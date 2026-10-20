# Linux x86_64 Android pilot runtime

Run these files **inside the dedicated Node 24 / Debian bookworm container**, with a writable 64 GiB PVC mounted at `/runtime`. They do not create a node pool, PVC, Pod, Service, device plugin, role assignment, or cloud upload. Do not run the install/start commands on the development Mac. Installation, Android boot, Maps availability, a real result screenshot, and collector acceptance are separate gates.

## Verified pilot state — 2026-10-16

The authorized private AKS pilot established KVM on one `crawler` node (`Standard_F4as_v7`, taint `maps-capture=android:NoSchedule`). Namespace `android-maps-pilot` contains the dedicated Pod and 64 GiB PVC. Host and container `/dev/kvm` checks, API version 12, VM creation, emulator acceleration, Android boot, exact installed-package readback and loopback-listener checks passed. The pilot Pod has a four-hour deadline, no mounted service-account token, no service credentials, and no Service/Ingress or host networking. It uses `privileged: true` as a temporary KVM access mechanism; that grants broader device access than the `/dev/kvm` mount and is not a production isolation design.

Maps manual search and original PNG/XML capture passed after the official app update described below. The initial v1 pilot used one manually prepared observation point per run. Adapter v2 adds automatic clearing, fresh GPS receipt gating, native recentering and a separate pre-search PNG/XML at every task. See the [capture contract](../../../docs/android-maps-node.md) and [pilot evidence record](../../../evidence/2026-10-16/android-maps/README.md) for the actual validation scope; Google's backend location and numerical ranks remain unverified.

## Pinned official packages and license

`packages.lock.json` was selected from Google's live stable repository metadata on 2026-10-16. It pins Linux command-line tools 22.0, platform-tools 37.0.1, emulator 37.2.12, and `system-images;android-35;google_apis_playstore;x86_64` revision 9. Command-line tools 22.0 matches the official download page's published SHA-256 and the earlier tested tools version; the repository also lists 23.0, which is not silently selected.

All four Linux packages use **`android-sdk-license`**. The x86_64 image's license text SHA-256 is `1f8729233617b193fd619213792ae16a41b95d2bbbf525dfe66998252ba68b16`, identical to the existing ARM host lock's accepted Android SDK agreement. This image does not reference `android-sdk-arm-dbt-license` or `intel-android-sysimage-license`. The `--sdk-license-accepted` flag records the operator's assertion of that already obtained approval. The script rechecks exact current license text and stops on drift. It never runs `yes`, `sdkmanager --licenses`, or automatically accepts another agreement.

Downloads go directly to `/runtime/downloads`. Every ZIP is checked against official repository size/SHA1; command-line tools additionally require Google's published SHA-256. Other SHA-256 values in download receipts are local computed digests, not independently published official expected values. Archive extraction preserves executable bits, rejects traversal/special files/duplicate paths, prevents writing through symlinks, and validates the complete symlink graph before installing. The installed `source.properties` and official SDK Manager `--list_installed` must independently match every pinned revision. Existing destinations without matching receipts are preserved and cause a stop.

Direct ZIP extraction does not register the generic command-line-tools/emulator packages with SDK Manager. After archive receipts and exact `Pkg.Path`/`Pkg.Revision` checks pass, the bootstrap creates their missing `package.xml` from the freshly verified official package/license metadata, preserving the generic XML type namespace. It leaves existing metadata untouched and still requires SDK Manager to report all four exact package paths and revisions. Metadata registration does not replace archive verification. Repository XML snapshots, registration hashes, and SDK Manager stdout/stderr are retained in `/runtime/receipts/` so a missing-package gate remains diagnosable.

