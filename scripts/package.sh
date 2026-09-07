#!/usr/bin/env bash
# Build a Chrome Web Store upload zip containing only runtime files.
# Usage: scripts/package.sh [output.zip]
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json | head -1)
OUT="${1:-dist/youtube-auto-subscribe-${VERSION}.zip}"

mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"

zip -r "$OUT" \
  manifest.json \
  background.js \
  content.js \
  popup.html \
  popup.js \
  completion.html \
  icons \
  -x '*.DS_Store'

echo "Built $OUT (version $VERSION)"
