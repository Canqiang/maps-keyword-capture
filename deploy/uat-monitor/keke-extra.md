# Keke unlocated daily supplement (UAT)

Effective for scheduled runs from 2026-11-03 Beijing midnight. The existing daily monitor retains its 40 Keke exact queries. The companion CronJob uses the same pinned collector image and capture profile for the 22 remaining exact queries. Their union matches the 52 configured targets and ten enabled best variants at rollout. Both lists are explicit snapshots: reconcile the sets when editing keyword targets. Do not add a query to both lists.

The supplement is scoped to Keke's existing store, merchant and place identity, uses the normal mandatory source API read, and never modifies the shared library. Its `keke-extra-YYYY-MM-DD` Beijing-date claim is distinct from the primary claim. Evidence is saved under the standard date/store/run paths; the existing 04:00 Beijing ingest verifies batch receipts and appends results to `r0c0` (query-only). No historical backfill. A landmark in a query is not verified device or search-backend location. All three fixed-point runs remain separate from the unlocated column.

The additional task requests the existing daily pod's resource envelope during its two batches. Check its original exit, selected keyword count, manifest and next ingest before reporting actual coverage. To suspend just the supplement, suspend `uat/maps-keke-extra-daily`; preserve the primary CronJob, historical evidence and claims.
