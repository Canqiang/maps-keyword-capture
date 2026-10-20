# Rank-tracking domain

The system answers one question: for a store and a keyword, where does Google Maps rank the store, seen from a given place, on a given surface, at a given time? Everything below is organized around that fact.

## Entities

| Entity | Meaning | Where it lives |
|---|---|---|
| **Store** | A merchant listing to follow: `storeId`, `placeId` (the web identity), `aliases` (the Android OCR identity), `center`, optional `grid`, `keywords.core` and `keywords.longTail`. | `tracking-config/v1` (`docs/tracking-config.example.json`), one file for the whole system |
| **Surface** | Where the search is made: `web` (desktop Maps, map-view anchored) or `android` (official app, device GPS). Surfaces are never merged into one trend. | config `surfaces`, observation field |
| **Observation point** | A coordinate with a stable ID. `r0c0` is the store; grid points are `r<row>c<col>` from `src/grid`. | derived from the store's `center` and `grid` |
| **Scan** | One collector run on one surface and tier: `point` (the store only, every N hours) or `grid` (every point, daily). A scan is a batch manifest on the web and an Android manifest on Android. | collector output, referenced by `scanId` |
| **RankObservation** | The fact: surface × store × keyword × point × time → rank, listings seen, evidence keys. | MongoDB `observations`, `_id` = observationId |
| **Grid metrics** | ARP, ATRP, SoLV, buckets and rings over one store, keyword, surface and day. | derived with `src/grid/metrics.ts`; not stored yet |

## RankObservation

```
observationId  web|keke-flushing|braised food|r0c0|2026-10-20T16:00:27.898Z
surface        web | android
storeId, placeId, keyword, keywordKey, keywordTier (core | longTail | null)
pointId, point {latitude, longitude, distanceKm, ring}
locationMode   query_only | map_view | device_gps
observedAt     UTC instant the query started
localDate      calendar date in the tracking timezone (America/New_York)
scanId, queryId
rank           {status, displayPosition, organicRank, listingsObserved, listingStatus, stopReason}
topListings    first 10 listings: position, rank, type, name, placeId, rating, reviews, distance
evidence       {manifestKey, resultKey, screenshotKeys}  → Azure object keys
source         {adapterVersion, profileHash}
ingestedAt
```

`rank.status`: `ranked` (found), `not_found` (complete list without it), `not_found_in_prefix` (partial list without it), `not_evaluated` (non-ranking page), `blocked` (CAPTCHA or consent), `failed`.

The observation ID is deterministic, so ingesting the same manifest twice updates the same document. Collectors keep producing their own manifests and screenshots; ingestion only derives the fact and points back at the evidence.

## Flow

```
tracking-config/v1 ──planScan──▶ queries (store × keyword × point)
        │                              │
        │                    toWebBatches / toAndroidRuns
        │                              ▼
        │                 web collector (mapView per batch)   android collector (GPS per task)
        │                              │                              │
        │                       batch manifest + results        android manifest
        │                              └──────────┬───────────────────┘
        └───────────── ingest (place ID match / alias match) ─────────▶ observations (MongoDB)
                                                                             │
                                                              grid metrics, trends, comparisons
```

```bash
npm run tracking -- plan --config tracking.json --surface web --tier grid --format web-batches
npm run tracking -- plan --config tracking.json --surface android --tier point --format android-runs
npm run tracking -- ingest --config tracking.json --surface web --store-id keke-flushing --batch-dir outputs/<run>/<attempt> --point-id r0c0 --mongo-uri-env MAPS_TRACKING_MONGO_URI
npm run tracking -- ingest --config tracking.json --surface android --manifest outputs/android-maps/<date>/<run>/manifest.json --out observations.json
```

## Database

MongoDB, database `maps-rank-tracking`, collection `observations`. Indexes: `trend` (storeId, keywordKey, surface, pointId, observedAt desc), `scan` (scanId), `daily` (storeId, localDate, surface). The connection string comes from the environment variable named on the command line (`--mongo-uri-env`), following the existing `KEYWORD_MONGO_URI` secret pattern; it is never written into config or evidence.

## Not yet built

Scheduling from the config (web two-hourly CronJob, Android resident emulator), automatic ingestion after each run, stored grid metrics, and the comparison view. The web collector accepts `mapView` now; the daily monitor still runs query-only until its ConfigMap carries planned batches.
