# UAT registry isolation — 2026-09-28

## Problem and authorized scope

The September 25–28 nightly runs failed before any keyword/browser dispatch because two source records assigned the George Merchant place to different merchant IDs. The user confirmed on September 28 that George is a test store and should not be captured. The fix excludes that exact place (`ChIJqVId_y1ZwokRjPCG1MQuKmg`) with reason `test_store`; it does not modify or delete database records.

Other duplicate or conflicting places are quarantined as complete groups instead of stopping unrelated stores. Configured test exclusions are normal scope. Unresolved quarantine remains a visible partial/incomplete result with exit 2. Invalid alias configuration, database/record/store bounds and storage failures retain the global stop boundary. A nil merchant UUID is invalid and excludes the known placeholder record.

## Local and source verification

Typecheck, build and all 468 tests in 38 files passed under Node 24. Regressions were observed failing before the implementation. The live read-only source replay found 18 source records: 10 eligible stores, 8 excluded records (two configured George records, one nil-ID placeholder and five unlinked legacy records), zero quarantines. All ten per-place API reads passed identity validation and selected 350 words in 18 production-cap batches. Royal Queen selected 40/59, CONNEXION SPA 32/32, Szechuan Opera 18/18 and SEEJOY 40/70. This preflight establishes current source selection, not browser or nightly acceptance.

## Release status

The first v4 smoke selected and attempted all 20 queries across 10 stores, with zero source failures or quarantines. It ended with 18 ranked captures, one geographic detail and one classification-unknown query (`float`), so the original Pod exit is 2 and this run is not complete collection acceptance. All 164 referenced objects independently passed Azure-login size/SHA and structural/semantic verification. The two unknown rows are strict-format House/Lodging variants supported by screenshot evidence. A separate v5 repair and smoke are pending; the original evidence and result remain unchanged.

The initial 500m manual smoke could not schedule because eligible aiapp nodes had 181–381m unreserved CPU. It was removed only after proving no application container started and retaining its evidence. The replacement smoke requests 250m CPU (unchanged 2 CPU limit and memory/storage settings), scheduled and executed normally. The same profile is proposed for daily deployment. Cluster promotion and final acceptance are still pending; full nightly throughput remains a separate boundary.
