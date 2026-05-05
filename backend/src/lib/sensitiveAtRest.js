/**
 * Application-level helpers for sensitive payloads at rest.
 * Full column encryption for payments/passengers requires schema migrations;
 * use {@link encryptField} from `cryptoField.js` for new encrypted columns.
 */

import { encryptField, decryptField } from './cryptoField.js';

/** Encrypt a short string when `HAMS_ENCRYPTION_KEY` is configured (e.g. document reference IDs). */
export function encryptOptionalNote(plain) {
  if (plain == null || plain === '') return null;
  return encryptField(String(plain));
}

export function decryptOptionalNote(stored) {
  if (stored == null || stored === '') return '';
  return decryptField(String(stored));
}
