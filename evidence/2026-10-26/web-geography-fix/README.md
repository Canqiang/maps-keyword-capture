# Web location preparation repair — October 26, 2026

**Status: implemented, independently verified in isolation, and enabled for future UAT Web Jobs at 12:39:21 Beijing / 00:39:21 New York. The first full scheduled round with this method is still pending.**

## Cause and repair

The same-pod four-way comparison separated URL camera position, browser GPS and search submission order. A direct coordinate-bearing search URL returned Flushing listings with a Garden City camera, even when GPS was enabled. Map home + acknowledged GPS + subsequent UI search returned Garden City / nearby Nassau County listings for the tested OnlyBear 3 km query.

The opt-in `located_ui` workflow grants origin-scoped GPS permission, verifies browser GPS and Google's visible acknowledgement before one search submission, and records the preparation receipt. It fails closed if preparation is unverified; it does not fall back to URL-only search or repeat an uncertain submission. Existing parser/scroll logic, advertisement labels and original display ordering are preserved. A new `profileHash` separates this method from historical URL-only observations; no historical record or shared SEO keyword was rewritten.

Source commit: `beb1467864c1981897f5d70e605b2cdde41c687b`. Cloud build: ACR `ch15bx`, independently read back as:

`fbrdevacr.azurecr.io/ai/maps-keyword-capture@sha256:778c35dfba14d67dba76752d8edf95d72468dccb328a744037dba9a68bd2d476`

## Verification

- TDD reproduced preparation/profile/config regressions, an unwanted retry after a submitted search, and an unbounded read after input removal. All regressions now pass.
- Full suite: **102 files / 1,931 tests passed**; focused suites: 23 tests. TypeScript checks and build passed. After aligning the deployment configuration, all 40 tests in four deployment/catalog/snapshot suites passed and type checking was rerun successfully. Independent review findings were repaired and re-reviewed.
- Initial diagnostic stage: ten searches using an explicitly identified working-tree overlay in a dedicated no-secret Pod. This stage is not immutable-image or Azure acceptance.
- Immutable-image Job: `maps-web-location-verify-20261026-beb1467`; **nine stores / 15 searches / 225 listing rows**, each query captured 15 displayed listings. Original Pod exit **0**, no restarts, expected imageID; finished **12:29:14 Beijing / 00:29:14 New York**.
- Independent Azure-login readback: **144 objects** (one summary, 15 manifests, 128 referenced artifacts), all exact sizes and SHA-256 hashes checked. All JSON/CSV rows reconciled and all **68 PNGs** fully decoded. Request/profile hashes, selected attempts, artifact paths, completion/sequence fields, and screenshot/observation references were checked.
- Verifier acceptance tests: 15 passed (the actual 15-case dataset plus 14 mutation-rejection cases); independently reviewed. Helper-contract weaknesses found during review were fixed; no actual artifact inconsistency was found.
- Visual scope: **14 of 68 original PNGs**, across all nine stores, all three OnlyBear points and all **four Sponsored ads**. Viewed names, ratings, addresses and ad labels matched structured rows. This visual sample does not claim every PNG was visually inspected.
- The isolation Job had no Mongo credential/client; its output uses only `verification/web-location-20261026-beb1467/` in `fbrdevstorage/maps-keyword-capture-uat`. It did not populate the normal dashboard observations.

OnlyBear results in the immutable-image probe:

| Keyword | Center | 3 km point | 5 km point |
| --- | ---: | ---: | ---: |
| bubble tea near me | 1 | 5 | 11 |
| boba near me | 1 | 6 | 9 |

These are organic ranks from new measurements, **not an SEO improvement claim**. For generic `bubble tea` at the 3 km point, OnlyBear was display position 8 / organic rank 7, with a Sponsored Gong Cha first. Four ads across the probe retain null organicRank and their original displayed positions.

## Future-only rollout and handoff

The existing 12:15 Beijing Job `maps-targets-web-2h-29883135` (UID `6a36711b-6c19-4803-8260-b289046f003b`) retained its original image, configuration and entire Job spec. A new immutable ConfigMap `maps-targets-web-located-beb1467` (UID `9338aa08-ca68-4a16-9e12-35c46baec8ec`) copies the previous data with only `surfaces.web.mapSearchMode=located_ui` changed.

A reviewed UID/resourceVersion-guarded patch changed exactly three future CronJob template values: image, `IMAGE_DIGEST`, and ConfigMap reference. Server dry-run and independent readback passed. All 19 protected resources matched their expected fingerprints: the Web CronJob's planned three-value delta, plus 18 unchanged resources. The schedule remains every two hours in America/New_York; three workers, requests/limits, deadlines, catalog source, UI, daily collectors and historical data are unchanged. Android remains suspended.

The **14:15 Beijing / 02:15 New York** scheduled Job is the first expected full round on the new method. The existing bounded `uat` monitor now distinguishes the old 12:15 version from the new 14:15 version. It must verify actual selected/attempted/completed counts, original worker exits, Mongo reconciliation, all manifests and declared artifact samples. The isolated probe does not prove the full current catalog fits the two-hour cadence. No full-round acceptance is claimed yet.

If a future rollback is authorized, change only future Web template values back to the previous image/configuration; never modify an active Job or rewrite observations. Do not automatically retry or downgrade a failed GPS preparation. A guarded patch failure after ConfigMap creation can leave an unused immutable ConfigMap; inspect the actual state before retrying.

## Evidence and remaining limitations

Machine-readable summary: [validation.json](validation.json). Durable raw evidence (local, not committed):

`/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/web-geography-fix-2026-10-26`

The temporary `/tmp/maps-web-geography-20261026` path is an alias to this durable directory. Relevant files: `image-readback/report.json`, `image-visual-review.json`, `original-pod-exit.json`, `rollout-result.json`, `rollout_future_web.py`, `verify-image-azure.py`, `verify_image_contract.py`, and test/review logs. Original PNGs and receipt hashes are retained. The initial interrupted tar transfer was diagnosed as a local evidence-transfer problem; the complete archive was recovered and hash-verified before deleting the diagnostic Pod.

GPS/UI preparation is now evidenced, but Google's backend geographic relevance remains `unverified`. Google can expand results beyond the neighborhood (some probe results were over 10 km away), and a fixed point is not strict-radius coverage. Chinese cuisine filter chips were visibly applied by Google in Chinese-food searches; structured applied-filter coverage remains incomplete. Limited-view notices remain visible in some screenshots. Missing review counts remain null. These limitations must remain visible in analysis and handoff.

Contract: [Web GPS-first search preparation](../../../docs/web-located-search.md).
