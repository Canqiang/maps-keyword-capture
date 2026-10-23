# UAT release verification — 2026-10-23

## Release identity

PR [#5](https://github.com/Canqiang/maps-keyword-capture/pull/5) merged at 02:10:46 UTC (10:10:46 Asia/Shanghai). Merge commit: `009673c82642395dd1699875f86424bc548c4845`. Runtime source: `c48f94f4c4bbfd77496060e96982f3f3ff31d8c8`; its Git tree equals the merge commit's tree (`b7fb007d7b95a26a83e8cef28ad03873651a31fe`). Both PR and merged-main CI passed. Fresh local suite: 1,665 tests / 87 files passed.

Azure ACR built the exact archived runtime source, independently read back as Succeeded:

- Web, build `ch159m`: `fbrdevacr.azurecr.io/ai/maps-keyword-capture@sha256:849d6cb8ff961bbe6c9af866dcea3ae8977544cd42eddaa915785fe731489fda`.
- Android, build `ch159n`: `fbrdevacr.azurecr.io/ai/maps-keyword-capture-android@sha256:227df8650712d68fe14d0e4f251f9386915274f25725dd883e3416fbc08dcd14`.

## Isolated acceptance scope

A fresh `maps-rank-tracking-verify-20261023` database separates tests from production observations and monitoring stores. Source store documents were read only. Web and Android use separate two-store test collections, with KEKE `braised food flushing` and OnlyBear `bubble tea garden city`, one center point per store, two workers per surface. No shared SEO library or historical data was edited.

Real infrastructure checks passed: exactly one of two Mongo gate contenders admitted; the losing round persisted as blocked; simultaneous snapshot initialization read the source once; two independent UI trigger instances using actual Kubernetes Leases created one no-op Job and rejected the other with HTTP 409.

The first infrastructure helper failed before writes because it queried unindexed `storeId` on a server enforcing `notablescan`. The helper was corrected to use `_id`; a new uniquely named Job with a fresh-database guard passed. The original failure evidence is retained. This was not a collector failure.

## Android acceptance boundary

Both Android workers ran the pinned image with zero restarts and exited 2, each persisting one observation. Both GPS readbacks matched their requested coordinates. These are **two review outcomes, zero qualified ranking outcomes**, not successful full ranking collection.

- KEKE: the original first screenshot shows KEKE BRAISED DELI (4.6 / 9 reviews), then Chuan Bistro (4.5 / 426). Later sheet movement clips KEKE's name; the OCR join reports `ordered_overlap_missing`, an unknown card and unreliable sequence. Global rank is null. The retained prefix/target-match rank is diagnostic evidence, not a qualified full-query rank. Chinese-name OCR also has a garbled prefix, while the Latin alias remains readable.
- OnlyBear: the screenshot still shows autocomplete suggestions and the keyboard. The keyword is visible, but result-list navigation was not established. `list_top_unverified` / `no_cards_recognized` correctly prevent a numeric rank. Native search submission and result-state readiness need follow-up.
- The two independent Azure-read manifests and all referenced artifacts persist the review outcomes honestly. No positive Sponsored example occurred in this bounded run; advertisement conflict acceptance remains covered by the offline regression fixtures, not a live positive-ad claim.
- Maps backend location remains unverified even with matching device GPS.

Android must retain its pre-existing suspended schedule. Enabling routine Android ranking collection requires repairing and revalidating the native search-ready and scrolling-overlap cases above. Do not turn these evidence-quality failures into manufactured organic ranks.

## Follow-up acceptance

1. Native submission must leave autocomplete and establish a genuine result-list state before collection.
2. Expand/scroll the result sheet with reliable overlap; clipped or contradictory cards must remain unresolved rather than silently merged.
3. Repeat bounded two-worker verification, including known ad-positive evidence and the two observed failure shapes. Require original PNG/XML/OCR, structured rows, independent receipts and qualified rank coverage; a completed Job alone is insufficient.
4. Preserve retained failure/snapshot/admission records. Do not clear live gates based only on age.

## Web and coordination acceptance

The old Web Job `maps-targets-web-2h-29878635` naturally completed all three workers with exit 0 and no restarts, before starting Web verification. Its summaries reported 575 dispatched/observed queries; this release inspected its runtime completion, not a full independent hash verification of that historical run.

The isolated Web Job `maps-release-web-20261023` completed both workers with exit 0. Both used SHA `a112a59369e21797dea2fc5d902bc2dc86698ef5523244b7fc9d6309fe6cc35c`. At 02:32:25.701Z the snapshot was ready and worker 1 was not yet admitted; only the scratch OnlyBear source keyword changed to `bubble tea mineola`. Worker 1 began at 02:33:55Z and still collected the frozen `bubble tea garden city`. Each store was assigned exactly once. Independent Mongo readback confirms four observations total and both surface gates inactive with finished indexes `[0,1]`.

Web observations were KEKE organic rank 14 and OnlyBear organic rank 2 in this bounded map-view capture. They are observations of this profile, not customer-local ground truth or comparable to the Android partials. Web review counts were absent in the source result cards and remain null.

## Deployment and service checks

The target Web CronJob, suspended legacy Web CronJob, suspended Android CronJob and tracking UI were pinned to the images above. Job UID and stable group environment fields were installed with compatible images; UI received namespace-scoped Lease permissions. Full patched specs were read back. A brief launch freeze was used after old collectors drained, preventing manual/scheduled launch races during cutover. It did not interrupt active collection. The UI rolled with maxUnavailable 0 and its actual imageID/runtime source were checked.

Original schedule/suspend states are preserved: target Web `15 */3 * * *`, America/New_York, enabled; legacy Web remains suspended; Android `0 21 * * *`, America/New_York, remains suspended. This release does not introduce a new two-hour schedule or enable Android. Unrelated daily collectors and ingestion schedules were not updated.

Fixed endpoint: https://maps.connexup-uat.net . After one initial 30-second probe timeout, a diagnostic rerun confirmed all 10 local/public authenticated endpoint checks: health, settings, KEKE store, historical timeline (6 rows), and scan-target listing (2 targets). The exact cause of the initial timeout was not established; the rerun did not reproduce it.

## Evidence scope and handoff

Independent Azure CLI identity read back 73 unique objects; all 67 referenced size/SHA-256 receipts matched. Six objects without such receipts were downloaded/parsed but must not be described as receipt-hash verified. All 18 PNGs were fully decoded, all 38 JSON files parsed, and 6 CSV files read. Android JSON/CSV semantics covered 2 queries and 4 listing rows; Web CSV/JSON comparisons covered all 28 listing rows. Visual review sampled 5 actual PNGs: 2 Web (one per store), 3 Android (KEKE first/final and OnlyBear autocomplete). This is not visual review of all 18 PNGs, nor live proof of advertisement classification across arbitrary layouts.

The private Azure container is `fbrdevstorage/maps-keyword-capture-uat`; exact scan, manifest, screenshot paths, snapshot identities and outcome counters are in [verification-summary.json](verification-summary.json). Raw local execution evidence and downloaded files are retained at `/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/scan-consistency-release-2026-10-23`.

Acceptance: source merge, compatible UAT rollout, Web bounded collection and shared coordination passed. Android evidence capture/delivery worked, but both live rank cases require further repair; keep Android suspended. No production catalog, shared SEO collection or historical observation was edited by this verification.
