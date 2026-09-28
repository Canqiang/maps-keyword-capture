#!/usr/bin/env python3
"""Read-only full UAT acceptance: Azure-login readback, counts, evidence and semantics.

No Google queries, cluster actions, SAS credentials or storage mutations occur here.
Exit 0: complete collection or only recognized non-ranking detail pages; 2: partial
collection / operational failures; 1: missing, corrupt or inconsistent evidence.
The report distinguishes evidence integrity, run coverage and ranking completeness.
"""
import argparse
import collections
import concurrent.futures
import csv
import hashlib
import io
import json
import pathlib
import re
import ssl
import struct
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib

ROOT = 'https://fbrdevstorage.blob.core.windows.net/maps-keyword-capture-uat/'
ADAPTER = 'maps-feed-card/v5'
REQUIRED_NR = {'diagnostic', 'result_json', 'result_csv', 'observations_jsonl'}
STATES = ('captured', 'partial', 'blocked', 'failed', 'skipped')
CSV_COLUMNS = 'run_id attempt_id query_id keyword captured_at profile_hash display_position result_type organic_rank name address rating review_count category maps_url place_id ad_label screenshot_files geographic_status'.split()
POLICY = 'P0-P3 then unknown priority; stable source order within each priority; exact query text deduplication; no score or surface filter'
REGISTRY_POLICY = 'Canonical keyword-library identities with nonempty keyword arrays; opaque safe place IDs excluding UUID/hex legacy IDs; no Google identity or geographic verification; exact place+merchant aliases; live names; stable place-derived IDs; no enabled flag; configured exact-place exclusions precede identity checks; nil merchant UUIDs are excluded; all duplicate/conflicting or alias-mismatched place records are quarantined while other eligible stores continue; invalid configuration and capacity overflow fail closed. Source hash covers normalized identities, exclusions and quarantine groups only.'
REGISTRY_EXCLUSIONS = {'missing_source_id', 'invalid_merchant_id', 'invalid_place_id', 'missing_name', 'invalid_keywords', 'empty_keywords'}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def json_bytes(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def safe_key(value):
    require(isinstance(value, str) and value and not value.startswith('/') and
            not any(c in value for c in '?#{\\\x00') and
            all(part not in ('', '.', '..') for part in value.split('/')),
            'Unsafe object key')
    return value


def png_check(data):
    require(data.startswith(b'\x89PNG\r\n\x1a\n'), 'Invalid PNG signature')
    at, width, height, ended = 8, 0, 0, False
    idat = []
    chunks = 0
    while at < len(data):
        require(at + 12 <= len(data), 'Truncated PNG chunk')
        length = struct.unpack('>I', data[at:at + 4])[0]
        kind = data[at + 4:at + 8]
        require(at + length + 12 <= len(data), 'Truncated PNG payload')
        payload = data[at + 8:at + 8 + length]
        crc = struct.unpack('>I', data[at + 8 + length:at + 12 + length])[0]
        require(zlib.crc32(kind + payload) & 0xffffffff == crc, 'PNG CRC mismatch')
        if kind == b'IHDR':
            require(chunks == 0 and length == 13, 'Invalid PNG IHDR')
            width, height = struct.unpack('>II', payload[:8])
            require(width * height < 100_000_000, 'PNG dimensions exceed verifier bound')
        if kind == b'IDAT':
            idat.append(payload)
        at += length + 12
        chunks += 1
        if kind == b'IEND':
            require(length == 0, 'Invalid PNG IEND')
            ended = True
            break
    require(width > 0 and height > 0 and ended and at == len(data), 'Incomplete PNG')
    decompressor = zlib.decompressobj()
    decoded = decompressor.decompress(b''.join(idat), 100_000_001)
    require(decoded and len(decoded) <= 100_000_000 and decompressor.eof and not decompressor.unused_data,
            'Invalid or oversized PNG pixel stream')
    return {'width': width, 'height': height}


class Reader:
    """Bounded, resumable readback. Cache trust requires a matching prior provenance ledger."""
    def __init__(self, out, offline_root=None):
        self.out = pathlib.Path(out)
        self.out.mkdir(parents=True, exist_ok=True)
        self.offline_root = pathlib.Path(offline_root) if offline_root else None
        self.identity = 'offline_replay' if offline_root else 'azure_cli_login'
        self.lock = threading.Lock()
        self.token_lock = threading.Lock()
        self.token = None
        self.token_at = 0
        self.records = {}
        self.cache_path = self.out / 'verification-cache.json'
        self.cache = json.loads(self.cache_path.read_text()) if self.cache_path.exists() else {}
        try:
            import certifi
            self.context = ssl.create_default_context(cafile=certifi.where())
        except ImportError:
            self.context = ssl.create_default_context()

    def access_token(self, force=False):
        with self.token_lock:
            if force or not self.token or time.monotonic() - self.token_at > 2400:
                result = subprocess.run(['az', 'account', 'get-access-token', '--resource',
                                         'https://storage.azure.com/', '--query', 'accessToken', '-o', 'tsv'],
                                        capture_output=True, text=True, timeout=60)
                require(result.returncode == 0 and result.stdout.strip(), 'Azure CLI login token unavailable')
                self.token = result.stdout.strip()
                self.token_at = time.monotonic()
            return self.token

    def fetch(self, key):
        safe_key(key)
        if self.offline_root:
            return (self.offline_root / key).read_bytes()
        for attempt in range(3):
            token = self.access_token()
            request = urllib.request.Request(ROOT + urllib.parse.quote(key, safe='/'),
                headers={'Authorization': 'Bearer ' + token, 'x-ms-version': '2023-11-03'})
            try:
                with urllib.request.urlopen(request, timeout=40, context=self.context) as response:
                    data = response.read(128_000_001)
                require(len(data) <= 128_000_000, 'Object exceeds verifier size bound: ' + key)
                return data
            except urllib.error.HTTPError as error:
                if error.code == 401 and attempt < 2:
                    self.access_token(force=True)
                elif error.code in (408, 429, 500, 502, 503, 504) and attempt < 2:
                    time.sleep(attempt + 1)
                else:
                    raise ValueError(f'Azure read HTTP {error.code}: {key}') from None
            except (urllib.error.URLError, TimeoutError):
                if attempt == 2:
                    raise ValueError('Azure read transport failure: ' + key) from None
                time.sleep(attempt + 1)

    def read(self, receipt, category, store_id=None):
        key = safe_key(receipt.get('objectKey'))
        require(receipt.get('storageStatus') == 'verified' and type(receipt.get('bytes')) is int and
                receipt['bytes'] >= 0 and re.fullmatch('[a-f0-9]{64}', receipt.get('sha256', '')),
                'Missing or invalid verified receipt: ' + key)
        expected = {'bytes': receipt['bytes'], 'sha256': receipt['sha256']}
        with self.lock:
            previous = self.records.get(key)
        if previous:
            require(previous['expected'] == expected, 'Conflicting receipts: ' + key)
            return self.out / key
        destination = self.out / key
        prior = self.cache.get(key, {})
        cached = (destination.exists() and prior.get('identity') == self.identity and
                  prior.get('expected') == expected)
        data = destination.read_bytes() if cached else b''
        if cached and (len(data) != expected['bytes'] or digest(data) != expected['sha256']):
            cached = False
        if not cached:
            data = self.fetch(key)
        require(len(data) == expected['bytes'] and digest(data) == expected['sha256'],
                'Receipt mismatch: ' + key)
        png = png_check(data) if key.endswith('.png') else None
        if not cached:
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name(destination.name + '.download')
            temporary.write_bytes(data)
            temporary.replace(destination)
        record = {'objectKey': key, 'category': category, 'storeId': store_id, 'path': str(destination),
                  'expected': expected, 'verified': True, 'identity': self.identity,
                  'cacheReused': cached, 'png': png}
        with self.lock:
            self.records[key] = record
            self.cache[key] = {'expected': expected, 'identity': self.identity}
            write_json(self.cache_path, self.cache)
        return destination

    def json(self, receipt, category, store_id=None):
        return json.loads(self.read(receipt, category, store_id).read_text())


def csv_value(value):
    if value is None:
        return ''
    if isinstance(value, str) and re.match(r'^[=+\-@\t\r]', value):
        return "'" + value
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def counter(value):
    require(isinstance(value, dict) and all(k in STATES and type(v) is int and v >= 0 for k, v in value.items()),
            'Invalid query counts')
    return collections.Counter(value)


def selected_keywords(snapshot, maximum):
    source = snapshot['source']['keywords']
    require(isinstance(source, list), 'Missing source keyword list')
    require([k['sourceIndex'] for k in source] == list(range(len(source))), 'Source order indexes are incomplete')
    ordered = sorted(source, key=lambda k: ({'P0': 0, 'P1': 1, 'P2': 2, 'P3': 3}.get(k['priority'], 4), k['sourceIndex']))
    seen, unique = set(), []
    for row in ordered:
        require(isinstance(row['keyword'], str) and row['keyword'].strip(), 'Blank source keyword')
        if row['keyword'] not in seen:
            seen.add(row['keyword'])
            unique.append(row)
    require(snapshot['selectionPolicy'] == POLICY and snapshot['keywords'] == unique[:maximum],
            'Selection differs from source top keywords')
    require(snapshot['availableCount'] == len(unique) and snapshot['duplicateCount'] == len(source) - len(unique),
            'Source selection denominator mismatch')
    expected_hash = digest(json_bytes({'sourceResponseHash': snapshot['source']['sourceResponseHash'],
                                      'policy': POLICY, 'keywords': snapshot['keywords']}))
    require(snapshot['selectionHash'] == expected_hash, 'Selection hash mismatch')
    return [k['keyword'] for k in snapshot['keywords']]


def canonical_id(listing):
    value = listing.get('placeId')
    if value and re.fullmatch(r'ChIJ[\w-]+', value):
        return value
    url = listing.get('mapsUrl') or ''
    match = re.search(r'!19s(ChIJ[\w-]+)', url)
    if match:
        return match[1]
    value = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).get('query_place_id', [None])[0]
    return value if value and re.fullmatch(r'ChIJ[\w-]+', value) else None


