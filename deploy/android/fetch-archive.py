#!/usr/bin/env python3
"""Fetch one pinned official SDK archive with at most four HTTPS range requests."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import fcntl
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import threading
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("package", choices=["emulator", "platform-tools", "system-images;android-35;google_apis_playstore;arm64-v8a"])
parser.add_argument("--root", default=str(Path.home() / ".local/share/maps-android"))
parser.add_argument("--license-accepted", action="store_true", help="Only use after explicit approval of this package's license.")
args = parser.parse_args()
if not args.license_accepted:
    parser.error("Explicit approval of the selected package's license is required before downloading.")
lock = json.loads((Path(__file__).parent / "packages.lock.json").read_text())
package = next(p for p in lock["packages"] if p["path"] == args.package)
archive = package["archive"]
root = Path(args.root).expanduser().resolve()
directory = root / "downloads"
directory.mkdir(parents=True, exist_ok=True)
target = directory / Path(archive["url"]).name
lock_handle = (directory / (target.name + ".lock")).open("a")
try:
    fcntl.flock(lock_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    raise SystemExit("Another process is fetching this archive; preserve its progress and wait.")
parts = directory / (target.name + ".parts")
parts.mkdir(exist_ok=True)
size = archive["sizeBytes"]
chunk_size = 16 * 1024 ** 2
count = (size + chunk_size - 1) // chunk_size
stop = threading.Event()
children = set()
children_lock = threading.Lock()


def curl_output(command):
    with children_lock:
        if stop.is_set():
            raise RuntimeError("Range fetch cancelled before curl startup.")
        process = subprocess.Popen(command, stdout=subprocess.PIPE, text=True)
        children.add(process)
    try:
        output, _ = process.communicate()
        if process.returncode:
            raise subprocess.CalledProcessError(process.returncode, command)
        return output
    finally:
        with children_lock:
            children.discard(process)


def verify(path):
    if not path.is_file() or path.stat().st_size != size:
        return False
    digest = hashlib.new(archive["checksumAlgorithm"])
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 ** 2), b""):
            digest.update(block)
    return digest.hexdigest() == archive["checksum"]


def required_free_before_requests():
    cached = 0
    for index in range(count):
        part = parts / f"{index:05}.part"
        expected = min(chunk_size, size - index * chunk_size)
        if part.exists() and part.stat().st_size == expected:
            cached += expected
    # Incomplete parts are deliberately not credited. Keep space for all missing
    # bytes, a second assembled copy, and the operational 4 GiB reserve.
    return size - cached + size + 4 * 1024 ** 3


if target.exists():
    if not verify(target):
        raise SystemExit(f"Existing archive does not match the pin; inspect before retrying: {target}")
    print(f"Already verified: {target}")
    raise SystemExit(0)
# Peak includes parts and assembled archive, while retaining a 4 GiB host reserve.
if shutil.disk_usage(root).free < required_free_before_requests():
    raise SystemExit("Insufficient space for range parts, assembled archive, and 4 GiB reserve.")


def fetch(index):
    if stop.is_set():
        raise RuntimeError("Another range failed; no new request started.")
    if shutil.disk_usage(root).free < required_free_before_requests():
        raise RuntimeError("Free disk no longer covers missing range bytes, assembly, and 4 GiB reserve; downloaded parts preserved.")
    start = index * chunk_size
    end = min(size - 1, start + chunk_size - 1)
    path = parts / f"{index:05}.part"
    if path.exists() and path.stat().st_size == end - start + 1:
        return index
    temporary = path.with_suffix(".partial")
    headers = path.with_suffix(".headers")
    response = curl_output([
        "curl", "--silent", "--show-error", "--fail", "--location", "--proto", "=https",
        "--proto-redir", "=https", "--tlsv1.2", "--retry", "2", "--connect-timeout", "15",
        "--max-time", "300", "--max-filesize", str(end - start + 1), "--range", f"{start}-{end}",
        "--dump-header", str(headers), "--output", str(temporary),
        "--write-out", "%{http_code}", archive["url"]])
    content_ranges = [line.split(":", 1)[1].strip() for line in headers.read_text().splitlines()
                      if line.lower().startswith("content-range:")]
    if (response != "206" or temporary.stat().st_size != end - start + 1
            or not content_ranges or content_ranges[-1] != f"bytes {start}-{end}/{size}"):
        raise RuntimeError(f"Invalid range response for part {index}: HTTP {response}")
    temporary.replace(path)
    headers.unlink()
    return index


started = time.monotonic()
with ThreadPoolExecutor(max_workers=4) as pool:
    jobs = [pool.submit(fetch, i) for i in range(count)]
    try:
        for completed, future in enumerate(as_completed(jobs), 1):
            future.result()
            print(f"{completed}/{count} verified-size range parts; {time.monotonic()-started:.0f}s elapsed", flush=True)
    except BaseException:
        stop.set()
        for job in jobs:
            job.cancel()
        with children_lock:
            for process in children:
                process.terminate()
        raise
temporary = target.with_suffix(".assembled")
if shutil.disk_usage(root).free < size + 4 * 1024 ** 3:
    raise SystemExit("Insufficient space to assemble archive while retaining a 4 GiB reserve; downloaded parts preserved.")
with temporary.open("wb") as output:
    for index in range(count):
        with (parts / f"{index:05}.part").open("rb") as source:
            shutil.copyfileobj(source, output, 4 * 1024 ** 2)
if not verify(temporary):
    raise SystemExit("Assembled archive checksum mismatch; parts preserved for inspection.")
temporary.replace(target)
sha256 = hashlib.sha256()
with target.open("rb") as stream:
    for block in iter(lambda: stream.read(4 * 1024 ** 2), b""):
        sha256.update(block)
receipt = {"package": package["path"], "archive": archive, "verifiedChecksum": archive["checksum"],
           "sha256": sha256.hexdigest(), "sha256Source": "locally computed after official repository checksum matched",
           "elapsedSeconds": round(time.monotonic()-started, 2), "parallelism": 4, "path": str(target)}
(root / "receipts").mkdir(exist_ok=True)
(root / "receipts" / (target.name + ".json")).write_text(json.dumps(receipt, indent=2) + "\n")
for index in range(count):
    (parts / f"{index:05}.part").unlink()
parts.rmdir()
print(json.dumps(receipt, indent=2))
