# Nine-store fixed-point monitoring deployment

**2026-10-22:** `maps-targets-web-2h` (uat) runs every three hours and `maps-targets-android-daily` (android-maps-pilot) once a day; both read stores, monitored keywords and points from Mongo `monitor-target-stores-v1` (the UI settings page). Android uses `android-configmap.yaml` (`android-tracking.json`: Android skips best variants) and the Secrets `maps-targets-source` / `maps-targets-storage`, copied from the uat Secrets `maps-keyword-monitor-source` / `maps-keyword-monitor-storage`. Scheduled Android scans use the capture profile proven on the verification Pod (`VERIFIED_CAPTURE_PROFILE`: Top 20, 90 screenshots, 89 gestures, 10 min, OCR scale 3 / 30 s).

Originally these were **suspended candidate templates**. They add `maps-targets-web-2h` in `uat` and `maps-targets-android-daily` (formerly `maps-targets-android-2h`) in `android-maps-pilot`. Neither template changes `maps-tracking-web-2h`, the legacy daily monitor, shared SEO keywords, or existing observation documents.

The exact approved catalog is `liya-90-v1.json` (90 merchant/query pairs, 27 explicit center/3 km/5 km points). Each surface schedules 270 searches per round. Two balanced whole-store shards carry 138 and 132 searches. The fixed points are not radius coverage or a 25-point grid. Both candidates use `15 */2 * * *`, `America/New_York`, `Forbid`, and a 6,600-second active deadline. The 15-minute offset avoids starting at the same minute as the old Web collector. A two-hour schedule is not a throughput guarantee; live completion time and pending resources must be checked before unsuspending.

## Frozen execution catalog

In **each namespace**, create the same ConfigMap named `maps-targets-liya90-v1-476d4c50`, containing the exact `tracking.json` and `liya-90-v1.json` files in this directory, and set `immutable: true` at creation. Do not overwrite a previous version. The catalog SHA-256 is:

```
476d4c506730f165951e505ee59c9ed27e6157313d87728b75679678e940068c
```

Both indexed Pods pass `--catalog /config/liya-90-v1.json --catalog-sha256 <hash>` to the actual **scan**, not just the planner. The CLI reads those bytes once, validates the pin before dispatch, then assigns and executes its shard from that snapshot. It never reads mutable Mongo stores for this mode. A changed/missing pin fails before capture. Future catalog changes require new immutable ConfigMap names and matching hashes on both surfaces.

Each scan publishes those exact bytes as `<scan-prefix>/catalog.json` before browser/device activity. The terminal `scan.json` records the catalog version, byte length, SHA-256, storage receipt and shard store IDs; batch logs carry the same hash. Android task `sourceReference` also includes it in the immutable capture manifests. Persistence or selected-store mismatch prevents dispatch. The no-`--catalog` legacy Mongo path is unchanged.

Import archived identities into the isolated `monitor-target-stores-v1` collection before the approved catalog import, as described in `docs/tracking-live-history.md`. The catalog's store IDs must match those retained historical identities. Observations still append to `maps-rank-tracking.observations`; this catalog does not replace the old `stores` collection. Database ingestion alone does not prove historical screenshots are available: publish and independently verify the retained original evidence keys too.

## Images and credentials

Build on the remote build service/CI and push to ACR. Render `REPLACE_DIGEST_WEB` and `REPLACE_DIGEST_ANDROID` to the independently verified digest of the corresponding source build, including `IMAGE_DIGEST` environment entries. These placeholder files must not be applied unchanged. Kubernetes pulls the built image from ACR; it does not run directly from a Git checkout. A local Docker daemon or local image cache is unnecessary.

Web references the existing `maps-keyword-monitor-source` / `KEYWORD_MONGO_URI` and `maps-keyword-monitor-storage` / `AZURE_STORAGE_CONTAINER_SAS_URL` Secret keys in `uat`. Android requires separate namespace-local `maps-targets-source` and `maps-targets-storage` Secrets with the same key names. Only the nonprivileged main collector receives these two values. No credentials belong in the ConfigMap, image, template, command line, or committed evidence.

## Android isolation and prerequisites

The Android node must have `envpool=crawler`, the `maps-capture=android:NoSchedule` taint, working `/dev/kvm`, and enough allocatable capacity for both Pods. Each runtime requests 1,500 mCPU / 5 GiB and its collector requests 150 mCPU / 512 MiB; the two steady Pods request 3,300 mCPU / 11 GiB total, plus existing node workloads. Limits are per container, and scheduling requests must be checked live.

The retained `android-runtime` PVC must already hold the pinned SDK and two separately verified worker clones under `/runtime/monitor-workers/0` and `/runtime/monitor-workers/1`. Each clone needs its own AVD, user/ADB identity, Appium state and `receipts/clone.json`; do not point both indices at one AVD or mutate the original runtime. The SDK is mounted read-only. The shared RWO PVC requires compatible placement on the crawler node. Native restartable init containers must be supported by the cluster.

A credential-free short init container prepares only ephemeral `/work` and `/tmp` permissions. No Pod-level `fsGroup` is set, avoiding recursive ownership changes on historical PVC contents. The restartable runtime sidecar starts `/app/deploy/android/linux/tracking_sidecar.py`, validates clone provenance, obtains the runtime lock and waits for its own freshly booted emulator and loopback Appium before creating `/tmp/android-ready`. Its startup probe gates the collector. The main container is non-root, has no KVM mount, mounts only `/runtime/sdk` read-only from the PVC, and writes capture artifacts to an `emptyDir` before durable Azure delivery. OCR uses the image's `/app/deploy/android/linux/screen_ocr.py`; `/runtime/sdk/platform-tools/adb` connects to the same Pod's loopback ADB service. No public ADB/Appium endpoint is created.

Run server-side manifest validation after replacing digests, validate runtime boot/cleanup, GPS receipts, real scrolling, ad classification, original PNGs, Mongo insertion and Azure hashes with a bounded manual Job first. Confirm both shards' catalog hashes, attempted denominator and completion time. Keep `suspend: true` until that acceptance succeeds. Exit 2 remains a partial evidence outcome; with no retry configured it must be reviewed rather than silently recaptured. Retain original logs and artifacts on failure.
