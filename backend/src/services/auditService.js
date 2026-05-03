import { pool } from '../config/db.js';

function clientIp(req) {
  if (!req) return null;
  const xf = req.headers?.['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) {
    return xf.split(',')[0].trim().slice(0, 64);
  }
  return req.ip || req.socket?.remoteAddress || null;
}

function userAgent(req) {
  if (!req?.headers) return null;
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua.slice(0, 2000) : null;
}

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 */
export async function writeAudit(db, { userId, action, entity, entityId, metadata, req }) {
  const meta = metadata && typeof metadata === 'object' ? metadata : {};
  const fullRow = [
    userId || null,
    action,
    entity || null,
    entityId || null,
    JSON.stringify(meta),
    clientIp(req),
    userAgent(req)
  ];
  try {
    await db.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata, ip_address, user_agent)
       VALUES ($1::uuid, $2, $3, $4::uuid, $5::jsonb, $6, $7)`,
      fullRow
    );
  } catch (err) {
    const msg = String(err?.message || err);
    if (!msg.includes('ip_address') && !msg.includes('user_agent')) {
      throw err;
    }
    await db.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1::uuid, $2, $3, $4::uuid, $5::jsonb)`,
      fullRow.slice(0, 5)
    );
  }
}

export async function writeLoginHistory({ userId, email, success, req, reason }) {
  try {
    await pool.query(
      `INSERT INTO login_history (user_id, email, success, ip_address, user_agent, reason)
       VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
      [
        userId || null,
        String(email).toLowerCase().slice(0, 150),
        Boolean(success),
        clientIp(req),
        userAgent(req),
        reason ? String(reason).slice(0, 120) : null
      ]
    );
  } catch (err) {
    console.warn('[audit] login_history insert skipped:', err?.message || err);
  }
}
