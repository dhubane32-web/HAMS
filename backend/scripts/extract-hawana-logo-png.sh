#!/usr/bin/env bash
# Rasterize official Hawana monotone logo PDF -> PNG for HAMS PDF headers (pdfkit).
# Source of truth: frontend/public/brand/source/Hawana Logo Monotone.pdf
# Requires: poppler-utils (pdftoppm). macOS: brew install poppler
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/assets/branding"
OUT="$DIR/hawana-logo-print.png"
SRC="$ROOT/../frontend/public/brand/source/Hawana Logo Monotone.pdf"

if [[ ! -f "$SRC" ]]; then
  echo "Missing official source PDF: $SRC"
  echo "Place 'Hawana Logo Monotone.pdf' in frontend/public/brand/source/"
  exit 1
fi

if ! command -v pdftoppm &>/dev/null; then
  echo "pdftoppm not found. Install Poppler, e.g.: brew install poppler"
  exit 1
fi

TMP="$DIR/.hawana-logo-print-tmp"
pdftoppm -png -f 1 -l 1 -r 240 "$SRC" "$TMP"
mv "${TMP}-1.png" "$OUT"
rm -f "${TMP}"-*.png 2>/dev/null || true
echo "Wrote $OUT (from $(basename "$SRC"))"
