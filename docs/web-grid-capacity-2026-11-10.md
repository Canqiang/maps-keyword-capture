# Web grid, selective screenshots, and competitor trends — assessment

Status: historical resource assessment and proposed design, 2026-11-10. No product code,
deployment, scheduling, worker count, database, keyword, or storage retention changes.
The user requested all monitored Web terms on a grid every two hours, with capacity
assessed first. Android remains outside this work; do not restart its stopped pool.

## Historical scope and subsequent implementation

This assessment predates the screenshot-policy release and later unlocated-cadence
changes. "Current" and "today" below refer to 2026-11-10. Its keyword counts,
node resources and throughput estimates have not been refreshed; they are not a
current capacity guarantee. The 19/25-point expansion remains a proposal, not an
activated collection plan. Original measurements and planning calculations are
retained for comparison, not rewritten as new measurements.

Subsequent work is documented separately:

- Selective screenshots, loading improvements and competitor trends:
  [implementation](web-evidence-competitors.md) and
  [UAT release evidence](../evidence/2026-11-10/web-optimization/README.md).
- Weekly search-volume synchronization:
  [operations](search-volume-sync.md) and
  [acceptance](../evidence/2026-11-12/search-volume-sync/README.md).
- Unlocated two-hour collection and dashed observational trends:
  [handoff](unlocated-two-hour-monitoring.md),
  [cadence acceptance](../evidence/2026-11-13/unlocated-two-hour/README.md) and
  [chart acceptance](../evidence/2026-11-14/unlocated-trend-lines/README.md).

The daily-unlocated references and implementation proposals below describe the
earlier state; the linked handoffs describe the later implemented behavior.

## Confirmed requirements

- Keep a screenshot when the target business has verified organic rank 1–10.
  Ads do not qualify. Retain a small bounded diagnostic screenshot on exceptions.
- Preserve structured observations for all queries, including ranks outside ten,
  competitors, qualified absence, partial results, failures, and ads.
- Support spatial grid observations and comparison of several competing businesses
  over time. Preserve exact query, location, method, and historical evidence.
- Do not affect existing collection, the shared SEO library, or other teams' services.

## Evidence collected on 2026-11-10

Read-only `FBRDevAKSCluster/uat` checks: `maps-targets-web-2h` is enabled,
`15 */2 * * *`, America/New_York, three workers, 6,600-second deadline, `uatops`
selector, pinned GPS-first image `778c35df...`. Each worker requests 250m CPU,
1 GiB RAM, 512 MiB ephemeral storage; limits 2 CPU, 2 GiB RAM, 2 GiB ephemeral.

Independently downloaded Azure scan summaries for the 05:15 UTC round
(13:15 Beijing / 00:15 New York, November 10):

| Worker scan suffix | Queries | Duration | Summary status |
| --- | ---: | ---: | --- |
| 718ca7 | 225 | 76m 22s | completed, exit 0 |
| 4fad28 | 237 | 88m 41s | completed, exit 0 |
| 86baa7 | 258 | 87m 40s | completed, exit 0 |

Total 720 selected/dispatched/observed queries; 713 captured lists and seven
recognized non-ranking outcomes. All three report zero blocked/failed/skipped/
unresolved queries and zero not-ingested observations. This is a throughput
summary check, NOT independent verification of all results, screenshots, or DB rows.

The downloaded frozen catalog's SHA-256 matches its writer receipt. Its active
keyword targets match today's authenticated store API. Nine active stores have
149 base terms and 91 enabled best variants, **240 store/query pairs**. The inactive
store is excluded. Exact queries repeated across stores remain separate contexts.

| Store | Base | Best variants | Exact terms |
| --- | ---: | ---: | ---: |
| Choice UWS | 12 | 12 | 24 |
| Choice Clinton Hill | 12 | 12 | 24 |
| Connexion Spa | 9 | 9 | 18 |
| Only Bear | 18 | 9 | 27 |
| Royal Queen | 10 | 10 | 20 |
| SEE JOY | 12 | 10 | 22 |
| Szechuan Opera | 8 | 8 | 16 |
| KEKE | 55 | 13 | 68 |
| Szechuan Gourmet | 13 | 8 | 21 |

## Capacity result

Current resources/partitioning cannot support all terms at 19 or 25 points every
two hours. Today's total worker-seconds / 720 = **21.059 seconds/query**, including
current batch overhead. Extrapolation assumes ideal balancing and unchanged query
cost; more points change batching overhead, result locality, and egress contention.
Use 24 seconds/query for an initial conservative planning case, **not a guarantee**.
A 90-minute completion target leaves 20 minutes before the existing deadline and
30 minutes before the next schedule. Every row below includes best variants.

