# Android ranking and advertisement repair — 2026-10-21

This change reparses Android evidence more accurately and connects the capture loop to the existing guarded native-list gesture. It does not modify historical data, shared SEO keywords, Web collectors, schedules, or cluster resources. Live acceptance and the two-hour capacity gate belong to the isolated deployment validation.

## Reproduced causes and changes

- Three visibly nonempty result screens produced `no_cards_recognized`: Tesseract read the star as `玄` or `計`. The rating grammar now accepts only those observed substitutions in the bounded star position. Ratings remain 1–5; arbitrary Chinese prose and 5.9 are rejected.
- Restaurant searches expose `More filters / Open now / Find a table / Price`, sometimes without `Relevance`. The native list recognizer now accepts that complete four-control row with the existing exact-query, Maps package, panel ancestry, merchant-action and foreign-subtree guards. Text elsewhere cannot replace the row.
- CJK/ellipsized/missed OCR headers erased visible advertisement classifications and list-top evidence. A supported exact native query and list provide the sheet bounds; native `ACTION_SCROLL_TO_POSITION` without `ACTION_SCROLL_BACKWARD` supplies explicit top proof. An already-scrolled native list overrides an apparent OCR top marker. Unknown/photo layouts do not acquire positive top proof.
- A clear, spatially associated `Sponsored` label remains `ad` even when name/rating confidence is low. Those confidence failures still prevent reliable ranking. Uncertain labels remain unknown; a missing label is not claimed to prove complete ad coverage.
- Native advertisement evidence is now cross-checked even when OCR misses `Sponsored`. The exact Maps-owned result-list/card ancestry and one contained OCR name/rating header are required before native `Sponsored` (or `Paid advertisement`) can classify that card as `ad`. `About this ad` alone, short/ambiguous labels, conflicting text/description, invalid bounds, missing ownership, multiple OCR headers or unmatched markers block organic inference and reliable sequence proof. This never supplies merchant identity or additional list-top proof. The real 156-frame native census contains 81 `Sponsored` and 81 `About this ad` nodes; other label representations are synthetic defensive cases only.
- The production `swipeResults` delegates to the guarded native-list path, using the same persisted XML and validating the live unique list bounds. Candidate2 permits at most 35% requested movement only when a full OCR title from the latest paired PNG and two distinct native action controls leave sufficient overlap headroom. The driver checks the actual latest PNG hash, consumes that proof before the gesture and refuses reuse. Missing support retains the 10% fallback; shallow titles do not trap the loop in progressively smaller gestures. There is no full-screen ADB fallback. Changed XML or unknown geometry is rejected before a gesture. Such pre-gesture refusals are unqualified per-query partials; real device/transport/storage/cancellation failures still stop the batch.
- OCR dimensions must match the persisted PNG. Frame JSON retains title/rating rectangles, native list bounds and the sources of sheet-boundary/top proof. Candidate2 changes the profile method to `full_screen_ocr_native_context_ordered_overlap/v7`; the compatible manifest adapter envelope remains `android-screen-ocr/v4`.

Clipped unnamed rows are **not** merged by coincident rating/review count. Candidate2 permits one clipped leading occurrence only when an intact, known following merchant anchors the same ordered overlap, exact metadata matches, both rating rectangles moved by the same measured amount, and native viewport/query geometry stayed consistent. Raw clipped frame cards remain unknown. Missing, uncertain or differently moving anchors still break proof; the historic Wonder fragment remains unqualified. Requested motion never proves actual overlap. No expansion gesture, automatic retry, or softened geography gate was introduced.

## Evidence and offline replay

The eight OCR/XML fixture pairs in `tests/fixtures/android/grid-v3-20261020/` were copied byte-for-byte after checking their producer receipts. `provenance.json` records original query/point identity, file hashes and PNG receipts. Existing PNGs remain in the original evidence bundle.

`offline-replay-native-ad-crosscheck.json` independently verifies 1,034 original objects (seven manifests plus 1,027 referenced artifacts) and replays the existing 125 queries / 156 search frames with the final native-ad guard. It does not create a new capture or change original records. Earlier replay files are retained as superseded intermediate evidence.

| Diagnostic from existing frames | Original reader | Repaired reader |
| --- | ---: | ---: |
| Queries with no recognized cards | 3 | 0 |
| Raw ad rows | 53 | 67 |
| Raw organic rows | 27 | 50 |
| Raw unknown rows | 79 | 45 |
| First frames with verified top | 27 | 83 |
| Existing short prefixes with reliable evidence | 0 | 45 |

The 45 prefixes are not complete top-20 lists or new ranking observations. The native-ad cross-check conservatively removes 11 of the preceding implementation's 56 short-prefix qualifications when native ad evidence cannot be fully associated. Original queries remain `needs_review`; no absence, customer-local ranking, or current result is asserted. All 125 GPS/backend-geography limits remain unchanged. Offline replay cannot validate the new touch movement or runtime capacity.

