# Validation status

Updated 2026-09-17. This page distinguishes recovered historical evidence, compile-time checks, and unfinished runtime acceptance. The local collector now exists and has run against the live site once; see [Local collector run](#local-collector-run-2026-09-17) for what that run did and did not show. No container image, storage adapter, or deployed Job exists yet, and no artifact has been delivered anywhere but the local disk.

## Evidence ledger

| Item | Current evidence | Status / outstanding work |
|---|---|---|
| Chrome versus bundled Chromium | Original probe scripts and centered-map PNG sequences | Local rendering samples only; Linux/Pod equivalence unvalidated |
| Sponsored placement | Gong Cha label visible in `ad_shot_00.png`; matching business details appear later in `ad_shot_02.png`. No Sponsored card appeared in the 2026-09-17 local run: 0 of 47 listings, and no `Sponsored` string in any captured DOM text | Supports preserving both appearances; does not validate label ownership or all organic classifications. The `ad` branch of the classifier is still unexercised against a live page; only the fixture covers it |
| DOM stride, dimensions, label depth, exact browser version | Historical notes and inspection scripts | Raw DOM/stdout not recovered; reproduce with saved logs before treating as parser acceptance |
| Query-only input | `qonly.mjs` constructs a query URL without a center/zoom; three first-screen PNGs recovered. The 2026-09-17 local run collected four keywords end to end this way: 47 listings, 15 results PNGs, complete scroll sequences, `configuredMapView: null` and the original keyword read back from the page in every result | Complete locally for one run on one machine and one egress. Not target-Pod acceptance; `observedMapView` stays null because the entry-page URL never gains an `@lat,lng,zoom` segment, so the returned area is evidenced only by the map pixels and the listing addresses |
| Geographic meaning | Garden City and Matcha samples show broad map extents and differing geographic signals | Review geographic ambiguity; preserve query text, never force a preferred city silently |
| 15 listings within 6 scrolls / 5 results screenshots | Measured on 2026-09-17: `fried chicken mineola` reached the 15-listing limit in 4 scrolls and 5 results screenshots, the only keyword to reach the limit. The other three ended at the list end first: 13 listings / 3 scrolls / 4 PNGs, 5 / 1 / 2, and 14 / 3 / 4 | Both budgets held, but the screenshot budget was consumed exactly at 5/5 on the one keyword that reached 15, so it has no margin. Four keywords on one machine; not a distribution, and not measured in the Pod |
| Contract shape | `src/contracts.ts`, `tests/contracts.type-test.ts` | Compile-time constraints covered; external JSON and cross-field relationships still need runtime validators |
| Empty, consent, CAPTCHA, second ad layout | No recovered samples | Missing fixtures and runtime evidence |
| Sandboxed Chromium in target Pod | No recovered evidence; scripts do not explicitly enable sandbox | Startup, resource use, timeout/SIGTERM, and query-only batch acceptance outstanding |
| Azure persistence | Design only | Upload plus independent byte/hash/image readback and final manifest receipt outstanding |

See the [evidence archive](../evidence/2026-09-17/README.md) and its [inventory](../evidence/2026-09-17/inventory.json) for original files and hashes. Source modification times are not browser capture timestamps. No recovered PNG is promoted to a structured, verified ranking result.

## Contract checks

```bash
npm run typecheck
npm test
```

The contract suite covers paid/unknown rank exclusions, success versus exhausted budgets, skipped input accounting, readback fields required by verified artifacts, attempt identity, evidence binding, and configured versus observed location. The tests were first run against the old contracts and failed before the missing shapes and constraints were added.

These checks do not launch Chromium, validate external JSON, or prove business behavior. Runtime acceptance must validate numeric ranges, hashes/timestamps, unknown configuration fields and reserved `mapView`, prefix continuity, classification evidence ownership, image coverage, artifact/attempt references, and the manifest's selected-attempt policy. In particular, a captured result requires all emitted cards to have supported classification and complete screenshot coverage. Storage status remains separate from collection quality.

## Next acceptance gate

The deterministic fixtures and the bounded collector now exist; the runtime validator does not. Re-run the three original keywords in the target Pod under the recorded query-only profile, inspect returned areas without changing queries, save raw observations and complete screenshot sequences, and measure budgets. Exercise missing layouts and failure states. Then verify Azure delivery and access after Pod deletion. Do not treat a successful probe exit or uploaded blob as completed acceptance.

## Local collector run (2026-09-17)

First end-to-end run of the collector against the live Google Maps site, from the developer laptop
(macOS, bundled Chromium `153.0.8010.12`, adapter `maps-feed-card/v1`, headless, `chromiumSandbox: true`).
Local-only persistence. This is one run, on one machine, through one egress, on one day; nothing below
is a property of Google Maps or of the collector in general.

Run of record: `run_20260917T061346Z_f832fd` / attempt `att_ee05c619`, exit code 0, batch status
`completed`. Manifest:
`outputs/maps-keyword-capture/2026-09-17/run_20260917T061346Z_f832fd/att_ee05c619/manifest.json`
(not committed; `outputs/` is ignored).

### Per-keyword outcome

| Query | Keyword | Status | Stop reason | Observed | Results PNGs | Scrolls |
|---|---|---|---|---|---|---|
| q0001 | bubble tea garden city | captured | end_of_results | 13 | 4 | 3 |
| q0002 | best bubble tea mineola | captured | end_of_results | 5 | 2 | 1 |
| q0003 | fried chicken mineola | captured | limit_reached | 15 | 5 | 4 |
| q0004 | matcha mineola | captured | end_of_results | 14 | 4 | 3 |

47 listings and 15 results screenshots in total. Every listing is `resultType: "organic"`;
`organicRank` runs 1..N with no gaps and no `unknown` in any of the four results.

**No Sponsored card appeared.** No listing was classified `ad`, and the string `Sponsored` does not
occur in any captured DOM text across the four keywords. The earlier probe's Gong Cha ad did not
reappear, so this run neither confirms nor contradicts the ad classifier: it did not exercise it.

### Reconciliation against the screenshots

`bubble tea garden city` was reconciled in full, every listing against every PNG; the other three were
spot-checked at their first and last screenshots.

1. **Display order and coverage.** Match. For q0001 the visual order across the four PNGs is exactly
   `displayPosition` 1..13, and every listing's `screenshotIds` point at a PNG in which that card is
   fully visible with its name legible. Cards cut off by the pane bottom are excluded from that
   screenshot and picked up by the next one (Arden is cut in `__01.png` and carried by `__02.png`),
   and cards visible in two consecutive screenshots carry both ids without being counted twice.
2. **Ad labelling.** Vacuously consistent: no card is visually marked Sponsored and no card is
   classified `ad`.
3. **Organic ranks.** Match: contiguous 1..N per keyword, no `unknown` cards, so the
   "null after any unknown" rule was not exercised.
4. **Counts and stop reasons.** Consistent. The three `end_of_results` keywords each show
   "You've reached the end of the list." in their final PNG, below the last recorded listing. For
   `fried chicken mineola` the final PNG shows cards 16, 17 and 18 (The Black Sheep Ale House, Kaiyo,
   7th Street Burger Mineola) present on the page and correctly absent from the output at
   `limit_reached`.
5. **CSV.** UTF-8 BOM, CRLF, header plus one row per listing, consistent column counts. `Café` and
   `Sip & Chill | Boba & Coffee House` survive intact, and of 918 cells none begins with `=`, `+`,
   `-`, `@`, tab or CR.
6. **Location.** `finalUrl` is recorded for every keyword and is the unchanged query-only URL.
   `context.observedMapView` is **null for all four keywords**: the entry-page URL never gains an
   `@lat,lng,zoom` segment, so there is nothing for the parser to read. This is left as-is, not
   fixed; the returned area is evidenced only by the map pixels and the listing addresses. The keywords
   were not altered and no city was appended. `bubble tea garden city` mixes regions exactly as the
   earlier probe suggested: within one result list, `3102 E Kansas Ave` (Kansas), `682 Stewart Ave`
   and `988 Franklin Ave` (Garden City NY), `3355 S Yarrow St` and `14101 E Exposition Ave`
   (Colorado), and `2700 Western Center Blvd` (Texas), over a continent-scale map. `best bubble tea
   mineola` and `fried chicken mineola` returned a local Nassau County map; `matcha mineola` drifted
   into Manhattan and Brooklyn addresses at ranks 9-12. Treating any of these as a local ranking
   would be wrong.
7. **Manifest.** All 27 artifacts exist at their recorded paths with byte counts matching
   `bytes` exactly (0 mismatches). Every keyword carries a terminal status and
   `persistenceStatus: "not_requested"`; artifacts carry `storageStatus: "local_only"` with a null
   `objectKey` and null `verifiedAt`.

### Defects found and fixed during this run

The first two live attempts did not produce data at all. Each was reproduced with a failing test
before being fixed; the suite went from 84 to 90 tests.

- **The page script could not run in the page.** Every keyword failed instantly with
  `page.evaluate: ReferenceError: __name is not defined`. `npm run capture` runs through tsx, whose
  esbuild transform hardcodes `keepNames`; it rewrites the page script's inner function to
  `const box=__name(r=>({...}),"box")`, and Playwright ships only the function source to the page,
  where no `__name` exists. The fixture tests never caught this because vitest's transform does not
  add the helper, so the same function serialized differently under test than in production.
  `readSnapshot` now evaluates the script inside a scope that defines `__name`.
- **The query field selector did not match the live entry page.** All four keywords then returned
  `partial / query_mismatch` with zero listings. Measured on the live page: `input#searchboxinput`
  never appears on the `?api=1&query=` entry page, the query sits in `input[name="q"]`, and both that
  field and the document title stay empty for roughly 0.8s *after* the results feed has rendered
  (feed present at 1.86s, query and title filled at 2.6s). The collector could therefore sample a
  stable feed while no query evidence existed yet and call it a mismatch. The selector now includes
  `input[name="q"]`, and a missing signal is waited out once rather than read as a mismatch.
- **Ratings were dropped whenever a card showed a review count.** Live cards label the rating
  `"4.8 stars 97 Reviews"`, but the selector required the aria-label to *end* with `" stars"`, so it
  matched the plain variant and missed the review-count one: `best bubble tea mineola` recorded
  `rating: null` for all five listings while the rating was plainly legible in the screenshot. Google
  serves both variants for the same keyword at different times, so which fields survived depended on
  when the run happened. Both label shapes now parse; in the run of record 0 of 47 listings have a
  null rating.
- **A spent budget was reported as a query mismatch.** Found while exercising the timeout below, in
  the wait introduced above: when the deadline expired before the query rendered, the result blamed
  the query instead of the budget. It now stops with `timeout`.

`reviewCount` is null for `bubble tea garden city` and `fried chicken mineola` and populated for the
other two. This is faithful, not a defect: Google served those cards without a review count, and the
screenshots show none.

### Timeout and shutdown

- **Controlled timeout.** One keyword with `keywordTimeoutMs: 5000` ended `failed / timeout`,
  `observedCount: 0`, error `no listings collected before timeout`, exit code 1, with the result JSON,
  CSV and observations still written. It did not hang. It also did not stop at 5s: the attempt ran
  **12.3s**, because the budget is checked at stage boundaries rather than enforced as a hard kill —
  navigation is granted a 1s floor and a stability observation completes once started. A Pod deadline
  must allow for this overshoot rather than assume `keywordTimeoutMs` bounds the attempt.
- **Clean shutdown.** `SIGINT` mid-batch printed
  `SIGINT received: finishing the current keyword, skipping the rest`, wrote `manifest.json`, and
  exited 130 with every input accounted for: `captured 1, failed 1, skipped 2`, the two untouched
  keywords recorded `skipped / cancelled` with no attempts. The keyword *in flight* at signal time
  does not survive, despite the message: its browser is closed underneath it and it is recorded
  `failed / error` with `page.screenshot: Target page, context or browser has been closed` (and in a
  second trial `navigation failed`, after burning a retry attempt on `qa02`). No data is lost and
  nothing is miscounted, but a deliberate shutdown is currently recorded as an error rather than as a
  cancellation.
- **Process cleanup.** Zero leftover browser processes after both the normal batch and the SIGINT
  run. Measured as Playwright-bundled Chromium executables specifically; the brief's
  `ps aux | grep -i chrom | wc -l` returns ~25 on this machine because the developer's own Google
  Chrome and PyCharm's CEF are running and have nothing to do with the collector. The counting method
  was validated against a deliberately open browser (6 processes while open, 0 after `close()`).

### What this run does not establish

- No consent page, no CAPTCHA, no no-results page and no second ad layout were encountered, so those
  paths remain covered only by fixtures. A `/sorry/` page still trips the batch circuit breaker in
  code alone.
- No ad appeared, so live ad classification and label ownership remain unvalidated.
- Not run in the target Pod: no sandboxed-Linux startup, resource, SIGTERM or egress evidence.
- No Azure delivery: persistence is local-only and no artifact has been uploaded or read back.
- One machine, one egress, one day, four keywords. The returned areas reflect this laptop's network
  location, not a client's.
