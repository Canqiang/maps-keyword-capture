# Keyword fixed-point metric trends — UAT release

## Delivered

The keyword detail view now provides selectable SoLV, ARP and ATRP time series,
per-round denominators, actual time intervals and exact observation/screenshot
links. Current fixed-point sampling is explicitly labeled; it is not geo-grid
coverage. Web/Android, locations, collection profiles and unsupported history
are not merged into claims of improvement. See `docs/keyword-metric-trends.md`.

## Validation

- Typecheck and production TypeScript build passed.
- Full suite: 104 files / 1,945 tests passed; 14 focused metric/view tests.
- Independent review: three findings corrected and all 14 focused tests rerun;
  no remaining blocking finding.
- Browser QA against 1,860 existing verified observations: three metric selectors,
  old-round selection, genuine zero versus unavailable values, exact evidence
  navigation and loaded PNG checked. No browser console errors observed.
- Local historical OnlyBear example at October 26 02:15 New York: ranks 1/5/10
  yield sample SoLV 33.3%, ARP 5.33, ATRP 5.33. This is historical QA, not the latest
  production result and not evidence of SEO improvement over a different profile.

## Deployment and independent readback

Azure ACR cloud build `ch15k4` succeeded. The immutable image is:

`fbrdevacr.azurecr.io/ai/maps-keyword-capture@sha256:0caf5832b4526382d4002d987230aea16e0009affc7a6261e732fa4999d0dd9e`

This was an explicit working-tree source snapshot based on `376259b`, identified
by context SHA-256 `1cfdc2606557933bcc23ba746787c96978decd28910a102b53b733ce37098a65`.
It is not described as a clean committed revision. Per-file hashes and the frozen
build context are retained in the local evidence directory.

Only `uat/maps-tracking-ui` container `ui.image` was patched, guarded by the old
Deployment UID and image. RollingUpdate kept the old replica available until the
new replica was ready. Independent readback at 2026-10-27 10:06 Beijing confirmed:

- New Pod ready, expected actual imageID, zero restarts.
- Deployment spec identical except for the image.
- Authenticated HTTPS HTML exactly matches the tested compiled `UI_HTML`:
  SHA-256 `67afae61722d84afb09b1591e2bdd7838ee9f897b1d18d9f95a447cc99a7557d`.
- Existing authenticated OnlyBear history API returns 57 observations, 19 at each
  of three fixed points, without pagination in this selected two-day range.
- These form 19 authoritative parent rounds. Latest observed round began
  2026-10-27 00:15Z (October 26 20:15 New York): center rank 3; two other points
  absent from 15 verified organic rows. Manual arithmetic agrees with sample
  SoLV 33.3%, ARP 3 (one appearing point), ATRP unavailable. No invented rank 21.
- All seven monitored Maps CronJob spec hashes unchanged. No collector deployment,
  schedule, keyword, location, database or historical evidence write was made.
  Android activation and resource changes are outside this release.

The existing per-process login signing key changes on UI restart; users may need
to sign in again. Existing auth configuration and credentials were not changed.

## Evidence and limits

Local evidence directory:
`/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/keyword-metric-trends-2026-10-27`

Includes frozen build source, test log, QA JSON, pre/post Deployment and CronJob
checks, ACR identity, actual served HTML, authenticated history readback and
browser screenshot. Authentication values were used only in memory, not stored.
No GitHub push was performed. Existing geography and organic-depth limitations
remain; this is a UI/derivation release, not a new collection-accuracy acceptance.