Reproduce using a fresh output filename (exclusive write):

```sh
node --import tsx evidence/2026-10-21/android-ranking-repair/replay.mjs \
  --repo-root . \
  --evidence-root /absolute/path/to/surrounding-grid-20261020 \
  --out /absolute/path/to/new-offline-replay.json
```

## Candidate1 live diagnostic and candidate2 repair

The isolated Maps 26.41.03 candidate1 run `run_20261021T014543Z_45126b` finished with its original exit2: five `needs_review` queries, zero complete lists, 14 search PNGs and five GPS PNGs. The local terminal readback rechecks all 75 manifest-referenced artifacts by size/SHA and decodes all 19 PNGs. Its manifest is read from the owned terminal run; this particular readback does not claim a separate producer receipt for the manifest. Five terminal search PNGs were visually examined, one for each query. Original evidence and outcomes remain unchanged.

| Query | Confirmed stop cause | Candidate2 handling |
| --- | --- | --- |
| 卤味 | The clipped native filter row contains typed `Spinner` and `CompoundButton` controls that the earlier closed layout rejected. | Accept only the observed complete typed five-control shape, preserving query, ancestry, role, bounds and negative mutations. |
| chinese food | A clipped Yummy House header was appended again despite the next intact Wonder header moving by the same 78px. | Validate the bounded ordered clipped-prefix proof; keep the raw frame unknown. |
| bubble tea near me | OnlyBear's name left the viewport while its rating and the intact Tea Magic header moved together by 77px. | The same proof retains the existing occurrence; ambiguous names, ratings or next-anchor confidence still reject. |
| hot pot near me | The first sponsored card has three fully fitting native buttons in a non-scrollable horizontal action row. | Recognize only the captured closed Directions/Call/Website shape with existing native top/ad gates. |
| bakery | The next card exposes only Sponsored/About this ad at the bottom edge; no merchant name/rating is visible yet. | Mark a trailing ad header as pending, continue capture, and refuse list-end proof. No new row or organic classification is inferred. |

The loop also treated three moving frames without a new merchant as a stall. It now resets that counter only for measured upward movement of a matching named OCR card in the same native viewport. A changed PNG alone is insufficient; three stationary frames and repeated PNGs still stop honestly.

`candidate2-probe-replay.json` re-verifies all 75 local producer artifact receipts and replays those 14 existing search frames: all five short prefixes reconcile to seven occurrences (four ads, three organic), rather than the original 12 raw rows containing duplicates/unknowns. This does **not** change the original run or prove a complete top20. Actual 10–35% content displacement, later layouts, screenshot coverage and two-hour throughput remain acceptance gates for the next bounded live run.

## Candidate2 live diagnosis and candidate3 repair

The second isolated run `run_20261021T021313Z_43aa38` completed at 2026-10-21 10:16:09 Asia/Shanghai after 175.917 seconds, with original exit2 and five `needs_review` queries. It produced **zero complete lists**, 18 search PNGs, five GPS PNGs, and nine raw rows (four ads, four organic, one unknown). All five device GPS receipts matched and the viewport followed the device; Google backend geography remains unverified. Neither this run nor the local repairs establish top20 or two-hour collection capacity.

The independent terminal readback matches the producer manifest receipt (129,741 bytes; SHA-256 `38dee332f1b7225ac051dfcaeff4d02a2311d0bd2845668aa4f541d944267d20`), all **91 referenced artifact receipts**, all five query JSON/CSV records and nine listing CSV rows. All **23 PNGs** decode. Visual sampling separately covers **10 of18 search PNGs across all five queries**. Original files and statuses remain unchanged. Detailed receipts, diagnostics and visual scopes are under the local `nine-store-uat-20261021/android-probe2-review/` directory (`verification.json`, `diagnosis.json`, `native-layout-visual-review.json`, `q1-q3-visual-review.json`).

| Query | Confirmed cause | Candidate3 handling |
| --- | --- | --- |
| 卤味 | The sole KEKE merchant is followed by **Discover through photos**. When its title clips, there is no following intact merchant to prove the same ordered occurrence. | Keep the conservative partial. Do not merge by rating/control metadata alone, traverse the photo gap, infer list end, or claim top20. |
| chinese food / hot pot near me | The native horizontal action row fits completely and is `scrollable=false`. Old generic list detection rejects it, so otherwise legitimate native Sponsored ownership fails its same-list check. | Use a closed, ordered Directions/Call/Website tree inside exact direct merchant envelopes, with strict package, role, click-state, hierarchy, bounds and icon closure. No merchant/promotion text allowlist is added. Pending bottom ad headers remain incomplete. |
| bakery | A scrolled list has the same complete static upper row, plus an insufficient clipped Directions/Save row below. | Use only the complete upper row to prove list geometry. Keep backward-scroll/top and ranking reconciliation checks unchanged. |
| bubble tea near me | The XML returned immediately before a planned gesture differs by811bytes from the persisted frame. Appium records no gesture after refusal; truncated response bodies do not identify the changed node. | Allow exactly one new persisted PNG/XML/OCR/frame and rerun every native/query/ad/ordered-overlap gate before replanning. A second mismatch still ends the query as an unqualified partial. |

