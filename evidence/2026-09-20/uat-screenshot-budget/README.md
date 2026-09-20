# UAT screenshot-budget repair — 2026-09-20

## Problem and scoped change

The September 20 midnight run executed all 260 selected queries, but Szechuan Gourmet's `sichuan restaurant near Columbia University` returned `partial / screenshot_limit`. Fifteen listings were parsed; the fifth image left listing 15, Famous Sichuan, clipped by 48 pixels. The first five screenshots covered 3, 3, 4, 1 and 3 new cards. A lazy-load scroll clamp consumed a frame with only one new card. The existing recovery logic was correct but could not save a sixth image under the five-image cap. The Pod's original exit 2 correctly represented this incomplete evidence.

Only the UAT configuration changes: `maxScreenshotsPerKeyword` 5 → 8 and `maxScrollsPerKeyword` 6 → 10. These remain upper bounds; complete coverage still stops early. The 90-second deadline, 50 MiB screenshot budget, first-15 limit, full-card visibility requirement, order verification, capture semantics, source selection and geographic behavior are unchanged. No runtime code or image change is needed. Standalone/Dev defaults remain unchanged.

## Regression and review

A real Chromium DOM fixture replays the recorded varying card heights, lazy append and exact initial offsets 0, 653, 1346, 1749, 2401. With the old UAT configuration the complete-coverage test failed on `partial / screenshot_limit`. With the revised configuration, the sixth screenshot at offset 3114 fully covers the fifteenth card. All 15 listing screenshot references and persisted PNG/JSON/CSV evidence pass. An explicit five-image cap and four-scroll cap still return honest partial results.

Typecheck, contract tests, all **369 tests across 34 files**, and build passed. Independent review found no blocking changes. See [local regression](local-regression.json) and [validation](validation.json).

## Targeted live validation

A separate three-keyword collector Job used the unchanged pinned daily image and the revised capture budget, with the same 500m CPU request, security settings and private UAT storage. Pod `maps-budget-smoke-20260920t060538z-gzn2r` ran **14:09:06–14:09:56 Asia/Shanghai**, exit **0**, zero restarts. It was not a new daily source read or a 260-query rerun.

| Keyword | Result | Listings / PNGs |
| --- | --- | ---: |
| `sichuan restaurant near Columbia University` | captured / limit_reached, complete screenshot coverage | 15 / 5 |
| `brunch near me` | captured / end_of_results, complete screenshot coverage | 10 / 3 |
| `only bear chicken & boba mineola` | recognized non-ranking detail, diagnostic evidence complete | 0 / 1 |

The live list order changed and needed only five images; this smoke does not independently reproduce the sixth-shot condition. The deterministic original-geometry regression proves that condition. The legacy ranking status remains `partial` because of the detail page; `executionStatus=completed` and exit 0 correctly reflect complete collection evidence.

Independent Azure CLI login readback validated **all 20 referenced objects**: one manifest and 19 artifacts, **8,747,740 bytes**, exact sizes/SHA-256, all **9 PNG structures**, all **25 CSV listing rows**, JSON and accepted-observation screenshot references. Separately, four PNGs were visually inspected across all three queries: final Sichuan frames, brunch end-of-list, and Only Bear diagnostic. Full hash validation does not imply all nine screenshots were visually reviewed. No positive live advertisement classification case was established.

All geographic assessments remain unverified. The brunch map spans Colorado; capture success does not prove customer-local ranking. See [acceptance](acceptance.json) and [visual scope](visual-review.json).

Azure account/container: private `fbrdevstorage/maps-keyword-capture-uat`.

Manifest: `2026-09-20/run_20260920T060907Z_12ca3e/att_71beffcf/manifest.json`.

## Activation and preservation

At **14:12:46 Asia/Shanghai**, after validation, a resource-version/data-guarded patch changed only the two UAT capture budgets. Independent readback confirmed exact expected configuration and the entire CronJob spec unchanged: enabled, `0 0 * * *`, `Asia/Shanghai`, same image, resources, seven stores, cap 40 and batch size 20. The next scheduled run consumes this ConfigMap. See [activation readback](activation-readback.json).

The September 20 failed Job and its original Azure evidence were not deleted, rewritten or relabeled. The standalone smoke has its own run ID and ConfigMap. No claim, keyword, location, Dev/Prod workload or schedule changes were made. The unrelated primary-checkout `deploy/cronjob/README.md` edit was preserved and excluded from this change. Full logs, runtime snapshots and the unchanged reviewed readback helper are retained in the local `uat-screenshot-budget-2026-09-20` evidence directory.
