/**
 * Helpers for safe file handling (use when adding multipart routes).
 * Validates buffer magic numbers and rejects path traversal in stored names.
 */

export const MAX_UPLOAD_BYTES = Math.min(
  50 * 1024 * 1024,
  Math.max(1024, Number(process.env.HAMS_MAX_UPLOAD_BYTES || 8 * 1024 * 1024))
);

export function assertBufferSize(buf, maxBytes = MAX_UPLOAD_BYTES) {
  const n = Buffer.isBuffer(buf) ? buf.length : 0;
  if (n > maxBytes) throw new Error(`Upload exceeds maximum size (${maxBytes} bytes).`);
  return buf;
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46]);

export function looksLikePng(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 8 && buf.subarray(0, 4).equals(PNG);
}

export function looksLikeJpeg(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 3 && buf.subarray(0, 3).equals(JPEG);
}

export function looksLikePdf(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 5 && buf.subarray(0, 4).equals(PDF);
}

/** Reject `../`, absolute paths, and Windows drive letters in upload filenames. */
export function assertSafeUploadFilename(name) {
  const n = String(name || '').trim();
  if (!n || n.length > 200) throw new Error('Invalid filename.');
  if (n.includes('..') || n.startsWith('/') || n.includes('\\') || /^[a-zA-Z]:/.test(n)) {
    throw new Error('Unsafe filename.');
  }
  return n;
}
