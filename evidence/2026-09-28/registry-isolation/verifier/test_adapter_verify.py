"""Offline release-version acceptance and stale-artifact rejection."""
import contextlib
import io
import json
import pathlib
import tempfile
import unittest
from unittest.mock import Mock, patch

import verify_daily as v
from test_registry_verify import discovered_fixture
from test_verify_daily import DIGEST, SOURCE, mutate_fixture


class AdapterVersionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.source = self.root / 'source'
        self.summary, self.config = discovered_fixture(self.source)

    def tearDown(self):
        self.temp.cleanup()

    def verify(self):
        return v.verify(self.summary, v.Reader(self.root / 'out', self.source), DIGEST, SOURCE,
                        expected_stores=1, maximum=40, expected_config=self.config,
                        adapter='maps-feed-card/v5')

    def test_v5_discovery_acceptance_keeps_full_evidence_checks(self):
        report = self.verify()
        self.assertTrue(report['collectionAcceptancePassed'])
        self.assertEqual(report['adapterVersion'], 'maps-feed-card/v5')
        self.assertEqual(report['verifiedObjects'], 12)
        self.assertEqual(report['resultAttemptsCompared'], 2)
        self.assertTrue(report['scope']['storeRegistrySnapshotAndIdentityChecks'])
        self.assertTrue(report['scope']['allReferencedArtifactsAllAttempts'])

    def test_cli_defaults_to_v5_and_completes_offline_receipt_validation(self):
        summary_path = self.root / 'summary.json'
        config_path = self.root / 'config.json'
        summary_path.write_text(json.dumps(self.summary))
        config_path.write_text(json.dumps(self.config))
        argv = ['verify_daily.py', '--summary', str(summary_path), '--out', str(self.root / 'cli-out'),
                '--offline-root', str(self.source), '--digest', DIGEST, '--source-commit', SOURCE,
                '--expected-stores', '1', '--max-keywords', '40', '--expected-config', str(config_path)]
        with patch('sys.argv', argv), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(v.main(), 0)
        report = json.loads((self.root / 'cli-out/readback-report.json').read_text())
        self.assertEqual(report['adapterVersion'], 'maps-feed-card/v5')
        self.assertEqual(report['verificationIdentity'], 'offline_replay')

    def test_requested_old_or_unknown_adapter_is_rejected_before_readback(self):
        for adapter in ('maps-feed-card/v2', 'maps-feed-card/v3', 'maps-feed-card/v4', 'maps-feed-card/v6'):
            with self.subTest(adapter=adapter):
                reader = Mock()
                with self.assertRaisesRegex(ValueError, 'only accepts the maps-feed-card/v5 contract'):
                    v.verify({}, reader, DIGEST, SOURCE, adapter=adapter)
                reader.json.assert_not_called()

    def test_v4_batch_is_rejected_even_with_resigned_receipts(self):
        self.summary = mutate_fixture(self.source, self.summary,
            lambda daily, batch, manifest, bodies: manifest['metadata'].update(adapterVersion='maps-feed-card/v4'))
        with self.assertRaisesRegex(ValueError, 'Unexpected batch adapter version'):
            self.verify()

    def test_v4_result_is_rejected_even_with_resigned_receipts(self):
        self.summary = mutate_fixture(self.source, self.summary,
            lambda daily, batch, manifest, bodies: bodies[0]['metadata'].update(adapterVersion='maps-feed-card/v4'))
        with self.assertRaisesRegex(ValueError, 'Result image/source/adapter differs'):
            self.verify()

    def test_v3_batch_is_rejected_even_with_resigned_receipts(self):
        self.summary = mutate_fixture(self.source, self.summary,
            lambda daily, batch, manifest, bodies: manifest['metadata'].update(adapterVersion='maps-feed-card/v3'))
        with self.assertRaisesRegex(ValueError, 'Unexpected batch adapter version'):
            self.verify()

    def test_v3_result_is_rejected_even_with_resigned_receipts(self):
        self.summary = mutate_fixture(self.source, self.summary,
            lambda daily, batch, manifest, bodies: bodies[0]['metadata'].update(adapterVersion='maps-feed-card/v3'))
        with self.assertRaisesRegex(ValueError, 'Result image/source/adapter differs'):
            self.verify()


if __name__ == '__main__':
    unittest.main()
