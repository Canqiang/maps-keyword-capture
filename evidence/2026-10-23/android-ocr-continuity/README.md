# KEKE OCR continuity repair and isolated native verification

Date: 2026-10-23. **Targeted historical repair verified; complete native ranking acceptance remains partial. No production promotion.**

## Targeted defect and repair

Original run `run_20261023T045212Z_cabf64` frames31/32 show the same Braised Canaan card. OCR changes the CJK name, loses `Closed`, changes rating-symbol whitespace and changes the opening quote of a separate review snippet. Exact continuity could not establish two anchors.

The new fallback requires a unique fact-preserving rating anchor and a unique long quoted snippet above the same trailing/leading card. Only quote glyphs normalize in the snippet; words, numbers and punctuation remain exact. Both anchors must have aligned horizontal geometry, line height and consistent bounded movement in the same exact-query native viewport. Rating/count/category/distance, compatible price and known ad/organic type must agree. Duplicate tuples, warnings, clipping, invalid boxes or conflicting exact motion reject the fallback. Existing placement and classification guards remain. No fuzzy-name or retry threshold was increased; raw observations remain immutable.

Original raw fixtures and exact receipts are committed under `tests/fixtures/android/command-probe-20261023/`. XML bytes are preserved by `.gitattributes`. The regression fails before the patch and passes after it. The full 30-selected-frame historical replay produces 12 ordered organic occurrences without the duplicate, but no end marker. Listing method is now `full_screen_ocr_native_context_ordered_overlap/v20`.

## Software and build evidence

- Repair commit: `cbb1283dc512230f73cc30c1f4cfd7e0e63c1fd9`.
- Runtime source: `beab53842f3a115c257e42f46b435ca3f3894593` (preserves original XML fixture bytes).
- Azure build: `ch15a0`; exact Git archive built in ACR.
- Image digest: `sha256:a135dae97de2f5b7a29ee0b79f6ba18c59811fc81116f48d8dbed659785a86c3`.
- 1,727 TypeScript tests, 30 runtime Python tests, typecheck, contracts and build passed. Targeted two-file suite: 46 tests, including 25 historical-boundary tests. Two read-only code reviews found no blockers after geometry guards and full-prefix replay.
- [Software validation](software-validation.json) includes log hashes. Actual container image identities, exits and restarts are in [runtime audit](runtime-audit.json).

## Actual isolated native result

Context `FBRDevAKSCluster`, namespace `android-maps-pilot`, Job/database `maps-android-ocr-continuity-20261023`. One KEKE keyword `braised food flushing`, original center, worker0 only, unchanged 90-screen / 89-scroll / 600-second bounded profile. Fresh database and immutable prefixes; no production observations written.

Tracking ran **13:20:01–13:24:42 Asia/Shanghai**, original exit **2**, sidecar exit0, zero restarts. It retained 36 ranking screenshots and 34 selected frames (25 and27 discarded during the two bounded corrections), with 14 diagnostic listing rows. It passed Braised Canaan and Chuan Bistro, then stopped `ranking_unreliable` / `anchored_card_missing: q0001:frame-035 -> q0001:frame-036`. Final target/organic ranks are null and organic coverage is zero. These 14 rows are not 14 accepted ranks.

The new native run **did not reproduce the exact historical quote/name drift**: [fallback comparison](fallback-comparison.json) has no changed boundaries when disabling the new fallback. Thus real historical fixture regression establishes the targeted repair; this device run does not prove that exact fallback executed live. All 34 selected OCR/XML frames reparse and reconcile to the persisted diagnostic rows ([replay](replay.json)). This is deterministic parsing replay, not a fresh OCR run or complete visual audit.

## Remaining distinct rating defect

Frame35 correctly reads Longjiang Pork Feet Rice at 4.1 / 18 reviews. In frame36 the same visible 4.1 becomes OCR `4.19% (18) - $10-20 - Chinese`; the strict rating parser returns no card. Independent exact anchors establish approximately -220px motion and the expected card remains visible, so ordered overlap fails closed. The next bottom-edge card also has malformed `49% (55)`.

The screenshot does not justify silently rounding every `4.19` to `4.1`. Add exact raw regression fixtures and investigate bounded OCR reread or evidence-backed missing-card handling. Do not infer list end from an empty parse. [Remaining boundary](remaining-rating-boundary.json) records PNG/XML/OCR/frame object keys, bytes and SHA-256 for both frames. The old intermittent Appium exception was not reproduced and remains undiagnosed.

## Independent artifact and command validation

Azure account/container: `fbrdevstorage/maps-keyword-capture-uat`.

- Android prefix: `android-maps/2026-10-23/run_20261023T052002Z_9dc461/`.
- Tracking prefix: `tracking/android/2026-10-23/point/android_scan_20261023T052002Z_c66c8c/`.
- All **166** referenced objects downloaded with Azure login, independent of Pod SAS. **165** exact writer receipts passed bytes/SHA-256; the top-level tracking scan root has service-length validation but no independent writer hash receipt.
- All **37 PNGs** decoded (36 ranking plus one location), **90 JSON** and **37 XML** parsed. Two CSVs checked against one query and14 listing rows. [Structure checks](structure-readback-report.json), [command audit](command-audit.json), [profile audit](profile-audit.json).
- **12 immutable command checkpoints recover all 870 sequence entries**, with no conflicting records or failed commands. Includes submission, sheet expansion, scrolling and cleanup. This bounded run has a complete union; it does not guarantee recovery after node loss/SIGKILL. No request bodies, credentials or arbitrary command responses were added to durable journals.
- **Four PNGs visually reviewed**, separately from complete hash/structural scope: first KEKE view, Braised Canaan and Longjiang frames35/36. [Visual review](visual-review.json). No ad appeared in this sample; no general advertisement acceptance claim. Device GPS matched and viewport followed; Google backend locality remains unverified.

Full local raw evidence and verifier scripts: `/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/android-ocr-continuity-2026-10-23/`. `durable-readback-report.json` maps exact Azure keys to locally retained objects. Portable receipts are also in the uploaded manifests and this directory's JSON reports.

## Protected services and handoff

[Protected audit](protected-audit.json): seven existing Maps workload specs and15 ConfigMap data hashes unchanged. Android production stays suspended on its previous image; Web/UI and shared SEO source remain unchanged. No production schedule/resource/image change, gate/claim deletion, automatic rerun, GitHub push/merge or full-catalog/concurrency acceptance occurred.

[Final validation](final-validation.json) is the machine-readable outcome. Continue from the exact rating boundary while retaining command logs; require complete KEKE acceptance before promoting the Android template. Previous OnlyBear success was not rerun here. See [handoff](../../../docs/android-ranking-repair-handoff.md).
