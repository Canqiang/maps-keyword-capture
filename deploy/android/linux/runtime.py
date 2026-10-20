#!/usr/bin/env python3
"""Foreground KVM emulator supervisor with bounded readiness and local control ports."""
import argparse
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import stat
import subprocess
import sys
import time

from bootstrap import AVD, GIB, environment, now, properties, require_linux, run, write_json


def probe_kvm(path=Path("/dev/kvm")):
    info = path.stat()
    if not stat.S_ISCHR(info.st_mode) or (os.major(info.st_rdev), os.minor(info.st_rdev)) != (10, 232):
        raise ValueError("KVM must be the real character device 10:232")
    descriptor = os.open(path, os.O_RDWR | os.O_CLOEXEC)
    try:
        version = fcntl.ioctl(descriptor, 0xAE00, 0)  # KVM_GET_API_VERSION
        if version != 12:
            raise ValueError("Unexpected KVM API version")
        vm = fcntl.ioctl(descriptor, 0xAE01, 0)  # KVM_CREATE_VM; no guest is run.
        os.close(vm)
    finally:
        os.close(descriptor)
    return {"path": str(path), "apiVersion": version, "createVm": "passed", "device": "10:232"}


def wait_for_boot(process, adb, env, timeout):
    deadline = time.monotonic() + timeout
    while True:
        if process.poll() is not None:
            raise ValueError(f"Emulator exited before readiness with status {process.returncode}")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError("Android boot deadline exceeded; inspect emulator log")
        try:
            completed = run(adb + ["shell", "getprop", "sys.boot_completed"], env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=min(10, remaining)).stdout.decode().strip()
            if completed == "1":
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    continue
                name = run(adb + ["emu", "avd", "name"], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                           timeout=min(10, remaining)).stdout.decode().splitlines()[0]
                if name != AVD:
                    raise ValueError("ADB serial belongs to a different AVD: " + name)
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    continue
                package = run(adb + ["shell", "pm", "path", "android"], env=env, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=min(10, remaining)).stdout.decode().strip()
                if package.startswith("package:"):
                    return
        except (subprocess.SubprocessError, OSError):
            pass
        time.sleep(min(2, max(0, deadline - time.monotonic())))


def check_loopback_ports(ports):
    """Fail if any relevant TCP listener is exposed on a wildcard/nonlocal address."""
    listing = run(["ss", "-H", "-ltn"], stdout=subprocess.PIPE, timeout=10).stdout.decode()
    seen = set()
    for row in listing.splitlines():
        endpoint = row.split()[3]
        host, port = endpoint.rsplit(":", 1)
        if port not in {str(p) for p in ports}:
            continue
        host = host.strip("[]")
        try:
            address = ipaddress.ip_address(host)
            mapped = getattr(address, "ipv4_mapped", None)
            local = address.is_loopback or (mapped is not None and mapped.is_loopback)
        except ValueError:
            local = False
        if not local:
            raise ValueError("Runtime control port is not loopback-only: " + endpoint)
        seen.add(int(port))
    if not {5037, 5554, 5555}.issubset(seen):
        raise ValueError("Expected ADB/emulator loopback listeners are missing")
    return listing


