# Android OCR concurrency repair — 2026-10-23

## Confirmed diagnosis and limits

The preceding v24 native two-worker run failed at OCR on two valid immutable PNGs. That release did not preserve OCR subprocess exits/stderr, so its exact timeout/signal subtype cannot be reconstructed from timing alone.

A controlled A/B/A/B replay of both original terminal PNGs used the same v24 image, language models, scale, and 1-CPU collector limits in two isolated indexed Pods. All eight invocations succeeded. Default OpenMP settings took 12.8–20.7 seconds; `OMP_THREAD_LIMIT=1` took 1.70–1.89 seconds. Each image's four output hashes were identical. Default CPU throttling was substantial; single-thread throttling was negligible. This establishes avoidable thread/quota overhead, not definitive proof of the original unlogged failure subtype.

## Candidate behavior (v25)

- Fix Tesseract to one OpenMP thread without changing OCR models, resolution, native search, recognition rules, or the existing timeout/resource limits.
- Persist one immutable `ocr_process_log` beside every attempted OCR PNG, with input SHA-256, duration, deadline, thread limit, process exit/signal, cancellation/timeout classification, and typed stage events. Raw stderr is represented only by byte count/hash; arbitrary subprocess errors and environment values are not exported.
- Preserve the diagnostic artifact on failure. A failed log write prevents complete acceptance. PNG/XML and Appium command checkpoints remain available independently.
- Observe primary process exit promptly and kill its owned descendant process group on all terminal paths. A child retaining pipes must not turn an already-exited parent into a timeout or survive a successful invocation.
- Separate recovered optional crop timeouts from fatal request timeouts. Unexpected signals retain `process_exit`; only the wrapper timer or a normal nonzero exit with terminal request timeout establishes timeout.
- Never retry or resubmit search as an OCR recovery action.

## Verification gate

Regression tests cover wall timeout, cancellation, process exit, malformed output, success, descendant cleanup on success/failure, recovered optional timeout followed by fatal ValueError or external signal, terminal request timeout, immutable log linkage, and failed diagnostic persistence. Exact red/green/full-suite receipts will accompany the final native result.

The native probe uses a fresh Job/database, KEKE and OnlyBear original centers, and one full keyword list per worker. A verification-only barrier waits until both emulators are ready while retaining the existing staggered startup. Acceptance requires actual overlapping search/capture intervals, both complete lists and original exits 0, one search submission each, independent artifact/database readback, and unchanged protected workloads/configuration. This is not a 270-search production capacity test. Production Android remains suspended; no promotion or existing collector changes are authorized by this repair.

Native verification checkpoints below are separate attempts; neither constitutes complete dual-worker acceptance.

## First native v25 attempt and additional bounded startup change

Source `b5f4776c2a0e62c5d4c8c89edabbea5e697cae28`, ACR `ch15ah`, image `sha256:b8e711061cfdea7bd9fcf25b6c1def98141acab1eab7f8d527754faa8f755006`, Job/database `maps-android-ocr-v25-20261023`.

- KEKE completed 31 OCR attempts without process failure or timeout (median 1,846ms; maximum 2,162ms), with every immutable diagnostic linked to its PNG. It ended partial/exit2 at frame30→31 ordered-overlap failure, retaining 13 diagnostic rows and null target rank. Two earlier bounded backward corrections were exhausted. Actual screenshots show different visible merchant headers across the last boundary; do not invent continuity.
- OnlyBear exited1 before search/OCR: `POST /session` exceeded the generic 30s client deadline. Outcome-unknown quarantine was retained; no second session/search request was sent. The raw Appium tail ends before the timeout and cannot prove the eventual server outcome, exact slow stage or resource causality.
- Independent Azure-login readback:187 objects,185 exact writer receipts plus two service-size-only scan roots;32 PNGs decoded,119 JSON,32 XML and four CSVs/13 rows checked. This first run did not pass complete concurrency acceptance.
- A separate startup budget now gives only `POST /session` up to90s (validated upper bound120s), retaining cancellation, no retry and outcome-unknown quarantine. Ordinary commands retain30s, query deadlines and OCR deadlines are unchanged. This is a bounded cold-start experiment, not a proven diagnosis of the Appium server's slow stage. Targeted red→green tests and independent review passed; another fresh dual native probe is required.


## Second native probe and v27 continuity candidate

