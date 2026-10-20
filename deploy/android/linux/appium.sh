#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
export MAPS_ANDROID_ROOT=${MAPS_ANDROID_ROOT:-/runtime}
export JAVA_HOME=${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}
export ADB_VENDOR_KEYS="$MAPS_ANDROID_ROOT/user/adbkey"
unset ANDROID_SDK_ROOT ANDROID_SERIAL ANDROID_ADB_SERVER_ADDRESS
exec bash "$script_dir/../appium.sh" "$@"

