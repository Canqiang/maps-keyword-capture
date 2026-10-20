#!/usr/bin/env python3
"""Isolated official Android runtime setup and evidence capture for Apple Silicon."""

import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import re
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
MAPS = "com.google.android.apps.maps"
IMAGE = "system-images;android-35;google_apis_playstore;arm64-v8a"
AVD = "maps-google-play-api35"


def run(argv, **kwargs):
    return subprocess.run([str(x) for x in argv], check=True, **kwargs)


def read(argv, env=None):
    return run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20, env=env).stdout.decode().strip()


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def java_home():
    candidates = [os.environ.get("JAVA_HOME"), "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home"]
    for candidate in candidates:
        if candidate and (Path(candidate) / "bin/java").is_file():
            return str(candidate)
    return None


def environment(root):
    env = os.environ.copy()
    env.update(ANDROID_HOME=str(root / "sdk"), ANDROID_USER_HOME=str(root / "user"),
               ANDROID_EMULATOR_HOME=str(root / "user"), ANDROID_AVD_HOME=str(root / "avd"),
               ADB_SERVER_SOCKET="tcp:127.0.0.1:5037", ANDROID_ADB_SERVER_PORT="5037")
    if java_home():
        env["JAVA_HOME"] = java_home()
    return env


def preflight(root, min_free_gib):
    ancestor = root
    while not ancestor.exists():
        ancestor = ancestor.parent
    disk = shutil.disk_usage(ancestor)
    system = platform.system()
    arch = platform.machine()
    hv = read(["sysctl", "-n", "kern.hv_support"]) if system == "Darwin" else "unknown"
    ram = int(read(["sysctl", "-n", "hw.memsize"])) if system == "Darwin" else None
    blockers = []
    if (system, arch) != ("Darwin", "arm64"):
        blockers.append("This lock and bootstrap support macOS arm64 only.")
    if hv != "1":
        blockers.append("Apple Hypervisor support is unavailable or unverified.")
    if disk.free < min_free_gib * 1024 ** 3:
        blockers.append(f"Insufficient free disk: {disk.free / 1024 ** 3:.2f} GiB; require {min_free_gib:g} GiB.")
    if not java_home():
        blockers.append("Set JAVA_HOME to a working JDK before bootstrapping; no global JDK is installed by this script.")
    return {"capturedAt": now(), "status": "blocked" if blockers else "ready_for_bootstrap",
            "host": {"system": system, "release": platform.release(), "macosVersion": platform.mac_ver()[0], "machine": arch,
                     "hypervisorSupported": hv == "1", "memoryBytes": ram, "logicalCpuCount": os.cpu_count()},
            "storage": {"checkedPath": str(ancestor), "freeBytes": disk.free, "requiredFreeGiB": min_free_gib},
            "runtimeRoot": str(root), "javaHome": java_home(),
            "installed": {"adb": (root / "sdk/platform-tools/adb").exists(),
                          "emulator": (root / "sdk/emulator/emulator").exists(),
                          "avd": (root / "avd" / f"{AVD}.avd").exists()},
            "blockers": blockers,
            "scope": "Host prerequisites only; no boot, Maps availability, UI, ranking, or cloud-runtime validation."}


def fetch(url):
    # Retain TLS validation. Python installations without CA bundles can use macOS curl.
    if urllib.parse.urlparse(url).netloc != "dl.google.com":
        raise ValueError("Only pinned official dl.google.com repository URLs are allowed.")
    return run(["curl", "--fail", "--silent", "--show-error", "--location", "--proto", "=https",
                "--proto-redir", "=https", "--tlsv1.2", "--max-time", "60", url],
               stdout=subprocess.PIPE).stdout


