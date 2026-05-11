#!/usr/bin/env bash
# Read-only: verify authoritative DNS and HTTPS for Hawana Airways HAMS production hosts.
# Usage: bash scripts/verify-hawana-production-dns.sh
# Optional: HAWANA_DOMAIN=hawanaairways.com bash scripts/verify-hawana-production-dns.sh

set -euo pipefail

DOMAIN="${HAWANA_DOMAIN:-hawanaairways.com}"
HAMS_HOST="hams.${DOMAIN}"
API_HOST="api.${DOMAIN}"

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[verify] Missing command: $1 (install bind tools / curl)" >&2
    exit 2
  }
}

need_cmd dig
need_cmd curl

fail=0

echo "[verify] Domain: ${DOMAIN}"
echo "[verify] Authoritative NS:"
dig +short NS "${DOMAIN}" | sed 's/^/[verify]   NS /' || true

echo "[verify] Resolution for ${HAMS_HOST}:"
HAMS_A=$(dig +short A "${HAMS_HOST}" | head -1 || true)
HAMS_C=$(dig +short CNAME "${HAMS_HOST}" | head -1 || true)
if [[ -z "${HAMS_A}" && -z "${HAMS_C}" ]]; then
  echo "[verify] FAIL: ${HAMS_HOST} has no A or CNAME (NXDOMAIN or empty)." >&2
  fail=1
else
  [[ -n "${HAMS_A}" ]] && echo "[verify]   A     ${HAMS_A}"
  [[ -n "${HAMS_C}" ]] && echo "[verify]   CNAME ${HAMS_C}"
fi

echo "[verify] Resolution for ${API_HOST}:"
API_A=$(dig +short A "${API_HOST}" | head -1 || true)
API_C=$(dig +short CNAME "${API_HOST}" | head -1 || true)
if [[ -z "${API_A}" && -z "${API_C}" ]]; then
  echo "[verify] FAIL: ${API_HOST} has no A or CNAME (NXDOMAIN or empty)." >&2
  fail=1
else
  [[ -n "${API_A}" ]] && echo "[verify]   A     ${API_A}"
  [[ -n "${API_C}" ]] && echo "[verify]   CNAME ${API_C}"
fi

echo "[verify] HTTPS (TLS + HTTP status):"
if curl -sfI --max-time 15 "https://${HAMS_HOST}/login" -o /tmp/hawana-hams-head.txt; then
  code=$(grep -i '^HTTP/' /tmp/hawana-hams-head.txt | tail -1 || true)
  echo "[verify]   ${HAMS_HOST}/login → ${code:-OK}"
else
  echo "[verify] FAIL: https://${HAMS_HOST}/login (TLS or HTTP error)." >&2
  fail=1
fi

if body=$(curl -sf --max-time 15 "https://${API_HOST}/health"); then
  echo "[verify]   ${API_HOST}/health → ${body:0:120}"
else
  echo "[verify] FAIL: https://${API_HOST}/health (TLS or HTTP error)." >&2
  fail=1
fi

if [[ "${fail}" -ne 0 ]]; then
  echo "[verify] Done with failures. Add DNS at your authoritative provider; see docs/DNS_HAMS_AND_API.md" >&2
  exit 1
fi

echo "[verify] OK — DNS resolves and HTTPS endpoints responded."
