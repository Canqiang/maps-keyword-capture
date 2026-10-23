# Native release regression evidence

Unmodified XML from the isolated Android release verification on 2026-10-23, Maps 26.41.03.993332563, Android 15, 720 x 1280.

- `keke-collapsed.xml`: `run_20261023T021606Z_de9623`, first capture for `braised food flushing`, a collapsed result sheet. Subsequent list gestures expanded the sheet and lost ordered overlap.
- `onlybear-suggestions.xml`: `run_20261023T021842Z_33ab33`, first capture for `bubble tea garden city`, still a focused editor with `typed_suggest_container`, not ranked search results.

Original PNG/XML receipts and manifests remain in `scan-consistency-release-2026-10-23` in the local evidence workspace and immutable Azure run prefixes. Tests pair the KEKE initial state with an explicitly synthetic transition to an existing expanded-sheet fixture; that transition is not claimed as device verification.

Second-candidate late-scroll fixtures: `keke-frame-36.json` / `keke-frame-37.json` are unmodified screen-reader frame artifacts from isolated scan `android_scan_20261023T025952Z_d6e983`, candidate source 24bd4b7. Independent Azure CLI readback verified all 174 objects / 172 exact writer receipts. PNGs and OCR/XML companions remain in the durable `android-search-scroll-2026-10-23/candidate1` evidence directory. Visual inspection shows the same merchant and review snippet moving about 304 px; rating separators differ while rating/count/price/category remain identical. Tests mark the pair's first frame top-verified only to isolate joining behavior, not to claim the original frame 36 was the list top.

Third-candidate fixtures: unmodified `keke-solo-01..03.{xml,ocr.json}` from `run_20261023T034223Z_316b51` (22 Azure objects/21 receipts independently verified); `onlybear-footer.{xml,ocr.json}` from `run_20261023T033523Z_f3634d` frame017 (126 objects/124 receipts for that two-worker round). Original PNGs remain in immutable Azure prefixes and durable local readback. The near-top Woodam frame remains locally unknown after normalization; only reconciliation with the previous full card proves organic identity.

Native XML content is captured from the real runs; Git may normalize CRLF to LF. Byte-exact originals and their receipts remain in the durable Azure/local readback evidence.