def verify_repository():
    """Reject package or license drift before allowing sdkmanager to download."""
    trees = {s["url"]: ET.fromstring(fetch(s["url"])) for s in LOCK["sources"]}
    for expected in LOCK["packages"]:
        matches = [p for p in trees[expected["source"]].findall("remotePackage")
                   if p.get("path") == expected["path"] and p.find("channelRef").get("ref") == "channel-0"]
        if len(matches) != 1:
            raise ValueError(f"Pinned stable package missing or ambiguous: {expected['path']}")
        package = matches[0]
        revision = ".".join(n.text for n in package.find("revision"))
        archive = next((a.find("complete") for a in package.findall("archives/archive")
                        if a.findtext("host-os") in (None, "macosx")
                        and a.findtext("host-arch") in (None, "aarch64")), None)
        if archive is None:
            raise ValueError(f"Compatible archive missing: {expected['path']}")
        url = urllib.parse.urljoin(expected["source"], archive.findtext("url"))
        if (revision != expected["revision"] or url != expected["archive"]["url"]
                or archive.findtext("checksum") != expected["archive"]["checksum"]
                or archive.find("checksum").get("type") != expected["archive"]["checksumAlgorithm"]
                or int(archive.findtext("size")) != expected["archive"]["sizeBytes"]
                or package.find("uses-license").get("ref") != expected["licenseId"]):
            raise ValueError(f"Package metadata changed; review and update the lock: {expected['path']}")
    for expected in LOCK["licenses"]:
        text = next(x.text for x in trees[expected["source"]].findall("license") if x.get("id") == expected["id"])
        if hashlib.sha256(text.encode()).hexdigest() != expected["textSha256"]:
            raise ValueError(f"License changed; human review required: {expected['id']}")
    return {"checkedAt": now(), "status": "matched", "packages": LOCK["packages"], "licenses": LOCK["licenses"]}


def bootstrap(args, root):
    report = preflight(root, args.min_free_gib)
    print(json.dumps(report, indent=2))
    if report["blockers"]:
        return 2
    if not args.sdk_license_accepted:
        raise ValueError("Review https://developer.android.com/studio/terms and obtain explicit approval before passing --sdk-license-accepted.")
    repository = verify_repository()
    sdk = root / "sdk"
    tools = sdk / "cmdline-tools/22.0"
    root.mkdir(parents=True, exist_ok=True)
    write_json(root / "receipts/repository.json", repository)
    env = environment(root)
    for name in ("user", "avd", "downloads"):
        (root / name).mkdir(exist_ok=True)
    commandline = next(p for p in LOCK["packages"] if p["path"] == "cmdline-tools;22.0")
    archive = root / "downloads" / Path(commandline["archive"]["url"]).name
    if not (tools / "bin/sdkmanager").exists():
        if tools.exists():
            raise ValueError(f"Incomplete command-line tools directory exists: {tools}. Inspect it before retrying; setup will not overwrite it.")
        if not archive.exists():
            temporary = archive.with_suffix(".partial")
            run(["curl", "--fail", "--show-error", "--location", "--proto", "=https", "--proto-redir", "=https",
                 "--tlsv1.2", "--retry", "2", "--output", temporary, commandline["archive"]["url"]])
            temporary.rename(archive)
        data = archive.read_bytes()
        if (len(data) != commandline["archive"]["sizeBytes"]
                or hashlib.sha256(data).hexdigest() != commandline["archive"]["sha256"]
                or hashlib.sha1(data).hexdigest() != commandline["archive"]["checksum"]):
            raise ValueError(f"Command-line tools hash or size mismatch: {archive}. Do not extract it.")
        with tempfile.TemporaryDirectory(prefix="extract-", dir=root) as temporary_dir:
            # Extract with system unzip so executable bits survive on macOS.
            with zipfile.ZipFile(archive) as package:
                if any(Path(x.filename).is_absolute() or ".." in Path(x.filename).parts for x in package.infolist()):
                    raise ValueError("Unsafe path in verified archive.")
            run(["unzip", "-q", archive, "-d", temporary_dir])
            tools.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(Path(temporary_dir) / "cmdline-tools"), tools)
        write_json(root / "receipts/commandline-download.json", {"verifiedAt": now(), "archive": commandline["archive"]})
    manager = tools / "bin/sdkmanager"
    run([manager, f"--sdk_root={sdk}", "--version"], env=env)
    print("SDK Manager may display package licenses. Review each prompt; this script never answers yes or runs --licenses automatically.", flush=True)
    # SDK Manager performs repository archive checksum verification. The metadata
    # guard above and the installed-revision guard below constrain package drift.
    selected = ["platform-tools", "emulator"]
    if not args.tools_only:
        selected.append(IMAGE)
    run([manager, f"--sdk_root={sdk}", "--channel=0", "--install", *selected], env=env)
    revisions = {}
    for package in LOCK["packages"]:
        if args.tools_only and package["path"] == IMAGE:
            continue
        properties = sdk.joinpath(*package["path"].split(";")) / "source.properties"
        values = dict(line.split("=", 1) for line in properties.read_text().splitlines() if "=" in line)
        values = {k.strip(): v.strip() for k, v in values.items()}
        actual = values.get("Pkg.Revision")
        if actual != package["revision"]:
            raise ValueError(f"Installed revision mismatch for {package['path']}: {actual}")
        revisions[package["path"]] = actual
    write_json(root / "receipts/installed.json", {"verifiedAt": now(), "scope": "sdk_tools_only" if args.tools_only else "runtime_packages", "revisions": revisions})
    return 0