def own_summary(place_id, listings):
    matched = [l for l in listings if canonical_id(l) == place_id]
    resolved = bool(listings) and all(canonical_id(l) is not None for l in listings)
    return {'status': 'observed' if matched else 'not_observed' if resolved else 'identity_unresolved',
            'displayPositions': [l['displayPosition'] for l in matched],
            'organicRanks': [l['organicRank'] for l in matched if l['organicRank'] is not None],
            'adDisplayPositions': [l['displayPosition'] for l in matched if l['resultType'] == 'ad'],
            'observedScope': len(listings)}


def validate_result(body, row, attempt, batch, store, by_key, prefix, reader):
    for field in ('queryId', 'keyword'):
        require(body[field] == row[field], 'Result/query identity mismatch: ' + field)
    for field in ('queryAttemptId', 'status', 'stopReason'):
        require(body[field] == attempt[field], 'Result/attempt mismatch: ' + field)
    require(body['runId'] == batch['runId'] and body['attemptId'] == batch['attemptId'], 'Result/batch identity mismatch')
    context = body['context']
    require(context['locationMode'] == 'query_only' and context['configuredMapView'] is None and
            context['geolocationPermission'] == 'not_granted' and context['loggedIn'] is False,
            'Unexpected browser location/account configuration')
    listings = body['listings']
    screenshots = {s['id']: s for s in body['screenshots']}
    require(len(screenshots) == len(body['screenshots']), 'Duplicate screenshot IDs')
    if body['status'] == 'captured':
        require(screenshots, 'Captured result lacks screenshot evidence')
    require(body['observedCount'] == len(listings), 'Result observed count mismatch')
    geo = body['quality'].get('geographicRelevance')
    require(geo and geo['status'] in ('unverified', 'matched', 'outside', 'mixed'), 'Missing geographic assessment')
    require(geo['expectedArea'] == store.get('expectedArea'), 'Geographic reference differs from store')
    if not store.get('expectedArea'):
        require(geo['status'] == 'unverified' and geo['reason'] == 'expected_area_not_configured', 'Unconfigured geography falsely verified')
    for screenshot in screenshots.values():
        key = screenshot['objectKey']
        require(key in by_key and by_key[key]['id'] == screenshot['id'], 'Missing screenshot artifact')
        require(by_key[key]['queryId'] == body['queryId'] and
                by_key[key]['queryAttemptId'] == body['queryAttemptId'] and
                screenshot['queryId'] == body['queryId'] and
                screenshot['queryAttemptId'] == body['queryAttemptId'] and
                by_key[key]['kind'] == screenshot['kind'] and screenshot['kind'] in ('results', 'diagnostic'),
                'Screenshot artifact ownership or kind mismatch')
        record = reader.records[key]
        require(record['png'] == {'width': screenshot['width'], 'height': screenshot['height']}, 'PNG dimensions disagree')
        require(screenshot['bytes'] == by_key[key]['bytes'] and screenshot['sha256'] == by_key[key]['sha256'], 'Screenshot receipt differs from batch')
    organic, uncertain = 0, False
    for position, listing in enumerate(listings, 1):
        require(listing['displayPosition'] == position, 'Non-contiguous displayed positions')
        if listing['resultType'] == 'ad':
            require(listing['adLabel'] and listing['organicRank'] is None, 'Ad without label or with organic rank')
        elif listing['resultType'] == 'unknown':
            uncertain = True
            require(listing['organicRank'] is None, 'Unknown card has organic rank')
        elif listing['resultType'] == 'organic':
            organic += 1
            require(listing['organicRank'] == (None if uncertain else organic), 'Incorrect organic rank')
        else:
            raise ValueError('Invalid classification')
        require(listing['category'] != 'No reviews', 'No reviews misclassified as category')
        require(all(s in screenshots for s in listing['screenshotIds']), 'Broken listing screenshot reference')
    csv_key = prefix + attempt['resultFile'][:-5] + '.csv'
    require(csv_key in by_key, 'Result CSV missing from batch manifest')
    require(by_key[csv_key]['kind'] == 'result_csv' and by_key[csv_key]['queryId'] == body['queryId'] and
            by_key[csv_key]['queryAttemptId'] == body['queryAttemptId'], 'CSV artifact ownership mismatch')
    table_reader = csv.DictReader(io.StringIO((reader.out / csv_key).read_text(encoding='utf-8-sig')))
    require(table_reader.fieldnames == CSV_COLUMNS, 'CSV schema differs')
    table = list(table_reader)
    require(len(table) == len(listings), 'CSV/JSON row count mismatch')
    mapping = {'display_position': 'displayPosition', 'result_type': 'resultType', 'organic_rank': 'organicRank',
               'name': 'name', 'address': 'address', 'rating': 'rating', 'review_count': 'reviewCount',
               'category': 'category', 'maps_url': 'mapsUrl', 'place_id': 'placeId', 'ad_label': 'adLabel'}
    shared = {'run_id': body['runId'], 'attempt_id': body['attemptId'], 'query_id': body['queryId'],
              'keyword': body['keyword'], 'captured_at': body['finishedAt'], 'profile_hash': body['metadata']['profileHash'],
              'geographic_status': geo['status']}
    for record, listing in zip(table, listings):
        expected = {**shared, **{col: listing[field] for col, field in mapping.items()},
                    'screenshot_files': ';'.join(screenshots[s]['filename'] for s in listing['screenshotIds'])}
        require(record == {k: csv_value(v) for k, v in expected.items()}, 'CSV/JSON semantic mismatch')
    if body['status'] == 'captured':
        require(body['stopReason'] in ('limit_reached', 'end_of_results') and body['sequenceVerified'] and
                body['quality']['classificationComplete'] and body['quality']['screenshotCoverageComplete'],
                'Incomplete evidence marked captured')
        require(all(l['screenshotIds'] for l in listings), 'Captured listing lacks screenshots')
    if body['stopReason'] == 'non_ranking_result':
        require(body['status'] == 'partial' and body['quality']['resultSurface'] == 'place_details' and
                not listings,
                'Invalid non-ranking detail evidence')
    return {'csvRows': len(table), 'pngKeys': [s['objectKey'] for s in screenshots.values()],
            'geographicStatus': geo['status'], 'surface': body['quality'].get('resultSurface'),
            'ownStore': own_summary(store['placeId'], listings), 'geographicRelevance': geo}


