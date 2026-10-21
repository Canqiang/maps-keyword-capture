# Rank-tracking domain

The system records where a merchant appears for a keyword on one search surface, at a particular observation point and time. A Web map viewport is a search anchor, not verified phone GPS. Web and Android histories remain separate.

## Entities and current implementation

| Entity | Meaning and source |
|---|---|
| Store | `storeId`, Google `placeId`, Android name `aliases`, center, optional grid/expected area, and core/long-tail keywords. Inline config or the independent MongoDB tracking `stores` collection. |
| Surface | `web`: desktop Maps with a configured map view; `android`: official Maps App with device-location evidence. A summary explicitly selects a surface. |
| Point | A coordinate plus a grid ID such as `r0c0` or `r+2c-1`. IDs are local to each store and grid geometry; matching IDs alone do not establish matching locations. |
| Scan | The Web orchestrator creates a parent scan and one or more collector batches. Each observation retains its source batch/run and selected query identity. Android produces its own run manifest. |
| RankObservation | One source query, target merchant, captured location/profile, rank qualifications, listing details and original evidence references. Stored in MongoDB `observations`. |
| Analysis | Latest ranks, channel-specific summaries, comparable trends, and grid metrics are derived from qualified observations; unavailable evidence is not a ranking penalty. |

`tracking scan` resolves active stores at run start, applies deterministic store sharding, captures Web batches, verifies delivery and upserts observations with a bounded retry. `tracking plan` resolves the same source before generating Web/Android tasks. `tracking ingest` resolves identities including inactive stores for historical imports and does not apply scan sharding. `stores --list` lists the full catalog.

The tracking store collection is **independent of the shared SEO keyword library** used by the existing daily monitor. UI keyword edits affect subsequent tracking scans; they do not edit that shared library. Android planning and ingestion are implemented, but unattended Android scheduling and automatic capture-to-ingestion orchestration still require separate integration. A grid UI or enabled config is not proof that grid collection has run. Existing daily-monitor behavior is separate from this path.

## Observation fields

| Field | Meaning |
|---|---|
| `observationId` | Deterministic source-query identity, independent of whether the result file was readable on the first import. |
| `surface`, `storeId`, `placeId` | Capture channel and merchant identity; merchant identity/center changes are not ordinary edits; same-Place-ID relocations require a reviewed migration. |
| `keyword`, `keywordKey`, `keywordTier` | Original query, normalized lookup key, and store-specific core/long-tail classification. Validation uses the same NFKC/case/whitespace normalization. |
| `pointId`, `point`, optional `gridSpec` | Captured coordinates/zoom and validated distance/ring metadata. Missing coordinates stay null. Fresh orchestrated scans retain their grid snapshot; historical imports must not invent one from today's settings. |
| `observedAt`, `localDate` | Source query time in UTC and calendar date in the tracking timezone. |
| `scanId`, `queryId`, `source` | Collector run/query, selected attempt identity, adapter and profile provenance. |
| `rank.displayPosition` | First matched displayed appearance, including advertisements. |
| `rank.organicRank` | Independently selected trustworthy organic appearance. An ad preceding the merchant's organic result does not hide the latter. |
| `rank.targetOccurrences`, `rank.adDisplayPositions` | Separate target occurrences and observed advertisement positions. |
| `quality` | Ordering, classification, screenshot coverage, identity resolution, organic coverage, explicit list end, result surface, geography and Android location checks. Missing checks are unverified. |
| `topListings` | First ten observed appearances with name, position, classification, rating and review count; this is a bounded summary, not the entire captured result set. |
| `evidence` | Exact verified remote object keys or resolvable local evidence paths. Local paths are not Azure keys; the Web evidence proxy serves only its permitted remote prefix. |

`rank.status` distinguishes `ranked`, `ad_only`, `not_found`, `not_found_in_prefix`, `not_evaluated`, `identity_unresolved`, `unreliable`, `blocked` and `failed`. A detail page is non-ranking, not absence. A partial prefix without the merchant does not prove it is outside the top 20. An unknown advertisement classification before a target cannot yield a certain natural rank.

## Eligibility and comparisons

