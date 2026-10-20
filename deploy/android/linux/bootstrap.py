#!/usr/bin/env python3
"""Pinned official Linux x86_64 SDK install. Run inside the dedicated runtime Pod."""
import argparse
import copy
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile

HERE = Path(__file__).resolve().parent
LOCK = json.loads((HERE / "packages.lock.json").read_text())
GIB = 1024 ** 3
IMAGE = "system-images;android-35;google_apis_playstore;x86_64"
AVD = "maps-google-play-api35-x86_64"


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + "\n")


def run(command, **kwargs):
    return subprocess.run([str(x) for x in command], check=True, **kwargs)


def environment(root):
    env = os.environ.copy()
    for key in ("ANDROID_SDK_ROOT", "ANDROID_SERIAL", "ANDROID_ADB_SERVER_ADDRESS"):
        env.pop(key, None)
    env.update(ANDROID_HOME=str(root / "sdk"), ANDROID_USER_HOME=str(root / "user"),
               ANDROID_EMULATOR_HOME=str(root / "user"), ANDROID_AVD_HOME=str(root / "avd"),
               ADB_VENDOR_KEYS=str(root / "user/adbkey"),
               ADB_SERVER_SOCKET="tcp:127.0.0.1:5037", ANDROID_ADB_SERVER_PORT="5037",
               JAVA_HOME=os.environ.get("JAVA_HOME", "/usr/lib/jvm/java-17-openjdk-amd64"))
    return env


def official_url(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc != "dl.google.com" or not parsed.path.startswith("/android/repository/"):
        raise ValueError("Only pinned official HTTPS SDK repository URLs are allowed")


def verify_repository(root):
    trees = {}
    documents = {}
    sources = []
    for source in LOCK["sources"]:
        official_url(source["url"])
        data = run(["curl", "--fail", "--silent", "--show-error", "--proto", "=https", "--max-time", "60", source["url"]],
                   stdout=subprocess.PIPE).stdout
        trees[source["url"]] = ET.fromstring(data)
        documents[source["url"]] = data
        sources.append({"url": source["url"], "sha256": hashlib.sha256(data).hexdigest()})
    for expected in LOCK["packages"]:
        matches = [p for p in trees[expected["source"]].findall("remotePackage")
                   if p.get("path") == expected["path"] and p.find("channelRef").get("ref") == "channel-0"]
        if len(matches) != 1:
            raise ValueError("Pinned stable package missing or ambiguous: " + expected["path"])
        package = matches[0]
        archives = [a.find("complete") for a in package.findall("archives/archive")
                    if a.findtext("host-os") in (None, "linux") and a.findtext("host-arch") in (None, "x64")]
        if len(archives) != 1:
            raise ValueError("Compatible Linux archive missing or ambiguous")
        archive = archives[0]
        actual = {"url": urllib.parse.urljoin(expected["source"], archive.findtext("url")),
                  "sizeBytes": int(archive.findtext("size")), "checksumAlgorithm": archive.find("checksum").get("type"),
                  "checksum": archive.findtext("checksum")}
        if (any(actual[k] != expected["archive"][k] for k in actual)
                or ".".join(x.text for x in package.find("revision")) != expected["revision"]
                or package.find("uses-license").get("ref") != expected["licenseId"]):
            raise ValueError("Package metadata drift; review lock before continuing: " + expected["path"])
    for expected in LOCK["licenses"]:
        license_text = next(x.text for x in trees[expected["source"]].findall("license") if x.get("id") == expected["id"])
        if hashlib.sha256(license_text.encode()).hexdigest() != expected["textSha256"]:
            raise ValueError("License text changed; renewed human review required: " + expected["id"])
    metadata_files = {}
    for index, source in enumerate(LOCK["sources"]):
        path = root / "receipts" / f"linux-repository-{index}.xml"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(documents[source["url"]])
        metadata_files[source["url"]] = str(path)
    receipt = {"checkedAt": now(), "status": "matched", "sources": sources, "packages": LOCK["packages"], "licenses": LOCK["licenses"],
               "metadataFiles": metadata_files}
    write_json(root / "receipts/linux-repository.json", receipt)
    return receipt


def verify_archive(path, expected):
    if path.is_symlink() or path.stat().st_size != expected["sizeBytes"]:
        raise ValueError("Archive size mismatch or symlink: " + str(path))
    digests = {expected["checksumAlgorithm"]: hashlib.new(expected["checksumAlgorithm"]), "sha256": hashlib.sha256()}
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 ** 2), b""):
            for digest in digests.values():
                digest.update(block)
    actual = {key: digest.hexdigest() for key, digest in digests.items()}
    if actual[expected["checksumAlgorithm"]] != expected["checksum"] or (expected.get("sha256") and actual["sha256"] != expected["sha256"]):
        raise ValueError("Archive checksum mismatch: " + str(path))
    return {"sizeBytes": path.stat().st_size, "digests": actual, "officialExpected": expected}


