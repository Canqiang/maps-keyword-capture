# Native Google Maps Android host

This directory prepares an isolated Apple Silicon Android runtime for the native collector. It uses Google's Android Emulator and a Google Play ARM64 system image. The official Maps app must be inspected on the running device before a collection result can be accepted.

## Validation boundary

The development Mac is macOS 26.3.1 ARM64 with 16 GiB RAM, 10 logical CPUs, Apple Hypervisor support, and OpenJDK 25.0.2. Initial free space was 4.8 GiB; separately authorized cache cleanup reclaimed about 6.1 GiB in total. System swap also changes available disk, so installation stages use fresh budgets. Command-line tools 22.0, platform tools 37.0.1, emulator 37.2.12, and the Google Play ARM64 API35 revision9 image are installed and independently read back. Command-line tools passed SHA-256/SHA1 verification; the complete image passed its official repository SHA1 and SDK Manager recognition. Emulator version and Hypervisor checks pass. Appium 3.8.0 and UiAutomator2 8.7.0 are installed, with a previously verified `ready=true` localhost response; that server is stopped until a device is usable.

The human accepted both the Android SDK license and the Google Play ARM image's additional `android-sdk-arm-dbt-license` clause for this development validation. The dedicated AVD is configured, but its first boot is blocked by disk capacity. The emulator enforces at least 6 GiB of userdata for this image; our guard requires 10.5 GiB free for that allocation, a 512 MiB SD card allowance, and the 4 GiB reserve. Available disk was about 6.1 GiB at the last check. No userdata was created, and no emulator or Appium server remains running. No official Maps app availability, real-app screenshot, UI hierarchy, or ranking extraction has been validated. Setup never automatically answers a new legal prompt or runs a blanket `--licenses` acceptance.

`preflight`, repository metadata checks, and an Appium readiness response each establish only their own prerequisite. Consult the task's runtime receipts for the latest device-validation state.

## Isolated paths and prerequisites

The default root is `$HOME/.local/share/maps-android`. Override it with `--root /path/on/a/suitable/volume`. Existing global Android SDKs, shell profiles, Android Studio installations, and unrelated AVDs are not changed.

The pilot intentionally uses the shared local ADB server at `127.0.0.1:5037` to match the collector's current capabilities. Host commands clear ambiguity from an inherited ADB endpoint, and raw evidence capture checks the selected emulator's AVD name before writing evidence. No script kills the shared ADB daemon. The tool files and Android user directories are isolated; the ADB daemon itself is not.

| Path under the runtime root | Contents |
| --- | --- |
| `sdk/` | Command-line tools, platform tools, emulator, Google Play image |
| `user/` | Task-specific Android settings and emulator state |
| `avd/` | `maps-google-play-api35` device data |
| `downloads/` | Download staging; redundant verified ZIPs may be removed after installed-package readback |
| `receipts/` | Repository match, archive verification, installed versions |

Prerequisites: macOS ARM64, Apple Hypervisor support, Python 3, TLS-validating `curl`, `unzip`, and a working JDK. `JAVA_HOME` is preferred, with the existing Homebrew OpenJDK as a fallback. The script installs no JDK. Start with 15 GiB free at minimum; **25 GiB free is recommended** for extraction, image data, and ongoing screenshots. These are this project's operational budgets, not a claim about Google's minimum system requirements. The thresholds are configurable because a dedicated external volume or preinstalled runtime can have different needs.

## Reproducible package selection

`packages.lock.json` pins the official archive URL, compressed size, repository checksum, stable channel, license identifier, and retrieval time for each component:

| Component | Pinned version | Download checksum |
| --- | --- | --- |
| Command-line tools, macOS ARM64 | 22.0 / build 15859902 | SHA-256 `835b62a26162b229b441d1f6d4680383815a270809eb33522c0d480fa5002c4e`, plus repository SHA1 |
| Platform tools, macOS | 37.0.1 | Repository SHA1 in the lock |
| Emulator, macOS ARM64 | 37.2.12 / build 16428233 | Repository SHA1 in the lock |
| Google Play ARM64 image, API 35 | revision 9 | Repository SHA1 in the lock |

Command-line tools 22.0 is the version advertised with a SHA-256 on the official download page at inspection time. The repository also contains 23.0; the bootstrap does not silently advance to it. API 35 is a deliberate reproducible choice, not a claim that it is the latest Android API.