def create_avd(root):
    if (root / "avd" / f"{AVD}.avd").exists():
        raise ValueError("AVD already exists. Existing data is preserved; do not recreate or wipe it implicitly.")
    root.joinpath("avd").mkdir(parents=True, exist_ok=True)
    manager = root / "sdk/cmdline-tools/22.0/bin/avdmanager"
    run([manager, "create", "avd", "--name", AVD, "--package", IMAGE, "--device", "pixel_7",
         "--path", root / "avd" / f"{AVD}.avd"], input="no\n", text=True, env=environment(root))
    # The only stdin answer above declines a custom hardware profile, not a license.
    configure_fresh_avd(root)
    return 0


def configure_fresh_avd(root):
    directory = root / "avd" / f"{AVD}.avd"
    if list(directory.glob("userdata*")):
        raise ValueError("Existing userdata is preserved; initial configuration cannot resize it.")
    config = directory / "config.ini"
    values = dict(line.split("=", 1) for line in config.read_text().splitlines() if "=" in line)
    values = {key.strip(): value.strip() for key, value in values.items()}
    if values.get("image.sysdir.1") != "system-images/android-35/google_apis_playstore/arm64-v8a/":
        raise ValueError("AVD Manager did not create the expected Google Play image configuration.")
    values.update({"avd.id": AVD, "avd.name": AVD, "PlayStore.enabled": "yes",
                   "disk.dataPartition.size": "6G"})
    config.write_text("".join(f"{key}={value}\n" for key, value in values.items()))


def first_boot_required_bytes(root):
    directory = root / "avd" / f"{AVD}.avd"
    values = dict(line.split("=", 1) for line in (directory / "config.ini").read_text().splitlines() if "=" in line)
    values = {key.strip(): value.strip() for key, value in values.items()}
    match = re.fullmatch(r"(\d+)\s*([KMG]?)(?:B)?", values.get("disk.dataPartition.size", "").upper())
    if not match:
        raise ValueError("Cannot budget the configured fresh userdata partition.")
    # The official emulator raises Google Play images to at least 6 GiB even if
    # config.ini asks for less. Budget physical capacity, not only sparse size.
    data_bytes = max(6 * 1024 ** 3, int(match[1]) * 1024 ** {"": 0, "K": 1, "M": 2, "G": 3}[match[2]])
    userdata = directory / "userdata-qemu.img"
    allocated = userdata.stat().st_blocks * 512 if userdata.is_file() and not userdata.is_symlink() else 0
    return max(0, data_bytes - allocated) + 512 * 1024 ** 2 + 4 * 1024 ** 3


def validate_image_entries(entries):
    for entry in entries:
        path = Path(entry.filename)
        kind = stat.S_IFMT(entry.external_attr >> 16)
        if (path.is_absolute() or ".." in path.parts
                or not entry.filename.startswith("arm64-v8a/")
                or kind not in (0, stat.S_IFREG, stat.S_IFDIR)
                or (kind == stat.S_IFDIR and not entry.is_dir())
                or (kind == stat.S_IFREG and entry.is_dir())):
            raise ValueError("Unexpected image archive entry; only regular files and directories are allowed.")


