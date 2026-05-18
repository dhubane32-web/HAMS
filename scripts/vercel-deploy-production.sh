#!/usr/bin/env bash
# Clean production deploy with Vercel build-cache bypass and nav label verification.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FRONTEND="$ROOT/frontend"
FRONTEND_URL="${FRONTEND_URL:-https://hams-frontend.vercel.app}"

if [[ -z "${VERCEL_TOKEN:-}" ]]; then
  echo "Set VERCEL_TOKEN (https://vercel.com/account/tokens) or run from Vercel Git integration."
  exit 1
fi

export VERCEL_FORCE_NO_BUILD_CACHE=1
export HAMS_NAV_CONFIG_VERSION="${HAMS_NAV_CONFIG_VERSION:-2}"

echo ">>> Generating build metadata (versioned bundle)"
cd "$FRONTEND"
node scripts/generate-build-meta.mjs

echo ">>> Vercel production deploy (--force, no build cache)"
npx --yes vercel@41.4.0 --prod --force --token "$VERCEL_TOKEN" \
  --env VERCEL_FORCE_NO_BUILD_CACHE=1 \
  --env HAMS_NAV_CONFIG_VERSION="$HAMS_NAV_CONFIG_VERSION"

echo ">>> Verify production nav labels + build stamp"
FRONTEND_URL="$FRONTEND_URL" bash "$ROOT/scripts/verify-production-nav-labels.sh"

echo "Done. Hard-refresh browser (Cmd+Shift+R) if sidebar still shows old labels."
