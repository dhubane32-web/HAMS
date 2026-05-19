import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { redactString } from '../lib/safeLog.js';
import { pool } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.HAMS_SYSTEM_LOG_DIR || path.join(__dirname, '../../var/logs');
const LOG_FILE = path.join(LOG_DIR, 'system-events.jsonl');

async function ensureLogDir() {
  await fs.mkdir(LOG_DIR, { recursive: true });
}

/**
 * Centralized operational log (auth, finance, admin, errors, deployments).
 * Persists to JSONL file and best-effort audit_logs when available.
 */
export async function logSystemEvent({
  level = 'info',
  category = 'system',
  action,
  message,
  userId = null,
  entity = null,
  entityId = null,
  metadata = {}
}) {
  const entry = {
    at: new Date().toISOString(),
    level,
    category,
    action,
    message: redactString(message),
    userId,
    entity,
    entityId,
    metadata
  };

  try {
    await ensureLogDir();
    await fs.appendFile(LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    /* disk optional on read-only containers */
  }

  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata)
       VALUES ($1::uuid, $2, $3, $4::uuid, $5::jsonb)`,
      [
        userId,
        `SYSTEM_${String(action || 'EVENT').toUpperCase()}`,
        entity || category,
        entityId,
        JSON.stringify({ level, message: entry.message, ...metadata })
      ]
    );
  } catch {
    /* audit table optional during bootstrap */
  }

  return entry;
}

export async function tailSystemEvents(limit = 100) {
  try {
    const raw = await fs.readFile(LOG_FILE, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
