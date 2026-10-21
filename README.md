# Maps Keyword Capture

Capture Google Maps business listings and original screenshots by keyword, preserving ads, display order, and organic rankings. Designed to run as an independent Kubernetes Job in the existing cluster.

## Project status

The collector, Azure Blob delivery with read-back verification, the container image, and the production Kubernetes Job are implemented. They were accepted in Dev on 2026-09-17: a 20-keyword batch ran in the target Pod with every artifact delivered to the private container and verified by read-back, and a Job stopped with SIGTERM still published a verified final manifest. See [validation status](docs/validation-status.md) for what those runs did and did not show.

Two daily workloads are deployed, with separate keyword sources and Azure containers:

| Workload | Schedule | Keyword source | Azure container |
|---|---|---|---|
| [Dev batch](deploy/cronjob/README.md) | 10:00 `America/New_York` | Fixed list, currently 20 keywords | `maps-keyword-capture` |
| [UAT monitor](docs/uat-monitor-operations.md) | 00:00 `Asia/Shanghai` | Automatic-enrollment release: daily MongoDB store discovery, fresh per-place keyword API records, up to 40 keywords per store | `maps-keyword-capture-uat` |

The automatic-enrollment release discovers eligible stores from the keyword library each day; configured stores serve as stable-ID aliases rather than a fixed enrollment list. See [automatic store discovery](docs/automatic-store-discovery.md) for eligibility, exclusions, capacity limits, and the persisted registry snapshot. Deployment and live-validation scope are recorded in the [release evidence](evidence/2026-09-23/automatic-store-discovery/README.md).

The first UAT midnight cycle selected 260 queries but stopped after 119 attempts: 109 captured, 10 partial, and 141 skipped. The detail-page breaker fix is now deployed after a targeted six-query test: three ranked captures, three correctly preserved non-ranking details, and no skipped work; all 36 objects passed independent Azure readback. A later manual run attempted all 260 selected keywords; all 1,744 evidence objects passed independent verification, with two remaining collector partials. The follow-up scroll, Lodging-layout and execution-status repair passed a five-query UAT test and is pinned in the daily image: both original cases succeeded, two details remained explicitly non-ranking, and all 29 objects passed independent readback, followed by manual inspection of all 12 PNGs. The daily 500m CPU reservation may still queue on the current node pool; the smoke used 200m after its first unscheduled attempt. See [repair evidence](evidence/2026-09-18/uat-capture-fixes/README.md) and [validation status](docs/validation-status.md) for exact scope. See the [release evidence](evidence/2026-09-18/uat-optimization/README.md) and [UAT operations guide](docs/uat-monitor-operations.md). Workload identity, a results viewer, and report generation remain outside this rollout.

No target business is required. Each run collects the listings observed for a keyword; downstream consumers can filter by business, compare observations over time, or prepare reports.

English is the primary language for project documentation and code comments. Preserve original search terms and page text in collected data.

## Native Android pilot

Current repair work and acceptance gates: [Android ranking repair handoff](docs/android-ranking-repair-handoff.md).

A separate [Android Maps worker](docs/android-maps-node.md) searches the official native app on a dedicated emulator and records original PNG/XML evidence at explicit observation points. It has its own capture profile and storage namespace. The v3 adapter adds native-card OCR, overlap-verified scrolling, ad classification and separate displayed/organic positions in listing rows. Unreadable fields and incomplete coverage remain explicit. It does **not** enable an Android daily schedule, automatically match the monitored store, or establish customer-local geography. See [development validation](evidence/2026-10-16/android-maps/README.md) for software checks and outstanding real-device gates, and [host setup](deploy/android/README.md) for installation.

```bash
npm run android -- validate --config deploy/android/pilot.example.json
```

The following collection behavior describes the existing desktop web collector.

## Agreed behavior

- Collect the first 15 displayed listings per keyword by default, including ads. The limit is configurable.
- Store `displayPosition` (list order including ads) separately from `organicRank` (excluding ads).
- Identify ads explicitly. Use `unknown` when classification is uncertain; do not guess organic rankings.
- Preserve separate ad and organic occurrences of the same business. Do not count overlapping scroll observations twice.
- Save original list and map screenshots with the query, ad labels, and surrounding context. Do not alter the page to manufacture a ranking.
- Produce CSV, JSON, and one or more PNG files per keyword, plus a batch manifest.
- Record query conditions and timestamps in metadata. Search the original keyword without setting a map center or simulated location. Google may still use network and other location signals. A single observation does not establish a persistent ranking or prove an SEO effect.

