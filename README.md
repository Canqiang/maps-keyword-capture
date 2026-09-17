# Maps Keyword Capture

Capture Google Maps business listings and original screenshots by keyword, preserving ads, display order, and organic rankings. Designed to run as an independent Kubernetes Job in the existing cluster.

## Project status

This repository is an initial scaffold containing requirements, data contracts, an input example, and a deployment design. **Browser collection, ad classification, screenshots, and uploads are not implemented, and nothing has been deployed to the cluster.**

No target business is required. Each run collects the listings observed for a keyword; downstream consumers can filter by business, compare observations over time, or prepare reports.

English is the primary language for project documentation and code comments. Preserve original search terms and page text in collected data.

## Agreed behavior

- Collect the first 20 displayed listings per keyword by default, including ads. The limit is configurable.
- Store `displayPosition` (list order including ads) separately from `organicRank` (excluding ads).
- Identify ads explicitly. Use `unknown` when classification is uncertain; do not guess organic rankings.
- Preserve separate ad and organic occurrences of the same business. Do not count overlapping scroll observations twice.
- Save original list and map screenshots with the query, ad labels, and surrounding context. Do not alter the page to manufacture a ranking.
- Produce CSV, JSON, and one or more PNG files per keyword, plus a batch manifest.
- Record query conditions and timestamps in metadata. A single observation does not establish a persistent ranking or prove an SEO effect.

## Technical direction

Node.js / TypeScript + Playwright + Google Chrome + Kubernetes Job + private object storage.

Installing the Playwright package does not install Google Chrome. The planned runner will use `channel: "chrome"`; the dedicated Linux image must install and validate Chrome separately and record its actual version.

## Development setup

```bash
npm ci
npm run typecheck
```

These commands validate the data contracts only. There is no executable capture command yet. Dependencies are pinned in the lockfile; browser compatibility has not been validated.

## Repository layout

```text
src/contracts.ts         Input, result, and batch status contracts
examples/keywords.json   Example keyword configuration
docs/spec.md             Ranking, ads, deduplication, and output conventions
docs/deployment.md       Independent Job design and acceptance criteria
```

## Next steps

1. Implement local Chrome collection: keyword input, result readiness, scrolling, ad classification, screenshots, and JSON/CSV output.
2. Run 3–5 keywords in the target Pod to verify access, screenshots, and challenge detection.
3. Integrate object storage with independent readback verification; add the container image and Job manifest.
4. Verify partial failures, timeouts, process cleanup, and artifact persistence after Pod deletion.

Start with manually triggered Jobs. Scheduled execution and an administration UI are outside the initial scope.
