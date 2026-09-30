"""Release gate for intentional exclusions and zero unresolved quarantine groups."""
import copy
import json
import unittest

import verify_daily as v
import test_registry_verify as registry_tests
from test_registry_verify import discovered_fixture


class QuarantineVerificationTests(unittest.TestCase):
    setUp = registry_tests.RegistryVerificationTests.setUp
    tearDown = registry_tests.RegistryVerificationTests.tearDown
    verify = registry_tests.RegistryVerificationTests.verify
    edit_registry = registry_tests.RegistryVerificationTests.edit_registry
    def registry(self):
        daily = json.loads((self.source / self.summary['manifestReceipt']['objectKey']).read_text())
        return v.validate_registry(daily, v.Reader(self.root / 'registry-only', self.source), self.config)

    def test_explicit_zero_quarantine_ready_registry_is_accepted(self):
        def edit(daily, snapshot):
            snapshot['counts']['quarantined'] = 0
            snapshot['quarantines'] = []
            daily['registry']['counts'] = copy.deepcopy(snapshot['counts'])
            daily['registry']['quarantines'] = []
        self.edit_registry(edit)
        self.assertTrue(self.verify()['collectionAcceptancePassed'])

    def test_known_configured_test_exclusion_is_accepted(self):
        self.config['storeDiscovery']['excludedPlaces'] = [{'placeId': 'ChIJremoved', 'reason': 'test_store'}]
        self.edit_registry(lambda daily, snapshot: snapshot['exclusions'][0].update(reason='configured_test_store'))
        report = self.registry()
        self.assertEqual(report['exclusions'][0]['reason'], 'configured_test_store')

    def test_configured_excluded_place_must_not_be_enrolled(self):
        self.config['storeDiscovery']['excludedPlaces'] = [{'placeId': 'ChIJtest', 'reason': 'test_store'}]
        with self.assertRaisesRegex(ValueError, 'enrolled a configured excluded place'):
            self.registry()

    def test_fabricated_configured_reason_is_rejected(self):
        self.config['storeDiscovery']['excludedPlaces'] = [{'placeId': 'ChIJremoved', 'reason': 'test_store'}]
        self.edit_registry(lambda daily, snapshot: snapshot['exclusions'][0].update(reason='configured_other_reason'))
        with self.assertRaisesRegex(ValueError, 'Registry exclusion invalid'):
            self.registry()

    def test_configured_reason_requires_actual_expected_config_entry(self):
        self.edit_registry(lambda daily, snapshot: snapshot['exclusions'][0].update(reason='configured_test_store'))
        with self.assertRaisesRegex(ValueError, 'Registry exclusion invalid'):
            self.registry()

    def test_duplicate_configured_place_entries_are_rejected(self):
        self.config['storeDiscovery']['excludedPlaces'] = [
            {'placeId': 'ChIJremoved', 'reason': 'test_store'},
            {'placeId': 'ChIJremoved', 'reason': 'another_reason'}]
        with self.assertRaisesRegex(ValueError, 'configured exclusion collision'):
            self.registry()

    def test_configured_exclusion_fields_must_be_safe_and_exact(self):
        for item in [{'placeId': '../bad', 'reason': 'test_store'},
                     {'placeId': 'ChIJremoved', 'reason': 'bad reason'},
                     {'placeId': 'ChIJremoved', 'reason': 'test_store', 'unknown': True}]:
            with self.subTest(item=item):
                self.config['storeDiscovery']['excludedPlaces'] = [item]
                with self.assertRaisesRegex(ValueError, 'configured exclusion invalid'):
                    self.registry()

    def test_nil_merchant_uuid_is_not_eligible(self):
        self.edit_registry(lambda daily, snapshot: snapshot['stores'][0].update(merchantId='00000000-0000-0000-0000-000000000000'))
        with self.assertRaisesRegex(ValueError, 'store identity invalid'):
            self.registry()

    def test_snapshot_quarantine_cannot_be_hidden_from_daily(self):
        self.edit_registry(lambda daily, snapshot: snapshot.update(quarantines=[{'placeId': 'ChIJremoved'}]))
        with self.assertRaisesRegex(ValueError, 'quarantine groups differ'):
            self.registry()

    def test_daily_quarantine_cannot_be_hidden_from_snapshot(self):
        self.edit_registry(lambda daily, snapshot: daily['registry'].update(quarantines=[{'placeId': 'ChIJremoved'}]))
        with self.assertRaisesRegex(ValueError, 'quarantine groups differ'):
            self.registry()

    def test_matching_quarantine_group_with_zero_count_is_not_ready(self):
        def edit(daily, snapshot):
            snapshot['quarantines'] = [{'placeId': 'ChIJremoved', 'reason': 'registry_ownership_conflict', 'sourceIds': ['legacy-record'], 'merchantIds': ['merchant']}]
            snapshot['counts']['quarantined'] = 0
            daily['registry']['counts'] = copy.deepcopy(snapshot['counts'])
            daily['registry']['quarantines'] = copy.deepcopy(snapshot['quarantines'])
        self.edit_registry(edit)
        with self.assertRaisesRegex(ValueError, 'not ready.*unresolved quarantines'):
            self.registry()

    def test_quarantined_count_without_groups_is_not_ready(self):
        def edit(daily, snapshot):
            snapshot['counts']['quarantined'] = 1
            daily['registry']['counts'] = copy.deepcopy(snapshot['counts'])
        self.edit_registry(edit)
        with self.assertRaisesRegex(ValueError, 'not ready.*unresolved quarantines'):
            self.registry()

    def test_quarantined_count_must_be_subset_of_excluded(self):
        def edit(daily, snapshot):
            snapshot['counts']['quarantined'] = 2
            daily['registry']['counts'] = copy.deepcopy(snapshot['counts'])
        self.edit_registry(edit)
        with self.assertRaisesRegex(ValueError, 'exceeds excluded subset'):
            self.registry()

    def test_quarantined_count_type_or_negative_is_rejected(self):
        for value in [-1, True, '0']:
            with self.subTest(value=value):
                self.summary, self.config = discovered_fixture(self.source)
                def edit(daily, snapshot):
                    snapshot['counts']['quarantined'] = value
                    daily['registry']['counts'] = copy.deepcopy(snapshot['counts'])
                self.edit_registry(edit)
                with self.assertRaisesRegex(ValueError, 'Registry counts invalid'):
                    self.registry()

    def test_quarantined_registry_status_is_not_release_acceptance(self):
        self.edit_registry(lambda daily, snapshot: daily['registry'].update(status='quarantined'))
        with self.assertRaisesRegex(ValueError, 'not ready for collection acceptance'):
            self.registry()

    def test_summary_registry_must_match_daily_registry(self):
        self.summary['registry']['counts']['excluded'] = 100
        with self.assertRaisesRegex(ValueError, 'Summary/daily mismatch: registry'):
            self.verify()

    def test_summary_registry_is_required_for_discovery_run(self):
        self.summary.pop('registry')
        with self.assertRaisesRegex(ValueError, 'Summary/daily mismatch: registry'):
            self.verify()

    def test_quarantine_count_field_cannot_be_omitted(self):
        self.edit_registry(lambda daily, snapshot: (snapshot['counts'].pop('quarantined'), daily['registry']['counts'].pop('quarantined', None)))
        with self.assertRaisesRegex(ValueError, 'Registry counts invalid'):
            self.registry()

    def test_snapshot_quarantine_field_cannot_be_omitted(self):
        self.edit_registry(lambda daily, snapshot: snapshot.pop('quarantines'))
        with self.assertRaisesRegex(ValueError, 'quarantine groups differ'):
            self.registry()

    def test_daily_quarantine_field_cannot_be_omitted(self):
        self.edit_registry(lambda daily, snapshot: daily['registry'].pop('quarantines'))
        with self.assertRaisesRegex(ValueError, 'quarantine groups differ'):
            self.registry()

    def test_unresolved_quarantine_reason_cannot_hide_in_exclusions(self):
        self.edit_registry(lambda daily, snapshot: snapshot['exclusions'][0].update(reason='registry_ownership_conflict'))
        with self.assertRaisesRegex(ValueError, 'Registry exclusion invalid'):
            self.registry()


if __name__ == '__main__':
    unittest.main()