def read_maps_path(adb, env):
    result = subprocess.run(adb + ["shell", "pm", "path", "com.google.android.apps.maps"], env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
    output = result.stdout.decode().strip()
    # pm path returns 1 with empty streams for an absent package. Preserve a booted
    # device for inspection, while transport/permission errors still fail visibly.
    missing = result.returncode == 1 and not output and not result.stderr.strip()
    if result.returncode != 0 and not missing:
        result.check_returncode()
    return {"present": output.startswith("package:"), "path": output, "exitCode": result.returncode}


def start_adb_server(adb_path, env):
    daemon_env = env.copy()
    for key in ("ADB_SERVER_SOCKET", "ANDROID_ADB_SERVER_PORT", "ANDROID_ADB_SERVER_ADDRESS", "ANDROID_SERIAL"):
        daemon_env.pop(key, None)
    # ADB's default key can live on the container root filesystem, while the
    # emulator userdata and its trusted key survive on the runtime PVC. Use the
    # same explicit persistent identity on every container launch.
    identity = Path(daemon_env['ANDROID_USER_HOME']) / 'adbkey'
    identity.parent.mkdir(parents=True, exist_ok=True)
    if identity.is_symlink() or (identity.exists() and not identity.is_file()):
        raise ValueError('Persistent ADB identity must be a regular private file')
    if not identity.exists():
        run([adb_path, 'keygen', identity], env=daemon_env, timeout=30)
    identity.chmod(0o600)
    daemon_env['ADB_VENDOR_KEYS'] = str(identity)
    # adb 37 treats even an explicit 127.0.0.1 host (-H or -L) as remote and
    # refuses daemon startup. Its default endpoint is localhost:5037; no -a is
    # enabled. All later client calls retain their explicit loopback host/port.
    run([adb_path, "start-server"], env=daemon_env, timeout=30)


def supervise(root, boot_timeout):
    require_linux()
    env = environment(root)
    avd_directory = root / "avd" / (AVD + ".avd")
    config = properties(avd_directory / "config.ini")
    if config.get("image.sysdir.1") != "system-images/android-35/google_apis_playstore/x86_64/":
        raise ValueError("Unexpected AVD image; inspect before launch")
    if config.get("disk.dataPartition.size") != "6G":
        raise ValueError("Expected a 6 GiB userdata partition")
    userdata = avd_directory / "userdata-qemu.img"
    allocated = userdata.stat().st_blocks * 512 if userdata.is_file() and not userdata.is_symlink() else 0
    required = max(0, 6 * GIB - allocated) + GIB // 2 + 4 * GIB
    if shutil.disk_usage(root).free < required:
        raise ValueError("Insufficient free space for 6 GiB userdata, SD-card allowance, and 4 GiB reserve")
    for port in (5554, 5555, 8554):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))
    kvm = probe_kvm()
    emulator = root / "sdk/emulator/emulator"
    acceleration = run([emulator, "-accel-check"], env=env, stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT, timeout=30).stdout.decode()
    adb = [str(root / "sdk/platform-tools/adb"), "-H", "127.0.0.1", "-P", "5037", "-s", "emulator-5554"]
    start_adb_server(root / "sdk/platform-tools/adb", env)
    command = [str(emulator), "-avd", AVD, "-port", "5554", "-grpc", "8554", "-grpc-use-token",
               "-accel", "on", "-gpu", "swiftshader", "-memory", "3072", "-cores", "2", "-no-window",
               "-no-snapshot", "-no-audio", "-no-boot-anim", "-no-metrics", "-timezone", "America/New_York"]
    (root / "logs").mkdir(exist_ok=True)
    receipt = {"startedAt": now(), "avdName": AVD, "serial": "emulator-5554", "kvm": kvm,
               "accelerationCheck": acceleration, "command": command, "status": "starting",
               "bootTimeoutSeconds": boot_timeout, "scope": "Android runtime readiness only; Maps UI and collection unverified"}
    receipt_path = root / "receipts/linux-runtime.json"
    process = None
    stop_requested = False

    def stop(signum, frame):
        nonlocal stop_requested
        stop_requested = True
        if process and process.poll() is None:
            process.terminate()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    with (root / "logs/emulator.log").open("a") as log:
        try:
            process = subprocess.Popen(command, env=env, stdout=log, stderr=subprocess.STDOUT)
            receipt["pid"] = process.pid
            write_json(receipt_path, receipt)
            wait_for_boot(process, adb, env, boot_timeout)
            receipt["listeners"] = check_loopback_ports((5037, 5554, 5555, 8554))
            receipt.update(status="android_booted", readyAt=now())
            maps = read_maps_path(adb, env)
            receipt.update(mapsPackagePresent=maps["present"], mapsPathExitCode=maps["exitCode"])
            (root / "receipts/mapsPath.txt").write_text(maps["path"] + "\n")
            for key, suffix in {
                "mapsPackage": ["shell", "dumpsys", "package", "com.google.android.apps.maps"],
                "properties": ["shell", "getprop"],
                "screenSize": ["shell", "wm", "size"],
                "screenDensity": ["shell", "wm", "density"],
            }.items():
                result = run(adb + suffix, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20).stdout.decode()
                (root / "receipts" / (key + ".txt")).write_text(result)
            write_json(receipt_path, receipt)
            print(json.dumps(receipt, indent=2), flush=True)
            while process.poll() is None and not stop_requested:
                time.sleep(1)
            if not stop_requested:
                raise ValueError(f"Emulator exited after readiness with status {process.returncode}")
            receipt.update(status="stopped", stoppedAt=now())
        except BaseException as error:
            receipt.update(status="failed", failedAt=now(), error=str(error))
            raise
        finally:
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=10)
            receipt["exitCode"] = process.returncode if process else None
            write_json(receipt_path, receipt)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=os.environ.get("MAPS_ANDROID_ROOT", "/runtime"))
    parser.add_argument("--boot-timeout", type=int, default=480)
    args = parser.parse_args()
    if not 30 <= args.boot_timeout <= 1800:
        parser.error("--boot-timeout must be 30..1800 seconds")
    root = Path(args.root).resolve()
    with (root / "linux-emulator.lock").open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        supervise(root, args.boot_timeout)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print("Linux Android runtime stopped: " + str(error), file=sys.stderr)
        sys.exit(2)
