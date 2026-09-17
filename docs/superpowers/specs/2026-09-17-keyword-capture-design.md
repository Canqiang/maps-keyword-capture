# Decisions and Deviations, 2026-09-17

Status: approved in discussion. This document records decisions made on 2026-09-17 that refine or override [the detailed design](../../design.md). Where the two disagree, this document wins; the detailed design has been updated to match, and this file remains as the rationale.

## Context established today

- The first version must run as a Kubernetes Job on the FBRDev AKS cluster (subscription `fbr-dev`, region eastus2), namespace `dev-ai`, from the start. Local-only operation is a development mode, not the deliverable.
- The Pod egress IP geolocates to Boydton, Virginia (Microsoft AS8075). Google will not infer Garden City or Mineola from the network.
- The `dev-ai` namespace already runs Playwright-style batch Jobs (`menu-scraper-*`) with `nodeSelector: envpool=aiapp`, ACR images under `fbrdevacr.azurecr.io/ai/`, `imagePullSecrets: docker-registry-secret`, and config via ConfigMap plus Secret.
- Storage account `fbrdevstorage` has an `seo` container that already holds client SEO reports. Secret `azure-storage-account-f6eab793693c54a6891af3c-secret` in `dev-ai` carries the account name and key.
- A throwaway probe on a laptop (headless Chrome, 1440x1000, `hl=en`, map centered on Garden City at zoom 13) measured: results panel 408px wide with 875px visible; cards 154 to 270px tall, most 210px; about 5 cards per screen; 8 to 11 cards mounted initially, 20 after two scrolls; feed children alternate card and separator, so card DOM indices step by 2 and stay stable while scrolling. No Sponsored cards appeared in three keywords, so ad markup is still unverified.

## Decisions

| Topic | Decision | Reason |
|---|---|---|
| Language | TypeScript on Node 22 with Playwright 1.63.0. | Chosen on project fit, not cluster consistency: the extraction logic runs in-page, so one language for page script and host code; the ad/organic/unknown contract is a discriminated union the compiler enforces. |
| Browser | Chromium bundled in `mcr.microsoft.com/playwright:v1.63.0-noble`. Google Chrome is not installed. | Removes the separate Chrome install and version validation from the image. Rendering of Maps is identical for this purpose. `chromiumSandbox` is verified in the cluster per the detailed design; never silently disabled. |
| Extraction | Read the results feed DOM; screenshots are evidence. No internal API interception, no vision models. | Display order and ad labels must be what the page shows. |
| Scope per keyword | 15 displayed listings including ads (was 20). | Product decision. |
| Scroll and screenshot budget | 6 scrolls, 5 results screenshots (was 30 and 20). | Measured: 15 listings need about 3 scrolls and 4 screenshots. |
| Scroll step | Scroll so the top of the last partially visible card becomes the top of the panel. If the 15th listing is cut off when the limit is reached, take one more screenshot. | Every card appears complete in at least one screenshot. |
| Search location | `mapView` is required. Open `https://www.google.com/maps/search/<keyword>/@<lat>,<lng>,<zoom>z?hl=en` directly instead of typing. | Egress is Virginia. The result still records that the Google-inferred location is unknown. |
| Overlap reconciliation | Feed DOM index is the primary occurrence key, combined with place identifier and ad flag. Each round also checks that card bounding-box tops increase with DOM index; a violation, a reorder of a known id, or a gap in the index sequence ends collection with `sequence_ambiguous` and keeps the verified prefix. | Measured stable append-only DOM. Simpler than pure visual alignment and still fails closed. The detailed design's visual-order caution is kept as the check. |
| Storage | Account `fbrdevstorage`, container `seo`, prefix `maps-keyword-capture/<YYYY-MM-DD>/<runId>/<attemptId>/`. Auth via the existing account-key Secret. | Reuses infrastructure the team already operates. The account key grants whole-account access; scoping to the prefix via workload identity is a later hardening step and is noted as accepted risk. |
| Artifact index | Folded into `manifest.json` (per-query object keys, sizes, checksums, verification times). No separate `artifact-index.json`. | Same information; one fewer file to verify. The manifest readback rule from the detailed design still applies. |
| Cluster settings | Namespace `dev-ai`; `nodeSelector: envpool=aiapp`; `imagePullSecrets: docker-registry-secret`; image `fbrdevacr.azurecr.io/ai/maps-keyword-capture:<git-sha>` referenced by digest. | Matches existing `dev-ai` Jobs. |

## Adopted unchanged from the detailed design

Attempt isolation (`attemptId`, `queryAttemptId`), `observations.jsonl` per query, the pre/post screenshot signature check, the CAPTCHA circuit breaker with `skipped`, one bounded transient retry per keyword, the wider snake_case CSV columns, `not_requested` for local-only persistence, exit codes 0/2/1/64, the batch deadline formula, the extended stop reasons, and the module boundaries.

## Milestone 0 status

The laptop probe covered card geometry, scrolling behavior, DOM stability, and screenshot legibility for `bubble tea garden city`, `fried chicken mineola`, and `matcha mineola`. Still missing: a live Sponsored card, a no-results page, a consent page, and a CAPTCHA page. Those are collected during the cluster acceptance run; until then the ad classifier is unverified and unrecognized cards fail closed to `unknown`.

## Out of scope for the first version

Scheduling, an administration UI, client-specific filtering, report generation, period-over-period comparison, CAPTCHA solving, workload identity, and general web search.
