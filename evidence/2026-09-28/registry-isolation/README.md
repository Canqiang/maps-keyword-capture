# UAT registry isolation — 2026-09-28

## Result

Promoted the accepted v5 release to the enabled UAT daily CronJob at **2026-09-28 18:12:59 Asia/Shanghai**. The next automatic run is September 29 at 00:00 Asia/Shanghai. This release passed a fresh **10-store, 20-query manual smoke**; the next full-capacity nightly run has not yet been observed.

| Boundary | Verified result |
|---|---|
| Live source preflight | 18 records, 10 eligible stores, 8 excluded records, zero quarantines; 350 selected keywords in 18 production-cap batches |
| Manual smoke | 20 selected and attempted; 19 nonempty ranked lists, one geographic detail (`flushing`), zero other partial/blocked/failed/skipped/source failures |
| Runtime | Original Pod exit 0, zero restarts, expected actual image; ranking `status=partial`, `executionStatus=completed` |
| Independent Azure login readback | All 163 referenced objects: 1 daily manifest, 1 registry snapshot, 10 selection snapshots, 10 batch manifests and 141 artifacts; sizes and SHA-256 matched |
| Structural and semantic checks | All 71 PNGs structurally valid; 251 listing rows reconciled across JSON/CSV; all 20 query attempts checked |
| Visual review | 12 actual PNGs across all 10 stores, including the geographic detail and both repaired `float` card shapes; 31 visible listing rows compared to JSON/CSV with no mismatch |
| Local checks | Typecheck and build passed; 537 tests in 40 files; 65 independent-verifier tests; 3 promotion-guard tests; 4 deployment tests |

The claim was independently read and matched separately from the 163 referenced objects. Full artifact hashes and limited visual sampling are separate scopes. No ad or unknown rows occurred in this smoke, so it does not establish all advertisement-label behavior. Geographic status remains unverified; generic keywords can produce distant results. Szechuan Opera's sampled query displayed a limited-view notice, so that list is not an exhaustive market inventory. Missing visible ratings/review counts remain null, never fabricated as zero.

## Problem and scope

The September 25–28 nightly runs failed before any keyword/browser dispatch because two source records assigned the George Merchant place to different merchant IDs. The user confirmed that George is a test store and should not be captured. The release excludes that exact place (`ChIJqVId_y1ZwokRjPCG1MQuKmg`) with reason `test_store`; no database record was modified or deleted.

Other duplicate or conflicting places are quarantined as complete groups instead of stopping unrelated stores. Configured test exclusions are normal scope. An unresolved quarantine still produces a visible partial/incomplete result with exit 2. Invalid alias configuration, database/record/store bounds and storage failures retain the global stop boundary. A nil merchant UUID is invalid and excludes the placeholder record.

Fresh daily discovery remains enabled. Current eligible source reads selected Royal Queen 40/59, CONNEXION SPA 32/32, Szechuan Opera 18/18 and SEEJOY 40/70, together with the six existing stores. The three newly added merchants were created after the September 28 midnight run. They participated in this smoke and are eligible for the next scheduled run. Actual nightly counts depend on that run's fresh source snapshot.

## Scheduling and parser repairs

The initial 500m manual smoke could not schedule: eligible aiapp nodes had 181–381m unreserved CPU. Its never-started Job was removed after saving evidence. The accepted replacement requests **250m CPU**, retaining the **2 CPU limit**, 1Gi memory request, 2Gi memory limit, storage bounds and node selector. Both replacement smoke runs scheduled and executed. This reduced-cap test does not prove full nightly throughput.

The first v4 smoke attempted all 20 queries and produced 18 ranked captures, one geographic detail and one `float` classification-unknown result, with original exit 2. All 164 referenced objects passed independent evidence checks, but collection acceptance correctly failed. The unchanged `first-*` files retain that outcome.

The `float` screenshots showed exact House and Lodging card variants. v5 recognizes only the witnessed, anchored formats, requires raw/rendered text agreement and preserves sponsored/unknown marker guards. In the fresh smoke, the House at display position 8 and Lodging at 11 are classified organic with their actual categories and null missing fields. Fixtures are documented screenshot/observation reconstructions, not recovered original DOM.

## Release identity and durable output

- Runtime source: `385a14d2615da65859f90fd06b623b560e3edc9f`.
- Adapter: `maps-feed-card/v5`.
- Image: `fbrdevacr.azurecr.io/ai/maps-keyword-capture@sha256:092537407e84318119932b9710809102b141cb37a05f8b10ad9d0c69def10da2`.
- ACR build: `ch14es`; task output and repository digest matched.
- Manual Job: `maps-registry-smoke-20260928t095213z-f1b8c7`.
- Run key: `registry-smoke-20260928t095213z-f1b8c7`.
- Daily run ID: `run_20260928T095251Z_8e7b98`.
- Pod execution: September 28 17:52:50–17:59:13 Asia/Shanghai; Job Complete at 17:59:16.
- Azure account/container: `fbrdevstorage/maps-keyword-capture-uat`.
- Manifest: `2026-09-28/daily/run_20260928T095251Z_8e7b98/manifest.json`.

The image was built from the runtime commit above; later commits only pin the image and record acceptance. Deployment used the guarded helper after independent readback and visual review. It preserved the enabled `0 0 * * *` / `Asia/Shanghai` schedule, Forbid policy, deadlines, limits and unrelated settings. The checked-in CronJob remains suspended as a bootstrap safety default; it was not reapplied wholesale to the live task. No historical failed nightly run was relabelled as successful.

## Evidence

- `source-preflight.json`, `local-validation.json`: source and test scope.
- `smoke-launch.json`, `smoke-summary.json`, `original-pod-exit.json`, `claim-readback.json`: exact run and original exit.
- `readback-report.json`: all referenced-file verification, outcome denominators and limitations.
- `visual-review*.json`: sampled PNG object keys and field comparisons. Local absolute paths are inspection provenance; durable files remain in Azure.
- `runtime-review.json`, `verifier-review.json`, `release-script-review.json`: independent reviews.
- `promotion.json`, `independent-deployment-readback.json`: deployment and fresh independent readback.
- `verifier/`: reviewed full-daily verification helper and 65 local tests.
- `promote.py`, `test_promotion_resources.py`: reviewed release guard and resource regressions. This one-off helper retains its original local evidence/worktree bindings for audit and must not be blindly replayed.
- `first-*`, `float-diagnosis.json`: unchanged first candidate evidence.

Full logs, downloaded artifacts and screenshots remain in the local release evidence directory and Azure, not in Git. No credentials are included. No GitHub Actions checks were configured; test evidence is local and UAT-specific.
