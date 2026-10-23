# Android Maps ranking repair — handoff

Last updated: 2026-10-23. **Post-submit stale-read recovery is implemented (v24); dual-worker complete collection still fails at OCR. Production Android remains suspended.** No duplicate search submission occurred. The latest failures must not be reported as complete rankings or as another Appium stale failure.

## Latest checkpoint (2026-10-23, dual run ended15:57:35 Asia/Shanghai)

- **Fix:** source`bfa6976db59cb1aef239d20c2b918f66a5481fc3`, ACR`ch15ag`, image`sha256:bc2e2b9275211679cf5c44d18a0ca31c2eb615c739a97285ca5a0fab3cc80ce8`, listing method v24. Only exact HTTP404 W3C stale-element GET errors inside the post-submit read loop may trigger at most three fresh acquisitions, within the existing deadline. Input/submission mutations and generic errors are never retried.
- **Tests:** regression red→green;214 device tests,94 files/1,803 full-suite tests, typecheck/contracts/build and independent review pass.
- **Actual concurrency:** KEKE and OnlyBear had220.752 seconds of overlapping search/capture and311 seconds of tracking-process overlap. All1,231 device-journal commands recovered (1,137 Appium HTTP +94 ADB); zero failures; each search submitted exactly once. No live stale event occurred: recovery branch proof is the targeted regression, not a claimed live replay.
- **Remaining failure:** both original tracking exits1, `screen_ocr_failed`. KEKE retained33 query PNGs/13 diagnostic organic rows; OnlyBear14 query PNGs/10 rows; two additional location PNGs. Both lists partial and final target ranks null. No fresh positive ad case.
- **Cause boundary:** valid terminal PNG/XML, but no terminal OCR result. Timing is compatible with the30s OCR budget; actual child exit/stderr was not retained, so CPU/timeout/OOM cannot yet be asserted. Persist structured OCR diagnostics and replay the two immutable PNGs before selecting the next fix. Do not resubmit search or blindly raise timeout.
- **Previous rating fix exercised:** KEKE frame27 full-screen OCR4.19%/18 was reread twice as4.1%/18; resulting4.1/18 matches the PNG.
- **Readback:**222 Azure objects/220 exact writer receipts plus two service-length-only scan roots;49 PNGs,49 XML,120 JSON, four CSVs/23 prefix rows verified. Seven PNGs visually sampled. Both database records match failed/null-rank manifests.92 protected workload/config checks unchanged. Maps location remains unverified.
- **Isolation:** new Job/database`maps-android-stale-v24-20261023`, dedicated crawler and separate worker roots; no current collector promotion, schedule/catalog/history change or old-gate deletion. Failed verification gate retained. Code committed locally; no push/merge.

See [v24 fix, final evidence and next-owner steps](../evidence/2026-10-23/android-stale-submit/README.md). Full logs/screenshots are in the durable `android-stale-submit-2026-10-23` visualization directory linked there.

## Historical v23 checkpoint (2026-10-23, two-worker run ended15:29:39 Asia/Shanghai)

Same runtime source `bd894e7f9c6e69f98bd06f40bba7eeb2b56d7f09`, ACR `ch15ad`, digest `sha256:8220c787f89e9c370122e73e42a17945dc09e3d5e8ac3e90a26a43c1b138df53`, listing method v23. Local branch `codex/android-search-scroll-20261023`; no new runtime build or promotion.

- **OnlyBear single-worker passed:** `bubble tea garden city` at its existing center, explicit list end,12 organic/0 ads/0 unknown, target display2 / organic2, original exit0 at15:21:20.16 ranking PNGs +1 location;462 command sequences, no command failures.82 Azure objects independently read back,81 exact bytes/SHA receipts plus service-length scan root.
- **Advertisement contract passed historical replay only:** current v23 exactly reproduces17 selected original frames with Sponsored Gong Cha display1 / organicRank null and OnlyBear display3 / organic2 (1 ad +12 organic).72 original artifact receipts rechecked locally. No ad appeared in the fresh samples; positive live v23 ad coverage remains open.
- **Two-worker Job failed:** worker0 KEKE original exit1 at15:25:23; worker1 OnlyBear original exit0 at15:29:39 with12 organic and target rank2. Roots, Pod IPs, indexes and store assignments are separate; both use the same frozen catalog. Tracking-process overlap0seconds: KEKE failed before worker1 emulator boot began. Do not call this a concurrent-load success or attribute the failure to resource contention.
- **Confirmed new defect:** command115 submitted the search once successfully. Command118 (`search.results`, `GET element/displayed`) returned404 / `stale element reference` for Maps `search_omnibox_text_box`. Diagnostic screenshot already shows the exact query/results. `searchField()` currently makes this transient post-submit read terminal before settled-source validation. Restoration/capture/cleanup completed. This evidence does not establish the cause of every older protocol error.
- **Next repair and gate:** narrowly reacquire fresh native evidence after a stale post-submit read within existing budgets; never repeat uncertain submission or relax query/ownership/consent guards. Add one-stale-success, exhausted-stale, changed/ambiguous-query and unrelated-protocol negative tests. Then rerun on a new version and require actual overlapping search/screenshot intervals with both exits0 before full-catalog acceptance.
- **Evidence/database:** dual readback102 objects/100 exact receipts,20 PNGs decoded and CSV2 queries/12 rows checked.128 KEKE commands fully recovered (one failure) and471 OnlyBear commands (zero failures). All3 new DB observations match their manifests; failed KEKE retains null rank. The isolated dual gate remains active/finished[1]; no gate was cleared or failed round retried.
- **Protection:** all7 protected Maps workload specs and82 pre-existing ConfigMap hashes unchanged. Source keywords/history/Web/UI/daily collectors unchanged. Current focused regression suites4 files/71 tests passed; prior full-suite results remain historical. Geographic status stays unverified.

See [same-version release-gate report and executable handoff](../evidence/2026-10-23/android-v23-release-gates/README.md) and [failed command diagnosis](../evidence/2026-10-23/android-v23-release-gates/dual/failure-diagnosis.json). The complete KEKE sample below remains valid historical evidence, not proof that the intermittent search-state race is resolved.

## Historical KEKE Top20 checkpoint (2026-10-23, finished15:04:17 Asia/Shanghai)

Runtime source `bd894e7f9c6e69f98bd06f40bba7eeb2b56d7f09`, ACR `ch15ad`, digest `sha256:8220c787f89e9c370122e73e42a17945dc09e3d5e8ac3e90a26a43c1b138df53`, listing method v23. Local branch `codex/android-search-scroll-20261023`; no push/merge or production promotion.

- **Complete bounded native capture:** isolated KEKE `braised food flushing`, original center point, one worker. Original exit0,20 organic results,0 ads/unknown; sequence/classification/screenshot coverage verified. KEKE display1 / organic1. The configured20-result target was reached; the entire Google list was not exhausted.
- **Screens and corrections:**48 ranking PNGs +1 location PNG;46 selected frames and two retained backward-correction frames25/26. Longjiang4.1/18 was correctly captured at33; Ji You explicit no-review card at43. Some raw Chinese name OCR remains noisy.
- **Coverage limits:** no native-top sheet restart or rating reread was invoked. Ji You's no-review line fully left frame44, so the new clipped no-review branch is covered by original-fixture tests, not this fresh run. This is one point/keyword, not fleet acceptance or new positive ad-case verification. Maps location remains unverified.
- **Evidence:**218 objects independently downloaded with Azure login,217 exact bytes/SHA receipts plus service-length scan-root check.49 PNGs decoded,49 XML and118 JSON parsed; CSV1 query/20 rows checked. Selected-frame replay exactly reproduces accepted20. Eight actual PNGs visually sampled.1,148 command sequences fully recovered from16 durable checkpoints, zero failures; historical intermittent Appium cause remains unconfirmed.
- **Software:**94 files /1,796 TypeScript tests plus typecheck/contracts/build passed; independent focused review passed. Earlier v22 validation included33 Python and9 CI guards; unchanged by v23.
- **Protection:**7 Maps workload specs and81 pre-existing ConfigMap data hashes unchanged. Separate database/output prefixes; Web/UI/daily collectors, source keyword library and past observations untouched. Production Android stays suspended.
- **Next gate:** same-candidate OnlyBear/ad-case and concurrent-worker validation, then full target-catalog/capacity acceptance before any production promotion.

See [v23 full verification and handoff](../evidence/2026-10-23/android-unrated-continuity/README.md) and [v22 partial checkpoint](../evidence/2026-10-23/android-sheet-recovery/README.md). The earlier three-frame partial result below is historical.

## Historical rating checkpoint (2026-10-23, isolated run finished13:58:59 Asia/Shanghai)

Source `d03fa2a19dde775c91a4be7b4c82ed32ea4d4b66`, ACR `ch15a2`, digest `sha256:0f0d1825f1d9ee35c984969aa97e82c88c28c2bc8d560fcb6b23975eb7e9ac08`, listing method v21. Local branch `codex/android-search-scroll-20261023`; no push/merge or production promotion.

- **Requested frame35/36 rating defect repaired in original evidence:** two same-PNG crop modes read4.1/18, with unchanged count/tail and bounded geometry. Original34 selected frames replay to14 continuous organic occurrences. No end marker, no fabricated digit, and no complete-list acceptance from replay.
- **Native verification did not complete:** Job/database `maps-android-rating-20261023`, KEKE `braised food flushing`, original center, one worker. Tracking13:57:56–13:58:59, original exit2; runtime sidecar exit0, all zero restarts. Three ranking PNGs; only frame1 is selected, two diagnostic prefix rows; final target rank remains null. No rating reread triggered before this early stop, so this run does not exercise the new recovery live.
- **New early state/continuity blocker:** frame1 list top272; frame2 top274, Nong Geng Ji name/status OCR drift and `ordered_overlap_missing`; backward correction exposes a partly collapsed panel at frame3/top456. Native backward capability is then false, another correction is rejected, and the query stops `unknown_scroll_layout`. This is not list end, an Appium protocol failure or proof that the rating patch regressed. All three screens and XML are retained in [remaining-native-boundary.json](../evidence/2026-10-23/android-rating-reread/remaining-native-boundary.json).
- **Diagnostics/storage:**185 commands fully recovered from5 immutable checkpoints, zero command failures.27 objects independently downloaded with Azure login;26 exact writer receipts match size/SHA-256, while scan root has service-length validation only. All4 PNGs decoded,17 JSON/4 XML parsed, two CSVs checked against one query/two rows. All3 ranking PNGs visually inspected; location PNG structurally checked. Old intermittent Appium cause remains unreproduced.
- **Software:**92 files /1,747 TypeScript tests,33 Python tests and9 CI checks passed, plus typecheck/contracts/build. An earlier unconstrained parallel device suite had an IME focus-window timeout (201/202); no device code was changed, and the full maxWorkers2 run passed. Independent review caught and verified the fix for optional OCR deadline loss. First ACR attempt failed packaging; final successful image used the Android-specific ignore rules in its staging context.
- **Protected services:**seven existing Maps workload specs and22 ConfigMap data hashes unchanged; fresh isolated database only. Android production stays suspended; Web/UI/shared SEO source and prior observations unchanged. No automatic second native run, gate clearing, extra retries or production promotion. GPS device evidence is retained; Google backend locality remains unverified.
- **Next owner:** address result-panel state transitions, stable viewport measurement and safe recovery when a backward correction reaches list top/collapses the sheet. Repeated early/late failures show that patching OCR spellings alone cannot establish end-to-end robustness. Use this exact3-frame sequence and a stable-sheet state contract; do not merely widen fuzzy thresholds or ignore native scroll capability. Require complete KEKE acceptance before promotion, then separately validate concurrency/full catalog.

