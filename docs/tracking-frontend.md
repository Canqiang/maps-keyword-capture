# Tracking frontend

The tracking HTTP service provides an evidence-first interface for Web and Android observations. It does not execute captures. The selected surface, merchant, point, keyword and range are part of navigation, so an observation always opens its own evidence rather than the newest screenshot.

## Views

- Portfolio: latest retained observations joined to the current catalog's keyword roster. This is not scheduler health or a period success rate.
- Keyword overview (default store view): one row per keyword with the three core facts together. Rows are ordered by the monitoring catalog's report search volume (a dated snapshot that covers only target keywords and does not change over time); keywords without a volume follow. Each fixed point, plus the legacy `r0c0` point when it has records, is a column showing the newest attempt, the change since the earliest qualified rank of the same cohort in the range, a sparkline over that column's observed span, and the point's target. A cell is green when the newest qualified rank meets the target. Selecting a row expands the full trend chart with every point overlaid and a map of the fixed points labelled with their newest result. The per-date matrix remains available as 按日期查看.
- Keyword history (按日期查看): latest attempted observation per keyword and local date, including failed attempts. Expand a day to inspect every attempt. Historical withdrawn keywords remain available separately. Rows are ordered by tier (monitoring targets first) and the first column shows the point's target rank when the catalog defines one. Cells use short states: a number is a qualified organic rank, `数字*` a raw rank whose evidence failed a check, `未见` a confirmed absence (the store is not in the verified top 15 displayed results, ads included, or the list ended earlier), `未见*` an absence in a capture that did not verify 15 results, `待核` an unresolved identity or unreliable ranking, `失败`/`受阻` a capture that produced no list.
- Trend: every attempt of the selected keyword is plotted at its local capture time, not one point per day. The axis starts at the first observed day when the selected range begins earlier, and says so. Qualified ranks are solid markers, connected only within one cohort (same point, zoom, profile and adapter) and when consecutive attempts are at most 36 hours apart. Qualified absences sit on a separate `未见` band and are never converted into a rank. Unverified ranks and absences are hollow markers on the current point only; failed or blocked captures leave a gap. The store's other fixed points are overlaid for the same keyword and date range (qualified records only, toggle per point), and the point's monitoring target is a dashed line. Range statistics count attempts; best, median and worst use qualified ranks only.
- Evidence: exact original screenshot sequence, selected occurrence and quality checks. Display order includes ads; organic rank excludes confirmed ads. The stored top-listings projection contains at most ten displayed appearances, not the entire result list.
- Surrounding points: recorded coordinates, selected point history and exact grid-run evidence when a captured grid exists. Unknown location, missing attempts and incompatible runs remain explicit. A few sampled points do not establish continuous radius coverage.

A raw observed rank may be shown with a quality warning when it does not pass the current metrics contract. Only qualified records contribute to qualified totals; comparison also requires a compatible location/profile/adapter cohort. Missing records are never converted into a rank or interpolated through a trend.

## Local read-only snapshot preview

Run from the repository:

```bash
npx tsx src/web/snapshot.ts /absolute/path/to/snapshot.json 0
```

The printed URL binds only to `127.0.0.1`. The loader never connects to Mongo, creates indexes, or runs a collector. Both the HTTP layer and repository reject writes. Existing production tracking behavior is unchanged.

A snapshot contains `version: 1`, an IANA `timezone`, `stores`, normalized `observations`, an `evidence` array, and descriptive `info`. Each evidence entry includes its exact object `key`, optional absolute PNG cache `path`, original `bytes`, and `sha256`. All observation image references must be indexed. The reader checks bytes, SHA-256 and PNG signature whenever an image is opened. A verified remote response may fill its explicitly indexed local cache path without overwriting an existing file. Unknown archive store centers remain null; these records cannot be used to configure capture plans.

Optional read-only Azure login fallback for uncached original screenshots:

```bash
SNAPSHOT_AZURE_ACCOUNT=myaccount SNAPSHOT_AZURE_CONTAINER=mycontainer \
  npx tsx src/web/snapshot.ts /absolute/path/to/snapshot.json 0
```

This uses the existing Azure CLI login through `AzureCliCredential`, never account keys or SAS values. Only indexed image keys can be read and every returned object must match its archived receipt. Missing or mismatched images produce an error rather than a substitute image. There are no remote upload, delete or list operations in this preview reader.

The preview is an explicitly dated archive, not a live operational monitor. Rebuilding a snapshot is separate from changing the capture configuration. The source audit must identify date ranges, catalog provenance, missing location/quality data and whether original images were hash-checked in full or only when read.

## Validation

Run `npm run typecheck`, `npm test` and `npm run build`. New focused suites cover timeline pagination and ownership, unavailable grid cells, archive read-only enforcement and receipts, and client day/cohort/evidence identity logic. Browser acceptance additionally checks desktop/mobile layout and real original PNG selection; unit fixtures alone do not establish live collector acceptance.
