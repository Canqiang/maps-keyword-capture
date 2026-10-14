# Keke monitoring-only cohort — October 14, 2026

User-approved scope: change only Keke daily Google Maps monitoring, preserving the shared SEO keyword library and every other store.

## Activated behavior

At **10:09:56 Asia/Shanghai on October 14**, the enabled UAT daily CronJob was switched to the accepted immutable image and monitoring cohort ConfigMap. The next eligible automatic run is **October 15 at 00:00 Asia/Shanghai**. That future scheduled full cycle has not yet been observed.

Only three CronJob template values changed: image, IMAGE_DIGEST and ConfigMap reference. The schedule, discovery, George exclusion, resources and capture profile remain unchanged. The old ConfigMap remains available for rollback; old captures and claims were not changed.

The `keke-acquisition-20261014-v1` set contains 32 core candidates, six exploration/continuity queries and two brand queries. Six exact old queries are retained and 34 are newly monitored (five already existed below the original top-40 cut, 29 are new monitoring-only candidates). Demand volume remains unverified. This allocation is a monitoring budget, not a shared SEO priority rule.

The 91-keyword shared API response was independently read again after validation and was identical to the before-state. The new collector contains no keyword-library write path. Keke still gets a fresh source snapshot every day, but its selected monitoring cohort is explicitly fixed; all other stores continue normal fresh-source selection.

## Validation

- Local typecheck, contract tests, build and **577 tests / 42 files passed** on Node 25.6.1; follow-up config/deploy tests passed **37/37 on supported Node 24.19.0**. No production dependencies changed.
- Independent code review checked source/merchant isolation, unchanged legacy selection hashes, duplicate/cap rejection and cohort provenance. No remaining code findings.
- A separate Pod used the exact candidate image and live source discovery. **10 stores / 350 selected queries** were checked at the selection boundary. Only Keke changed; the other nine selections matched the original algorithm exactly.
- Actual browser smoke covered **three queries**, not all 40: `chinese deli flushing`, `法拉盛 卤味`, `可可小卤 法拉盛`. Pod ran 10:06:07–10:06:48 Asia/Shanghai, exited **0**, zero restarts.
- Two queries returned ranked lists (15 and four observed listings); the Chinese brand query opened the correct Keke merchant detail. Details have no organic rank. The two generic lists did not show Keke in their observed rows.
- Independent Azure-login readback verified **18/18 objects**, 4,929,573 bytes, all seven PNG structures, all 19 CSV listing rows and all result/observation/runtime identities. Three PNGs, one per query, were visually inspected. Full hashes are not inferred from visual sampling.
- The Chinese generic list visibly showed Google's limited-view notice; its four listings are observed coverage, not a complete market inventory. Query-only geography remains unverified.
- The separate verifier retains the historical limited-detail regression requirement by default. The explicit cohort-smoke option skips only that unrelated occurrence requirement; **112 offline tests** passed, including acceptance of standard details and rejection of inconsistent runtime metadata.

Runtime source commit and exact image are in `launch-plan.json`. ACR build: `ch14xp`. Adapter remains `maps-feed-card/v6`; parser behavior was not changed.

## Evidence and limits

`monitoring-cohort.json` and `keyword-diff.json` define the exact cohort and old/new mapping. `probe-acceptance.json`, `readback-report.json`, `object-inventory.json`, `selection-validation.json`, `visual-review.json` and `activation.json` separate runtime, collection, storage and visual evidence.

The standalone smoke manifest is in private storage account `fbrdevstorage`, container `maps-keyword-capture-uat`:
`2026-10-14/run_20261014T020608Z_0584be/att_f93e09ba/manifest.json`.

Durable local PNGs, Pod logs, original and new Kubernetes snapshots, reviewed verifier copy and the Chinese keyword guide are at:
`/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/keke-monitor-keywords-2026-10-14`.

This establishes activated future-job configuration, live all-store selection and a three-query capture/storage smoke. It does **not** establish a completed scheduled full cohort, verified customer-local rankings, proven keyword demand, SEO lift or a segmented dashboard. Compare unchanged common queries across the cohort transition, and keep brand observations separate from acquisition metrics.
