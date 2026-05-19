#!/usr/bin/env node
/**
 * Validate production env before Railway deploy (run locally or in CI).
 * Usage: NODE_ENV=production node backend/scripts/railway-preflight.mjs
 */
import { validateProductionEnv } from '../src/config/envValidation.js';

const required = [
  'NODE_ENV',
  'DATABASE_URL',
  'JWT_SECRET',
  'HAMS_ENCRYPTION_KEY',
  'BACKUP_ENCRYPTION_KEY',
  'FRONTEND_URL'
];

let ok = true;
for (const key of required) {
  const v = process.env[key];
  if (!v || !String(v).trim()) {
    console.error(`MISSING: ${key}`);
    ok = false;
  }
}

if (process.env.JWT_SECRET && String(process.env.JWT_SECRET).length < 32) {
  console.error('INVALID: JWT_SECRET must be at least 32 characters');
  ok = false;
}
if (process.env.HAMS_ENCRYPTION_KEY && String(process.env.HAMS_ENCRYPTION_KEY).length < 32) {
  console.error('INVALID: HAMS_ENCRYPTION_KEY must be at least 32 characters');
  ok = false;
}

try {
  validateProductionEnv();
  console.log('validateProductionEnv: OK');
} catch (e) {
  console.error(`validateProductionEnv: ${e.message}`);
  ok = false;
}

if (!ok) process.exit(1);
console.log('Railway preflight passed. Deploy backend, generate domain, then curl /health.');
