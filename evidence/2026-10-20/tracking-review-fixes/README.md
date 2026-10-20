# Combined tracking review fixes — 2026-10-20

Base: `cac847388f47015a6c1555c7d9e38a76b57ddbe1`.
Branch: `codex/fix-tracking-review-20261020`.

This change addresses the v5/v6 local reviews and the Android/grid defects carried forward by both. It was developed in a separate checkout. No cluster, Azure, MongoDB, image, schedule, shared SEO keyword library or GitHub mutation was used for validation. The existing desktop collector and daily monitor source are unchanged.

## Repair ledger

| Area | Repaired behavior | Regression coverage |
|---|---|---|
| Store discovery | Plans and both ingestion paths resolve Mongo-backed stores; history imports include inactive stores, without scan sharding. Stored timestamps are removed before strict config validation. | `tracking-command-regressions.test.ts` |
| CLI/config | Valueless `--list`; normalized duplicate keywords; Android-compatible input bounds; strict database-store validation; bounded batch sizes. | `tracking-command-regressions.test.ts` |
| Android grid planning | Canonical signed grid IDs accepted only in location IDs; existing store-ID/path constraints retained. | `grid.test.ts`, `tracking-command-regressions.test.ts` |
| Store context | Point geometry, grid snapshots and keyword tiers scoped to store; fresh grid observations retain parent grid run identity. Historical imports cannot invent a current grid snapshot. | `tracking-web-scan.test.ts`, `domain-ingest.test.ts` |
| Scan result | Collector partial/error status and failed manifest/summary delivery propagate. Unverified Azure evidence is not ingested, including manual imports with byte/SHA-matched final receipts. Complete non-ranking evidence remains distinct from ranked capture. Existing bounded ingestion retry retained. | `tracking-web-scan.test.ts` |
| Ingestion | Separate ad/organic target occurrences; preserve unknown identity, non-ranking and unreliable results, quality and location provenance. | `domain-ingest.test.ts`, `domain.test.ts` |
| Evidence/identity | Resolve real local screenshot filenames and remote keys; stable source-query IDs survive file recovery; missing geometry stays null. | `domain-ingest.test.ts` |
| Android cards | Preserve repeated merchant/branch/ad occurrences; require ordered overlap and top-state evidence; gate OCR/ad confidence; short CJK aliases; unreliable organic ranks are null. | `android-screen-reader.test.ts`, `android-runner.test.ts` |
| Android scrolling | Duplicate images and no-new-result stalls no longer prove the list ended. Explicit terminal evidence is required, and a terminal screen truncated at the displayed-result cap cannot prove list end. | `android-runner.test.ts` |
| Grid metrics | Verified rank/absence eligibility, actual coordinate agreement, captured geometry/run isolation, unavailable empty denominators. | `grid.test.ts`, `tracking-reliability.test.ts` |
| Repository | Separate channel summaries, exclude failed ranks, protect merchant/location identity, compare compatible profiles, return newest bounded history, close failed initialization clients. | `tracking-reliability.test.ts`, `tracking-ui.test.ts` |
| UI/server | Retain expected area on edits; trend gaps/status; route and panel race protection; preserve missing-result trend gaps and valid peers of a failed grid point; guarded malformed URLs and async errors; same-origin JSON write checks. | `tracking-reliability.test.ts`, `tracking-ui.test.ts` |
| Operations docs | Build a suspended CronJob manifest before apply; construct read-only Job arguments before creation. Neither procedure was executed. | Documentation review; existing deployment-contract tests |

## Compatibility and scope

- Legacy observations are retained. Missing quality/provenance is explicitly unavailable for comparable metrics, not automatically trusted.
- Source-query IDs are versioned; no existing database rewrite or migration occurs here. Historical re-ingestion across versions needs a reviewed deduplication/migration plan.
- Store identity and center cannot be changed in place. Different merchant identities use new IDs. Moving the same Place ID requires a separately reviewed migration because the collection keeps Place IDs unique.
- Android scheduling and shared SEO-library synchronization are still separate integration work. Existing tracking configuration does not prove those capabilities run automatically.
- The UI remains intended for controlled internal access. Same-origin/JSON checks do not replace authentication for public exposure.
- Tests replay synthetic/local evidence. They do not constitute a new live Maps App or Google Web acceptance run, nor proof of deployment.

## Validation

- `npm run typecheck`: passed.
- `npm test`: contract type checks passed; **1,212 tests passed across 56 files**, with no failures or skips.
- `npm run build`: passed.
- `git diff --check`: passed.
- Source, tests and dependency hashes were unchanged throughout the final validation run.
- Two independent local reviews found no remaining concrete P1/P2 findings in their inspected scopes. Their five additional findings were reproduced, repaired and rechecked before the final suite.

The exact commands, timings, log hashes, tested file hashes and limitations are recorded in [validation.json](validation.json). Final command logs are saved alongside this document. Raw red/green reproductions and review reports remain under the task's `android-maps-2026-10-16/fixes-20261020` artifact directory.

These are local regression and build results. No live device acceptance, database migration, merge, deployment or scheduled collection was performed.
