import collections
import copy
import csv
import io
import json
import pathlib
import struct
import tempfile
import unittest
import zlib

import verify_daily as v

DIGEST = 'sha256:' + 'a' * 64
SOURCE = 'b' * 40


def make_png():
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b'\x00\x00\x00\x00')) + chunk(b'IEND', b'')


def fixture(root, statuses=('captured', 'partial'), omit_snapshot=False):
    root = pathlib.Path(root)
    def put(key, value):
        data = value if isinstance(value, bytes) else json.dumps(value, ensure_ascii=False).encode()
        path = root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return {'objectKey': key, 'storageStatus': 'verified', 'bytes': len(data), 'sha256': v.digest(data)}
    store = {'storeId': 'store', 'merchantId': 'merchant', 'placeId': 'ChIJtest', 'name': 'Store'}
    keywords = [{'keyword': f'keyword {i}', 'priority': 'P0', 'sourceIndex': i} for i in range(len(statuses))]
    source = {'keywords': keywords, 'placeId': store['placeId'], 'merchantId': store['merchantId'], 'sourceResponseHash': 'c' * 64}
    snapshot = {'dailyRunId': 'daily', 'runKey': 'manual', 'date': '2026-09-18', 'store': store,
                'source': source, 'selectionPolicy': v.POLICY, 'keywords': keywords, 'availableCount': len(keywords), 'duplicateCount': 0}
    snapshot['selectionHash'] = v.digest(v.json_bytes({'sourceResponseHash': source['sourceResponseHash'], 'policy': v.POLICY, 'keywords': keywords}))
    prefix = '2026-09-18/store/daily/batches/b01/run/attempt/'
    rows, artifacts, own = [], [], []
    for i, status in enumerate(statuses):
        qid, keyword = f'q{i + 1:04}', keywords[i]['keyword']
        if status == 'skipped':
            rows.append({'queryId': qid, 'inputIndex': i, 'keyword': keyword, 'status': 'skipped', 'stopReason': 'unsupported_layout',
                         'attempts': [], 'selectedQueryAttemptId': None, 'resultFile': None, 'artifactIds': [], 'persistenceStatus': 'not_requested'})
            continue
        filename = f'{qid}/qa01/result.json'
        png = {**put(prefix + f'{qid}/qa01/shot.png', make_png()), 'id': 'shot', 'filename': 'shot.png',
               'kind': 'results' if status == 'captured' else 'diagnostic', 'width': 1, 'height': 1, 'queryId': qid, 'queryAttemptId': 'qa01', 'observationId': 'obs01'}
        geo = {'status': 'unverified', 'expectedArea': None, 'reason': 'expected_area_not_configured'}
        listing = {'occurrenceId': 'occ01', 'displayPosition': 1, 'resultType': 'organic', 'organicRank': 1, 'name': 'Store', 'address': None,
                   'rating': None, 'reviewCount': None, 'category': 'Bakery', 'mapsUrl': None, 'placeId': 'ChIJtest',
                   'adLabel': None, 'screenshotIds': ['shot']}
        body = {'runId': 'run', 'attemptId': 'attempt', 'queryId': qid, 'queryAttemptId': 'qa01', 'keyword': keyword,
                'status': status, 'stopReason': 'end_of_results' if status == 'captured' else 'non_ranking_result',
                'finishedAt': '2026-09-18T00:00:00Z', 'sequenceVerified': True, 'metadata': {'imageDigest': DIGEST, 'sourceCommit': SOURCE, 'profileHash': 'profile', 'adapterVersion': v.ADAPTER},
                'context': {'locationMode': 'query_only', 'configuredMapView': None, 'geolocationPermission': 'not_granted', 'loggedIn': False},
                'quality': {'geographicRelevance': geo, 'classificationComplete': True, 'screenshotCoverageComplete': True,
                            'resultSurface': 'results_list' if status == 'captured' else 'place_details'},
                'error': None, 'observationArtifactIds': ['observations'],
                'listings': [listing] if status == 'captured' else [], 'screenshots': [png], 'observedCount': 1 if status == 'captured' else 0}
        observation = {k: body[k] for k in ('runId', 'attemptId', 'queryId', 'queryAttemptId')}
        observation.update(observationId='obs01', accepted=True, cards=[{'occurrenceId': 'occ01', 'fullyVisible': True}], screenshotIds=['shot'])
        obs_art = {**put(prefix + f'{qid}/qa01/observations.jsonl', (json.dumps(observation)+'\n').encode() if status == 'captured' else b''),
                   'id': 'observations', 'kind': 'observations_jsonl', 'queryId': qid, 'queryAttemptId': 'qa01'}
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(v.CSV_COLUMNS)
        if body['listings']:
            writer.writerow(['run', 'attempt', qid, keyword, body['finishedAt'], 'profile', 1, 'organic', 1, 'Store', '', '', '', 'Bakery', '', 'ChIJtest', '', 'shot.png', 'unverified'])
        csv_art = {**put(prefix + filename[:-5] + '.csv', output.getvalue().encode()), 'id': 'csv', 'filename': filename[:-5] + '.csv', 'kind': 'result_csv', 'queryId': qid, 'queryAttemptId': 'qa01'}
        json_art = {**put(prefix + filename, body), 'id': 'json', 'filename': filename, 'kind': 'result_json', 'queryId': qid, 'queryAttemptId': 'qa01'}
        artifacts.extend([png, csv_art, json_art, obs_art])
        attempt = {'queryAttemptId': 'qa01', 'resultFile': filename, 'status': status, 'stopReason': body['stopReason'], 'error': None, 'artifactIds': ['shot', 'csv', 'json', 'observations']}
        rows.append({'queryId': qid, 'inputIndex': i, 'keyword': keyword, 'status': status, 'stopReason': body['stopReason'], 'selectedQueryAttemptId': 'qa01',
                     'resultFile': filename, 'attempts': [attempt], 'persistenceStatus': 'verified', 'error': None, 'artifactIds': attempt['artifactIds']})
        own.append({'queryId': qid, 'keyword': keyword, 'summary': v.own_summary('ChIJtest', body['listings']), 'geographicRelevance': geo})
    counts = dict(collections.Counter(statuses))
    counts['nonRanking'] = counts.get('partial', 0)
    execution = 'incomplete' if 'skipped' in statuses else 'completed'
    batch_status = 'completed' if set(statuses) == {'captured'} else 'partial'
    manifest = {'runId': 'run', 'attemptId': 'attempt', 'finishedAt': '2026-09-18T00:00:00Z', 'status': batch_status,
                'metadata': {'imageDigest': DIGEST, 'sourceCommit': SOURCE, 'adapterVersion': v.ADAPTER},
                'executionStatus': execution, 'persistenceMode': 'azure_blob', 'queries': rows, 'artifacts': artifacts}
    batch = {'batchId': 'b01', 'keywords': [k['keyword'] for k in keywords], 'runId': 'run', 'attemptId': 'attempt',
             'prefix': prefix.split('/run/')[0], 'status': batch_status, 'manifestReceipt': put(prefix + 'manifest.json', manifest), 'counts': counts, 'ownStore': own, 'executionStatus': execution}
    daily = {'dailyRunId': 'daily', 'runKey': 'manual', 'date': '2026-09-18', 'startedAt': 'start', 'finishedAt': 'finish', 'status': batch_status,
             'executionStatus': execution, 'stopReason': None, 'deliveryMode': 'azure_blob', 'stores': [{**store, 'status': batch_status, 'executionStatus': execution,
             'snapshotReceipt': None if omit_snapshot else put('2026-09-18/store/daily/keyword-selection.json', snapshot),
             'selectionHash': snapshot['selectionHash'], 'selectedCount': len(statuses), 'batches': [batch]}],
             'counts': {'stores': 1, 'batches': 1, 'selected': len(statuses), **{s: counts.get(s, 0) for s in v.STATES}, 'sourceFailed': 0, 'empty': 0, 'nonRanking': counts['nonRanking']}}
    return {'dailyRunId': 'daily', 'runKey': 'manual', 'counts': daily['counts'], 'status': batch_status,
            'executionStatus': execution, 'exitCode': 0 if execution == 'completed' else 2, 'manifestReceipt': put('2026-09-18/daily/daily/manifest.json', daily)}


