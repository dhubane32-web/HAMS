import crypto from 'crypto';

const IV_LEN = 12;
const TAG_LEN = 16;

function deriveKey() {
  const raw = process.env.HAMS_ENCRYPTION_KEY;
  if (!raw || String(raw).length < 8) return null;
  if (process.env.NODE_ENV === 'production' && String(raw).length < 32) return null;
  return crypto.createHash('sha256').update(String(raw), 'utf8').digest();
}

/**
 * AES-256-GCM encrypt for at-rest secrets (e.g. TOTP seed). Returns plaintext if no key configured (dev only).
 * @param {string} plain
 * @returns {string} base64 iv+ciphertext+tag
 */
export function encryptField(plain) {
  const key = deriveKey();
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('HAMS_ENCRYPTION_KEY is required in production to store 2FA secrets.');
    }
    return `plain:${plain}`;
  }
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString('base64');
}

/**
 * @param {string} stored
 * @returns {string}
 */
export function decryptField(stored) {
  if (!stored) return '';
  if (String(stored).startsWith('plain:')) {
    return String(stored).slice('plain:'.length);
  }
  const key = deriveKey();
  if (!key) throw new Error('Cannot decrypt: HAMS_ENCRYPTION_KEY not set.');
  const buf = Buffer.from(String(stored), 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const data = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