The script checks current official metadata against the lock before installing. It directly verifies the command-line ZIP with SHA-256, SHA1, and size before extraction. Runtime components are installed by the official SDK Manager, which performs its package archive checksum checks; this script additionally verifies installed package revisions. The receipt distinguishes these checks rather than claiming an independent SHA-256 check of runtime archives. If upstream metadata changes, setup stops for a reviewed lock update. Do not substitute a hash calculated from an untrusted download for an official expected hash.

For slow direct transfers, `fetch-archive.py` can prefetch a pinned archive using at most four simultaneous official HTTPS range requests. It requires explicit package-license approval, validates response sizes and the full official repository checksum after assembly, then records a local SHA-256. It reserves space for both parts and the assembled archive plus 4 GiB, and removes only its own completed range parts after verification. Prefetching alone does not install a package or validate a runtime.

After the Google Play ARM license is approved, the optional prefetch route is:

```bash
python3 deploy/android/fetch-archive.py 'system-images;android-35;google_apis_playstore;arm64-v8a' --license-accepted
python3 deploy/android/host.py install-image-archive --license-accepted
```

The second command serializes image installers, rechecks the full official checksum, rejects archive links and special files, checks declared unpacked size plus a 4 GiB reserve, validates the extracted package properties, and requires SDK Manager to independently recognize the pinned image package/revision. It refuses an existing image destination. Run it only after any other SDK Manager operation has finished. This path passed a real official image installation and SDK Manager readback in this task; preserve its success receipt before removing the download archive.

Primary sources:

