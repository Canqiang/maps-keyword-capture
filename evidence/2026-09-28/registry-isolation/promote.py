"""Promote only the exact UAT smoke release accepted by independent readback."""
import copy
import datetime
import hashlib
import json
import pathlib
import re
import subprocess

E = pathlib.Path(__file__).resolve().parent
R = pathlib.Path('/private/tmp/maps-registry-quarantine-20260928')
K = ['kubectl', '--context', 'FBRDevAKSCluster', '--request-timeout=30s', '-n', 'uat']
RUNTIME_COMMIT = '385a14d2615da65859f90fd06b623b560e3edc9f'
VERIFIER_SHA256 = '6ec2e176c982b9645a9d95b9e7cdff027855682fe0406ea2c1042aab2df02758'
IMAGE_REPOSITORY = 'fbrdevacr.azurecr.io/ai/maps-keyword-capture'
EXPECTED_RESOURCES = {'requests': {'cpu': '250m', 'memory': '1Gi', 'ephemeral-storage': '1Gi'}, 'limits': {'cpu': '2', 'memory': '2Gi', 'ephemeral-storage': '3Gi'}}


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def read_json(path):
    return json.loads(path.read_text())


def call(args, data=None, cwd=None):
    result = subprocess.run(args, input=data, text=True, capture_output=True, timeout=45, cwd=cwd)
    require(result.returncode == 0, 'command failed: ' + args[0] + ' ' + str(result.returncode))
    return result.stdout


def get(kind, name):
    return json.loads(call(K + ['get', kind, name, '-o', 'json']))


def normalized_config_hash(config):
    # Use the built runtime parser and canonical JSON implementation, including defaults.
    script = """import { readFileSync } from 'node:fs';
import { parseMonitorConfig } from './dist/monitor/config.js';
import { hashJson } from './dist/ids.js';
process.stdout.write(hashJson(parseMonitorConfig(JSON.parse(readFileSync(0, 'utf8')))));"""
    return call(['node', '--input-type=module', '-e', script], json.dumps(config), cwd=R).strip()


def verified_local_file(root, receipt):
    require(isinstance(receipt, dict) and receipt.get('storageStatus') == 'verified', 'Unverified evidence receipt')
    key = receipt.get('objectKey')
    require(isinstance(key, str) and key and not key.startswith('/')
            and not any(c in key for c in '?#{\\\x00')
            and all(part not in ('', '.', '..') for part in key.split('/')), 'Unsafe evidence object key')
    require(type(receipt.get('bytes')) is int and 0 <= receipt['bytes'] <= 128_000_000
            and re.fullmatch(r'[a-f0-9]{64}', receipt.get('sha256', '')), 'Invalid evidence receipt hash/size')
    path = (root / key).resolve()
    require(path.is_relative_to(root.resolve()), 'Evidence path escaped readback directory')
    data = path.read_bytes()
    require(len(data) == receipt['bytes'] and hashlib.sha256(data).hexdigest() == receipt['sha256'],
            'Evidence no longer matches its verified receipt: ' + key)
    return path, data


def matches_artifact_path(recorded, expected, evidence):
    if not isinstance(recorded, str) or not recorded:
        return False
    path = pathlib.Path(recorded)
    # The documented verifier invocation runs from verifier/ with --out ../readback.
    return any((base / path).resolve() == expected for base in (pathlib.Path.cwd(), evidence, evidence / 'verifier'))


def monitor_container(spec):
    containers = spec.get('containers', [])
    require(len(containers) == 1 and containers[0].get('name') == 'monitor', 'Unexpected monitor Pod container layout')
    return containers[0]


def validate_resources(container):
    require(container.get('resources') == EXPECTED_RESOURCES, 'Workload resources differ from the accepted production profile')


