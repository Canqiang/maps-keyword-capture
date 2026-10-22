import os
import unittest
import json
from pathlib import Path
import tempfile
from tracking_sidecar import share_console_token, current_boot_receipt, runtime_root, validate_clone, owned_emulator


class SidecarReadinessTests(unittest.TestCase):
    def test_old_or_failed_receipt_is_not_readiness(self):
        self.assertFalse(current_boot_receipt({'status':'android_booted','startedAt':'2026-10-20T00:00:00Z','pid':99}, '2026-10-21T00:00:00Z'))
        self.assertFalse(current_boot_receipt({'status':'failed','startedAt':'2026-10-21T00:01:00Z','pid':99}, '2026-10-21T00:00:00Z'))

    def test_current_boot_needs_a_real_pid(self):
        self.assertTrue(current_boot_receipt({'status':'android_booted','startedAt':'2026-10-21T00:01:00Z','pid':99}, '2026-10-21T00:00:00Z'))
        self.assertFalse(current_boot_receipt({'status':'android_booted','startedAt':'2026-10-21T00:01:00Z'}, '2026-10-21T00:00:00Z'))

    def test_worker_paths_cannot_escape(self):
        self.assertEqual(str(runtime_root('1')), '/runtime/monitor-workers/1')
        for value in ('../0','-1','2','01',''):
            with self.assertRaises(ValueError): runtime_root(value)

    def test_clone_receipt_is_bound_to_canonical_worker(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve() / 'worker'
            (root / 'receipts').mkdir(parents=True)
            receipt = root / 'receipts/clone.json'
            receipt.write_text(json.dumps({'target': str(root), 'sourceNotWritten': True, 'copiedFilesVerified': 30}))
            validate_clone(root)
            link = root.parent / 'alias'
            link.symlink_to(root, target_is_directory=True)
            with self.assertRaises(RuntimeError): validate_clone(link)
            receipt.write_text(json.dumps({'target': '/different', 'sourceNotWritten': True, 'copiedFilesVerified': 30}))
            with self.assertRaises(RuntimeError): validate_clone(root)

    def test_boot_pid_must_belong_to_supervisor_and_be_emulator(self):
        with tempfile.TemporaryDirectory() as temp:
            proc = Path(temp)
            pid = proc / '99'
            pid.mkdir()
            (pid / 'stat').write_text('99 (qemu worker (0)) S 42 1 1 0')
            (pid / 'cmdline').write_bytes(b'/runtime/sdk/emulator/qemu/linux-x86_64/qemu-system-x86_64\0-avd\0')
            self.assertTrue(owned_emulator(99, 42, proc))
            self.assertFalse(owned_emulator(99, 43, proc))
            (pid / 'cmdline').write_bytes(b'/usr/bin/sleep\0')
            self.assertFalse(owned_emulator(99, 42, proc))




class ConsoleTokenTests(unittest.TestCase):
    def test_token_in_shared_home_is_handed_to_collector(self):
        with tempfile.TemporaryDirectory() as temp:
            token = Path(temp) / '.emulator_console_auth_token'
            token.write_text('secret'); token.chmod(0o600)
            self.assertTrue(share_console_token([token], token, os.getuid()))
            self.assertEqual(token.stat().st_mode & 0o777, 0o600)

    def test_token_elsewhere_is_copied_privately(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / 'user/.emulator_console_auth_token'; source.parent.mkdir()
            source.write_text('secret')
            target = Path(temp) / 'home/.emulator_console_auth_token'; target.parent.mkdir()
            self.assertTrue(share_console_token([Path(temp) / 'missing', source], target, os.getuid()))
            self.assertEqual(target.read_text(), 'secret'); self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_symlinked_token_is_refused_and_absent_token_is_fine(self):
        with tempfile.TemporaryDirectory() as temp:
            link = Path(temp) / '.emulator_console_auth_token'; link.symlink_to('/etc/passwd')
            with self.assertRaises(RuntimeError): share_console_token([link], link, os.getuid())
            self.assertFalse(share_console_token([Path(temp) / 'none'], Path(temp) / 'out', os.getuid()))


if __name__ == '__main__': unittest.main()
