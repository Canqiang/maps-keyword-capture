# Android Maps ranking repair — handoff

Last updated: 2026-10-21 12:20 Asia/Shanghai. **Work in progress; Android recurring collection is not accepted or enabled.** Latest candidate: candidate9 (probe 9 checkpoint below). Update this document after each candidate replay, device run, deployment, or change to the acceptance criteria.

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
- Cloud image builds use Azure ACR. Existing Android candidate image digest `sha256:98aad6fa03e1e3060bb7e5755aa52fe9a266d5ec4ffd720e2bc750af096db063` is source `0eba0589ff960829dc48104b9ad5bafa3283c1db`, not the candidate5 repair below. UI/Web deployed image remains `sha256:3fd3c076221a48bf43083bd80976de5b1f2a6b6acfd9a423e01d417f099c75df`.

## Confirmed problems and required effects

| ID | Evidence / root cause | Intended handling | Current status |
|---|---|---|---|
| A1 | Candidate4 OnlyBear: Manny's OCR title has a word box extending below its rating. Runner selected this last title, while the native gesture correctly rejected overlapping geometry. | Filter candidate anchors using the same title-before-rating constraints; select an earlier valid anchor or retain the bounded fallback. Never weaken native stale-source/geometry checks. | Local regression passing; probe 5 (candidate5) showed no recurrence. |
| A2 | Candidate3 SEE JOY frame5: a status line touches native sheet bottom at y=1232; clipped `3.3 mi` is read as `22 mi`, conflicting with the next full frame. | Keep raw OCR; withhold cropped status/distance values. Fill missing values only after the same merchant passes existing ordered overlap. Do not guess a corrected number. | Local regression passing; probe 5 (candidate5) showed no recurrence. |
| A3 | Candidate3 small-frame OCR loses a rating decimal and varies CJK names; candidate4 large canvas still varies the same merchant name across frames. | Test explicit higher OCR resolution on the immutable source PNGs; record scale in input, artifact and profile hash. Keep exact occurrence/overlap checks; do not infer identity from rating/review/distance alone. | PSM4 ×3 improves six offline samples reproducibly, but probe 5 at scale 3 still drifted (q0001 f2 name, q0004 star glyph 丙). Candidate introduces opt-in `ocrScale: 3`; default remains 2. |
| A4 | Ad labels can be incomplete or attached to partially visible native owners; the same merchant can appear as ad and organic. | Positive visible Sponsored/native ownership evidence yields `ad`; ambiguous association yields `unknown`. Keep separate displayed occurrences, do not consume an organic rank for an ad, and withhold reliable downstream ranks after unresolved classification. | Existing regression coverage; must recheck on the next real ad sample. |
| A5 | Photo-discovery modules interrupt native result cards. Forward/backward actions remain available at observed stopping points. | Do not interpret a short/stationary/photo viewport as list end. Preserve partial output and stop reason unless explicit supported terminal evidence exists. | **Now the main blocker** (probe 6: q0001, q0002, q0005 end at the module). Candidate7 plan in the probe-6 checkpoint. |
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

## Latest candidate and evidence

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
