# v33 Android representative concurrent capture — passed

The isolated two-worker verification passed on 2026-10-24. This accepts two representative keyword/center samples, not the full nine-store two-hour schedule. Production Android remains suspended; existing daily/Web/UI workloads and shared keywords/history were not changed.

## Repair and regression proof

Original v32 KEKE frames 1→2 and 4→5 contained the same Nong Geng Ji card but uncertain Chinese OCR changed to Latin fragments. Three clean English prefix words, native control movement, word boxes and unique 4.6/546/category/price/distance metadata agreed; strict lexical overlap still rejected it. Recovery then exhausted the one-time panel restart.

The v33 fallback is restricted to that corroborated native-control path. It requires three prefix words with confidence at least 80 moving with the native controls. An uncertain script box must match either a high-confidence Chinese box or a uniquely matching very-low-confidence punctuated reading. Digits, Roman branch suffixes (including #III/#IV), confident changed words, contradictory motion, ambiguous identity and ad classification still reject the match. No brand aliases, extra searches or increased recovery budget were added.

The original receipt-verified fixture fails before the fix and passes after it. Independent review found a punctuated Roman-suffix exclusion missing on one side; both sides and the CJK-counterpart path now reject it. Fifteen focused new tests passed independently. The full focused group passed 73 tests; the full suite passed 100 files / 1,915 tests, plus contracts, typecheck and build. Eight XML/OCR fixture Git blobs retain their original receipt hashes; `.gitattributes` prevents XML newline normalization.

**Proof boundary:** replaying the fresh v33 selected frames with baseline v32 also yields complete 20/13 rows. This fresh run proves concurrent native acceptance, not recurrence of the exact low-confidence corruption. The new fallback is proven by the immutable original regression. No rating reread changed a fresh v33 frame.

## Runtime identity and outcome

- Runtime source: `6cf43d39997db04da82eee635c04566ddaa71a64`; repair commit: `8a09846`.
- ACR build: `ch15bb`; digest: `sha256:accac5a72cfc69f1b47ab3eb758c1b66aede231770dd4ddc68e0ea37a96d155e`.
- Listing method: `full_screen_ocr_native_context_ordered_overlap/v33`.
- AKS context `FBRDevAKSCluster`, namespace `android-maps-pilot`, isolated Job/database `maps-android-v33-20261024`.
- Same crawler resource envelope and worker stagger. Both actual image IDs/source/worker roots verified; no restarts; both original tracking exits 0.

| Worker / query | Result | Target display / organic | Finished Beijing / New York | Capture evidence |
| --- | --- | --- | --- | --- |
| KEKE / `braised food flushing` | Complete configured first 20 organic rows; `target_reached` | 1 / 1 | Oct 24 14:43:04 / 02:43:04 | 50 query PNG/OCR attempts, 48 selected frames, 1 location PNG |
| OnlyBear / `bubble tea garden city` | 13 organic rows, explicit `list_end` | 2 / 2 | Oct 24 14:40:10 / 02:40:10 | 16 query PNG/OCR attempts, 16 selected frames, 1 location PNG |

KEKE did **not** exhaust the Google Maps list. Two bounded overlap corrections retained discarded frames 26 and 27; frame 28 restored overlap without a sheet restart. Both searches were submitted exactly once. Actual search/capture overlap was **83.052 seconds**. All 66 OCR attempts succeeded: no primary/optional timeout or process failure; maxima 2.693 s / 2.080 s. All 1,675 command sequences were recovered (1,168 / 507), with zero failed commands. Raw Appium tails are separately retained with their 4 MiB bound; the complete structured journal is the command-coverage proof.

Both database observations and evidence match their manifests. The isolated round gate is inactive with both workers finished. Same-source selected-frame replay exactly reproduces the writer listings.

## Independent evidence verification

Azure account `fbrdevstorage`, private container `maps-keyword-capture-uat`:

- `android-maps/2026-10-24/run_20261024T063746Z_a6fe3e/`
- `android-maps/2026-10-24/run_20261024T063746Z_2f3ff4/`

Independent Azure CLI login downloaded **374 objects**. All **372 exact writer size/SHA-256 receipts** match; two additional scan-root objects have service-length validation and computed hashes, without original writer receipts. All referenced artifacts are present. All **68 PNGs** decode; **234 JSON** files parse; four CSV files match the two query / 33 listing rows checked.

Visual review covers **11 original PNGs**, not all 68: both first/last frames and native location views, KEKE discarded/recovery frames 26/28, rating frame 31, and no-review frames 39/40. First cards, Longjiang 4.1/18, Ji You's explicit no-review state and OnlyBear's end footer agree with the sampled evidence. See [visual-review.json](visual-review.json) for exact object keys and hashes; automatic image selection is not a claim that every selected image was viewed.

Full logs, screenshots, XML/OCR, immutable command journals, worker runtime audits, resource samples, protected-service comparisons and database readback are retained at:

`/Users/xander/.codex/visualizations/2026/09/17/01a0ad00-ac77-7b61-93d6-b789dc702448/android-low-confidence-script-2026-10-24`

Compact reports: [outcomes](outcome-audit.json), [software validation](validation.json), [final scope](verification.json), [Azure readback](readback-summary.json), [structure/CSV checks](structure-readback-report.json), [OCR diagnostics](ocr-diagnostics-audit.json), [baseline comparison](baseline-comparison.json).

## Protection and remaining acceptance

All **111 protected checks** are unchanged: seven workload specs and 104 pre-existing ConfigMap data hashes. No schedule, resource, keyword/catalog, historical observation, production image or existing gate was modified. Candidate code/evidence are locally committed; no push, merge or production promotion in this follow-up.

No ad appeared in v33. The separately verified v30 positive example has one ad + 13 organic rows and target display 3 / organic 2; it is historical evidence from that version, not a fresh positive v33 case. Keep positive-ad acceptance explicit before broader promotion.

All eight final read-only system diagnostic calls completed. Background startup ANR records precede the searches (worker 0 New York 02:34:48.420; worker 1 02:37:45.419). They do not establish foreground search failure or resource causality; broader startup reliability still needs observation. GPS/native home receipts do not independently prove Google backend locality; geography remains unverified.

Next release gates are full-catalog/two-hour capacity, representative positive-ad coverage on the release candidate, and explicit geographic acceptance. Do not extrapolate these two successful queries to the full nine-store workload or silently enable the suspended production Android schedule.
