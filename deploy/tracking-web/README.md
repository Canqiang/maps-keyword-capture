# Two-hourly web rank tracking

CronJob `maps-tracking-web-2h` in `uat` runs the desktop collector every two hours (store local time, `America/New_York`) for every active store and keyword, searching with the map centred on the store (`mapView`), delivering screenshots and manifests to the private container `maps-keyword-capture-uat` under `tracking/web/<date>/point/<scanId>/…`, and upserting one `RankObservation` per keyword into MongoDB `maps-rank-tracking.observations`. The domain is described in [`docs/domain.md`](../../docs/domain.md).

**Stores live in MongoDB** (`maps-rank-tracking.stores`) and are added, edited and paused in the [tracking UI](../tracking-ui/README.md). `configmap.yaml` only holds shared settings (`storeSource: mongo`); `stores-seed.json` is the initial import. Each run reads the active stores at start.

**Sharding.** The Job is Indexed with `completions: 2`; each pod scans the stores whose stable storeId hash falls in its index (`--shard-count` must equal `completions`). One pod covers about 250 keywords in two hours, so raise both together when the total keyword count grows past about 450. More shards means more concurrent browsers on `uatops` and more searches from the same egress IP.

It reuses the UAT monitor's storage SAS Secret and Mongo URI Secret. The daily monitor keeps running unchanged.

## Build and pin

```bash
bash <<'SH'
set -euo pipefail
npm ci && npm run typecheck && npm test && npm run build
COMMIT=$(git rev-parse HEAD)
az acr build --registry FBRDevAcr --platform linux/amd64 --image "ai/maps-keyword-capture:tracking-web-$COMMIT" --build-arg "GIT_COMMIT=$COMMIT" .
az acr repository show --name FBRDevAcr --image "ai/maps-keyword-capture:tracking-web-$COMMIT" --query digest -o tsv
SH
```

Put the digest into `image` and `IMAGE_DIGEST` in `cronjob.yaml`, run `npx vitest run tests/tracking-web-deploy.test.ts`, commit.

## Deploy, run once, verify

These are operator-run deployment instructions, not validation commands. Local regression tests do not deploy anything. Applying the checked-in `cronjob.yaml` directly enables its schedule (`suspend: false`), so **prepare a suspended manifest before applying it** when validating manually. Suspending an existing CronJob does not stop a running Job: wait for its active Jobs to finish before creating a manual scan.

```bash
kubectl --context FBRDevAKSCluster -n uat create --dry-run=client -f deploy/tracking-web/cronjob.yaml -o json > /tmp/maps-tracking-web-suspended.json
python3 - <<'PY_SUSPEND'
import json
p = '/tmp/maps-tracking-web-suspended.json'
d = json.load(open(p))
d['spec']['suspend'] = True
with open(p, 'w') as f:
    json.dump(d, f)
PY_SUSPEND
kubectl --context FBRDevAKSCluster -n uat apply -f deploy/tracking-web/configmap.yaml -f /tmp/maps-tracking-web-suspended.json
kubectl --context FBRDevAKSCluster -n uat get cronjob maps-tracking-web-2h -o jsonpath='{.spec.suspend}{"\n"}{.status.active}{"\n"}'
# Continue only after suspend is true and no active scheduled scan remains.
JOB=$(kubectl --context FBRDevAKSCluster -n uat create job --from=cronjob/maps-tracking-web-2h "maps-tracking-web-manual-$(date -u +%Y%m%d%H%M)" -o name)
kubectl --context FBRDevAKSCluster -n uat get "$JOB"
```

For an Indexed Job, inspect both pod logs and exit codes; one pod does not represent the whole Job. Each final log event is `tracking_scan_finished` with per-batch, query and upsert counts, plus a separate final-summary receipt. Exit 0 means execution and required delivery completed; recognized non-ranking pages are counted as `nonRanking`, not as ranks or confirmed absence. Exit 2 means incomplete execution/ingestion; exit 1 covers blocked/cancelled runs and delivery failure. A batch that cannot verify Azure delivery is not ingested, and stops further dispatch. `queries.captured/nonRanking/partial/blocked/failed/skipped` describe collection outcomes; `ranked/notFound/unresolved` describe ranking usability and are not an additional denominator. The immutable scan JSON cannot contain its own final receipt; use the terminal log receipt to verify that file.

Read observations back without starting a collector. Construct the read-only Job **before creating it**, replacing the scan arguments and removing Indexed Job parallelism:

```bash
kubectl --context FBRDevAKSCluster -n uat create job --from=cronjob/maps-tracking-web-2h "maps-tracking-recent-$(date -u +%Y%m%d%H%M)" --dry-run=client -o json > /tmp/maps-tracking-recent.json
python3 - <<'PY_RECENT'
import json
p = '/tmp/maps-tracking-recent.json'
d = json.load(open(p))
d['spec'].update(completions=1, parallelism=1, completionMode='NonIndexed')
d['spec']['template']['spec']['containers'][0]['args'] = [
    'node', 'dist/domain/cli.js', 'recent', '--config', '/config/tracking.json',
    '--mongo-uri-env', 'MAPS_TRACKING_MONGO_URI', '--limit', '50'
]
with open(p, 'w') as f:
    json.dump(d, f)
PY_RECENT
kubectl --context FBRDevAKSCluster -n uat create -f /tmp/maps-tracking-recent.json
```

After reviewing the manual run and evidence, enabling the schedule is a separate operator action. Do not use `kubectl apply -f cronjob.yaml` as a read-only verification step.

## Change keywords or stores

Use the tracking UI; the next run picks the change up. Keep each store's keywords unique across `core` and `longTail`. Every 20 keywords of a store is one batch of about 7 minutes.

## Pause, stop, remove

```bash
kubectl -n uat patch cronjob maps-tracking-web-2h --type=merge -p '{"spec":{"suspend":true}}'
kubectl -n uat delete cronjob maps-tracking-web-2h   # deletes its Jobs and logs; observations and Azure evidence stay
```
