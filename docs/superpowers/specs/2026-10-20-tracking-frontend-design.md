# Maps tracking frontend design

Date: 2026-10-20  
Implementation baseline: `83f3609`  
Status: design proposal for review; not a deployed feature.

## Intent and existing decisions

The primary audience is the internal SEO team. Their recurring task is to see which merchant keywords changed, determine whether the comparison is valid, and inspect the corresponding Google Maps evidence. The user explicitly wants both Web and Android observations, all merchants, keyword history and original screenshots. Store-owner reporting is a separate presentation layer; this workspace must support investigation rather than imply business impact.

Keep the existing TypeScript/Node service and its API. The proposed implementation remains HTML, CSS and browser JavaScript; a frontend framework or dependency migration is unnecessary for this scope. Use the existing separate worktree. Do not deploy, alter active collectors, change keywords or migrate stored observations as part of design work.

The layout choices below are designer recommendations, not additional user requirements. The companion visual preview uses clearly labeled illustrative data and screenshot placeholders; it makes no calls to production services.

## The primary journey

```text
All stores
  → choose one surface and a merchant
    → keyword × observation date matrix
      → select a keyword for its comparable trend
        → select an observation for its ranking list and original screenshots
          → optionally compare two compatible observations side by side
```

Location-grid analysis is a secondary tab inside a store. Settings are a separate route. Routine analysis must not require navigating through forms or execution logs.

## Information architecture and layout

Desktop uses a compact left rail, a small context header and a wide content area. The rail contains All stores and the current store's Keywords, Location grid and Settings destinations. Evidence opens from an observation; it is not an unrelated gallery.

Context always identifies the merchant, surface, observation point and displayed timezone. Shareable URL state retains those selections plus keyword, date range, filters and selected observation. Switching surface does not reuse the previous surface's results while loading.

### 1. All stores

The table is the main component. Show:

| Column | Meaning |
|---|---|
| Merchant | Human-readable name; secondary store ID when useful |
| Tracking configuration | Enabled / paused; this is not evidence of a running job |
| Configured keywords | Current core + long-tail keyword count |
| Keywords with records | Latest retained observations in the selected surface, reconciled against the configured keyword set |
| Qualified ranked keywords | Current retained records with an eligible natural rank |
| Top 3 | Qualified natural ranks 1–3 |
| Needs review | Latest retained records that are unavailable for ranking analysis |
| Latest observation | Actual observation timestamp; not “last successful run” |

The surface control is a segmented Web / Android selector. Do not sum, average or join the two surfaces. Search by merchant name or ID; filter configured enabled/paused state separately from data availability.

No prominent average-ranking KPI: the current mean excludes absent/unusable keywords and can improve when weak keywords disappear. If included in an expanded explanation, label it “Average rank among qualified ranked keywords” with its denominator.

Until a bounded-period summary API exists, label this view “Latest retained observations,” not “Today’s results.” A merchant's newest timestamp does not establish freshness for every keyword.

Do not add a green “system healthy” badge. The current API has no scheduler/job health contract. Empty Android data says “No Android observations available”; it must not promise that a nightly job will fill them.

### 2. Store keyword workspace

```text
Merchant name                              [Web] [Android]
Observation point • timezone • location evidence

[Keywords] [Location grid]                 [Store settings]
[14 days / 30 days / custom] [Search] [Tier] [Status]

Keyword                      Latest   Change     10/12  10/13  10/14 ...
spicy duck neck flushing        4      ↑ 5           9      8      7
chinese braised food flushing   9      unchanged      9      —      9
...

Selected keyword
Comparable natural-rank trend     [Open selected observation]
Observation dates and evidence entries below the chart
```

Freeze the keyword column and column headers; allow horizontal scrolling within the table, not the whole page. Row selection updates the trend. Selecting a date cell opens that exact observation. The default ordering is keyword name; optional sorts include latest rank and comparable change.

