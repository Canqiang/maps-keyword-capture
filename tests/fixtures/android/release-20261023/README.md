# Native release regression evidence

Unmodified XML from the isolated Android release verification on 2026-10-23, Maps 26.41.03.993332563, Android 15, 720 x 1280.

- `keke-collapsed.xml`: `run_20261023T021606Z_de9623`, first capture for `braised food flushing`, a collapsed result sheet. Subsequent list gestures expanded the sheet and lost ordered overlap.
- `onlybear-suggestions.xml`: `run_20261023T021842Z_33ab33`, first capture for `bubble tea garden city`, still a focused editor with `typed_suggest_container`, not ranked search results.

Original PNG/XML receipts and manifests remain in `scan-consistency-release-2026-10-23` in the local evidence workspace and immutable Azure run prefixes. Tests pair the KEKE initial state with an explicitly synthetic transition to an existing expanded-sheet fixture; that transition is not claimed as device verification.
