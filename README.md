# Maps Keyword Capture

Capture Google Maps business listings and original screenshots by keyword, preserving ads, display order, and organic rankings. Designed to run as an independent Kubernetes Job in the existing cluster.

## Project status

This repository is an initial scaffold containing requirements, preliminary data contracts, an input example, a detailed design, and an implementation plan. **Browser collection, ad classification, screenshots, and uploads are not implemented, and nothing has been deployed to the cluster.**

No target business is required. Each run collects the listings observed for a keyword; downstream consumers can filter by business, compare observations over time, or prepare reports.

English is the primary language for project documentation and code comments. Preserve original search terms and page text in collected data.

## Agreed behavior

- Collect the first 15 displayed listings per keyword by default, including ads. The limit is configurable.
- Store `displayPosition` (list order including ads) separately from `organicRank` (excluding ads).
- Identify ads explicitly. Use `unknown` when classification is uncertain; do not guess organic rankings.
- Preserve separate ad and organic occurrences of the same business. Do not count overlapping scroll observations twice.
- Save original list and map screenshots with the query, ad labels, and surrounding context. Do not alter the page to manufacture a ranking.
- Produce CSV, JSON, and one or more PNG files per keyword, plus a batch manifest.
- Record query conditions and timestamps in metadata. The initial map view is required input because the cluster's egress IP geolocates to Virginia. A single observation does not establish a persistent ranking or prove an SEO effect.

## Technical direction

Node.js 22 / TypeScript + Playwright + bundled Chromium + Kubernetes Job on the FBRDev AKS cluster + Azure Blob Storage.

The container image is based on the official Playwright Linux image, which bundles Chromium. Google Chrome is not installed. The runner records the actual browser version in each result.

## Development setup

```bash
npm ci
npm run typecheck
```

These commands validate the data contracts only. There is no executable capture command yet. Dependencies are pinned in the lockfile; browser compatibility has not been validated.

## Design documents

- [Detailed design](docs/design.md): architecture, browser workflow, ad evidence, sequence reconciliation, output contracts, persistence, and Job operations.
- [Implementation plan](docs/implementation-plan.md): phased deliverables and acceptance gates.
- [Collection specification](docs/spec.md): concise output and ranking conventions.
- [Deployment summary](docs/deployment.md): runtime choices and cluster validation.
- [Decisions and deviations, 2026-09-17](docs/superpowers/specs/2026-09-17-keyword-capture-design.md): why Chromium, 15 listings, required map view, Azure target, and DOM-index reconciliation.

These describe planned behavior. The preliminary TypeScript contracts must be extended as listed in the detailed design before runtime implementation.

## Repository layout

```text
src/contracts.ts         Input, result, and batch status contracts
examples/keywords.json   Example keyword configuration
docs/spec.md             Ranking, ads, deduplication, and output conventions
docs/deployment.md       Independent Job deployment summary
docs/design.md           Detailed architecture and behavior
docs/implementation-plan.md  Implementation milestones and acceptance gates
```

## Next steps

1. Implement local Chromium collection: keyword input, result readiness, scrolling, ad classification, screenshots, and JSON/CSV output.
2. Run 3–5 keywords in the target Pod to verify access, screenshots, ad markup, and challenge detection.
3. Integrate Azure Blob Storage with independent readback verification; add the container image and Job manifest.
4. Verify partial failures, timeouts, process cleanup, and artifact persistence after Pod deletion.

Start with manually triggered Jobs. Scheduled execution and an administration UI are outside the initial scope.