Initially show the current configured keywords plus an opt-in “Historical keywords” section. Newly added words have “No observation” before their first capture. Removed words remain accessible as history. Do not imply the roster was constant throughout the range.

Daily matrix policy:

- Calendar dates use the configured tracking timezone, displayed explicitly.
- Group by merchant, normalized keyword, surface and point identity.
- Use the latest attempted observation for the date, including failures; never choose the best rank or the last successful rank to hide a later failure.
- Mark days with multiple observations and allow expansion to exact times/IDs.
- Preserve manual/scheduled origin only when supplied by the source; otherwise label it unknown. Do not infer it from a timestamp.
- A blank day means no observation in the returned coverage, not a failed run.
- If an API result is truncated or a range was not fully loaded, show that distinction; do not label unloaded dates “not collected.”

“Change” is between two explicitly shown endpoints in the same comparison cohort: merchant identity, surface, actual coordinates, location mode, Web zoom, adapter and profile; Android also requires matched device-location evidence. It is “Not comparable” across a change of conditions. If either endpoint is failed, non-ranking, truncated or identity-uncertain, show no numeric delta. Do not silently skip the failed endpoint.

The graph places rank 1 at the top. Numeric ranks are connected only across adjacent available comparable observations. Draw no line across unavailable records or intervening dates with no collection; do not interpolate or forward-fill. Confirmed absence is a labeled state, not rank 21. Provide a tabular alternative and keyboard-accessible observation links.

### 3. Observation evidence and comparison

Selecting an observation opens a wide drawer on desktop and a full-screen detail view on small screens. Preserve the list and scroll position when closing.

The header answers: which keyword, merchant, surface, location and exact capture time? Show a natural rank and an ad-inclusive first display position separately. Label any target advertisement positions independently.

The main pane displays the original unedited PNG sequence. Preserve aspect ratios, support zoom and a “Open original” link, and expose all screenshots rather than silently limiting the count. A highlight may be an optional overlay; it never changes the original evidence. If storage is unconfigured or retrieval fails, show that state instead of a broken image.

The adjacent listing table contains:

| Column | Rule |
|---|---|
| Display position | Original observed order, including ads |
| Natural rank | Trusted natural rank only; no number for an ad or unreliable classification |
| Listing type | Organic / ad / unknown, always textual |
| Merchant | Retain separate ad and organic appearances of the same business |
| Rating | Observed value; missing is “Unavailable,” never zero |
| Review count | Observed value at that capture; missing is not zero |

The existing `topListings` contains at most the first 10 displayed appearances. Label it “First 10 retained appearances,” not “All competitors.” Loading the entire captured list requires a separate scoped artifact endpoint.

An expandable “Capture conditions and evidence” section holds quality flags, location checks, warnings, profile/adapter identifiers and source references. Use plain-language explanations first. Do not show a SAS URL, credentials or raw server file paths.

Two-date comparison accepts exact observation IDs. Display both timestamps, screenshot sequences, quality and the cohort compatibility result. If incompatible, still allow visual inspection but suppress improvement claims/delta. If an observation lacks historical screenshot references, show “Historical evidence unavailable”; do not substitute the latest screenshot.

### 4. Location grid

Keep this inside the selected merchant and surface. Controls select keyword and a recorded date/run. Show observation-point distance, captured radius and grid geometry source; mark the center.

The grid distinguishes a qualified numeric rank, a qualified absence, and an unavailable/missing point using text and color. Show:

- Top-three qualified points / all qualified points, with the fraction visible.
- Qualified points / planned points, so missing coverage remains apparent.
- ARP as an optional advanced metric, labeled as an average only among appearing points.
- ATRP only in expanded technical details, explaining that 21 is a calculation penalty for qualified absence, never an observed rank.

Only compare compatible captured runs and coordinates. No qualified points means unavailable metrics. A partially failed run retains its valid peers; it does not fall back to an older successful run. Clicking a cell must resolve the exact selected-date/run observation; it may not query the current latest point and present it as historical evidence.