Analysis requires explicit quality checks. A numeric rank retained in a failed or unreliable record does not count toward ranked/top-three totals. Confirmed absence requires a trustworthy ordered/classified result list with an explicit end or enough natural results for the metric's cutoff. Unknown, blocked, incomplete and non-ranking observations create gaps; charts do not connect across those gaps. No eligible points means unavailable ARP/ATRP/SoLV, not zero.

History comparisons require the same merchant, surface, point geometry, capture profile, adapter and location mode. Web comparisons also retain map zoom; Android comparisons require matching device-location evidence. Grid analysis uses captured geometry where present and rejects incompatible coordinates instead of mapping historical `r+2c0` onto today's changed radius. The default map context remains observational evidence, not proof of every customer's local ranking.

The new source-identity format is versioned. Existing timestamp-keyed rows are not deleted or migrated automatically. Re-ingesting old data across versions may require a separately reviewed migration/deduplication plan. Legacy records lacking required quality/provenance remain available as evidence but are not silently promoted into comparable metrics.

## Execution, persistence and ingestion

Execution completion, ranking usability and evidence delivery are separate:

- A recognized detail page with complete evidence can finish execution while yielding no rank.
- Partial scrolling, skipped queries, missing evidence and collector failure propagate to the scan result.
- Azure batches require verified manifest/query delivery before their observations are upserted. Manual imports additionally require `--manifest-receipt <receipt.json>` containing the final collector receipt; its size, SHA-256, source identity and optional `--manifest-key` must match the imported manifest. A present Web result must also match the selected, referenced `result_json` artifact's byte size and SHA-256 before ingestion; altered local content cannot inherit the original artifact's provenance. Android imports also check all artifact delivery statuses. Failed delivery stops further dispatch. Local-only runs retain local evidence explicitly.
- Failed Mongo ingestion is retried once; permanent failure is reported as `notIngested` and a partial scan.
- Failure to persist the final scan summary yields exit 1 even if capture succeeded. The final summary's delivery receipt is returned/logged outside its own immutable file.

Exit 0 means completed execution and required delivery, not “all keywords ranked.” Inspect the separate captured/non-ranking/partial/blocked/failed/skipped counters and ranked/confirmed-absence/unresolved counts.

## Commands

```bash
npm run tracking -- plan --config tracking.json --surface web --tier grid --format web-batches --mongo-uri-env MAPS_TRACKING_MONGO_URI
npm run tracking -- plan --config tracking.json --surface android --tier point --format android-runs --mongo-uri-env MAPS_TRACKING_MONGO_URI
npm run tracking -- ingest --config tracking.json --surface web --store-id keke-flushing --batch-dir outputs/<run>/<attempt> --manifest-receipt final-web-receipt.json --point-id r0c0 --mongo-uri-env MAPS_TRACKING_MONGO_URI
npm run tracking -- ingest --config tracking.json --surface android --manifest outputs/android-maps/<date>/<run>/manifest.json --manifest-receipt final-android-receipt.json --mongo-uri-env MAPS_TRACKING_MONGO_URI
npm run tracking -- stores --config tracking.json --mongo-uri-env MAPS_TRACKING_MONGO_URI --list
npm run tracking -- ingest-daily --config tracking.json --mongo-uri-env MAPS_TRACKING_MONGO_URI --from 2026-10-15 --to 2026-10-21   # daily-monitor batches from the evidence container, append-only
```

`ingest-daily` needs the evidence container settings (`AZURE_STORAGE_CONTAINER_SAS_URL`) and verifies every selected result against the manifest's own artifact receipt; it never replaces stored observations (see [daily-monitor ingestion](../deploy/tracking-ingest/README.md)). Receipt options above apply to Azure manifests; explicitly local-only manifests do not require remote receipts. A saved collector receipt is used here for ingestion consistency, not a new independent Azure download.

The Mongo URI comes from the named environment variable and must not be stored in config or evidence. Deployment procedures are in [tracking Web operations](../deploy/tracking-web/README.md). Local tests use synthetic collector outputs and mock/in-memory external services; passing them does not establish live Google behavior, Azure permissions or runtime isolation.