def observations_and_coverage(body, owned, reader):
    observation_artifacts = [a for a in owned if a['kind'] == 'observations_jsonl']
    if body['status'] == 'captured':
        require(observation_artifacts, 'Captured query lacks observations artifact')
    require(set(body['observationArtifactIds']) == {a['id'] for a in observation_artifacts},
              'Result observation artifact references differ')
    observations = {}
    for artifact in observation_artifacts:
        for line in (reader.out / artifact['objectKey']).read_text().splitlines():
            obs = json.loads(line)
            require(all(obs[k] == body[k] for k in ('runId', 'attemptId', 'queryId', 'queryAttemptId')),
                      'Observation query ownership mismatch')
            require(obs['observationId'] not in observations, 'Duplicate observation ID')
            observations[obs['observationId']] = obs
    screenshots = {s['id']: s for s in body['screenshots']}
    listings = body['listings']
    occurrence_ids = [l['occurrenceId'] for l in listings]
    require(all(occurrence_ids) and len(set(occurrence_ids)) == len(occurrence_ids),
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
            require(matched, 'Captured listing has no fully visible accepted screenshot observation: ' + listing['occurrenceId'])
        coverage.append({'occurrenceId': listing['occurrenceId'], 'displayPosition': listing['displayPosition'],
                         'name': listing['name'], 'verifiedScreenshotIds': matched})
    return {'observations': len(observations), 'listingCoverage': coverage,
            'allListingsCovered': all(c['verifiedScreenshotIds'] for c in coverage)}


def validate_registry(daily, reader, expected_config):
    """Check the immutable live enrollment evidence independently of config aliases."""
    registry = daily.get('registry')
    discovery = (expected_config or {}).get('storeDiscovery')
    if not registry and not discovery:
        return None
    require(expected_config is not None, 'Registry verification requires exact expected config')
    require(isinstance(discovery, dict) and discovery.get('provider') == 'mongo', 'Registry discovery config missing or unsupported')
    require(isinstance(registry, dict) and registry.get('mode') == 'discovered' and registry.get('status') == 'ready'
            and registry.get('error') is None, 'Registry is missing or not ready for collection acceptance')
    receipt = registry.get('snapshotReceipt')
    require(isinstance(receipt, dict) and receipt.get('objectKey') == f"{daily['date']}/daily/{daily['dailyRunId']}/store-registry.json",
            'Registry snapshot escaped daily/run namespace')
    snapshot = reader.json(receipt, 'store_registry_snapshot')
    require(snapshot.get('schemaVersion') == '1' and all(snapshot.get(k) == daily[k] for k in ('dailyRunId', 'runKey', 'date')),
            'Registry run identity mismatch')
    require(snapshot.get('policy') == REGISTRY_POLICY, 'Registry policy differs from this release contract')
    require(isinstance(snapshot.get('fetchedAt'), str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z', snapshot['fetchedAt']),
            'Registry fetchedAt is not a UTC timestamp')
    require(isinstance(snapshot.get('sourceResponseHash'), str) and re.fullmatch(r'[0-9a-f]{64}', snapshot['sourceResponseHash']),
            'Registry normalized source hash malformed')
    rows, exclusions, counts = snapshot.get('stores'), snapshot.get('exclusions'), snapshot.get('counts')
    require(isinstance(rows, list) and isinstance(exclusions, list) and isinstance(counts, dict), 'Registry roster/counts structure invalid')
    require(set(counts) == {'fetched', 'eligible', 'excluded', 'quarantined'}
            and all(type(value) is int and value >= 0 for value in counts.values()),
            'Registry counts invalid')
    require(counts == registry.get('counts') and counts['eligible'] == len(rows) and counts['excluded'] == len(exclusions)
            and counts['fetched'] == counts['eligible'] + counts['excluded'], 'Registry counts do not reconcile')
    quarantines = snapshot.get('quarantines')
    require(isinstance(quarantines, list) and isinstance(registry.get('quarantines'), list) and quarantines == registry['quarantines'],
            'Registry quarantine groups differ between snapshot and daily')
    require(counts.get('quarantined', 0) <= counts['excluded'], 'Registry quarantined count exceeds excluded subset')
    require(not quarantines and counts.get('quarantined', 0) == 0,
            'Registry is not ready for release acceptance: unresolved quarantines')
    require(type(discovery.get('maxStores')) is int and type(discovery.get('maxRecords')) is int
            and 0 < len(rows) <= discovery['maxStores'] <= discovery['maxRecords'] and counts['fetched'] <= discovery['maxRecords'],
            'Registry capacity exceeded or invalid')
    safe_id = lambda value: isinstance(value, str) and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}', value)
    configured_exclusions = discovery.get('excludedPlaces', [])
    require(isinstance(configured_exclusions, list) and all(
        isinstance(item, dict) and set(item) == {'placeId', 'reason'}
        and safe_id(item['placeId']) and safe_id(item['reason']) for item in configured_exclusions),
        'Registry configured exclusion invalid')
    require(len({item['placeId'] for item in configured_exclusions}) == len(configured_exclusions),
            'Registry configured exclusion collision')
    excluded_places = {item['placeId'] for item in configured_exclusions}
    exclusion_reasons = REGISTRY_EXCLUSIONS | {'configured_' + item['reason'] for item in configured_exclusions}
    legacy_place = re.compile(r'(?:[a-f0-9]{24}|[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})', re.I)
    for row in rows:
        require(isinstance(row, dict) and all(safe_id(row.get(k)) for k in ('storeId', 'merchantId', 'placeId'))
                and row['merchantId'] != '00000000-0000-0000-0000-000000000000'
                and not legacy_place.fullmatch(row['placeId']) and isinstance(row.get('name'), str)
                and row['name'] == row['name'].strip() and bool(row['name']), 'Registry store identity invalid')
    require(not any(row['placeId'] in excluded_places for row in rows), 'Registry enrolled a configured excluded place')
    require(len({s['storeId'] for s in rows}) == len(rows) and len({s['placeId'] for s in rows}) == len(rows),
            'Registry has duplicate store or place identity')
    for exclusion in exclusions:
        require(isinstance(exclusion, dict) and exclusion.get('reason') in exclusion_reasons
                and (exclusion.get('sourceId') is None or safe_id(exclusion['sourceId'])), 'Registry exclusion invalid')
    require(len(rows) == len(daily['stores']) and all(
        all(row[k] == store[k] for k in ('storeId', 'merchantId', 'placeId', 'name'))
        and row.get('expectedArea') == store.get('expectedArea') for row, store in zip(rows, daily['stores'])),
        'Registry and daily store identity/order differ')
    aliases = expected_config.get('stores', [])
    require(len({s['placeId'] for s in aliases}) == len(aliases) and len({s['storeId'] for s in aliases}) == len(aliases),
            'Registry configured alias collision')
    by_place = {alias['placeId']: alias for alias in aliases}
    reserved_ids = {alias['storeId'] for alias in aliases}
    for row in rows:
        alias = by_place.get(row['placeId'])
        if alias:
            require(row['merchantId'] == alias['merchantId'] and row['storeId'] == alias['storeId']
                    and row.get('expectedArea') == alias.get('expectedArea'), 'Registry alias identity or expected area differs')
        else:
            expected_id = 'place-' + digest(row['placeId'].encode())[:32]
            require(row['storeId'] == expected_id and row['storeId'] not in reserved_ids and row.get('expectedArea') is None,
                    'Registry unaliased store lacks stable place-derived identity')
    return {'mode': 'discovered', 'status': 'ready', 'counts': counts, 'fetchedAt': snapshot['fetchedAt'],
            'sourceResponseHash': snapshot['sourceResponseHash'], 'policy': snapshot['policy'],
            'snapshotReceipt': receipt, 'stores': rows, 'exclusions': exclusions, 'quarantines': quarantines,
            'sourceHashRecomputed': False,
            'sourceHashNote': 'The receipt verifies the persisted snapshot. Normalized source IDs are not retained for eligible rows, so the original database-response hash cannot be independently recomputed.'}


def verify(summary, reader, expected_digest, source_commit=None, expected_stores=7, maximum=40,
           workers=6, expected_config=None, adapter=ADAPTER):
    require(re.fullmatch(r'[0-9a-f]{40}', source_commit or ''), 'A full expected runtime source commit is required')
    require(adapter == ADAPTER, 'This verifier only accepts the maps-feed-card/v5 contract')
    require(summary.get('status') != 'duplicate_skipped', 'duplicate_skipped is not a collection acceptance')
    require(summary.get('manifestReceipt'), 'Final daily manifest receipt missing')
    daily = reader.json(summary['manifestReceipt'], 'daily_manifest')
    require(daily['status'] in ('completed', 'partial', 'failed') and daily['finishedAt'], 'Daily manifest is not final')
    require(daily['deliveryMode'] == 'azure_blob', 'Daily delivery mode is not Azure')
    require(summary['manifestReceipt']['objectKey'] == f"{daily['date']}/daily/{daily['dailyRunId']}/manifest.json", 'Daily manifest escaped expected namespace')
    for field in ('dailyRunId', 'runKey', 'counts', 'executionStatus'):
        require(daily[field] == summary[field], 'Summary/daily mismatch: ' + field)
    require(daily.get('registry') == summary.get('registry'), 'Summary/daily mismatch: registry')
    require(summary['exitCode'] in (0, 1, 2), 'Invalid final process exit code')
    require(summary['status'] == daily['status'] or summary['status'] == 'failed', 'Summary status differs')
    require(daily.get('executionStatus') in ('completed', 'incomplete', 'failed'), 'Missing final v3 execution status')
    stores = daily['stores']
    require(len(stores) == expected_stores and len({s['storeId'] for s in stores}) == len(stores), 'Missing or duplicate enrolled stores')
    registry_report = validate_registry(daily, reader, expected_config)
    if expected_config:
        if registry_report is None:
            require([s['storeId'] for s in stores] == [s['storeId'] for s in expected_config['stores']], 'Enrolled store order differs')
            for actual, expected in zip(stores, expected_config['stores']):
                require(all(actual[k] == expected[k] for k in ('storeId', 'merchantId', 'placeId', 'name')) and
                        actual.get('expectedArea') == expected.get('expectedArea'), 'Enrolled store identity differs')
        require(maximum == expected_config['maxKeywordsPerStore'], 'Selection limit differs from launch config')
        normalized_config = dict(expected_config)
        if registry_report is not None:
            normalized_config.setdefault('stores', [])
        normalized_config['capture'] = {
            'maxResultsPerKeyword': 15, 'maxScrollsPerKeyword': 6, 'maxScreenshotsPerKeyword': 5,
            'keywordTimeoutMs': 90000, 'locale': 'en-US', 'browserTimezoneId': 'America/New_York',
            'filenameTimezone': 'Asia/Shanghai', 'viewport': {'width': 1440, 'height': 1000},
            **expected_config['capture']}
        require(daily['configHash'] == digest(json_bytes(normalized_config)), 'Daily configHash differs from expected normalized monitor config')
    issues, store_reports, query_reports, partials, all_artifacts = [], [], [], [], []
    total = collections.Counter({'stores': len(stores), 'batches': 0, 'selected': 0,
                                **{s: 0 for s in STATES}, 'sourceFailed': 0, 'empty': 0, 'nonRanking': 0})
    batches_to_validate = []
    for store in stores:
        sid = store['storeId']
        batches = store['batches']
        require(store['status'] not in ('pending', 'selected'), 'Store left unfinished: ' + sid)
        total['selected'] += store['selectedCount']
        total['batches'] += len(batches)
        store_counts = collections.Counter()
        if not store.get('snapshotReceipt'):
            require(store['status'] in ('source_failed', 'skipped', 'failed') and store['selectedCount'] == 0 and not batches,
                    'Missing selection snapshot for selected store: ' + sid)
            issues.append({'storeId': sid, 'kind': 'missing_source_snapshot', 'status': store['status'], 'reason': store.get('sourceError') or store.get('stopReason')})
            total['sourceFailed'] += store['status'] == 'source_failed'
        else:
            require(store['snapshotReceipt']['objectKey'] == f"{daily['date']}/{sid}/{daily['dailyRunId']}/keyword-selection.json", 'Selection snapshot escaped store/run namespace')
            snapshot = reader.json(store['snapshotReceipt'], 'selection_snapshot', sid)
            require(all(snapshot[k] == daily[k] for k in ('dailyRunId', 'runKey', 'date')), 'Snapshot run identity mismatch')
            require(all(snapshot['store'][k] == store[k] for k in ('storeId', 'merchantId', 'placeId', 'name')), 'Snapshot store identity mismatch')
            require(snapshot['store'].get('expectedArea') == store.get('expectedArea'), 'Snapshot expected area differs')
            require(snapshot['source']['placeId'] == store['placeId'] and snapshot['source']['merchantId'] == store['merchantId'], 'Keyword source identity mismatch')
            keywords = selected_keywords(snapshot, maximum)
            require(store['selectionHash'] == snapshot['selectionHash'], 'Daily/snapshot selection hash mismatch')
            require(len(keywords) == store['selectedCount'] and keywords == [k for b in batches for k in b['keywords']], 'Selected denominator/order differs from batches')
            if not keywords:
                require(store['status'] == 'empty', 'Empty source not explicitly accounted')
                total['empty'] += 1
                issues.append({'storeId': sid, 'kind': 'empty_source'})
        if expected_config:
            batch_size = expected_config['batchSize']
            require(all(0 < len(b['keywords']) <= batch_size for b in batches) and
                    all(len(b['keywords']) == batch_size for b in batches[:-1]), 'Batch split differs from expected config')
        for batch in batches:
            require(batch['prefix'] == f"{daily['date']}/{sid}/{daily['dailyRunId']}/batches/{batch['batchId']}", 'Batch escaped store/run namespace')
            declared_count = batch['counts'].copy()
            declared_nr = declared_count.pop('nonRanking', 0)
            require(type(declared_nr) is int and declared_nr >= 0, 'Invalid batch nonRanking count')
            count = counter(declared_count)
            total['nonRanking'] += declared_nr
            require(sum(count.values()) == len(batch['keywords']), 'Batch count denominator differs: ' + sid)
            store_counts.update(count)
            if not batch.get('manifestReceipt'):
                require(batch['status'] in ('skipped', 'failed') and batch['stopReason'] and
                        set(+count).issubset({'skipped', 'failed'}), 'Missing manifest for attempted batch: ' + sid)
                issues.append({'storeId': sid, 'batchId': batch['batchId'], 'kind': 'batch_without_manifest',
                               'status': batch['status'], 'reason': batch['stopReason'], 'counts': dict(count)})
                continue
            manifest = reader.json(batch['manifestReceipt'], 'batch_manifest', sid)
            require(manifest['runId'] == batch['runId'] and manifest['attemptId'] == batch['attemptId'], 'Batch identity mismatch')
            require(manifest['finishedAt'] and manifest['status'] == batch['status'], 'Batch is unfinished or status differs')
            require(manifest['persistenceMode'] == 'azure_blob', 'Batch persistence is not Azure')
            require(manifest['metadata']['imageDigest'] == expected_digest, 'Unexpected batch image digest')
            require(manifest['metadata']['sourceCommit'] == source_commit, 'Unexpected batch source commit')
            require(manifest['metadata']['adapterVersion'] == adapter, 'Unexpected batch adapter version')
            rows = manifest['queries']
            require([q['keyword'] for q in rows] == batch['keywords'] and [q['inputIndex'] for q in rows] == list(range(len(rows))), 'Missing/reordered batch queries')
            require(len({q['queryId'] for q in rows}) == len(rows) and collections.Counter(q['status'] for q in rows) == count, 'Query counts/IDs differ')
            require(all(q['status'] in STATES for q in rows), 'Unfinished query')
            prefix = batch['manifestReceipt']['objectKey'].rsplit('/', 1)[0] + '/'
            require(prefix.startswith(batch['prefix'] + '/'), 'Batch manifest escaped its namespace')
            by_key, identities = {}, set()
            known_attempts = {(q['queryId'], a['queryAttemptId']): a for q in rows for a in q['attempts']}
            require(len(known_attempts) == sum(len(q['attempts']) for q in rows), 'Duplicate query attempt identity')
            for artifact in manifest['artifacts']:
                key = safe_key(artifact.get('objectKey'))
                identity = (artifact.get('queryId'), artifact.get('queryAttemptId'), artifact['id'])
                require(key.startswith(prefix) and key not in by_key and identity not in identities, 'Duplicate or out-of-prefix batch artifact')
                owner = (artifact.get('queryId'), artifact.get('queryAttemptId'))
                if owner == (None, None):
                    require(artifact['kind'] == 'request_json', 'Unexpected shared artifact kind')
                else:
                    require(owner in known_attempts, 'Artifact owner does not reference an existing query attempt')
                    if artifact['kind'] in ('result_json', 'result_csv'):
                        result_key = prefix + safe_key(known_attempts[owner]['resultFile'])
                        expected_key = result_key if artifact['kind'] == 'result_json' else result_key[:-5] + '.csv'
                        require(key == expected_key, 'Extra or mismatched attempt result artifact')
                by_key[key] = artifact
                identities.add(identity)
                all_artifacts.append((artifact, sid))
            batches_to_validate.append((store, batch, manifest, prefix, by_key))
        total.update(store_counts)
        require(sum(store_counts.values()) == store['selectedCount'], 'Store count denominator differs: ' + sid)
        store_reports.append({'storeId': sid, 'name': store['name'], 'status': store['status'], 'selected': store['selectedCount'],
                              'counts': dict(store_counts), 'sourceError': store.get('sourceError'), 'stopReason': store.get('stopReason')})
    require(dict(total) == daily['counts'], 'Recomputed daily counts differ')
    require(total['selected'] > 0 and sum(total[k] for k in STATES) == total['selected'], 'Missing or zero final denominator')
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(reader.read, artifact, 'artifact', sid) for artifact, sid in all_artifacts]
        for i, future in enumerate(concurrent.futures.as_completed(futures), 1):
            future.result()
            if i % 100 == 0:
                print(json.dumps({'phase': 'artifact_readback', 'verified': i, 'total': len(futures)}), flush=True)
    csv_rows, attempts_checked, observation_count, complete_nr = 0, 0, 0, 0
    selected_ranked, selected_no_results = 0, 0
    for store, batch, manifest, prefix, by_key in batches_to_validate:
        batch_nr = 0
        batch_complete = True
        own_by_id = {r['queryId']: r for r in batch['ownStore']}
        require(len(own_by_id) == len(batch['ownStore']), 'Duplicate daily own-store summary')
        expected_own = {q['queryId'] for q in manifest['queries'] if q['status'] != 'skipped'}
        require(set(own_by_id) == expected_own, 'Missing or extra daily own-store summary')
        for row in manifest['queries']:
            qr = {'storeId': store['storeId'], 'batchId': batch['batchId'], 'queryId': row['queryId'],
                  'keyword': row['keyword'], 'status': row['status'], 'stopReason': row['stopReason']}
            if row['status'] == 'skipped':
                require(not row['attempts'] and row['resultFile'] is None and not row['artifactIds'], 'Skipped query has contradictory attempts')
                require(row['selectedQueryAttemptId'] is None and row['persistenceStatus'] == 'not_requested', 'Skipped query has contradictory selection/persistence')
                batch_complete = False
                issues.append({**qr, 'kind': 'skipped_query'})
                query_reports.append(qr)
                continue
            require(row['persistenceStatus'] == 'verified' and row['attempts'], 'Attempted query lacks verified persistence')
            selected = [a for a in row['attempts'] if a['queryAttemptId'] == row['selectedQueryAttemptId']]
            require(len(selected) == 1 and all(row[k] == selected[0][k] for k in ('resultFile', 'status', 'stopReason', 'error')), 'Selected attempt mismatch')
            require(row['artifactIds'] == [aid for a in row['attempts'] for aid in a['artifactIds']], 'Query artifact IDs differ from all-attempt references')
            preferred = next((a for a in row['attempts'] if a['status'] == 'captured'), None) or next((a for a in row['attempts'] if a['status'] in ('partial', 'blocked')), None) or row['attempts'][0]
            require(preferred['queryAttemptId'] == row['selectedQueryAttemptId'], 'Selected attempt violates collector selection policy')
            selected_result = None
            for attempt in row['attempts']:
                owned = [a for a in manifest['artifacts'] if a['queryId'] == row['queryId'] and a['queryAttemptId'] == attempt['queryAttemptId']]
                require(len(attempt['artifactIds']) == len(set(attempt['artifactIds'])) and
                        set(attempt['artifactIds']) == {a['id'] for a in owned}, 'Attempt artifact references differ')
                key = prefix + safe_key(attempt['resultFile'])
                require(key in by_key and by_key[key]['kind'] == 'result_json', 'Attempt JSON absent from batch artifacts')
                require(by_key[key]['queryId'] == row['queryId'] and
                        by_key[key]['queryAttemptId'] == attempt['queryAttemptId'], 'JSON artifact ownership mismatch')
                body = json.loads((reader.out / key).read_text())
                if expected_config:
                    capture_config = normalized_config['capture']
                    require(body['requestedLimit'] == capture_config['maxResultsPerKeyword'] and
                            all(body['context'][k] == capture_config[k] for k in ('locale', 'browserTimezoneId', 'viewport')),
                            'Result capture profile differs from expected config')
                require(body['error'] == attempt['error'], 'Result/attempt errors differ')
                require(body['quality']['classificationComplete'] == all(l['resultType'] != 'unknown' for l in body['listings']), 'Classification completeness disagrees with listings')
                if body['status'] == 'captured':
                    require(body['error'] is None, 'Captured query contains an error')
                checks = validate_result(body, row, attempt, batch, store, by_key, prefix, reader)
                require(body['metadata']['imageDigest'] == expected_digest and
                        body['metadata']['sourceCommit'] == source_commit and
                        body['metadata']['adapterVersion'] == adapter, 'Result image/source/adapter differs')
                coverage = observations_and_coverage(body, owned, reader)
                observation_count += coverage['observations']
                checks.update({'listingCoverage': coverage['listingCoverage'], 'allListingsCovered': coverage['allListingsCovered'],
                               'resultKey': key, 'listingCount': len(body['listings'])})
                csv_rows += checks['csvRows']
                attempts_checked += 1
                if attempt['queryAttemptId'] == row['selectedQueryAttemptId']:
                    selected_result = checks
                    if row['status'] == 'partial' and row['stopReason'] == 'non_ranking_result':
                        complete_detail = (row['error'] is None and attempt['error'] is None and body['error'] is None and
                            REQUIRED_NR.issubset({a['kind'] for a in owned}) and
                            any(s['kind'] == 'diagnostic' for s in body['screenshots']))
                        checks['completeNonRanking'] = complete_detail
                        if complete_detail:
                            complete_nr += 1
                            batch_nr += 1
                    elif row['status'] == 'captured':
                        if body['listings']:
                            require(checks['surface'] == 'results_list', 'Ranked capture is not a results-list surface')
                            selected_ranked += 1
                        else:
                            require(checks['surface'] == 'no_results', 'Empty captured list lacks explicit no-results surface')
                            selected_no_results += 1
            require(selected_result is not None, 'Selected result missing')
            own = own_by_id[row['queryId']]
            require(own['keyword'] == row['keyword'] and own['summary'] == selected_result['ownStore'] and
                    own['geographicRelevance'] == selected_result['geographicRelevance'], 'Daily own-store/geography summary differs from result')
            qr.update({k: v for k, v in selected_result.items() if k not in ('ownStore', 'geographicRelevance')})
            query_reports.append(qr)
            if row['status'] != 'captured':
                partials.append(qr)
                if not selected_result.get('completeNonRanking', False):
                    batch_complete = False
                    issues.append({**qr, 'kind': 'incomplete_query'})
        require(batch_nr == batch['counts'].get('nonRanking', 0), 'Batch nonRanking count differs from selected complete evidence')
        expected_batch_execution = 'failed' if manifest['status'] == 'failed' else 'completed' if batch_complete and manifest['queries'] else 'incomplete'
        require(manifest.get('executionStatus') == expected_batch_execution, 'Batch executionStatus differs from query evidence')
        # Daily wrapper can record an operational exception after a final batch manifest.
        wrapper_failed = batch.get('executionStatus') == 'failed' and daily['status'] == 'failed' and batch.get('stopReason')
        require(batch.get('executionStatus') == expected_batch_execution or wrapper_failed, 'Daily batch executionStatus differs')
    require(complete_nr == total['nonRanking'], 'Daily nonRanking count differs from selected complete evidence')
    for store in stores:
        expected_store_execution = 'failed' if store['status'] == 'failed' else 'completed' if store['batches'] and all(b.get('executionStatus') == 'completed' for b in store['batches']) else 'incomplete'
        require(store.get('executionStatus') == expected_store_execution, 'Store executionStatus differs from batch evidence')
    expected_daily_execution = 'failed' if daily['status'] == 'failed' else 'completed' if not daily['stopReason'] and total['selected'] > 0 and all(s['executionStatus'] == 'completed' for s in stores) else 'incomplete'
    require(daily['executionStatus'] == expected_daily_execution, 'Daily executionStatus differs from underlying evidence')
    expected_exit = 1 if expected_daily_execution == 'failed' else 0 if expected_daily_execution == 'completed' else 2
    require(summary['exitCode'] == expected_exit, 'Summary exitCode differs from v3 execution status')
    samples, sampled_keys = [], set()
    def sample(query, reason):
        keys = query.get('pngKeys', [])
        if keys and keys[0] not in sampled_keys:
            sampled_keys.add(keys[0])
            samples.append({**{k: query[k] for k in ('storeId', 'keyword', 'status', 'stopReason')},
                            'reason': reason, 'objectKey': keys[0], 'path': str(reader.out / keys[0]), 'visualReview': 'pending'})
    for store in stores:
        candidates = [q for q in query_reports if q['storeId'] == store['storeId'] and q.get('pngKeys')]
        candidates.sort(key=lambda q: q['status'] != 'captured')
        if candidates:
            sample(candidates[0], 'store_coverage')
    for reason in sorted({q['stopReason'] for q in partials}):
        for query in partials:
            if query['stopReason'] == reason and query.get('pngKeys'):
                sample(query, 'partial_reason:' + reason)
                break
    pngs = [r for r in reader.records.values() if r['png']]
    report = {'verificationIdentity': reader.identity, 'evidenceIntegrityPassed': True,
              'dailyRunId': daily['dailyRunId'], 'runKey': daily['runKey'], 'date': daily['date'],
              'startedAt': daily['startedAt'], 'finishedAt': daily['finishedAt'], 'status': daily['status'],
              'exitCode': summary['exitCode'], 'executionStatus': daily['executionStatus'],
              'recomputedExecutionStatus': expected_daily_execution, 'originalPodExitCode': None,
              'originalPodExitCodeNote': 'Summary exitCode is preserved; compare original Pod termination exit code separately.',
              'stopReason': daily['stopReason'], 'counts': dict(total),
              'imageDigest': expected_digest, 'sourceCommit': source_commit, 'adapterVersion': adapter, 'finalReceipt': summary['manifestReceipt'],
              'verifiedObjects': len(reader.records), 'verifiedArtifacts': len(all_artifacts),
              'verifiedBytes': sum(r['expected']['bytes'] for r in reader.records.values()),
              'cacheReused': sum(r['cacheReused'] for r in reader.records.values()),
              'pngsStructurallyChecked': len(pngs), 'csvRowsComparedAllAttempts': csv_rows,
              'resultAttemptsCompared': attempts_checked, 'observationRecordsChecked': observation_count, 'partialReasons': dict(collections.Counter(q['stopReason'] for q in partials)),
              'geographicStatuses': dict(collections.Counter(q.get('geographicStatus', 'not_attempted') for q in query_reports)),
              'nonRankingDetailCount': complete_nr, 'otherPartialCount': total['partial'] - complete_nr,
              'coverage': {'selected': total['selected'], 'attemptedWithResultEvidence': sum(q['status'] != 'skipped' for q in query_reports),
                           'nonemptyRankedCaptures': selected_ranked, 'explicitNoResults': selected_no_results,
                           'nonRankingDetails': complete_nr, 'otherPartial': total['partial'] - complete_nr,
                           'blocked': total['blocked'], 'failed': total['failed'], 'skipped': total['skipped'],
                           'sourceFailedStores': total['sourceFailed']},
              'allSelectedKeywordsAttempted': len(query_reports) == total['selected'] and total['skipped'] == 0 and total['sourceFailed'] == 0,
              'allKeywordsRankingComplete': total['captured'] == total['selected'] and not issues,
              'collectionAcceptancePassed': not issues and daily['executionStatus'] == 'completed' and summary['exitCode'] == 0,
              'stores': store_reports, 'registry': registry_report, 'issues': issues, 'partialQueries': partials,
              'scope': {'allReferencedSnapshotsAndManifests': True, 'allReferencedArtifactsAllAttempts': True,
                        'allPngStructuralChecks': True, 'allResultCsvSemanticChecks': True, 'allCapturedListingObservationCoverageChecks': True,
                        'storeRegistrySnapshotAndIdentityChecks': registry_report is not None,
                        'visualReview': 'pending; see visual-samples.json', 'visualSampleCount': len(samples),
                        'visualSampleStores': sorted({s['storeId'] for s in samples})},
              'limitations': ['Detail pages have no comparable ranked list and remain partial.',
                              'Geographic unverified is not proof that rankings apply to the enrolled store area.',
                              'PNG structure and hashes do not replace visual interpretation.',
                              'Source response hash cannot reconstruct raw API fields not retained in the snapshot.',
                              'Skipped batches have explicit counts but no per-query result evidence.']}
    write_json(reader.out / 'object-inventory.json', sorted(reader.records.values(), key=lambda r: r['objectKey']))
    write_json(reader.out / 'query-inventory.json', query_reports)
    write_json(reader.out / 'visual-samples.json', samples)
    write_json(reader.out / 'readback-report.json', report)
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument('--summary')
    g.add_argument('--log')
    p.add_argument('--out', required=True)
    p.add_argument('--digest', required=True)
    p.add_argument('--source-commit', required=True)
    p.add_argument('--adapter-version', default=ADAPTER)
    p.add_argument('--expected-stores', type=int, default=7)
    p.add_argument('--max-keywords', type=int, default=40)
    p.add_argument('--expected-config', help='Exact monitor JSON used for launch; never a Kubernetes Secret')
    p.add_argument('--workers', type=int, default=6)
    p.add_argument('--offline-root', help='Synthetic/offline replay only; not a fresh Azure acceptance')
    args = p.parse_args()
    require(re.fullmatch(r'sha256:[0-9a-f]{64}', args.digest), 'Invalid image digest')
    require(1 <= args.workers <= 8 and 1 <= args.max_keywords <= 40 and args.expected_stores > 0, 'Invalid verifier bounds')
    if args.log:
        summaries = []
        for line in pathlib.Path(args.log).read_text().splitlines():
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict) and value.get('summary') is True:
                summaries.append(value)
        require(len(summaries) == 1, 'Expected exactly one final summary')
        summary = summaries[0]
    else:
        summary = json.loads(pathlib.Path(args.summary).read_text())
    reader = Reader(args.out, args.offline_root)
    config = json.loads(pathlib.Path(args.expected_config).read_text()) if args.expected_config else None
    report = verify(summary, reader, args.digest, args.source_commit, args.expected_stores,
                    args.max_keywords, args.workers, config, args.adapter_version)
    print(json.dumps({k: report[k] for k in ('dailyRunId', 'runKey', 'counts', 'verifiedObjects', 'verifiedBytes',
        'pngsStructurallyChecked', 'csvRowsComparedAllAttempts', 'partialReasons', 'nonRankingDetailCount',
        'allSelectedKeywordsAttempted', 'collectionAcceptancePassed', 'allKeywordsRankingComplete')}, indent=2))
    return 0 if report['collectionAcceptancePassed'] else 2


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, KeyError, OSError, TypeError, zlib.error) as error:
        # Deliberately exclude HTTP headers, subprocess output and authentication tokens.
        print(json.dumps({'evidenceIntegrityPassed': False, 'error': str(error)}))
        raise SystemExit(1)
