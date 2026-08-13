#!/bin/bash
# Build the store submission zip: ONLY the files that run in the browser.
# No tests, docs, node_modules, git, or tooling — a small, readable package
# reviews faster and matches the public repo byte for byte.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
OUT="dist/wholepage-$VERSION.zip"
rm -rf dist && mkdir -p dist
zip -q -r "$OUT" \
  manifest.json \
  sw content result popup options \
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png \
  -x "*/.DS_Store"
echo "built $OUT"
unzip -l "$OUT"
