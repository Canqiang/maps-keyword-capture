# Android ranking and advertisement repair — 2026-10-21

This change reparses Android evidence more accurately and connects the capture loop to the existing guarded native-list gesture. It does not modify historical data, shared SEO keywords, Web collectors, schedules, or cluster resources. Live acceptance and the two-hour capacity gate belong to the isolated deployment validation.

## Reproduced causes and changes

- Three visibly nonempty result screens produced `no_cards_recognized`: Tesseract read the star as `玄` or `計`. The rating grammar now accepts only those observed substitutions in the bounded star position. Ratings remain 1–5; arbitrary Chinese prose and 5.9 are rejected.
- Restaurant searches expose `More filters / Open now / Find a table / Price`, sometimes without `Relevance`. The native list recognizer now accepts that complete four-control row with the existing exact-query, Maps package, panel ancestry, merchant-action and foreign-subtree guards. Text elsewhere cannot replace the row.
- CJK/ellipsized/missed OCR headers erased visible advertisement classifications and list-top evidence. A supported exact native query and list provide the sheet bounds; native `ACTION_SCROLL_TO_POSITION` without `ACTION_SCROLL_BACKWARD` supplies explicit top proof. An already-scrolled native list overrides an apparent OCR top marker. Unknown/photo layouts do not acquire positive top proof.
- A clear, spatially associated `Sponsored` label remains `ad` even when name/rating confidence is low. Those confidence failures still prevent reliable ranking. Uncertain labels remain unknown; a missing label is not claimed to prove complete ad coverage.
- Native advertisement evidence is now cross-checked even when OCR misses `Sponsored`. The exact Maps-owned result-list/card ancestry and one contained OCR name/rating header are required before native `Sponsored` (or `Paid advertisement`) can classify that card as `ad`. `About this ad` alone, short/ambiguous labels, conflicting text/description, invalid bounds, missing ownership, multiple OCR headers or unmatched markers block organic inference and reliable sequence proof. This never supplies merchant identity or additional list-top proof. The real 156-frame native census contains 81 `Sponsored` and 81 `About this ad` nodes; other label representations are synthetic defensive cases only.
- The production `swipeResults` now delegates to the guarded native-list path, using the same persisted XML and validating the live unique list bounds. Movement is capped at 10% of that list; no full-screen ADB fallback. Changed XML or unknown geometry is rejected before a gesture. Such pre-gesture refusals are unqualified per-query partials; real device/transport/storage/cancellation failures still stop the batch.
- OCR dimensions must match the persisted PNG. New frame JSON records the source of sheet-boundary and top proof. The profile hash uses `full_screen_ocr_native_context_ordered_overlap/v6`; the compatible manifest adapter envelope remains `android-screen-ocr/v4`.

Clipped unnamed rows are **not** merged by coincident rating/review count. The historic Wonder fragment still breaks sequence proof. Smaller movement is preventive; it is not proof that a real scroll always preserves overlap. No expansion gesture, automatic retry, or softened geography gate was introduced.

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

## Validation

Meaningful RED/GREEN cases cover the three real rating failures, visible Sponsored with missing/CJK query OCR, native top/negative backward state, the observed alternate filter row and missing-control mutation, low-confidence ad identity, foreign query/image dimensions, clipped identity gaps, exact captured-XML gesture handoff, partial-vs-operational failures, and refusal of unsupported native geometry.

- Android suite: 545/545 passed before the final two low-confidence-ad tests.
- Prior reader suite: 42/42 passed, including those two added RED/GREEN tests.
- Final native-ad regression, screen reader, native UI and runner suite: 399/399 passed. The real OCR-label-deletion regression and six initial negative cases failed before the cross-check; two empty/unmatched-frame reliability cases then exposed and fixed a second guard gap. Synthetic runner tests were corrected to stop attaching an unrelated SEE JOY native ad to arbitrary mocked OCR merchants; a dedicated negative runner test retains that contradictory pair and verifies unqualified output.
- `npm run typecheck` and `npm run test:contracts`: passed.
- An overlapping initial full-suite invocation had the two intentionally RED ad tests and a 30-second `monitor-daily` timeout: 1,299 passed / 3 failed. It is not a clean final full-suite verdict. `npm test -- --maxWorkers=1` was interpreted by npm and did not constrain Vitest.
- A correctly serialized full-suite invocation was stopped at the parent's request (owned Vitest PID verified, exit143) to avoid concurrent full suites. The root agent will run the final integrated full suite after all agents freeze their changes.

See `native-ad-validation.json` for the latest frozen Android source hashes and checks; `validation.json` preserves the preceding freeze. No build, deployment, live capture, or cluster write was performed by this Android repair task.

## Bounded native acceptance

Use a new isolated runtime/output path and the sealed source, with the worker-private AVD and the existing per-serial lease. Preserve the old v3 run. Start with representative English and Chinese queries that previously exposed ads, the alternate restaurant filter row and the target merchant. Use explicit existing budgets (for example 60 screenshots / 59 scrolls, 20 displayed results, 600,000 ms per keyword); do not retry or enlarge the budget automatically.

```sh
node dist/android/cli.js validate --config /work/repair-probe.json
node dist/android/cli.js capture --config /work/repair-probe.json --storage local
```

After the run, retain original exit code, session cleanup, lease release, exact manifest receipt and all selected PNG/XML/OCR/frame/JSON/CSV receipts. Review actual first/next frame displacement, label association, overlap continuity, target identity, and completeness. A 10% gesture may require substantially more frames than 40%; 60 screenshots do **not** promise a complete top-20 or a two-hour 90-keyword cycle. Measure per-query latency and complete/partial/failed counts before enabling the schedule. `needs_review` and unknown classifications remain visible to users. GPS matched/following remains separate from unverified Google backend geography.
