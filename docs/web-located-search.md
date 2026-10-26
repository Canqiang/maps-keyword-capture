# Web GPS-first search preparation

## Problem and diagnosis

A Maps camera URL is not the location used by Google to select nearby results. The October 26 OnlyBear investigation reproduced a Garden City camera with Flushing listings. Changing ranks or removing distant businesses would hide the problem and is not an acceptable repair.

A four-way isolated experiment used fresh contexts, the same AKS egress, the same Chromium image, the same keyword (`bubble tea near me`), and the same OnlyBear 3 km point (40.7222614, -73.6415096, zoom 15):

| Entry method | Browser GPS | Observed outcome |
| --- | --- | --- |
| Direct coordinate-bearing search URL | Off | Flushing-dominated results |
| Direct coordinate-bearing search URL | On | GPS was read, but the already-started search remained Flushing-dominated |
| Map home, then UI search | Off | Results/camera shifted toward Flushing |
| Map home, acknowledged GPS, then UI search | On | Garden City / nearby Nassau County businesses, including OnlyBear |

This identifies search preparation/order as a reproducible cause in this sample. It does not establish that every keyword or every future Google response has verified customer-local ranking.

## Opt-in contract

Capture configurations may set `mapSearchMode: "located_ui"` together with `mapView`. Tracking configurations expose the same option at `surfaces.web.mapSearchMode`; a frozen tracking configuration takes precedence over a caller's capture override. Android's configuration is unchanged. Omission, or `"url"`, preserves the legacy workflow. No shared SEO keywords are rewritten.

Each located search:

1. Starts a fresh context with the requested simulated GPS coordinate and 10 m accuracy. Geolocation permission is granted only to `https://www.google.com`.
2. Opens the map home at the requested camera coordinate/zoom before submitting any keyword.
3. Reads browser GPS back, checks finite coordinates/accuracy and an exact-point tolerance, and requires Google's visible, unique `Your Location` acknowledgement.
4. Checks the prepared camera (within 0.0001 degree and exact requested zoom), fills one empty search field, and clicks the unique Search control once.
5. Waits for the result surface and uses the existing capture/parser/scroll pipeline. It never changes keywords, removes distant listings, reorders results, or relabels ads.

The current UI controls are English; use the existing `en-US` capture locale. Translated/unrecognised controls fail closed rather than falling back to an unlocated search. Preparation and input reads spend the same bounded navigation budget. CAPTCHA/consent retain the existing blocked outcome. A failure before submission yields `location_unverified`, no ranked listings and diagnostic evidence when available. A failure after submission cannot trigger a fresh search attempt.

`context.searchLocation` records method version, requested/observed GPS and accuracy, readback time, Google acknowledgement, prepared camera, submission attempt/completion, and any failing stage. `geolocationPermission` records the actual successful context grant. A click attempt whose completion is uncertain is distinguished from a completed click. These fields attest browser/UI preparation, not Google's internal ranking location.

## Historical comparability and evidence

The located method adds `browser_gps_before_search/v1` to `profileHash`; legacy hashes stay byte-for-byte compatible. Existing observation cohort checks therefore do not join old URL-only and new GPS-first observations into an asserted rank improvement. Historical records/screenshots remain intact.

`displayPosition` still includes ads; `organicRank` remains the verified natural ordering. GPS preparation does not change advertisement classification. `geographicRelevance` remains `unverified` without a configured expected area. Google may widen results or apply filters; the existing unrecorded applied-filter limitation remains open. A null review count remains null.

## Safe validation and rollout

Use a bounded isolated Pod/Job and fresh output/run IDs. Do not change an active scheduled Job, shared ConfigMap, Mongo keyword catalog, historical data, resource limits, or the daily/Android collectors. Validate actual OnlyBear center/3 km/5 km points and other-store controls; retain location receipts, full result JSON/CSV, screenshots, original exits and executable provenance.

Before enabling future Web Jobs: require the full test suite, reviewed code, a pinned cloud-built image, a fresh isolated image-level test, and independent artifact checks. Use a new immutable configuration and patch only the future Web Job template. Existing running Jobs retain their original image/configuration. Capacity and the first complete scheduled round remain separate acceptance gates; small isolated tests cannot prove a full 620-query round fits two hours.

See [October 26 evidence](../evidence/2026-10-26/web-geography-fix/README.md) for exact progress and release state.
