"""Offline receipt-chain and roster regressions; no network or cluster access."""
import copy
import json
import pathlib
import tempfile
import unittest

import verify_daily as v
from test_verify_daily import DIGEST, SOURCE, fixture, mutate_fixture

REGISTRY_POLICY = 'Canonical keyword-library identities with nonempty keyword arrays; opaque safe place IDs excluding UUID/hex legacy IDs; no Google identity or geographic verification; exact place+merchant aliases; live names; stable place-derived IDs; no enabled flag; configured exact-place exclusions precede identity checks; nil merchant UUIDs are excluded; all duplicate/conflicting or alias-mismatched place records are quarantined while other eligible stores continue; invalid configuration and capacity overflow fail closed. Source hash covers normalized identities, exclusions and quarantine groups only.'


def put(root, key, value):
    data = json.dumps(value, ensure_ascii=False).encode()
    path = root / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return {'objectKey': key, 'storageStatus': 'verified', 'bytes': len(data), 'sha256': v.digest(data)}


def discovered_fixture(root):
    summary = fixture(root)
    config = {'schemaVersion': '1', 'sourceBaseUrl': 'http://example.test',
              'stores': [{'storeId': 'store', 'merchantId': 'merchant', 'placeId': 'ChIJtest', 'name': 'Previous name'},
                         {'storeId': 'removed', 'merchantId': 'removed-merchant', 'placeId': 'ChIJremoved', 'name': 'Removed store'}],
              'storeDiscovery': {'provider': 'mongo', 'database': 'test', 'collection': 'local_keywords', 'maxStores': 40, 'maxRecords': 10000, 'timeoutMs': 30000},
              'maxKeywordsPerStore': 40, 'batchSize': 20, 'sourceTimeoutMs': 15000, 'outputDirectory': '/tmp/fixture',
              'capture': {'maxResultsPerKeyword': 15, 'maxScrollsPerKeyword': 10, 'maxScreenshotsPerKeyword': 8, 'keywordTimeoutMs': 90000,
                          'locale': 'en-US', 'browserTimezoneId': 'America/New_York', 'filenameTimezone': 'Asia/Shanghai', 'viewport': {'width': 1440, 'height': 1000}}}
    def edit(daily, batch, manifest, bodies):
        daily['configHash'] = v.digest(v.json_bytes(config))
        for body in bodies:
            if body is not None:
                body['requestedLimit'] = 15
                body['context'].update(locale='en-US', browserTimezoneId='America/New_York', viewport={'width': 1440, 'height': 1000})
        store = {key: daily['stores'][0][key] for key in ('storeId', 'merchantId', 'placeId', 'name')}
        snapshot = {'schemaVersion': '1', 'dailyRunId': 'daily', 'runKey': 'manual', 'date': '2026-09-18',
                    'fetchedAt': '2026-09-18T00:00:00.000Z', 'sourceResponseHash': 'd' * 64, 'policy': REGISTRY_POLICY,
                    'stores': [store], 'exclusions': [{'sourceId': 'legacy-record', 'reason': 'invalid_place_id'}],
                    'quarantines': [], 'counts': {'fetched': 2, 'eligible': 1, 'excluded': 1, 'quarantined': 0}}
        daily['registry'] = {'mode': 'discovered', 'status': 'ready', 'error': None, 'counts': snapshot['counts'], 'quarantines': [],
                             'snapshotReceipt': put(root, '2026-09-18/daily/daily/store-registry.json', snapshot)}
    summary = mutate_fixture(root, summary, edit)
    daily = json.loads((root / summary['manifestReceipt']['objectKey']).read_text())
    summary['registry'] = copy.deepcopy(daily['registry'])
    return summary, config


class RegistryVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.source = self.root / 'source'
        self.summary, self.config = discovered_fixture(self.source)

    def tearDown(self):
        self.temp.cleanup()

    def verify(self, config=True):
        return v.verify(self.summary, v.Reader(self.root / 'out', self.source), DIGEST, SOURCE,
                        expected_stores=1, maximum=40, expected_config=self.config if config else None)

    def edit_registry(self, edit):
        path = self.source / self.summary['manifestReceipt']['objectKey']
        daily = json.loads(path.read_text())
        key = daily['registry']['snapshotReceipt']['objectKey']
        snapshot = json.loads((self.source / key).read_text())
        edit(daily, snapshot)
        if daily.get('registry', {}).get('snapshotReceipt'):
            daily['registry']['snapshotReceipt'] = put(self.source, daily['registry']['snapshotReceipt']['objectKey'], snapshot)
        self.summary['manifestReceipt'] = put(self.source, self.summary['manifestReceipt']['objectKey'], daily)
        self.summary['registry'] = copy.deepcopy(daily.get('registry'))

    def test_discovery_roster_supplies_enrollment_not_old_alias_list(self):
        report = self.verify()
        self.assertTrue(report['collectionAcceptancePassed'])
        self.assertEqual(report['verifiedObjects'], 12)
        self.assertEqual(report['registry']['counts'], {'fetched': 2, 'eligible': 1, 'excluded': 1, 'quarantined': 0})
        self.assertTrue(report['scope']['storeRegistrySnapshotAndIdentityChecks'])

    def test_discovery_requires_exact_launch_config(self):
        with self.assertRaisesRegex(ValueError, 'Registry.*expected config'):
            self.verify(config=False)

    def test_missing_registry_cannot_fall_back_to_aliases(self):
        self.edit_registry(lambda daily, snapshot: daily.pop('registry'))
        with self.assertRaisesRegex(ValueError, 'Registry'):
            self.verify()

    def test_registry_receipt_corruption_is_rejected(self):
        (self.source / '2026-09-18/daily/daily/store-registry.json').write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'Receipt mismatch'):
            self.verify()

    def test_registry_must_belong_to_this_run_and_namespace(self):
        for field, value in [('runKey', 'other'), ('dailyRunId', 'other'), ('date', '2026-09-17')]:
            with self.subTest(field=field):
                self.summary, self.config = discovered_fixture(self.source)
                self.edit_registry(lambda daily, snapshot: snapshot.update({field: value}))
                with self.assertRaisesRegex(ValueError, 'Registry run identity'):
                    self.verify()
        self.summary, self.config = discovered_fixture(self.source)
        self.edit_registry(lambda daily, snapshot: daily['registry']['snapshotReceipt'].update(objectKey='elsewhere/registry.json'))
        with self.assertRaisesRegex(ValueError, 'Registry.*namespace'):
            self.verify()

    def test_registry_counts_and_capacity_cannot_be_overstated(self):
        for counts in [{'fetched': 3, 'eligible': 1, 'excluded': 1}, {'fetched': 2, 'eligible': 2, 'excluded': 0}]:
            with self.subTest(counts=counts):
                self.summary, self.config = discovered_fixture(self.source)
                self.edit_registry(lambda daily, snapshot: snapshot.update(counts=counts))
                with self.assertRaisesRegex(ValueError, 'Registry.*counts'):
                    self.verify()
        self.summary, self.config = discovered_fixture(self.source)
        self.config['storeDiscovery']['maxStores'] = 0
        with self.assertRaisesRegex(ValueError, 'Registry.*capacity'):
            self.verify()

    def test_snapshot_and_daily_identity_or_name_mismatch_is_rejected(self):
        for field in ('storeId', 'merchantId', 'placeId', 'name'):
            with self.subTest(field=field):
                self.summary, self.config = discovered_fixture(self.source)
                self.edit_registry(lambda daily, snapshot: snapshot['stores'][0].update({field: 'different'}))
                with self.assertRaisesRegex(ValueError, 'Registry.*identity'):
                    self.verify()

    def test_legacy_alias_ownership_and_store_id_are_preserved(self):
        for field in ('merchantId', 'storeId'):
            with self.subTest(field=field):
                self.summary, self.config = discovered_fixture(self.source)
                self.config['stores'][0][field] = 'different'
                with self.assertRaisesRegex(ValueError, 'Registry.*alias'):
                    self.verify()

    def test_unaliased_store_must_use_stable_place_derived_id(self):
        self.config['stores'] = []
        with self.assertRaisesRegex(ValueError, 'Registry.*derived'):
            self.verify()

    def test_new_store_derived_identity_is_accepted_independently_of_legacy_aliases(self):
        expected_id = 'place-' + v.digest(b'ChIJtest')[:32]
        self.config['stores'] = [self.config['stores'][1]]
        def edit(daily, snapshot):
            daily['stores'][0]['storeId'] = expected_id
            snapshot['stores'][0]['storeId'] = expected_id
        self.edit_registry(edit)
        daily = json.loads((self.source / self.summary['manifestReceipt']['objectKey']).read_text())
        report = v.validate_registry(daily, v.Reader(self.root / 'registry-out', self.source), self.config)
        self.assertEqual(report['stores'][0]['storeId'], expected_id)
        self.assertEqual(report['counts']['eligible'], 1)

    def test_new_store_cannot_reuse_reserved_alias_or_invent_reference_area(self):
        expected_id = 'place-' + v.digest(b'ChIJtest')[:32]
        self.config['stores'] = [{'storeId': expected_id, 'merchantId': 'other', 'placeId': 'ChIJreserved', 'name': 'Absent alias'}]
        def edit(daily, snapshot):
            daily['stores'][0]['storeId'] = expected_id
            snapshot['stores'][0]['storeId'] = expected_id
        self.edit_registry(edit)
        daily = json.loads((self.source / self.summary['manifestReceipt']['objectKey']).read_text())
        with self.assertRaisesRegex(ValueError, 'Registry.*derived'):
            v.validate_registry(daily, v.Reader(self.root / 'registry-out', self.source), self.config)
        self.config['stores'] = []
        self.edit_registry(lambda daily, snapshot: (daily['stores'][0].update(expectedArea={'label': 'invented'}), snapshot['stores'][0].update(expectedArea={'label': 'invented'})))
        daily = json.loads((self.source / self.summary['manifestReceipt']['objectKey']).read_text())
        with self.assertRaisesRegex(ValueError, 'Registry.*derived'):
            v.validate_registry(daily, v.Reader(self.root / 'registry-out', self.source), self.config)

    def test_duplicate_places_and_stores_are_rejected(self):
        def edit(daily, snapshot):
            snapshot['stores'].append(copy.deepcopy(snapshot['stores'][0]))
            snapshot['counts'].update(fetched=3, eligible=2)
            daily['registry']['counts'] = snapshot['counts']
        self.edit_registry(edit)
        with self.assertRaisesRegex(ValueError, 'Registry.*duplicate'):
            self.verify()

    def test_unknown_policy_and_exclusion_reasons_are_rejected(self):
        self.edit_registry(lambda daily, snapshot: snapshot.update(policy='silently truncated roster'))
        with self.assertRaisesRegex(ValueError, 'Registry.*policy'):
            self.verify()
        self.summary, self.config = discovered_fixture(self.source)
        self.edit_registry(lambda daily, snapshot: snapshot['exclusions'][0].update(reason='silent_capacity_drop'))
        with self.assertRaisesRegex(ValueError, 'Registry.*exclusion'):
            self.verify()


if __name__ == '__main__':
    unittest.main()
