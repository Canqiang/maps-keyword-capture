# Maps Keyword Capture

Capture Google Maps business listings and original screenshots by keyword, preserving ads, display order, and organic rankings. Designed to run as an independent Kubernetes Job in the existing cluster.

## Project status

The local collector is implemented and has been validated locally: keyword input, readiness checks, results scrolling, ad classification, screenshots, sequence reconciliation, and JSON/CSV/manifest output run under fixture tests and have completed one end-to-end run of four keywords against the live site on one machine. See [validation status](docs/validation-status.md) for what that run did and did not show. **Azure Blob delivery, the container image, the Kubernetes Job, and target-Pod acceptance are not implemented. Nothing has been deployed to the cluster, and no artifact has been delivered anywhere but the local disk.**

No target business is required. Each run collects the listings observed for a keyword; downstream consumers can filter by business, compare observations over time, or prepare reports.

English is the primary language for project documentation and code comments. Preserve original search terms and page text in collected data.

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

`npm run capture` runs the local collector in local-only persistence mode. It launches the bundled Chromium (`channel: "chromium"`), collects each keyword sequentially, and writes `outputs/maps-keyword-capture/<date>/<runId>/<attemptId>/` with `request.json`, per-query `q000N/qa0M/` folders (result JSON, CSV, `observations.jsonl`, PNGs), `manifest.progress.json`, and the final `manifest.json`. The exit code is 0 when every keyword is captured, 2 for a partial batch, 1 for a failed batch, and 64 for an invalid configuration. The summary line printed last includes the manifest path and `remotePersistence: not_requested`.

## Design documents

- [Detailed design](docs/design.md): architecture, browser workflow, ad evidence, sequence reconciliation, output contracts, persistence, and Job operations.
- [Implementation plan](docs/implementation-plan.md): phased deliverables and acceptance gates.
- [Collection specification](docs/spec.md): concise output and ranking conventions.
- [Deployment summary](docs/deployment.md): runtime choices and cluster validation.
- [Decisions and deviations, 2026-09-17](docs/superpowers/specs/2026-09-17-keyword-capture-design.md): why Chromium, 15 listings, query-only location behavior, Azure target, and DOM-index reconciliation.

The collection parts of these documents are implemented locally; the storage, container, and cluster parts still describe planned behavior. [TypeScript contracts](src/contracts.ts) cover attempts, observations, quality, skipped inputs, and artifact readback, with compile-time checks. Runtime schema validation of external JSON remains outstanding.

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

1. Done locally: keyword input, result readiness, scrolling, ad classification, screenshots, and JSON/CSV output. See docs/validation-status.md for what the local run has and has not shown.
2. Run 3–5 keywords in the target Pod to verify access, screenshots, ad markup, and challenge detection.
3. Integrate Azure Blob Storage with independent readback verification; add the container image and Job manifest.
4. Verify partial failures, timeouts, process cleanup, and artifact persistence after Pod deletion.

Start with manually triggered Jobs. Scheduled execution and an administration UI are outside the initial scope.
