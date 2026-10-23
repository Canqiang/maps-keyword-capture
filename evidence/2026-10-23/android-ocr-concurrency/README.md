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

Native verification: pending candidate build/run. This checkpoint is not a passing runtime verdict.

## First native v25 attempt and additional bounded startup change

Source `b5f4776c2a0e62c5d4c8c89edabbea5e697cae28`, ACR `ch15ah`, image `sha256:b8e711061cfdea7bd9fcf25b6c1def98141acab1eab7f8d527754faa8f755006`, Job/database `maps-android-ocr-v25-20261023`.

- KEKE completed 31 OCR attempts without process failure or timeout (median 1,846ms; maximum 2,162ms), with every immutable diagnostic linked to its PNG. It ended partial/exit2 at frame30→31 ordered-overlap failure, retaining 13 diagnostic rows and null target rank. Two earlier bounded backward corrections were exhausted. Actual screenshots show different visible merchant headers across the last boundary; do not invent continuity.
- OnlyBear exited1 before search/OCR: `POST /session` exceeded the generic 30s client deadline. Outcome-unknown quarantine was retained; no second session/search request was sent. The raw Appium tail ends before the timeout and cannot prove the eventual server outcome, exact slow stage or resource causality.
- Independent Azure-login readback:187 objects,185 exact writer receipts plus two service-size-only scan roots;32 PNGs decoded,119 JSON,32 XML and four CSVs/13 rows checked. This first run did not pass complete concurrency acceptance.
- A separate startup budget now gives only `POST /session` up to90s (validated upper bound120s), retaining cancellation, no retry and outcome-unknown quarantine. Ordinary commands retain30s, query deadlines and OCR deadlines are unchanged. This is a bounded cold-start experiment, not a proven diagnosis of the Appium server's slow stage. Targeted red→green tests and independent review passed; another fresh dual native probe is required.
