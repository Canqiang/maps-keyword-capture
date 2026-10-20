#!/usr/bin/env bash
# Explicit root-only preparation inside the dedicated Node 24 Debian bookworm Pod.
set -euo pipefail
if [[ $(id -u) != 0 || $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
  echo 'Run only as root inside the dedicated Linux x86_64 Pod.' >&2
  exit 2
fi
. /etc/os-release
if [[ ${ID:-} != debian || ${VERSION_CODENAME:-} != bookworm ]]; then
  echo 'This prerequisite list is for Debian bookworm.' >&2
  exit 2
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl python3 python3-pil unzip openjdk-17-jre-headless \
  tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-sim tesseract-ocr-chi-tra \
  libasound2 libdbus-1-3 libfontconfig1 libnss3 libx11-6 libxcb1 \
  libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
  libxrandr2 libxrender1 libxtst6 libxkbcommon0 libxkbcommon-x11-0 \
  libgl1 libglib2.0-0 libpulse0 libstdc++6 zlib1g procps iproute2