Source `eef9fae3e1fa1bb4bd57835a878d9529ca674643`, ACR `ch15ak`, image `sha256:2d87a1f44e1732dc01fb906453ae2af0b9368bcab5017a104e031617d885458a`, Job/database `maps-android-ocr-v26-20261023` (listing method remains v25).

Both workers actually overlapped search/capture for96.099s. All52 OCR invocations succeeded (KEKE35, OnlyBear17), with no primary/optional timeout. Both sessions were created below30s, so the90s startup path was not exercised live. All1,331 device commands were recovered (1,245 Appium HTTP,86 ADB), with no failures and one session/search submission each. OnlyBear completed12 organic results, own display/natural rank2, exit0. KEKE stopped partial/exit2 at frame34→35, retaining15 diagnostic rows and null rank. Gates closed for both workers but ranking acceptance failed.

Independent Azure-login readback verified299 objects:297 exact writer receipts plus two scan roots checked against service metadata,54 PNGs structurally decoded,187 JSON,54 XML and four CSVs/27 rows. Database observations/evidence links matched. Seven original PNGs were visually sampled, including each target, Longjiang4.1/18, Bob’s Noodle frames34/35 and OnlyBear’s terminal footer. No fresh positive advertisement occurred; historical ad replay remains separate evidence.

The remaining pair is the same Bob’s Noodle4.6/135 header. Two uniquely placed native buttons and both English words move exactly−417px; English confidence exceeds85 and horizontal spans agree. Chinese OCR differs in uncertain characters plus explicit simplified/traditional variants. v27 adds a narrow motion proof requiring full unclipped headers, matching rating/category/price/distance, unique rating tuples, matching classifications, every English suffix word and numeric prefix, high-confidence English word geometry, and character-position-specific uncertainty for differing CJK characters. Only过/過 and线/線 are explicit confident script equivalents. No alias, broad fuzzy-name threshold or retry-budget change is introduced.

Actual-pair regression failed before the change and passes after it;13 negative cases reject conflicting brands, branches, numbers, confident CJK changes, geometry, classification and ambiguous evidence. Independent review ran65 relevant historical/new tests with no blockers. Replaying all33 selected historical frames now preserves continuous14 distinct rows (the duplicate Bob’s occurrence is joined), but the old run still lacks list completion and remains partial. A fresh complete native dual probe is required.


## Third native probe and v28 candidate

Source`68be32230091909582f46a3cd7cc6eddcba82280`, ACR`ch15an`, digest`sha256:666f52a117e068c32a3f4e193550d3eda1b148a5a595ab65d89aed209e88d69f`, Job/database`maps-android-ocr-v27-20261023`.

- Actual search/capture overlap87.8s;55 OCR attempts all successful, no primary/optional timeouts. OnlyBear completed12 organic rows/own rank2/exit0. KEKE retained16 diagnostic rows, partial/exit2 at frame37→38. No fresh positive ad.
- The Longjiang title moves above the sheet at that boundary. Its complete4.1/18 rating and an exact long review line both move−381px, while JiBeiChuan enters below. The old tolerant-line fallback rejected a one-card-to-two-card transition. v28 allows only this tightly checked geometry: prior full organic card, clipped first title with rating within6px of sheet top, unique matching metadata, independent exact quote/rating motion, and incoming full card projected entirely below the previous viewport. It does not relax general multi-card identity or skip detection. Actual-pair red→green and12 negative tests pass. All36 selected old frames replay to15 continuous distinct rows; the original incomplete run remains partial.
-315 objects independently read back:313 exact writer receipts plus two service-metadata-only scan roots.57 PNGs decoded,197 JSON,57 XML and four CSVs/28 rows checked. Database observations/evidence match. Five original screenshot samples were inspected for the terminal boundary and related headers; final sample scope is recorded separately.
- Command preservation limitation: KEKE921/921 journal sequences recovered; OnlyBear692/712, with20 missing early location commands30–49. The started checkpoint ended29, and location ended305, exceeding the256-entry window. All observed failures were empty, but that is not proof that unseen commands succeeded. Raw bounded Appium tails are retained separately; they are not substituted for exact immutable journal receipts.
- v28 increases the recent allowlisted command window to512 in memory and artifact serialization, preserving32 early failure entries. A regression recreates the276-command phase and verifies a gap-free checkpoint union. This is still bounded; longer phases can drop entries and must remain explicit. No command, search or GPS retry behavior changes. Independent review passed the continuity suites and all three diagnostics tests. Fresh native acceptance is pending.