The refresh occupies a normal loop iteration and consumes the existing screenshot/time budget; there is no automatic gesture retry, deadline extension, source comparison bypass or additional capture budget. A same-image refresh after **no gesture** is not mistaken for a failed swipe. Native consent on the fresh frame stops before OCR or another action. `nativeFrameRefreshes` records the rejected frame and the completed fresh frame (or null if its checks did not complete). This optional manifest field is compatible with historical artifacts; the method profile changes to `full_screen_ocr_native_context_ordered_overlap/v8`.

Candidate3 is locally frozen after **663/663 tests across eight targeted Android files**, typecheck, contract checks and diff-check. Six UI regressions and four refresh regressions were RED before implementation; the fresh-consent negative also passes. UI and runner changes were independently cross-reviewed. `candidate3-validation.json`, `candidate3-independent-review.json` and `candidate3-targeted-tests.json` record exact hashes and scopes. A newly sealed live probe remains required before Android activation.

## Validation

Meaningful RED/GREEN cases cover the three real rating failures, visible Sponsored with missing/CJK query OCR, native top/negative backward state, the observed alternate filter row and missing-control mutation, low-confidence ad identity, foreign query/image dimensions, clipped identity gaps, exact captured-XML gesture handoff, partial-vs-operational failures, and refusal of unsupported native geometry.

- Android suite: 545/545 passed before the final two low-confidence-ad tests.
- Prior reader suite: 42/42 passed, including those two added RED/GREEN tests.
- Final native-ad regression, screen reader, native UI and runner suite: 399/399 passed. The real OCR-label-deletion regression and six initial negative cases failed before the cross-check; two empty/unmatched-frame reliability cases then exposed and fixed a second guard gap. Synthetic runner tests were corrected to stop attaching an unrelated SEE JOY native ad to arbitrary mocked OCR merchants; a dedicated negative runner test retains that contradictory pair and verifies unqualified output.
- `npm run typecheck` and `npm run test:contracts`: passed.
- An overlapping initial full-suite invocation had the two intentionally RED ad tests and a 30-second `monitor-daily` timeout: 1,299 passed / 3 failed. It is not a clean final full-suite verdict. `npm test -- --maxWorkers=1` was interpreted by npm and did not constrain Vitest.
- A correctly serialized full-suite invocation was stopped at the parent's request (owned Vitest PID verified, exit143) to avoid concurrent full suites. The root agent will run the final integrated full suite after all agents freeze their changes.

Candidate2's final targeted seven-file Android suite passes **595/595**; typecheck, contract checks and diff check pass. Device/UI changes and reader/runner changes were independently reviewed across the two implementing agents. Meaningful new RED/GREEN cases reproduce all five live stop causes, uncertain next-anchor rejection, measured-motion stall reset, shallow-header fallback, latest-snapshot binding and one-use adaptive proof. `candidate2-validation.json` and `candidate2-targeted-tests.json` hold the new source hashes and results. `native-ad-validation.json`, `native-ad-ownership-tests.json` and `validation.json` preserve earlier freezes. This subtask only read the owned live run; the parent performed its launch. No build, deployment or cluster mutation was performed by this Android repair subtask.

## Bounded native acceptance

Use a new isolated runtime/output path and the sealed source, with the worker-private AVD and the existing per-serial lease. Preserve the old v3 run. Start with representative English and Chinese queries that previously exposed ads, the alternate restaurant filter row and the target merchant. Use explicit existing budgets (for example 60 screenshots / 59 scrolls, 20 displayed results, 600,000 ms per keyword); do not retry or enlarge the budget automatically.

```sh
node dist/android/cli.js validate --config /work/repair-probe.json
node dist/android/cli.js capture --config /work/repair-probe.json --storage local
```

After the run, retain original exit code, session cleanup, lease release, exact manifest receipt and all selected PNG/XML/OCR/frame/JSON/CSV receipts. Review actual first/next frame displacement, label association, overlap continuity, target identity, and completeness. A bounded adaptive request does **not** promise a complete top20 within 60 screenshots or a two-hour 90-keyword cycle. Measure per-query latency and complete/partial/failed counts before enabling the schedule. `needs_review` and unknown classifications remain visible to users. GPS matched/following remains separate from unverified Google backend geography.
