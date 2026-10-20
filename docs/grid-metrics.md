# Observation grids and rank metrics

Location-dependent rank tracking samples each store on an N×N square grid, Local Falcon style, and summarizes the ranks with a few fixed figures. `src/grid/grid.ts` generates the points, `src/grid/metrics.ts` computes the figures, and `npm run grid` exposes both.

## Grid

- `radiusKm` is the distance from the store to the grid **edge**; point spacing is `2·radius/(N−1)`. The default is **5×5 with a 5 km radius**: 25 points, 2.5 km spacing, edge points at 5 km and corners at 7.1 km. Use 3×3 (9 points, 5 km spacing) for a cheap daily check and 7×7 (49 points, 1.67 km) only for an occasional detailed scan.
- `size` is odd (3 to 15) so the store itself is a point, `r0c0`. Point IDs are `r<row>c<col>` with signed offsets (`r-3c+2`); row is positive northwards. IDs are relative offsets, not geographic identities: changing the center, radius or size can move a point with the same ID. Android ingestion compares the recorded coordinates against the chosen grid within 1 metre and leaves mismatches unavailable. Canonical signed IDs are accepted by the Android location schema.
- Latitude offset per kilometre is 1/111.32 degrees; longitude offset is divided by cos(latitude). Distances are great-circle.
- Rings: `inner` ≤ 1 km, `middle` ≤ 3 km, `outer` beyond, configurable per call.

```bash
npm run grid -- points --lat 40.7658211 --lng -73.8315243 --radius-km 5 --size 5
npm run grid -- points --lat 40.7658211 --lng -73.8315243 --radius-km 5 --size 5 \
  --android-tasks --store-id keke-flushing --store-name "Keke Food 可可小卤 — Flushing" \
  --keyword "braised food" --alias 可可小卤 --alias "KEKE BRAISED DELI" > tasks.json
```

The second form prints a `tasks` array ready to paste into an `android-maps-input/v1` file (the Android input accepts at most 20 tasks per run, so a 5×5 grid is two runs and a 7×7 grid three).

## Metrics

All figures use the organic rank by default (`--rank-field displayPosition` counts ads).

| Figure | Definition |
|---|---|
| ARP | Average Rank Position: mean rank over the points where the store appears in the top 20. |
| ATRP | Average Total Rank Position: mean over every observed point; absent counts as 21 (`notFoundRank`). |
| SoLV | Share of Local Voice: fraction of observed points where the store is in the top 3. |
| Buckets | Heat-map colours: top 3, 4–10, 11–20, not found. |
| Rings | ARP, ATRP, SoLV and counts per inner/middle/outer ring, which shows the radius of influence. |
| missingPoints | Grid points with no usable observation, including failures, non-ranking pages, unknown quality, partial absences and mismatched coordinates. They are listed, never counted as not found. |

```bash
npm run grid -- metrics --manifest outputs/android-maps/<date>/<run>/manifest.json --grid grid.json \
  --store-id keke-flushing --keyword "braised food"
```

A reliable numeric rank can be used from a partial but continuously verified prefix. A null rank is eligible only with `rankingStatus=not_found`, a complete assessment, explicit reliable classification/order, and either an explicit observed list end or ranks 1–20 in the selected rank field. Reaching the default budget of 15 displayed results does not establish NR20. Historical manifests missing coordinates or reliability remain raw evidence, outside the denominator. ARP, ATRP and SoLV are `null` when their denominator is empty, including empty rings.

`grid.json` holds `{ "grid": { "center": {...}, "radiusKm": 5, "size": 7 } }`. The output includes a textual heat map, north at the top, `x` for not found and `?` for a missing point.

## Cost

Each point is one query. A 5×5 grid costs about 8 minutes per store and keyword on the desktop collector (20 s per query) and about 25 minutes on one Android emulator (60 s per query); 7×7 doubles that. Grid scans belong to a few core keywords per store, once a day, while the hourly or two-hourly series stays at the store point.
