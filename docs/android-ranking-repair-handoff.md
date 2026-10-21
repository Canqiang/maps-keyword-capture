# Android Maps ranking repair — handoff

Last updated: 2026-10-21, Asia/Shanghai. **Work in progress; Android recurring collection is not accepted or enabled.** Update this document after each candidate replay, device run, deployment, or change to the acceptance criteria.

## Objective and scope

Run official Google Maps Android App collection alongside the existing Web collector. Capture exact keywords at explicit observation points, automatically scroll a bounded result list, and retain original screenshots and UI XML. Extract business name, rating, review count, advertisement evidence, display position including ads, and organic rank excluding ads. All fields and rankings must be traceable to original artifacts. Unknown ad classification and incomplete ordering must stay explicit.

The approved target catalog is `deploy/tracking-targets/liya-90-v1.json`: 9 stores, 90 store-keyword pairs, three explicit points per store (center/3 km/5 km), **270 searches per surface per round**. The eventual requirement is both surfaces every two hours. These three observations are not radius coverage or a 25-point grid. Preserve historical records, the shared SEO keyword library, and the established daily/Web workloads.

## Current operational boundary

- AKS context `FBRDevAKSCluster`; Android pilot namespace `android-maps-pilot`; dedicated crawler user pool, currently one `Standard_F4as_v7` (4 CPU/16 GiB), with `maps-capture=android:NoSchedule`.
- Isolated verification Pod: `maps-nine-android-verify-20261021`. Worker0 runs the official app; its runtime and original evidence are on the retained `android-runtime` PVC. Its current active deadline is finite: check live state before reusing it.
- No Android production schedule is enabled. `deploy/tracking-targets/android-cronjob.yaml` is a suspended candidate, not a deployment receipt. Its two workers and 6 GiB runtime limits have not passed full-load acceptance.
- Protected workloads: UAT `maps-keyword-monitor-daily`, `maps-tracking-web-2h`, and their existing ConfigMaps. Do not repurpose, replace, rerun or delete them while repairing Android.
- New nine-store Web verification completed 270/270 searches across 138/132 shards, with zero restarts. Independent readback: all 270 Mongo rows matched; all 2,018 writer receipts passed remote size/availability checks; 310 files passed independent full SHA-256 readback, including every result/manifest/catalog/scan JSON and nine sampled PNGs. Outcome: 84 ranked, 2 confirmed absent, 184 unavailable under the 15-displayed-result limit. These 184 are **not NR20**. The new Web schedule remains suspended until separately enabled/read back.
- Authenticated UAT viewer: https://maps.connexup-uat.net. Do not put credentials or SAS URLs in this document.
- Cloud image builds use Azure ACR. Existing Android candidate image digest `sha256:98aad6fa03e1e3060bb7e5755aa52fe9a266d5ec4ffd720e2bc750af096db063` is source `0eba0589ff960829dc48104b9ad5bafa3283c1db`, not the uncommitted repair below. UI/Web deployed image remains `sha256:3fd3c076221a48bf43083bd80976de5b1f2a6b6acfd9a423e01d417f099c75df`.

## Confirmed problems and required effects

| ID | Evidence / root cause | Intended handling | Current status |
|---|---|---|---|
| A1 | Candidate4 OnlyBear: Manny's OCR title has a word box extending below its rating. Runner selected this last title, while the native gesture correctly rejected overlapping geometry. | Filter candidate anchors using the same title-before-rating constraints; select an earlier valid anchor or retain the bounded fallback. Never weaken native stale-source/geometry checks. | Local regression reproduced and passing; live revalidation pending. |
| A2 | Candidate3 SEE JOY frame5: a status line touches native sheet bottom at y=1232; clipped `3.3 mi` is read as `22 mi`, conflicting with the next full frame. | Keep raw OCR; withhold cropped status/distance values. Fill missing values only after the same merchant passes existing ordered overlap. Do not guess a corrected number. | Local regression reproduced and passing; live revalidation pending. |
| A3 | Candidate3 small-frame OCR loses a rating decimal and varies CJK names; candidate4 large canvas still varies the same merchant name across frames. | Test explicit higher OCR resolution on the immutable source PNGs; record scale in input, artifact and profile hash. Keep exact occurrence/overlap checks; do not infer identity from rating/review/distance alone. | PSM4 ×3 improves six offline samples reproducibly; full live acceptance pending. Candidate introduces opt-in `ocrScale: 3`; default remains 2. |
| A4 | Ad labels can be incomplete or attached to partially visible native owners; the same merchant can appear as ad and organic. | Positive visible Sponsored/native ownership evidence yields `ad`; ambiguous association yields `unknown`. Keep separate displayed occurrences, do not consume an organic rank for an ad, and withhold reliable downstream ranks after unresolved classification. | Existing regression coverage; must recheck on the next real ad sample. |
| A5 | Photo-discovery modules interrupt native result cards. Forward/backward actions remain available at observed stopping points. | Do not interpret a short/stationary/photo viewport as list end. Preserve partial output and stop reason unless explicit supported terminal evidence exists. | Unresolved complete-list acceptance; do not bypass guards to produce Top20. |
| A6 | Short partial probes exit early, so elapsed time understates complete-list cost. One verification Pod retains ~7 GiB working set. | Validate memory/CPU, artifact staging volume, and complete-list throughput before enabling two workers. Keep crawler 4 CPU/16 GiB for pilot; no direct 8 GiB downsize. | Full two-worker capacity pending. |

## Latest candidate and evidence

Working branch: `codex/fix-tracking-review-20261020`; active checkout is a managed sibling worktree. Last committed display metadata change: `93db1892b3ce75c9368ce0c8f1af6d80135b6346`; documentation receipt commit: `36a1a00`. New repairs are not included in either commit or an ACR image yet.