def extract_archive(path, destination, archive_root, reserve_bytes=4 * GIB):
    """Prevalidate all paths; only allow internal symlinks, never write through them."""
    if destination.exists() and any(destination.iterdir()):
        raise ValueError("Extraction staging directory must be empty")
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path) as content:
        entries = content.infolist()
        seen, links = set(), {}
        for entry in entries:
            item = PurePosixPath(entry.filename)
            mode = stat.S_IFMT(entry.external_attr >> 16)
            if (item.is_absolute() or ".." in item.parts or "\\" in entry.filename or not item.parts
                    or item.parts[0] != archive_root or item in seen
                    or mode not in (0, stat.S_IFREG, stat.S_IFDIR, stat.S_IFLNK)
                    or (mode == stat.S_IFDIR and not entry.is_dir())
                    or (mode in (stat.S_IFREG, stat.S_IFLNK) and entry.is_dir())):
                raise ValueError("Unsafe archive path or file type: " + entry.filename)
            seen.add(item)
            if mode == stat.S_IFLNK:
                if entry.file_size > 4096:
                    raise ValueError("Unsafe oversized archive link")
                target = content.read(entry).decode("utf-8")
                resolved = (destination / str(item.parent) / target).resolve()
                if (PurePosixPath(target).is_absolute() or "\\" in target or "\x00" in target
                        or not resolved.is_relative_to(destination.resolve() / archive_root)):
                    raise ValueError("Unsafe archive symlink: " + entry.filename)
                links[item] = target
        if any(parent in links for item in seen for parent in item.parents):
            raise ValueError("Unsafe archive writes through a symlink")
        if shutil.disk_usage(destination).free < sum(x.file_size for x in entries) + reserve_bytes:
            raise ValueError("Insufficient free space for full extraction plus reserve")
        for entry in entries:
            item = PurePosixPath(entry.filename)
            output = destination / str(item)
            if item in links:
                continue
            if entry.is_dir():
                output.mkdir(parents=True, exist_ok=True)
            else:
                output.parent.mkdir(parents=True, exist_ok=True)
                with content.open(entry) as source, output.open("xb") as target:
                    shutil.copyfileobj(source, target, 4 * 1024 ** 2)
                output.chmod((entry.external_attr >> 16) & 0o777 or 0o644)
        for item, target in links.items():
            output = destination / str(item)
            output.parent.mkdir(parents=True, exist_ok=True)
            output.symlink_to(target)
        # A composition of individually safe links can escape after creation.
        # Check the complete graph before the caller publishes this staging tree.
        for item in links:
            try:
                resolved = (destination / str(item)).resolve(strict=True)
            except (RuntimeError, OSError) as error:
                raise ValueError("Unsafe archive symlink cycle") from error
            if not resolved.is_relative_to(destination.resolve() / archive_root):
                raise ValueError("Unsafe composed archive symlink: " + str(item))


def properties(path):
    return {k.strip(): v.strip() for line in path.read_text().splitlines() if "=" in line for k, v in [line.split("=", 1)]}


def local_package_metadata(package, document, license_pin):
    """Convert the verified official generic remotePackage to SDK local metadata."""
    tree = ET.fromstring(document)
    matches = [p for p in tree.findall("remotePackage") if p.get("path") == package["path"]
               and p.find("channelRef").get("ref") == "channel-0"]
    if len(matches) != 1:
        raise ValueError("Missing or ambiguous stable package metadata")
    remote = matches[0]
    if ".".join(x.text for x in remote.find("revision")) != package["revision"]:
        raise ValueError("Package metadata revision does not match the pin")
    licenses = [entry for entry in tree.findall("license") if entry.get("id") == license_pin["id"]]
    if (len(licenses) != 1 or remote.find("uses-license").get("ref") != package["licenseId"]
            or license_pin["id"] != package["licenseId"]
            or hashlib.sha256((licenses[0].text or "").encode()).hexdigest() != license_pin["textSha256"]):
        raise ValueError("Package metadata license does not match the accepted text")
    xsi = "http://www.w3.org/2001/XMLSchema-instance"
    common = "http://schemas.android.com/repository/android/common/02"
    if remote.find("type-details").get("{" + xsi + "}type") != "generic:genericDetailsType":
        raise ValueError("Only the pinned generic SDK packages need this registration")
    ET.register_namespace("repo", common)
    ET.register_namespace("xsi", xsi)
    # QName namespace declarations used only inside xsi:type are not retained by
    # ElementTree. Preserve generic explicitly so the SDK's JAXB reader resolves it.
    repository = ET.Element("{" + common + "}repository", {"xmlns:generic": "http://schemas.android.com/repository/android/generic/02"})
    repository.append(copy.deepcopy(licenses[0]))
    local = ET.SubElement(repository, "localPackage", {"path": package["path"], "obsolete": "false"})
    for name in ("type-details", "revision", "display-name", "uses-license", "dependencies"):
        element = remote.find(name)
        if element is not None:
            local.append(copy.deepcopy(element))
    return ET.tostring(repository, encoding="utf-8", xml_declaration=True)


