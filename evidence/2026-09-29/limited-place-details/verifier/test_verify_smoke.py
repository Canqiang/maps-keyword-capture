import copy
import csv
import io
import json
import pathlib
import tempfile
import unittest

import synthetic_fixture as f
import verification_helpers as h
import verify_smoke as smoke

EXPECTED_KEYWORDS = ['keyword 0', 'keyword 1']
EXPECTED_CONFIG = smoke.normalized_config({'schemaVersion': '1', 'keywords': EXPECTED_KEYWORDS, 'outputDirectory': '/work/outputs'}, EXPECTED_KEYWORDS)


def put(root, key, value):
    data = value if isinstance(value, bytes) else json.dumps(value).encode()
    path = root / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return {'objectKey': key, 'storageStatus': 'verified', 'bytes': len(data), 'sha256': h.digest(data)}


def fixture(root):
    f.fixture(root)
    mp = next(p for p in root.rglob('manifest.json') if '/batches/' in str(p))
    manifest = json.loads(mp.read_text())
    prefix = mp.relative_to(root).as_posix().rsplit('/', 1)[0] + '/'
    manifest['executionStatus'] = 'completed'
    manifest['persistenceMode'] = 'azure_blob'
    manifest['startedAt'] = '2026-09-18T00:00:00Z'
    manifest['metadata'].update(adapterVersion=smoke.ADAPTER, configHash=h.digest(h.json_bytes(EXPECTED_CONFIG)), profileHash=smoke.profile_hash(EXPECTED_CONFIG, smoke.ADAPTER))
    for row in manifest['queries']:
        row['error'] = None
        attempt = row['attempts'][0]
        attempt['error'] = None
        body_key = prefix + attempt['resultFile']
        body = json.loads((root / body_key).read_text())
        body['metadata'].update(manifest['metadata'])
        body['requestedLimit'] = EXPECTED_CONFIG['maxResultsPerKeyword']
        body['context'].update({k: EXPECTED_CONFIG[k] for k in ('locale', 'browserTimezoneId', 'viewport')}, deviceScaleFactor=1)
        body['finalUrl'] = 'https://www.google.com/maps/place/She-Joy' if not body['listings'] else 'https://www.google.com/maps/search/keyword+0'
        if not body['listings']:
            body['quality']['placeDetails'] = {'name': "She-Joy's Sweet Treats", 'mapsUrl': body['finalUrl'], 'recognition': 'limited_actions', 'signals': ['visible_heading', 'named_pane', 'named_actions', 'save', 'send_to_phone', 'share', 'website']}
        csv_artifact = next(a for a in manifest['artifacts'] if a['kind'] == 'result_csv' and a['queryId'] == row['queryId'])
        csv_reader = csv.DictReader(io.StringIO((root / csv_artifact['objectKey']).read_text()))
        csv_rows = list(csv_reader)
        csv_out = io.StringIO()
        writer = csv.DictWriter(csv_out, fieldnames=csv_reader.fieldnames)
        writer.writeheader()
        for csv_row in csv_rows:
            csv_row['profile_hash'] = body['metadata']['profileHash']
            writer.writerow(csv_row)
        csv_artifact.update(put(root, csv_artifact['objectKey'], csv_out.getvalue().encode()))
        body['error'] = None
        body['observationArtifactIds'] = ['obs']
        for listing in body['listings']:
            listing['occurrenceId'] = 'occ_' + row['queryId']
        for shot in body['screenshots']:
            shot['observationId'] = 'obs01' if body['listings'] else None
        observations = []
        if body['listings']:
            observations = [{'runId': body['runId'], 'attemptId': body['attemptId'], 'queryId': body['queryId'],
                             'queryAttemptId': body['queryAttemptId'], 'observationId': 'obs01', 'accepted': True,
                             'screenshotIds': [s['id'] for s in body['screenshots']],
                             'cards': [{'occurrenceId': l['occurrenceId'], 'fullyVisible': True} for l in body['listings']]}]
        obs_key = prefix + row['queryId'] + '/qa01/observations.jsonl'
        obs_artifact = {**put(root, obs_key, '\n'.join(json.dumps(o) for o in observations).encode()),
                        'id': 'obs', 'kind': 'observations_jsonl', 'queryId': row['queryId'], 'queryAttemptId': 'qa01'}
        manifest['artifacts'].append(obs_artifact)
        json_artifact = next(a for a in manifest['artifacts'] if a['objectKey'] == body_key)
        json_artifact.update(put(root, body_key, body))
        attempt['artifactIds'] = [a['id'] for a in manifest['artifacts'] if a['queryId'] == row['queryId']]
        row['artifactIds'] = attempt['artifactIds'].copy()
    request = {'runId': manifest['runId'], 'attemptId': manifest['attemptId'], 'startedAt': manifest['startedAt'], 'config': EXPECTED_CONFIG}
    manifest['artifacts'].append({**put(root, prefix + 'request.json', request), 'id': 'request_json', 'kind': 'request_json', 'queryId': None, 'queryAttemptId': None})
    receipt = put(root, mp.relative_to(root).as_posix(), manifest)
    summary = {'summary': True, 'runId': manifest['runId'], 'attemptId': manifest['attemptId'],
               'status': 'partial', 'executionStatus': 'completed', 'remotePersistence': 'verified',
               'manifestReceipt': receipt, 'counts': {'captured': 1, 'partial': 1, 'nonRanking': 1}}
    return summary, manifest, prefix


class SmokeVerifierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.source = self.root / 'source'
        self.summary, self.manifest, self.prefix = fixture(self.source)

    def tearDown(self):
        self.temp.cleanup()

    def verify(self, keywords=None):
        return smoke.verify(self.summary, h.Reader(self.root / 'out', self.source), f.DIGEST, f.SOURCE,
                            keywords or EXPECTED_KEYWORDS, expected_config=copy.deepcopy(EXPECTED_CONFIG))

    def resave(self):
        self.summary['manifestReceipt'].update(put(self.source, self.summary['manifestReceipt']['objectKey'], self.manifest))

    def test_complete_execution_preserves_nonranking_partial(self):
        report = self.verify()
        self.assertTrue(report['smokeAccepted'])
        self.assertEqual(report['status'], 'partial')
        self.assertEqual(report['executionStatus'], 'completed')
        self.assertEqual(report['counts']['nonRanking'], 1)
        self.assertEqual(report['verifiedObjects'], 10)
        self.assertEqual(report['observationRecordsChecked'], 1)
        self.assertTrue(report['results'][0]['allListingsCovered'])
        self.assertIsNone(report['podExitCode'])

    def test_other_partial_does_not_pass_stale_completed_execution(self):
        row = self.manifest['queries'][1]
        row['stopReason'] = row['attempts'][0]['stopReason'] = 'scroll_limit'
        key = self.prefix + row['resultFile']
        body = json.loads((self.source / key).read_text())
        body['stopReason'] = 'scroll_limit'
        body['quality'].pop('placeDetails', None)
        next(a for a in self.manifest['artifacts'] if a['objectKey'] == key).update(put(self.source, key, body))
        self.summary['counts']['nonRanking'] = 0
        self.resave()
        report = self.verify()
        self.assertFalse(report['smokeAccepted'])
        self.assertEqual(report['verifierExitCode'], 2)

    def test_detail_requires_observations_artifact(self):
        row = self.manifest['queries'][1]
        self.manifest['artifacts'] = [a for a in self.manifest['artifacts'] if not (a['queryId'] == row['queryId'] and a['kind'] == 'observations_jsonl')]
        row['artifactIds'].remove('obs')
        row['attempts'][0]['artifactIds'].remove('obs')
        self.resave()
        with self.assertRaisesRegex(ValueError, 'Missing observations artifact'):
            self.verify()

    def test_keyword_sequence_is_exact(self):
        with self.assertRaisesRegex(ValueError, 'Expected config keyword sequence'):
            self.verify(['keyword 1', 'keyword 0'])

    def test_corrupt_artifact_fails(self):
        next(self.source.rglob('shot.png')).write_bytes(b'bad')
        with self.assertRaisesRegex(ValueError, 'Receipt mismatch'):
            self.verify()

    def test_captured_listing_needs_accepted_fully_visible_observation(self):
        artifact = next(a for a in self.manifest['artifacts'] if a['kind'] == 'observations_jsonl' and a['queryId'] == 'q0001')
        obs = json.loads((self.source / artifact['objectKey']).read_text())
        obs['cards'][0]['fullyVisible'] = False
        artifact.update(put(self.source, artifact['objectKey'], json.dumps(obs).encode()))
        self.resave()
        with self.assertRaisesRegex(ValueError, 'no fully visible accepted screenshot'):
            self.verify()

    def test_wrong_adapter_does_not_pass(self):
        self.manifest['metadata']['adapterVersion'] = 'maps-feed-card/v2'
        self.resave()
        with self.assertRaisesRegex(ValueError, 'Unexpected manifest adapterVersion'):
            self.verify()

    def test_unknown_listing_cannot_pass_a_stale_complete_flag(self):
        row = self.manifest['queries'][0]
        key = self.prefix + row['resultFile']
        body = json.loads((self.source / key).read_text())
        body['listings'][0].update(resultType='unknown', organicRank=None)
        next(a for a in self.manifest['artifacts'] if a['objectKey'] == key).update(put(self.source, key, body))
        self.resave()
        with self.assertRaisesRegex(ValueError, 'Classification completeness flag disagrees'):
            self.verify()

    def test_orphan_result_artifact_owner_is_rejected(self):
        key = self.prefix + 'q9999/qa01/result.json'
        self.manifest['artifacts'].append({**put(self.source, key, {}), 'id': 'orphan',
            'kind': 'result_json', 'queryId': 'q9999', 'queryAttemptId': 'qa01'})
        self.resave()
        with self.assertRaisesRegex(ValueError, 'Artifact owner does not reference'):
            self.verify()

    def test_extra_result_json_for_real_attempt_is_rejected(self):
        key = self.prefix + 'q0001/qa01/extra.json'
        self.manifest['artifacts'].append({**put(self.source, key, {}), 'id': 'extra',
            'kind': 'result_json', 'queryId': 'q0001', 'queryAttemptId': 'qa01'})
        self.resave()
        with self.assertRaisesRegex(ValueError, 'Extra or mismatched result JSON/CSV'):
            self.verify()


if __name__ == '__main__':
    unittest.main()