Sources: [SDK packages](https://dl.google.com/android/repository/repository2-3.xml), [Google Play image packages and terms](https://dl.google.com/android/repository/sys-img/google_apis_playstore/sys-img2-3.xml), [command-line tools SHA-256](https://developer.android.com/studio), [SDK Manager](https://developer.android.com/tools/sdkmanager), [emulator options](https://developer.android.com/studio/run/emulator-commandline), [acceleration requirements](https://developer.android.com/studio/run/emulator-acceleration).

## Prepare and install

From the repository root inside the container, root installs the exact Debian package names listed in `prerequisites.sh`. Runtime scripts themselves do not invoke apt or elevate privileges.

```bash
bash deploy/android/linux/prerequisites.sh
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export MAPS_ANDROID_ROOT=/runtime
python3 deploy/android/linux/bootstrap.py --root /runtime install --sdk-license-accepted
python3 deploy/android/linux/bootstrap.py --root /runtime create-avd --small-screen
```

Fresh installation requires 20 GiB free. Extraction separately budgets each uncompressed archive plus 4 GiB; initial boot budgets the 6 GiB userdata, 512 MiB SD-card allowance, and 4 GiB reserve. Verified ZIPs are retained for review. Avoid lowering disk guards to fit a full volume. No unrelated files are deleted. A bootstrap file lock prevents overlapping installers. A failed partial download can be redownloaded under that lock; an existing installed directory with an incomplete receipt must be inspected before any repair.

The AVD name is `maps-google-play-api35-x86_64`, with 2 guest CPU cores, 3072 MiB RAM, and 6 GiB userdata. `--small-screen` selects 720×1280 at 320 dpi; omitting it selects 1080×1920 at 420 dpi. `create-avd` answers only `no` to the custom hardware-profile prompt. It refuses an existing AVD and never wipes userdata.

## Boot and check the actual device

The container needs usable `/dev/kvm` **and device-cgroup permission**. A hostPath mount alone is insufficient. Before any emulator process starts, the launcher requires character device `10:232`, opens it, checks KVM API version 12, creates and closes an empty VM descriptor, and runs the installed emulator's `-accel-check`. This still does not prove Android boots.

```bash
python3 deploy/android/linux/runtime.py --root /runtime --boot-timeout 480
```

This is a foreground supervisor; keep it running in its own container exec session. It uses hardware acceleration `on`, software GPU `swiftshader`, no window/audio/snapshots, 3072 MiB RAM, two guest cores, and `America/New_York`. It waits at most 480 seconds for the selected AVD's `sys.boot_completed=1` and responsive package manager. It then checks ADB/emulator/gRPC control ports for loopback listeners, records properties, Maps package dump/path and actual screen size, and remains alive with the emulator. SIGTERM/Ctrl-C terminates only its own emulator. Failed readiness also terminates that process and preserves logs.

Inspect `/runtime/logs/emulator.log`, `/runtime/receipts/linux-runtime.json`, `properties.txt`, `mapsPackage.txt`, `mapsPath.txt`, `screenSize.txt`, and `screenDensity.txt`. `status=android_booted` proves this boot gate only. The presence of a Maps package is not a validated Maps screen or ranking. Check the original system app from the verified Google image and read back the effective package version/installer after any official update. Capture and inspect actual PNG/XML before selecting collector UI controls.

All control traffic is local: ADB `127.0.0.1:5037`, emulator console/ADB `5554/5555`, token-authenticated gRPC `8554`, and Appium `127.0.0.1:4723`. Do not publish Services, host ports, or ingress for them. Emulator guest network egress remains necessary for Maps. The configured timezone/locale, guest GPS fix, and cloud egress each describe different observation conditions; they do not establish Google's ranking location.

ADB daemon startup uses `adb start-server` with endpoint/device environment overrides removed, so ADB uses its default localhost listener. Pinned adb 37.0.1 refuses to create an absent daemon when given an explicit `-H 127.0.0.1` or `-L tcp:127.0.0.1:5037`, treating it as remote. Subsequent device commands retain explicit loopback host/port and serial, and the runtime still verifies actual listeners before declaring readiness.

The Linux runtime and Appium wrapper pin `ADB_VENDOR_KEYS` to `/runtime/user/adbkey`. The launcher generates this identity once if absent and preserves it with mode `0600`, alongside persistent emulator userdata. A container-local default ADB key can otherwise differ after Pod recreation and leave the retained guest unauthorized. Never copy the private key into logs, evidence archives, or source control.

Start the supervisor first. Wait for **this launch's** `linux-runtime.json` to report `android_booted`, with its matching live emulator PID, before starting Appium, doctor, or a capture session. Kubernetes Pod Ready and an old PVC receipt are insufficient. `adb start-server` does not reload an already running daemon's identity; if an earlier wrong daemon exists, diagnose it and restart only this dedicated Pod's loopback ADB server after stopping owned sessions. Do not start Appium and runtime bootstrap concurrently.

The listener check recognizes native loopback and IPv4-mapped loopback such as `[::ffff:127.0.0.1]`, used by the emulator's gRPC listener. Mapped nonlocal addresses and all wildcard/unspecified listeners remain rejected; ADB and emulator ports `5037`, `5554`, and `5555` must still be present.

## Official Maps update required by the observed image

The pinned API 35 revision 9 image shipped Maps `11.129.0103` at `/product/app/Maps`. On this pilot it displayed the map and GPS blue dot, but entering a search crashed with `java.lang.UnsatisfiedLinkError: dlopen failed: library "libelements.so" not found`. Archive integrity and successful boot did not detect that app-level failure.

The operator followed [Google's account-free update instructions](https://support.google.com/maps/answer/9878013?hl=en): open the Maps listing in the Play Store app, use the sign-in screen's Options/More menu → Updates, and select Update for Maps only. The Install path leads to sign-in and is not this flow. No Google account or third-party APK was used. Package readback then showed effective Maps `26.41.03.993332563`, installed by `com.android.vending`, and manual native searches succeeded. Preserve both package dumps, the crash log, and update-screen PNG/XML; the repository's system-image pin does not pin a later Play-delivered app version.

An API 36 image experiment was prepared outside the default deployment as a fallback, but it was not installed or booted. It is not needed to explain the successful API 35 app update.

## Appium and collector

The Linux wrapper reuses `../appium.lock.json` and `../appium.sh`: Appium 3.8.0 and UiAutomator2 8.7.0 with existing integrity validation. Node 24 and npm ≥10 satisfy the pinned engines. The wrapper supplies the Linux JDK path and `/runtime` root.

```bash
bash deploy/android/linux/appium.sh install
bash deploy/android/linux/appium.sh doctor
bash deploy/android/linux/appium.sh start
```

The collector OCRs every result screenshot with `deploy/android/linux/screen_ocr.py`; `prerequisites.sh` installs Tesseract with the `eng`, `chi_sim` and `chi_tra` packs and Pillow for it. Use an explicit collector `adbPath=/runtime/sdk/platform-tools/adb`, serial `emulator-5554`, and Appium URL `http://127.0.0.1:4723`; keep outputs on the PVC. Read back actual locale/timezone before collecting, because the collector expects `en-US` and `America/New_York`. ADB readiness and Appium `/status` do not create or validate a UiAutomator2 session. First session setup may exceed the collector's default 30-second command timeout; inspect/prewarm it separately and check for an orphan server session before retrying. Unknown UI selectors or first-run screens remain review failures. Two actual Maps 26.41 fixtures now support a narrow screenshot-only results-panel check; this does not reconcile merchant identities or advertisement coverage. Numerical ranks remain `not_evaluated` until a real app reconciler is accepted.

## Local verification

```bash
python3 -m unittest discover -s deploy/android/linux -p 'test_*.py'
python3 deploy/android/linux/bootstrap.py --root /tmp/maps-linux-metadata-check verify-repository
```

These test archive safety, checksum rejection, installed-revision checks, KVM file-type rejection, process exit handling and bounded readiness without running Android. A metadata match on the Mac is allowed and downloads only the small repository XML documents. A Linux boot or live Maps result cannot be claimed from these checks.