def register_generic_packages(root, repository):
    registered = []
    for package in LOCK["packages"]:
        if package["path"] not in ("cmdline-tools;22.0", "emulator"):
            continue
        target = (root / "sdk").joinpath(*package["path"].split(";"))
        receipt_path = root / "receipts" / (package["path"].replace(";", "_") + "-archive.json")
        if not receipt_path.is_file() or json.loads(receipt_path.read_text()).get("officialExpected") != package["archive"]:
            raise ValueError("Cannot register a package without its verified archive receipt")
        values = properties(target / "source.properties")
        if values.get("Pkg.Revision") != package["revision"] or values.get("Pkg.Path") != package["path"]:
            raise ValueError("Cannot register package metadata for a different installed identity")
        if (target / "package.xml").exists():
            continue  # Preserve existing metadata; strict SDK Manager readback follows.
        document = Path(repository["metadataFiles"][package["source"]]).read_bytes()
        source_pin = next(s for s in repository["sources"] if s["url"] == package["source"])
        if hashlib.sha256(document).hexdigest() != source_pin["sha256"]:
            raise ValueError("Verified source metadata changed before registration")
        license_pin = next(p for p in LOCK["licenses"] if p["source"] == package["source"] and p["id"] == package["licenseId"])
        metadata = local_package_metadata(package, document, license_pin)
        with (target / "package.xml").open("xb") as output:
            output.write(metadata)
        registered.append({"packagePath": package["path"], "revision": package["revision"],
                           "source": package["source"], "sha256": hashlib.sha256(metadata).hexdigest()})
    if registered:
        write_json(root / "receipts/linux-package-registration.json", {"registeredAt": now(), "packages": registered,
                   "scope": "Official metadata registration only; installed package readback is a separate required gate"})


def check_installed_listing(listing, packages):
    rows = [tuple(part.strip() for part in line.split("|")) for line in listing.splitlines()]
    for package in packages:
        if not any(len(row) >= 2 and row[:2] == (package["path"], package["revision"]) for row in rows):
            raise ValueError("SDK Manager did not recognize pinned package/revision: " + package["path"])


