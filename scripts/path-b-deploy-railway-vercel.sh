#!/usr/bin/env bash
# Path B: Railway API + Vercel frontend proxy (run on your machine after `railway login`).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"

echo "=== Path B: Hawana HAMS production auth ==="

if ! command -v railway >/dev/null 2>&1; then
  echo "Installing Railway CLI..."
  npm install -g @railway/cli
fi

if ! railway whoami >/dev/null 2>&1; then
  echo "Run: railway login"
  exit 1
fi

echo ""
echo ">>> Step 1: Deploy backend to Railway (from backend/)"
cd "$BACKEND_DIR"

if [[ ! -f .env.railway.example ]]; then
  cat > .env.railway.example <<'ENV'
# Copy to Railway project variables (Dashboard → Variables) or: railway variables set KEY=value
NODE_ENV=production
PORT=5013
DATABASE_URL=postgresql://USER:PASS@HOST:5432/hams
JWT_SECRET=CHANGE_ME_MIN_32_CHARACTERS_RANDOM_STRING
HAMS_ENCRYPTION_KEY=CHANGE_ME_ANOTHER_32_CHAR_RANDOM_STRING
FRONTEND_URL=https://hams-frontend.vercel.app,https://hams.hawanaairways.com
ENV
fi

echo "Ensure Railway project has DATABASE_URL, JWT_SECRET, HAMS_ENCRYPTION_KEY, FRONTEND_URL set."
echo "Then deploy:"
railway up --detach || railway up

echo ""
echo ">>> Public API URL (copy this):"
RAILWAY_URL="$(railway domain 2>/dev/null | head -1 || true)"
if [[ -z "$RAILWAY_URL" ]]; then
  echo "  Open Railway dashboard → your service → Settings → Networking → Generate domain"
  read -r -p "Paste Railway public URL (https://....railway.app): " RAILWAY_URL
fi
RAILWAY_URL="${RAILWAY_URL%/}"
echo "  HAMS_BACKEND_INTERNAL_URL=$RAILWAY_URL"

echo ""
echo ">>> Step 2: Reset admin password on Railway DB"
read -r -p "Run password reset on Railway DB now? [y/N] " yn
if [[ "${yn,,}" == "y" ]]; then
  DATABASE_URL="$(railway variables get DATABASE_URL 2>/dev/null || true)"
  if [[ -n "$DATABASE_URL" ]]; then
    DATABASE_URL="$DATABASE_URL" node "$ROOT/backend/scripts/reset-hawana-admin-password.mjs"
  else
    echo "Set DATABASE_URL in Railway first, then:"
    echo "  DATABASE_URL='...' node backend/scripts/reset-hawana-admin-password.mjs"
  fi
fi

echo ""
echo ">>> Step 3: Verify API"
API_BASE="$RAILWAY_URL" bash "$ROOT/scripts/verify-production-api.sh" || true

echo ""
echo ">>> Step 4: Vercel frontend env (set in dashboard or vercel CLI)"
cat <<VERCEL

  HAMS_BACKEND_INTERNAL_URL=$RAILWAY_URL
  NEXT_PUBLIC_USE_API_PROXY=true
  NEXT_PUBLIC_API_URL=/api
  NEXT_PUBLIC_SITE_URL=https://hams-frontend.vercel.app
  NEXT_PUBLIC_CANONICAL_HOST=hams-frontend.vercel.app

VERCEL

if command -v vercel >/dev/null 2>&1; then
  read -r -p "Apply to Vercel project now? [y/N] " vy
  if [[ "${vy,,}" == "y" ]]; then
    cd "$FRONTEND_DIR"
    vercel env rm HAMS_BACKEND_INTERNAL_URL production -y 2>/dev/null || true
    printf '%s' "$RAILWAY_URL" | vercel env add HAMS_BACKEND_INTERNAL_URL production
    printf '%s' 'true' | vercel env add NEXT_PUBLIC_USE_API_PROXY production
    printf '%s' '/api' | vercel env add NEXT_PUBLIC_API_URL production
    printf '%s' 'https://hams-frontend.vercel.app' | vercel env add NEXT_PUBLIC_SITE_URL production
    printf '%s' 'hams-frontend.vercel.app' | vercel env add NEXT_PUBLIC_CANONICAL_HOST production
    vercel --prod --force
  fi
else
  echo "Install Vercel CLI: npm i -g vercel && cd frontend && vercel --prod"
fi

echo ""
echo ">>> Step 5: Test login"
echo "  https://hams-frontend.vercel.app/login"
echo "  admin@hawanaairways.com / Hawana@2026"
echo ""
echo "Proxy check:"
echo "  curl -sS https://hams-frontend.vercel.app/health"
echo "  curl -sS -X POST https://hams-frontend.vercel.app/api/auth/login -H 'Content-Type: application/json' -d '{\"email\":\"admin@hawanaairways.com\",\"password\":\"Hawana@2026\"}'"
