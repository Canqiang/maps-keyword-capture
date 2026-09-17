# Decisions and Deviations, 2026-09-17

Status: approved in discussion. This document records decisions made on 2026-09-17 that refine or override [the detailed design](../../design.md). Where the two disagree, this document wins; the detailed design has been updated to match, and this file remains as the rationale.

## Context established today

- The first version must run as a Kubernetes Job on the FBRDev AKS cluster (subscription `fbr-dev`, region eastus2), namespace `dev-ai`, from the start. Local-only operation is a development mode, not the deliverable.
- The Pod egress IP was reported as geolocating to Boydton, Virginia (Microsoft AS8075). Retain this as query context; it does not require overriding the map view when the keyword itself names an area.
- The `dev-ai` namespace already runs Playwright-style batch Jobs (`menu-scraper-*`) with `nodeSelector: envpool=aiapp`, ACR images under `fbrdevacr.azurecr.io/ai/`, `imagePullSecrets: docker-registry-secret`, and config via ConfigMap plus Secret.
- Storage account `fbrdevstorage` has an `seo` container that already holds client SEO reports. Secret `azure-storage-account-f6eab793693c54a6891af3c-secret` in `dev-ai` carries the account name and key.
- A throwaway probe on a laptop (headless Chrome, 1440x1000, `hl=en`, map centered on Garden City at zoom 13) measured: results panel 408px wide with 875px visible; cards 154 to 270px tall, most 210px; about 5 cards per screen; 8 to 11 cards mounted initially, 20 after two scrolls; feed children alternate card and separator, so card DOM indices step by 2 and stay stable while scrolling. No Sponsored cards appeared in that pass.
- The same probe repeated with Playwright Chromium 153.0.8010.12 and `channel: "chromium"` gave the same panel geometry, card heights (120 to 230px), cards per screen, and DOM structure for the same three keywords. In that pass `bubble tea garden city` showed a Sponsored card (Gong Cha) in first position and the same business again as an organic card at position 11; the label was legible in the screenshot. Feed children 0 and 1 are header nodes, cards start at child 2 on even indices, and trailer nodes follow the last card. The stride held with the ad present. Ad markup is verified for exactly one layout sample; group-level ad markers and other layouts remain unverified.

## Decisions

| Topic | Decision | Reason |
|---|---|---|
| Language | TypeScript on Node 22 with Playwright 1.63.0. | Chosen on project fit, not cluster consistency: the extraction logic runs in-page, so one language for page script and host code; the ad/organic/unknown contract is a discriminated union the compiler enforces. |
| Browser | Chromium bundled in `mcr.microsoft.com/playwright:v1.63.0-noble`, launched with `channel: "chromium"` (new headless mode, not the default headless shell). Google Chrome is not installed. | Removes the separate Chrome install and version validation from the image. The probe was repeated under this launch configuration with matching geometry and DOM structure for three keywords, and one legible Sponsored card; equivalence beyond those samples is still verified in the cluster acceptance run. `chromiumSandbox` is verified in the cluster per the detailed design; never silently disabled. |
| Extraction | Read the results feed DOM; screenshots are evidence. No internal API interception, no vision models. | Display order and ad labels must be what the page shows. |
| Scope per keyword | 15 displayed listings including ads (was 20). | Product decision. |
| Scroll and screenshot budget | 6 scrolls, 5 results screenshots (was 30 and 20). | Measured: 15 listings need about 3 scrolls and 4 screenshots. |
| Scroll step | Scroll so the top of the last partially visible card becomes the top of the panel. With no partial card, keep the last full card as overlap. A card taller than the pane gets consecutive screenshots. Every scroll must advance or it counts toward the stall limit. If the 15th listing is cut off when the limit is reached, take one more screenshot; it counts toward the 5-screenshot budget, and an exhausted budget yields `partial / screenshot_limit`. | Every card appears complete in at least one screenshot, with defined behavior at the edges. |
| Search location | Query-only search is the first-version default. Submit the original keyword without coordinates, map panning, "Search this area", or simulated geolocation. `mapView` is optional and reserved for a later mode, not enabled now. | Follow-up decision supersedes the earlier required-map-view choice. Region-bearing keywords already state an area; IP/location effects remain recorded context. Do not silently append a city or equate an omitted map view with location-independent ranking. |
| Overlap reconciliation | Feed DOM index is the primary occurrence key, combined with place identifier and ad flag. Every round re-verifies the whole committed `index -> occurrence` mapping, not just the new suffix: a replacement at a committed index, a disappearance, or an ad-type change invalidates the prefix from that index and forces one re-read, then `sequence_ambiguous`. Bounding-box tops must increase with index; a violation, a reorder, or an index gap also ends with `sequence_ambiguous`. The constant index stride applies only to fixture-verified layouts. | Measured stable append-only DOM. Simpler than pure visual alignment and still fails closed, including against same-index replacement. |
| Storage | Account `fbrdevstorage`, container `seo`, prefix `maps-keyword-capture/<YYYY-MM-DD>/<runId>/<attemptId>/`. Auth via the existing account-key Secret. | Reuses infrastructure the team already operates. The account key grants whole-account access; scoping to the prefix via workload identity is a later hardening step and is noted as accepted risk. |
| Artifact index | Folded into `manifest.json` (per-query object keys, sizes, checksums, verification times). No separate `artifact-index.json`. | Same information; one fewer file to verify. The manifest readback rule from the detailed design still applies. |
| Cluster settings | Namespace `dev-ai`; `nodeSelector: envpool=aiapp`; `imagePullSecrets: docker-registry-secret`; image `fbrdevacr.azurecr.io/ai/maps-keyword-capture:<git-sha>` referenced by digest. | Matches existing `dev-ai` Jobs. |

## Adopted unchanged from the detailed design

Attempt isolation (`attemptId`, `queryAttemptId`), `observations.jsonl` per query, the pre/post screenshot signature check, the CAPTCHA circuit breaker with `skipped`, one bounded transient retry per keyword, the wider snake_case CSV columns, `not_requested` for local-only persistence, exit codes 0/2/1/64, the batch deadline formula, the extended stop reasons, and the module boundaries.

## Milestone 0 status

The laptop probe covered card geometry, scrolling behavior, DOM stability, feed child structure, and screenshot legibility for `bubble tea garden city`, `fried chicken mineola`, and `matcha mineola`, in both headless Chrome and Playwright Chromium. One live Sponsored card was captured with its label placement. Still missing: a no-results page, a consent page, a CAPTCHA page, and any second ad layout. Those are collected during the cluster acceptance run; the ad classifier stays a formal acceptance item and unrecognized cards fail closed to `unknown`.

## Follow-up location decision

The user confirmed query-only search after reviewing the required-map-view choice. Remove the example coordinates and make the preliminary `mapView` field optional. Until explicit area-search support exists, a supplied map view must be rejected with a clear configuration error. Record `locationMode: "query_only"`, `configuredMapView: null`, the final URL, and observed map/location context separately. Re-run the earlier centered-map probe under this profile on the target Pod; existing measurements do not establish query-only behavior.

## Out of scope for the first version

Scheduling, an administration UI, client-specific filtering, report generation, period-over-period comparison, CAPTCHA solving, workload identity, and general web search.
