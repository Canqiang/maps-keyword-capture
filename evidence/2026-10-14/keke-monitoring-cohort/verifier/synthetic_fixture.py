"""Synthetic fixture construction reused from full-run verifier tests."""

import collections, csv, io, json, pathlib, struct, zlib

import verification_helpers as v

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
               'kind': 'results' if status == 'captured' else 'diagnostic', 'width': 1, 'height': 1, 'queryId': qid, 'queryAttemptId': 'qa01'}
        geo = {'status': 'unverified', 'expectedArea': None, 'reason': 'expected_area_not_configured'}
        listing = {'displayPosition': 1, 'resultType': 'organic', 'organicRank': 1, 'name': 'Store', 'address': None,
                   'rating': None, 'reviewCount': None, 'category': 'Bakery', 'mapsUrl': None, 'placeId': 'ChIJtest',
                   'adLabel': None, 'screenshotIds': ['shot']}
        body = {'runId': 'run', 'attemptId': 'attempt', 'queryId': qid, 'queryAttemptId': 'qa01', 'keyword': keyword,
                'status': status, 'stopReason': 'end_of_results' if status == 'captured' else 'non_ranking_result',
                'finishedAt': '2026-09-18T00:00:00Z', 'sequenceVerified': True, 'metadata': {'imageDigest': DIGEST, 'sourceCommit': SOURCE, 'profileHash': 'profile'},
                'context': {'locationMode': 'query_only', 'configuredMapView': None, 'geolocationPermission': 'not_granted', 'loggedIn': False},
                'quality': {'geographicRelevance': geo, 'classificationComplete': True, 'screenshotCoverageComplete': True,
                            'resultSurface': 'results_list' if status == 'captured' else 'place_details'},
                'listings': [listing] if status == 'captured' else [], 'screenshots': [png], 'observedCount': 1 if status == 'captured' else 0}
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(v.CSV_COLUMNS)
        if body['listings']:
            writer.writerow(['run', 'attempt', qid, keyword, body['finishedAt'], 'profile', 1, 'organic', 1, 'Store', '', '', '', 'Bakery', '', 'ChIJtest', '', 'shot.png', 'unverified'])
        csv_art = {**put(prefix + filename[:-5] + '.csv', output.getvalue().encode()), 'id': 'csv', 'filename': filename[:-5] + '.csv', 'kind': 'result_csv', 'queryId': qid, 'queryAttemptId': 'qa01'}
        json_art = {**put(prefix + filename, body), 'id': 'json', 'filename': filename, 'kind': 'result_json', 'queryId': qid, 'queryAttemptId': 'qa01'}
        artifacts.extend([png, csv_art, json_art])
        attempt = {'queryAttemptId': 'qa01', 'resultFile': filename, 'status': status, 'stopReason': body['stopReason']}
        rows.append({'queryId': qid, 'inputIndex': i, 'keyword': keyword, 'status': status, 'stopReason': body['stopReason'], 'selectedQueryAttemptId': 'qa01',
                     'resultFile': filename, 'attempts': [attempt], 'persistenceStatus': 'verified'})
        own.append({'queryId': qid, 'keyword': keyword, 'summary': v.own_summary('ChIJtest', body['listings']), 'geographicRelevance': geo})
    counts = dict(collections.Counter(statuses))
    batch_status = 'completed' if set(statuses) == {'captured'} else 'partial'
    manifest = {'runId': 'run', 'attemptId': 'attempt', 'finishedAt': '2026-09-18T00:00:00Z', 'status': batch_status,
                'metadata': {'imageDigest': DIGEST, 'sourceCommit': SOURCE}, 'queries': rows, 'artifacts': artifacts}
    batch = {'batchId': 'b01', 'keywords': [k['keyword'] for k in keywords], 'runId': 'run', 'attemptId': 'attempt',
             'prefix': prefix.split('/run/')[0], 'status': batch_status, 'manifestReceipt': put(prefix + 'manifest.json', manifest), 'counts': counts, 'ownStore': own}
    daily = {'dailyRunId': 'daily', 'runKey': 'manual', 'date': '2026-09-18', 'startedAt': 'start', 'finishedAt': 'finish', 'status': batch_status,
             'stopReason': None, 'deliveryMode': 'azure_blob', 'stores': [{**store, 'status': batch_status,
             'snapshotReceipt': None if omit_snapshot else put('2026-09-18/store/daily/keyword-selection.json', snapshot),
             'selectionHash': snapshot['selectionHash'], 'selectedCount': len(statuses), 'batches': [batch]}],
             'counts': {'stores': 1, 'batches': 1, 'selected': len(statuses), **{s: counts.get(s, 0) for s in v.STATES}, 'sourceFailed': 0, 'empty': 0}}
    return {'dailyRunId': 'daily', 'runKey': 'manual', 'counts': daily['counts'], 'status': batch_status,
            'exitCode': 0 if batch_status == 'completed' else 2, 'manifestReceipt': put('2026-09-18/daily/daily/manifest.json', daily)}