def mutate_fixture(root, summary, mutate):
    """Re-sign the entire receipt chain, so negative tests exercise semantics."""
    root = pathlib.Path(root)
    dp = root / summary['manifestReceipt']['objectKey']
    daily = json.loads(dp.read_text())
    batch = daily['stores'][0]['batches'][0]
    mp = root / batch['manifestReceipt']['objectKey']
    manifest = json.loads(mp.read_text())
    prefix = batch['manifestReceipt']['objectKey'].rsplit('/', 1)[0] + '/'
    bodies = [json.loads((root / (prefix + q['resultFile'])).read_text()) if q['resultFile'] else None for q in manifest['queries']]
    mutate(daily, batch, manifest, bodies)
    for row, body in zip(manifest['queries'], bodies):
        if body is not None:
            (root / (prefix + row['resultFile'])).write_text(json.dumps(body))
    for artifact in manifest['artifacts']:
        data = (root / artifact['objectKey']).read_bytes()
        artifact.update(bytes=len(data), sha256=v.digest(data))
    mp.write_text(json.dumps(manifest))
    batch['manifestReceipt'].update(bytes=mp.stat().st_size, sha256=v.digest(mp.read_bytes()))
    dp.write_text(json.dumps(daily))
    summary.update(counts=daily['counts'], status=daily['status'], executionStatus=daily['executionStatus'])
    summary['manifestReceipt'].update(bytes=dp.stat().st_size, sha256=v.digest(dp.read_bytes()))
    return summary


class VerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def verify(self, summary, out='out'):
        return v.verify(summary, v.Reader(self.root / out, self.root / 'source'), DIGEST, SOURCE, expected_stores=1)

    def test_nonranking_is_partial_but_does_not_invalidate_collection(self):
        summary = fixture(self.root / 'source')
        report = self.verify(summary)
        self.assertEqual(report['counts']['selected'], 2)
        self.assertEqual(report['nonRankingDetailCount'], 1)
        self.assertTrue(report['collectionAcceptancePassed'])
        self.assertFalse(report['allKeywordsRankingComplete'])
        self.assertEqual(report['verifiedObjects'], 11)
        self.assertEqual(report['pngsStructurallyChecked'], 2)
        self.assertEqual(report['csvRowsComparedAllAttempts'], 1)
        self.assertEqual(self.verify(summary)['cacheReused'], 11)

    def test_skip_is_explicit_and_not_acceptance(self):
        report = self.verify(fixture(self.root / 'source', ('captured', 'skipped')))
        self.assertEqual(report['counts']['skipped'], 1)
        self.assertFalse(report['allSelectedKeywordsAttempted'])
        self.assertFalse(report['collectionAcceptancePassed'])

    def test_corrupt_artifact_fails_readback(self):
        summary = fixture(self.root / 'source')
        next((self.root / 'source').rglob('shot.png')).write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'Receipt mismatch'):
            self.verify(summary)

    def test_empty_observation_artifact_is_valid_with_exact_receipt(self):
        source = self.root / 'source'
        source.mkdir()
        (source / 'observations.jsonl').write_bytes(b'')
        reader = v.Reader(self.root / 'out', source)
        path = reader.read({'objectKey': 'observations.jsonl', 'storageStatus': 'verified',
                            'bytes': 0, 'sha256': v.digest(b'')}, 'artifact')
        self.assertEqual(path.read_bytes(), b'')

    def test_missing_selected_snapshot_is_never_empty_success(self):
        with self.assertRaisesRegex(ValueError, 'Missing selection snapshot'):
            self.verify(fixture(self.root / 'source', omit_snapshot=True))

    def test_duplicate_claim_is_not_acceptance(self):
        with self.assertRaisesRegex(ValueError, 'duplicate_skipped'):
            self.verify({'status': 'duplicate_skipped'})

    def result_fixture(self):
        fixture(self.root / 'source')
        mp = next(p for p in (self.root / 'source').rglob('manifest.json') if '/batches/' in str(p))
        manifest = json.loads(mp.read_text())
        prefix = mp.relative_to(self.root / 'source').as_posix().rsplit('/', 1)[0] + '/'
        row = manifest['queries'][0]
        attempt = row['attempts'][0]
        body = json.loads((self.root / 'source' / prefix / attempt['resultFile']).read_text())
        reader = v.Reader(self.root / 'out', self.root / 'source')
        by_key = {a['objectKey']: a for a in manifest['artifacts']}
        for artifact in manifest['artifacts']:
            reader.read(artifact, 'artifact')
        return body, row, attempt, manifest, {'placeId': 'ChIJtest'}, by_key, prefix, reader

    def test_captured_empty_list_requires_verified_screenshot(self):
        args = self.result_fixture()
        args[0].update(listings=[], observedCount=0, screenshots=[])
        with self.assertRaisesRegex(ValueError, 'Captured result lacks screenshot evidence'):
            v.validate_result(*args)

    def test_cross_query_screenshot_cannot_satisfy_evidence(self):
        args = self.result_fixture()
        other = next(a for a in args[5].values() if a['kind'] == 'diagnostic')
        args[0]['screenshots'] = [{**other, 'width': 1, 'height': 1}]
        with self.assertRaisesRegex(ValueError, 'Screenshot artifact ownership'):
            v.validate_result(*args)

    def test_cross_query_csv_cannot_satisfy_evidence(self):
        args = self.result_fixture()
        csv_artifact = args[5][args[6] + args[2]['resultFile'][:-5] + '.csv']
        csv_artifact['queryId'] = 'other'
        with self.assertRaisesRegex(ValueError, 'CSV artifact ownership'):
            v.validate_result(*args)

    def test_json_csv_mismatch_even_with_valid_receipt_is_detected(self):
        summary = fixture(self.root / 'source', ('captured',))
        # Re-sign the changed CSV and ancestor manifests, simulating internally
        # consistent transport with semantically wrong exported data.
        p = next((self.root / 'source').rglob('result.csv'))
        p.write_text(p.read_text().replace('Store', 'Wrong'))
        mp = next(p for p in (self.root / 'source').rglob('manifest.json') if '/batches/' in str(p))
        m = json.loads(mp.read_text())
        receipt = next(a for a in m['artifacts'] if a['kind'] == 'result_csv')
        receipt.update(bytes=p.stat().st_size, sha256=v.digest(p.read_bytes()))
        mp.write_text(json.dumps(m))
        dp = self.root / 'source' / summary['manifestReceipt']['objectKey']
        d = json.loads(dp.read_text())
        d['stores'][0]['batches'][0]['manifestReceipt'].update(bytes=mp.stat().st_size, sha256=v.digest(mp.read_bytes()))
        dp.write_text(json.dumps(d))
        summary['manifestReceipt'].update(bytes=dp.stat().st_size, sha256=v.digest(dp.read_bytes()))
        with self.assertRaisesRegex(ValueError, 'CSV/JSON semantic mismatch'):
            self.verify(summary)


    def mutate(self, summary, fn):
        return mutate_fixture(self.root / 'source', summary, fn)

    def test_v3_partial_execution_completed_preserves_exit_zero(self):
        report = self.verify(fixture(self.root / 'source'))
        self.assertEqual((report['status'], report['executionStatus'], report['exitCode']), ('partial', 'completed', 0))
        self.assertEqual(report['counts']['nonRanking'], 1)
        self.assertEqual(report['coverage']['nonemptyRankedCaptures'], 1)
        self.assertEqual(report['coverage']['nonRankingDetails'], 1)
        self.assertEqual(report['otherPartialCount'], 0)
        self.assertEqual(report['observationRecordsChecked'], 1)

    def test_nonranking_aggregate_mismatch_rejected(self):
        summary = fixture(self.root / 'source')
        def edit(d, b, m, bodies):
            d['counts']['nonRanking'] = b['counts']['nonRanking'] = 0
        self.mutate(summary, edit)
        with self.assertRaisesRegex(ValueError, 'nonRanking count differs'):
            self.verify(summary)

    def test_nonranking_missing_observations_cannot_complete(self):
        summary = fixture(self.root / 'source')
        def edit(d, b, m, bodies):
            q = m['queries'][1]
            m['artifacts'] = [a for a in m['artifacts'] if not (a['queryId'] == q['queryId'] and a['kind'] == 'observations_jsonl')]
            q['artifactIds'].remove('observations')
            q['attempts'][0]['artifactIds'] = q['artifactIds'][:]
            bodies[1]['observationArtifactIds'] = []
        self.mutate(summary, edit)
        with self.assertRaisesRegex(ValueError, 'nonRanking count differs'):
            self.verify(summary)

    def test_nonranking_error_cannot_complete(self):
        summary = fixture(self.root / 'source')
        def edit(d, b, m, bodies):
            err = {'code': 'write_failed'}
            m['queries'][1]['error'] = m['queries'][1]['attempts'][0]['error'] = bodies[1]['error'] = err
        self.mutate(summary, edit)
        with self.assertRaisesRegex(ValueError, 'nonRanking count differs'):
            self.verify(summary)

    def test_other_partial_is_incomplete_exit_two(self):
        summary = fixture(self.root / 'source')
        def edit(d, b, m, bodies):
            d['counts']['nonRanking'] = b['counts']['nonRanking'] = 0
            d['executionStatus'] = d['stores'][0]['executionStatus'] = b['executionStatus'] = m['executionStatus'] = 'incomplete'
            q = m['queries'][1]
            q['stopReason'] = q['attempts'][0]['stopReason'] = bodies[1]['stopReason'] = 'unsupported_layout'
            bodies[1]['quality']['resultSurface'] = 'unknown'
        self.mutate(summary, edit)
        summary['exitCode'] = 2
        report = self.verify(summary)
        self.assertFalse(report['collectionAcceptancePassed'])
        self.assertEqual(report['otherPartialCount'], 1)
        self.assertEqual(report['exitCode'], 2)

    def test_execution_completed_cannot_mask_other_partial(self):
        summary = fixture(self.root / 'source')
        def edit(d, b, m, bodies):
            d['counts']['nonRanking'] = b['counts']['nonRanking'] = 0
            q = m['queries'][1]
            q['stopReason'] = q['attempts'][0]['stopReason'] = bodies[1]['stopReason'] = 'timeout'
            bodies[1]['quality']['resultSurface'] = 'unknown'
        self.mutate(summary, edit)
        with self.assertRaisesRegex(ValueError, 'Batch executionStatus differs'):
            self.verify(summary)

    def test_runtime_provenance_mismatches_rejected(self):
        for field, bad in [('imageDigest', 'sha256:'+'e'*64), ('sourceCommit', 'f'*40), ('adapterVersion', 'maps-feed-card/v2')]:
            with self.subTest(field=field):
                summary = fixture(self.root / 'source')
                self.mutate(summary, lambda d,b,m,bodies: m['metadata'].update({field: bad}))
                with self.assertRaisesRegex(ValueError, 'Unexpected batch'):
                    self.verify(summary, out=field)

    def test_result_runtime_provenance_mismatches_rejected(self):
        for field, bad in [('imageDigest', 'sha256:'+'e'*64), ('sourceCommit', 'f'*40), ('adapterVersion', 'maps-feed-card/v2')]:
            with self.subTest(field=field):
                summary = fixture(self.root / 'source')
                self.mutate(summary, lambda d,b,m,bodies: bodies[0]['metadata'].update({field: bad}))
                with self.assertRaisesRegex(ValueError, 'Result image/source/adapter differs'):
                    self.verify(summary, out=field)

    def test_captured_listing_requires_accepted_fully_visible_observation(self):
        summary = fixture(self.root / 'source')
        obs = next(p for p in (self.root / 'source').rglob('observations.jsonl') if p.stat().st_size)
        body = json.loads(obs.read_text())
        body['cards'][0]['fullyVisible'] = False
        obs.write_text(json.dumps(body)+'\n')
        self.mutate(summary, lambda *args: None)
        with self.assertRaisesRegex(ValueError, 'no fully visible accepted screenshot'):
            self.verify(summary)

    def test_selected_attempt_artifact_ids_are_checked(self):
        summary = fixture(self.root / 'source')
        def edit(d, b, m, bodies):
            q = m['queries'][0]
            q['artifactIds'] = q['attempts'][0]['artifactIds'] = ['shot', 'json', 'csv']
        self.mutate(summary, edit)
        with self.assertRaisesRegex(ValueError, 'Attempt artifact references differ'):
            self.verify(summary)

    def test_explicit_no_results_is_separate_from_ranked_capture(self):
        summary = fixture(self.root / 'source', ('captured',))
        csv_path = next((self.root / 'source').rglob('result.csv'))
        csv_path.write_text(','.join(v.CSV_COLUMNS)+'\n')
        def edit(d, b, m, bodies):
            bodies[0].update(listings=[], observedCount=0)
            bodies[0]['quality']['resultSurface'] = 'no_results'
            b['ownStore'][0]['summary'] = v.own_summary('ChIJtest', [])
        self.mutate(summary, edit)
        report = self.verify(summary)
        self.assertEqual(report['coverage']['nonemptyRankedCaptures'], 0)
        self.assertEqual(report['coverage']['explicitNoResults'], 1)
        self.assertTrue(report['collectionAcceptancePassed'])

    def test_zero_exit_cannot_mask_incomplete_execution(self):
        summary = fixture(self.root / 'source', ('captured', 'skipped'))
        summary['exitCode'] = 0
        with self.assertRaisesRegex(ValueError, 'exitCode differs'):
            self.verify(summary)


    def test_retry_keeps_all_attempt_artifacts_and_selects_captured(self):
        for prior_status in ('failed', 'partial'):
            with self.subTest(prior_status=prior_status):
                summary = fixture(self.root / 'source', ('captured',))
                def edit(d, b, m, bodies):
                    row = m['queries'][0]
                    first = copy.deepcopy(row['attempts'][0])
                    first.update(queryAttemptId='qa00', resultFile=row['resultFile'].replace('qa01', 'qa00'),
                                 status=prior_status, stopReason='timeout',
                                 error={'code': 'timeout'} if prior_status == 'failed' else None)
                    first['artifactIds'] = ['first_' + aid for aid in first['artifactIds']]
                    body = copy.deepcopy(bodies[0])
                    body.update(queryAttemptId='qa00', status=prior_status, stopReason='timeout', error=first['error'])
                    body['observationArtifactIds'] = ['first_' + aid for aid in body['observationArtifactIds']]
                    for shot in body['screenshots']:
                        shot.update(id='first_' + shot['id'], queryAttemptId='qa00', objectKey=shot['objectKey'].replace('qa01', 'qa00'))
                    for listing in body['listings']:
                        listing['screenshotIds'] = ['first_' + sid for sid in listing['screenshotIds']]
                    for artifact in list(m['artifacts']):
                        art = copy.deepcopy(artifact)
                        art.update(id='first_' + art['id'], queryAttemptId='qa00', objectKey=art['objectKey'].replace('qa01', 'qa00'))
                        oldpath = self.root / 'source' / artifact['objectKey']
                        newpath = self.root / 'source' / art['objectKey']
                        newpath.parent.mkdir(parents=True, exist_ok=True)
                        if art['kind'] == 'result_json':
                            newpath.write_text(json.dumps(body))
                        elif art['kind'] == 'observations_jsonl':
                            obs = json.loads(oldpath.read_text())
                            obs.update(queryAttemptId='qa00', screenshotIds=['first_shot'])
                            newpath.write_text(json.dumps(obs)+'\n')
                        else:
                            newpath.write_bytes(oldpath.read_bytes())
                        m['artifacts'].append(art)
                    row['attempts'].insert(0, first)
                    row['artifactIds'] = [aid for attempt in row['attempts'] for aid in attempt['artifactIds']]
                self.mutate(summary, edit)
                report = self.verify(summary, out=prior_status)
                self.assertTrue(report['collectionAcceptancePassed'])
                self.assertEqual(report['resultAttemptsCompared'], 2)
                self.assertEqual(report['coverage']['nonemptyRankedCaptures'], 1)

    def test_honest_incomplete_nonranking_is_other_partial(self):
        for failure in ('diagnostic', 'observations', 'error'):
            with self.subTest(failure=failure):
                summary = fixture(self.root / 'source')
                def edit(d, b, m, bodies):
                    d['counts']['nonRanking'] = b['counts']['nonRanking'] = 0
                    d['executionStatus'] = d['stores'][0]['executionStatus'] = b['executionStatus'] = m['executionStatus'] = 'incomplete'
                    row, body = m['queries'][1], bodies[1]
                    if failure == 'error':
                        row['error'] = row['attempts'][0]['error'] = body['error'] = {'code': 'diagnostic_failed'}
                    else:
                        kind = 'diagnostic' if failure == 'diagnostic' else 'observations_jsonl'
                        aid = 'shot' if failure == 'diagnostic' else 'observations'
                        m['artifacts'] = [a for a in m['artifacts'] if not (a['queryId'] == row['queryId'] and a['kind'] == kind)]
                        row['artifactIds'].remove(aid)
                        row['attempts'][0]['artifactIds'] = row['artifactIds'][:]
                        if failure == 'diagnostic':
                            body['screenshots'] = []
                        else:
                            body['observationArtifactIds'] = []
                self.mutate(summary, edit)
                summary['exitCode'] = 2
                report = self.verify(summary, out=failure)
                self.assertTrue(report['evidenceIntegrityPassed'])
                self.assertFalse(report['collectionAcceptancePassed'])
                self.assertEqual(report['coverage']['otherPartial'], 1)
                self.assertEqual(report['coverage']['nonRankingDetails'], 0)
                self.assertEqual(report['executionStatus'], 'incomplete')


if __name__ == '__main__':
    unittest.main()
