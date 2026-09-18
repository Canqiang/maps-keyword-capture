# UAT monitor resilience release — 2026-09-18

The midnight cycle exposed a semantic error: recognized business details were counted as unsupported layouts. Three consecutive details stopped remaining keywords and stores. Runtime commit `ed2a128876dd378fc54d37476aa8652905b6071e` fixes that behavior, no-review card classification, visible-feed selection, delayed redirects, and false empty-search detection. Adapter provenance is `maps-feed-card/v2`. Geographic assessment is passive and never changes a query, map view, or browser location.

## Verification

- Local: 320 tests across 31 files passed, plus one added late-transition geography regression; typecheck, contracts and build passed. Four deployment checks passed after pinning the image. Independent code review findings were fixed and rechecked.
- ACR build `ch144e` succeeded. Image: `fbrdevacr.azurecr.io/ai/maps-keyword-capture@sha256:969d8592e7d3369591195d5a102287d3fca39268e36417b49fbf8f4a394315e0`. Image metadata records source abbreviation `ed2a128`, resolving to the full runtime commit above.
- Isolated UAT collector Job `maps-optimize-smoke-20260918t000542z-d345e2` ran from **08:06:04 to 08:07:28 Asia/Shanghai**. Actual Pod imageID matched the pin; zero restarts.

| Query | Observed outcome | Listing rows |
| --- | --- | ---: |
| bakery | captured / limit_reached | 15 |
| slush mineola | partial / non_ranking_result | 0 |
| only bear chicken & boba mineola | partial / non_ranking_result | 0 |
| only bear mineola | partial / non_ranking_result | 0 |
| bubble tea delivery mineola | captured / limit_reached | 15 |
| tea mineola | captured / limit_reached | 15 |

All **6/6 queries were attempted; none were skipped, blocked, or failed**. Three consecutive recognized details did not interrupt the last two queries. Memo Fırın was actually observed with `No reviews / Bakery`, classified organic with null rating; it no longer made the bakery capture partial. This is targeted acceptance of those behaviors, not six complete ranked searches: the Job remains `partial`, Pod exit **2** (`Failed` in Kubernetes), because three queries had no ranked list. No first-place rank was invented for those details.

Independent Azure login readback downloaded and verified **all 36 objects**: final manifest plus 35 referenced artifacts, **12,904,057 bytes**, including **16 PNGs**. Every size and SHA-256 matched. All **45 listing rows** agreed between JSON and CSV. PNG structure and pixel payloads were validated for all 16; visual review covered **6 PNGs**, one first/diagnostic frame per query; [visual-review.json](visual-review.json) records that subsequent review after the machine readback stage. The three detail frames contain loaded business detail panels. `slush mineola` opened Manny's Sweet Treats in Mineola, NY in this smoke, differing from the earlier Texas result; no stable location claim follows from that change. The bakery frame remains geographically broad. No live ad appeared in this smoke; ad behavior has fixture coverage, not fresh live ad acceptance.

The exact final manifest in private account/container `fbrdevstorage/maps-keyword-capture-uat` is:

`2026-09-18/run_20260918T000605Z_db673f/att_9c5e0927/manifest.json`

Receipt: **28,885 bytes**, SHA-256 `fb64c821f2c7c4cfe632650d49fd7889c35197ca13dafa7bec402cc8747adde2`. See [readback report](readback-report.json), [summary](smoke-summary.json), [Pod exit](pod-exit.json), and [launch scope](smoke-launch.json).

## Daily workload update and limits

After acceptance, the UAT daily CronJob was updated by a guarded **image-only patch**. Independent readback at **08:10:43 Asia/Shanghai** confirmed the new digest, `suspend: false`, unchanged `0 0 * * * / Asia/Shanghai`, all seven stores, and cap 40 per store. Source ConfigMap content was unchanged; see [activation readback](activation-readback.json). The committed bootstrap manifest intentionally remains suspended. Reapplying it would pause scheduling; the running workload was patched narrowly instead.

The next scheduled run is **2026-09-19 00:00 Asia/Shanghai**. A full seven-store daily cycle on this image has not yet been observed. This six-query collector test did not re-read all source APIs or re-run the original 260-query cycle; cross-store continuation and source propagation have offline integration coverage. The original run, claim and artifacts remain unchanged. No historical recovery or new monitoring automation was started.

No verified `expectedArea` was added for any store. All six smoke results correctly say `unverified`, including the query-level CSV `geographic_status`; captured does not certify a customer-local ranking. Adding a verified per-store reference can distinguish matched/outside/mixed observed coordinates without changing search location. A full daily run may still return exit 2 for honest partial outcomes, but known detail pages no longer cause the old global skip.

The temporary six-query Job and ConfigMap were removed after all evidence and final Pod/Job state were archived. [Cleanup readback](cleanup-readback.json) confirms both are absent; the original daily Job and all Azure data were preserved.
