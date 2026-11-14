# Unlocated monitoring cadence

The existing unlocated series is collected every two hours from 2026-11-13. Historical resource names and the UI label `日监控 · 未定位` are retained so existing links and histories continue to work. This is still query-only Google Maps search without a configured camera/GPS position; it is not a fourth geographic sampling point.

## Execution and data flow

- `maps-keyword-monitor-daily`: `0 */2 * * *`, Asia/Shanghai; 110-minute Job deadline.
- `maps-keke-extra-daily`: same schedule; existing 90-minute deadline.
- Both retain `Forbid`, existing image, resources, keyword sources and capture configuration. Each Pod obtains `MONITOR_JOB_NAME` from `metadata.labels['batch.kubernetes.io/job-name']` and passes it to `--run-key`. Distinct scheduled Jobs therefore have distinct atomic Azure claims; Pods of one Job share a claim. Old date-based claims and all history remain intact.
- `maps-tracking-ingest-daily`: `30 1-23/2 * * *`, Asia/Shanghai; imports 90 minutes after each planned collector start, retaining the existing read-only Azure credentials and append-only Mongo writes. It scans today's and yesterday's Beijing-date folders, verifies selected JSON receipts, then inserts missing observations. A late batch is imported by the next pass.
- Display keeps the actual observation timestamp, `r0c0`, `query_only`, source profile and evidence keys. The existing ingestion contract can retain a store-center fallback in the point fields; this is not browser GPS evidence. `query_only` remains excluded from comparable geographic cohorts, so more samples do not establish geographic equivalence or SEO improvement.

## Capacity and release scope

The 2026-11-13 midnight primary run selected355 searches across10 discovered stores and completed in47m06s. Keke's unchanged supplement selected22 in2m46s. The existing ingestion completed in11seconds. These support increasing frequency on current resources, but do not guarantee every future slot will finish: `Forbid` skips/defers overlap; late starts, shutdown grace and source growth can reduce the scheduled12daily rounds. There is no node expansion.

The ingestion reader currently rechecks all batches and results in both date folders, including existing rows. Monitor its duration as the two-day history grows to24rounds; the observed11seconds is a low-frequency baseline, not a fully populated high-frequency capacity test. Its deadline remains1800seconds. Keep the same cadence unless measured duration requires an incremental checkpoint design.

Only these three CronJob schedules/templates are changed. Located center/3km/5km collection, Web UI, weekly search volume synchronization, Android, shared SEO stores, all keywords and screenshots are preserved. Future Jobs use the updated templates; existing Jobs are not modified.

## Verification and rollback

Regression tests cover stable Job-name claims across retries/date changes, two distinct same-day collection runs, multiple intraday observations and append-only repeat ingestion. Two isolated real probes use3existing Keke words including `法拉盛 卤味外卖`; independently verify Azure sizes/SHA-256 and original Pod exits, then reconcile Mongo/API observations.

A cadence rollback changes only the three schedules back to their previous values and restores the primary deadline if required; retain Job-name run keys and all claims/history. Never delete claims or historical observations to make a retry pass. Deployment evidence records whether future automatic slots were actually observed; a manual probe is not proof of scheduled execution.

## Unlocated trend display (2026-11-14)

The original chart required a non-null geographic cohort before drawing a line. Query-only records deliberately have `cohortKey=null`, so increasing collection frequency added dots but could not connect them. The UI now draws a separate dashed observational line in both the overview sparkline and expanded chart, including the unlocated overlay beside center/3km/5km.

`unlocatedSeries` connects only eligible numeric natural ranks with the same store, target place ID, keyword key, surface, point ID, query-only mode, profile hash and adapter version. Failures, absence, non-ranking results, incomplete provenance, changed identity/method, invalid or duplicate timestamps and gaps over36hours break the line. The36-hour threshold retains daily historical continuity without bridging multi-day missing periods. Visible-range clipping starts a fresh SVG path correctly.

This is presentation only: the dashed line does not prove the searches came from the same geographic location. The page states `未定位虚线仅表示观测趋势，地域未核实`. Geographic cohorts remain null; comparable rank deltas, SoLV/ARP/ATRP, ingestion and collection logic are unchanged. Existing historical coordinates are not promoted into GPS evidence. Ads and non-ranking outcomes are not plotted as natural ranks.

Release scope is only the `maps-tracking-ui` Deployment image; all CronJob specs, keywords, points, resources, databases and screenshots stay unchanged. Roll back only that Deployment image if needed. See `evidence/2026-11-14/unlocated-trend-lines/README.md` for the tested snapshot, live readback and rollout outcome.
