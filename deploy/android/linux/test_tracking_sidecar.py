import unittest
import json
from pathlib import Path
import tempfile
from tracking_sidecar import current_boot_receipt, runtime_root, validate_clone, owned_emulator


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


if __name__ == '__main__': unittest.main()
