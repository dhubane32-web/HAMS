/**
 * Production-safe logging — never print secrets, tokens, or connection strings.
 */

const SECRET_PATTERNS = [
  /postgresql:\/\/[^\s]+/gi,
  /postgres(ql)?:\/\/[^\s]+/gi,
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /(jwt_secret|password|secret|token|api[_-]?key|encryption[_-]?key)\s*[=:]\s*['"]?[^'"\s]+/gi
];

const REDACT_KEYS = new Set([
  'password',
  'password_hash',
  'token',
  'jwt',
  'secret',
  'authorization',
  'cookie',
  'hams_token',
  'refreshToken',
  'accessToken',
  'DATABASE_URL',
  'JWT_SECRET',
  'HAMS_ENCRYPTION_KEY',
  'BACKUP_ENCRYPTION_KEY',
  'HAMS_INTERNAL_API_KEY'
]);

export function redactString(input) {
  let s = String(input ?? '');
  for (const pattern of SECRET_PATTERNS) {
    s = s.replace(pattern, '[REDACTED]');
  }
  return s;
}

export function redactValue(key, value) {
  const k = String(key || '').toLowerCase();
  if (REDACT_KEYS.has(key) || REDACT_KEYS.has(String(key))) return '[REDACTED]';
  if (k.includes('password') || k.includes('secret') || k.includes('token') || k.includes('authorization')) {
    return '[REDACTED]';
  }
  if (typeof value === 'string') return redactString(value);
  return value;
}

export function safeErrorMessage(err) {
  return redactString(err?.message || String(err));
}

export function logInfo(message, meta) {
  if (meta && typeof meta === 'object') {
    console.log(redactString(message), sanitizeMeta(meta));
    return;
  }
  console.log(redactString(message));
}

export function logError(message, err, meta) {
  const base = safeErrorMessage(err || message);
  const msg = err ? redactString(message) : base;
  if (meta && typeof meta === 'object') {
    console.error(msg, sanitizeMeta(meta));
    return;
  }
  console.error(msg);
}

function sanitizeMeta(meta) {
  const out = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = redactValue(k, v);
  }
  return out;
}
