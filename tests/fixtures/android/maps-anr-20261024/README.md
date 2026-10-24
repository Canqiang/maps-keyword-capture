# Google Maps system ANR fixture

Original hierarchy from the isolated v29 OnlyBear `bubble tea garden city` search at 2026-10-24T05:11:18.558Z. Captured after exactly one successful IME submission. The Android system modal says "Maps isn't responding" and offers Close app / Wait; neither action was taken. The underlying list is not rankable while this modal is present.

Source: `/tmp/maps-android-v29-20261024/onlybear-early/20261024T051118.558Z__bubble-tea-garden-city__01.xml` (also retained in the durable v29 evidence directory).
Original SHA-256: `f382f833fd4da197df5ec7282e57cf109f393f9ab88a15c4e570f7a264df7059`.

Tests cover exact system-owned modal recognition, wrong-app/ownership/control negatives, search rejection without resubmission, and paired diagnostic-only snapshots during capture. This fixture proves modal handling, not the cause or repair of the native application's ANR.