See [rating repair evidence](../evidence/2026-10-23/android-rating-reread/README.md). Historical checkpoints below retain their original scope.

## Historical continuity checkpoint (2026-10-23, isolated run finished 13:24:42 Asia/Shanghai)

Runtime source `beab53842f3a115c257e42f46b435ca3f3894593` (repair commit `cbb1283`), ACR `ch15a0`, image digest `sha256:a135dae97de2f5b7a29ee0b79f6ba18c59811fc81116f48d8dbed659785a86c3`; branch `codex/android-search-scroll-20261023`. Local commits only; no push/merge or production promotion in this follow-up.

- **Requested historical boundary repaired:** original receipt-verified PNG/XML/OCR/frame fixtures reproduce the Braised Canaan frame31→32 failure. The new two-anchor geometry proof joins it conservatively; all 30 original selected frames replay to 12 continuous organic occurrences without the duplicate. That historical prefix has no end marker and is not complete-list acceptance.
- **New native run remains partial:** isolated Job `maps-android-ocr-continuity-20261023`, fresh database of the same name, KEKE `braised food flushing` at the original center, worker0 only. Actual tracking runtime 13:20:01–13:24:42; original exit2, sidecar exit0, all zero restarts. It captured 36 ranking PNGs, selected 34 frames and retained 14 diagnostic listing rows. Final target and organic ranks remain null; no accepted ranking coverage is claimed.
- **Separate new defect confirmed:** at frame35→36, visible Longjiang rating 4.1 / 18 reviews becomes OCR `4.19% (18)`. The strict parser produces no card; exact anchored movement detects `anchored_card_missing`. The next clipped card also has malformed `49%`. Do not round these values, assume list end, or call this an Appium fault. Exact artifacts and next steps are in [remaining-rating-boundary.json](../evidence/2026-10-23/android-ocr-continuity/remaining-rating-boundary.json).
- **Native proof limit:** this run passed Braised Canaan, but did not reproduce the historical quote/name variation. Replay with the new fallback disabled changes no boundary in this new run. Historical artifact regressions prove the targeted fix; this probe does not independently exercise that exact new fallback.
- **Diagnostics and verification:** all 870 command sequences recovered from 12 immutable checkpoints, zero command failures. The old intermittent Appium fault remains unreproduced. Independently downloaded all 166 referenced objects using Azure login; 165 exact writer receipts matched bytes/SHA-256 (scan root has service-length validation only). Decoded all 37 PNGs; parsed 90 JSON and 37 XML; checked two CSVs against one query / 14 listing rows. Visually reviewed four PNGs. See [complete evidence and limits](../evidence/2026-10-23/android-ocr-continuity/README.md).
- **Software validation:** 1,727 TypeScript tests and 30 runtime Python tests pass, plus typecheck/contracts/build. Real-fixture positive/negative tests include numeric/text changes, duplicates, invalid geometry, contradictory motion and ad/unknown conflicts. Independent review found no blockers.
- **Existing services protected:** seven workload specs and 15 ConfigMap data hashes unchanged. Android production remains suspended; Web/UI/shared SEO source unchanged. Same bounded profile, no production observations, gate/claim deletion, automatic retry or capacity expansion. Fresh GPS matched and viewport followed; Google backend geography remains unverified.
- **Next owner:** add an exact frame35/36 regression and investigate bounded OCR reread or evidence-backed missing-card handling without guessing numbers. Require full KEKE native acceptance before promotion; previous OnlyBear acceptance is historical and was not rerun here. Concurrent workers and the full catalog require separate capacity acceptance.

## Historical diagnostic checkpoint (2026-10-23, 13:02 Asia/Shanghai)

Instrumented source `de28c6b0662709538ba0f3d9abc2dc2bff471b86`, ACR `ch159x`, digest `sha256:53b8128b93d36d1b0697c9bbf6aa65720a11e56f6093f7c42b6ae722b2f896d2`; branch `codex/android-search-scroll-20261023`. Local source commits only; no production promotion or push/merge in this follow-up.

- **Durable command diagnostics verified:** 11 immutable Azure checkpoints recover all794 command sequence entries for this bounded run, including search submission, sheet expansion, scrolling and cleanup. Zero failed commands. Normal checkpoint bounds still apply to other runs; this one complete union is not a guarantee against SIGKILL/node loss. Four commands were safely labelled `other`; a subsequent locally tested fixed-route allowlist addition covers settings, nested-elements and clickable/content-desc attributes, without IDs or values.
- **Prior Appium fault not reproduced:** the same KEKE keyword, point and collection profile crossed the old failure point and produced32 ranking PNGs. Its original historical `appium_protocol_error` has no retained command detail. No cause, retry-based fix or resolution is claimed. The new journal enables the next occurrence to be diagnosed.
- **KEKE still partial, for a separately confirmed reason:** original exit2 at12:57:09; frames31/32 show the same Braised Canaan merchant, but OCR name/status drift defeats ordered overlap after two bounded backward corrections.30 selected frames,13 stored rows,12 verified organic occurrences; final target rank remains null. Initial target match/first visible result is not a complete accepted query. No OCR threshold or identity rule was broadened in this diagnostic follow-up.
- **OnlyBear previous sample remains accepted, not rerun here:** candidate `0dabee3` captured `bubble tea garden city` to explicit list end, exit0,1 ad +12 organic, target display3 / organic2. This does not establish fleet acceptance.
- **Validation:**1,702 TypeScript tests +30 runtime Python tests passed before the probe; the fixed-route follow-up additionally passed its2 tests plus typecheck/contracts/build. Independent review found no blockers. All149 Azure objects downloaded;148 exact writer receipts verified by size/SHA-256; the top-level scan summary lacks an external exact receipt.33 PNGs decoded,33 XML and81 JSON parsed,2 CSVs/1 query/13 listing rows checked;3 PNGs visually inspected. See [diagnostic verification evidence](../evidence/2026-10-23/android-command-diagnostics/README.md).
- **Protected services unchanged:**7 workload specs and15 ConfigMap data hashes match preflight. Android production remains suspended on the previous production image; Web/UI and shared SEO source unchanged. This probe used its own fresh database and output prefixes. All probe containers terminated with zero restarts. No claim/gate deletion or automatic retry.
- **Next action:** retain command logs on the next specifically authorized probe to identify any recurring Appium fault; separately repair the evidenced OCR boundary using the exact frames and conservative identity/geometry proof. Require complete KEKE and OnlyBear native acceptance before promotion, then separate concurrent/full-catalog validation.

## Objective and scope

Run official Google Maps Android App collection alongside the existing Web collector. Capture exact keywords at explicit observation points, automatically scroll a bounded result list, and retain original screenshots and UI XML. Extract business name, rating, review count, advertisement evidence, display position including ads, and organic rank excluding ads. All fields and rankings must be traceable to original artifacts. Unknown ad classification and incomplete ordering must stay explicit.

The approved target catalog is `deploy/tracking-targets/liya-90-v1.json`: 9 stores, 90 store-keyword pairs, three explicit points per store (center/3 km/5 km), **270 searches per surface per round**. The eventual requirement is both surfaces every two hours. These three observations are not radius coverage or a 25-point grid. Preserve historical records, the shared SEO keyword library, and the established daily/Web workloads.

## Historical operational boundary (2026-10-22; see dated follow-ups)

- AKS context `FBRDevAKSCluster`; Android pilot namespace `android-maps-pilot`; dedicated crawler user pool, currently one `Standard_F4as_v7` (4 CPU/16 GiB), with `maps-capture=android:NoSchedule`.
- Isolated verification Pod: `maps-nine-android-verify-20261021`. Worker0 runs the official app; its runtime and original evidence are on the retained `android-runtime` PVC. Its current active deadline is finite: check live state before reusing it.
- No Android production schedule is enabled. `deploy/tracking-targets/android-cronjob.yaml` is a suspended candidate, not a deployment receipt. Its two workers and 6 GiB runtime limits have not passed full-load acceptance.
- Protected workloads: UAT `maps-keyword-monitor-daily`, `maps-tracking-web-2h`, and their existing ConfigMaps. Do not repurpose, replace, rerun or delete them while repairing Android.
- New nine-store Web verification completed 270/270 searches across 138/132 shards, with zero restarts. Independent readback: all 270 Mongo rows matched; all 2,018 writer receipts passed remote size/availability checks; 310 files passed independent full SHA-256 readback, including every result/manifest/catalog/scan JSON and nine sampled PNGs. Outcome: 84 ranked, 2 confirmed absent, 184 unavailable under the 15-displayed-result limit. These 184 are **not NR20**. The new Web schedule remains suspended until separately enabled/read back.
- Authenticated UAT viewer: https://maps.connexup-uat.net. Do not put credentials or SAS URLs in this document.
- Cloud image builds use Azure ACR. Existing Android candidate image digest `sha256:98aad6fa03e1e3060bb7e5755aa52fe9a266d5ec4ffd720e2bc750af096db063` is source `0eba0589ff960829dc48104b9ad5bafa3283c1db`, not the candidate5 repair below. UI/Web deployed image remains `sha256:3fd3c076221a48bf43083bd80976de5b1f2a6b6acfd9a423e01d417f099c75df`.

## Confirmed problems and required effects

