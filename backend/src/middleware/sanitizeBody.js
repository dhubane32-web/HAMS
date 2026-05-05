const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function scrub(value, depth) {
  if (depth > 6) return value;
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => scrub(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      out[k] = scrub(value[k], depth + 1);
    }
    return out;
  }
  return value;
}

/** Strip prototype-pollution keys from JSON bodies. */
export function sanitizeBody(req, _res, next) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    req.body = scrub(req.body, 0);
  }
  next();
}
