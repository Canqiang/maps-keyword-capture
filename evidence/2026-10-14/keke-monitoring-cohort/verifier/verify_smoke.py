#!/usr/bin/env python3
"""Independent standalone collector smoke acceptance; no cluster/storage mutations."""
import argparse
import collections
import concurrent.futures
import json
import pathlib
import re
import urllib.parse
import zoneinfo

import verification_helpers as h

ADAPTER = 'maps-feed-card/v6'
REQUIRED_NR = {'diagnostic', 'result_json', 'result_csv', 'observations_jsonl'}


CONFIG_DEFAULTS = {
    'maxResultsPerKeyword': 15, 'maxScrollsPerKeyword': 6, 'maxScreenshotsPerKeyword': 5,
    'keywordTimeoutMs': 90000, 'locale': 'en-US', 'browserTimezoneId': 'America/New_York',
    'filenameTimezone': 'Asia/Shanghai', 'viewport': {'width': 1440, 'height': 1000},
    'outputDirectory': './outputs',
}
DETAIL_SIGNALS = {'visible_heading', 'directions', 'address', 'save', 'send_to_phone',
                  'share', 'website', 'phone', 'named_pane', 'named_actions'}


def normalized_config(raw, keywords):
    h.require(isinstance(raw, dict) and set(raw) <= set(CONFIG_DEFAULTS) | {'schemaVersion', 'keywords'},
              'Expected capture config contains unsupported fields or geographic override')
    h.require(raw.get('schemaVersion') == '1' and raw.get('keywords') == keywords,
              'Expected config keyword sequence or schema differs')
    config = {**CONFIG_DEFAULTS, **raw}
    bounds = {'maxResultsPerKeyword': (1, 60), 'maxScrollsPerKeyword': (0, 50),
              'maxScreenshotsPerKeyword': (1, 30), 'keywordTimeoutMs': (5000, 600000)}
    h.require(all(type(config[k]) is int and low <= config[k] <= high for k, (low, high) in bounds.items()),
              'Expected capture limits invalid')
    h.require(1 <= len(keywords) <= 20, 'Expected keyword count outside runtime limits')
    h.require(isinstance(config['viewport'], dict) and set(config['viewport']) == {'width', 'height'}
              and all(type(config['viewport'][k]) is int and low <= config['viewport'][k] <= high
                      for k, low, high in [('width', 800, 3840), ('height', 600, 2160)]), 'Expected viewport invalid')
    h.require(all(isinstance(config[k], str) and config[k] for k in
                  ('locale', 'browserTimezoneId', 'filenameTimezone', 'outputDirectory')), 'Expected profile strings invalid')
    h.require(len(config['locale']) >= 2, 'Expected locale invalid')
    for key in ('browserTimezoneId', 'filenameTimezone'):
        try:
            zoneinfo.ZoneInfo(config[key])
        except (ValueError, zoneinfo.ZoneInfoNotFoundError):
            raise ValueError('Expected timezone invalid: ' + key) from None
    return config


def profile_hash(config, adapter):
    return h.digest(h.json_bytes({'surface': 'google-maps-desktop', 'locale': config['locale'],
        'browserTimezoneId': config['browserTimezoneId'], 'viewport': config['viewport'],
        'deviceScaleFactor': 1, 'locationMode': 'query_only', 'adapterVersion': adapter}))