| ID | Evidence / root cause | Intended handling | Current status |
|---|---|---|---|
| A1 | Candidate4 OnlyBear: Manny's OCR title has a word box extending below its rating. Runner selected this last title, while the native gesture correctly rejected overlapping geometry. | Filter candidate anchors using the same title-before-rating constraints; select an earlier valid anchor or retain the bounded fallback. Never weaken native stale-source/geometry checks. | Local regression passing; probe 5 (candidate5) showed no recurrence. |
| A2 | Candidate3 SEE JOY frame5: a status line touches native sheet bottom at y=1232; clipped `3.3 mi` is read as `22 mi`, conflicting with the next full frame. | Keep raw OCR; withhold cropped status/distance values. Fill missing values only after the same merchant passes existing ordered overlap. Do not guess a corrected number. | Local regression passing; probe 5 (candidate5) showed no recurrence. |
| A3 | Candidate3 small-frame OCR loses a rating decimal and varies CJK names; candidate4 large canvas still varies the same merchant name across frames. | Test explicit higher OCR resolution on the immutable source PNGs; record scale in input, artifact and profile hash. Keep exact occurrence/overlap checks; do not infer identity from rating/review/distance alone. | PSM4 ×3 improves six offline samples reproducibly, but probe 5 at scale 3 still drifted (q0001 f2 name, q0004 star glyph 丙). Candidate introduces opt-in `ocrScale: 3`; default remains 2. |
| A4 | Ad labels can be incomplete or attached to partially visible native owners; the same merchant can appear as ad and organic. | Positive visible Sponsored/native ownership evidence yields `ad`; ambiguous association yields `unknown`. Keep separate displayed occurrences, do not consume an organic rank for an ad, and withhold reliable downstream ranks after unresolved classification. | Existing regression coverage; must recheck on the next real ad sample. |
| A5 | Photo-discovery modules interrupt native result cards. Forward/backward actions remain available at observed stopping points. | Do not interpret a short/stationary/photo viewport as list end. Preserve partial output and stop reason unless explicit supported terminal evidence exists. | **Historical probe-6 blocker** (q0001, q0002, q0005 end at the module). Candidate7 plan in the probe-6 checkpoint. |
| A6 | Short partial probes exit early, so elapsed time understates complete-list cost. One verification Pod retains ~7 GiB working set. | Validate memory/CPU, artifact staging volume, and complete-list throughput before enabling two workers. Keep crawler 4 CPU/16 GiB for pilot; no direct 8 GiB downsize. | Full two-worker capacity pending. |

## Expected data and user-visible behavior

| Field / view | Expected behavior | Never imply |
|---|---|---|
| `name`, `rating`, `reviewCount` | Extract observed values, with raw PNG/XML/OCR and frame references available for review. Leave unreadable fields missing. | A guessed decimal, review count or normalized merchant identity is an observed fact. |
| `resultType` / `adLabel` | `ad` requires positive supported ad evidence; `organic` requires the parser's complete classification evidence; unresolved ownership stays `unknown`. | No visible label in a cropped card proves organic. |
| `displayPosition` | Ordered displayed occurrence, counting both paid and organic entries; preserve the same merchant appearing twice in different result types. | Deduplicating all identical merchant names preserves the displayed list. |
| `organicRank` | Count only verified organic occurrences; null for ads/unknown. Only publish target ranks when the query's ordering/classification quality gates pass. | Partial/unknown sequence means a reliable full-list rank. |
| `listingStatus` / `stopReason` | Complete only at configured target or supported explicit list end; otherwise retain partial plus the actual stopping reason. | A stationary screen, photo module or available forward action is an end-of-list receipt. |
| Location / profile | Separate requested point, device GPS receipt, viewport following and unverified Google backend geography. Keep Web and Android profiles separate. | Injected GPS proves Google's entire ranking backend used that location. |
| UAT page | Select store, keyword, date, surface and observation point; show status/rank and open the original corresponding screenshot. Keep historical profiles visible and labelled. | Missing observations are rank0, improvements, or a continuous interpolated trend. |

Example: a verified sequence `Sponsored A → B → C` yields display positions1/2/3, with organic ranks null/1/2. If the first occurrence is `unknown`, it must not silently become organic rank1, and downstream target ranks must follow the reliability gate. Both surfaces may legitimately disagree at the same keyword/point/time; retain their independent evidence.

## Historical candidate5 and evidence

Working branch: `codex/fix-tracking-review-20261020`; active checkout is a managed sibling worktree. Last committed display metadata change: `93db1892b3ce75c9368ce0c8f1af6d80135b6346`; documentation receipt commit: `36a1a00`. Candidate5 repairs and this handoff were committed as `af0bc7f8b301e88cc79951a42171acb03108ae8f`. No candidate5 ACR image has been built or deployed.

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

## Candidate5 live verification checkpoint

2026-10-21 11:26–11:28 Asia/Shanghai: the original five-query probe is running in the isolated Pod, using source `af0bc7f8b301e88cc79951a42171acb03108ae8f`, fresh source directory `/runtime/nine-store-source-20261021e` and output directory `/runtime/nine-store-verification-20261021e`. All 134 uploaded compiled/runtime files were independently SHA-256 checked before launch. Baseline display remains 720×1280 /320 dpi; OCR scale is explicitly3. Pod UID `a09f1277-3b96-4a1e-8c7b-a6dcf8774ec6`, original launch PID5347, zero restarts at launch. The terminal outcome is recorded in the next section; it is not acceptance.

Local monitoring: `android-probe5-review/monitor.py` reads progress only. At termination, `download.py` saves bounded raw files and checks transfer hashes; `read-operations.py` checks runtime source/config/lease; `verify.py` verifies artifact receipts, JSON/CSV/PNG/profile consistency. The verifier is undergoing separate review. Run these from the durable local evidence base above; preserve all earlier probe folders.

## Candidate5 live verification outcome (probe 5)

2026-10-21 11:27–11:33 Asia/Shanghai, run `run_20261021T032723Z_c779a2`, source `af0bc7f8b301e88cc79951a42171acb03108ae8f`, OCR scale 3, display 720×1280 / 320 dpi, profile method `full_screen_ocr_native_context_ordered_overlap/v9` (hash `0f7321713349e6dc9a0e13ffa820fb7761b486734fd984c9c74e10cfcf144bfd`). Original exit 2, `needs_review`, zero restarts. All five GPS injections matched and the viewport followed. Independent readback (`candidate5-live-verification.json`, helper review `candidate5-live-verifier-review.json`): manifest receipt 255,006 bytes matched, all 195 artifact receipts verified by size/SHA-256, 49 PNGs decoded at the baseline display, 5 query JSON and 5 + 20 CSV rows matched. Visual review covered the ten contact-sheet frames (first and last frame of every query). **Outcome: 0 of 5 complete, 0 ranked, 5 partial** (44 search + 5 location screenshots, 20 listings: 2 ads, 17 organic, 1 unknown). This is still not Top20 acceptance.

| Query | Frames / rows | Stop reason | Diagnosed cause (from the persisted OCR/XML/frame evidence) |
|---|---:|---|---|
| q0001 卤味 @ keke-center | 2 / 2 | `ranking_unreliable` | Ordered overlap missing f1→f2. The same card was OCR'd as `可 可 小 鹵 KEKE BRAISED DELI` (f1) and `By AJ/)\pq KEKE BRAISED DELI` (f2); f2 also lost its status line (`d.0 ml`), so `distanceText` is null and the fuzzy-name path is not allowed. The sheet expanded between the frames (list top 456→272), so no geometric path applies either. A3 recurred at scale 3. |
| q0002 chinese food @ keke-3km | 3 / 2 | `ranking_unreliable` | f3 shows Hwa Lung Kitchen 34 px below the list top (< 35) → `card_header_clipped` → `unknown`. `clippedPrefixOverlap` requires at least two aligned cards, so a one-card frame cannot be joined; the reconciler reports overlap missing and the loop stops. |
| q0003 bubble tea near me @ onlybear-center | 17 / 7 | `source_changed` | Sequence verified for 17 frames; one refresh already used after f4. A second pre-gesture `SOURCE_CHANGED` stopped the query: the runner allows one refresh per query (the earlier text of this document said two). |
| q0004 hot pot near me @ seejoy-5km | 15 / 6 | `ranking_unreliable` | f15 OCR reads the rating line as `4.9 丙 (1174) …`; the star-slot substitution set `[玄計]` does not include 丙, so Mt. ShooTao is not a card in f15 and the overlap with f14 is missing. Name drift across f5–f9 (`/J\ 龙 欣 火 钢` … `小 龍 坎 火 鋼`) was absorbed by the equal-distance similar-name path. |
| q0005 bakery @ uws-center | 7 / 3 | `unknown_scroll_layout` | f7 native list has a third direct child `[0,1131][720,1232]`: the clipped head of the photo-discovery module with no labels and no action row. `liveSearchLists` requires every direct card to carry a scrollable HorizontalScrollView or static action row, so the list is rejected although it is the same `search_list_layout` with the exact query heading. |

A1/A2 did not recur (no anchor-geometry rejection, no clipped-status conflict). Throughput: each gesture moved about 300 px against a card pitch of about 690 px, so a row costs 2–3 frames at about 5.5 s per frame (q0003: 7 rows in 17 frames). A 20-row list would need roughly 50 frames, close to the 60-screenshot cap and far from the 2-hour 270-search requirement (A6).

Next action (candidate6, not started on a device): accept any single non-alphanumeric glyph in the star slot when the parenthesised count follows; allow a one-card clipped-prefix join when the name key is identical; add a measured-geometry identity (same native list, same upward delta, equal rating/review count, similar name) for drifted CJK names; raise the per-query source-change refresh budget; accept a trailing unlabeled list child beside cards that carry clickable action controls. Reproduce each from the probe5 fixtures before any device run.

## Candidate6 checkpoint (probe 6)

Source `df3bab1195e062bfa30042b7a239c96e5dc8684e` (branch `fix/android-candidate6`, merged to main after this probe). Repairs, each reproduced first from the probe-5 fixtures in `tests/android-candidate6-probe5.test.ts` (fixtures `tests/fixtures/android/repair-probe-20261021/candidate5-*`, provenance in `provenance-candidate5-probe5.json`): one CJK glyph accepted in the star slot (丙; two or more CJK characters such as `3.9 公里 (1256)` remain prose); a lone clipped header joins when its name key is identical; OCR-drifted names join through measured list geometry (same native list left/right/bottom, consistent non-positive movement relative to the list top, equal rating/review count/type, similar name); a fresh frame is allowed again after each sent gesture, never twice in a row, at most three per query; the clipped photo-module head at the list edge no longer invalidates the static action rows beside it. Listing profile method is now `…/v10`. Software gates: typecheck, full `npm test` 1,540 tests / 72 files, Python OCR tests 26/26 (`candidate6-full-tests.log`, `candidate6-python-tests.log`). No ACR image was built.

2026-10-21 12:00–12:08 Asia/Shanghai, run `run_20261021T040041Z_172916`, same Pod (UID `a09f1277…`), fresh source directory `/runtime/nine-store-source-20261021f` (152 files SHA-256 checked before launch, `candidate6-launch-source.json`), output `/runtime/nine-store-verification-20261021f`, same five tasks and config apart from the output directory, display 720×1280 / 320 dpi, OCR scale 3, profile hash `3ade85846c51651e913ecb7c00d274372fdc21217b69253a72c40aef46dee6c4`. Original exit 2, `needs_review`, zero restarts, all five GPS injections matched and the viewport followed. Independent readback (`candidate6-live-verification.json`): 303 files / 50.4 MB transferred with matching hashes, manifest receipt 372,905 bytes matched, all 295 artifact receipts verified, 74 PNGs decoded, 5 query JSON and 5 + 28 CSV rows matched, 3 native refreshes. Visual review: first and last frame of every query (contact sheet in the local evidence base). **Outcome: still 0 of 5 complete and 0 ranked; 28 rows instead of 20 (2 ads, 24 organic, 2 unknown); 69 search + 5 location screenshots.**