def validate_acceptance(evidence, config, config_hasher=normalized_config_hash):
    # This function reads local evidence only; all guards finish before any cluster mutation.
    image = read_json(evidence / 'image.json')
    launch = read_json(evidence / 'launch.json')
    report = read_json(evidence / 'readback/readback-report.json')
    summary = read_json(evidence / 'summary.json')
    visual = read_json(evidence / 'visual-review.json')
    job = read_json(evidence / 'job.json')
    pod = read_json(evidence / 'pod.json')
    smoke_config = read_json(evidence / 'smoke-monitor.json')
    summaries = []
    for line in (evidence / 'pod.log').read_text().splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict) and event.get('summary') is True:
            summaries.append(event)
    require(summaries == [summary], 'Saved Pod log does not contain exactly the accepted summary')
    readback = evidence / 'readback'

    require(hashlib.sha256((evidence / 'verifier/verify_daily.py').read_bytes()).hexdigest() == VERIFIER_SHA256,
            'Independent verifier differs from the reviewed helper')
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', image.get('digest', ''))
            and image.get('image') == IMAGE_REPOSITORY + '@' + image['digest']
            and image.get('runtimeCommit') == RUNTIME_COMMIT, 'Unexpected release image or runtime commit')
    require(all(launch.get(key) == image.get(key) for key in ('image', 'digest', 'runtimeCommit', 'buildRunId')),
            'Image metadata differs from smoke launch')
    require(launch.get('manual') is True and launch.get('maxKeywordsPerStore') == 2
            and isinstance(launch.get('runKey'), str) and launch['runKey'].startswith('registry-smoke-'),
            'Unexpected smoke launch scope')
    require(report.get('verificationIdentity') == 'azure_cli_login'
            and report.get('evidenceIntegrityPassed') is True and report.get('collectionAcceptancePassed') is True
            and report.get('executionStatus') == 'completed' and report.get('exitCode') == 0,
            'Independent Azure-login verification did not accept complete execution')
    require(report.get('imageDigest') == image['digest'] and report.get('sourceCommit') == RUNTIME_COMMIT
            and report.get('adapterVersion') == 'maps-feed-card/v5',
            'Accepted report has different runtime provenance')
    require(report.get('runKey') == launch['runKey'] and report.get('dailyRunId')
            and report.get('finalReceipt') == summary.get('manifestReceipt'), 'Accepted report belongs to another smoke run')
    receipt = report['finalReceipt']
    _, manifest_bytes = verified_local_file(readback, receipt)
    daily = json.loads(manifest_bytes)
    require(receipt['objectKey'] == f"{daily['date']}/daily/{daily['dailyRunId']}/manifest.json",
            'Final manifest namespace does not match accepted run')
    for key in ('runKey', 'dailyRunId', 'counts', 'status', 'executionStatus'):
        require(report.get(key) == daily.get(key) == summary.get(key), 'Report/manifest/summary mismatch: ' + key)
    require(daily.get('schemaVersion') == '1' and daily.get('deliveryMode') == 'azure_blob'
            and daily.get('finishedAt') and not daily.get('stopReason') and summary.get('exitCode') == 0
            and summary.get('summary') is True and report.get('date') == daily.get('date'), 'Smoke terminal evidence is incomplete')
    stores = daily['stores']
    store_ids = {store['storeId'] for store in stores}
    require(type(launch.get('expectedStores')) is int and len(stores) == len(store_ids) == launch['expectedStores']
            and len(stores) > 0 and daily['counts']['stores'] == len(stores), 'Accepted smoke roster differs from launch expectation')
    require(type(launch.get('expectedSelected')) is int and daily['counts']['selected'] == launch['expectedSelected'], 'Accepted selected query count differs from launch expectation')
    require(report.get('scope', {}).get('storeRegistrySnapshotAndIdentityChecks') is True
            and report.get('registry', {}).get('status') == 'ready'
            and daily.get('registry', {}).get('status') == 'ready'
            and report['registry']['snapshotReceipt'] == daily['registry']['snapshotReceipt'], 'Accepted registry proof missing')
    _, registry_bytes = verified_local_file(readback, daily['registry']['snapshotReceipt'])
    registry = json.loads(registry_bytes)
    require(all(registry.get(key) == daily[key] for key in ('runKey', 'dailyRunId', 'date'))
            and registry.get('stores') == report['registry']['stores']
            and {row['storeId'] for row in registry['stores']} == store_ids, 'Registry belongs to another accepted roster')

    require(smoke_config.get('maxKeywordsPerStore') == 2 and config.get('maxKeywordsPerStore') == 40,
            'Unexpected smoke or production keyword cap')
    expected_config = copy.deepcopy(smoke_config)
    expected_config['maxKeywordsPerStore'] = 40
    require(config == expected_config, 'Production config differs from accepted smoke beyond the keyword cap')
    require(daily.get('configHash') == config_hasher(smoke_config), 'Accepted manifest configHash differs from persisted smoke config')

    require(job.get('kind') == 'Job' and job['metadata'].get('name') == launch['job']
            and job['metadata'].get('namespace') == 'uat' and job['metadata'].get('uid'), 'Saved Job does not match smoke launch')
    require(pod.get('kind') == 'Pod' and pod['metadata'].get('namespace') == 'uat'
            and any(owner.get('kind') == 'Job' and owner.get('name') == launch['job']
                    and owner.get('uid') == job['metadata']['uid'] and owner.get('controller') is True
                    for owner in pod['metadata'].get('ownerReferences', [])), 'Saved Pod is not owned by the accepted smoke Job')
    for spec in (job['spec']['template']['spec'], pod['spec']):
        container = monitor_container(spec)
        require(container.get('image') == image['image'], 'Saved smoke workload uses a different image')
        validate_resources(container)
        args = container.get('args', [])
        require(args.count('--run-key') == 1 and args[args.index('--run-key') + 1:] == [launch['runKey']],
                'Saved smoke workload uses a different run key')
        require([item.get('value') for item in container.get('env', []) if item['name'] == 'IMAGE_DIGEST'] == [image['digest']],
                'Saved smoke workload image metadata differs')
        require([volume.get('configMap', {}).get('name') for volume in spec.get('volumes', [])
                 if volume.get('name') == 'config'] == [launch['configMap']], 'Saved smoke workload uses another config')
    statuses = pod.get('status', {}).get('containerStatuses', [])
    require(pod.get('status', {}).get('phase') == 'Succeeded' and len(statuses) == 1 and statuses[0].get('name') == 'monitor',
            'Smoke Pod did not finish successfully')
    status = statuses[0]
    require(status.get('state', {}).get('terminated', {}).get('exitCode') == 0 and status.get('restartCount') == 0
            and status.get('imageID', '').endswith('@' + image['digest']), 'Smoke Pod exit or actual image differs')

    require(visual.get('completed') is True and visual.get('scope', {}).get('allStores') is True
            and all(visual.get(key) == report[key] for key in ('runKey', 'dailyRunId', 'imageDigest', 'sourceCommit')),
            'Visual review is incomplete or belongs to another smoke run')
    inventory = read_json(readback / 'object-inventory.json')
    by_key = {row['objectKey']: row for row in inventory}
    require(len(by_key) == len(inventory), 'Duplicate artifact inventory keys')
    queries = read_json(readback / 'query-inventory.json')
    query_pngs = {(row['storeId'], row['keyword'], key) for row in queries for key in row.get('pngKeys', [])}
    samples = visual.get('samples', [])
    require(isinstance(samples, list) and {sample['storeId'] for sample in samples} == store_ids,
            'Visual samples do not cover exactly the accepted store roster')
    require(len({sample['objectKey'] for sample in samples}) == len(samples), 'Duplicate visual samples')
    for sample in samples:
        key = sample['objectKey']
        require((sample['storeId'], sample['keyword'], key) in query_pngs
                and isinstance(sample.get('findings'), (str, list)) and bool(sample['findings']),
                'Visual sample lacks accepted query identity or review findings')
        entry = by_key.get(key, {})
        require(entry.get('verified') is True and entry.get('identity') == 'azure_cli_login'
                and entry.get('category') == 'artifact' and entry.get('storeId') == sample['storeId']
                and entry.get('png') and key.endswith('.png'), 'Visual sample is not an independently verified PNG')
        path, _ = verified_local_file(readback, {'objectKey': key, 'storageStatus': 'verified', **entry['expected']})
        require(matches_artifact_path(sample['path'], path, evidence)
                and matches_artifact_path(entry['path'], path, evidence),
                'Visual review path differs from the verified artifact')
    return image, report, launch, daily


