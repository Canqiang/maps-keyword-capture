# UAT manual full-run verification — 2026-09-18

The optimized monitor executed all **260 selected keywords across seven stores and
13 batches**, and independent Azure readback verified every referenced evidence
object. The run remains **partial**: 233 searches were captured completely and 27
were partial. The Pod and acceptance verifier both exited with code **2**.
`evidenceIntegrityPassed` is `true`; `collectionAcceptancePassed` and
`allKeywordsRankingComplete` are `false`.

This was an authorized manual run from **08:33:35 to 09:56:25 Asia/Shanghai**
(`00:33:35–01:56:25Z`), approximately 82 minutes 50 seconds. It verifies execution
of the deployed image at full selected volume. It does **not** establish that the
midnight schedule fired. The separate manual run key preserved the original
scheduled-run claim and its evidence.

## Run identity

| Field | Value |
| --- | --- |
| Cluster context / namespace | `FBRDevAKSCluster` / `uat` |
| CronJob template | `maps-keyword-monitor-daily` |
| Manual Job | `maps-monitor-verify-20260918t003315z-544bac` |
| Pod | `maps-monitor-verify-20260918t003315z-544bac-n26vk` |
| Run key | `verify-20260918t003315z-544bac` |
| Daily run ID | `run_20260918T003336Z_1bd373` |
| Image source revision recorded in artifacts | `ed2a128` |
| Image digest | `sha256:969d8592e7d3369591195d5a102287d3fca39268e36417b49fbf8f4a394315e0` |
| Azure account / container | `fbrdevstorage` / `maps-keyword-capture-uat` |

The final [summary](summary.json), [Pod exit evidence](pod-exit.json), and
[independently reread claim](claim-final-readback.json) preserve the run identity
and terminal state. Kubernetes reports `Failed / BackoffLimitExceeded` because
the application deliberately returned exit code 2 for partial collection; there
were no Pod restarts. That state must not be relabeled as a crash or full success.

## Coverage and result meaning

The denominator comes from the seven source snapshots read for this run, with at
most 40 keywords per store. Six stores supplied 40 selected keywords; Szechuan
Gourmet supplied 20. All 260 were attempted. There were **zero skipped, blocked,
failed, source-failed or empty-store records**, and no global stop reason.

| Store | Selected / attempted | Captured | Partial | Partial reasons |
| --- | ---: | ---: | ---: | --- |
| Choice Upper West Side | 40 / 40 | 39 | 1 | Scroll limit |
| Choice Clinton Hill | 40 / 40 | 39 | 1 | Non-ranking detail |
| Only Bear | 40 / 40 | 32 | 8 | Non-ranking details |
| Keke Flushing | 40 / 40 | 36 | 4 | Non-ranking details / regions |
| George merchant | 40 / 40 | 37 | 3 | Non-ranking details / region |
| Massage & Float | 40 / 40 | 30 | 10 | Nine non-ranking details / region; one unknown classification |
| Szechuan Gourmet | 20 / 20 | 20 | 0 | None |
| **Total** | **260 / 260** | **233** | **27** | |

The 233 captured searches comprise **231 nonempty complete lists and two explicit
no-results pages**. Keke's `luwei` and `cold dishes` screenshots say Google Maps
cannot find the query. Their JSON has `resultSurface: no_results`,
`observedCount: 0` and an empty listings array; their CSVs contain headers and zero
data rows. They must not be described as two successful merchant rankings.

The 27 partial searches comprise:

- **25 `non_ranking_result` pages:** 21 business details and four region pages.
  The region queries are Keke's `flushing` and `new york city`, George's `new york`,
  and Massage & Float's `chesapeake`. These contain zero ranked listings.
- **One `scroll_limit`:** Choice Upper West Side's `brunch near me`, with 13
  retained listings. The last saved PNG visibly contains an end-of-list message,
  while the recorded outcome remains partial. This is a diagnostic candidate for
  end-marker detection or observation timing, not sufficient evidence to change
  the historical outcome to complete.
- **One `classification_unknown`:** Massage & Float's `spa`, with 15 listings.
  Display position 2 is `Blue Stone Chateau Yosemite Pool Spa Secluded - Deluxe
  Villa`; its visible card shows `Lodging` without a supported classification
  signature. It remains unknown. Subsequent organic ranks are null rather than
  assuming whether this card belongs in the organic sequence.

