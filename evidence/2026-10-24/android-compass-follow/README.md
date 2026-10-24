# v31 native compass-follow verification

Source `cff132d70ef81d21e36e48e30c311ea0aa219283`, ACR `ch15b9`, image `sha256:e19202b8eb1efa55982f7d2127e93f5cd8978f0a38dec4c9022bcf5b679719bb`. Isolated Job/database `maps-android-v31-20261024`.

## Result

The native location preparation passed for both queries. Search/capture intervals overlapped80.865 seconds. OnlyBear completed13 organic rows, target display 2 / organic 2, explicit list end, original exit 0 at 2026-10-24 14:04:07 Asia/Shanghai. KEKE completed 45 successful OCRs but stopped partial at 14:06:44, original exit 2, 18 organic diagnostic rows plus 1 unknown; final target ranks remain null.

The remaining KEKE failure is frame 44→45: a clipped JiYou Braised Food zero-review line changed `Restaurant . 0.6 mi` to `Restaurant - 0.6 mi`. Strict line equality rejected continuity despite unchanged category/distance and an independent following JiBeiChuan 4.7/842 anchor. The original artifacts are preserved. v32 adds only known-separator canonicalization under the existing zero-review/geometry/independent-anchor guards; it does not repair historical results.

## Verification and limits

- 99 files / 1,894 tests, contracts, typecheck and build passed for v31; 341 focused tests and independent review passed.
- 61 OCR attempts succeeded, no OCR timeout/failure. All 1,521 command sequences recovered (KEKE 1,065; OnlyBear 456), zero command failures, exactly one search submission each.
- 350 Azure objects independently downloaded: 348 exact writer size/SHA receipts plus 2 service-length-only scan roots. 63 PNGs decoded, 220 JSONs parsed, 4 CSVs and 2 query / 32 listing rows checked. Both isolated database observations match.
- Both final app-health reports preserved; all 8 read-only diagnostics completed. `lastanr` says no ANR since boot; exit-info records background Maps startup ANRs at 01:58:39 / 02:01:32 New York, before the 02:02:42 / 02:02:43 search submissions. These are not evidence of a foreground search failure or a proven resource root cause.
- Visual sampling: first KEKE and OnlyBear listings, OnlyBear terminal list marker, both native location screenshots, and the exact KEKE 44/45 failure pair. It does not establish all ad labels or customer-local geographic relevance.
- 108 protected checks unchanged: 7 workload specs and 101 existing ConfigMap hashes. No production resource/schedule/catalog/history changes. Android production remains suspended. No promotion/push/merge.

Full immutable source artifacts, Appium tails, command journals, receipt inventory, original exits, replay and DB evidence:
`/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/android-compass-follow-2026-10-24`.

Full two-query ranking acceptance **failed**; concurrency and OCR success are separate. Next gate: fresh v32 run must complete both lists with actual overlap and full independent evidence checks. Full-catalog/two-hour capacity and geographic acceptance remain separate.
