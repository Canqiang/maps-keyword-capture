# UAT daily keyword monitoring

Status: confirmed product direction and schedule; the UAT keyword-source integration and scheduled workload are not implemented or deployed. The existing `deploy/cronjob/` workload is a separate Dev fixed-keyword batch, not this UAT monitor.

## Confirmed schedule

- Run once each day at **00:00 Beijing time**.
- Kubernetes schedule: `0 0 * * *`.
- Kubernetes time zone: `Asia/Shanghai` (UTC+08:00).
- Use `Asia/Shanghai` for the date folder and filename timestamps as well.
- Browser timezone remains the recorded search-profile setting (`America/New_York`); scheduling timezone must not silently change the Google search profile.
- Deployment target: UAT. The user will deploy to UAT; confirming the schedule does not mean a live UAT resource already exists.

Configuration fragment for the future UAT CronJob (not a deployable manifest):

```yaml
metadata:
  namespace: uat
spec:
  schedule: "0 0 * * *"
  timeZone: Asia/Shanghai
  concurrencyPolicy: Forbid
```

`Forbid` applies to scheduled Jobs belonging to the same CronJob; a separate manual Job is not covered. The UAT dispatcher must also identify work by scheduled date, store, and keyword-selection snapshot to prevent duplicate dispatch. Failed, missed, or delayed runs must remain visible rather than be treated as completed daily coverage.

## Daily flow

1. Enumerate enrolled stores and read their latest UAT local keyword records.
2. Validate merchant and Place ID linkage; record missing/invalid stores explicitly.
3. Select up to 40 distinct keywords per store. The current database has P0–P3 priorities and no numeric score. Use priority order, then stable source order within a priority; preserve original query text. Fewer than 40 words means collecting the available words, not inventing more.
4. Save the source record identifiers, update time, selection policy, and exact daily selection before launching browser work.
5. Split each store into batches of at most 20 keywords, matching the existing collector limit. Control concurrency across stores; a per-batch CAPTCHA stop must propagate to the daily dispatcher rather than immediately starting another batch on the blocked environment.
6. Run query-only Google Maps searches without setting coordinates. Keep display position, organic rank, and ad status separate; save original PNG evidence and JSON/CSV.
7. Upload to Azure Blob, independently read back and verify artifacts, and publish per-batch and daily manifests. Collection quality and delivery success are separate states.

## Proposed output organization

```text
<Beijing-date>/<store-id>/<daily-run-id>/
  keyword-selection.json
  batches/<batch-id>/<worker-attempt-id>/
    <query-id>/<query-attempt-id>/
      <timestamp>__<keyword-slug>__<query-id>.json
      <timestamp>__<keyword-slug>__<query-id>.csv
      <timestamp>__<keyword-slug>__<query-id>__01.png
      observations.jsonl
    manifest.json
  manifest.json
```

This store-level daily wrapper extends the existing collector's date/run/attempt layout and is not currently implemented. IDs prevent same-keyword or same-day reruns from overwriting evidence. Use the scheduled Beijing date for daily grouping and record actual start/capture timestamps separately, including delayed runs.

## UAT source inventory and remaining work

A direct read of `uat` MongoDB database `seo-integration`, collection `local_keywords`, at `2026-09-17T13:21:50.308Z` found 12 records / 708 keywords. Seven records have merchant and Place IDs and would yield 260 queries in 13 batches under the per-store cap. Five legacy records lack linkage. This is a data inventory, not confirmation that all seven stores are enrolled for monitoring; store identity and enrollment still require validation.

Prefer the service boundary `GET /seo/keyword/local/{place_id}` for keyword reads. A store registry or enumeration API is still required; do not confuse one-Place-ID lookup with a full-store-list endpoint. Empty `target_surface_types` must not silently remove a store's entire local pool.

Before activation, implement and test store discovery, source snapshots, selection, dispatch and daily aggregation, canonical business identity matching for own-store summaries, and UAT storage access. Verify a manual UAT cycle with Azure readback before enabling the CronJob. Do not copy the existing Dev fixed-keyword workload to UAT and describe it as automatic database-driven monitoring.

Historical results remain immutable. Comparisons use matching keywords and compatible search profiles, and expose changes to the daily selected keyword set. A store absent from the collected first 15 displayed results is recorded as not observed in that scope, never as rank 16.
