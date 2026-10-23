# Android v23 OnlyBear, advertisement and two-worker acceptance

**Release gate remains blocked.** Same image/source as the prior complete KEKE Top20 sample was used throughout; runtime code, retry limits, Android production schedule and shared keyword catalog were not changed. OnlyBear completed twice. The two-worker Job did not establish concurrent search acceptance because worker0 failed before worker1 started searching.

## Fixed provenance and isolation

- Runtime source: `bd894e7f9c6e69f98bd06f40bba7eeb2b56d7f09`.
- Image: `sha256:8220c787f89e9c370122e73e42a17945dc09e3d5e8ac3e90a26a43c1b138df53` (existing ACR build `ch15ad`; no new build).
- Listing method: `full_screen_ocr_native_context_ordered_overlap/v23`; profile hash `70fa013fb847eab1bd9749328f7100f88fe58cf635f0b62bd841efbe366abf5d` reconstructed for each new manifest.
- Context `FBRDevAKSCluster`, namespace `android-maps-pilot`, dedicated node `aks-crawler-16703113-vmss000004`. Exact source was read from each runtime, actual imageIDs matched, all container restart counts0.
- Fresh databases/Jobs: `maps-android-onlybear-v23-20261023` (one worker) and `maps-android-dual-v23-20261023` (Indexed workers0/1). Source stores were read from the current catalog and copied with their existing center points, one keyword each. Existing catalog and observations were not written.

## Actual results (Asia/Shanghai, 2026-10-23)

| Run | Search interval | Original exit | Result |
|---|---|---:|---|
| OnlyBear standalone |15:18:50–15:21:20|0|`bubble tea garden city`; explicit list end;12 organic,0 ads/unknown; target display2 / organic2.16 retained ranking PNGs,15 selected plus one correction frame;1 location PNG.|
| Two-worker index0 / KEKE |15:24:39–15:25:23|1|`braised food flushing`; failed post-submit native element read;0 accepted rows, target rank null;1 diagnostic PNG +1 location PNG.|
| Two-worker index1 / OnlyBear |15:27:14–15:29:39|0|Same query/center; explicit list end;12 organic,0 ads/unknown; target display2 / organic2.17 retained ranking PNGs,16 selected plus one correction frame;1 location PNG.|

The original two-worker Job is Failed. Worker roots `/runtime/monitor-workers/0` and `/runtime/monitor-workers/1`, Pod IPs and assignments are distinct. Both worker summaries have frozen catalog SHA `1662301865d30e9536a8d7b1e0aae9d0728aa46858144e14ce83cf241524763e`; KEKE and OnlyBear assignments are disjoint and exhaustive for this test. Both worker indexes were admitted exactly once.

**Tracking-process overlap is0seconds.** Worker0 runtime sidecar terminated15:25:26; worker1 emulator boot began15:25:35 after the existing180-second cold-start stagger. Therefore this failure is not evidence of two active emulators exhausting capacity, nor does scheduling both Pods prove concurrent operation. Sampled node metrics reached1428m CPU and6824Mi memory; those samples are not full concurrent capacity or peak-load proof. No OOM, unexpected restart or scheduling-resource failure was observed.

## Confirmed failure, evidence and expected fix

At15:25:18.893 worker0's single `mobile:performEditorAction` succeeded (command115). Result-state observation then called `POST elements` (117,2483ms), followed by `GET element/displayed` (118). Command118 failed at15:25:21.686 with HTTP404 / W3C `stale element reference`. Appium's retained raw log identifies `com.google.android.apps.maps:id/search_omnibox_text_box` as no longer present in its cache/DOM. The diagnostic PNG at15:25:22.463 already shows the exact query and KEKE result in a partially expanded sheet.

The code path is `src/android/device.ts`, post-submit `search()` → `searchField()` → per-element `GET displayed`. A transient invalid native handle currently becomes a terminal `APPIUM_PROTOCOL_ERROR` before settled native-source evaluation and sheet expansion. IME restoration, diagnostic capture, command checkpoint publication and DELETE session cleanup succeeded. This is a newly evidenced stale-read race; do not retroactively label all historical protocol failures with the same cause.

Expected next repair:

1. Handle a stale reference specifically while **observing post-submit state**. Drop the invalid handle and obtain fresh Maps-owned exact-query native evidence within the existing deadline/observation budget.
2. Keep single-submit behavior. Never resend the editor action, change the query/location, assume a successful search from a stale read, or add generic transport retries.
3. Preserve blocked/consent/wrong-query/ambiguous-layout failures and record each failed/read-recovery command. Exhausted/repeated stale state remains an honest failure.
4. Add regression tests for one stale read then valid results; repeated stale budget exhaustion; changed/ambiguous query; unrelated protocol error; and uncertain submission that must not be repeated. Distinguish read-only reacquisition from mutation retries.
5. Rebuild a separately versioned candidate, repeat single-query acceptance, then demonstrate **positive overlapping search/screenshot intervals** for workers0/1 with both original exits0 and independent storage/database readback. Only then proceed to full-catalog/capacity release gates.

