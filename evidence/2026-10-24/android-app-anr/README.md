# v30 native ANR diagnostics and two-worker verification

## Result

Source `2958f81d0855509ef2b87409183a280b2a726724`, ACR `ch15b8`, isolated Job/database `maps-android-v30-20261024`. **Full dual-worker acceptance failed.** Existing collectors were not promoted or changed.

- OnlyBear finished 2026-10-24 13:46:38 Beijing (01:46:38 New York), original exit0. `bubble tea garden city`: explicit list end,14 rows (1ad+13organic),19 successful OCRs, target display3/natural2. Exactly one search submission,527/527 journal commands recovered. No foreground ANR occurred during this successful search/capture.
- KEKE finished13:54:45 Beijing (01:54:45 New York), original exit1,0 search submissions/0OCR/0rows/null ranks. Fresh GPS matched and follow-state preparation succeeded at13:44:44.929; the mode later showed `Exit compass mode`, while snapshot readiness accepted only `Enter compass mode`. The ten-minute keyword budget was incorrectly reused by the location snapshot. The pending snapshot eventually returned `query_timeout`.
- Three independent live hierarchy reads were identical and showed the exact blank-home compass state. A separate ADB screenshot is diagnostic, not a simultaneous PNG/XML pair. The new v31 fix recognizes both native following orientation modes without clicking and bounds location snapshots to10s, respecting shorter deadlines and cancellation.

## Diagnostics and evidence boundaries

Four fixed read-only Android system commands were preserved before cleanup on both workers, all eight succeeded. `lastanr` reported no foreground record since boot, but `exit-info` records **background Maps startup ANRs before collection**: worker0 at01:41:02 New York, worker1 at01:43:59. These are distinct from the later successful OnlyBear search and KEKE viewport-state wait. The dumps do not prove disk/CPU contention caused the prior v29 dialog; that causal issue remains unconfirmed. Timestamp correlation is mandatory.

Independent Azure-login readback:126 objects,124 exact writer size/SHA receipts plus two service-size-only scan roots; no receipt mismatch.20PNGs decoded,82JSON and4CSV files parsed; two query records and14listing rows compared. Both Mongo observations match immutable manifests. Positive-ad visual review covered OnlyBear original frames1 and2: Sponsored Gong Cha display1/organic null, Smo Tea organic1, OnlyBear display3/organic2. This is a fresh observed ad example, not blanket proof for every future ad layout. Geography remains unverified at the Maps backend.

**Command-history limit:** OnlyBear527/527 commands were recovered. KEKE's unexpectedly long pre-search wait generated8,817 commands; only546 unique sequences survived bounded checkpoints (plus a bounded4MiB Appium tail). Do not claim complete KEKE command history. The v31 shorter wait reduces this path's exposure; full command recovery must still be checked afresh. Failed gate remains retained; no rerun reused its claim/database.

## Software and protection

v30:98files/1,879tests,326focused tests, contracts/typecheck/build and independent review passed. All105 protected checks were unchanged (seven workload specs and98pre-existing ConfigMaps). No daily/Web/UI/catalog/history/resource/schedule changes. Local commits only; no push/merge/promotion.

Full original evidence and helper scripts: `/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/android-app-anr-2026-10-24`.

Next: complete the isolated v31 two-worker gate, verify true overlapping capture, original exits, all writer receipts, database observations and command/OCR/system logs; preserve existing failures and distinguish broad capacity from this two-query sample.
