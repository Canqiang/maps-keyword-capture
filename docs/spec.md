# Collection Specification

## Scope

Input consists of keywords and shared query settings; no target business is required. The default scope is the first 20 displayed listings, including ads, not every business available on Google Maps. General web search would require a separate adapter and must not share Maps ranking semantics.

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

Keep ad and organic occurrences of the same business separately. A business identifier supports downstream association but cannot serve as the sole deduplication key for displayed occurrences. Resolve scroll overlap using stable occurrence identifiers and neighboring order; mark results as partial when this cannot be verified. Map marker order must not be treated as list order.

## Page collection

- Use a fresh, signed-out browser context with a fixed viewport, language, and configured initial map view. Process one keyword at a time.
- Wait for the query to match the result list and for visible map content and images to render. A fixed sleep alone is not evidence of readiness.
- Handle CAPTCHA, consent pages, no results, business detail pages, and blank pages explicitly.
- Scroll the internal results list within configured bounds. A `fullPage` screenshot is not a substitute for scrolling that list.
- Capture the visible list and map while preserving ad labels. Adjacent screenshots may overlap, but data must not be counted twice.
- Stop at the listing limit, confirmed end of results, scroll limit, stalled loading, or timeout, and record `stopReason`.
- Keep original screenshots free of added ranking annotations. Report annotations belong in separate derived files with references to the originals.

## Files and storage

```text
outputs/2026-09-17/<run-id>/
  20260917T143025.123+0800__bubble-tea-garden-city__<query-id>.json
  20260917T143025.123+0800__bubble-tea-garden-city__<query-id>.csv
  20260917T143025.123+0800__bubble-tea-garden-city__<query-id>__01.png
  manifest.json
```

Use the configured timezone in filenames and retain the UTC offset. JSON timestamps use ISO 8601 with a timezone. Normalize Unicode, sanitize path characters, and limit keyword length in filenames; retain the complete original keyword in JSON. Run and query IDs prevent collisions within the same second or after sanitization.

CSV retains the ranking and classification fields from JSON. Escape commas, quotes, and line breaks correctly, and handle external text that spreadsheet software could interpret as a formula. JSON retains the original values.

Temporary Pod files are not durable delivery. Upload each query promptly and record object keys, byte counts, and checksums. Independently read back and verify the files before updating the manifest's `persistenceStatus`. Screenshots must decode successfully; CAPTCHA screenshots are diagnostic artifacts only.

## Success criteria

`captured` means collection reached the configured limit or a confirmed end of results, and the list order, classification, and screenshots meet this specification. It does not imply exhaustive global results for a keyword. `partial` preserves the evidence collected and the reason collection stopped. Incomplete keywords must also appear in the manifest.

Do not infer a persistent first-place ranking from one screenshot or automatically attribute changes between observations to the service. Browser geolocation, map view, network egress, language, and time may affect results. Leave the actual search location unknown when it cannot be established.
