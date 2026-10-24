# Android input readiness and short CJK continuity — 2026-10-24

## Scope and diagnosis

Continue the preceding OCR repair with the two confirmed v28 boundaries. Preserve the existing daily/Web/UI collectors, shared catalog, historical observations and suspended Android production schedule. Use a fresh isolated two-worker Job/database only; no production promotion or retry of an old failed round.

KEKE's original frame23/24 shows the same Jianghu merchant at4.8/273. An uncertain interior Chinese glyph changes from涮 to测 at the same independently anchored position. The existing long-name clipped-header rule cannot match this short title. OnlyBear's command93 is a pre-submit `POST elements` read aborted after4,988ms by a five-second focus budget. Its diagnostic page shows an empty search input. Raw Appium logs show forwarding to UiAutomator2 and client disconnection, not a completed server error; exact server latency cause remains unconfirmed.

## Implemented behavior

- Only the anchored geometric placement path can accept one uncertain interior CJK glyph. Require pure-CJK word evidence, the same unique rating/count/category/price/distance, complete contained headers, same first-word/changed-glyph/rating motion, previous clean organic classification, and current unknown solely because of the conservative header-clipped flag. Confident differences, branches/numbers, multiple differences, duplicated ratings, ad uncertainty and invalid geometry remain rejected. No global alias or fuzzy threshold change.
- Observe a usable native input within at most30 seconds, one normal command budget, and half the query budget; the global query deadline can shorten it further. Completed reads reporting no usable input can poll. Transport timeout/cancellation errors remain intact. Only expiration during the observation pause after a completed unusable-input read is classified as unsupported readiness. Never repeat entry click, typing or search submission.
- Listing method becomes v29. No resource increases, search retries, OCR model changes or production schedule changes.

## Regression and acceptance

The original-pair test fails on v28 and joins exactly one occurrence after repair.13 negative identity cases remain rejected. Slow input reads, real transport timeout, remaining global deadline and cancellation have behavioral tests. Independent review passed238 device/CJK tests and validated all four original fixture hashes.

All24 selected historical v28 frames now replay to11 continuous distinct organic rows, without rewriting historical records. This is a valid prefix with no terminal list marker, not a complete search or fresh OCR verdict.

Native acceptance still requires both complete representative lists, original exits0, actual overlapping search/capture intervals, one submission each, complete immutable command/OCR artifacts, independent Azure/database readback and unchanged protected workloads. A two-keyword test is not270-search/two-hour capacity acceptance. No fresh positive-ad or customer-local geography claim follows from passing these fixes.

## Final native verification — v29

Source `aaccc64b9943939ab206169afc489b7fe8e5fb18`, ACR build `ch15b7`, image `sha256:70c2a495f654d562716df13a369f0bd1430627e8fb6e616a8738a7ccbf70dfa0`. Isolated Indexed Job/database `maps-android-v29-20261024`; two workers, one center keyword each, same frozen catalog, same resource requests, no production promotion.

**Overall: complete dual-worker ranking acceptance failed. KEKE passed its configured 20-result target; OnlyBear encountered a Google Maps ANR after one successful submission.**

| Worker | Query | Original tracking exit | Native result |
| --- | --- | --- | --- |
| KEKE | `braised food flushing` | 0 at 13:15:00 Beijing | 20 organic listings, display 1 / organic 1; sequence, classification and screenshot coverage verified; `target_reached`, not exhausted list |
| OnlyBear | `bubble tea garden city` | 1 at 13:11:19 Beijing | `unknown_search_layout`; diagnostic screenshot/XML show **Maps isn't responding**, 0 OCR attempts / 0 accepted rows / null rank |

Both runtime containers and tracking containers had zero restarts and the expected actual image digest. They started the same verification round at 13:09:56 Beijing. OnlyBear's IME submission returned HTTP 200 after 6,048 ms; all its 174 device commands succeeded. Its exact submitted query and result list are visible behind the ANR modal. The previous input-read timeout did not recur, but the new longer-wait branch was not exercised by a slow live input read. Do not relabel ANR as an OCR timeout or successful ranking.

KEKE had 48 successful OCR process attempts (46 selected frames, two retained correction frames), maximum 2,442 ms / median 1,907.5 ms, zero timeouts/process failures. Its 1,128 commands were fully recovered. Across both workers all 1,302 command sequences were recovered with no command failures; each keyword was submitted exactly once. Worker processes overlapped, but OnlyBear produced no OCR frame, so **no successful dual-worker search/capture interval is claimed**.

