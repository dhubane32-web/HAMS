/**
 * Optional IP allowlist for high-privilege system routes (comma-separated IPv4 or CIDR).
 * Env: ADMIN_IP_ALLOWLIST=203.0.113.10,198.51.100.0/24
 */

function parseList() {
  const raw = process.env.ADMIN_IP_ALLOWLIST;
  if (!raw || !String(raw).trim()) return null;
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function ipMatchesEntry(clientIp, entry) {
  if (!clientIp || !entry) return false;
  if (entry.includes('/')) {
    const [net, bits] = entry.split('/');
    const b = Number(bits);
    if (!Number.isFinite(b) || b < 0 || b > 32) return false;
    const a = clientIp.split('.').map(Number);
    const n = net.split('.').map(Number);
    if (a.length !== 4 || n.length !== 4) return false;
    const mask = (0xffffffff << (32 - b)) >>> 0;
    let ca = 0;
    let cn = 0;
    for (let i = 0; i < 4; i++) {
      ca = (ca << 8) + a[i];
      cn = (cn << 8) + n[i];
    }
    ca >>>= 0;
    cn >>>= 0;
    return (ca & mask) === (cn & mask);
  }
  return clientIp === entry;
}

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) {
    return xf.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '';
}

export function adminIpAllowlist(req, res, next) {
  const list = parseList();
  if (!list) return next();
  const ip = clientIp(req);
  if (list.some((e) => ipMatchesEntry(ip, e))) return next();
  return res.status(403).json({ message: 'Admin access is restricted from this network address.' });
}
