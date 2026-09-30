"""Re-signed evidence mutations exercise v6 semantics, not merely hash failures."""
import copy
import json
import pathlib
import subprocess
import sys
import unittest

import synthetic_fixture as f
import verification_helpers as h
import verify_smoke as smoke
import test_verify_smoke as base
from test_verify_smoke import EXPECTED_CONFIG, EXPECTED_KEYWORDS, fixture, put


class V6SmokeRegressionTests(unittest.TestCase):
    setUp = base.SmokeVerifierTests.setUp
    tearDown = base.SmokeVerifierTests.tearDown
    verify = base.SmokeVerifierTests.verify
    resave = base.SmokeVerifierTests.resave

    def mutate_body(self, mutate, index=1, attempt_index=0):
        row = self.manifest['queries'][index]
        key = self.prefix + row['attempts'][attempt_index]['resultFile']
        body = json.loads((self.source / key).read_text())
        mutate(body)
        next(a for a in self.manifest['artifacts'] if a['objectKey'] == key).update(put(self.source, key, body))
        self.resave()
        return body

    def append_attempt(self, target_index, source_index, attempt_id='qa02'):
        source = self.manifest['queries'][source_index]
        target = self.manifest['queries'][target_index]
        old = source['attempts'][0]
        def replace(text):
            return text.replace(source['queryId'], target['queryId']).replace(source['keyword'], target['keyword']).replace(old['queryAttemptId'], attempt_id)
        attempt = json.loads(replace(json.dumps(old)))
        owned = [a for a in self.manifest['artifacts'] if a['queryId'] == source['queryId'] and a['queryAttemptId'] == old['queryAttemptId']]
        for artifact in owned:
            new = json.loads(replace(json.dumps(artifact)))
            data = (self.source / artifact['objectKey']).read_bytes()
            if not artifact['objectKey'].endswith('.png'):
                data = replace(data.decode()).encode()
            new.update(put(self.source, new['objectKey'], data))
            self.manifest['artifacts'].append(new)
        target['attempts'].append(attempt)
        target['artifactIds'] = [aid for a in target['attempts'] for aid in a['artifactIds']]
        self.resave()
        return attempt

    def test_current_smoke_config_and_normalized_snapshot_agree(self):
        parent = pathlib.Path(__file__).resolve().parent.parent
        raw = json.loads((parent / 'smoke-config.json').read_text())
        normalized = json.loads((parent / 'normalized-smoke-config.json').read_text())
        self.assertEqual(raw['keywords'], ['see joy', 'SEE JOY 喜聚', 'bubble tea mineola', 'Flushing'])
        self.assertEqual(smoke.normalized_config(raw, raw['keywords']), normalized)

    def test_limited_details_preserve_name_and_do_not_fabricate_rank(self):
        report = self.verify()
        details = report['results'][1]
        self.assertTrue(report['smokeAccepted'])
        self.assertEqual(report['limitedActionsDetailsObserved'], 1)
        self.assertEqual(details['placeDetails']['name'], "She-Joy's Sweet Treats")
        self.assertEqual(details['listings'], 0)
        self.assertEqual(details['listingCoverage'], [])
        self.assertEqual(report['csvRowsComparedAllAttempts'], 1)

    def test_phone_only_limited_contact_is_valid(self):
        self.mutate_body(lambda b: b['quality']['placeDetails']['signals'].__setitem__(-1, 'phone'))
        self.assertTrue(self.verify()['smokeAccepted'])

    def test_each_required_limited_signal_is_required(self):
        for signal in ('visible_heading', 'named_pane', 'named_actions', 'save', 'send_to_phone', 'share', 'website'):
            with self.subTest(signal=signal):
                self.summary, self.manifest, self.prefix = fixture(self.source)
                self.mutate_body(lambda b: b['quality']['placeDetails']['signals'].remove(signal))
                with self.assertRaisesRegex(ValueError, 'signals'):
                    self.verify()

    def test_duplicate_unknown_or_standard_signal_cannot_claim_limited(self):
        for signal in ('save', 'footer', 'directions', 'address'):
            with self.subTest(signal=signal):
                self.summary, self.manifest, self.prefix = fixture(self.source)
                self.mutate_body(lambda b: b['quality']['placeDetails']['signals'].append(signal))
                with self.assertRaisesRegex(ValueError, 'signals'):
                    self.verify()

    def test_optional_historical_detail_field_does_not_prove_target_regression(self):
        self.mutate_body(lambda b: b['quality'].pop('placeDetails'))
        report = self.verify()
        self.assertTrue(report['evidenceIntegrityPassed'])
        self.assertFalse(report['smokeAccepted'])
        self.assertEqual(report['verifierExitCode'], 2)
        self.assertEqual(report['recomputedExecutionStatus'], 'completed')
        self.assertIn('limited_actions_live_case_not_observed', [i['issue'] for i in report['issues']])

    def test_standard_details_alone_do_not_prove_limited_regression(self):
        self.mutate_body(lambda b: b['quality']['placeDetails'].update(recognition='standard_actions', signals=['visible_heading', 'address']))
        report = self.verify()
        self.assertTrue(report['evidenceIntegrityPassed'])
        self.assertFalse(report['smokeAccepted'])
        self.assertEqual(report['limitedActionsDetailsObserved'], 0)

    def test_detail_evidence_cannot_be_attached_to_ranked_list(self):
        details = json.loads((self.source / (self.prefix + self.manifest['queries'][1]['resultFile'])).read_text())['quality']['placeDetails']
        self.mutate_body(lambda b: b['quality'].update(placeDetails=details), index=0)
        with self.assertRaisesRegex(ValueError, 'incomplete place-details surface'):
            self.verify()

    def test_late_detail_transition_keeps_real_prefix_but_remains_incomplete(self):
        details = json.loads((self.source / (self.prefix + self.manifest['queries'][1]['resultFile'])).read_text())['quality']['placeDetails']
        row = self.manifest['queries'][0]
        row.update(status='partial', stopReason='unsupported_layout')
        row['attempts'][0].update(status='partial', stopReason='unsupported_layout')
        self.manifest['executionStatus'] = self.summary['executionStatus'] = 'incomplete'
        self.summary['counts'] = {'partial': 2, 'nonRanking': 1}
        def mutate(body):
            body.update(status='partial', stopReason='unsupported_layout', finalUrl=details['mapsUrl'])
            body['quality'].update(resultSurface='place_details', placeDetails=details)
        self.mutate_body(mutate, index=0)
        report = self.verify()
        self.assertTrue(report['evidenceIntegrityPassed'])
        self.assertFalse(report['smokeAccepted'])
        self.assertEqual(report['results'][0]['listings'], 1)
        self.assertEqual(report['csvRowsComparedAllAttempts'], 1)
        self.assertEqual(report['verifierExitCode'], 2)

    def test_detail_url_must_be_trusted_place_and_equal_final_url(self):
        for url in ('http://www.google.com/maps/place/X', 'https://www.google.com.evil.invalid/maps/place/X',
                    'https://user@www.google.com/maps/place/X', 'https://www.google.com:444/maps/place/X',
                    'https://www.google.com/maps/search/X', 'https://www.google.com/maps/place/Different'):
            with self.subTest(url=url):
                self.summary, self.manifest, self.prefix = fixture(self.source)
                self.mutate_body(lambda b: b['quality']['placeDetails'].update(mapsUrl=url))
                with self.assertRaisesRegex(ValueError, 'URL'):
                    self.verify()

    def test_detail_extra_fields_and_empty_name_are_rejected(self):
        for mutate in (lambda d: d.update(organicRank=1), lambda d: d.update(name=' '), lambda d: d.update(recognition='guess')):
            self.summary, self.manifest, self.prefix = fixture(self.source)
            self.mutate_body(lambda b: mutate(b['quality']['placeDetails']))
            with self.assertRaisesRegex(ValueError, 'Place details'):
                self.verify()

    def test_retry_union_and_all_attempt_evidence_are_accepted(self):
        self.append_attempt(0, 0)
        report = self.verify()
        self.assertTrue(report['smokeAccepted'])
        self.assertEqual(report['resultAttemptsCompared'], 3)
        self.assertEqual(report['verifiedObjects'], 14)
        self.assertEqual(report['csvRowsComparedAllAttempts'], 2)

    def test_nonselected_limited_attempt_does_not_satisfy_target_acceptance(self):
        selected = self.append_attempt(1, 0)
        row = self.manifest['queries'][1]
        row.update({k: selected[k] for k in ('status', 'stopReason', 'resultFile', 'error')})
        row['selectedQueryAttemptId'] = selected['queryAttemptId']
        self.manifest['status'] = self.summary['status'] = 'completed'
        self.summary['counts'] = {'captured': 2, 'nonRanking': 0}
        self.resave()
        report = self.verify()
        self.assertTrue(report['evidenceIntegrityPassed'])
        self.assertFalse(report['smokeAccepted'])
        self.assertEqual(report['limitedActionsDetailsObserved'], 0)

    def test_runtime_attempt_selection_policy_is_enforced(self):
        self.append_attempt(1, 0)
        with self.assertRaisesRegex(ValueError, 'selection policy'):
            self.verify()

    def test_unselected_attempt_provenance_is_checked(self):
        self.append_attempt(0, 0)
        self.mutate_body(lambda b: b['metadata'].update(sourceCommit='c' * 40), index=0, attempt_index=1)
        with self.assertRaisesRegex(ValueError, 'Unexpected result sourceCommit'):
            self.verify()

    def test_unreferenced_diagnostic_png_is_not_evidence(self):
        self.mutate_body(lambda b: b.update(screenshots=[]))
        with self.assertRaisesRegex(ValueError, 'screenshot references differ'):
            self.verify()

    def test_non_png_diagnostic_cannot_bypass_png_validation(self):
        artifact = next(a for a in self.manifest['artifacts'] if a['kind'] == 'diagnostic')
        artifact['objectKey'] += '.txt'
        artifact.update(put(self.source, artifact['objectKey'], b'not a screenshot'))
        self.resave()
        with self.assertRaisesRegex(ValueError, 'not PNG'):
            self.verify()

    def test_resigned_malformed_png_fails_structure_check(self):
        artifact = next(a for a in self.manifest['artifacts'] if a['kind'] == 'diagnostic')
        artifact.update(put(self.source, artifact['objectKey'], b'not a screenshot'))
        self.resave()
        with self.assertRaisesRegex(ValueError, 'Invalid PNG signature'):
            self.verify()

    def test_nonranking_csv_must_remain_header_only(self):
        artifact = next(a for a in self.manifest['artifacts'] if a['kind'] == 'result_csv' and a['queryId'] == 'q0002')
        data = (self.source / artifact['objectKey']).read_bytes() + b'fabricated,rank\n'
        artifact.update(put(self.source, artifact['objectKey'], data))
        self.resave()
        with self.assertRaisesRegex(ValueError, 'CSV/JSON row count mismatch'):
            self.verify()

    def test_exact_manifest_provenance_is_required(self):
        for field, value in [('imageDigest', 'sha256:' + 'c' * 64), ('sourceCommit', 'c' * 40),
                             ('adapterVersion', 'maps-feed-card/v5'), ('profileHash', 'c' * 64), ('configHash', 'c' * 64)]:
            with self.subTest(field=field):
                self.summary, self.manifest, self.prefix = fixture(self.source)
                self.manifest['metadata'][field] = value
                self.resave()
                with self.assertRaisesRegex(ValueError, 'Unexpected manifest|config/profile differs'):
                    self.verify()

    def test_exact_result_provenance_is_required(self):
        for field, value in [('imageDigest', 'sha256:' + 'c' * 64), ('sourceCommit', 'c' * 40),
                             ('adapterVersion', 'maps-feed-card/v5'), ('profileHash', 'c' * 64), ('configHash', 'c' * 64)]:
            with self.subTest(field=field):
                self.summary, self.manifest, self.prefix = fixture(self.source)
                self.mutate_body(lambda b: b['metadata'].update({field: value}))
                with self.assertRaisesRegex(ValueError, 'Unexpected result|config/profile differs'):
                    self.verify()

    def test_resigned_request_config_drift_is_rejected(self):
        artifact = next(a for a in self.manifest['artifacts'] if a['kind'] == 'request_json')
        request = json.loads((self.source / artifact['objectKey']).read_text())
        request['config']['maxScrollsPerKeyword'] += 1
        artifact.update(put(self.source, artifact['objectKey'], request))
        self.resave()
        with self.assertRaisesRegex(ValueError, 'Persisted request config'):
            self.verify()

    def test_result_actual_profile_and_limit_are_checked(self):
        for mutate in (lambda b: b.update(requestedLimit=60), lambda b: b['context'].update(locale='zh-CN'),
                       lambda b: b['context'].update(deviceScaleFactor=2)):
            self.summary, self.manifest, self.prefix = fixture(self.source)
            self.mutate_body(mutate)
            with self.assertRaisesRegex(ValueError, 'browser profile or requested limit'):
                self.verify()

    def test_manifest_keyword_order_is_exact(self):
        self.manifest['queries'][0]['keyword'] = 'different keyword'
        self.resave()
        with self.assertRaisesRegex(ValueError, 'Expected keyword sequence differs'):
            self.verify()

    def test_status_cannot_disagree_with_underlying_query_results(self):
        self.manifest['status'] = self.summary['status'] = 'completed'
        self.resave()
        with self.assertRaisesRegex(ValueError, 'Manifest status disagrees'):
            self.verify()

    def test_partial_nonranking_completed_returns_cli_exit_zero(self):
        log = self.root / 'collector.log'
        log.write_text('collector progress\n' + json.dumps(self.summary) + '\n')
        keywords = self.root / 'keywords.json'
        keywords.write_text(json.dumps(EXPECTED_KEYWORDS))
        config = self.root / 'config.json'
        config.write_text(json.dumps(EXPECTED_CONFIG))
        result = subprocess.run([sys.executable, str(pathlib.Path(smoke.__file__)), '--log', str(log),
            '--out', str(self.root / 'cli'), '--offline-root', str(self.source), '--digest', f.DIGEST,
            '--source-commit', f.SOURCE, '--expected-keywords', str(keywords), '--expected-config', str(config)],
            capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = json.loads((self.root / 'cli/readback-report.json').read_text())
        self.assertTrue(report['smokeAccepted'])
        self.assertEqual(report['status'], 'partial')
        self.assertEqual(report['executionStatus'], 'completed')
        self.assertEqual(report['verificationIdentity'], 'offline_replay')

    def test_summary_must_be_unique(self):
        log = self.root / 'collector.log'
        log.write_text((json.dumps(self.summary) + '\n') * 2)
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            smoke.read_summary(log)

    def test_config_runtime_bounds_and_geography_override_fail_closed(self):
        for changed in ({'maxResultsPerKeyword': 0}, {'maxScreenshotsPerKeyword': 0}, {'keywordTimeoutMs': 1},
                        {'maxScrollsPerKeyword': 51}, {'maxResultsPerKeyword': True}, {'expectedArea': {}},
                        {'mapView': {}}, {'viewport': {'width': 799, 'height': 1000}},
                        {'browserTimezoneId': 'invalid/zone'}):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                smoke.normalized_config({**EXPECTED_CONFIG, **changed}, EXPECTED_KEYWORDS)


if __name__ == '__main__':
    unittest.main()