## Technical direction

Node.js 22 / TypeScript + Playwright + bundled Chromium + Kubernetes Job on the FBRDev AKS cluster + Azure Blob Storage.

The container image is based on the official Playwright Linux image, which bundles Chromium. Google Chrome is not installed. The runner records the actual browser version in each result.

## Development setup

```bash
npm ci
npx playwright install chromium
npm test                      # contract type tests + unit and fixture tests
npm run capture -- --config examples/keywords.json
AZURE_STORAGE_ACCOUNT_URL=https://fbrdevstorage.blob.core.windows.net npm run capture -- --config examples/keywords.json --storage azure   # after az login
```

`npm run capture` runs the local collector in local-only persistence mode. It launches the bundled Chromium (`channel: "chromium"`), collects each keyword sequentially, and writes `outputs/maps-keyword-capture/<date>/<runId>/<attemptId>/` with `request.json`, per-query `q000N/qa0M/` folders (result JSON, CSV, `observations.jsonl`, PNGs), `manifest.progress.json`, and the final `manifest.json`. In local mode exit 0 means observation execution completed: every keyword is either captured or a recognized non-ranking page with complete diagnostic/JSON/CSV/observation evidence. The original ranking-coverage `status` and query-level `partial / non_ranking_result` are retained; `executionStatus` is separate and `counts.nonRanking` is a subset of `counts.partial`, not an additional denominator. Exit 2 covers other incomplete, blocked or skipped work; 1 means a failed batch, and 64 means invalid configuration. With `--storage azure` the same codes apply, and 1 is also returned when any artifact or the final manifest is not verified in the container. The summary line printed last includes the manifest path and `remotePersistence`: `not_requested` in local mode, and `verified` or `failed` with `--storage azure`, where the summary also carries `manifestReceipt`, the delivery receipt for `manifest.json`.

## Design documents

- [Detailed design](docs/design.md): architecture, browser workflow, ad evidence, sequence reconciliation, output contracts, persistence, and Job operations.
- [Implementation plan](docs/implementation-plan.md): phased deliverables and acceptance gates.
- [Collection specification](docs/spec.md): concise output and ranking conventions.
- [Deployment summary](docs/deployment.md): runtime choices and cluster validation.
- [Decisions and deviations, 2026-09-17](docs/superpowers/specs/2026-09-17-keyword-capture-design.md): why Chromium, 15 listings, query-only location behavior, Azure target, and DOM-index reconciliation.

These documents describe implemented behavior, except for the items listed under Next steps. [TypeScript contracts](src/contracts.ts) cover attempts, observations, quality, skipped inputs, and artifact readback, with compile-time checks. Runtime schema validation of external JSON remains outstanding.

- [Validation status](docs/validation-status.md): evidence-backed findings and remaining acceptance gates.
- [Recovered probe archive](evidence/2026-09-17/README.md): original scripts and screenshots with checksums and explicit provenance limits.

## Repository layout

```text
src/contracts.ts         Input, result, evidence, and delivery contracts
tests/contracts.type-test.ts  Compile-time contract regression checks
evidence/2026-09-17/     Recovered laptop probes and provenance inventory
examples/keywords.json   Example keyword configuration
docs/spec.md             Ranking, ads, deduplication, and output conventions
docs/deployment.md       Independent Job deployment summary
docs/design.md           Detailed architecture and behavior
docs/implementation-plan.md  Implementation milestones and acceptance gates
```

## Next steps

1. Validate full-volume UAT daily operation and improve coverage for documented partial outcomes.
2. Authenticate the Pod with workload identity instead of a container SAS.
3. Add a results viewer.
4. Add report generation.
5. Observe a CAPTCHA or consent page and a stalled or throttling storage account from the Pod; revocation and rotation were exercised on 2026-09-17.

For Dev scheduled batches, see [deploy/cronjob/README.md](deploy/cronjob/README.md); for individual manual batches, see [deploy/job/README.md](deploy/job/README.md); for the UAT monitor, see [docs/uat-monitor-operations.md](docs/uat-monitor-operations.md).
