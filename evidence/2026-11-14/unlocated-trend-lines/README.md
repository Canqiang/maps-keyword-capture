# Unlocated trend lines — 2026-11-14

## Outcome

Deployed UI-only at 16:49 Beijing. The unlocated magenta observations now connect as a dashed trend in overview sparklines and expanded charts. Located lines keep their original behavior. Same-profile continuity is a display aid, not proof of Google backend locality; `cohortKey` remains null and no geographic rank-change metric is enabled.

Cause: the old shared line builder required a non-null geographic cohort. Query-only history deliberately lacks one, so increasing collection frequency still yielded dots.

## Validation

- 38 new tests, 78 focused tests passed; final full run: 2,061 tests across 116 files passed. Typecheck/build and independent review passed. The first full run had one unchanged Android deadline timeout; isolated 229-test Android rerun and the subsequent full suite passed. Logs retain both outcomes.
- Frozen working-tree snapshot `unlocated-ui-snapshot-08911598d884c19c` (not a Git commit), ACR build `ch16b7`, image `sha256:38bdfd4dc2a4eb3e9b64594b6c499d6914ca8cee1677cd964cff1b62c508dd1c`. Compared with the previous live UI snapshot, only `src/web/frontend-model.ts` and `src/web/ui.ts` changed in runtime source.
- New UI Pod ready, actual imageID matched, zero restarts. Deployment diff is image-only. All8CronJob specs/UIDs and11retained Job specs unchanged; no collection rerun, keyword/point change or Android activation.
- Independent public HTTPS page/API readback returned200 and contained the fix. All23existing records for `法拉盛 卤味外卖` matched byte-for-byte at the observation-object level; null cohorts retained.
- Live Pod browser view showed2magenta dashed paths (7historic +16recent ranks), preserving the November7–9gap, with `地域未核实` visible and no page errors. Direct local Chromium public navigation hit `ERR_CONNECTION_CLOSED`; visual validation used a read-only loopback port-forward to the live UI, then closed it. Public HTML/API were verified separately. A real-data local rendering also checked desktop/mobile widths; this does not claim a full mobile UX audit.

## Boundaries and handoff

Only eligible numeric natural ranks with complete matching store/place/keyword/surface/point/mode/profile/adapter provenance connect. Failed/absent/unqualified records, missing identity, method changes, invalid or duplicate times and gaps above36hours break the line. No history was filled in. Ads, geographic comparisons, SoLV/ARP/ATRP and existing collection behavior are unchanged.

`docs/unlocated-two-hour-monitoring.md` documents the distinction. Rollback affects only `maps-tracking-ui` image, to `sha256:897cb59a1121af0eaf2db867c353df1f1319f4c5eead7c3d9e6bccb6e8134ea6`. Do not roll back any CronJob to change chart rendering.

Detailed source hashes, test logs, registry readback, before/after specs, real history receipts and screenshots: `/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/unlocated-trend-lines-2026-11-14`.
