"""Credential-free native Kubernetes sidecar for one isolated emulator worker."""
import datetime
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import urllib.request


def current_boot_receipt(receipt, started_at):
    try:
        started = datetime.datetime.fromisoformat(started_at.replace('Z', '+00:00'))
        actual = datetime.datetime.fromisoformat(receipt['startedAt'].replace('Z', '+00:00'))
        return receipt.get('status') == 'android_booted' and actual >= started and type(receipt.get('pid')) is int and receipt['pid'] > 1
    except (KeyError, TypeError, ValueError):
        return False


def runtime_root(index):
    if index not in ('0', '1'):
        raise ValueError('worker index must be 0 or 1')
    return Path('/runtime/monitor-workers') / index


def validate_clone(root):
    if root.is_symlink() or root.resolve() != root:
        raise RuntimeError('worker root must be a canonical directory')
    receipt = json.loads((root / 'receipts/clone.json').read_text())
    if receipt.get('target') != str(root) or receipt.get('sourceNotWritten') is not True or not receipt.get('copiedFilesVerified', 0) > 0:
        raise RuntimeError('worker clone receipt does not match this worker')


def owned_emulator(pid, supervisor_pid, proc=Path('/proc')):
    """The boot receipt must name a direct child of our runtime supervisor."""
    try:
        stat = (proc / str(pid) / 'stat').read_text()
        # Linux comm can contain spaces and parentheses; the last ')' ends it.
        fields = stat[stat.rfind(')') + 2:].split()
        argv = (proc / str(pid) / 'cmdline').read_bytes().split(b'\0')
        executable = Path(os.fsdecode(argv[0])).name
        return int(fields[1]) == supervisor_pid and (executable.startswith('qemu-system-') or executable == 'emulator')
    except (OSError, ValueError, IndexError):
        return False


def main():
    ready = Path('/tmp/android-ready')
    ready.unlink(missing_ok=True)
    root = runtime_root(os.environ.get('JOB_COMPLETION_INDEX', ''))
    validate_clone(root)
    env = os.environ.copy()
    # This container must not receive database or Azure credentials.
    if any(env.get(key) for key in ('MAPS_TRACKING_MONGO_URI', 'AZURE_STORAGE_CONTAINER_SAS_URL')):
        raise RuntimeError('emulator sidecar must be credential-free')
    env.update(MAPS_ANDROID_ROOT=str(root), TMPDIR=str(root / 'tmp'))
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    script_dir = Path(__file__).resolve().parent
    stop = False
    children = []
    def stopping(_signal, _frame):
        nonlocal stop
        stop = True
    signal.signal(signal.SIGTERM, stopping)
    signal.signal(signal.SIGINT, stopping)
    try:
        with Path('/tmp/runtime.log').open('w') as log:
            runtime = subprocess.Popen(['python3', str(script_dir / 'runtime.py'), '--root', str(root), '--boot-timeout', '480'], env=env, stdout=log, stderr=subprocess.STDOUT)
        children.append(runtime)
        deadline = time.monotonic() + 510
        while not stop:
            if runtime.poll() is not None:
                raise RuntimeError('emulator supervisor exited; inspect /tmp/runtime.log')
            try:
                receipt = json.loads((root / 'receipts/linux-runtime.json').read_text())
                if current_boot_receipt(receipt, started) and owned_emulator(receipt['pid'], runtime.pid): break
            except (OSError, ValueError): pass
            if time.monotonic() > deadline: raise TimeoutError('fresh runtime readiness deadline')
            time.sleep(1)
        if stop: return
        with Path('/tmp/appium.log').open('w') as log:
            appium = subprocess.Popen(['bash', str(script_dir / 'appium.sh'), 'start'], env=env, stdout=log, stderr=subprocess.STDOUT)
        children.append(appium)
        deadline = time.monotonic() + 90
        while not stop:
            if any(child.poll() is not None for child in children): raise RuntimeError('owned service exited')
            try:
                with urllib.request.urlopen('http://127.0.0.1:4723/status', timeout=2) as response:
                    if json.load(response).get('value', {}).get('ready') is True: break
            except (OSError, ValueError): pass
            if time.monotonic() > deadline: raise TimeoutError('Appium readiness deadline')
            time.sleep(1)
        if stop: return
        ready.write_text(json.dumps({'worker': root.name, 'startedAt': started, 'readyAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}))
        print(ready.read_text(), flush=True)
        while not stop:
            if any(child.poll() is not None for child in children): raise RuntimeError('owned service exited after readiness')
            time.sleep(1)
    finally:
        ready.unlink(missing_ok=True)
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
                try: child.wait(timeout=35)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=10)


if __name__ == '__main__': main()
