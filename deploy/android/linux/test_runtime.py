import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


class RuntimeReadinessTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((HERE / "runtime.py").is_file(), "Linux runtime supervisor is missing")
        sys.path.insert(0, str(HERE))
        spec = importlib.util.spec_from_file_location("runtime", HERE / "runtime.py")
        self.runtime = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.runtime)

    def test_emulator_exit_is_not_reported_as_ready(self):
        process = subprocess.Popen([sys.executable, "-c", "raise SystemExit(7)"])
        process.wait(timeout=5)
        with self.assertRaisesRegex(ValueError, "exited.*7"):
            self.runtime.wait_for_boot(process, ["missing-adb"], {}, 1)

    def test_unresponsive_adb_cannot_overrun_boot_deadline(self):
        with tempfile.TemporaryDirectory() as directory:
            adb = Path(directory) / "adb.py"
            adb.write_text("import time\ntime.sleep(60)\n")
            process = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
            started = time.monotonic()
            try:
                with self.assertRaisesRegex(TimeoutError, "boot"):
                    self.runtime.wait_for_boot(process, [sys.executable, str(adb)], {}, 0.2)
                self.assertLess(time.monotonic() - started, 3)
            finally:
                process.terminate()
                process.wait(timeout=5)

    def test_kvm_probe_rejects_a_regular_file(self):
        with tempfile.NamedTemporaryFile() as file:
            with self.assertRaisesRegex(ValueError, "character device"):
                self.runtime.probe_kvm(Path(file.name))

    def test_missing_maps_path_is_recorded_but_transport_error_still_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            adb = Path(directory) / "adb.py"
            adb.write_text("raise SystemExit(1)\n")
            result = self.runtime.read_maps_path([sys.executable, str(adb)], {})
            self.assertEqual(result, {"present": False, "path": "", "exitCode": 1})
            adb.write_text("import sys\nsys.stderr.write('error: device offline\\n')\nraise SystemExit(1)\n")
            with self.assertRaises(subprocess.CalledProcessError):
                self.runtime.read_maps_path([sys.executable, str(adb)], {})

    def test_local_adb_start_uses_default_loopback_and_scrubs_remote_overrides(self):
        with tempfile.TemporaryDirectory() as directory:
            adb = Path(directory) / "adb"
            captured = Path(directory) / "invocation.json"
            adb.write_text("#!" + sys.executable + "\nimport json, os, sys\n" +
                           "from pathlib import Path\n" +
                           "Path(os.environ['CAPTURE_PATH']).write_text(json.dumps({'argv': sys.argv[1:], 'env': dict(os.environ)}))\n")
            adb.chmod(0o755)
            env = {"CAPTURE_PATH": str(captured), "JAVA_HOME": "/some/jdk", "ADB_SERVER_SOCKET": "tcp:unwanted:5555",
                   "ANDROID_ADB_SERVER_PORT": "5555", "ANDROID_ADB_SERVER_ADDRESS": "unwanted", "ANDROID_SERIAL": "wrong-device", "ANDROID_USER_HOME": directory}
            (Path(directory) / 'adbkey').write_text('synthetic-existing-key')
            self.assertTrue(callable(getattr(self.runtime, "start_adb_server", None)), "Local ADB bootstrap is missing")
            self.runtime.start_adb_server(adb, env)
            actual = json.loads(captured.read_text())
            self.assertEqual(actual["argv"], ["start-server"])
            self.assertEqual(actual["env"]["JAVA_HOME"], "/some/jdk")
            for key in ("ADB_SERVER_SOCKET", "ANDROID_ADB_SERVER_PORT", "ANDROID_ADB_SERVER_ADDRESS", "ANDROID_SERIAL"):
                self.assertNotIn(key, actual["env"])
                self.assertIn(key, env)  # Do not weaken the environment used by subsequent explicit clients.

    def test_persistent_adb_identity_is_reused_after_container_home_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'user').mkdir()
            key = root / 'user/adbkey'
            key.write_text('synthetic-existing-key')
            key.chmod(0o600)
            calls = []
            with patch.object(self.runtime, 'run', side_effect=lambda command, **kw: calls.append((command, kw))):
                env = self.runtime.environment(root)
                self.runtime.start_adb_server(root / 'sdk/platform-tools/adb', env)
            self.assertEqual(key.read_text(), 'synthetic-existing-key')
            self.assertEqual(len(calls), 1)
            self.assertEqual(calls[0][1]['env']['ADB_VENDOR_KEYS'], str(key))

    def test_first_launch_generates_persistent_adb_identity_before_starting_server(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            calls = []
            def execute(command, **kw):
                calls.append(command)
                if command[1] == 'keygen':
                    Path(command[2]).write_text('synthetic-new-key')
                if command[1] == 'start-server':
                    self.assertTrue((root / 'user/adbkey').is_file())
                    self.assertEqual(kw['env']['ADB_VENDOR_KEYS'], str(root / 'user/adbkey'))
            with patch.object(self.runtime, 'run', side_effect=execute):
                self.runtime.start_adb_server(root / 'sdk/platform-tools/adb', self.runtime.environment(root))
            self.assertEqual([c[1] for c in calls], ['keygen', 'start-server'])
            self.assertEqual((root / 'user/adbkey').stat().st_mode & 0o777, 0o600)

    def test_listener_gate_accepts_only_local_ipv4_mapped_addresses(self):
        required = "LISTEN 0 128 127.0.0.1:5037 0.0.0.0:*\n" + \
            "LISTEN 0 128 127.0.0.1:5554 0.0.0.0:*\n" + \
            "LISTEN 0 128 127.0.0.1:5555 0.0.0.0:*\n"
        for endpoint, accepted in [
            ("[::ffff:127.0.0.1]:8554", True),
            ("[::ffff:7f00:1]:8554", True),
            ("[::1]:8554", True),
            ("127.0.0.1:8554", True),
            ("[::ffff:192.168.1.1]:8554", False),
            ("[::ffff:8.8.8.8]:8554", False),
            ("[::ffff:0.0.0.0]:8554", False),
            ("[::]:8554", False),
            ("0.0.0.0:8554", False),
            ("*:8554", False),
        ]:
            listing = required + f"LISTEN 0 128 {endpoint} *:*\n"
            with self.subTest(endpoint=endpoint), patch.object(self.runtime, "run", return_value=subprocess.CompletedProcess([], 0, stdout=listing.encode())):
                if accepted:
                    self.assertEqual(self.runtime.check_loopback_ports((5037, 5554, 5555, 8554)), listing)
                else:
                    with self.assertRaisesRegex(ValueError, "not loopback"):
                        self.runtime.check_loopback_ports((5037, 5554, 5555, 8554))
        incomplete = required.replace("LISTEN 0 128 127.0.0.1:5555 0.0.0.0:*\n", "") + "LISTEN 0 128 [::ffff:127.0.0.1]:8554 *:*\n"
        with patch.object(self.runtime, "run", return_value=subprocess.CompletedProcess([], 0, stdout=incomplete.encode())):
            with self.assertRaisesRegex(ValueError, "missing"):
                self.runtime.check_loopback_ports((5037, 5554, 5555, 8554))


if __name__ == "__main__":
    unittest.main()