| New grid only | Searches/round | Searches/24h* | Ideal duration with 3 workers at measured mean | Workers for 90min at measured mean | Workers for 90min at 24s/query |
| --- | ---: | ---: | ---: | ---: | ---: |
| 19 points | 4,560 | 54,720 | 8.89h | 18 | 21 |
| 25 points | 6,000 | 72,000 | 11.70h | 24 | 27 |

*12 rounds per ordinary 24-hour day; local daylight-saving transition days require
explicit slot accounting. These are full-grid-only replacement scenarios, not
permission to remove the existing fixed-point workload. Retaining today's 720
fixed-point searches adds 8,640/day; at 24s/query the combined minimum is 24 or
30 balanced workers respectively. For isolated rollout retain the original three
workers and provision a separately measured grid budget. The distinct daily
unlocated collector also remains unchanged and is outside these grid totals.

For engineering planning, evaluate **22–24 concurrent grid workers for 19 points**
and **28–32 for 25 points**, in an isolated pool. These are benchmark candidates,
not a validated node allocation or cost quote. At the present 1 GiB request and
2 GiB limit, those ranges alone request 22–24 / 28–32 GiB and can reach 44–48 /
56–64 GiB respectively, before system reservations and headroom. CPU requests of
250m are scheduling reservations, not measured browser CPU demand. Do not select
a production VM size from those requests. A provisional dedicated hardware budget
around 32–40 vCPU and 64–96 GiB is a sizing envelope to test, NOT a promise of
throughput or authorization to expand. Adjust after measured CPU/RAM/IO peaks.

Today's shared uatops pool has three Standard_B4as_v2 nodes, 11.58 allocatable CPU
and about 43.48 GiB allocatable memory. Existing requests total 4.987 CPU and
19,272 MiB (~18.82 GiB), leaving ~6.593 CPU and ~24.66 GiB in aggregate. Idle
actual RAM was ~9,513/6,674/7,635 MiB. This is neither a peak-load measurement nor
permission to consume the remainder. 27 extra 1-GiB requests already exceed that
memory headroom. Even 21 workers fitting aggregate requests would not establish
safe sustained performance alongside existing services. Account for per-node
placement, Pod slots, daemon overhead, and CPU contention. Azure distinguishes
nominal from allocatable resources: https://learn.microsoft.com/en-us/azure/aks/node-resource-reservations.

The current scheduler shards whole stores; more than nine workers cannot split
nine stores' work. KEKE alone has 68×25=1,700 grid searches (~9.94 worker-hours at
today's average). Merely increasing Pod count does not solve this bottleneck.

## Proposed implementation boundaries

### Selective screenshots (first)

`captureStableObservation` currently takes screenshots while waiting for stability;
`query-runner` associates images with card coverage, and ingestion/metric eligibility
requires screenshot coverage. Simply setting the image budget to zero would mark
legitimate rankings unreliable. Deleting PNGs after upload also would not avoid
capture/transfer cost.

Introduce an explicit versioned evidence policy. Check stable DOM snapshots,
consecutive rank prefix, identity, query, ads, and location receipts without making
image presence the definition of rank correctness. When the target's verified
organic rank is 1–10, capture its fully visible card and sufficient list context
from the same query attempt, verifying DOM signatures around the screenshot. Do
not rerun the search to manufacture evidence, and do not stop collecting other
listings when the target is found. Unknown classification/identity cannot qualify
as a numeric Top-10 hit. Keep at most a small bounded diagnostic image per failed
attempt (proposed default one), subject to the existing retry cap.

Record `screenshotDecision` (captured / omitted_by_policy / diagnostic / failed),
policy version, trigger rank, and actual artifact receipts separately from sequence
and classification quality. Intentionally omitted images are not broken evidence
links or capture failures. An image required by policy that fails remains a visible
evidence-delivery failure. Existing historical screenshot coverage semantics are
not rewritten; metric code must explicitly accept the new structured-evidence
contract rather than falsely setting screenshotCoverageComplete=true. Preserve
version/cohort provenance; do not silently bridge incompatible historical methods.

Store all structured rank results/JSON/CSV and raw observation provenance. Never
fill missing images with reconstructed Google screenshots. UI displays
“按策略未截图（本店未进入自然前10）”, or the actual exception reason, while keeping
rank trends accessible. Existing PNGs are not deleted. Keep rank depth at the
current displayed-result budget for the first optimization; deeper organic
collection for ATRP needs a separate performance measurement.

Screenshot byte savings depend on the measured Top-10 hit rate, retained frames
per hit, and exception rate. The runtime summaries cannot establish that fraction.
Do not promise a percentage reduction or count hypothetical savings as capacity.

### Grid and scheduling

