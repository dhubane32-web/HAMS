#!/usr/bin/env node
/**
 * Lightweight static security checklist (no network).
 * Run: node scripts/security-audit.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const checks = [];

function fileHas(rel, needle) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) {
    checks.push({ ok: false, name: rel, detail: 'missing file' });
    return false;
  }
  const s = fs.readFileSync(p, 'utf8');
  const ok = s.includes(needle);
  checks.push({ ok, name: rel, detail: ok ? `contains "${needle}"` : `missing "${needle}"` });
  return ok;
}

fileHas('src/middleware/securityHeaders.js', 'contentSecurityPolicy');
fileHas('src/middleware/apiRateLimits.js', 'rateLimit');
fileHas('src/middleware/trustedOriginMutations.js', 'trustedOriginMutations');
fileHas('src/middleware/auth.js', 'requireAuth');
fileHas('src/routes/auth.js', 'bcrypt.compare');
fileHas('src/routes/auth-totp.js', 'authenticator');
fileHas('src/config/envValidation.js', 'validateProductionEnv');
fileHas('src/middleware/productionErrors.js', 'productionErrorHandler');
fileHas('src/middleware/sanitizeBody.js', 'sanitizeBody');
fileHas('src/middleware/bearerFromCookie.js', 'bearerFromCookie');
fileHas('src/lib/safeLog.js', 'redactString');
fileHas('src/services/healthService.js', 'getReadiness');
fileHas('src/services/monitoringService.js', 'recordRequest');
fileHas('src/services/alertService.js', 'sendOperationalAlert');
fileHas('src/lib/bcryptConfig.js', 'BCRYPT_ROUNDS');
fileHas('src/routes/health.js', '/ready');
fileHas('src/lib/gracefulShutdown.js', 'registerGracefulShutdown');
fileHas('src/middleware/requestTimeout.js', 'requestTimeout');
fileHas('src/services/systemLogService.js', 'logSystemEvent');
fileHas('src/services/dbIntegrityService.js', 'runDbIntegrityChecks');
fileHas('src/services/diagnosticsService.js', 'getDiagnosticsDashboard');
fileHas('src/config/db.js', 'idleTimeoutMillis');
fileHas('src/config/db.js', 'getPoolStats');
fileHas('src/middleware/maintenanceMode.js', 'maintenanceMode');
fileHas('src/services/monitoringService.js', 'maybeAlert5xxSpike');
fileHas('src/index.js', 'maintenanceMode');
fileHas('src/index.js', 'sendOperationalAlert');

const failed = checks.filter((c) => !c.ok);
console.log('HAMS security audit (static)\n');
for (const c of checks) {
  console.log(`${c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`);
}
console.log(`\n${failed.length ? 'FAILED' : 'OK'} — ${checks.length} checks`);
process.exit(failed.length ? 1 : 0);
