# UAT scrolling, Lodging and execution-status repair — 2026-09-18

The preceding [manual full-capacity verification](../uat-full-verification/README.md) exposed two remaining collector defects: a scroll step skipped the full screenshot for The Hidden House in `brunch near me`, and the `spa` results contained an unsupported name + Lodging card. This revision repairs both and separates observation execution from ranked-coverage status.

- Scroll fallback uses a visible card rather than an off-screen loaded card. Bounded recovery can revisit an uncovered committed occurrence using current geometry; sequence, screenshot, scroll and deadline limits remain enforced.
- An exact Lodging-only format with a distinct business name and valid HTTPS Google Maps place link is supported. Explicit Sponsored labels still win; unresolved advertising and arbitrary standalone categories remain unknown. The browser fixture is reconstructed from screenshot/text evidence, not a saved production DOM.
- Query `partial / non_ranking_result` and original manifest ranked-coverage status remain unchanged. `executionStatus: completed` and exit 0 require every query to be captured or to have a complete, selected-attempt diagnostic PNG, result JSON, CSV and observations record. Remote delivery remains a separate required gate. Other partials, source failures, skipped work and missing evidence remain nonzero. `counts.nonRanking` is a subset of partial, not an additional count to add to the denominator.
- Adapter/profile and layout provenance are `maps-feed-card/v3`. Search keywords, geolocation behavior and geographic assessments are unchanged.

## Local validation

[Validation record](local-validation.json): baseline 321 tests passed. Regression-first verification reproduced the scroll gap and the Lodging format failure. The integrated suite passed **366 tests across 33 files**. After the provenance-only v3 string update, typecheck, contract checks, build and an independent check of the built adapter/layout constants passed. Independent code review found no blocking issues; documentation review corrections were applied.

At this source commit, the new image has not yet completed UAT acceptance or replaced the daily image. Live acceptance, image digest and the authorized cleanup of the completed failed verification Job will be appended after independent readback. The existing primary-checkout edit to `deploy/cronjob/README.md` is outside this repair and remains preserved.
