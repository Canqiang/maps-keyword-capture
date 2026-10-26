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

Deployed UI-only at 10:04 Beijing / October 25 22:04 New York. Source `61cce6e318d8e45d153a79de7cdcb8e1837f31fd`, ACR run `ch15bk`, digest `sha256:dd6e77e1f9419d53c5d11c6e42d36ca90063a47c378e19aa63fb197e3d27bce4`. The actual running imageID, source commit and delivered HTML were independently read back; UI ready, zero restarts, health endpoint OK. Browser checks covered both rendered views, 30/90-day shortcuts, latest navigation, manual history reload and read-only archive behavior, with zero page errors. The live API subsequently returned 39 observations through October 25 versus 15 through October 22, including a new current-round capture. See `initial-release.json` and `browser-qa.json`. No collection Job was interrupted; protected CronJob/active Job specs were identical before and after. Keep collector images/configuration, historical data and shared SEO library unchanged. The separately authorized Web three-hour to two-hour schedule adjustment requires the current complete 620-query run and capacity check first. Android remains suspended pending bounded verification and a resource proposal; the user did not authorize expansion.


### Same-range refresh refinement

The initial release was followed by source `c8191fb44fec5c1f2e0421089d6ad0587bc4e774`, ACR `ch15bn`, digest `sha256:309e96931dd7fd667d518da2d4e029574a5f9d493eb0e07e9a294d5a816d3aa4`. Clicking Latest again on an already-current URL now reloads observations instead of relying on a hashchange that would not fire. The new regression first failed; five date tests and six focused suites / 73 tests pass, as do typecheck/build and independent review. The previous full 1,919-test run applies to the initial revision, not an unexecuted 1,920-test final-suite claim.

Seven browser checks passed with zero page errors; this second QA used a local read-only proxy to the real UAT API narrowed to one keyword for bounded transfer, plus a local archive-mode override. The initial six browser checks covered the full real-data overview and date view. Temporary QA proxy/Playwright cleanup issues were corrected independently; they were not collector outages. The final actual Pod imageID/source, HTTP HTML, timeline and original PNG were read back. `release.json` is the final image readback; `initial-release.json` preserves the previous deployment evidence.

A separate geographic finding from the collection audit is documented in [the rollout evidence](../two-hour-rollout/geographic-finding.md). This date fix does not alter capture location or validate nearby-search relevance.

### Subsequent collection validation

The 620-query Web round was subsequently verified, and the schedule-only two-hour change was applied at10:54:45 Beijing. The isolated Android probe ended18complete/9needs_review; it remains suspended. See the [final rollout ledger](../two-hour-rollout/README.md) for exact checks, limitations and the bounded future-trigger follow-up.