| Query | Frames / rows | Stop reason | What happened |
|---|---:|---|---|
| q0001 卤味 | 4 / 2 | `ranking_unreliable` | Frame 3 (34 px clipped header) now joins. Frame 4 shows the same card with its name fully under the sheet header and the photo-discovery module below it; no following card is on screen. The one-card clipped join requires a legible name, so the overlap is missing. |
| q0002 chinese food | 4 / 2 | `ranking_unreliable` | Identical pattern to q0001 (Hwa Lung Kitchen, then the photo module). |
| q0003 bubble tea near me | 27 / 12 | `ranking_unreliable` | Twelve verified rows (Only Bear rank 1) against seven in probe 5. Between frames 26 and 27 the content moved about 1,000 px for one bounded gesture: Teamisu cafe's header left the list and only its snippet and action row remain above Super FL Mart. No shared header, so the overlap is correctly missing; the cause of the jump (fling or list settle) is not yet identified. |
| q0004 hot pot near me | 28 / 10 | `source_changed` | Ten rows (KPOT ad at position 1, then nine organic) against six. Refreshes were spent after frames 10, 14 and 21; a fourth pre-gesture source change at frame 28 stopped the query. This list changes its native source often while loading. |
| q0005 bakery | 6 / 2 | `unknown_scroll_layout` | Frame 6: the list holds the merchant card and the photo-discovery module (`Image result for bakery posted by …`). `liveSearchLists` rejects any list containing photo-result anchors unless it matches one of the hand-coded module shapes, and this shape is not among them. |

Reading: candidate6 fixed every probe-5 stop except the photo-discovery module (A5), which now ends three of five queries, plus one unexplained large jump and one source-change budget exhaustion. A1–A4 did not recur. Throughput is unchanged (about 300 px per gesture, 5–6 s per frame).

Next action (candidate7): bridge the photo-discovery module. (1) Native inspector: accept the exact-query `search_list_layout` when the photo module is one of its direct children beside at least one complete merchant card, instead of enumerating module shapes. (2) Reconciler: verify continuity between adjacent frames from any stable OCR lines (snippet, action row, module title) at the same left/right with one consistent upward delta, not only from card headers; when continuity is verified and a name-clipped first card has the same rating line geometry, review count and distance as the previous last card, join it. (3) Investigate the q0003 26→27 jump from the saved XML/PNG pair before changing gesture size. (4) Consider a per-frame instead of per-query refresh budget once (1)–(2) hold. Reproduce each from the probe-6 artifacts (`/runtime/nine-store-verification-20261021f`, local copy in the evidence base `android-probe6-review/download`).

## Candidate7 checkpoint (probe 7)

Source `8d8ebc57b2f2f37fa9530f87ee5ad5c8611ad8fa` (merged to main). Repairs, reproduced first from the probe-6 fixtures (`tests/android-candidate7-probe6.test.ts`, fixtures `candidate6-*`, provenance `provenance-candidate6-probe6.json`): continuity between adjacent frames is measured from two or more identical legible sheet lines (snippet, status, action row, module title) at the same left/right that moved by one consistent non-positive amount within half the list height (`anchoredContinuity`, persisted as `anchors` in each frame JSON); with that continuity a name-clipped first card joins the previous verified row when its rating line kept the same geometry and moved by the anchored amount and rating/review count/distance agree; anchored movement counts as screen progress; the scrolled exact-query list is accepted when its direct children are complete merchant cards plus the photo-discovery module (at least two `Image result for <query> posted by …` tiles, no other label, backward-scroll proof). Software gates: typecheck, full `npm test` 1,557 tests / 73 files (`candidate7-full-tests.log`). No ACR image built for Android.

2026-10-21 12:21–12:36 Asia/Shanghai, run `run_20261021T042153Z_4f919e`, same Pod and tasks, source directory `/runtime/nine-store-source-20261021g` (154 files SHA-256 checked, `candidate7-launch-source.json`), output `/runtime/nine-store-verification-20261021g`, profile hash `3ade85846c51651e913ecb7c00d274372fdc21217b69253a72c40aef46dee6c4`. Original exit 2, `needs_review`, zero restarts, all five GPS injections matched. Independent readback (`candidate7-live-verification.json`): 615 artifact receipts verified, 154 PNGs decoded, 5 query JSON and 5 + 46 CSV rows matched, 5 native refreshes. **Outcome: still 0 of 5 complete; 46 rows (3 ads, 41 organic, 2 unknown) against 28 in probe 6 and 20 in probe 5; 149 search + 5 location screenshots.** Keke (可可小鹵 KEKE BRAISED DELI) is visible at display position 2 / organic 2 for 卤味 and Only Bear at display 2 / organic 1 (behind a Gong Cha ad) for bubble tea near me, but both stay `not_evaluated` because the lists are partial and the final overlap is unverified.

| Query | Frames / rows | Stop reason | What happened |
|---|---:|---|---|
| q0001 卤味 | 25 / 7 | `ranking_unreliable` | The photo module is now crossed (rows 2–7 after it). Frame 25 has no native result list and no OCR sheet header (`query_header_not_recognized`), so its two cards are `unknown` and the overlap 24→25 is unverified. The saved XML of frame 25 has not been inspected yet. |
| q0002 chinese food | 44 / 12 | `ranking_unreliable` | Frames 43→44: Fortune Garden (rating line y 741) disappears and JiBeiChuan appears at y 524, about 1,000 px for one bounded gesture; same signature as probe 6 q0003 26→27. |
| q0003 bubble tea near me | 33 / 13 | `ranking_unreliable` | Frames 32→33: Teamisu cafe (y 744) → Super FL Mart (y 527); the same jump at the same list position as probe 6. Two refreshes were used successfully. |
| q0004 hot pot near me | 34 / 12 | `source_changed` | Three refreshes spent (budget), fourth pre-gesture source change. |
| q0005 bakery | 13 / 2 | `unknown_scroll_layout` | Frames 11–13 traverse the photo module (no cards, continuity held). In frame 13 the module exposes its `View photo map` control; the module-beside-cards rule only allows image-result labels, so the list is rejected again. |

Reading: candidate7 removed the photo-module stop at the first card for q0001/q0002 and q0005 progressed into the module. The recurring blocker is now a ~1,000 px content jump at a fixed position in long lists (q0002 44, q0003 33, probe 6 q0003 27), plus the `View photo map` module state and the source-change budget on q0004.

Next action (candidate8): (1) diff the XML/PNG pairs around the jumps (probe 6 q0003 26/27, probe 7 q0002 43/44, q0003 32/33) to tell a fling from a RecyclerView re-layout; if it is a re-layout after loading more items, a smaller gesture will not help and a backward correction gesture or a second capture before the gesture is needed. (2) Accept the module's `View photo map` control as a known module label (exact text, clickable ViewGroup) in `cardsBesidePhotoModule` while keeping the dedicated photo-map-tail proofs for other shapes. (3) Inspect q0001 frame 25 (no native list, no OCR header). (4) Make the source-change budget per gesture rather than per query once (1)–(3) hold. The verification Pod's 4-hour deadline ends at 05:19 UTC; all outputs stay on the `android-runtime` PVC under `/runtime/nine-store-verification-20261021{e,f,g}`.

## Candidate8 checkpoint (probe 8)

Source `5111f091eda124bfd27423c391ba529501a4da93` (merged to main). Repairs, reproduced first from the probe-7 fixtures (`tests/android-candidate8-probe7.test.ts`, runner tests in `tests/android-runner.test.ts`): a forward gesture whose next frame shares no ordered overlap is corrected by one bounded **backward** gesture (45% of the native list, backward-scroll proof required, `device.swipeResults(evidence, 'backward')`); the skipped frame stays as evidence (`screens[].discarded`) but leaves the reconciled sequence (`nativeFrameCorrections`), at most two per query; the photo-discovery module may carry its own `View photo map` control (clickable ViewGroup with ACTION_CLICK below the tiles, that label only); listing method v11. Software gates: typecheck, full `npm test` 1,577 tests / 77 files.

