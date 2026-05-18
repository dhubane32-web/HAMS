#!/usr/bin/env node
/**
 * Validate Vercel production env before `next build`.
 * Usage: NODE_ENV=production VERCEL=1 node frontend/scripts/vercel-preflight.mjs
 */
// Vercel injects project env at build time — strict CLI checks are for local/CI only.
if (process.env.VERCEL === '1') {
  console.log('vercel-preflight: skipped on Vercel (use Project → Environment Variables)');
  process.exit(0);
}

const isProd = process.env.NODE_ENV === 'production';

if (!isProd) {
  console.log('vercel-preflight: skipped (not production build)');
  process.exit(0);
}

let ok = true;
const fail = (msg) => {
  console.error(`INVALID: ${msg}`);
  ok = false;
};

const internal = (process.env.HAMS_BACKEND_INTERNAL_URL || '').trim();
if (!internal || !/^https:\/\//i.test(internal)) {
  fail('HAMS_BACKEND_INTERNAL_URL must be set to your Railway HTTPS API URL');
}
if (/localhost|127\.0\.0\.1/i.test(internal)) {
  fail('HAMS_BACKEND_INTERNAL_URL must not use localhost in production');
}

const useProxy = process.env.NEXT_PUBLIC_USE_API_PROXY === 'true';
const apiUrl = (process.env.NEXT_PUBLIC_API_URL || '').trim();
if (!useProxy || apiUrl !== '/api') {
  fail('Set NEXT_PUBLIC_USE_API_PROXY=true and NEXT_PUBLIC_API_URL=/api (Path B proxy)');
}
if (/localhost|127\.0\.0\.1/i.test(apiUrl)) {
  fail('NEXT_PUBLIC_API_URL must not point to localhost in production');
}

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL || '').trim();
if (siteUrl && /localhost|127\.0\.0\.1/i.test(siteUrl)) {
  fail('NEXT_PUBLIC_SITE_URL must not use localhost in production');
}

if (!ok) {
  console.error('\nVercel preflight failed. Fix Project → Settings → Environment Variables, then redeploy.');
  process.exit(1);
}

console.log('Vercel preflight passed.');
