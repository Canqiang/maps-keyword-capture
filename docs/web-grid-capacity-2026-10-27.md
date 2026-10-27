# Web 25-point grid capacity assessment — 2026-10-27

Assessment only. No collector, schedule, node pool, keyword, database or historical
artifact was changed. Android is not included in the throughput estimates.

## Decision

Three fixed points are useful directional observations but too sparse to describe
spatial visibility around a business. A consistent 5x5 grid gives 25 samples and
4-percentage-point SoLV steps, versus 33.3 points with three samples. Neither is
population-weighted market share. Grid extent and spacing matter as much as count.

The current three Web workers cannot collect every current keyword on 25 points
every two hours. A query-only extrapolation is about 12.7 hours per round. The
current 110-minute deadline would terminate the run first; extending the deadline
alone would block following schedules under Forbid.

## Current live configuration and measured baseline

Read-only checks at approximately 2026-10-27 13:45–13:54 Asia/Shanghai:

- `FBRDevAKSCluster`, `uat/maps-targets-web-2h`: 3 indexed workers, balanced
  whole-store assignment, schedule `15 */2 * * *`, America/New_York, Forbid,
  active deadline 6,600 seconds. Grid tier currently disabled.
- Each worker requests 250m CPU, 1Gi memory, 512Mi ephemeral storage; limits are
  2 CPU, 2Gi memory, 2Gi ephemeral storage. Work EmptyDir is 2Gi.
- Nine active stores, 27 current fixed points; inactive Massage has none.
- Authenticated current store catalog, passed through the production pure planner:
  146 base store-keyword pairs, 234 including best variants, 620 point-query pairs.
  Counts are per merchant, not globally deduplicated search phrases. Some KEKE
  terms currently search only the center; multiplying 620 by 25/3 understates an
  all-keywords-at-all-grid-points proposal.
- Today's 12:15 Beijing / 00:15 New York round: three independently downloaded
  Azure scan summaries show 210/204/206 searches, completed, summary exit 0.
  Slowest worker took 80m31s; summed worker time 13,479.713s, 21.74s/query.
  There are 617 result lists plus three recognized non-ranking outcomes. This
  summary read is for throughput, not a fresh all-artifact correctness audit.
- The independently verified October 26 GPS-first round supplies a cross-check:
  620 searches, 81m36s wall time; 21.95 worker-seconds/query.

## Workload scenarios

These are replacement workload scenarios, not additions to the existing job.
Keeping the existing job in parallel adds another 620 searches per two-hour slot.
No existing keyword will be silently removed to meet a capacity estimate.

| Scope across nine stores | Searches/round | Linear time, current 3 workers | Initial parallel-worker planning range |
| --- | ---: | ---: | ---: |
| Current fixed-point plan | 620 | 80.5 min observed | 3 existing |
| 3 selected terms/store, 25 points | 675 | 88 min estimated | 3–4, benchmark required |
| 5 selected terms/store, 25 points | 1,125 | 146 min estimated | 6–8 |
| Original 90 store-keyword pairs only | 2,250 | 292 min estimated | 10–12 |
| Current 146 base terms, no best variants | 3,650 | 474 min estimated | 18–20 |
| All current 234 expanded terms | 5,850 | 760 min estimated | 24–30 |

Counts are explicit scenarios, not approval to select or remove terms. At a
planning rate of 24 worker-seconds/query, 5,850 searches need at least 22 balanced
workers to fit 110 minutes, or 26 for a 90-minute target. Extra point-batch/browser
startup, geographic variation, Azure round trips, retries and concurrent egress
contention are not proven to scale linearly. A grid with three terms per point
has 225 batches instead of today's 47; its 88-minute estimate is not a guarantee.

All timing assumes the current maximum 15 displayed results, including ads.
Reliable ATRP for missing stores requires at least 20 verified organic results
or an exhausted list. Deeper collection needs another benchmark and increases
work; do not fill top-15 absences with rank 21.

## Existing nodes and safe capacity

Web selects `envpool=uatops`: 3 Standard_B4as_v2 nodes, 4 vCPU / 16GiB nominal each.
Total allocatable CPU is 11.58 cores; memory is 43.48GiB. Active workloads already
request 6.787 CPU and 19.570GiB. Remaining request headroom is therefore about
4.793 CPU and 23.91GiB, spread unevenly across nodes. At current worker requests,
the per-node scheduling upper bounds are 2 + 5 + 11 = 18 workers. This is a
request-only ceiling, not safe throughput: other services, CPU bursts, resident
memory, storage, Pod constraints and performance headroom still matter.