def validate_place_details(body):
    details = body['quality'].get('placeDetails')
    if details is None:
        return None
    # A late feed-to-details transition may retain a real, incomplete ranked prefix.
    # Only a detail-only non_ranking_result can count as a completed observation.
    h.require(body['status'] in ('partial', 'failed') and body['quality'].get('resultSurface') == 'place_details',
              'Place details must describe an incomplete place-details surface')
    if body['stopReason'] == 'non_ranking_result':
        h.require(body['status'] == 'partial' and not body['listings'] and body['observedCount'] == 0,
                  'Non-ranking place details must have zero listings')
    h.require(isinstance(details, dict) and set(details) == {'name', 'mapsUrl', 'recognition', 'signals'},
              'Place details fields invalid')
    h.require(isinstance(details['name'], str) and details['name'].strip() and details['name'] == details['name'].strip(),
              'Place details name invalid')
    h.require(isinstance(details['mapsUrl'], str), 'Place details URL invalid')
    url = urllib.parse.urlsplit(details['mapsUrl'])
    h.require(url.scheme == 'https' and url.hostname in ('google.com', 'www.google.com', 'maps.google.com')
              and url.port in (None, 443) and not url.username and not url.password
              and re.match(r'^/maps/place/[^/]+', url.path), 'Place details URL is not a trusted Google place')
    h.require(details['mapsUrl'] == body.get('finalUrl'), 'Place details URL differs from the observed final URL')
    signals = details['signals']
    h.require(isinstance(signals, list) and all(isinstance(x, str) and x in DETAIL_SIGNALS for x in signals)
              and len(set(signals)) == len(signals) and 'visible_heading' in signals, 'Place details signals invalid')
    h.require(details['recognition'] in ('standard_actions', 'limited_actions'), 'Place details recognition invalid')
    if details['recognition'] == 'limited_actions':
        h.require({'named_pane', 'named_actions', 'save', 'send_to_phone', 'share'}.issubset(signals) and bool({'website', 'phone'} & set(signals)),
                  'Limited place details lack independent action and contact signals')
        h.require(not ({'directions', 'address'} & set(signals)),
                  'Limited recognition conflicts with standard action signals')
    else:
        h.require(bool({'directions', 'address'} & set(signals)) and set(signals) <= {'visible_heading', 'directions', 'address'},
                  'Standard place details lack standard action signals or contain limited signals')
    return details


def read_summary(path):
    summaries = []
    for line in pathlib.Path(path).read_text().splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and value.get('summary') is True:
            summaries.append(value)
    h.require(len(summaries) == 1, 'Expected exactly one final collector summary')
    return summaries[0]


def observations_and_coverage(body, owned, reader):
    observation_artifacts = [a for a in owned if a['kind'] == 'observations_jsonl']
    h.require(observation_artifacts, 'Missing observations artifact')
    h.require(set(body['observationArtifactIds']) == {a['id'] for a in observation_artifacts},
              'Result observation artifact references differ')
    observations = {}
    for artifact in observation_artifacts:
        for line in (reader.out / artifact['objectKey']).read_text().splitlines():
            obs = json.loads(line)
            h.require(all(obs[k] == body[k] for k in ('runId', 'attemptId', 'queryId', 'queryAttemptId')),
                      'Observation query ownership mismatch')
            h.require(obs['observationId'] not in observations, 'Duplicate observation ID')
            observations[obs['observationId']] = obs
    screenshots = {s['id']: s for s in body['screenshots']}
    listings = body['listings']
    occurrence_ids = [l['occurrenceId'] for l in listings]
    h.require(all(occurrence_ids) and len(set(occurrence_ids)) == len(occurrence_ids),
              'Missing or duplicate listing occurrence IDs')
    coverage = []
    for listing in listings:
        matched = []
        for sid in listing['screenshotIds']:
            shot = screenshots[sid]
            obs = observations.get(shot['observationId'])
            if obs and obs.get('accepted') is True and sid in obs.get('screenshotIds', []) and any(
                    c.get('occurrenceId') == listing['occurrenceId'] and c.get('fullyVisible') is True
                    for c in obs['cards']):
                matched.append(sid)
        if body['status'] == 'captured':
            h.require(matched, 'Captured listing has no fully visible accepted screenshot observation: ' + listing['occurrenceId'])
        coverage.append({'occurrenceId': listing['occurrenceId'], 'displayPosition': listing['displayPosition'],
                         'name': listing['name'], 'verifiedScreenshotIds': matched})
    return {'observations': len(observations), 'listingCoverage': coverage,
            'allListingsCovered': all(c['verifiedScreenshotIds'] for c in coverage)}


