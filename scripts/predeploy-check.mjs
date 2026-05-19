#!/usr/bin/env node
/**
 * Unified pre-deploy validation for Railway (backend) and Vercel (frontend).
 * Usage:
 *   node scripts/predeploy-check.mjs --target railway
 *   node scripts/predeploy-check.mjs --target vercel
 *   node scripts/predeploy-check.mjs --target all
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const target = process.argv.includes('--target')
  ? process.argv[process.argv.indexOf('--target') + 1]
  : 'all';

function run(cmd, args, cwd, env = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: 'inherit'
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (target === 'railway' || target === 'all') {
  console.log('\n=== Railway backend preflight ===\n');
  run('node', ['scripts/railway-preflight.mjs'], path.join(root, 'backend'), {
    NODE_ENV: 'production'
  });
  run('node', ['scripts/check-migrations-safe.mjs'], path.join(root, 'backend'));
  run('node', ['scripts/security-audit.mjs'], path.join(root, 'backend'));
}

if (target === 'vercel' || target === 'all') {
  console.log('\n=== Vercel frontend preflight ===\n');
  run('node', ['scripts/vercel-preflight.mjs'], path.join(root, 'frontend'), {
    NODE_ENV: 'production',
    VERCEL: '1'
  });
}

console.log('\nPre-deploy checks passed.\n');
