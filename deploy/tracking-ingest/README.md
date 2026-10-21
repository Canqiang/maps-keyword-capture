# Daily-monitor ingestion

The UAT daily monitor (`maps-keyword-monitor-daily`, 00:00 Asia/Shanghai, 10 stores, query-only) delivers batch manifests, result JSON and screenshots to the private container `maps-keyword-capture-uat` under `<Beijing date>/<storeId>/<daily run>/batches/<batch>/<run>/<attempt>/`, but writes no `RankObservation`. The history up to local date 2026-10-14 was imported once from an audited snapshot; from 2026-10-21 on, CronJob `maps-tracking-ingest-daily` (04:00 Asia/Shanghai) runs

```
node dist/domain/cli.js ingest-daily --config /config/tracking.json --mongo-uri-env MAPS_TRACKING_MONGO_URI
```

which lists today's and yesterday's date folders, downloads every batch manifest, verifies each selected result file against the manifest's artifact receipt (object key, byte count, SHA-256), derives the observations with the same `ingestWebBatch` as the scans (point `r0c0`, `locationMode: query_only`, v2 observation IDs, evidence keys pointing at the container) and **appends only the IDs that are not stored yet** (`$setOnInsert`). The imported history and the scans' own rows are never replaced; re-running a date is a no-op. Stores are resolved from the configured Mongo store collection including paused ones (`massage-float`), so a paused store's captures are still recorded; a folder for a store that is not in the collection is skipped and logged. A batch with a missing, tampered or unverified result is withheld entirely (exit code 2) and retried by the next run.

## Backfill

```bash
JOB=$(kubectl -n uat create job --from=cronjob/maps-tracking-ingest-daily maps-tracking-ingest-backfill-$(date -u +%Y%m%d%H%M) --dry-run=client -o json \
  | python3 -c 'import json,sys; j=json.load(sys.stdin); c=j["spec"]["template"]["spec"]["containers"][0]; c["args"]=["node","dist/domain/cli.js","ingest-daily","--config","/config/tracking.json","--mongo-uri-env","MAPS_TRACKING_MONGO_URI","--from","2026-10-15","--to","2026-10-21"]; print(json.dumps(j))' \
  | kubectl -n uat create -f - -o name)
kubectl -n uat logs -f "$JOB"
```

The last stdout line is `tracking_daily_ingested` with per-date `manifests / inserted / existing` counts. `--dry-run true` runs the same reads without writing. The 2026-10-15 folder (local date 10-14) is already imported and reports `existing` only; 2026-10-17 has no daily run.

## Build, pin, deploy

The container SAS of the daily monitor can write but not list, so the ingest uses its own read+list SAS from the stored access policy `maps-uat-ingest-reader` (expires 2027-10-21; delete the policy to revoke) in Secret `maps-tracking-ingest-storage`. Same image as the other tracking workloads (`az acr build` in the repo root, see `deploy/tracking-web/README.md`); put the digest into `image` and `IMAGE_DIGEST`, then `kubectl apply -f deploy/tracking-ingest/cronjob.yaml`. The mirror of the applied manifest lives in `fbr-env-project` (`azure/uat/kube/resource/app/ai/64-maps-tracking-ingest-daily-cronjob.yml`).
