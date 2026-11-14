# Weekly search-volume integration acceptance — 2026-11-12

The new independent search-volume task and UI join are deployed to UAT. Existing rank collectors, keywords, points, shared SEO source, and screenshot history were not modified.

- Active scope: 9 stores, 484 store/keyword records; 446 unique keyword/region/language identities.
- Final validated result: 299 store records with numeric estimates, 185 explicit upstream no-data records, zero failed records. Deduplicated counts: 261 numeric / 185 no-data.
- Final run `743381e3-506a-4dc5-8e5d-e002619ea403` completed 2026-11-12 11:40:27 Asia/Shanghai, original Pod exit 0, zero restarts. It reused 442 checked outcomes with their original call IDs/timestamps and completed the last 4 outstanding queries. The whole run family covers the 446 identities; timestamps are not falsely reset by recovery.
- Final pinned image: `sha256:897cb59a1121af0eaf2db867c353df1f1319f4c5eead7c3d9e6bccb6e8134ea6`. ACR build `ch168m`; frozen working-tree source `volume-snapshot-1063801ce86f233a` (not a Git commit; file hashes retained). The same image is deployed for the UI and weekly volume task, not for rank collectors.
- `maps-search-volume-weekly` is enabled at `30 10 * * 1`, `Asia/Shanghai`; next expected 2026-11-16 10:30 Beijing. Future scheduled execution has not yet been observed. Normal weekly calls remain batched; recovery flags are absent from the CronJob.
- Public UAT: https://maps.connexup-uat.net/ . All 9 authenticated store APIs matched all 484 database rows. Keke page visually checked for source, region, period, sync timestamp and unchanged ranking columns; zero browser exceptions.
- Validation: 2,020 tests in 114 files passed; typecheck/build/contract checks passed. Independent code reviews covered exact response coverage, legacy-cache exclusion, 90-minute request deadline, and explicit single-word recovery. All 7 pre-existing UAT CronJob specs/UIDs and the complete stored catalog were unchanged.

## Live integration findings and safeguards

1. Google Ads rejected `zh` with 40501. `zh_CN` was live-verified and is now used for Han-script queries.
2. The connected MCP returned only 10 items for larger requests, without an explicit truncation flag. Calls now contain at most 10 words; normalized requested/returned keys must match exactly. Missing items are failures, never no-data. Only an explicit returned item without a metric is no-data.
3. Earlier run IDs `a6030cd6-6710-490f-98c1-a9b17a613976` and `1ca3e9c5-37cc-4959-bf5f-0048a56e3f1e` were marked `validationStatus=rejected_coverage`. The earlier apparent complete readback is superseded, not accepted evidence. Historical audit documents were retained.
4. Later partial runs encountered MCP response failures. A diagnostic call returned `Client failed to initialize calling tool`; not every original failed response body was preserved, so do not attribute every failure to that same cause. Explicit bounded recovery completed the remaining queries; this does not claim the external MCP service can never fail.
5. `--retry-recent --single-recovery` only splits unresolved queries after verified recent reuse. It is manual, capped at 60 actual calls, and disabled in weekly configuration. New calls stop within 90 minutes, leaving persistence time before the 110-minute Pod deadline. Errors/no-data/zero remain distinct; prior successful values may be retained with an explicit failed/no-data refresh marker.

## Acceptance scope

Every frozen selected word was reconciled against original successful MCP items, including region, language, value, monthly series, source, call ID, keywordKey, data period and timestamps. Reused records were traced through original per-run history; root counts and exact expected catalog were checked independently. All current and history rows matched; all 9 store APIs matched. The UI screenshot is a visual sample, not the basis for full data acceptance.

Search volume is an upstream Google Search monthly estimate, not Maps searches or point-level customer demand. Null/no-data is not zero. `keyword`, `keyword near me`, and city variants retain separate metrics; no additive rewriting of base-term volume. Existing report snapshots remain available as historical references. See `docs/search-volume-sync.md` for operation, regions, rollback, credential rotation and recovery limits.

Full local receipts, raw readback, source hashes, screenshots and test logs:
`/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/search-volume-sync-2026-11-12`.
