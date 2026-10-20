#!/usr/bin/env bash
# Keep Appium, drivers, npm cache and server state outside the user's global tools.
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
runtime_root=${MAPS_ANDROID_ROOT:-"$HOME/.local/share/maps-android"}
export APPIUM_HOME="$runtime_root/appium-home"
export ANDROID_HOME="$runtime_root/sdk"
export ANDROID_USER_HOME="$runtime_root/user"
export ANDROID_AVD_HOME="$runtime_root/avd"
export ANDROID_EMULATOR_HOME="$runtime_root/user"
export ADB_SERVER_SOCKET=tcp:127.0.0.1:5037
export ANDROID_ADB_SERVER_PORT=5037
export JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home}
export npm_config_registry=https://registry.npmjs.org
export npm_config_cache="$runtime_root/npm-cache"
export APPIUM_SKIP_CHROMEDRIVER_INSTALL=1
appium_bin="$runtime_root/appium-runtime/node_modules/.bin/appium"

case ${1:-help} in
  install)
    mkdir -p "$APPIUM_HOME" "$runtime_root/appium-runtime" "$runtime_root/receipts"
    # Verify exact top-level metadata; npm validates tarball integrity on install.
    python3 - "$script_dir/appium.lock.json" <<'PY'
import json, subprocess, sys
lock=json.load(open(sys.argv[1]))
for package in lock['packages']:
    actual=json.loads(subprocess.check_output(['npm','view','--registry='+lock['registry'],package['name']+'@'+package['version'],'dist','--json']))
    if actual['integrity'] != package['integrity'] or actual['tarball'] != package['url']:
        raise SystemExit('Registry metadata mismatch: '+package['name'])
PY
    npm install --prefix "$runtime_root/appium-runtime" --save-exact --no-audit --no-fund appium@3.8.0
    "$appium_bin" driver list --installed --json > "$runtime_root/receipts/appium-drivers.json"
    driver_state=$(python3 - "$runtime_root/receipts/appium-drivers.json" <<'PY'
import json, sys
driver=json.load(open(sys.argv[1])).get('uiautomator2')
if not driver:
    print('missing')
elif driver.get('version') == '8.7.0':
    print('installed')
else:
    raise SystemExit('An unexpected UiAutomator2 version is installed; inspect before changing it.')
PY
)
    if [[ "$driver_state" == missing ]]; then
      "$appium_bin" driver install --source=npm appium-uiautomator2-driver@8.7.0
    fi
    "$appium_bin" --version
    "$appium_bin" driver list --installed --json > "$runtime_root/receipts/appium-drivers.json"
    cp "$runtime_root/appium-runtime/package-lock.json" "$runtime_root/receipts/appium-server-package-lock.json"
    if [[ -f "$APPIUM_HOME/package-lock.json" ]]; then
      cp "$APPIUM_HOME/package-lock.json" "$runtime_root/receipts/appium-driver-package-lock.json"
    fi
    ;;
  doctor)
    exec "$appium_bin" driver doctor uiautomator2
    ;;
  start)
    # Native-only server: no relaxed security, adb_shell or driver downloads enabled.
    exec "$appium_bin" --address 127.0.0.1 --port "${MAPS_APPIUM_PORT:-4723}" --use-drivers uiautomator2 --log-timestamp
    ;;
  *)
    echo 'Usage: bash deploy/android/appium.sh install|doctor|start'
    echo 'Optional: MAPS_ANDROID_ROOT=/absolute/runtime/root MAPS_APPIUM_PORT=4723'
    exit 2
    ;;
esac
