# Observation grids and rank metrics

Location-dependent rank tracking samples each store on an N×N square grid, Local Falcon style, and summarizes the ranks with a few fixed figures. `src/grid/grid.ts` generates the points, `src/grid/metrics.ts` computes the figures, and `npm run grid` exposes both.

## Grid

- `radiusKm` is the distance from the store to the grid **edge**; point spacing is `2·radius/(N−1)`. A 7×7 grid with a 5 km radius has 1.67 km spacing, edge points at 5 km and corners at 7.1 km.
- `size` is odd (3 to 15) so the store itself is a point, `r0c0`. Point IDs are `r<row>c<col>` with signed offsets (`r-3c+2`); row is positive northwards. The same ID means the same place on every day and on both surfaces.
- Latitude offset per kilometre is 1/111.32 degrees; longitude offset is divided by cos(latitude). Distances are great-circle.
- Rings: `inner` ≤ 1 km, `middle` ≤ 3 km, `outer` beyond, configurable per call.

```bash
npm run grid -- points --lat 40.7658211 --lng -73.8315243 --radius-km 5 --size 7
npm run grid -- points --lat 40.7658211 --lng -73.8315243 --radius-km 5 --size 7 \
  --android-tasks --store-id keke-flushing --store-name "Keke Food 可可小卤 — Flushing" \
  --keyword "braised food" --alias 可可小卤 --alias "KEKE BRAISED DELI" > tasks.json
```

The second form prints a `tasks` array ready to paste into an `android-maps-input/v1` file (the Android input accepts at most 20 tasks per run, so a 7×7 grid is three runs).

## Metrics

All figures use the organic rank by default (`--rank-field displayPosition` counts ads).

| Figure | Definition |
|---|---|
| ARP | Average Rank Position: mean rank over the points where the store appears in the top 20. |
| ATRP | Average Total Rank Position: mean over every observed point; absent counts as 21 (`notFoundRank`). |
| SoLV | Share of Local Voice: fraction of observed points where the store is in the top 3. |
| Buckets | Heat-map colours: top 3, 4–10, 11–20, not found. |
| Rings | ARP, ATRP, SoLV and counts per inner/middle/outer ring, which shows the radius of influence. |
| missingPoints | Grid points with no usable observation (failed or skipped query). They are listed, never counted as not found. |

```bash
npm run grid -- metrics --manifest outputs/android-maps/<date>/<run>/manifest.json --grid grid.json \
  --store-id keke-flushing --keyword "braised food"
```

`grid.json` holds `{ "grid": { "center": {...}, "radiusKm": 5, "size": 7 } }`. The output includes a textual heat map, north at the top, `x` for not found and `?` for a missing point.

## Cost

Each point is one query. A 7×7 grid costs about 16 minutes per store and keyword on the desktop collector (20 s per query) and about 49 minutes on one Android emulator (60 s per query), so grid scans belong to a few core keywords per store, once a day, while the hourly or two-hourly series stays at the store point.