No runtime repair was slipped into this same-version validation. Failure details and adjacent allowlisted commands are in `dual/failure-diagnosis.json`.

## Advertisement verification: live absence vs positive historical replay

Neither fresh OnlyBear run displayed an ad. A fresh positive v23 ad exposure is therefore **not established**. The current parser was separately replayed against the original receipt-checked OnlyBear run `run_20261023T040540Z_de9155`:17 selected frames,13 listings =1 ad +12 organic. The Sponsored Gong Cha screenshot was visually reviewed again. Current v23 exactly reproduces all stored listings: ad display1 / organicRank null; Smo Tea display2 / organic1; OnlyBear display3 / organic2. The later organic Gong Cha occurrence stays separate despite OCR spelling noise (`Cong Cha`).

All72 retained PNG/XML/OCR/frame objects in that historical18-screen sequence were freshly checked locally against their original bytes/SHA receipts. The original Azure download was verified earlier; this is **historical raw-artifact replay, not a new v23 device capture or fresh Azure download**. Existing advertisement/unknown/native-label and shard snapshot regression suites were run this turn:4 files /71 tests passed. Historical full1,796-test validation is not represented as rerun here. No runtime source changed.

## Independent verification and retained logs

| Scope | Azure objects | Exact writer bytes/SHA receipts | PNGs decoded | XML / JSON parsed | CSV comparison |
|---|---:|---:|---:|---:|---|
| OnlyBear standalone |82|81|17|17 /46|2 CSVs,1 query,12 listings|
| Two-worker run |102|100|20|20 /58|4 CSVs,2 queries,12 listings|

All receipts match; zero missing-reference/hash errors. The three top-level tracking scan roots have service-length validation only, not external exact writer digests. Azure CLI login identity was used, separately from collector SAS. Both successful sequences replay exactly with verified order/classification/coverage; failed KEKE has no selected OCR ranking frames, so ranking replay is explicitly not applicable.

All per-session command sequences are recoverable from overlapping immutable Azure checkpoints:462 for standalone OnlyBear,128 for failed KEKE (one failure, command118),471 for two-worker OnlyBear (zero failures). Combined1,061 entries across three sessions. Raw local Appium tails are additionally retained and bounded; checkpoint completeness is the durable verification basis, not an assertion that every raw tail captures every line. Fresh visual sample scope:3 solo PNGs and4 two-worker PNGs, plus1 historical ad PNG; full hash/structure checks are broader than visual sampling.

A separate read-only database verifier checked all3 stored observations against manifest ranks, query identity, profile and exact screenshot/manifest links. Failed KEKE is stored as failed with null rank; neither screenshots nor persistence turned it into a successful observation. OnlyBear's standalone gate is inactive/finished[0]. The isolated dual gate remains active/finished[1] after worker0's protocol failure, with exactly two worker admissions. The Job and both runtime containers are terminal, but **no retained gate or lock was cleared**. Review its disposition explicitly; do not reuse the failed round or clear production gates to bypass it.

## Storage and service protection

Azure account/container: `fbrdevstorage/maps-keyword-capture-uat`.

- Solo: `android-maps/2026-10-23/run_20261023T071850Z_2b42a1/`
- Dual KEKE: `android-maps/2026-10-23/run_20261023T072440Z_ba374f/`
- Dual OnlyBear: `android-maps/2026-10-23/run_20261023T072714Z_517439/`
- Tracking prefixes are recorded in each `readback-report.json`; observation `scanId` follows the manifest run ID contract, distinct from the outer tracking scan ID.

Full original logs, readback files, worker proofs and verifier scripts are at `/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/android-v23-onlybear-concurrency-2026-10-23/`. Original report `local` paths refer to temporary download destinations; durable copies use the same `readback/<sha256>` layout under `onlybear/` or `dual/`. Raw server logs are kept locally, not committed into the repository.

Before/after comparisons match all7 protected Maps workload specs/UIDs and82 pre-existing ConfigMap data hashes. Web/UI/daily collectors are unchanged; Android production remains suspended on its existing image. No source keyword/library/history changes, production deployment, GitHub push, Job deletion, worker-lock clearing or automatic rerun occurred. Geographic status remains `unverified`; ranks describe these observed queries/points and do not prove customer-device/radius-wide ranking.
