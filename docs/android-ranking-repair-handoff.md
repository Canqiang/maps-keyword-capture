# Android Maps ranking repair — handoff

Last updated: 2026-10-21 12:20 Asia/Shanghai. **Work in progress; Android recurring collection is not accepted or enabled.** Latest candidate: candidate6 (probe 6 checkpoint below). Update this document after each candidate replay, device run, deployment, or change to the acceptance criteria.

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
