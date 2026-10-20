# Evidence-first Tracking Frontend Implementation Plan

> **For agentic workers:** Use subagent-driven development with independent ownership and final review. User approved the design and implementation; proceed without another approval gate.

**Goal:** Implement the approved Connexup interface with real historical Web and Android observations, screenshots, and surrounding sampling points.

**Architecture:** Extend the existing TypeScript repository and HTTP API additively. A plain HTML/CSS/JavaScript client loads bounded timelines and exact observation evidence. A local read-only snapshot preview consumes existing real artifacts without changing collectors, databases, schedules, or deployments.

**Tech Stack:** TypeScript, Node HTTP, existing Mongo/in-memory repository, Vitest, plain browser JavaScript.

**Spec:** `docs/superpowers/specs/2026-10-20-tracking-frontend-design.md`

## Global Constraints

- Preserve existing collectors, deployment files, source keywords and shared SEO library.
- Separate Web and Android; surface selection is explicit in new query APIs.
- Preserve failure gaps, unknown classification, unverified location and incompatible cohorts.
- Never infer rank from a screenshot placeholder or substitute a latest image for historical evidence.
- Timeline default 14 days, maximum 90 days and 2,000 observations per page; fully consume pages before treating missing days as missing.
- A new failed grid run never falls back silently to an older successful run.
- Documents are English; UI is Chinese with field/metric names where useful.
- Local real-data preview is read-only and must not create remote indexes or write collections.

## Review Focus

- Same timestamp multiple observations must paginate without omissions and preserve exact screenshot identity.
- Failed latest attempts and switched profiles must break a trend and suppress misleading improvement deltas.
- Cross-store observation IDs and screenshot paths must not leak unrelated local files or secrets.
- Surrounding points with missing GPS or unverified geometry must remain unavailable, not rank 21 or fabricated coverage.
- Rapid merchant/channel/point changes must not display stale response data under the wrong heading.

### Task 1: Add historical query and grid evidence contracts

**Files:** `src/domain/repository.ts`, `src/web/server.ts`, new query helper modules as needed, `tests/tracking-history.test.ts`.
**Interfaces:** New `timeline`, `observation`, and `points` repository reads; explicit-surface timeline/detail/points/grid-runs HTTP contracts; additive `rosterLatest` and selected grid identity. Share finalized JSON shapes with the UI worker before implementation integration.

- [x] Write failing tests for stable date pagination, all outcome/cohort retention, ownership, roster partition, historical grid selection and unavailable attempted cells.
- [x] Run `npx vitest run tests/tracking-history.test.ts` and confirm meaningful failures.
- [x] Implement read APIs and backwards-compatible additions; optionally enforce `ServerDeps.readOnly` on every mutation.
- [x] Run focused tests, existing `tracking-ui`/reliability regressions and typecheck.

### Task 2: Implement approved frontend

**Files:** `src/web/ui.ts`, focused browser/model modules if useful, `tests/tracking-frontend.test.ts`.
**Interfaces:** Task 1 APIs; existing `/api/evidence?key=` PNG proxy; settings include read-only state.

- [x] Pin daily latest-attempt selection, cohort gaps, escaping and screenshot identity behavior with failing tests.
- [x] Implement portfolio, keyword/date matrix, trend, exact evidence comparison and surrounding point view using the approved design preview.
- [x] Add explicit Web/Android switches, point selection, exact run selection, capture coordinates/location receipts, responsive layout, loading/error/empty states and stale-request cancellation.
- [x] Verify existing configuration functionality remains available when writable and read-only preview cannot mutate it.
- [x] Run focused tests; fix contract integration issues.

### Task 3: Integrate real read-only evidence

**Files:** `src/web/snapshot.ts`, `tests/tracking-snapshot.test.ts`, local evidence directory outside Git.
**Interfaces:** Existing real data is mapped conservatively to `StoredStore` and `RankObservation`; evidence reader resolves an explicit allowlist of PNG files only.

- [x] Discover source artifact contracts and record proven date/store/surface/point coverage.
- [x] Write tests for snapshot loading, missing evidence, path traversal, quality preservation and forbidden mutations.
- [x] Implement an explicit read-only local preview entry point and adapt existing artifact data without promoting legacy evidence quality.
- [x] Validate all linked observation IDs and screenshot existence; record SHA-256 for visually inspected originals.

### Task 4: Integration and delivery

**Files:** local evidence report plus English README under `evidence/2026-10-20/tracking-frontend/`.

- [x] Run typecheck, build and full unit/contract tests after integration.
- [x] Independently review all new code; fix actionable findings and rerun affected checks.
- [x] Use browser UI to verify real Web and Android rows, historical screenshot selection, surrounding points and mobile layout.
- [x] Capture local preview screenshots and validation scope; confirm canonical main and collectors are unchanged.
- [x] Deliver the working local preview with actual data coverage and explicit remaining limitations; no deployment or GitHub push.