def main():
    config = json.loads((R / 'deploy/uat-monitor/configmap.yaml').read_text().split('  monitor.json: |\n', 1)[1])
    image, report, launch, daily = validate_acceptance(E, config)
    cron = get('cronjob', 'maps-keyword-monitor-daily')
    cm = get('configmap', 'maps-keyword-monitor-config')
    before = read_json(E / 'before-cronjob.json')
    before_cm = read_json(E / 'before-configmap.json')
    require(cron['metadata']['uid'] == before['metadata']['uid'] and cron['spec'] == before['spec'], 'CronJob changed since preflight')
    require(cm['metadata']['uid'] == before_cm['metadata']['uid'] and cm['data'] == before_cm['data'], 'Monitor ConfigMap changed since preflight')
    require(cron['spec']['suspend'] is False and cron['spec']['schedule'] == '0 0 * * *'
            and cron['spec']['timeZone'] == 'Asia/Shanghai', 'Active schedule differs from release scope')
    jobs = json.loads(call(K + ['get', 'jobs', '-o', 'json']))['items']
    require(not any(job.get('status', {}).get('active', 0) and job['metadata']['name'].startswith('maps') for job in jobs), 'Active maps run')
    expected = copy.deepcopy(cron)
    container = monitor_container(expected['spec']['jobTemplate']['spec']['template']['spec'])
    container['image'] = image['image']
    container['resources']['requests']['cpu'] = '250m'
    validate_resources(container)
    container['env'] = [item for item in container['env'] if item['name'] not in ('IMAGE_DIGEST', 'KEYWORD_MONGO_URI')] + [
        {'name': 'IMAGE_DIGEST', 'value': image['digest']},
        {'name': 'KEYWORD_MONGO_URI', 'valueFrom': {'secretKeyRef': {'name': 'maps-keyword-monitor-source', 'key': 'KEYWORD_MONGO_URI'}}}]
    # New code supports static config. Patch image first; keep schedule and other fields intact.
    operations = [{'op': 'test', 'path': '/metadata/resourceVersion', 'value': cron['metadata']['resourceVersion']},
                  {'op': 'replace', 'path': '/spec/jobTemplate/spec/template/spec/containers/0/image', 'value': container['image']},
                  {'op': 'replace', 'path': '/spec/jobTemplate/spec/template/spec/containers/0/env', 'value': container['env']},
                  {'op': 'replace', 'path': '/spec/jobTemplate/spec/template/spec/containers/0/resources/requests/cpu', 'value': '250m'}]
    call(K + ['patch', 'cronjob', 'maps-keyword-monitor-daily', '--type=json', '--patch-file=/dev/stdin', '-o', 'name'], json.dumps(operations))
    operations = [{'op': 'test', 'path': '/metadata/resourceVersion', 'value': cm['metadata']['resourceVersion']},
                  {'op': 'replace', 'path': '/data/monitor.json', 'value': json.dumps(config, ensure_ascii=False, indent=2) + '\n'}]
    call(K + ['patch', 'configmap', 'maps-keyword-monitor-config', '--type=json', '--patch-file=/dev/stdin', '-o', 'name'], json.dumps(operations))
    after = get('cronjob', 'maps-keyword-monitor-daily')
    after_cm = get('configmap', 'maps-keyword-monitor-config')
    require(after['metadata']['uid'] == cron['metadata']['uid'] and after['spec'] == expected['spec'], 'CronJob readback mismatch')
    expected_data = dict(cm['data'])
    expected_data['monitor.json'] = operations[1]['value']
    require(after_cm['metadata']['uid'] == cm['metadata']['uid'] and after_cm['data'] == expected_data, 'ConfigMap readback mismatch')
    (E / 'after-cronjob.json').write_text(json.dumps(after, indent=2))
    (E / 'after-configmap.json').write_text(json.dumps(after_cm, indent=2))
    result = {'promotedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'image': image['image'],
              'runtimeCommit': image['runtimeCommit'], 'acceptedRunKey': launch['runKey'], 'acceptedDailyRunId': daily['dailyRunId'],
              'acceptedManifestReceipt': report['finalReceipt'], 'schedule': after['spec']['schedule'],
              'timeZone': after['spec']['timeZone'], 'suspend': after['spec']['suspend'], 'discovery': config['storeDiscovery'],
              'cpuRequest': '250m', 'cpuLimit': '2', 'maxKeywordsPerStore': config['maxKeywordsPerStore'], 'configReadbackMatched': True,
              'cronSpecOnlyIntendedChanges': True, 'nextScheduledBeijing': '2026-09-29T00:00:00+08:00', 'smokeOnlyNotFullCapacity': True}
    (E / 'promotion.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == '__main__':
    main()
