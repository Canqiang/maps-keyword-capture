# Android search submission / scroll follow-up — 2026-10-23

Source branch: `codex/android-search-scroll-20261023`. Candidate 1: `24bd4b7`; candidate 2: `40f081d6b2104e812e5caeef8c80e1d05bfe5b61`. No production image or schedule was replaced. Web/UI and source keyword collections remain protected. Android scheduling remains suspended.

## Candidate 1

ACR `ch159p`, digest `sha256:712f0941bdf89d6e831538cf0bbec5b941e9babb4c17480973646a0ab9f3d2e5`. Exact-query autocomplete readiness guard and initial sheet expansion worked as guards; ENTER flags did not submit OnlyBear. KEKE reached 14 continuous organic rows then encountered OCR separator mismatch in frames36/37. Worker exits: 2 and 1. All 174 independent Azure objects / 172 exact writer receipts verified; 41 PNGs decoded. These failures are preserved.

## Candidate 2: actual App observations

ACR `ch159u`, digest `sha256:6538c3f42f171236a27cc103c0be327b676fef3aa250492545bb265684ff4efc`. Job `maps-android-search-scroll-v2-20261023`, fresh database with same name. Original exits: KEKE 1, OnlyBear 2; zero restarts, actual imageIDs match.

| Store | Query | Actual result | Limit |
|---|---|---|---|
| KEKE | braised food flushing | 9 ordered frames, 5 natural listings; 10th PNG saved but OCR failed | No rank acceptance; failed query. Screenshot03:35:23Z to manifest03:35:54Z is consistent with 30s OCR timeout, coinciding with worker1 startup. Resource contention is a hypothesis, not a confirmed cause. |
| OnlyBear | bubble tea garden city | Submitted exact query, 17 frames, 1 ad +12 natural listings; target displayed3 / organic2 | Partial: `stalled_same_frame`. Last screenshot shows Looking for someplace else? / Add a missing place, which current terminal-marker contract does not recognize. |

OnlyBear submission failure is repaired in a real App observation. The complete collection is **not** accepted. Explicit Sponsored Gong Cha is visually confirmed in frame001; frame002 confirms overlapping Smo Tea and Only Bear Chicken & Boba (4.7 /102). This is one sampled ad, not general ad-classifier certification. GPS device receipts matched; Google backend locality remains unverified.

Independent Azure CLI identity readback: **126 objects,124 exact writer receipts, no mismatch**. All29 PNGs decoded,64 JSON files parsed,2 query JSON/CSV records and18 listing rows compared. Visual QA scope: OnlyBear frames001,002,017; separate from full byte/hash scope.

All raw logs, immutable manifests, receipts, original PNG/XML/OCR and deployment snapshots are retained under the local evidence directory `android-search-scroll-2026-10-23` in this task's visualization workspace. Azure container: `fbrdevstorage/maps-keyword-capture-uat`. Android prefixes:
- `android-maps/2026-10-23/run_20261023T033238Z_79a599/`
- `android-maps/2026-10-23/run_20261023T033523Z_f3634d/`

## Isolated KEKE follow-up

Same immutable candidate2 image; one worker, same original keyword/point/profile, separate fresh verification database. No old failed gate is cleared. This separates the original scrolling defect from the newly observed OCR failure during second-worker startup. Terminal outcome: exit2, three screens, `ranking_unreliable`; no OCR timeout in this short sample. A far-right scrollbar was OCR'd into Woodam's rating line and distorted its bounds. The retained clipped-header guard correctly refused to join it. Candidate3 changes only derived geometry for a narrowly identified scrollbar word. Independent Azure-login readback verified22 objects /21 receipts; all4 PNGs decoded,12 JSON files parsed and4 listing rows compared. A short non-timeout run does not disprove the earlier intermittent OCR timeout.

## Candidate3 — bounded serial verification

Source `0dabee3a679a468b047ba31dbf6a6d08121ec4e9`, ACR `ch159w`, digest `sha256:e3f7dccbf9e8392836e6f99c6282898d7775d41a93c10641439e516d55fcf824`. Job/database `maps-android-search-scroll-v3-20261023`; indexed two-worker assignment with parallelism1, so emulator startup does not overlap. Original keywords, two center points,90 screenshots /89 scrolls /600seconds per query remain unchanged. This run does not validate concurrent two-worker capacity.

