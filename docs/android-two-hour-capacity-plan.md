# Android two-hour capacity plan

Status: 2026-10-26, planning only. The user chose **no expansion now** and prioritizes Web. Do not scale the node pool, increase worker completions, or enable production Android from this document. The 27-query probe is complete: 18 complete listings and nine needs-review outcomes, both original exits 2. It is not full-catalog acceptance.

## Current boundary

The frozen production plan has 356 Android keyword/point searches across nine stores. The existing dedicated crawler has 4 vCPU / 16 GiB and runs two workers. Per worker, the tracking container requests 150m CPU / 512 MiB; the restartable emulator sidecar requests 1,500m CPU / 5 GiB. Together the two workers reserve 3.3 CPU / 11 GiB, before node overhead. Current limits allow CPU contention, so adding more workers to this node is not a safe capacity fix.

A two-hour interval allows at most 40.4 seconds per query on two perfectly balanced workers, before boot, point changes, persistence and scheduling overhead. With a 110-minute execution budget the limit is 37.1 seconds, even before startup. Prior complete representative native captures were materially slower. The present probe measures one existing keyword at each of three existing points for all nine stores (27 searches), retaining command logs, OCR diagnostics and screenshots.

## Measure before choosing resources

Record startup, first/last query timestamps, query durations, frame/OCR counts, timeouts, point-change durations and persistence separately for each worker and store. Use the actual full-plan store/keyword weights, not a simple average of the 27 equally sampled store/point cases. Ads, ambiguous overlap and long result lists can be much more expensive.

For orientation only, assuming 100 usable capture minutes per worker within the 110-minute budget:

| Mean full-plan query duration | Ideal lower-bound workers for 356 searches | Two-worker nodes, if validated |
|---|---:|---:|
| 1 minute | 4 | 2 |
| 2 minutes | 8 | 4 |
| 3 minutes | 11 | 6 |
| 4 minutes | 15 | 8 |

These are arithmetic scenarios, not measured requirements or a deployment recommendation. They exclude imbalance and variability. Add measured safety margin; verify quotas, KVM availability and actual allocation before approval. Obtain Azure pricing for the chosen region/SKU only after selecting a feasible layout.

## Measured 27-query probe

On October 26 the two workers took 67.4 and 66.1 capture minutes for 15 and 12 searches, respectively: 133.6 worker-minutes / 27 searches, approximately 4.95 minutes/search for this selected mix. This includes query recovery and evidence work; emulator startup adds approximately seven minutes before capture. All primary OCR processes succeeded, yet nine queries remained partial because of continuity, scrolling and classification. Faster OCR alone is not acceptance.

A purely linear extrapolation would take about 14.7 hours on two workers for 356 searches. At 100 usable minutes/worker, that arithmetic would need 18 workers / nine two-worker nodes. **This is a sensitivity calculation, not a sizing recommendation:** the sample is small, equally weights stores instead of the real catalog, contains nine partial outcomes and does not measure scaling or full-plan variance. Do not spend on that extrapolation. First repair the remaining ranking/scroll cases, reduce measured overhead without losing evidence, implement query-level sharding, then benchmark a weighted/full round. No expansion is authorized.

## Required implementation before horizontal scale

1. Freeze the round's complete `(storeId, keyword, pointId)` query set and assign immutable query-level shards. Whole-store sharding leaves KEKE's 74 searches indivisible and can exceed two hours regardless of the total worker count.
2. Separate global shard identity from local emulator/runtime identity. The current runtime only supports local slots 0 and 1; increasing Job completions alone is unsafe.
3. Give each node/worker an independently verified runtime volume or otherwise validated storage layout. The retained RWO PVC and exclusive roots cannot simply be shared across arbitrary nodes.
4. Preserve admission/gate protection, exact coverage reconciliation, original command logs, screenshot receipts and honest null/partial/ad classification. Do not convert lock refusals or Forbid skips into successful collection.
5. Validate the full current 356-query denominator with real concurrent execution, independent artifact readback and ingestion reconciliation, finishing within 6,600 seconds with operational headroom. A 27-query representative probe cannot establish this.

Until these gates are met, keep Android paused and retain the completed Web schedule independently. No shared SEO keywords, historical observations, Web collector configuration or daily monitor need to change for this plan.
