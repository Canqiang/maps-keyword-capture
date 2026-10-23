# Durable Android command diagnostics — 2026-10-23

## Result

Diagnostics are implemented and independently verified in Azure. **KEKE collection is still partial; the prior Appium fault was not reproduced or claimed fixed.** No production promotion, schedule change, shared keyword mutation or branch push/merge occurred.

Source: `de28c6b0662709538ba0f3d9abc2dc2bff471b86`; ACR `ch159x`; image `sha256:53b8128b93d36d1b0697c9bbf6aa65720a11e56f6093f7c42b6ae722b2f896d2`. Job/database `maps-android-command-log-20261023`, single worker, same KEKE `braised food flushing` center point and capture profile. Collection ran12:52:10–12:57:09 Asia/Shanghai, original exit2, no restarts. Sidecar exited0.

## Implemented contract

`command_log` artifacts persist bounded allowlisted metadata: phase/category, sequence/time/duration, HTTP status, W3C error class and response type. They never retain query text, credentials, arguments, native session/element IDs, response bodies, stack traces or raw server messages. The cumulative session journal contains last256 commands and first32 failures with dropped counters. Immutable checkpoints at start, location/search completion, every5 selected frames, query-final and close use existing bytes/SHA-256/verified-storage receipts. Failed diagnostic persistence retains the original error and stops later queries before any location/device operation. Abrupt node loss/SIGKILL can still lose commands after the last checkpoint.

This real run produced11 checkpoints. Their overlapping retained windows recover all794 sequence entries with no conflicts or failed commands. The exact single editor action, result-sheet expansion and all scroll commands completed. Four events were safely categorized as `other`; a subsequent two-test local change adds only fixed settings/nested-element/clickable/content-desc route labels. It is not a new device behavior and was not part of this image.

## Native result and diagnostic limit

32 original ranking screenshots were retained,30 selected, with two bounded backward corrections. At frame31→32, the same visible Braised Canaan merchant has unstable OCR name/status text. Ordered overlap is not established, so the query ends `ranking_unreliable`.13 listing rows remain diagnostic evidence (12 verified organic occurrences plus an unverified continuation); final query rank is null. The first screenshot shows KEKE first,4.6/9, but this is not a complete accepted query.

The old Appium error happened before ranked frames and had no durable failed-command trace. This instrumentation-only run crosses that point without reproducing it. Its cause remains unknown; checkpoint I/O changes timing, so this successful command path does not rule out an earlier race. No speculative stale-element/transport retry is introduced. The new OCR boundary is distinct and must not be reported as the old Appium cause. See [remaining-ocr-boundary.json](remaining-ocr-boundary.json) for exact original artifact keys and receipts.

## Verification scope

- Full Azure CLI identity readback, separate from collector SAS:149 objects downloaded;148 exact writer receipts pass bytes/SHA-256. The top-level tracking `scan.json` has no external exact receipt and is only downloaded/service-length checked.
- Every downloaded PNG fully decoded (33), XML parsed (33), JSON parsed (81);2 CSVs compared against query/manifest selected fields (1 query,13 rows).
- Visual sample:3 actual PNGs, first target plus failing frames31/32. Zero ads were observed in this query; it does not validate all ad layouts. Device GPS matched and viewport followed; Google backend geography remains unverified.
-1,702 TypeScript and30 Python tests passed; typecheck/contracts/build passed. The route-label follow-up adds2 locally passing test cases (existing test count), with repeated typecheck/contracts/build. Independent review has no remaining blockers in the diagnostic changes.
-7 protected workload specs and15 existing ConfigMap data hashes unchanged. Android remains suspended on the previous production image. Only the isolated verification database was seeded/written. No old failure, claim or gate was cleared.

Evidence: [final-validation.json](final-validation.json), [command-audit.json](command-audit.json), [runtime-audit.json](runtime-audit.json), [structure checks](structure-readback-report.json), [visual review](visual-review.json), [software validation](software-validation.json), [protected audit](protected-audit.json).

Account/container: `fbrdevstorage/maps-keyword-capture-uat`.
- Android: `android-maps/2026-10-23/run_20261023T045212Z_cabf64/`
- Tracking: `tracking/android/2026-10-23/point/android_scan_20261023T045211Z_0abd81/`

Durable local readback and original logs are under `/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/android-command-diagnostics-2026-10-23/diagnostic-probe/`; `durable-readback-report.json` maps object keys to local bytes. A bounded local Appium tail supplements the metadata but is not a complete server-log guarantee.

## Next owner

Read [handoff](../../../docs/android-ranking-repair-handoff.md). Preserve this failed/partial run. Use a new isolated DB and run identity for any accepted follow-up. On any Appium recurrence, inspect the earliest failed sequence and phase before modifying collection behavior; do not automatically retry an uncertain submit. Repair the evidenced OCR boundary with original fixtures and negative identity/ad cases separately. Require successful KEKE complete-list and OnlyBear control validation before considering promotion, followed by parallel/full-catalog capacity validation.