def verify(summary, reader, digest, source_commit, keywords, adapter=ADAPTER, workers=6, expected_config=None, require_limited_case=True):
    h.require(adapter == ADAPTER, 'This smoke verifier only accepts maps-feed-card/v6')
    h.require(re.fullmatch(r'sha256:[0-9a-f]{64}', digest or '') and re.fullmatch(r'[0-9a-f]{40}', source_commit or ''),
              'Exact image digest and full source commit required')
    h.require(type(workers) is int and 1 <= workers <= 8, 'Workers must be between one and eight')
    h.require(isinstance(keywords, list) and keywords and all(isinstance(k, str) and k.strip() for k in keywords),
              'Expected keywords must be a nonempty JSON string array')
    config = normalized_config(expected_config, keywords)
    expected_profile = profile_hash(config, adapter)
    h.require(summary.get('remotePersistence') == 'verified', 'Collector remote persistence is not verified')
    receipt = summary.get('manifestReceipt')
    h.require(receipt, 'Final collector manifest receipt missing')
    manifest = reader.json(receipt, 'batch_manifest')
    for field in ('runId', 'attemptId', 'status', 'executionStatus'):
        h.require(summary[field] == manifest[field], 'Summary/manifest mismatch: ' + field)
    h.require(manifest['finishedAt'] and manifest['status'] != 'running', 'Collector manifest is not final')
    h.require(manifest['persistenceMode'] == 'azure_blob', 'Collector is not using Azure persistence')
    for field, expected in [('imageDigest', digest), ('sourceCommit', source_commit), ('adapterVersion', adapter)]:
        h.require(manifest['metadata'][field] == expected, 'Unexpected manifest ' + field)
    h.require(receipt['objectKey'].endswith('/' + manifest['runId'] + '/' + manifest['attemptId'] + '/manifest.json'),
              'Manifest namespace differs from run/attempt')
    h.require(manifest['metadata'].get('configHash') == h.digest(h.json_bytes(config))
              and manifest['metadata'].get('profileHash') == expected_profile, 'Manifest capture config/profile differs')
    rows = manifest['queries']
    h.require([q['keyword'] for q in rows] == keywords, 'Expected keyword sequence differs')
    h.require([q['inputIndex'] for q in rows] == list(range(len(rows))) and
              len({q['queryId'] for q in rows}) == len(rows), 'Missing or duplicate input query identity')
    counts = collections.Counter(q['status'] for q in rows)
    expected_status = ('completed' if all(q['status'] == 'captured' for q in rows) else
                       'partial' if any(q['status'] in ('captured', 'partial', 'blocked') for q in rows) else 'failed')
    h.require(manifest['status'] == expected_status, 'Manifest status disagrees with query evidence')
    declared = summary['counts'].copy()
    declared_nr = declared.pop('nonRanking')
    h.require(type(declared_nr) is int and declared_nr >= 0 and h.counter(declared) == counts,
              'Summary query counts differ')
    prefix = receipt['objectKey'].rsplit('/', 1)[0] + '/'
    by_key, by_identity = {}, {}
    known_attempts = {(q['queryId'], a['queryAttemptId']): a for q in rows for a in q['attempts']}
    for artifact in manifest['artifacts']:
        key = h.safe_key(artifact['objectKey'])
        identity = (artifact['queryId'], artifact['queryAttemptId'], artifact['id'])
        h.require(key.startswith(prefix) and key not in by_key and identity not in by_identity,
                  'Duplicate or out-of-prefix artifact')
        owner = (artifact['queryId'], artifact['queryAttemptId'])
        if owner == (None, None):
            h.require(artifact['kind'] == 'request_json', 'Unexpected shared artifact kind')
        else:
            h.require(owner in known_attempts, 'Artifact owner does not reference an existing query attempt')
            h.require(artifact['kind'] in {'results', 'diagnostic', 'result_json', 'result_csv', 'observations_jsonl'},
                      'Unexpected query artifact kind')
            if artifact['kind'] in ('results', 'diagnostic'):
                h.require(key.endswith('.png'), 'Screenshot artifact is not PNG')
            if artifact['kind'] in ('result_json', 'result_csv'):
                result_key = prefix + known_attempts[owner]['resultFile']
                expected_key = result_key if artifact['kind'] == 'result_json' else result_key[:-5] + '.csv'
                h.require(key == expected_key, 'Extra or mismatched result JSON/CSV for query attempt')
        by_key[key] = artifact
        by_identity[identity] = artifact
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(reader.read, a, 'artifact') for a in manifest['artifacts']]
        for future in concurrent.futures.as_completed(futures):
            future.result()
    requests = [a for a in manifest['artifacts'] if a['kind'] == 'request_json']
    h.require(len(requests) == 1 and requests[0]['objectKey'] == prefix + 'request.json'
              and requests[0]['queryId'] is None and requests[0]['queryAttemptId'] is None, 'Missing or unexpected request artifact')
    request = json.loads((reader.out / requests[0]['objectKey']).read_text())
    h.require(request.get('runId') == manifest['runId'] and request.get('attemptId') == manifest['attemptId']
              and request.get('startedAt') == manifest.get('startedAt') and request.get('config') == config,
              'Persisted request config or run identity differs')
    results, issues, samples = [], [], []
    csv_rows, observations, attempts = 0, 0, 0
    complete_nr = 0
    limited_details_observed = 0
    for row in rows:
        result_summary = {k: row[k] for k in ('queryId', 'keyword', 'status', 'stopReason')}
        if row['status'] not in ('captured', 'partial', 'blocked', 'failed'):
            issues.append({**result_summary, 'issue': 'query_not_collected'})
            results.append(result_summary)
            continue
        h.require(row['persistenceStatus'] == 'verified' and row['attempts'], 'Attempted query has unverified persistence')
        selected = [a for a in row['attempts'] if a['queryAttemptId'] == row['selectedQueryAttemptId']]
        h.require(len(selected) == 1 and all(row[k] == selected[0][k] for k in ('status', 'stopReason', 'resultFile', 'error')),
                  'Selected attempt differs from query row')
        chosen = next((a for a in row['attempts'] if a['status'] == 'captured'), None)
        chosen = chosen or next((a for a in row['attempts'] if a['status'] in ('partial', 'blocked')), row['attempts'][0])
        h.require(selected[0] == chosen, 'Selected attempt violates runtime selection policy')
        h.require(row['artifactIds'] == [aid for a in row['attempts'] for aid in a['artifactIds']],
                  'Query artifact references differ from all attempts')
        h.require(len({a['queryAttemptId'] for a in row['attempts']}) == len(row['attempts']), 'Duplicate query attempt ID')
        for attempt in row['attempts']:
            owned = [a for a in manifest['artifacts'] if a['queryId'] == row['queryId'] and a['queryAttemptId'] == attempt['queryAttemptId']]
            h.require(len(attempt['artifactIds']) == len(set(attempt['artifactIds']))
                      and set(attempt['artifactIds']) == {a['id'] for a in owned}, 'Attempt artifact references differ')
            key = prefix + attempt['resultFile']
            h.require(key in by_key and by_key[key]['kind'] == 'result_json' and
                      by_key[key]['queryId'] == row['queryId'] and by_key[key]['queryAttemptId'] == attempt['queryAttemptId'],
                      'Missing or wrongly owned result JSON')
            body = json.loads((reader.out / key).read_text())
            for field, expected in [('imageDigest', digest), ('sourceCommit', source_commit), ('adapterVersion', adapter)]:
                h.require(body['metadata'][field] == expected, 'Unexpected result ' + field)
            h.require(body['metadata'].get('configHash') == manifest['metadata']['configHash']
                      and body['metadata'].get('profileHash') == expected_profile, 'Result capture config/profile differs')
            h.require(body.get('requestedLimit') == config['maxResultsPerKeyword'] and all(
                body['context'].get(k) == config[k] for k in ('locale', 'browserTimezoneId', 'viewport'))
                and body['context'].get('deviceScaleFactor') == 1, 'Result browser profile or requested limit differs')
            details = validate_place_details(body)
            h.require(body.get('error') == attempt.get('error'), 'Result/attempt errors differ')
            h.require(body['quality']['classificationComplete'] ==
                      all(l['resultType'] != 'unknown' for l in body['listings']),
                      'Classification completeness flag disagrees with actual listings')
            if body['status'] == 'captured':
                h.require(body.get('error') is None and attempt.get('error') is None,
                          'Captured query contains an error')
            checks = h.validate_result(body, row, attempt, manifest, {'placeId': 'unconfigured'}, by_key, prefix, reader)
            h.require({s['objectKey'] for s in body['screenshots']} ==
                      {a['objectKey'] for a in owned if a['kind'] in ('results', 'diagnostic')},
                      'Result screenshot references differ from attempt artifacts')
            coverage = observations_and_coverage(body, owned, reader)
            csv_rows += checks['csvRows']
            observations += coverage['observations']
            attempts += 1
            if attempt['queryAttemptId'] != row['selectedQueryAttemptId']:
                continue
            result_summary.update({'placeDetails': details, 'resultKey': key, 'listings': len(body['listings']), 'surface': checks['surface'],
                                   'geographicStatus': checks['geographicStatus'], 'pngKeys': checks['pngKeys'],
                                   'listingCoverage': coverage['listingCoverage'], 'allListingsCovered': coverage['allListingsCovered'],
                                   'classificationCounts': dict(collections.Counter(l['resultType'] for l in body['listings']))})
            if row['status'] == 'partial' and row['stopReason'] == 'non_ranking_result':
                h.require(row.get('error') is None and attempt.get('error') is None and body.get('error') is None,
                          'Non-ranking query contains an error')
                h.require(REQUIRED_NR.issubset({a['kind'] for a in owned}), 'Non-ranking query lacks complete diagnostic/JSON/CSV/observations evidence')
                h.require(any(s['kind'] == 'diagnostic' and s['bytes'] > 0 for s in body['screenshots']),
                          'Non-ranking query lacks referenced diagnostic PNG')
                complete_nr += 1
                limited_details_observed += bool(details and details['recognition'] == 'limited_actions')
            elif row['status'] != 'captured':
                issues.append({**result_summary, 'issue': 'query_incomplete'})
            for png_key in checks['pngKeys']:
                # Every smoke screenshot remains available for targeted visual review.
                samples.append({'queryId': row['queryId'], 'keyword': row['keyword'], 'status': row['status'],
                                    'stopReason': row['stopReason'], 'key': png_key, 'jsonKey': key,
                                    'bytes': by_key[png_key]['bytes'], 'sha256': by_key[png_key]['sha256'],
                                    'path': str(reader.out / png_key), 'visualReview': 'pending'})
        results.append(result_summary)
    h.require(complete_nr == declared_nr, 'Summary nonRanking count differs from complete evidence')
    expected_execution = 'completed' if not issues else 'failed' if manifest['status'] == 'failed' else 'incomplete'
    if manifest['executionStatus'] != expected_execution:
        issues.append({'issue': 'execution_status_disagrees_with_underlying_evidence',
                       'declared': manifest['executionStatus'], 'recomputed': expected_execution})
    if require_limited_case and limited_details_observed < 1:
        issues.append({'issue': 'limited_actions_live_case_not_observed', 'note': 'No selected attempt reproduced the target limited detail case; release acceptance remains unproven.'})
    png_count = sum(r['png'] is not None for r in reader.records.values())
    report = {'verificationIdentity': reader.identity, 'evidenceIntegrityPassed': True,
              'runId': manifest['runId'], 'attemptId': manifest['attemptId'], 'status': manifest['status'],
              'executionStatus': manifest['executionStatus'], 'recomputedExecutionStatus': expected_execution,
              'counts': {**dict(counts), 'nonRanking': complete_nr}, 'expectedKeywords': keywords,
              'limitedActionsDetailsObserved': limited_details_observed, 'limitedCaseRequired': require_limited_case, 'expectedConfig': config, 'expectedProfileHash': expected_profile,
              'imageDigest': digest, 'sourceCommit': source_commit, 'adapterVersion': adapter,
              'finalReceipt': receipt, 'verifiedObjects': len(reader.records),
              'verifiedArtifacts': len(manifest['artifacts']), 'verifiedBytes': sum(r['expected']['bytes'] for r in reader.records.values()),
              'pngsStructurallyChecked': png_count, 'csvRowsComparedAllAttempts': csv_rows,
              'observationRecordsChecked': observations, 'resultAttemptsCompared': attempts,
              'cacheReused': sum(r['cacheReused'] for r in reader.records.values()),
              'smokeAccepted': not issues and manifest['executionStatus'] == 'completed',
              'verifierExitCode': 0 if not issues and manifest['executionStatus'] == 'completed' else 2,
              'podExitCode': None, 'podExitCodeNote': 'Not present in collector summary; compare separately with archived Kubernetes termination state.',
              'issues': issues, 'results': results,
              'scope': {'allManifestArtifactsVerified': True, 'allAttemptJsonCsvCompared': True,
                        'allPngStructurallyChecked': True, 'visualReview': 'pending; see visual-review-plan.json',
                        'visualSampleCount': len(samples)},
              'limitations': ['Small standalone collector smoke only; not a full daily-monitor or midnight-schedule acceptance.',
                              'Complete non-ranking observations keep status partial and have no merchant ranking.',
                              'No expectedArea is configured: all geographic statuses must remain unverified.',
                              'The limited-actions regression is accepted only when at least one selected detail has its required recognition signals; visual review remains separate.',
                              'PNG structural integrity and observation coverage do not replace visual interpretation.']}
    h.write_json(reader.out / 'readback-report.json', report)
    h.write_json(reader.out / 'object-inventory.json', sorted(reader.records.values(), key=lambda r: r['objectKey']))
    h.write_json(reader.out / 'visual-review-plan.json', samples)
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--log', required=True)
    p.add_argument('--out', required=True)
    p.add_argument('--digest', required=True)
    p.add_argument('--source-commit', required=True)
    p.add_argument('--expected-config', required=True, help='Exact capture config JSON, raw or normalized')
    p.add_argument('--expected-keywords', required=True, help='JSON array file, in exact submitted order')
    p.add_argument('--adapter-version', default=ADAPTER)
    p.add_argument('--workers', type=int, default=6)
    p.add_argument('--offline-root')
    p.add_argument('--cohort-smoke', action='store_true', help='Validate collection evidence without requiring the historical see-joy limited-details regression')
    args = p.parse_args()
    h.require(re.fullmatch(r'sha256:[0-9a-f]{64}', args.digest), 'Invalid image digest')
    h.require(1 <= args.workers <= 8, 'Workers must be between one and eight')
    report = verify(read_summary(args.log), h.Reader(args.out, args.offline_root), args.digest,
                    args.source_commit, json.loads(pathlib.Path(args.expected_keywords).read_text()), args.adapter_version, args.workers, json.loads(pathlib.Path(args.expected_config).read_text()), require_limited_case=not args.cohort_smoke)
    print(json.dumps({k: report[k] for k in ('runId', 'status', 'executionStatus', 'counts', 'verifiedObjects',
        'verifiedBytes', 'pngsStructurallyChecked', 'csvRowsComparedAllAttempts', 'smokeAccepted', 'verifierExitCode')}, indent=2))
    return report['verifierExitCode']


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, KeyError, OSError, TypeError) as error:
        print(json.dumps({'evidenceIntegrityPassed': False, 'error': str(error)}))
        raise SystemExit(1)