Changes being verified:

1. `src/android/runner.ts`: reject invalid OCR scroll anchors before selecting one; propagate and verify requested OCR scale; advance listing profile method from v8 to v9.
2. `src/android/screen-reader.ts`: retain clipped status as missing, then fill missing status fields from a verified subsequent overlap; no changes to ad/organic sequence identity rules.
3. `src/android/config.ts` / `contracts.ts`: explicit bounded integer `ocrScale` (1–3, default 2). Scale is included in profile hash. The Python OCR 20-million-pixel cap remains unchanged; 1080×2400×3 exceeds it, so candidate testing uses the restored 720×1280 display.
4. New receipt-verified PNG/XML/OCR fixtures and behavior tests cover A1/A2. Never overwrite the source probe evidence.

Prior device results (all original exit2 / partial; none are accepted Top20 runs):

| Probe | Run ID | Queries | Search / GPS PNGs | Outcome |
|---|---|---:|---:|---|
| 2 | `run_20261021T021313Z_43aa38` | 5 | 18 / 5 | 5 partial, 0 complete |
| 3 | `run_20261021T023654Z_7fc6c2` | 5 | 27 / 5 | 5 partial, 0 complete |
| 4 | `run_20261021T025404Z_338bc9` | 2 | 5 / 2 | 2 partial, 0 complete; higher canvas did not resolve OCR identity drift |

Probe4 display override was restored after termination to 720×1280 / 320 dpi / font scale1.0. Preserve the effective display in device metadata/profile; never silently compare different profiles as one trend.

Durable local evidence base (private, not necessarily available to another developer):
`/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/nine-store-uat-20261021/`

Relevant subdirectories: `android-probe3-review/`, its `ocr-experiment/`, `android-probe4-review/`, `resource-sizing-20261021/`, `web-full-verification/`. Portable fixtures and prior validation receipts are checked into `tests/fixtures/android/repair-probe-20261021/` and `evidence/2026-10-21/android-ranking-repair/`. Add the current candidate's machine-readable receipt there after verification.

## Verification and final acceptance

1. **Software:** reproduce each fault before fixing; targeted tests, contract checks, typecheck, Python OCR tests, full unit suite and build pass. Preserve exact counts/log hashes and source identity. Passing synthetic/fixture tests does not establish real-device acceptance.
2. **Device:** isolated bounded run on official Maps at approved points; every GPS injection independently matches and viewport follows; record App version, display, locale/timezone, engine/languages/scale, source commit and original exit code. No overlapping emulator tasks.
3. **Ranking:** reach configured displayed-result target or an explicit supported end, with continuous ordered screenshot coverage. Ads consume `displayPosition`, never `organicRank`; unknown classifications prevent claiming a reliable downstream organic rank. A merchant detail page is not rank1. NR20 requires 20 verified natural results, not 20 displayed entries including ads.
4. **Evidence:** independently read back exact receipts, byte sizes and SHA-256 for the candidate's manifest and every referenced artifact; validate JSON/CSV agreement and PNG structure, then visually inspect all candidate queries, every ad/unknown example and each partial reason. Keep full hash scope distinct from visual sampling.
5. **Isolation:** compare protected CronJob/ConfigMap identities/spec/data before and after. No changes to shared SEO source or historical observations. Pilot outputs remain separate until accepted.
6. **Capacity:** run complete queries rather than extrapolating partials. Two shards are 138 and132 searches; with a110-minute deadline the larger shard needs less than47.8sec/query before startup/storage overhead. Measure peak memory/CPU and storage; no OOM or node pressure. Scheduler fit alone is not acceptance.
7. **Release:** only after all gates pass, build exact source in ACR, verify registry digest, pin the candidate configuration, and perform deployment/readback separately. Do not claim enabled recurring collection merely because a template exists or an isolated probe completed.

If any ranking gate fails, deliver the partial evidence and exact cause; do not enable Android recurring collection as if fixed. Update this document's statuses and next actions rather than erasing failed candidate history.

## Candidate5 software checkpoint

2026-10-21: full `npm test` passed (1,519 tests /71 files, including contract checks); targeted 105/105 and Python26/26 passed. Typecheck/build/diff checks passed. Geometry failures were observed before the fix; explicit-scale failures were observed before propagation. Earlier intermediate failures are retained in the software receipt, not hidden. Independent review passed with no P0/P1/P2 blocker (205 targeted tests and four negative cases independently checked); live verification remains pending. See `evidence/2026-10-21/android-ranking-repair/candidate5-independent-review.json`. See `evidence/2026-10-21/android-ranking-repair/candidate5-software-validation.json`.

## Next engineer checklist

- Check current Git diff and this handoff before editing; do not overwrite another developer's work.
- Confirm the verification Pod deadline/liveness and absence of active captures; do not start a second emulator or OCR task on the same worker.
- Software regressions and independent review have passed. For reproduction, run: `npm run typecheck`, `npm test`, `npm run build`, and `python3 -m unittest discover -s deploy/android/linux -p 'test_*.py'`.
- Freeze compiled files and configuration with SHA-256 under a fresh candidate directory on the owned PVC; verify the uploaded bytes before executing. Use approved original keywords and coordinates, max20 displayed rows /60screens /600seconds per query.
- Save all outputs and verify them independently before changing a profile, stopping the pilot, or planning a deployment.
- Terraform drift is tracked separately in `fbr-env-project/azure/infra/env/04-aks.tf`: local reconciliation sets count1 and the Android taint. Do not assume it has been committed/pushed/applied; check that repository separately.
