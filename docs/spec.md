# Collection Specification

This is the concise specification. See [the detailed design](design.md) for the algorithm, attempt isolation, evidence protocol, and data contracts. The collector and Azure delivery are implemented; see [validation status](validation-status.md) for release evidence and the limits of local-only changes.

## Scope

Input consists of keywords and shared query settings; no target business is required. The default scope is the first 15 displayed listings, including ads, not every business available on Google Maps. The first version submits only the original keyword, without a configured map center, zoom, or simulated geolocation. Optional map-view configuration is reserved for a later explicit mode; it is not enabled in this version. General web search would require a separate adapter and must not share Maps ranking semantics.

## Rankings and ads

`displayPosition` is the one-based list order observed during collection, including ads. `organicRank` is calculated only for confirmed organic results. The following example uses fictional data:

| Display position | Business | Type | Organic rank |
|---|---|---|---|
| 1 | A | ad | null |
| 2 | B | organic | 1 |
| 3 | C | organic | 2 |
| 4 | D | ad | null |
| 5 | E | organic | 3 |

Preserve the actual ad label and screenshot evidence used for classification. Failure to find ad text is not sufficient to classify a listing as organic when the page structure is unknown. After an `unknown` classification, a gap in the sequence, or an unstable reorder, set affected organic rankings to null and mark the result as partial. Do not skip uncertain entries and continue reporting definitive rankings.

A no-review card may omit its address. The supported fallback requires an explicit `No reviews` row followed by one of `Bakery`, `Cafe`, `Coffee shop`, `Restaurant`, `Bubble tea store`, or `Tea house`. Other category-only text remains unknown; locality text is not a business category. Recognized ad labels still take precedence, and unresolved standalone ad markers cannot become organic results.

Keep ad and organic occurrences of the same business separately. A business identifier supports downstream association but cannot serve as the sole deduplication key for displayed occurrences. Resolve scroll overlap using stable occurrence identifiers and neighboring order; mark results as partial when this cannot be verified. Map marker order must not be treated as list order.

## Page collection

- Use a fresh, signed-out Chromium context with a fixed viewport and language. Submit the original keyword without map coordinates, manual panning, "Search this area", or browser geolocation overrides. Process one keyword at a time.
- Record `locationMode: "query_only"`, `configuredMapView: null`, the final URL, and observed map/location context where available. Do not silently append a city to a keyword. Broad, ambiguous city names, and "near me" queries describe the runner's environment, not a guaranteed customer area. The [recovered query-only samples](../evidence/2026-09-17/README.md) already show geographic ambiguity; preserve the keyword and flag observed ambiguity for review.
- Optional `expectedArea` records a verified reference label, coordinates, radius, and provenance (`source`) for passive geographic assessment. It never changes the query or browser location. JSON records `quality.geographicRelevance`; missing reference or incomplete coordinate evidence remains `unverified`. The seven-store default registry has no verified reference areas configured.
- Wait for the query to match the result list and for visible map content and images to render. A fixed sleep alone is not evidence of readiness.
- Handle CAPTCHA, consent pages, no results, business detail pages, and blank pages explicitly. A recognized detail page without a ranked feed produces `partial / non_ranking_result`, a diagnostic screenshot, and no invented rank. Continue to subsequent keywords and stores; this outcome does not contribute to the unknown-layout breaker. A place URL alone is insufficient to recognize a detail page. Unknown layouts, CAPTCHA/consent, and storage failures retain their existing safeguards.
- Scroll the internal results list within configured bounds (provisional defaults: 6 scrolls and 5 results screenshots; query-only coverage remains unvalidated). Move the last partially visible card to the top; if none exists, retain the last full card as overlap. Oversized cards require consecutive screenshots that jointly cover the card. Budget exhaustion yields partial evidence, as detailed in [scroll coverage](design.md#scroll-step-and-screenshot-coverage). A `fullPage` screenshot is not a substitute for scrolling that list.
- Capture the visible list and map while preserving ad labels. Adjacent screenshots may overlap, but data must not be counted twice.
- Stop at the listing limit, confirmed end of results, scroll limit, stalled loading, or timeout, and record `stopReason`.
- Keep original screenshots free of added ranking annotations. Report annotations belong in separate derived files with references to the originals.

## Files and storage

```text
maps-keyword-capture/2026-09-17/<run-id>/<attempt-id>/q0001/
  qa01/
    20260917T143025.123+0800__bubble-tea-garden-city__<query-id>.json
    20260917T143025.123+0800__bubble-tea-garden-city__<query-id>.csv
    observations.jsonl
    20260917T143025.123+0800__bubble-tea-garden-city__<query-id>__01.png
```

The final manifest is at the attempt root; all query artifacts are isolated by query attempt as detailed in [the output layout](design.md#10-data-model-and-output).

Use the configured timezone in filenames and retain the UTC offset. JSON timestamps use ISO 8601 with a timezone. Normalize Unicode, sanitize path characters, and limit keyword length in filenames; retain the complete original keyword in JSON. Run and query IDs prevent collisions within the same second or after sanitization.

CSV retains the ranking and classification fields from JSON. Its `geographic_status` column repeats the **query-level** geographic assessment on every listing row; it is not a per-listing inside/outside verdict. JSON retains the assessment scope, reference provenance, and checked/inside/outside/unknown counts. Escape commas, quotes, and line breaks correctly, and handle external text that spreadsheet software could interpret as a formula. JSON retains the original values.

Temporary Pod files are not durable delivery. Upload each query promptly to the private `maps-keyword-capture` (Dev batch) or `maps-keyword-capture-uat` (UAT daily monitor) container in `fbrdevstorage`, using the workload-specific path layout, and record object keys, byte counts, and checksums. Independently read back and verify the files before updating the manifest's `persistenceStatus`. Screenshots must decode successfully; CAPTCHA screenshots are diagnostic artifacts only.

## Success criteria

`captured` means collection reached the configured limit or a confirmed end of results, and the list order, classification, and screenshots meet this specification. It does not imply exhaustive global results for a keyword. `partial` preserves the evidence collected and the reason collection stopped. Incomplete keywords must also appear in the manifest.

Do not infer a persistent first-place ranking from one screenshot or automatically attribute changes between observations to the service. Browser geolocation, map view, network egress, language, and time may affect results. Leave the actual search location unknown when it cannot be established.
