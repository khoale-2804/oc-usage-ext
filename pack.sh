#!/usr/bin/env bash
# Build the Chrome Web Store upload zip: only files the extension needs.
set -euo pipefail
cd "$(dirname "$0")"
rm -f oc-usage-ext.zip
zip -r oc-usage-ext.zip \
  manifest.json content.js shared.js background.js \
  popup.html popup.js popup.css \
  options.html options.js options.css \
  icons -x '*.DS_Store' >/dev/null
echo "built oc-usage-ext.zip"
unzip -l oc-usage-ext.zip