The screenshot supplied by the user shows 19 points / two rings / 0.25 km distance.
The live Whitespark report redirects to login in this session; its exact geometry
and metric internals have not been inspected. Do not claim a compatible algorithm.
Our existing generator supports odd square grids (3×3, 5×5, etc.), not the shown
19-point layout. A 19-point candidate could use a center + two hexagonal rings;
exact coordinates must be previewed and frozen, and spacing/extent semantics named
explicitly. Geometry choice and spacing per store remain unresolved. Capacity
comparison above does not choose them. The old 5-km-edge default would produce
2.5-km spacing on a 5×5 grid, very different from the supplied dense neighborhood.

Use immutable grid definitions with center/coordinates/version, and common scheduled
round IDs. Partition bounded point/keyword batches across workers, rather than whole
stores. Freeze all exact terms including best variants once per round, with unique
work IDs, bounded retries, fenced/idempotent claims, aggregate completion and coverage.
Preserve failed/missing points rather than replacing them with previous successes.
Only delete local staging after independent durable-upload verification and receipt
recording; do not delete historical Azure artifacts. No unbounded pending queue.

Render actual sampled points with ranks/colors, a date/round selector, and click-to-
inspect query results. Distinguish absent within checked depth, failed, missing,
non-ranking, and unverified geography. Do not interpolate dots into claimed measured
coverage. Old fixed points and unlocated daily observations stay separate. Grid
geometry/profile changes start separate comparison cohorts. Location receipts are
not proof of Google's backend locality.

### Competitor trends

Use the same search result list; do not launch one search per competitor. Mongo's
`topListings` currently retains only ten displayed entries, including ads; raw
Azure result JSON may hold the larger captured prefix. Ingest complete captured
listing facts into an indexed, derived observation model, keyed by round/query/
point/profile and stable place identity. Preserve ad display order and organic
rank separately, including repeated organic/ad appearances of the same merchant.
Do not join different branches by name alone. Missing identity remains unresolved.

Proposed UI: current business plus up to five selected competitors on a keyword's
same-point rank chart, with a separate grid-summary metric chart and a selectable
business map. Offer competitor candidates from repeated co-occurrence, then persist
selected identities so the baseline does not silently change each day. Show rating
and review-count changes where observed; null reviewCount remains unknown. A missing
competitor outside Mongo's ten displayed entries is not proof of absence: retrieve
raw JSON first or label the history depth-limited.

Build historical competitor series read-only from preserved results with provenance,
without overwriting source observations or storing all PNGs again. Never fetch large
blob inventories on every page refresh; use paginated summary APIs, indexed derived
rows, and on-demand evidence links. Do not use image count as analytic denominator.

SoLV uses Top-3 organic presence with explicit assessable/planned point counts; ARP
uses observed ranks with its appearing-point denominator. ATRP requiring rank-20
absence remains unavailable when the captured prefix is too short. Do not invent
16 or 21 as an actual rank, or bridge unavailable points with smooth lines. Compare
competitors on matched time/point/method sets and show missingness. A ranking change
alone does not prove an SEO intervention caused it.

## Validation and rollout gates (proposed, not executed)

1. Unit/contract tests: ranks 10/11 boundary, ad-only/unknown identity, stable DOM
   without images, exception images, image-write failure, existing historical
   contracts, and skipped-image UI. All queries must still produce structured data.
2. Offline tests: exact all-term grid counts, best-variant inclusion, coordinate
   identities, common-round completeness, worker retries and no duplicate selected
   attempts; competitor identity, missingness, organic/ad ordering, and formulas.
3. After implementation and a concrete approved pilot plan, run isolated same-query
   comparisons with telemetry: worker-seconds/query, p95/p99 durations, peak RAM/CPU,
   local disk high-water, upload bytes, Top-10 hit/diagnostic rates, CAPTCHA/layout/
   location failures. No production schedule change during the assessment.
4. Scale isolated tests in bounded steps and require two complete target-sized
   rounds below 90 minutes, with every planned work item accounted for, no storage
   delivery loss and no unexplained duplication/quality regression. Independently
   read receipts, sampled screenshots, and derived observations. Do not add workers
   if egress rate limiting or result quality worsens.
5. Production resource spending and cutover/replacement vs continued fixed-point
   collection require a concrete decision. Keep rollback images/configuration and
   preserve history. Do not change other teams' services or activate Android.

## Evidence paths and limitations

Local evidence root:
`/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/web-grid-assessment-20261110`

Files: capacity.json, current authenticated stores.json, frozen-catalog.json,
three scan-*.json summaries, nodes.json, pods.json, web-cron.json, config.json.
The capacity.json computes scenarios from fresh measurements. No post-optimization
benchmark exists yet. Final grid geometry, exact storage savings, chosen VM SKU,
monthly cost, and concurrent worker throughput remain unverified decisions.
