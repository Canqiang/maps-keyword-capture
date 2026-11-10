# Web evidence and competitor trends implementation plan

**Goal:** Preserve all current words/points while reducing screenshot volume and page transfer, and expose competitor history.
**Architecture:** Versioned target-organic-top10 evidence policy; independent structured-data quality; authenticated conditional image caching; bounded competitor history derived from existing observations.
**Tech stack:** Existing TypeScript, Playwright, Mongo repository, vanilla UI and Vitest.
**Spec:** docs/web-grid-capacity-2026-11-10.md, narrowed by user: no grid/point/keyword/resource changes.

## Constraints and decisions
- Default raw capture remains legacy all-images; tracking and daily store-aware Web calls select top10 with canonical target Place ID. Android unchanged.
- All results and JSON/CSV persist. Missing required images fail evidence policy; intentional omission is explicit, never fake screenshotCoverageComplete.
- Historical competitor rows remain depth-limited; never infer absence from missing legacy topListings entries. No automatic blob backfill or extra Google searches.
- Competitors use same query/point/profile; missing/cohort changes break lines. Ads are separate; unresolved identities excluded.
- Private image cache must authenticate every conditional request; metadata requests stay fresh. No shared public cache.
- Do not deploy, change cluster configuration, delete artifacts or change shared SEO data in this implementation.

## Tasks / verification ledger
- [x] Screenshot tests: 10/11, ad-only, absent, failure diagnostics, real browser no screenshots on omitted queries, full structured output; implement policy contract and store-aware wiring.
- [x] API tests: authenticated ETag image cache and 304, bounded buffer budget, minimal competitor response/pagination/depth/cohort safety; implement API and full future listing retention.
- [x] UI tests: competitor route/selection/chart/cell evidence, lazy image loading and request reuse; implement using current design.
- [x] Run typecheck/contracts/build and focused + broad tests, independent review, record limitations in handoff.

## Validation record

- Screenshot/loading/base competitor implementation: all **110 files / 1,989 tests** passed. This included the regression where a returned image upload failure had incorrectly satisfied the policy; it was corrected before this successful run.
- User subsequently provided a multi-series metrics reference. Added fixed-sample SoLV/ARP/ATRP, every-round/daily-last and line/bar presentation without changing collection points/words. Its focused metrics/history/browser checks passed **29 tests across four files**.
- Final related regression after the reference-layout changes: **10 files / 115 tests passed**, including existing frontend, history, snapshot, ingestion and metric suites plus the new browser integration. This supplements the earlier full 1,989-test run; it is not a second full-suite verdict.
- TypeScript typecheck, contract type tests, production build and `git diff --check` passed after those changes.
- Independent review confirmed fixes for unresolved parent receipts disappearing from daily/latest history and rank-mode selection of an unloaded legacy point; independently reran both regressions successfully.
- Browser QA: actual local Chromium at 1440px and 390px, selectable businesses, controls, no image loading for charts, no extra API requests on metric/range/type changes. Saved previews explicitly label the fixture data as simulated. No live UAT acceptance or speed benchmark was performed.
- Handoff: `docs/web-evidence-competitors.md`. No remote writes, deployment, node-pool change, data deletion or SEO-library update.

Existing `.vscode/` and the earlier capacity assessment are preserved. Changes remain local on `codex/web-evidence-competitors-20261110`; not committed or pushed by this task.