Do not describe sampled points as continuous geographic coverage or as every customer's rank. Web map view and Android GPS evidence are different, and “unverified geography” remains visible.

### 5. Store settings

Keep settings outside the normal evidence workflow. Separate identity, capture configuration and monitored keywords. Use the existing independent tracking keyword collection; explicitly state that edits do not change the shared website/GBP SEO library.

Identity and coordinates retain the existing immutable/migration rules. Preserve `expectedArea` on ordinary edits. Avoid promises such as “every two hours” unless backed by an actual scheduling contract. Enabled config alone does not establish Android scheduling.

A future implementation validates edits, shows changed fields before save and reloads saved values. No edit or save control in the visual preview writes data.

## Visual system

| Token | Value / use |
|---|---|
| Canvas | `#F6F5FA`, quiet neutral-lavender workspace |
| Surface | `#FFFFFF`, tables and evidence |
| Ink | `#242034`, main content |
| Accent | `#6D3BD1`, active selection and controls |
| Success | `#20744A`, qualified top ranks and upward changes |
| Attention | `#946100`, non-ranking/uncertain states |
| Error | `#B53C4B`, failed capture, never an unexplained ranking penalty |

Reuse the locally archived official Connexup logo. Prefer PingFang SC / Microsoft YaHei / system sans-serif with tabular numerals. Body 14–15px, table 13–14px, page title 24–28px. Text is left aligned, numeric columns consistently aligned. Avoid oversized KPI cards and decorative charts; the recognizable element is the date matrix tied directly to evidence.

Use compact 6–10px radii, little or no shadow, modest dividers, visible selection. Color is never the sole status signal. Visible keyboard focus, semantic tables, labeled controls, contrast checks and reduced-motion support are acceptance requirements.

Below 900px collapse the rail. Below 600px retain the scrollable matrix with one frozen keyword column; do not hide the date/rank relationship. Evidence comparison stacks vertically while retaining both timestamps and conditions. The Android capture surface is independent of the screen size used to view this frontend.

## Exact state language

| State | Visible wording | Numeric delta? |
|---|---|---|
| Qualified organic rank | “Natural rank 4” | Only against a qualified comparable endpoint |
| Confirmed organic absence with sufficient coverage | “Not in organic top 20” | No fabricated rank 21 |
| Target appears only as an ad | “Ad only”; add qualified organic absence only if independently proven | No |
| Partial prefix without target | “Not seen in captured portion” | No |
| Merchant/geographic detail page | “Not a ranking list” | No |
| Identity unresolved | “Merchant match uncertain” | No |
| Ordering/classification/evidence incomplete | “Insufficient ranking evidence” | No |
| CAPTCHA/consent/block | “Collection blocked” | No |
| Failed attempt | “Collection failed” | No |
| No record in complete returned coverage | “No observation” | No |
| Range not fully returned | “Not loaded” / “History truncated” | No |

Chinese equivalents are used in the UI. Human-facing language must not turn execution completion into ranked-capture success, or ranking changes into causal SEO/business improvements.

## API fit and necessary additions

Existing read paths:

- `GET /api/settings`: timezone and defaults; not execution status.
- `GET /api/stores?surface=web|android`: catalog and channel-specific summaries.
- `GET /api/stores/:id`: store settings.
- `GET /api/stores/:id/latest?surface=...&point=...`: latest keyword snapshots and their screenshot references.
- `GET /api/stores/:id/trend?surface=...&point=...&keyword=...&days=...`: bounded comparable trend, currently without observation IDs or historical screenshot keys.
- `GET /api/stores/:id/grid?surface=...&keyword=...&date=...`: grid and aggregate metrics, currently without per-cell observation/evidence identity.
- `GET /api/evidence?key=...`: scoped private PNG proxy, unavailable when not configured; not a general local file/JSON reader.

Required additions before implementing the proposed full interaction:

1. **Date-bounded timeline endpoint.** Proposed `GET /api/stores/:id/timeline` takes surface, point, keyword filter, from/to dates and cursor. Returns explicit range/timezone, coverage/truncation, exact observation IDs, source timestamps, status, rank eligibility and cohort identity/compatibility. Preserve failures and incompatible profile segments; do not silently filter them into apparent missing days. Pagination is stable, bounded and cursor-based. Default to a 14-day page, maximum 90-day request and 2,000 records per page. A day remains partially loaded until all its pages are fetched.
2. **Exact observation endpoint.** Proposed `GET /api/stores/:id/observations/:observationId` returns the safe analysis fields, target occurrences, retained listings, quality, exact evidence references and source IDs. Validate store ownership. Decode versioned IDs safely. Do not expose secrets or local filesystem paths.
3. **Grid selection and identity extension.** Add `GET /api/stores/:id/grid-runs?surface=...&keyword=...&date=...` to discover recorded runs and accept optional `gridRunId` on the existing grid endpoint. Default to the newest attempted run; older runs require explicit selection. Validate run ownership, keyword, surface and date. Return selected grid run identity, capture times, per-cell observation ID/status/eligibility, geometry provenance and coverage. An unavailable cell still identifies its attempted record when one exists. Legacy records without a verified common run ID cannot be combined into an invented selectable run.
4. **Roster-aware latest summary.** Extend `/api/stores` with an optional, separately named `rosterLatest` summary while preserving the existing `summary` unchanged. Join normalized current configured keywords to their latest observations for the requested surface and center point. Return configured, withRecord, qualifiedRanked, top3, qualifiedAbsent, unavailable, noRecord and historicalOnly counts, plus oldest/newest retained observation times. Counts must form explicit disjoint groups where applicable: configured = qualifiedRanked + qualifiedAbsent + unavailable + noRecord. “With record” overlaps those outcome groups and is not an extra outcome. Withdrawn keywords do not inflate current-roster totals; expose them separately. Use this extension for the proposed portfolio columns, or omit those columns until it exists. The existing `summary.keywords` is not a replacement for withRecord.
5. **Period portfolio summary.** If a date filter is enabled in the portfolio, add a separate bounded-period summary using the same current-roster membership and explicit denominators for records/qualified ranks/unavailable/missing. Describe the roster as current, not historically fixed; historical roster comparisons require saved roster snapshots. Do not relabel the existing heterogeneous latest summary as this endpoint.

These are proposals, not endpoints already implemented. Keep existing API fields backward compatible. Initially fetch the all-store list once; lazy-load one merchant's timeline and the selected evidence only. Cancel stale route/selection requests and retain loading/error states. Do not solve the matrix with hundreds of parallel per-keyword requests.

Competitor share of voice, review growth, run health, full captured listing replay and automated Android scheduling are not part of this presentation change. They need their own contracts and validation; a static snapshot or a configured flag cannot stand in for them.

## Design review

An independent builder review identified two contract omissions: current-roster summary counts and explicit historical grid-run selection. Both were resolved above as additive API changes. The review did not identify a user-owned decision that requires interrupting the design work. The visual preview remains illustrative; its completed interactions are not evidence that the proposed APIs exist.

## Delivery stages and acceptance

1. Review this design and the labeled visual preview.
2. Implement layout and existing-API views, preserving current functionality.
3. Implement the bounded history and exact-evidence additions with regression coverage; then enable matrix-cell and before/after screenshot interactions.
4. Verify with fixture-backed local APIs and browser checks at desktop and mobile widths. Keep the live collectors untouched.
5. Any deployment is a separate step; this design does not authorize a production migration or a schedule change.

Acceptance cases include: surface switch isolation; keyboard cell navigation; exact historical screenshot resolution; failed/missing day as a gap; ads plus organic occurrences of one target; unknown classification; unavailable review count; no Android data; paused configuration with existing history; partial grid; all-failed latest grid; profile/location changes; pagination/truncation; stale-response prevention; safe screenshot errors; and settings preservation.