- [Android command-line tools and published SHA-256](https://developer.android.com/studio)
- [Official SDK package metadata](https://dl.google.com/android/repository/repository2-3.xml)
- [Official Google Play image metadata and license text](https://dl.google.com/android/repository/sys-img/google_apis_playstore/sys-img2-3.xml)
- [SDK Manager](https://developer.android.com/tools/sdkmanager)
- [Android SDK terms](https://developer.android.com/studio/terms)
- [Android Emulator acceleration](https://developer.android.com/studio/run/emulator-acceleration)
- [AVD management and Google Play images](https://developer.android.com/studio/run/managing-avds)
- [Emulator command-line options](https://developer.android.com/studio/run/emulator-commandline)
- [Android environment variables](https://developer.android.com/tools/variables)

## Setup

Run from the repository root. The commands intentionally use the task SDK explicitly rather than changing the user's global `PATH`.

```bash
python3 deploy/android/host.py preflight --output /tmp/maps-android-preflight.json
python3 deploy/android/host.py verify-repository
```

Resolve reported blockers first. Do not lower the free-space guard merely to fit a multi-gigabyte image onto a nearly full disk. Use another suitable volume or arrange a separately approved cleanup. The script deletes no user files.

After the human has accepted the SDK license, run the following in an interactive terminal. `--sdk-license-accepted` records the operator's prerequisite assertion; it does not answer SDK Manager's package prompts.

```bash
python3 deploy/android/host.py bootstrap --sdk-license-accepted
python3 deploy/android/host.py create-avd
```

If the ARM image's additional license is still pending, install only the approved SDK tools first with `bootstrap --tools-only --sdk-license-accepted`. Run the full bootstrap after that license approval and a fresh disk check. Do not start parallel SDK Manager installations against the same SDK root.

The bootstrap checks space before downloading. It preserves a previously created AVD and refuses implicit recreation. `create-avd` answers `no` only to AVD Manager's custom hardware-profile question. It does not accept a legal agreement. A newly created device uses a 6 GiB userdata partition; smaller requests are raised to this minimum by the [official emulator implementation](https://android.googlesource.com/platform/external/qemu/+/emu-master-dev/android-qemu2-glue/main.cpp). Initial configuration refuses to resize any existing userdata.

Start the emulator in a foreground terminal; the default has no desktop window. The 4 GiB setting below is the reserve for an installed runtime. An additional allocation check requires **10.5 GiB free for a fresh device**, and accounts for physically allocated userdata on later starts. Sparse file length alone does not count as allocated capacity. `--window` enables a visible emulator if needed. Stop this foreground process with Ctrl-C after collection.

```bash
python3 deploy/android/host.py --min-free-gib 4 start-avd
```

Defaults: serial `emulator-5554`, 2 CPU cores, a 2 GiB guest RAM request (the pinned image raises it to 2.5 GiB), `America/New_York` timezone, no audio, no snapshot load/save, and metrics collection disabled. The selected timezone is an observation condition. It does not establish geographic location. The scripts do not set mock GPS coordinates or change the map center. Change a port only to an unused even emulator console port and use the matching explicit serial everywhere.

In another terminal, verify actual readiness:

```bash
"$HOME/.local/share/maps-android/sdk/platform-tools/adb" devices -l
"$HOME/.local/share/maps-android/sdk/platform-tools/adb" -s emulator-5554 shell getprop sys.boot_completed
"$HOME/.local/share/maps-android/sdk/platform-tools/adb" -s emulator-5554 shell pm path com.google.android.apps.maps
"$HOME/.local/share/maps-android/sdk/platform-tools/adb" -s emulator-5554 shell dumpsys package com.google.android.apps.maps
```

Require `sys.boot_completed=1`. Record actual Maps `versionName`/`versionCode`, installation path, package flags/installer, build fingerprint, OS version, locale, timezone, screen size, and visible state. A Google Play image's availability does not prove Maps is present. A package name alone does not authenticate its origin: prefer the Maps system app included with the verified official image, retaining its package dump and source image receipt. If Maps is absent or an account sign-in is required, stop and report that state. Do not download a third-party APK or sign in to a user's Google account to bypass the gate.

The collector should use this explicit adb executable and selected serial. To open the already installed app without submitting a query:

```bash
"$HOME/.local/share/maps-android/sdk/platform-tools/adb" -s emulator-5554 shell monkey -p com.google.android.apps.maps -c android.intent.category.LAUNCHER 1
```

Inspect the actual screen and handle any first-run terms or account prompts only within the applicable authorization. These host scripts do not click through first-run flows.

## Raw device evidence

Choose a new, empty output directory for every capture. This command records the current screen; it does not launch Maps, submit a keyword, or manipulate the viewport.

```bash
python3 deploy/android/host.py device-evidence \
  --serial emulator-5554 \
  --output /absolute/path/to/evidence/pilot-001
```

Outputs include the original `screen.png`, UI Automator `hierarchy.xml`, package details, installation path, installer, device properties, focused window, and `device-evidence.json` with file hashes. A missing app, failed screenshot, inaccessible hierarchy, or other missing check returns exit 2 and preserves the available diagnostics. A successful raw capture still requires visual inspection: a launcher, onboarding screen, error, or empty map is not a successful listing capture.

For collector acceptance, retain at least one real keyword result screenshot and its contemporaneous hierarchy, inspect the ad labels and listing order, compare parsed rows against that screen, and verify separate displayed positions and organic ranks. Do not promote synthetic XML fixtures or a successful adb connection to a real-app validation claim.

## Isolated Appium server

`appium.lock.json` pins Appium **3.8.0** and UiAutomator2 **8.7.0**, including the official npm tarball URLs and SHA-512 integrity values. `appium.sh` checks those metadata values, installs the server and driver under the runtime root, and retains npm's transitive dependency lock in `receipts/`. It uses the official npm registry explicitly, independent of the user's global npm registry setting. Node 25.6.1 and npm 11.9.0 satisfy the packages' declared engines; the existing OpenJDK is reused.

```bash
bash deploy/android/appium.sh install
bash deploy/android/appium.sh doctor
bash deploy/android/appium.sh start
```

The server binds only to `127.0.0.1:4723`, uses the native UiAutomator2 driver, and enables no relaxed-security features or automatic Chromedriver download. Override the root with `MAPS_ANDROID_ROOT` and the port with `MAPS_APPIUM_PORT`. The default URL for the collector is `http://127.0.0.1:4723`. Keep this foreground server running while collecting; stop it with Ctrl-C afterwards. Appium Doctor diagnostics and server readiness are prerequisites, not proof that a Maps session or keyword result was successfully captured.

References: [Appium requirements](https://appium.io/docs/en/latest/quickstart/requirements/), [UiAutomator2 driver requirements and doctor](https://github.com/appium/appium-uiautomator2-driver).

## Host and deployment boundary

This is a local macOS host setup, not a Kubernetes deployment. The verified Mac Hypervisor capability says nothing about nested virtualization or `/dev/kvm` in the existing AKS node pool. A cloud or Linux runtime requires its own CPU architecture, KVM/device access, image-license, boot, Maps availability, egress/location, resource-budget, and screenshot checks. No AKS changes or paid cloud resources are created by these scripts.

Exit codes: `0` for the specific command's success, `2` for blocked setup or partial device evidence; an emulator process can return its own exit status. Preserve and diagnose the actual failing gate before retrying.
