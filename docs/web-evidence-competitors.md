# Web screenshot policy, loading and competitor history

Implemented locally on `codex/web-evidence-competitors-20261110` (2026-11-10).
This document is a handoff, not a UAT deployment receipt. No point, keyword,
schedule, resource, shared SEO database or historical artifact was changed.
Android collection and its stopped node pool are unchanged.

## User-visible behavior

### Screenshots

Store-aware Web tracking and daily monitoring select `target-organic-top10/v1`.
Only a canonical Place ID match for the target store at natural rank 1–10
requires a normal screenshot. An ad alone does not qualify; display position
11 can qualify when its natural rank is 10. Every observed listing and the
JSON/CSV/observation artifacts remain available within the existing capture limit.
This does not extend result depth or collect additional search queries.

Normal out-of-Top10 or absent-target searches use stable DOM observations and do
not invoke the image capture API. Exceptions retain bounded diagnostics. Unknown
classification, incomplete traversal and required-image failures cannot be
reported as satisfied intentional omission. Upload failures returned as storage
receipts, as well as thrown write errors, remain failures.

The result carries `quality.screenshotPolicy` with target identity, trigger rank,
decision and satisfaction. `screenshotCoverageComplete` retains its literal old
meaning and is not made true for unscreenshoted rows. Ingestion validates the
policy against selected results and successful screenshot receipts. The UI
explains intentional omission separately from missing or failed images.

Raw CLI capture without a store-aware policy keeps legacy behavior. Historical
images are neither deleted nor rewritten. Policy is included in profile hashing;
old and new evidence cohorts must not be presented as continuous comparable
improvement merely because the image policy changed.

### Loading

- Timeline Mongo reads omit listing details, screenshot/result keys and warnings
  that the compact timeline does not use. Exact observations still load on demand.
- JSON responses have a tab-local 30-second, 12-MiB LRU cache. Explicit refresh,
  latest-data navigation and writes invalidate it. Failed/aborted requests are
  not cached. A fresh page load still requests metadata.
- Image responses remain authenticated on every request, including conditional
  requests. Private ETags allow unchanged cached images to receive `304` without
  downloading their body again. The server coalesces concurrent reads and keeps
  a 64-MiB, five-minute LRU image cache to avoid repeated Azure reads.
- Existing lazy image loading is retained. Browser eviction or an expired server
  cache can still require a transfer; this is not a promise of zero image traffic.
- No production speed, storage-saving percentage or capacity claim is made from
  local tests. Savings depend on the actual target Top10 rate and image usage.

### Competitor entry

Open a store and select **竞品排名**, also available in the sidebar. Select the
keyword, point and date range, then compare up to six businesses. Defaults are
the target store and recurring observed rivals. Selection is remembered per
store/surface/point/keyword, so changing dates does not silently replace the
comparison group. Click a chart point or timestamp for the exact observation.

The comparison panel follows the user's multi-series reference: **SoLV / ARP /
ATRP / 自然排名**, **每轮采集 / 每日末轮**, and **折线 / 柱状** controls, with a
shared business legend below the chart. SoLV/ARP/ATRP default to the configured
fixed-point scope, explicitly labelled as a fixed-point sample, not a new grid.
Natural-rank mode displays the selected individual point. Daily mode takes the
last recorded round for each local date, including an unsuccessful last round;
it never selects the day's best rank or smooths missing values.

Point batches join only through the parent scan identity in their writer manifest
paths. Time proximity is insufficient. The latest attempt at each point wins,
including failures. Mixed capture profiles and incomplete pagination withhold
metrics. Each business/metric reports its valid-point denominator; cohort changes
include scope, coordinates/profile and qualifying points so lines do not imply
comparable continuity across changing samples.

- SoLV: percentage of qualified points where that business ranks organically in
  the first three. Qualified absence needs known organic depth >=3 or list end.
- ARP: average of observed natural ranks 1–20. Absent points are excluded, so
  compare the valid-point count alongside the number.
- ATRP: average across the entire selected point scope; confirmed absence from
  the first 20 natural results (or list end) is assigned 21. A truncated index,
  unknown point or absence known only within 15 results is insufficient. The
  value is withheld rather than fabricating 21 or dropping the weak point.

Positive competitor ranks remain usable in legacy truncated indexes; absence
does not. Pages are fetched for at most three points concurrently, 500 rows per
point at a time, with explicit continuation. Metric/type/range changes reuse the
already loaded data and make no further collection or image requests.

API: `GET /api/stores/:storeId/competitors` with `surface`, `point`, `keyword`,
`from`, `to`, `limit` and optional `cursor`. It reuses existing observations,
requires normal authentication and does not launch searches. The UI loads 500
observations initially, with an explicit continuation button. It does not load
screenshots for the trend chart.

Business identity uses canonical Place IDs. Natural ranks and advertising
display positions stay separate. Failed/unqualified observations, missing ranks,
profile changes and gaps longer than three hours break lines. Geography remains
visible and unverified when evidence does not establish it.

New Web observations retain every collected listing in Mongo, within the same
result limit. Older observations may retain only the first ten listings. Missing
competitors in these older truncated records are labelled **历史收录范围有限**,
not assigned a rank or declared absent. An ad in a truncated record does not
prove the absence of an organic occurrence. No historical backfill is performed.

## Validation and operational handoff

Automated checks cover Top10/11, ads versus natural rank, zero-image omissions,
bounded diagnostic images, thrown/returned image storage failures, policy
validation and snapshot round trips, competitor identity/depth/cohorts, caches,
authenticated image 304 responses and scoped pagination. Browser integration
uses local fixtures at desktop and mobile widths; it checks chart selection,
request reuse, image-free trend loading and JavaScript errors. These fixtures
are not a live UAT or real-store ranking acceptance test.

Independent code review found and verified fixes for snapshot receipt loss,
classification-partial diagnostics, legacy ad/organic wording and returned
image-upload failures. Final test results are recorded in the implementation
plan alongside this document.

Deployment remains a separate step. Build and publish immutable Web/UI images,
then verify one isolated store-aware probe and its selected artifacts before
changing future scheduled jobs. Do not mutate active jobs or activate Android.
Keep both UI/ingestion receipt support and producer policy support in the release;
an older consumer can misinterpret intentionally absent screenshots. A runtime
rollback may use the previous pinned image; retained historical files stay intact.
