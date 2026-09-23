# Automatic store discovery — UAT release, 2026-09-23

## Released behavior

The enabled UAT daily CronJob now discovers linked stores from `seo-integration.local_keywords` at startup, saves the discovered registry, then reads each store's current keywords through the existing API. It selects up to 40 keywords per store by priority and stable source order. The seven existing storage IDs remain stable; new stores receive deterministic place-derived IDs. New linked stores with nonempty keywords enroll on a subsequent daily cycle without editing the roster. Missing identities are explicit exclusions; discovery errors/capacity overflow do not use stale aliases as a fallback.

The fresh source probe found 13 records: eight linked stores, including SEE JOY 喜聚, and five unlinked legacy exclusions. All eight API reads succeeded, selecting 300 keywords across 15 batches at the daily cap (six original stores × 40, Szechuan Gourmet × 20, and SEE JOY with 40 of 43 available keywords). This was a source probe, not a 300-query browser run. See `live-source-probe.json` and `live-source-registry.json`.

## Runtime and deployment

- Runtime commit: `a530fdb6d5e65ffb25943cf97dcb959aecb486fc`; adapter `maps-feed-card/v4`.
- ACR build: `ch14at`; image digest `sha256:0f430d59eeac7106679448f3dd6ce385aed3b43dc71420d0c73d31cb1b43f2c0`.
- UAT promotion independently read back at **2026-09-23 10:39:35 Asia/Shanghai**: image, `IMAGE_DIGEST`, source Secret reference, and discovery config matched.
- Schedule remains `0 0 * * *`, `Asia/Shanghai`, `suspend=false`; a full cap of 40 keywords per store. The existing resource requests, deadlines and concurrency policy were preserved. The committed bootstrap manifest intentionally remains suspended; it was not blindly applied to the enabled workload.
- Next eligible scheduled cycle: **2026-09-24 00:00 Asia/Shanghai**. That future trigger and full 300-query coverage have not been verified by this release.
- Dev/production workloads and source database records were unchanged. Existing Azure claims were neither deleted nor overwritten; each manual smoke used a new run key and claim. The unrelated dirty `deploy/cronjob/README.md` was preserved byte-for-byte.

See `image.json` and `promotion.json`. A separate deployment GET at **2026-09-23 10:42:08 Asia/Shanghai** matched the promoted CronJob spec and config; see `independent-deployment-readback.json`. The initial Azure authentication failure in `release-blocker.json` is historical and resolved by user reauthentication.

## Acceptance: separate selection, execution, ranking and storage

The unique manual smoke `discovery-smoke-20260923t022732z-77cd31` used the same config as the promoted daily workload except **two keywords per store**. It freshly discovered 8 stores and selected and executed 16 queries across 8 batches. Pod `maps-discovery-smoke-20260923t022732z-77cd31-6kdrc` ran from 10:27:43 to 10:32:54 Beijing time on 2026-09-23, finished with its original exit code 0 and zero restarts; its actual `imageID` matched the pinned digest. The Job completed at 10:32:57.

| Outcome | Queries |
|---|---:|
| Nonempty ranked captures | 15 |
| Recognized geographic detail (`flushing`, no rank) | 1 |
| Explicit no-results | 0 |
| Other partial / blocked / failed / skipped | 0 |
| Source failures | 0 |

The daily ranking status is `partial` because the geographic detail is not a ranking list. Execution is `completed`; `nonRanking: 1` is a subset of `partial: 1`, not an additional query. The smoke is accepted for complete scoped execution, not 16 ranked results.

Daily manifest: `2026-09-23/daily/run_20260923T022744Z_cca993/manifest.json` in private Azure container `fbrdevstorage/maps-keyword-capture-uat`. The independent claim read and final receipt bind the same run/config identities; see `accepted-claim.json`, `accepted-smoke-summary.json`, `accepted-pod-exit.json` and `accepted-readback.json`.

## Independent evidence verification

An Azure CLI login identity, separate from the Pod SAS, downloaded and verified **all 132 referenced objects**: 1 daily manifest, 1 registry snapshot, 8 keyword-selection snapshots, 8 batch manifests and 114 batch artifacts. All byte counts, totaling 49,023,740 bytes, and SHA-256 receipts matched. The helper structurally checked 58 PNGs and compared all 213 CSV rows, 16 result attempts and their observations and coverage. Claim readback is separate from those 132 objects. Verification covered all referenced artifacts from every attempt.

The reviewed v4/discovery verifier is included under `verifier/`; 42 offline tests passed and an independent reviewer reran them. Helper SHA-256: `54d44090f248501fedf948c1690bbcf612a6e1e00767ceed53986d1ef157c9a0`. The original first-smoke v3 helper and evidence were not rewritten. Registry `sourceResponseHash` cannot be reconstructed from the snapshot alone because eligible source-document IDs are not retained; persisted-file integrity is fully verified separately.

Visual QA viewed **10 actual PNGs across all 8 stores**, including the geographic detail and the Apartment card for `float`, and compared visible order/fields to JSON. This is a visual sample, not inspection of every screenshot or proof of every ad label. All 213 selected rows were classified as organic; no live Sponsored variant was exercised. Generic terms show Colorado or broad US maps; every query's geographic relevance remains unverified. Screenshots are not customer-local rank proof.

Known scope limits: the final Urban Float card displayed a 5.0 rating and 2 reviews, so the live retest exercised a rated variant; the original no-rating Apartment shape is supported by reconstructed classifier/browser regressions, not re-observed live in the second smoke. That rated variant's captured category was null even with a visible Apartment label. A Google automatic Hamburger chip was visible in the burger sample while `context.filters` was empty; complete UI filter-state capture is not established. These limitations are preserved in `accepted-visual-review.json`.

## First smoke and bounded parser repair

The first image, `b8204c5f…`, used runtime `e613fbf` and build `ch14ap`. It discovered the same 8 stores and executed 16 queries. It correctly exited with code 2: 14 ranked captures, 1 geographic detail and 1 `classification_unknown` for `float`. All 132 objects passed independent receipt checks; that did not make collection complete. Its original summary/readback and `apartment-layout-observed.png` remain preserved.

The unknown was an Apartment vacation-rental card at position 10 with occupancy and amenities but no rating/reviews/address. v4 adds a narrow matcher requiring an exact name, an HTTPS Google Maps place URL, the Apartment category, positive occupancy, Directions and known observed amenities. Extra unsupported text or ambiguous ad labels remain unknown; owned Sponsored precedence stays intact. Tests reconstruct the evidenced screenshot/text shape and do not claim raw-DOM replay.

## Local verification

Typecheck, build, and **454 tests across 38 files** passed, plus 7 deployment tests after the final image pin. Independent review found no blockers. The Apartment/ranking subset had 88 passing tests and 7 browser-pipeline tests (including existing lodging/no-review layouts). See `local-validation.json`.