At the idle-between-rounds snapshot, uatops actual memory was about
10,076 / 11,676 / 2,886 MiB. No Web worker was active then, so this is NOT a
measurement of browser peak CPU or memory. Low instantaneous CPU does not prove
capacity for 26 sustained browser workers. AKS scheduling uses allocatable and
resource requests, not the apparent free fraction in one `kubectl top` sample.

The separate crawler node is Standard_F4as_v7 (4 vCPU / 16GiB nominal), allocatable
3.86 CPU / 15.07GiB, currently about 0.329 CPU / 0.398GiB requested. It has the
`maps-capture=android:NoSchedule` taint, 10 remaining Pod slots, and is not eligible
for the current Web selector. It may be considered for a separately approved,
measured pilot while Android stays inactive; it is not enough for full Web grid
capacity and is not silently repurposed in this assessment.

For the full 5,850-query proposal, reserve an independent pool budget roughly
24–32 vCPU and at least 64GiB, then confirm actual sizing with a bounded benchmark.
This is an initial engineering budget, not a verified SKU/count or cost quote.
Increasing requests/limits in a shared pool is not an isolation guarantee.

## Software and storage gates

1. `balancedShardStores` balances whole stores. Only nine active stores exist;
   increasing parallelism beyond nine cannot split one store's work. KEKE alone
   would have 62 x 25 = 1,550 searches. Introduce bounded keyword/point or point-
   batch work units and authoritative common-round completion/identity first.
2. The current grid planner does not automatically add point-tier best variants.
   Simply enabling grid would change keyword scope. Freeze and compare the exact
   intended query plan and preserve the shared SEO library.
3. Current metric UI is intentionally fixed-point only. Grid metrics need their
   own complete, immutable point-set/round identity, including cross-worker
   aggregation. Do not concatenate the new grid with old three-point baselines.
4. Remote storage stages files locally and does not remove completed batch files.
   Workdir quota is 2Gi. The reference round has 4,627 objects totaling 2.30GiB,
   or about 3.80MiB/query. Running the full grid on three workers would imply
   roughly 7.2GiB staged per worker on average, beyond today's quota, even if the
   deadline were extended. Smaller work units or verified staging cleanup needed.
5. At unchanged evidence density, the full scenario produces about 21.7GiB/round,
   260.6GiB/day at 12 rounds/day, or 7.63TiB per 30 days before lifecycle reduction.
   Current workload is roughly 27.6GiB/day under the same approximation. This is
   a single-round storage extrapolation, not a measured future bill. Preserve
   historical data and agree prospective retention before reducing evidence.
6. More workers share Google egress. CAPTCHA/limited views, result locality,
   verified rank continuity and upload latency must remain acceptance gates;
   completion count alone is insufficient. Do not bypass protections.

## Recommended staged choice

Keep the current three-point/two-hour job unchanged. First benchmark an isolated
OnlyBear 5-term x 25-point job (125 searches) with preserved evidence and node
telemetry. Select spacing/radius from the intended customer area, not merely a
larger dot count. Then choose between:

- Low-resource path: retain all current terms at three points every two hours,
  and run five agreed core terms/store on a 25-point grid once per day. That adds
  1,125 searches/day, roughly 15% over today's 7,440/day; still schedule it without
  competing with the existing job and validate the overlap budget.
- Frequent spatial tracking: choose 3–5 terms/store for a two-hour grid, explicitly
  decide whether this supplements or replaces their fixed-point observations,
  measure 6–8 workers for the five-term replacement scenario, and allocate
  additional resources if retaining the original full job.
- Full two-hour grid: refactor work partitioning, establish round-level metrics,
  secure dedicated capacity/retention budget, then increase concurrency in bounded
  steps and demonstrate two consecutive full rounds within the safe deadline.

No pilot, resize, activation, deletion or configuration change was performed.

## Evidence

Local evidence:
`/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/grid-capacity-2026-10-27`

Contains live CronJob/node/Pod snapshots, authenticated stores/config, pure planner
counts, node request arithmetic, latest three Azure summaries and scenario math.
Credentials were used only in memory and not printed or saved.

Reference guidance:
- https://docs.localfalcon.com/guides/grid-configuration
- https://learn.microsoft.com/en-us/azure/aks/node-resource-reservations
