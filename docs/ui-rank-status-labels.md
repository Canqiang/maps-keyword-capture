# Rank absence labels and geographic qualification

The UI uses **未见** for an eligible observation without a target organic rank.
It means the target's organic result was absent **within that observation's
verified capture scope**, not that the business is absent everywhere or has
rank 16 or 21. The configured collector scope is the first 15 displayed items
(including ads), or a verified end of the result list. The underlying eligibility
and metric rules remain in `src/domain/model.ts`; this change does not alter them.

## Presentation contract

- Qualified absence: `未见` in both compact cells and expanded detail.
- Incomplete/unqualified absence: `未见*`, with a visible evidence-insufficient
  note. It remains excluded from qualified rank changes.
- Qualified ad-only observations: `未见` for organic presence, with a separate
  `仅见本店广告` annotation. Ad positions and natural ranks stay separate.
- No observation: `无记录` / `—`, with no invented absence or geographic finding.
- Failed, blocked, non-ranking, unresolved identity and unreliable observations
  retain their existing separate states.

Geography is independent of rank eligibility. `unverified`, missing/null, or
unrecognized geographic status produces a visible **地域未核实** annotation,
including for numerical ranks. `outside` is **地域不符**, `mixed` is **地域混合**.
A `matched` result-region assessment suppresses the uncertainty annotation; it
does not assert verified Google backend locality. GPS/device acknowledgements
alone never suppress the geographic warning.

The overview, date cells, evidence cards, selected metric-round records and rank
summaries use the shared presentation model. Tooltips preserve capture-scope
notes. The grid summary does not expose per-cell geographic assessments, so it
explicitly directs users to exact observation evidence and never assumes locality.
The historical comparison selector includes the geographic status and fits mobile
widths. Existing screenshots, query identities and comparison links are preserved.

## Change boundary

Only frontend rendering and its tests change. No collector, ingest, rank
eligibility, metrics arithmetic, database records, keyword lists, schedules,
resource limits or Android activation changes are included. A UI release updates
only the `uat/maps-tracking-ui` Deployment image. Read back the Deployment and
served HTML, and compare all Maps CronJob spec hashes before and after release.

## Validation

Regression cases exercise qualified absence, both incomplete absence states,
ad-only, no record, missing/unknown/matched/outside/mixed geography, GPS-only
receipts, numerical ranks, and latest-observation selection without resurrecting
an older verified result. Served-script tests render actual evidence cards and
overview cells. Browser QA uses archived, real OnlyBear API observations for
desktop overview/date/evidence and a 390-pixel mobile evidence layout; it does not
trigger collection or independently revalidate those historical rankings.

Release evidence is retained under the task's `ui-absence-labels-2026-10-27`
directory. See its test logs, browser QA, source hashes, and UAT readback report.
