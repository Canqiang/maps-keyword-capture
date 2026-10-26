# Web history date navigation — 2026-10-26

## Confirmed issue

The selected URL range ended on October 22 although live Web observations existed through October 25 in America/New_York. Preserving an explicit historical range is intentional. However, the `Recent 14/30/90 days` controls incorrectly used that old end date as their anchor. Refreshing or choosing a recent window could therefore continue hiding newer data.

Both keyword overview and date matrix now share date handlers. Recent windows end on the current date in the configured display timezone, and `View latest data` opens the last 14 calendar days. Explicit manual ranges are retained until the user changes them. Read-only archived reports continue to use their selected snapshot end date and do not show a live-data button.

## Verification

- Regression first failed with four missing-binding failures; after the change all four behavioral checks pass (timezone boundary, latest navigation, manual history, archive anchor).
- Six related frontend/history suites: 72 tests passed.
- Full suite: 1,919 tests across 101 files passed; contract tests, TypeScript checking and build passed.
- Independent review found no blocking issue; it requested actual browser wiring checks before deployment.
- Live API confirms the same historical keyword returns 15 observations through October 22 and 38 through October 25. An authenticated screenshot request returned a valid PNG. API histories are ascending; latest-record diagnostics must sort by observedAt.

## Deployment boundary

UI-only candidate deployment is pending browser verification. Keep collector images/configuration, historical data and shared SEO library unchanged. The separately authorized Web three-hour to two-hour schedule adjustment requires the current complete 620-query run and capacity check first. Android remains suspended pending bounded verification and a resource proposal; the user did not authorize expansion.
