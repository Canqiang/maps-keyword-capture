# KEKE rating reread repair — isolated verification

2026-10-23. **Historical frame35/36 repair passes; native end-to-end collection remains partial.**

## Repair and proof

The original Longjiang screenshot shows4.1 /18 reviews, while full-screen OCR returns `4.19%`. Two same-PNG English crop passes (PSM7 and13, scale3, six-pixel padding) both read `4.1% (18) - $10-20 - Chinese`. Primary OCR remains unchanged; supplementary lines, words, geometry and mode evidence are retained. No digit is truncated or inferred from an earlier merchant.

At most two malformed rating heads receive rereads; valid ratings are untouched. All optional passes share a two-second cap and an earlier caller-aware deadline. Strict native query/viewport, confidence, crop, full-text agreement and original count/tail checks gate acceptance. An optional timeout preserves primary OCR. Real-subprocess red/green testing caught and fixed a timing bug where outer process termination previously discarded primary output.

Portable original PNG/XML/OCR and independent crop evidence: `tests/fixtures/android/rating-reread-20261023/`. Original34 selected frames with only frame36 supplemented reconcile to14 continuous organic occurrences, without list-end evidence ([offline replay](offline-replay.json)). This is a regression proof, not native E2E acceptance.

## Source, tests and build

Source `d03fa2a19dde775c91a4be7b4c82ed32ea4d4b66`; method `full_screen_ocr_native_context_ordered_overlap/v21`. ACR `ch15a2`, image `sha256:0f0d1825f1d9ee35c984969aa97e82c88c28c2bc8d560fcb6b23975eb7e9ac08`. Independent registry readback and actual Pod imageIDs matched.

92 files /1,747 TypeScript tests,33 Python tests,9 CI checks, typecheck/contracts/build passed. Initial unconstrained concurrent device run had a bounded IME focus-window timeout (201/202); full maxWorkers2 rerun passed without device changes. [Software validation](software-validation.json) preserves both logs and their hashes. Independent code review found the optional deadline issue, then confirmed the fix with20 targeted tests.

ACR `ch15a1` failed because Web root ignore rules excluded Android runtime scripts. Staging root `.dockerignore` was replaced by the tracked Android Dockerfile-specific rules for the successful ACR CLI upload; runtime source remained the exact Git archive. See [packaging record](context-packaging.json). No GitHub push/merge occurred.

## Actual native outcome

Context `FBRDevAKSCluster`; namespace `android-maps-pilot`; fresh Job/database `maps-android-rating-20261023`. One KEKE keyword `braised food flushing`, original center, worker0 only. Tracking13:57:56–13:58:59 Asia/Shanghai; original exit2, runtime sidecar exit0, zero restarts. Same bounded90-frame/89-scroll/600-second profile.

Three ranking screenshots were retained. Frames2/3 are discarded with `ordered_overlap_missing`, leaving one selected frame and two diagnostic prefix rows. Their prefix ranks do **not** establish accepted final query coverage: target display/organic rank is null and final rankingReliable=false. No supplementary reread triggered; this run stopped before the historical35/36 boundary and cannot demonstrate the new recovery live.

Frame1 native list top is272; frame2 top274 and the Nong Geng Ji title/status OCR changes. The expected ordered overlap is rejected. One backward correction then produces a partially collapsed sheet at frame3/top456 with native `canScrollBackward=false`. Another backward request is refused; final stop is `unknown_scroll_layout`. The screenshots show this is not list end. No Appium command failed. Root transport failure is not inferred.

[Native boundary](remaining-native-boundary.json) contains all three original PNG/XML/OCR/frame receipts and native action/viewport observations. [Replay](replay.json) only reproduces the selected prefix; it is not a full-run acceptance verdict. Next work should establish stable result-panel states and safe bounded recovery at list top, retaining exact query and native capability checks. Repeated scene-state failures warrant addressing the state machine rather than adding more permissive OCR/name thresholds.

## Evidence and protection

Azure account/container: `fbrdevstorage/maps-keyword-capture-uat`.

- Android prefix: `android-maps/2026-10-23/run_20261023T055758Z_214478/`.
- Tracking prefix: `tracking/android/2026-10-23/point/android_scan_20261023T055757Z_296d76/`.
- 27 objects independently downloaded using Azure login.26 exact writer receipts passed size/SHA-256; the scan root has no external exact writer hash, only service-length validation. All4 PNGs decoded,17 JSON/4 XML parsed; two CSVs checked against one query/two listing rows.
- 185 commands, sequence1–185, recovered consistently from5 immutable Azure checkpoints, zero command failures. [Command audit](command-audit.json). The old intermittent Appium failure remains unreproduced. Bounded local Appium tail additionally retained; it is not guaranteed to include teardown.
- All3 ranking PNGs visually inspected; location PNG only structurally validated. [Visual review](visual-review.json). No ad appeared, so no general ad-classification acceptance. Google backend geography remains unverified.
- Seven workload specs and22 ConfigMap data hashes unchanged ([protected audit](protected-audit.json)). Android production stays suspended; Web/UI/shared SEO source and historical data unchanged. No gate/claim clearing, automatic second native run, production image/schedule change or capacity claim.

Full local evidence/scripts/readback: `/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/android-rating-reread-2026-10-23/`. `durable-readback-report.json` maps remote objects to local files. [Final machine-readable result](final-validation.json), [runtime audit](runtime-audit.json), [profile audit](profile-audit.json), [handoff](../../../docs/android-ranking-repair-handoff.md).