The native run crossed the old Jianghu boundary, but disabling only the new CJK fallback offline still reproduces all 20 rows. Therefore the exact new glyph-repair branch is proven by the original-fixture regressions, not falsely credited as exercised live. The older rating reread **was** exercised live at frame 33: primary `4.19% (18)` became `4.1% (18)` in both crop modes, preserving true 4.1/18. Removing those rereads offline breaks continuity at frame 32→33. Raw Chinese titles still contain OCR noise; exact title transcription is not claimed.

## Independent evidence scope

- Azure CLI identity independently downloaded all **280** objects: **278** exact writer receipts matched size/SHA-256; two scan-root manifests have service-length validation only. No missing or mismatched object.
- Fully decoded **51 PNGs**, parsed **174 JSON / 51 XML**, and compared all four CSV files with two query records / 20 listing rows. Replaying all 46 selected KEKE OCR/XML frames exactly reproduces the persisted listings.
- All 48 immutable OCR-process diagnostics matched their PNG hashes, recorded one thread, primary exit 0 and complete stage/exit metadata. No timeout/signal failure was observed live; tests cover those branches.
- Independent database readback matches both observations, ranks, profile/version and screenshot/manifest references. An earlier readback taken before KEKE finished contained one observation; it is retained as `db-readback-initial.json`, never treated as the final two-result check.
- Visually inspected **seven original PNGs**: KEKE frames 1/22/23/32/33/48 and OnlyBear's ANR. Visual sampling is separate from complete hash/structure checks. No fresh positive-ad case occurred (20 organic, 0 ad, 0 unknown); historical positive-ad replay remains separately labelled.
- Protected workload UID/spec and all pre-existing ConfigMap hashes are unchanged (see `protected-audit.json`). Daily/Web/UI/catalog/history were not altered; Android production remains suspended. This verifies configuration preservation, not every service's business-level health.

Durable local evidence: `/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/android-readiness-cjk-2026-10-24/`. Contains raw bounded Appium tails, runtime/boot evidence, independent object inventory, command/OCR audits, database readback, original screenshots and helper scripts. Appium tails are bounded samples; immutable command checkpoints provide the complete command sequence. Azure batch roots:

- `maps-keyword-capture-uat/android-maps/2026-10-24/run_20261024T050956Z_57d9c3/`
- `maps-keyword-capture-uat/android-maps/2026-10-24/run_20261024T050956Z_748e97/`

## Remaining blocker and next-owner actions

1. **App stability:** persist Android logcat / ANR traces before the owned runtime terminates, with bounded/redacted output. Classify an app-not-responding modal distinctly from generic unsupported layout. Preserve diagnostic PNG/XML first. Do not silently dismiss it, repeat search, restart shared infrastructure, or accept the obscured list as ranking evidence.
2. **Cause still open:** worker 0 Appium cold startup had a `blk_mq_get_tag` block-I/O wait. The attached StandardSSD exposes 500 IOPS / 100 MB/s and about 30 GiB free. Both runtimes eventually became ready without restart. This is evidence of startup I/O waiting, **not proof that disk throttling caused OnlyBear's later ANR**. Node CPU/memory samples alone do not establish absence of short stalls. Inspect app/system traces before changing capacity.
3. Revalidate both complete representative lists with actual overlapping capture, one submission each, original exits 0 and independent receipt/DB checks. Retain the failed probe/gate; no automatic retry or production gate clearing was performed.
4. Full 270-search/two-hour capacity, fresh positive-ad recognition and customer-local geography remain separate, unpassed gates.

## Software validation and release state

All **97 files / 1,866 TypeScript tests**, typecheck, contracts and build passed. The full-suite command's npm `--maxWorkers` argument was not forwarded; the passing suite used default workers. The focused device/CJK set passed **238 tests**; independent review and fixture receipt checks passed. No Python source changed in this follow-up; prior Python results are historical, not a new run. A helper was initially invoked without its required report argument; corrected invocation passed all structural checks (not a collector failure).

Code is committed locally on `codex/android-search-scroll-20261023`. Documentation/evidence follow-up does not change the frozen image source. No push, merge or production promotion in this turn. XML fixtures retain original receipt hashes and a separately recorded Git newline-normalized hash; see `fixture-source-audit.json` and the fixture README.