All 25 detail/region queries were followed by further queries. Only Bear's three
consecutive detail pages at the end of its second batch did not prevent the next
query or any later store from running. This reproduces and verifies the intended
breaker correction. [Log analysis](log-analysis.json) records every batch and
partial query. It found no CAPTCHA, timeout, unsupported-layout breaker, browser
startup or storage error events; all 260 query exports reported no export error
and verified persistence.

## Independent evidence verification

The [readback report](readback-report.json) used the operator's Azure CLI login,
independent of the Pod's SAS. It downloaded and checked **1,744 objects**, totaling
**809,943,640 bytes**, with matching receipt sizes and SHA-256 values:

| Object scope | Count |
| --- | ---: |
| Final daily manifest | 1 |
| Source selection snapshots | 7 |
| Batch manifests | 13 |
| Referenced artifacts, including every attempt | 1,723 |
| **Total** | **1,744** |

No cache entries were reused for this independent run. All **930 PNG files**
passed structural checks; **260 result attempts** and **3,070 JSON/CSV listing
rows** were reconciled, including positions, business fields, classifications,
screenshot references and geographic status. Selected per-store summaries were
checked against their result records. The source snapshots and batch selections
reconcile to the actual 260-keyword denominator.

The 3,070 emitted listing rows comprise **3,069 classified organic, one unknown,
and zero classified ads**. This does not prove advertisements were absent from
all rendered pages. In particular, this run does not constitute a live positive
test of sponsored-result detection.

Manual visual review covered **22 distinct PNGs across 19 queries and all seven
stores**, including all 10 verifier-recommended samples. [The visual review
report](visual-review.json) gives the exact reviewed objects and links to the
component review records. Structural checks of all 930 PNGs must not be represented as
visual inspection of every image. Sampled screenshots were compared with their
JSON/CSV records and receipt hashes; the reviewed sample includes normal result
lists, business and region details, no-results pages, the unknown card and the
scroll-limit case.

## Geographic limitation

All **260 geographic assessments remain `unverified`**, because no verified
`expectedArea` was configured. The program preserved the input keywords and did
not grant browser geolocation or set a map view. Collection completeness does not
establish that the results apply to the enrolled merchant's area.

Visual examples show why the distinction matters:

- Only Bear is visibly first for this capture of `bubble tea delivery mineola`,
  with the map showing Mineola and nearby communities.
- `Brooklyn bakery` opens Brooklyn Baking Company in **Waterbury, Connecticut**.
- `bubble tea near winthrop hospital` opens Tsaocaa Westminster at a visible
  **Westminster, Colorado** address.
- Generic searches such as Keke's `noodles` and George's `burger` show Colorado
  results; Choice Clinton Hill's `Brooklyn cafe` shows a nationwide map.

These observations identify the displayed places and map content. They do not
establish the searcher's location, the Google location signal responsible, or a
merchant's ranking throughout its local market.

## Final Azure receipt

Final manifest object key:

```text
2026-09-18/daily/run_20260918T003336Z_1bd373/manifest.json
```

- Size: **224,272 bytes**.
- SHA-256: `643a37d82fa6c31ba38b026a2a0838c1a84a895f7a8c605a0961d1f66e4e0f65`.
- Receipt verified at: `2026-09-18T01:56:25.440Z`.
- Claim object: `claims/verify-20260918t003315z-544bac.json`.

The container is private. These paths identify evidence and contain no SAS token
or other credentials.

## Outstanding work

1. Inspect the `brunch near me` end-marker/scroll-limit discrepancy using the saved
   observations and screenshots; retain the original partial record.
2. Add a conservative supported-layout case for the `Lodging` card only after
   checking its DOM evidence and advertisement-label ownership. Do not convert
   unknown cards to organic by default.
3. Obtain verified expected-area references per merchant for passive geographic
   assessment. Keep that separate from any future decision to change search
   location or keyword text.
4. Keep no-results and non-ranking pages separate from merchant ranking evidence
   in downstream reports, and exercise sponsored-result detection with suitable
   evidence before claiming live ad-classification acceptance.
5. Verify a future scheduled midnight run separately if schedule acceptance is
   needed; this manual run does not substitute for it.

The resolved issue is full-run continuation after recognized detail pages. The
remaining limitations are explicitly preserved in the result data and evidence.
