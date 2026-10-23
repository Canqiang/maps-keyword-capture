# Post-submit stale element recovery (v24)

## Problem and intended behavior

The v23 dual-worker probe submitted KEKE's exact query once. Appium accepted
`mobile:performEditorAction` (command 115), but Maps replaced its omnibox before
command 118 (`GET element/displayed`). The confirmed W3C stale-element response
was treated as a terminal protocol failure even though the diagnostic screenshot
already showed the correct query and results. See the previous
[diagnosis](../android-v23-release-gates/dual/failure-diagnosis.json).

The desired behavior is to observe the accepted search without submitting again.
The recovery is limited to exact HTTP 404 / W3C `stale element reference` responses
to GET element reads. Only the post-submit observation loop catches this internal
error marker. It discards handles, verifies Maps foreground, acquires a fresh
unique Maps-owned field and checks the exact query again. At most three
reacquisitions are allowed within the original query deadline. Existing stable
native-source, loading, consent, query and sheet checks remain in place.

No input click, clear, value or editor action is retried. Unknown submission
outcomes, transport errors, other protocol errors, pre-submit stale elements,
ambiguous fields and changed queries remain failures. Failed reads remain in the
immutable Appium command journal. Exhausted recovery preserves diagnostic evidence.

## Software verification

- Regression red: five failures and two passes against v23.
- Regression green: stale displayed/text/package reads recover; repeated stale is
  bounded; unrelated errors, pre-submit stale and changed query still fail. Every
  submitted case asserts exactly one submission and successful recovery asserts
  no post-submit input mutation.
- Device suite: 214 tests passed. Full suite: 94 files / 1,803 tests passed.
- Typecheck, contract typecheck, build and independent focused review passed.
- Runtime source: `bfa6976db59cb1aef239d20c2b918f66a5481fc3`.
- ACR build: `ch15ag`; actual registry digest independently read back:
  `sha256:bc2e2b9275211679cf5c44d18a0ca31c2eb615c739a97285ca5a0fab3cc80ce8`.
- Listing method: `full_screen_ocr_native_context_ordered_overlap/v24`.
- Historical positive-ad evidence: all 17 selected frames replay to the same 13
  occurrences using current code. This is regression evidence, not a fresh ad capture.

## Isolated native validation

Job/database: `maps-android-stale-v24-20261023`. Two workers, one original center
and one keyword each: KEKE `braised food flushing`, OnlyBear `bubble tea garden city`.
Fresh verification database seeded with read-only copies of those store definitions.
Dedicated crawler node, separate worker runtime roots, unchanged resource requests
and startup staggering. Production Android remains suspended; existing Web, daily,
UI workloads and shared keyword catalog are not promoted or changed.

**Result: the stale-read fix is implemented and tested, but complete dual-worker
collection acceptance did not pass.** Both runtime image/source readbacks matched
v24 and all containers had zero restarts. Original tracking exits were both **1**.

| Worker | Beijing tracking interval | Retained query PNGs | Selected OCR frames | Diagnostic prefix rows | Outcome |
|---|---|---:|---:|---:|---|
| KEKE | 15:49:43–15:57:35 | 33 | 30 | 13 organic | screen_ocr_failed; partial |
| OnlyBear | 15:52:23–15:57:34 | 14 | 12 | 10 organic | screen_ocr_failed; partial |

Each worker also retained one location PNG. KEKE has two discarded correction
frames and one terminal screenshot without OCR; OnlyBear has one discarded
correction frame and one terminal screenshot without OCR. No accepted target rank
was emitted for either failed query. Neither list reached end/max20.

The complete immutable command histories contain **813 + 418 = 1,231 device commands** (1,137 Appium HTTP +94 ADB),
zero command failures and **exactly one successful editor action per worker**.
There was no stale-element error in this run, so live execution crossed the old
failure point, but did not exercise the recovery branch. That branch is proven by
red-green HTTP fixture tests. Actual submission-to-last-selected-screenshot
intervals overlap for **220.752 seconds** (tracking processes overlap311 seconds).
This proves concurrent activity, not successful concurrent complete collection.

Both terminal PNGs are readable Maps result lists. No terminal OCR JSON was
produced. The approximately30-second interval is compatible with the configured
30,000ms OCR limit; however, the OCR subprocess stderr/exit reason was converted
into generic `screen_ocr_failed` and not durably saved. **Timeout, CPU starvation,
OOM and parser failure are not established root causes.** Node samples peaked at
2,950m CPU and11,357Mi memory; these are samples, not continuous peak measurements.
See [failure-diagnosis.json](failure-diagnosis.json).

KEKE frame27 exercised the earlier rating fix: original full-screen OCR read
`4.19% (18)`; both same-image crop passes read`4.1% (18)`. The resulting4.1/18
matches the visually inspected PNG. This does not make the partial query complete.

## Independent evidence verification

- Azure CLI login (separate from collector SAS): all222 objects downloaded;
  all220 exact writer receipts matched bytes/SHA-256. Two scan roots have only
  independent service-length checks, not writer SHA receipts.
- All49 PNGs decoded,49 XML and120 JSON parsed; four CSVs compared against both
  queries and23 diagnostic listing rows. All selected OCR/XML frames replay to
  the exact saved prefix listings. Both v24 profile hashes match current code.
- Seven actual PNGs visually sampled across both stores, first/last/terminal
  states and KEKE rating frame27. Visual sampling does not establish all labels.
- No fresh ads or unknown rows in the23 prefix rows. Historical positive-ad
  replay remains a separate test, not new ad acceptance.
- Independent read-only Mongo job matched both observations, evidence keys,
  null final ranks and failed states. Fresh validation gate remains active with
  no finished shards; it was not cleared or reused.
- Seven protected Maps workload specs/UIDs plus85 pre-existing ConfigMap hashes
  remain unchanged (92 checks). No production image/schedule/catalog change,
  shared SEO keyword mutation, historical overwrite, job deletion or GitHub push.
- `mapsLocationStatus` remains`unverified`; no verified customer-local rank claim.

Full PNG/XML/JSON/CSV, Appium checkpoints, bounded raw Appium tails and helper
scripts are archived under:
`/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/android-stale-submit-2026-10-23`.
Azure private container: `fbrdevstorage/maps-keyword-capture-uat`:

- `android-maps/2026-10-23/run_20261023T074944Z_3e872e/`
- `android-maps/2026-10-23/run_20261023T075224Z_d95b73/`

## Next owner / remaining acceptance gate

1. Persist bounded, allowlisted OCR process diagnostics: stage, duration, exit
   code/signal, actual timeout flag and sanitized stderr. Preserve PNG/XML first.
2. Replay both exact terminal PNGs with the same Linux image, languages/scale
   and one-versus-two OCR processes; measure timing/throttling. This requires no
   new Maps search or duplicate search submission.
3. Fix the confirmed OCR failure, not an assumed cause. Add a regression and
   repeat isolated dual validation without changing existing collectors.
4. Require both queries complete/reliable, valid list-end or max20 condition,
   full consistent command sequences, single submission each, positive actual
   capture overlap, full receipt readback and protected configuration equality.
   Keep production Android suspended until these and fleet/capacity gates pass.
