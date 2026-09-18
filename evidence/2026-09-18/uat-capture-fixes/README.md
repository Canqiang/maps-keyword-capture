# UAT scrolling, Lodging and execution-status repair — 2026-09-18

The preceding [manual full-capacity verification](../uat-full-verification/README.md) exposed two remaining collector defects: a scroll step skipped the full screenshot for The Hidden House in `brunch near me`, and the `spa` results contained an unsupported name + Lodging card. This revision repairs both and separates observation execution from ranked-coverage status.

- Scroll fallback uses a visible card rather than an off-screen loaded card. Bounded recovery can revisit an uncovered committed occurrence using current geometry; sequence, screenshot, scroll and deadline limits remain enforced.
- An exact Lodging-only format with a distinct business name and valid HTTPS Google Maps place link is supported. Explicit Sponsored labels still win; unresolved advertising and arbitrary standalone categories remain unknown. The browser fixture is reconstructed from screenshot/text evidence, not a saved production DOM.
- Query `partial / non_ranking_result` and original manifest ranked-coverage status remain unchanged. `executionStatus: completed` and exit 0 require every query to be captured or to have a complete, selected-attempt diagnostic PNG, result JSON, CSV and observations record. Remote delivery remains a separate required gate. Other partials, source failures, skipped work and missing evidence remain nonzero. `counts.nonRanking` is a subset of partial, not an additional count to add to the denominator.
- Adapter/profile and layout provenance are `maps-feed-card/v3`. Search keywords, geolocation behavior and geographic assessments are unchanged.

## Local validation

[Validation record](local-validation.json): baseline 321 tests passed. Regression-first verification reproduced the scroll gap and the Lodging format failure. The integrated suite passed **366 tests across 33 files**. After the provenance-only v3 string update, typecheck, contract checks, build and an independent check of the built adapter/layout constants passed. Independent code review found no blocking issues; documentation review corrections were applied.

## Live targeted UAT acceptance

Runtime source `3daa349a05b68d7bdbe5fe1dfe6e20a31c7bf942`, adapter `maps-feed-card/v3`, ACR build `ch144n` (succeeded). Immutable image:

`fbrdevacr.azurecr.io/ai/maps-keyword-capture@sha256:59f7e7db45937ac6103972126e85fc827a06d73474f6144cb709bda194f38868`

Manual standalone collector Job `maps-repair-smoke-20260918t032232z`, Pod `maps-repair-smoke-20260918t032232z-wljcz`, ran **11:23:07–11:24:10 Asia/Shanghai on 2026-09-18**. The actual image ID matched; zero restarts; Pod exit **0**, Job Succeeded. This is a five-keyword collector test, not a new source read, daily-monitor aggregation run, 260-query run or midnight trigger.

| Keyword | Actual observation | Listings / PNGs | Acceptance evidence |
| --- | --- | ---: | --- |
| `brunch near me` | captured / end_of_results | 13 / 3 | All 13 listings covered; The Hidden House at position 10 is fully visible in image 3. Live logs show bounded coverage recovery; end marker visible. |
| `spa` | captured / limit_reached | 15 / 3 | Exact Blue Stone Chateau Yosemite Pool Spa Secluded - Deluxe Villa name + Lodging format reappeared at position 2; classified organic, organicRank 2. All 15 covered. |
| `only bear chicken & boba mineola` | partial / non_ranking_result | 0 / 1 diagnostic | Loaded business detail page, no invented rank. |
| `flushing` | partial / non_ranking_result | 0 / 1 diagnostic | Loaded Queens regional page, no business ranking. |
| `bubble tea delivery mineola` | captured / limit_reached | 15 / 4 | Later query still completed after both details; all 15 covered. |

Original manifest `status: partial` remains truthful for ranking coverage. `executionStatus: completed`, counts 3 captured + 2 partial (both nonRanking), remotePersistence verified and exit 0 reflect complete evidence collection. nonRanking is a subset of partial, so the denominator is five, not seven. No blocked, failed, skipped, unknown-classification or storage-failed outcomes occurred. There was no positive live Sponsored example; ad guards are regression-tested.

Independent **Azure CLI login** readback verified **all 29 referenced objects** (one final manifest + 28 artifacts), **9,374,613 bytes**, every size and SHA-256, all **12 PNG structures**, all **five JSON/CSV attempts with 43 listing rows**, and ten observation records. No cached download was reused. Manual inspection then covered **all 12 PNGs**, all five queries and all emitted listing sequences; see [visual review](visual-review.json). The verifier's immutable report retains its pre-visual-review note; the separate visual review completes that gate. See [readback report](readback-report.json), [object inventory](object-inventory.json), and combined [acceptance](acceptance.json).

Azure account/container: private `fbrdevstorage/maps-keyword-capture-uat`.

Final manifest: `2026-09-18/run_20260918T032308Z_a8fb06/att_bdae7439/manifest.json`.

Receipt: **23,305 bytes**, SHA-256 `5da8699e232c2c79e92246958b6a1a8660106b6ab8e774e563212fdbe75515b8`.

All five geographic assessments remain unverified. Generic brunch/spa maps visibly span broad nonlocal areas. This release fixes collection correctness; it does not establish customer-local ranking or retrospective SEO performance.

## Scheduling constraint and deployment

The first smoke Job, `maps-repair-smoke-20260918t031502z-f91c6`, could not schedule its 500m CPU request. The four matching aiapp nodes had approximately 81m, 231m, 181m and 181m unreserved CPU; actual sampled CPU utilization was only 15–29%. Events reported Insufficient cpu, not an image or application fault. The Pod had no assigned node and no container start. After saving its state/events, that never-started temporary Job was replaced once with the same five-word/image/config test at **200m CPU request, 2-core limit**. No keyword capture had started on the original Pod.

At **11:28:38 Asia/Shanghai**, only `container.image` and `IMAGE_DIGEST` in the enabled UAT daily CronJob were updated. Independent readback confirmed the entire remaining spec and source ConfigMap data unchanged: **00:00 Asia/Shanghai**, enabled, **500m CPU request**, original seven-store source/cap/config. The repository bootstrap manifest remains suspended by design. Four deployment-manifest tests passed after pinning. See [activation readback](activation-readback.json).

**Remaining operational risk:** the daily workload retains its 500m reservation and may queue while node reservations remain full. The 200m smoke does not prove daily schedulability or full-volume performance. This repair did not change node pools, unrelated workloads, location, selection, schedule, or Dev/Prod images. Daily execution-status aggregation is covered by local integration tests; a v3 daily full-capacity cycle has not been re-run.

## Cleanup and preservation

The completed failed verification Job and its owned failed Pod were archived before removal. The [backup ledger](cleanup-backup.json) records exact Job UID and four file hashes (Job metadata, Pod metadata, events, complete Pod log); those files remain in the local evidence directory. After fresh terminal-state and UID checks, Job `maps-monitor-verify-20260918t003315z-544bac` and its owned Pod were deleted using a server-side Job UID precondition. Independent reads confirmed both absent; see [cleanup readback](cleanup-readback.json) for the actual time. The new successful smoke Job was retained for inspection. Azure claims, manifests and original screenshots were not modified or deleted; neither historical partial result was relabeled. The historical duplicate-test Succeeded Job is outside this cleanup.

The existing unrelated primary-checkout edit to `deploy/cronjob/README.md` was preserved byte-identically and excluded from both commits. Full logs, raw downloaded objects, scheduling snapshots and the reviewed reusable verifier are retained locally under `uat-fix-2026-09-18` in the task evidence directory; no SAS or account credentials are included here.
