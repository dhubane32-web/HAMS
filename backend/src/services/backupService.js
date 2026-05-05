import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import crypto from 'crypto';
import os from 'os';
import { pool } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../../');

const DEFAULT_BACKUP_ROOT = path.join(backendRoot, 'var', 'backups');
const DEFAULT_UPLOADS_DIR = path.join(backendRoot, 'uploads');
const DEFAULT_TICKET_PDF_DIR = path.join(backendRoot, 'var', 'eticket-pdf-cache');
const DEFAULT_REPORTS_DIR = path.join(backendRoot, 'var', 'reports');
const DEFAULT_ENCRYPTION_KEY = 'hams-backup-dev-key-change-in-production';

function tsSlug(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '_');
}

function normalizeBool(v, fallback = false) {
  if (v == null) return fallback;
  const raw = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function tierFromTrigger(triggerKind = 'manual') {
  if (triggerKind === 'monthly') return 'monthly';
  if (triggerKind === 'weekly') return 'weekly';
  return 'daily';
}

function deriveAesKey() {
  const secret = process.env.BACKUP_ENCRYPTION_KEY || DEFAULT_ENCRYPTION_KEY;
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest();
}

function checksumSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function runCommand(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} failed (${code}): ${stderr || stdout}`));
    });
  });
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function getConfiguredPaths() {
  return {
    backupRootDir: process.env.BACKUP_ROOT_DIR || DEFAULT_BACKUP_ROOT,
    uploadsDir: process.env.BACKUP_UPLOADS_DIR || DEFAULT_UPLOADS_DIR,
    ticketPdfDir: process.env.BACKUP_TICKET_PDF_DIR || DEFAULT_TICKET_PDF_DIR,
    reportsDir: process.env.BACKUP_REPORTS_DIR || DEFAULT_REPORTS_DIR
  };
}

async function createSystemSettingsBackup(targetDir, stamp) {
  const jsonName = `system-settings-${stamp}.json`;
  const jsonPath = path.join(targetDir, jsonName);
  let rows = [];
  try {
    const result = await pool.query(
      `SELECT category, setting_key, value_json, updated_at, updated_by
       FROM system_settings
       ORDER BY category, setting_key`
    );
    rows = result.rows;
  } catch (error) {
    if (String(error?.message || '').includes('relation "system_settings" does not exist')) rows = [];
    else throw error;
  }
  await fs.writeFile(jsonPath, `${JSON.stringify({ exported_at: new Date().toISOString(), rows }, null, 2)}\n`, 'utf8');
  return { label: 'system-settings', storedName: jsonName };
}

async function createDatabaseBackup(targetDir, stamp) {
  const sqlName = `db-${stamp}.sql`;
  const sqlPath = path.join(targetDir, sqlName);
  await runCommand('pg_dump', ['--no-owner', '--no-privileges', '--format=plain', '--file', sqlPath, process.env.DATABASE_URL]);
  return { label: 'database', storedName: sqlName };
}

async function archiveDirectory(sourceDir, targetDir, prefix, stamp) {
  const archiveName = `${prefix}-${stamp}.tar.gz`;
  const archivePath = path.join(targetDir, archiveName);
  await runCommand('tar', ['-czf', archivePath, '-C', sourceDir, '.']);
  return { label: prefix, storedName: archiveName };
}

async function createCombinedArchive(targetDir, stamp) {
  const zipName = `full-backup-${stamp}.zip`;
  const zipPath = path.join(targetDir, zipName);
  const names = (await fs.readdir(targetDir)).filter((x) => x !== zipName);
  if (names.length === 0) await fs.writeFile(zipPath, '', 'utf8');
  else await runCommand('sh', ['-c', `cd "${targetDir}" && zip -r -q "${zipName}" .`]);
  return { label: 'full-archive', storedName: zipName };
}

function encryptEnvelope(plainBuf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveAesKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('HAMSENC1'), iv, tag, encrypted]);
}

function decryptEnvelope(encBuf) {
  if (encBuf.subarray(0, 8).toString() !== 'HAMSENC1') throw new Error('Unsupported backup encryption envelope.');
  const iv = encBuf.subarray(8, 20);
  const tag = encBuf.subarray(20, 36);
  const payload = encBuf.subarray(36);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveAesKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(payload), decipher.final()]);
}

async function createBackupLogRow(client, data) {
  try {
    const q = await client.query(
      `INSERT INTO backup_logs (
         backup_type, file_name, file_size, status, backup_tier, is_encrypted, checksum_sha256, offsite_provider, offsite_status, last_error
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, backup_type, file_name, file_size, status, backup_tier, is_encrypted, checksum_sha256, offsite_provider, offsite_status, created_at, restored_at`,
      [
        data.backupType,
        data.fileName,
        data.fileSize,
        data.status,
        data.backupTier || 'daily',
        Boolean(data.isEncrypted),
        data.checksum || null,
        data.offsiteProvider || null,
        data.offsiteStatus || 'not_configured',
        data.lastError || null
      ]
    );
    return q.rows[0];
  } catch {
    const fallback = await client.query(
      `INSERT INTO backup_logs (backup_type, file_name, file_size, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id, backup_type, file_name, file_size, status, created_at, restored_at`,
      [data.backupType, data.fileName, data.fileSize, data.status]
    );
    return fallback.rows[0];
  }
}

async function updateBackupLogStatus(client, id, status) {
  await client.query(`UPDATE backup_logs SET status = $1 WHERE id = $2::uuid`, [status, id]);
}

export async function runFullBackup({ triggeredBy = null, triggerKind = 'manual' } = {}) {
  const { backupRootDir, uploadsDir, ticketPdfDir, reportsDir } = getConfiguredPaths();
  const stamp = tsSlug();
  const runDir = path.join(backupRootDir, `run-${stamp}`);
  const backupTier = tierFromTrigger(triggerKind);
  await ensureDir(runDir);

  const client = await pool.connect();
  const created = [];
  try {
    const artifacts = [];
    artifacts.push(await createDatabaseBackup(runDir, stamp));
    artifacts.push(await createSystemSettingsBackup(runDir, stamp));
    if (await pathExists(uploadsDir)) artifacts.push(await archiveDirectory(uploadsDir, runDir, 'uploads', stamp));
    if (await pathExists(ticketPdfDir)) artifacts.push(await archiveDirectory(ticketPdfDir, runDir, 'ticket-pdfs', stamp));
    if (await pathExists(reportsDir)) artifacts.push(await archiveDirectory(reportsDir, runDir, 'reports', stamp));
    artifacts.push(await createCombinedArchive(runDir, stamp));

    const keepPlain = normalizeBool(process.env.BACKUP_KEEP_PLAINTEXT, false);
    const provider = (process.env.BACKUP_OFFSITE_PROVIDER || 'none').trim().toLowerCase();
    const offsiteDryRun = normalizeBool(process.env.BACKUP_OFFSITE_DRY_RUN, true);

    for (const item of artifacts) {
      const abs = path.join(runDir, item.storedName);
      const plain = await fs.readFile(abs);
      const checksum = checksumSha256(plain);
      const envelope = encryptEnvelope(plain);
      const encPath = `${abs}.enc`;
      await fs.writeFile(encPath, envelope);
      if (!keepPlain) await fs.rm(abs, { force: true });

      const st = await fs.stat(encPath);
      const row = await createBackupLogRow(client, {
        backupType: item.label,
        fileName: path.relative(backupRootDir, encPath),
        fileSize: Number(st.size || 0),
        status: 'success',
        backupTier,
        isEncrypted: true,
        checksum,
        offsiteProvider: provider === 'none' ? null : provider,
        offsiteStatus: provider === 'none' ? 'not_configured' : offsiteDryRun ? 'dry_run_ok' : 'pending'
      });
      created.push(row);
    }

    return { triggeredBy, backupRootDir, runDir, rows: created };
  } catch (error) {
    if (created.length > 0) {
      for (const row of created) await updateBackupLogStatus(client, row.id, 'partial_failed');
    } else {
      const failPath = path.join(runDir, `failed-run-${stamp}.txt`);
      await fs.writeFile(failPath, String(error?.message || error), 'utf8');
      const st = await fs.stat(failPath);
      await createBackupLogRow(client, {
        backupType: 'meta',
        fileName: path.relative(backupRootDir, failPath),
        fileSize: Number(st.size || 0),
        status: 'failed',
        backupTier,
        lastError: String(error?.message || error)
      });
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function listBackupLogs({ limit = 100, offset = 0 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  try {
    const result = await pool.query(
      `SELECT id, backup_type, file_name, file_size, status, backup_tier, is_encrypted, checksum_sha256, offsite_provider, offsite_status, created_at, restored_at
       FROM backup_logs
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [safeLimit, safeOffset]
    );
    return { rows: result.rows, limit: safeLimit, offset: safeOffset };
  } catch {
    const fallback = await pool.query(
      `SELECT id, backup_type, file_name, file_size, status, created_at, restored_at
       FROM backup_logs
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [safeLimit, safeOffset]
    );
    return { rows: fallback.rows, limit: safeLimit, offset: safeOffset };
  }
}

export async function resolveBackupFileById(id) {
  const result = await pool.query(
    `SELECT id, backup_type, file_name, file_size, status, backup_tier, is_encrypted, checksum_sha256, offsite_provider, offsite_status, created_at, restored_at
     FROM backup_logs WHERE id = $1::uuid`,
    [id]
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  const { backupRootDir } = getConfiguredPaths();
  const rel = String(row.file_name || '').trim().replace(/^\/+/, '');
  const absolutePath = path.resolve(backupRootDir, rel);
  const normalizedRoot = path.resolve(backupRootDir);
  if (!absolutePath.startsWith(`${normalizedRoot}${path.sep}`) && absolutePath !== normalizedRoot) {
    throw new Error('Invalid backup path.');
  }
  return { row, absolutePath };
}

async function restoreDatabaseFile(filePath) {
  await runCommand('psql', [process.env.DATABASE_URL, '-v', 'ON_ERROR_STOP=1', '-f', filePath]);
}

async function restoreArchiveToDir(archivePath, targetDir, overwrite) {
  const tempDir = path.join(path.dirname(archivePath), `.restore-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  await ensureDir(tempDir);
  try {
    await runCommand('tar', ['-xzf', archivePath, '-C', tempDir]);
    const names = await fs.readdir(tempDir);
    for (const name of names) {
      await fs.cp(path.join(tempDir, name), path.join(targetDir, name), {
        recursive: true,
        force: overwrite,
        errorOnExist: false
      });
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export async function decryptBackupToTemp(id) {
  const resolved = await resolveBackupFileById(id);
  if (!resolved) return null;
  const encBuf = await fs.readFile(resolved.absolutePath);
  const plainBuf = decryptEnvelope(encBuf);
  const tmpPath = path.join(os.tmpdir(), `hams-backup-${id}-${Date.now()}`);
  await fs.writeFile(tmpPath, plainBuf);
  return { row: resolved.row, tmpPath, plainBuf };
}

export async function restoreFromBackupLog({ id, restoredBy = null } = {}) {
  const decrypted = await decryptBackupToTemp(id);
  if (!decrypted) {
    const err = new Error('Backup not found.');
    err.statusCode = 404;
    throw err;
  }
  const { row, tmpPath } = decrypted;
  const overwrite = normalizeBool(process.env.BACKUP_RESTORE_OVERWRITE, false);
  const { uploadsDir, ticketPdfDir, reportsDir } = getConfiguredPaths();
  try {
    if (row.backup_type === 'database') await restoreDatabaseFile(tmpPath);
    else if (row.backup_type === 'uploads') {
      await ensureDir(uploadsDir);
      await restoreArchiveToDir(tmpPath, uploadsDir, overwrite);
    } else if (row.backup_type === 'ticket-pdfs') {
      await ensureDir(ticketPdfDir);
      await restoreArchiveToDir(tmpPath, ticketPdfDir, overwrite);
    } else if (row.backup_type === 'reports') {
      await ensureDir(reportsDir);
      await restoreArchiveToDir(tmpPath, reportsDir, overwrite);
    } else {
      const err = new Error(`Unsupported backup type for restore: ${row.backup_type}`);
      err.statusCode = 400;
      throw err;
    }
  } finally {
    await fs.rm(tmpPath, { force: true });
  }
  await pool.query(`UPDATE backup_logs SET restored_at = NOW() WHERE id = $1::uuid`, [id]);
  return { restoredBy, ...row };
}

export async function simulateRestoreFromBackupLog({ id } = {}) {
  const decrypted = await decryptBackupToTemp(id);
  if (!decrypted) {
    const err = new Error('Backup not found.');
    err.statusCode = 404;
    throw err;
  }
  const { row, tmpPath, plainBuf } = decrypted;
  try {
    if (row.backup_type === 'database') {
      const txt = plainBuf.toString('utf8');
      if (!txt.includes('CREATE') && !txt.includes('INSERT') && !txt.includes('COPY')) {
        throw new Error('Database simulation sanity check failed.');
      }
    } else {
      const tempOut = path.join(os.tmpdir(), `hams-sim-${row.id}-${Date.now()}`);
      await fs.mkdir(tempOut, { recursive: true });
      try {
        await runCommand('tar', ['-xzf', tmpPath, '-C', tempOut]);
        await fs.readdir(tempOut);
      } finally {
        await fs.rm(tempOut, { recursive: true, force: true });
      }
    }
    return { ...row, simulated_at: new Date().toISOString(), checksum_sha256: checksumSha256(plainBuf) };
  } finally {
    await fs.rm(tmpPath, { force: true });
  }
}

export async function cleanupBackupsByRetention() {
  const policyDays = { daily: 7, weekly: 28, monthly: 365 };
  const { rows } = await listBackupLogs({ limit: 1000, offset: 0 });
  const now = Date.now();
  let removedCount = 0;
  for (const row of rows) {
    const tier = row.backup_tier || 'daily';
    const keepDays = policyDays[tier] || 7;
    if (now - new Date(row.created_at).getTime() <= keepDays * 24 * 3600 * 1000) continue;
    try {
      const resolved = await resolveBackupFileById(row.id);
      if (resolved) {
        await fs.rm(resolved.absolutePath, { force: true });
        removedCount += 1;
      }
    } catch {
      // best-effort cleanup
    }
  }
  return { removedCount };
}

export async function getBackupHealthSummary() {
  const { rows } = await listBackupLogs({ limit: 200, offset: 0 });
  const last = rows[0] || null;
  const failed = rows.filter((r) => String(r.status || '').toLowerCase().includes('fail'));
  const lastRestore = rows.find((r) => r.restored_at) || null;
  return {
    lastBackupStatus: last?.status || 'unknown',
    lastBackupSize: Number(last?.file_size || 0),
    lastBackupAt: last?.created_at || null,
    lastRestoreTest: lastRestore
      ? { id: lastRestore.id, backup_type: lastRestore.backup_type, restored_at: lastRestore.restored_at }
      : null,
    failedBackupAlerts: failed.slice(0, 10)
  };
}

export async function getOffsiteProviderStatus() {
  const provider = (process.env.BACKUP_OFFSITE_PROVIDER || 'none').trim().toLowerCase();
  const dryRun = normalizeBool(process.env.BACKUP_OFFSITE_DRY_RUN, true);
  const bucket = process.env.BACKUP_OFFSITE_BUCKET || '';
  const endpoint = process.env.BACKUP_OFFSITE_ENDPOINT || '';
  if (provider === 'none') return { provider, configured: false, dryRun, message: 'Offsite disabled.' };
  if (!bucket) return { provider, configured: false, dryRun, message: 'Missing BACKUP_OFFSITE_BUCKET.' };
  if (provider === 'r2' && !endpoint) return { provider, configured: false, dryRun, message: 'Missing BACKUP_OFFSITE_ENDPOINT.' };
  return { provider, configured: true, dryRun, message: dryRun ? 'Dry-run configuration validated.' : 'Configured.' };
}