def install_image_archive(args, root):
    with (root / "image-install.lock").open("a") as lock_handle:
        try:
            fcntl.flock(lock_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("Another image installer is active; preserve its progress and wait.")
        return _install_image_archive(args, root)


def _install_image_archive(args, root):
    """Install a fully verified prefetch, then require SDK Manager recognition."""
    if not args.license_accepted:
        raise ValueError("Explicit approval of the Google Play ARM image license is required.")
    verify_repository()
    package = next(p for p in LOCK["packages"] if p["path"] == IMAGE)
    archive = root / "downloads" / Path(package["archive"]["url"]).name
    expected = package["archive"]
    if not archive.is_file() or archive.stat().st_size != expected["sizeBytes"]:
        raise ValueError("Complete prefetched image archive is missing or has the wrong size.")
    digest = hashlib.new(expected["checksumAlgorithm"])
    with archive.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 ** 2), b""):
            digest.update(block)
    if digest.hexdigest() != expected["checksum"]:
        raise ValueError("Prefetched image archive failed its official repository checksum.")
    target = root / "sdk/system-images/android-35/google_apis_playstore/arm64-v8a"
    if target.exists():
        raise ValueError(f"Image destination already exists; inspect before changing it: {target}")
    with zipfile.ZipFile(archive) as content:
        entries = content.infolist()
        validate_image_entries(entries)
        required = sum(p.file_size for p in entries) + 4 * 1024 ** 3
        if shutil.disk_usage(root).free < required:
            raise ValueError(f"Image extraction requires {required / 1024 ** 3:.2f} GiB including a 4 GiB reserve.")
    with tempfile.TemporaryDirectory(prefix="image-stage-", dir=root) as staging:
        run(["unzip", "-q", archive, "-d", staging])
        image = Path(staging) / "arm64-v8a"
        properties = dict(line.split("=", 1) for line in (image / "source.properties").read_text().splitlines() if "=" in line)
        properties = {key.strip(): value.strip() for key, value in properties.items()}
        required_properties = {"Pkg.Revision": package["revision"], "AndroidVersion.ApiLevel": "35",
                               "SystemImage.Abi": "arm64-v8a", "SystemImage.TagId": "google_apis_playstore"}
        if any(properties.get(key) != value for key, value in required_properties.items()):
            raise ValueError("Extracted image source.properties does not match the pin.")
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            raise ValueError("Image destination appeared during extraction; staged files will not overwrite it.")
        image.rename(target)
    manager = root / "sdk/cmdline-tools/22.0/bin/sdkmanager"
    listing = run([manager, f"--sdk_root={root / 'sdk'}", "--list_installed"], env=environment(root),
                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60).stdout.decode()
    matches = [line.split("|") for line in listing.splitlines() if line.split("|")[0].strip() == IMAGE]
    if not any(len(fields) > 1 and fields[1].strip() == package["revision"] for fields in matches):
        raise ValueError("Image extracted, but SDK Manager did not confirm its pinned package/revision. Inspect before creating an AVD.")
    write_json(root / "receipts/image-installed.json", {"verifiedAt": now(), "package": package,
               "method": "verified_archive_extraction_with_sdkmanager_readback", "sdkManagerListing": listing})
    return 0


def start_avd(args, root):
    report = preflight(root, args.min_free_gib)
    if report["blockers"]:
        print(json.dumps(report, indent=2))
        return 2
    required = first_boot_required_bytes(root)
    if shutil.disk_usage(root).free < required:
        raise ValueError(f"AVD start requires {required / 1024 ** 3:.2f} GiB for initial userdata, SD card, and a 4 GiB reserve.")
    emulator = root / "sdk/emulator/emulator"
    run([emulator, "-accel-check"], env=environment(root))
    command = [str(emulator), "-avd", AVD, "-port", str(args.port), "-memory", "2048", "-cores", "2",
               "-no-snapshot", "-no-audio", "-no-boot-anim", "-no-metrics", "-gpu", "auto", "-timezone", args.timezone]
    if not args.window:
        command.append("-no-window")
    # Foreground process; the operator can stop only this emulator with Ctrl-C.
    return subprocess.call(command, env=environment(root))


