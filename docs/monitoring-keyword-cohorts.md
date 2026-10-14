# Monitoring-only keyword cohorts

An optional `monitoringKeywordSets` array in `monitor.json` replaces the daily selected keywords for one exact Place ID and merchant ID. It does not write to the shared SEO keyword API or MongoDB library. All other stores retain the existing daily fresh-source, P0–P3 priority and source-order selection.

Each set has a versioned `id`, `placeId`, `merchantId`, and 1–40 `{ keyword, group }` items. Groups are `core`, `exploration`, and `brand`; these are monitoring labels, **not shared-library priorities**. The configured order is the capture order. Empty or duplicate queries, ambiguous sets and sets exceeding the global per-store cap are rejected instead of silently truncating brand queries at the end.

```json
{
  "monitoringKeywordSets": [{
    "id": "example-v1",
    "merchantId": "merchant-1",
    "placeId": "ChIJexample",
    "keywords": [
      { "keyword": "chinese deli flushing", "group": "core" },
      { "keyword": "Example Deli Flushing", "group": "brand" }
    ]
  }]
}
```

## Daily behavior and provenance

- Live MongoDB discovery still determines enrollment. A cohort cannot enroll an excluded, quarantined or removed store.
- The original keyword API is still read and identity-validated each day. A source failure is explicit and does not silently fall back to a stale cohort.
- A matching Place ID with a different merchant ID fails that store with `source_monitoring_cohort_identity_mismatch`; other stores may continue.
- The full original source record stays in `keyword-selection.json`. The selected cohort rows have `priority: null`, `sourceIndex: null`, `cohortIndex` and `monitoringGroup`; they do not pretend to occupy a position in the shared source.
- `selectionPolicy` identifies `monitoring_cohort/v1`. `monitoringCohort` contains the version ID, SHA-256 of the normalized identity-bound set, and group counts. Both the selection snapshot and daily store row carry this metadata. Selection hashes bind the original source hash, policy, exact queries and cohort metadata.
- Stores without an override retain the historical selection shape and hash calculation.
- The override is a fixed monitoring cohort: edits to the shared library do not automatically replace its selected queries. Those live edits remain visible in the original source snapshot. Updating the monitoring cohort requires a deliberate versioned config change.

## Analysis boundaries

Old snapshots and screenshots remain immutable. A new query begins its own time series on its first actual capture, not on the configuration date. Compare common, quality-eligible queries across a cohort change. Do not treat a change in the keyword mix as a ranking gain.

Report core, exploration and brand separately. Brand detail pages have no organic rank; use verified entity identity to evaluate brand presence. A competing merchant detail is not our brand success. Monitoring labels do not change the collector's result classification or invent brand-match metrics. The existing reporting UI must explicitly use the snapshot groups before claiming a segmented dashboard.

The browser remains `query_only`. A city in the keyword is intent, not verified customer-local geography. Chinese queries continue to use the existing en-US browser profile and should be interpreted separately from a localized Chinese-user experiment.

## Keke cohort (October 14, 2026)

`keke-acquisition-20261014-v1` selects 32 core candidates, 6 exploration/continuity terms and 2 brand terms. Six exact historical queries are retained, 34 are newly monitored. Five of those 34 already exist below the old top-40 cut; 29 are new monitoring-only candidates. The 91-entry shared library is unchanged.

Candidates are grounded in the October 13 stored GBP menu/profile and the current merchant website https://www.mrkeke.com/ (read October 14). They include English and Chinese category, product and takeout/delivery intent. Demand volume and actual GBP search-term performance have not been established. The 32/6/2 allocation is a monitoring budget, not an SEO priority standard or proof that these are the 40 most searched queries.

Two existing Flushing High School queries are retained as continuity observations, not because a favorable rank proves demand. Generic city-only queries and redundant landmark permutations leave this daily cohort but remain in the shared library and historical archive.

Inputs and the exact retain/add/retire diff are under `evidence/2026-10-14/keke-monitoring-cohort/`. Deployment evidence must separately establish actual runtime activation; committing a config does not activate it.

## Activation and rollback

Deploy code that accepts the optional field before referencing the cohort config. Prefer a new immutable ConfigMap and one guarded CronJob template patch that changes the image, IMAGE_DIGEST and config reference together. Keep the previous ConfigMap and image for rollback; preserve the enabled schedule, current source discovery, exclusions, resource requests and capture profile. Already-created Jobs keep their original template and evidence.

Verify the parsed live configuration and effective selection using the deployed image, then independently read back the CronJob and a fresh GET of the shared keyword API. A selection-only acceptance is not a complete browser/Azure capture. Record that distinction and the next eligible scheduled run date. To roll back, restore the previous image/digest/config reference together; do not delete claims or historical data.