Software:1,696 TypeScript tests,30 runtime Python tests, typecheck, contract typecheck and build passed. Independent review found no remaining blockers after malformed OCR word metadata was made ineligible for normalization. The final real App outcome is recorded below; overall acceptance did not pass.


## Final isolated result — 12:08 Asia/Shanghai

| Store | Original exit | Final result | Acceptance |
|---|---:|---|---|
| KEKE | 1 (11:59:20) | Exact query reached a result screen, fresh GPS matched, but `appium_protocol_error` occurred before ranked frames. | Failed. Existing scroll fixes pass real-fixture replay, but are not end-to-end accepted by this run. No target rank is published. |
| OnlyBear | 0 (12:08:22) | Complete list: 13 displayed occurrences = 1 ad + 12 organic, unknown0; target display3 / organic2. | Passed this keyword/center-point sample.17 selected frames,18 retained screenshots including one discarded frame from a bounded backward correction; verified `list_end`. |

Job finished Failed at12:08:27 because indexed worker0 failed; worker1 succeeded. Both workers and native sidecars have terminated with zero restarts; imageIDs match the candidate digest. No retry, failed-gate clearing or production rollout was performed.

Independent Azure CLI identity readback downloaded **all94 objects under both runs' recorded prefixes**, and verified **all92 exact writer receipts** with bytes/SHA-256, with zero mismatch. The two top-level scan summaries have no external exact hash receipt; they were downloaded and checked against service length, not misreported as externally hash-verified. All21 PNGs fully decoded,21 XML files parsed,48 JSON files parsed,4 CSV files parsed,2 query records and13 listing rows compared. All17 selected OnlyBear OCR/XML frames were reparsed/reconciled and exactly reproduced the persisted13 listings. This is deterministic same-source replay, not independent OCR. The initial local replay helper incorrectly expected quality fields on the reconciler instead of the runner/frame; its contract was corrected, and this helper error was not attributed to the collector.

Visual review:4 PNGs (KEKE diagnostic; OnlyBear Sponsored Gong Cha, target and terminal footer). These visual samples do not establish every ad layout's correctness. Device GPS matched for both; Google backend location remains unverified. OCR spelling/case imperfections remain in raw merchant names; no invented name corrections were applied.

Final readback and scope: [final-validation.json](final-validation.json), [runtime-audit.json](runtime-audit.json), [software-validation.json](software-validation.json), [replay-final.json](replay-final.json), [visual-review.json](visual-review.json), [protected-audit.json](protected-audit.json).

Artifact account/container: `fbrdevstorage/maps-keyword-capture-uat`.
- KEKE: `android-maps/2026-10-23/run_20261023T035839Z_994316/`
- OnlyBear: `android-maps/2026-10-23/run_20261023T040540Z_de9155/`
- Tracking summaries partition by New York date: KEKE2026-10-22, OnlyBear2026-10-23. This run crossed local midnight; the two shards used the same verified catalog snapshot.

Durable raw evidence: `/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/android-search-scroll-2026-10-23/candidate3/`. `durable-readback-report.json` points to retained files there. Earlier candidates and the solo KEKE attempt are separate directories. Nothing rewrites old failed observations.

## Release decision / next owner

**Do not promote or enable Android yet.** All7 protected Maps workload specs and15 existing ConfigMap data hashes stayed unchanged. Existing Web/UI images, schedules and shared SEO keywords remain untouched. The production Android template is still suspended and pinned to its prior image. This serial two-query probe does not prove concurrent capacity or full90-keyword acceptance. Source fixes are local commits on `codex/android-search-scroll-20261023`; no branch push/merge in this follow-up.

See [handoff](../../../docs/android-ranking-repair-handoff.md) for the exact missing Appium diagnostic boundary and next steps. The next investigation must first retain bounded sanitized command/HTTP/W3C error evidence before sidecar shutdown. Do not broaden ranking heuristics or automatically repeat uncertain search submission to work around an unclassified control failure.
