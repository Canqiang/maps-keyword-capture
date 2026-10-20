# Two-hourly web rank tracking

CronJob `maps-tracking-web-2h` in `uat` runs the desktop collector every two hours (store local time, `America/New_York`) for every store and keyword in `configmap.yaml`, searching with the map centred on the store (`mapView`), delivering screenshots and manifests to the private container `maps-keyword-capture-uat` under `tracking/web/<date>/point/<scanId>/…`, and upserting one `RankObservation` per keyword into MongoDB `maps-rank-tracking.observations`. The domain is described in [`docs/domain.md`](../../docs/domain.md).

It runs on the `uatops` pool and reuses the UAT monitor's storage SAS Secret and Mongo URI Secret (the Mongo user must be allowed to create the `maps-rank-tracking` database on the UAT replica set). The daily monitor keeps running unchanged; this job is additional load on the same egress IP, about 40 searches every two hours for one store.

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

```bash
kubectl apply -f deploy/tracking-web/configmap.yaml -f deploy/tracking-web/cronjob.yaml
JOB=$(kubectl -n uat create job --from=cronjob/maps-tracking-web-2h "maps-tracking-web-manual-$(date -u +%Y%m%d%H%M)" -o name)
kubectl -n uat logs -f "$JOB"
```

The last log line is `tracking_scan_finished` with `status`, per-batch and per-query counts and the observation upsert counts. Exit 0 is a completed scan, 2 partial (a batch or query failed), 1 blocked (CAPTCHA or consent page; the scan stops at the first blocked batch) or cancelled.

Read the newest observations back from MongoDB with the same image:

```bash
kubectl -n uat create job --from=cronjob/maps-tracking-web-2h maps-tracking-recent -o name
kubectl -n uat patch job maps-tracking-recent --type=json -p '[{"op":"replace","path":"/spec/template/spec/containers/0/args","value":["node","dist/domain/cli.js","recent","--config","/config/tracking.json","--mongo-uri-env","MAPS_TRACKING_MONGO_URI","--limit","50"]}]'
```

(Creating from the CronJob and patching the args is not possible after the Pod starts; instead copy the Job manifest from `kubectl get job … -o yaml`, change `args`, and apply it under a new name.)

## Change keywords or stores

Edit `configmap.yaml` and apply it; the next run reads the new list. Keep each store's keywords unique across `core` and `longTail`. Adding a store adds one batch per 20 keywords per run; keep the total under about 250 queries per run so the scan stays well inside the two-hour window and the egress stays under roughly 3000 searches a day.

## Pause, stop, remove

```bash
kubectl -n uat patch cronjob maps-tracking-web-2h --type=merge -p '{"spec":{"suspend":true}}'
kubectl -n uat delete cronjob maps-tracking-web-2h   # deletes its Jobs and logs; observations and Azure evidence stay
```
