# Keyword metrics over fixed-point history

The keyword detail UI offers SoLV, ARP and ATRP trend selectors. This is a
**fixed-point sample**, not a full geo-grid or an estimate of area-wide visibility.
Web and Android are separate. Existing point rank charts, evidence links and
historical observations remain unchanged; no collection configuration is modified.

## Metric contract

The terminology follows the [Local Falcon definitions](https://www.localfalcon.com/answers/?c=22)
and [ARP/ATRP guide](https://www.localfalcon.com/knowledge-base/kb25-how-to-use-arp-atrp).
The following is our explicit sample-based implementation, not an assertion that
our sampling or Google search environment replicates Local Falcon.

| Metric | Calculation | Unavailable observations |
| --- | --- | --- |
| SoLV | Top-3 natural-rank points / points with sufficient evidence to decide Top-3 presence | Excluded, denominator shown. Confirmed absence needs 3 organic results or an exhausted list. |
| ARP | Mean natural rank among observed ranks 1–20 | Excluded, appearing-point denominator shown. This can improve when weak points disappear. |
| ATRP | Mean across every point in the current keyword scope; confirmed absence beyond 20 is assigned 21 | Withheld unless every scoped point is assessable. A top-15 absence is insufficient. 21 is a calculation penalty, not an observed rank. |

Ads do not contribute natural ranks or organic coverage. Valid numeric natural
ranks require the existing identity, sequence, classification, screenshot and
ranking quality checks and a comparable observation cohort. Outside/mixed
geography is excluded. Unverified geography is explicitly not proof of local
search-backend location. A detail page, failure or blocked response is not absence.

## Round identity and comparability

- `RankObservation.scanId` currently contains the **batch run ID** in Web ingestion.
  It must not be used to combine the center, 3km and 5km points.
- The existing writer manifest namespace `tracking/<surface>/<date>/point/<scanId>/`
  identifies the parent scan. Parsing binds the surface and contained batch ID.
  Missing parent provenance leaves numeric metrics unavailable; timestamps are
  never used to invent shared round identity. Different worker parent scans are
  not merged without authoritative common-round provenance.
- Group by surface, store, place identity, keyword and parent scan. Keep the newest
  attempt per point, including a failed `query_only` projection from ingestion.
  Never resurrect an older success after a failed latest attempt.
- Scope is the current store fixed points, restricted by the keyword's `scanPoints`
  (including its best variant). This is not reconstruction of historical planned
  coverage. Legacy unlocated rows and full grid runs are not mixed into this view.
- Full history loading is required. Missing fixed-point pagination disables metrics.
- Lines break at unavailable metrics, point/cohort/qualified-denominator changes,
  or a gap exceeding three hours. No interpolation. Entirely absent runs cannot
  be recovered from observations alone. Different profiles stay separate and the
  UI warns against interpreting a collection-method change as SEO improvement.

## Presentation and acceptance

Cards show the latest recorded round, even if unavailable. Selecting a card
switches the chart; selecting a dot or round shows its actual time interval,
denominators and exact observation links. Date labels use the UI timezone.

Implementation: `src/web/keyword-metrics.ts`, `keyword-metrics-view.ts`, integration
in `ui.ts`. All work is client-side over the existing authenticated history API.
Tests cover organic-depth censoring, ads, missing and failed points, parent/batch
identity, mixed profiles, channel/scope separation, partial pagination and UI
selection. A local read-only acceptance snapshot uses 1,860 existing observations
from three verified October 26 Web rounds; raw observations are not rewritten.

Example: OnlyBear `bubble tea near me`, 2026-10-26 02:15–02:35 New York,
natural ranks 1/5/10 => sample SoLV 33.3%, ARP 5.33, ATRP 5.33. The preceding
URL-only profile is a separate baseline, not evidence of SEO improvement.