2026-10-21 15:36–15:50 Asia/Shanghai, run `run_20261021T073609Z_835f64`, new Pod `maps-nine-android-verify-20261021b` (the first Pod's 4-hour deadline had passed; emulator and Appium started by hand from `deploy/android/linux/runtime.py` and `appium.sh`), source `/runtime/nine-store-source-20261021h` (160 files SHA-256 checked), output `/runtime/nine-store-verification-20261021j` (two earlier launches in `…h` and `…i` failed before any capture: Appium not running, then a stale device lease from that failure — cleared after confirming no session existed), profile hash `0441d97dd1e75e1a111a85e6f946c54e3f73b93277894ae3df1562c164a49055`. Original exit 2, `needs_review`, all five GPS injections matched. Independent readback (`candidate8-live-verification.json`): 619 artifact receipts verified, 155 PNGs decoded, 5 + 44 CSV rows matched, 7 native refreshes. **Outcome: still 0 of 5 complete; 44 rows (2 ads, 42 organic, 0 unknown); first query to end in a reliable state (q0002, 14 rows, `not_found_in_prefix`, stopped only by the 60-screenshot budget).**

| Query | Frames / rows | Stop reason | What happened |
|---|---:|---|---|
| q0001 卤味 | 24 / 5 | `ranking_unreliable` | Frame 22 read `一 回 小 店` for the card frame 21 read as `一 间 小 店` (4-character CJK name, one character differs; bigram similarity 0.2 < 0.5). Two backward corrections re-exposed the previous cards (frames 23–24) but every continuity rule rejects *downward* movement, so the corrected frames could not join frame 21 either. Keke visible at display 2 / organic 2. |
| q0002 chinese food | 60 / 14 | `screenshot_budget` | Corrections after frame 48 worked (frame 51 rejoined frame 48); sequence verified to the end; 14 rows reliable; budget exhausted at 60 screenshots. |
| q0003 bubble tea near me | 40 / 14 | `unknown_scroll_layout` | Corrections after frame 33 worked; frame 40's list (one complete card plus the next card whose action row is not yet visible) is not accepted by `liveSearchLists` (`sheetBoundarySource: ocr_header`). Only Bear at display 2 / organic 1 behind a Gong Cha ad. |
| q0004 hot pot near me | 25 / 10 | `ranking_unreliable` | Frame 23: the same card with a 34 px clipped header keeps its legible name but lost its distance text; the clipped-prefix join requires equal distance and the anchored join requires a *null* name, so neither applies; the two corrections then hit the downward-movement rule as in q0001. |
| q0005 bakery | 1 / 1 | `unknown_scroll_layout` | The very first frame (filter row + one card with Directions/Save in a non-scrolling row) is not accepted by `liveSearchLists`, so no gesture was sent. |

Reading: the backward correction works when the previous content is re-exposed and names re-read identically (q0002, q0003). The remaining stops are rule gaps rather than device behaviour: (1) continuity rules refuse downward movement, which is exactly what a correction produces; (2) short CJK names with one misread character fail the bigram similarity; (3) a clipped header whose name is still legible but whose status line lost its distance cannot join; (4) two more list shapes are outside the native whitelist (q0003 frame 40, q0005 frame 1). Throughput: q0002 needed 60 frames for 14 rows; a reliable Top20 needs roughly 90 screenshots at the current 300 px gesture.

Next action (candidate9): mark frames captured after a backward correction and let the overlap/anchor/drift rules accept movement in either direction (within half the list) for them; character-level similarity for short CJK names (share ≥ 60% of characters); anchored clipped join when the clipped card keeps an identical name key; raise `maxScreenshotsPerQuery` for verification runs to 90; then look at the two list shapes.

## Candidate9 checkpoint (probe 9)

Source `d53412f` (compiled files; commit later amended to `b3f05cf` with a test-only change, same `dist`), merged to main. Repairs, reproduced from the probe-8 fixtures (`tests/android-candidate9-probe8.test.ts`): frames captured after a backward correction may show content that moved *down* (within half the list) in the overlap, drift and anchor rules; short CJK names sharing 60% of their characters are the same card at an overlap position (一回小店 / 一间小店); a clipped header whose name is still legible and identical joins through anchored continuity (the probe-8 note about a lost distance was wrong: the join had failed on a 4 px tolerance); per-line movement tolerance 4 → 12 px; listing method v12. Verification config raised `maxScreenshotsPerQuery` to 90. Software gates: full `npm test` 1,583 tests / 78 files (`candidate9-full-tests.log`).

2026-10-21 16:01–16:17 Asia/Shanghai, run `run_20261021T080153Z_05bdb7`, same Pod, source `/runtime/nine-store-source-20261021k` (162 files SHA-256 checked), output `/runtime/nine-store-verification-20261021k`, profile hash `62491d8d2f968bb99bf21a51d6e440d2d1a446f7bd75b5c04456a57e822f4c64`. Original exit 2, `needs_review`. Independent readback (`candidate9-live-verification.json`): 655 artifact receipts verified, 164 PNGs decoded, 5 + 47 CSV rows matched, 8 native refreshes. **Outcome: still 0 of 5 complete; 47 rows (2 ads, 44 organic, 1 unknown); q0004 reached 19 rows (one short of the 20 target).**

| Query | Frames / rows | Stop reason | What happened |
|---|---:|---|---|
| q0001 卤味 | 19 / 3 | `ranking_unreliable` | an `unknown` card entered the sequence (`unknown_cards_precede_organic_ranks`); not yet inspected |
| q0002 chinese food | 52 / 12 | `ranking_unreliable` | overlap missing 50 → 52 after both corrections were spent |
| q0003 bubble tea near me | 33 / 12 | `source_changed` | the three-per-query refresh budget was exhausted |
| q0004 hot pot near me | 54 / 19 | `source_changed` | refresh budget exhausted at 19 reliable rows |
| q0005 bakery | 1 / 1 | `unknown_scroll_layout` | first-frame layout (filter row + one card with a non-scrolling Directions/Save row) still outside the native whitelist |

Next action (candidate10): make the source-change refresh budget per *gesture* (one fresh capture after every sent gesture) instead of three per query — it now ends the two longest runs; inspect q0001's unknown card and q0002 frames 50–52; accept the q0005 first-frame layout. The verification Pod `maps-nine-android-verify-20261021b` expires at 11:11 UTC; all outputs stay on the PVC (`…h`, `…j`, `…k`).

## Candidate10 (repairs from the probe-9 evidence; not yet run on a device)

2026-10-22. Diagnosed from the downloaded probe-9 outputs (`run_20261021T080153Z_05bdb7`); the frames used by the tests are copied byte-for-byte under `tests/fixtures/android/repair-probe-20261021/candidate9-*` with `provenance-candidate9-probe9.json`. Listing method `v13`. Tests: `tests/android-candidate10-probe9.test.ts` (9 tests; 7 fail on the candidate9 code, the 2 refusal guards pass on both), full suite 1,602 tests, Python OCR tests 26.

| Probe-9 failure | Cause found in the evidence | Repair |
|---|---|---|
| q0003, q0004 `source_changed` (and every one of the 8 refreshes in the run) | In all 8 refused/refreshed pairs the only XML difference is an empty leaf `ImageView` inserted over a photo placeholder with identical bounds, i.e. a merchant photo finished loading after the snapshot. q0003 died on the refusal right after a refresh, q0004 on the third-per-query cap. | Gesture guards compare `nativeLayoutSignature()` (empty unlabelled leaf ImageViews, sibling ordering attributes and inter-tag whitespace removed). Labelled images, text and bounds changes still refuse; consecutive frames after a real gesture still differ. The refresh budget is now one per sent gesture (still never two in a row). |
| q0002 `ordered_overlap_missing 050 -> 052` | The forward gesture flung ~95% of the list; after the 45% backward correction the kept and corrected frames share two unique lines (`opens 11 am - 0.9 mi`, `and cooked with care."`) moved by -505 px, just beyond the half-list (-479 px) anchor bound. | Upward anchored movement may reach 70% of the list (two unique consistent anchors still required; downward bound unchanged). |
| q0001 `unknown_cards_precede_organic_ranks` | Frame 19's last card, fully visible, OCR'd `Braised Canaan WIR db ipglk` at confidence 38.66 (< 40); the run stopped on that frame. | The query continues while the only uncertainty is a trailing card first read in the newest frame below the name floor (`onlyPendingLowConfidence`). At an anchored overlap a later legible reading resolves it when rating, review count and distance (all present) agree, the names share a prefix (or are similar), and the rating line moved by the anchored amount; the row gets `low_confidence_name_resolved_by_line_anchors`. Unresolved at the end, the ranking stays unreliable. |
| q0005 `unknown_scroll_layout` on frame 1 | The half sheet's only card has a complete, non-scrolling Directions + Save row; the classifier accepted only Directions/Call/Website. | `closedStaticActionRow` accepts a complete row of 2-3 known controls led by Directions with the same strict containment checks; unknown controls or a clipped strip still fail. |

Next action: probe 10 on a fresh verification Pod with these compiled files (same five queries, then the nine-store set), following the checklist below. Record the original exit code, counts and receipts here whatever the outcome.

## Candidate10 checkpoint (probe 10) and candidate11

2026-10-22 06:39–07:00 UTC, run `run_20261022T063939Z_3f8f10`, new Pod `maps-nine-android-verify-20261022` (UID `d7d6489f…`, 4-hour deadline from 06:32Z; the expired `…20261021b` Pod was deleted, PVC kept; emulator started from `runtime.py`, booted 06:36Z; Appium 3.8.0 started from `appium.sh`), source `/runtime/nine-store-source-20261022a` (main `2944c8d`, 156 files SHA-256 verified in the Pod), output `/runtime/nine-store-verification-20261022a`, same five tasks and limits as probe 9. Original exit 2, `needs_review`, all five GPS fixes matched. Independent check (`android-probe10-review/verify.py`): 891 artifact receipts verified, 223 PNGs decoded, 5 + 72 CSV rows matched. **Outcome: 2 of 5 complete reliable Top 20 for the first time; 0 source-change refreshes were needed.**

| Query | Screens / rows | Stop | What happened |
|---|---:|---|---|
| q0001 卤味 @ keke-center | 7 / 1 | `stalled_no_new_cards` | Google listed Er Hou Roast Chicken first this time (Keke was first in probe 9). Inside the tall photo-discovery module only one OCR line repeated exactly between frames, so measured progress was false three times and the query stalled. |
| q0002 chinese food @ keke-3km | 69 / 20 | `target_reached` | Complete, reliable; Keke not in the Top 20. Two corrections used and both rejoined. |
| q0003 bubble tea near me @ onlybear-center | 44 / 18 | `ranking_unreliable` | Frame 42's only card name was not recognised (no cards); frames 43 and the corrected 44 were compared with that empty frame only, so the gap was reported and 44's two cards were appended again (rows 17-18 duplicate 15-16). |
| q0004 hot pot near me @ seejoy-5km | 55 / 20 | `target_reached` | Complete, reliable; SEE JOY not in the Top 20. |
| q0005 bakery @ uws-center | 43 / 13 | `ranking_unreliable` | One card (4.3, 985 reviews, 0.2 mi) read as Maman / miamian / maman / Maman (last below the floor) in frames 40-43 became four rows; anchored continuity held, so the duplicates were silently appended before the low-confidence reading stopped the query. |

Candidate11 (listing method v14), tests `tests/android-candidate11-probe10.test.ts` from byte-for-byte probe-10 fixtures (`candidate10-*`, `provenance-candidate10-probe10.json`; 4 fail on candidate10, the 3 guards pass on both), full suite 1,610 tests:
- one unique OCR line of at least 16 characters moving up within 70% of the list counts as progress (stall counter only);
- at an anchored overlap position, equal rating, review count and distance plus a rating line moved by the anchored amount identify the same occurrence whatever the OCR names (replaces the one-directional low-confidence resolver); the most confident reading names the row (`name_joined_by_line_anchors`);
- when the previous frame shows no cards, a frame that does not join it is compared with the last frame that showed cards (`overlap_verified_across_cardless_frame`); a real gap is still reported.

## Candidate11 checkpoint (probe 11) and candidate12

2026-10-22 07:10–07:33 UTC, run `run_20261022T071047Z_e8834f`, same Pod, source `/runtime/nine-store-source-20261022b` (main `ed7ee0d`, 156 files verified), output `…20261022b`, same tasks. Original exit 2, all GPS matched. Independent check: 975 receipts, 244 PNGs, 5 + 77 CSV rows. **Outcome: 3 of 5 complete reliable Top 20**: chinese food @ keke-3km (Keke not in Top 20), bubble tea near me @ onlybear-center (**Only Bear display 2 / organic 1**, behind a Gong Cha ad), bakery @ uws-center (not in Top 20). No source-change refreshes.

| Query | Screens / rows | Stop | What happened |
|---|---:|---|---|
| q0001 卤味 | 24 / 7 | `ranking_unreliable` | Er Hou 1, Keke 2, Braised Canaan 3, 一间小店 4 read correctly; a CJK name read as `SRE RRs` / `SRE` (both below the floor) in frames 23-24, and 一间小店's clipped header in frame 24 did not join, so both were appended as new rows. |
| q0004 hot pot near me | 21 / 10 | `ranking_unreliable` | Frames 20-21: KPOT's header clipped in both; no ordered overlap matched, anchored continuity held (-78 px), so KPOT and Mt. ShooTao were appended again (rows 9-10 duplicate 7-8). |

Candidate12 (listing method v15; `tests/android-candidate12-probe11.test.ts`, fixtures `candidate11-*`):
- with anchored movement known and no ordered overlap, every card whose rating line was already inside the previous viewport is placed on the previous card at the shifted position (equal rating and review count, distance compatible, rating line within 12 px, only name/clipping/status warnings); it is never appended as a new merchant (`joined_by_anchored_geometry`). Conversely a previous card that should now be well inside the viewport must be present. Either contradiction (`anchored_card_unmatched`, `anchored_card_missing`) makes the ranking unreliable;
- OCR names never contradict a geometric identity (probe 11 q0003 frames 35-36: TIGER SUGAR read confidently as `CER >UCAR TI`), except at a clipped header, where two confident names must have equal keys;
- a low-confidence row may keep the query going while it is visible in the newest frame and has been read in at most three frames.
Full replay of every probe-10/11 query: the six device-reliable queries replay identically (names and ranks); probe-10 bubble tea and bakery and probe-11 hot pot replay as reliable without their duplicates; probe-11 卤味 stays unreliable but pending.

## Candidate12 checkpoint (probe 12) and candidate13

2026-10-22 07:46–08:04 UTC, run `run_20261022T074629Z_360bfb`, same Pod, source `…20261022c` (main `a24215d`, 156 files verified), same tasks. Original exit 2, all GPS matched. Independent check: 723 receipts, 181 PNGs, 5 + 60 CSV rows. **Outcome: 2 of 5 complete reliable** (chinese food: Keke not in Top 20; bubble tea near me: **Only Bear organic 1** again). 卤味 read 7 merchants correctly (Keke 1 this time) and stopped on a newest card whose name was not recognised; hot pot raised `anchored_card_missing` 25 -> 26 because frame 25 read a bottom-edge rating line as 239 reviews (339 in full); bakery frame 2 (one card with a complete Directions / Share / Save row above the photo module) was outside the list whitelist.

Candidate13 (listing method v16; `tests/android-candidate13-probe12.test.ts`, fixtures `candidate12-*`; 3 fail on candidate12, the guard passes on both; full suite 1,618):
- a bottom-edge reading (rating line within 40 px of the list bottom) joins the next frame's card at the shifted position by name, and the full reading replaces rating, reviews and distance (`edge_reading_corrected_by_full_reading`); it is not required to reappear in the converse check;
- the filters + merchant + photo-module list variant accepts a complete non-scrolling action row through `closedStaticActionRow`;
- a newest card whose name was not recognised gets the same up-to-three readings as a low-confidence name.
Full replay of all fifteen probe-10..12 queries: the nine device-reliable queries replay identically; probe-12 hot pot replays as reliable without its duplicate; both 卤味 runs are pending (the query would continue).

## Candidate13 checkpoint (probe 13)

2026-10-22 08:11–08:32 UTC, run `run_20261022T081138Z_3d1b4c`, same Pod, source `…20261022d` (main `29d8ae7`, 156 files verified), same tasks. Original exit 2, all GPS matched. Independent check (`android-probe13-review/verify.py`; the single-stream `kubectl exec tar` download truncated at ~158 MB twice, so the output was fetched per query directory with byte counts compared to the Pod side): 823 receipts, 206 PNGs, 5 + 68 CSV rows. **Outcome: 3 of 5 complete reliable Top 20** — chinese food @ keke-3km (Keke not in Top 20), bubble tea near me @ onlybear-center (**Only Bear organic 1**, third run in a row), hot pot near me @ seejoy-5km (first complete run; SEE JOY not in Top 20).

Progress across this Pod (same five queries): probe 9 0/5 → probe 10 2/5 → probe 11 3/5 → probe 12 2/5 → probe 13 3/5; no source-change refresh was needed after candidate10.

Remaining failures (next candidate):
- q0001 卤味: frame 24 was a valid next frame (the card read as `SR ERRe` in frame 23 read as `浮 香 居 傳統 次 發`, same 4.9 / 55 / 0.5 mi) but too few identical OCR lines gave no anchored movement, so it was treated as an overlap gap; two backward corrections overshot (frames 25-26 sit above frame 23) and their cards were appended again (rows 6-7 duplicate 3-4). Next: identify a trailing card by rating, reviews and distance in the frame after a forward gesture before declaring a gap, and place corrected frames by the same geometry instead of appending.
- q0005 bakery: frame 3 is the scrolled form of probe-12 frame 2 (filter row off screen, one card with a complete Directions / Share / Save row above the photo module); the scrolled photo-module variants still require a scrolling action row. Next: use `closedStaticActionRow` in those variants as well.
- The pilot Pod `maps-nine-android-verify-20261022` expires at 10:32 UTC by its deadline; outputs stay on the PVC (`…20261022a`–`d`). No Android CronJob exists; step 3 (scheduled Android scans reading the store settings) has not started.

## Candidate14 (repairs for the probe-13 failures)

Listing method v17; `tests/android-candidate14-probe13.test.ts` from byte-for-byte probe-13 fixtures (`candidate13-*`; 3 fail on candidate13, the residue guard passes on both); full suite 1,622.
- `cardPairContinuity`: when too few OCR lines repeat exactly, two previous cards with unique rating + review counts in both frames, compatible distances and the same rating-line span that moved by one amount (±12 px, same bounds as line anchors) prove the movement. Probe 13 q0001 frames 23 -> 24 (394 -> 317, 990 -> 912) are then continuous, the unreadable card resolves to `浮 香 居 …`, and no backward correction is triggered; replaying frames 1-24 gives five reliable rows (Keke 1).
- `residualFilterContainer`: after the filter row scrolls off, its container remains as a 1 px band at the list top; the scrolled photo-module variants ignore exactly that residue (full width, ≤ 2 px, filter recycler inside, only known chip labels) and accept a complete static action row. Probe 13 q0005 frame 3 is a result list.
Full replay of the twenty probe-10..13 queries: all twelve device-reliable queries replay identically.

## Candidate14 checkpoint (probe 14)

2026-10-22 08:44–09:11 UTC, run `run_20261022T084417Z_cba25e`, same Pod, source `…20261022e` (main `c0641d4`, 156 files verified), same tasks. Original exit 2, all GPS matched. Independent check (per-query downloads; the bakery directory needed 60-file batches): 1,155 receipts, 289 PNGs, 5 + 90 CSV rows. **Outcome: 4 of 5 complete reliable Top 20** — chinese food (Keke not in Top 20), bubble tea near me (**Only Bear organic 1**, fourth run in a row), hot pot near me (SEE JOY not in Top 20), bakery (first complete run; target not in Top 20).

Progress on this Pod: probe 9 0/5 → 10: 2/5 → 11: 3/5 → 12: 2/5 → 13: 3/5 → **14: 4/5**.

Remaining: 卤味 read ten rows and stopped on `anchored_card_unmatched` / `anchored_card_missing` 35 -> 36 (line and card-pair movement both -78). The first card's header is clipped in frame 36; its readings `pd =) 36h tR Master of Braised Delicacies` (71) and `锣 常 门 猪 脚 饭 Master of Braised Delicacies` (84) differ only in the CJK part, and the clipped-header rule requires equal name keys. The refusal kept the ranking honest (no duplicate). Next: at a clipped header, also accept two confident names sharing a long Latin component (e.g. ≥ 12 characters).

## Step 3: first scheduled-job run (Only Bear, 2026-10-22)

CronJob `maps-targets-android-daily` (ns `android-maps-pilot`, suspended) reads the stores from Mongo with the verified capture profile. Manual Jobs are created from it with `--store-id only-bear` (27 queries: 9 keywords x center/3km/5km).
- First Job (image from f2b99df) stopped at q0001: `GPS_INJECTION_REJECTED`. Cause: the root sidecar's emulator writes `/tmp/.emulator_console_auth_token` mode 600; the uid-1001 collector's `adb emu geo fix` could not authenticate. Fix 91d3ece: the sidecar hands the token to the collector uid (`share_console_token`).
- Second Job `maps-targets-android-manual-202610220956` (image sha256:57f90c7a…, ACR ch159f): all 27 queries located and observed in 1 h 57 min (~4.4 min/query), 27 observations inserted, 938 screenshots; exit 2 = partial. Batch 1 (`run_20261022T095919Z_83d94f`): 10 captured / 10 needs review; batch 2 (`run_20261022T112504Z_83b35b`): 1 / 6. Every needs-review query stopped on the reader, not on the device.

## Candidate15 (repairs for the scheduled-run failures)

Listing method v18; `tests/android-candidate15-scheduled1.test.ts` from byte-for-byte fixtures (`candidate15-*`, provenance JSON); full suite 1,637.
- `joinSplitRatingLines`: a rating read as its own OCR line (`4.6`, or `45` with the dot lost) beside `(39) · …` on the same row is joined (batch 1 q0001 f49, q0004 f36; also probe-10 q0003 f42).
- RATING accepts a spaced `x` as the star (`5.0 x (1)`, q0018 f19).
- Geometric placement treats `native_ad_label_confirmed` as evidence (q0005 f8-9) and `name_not_recognized` as pending (probe 14 卤味 f35-36); a rating line cut by the list top is measured from its bottom (q0012 f5-6); a "No reviews" card needs its exact confident name (batch 2 q0001 f36-37).
- `clippedNamesAgree`: at a clipped header two confident names may differ in a garbled part when the shared start + end is ≥ 12 characters and ≥ 60 % of the shorter key, but never when one only extends the other (`Kennedy's nck & Sandwiches`, q0013 f25; probe 14 卤味 now PENDING instead of stopping).
- Photo-module continuation: a trailing merchant without photos may be up to 320 px tall (q0003 f13); the icon may read `Wheelchair not accessible` (q0015 f18).
- Ads: a trailing owner showing only its 2 px `About this ad` button is a pending header (batch 2 q0003 f8); clipped `Sponsored` markers at the list top belong to the one nameless card below them (q0009 f3).
Replay: batch 1 10/10 needs-review queries now continue (all 10 captured identical); batch 2 (held out while designing the first eight rules) 5/6, all captured identical; probes 10-14 device-reliable queries identical. Remaining: batch 2 q0002 frames 48 -> 50 (an ad's sitelink box: one shared OCR line across a 590 px move), and two device-side stops (`stalled_same_frame`, `unknown_scroll_layout`) whose frames replay reliable.

## Operational read-only commands

```sh
kubectl --context FBRDevAKSCluster -n android-maps-pilot get pod maps-nine-android-verify-20261021 -o wide
kubectl --context FBRDevAKSCluster -n uat get cronjob maps-keyword-monitor-daily maps-tracking-web-2h maps-targets-web-2h
```

Check the Pod UID and deadline against the checkpoint before using any saved helper. The collector was launched inside the runtime container; its application log is the candidate output directory's `capture.log`, not necessarily `kubectl logs`. Never start the launch script twice: `started.json` is an exclusive run guard. Preserve the PVC and candidate output directories when cleaning up a finished Pod.

See also `docs/ci-images.md` for ACR builds and `deploy/tracking-targets/` for candidate catalog/schedules. A subsequent maintainer should append a dated checkpoint with source commit, original exit code, counts, receipt coverage, visual scope, unresolved issues and next action. Do not rewrite prior failed observations into successful ones.

## Next engineer checklist

- Check current Git diff and this handoff before editing; do not overwrite another developer's work.
- Confirm the verification Pod deadline/liveness and absence of active captures; do not start a second emulator or OCR task on the same worker.
- Software regressions and independent review have passed. For reproduction, run: `npm run typecheck`, `npm test`, `npm run build`, and `python3 -m unittest discover -s deploy/android/linux -p 'test_*.py'`.
- Freeze compiled files and configuration with SHA-256 under a fresh candidate directory on the owned PVC; verify the uploaded bytes before executing. Use approved original keywords and coordinates, max20 displayed rows /60screens /600seconds per query.
- Save all outputs and verify them independently before changing a profile, stopping the pilot, or planning a deployment.
- Terraform drift is tracked separately in `fbr-env-project/azure/infra/env/04-aks.tf`: local reconciliation sets count1 and the Android taint. Do not assume it has been committed/pushed/applied; check that repository separately.

## 2026-10-23 — Source-repair stage (before deployment)

The latest source review found an edge-join classification contradiction, independently mutable worker catalogs, and concurrent manual Job creation. Implementation, expected behavior, isolated rollout requirements and orphan-lock recovery are recorded in [scan-consistency-handoff.md](scan-consistency-handoff.md). Android listing method advances from v18 to v19: accumulated ad/organic contradictions (including an intermediate unknown frame) invalidate natural ranking without erasing the original frame evidence.

This source repair does not replace earlier live probe findings or imply candidate15/v19 full-device acceptance. At this source-repair stage, no active collectors, source keywords, observations, screenshots, schedules or cloud images were changed. See the later release follow-up below for deployed state. Review the new shared snapshot/gate contract before deploying; old and new collector versions must not run together on the same target.


## 2026-10-23 UAT release follow-up

See [the merged release verification](../evidence/2026-10-23/uat-scan-consistency/README.md). The v19 image is deployed to the suspended Android template. Both real App queries returned review outcomes (KEKE overlap/clipped card; OnlyBear still in autocomplete). GPS and independent artifact delivery passed; qualified rankings did not. Preserve suspension until the documented result-state and scrolling cases are repaired and verified.


## 2026-10-23 — Search submission and initial sheet preparation

Follow-up to the two isolated release failures above, on branch `codex/android-search-scroll-20261023`.

- **KEKE root cause:** the production runner calls `search()` but never calls the existing `prepareResults()` helper. Its first capture therefore retained the collapsed bottom sheet. Subsequent result-list gestures changed sheet geometry and repeatedly failed ordered overlap. Search now invokes the existing bounded expansion only for a recognized native sheet with proven list top. Exact-query, before/after XML, expanded geometry and post-expansion list-top guards are retained. No overlap, identity or ad-classification threshold is relaxed.
- **OnlyBear root cause:** an unchanged exact-query autocomplete screen was accepted under the settled-unknown-layout evidence route. Visible Maps-owned `typed_suggest_container` now blocks readiness. ENTER is submitted once with Android `FLAG_EDITOR_ACTION` (16); transport completion alone is never readiness. There is no suggestion selection, query rewrite or uncertain submission retry. Persistent suggestions time out and retain a bounded diagnostic.
- **Regression evidence:** unmodified native XML from both failed runs is in `tests/fixtures/android/release-20261023/`. Both regressions failed on the old code and passed after the change. The test expansion transition is synthetic; actual App acceptance requires the isolated validation below.
- **Expected acceptance:** both exact original queries leave the editor, capture the expanded list from the top, retain continuous ordered screenshots to the configured limit or a verified list end, and preserve distinct display/organic ranks. GPS receipt and storage checks are independent of ranking acceptance. Backend search locality remains unverified.
- **Isolation:** retain all historical runs. Use a new verification database and Job, only KEKE/OnlyBear center points, the dedicated crawler workers, and a candidate image. Keep production CronJobs, Web/UI images, shared keyword collections and Android suspension unchanged.

At this checkpoint real-device verification was pending. Later checkpoints below record the failed first retest and subsequent candidates; this checkpoint does not establish Android scheduling acceptance.

## 2026-10-23 — First isolated retest and second candidate

The preceding ENTER-with-flags hypothesis did **not** fix actual OnlyBear submission. Candidate 24bd4b7 / ACR ch159p ran in a fresh two-store verification DB and an isolated indexed Job; production templates and schedules were unchanged. KEKE expanded successfully and reached 14 continuous organic rows, then stopped on a late overlap mismatch (exit 2). OnlyBear remained in suggestions and correctly timed out (exit 1). No qualified ranking acceptance is claimed. Independent Azure login readback verified 174 objects and 172 exact writer receipts; all 41 PNGs decoded, 88 JSON files parsed, and both query CSVs / 16 listing rows matched the JSON artifacts.

Second-candidate changes:
- Appium's installed editor-action helper types a control sequence through `io.appium.settings/.AppiumIME`. Wait for this already-enabled IME to be selected and bound before exactly one numeric IME_ACTION_SEARCH (3); recheck the focused exact Maps query immediately before submission. Restore the original IME with a bounded cleanup, including cancellation. Preserve a primary failure if restoration also fails, and retry restoration during close before releasing the device. No keyboard installation, suggestion selection, query rewriting or uncertain resubmission.
- KEKE frames 36/37 visibly show the same card moving about 304 px. Its rating row changed only separator OCR (`4.8% (273) - $40-50 - barbecue` versus `4.8% (273) .$40-50.barbecue`). Normalize separators only on recognized rating anchors, retaining numeric tokens, price ranges, currency and category. Keep exact-anchor decisions first. This fallback only applies to one card in each viewport with equal non-null rating/count and a second independent exact non-rating anchor, consistent motion, global anchor uniqueness, identical native viewport and all existing card/ad contradiction guards.
- New real-frame positive and negative regressions cover changed facts, missing anchors, inconsistent movement and conflicting ad classification. IME regressions cover unavailable/binding-timeout/focus-loss/ambiguous submission/cancellation/restoration failure.

At this checkpoint second-candidate real-device acceptance was pending. Its actual outcomes are recorded below. Keep the Android production schedule suspended until acceptance; do not replace historical failures with replay results.

## 2026-10-23 — Third bounded candidate: scrollbar geometry and terminal footer

Candidate2 fixed actual OnlyBear submission: exact query, display3 / organic2, one visually confirmed Sponsored Gong Cha. It remained partial because Maps' actual `Looking for someplace else?` / `Add a missing place` footer was not recognized, despite native `canScrollForward=false`. The dual-worker KEKE run stopped in OCR after about30seconds during worker1 startup; this is a possible resource-contention event, not a confirmed parser regression.

A same-image, single-worker KEKE retest preserved three frames and stopped on a distinct reproducible geometry error: the scrollbar at x712–716 was OCR'd as `|` on the rating line, expanding its bounds from the actual y344–371 to y318–379. This prevented the existing conservative clipped-header overlap rule from associating Woodam with its preceding full card.

The third candidate derives rating geometry without only a thin/tall `|` at the far right edge, with all other words well inside the content area. Raw PNG/OCR remain immutable. Near-top card classification stays unknown locally; prior-frame geometric/identity proof is still required to restore it. No ad text is excluded. The new terminal-footer route requires the exact native query, supported native list, no forward action, same-list enabled title and missing-place button, and matching OCR title below the final card. Stationary screenshots alone remain insufficient. Regression tests cover missing/scrollable/wrong-query/absent-OCR footer and interior/text/wide-bar negatives.

See [verification evidence](../evidence/2026-10-23/android-search-scroll/README.md) for each immutable run and limits. The latest verified checkpoint above records the final real App outcome and remaining blocker.


### Candidate3 remaining execution blocker and next investigation

The isolated serial KEKE worker (source `0dabee3`, Job `maps-android-search-scroll-v3-20261023`, index0) exited1 at2026-10-23 11:59:20 Asia/Shanghai before producing a ranking frame. The immutable query reports `appium_protocol_error`; its diagnostic screenshot/native XML shows the exact submitted result query, and fresh GPS matched. It cannot validate the new scroll fix. No automatic rerun or gate clearing was performed.

The generic collector error omits the failed Appium command, HTTP status/response and original cause. Sidecar Appium logs are written to Pod-local `/tmp/appium.log`, not durable storage or container stdout, and the sidecar terminates immediately with the collector. Therefore the original command failure cannot be recovered through normal completed-Pod logs. This is a diagnosed observability gap; stale native handles, Appium transport failure or result-state timing are **unconfirmed hypotheses**. The prior candidate2 OCR timeout also remains unexplained; serial execution removes overlapping emulator startup from this run but does not establish the earlier cause.

Before another behavioral patch:
1. Retain bounded, sanitized command-level failure diagnostics (stage, command name, HTTP status, W3C error code and timing) alongside the query, without credentials, console tokens or full screenshot bodies.
2. Persist Appium/OCR error tails on the same owned run before sidecar teardown; retain the primary error and separate cleanup outcomes. Do not log arbitrary shell environment or private key files.
3. Reproduce the exact two queries/points on a fresh isolated database with the same pinned image/profile. Fix a specific evidenced state transition, with replay/regression tests and one bounded native acceptance run. Never automatically repeat uncertain search submission.
4. Require KEKE end-to-end ordered capture and both original exit codes0 before promoting the Android template. Then separately test concurrent workers and full target-catalog capacity. Web and existing collectors must remain unchanged.

After several candidates exposed separate state/OCR/transport failure layers, further broadening of OCR thresholds is not justified. Preserve current failure evidence and improve native state/transport diagnosis first.


## 2026-10-23 — Follow-up: durable command diagnostics (verified; KEKE acceptance still partial)

User authorized continuing the KEKE Appium investigation with durable evidence before another behavior fix. The collector now records allowlisted command metadata: phase, command category, monotonically increasing sequence, timestamp/duration, HTTP status, W3C error class and response **type** (never value). It does not serialize request bodies, query text, native element/session IDs, server messages, stack traces, Appium URLs, environment variables or credentials.

The journal is cumulative for the device session: last256 commands plus first32 failures; counters expose omitted history. Checkpoints are immutable `command_log` JSON artifacts at session start, location/search completion, every5 selected frames, query-final and after cleanup, with normal bytes/SHA-256/storage receipts. This retains failure metadata before normal sidecar teardown, including separate restoration/cleanup failures. It does not guarantee delivery after SIGKILL/node loss, and it cannot recover a pre-existing run's missing logs. The last successful checkpoint bounds crash evidence.

Storage failure remains fail-closed: a failed final checkpoint cannot start a later query or change its location. Original search failure remains primary when diagnostic persistence also fails. Reading the journal executes no device commands, including after cancellation. The checkpoint files are cumulative; sequence/timestamps and checkpoint query path establish context, not a claim that all recorded commands belong only to that query.

Regression tests include HTTP500 editor-action failure metadata with query/session redaction, journal bounds and hostile fields, startup phase, query-final/cleanup persistence, original-error preservation and a two-query storage-failure stop. Independent code review found the initial second-query storage continuation bug; its failing test was reproduced, then fixed. No collection behavior or promotion has been changed in this instrumentation checkpoint.


### Diagnostic probe result and remaining work

`maps-android-command-log-20261023` used a fresh database with the same name, one KEKE keyword/center, worker0 only, unchanged90-frame/89-scroll/600-second profile. It did not write to production observations or change any scheduled workload. Actual tracking runtime was12:52:10–12:57:09 Asia/Shanghai; original exit2. Job Failed reflects the intentionally nonzero partial result, not an Appium/server crash. Sidecar exited0; no restart.

All794 bounded journal entries are recoverable from this run's11 overlapping checkpoints; no HTTP/ADB command failed. The exact one-time editor action and result-sheet expansion both succeeded. The old pre-first-frame Appium protocol error was not reproduced, so its cause remains unknown. Checkpoint storage introduces additional I/O timing; this single successful command path does not exclude a prior race. Do not label stale elements, transport, timing or resource pressure as a confirmed cause and do not introduce uncertain-submission retries.

New stopping evidence is separate: `frame-031` and `frame-032` visually show the same Braised Canaan card moving upward. OCR changes `Braised Canaan 迦 南 地 涉 味` to `Braised Canaan Wma steal`, inserts rating-symbol whitespace and loses `Closed` from the status line. Native query remains exact. Current overlap guards reject the match after the two allowed backward corrections, preserve the original frames and withhold final ranking. Matching4.8/75 alone is insufficient identity proof. The next OCR change needs exact captured fixtures, independent geometric/anchor evidence and negative cases, not a global fuzzy-name or higher retry threshold.

Portable artifact keys/hashes are in [remaining-ocr-boundary.json](../evidence/2026-10-23/android-command-diagnostics/remaining-ocr-boundary.json). Azure account/container: `fbrdevstorage/maps-keyword-capture-uat`; run prefix `android-maps/2026-10-23/run_20261023T045212Z_cabf64/`. Original historical failures remain untouched. The local Appium server tail was additionally retained for this probe but is bounded and may miss final teardown; Azure command-log receipts are the durable diagnostic contract. No broad raw server-log or screenshot-body logging was introduced.

## 2026-10-23 — KEKE frame31/32 repair (historical regression passed; new native run partial)

User authorized fixing the exact retained `run_20261023T045212Z_cabf64` frame31→32 boundary, preserving command logs, then running an isolated verification. Original PNG/XML/OCR/frame artifacts and their independently checked receipts are now portable fixtures in `tests/fixtures/android/command-probe-20261023/`.

Confirmed mechanism: the trailing Braised Canaan name loses its CJK text in OCR, the status line loses `Closed`, the rating-star spacing changes, and an independent review snippet switches its opening quote glyph. Exact name/status/anchor matching therefore had no usable two-anchor movement proof. A new bounded fallback compares a unique fact-preserving rating line plus a unique long quoted snippet above the same suffix/prefix card. Only quote glyphs change for the snippet; words/numbers/punctuation remain exact. Both anchors must share horizontal geometry, line height and bounded motion in the same exact-query native viewport. Card rating/count/category/distance and known ad/organic type must agree; ambiguous rating tuples, clipped/warning-bearing cards, invalid boxes and conflicting exact motion reject it. Existing identity placement and ad-conflict gates remain active. Raw OCR and historical observations are immutable; no fuzzy-name threshold or retry budget was raised.

The listing profile advances from v19 to `full_screen_ocr_native_context_ordered_overlap/v20`, so new observations remain distinguishable. Real-fixture regression reproduces the old failure before the patch. Thirty selected original frame JSONs replay to12 ordered organic occurrences, with the final card joined rather than duplicated; this prefix does not reach an end marker and does not itself establish complete-list acceptance. Tests cover changed words/facts/metadata, duplicate anchors/cards, query/viewport differences, contradictory motion, clipping, malformed geometry and ad/unknown conflicts. Durable bounded command logs remain enabled, including final/cleanup checkpoints. The subsequent isolated run finished with a distinct rating OCR defect; its original exit2 and evidence are recorded in the Historical continuity checkpoint (run finished13:24:42). The original intermittent Appium fault remains unreproduced.

## 2026-10-23 — Candidate: independent rating reread for KEKE frame35/36

The visible Longjiang rating is4.1 with18 reviews, but original full-screen OCR emits one malformed token `4.19%`. No native accessibility rating is available. Truncating the number would fabricate evidence. The exact immutable PNG was therefore reread inside an isolated CPU-only Pod using the pinned Tesseract5.3.0 runtime. Two line modes (PSM7 and13, English, scale3, six-pixel crop padding) independently emit `4.1% (18) - $10-20 - Chinese`. The separate bottom-edge malformed49% line disagrees between passes and remains rejected.

Candidate v21 preserves primary OCR lines and adds bounded `ratingRereads` evidence (original line index, pixel crop, languages, scale, both raw line/word results and optional error class). At most two malformed numeric rating heads are reread from the same immutable PNG. All rereads share a two-second budget, earlier than the caller's absolute OCR deadline with serialization/exit headroom. A slow optional pass returns the primary OCR and bounded error metadata. The real subprocess regression reproduced the original deadline bug, then passed after the deadline fix.

The reader requires an exact-query supported native list, a fully contained original line, bounded crop/line geometry, two different specified modes, confidence>=60, identical reread text, and the original parenthesized count plus entire remaining text unchanged. It never replaces an already-valid rating, guesses a decimal/digit, or uses a prior card's rating. Raw evidence remains immutable and profile method advances to `full_screen_ocr_native_context_ordered_overlap/v21`. Existing identity, advertisement, ordering and terminal-list checks are unchanged; durable Appium command checkpoints remain enabled.

Original frames35/36 are portable fixtures in `tests/fixtures/android/rating-reread-20261023/`. The positive regression failed before the patch; negative cases cover disagreement, wrong count/tail/crop/native query, missing/duplicate modes, ambiguous records, low confidence and failed rereads. Supplementing only frame36 in the original34-selected-frame sequence produces14 continuous organic occurrences, with no end marker. This is offline evidence, not complete native acceptance. The isolated native run ended partial after three captures due to an earlier result-panel state transition; see the latest checkpoint. It did not reach or reproduce the requested frame35/36 case.

## 2026-10-23 — Result-sheet state and bounded top recovery (candidate v22)

### Confirmed failure and intended behavior

The preceding native run `run_20261023T055758Z_214478` stopped after three frames. Frames1–2 showed the same Nong Geng Ji rating/count (4.6/547) moving308px while the bilingual name and action-row OCR changed. Exact native Directions/Order/Menu controls moved by the same308px. The first backward correction returned to the verified list top and collapsed the sheet (list top272/274→456). Another backward attempt was refused because the list could no longer scroll backward. All185 journal commands succeeded; this is a result-state/continuity failure, not a demonstrated Appium transport failure.

The candidate addresses both transitions, without changing the shared keyword catalog, schedules or production images:

- Motion may be corroborated by two distinct uniquely placed native action controls **inside the exact result list**, fully visible and enabled, plus one unique unchanged screenshot rating/count row with consistent geometry and classification. This fallback also requires a confident complete card header, an identical first three Latin name tokens (at least eight letters) and unchanged category/price/distance. Original word-level OCR must reconstruct both names exactly. The full Latin/numeric token sequences must agree: clean branch suffixes/extensions are not ignored. A punctuation-prefixed Latin garble (confidence<20, at most six letters, no digits) may be excluded only where its translated bounds match a unique high-confidence (>=80) Chinese word of at least two characters in the other screenshot. This covers the observed `#aic`/`农耕` error, not arbitrary branch-name differences. It cannot replace the stricter short-CJK or quoted-snippet paths. Controls only prove motion; existing card identity and ad gates still decide an occurrence join. A contradictory exact OCR anchor vetoes this fallback. Disabled, clipped, overlay or ambiguous controls cannot supply proof.
- After a backward correction, a changed sheet at an independently verified native top may be re-expanded **once per query**. The device must verify the latest captured source against live exact-query native state before using the existing one-gesture expansion routine. It never retypes the query or blindly scrolls backwards at the top.
- The previous selected sequence is retained as `sheet_top_restart` evidence. New ranks start from a fresh verified first frame. `nativeSheetRecoveries` records the triggering frame, superseded IDs, attempted/completed state and fresh restart frame; neither a successful gesture nor old prefix is proof of the new ranking.
- Recovery and backward correction consume existing screenshot, movement and deadline budgets; they cannot send a gesture when no follow-up screenshot budget remains. Uncertain Appium/transport outcomes are not retried. Command checkpoints remain durable before/after recovery and at query/cleanup boundaries.
- Listing method changes to `full_screen_ocr_native_context_ordered_overlap/v22`. Historical artifacts are not rewritten.

Expected acceptance is an isolated KEKE `braised food flushing` center-point capture reaching20 reliable displayed occurrences or an independently recognized list end, with ad/display/natural ranks kept distinct. Full independent artifact readback, original exit code and command-journal coverage must be recorded before claiming native completion. Real fixture replay alone does not satisfy this gate. The dated v22 checkpoint below records its partial native outcome; the latest v23 checkpoint records the subsequent complete bounded KEKE result.

### v22 native checkpoint — 2026-10-23 14:40–14:46 Asia/Shanghai

Isolated Job `maps-android-sheet-20261023`, run `run_20261023T064015Z_16019e`, image digest `sha256:79f270569cf3ea34a3a05ddc6cc210afe06a6164b98b20959cf470cbc3e567f9`, runtime source `88379ee4fc3bf5e9a34aa26a3aee00ada4bfb60c` passed the early sheet boundary. The collector saved46 ranking frames, selected44, and performed two bounded backward corrections at frames27/28. It did not require a native-top re-expansion, so that branch remains tested in fixtures/device mocks, not exercised by this live run. Longjiang was observed as4.1/18. This run did not invoke supplementary rating rereads.

It still ended `partial`, original exit2:19 diagnostic occurrences (18organic,1unknown), no accepted target rank. Frames45–46 revealed a separate clipped **explicit no-reviews** card: Ji You Braised Food's name left the screen while its identical `No reviews - Restaurant . 0.6 mi` line remained; the next JiBeiChuan4.7/842 card moved by the same306px. The numeric-rating requirement in `clippedPrefixOverlap` rejected this supported two-card overlap and appended an unknown duplicate. Do not count this as a complete Top20 capture or turn missing rating into0stars.

Independent Azure-login readback checked207 objects,206 exact size/SHA receipts (scan root has service-size check only),47 PNGs fully decoded,47 XMLs parsed, all selected JSON/CSV fields consistent. All1,097 command sequences were recovered without a failed command. Original artifacts remain unchanged.

Candidate v23 extends only the existing multi-card clipped-prefix rule: explicit equal no-review lines, zero review count, known organic prior card, unique unrated occurrence in both frames, matching non-null distance/category and an independently rated following card with the existing identical-name/movement checks. A lone null rating, changed facts, ambiguous occurrence, ad/unknown or extra warning still rejects the join. New original-frame positive/negative tests precede a fresh isolated native validation; v22's partial result remains historical evidence.
