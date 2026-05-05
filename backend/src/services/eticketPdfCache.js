/**
 * On-disk cache for generated e-ticket PDFs. Serves existing bytes when the
 * booking/ticket context signature matches; otherwise builds and stores a new PDF.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { loadTicketDocumentContext, buildEticketPdfBuffer } from './ticketDocuments.js';

const ETICKET_TEMPLATE_VERSION = '2026-05-05-branding-v2';

function contentSignatureFromContext(ctx) {
  const { ticket, flights, seatByFlight, paxCount } = ctx;
  const legParts = flights.map((f) => {
    const sid = f.id;
    const seat = seatByFlight[sid] != null ? String(seatByFlight[sid]) : '';
    return `${sid}:${seat}:${f.cabin_class || ''}:${f.departure_time || ''}:${f.flight_number || ''}`;
  });
  const payload = {
    templateVersion: ETICKET_TEMPLATE_VERSION,
    ticketNumber: ticket.ticket_number,
    issuedAt: ticket.issued_at,
    bookingTotal: String(ticket.total_amount),
    currency: ticket.currency,
    paxCount,
    legs: legParts.join('|')
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function getEticketPdfCacheDir() {
  return process.env.ETICKET_PDF_CACHE_DIR || path.join(process.cwd(), 'var', 'eticket-pdf-cache');
}

/** @param {import('pg').Pool} pool */
export async function getOrBuildEticketPdfBuffer(pool, bookingId, ticketId, opts = {}) {
  const forceRegenerate = Boolean(opts.forceRegenerate);
  const ctx = await loadTicketDocumentContext(pool, bookingId, ticketId);
  if (!ctx) {
    return { buffer: null, context: null, cacheHit: false };
  }

  const sig = contentSignatureFromContext(ctx);
  const dir = getEticketPdfCacheDir();
  const pdfPath = path.join(dir, `${ticketId}.pdf`);
  const sigPath = path.join(dir, `${ticketId}.sig`);

  if (!forceRegenerate) {
    try {
      const [sigDisk, st] = await Promise.all([fs.readFile(sigPath, 'utf8'), fs.stat(pdfPath)]);
      if (sigDisk.trim() === sig && st.isFile() && st.size > 0) {
        const buffer = await fs.readFile(pdfPath);
        return { buffer, context: ctx, cacheHit: true };
      }
    } catch {
      /* miss or corrupt cache */
    }
  }

  const buffer = await buildEticketPdfBuffer(ctx);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(pdfPath, buffer);
  await fs.writeFile(sigPath, `${sig}\n`, 'utf8');
  return { buffer, context: ctx, cacheHit: false };
}