def device_evidence(args, root):
    adb = root / "sdk/platform-tools/adb"
    env = environment(root)
    base = [str(adb), "-H", "127.0.0.1", "-P", "5037", "-s", args.serial]
    if read(base + ["get-state"], env=env) != "device":
        raise ValueError("Selected adb device is not online.")
    if read(base + ["shell", "getprop", "sys.boot_completed"], env=env) != "1":
        raise ValueError("Android boot is not complete.")
    avd_name = read(base + ["emu", "avd", "name"], env=env).splitlines()[0]
    if avd_name != AVD:
        raise ValueError(f"Selected emulator is {avd_name!r}, expected {AVD!r}; capture stopped.")
    output = Path(args.output).expanduser().resolve()
    if output.exists() and any(output.iterdir()):
        raise ValueError("Evidence directory is nonempty; use a fresh directory to preserve earlier evidence.")
    output.mkdir(parents=True, exist_ok=True)
    status = {"capturedAt": now(), "serial": args.serial, "avdName": avd_name, "package": MAPS, "checks": {},
              "scope": "Raw device evidence only; does not establish ranking extraction or current public Maps visibility."}
    commands = {"adb-version.txt": [str(adb), "version"],
                "properties.txt": base + ["shell", "getprop"],
                "maps-package.txt": base + ["shell", "dumpsys", "package", MAPS],
                "maps-path.txt": base + ["shell", "pm", "path", MAPS],
                "maps-installer.txt": base + ["shell", "pm", "list", "packages", "-i", MAPS],
                "current-window.txt": base + ["shell", "dumpsys", "window", "windows"]}
    for name, command in commands.items():
        try:
            (output / name).write_text(read(command, env=env) + "\n")
            status["checks"][name] = "captured"
        except (subprocess.SubprocessError, OSError) as error:
            status["checks"][name] = str(error)
    maps_path = output / "maps-path.txt"
    status["mapsInstalled"] = maps_path.exists() and maps_path.read_text().startswith("package:")
    try:
        png = run(base + ["exec-out", "screencap", "-p"], stdout=subprocess.PIPE, timeout=30, env=env).stdout
        if not png.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("adb screencap output is not a PNG.")
        (output / "screen.png").write_bytes(png)
        status["checks"]["screen.png"] = "captured"
    except (subprocess.SubprocessError, ValueError) as error:
        status["checks"]["screen.png"] = str(error)
    remote = f"/sdcard/maps-evidence-{os.getpid()}.xml"
    try:
        run(base + ["shell", "uiautomator", "dump", remote], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, env=env)
        run(base + ["pull", remote, output / "hierarchy.xml"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, env=env)
        ET.parse(output / "hierarchy.xml")
        status["checks"]["hierarchy.xml"] = "captured"
    except (subprocess.SubprocessError, ET.ParseError, OSError) as error:
        status["checks"]["hierarchy.xml"] = str(error)
    finally:
        try:
            run(base + ["shell", "rm", "-f", remote], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10, env=env)
        except (subprocess.SubprocessError, OSError) as error:
            status["checks"]["hierarchy-cleanup"] = str(error)
    status["files"] = [{"path": p.name, "sha256": hashlib.sha256(p.read_bytes()).hexdigest(), "sizeBytes": p.stat().st_size}
                       for p in sorted(output.iterdir()) if p.is_file()]
    status["status"] = "captured" if status["mapsInstalled"] and all(v == "captured" for v in status["checks"].values()) else "partial"
    write_json(output / "device-evidence.json", status)
    print(json.dumps(status, indent=2))
    return 0 if status["status"] == "captured" else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=str(Path.home() / ".local/share/maps-android"))
    parser.add_argument("--min-free-gib", type=float, default=15)
    sub = parser.add_subparsers(dest="command", required=True)
    pre = sub.add_parser("preflight")
    pre.add_argument("--output")
    sub.add_parser("verify-repository")
    boot = sub.add_parser("bootstrap")
    boot.add_argument("--sdk-license-accepted", action="store_true", help="Use only after the human has explicitly accepted the SDK terms.")
    boot.add_argument("--tools-only", action="store_true", help="Install SDK tools without the Google Play ARM image.")
    sub.add_parser("create-avd")
    offline = sub.add_parser("install-image-archive")
    offline.add_argument("--license-accepted", action="store_true")
    start = sub.add_parser("start-avd")
    start.add_argument("--port", type=int, default=5554)
    start.add_argument("--timezone", default="America/New_York")
    start.add_argument("--window", action="store_true")
    evidence = sub.add_parser("device-evidence")
    evidence.add_argument("--serial", required=True)
    evidence.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(args.root).expanduser().resolve()
    if args.min_free_gib <= 0:
        parser.error("--min-free-gib must be positive")
    if args.command == "preflight":
        result = preflight(root, args.min_free_gib)
        if args.output:
            write_json(Path(args.output), result)
        print(json.dumps(result, indent=2))
        return 2 if result["blockers"] else 0
    if args.command == "verify-repository":
        print(json.dumps(verify_repository(), indent=2))
        return 0
    if args.command == "bootstrap":
        return bootstrap(args, root)
    if args.command == "create-avd":
        return create_avd(root)
    if args.command == "install-image-archive":
        return install_image_archive(args, root)
    if args.command == "start-avd":
        return start_avd(args, root)
    return device_evidence(args, root)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(f"Android host setup stopped: {error}", file=sys.stderr)
        sys.exit(2)