def installed_readback(root):
    sdk = root / "sdk"
    for package in LOCK["packages"]:
        target = sdk.joinpath(*package["path"].split(";"))
        if properties(target / "source.properties").get("Pkg.Revision") != package["revision"]:
            raise ValueError("Installed source.properties revision mismatch: " + package["path"])
    result = run([sdk / "cmdline-tools/22.0/bin/sdkmanager", f"--sdk_root={sdk}", "--list_installed"], env=environment(root),
                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
    listing = result.stdout.decode()
    (root / "receipts").mkdir(parents=True, exist_ok=True)
    (root / "receipts/linux-sdkmanager-list.txt").write_text(listing)
    (root / "receipts/linux-sdkmanager-stderr.txt").write_bytes(result.stderr)
    check_installed_listing(listing, LOCK["packages"])
    write_json(root / "receipts/linux-installed.json", {"verifiedAt": now(), "scope": "runtime_packages_only",
               "sdkManagerListing": listing, "packages": LOCK["packages"]})
    print(listing)


def require_linux():
    if (platform.system(), platform.machine()) != ("Linux", "x86_64"):
        raise ValueError("Run installation/start only inside the dedicated Linux x86_64 container")


def install(root, accepted):
    require_linux()
    if not accepted:
        raise ValueError("--sdk-license-accepted must reflect prior human approval of the exact pinned SDK terms")
    if not Path(environment(root)["JAVA_HOME"], "bin/java").is_file():
        raise ValueError("Install root prerequisites and set the Linux JAVA_HOME first")
    if shutil.disk_usage(root).free < 20 * GIB:
        raise ValueError("Require 20 GiB free for the initial installation; use the 64 GiB runtime PVC")
    repository = verify_repository(root)
    write_json(root / "receipts/linux-license-authorization.json", {"recordedAt": now(), "operatorAssertedPriorAcceptance": True,
               "licenses": LOCK["licenses"], "scope": "Exact previously accepted Android SDK terms only; no blanket license acceptance"})
    for name in ("downloads", "user", "avd", "sdk"):
        (root / name).mkdir(exist_ok=True)
    for package in LOCK["packages"]:
        target = (root / "sdk").joinpath(*package["path"].split(";"))
        receipt_path = root / "receipts" / (package["path"].replace(";", "_") + "-archive.json")
        if target.exists():
            if not receipt_path.exists() or json.loads(receipt_path.read_text()).get("officialExpected") != package["archive"]:
                raise ValueError("Existing package lacks matching download receipt; inspect before replacing: " + str(target))
            if properties(target / "source.properties").get("Pkg.Revision") != package["revision"]:
                raise ValueError("Existing package revision changed: " + str(target))
            continue
        archive = root / "downloads" / Path(package["archive"]["url"]).name
        if not archive.exists():
            partial = archive.with_suffix(".partial")
            official_url(package["archive"]["url"])
            run(["curl", "--fail", "--show-error", "--proto", "=https", "--connect-timeout", "30", "--max-time", "3600",
                 "--retry", "2", "--output", partial, package["archive"]["url"]], timeout=10900)
            verify_archive(partial, package["archive"])
            partial.rename(archive)
        verification = verify_archive(archive, package["archive"])
        with tempfile.TemporaryDirectory(prefix="linux-extract-", dir=root) as temporary:
            extract_archive(archive, Path(temporary), package["archiveRoot"])
            source = Path(temporary) / package["archiveRoot"]
            values = properties(source / "source.properties")
            expected = {"Pkg.Revision": package["revision"]}
            if package["path"] == IMAGE:
                expected.update({"AndroidVersion.ApiLevel": "35", "SystemImage.Abi": "x86_64", "SystemImage.TagId": "google_apis_playstore"})
            if any(values.get(key) != value for key, value in expected.items()):
                raise ValueError("Extracted package properties do not match pin: " + package["path"])
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                raise ValueError("Package destination appeared during extraction")
            source.rename(target)
        write_json(receipt_path, {"verifiedAt": now(), "packagePath": package["path"], **verification})
        print("Installed verified archive: " + package["path"], flush=True)
    register_generic_packages(root, repository)
    installed_readback(root)


def create_avd(root, small):
    require_linux()
    installed_readback(root)
    avd = root / "avd" / (AVD + ".avd")
    if avd.exists() or (root / "avd" / (AVD + ".ini")).exists():
        raise ValueError("AVD already exists; preserve it, never implicitly recreate or wipe userdata")
    run([root / "sdk/cmdline-tools/22.0/bin/avdmanager", "create", "avd", "--name", AVD, "--package", IMAGE,
         "--device", "pixel_7", "--path", avd], input="no\n", text=True, env=environment(root), timeout=120)
    config = avd / "config.ini"
    values = properties(config)
    if values.get("image.sysdir.1") != "system-images/android-35/google_apis_playstore/x86_64/" or list(avd.glob("userdata*")):
        raise ValueError("Unexpected image or preexisting userdata; inspect AVD before continuing")
    width, height, density = (720, 1280, 320) if small else (1080, 1920, 420)
    values.update({"avd.id": AVD, "avd.name": AVD, "PlayStore.enabled": "yes", "disk.dataPartition.size": "6G",
                   "hw.cpu.ncore": "2", "hw.ramSize": "3072", "hw.lcd.width": str(width), "hw.lcd.height": str(height),
                   "hw.lcd.density": str(density), "hw.keyboard": "yes", "hw.gpu.enabled": "yes", "hw.gpu.mode": "swiftshader",
                   "hw.camera.back": "none", "hw.camera.front": "none", "showDeviceFrame": "no", "skin.name": f"{width}x{height}",
                   "skin.path": f"{width}x{height}", "fastboot.forceColdBoot": "yes", "fastboot.forceFastBoot": "no"})
    config.write_text("".join(f"{k}={v}\n" for k, v in values.items()))
    write_json(root / "receipts/linux-avd.json", {"createdAt": now(), "avdName": AVD, "config": values, "status": "configured_not_booted"})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=os.environ.get("MAPS_ANDROID_ROOT", "/runtime"))
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("verify-repository")
    boot = sub.add_parser("install")
    boot.add_argument("--sdk-license-accepted", action="store_true")
    avd = sub.add_parser("create-avd")
    avd.add_argument("--small-screen", action="store_true")
    sub.add_parser("readback")
    args = parser.parse_args()
    root = Path(args.root).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    with (root / "linux-bootstrap.lock").open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.command == "verify-repository":
            print(json.dumps(verify_repository(root), indent=2))
        elif args.command == "install":
            install(root, args.sdk_license_accepted)
        elif args.command == "create-avd":
            create_avd(root, args.small_screen)
        else:
            require_linux()
            installed_readback(root)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError, zipfile.BadZipFile, ET.ParseError) as error:
        print("Linux Android setup stopped: " + str(error), file=sys.stderr)
        sys.exit(2)
