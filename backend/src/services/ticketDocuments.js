/**
 * Branded PDFs (e-ticket, invoice, receipt) and optional email delivery.
 */

import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';
import {
  HAWANA_BRAND,
  readOptionalBrandLogoPng,
  drawStandardDocumentHeader,
  drawStandardPdfFooter
} from '../lib/hawanaBranding.js';

const AIRLINE_NAME = HAWANA_BRAND.airlineName;
const BRAND_HEX = HAWANA_BRAND.primaryHex;

function money(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return x.toFixed(2);
}

function formatWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

/** Compact date/time for e-ticket itinerary (avoids overly long strings). */
function formatEticketDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function formatIssueDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function tripTypeLabel(tt) {
  const u = String(tt || '').toUpperCase();
  if (u === 'RETURN') return 'Return';
  if (u === 'ONE_WAY') return 'One way';
  return tt || '—';
}

/** E-ticket panel: airline-standard wording; cancelled remains explicit. */
function eticketBookingStatusLine(bookingStatus) {
  const u = String(bookingStatus || '').toUpperCase().replace(/\s+/g, '_');
  if (u.includes('CANCEL')) return u.replace(/_/g, ' ');
  return 'CONFIRMED';
}

/**
 * Draw origin and destination with a small vector arrow (reliable in standard PDF fonts).
 */
function drawAirportRoute(doc, x, y, dep, arr, opts = {}) {
  const size = opts.fontSize || 10;
  const depS = String(dep || '').trim().toUpperCase();
  const arrS = String(arr || '').trim().toUpperCase();
  doc.save();
  doc.fillColor('#0f172a').strokeColor('#64748b').lineWidth(0.65);
  doc.font('Helvetica-Bold').fontSize(size);
  doc.text(depS, x, y, { lineBreak: false });
  const wDep = doc.widthOfString(depS);
  const gap = 5;
  const ax = x + wDep + gap;
  const midY = y + size * 0.35;
  const arrowLen = 16;
  doc.moveTo(ax, midY).lineTo(ax + arrowLen, midY).stroke();
  doc
    .moveTo(ax + arrowLen - 1.5, midY - 3.2)
    .lineTo(ax + arrowLen + 3.2, midY)
    .lineTo(ax + arrowLen - 1.5, midY + 3.2)
    .fillColor('#64748b')
    .fill();
  doc.font('Helvetica-Bold').fontSize(size).fillColor('#0f172a').text(arrS, ax + arrowLen + gap + 2, y, { lineBreak: false });
  doc.restore();
}

function computeFareBreakdown(ctx) {
  const { ticket, fareLines, legBaseSum, perPaxTotal } = ctx;
  const currency = String(ticket.currency || 'USD').toUpperCase();
  let base = 0;
  let taxes = 0;
  let fees = 0;
  if (fareLines.length) {
    for (const L of fareLines) {
      const a = Number(L.amount);
      if (!Number.isFinite(a)) continue;
      const ty = String(L.type || '').toLowerCase();
      if (ty === 'tax') taxes += a;
      else if (ty === 'fee') fees += a;
      else base += a;
    }
    if (base === 0 && taxes === 0 && fees === 0) {
      base = fareLines.reduce((s, L) => s + (Number(L.amount) || 0), 0);
    }
  } else {
    base = Number(ticket.fare_base_total) || Number(legBaseSum) || 0;
    taxes = Number(ticket.fare_tax_total) || 0;
    fees = Number(ticket.fare_fee_total) || 0;
  }
  const total = Number.isFinite(Number(perPaxTotal)) ? Number(perPaxTotal) : base + taxes + fees;
  return { base, taxes, fees, total, currency };
}

function pdfBufferFromBuilderA4(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: { Producer: 'Ticketing Platform', Creator: AIRLINE_NAME, Title: 'Electronic ticket' }
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      buildFn(doc);
    } catch (e) {
      reject(e);
      return;
    }
    doc.end();
  });
}

function fareLinesFromBooking(booking) {
  let fb = booking.fare_breakdown;
  if (typeof fb === 'string') {
    try {
      fb = JSON.parse(fb);
    } catch {
      fb = null;
    }
  }
  if (!fb || typeof fb !== 'object') return [];
  const lines = Array.isArray(fb.lines) ? fb.lines : [];
  return lines.map((L) => ({
    code: String(L.code || ''),
    label: String(L.label || L.code || ''),
    amount: Number(L.amount),
    type: String(L.type || '').toLowerCase()
  }));
}

export async function loadTicketDocumentContext(pool, bookingId, ticketId) {
  const tRes = await pool.query(
    `SELECT t.id, t.ticket_number, t.passenger_id, t.issued_at, t.ticket_status,
            b.id AS booking_id, b.pnr, b.trip_type, b.booking_status, b.payment_status,
            b.total_amount, b.currency, b.fare_breakdown, b.fare_base_total, b.fare_tax_total, b.fare_fee_total,
            b.created_at AS booked_at
     FROM tickets t
     JOIN bookings b ON b.id = t.booking_id
     WHERE t.booking_id = $1 AND t.id = $2`,
    [bookingId, ticketId]
  );
  const ticket = tRes.rows[0];
  if (!ticket) return null;

  const [pRes, fRes, pcRes, seatsRes] = await Promise.all([
    pool.query(
      `SELECT id, first_name, last_name, email, phone
       FROM passengers WHERE id = $1`,
      [ticket.passenger_id]
    ),
    pool.query(
      `SELECT f.id, f.flight_number, f.departure_airport, f.arrival_airport,
              f.departure_time, f.arrival_time, bf.leg_type, bf.fare_amount,
              COALESCE(bf.cabin_class, 'ECONOMY') AS cabin_class
       FROM booking_flights bf
       JOIN flights f ON f.id = bf.flight_id
       WHERE bf.booking_id = $1
       ORDER BY CASE bf.leg_type WHEN 'OUTBOUND' THEN 1 WHEN 'INBOUND' THEN 2 ELSE 3 END, f.departure_time ASC`,
      [bookingId]
    ),
    pool.query(
      `SELECT COUNT(DISTINCT bp.passenger_id)::int AS c
       FROM booking_passengers bp WHERE bp.booking_id = $1`,
      [bookingId]
    ),
    pool.query(
      `SELECT c.flight_id, c.seat_number
       FROM checkins c
       WHERE c.booking_id = $1 AND c.passenger_id = $2`,
      [bookingId, ticket.passenger_id]
    )
  ]);

  const passenger = pRes.rows[0] || {};
  const flights = fRes.rows;
  const paxCount = Math.max(1, Number(pcRes.rows[0]?.c || 1));
  const seatByFlight = {};
  for (const s of seatsRes.rows) {
    seatByFlight[s.flight_id] = s.seat_number;
  }

  const legBaseSum = flights.reduce((s, fl) => s + Number(fl.fare_amount || 0), 0);
  const perPaxTotal = Number(ticket.total_amount) / paxCount;

  return {
    ticket,
    passenger,
    flights,
    paxCount,
    seatByFlight,
    legBaseSum,
    perPaxTotal,
    fareLines: fareLinesFromBooking(ticket)
  };
}

export async function loadBookingDocumentContext(pool, bookingId) {
  const bRes = await pool.query(
    `SELECT b.*, pc.code AS promo_code
     FROM bookings b
     LEFT JOIN sales_promo_codes pc ON pc.id = b.promo_code_id
     WHERE b.id = $1`,
    [bookingId]
  );
  const booking = bRes.rows[0];
  if (!booking) return null;

  const [flights, passengers, payments] = await Promise.all([
    pool.query(
      `SELECT f.flight_number, f.departure_airport, f.arrival_airport, f.departure_time, bf.leg_type, bf.fare_amount
       FROM booking_flights bf
       JOIN flights f ON f.id = bf.flight_id
       WHERE bf.booking_id = $1
       ORDER BY CASE bf.leg_type WHEN 'OUTBOUND' THEN 1 WHEN 'INBOUND' THEN 2 ELSE 3 END, f.departure_time ASC`,
      [bookingId]
    ),
    pool.query(
      `SELECT p.first_name, p.last_name, p.email, bp.passenger_type
       FROM booking_passengers bp
       JOIN passengers p ON p.id = bp.passenger_id
       WHERE bp.booking_id = $1`,
      [bookingId]
    ),
    pool.query(
      `SELECT id, payment_type, amount, currency, payment_status, transaction_ref, processed_at
       FROM payments WHERE booking_id = $1 ORDER BY processed_at DESC`,
      [bookingId]
    )
  ]);

  return {
    booking,
    flights: flights.rows,
    passengers: passengers.rows,
    payments: payments.rows,
    fareLines: fareLinesFromBooking(booking)
  };
}

function pdfBufferFromBuilder(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Producer: 'Ticketing Platform' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      buildFn(doc);
    } catch (e) {
      reject(e);
      return;
    }
    doc.end();
  });
}

function drawSectionTitle(doc, x, y, w, title) {
  doc.font('Helvetica-Bold').fontSize(10).fillColor(BRAND_HEX).text(title.toUpperCase(), x, y, { width: w });
  return y + 14;
}

/** Two-column info row: label | value (single line). */
function drawInfoRow(doc, x, y, w, label, value, opts = {}) {
  const lh = opts.lineHeight || 13;
  const labelW = opts.labelWidth || 118;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#64748b').text(label, x, y, { width: labelW, continued: false });
  doc.font('Helvetica').fontSize(8.5).fillColor('#0f172a').text(String(value ?? '—'), x + labelW + 6, y, {
    width: w - labelW - 8
  });
  return y + lh;
}

export async function buildEticketPdfBuffer(ctx) {
  const { ticket, passenger, flights, seatByFlight, perPaxTotal, fareLines, paxCount } = ctx;
  const pnr = ticket.pnr;
  const tkt = ticket.ticket_number;
  const qrPayload = `ETKT|${pnr}|${tkt}|${ticket.booking_id}`;
  const qrPng = await QRCode.toBuffer(qrPayload, { type: 'png', margin: 1, width: 200, errorCorrectionLevel: 'M' });
  const headerLogoBuf = readOptionalBrandLogoPng();

  const name = `${passenger.first_name || ''} ${passenger.last_name || ''}`.trim() || 'Passenger';
  const fare = computeFareBreakdown(ctx);
  const globalTrip = tripTypeLabel(ticket.trip_type);

  return pdfBufferFromBuilderA4((doc) => {
    const ml = doc.page.margins.left;
    const mt = doc.page.margins.top;
    const pr = doc.page.margins.right;
    const mb = doc.page.margins.bottom;
    const pw = doc.page.width - ml - pr;
    const pageH = doc.page.height;
    const footerTop = pageH - mb - 80;

    const qrCol = 118;
    const gutter = 14;
    const mainW = pw - qrCol - gutter;

    let y = mt;

    const headerH = drawStandardDocumentHeader(doc, 'Electronic Ticket', {
      logoBuf: headerLogoBuf,
      marginLeft: ml,
      pageWidth: pw,
      y: mt,
      bandHeight: 130,
      innerPadX: 26,
      innerPadY: 24,
      logoSlotW: 320,
      logoMaxW: 280,
      logoMaxH: 110,
      bandColor: '#FFFFFF',
      theme: 'light',
      accentBarHeight: 5,
      accentBarColor: BRAND_HEX
    });
    y = mt + headerH + 8;

    const qrX = ml + mainW + gutter;
    const qrY = mt + headerH + 4;
    const qrSize = 102;
    doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });
    doc.font('Helvetica').fontSize(7.5).fillColor('#475569').text('Scan for PNR / ticket verification', qrX, qrY + qrSize + 5, {
      width: qrCol,
      align: 'center'
    });
    doc.font('Helvetica').fontSize(7).fillColor('#94a3b8').text(tkt, qrX, qrY + qrSize + 18, { width: qrCol, align: 'center' });

    /* ----- Current ticket information (PNR, ticket, passenger, booking status, issue date only) ----- */
    const panelPad = 12;
    const infoRowCount = 5;
    const infoBoxTop = y + 6;
    /* Title + rows + padding (title may wrap on narrow layouts). */
    const infoBoxH = 10 + 18 + infoRowCount * 13 + 12;
    doc.rect(ml, infoBoxTop, mainW, infoBoxH).fill('#ffffff');
    doc.rect(ml, infoBoxTop, mainW, infoBoxH).strokeColor('#e2e8f0').lineWidth(0.65).stroke();

    let py = infoBoxTop + 10;
    py = drawSectionTitle(doc, ml + panelPad, py, mainW - panelPad * 2, 'Current ticket information');
    py = drawInfoRow(doc, ml + panelPad, py, mainW - panelPad * 2, 'PNR', pnr);
    py = drawInfoRow(doc, ml + panelPad, py, mainW - panelPad * 2, 'Ticket number', tkt);
    py = drawInfoRow(doc, ml + panelPad, py, mainW - panelPad * 2, 'Passenger name', name);
    py = drawInfoRow(doc, ml + panelPad, py, mainW - panelPad * 2, 'Booking status', eticketBookingStatusLine(ticket.booking_status));
    py = drawInfoRow(doc, ml + panelPad, py, mainW - panelPad * 2, 'Issue date', formatIssueDate(ticket.issued_at));

    y = infoBoxTop + infoBoxH + 14;

    /* ----- Flight itinerary ----- */
    const itBoxTop = y;
    const rowH = 22;
    const legRows = Math.max(1, flights.length);
    const itBoxH = 38 + legRows * rowH + 24;
    doc.rect(ml, itBoxTop, mainW, itBoxH).fill('#ffffff');
    doc.rect(ml, itBoxTop, mainW, itBoxH).strokeColor('#e2e8f0').lineWidth(0.65).stroke();

    py = itBoxTop + 8;
    py = drawSectionTitle(doc, ml + panelPad, py, mainW - panelPad * 2, 'Flight itinerary');
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b').text(`Trip type (booking): ${globalTrip}`, ml + panelPad, py);
    py += 12;

    const col = {
      route: ml + panelPad,
      flt: ml + panelPad + 100,
      dep: ml + panelPad + 152,
      cab: ml + panelPad + 252,
      seat: ml + panelPad + 302
    };
    doc.font('Helvetica-Bold').fontSize(7).fillColor('#475569');
    doc.text('ROUTE', col.route, py, { width: 96 });
    doc.text('FLT', col.flt, py, { width: 46 });
    doc.text('DEPARTURE', col.dep, py, { width: 96 });
    doc.text('CABIN', col.cab, py, { width: 42 });
    doc.text('SEAT', col.seat, py, { width: 36 });
    py += 12;
    doc.moveTo(ml + panelPad, py).lineTo(ml + mainW - panelPad, py).strokeColor('#e2e8f0').lineWidth(0.5).stroke();
    py += 6;

    doc.font('Helvetica').fontSize(8).fillColor('#0f172a');
    for (const fl of flights) {
      const seat = seatByFlight[fl.id] || '—';
      const cabin = String(fl.cabin_class || 'ECONOMY').toUpperCase();
      const legLabel = fl.leg_type === 'INBOUND' ? 'Inbound' : 'Outbound';
      drawAirportRoute(doc, col.route, py, fl.departure_airport, fl.arrival_airport, { fontSize: 8 });
      doc.font('Helvetica-Bold').fontSize(8.5).text(String(fl.flight_number || '—'), col.flt, py + 1, { width: 52 });
      doc.font('Helvetica').fontSize(7.5).fillColor('#334155').text(formatEticketDateTime(fl.departure_time), col.dep, py + 1, { width: 92 });
      doc.font('Helvetica').fontSize(8).fillColor('#0f172a').text(cabin, col.cab, py + 1, { width: 44 });
      doc.font('Helvetica-Bold').fontSize(8.5).text(String(seat), col.seat, py + 1, { width: 40 });
      doc.font('Helvetica').fontSize(6.8).fillColor('#94a3b8').text(legLabel, col.dep, py + 12, { width: 200 });
      py += rowH;
    }

    y = itBoxTop + itBoxH + 14;

    /* ----- Fare breakdown ----- */
    const fareBoxTop = y;
    const fareBoxH = 112;
    doc.rect(ml, fareBoxTop, mainW, fareBoxH).fill('#ffffff');
    doc.rect(ml, fareBoxTop, mainW, fareBoxH).strokeColor('#e2e8f0').lineWidth(0.65).stroke();
    py = fareBoxTop + 10;
    py = drawSectionTitle(doc, ml + panelPad, py, mainW - panelPad * 2, 'Fare & charges');
    doc.font('Helvetica').fontSize(7.5).fillColor('#64748b').text(`${paxCount} passenger(s) on booking · amounts in ${fare.currency}`, ml + panelPad, py);
    py += 14;

    const tblLeft = ml + panelPad;
    const tblW = mainW - panelPad * 2;
    const amtX = tblLeft + tblW - 78;
    const rowLine = (label, amt, bold) => {
      doc.save();
      if (bold) doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a');
      else doc.font('Helvetica').fontSize(8.5).fillColor('#334155');
      doc.text(label, tblLeft, py, { width: tblW - 86 });
      doc.text(`${money(amt)} ${fare.currency}`, amtX, py, { width: 72, align: 'right' });
      doc.restore();
      py += 14;
    };
    rowLine('Base fare', fare.base, false);
    rowLine('Taxes', fare.taxes, false);
    rowLine('Fees', fare.fees, false);
    doc.moveTo(tblLeft, py).lineTo(tblLeft + tblW, py).strokeColor('#cbd5e1').lineWidth(0.45).stroke();
    py += 8;
    rowLine('Total paid (per passenger)', fare.total, true);

    /* ----- Footer (fixed): no additional brand text/logo for e-ticket ----- */
    doc.font('Helvetica').fontSize(8).fillColor('#475569');
    doc.text('Present this document or QR code at check-in.', ml, footerTop - 40, { width: pw, align: 'center' });
    doc.text('This ticket is electronically generated and valid without signature.', ml, footerTop - 26, {
      width: pw,
      align: 'center'
    });
    doc.fontSize(7).fillColor('#94a3b8').text(`Ref: ${pnr} / ${tkt}`, ml, footerTop - 12, { width: pw, align: 'center' });
    doc.fontSize(6.5).fillColor('#94a3b8').text('Generated by ticketing service', ml, footerTop + 8, {
      width: pw,
      align: 'center'
    });
  });
}

export async function buildInvoicePdfBuffer(ctx) {
  const { booking, flights, passengers, fareLines } = ctx;
  const logoBuf = readOptionalBrandLogoPng();
  return pdfBufferFromBuilder((doc) => {
    const bh = drawStandardDocumentHeader(doc, 'Booking invoice', { logoBuf });
    doc.x = 48;
    doc.y = bh + 16;
    doc.fontSize(10).fillColor('#111');
    doc.text(`PNR: ${booking.pnr}`);
    doc.text(`Trip: ${booking.trip_type} · Status: ${booking.booking_status} · Payment: ${booking.payment_status}`);
    doc.text(`Booked: ${formatWhen(booking.created_at)}`);
    doc.moveDown();

    doc.fontSize(12).fillColor(BRAND_HEX).text('Passengers', { underline: true });
    doc.moveDown(0.25);
    doc.fontSize(10).fillColor('#111');
    for (const p of passengers) {
      doc.text(`• ${p.first_name} ${p.last_name} (${p.passenger_type})${p.email ? ` · ${p.email}` : ''}`);
    }
    doc.moveDown();

    doc.fontSize(12).fillColor(BRAND_HEX).text('Flights', { underline: true });
    doc.moveDown(0.25);
    doc.fontSize(10).fillColor('#111');
    for (const fl of flights) {
      doc.text(
        `${fl.flight_number} ${fl.departure_airport}→${fl.arrival_airport} · ${formatWhen(fl.departure_time)} · leg ${fl.leg_type}`
      );
    }
    doc.moveDown();

    doc.fontSize(12).fillColor(BRAND_HEX).text('Charges', { underline: true });
    doc.moveDown(0.25);
    doc.fontSize(10).fillColor('#111');
    if (fareLines.length) {
      for (const L of fareLines) {
        doc.text(`${L.label}: ${money(L.amount)} ${booking.currency}`);
      }
    } else {
      doc.text(`(No line-item breakdown stored.)`);
    }
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').text(`Total: ${money(booking.total_amount)} ${booking.currency}`);
    doc.font('Helvetica');
    drawStandardPdfFooter(doc, 48, doc.page.height - 88, doc.page.width - 96, { withLogo: true, logoBuf });
  });
}

export async function buildReceiptPdfBuffer({ booking, payment }) {
  const logoBuf = readOptionalBrandLogoPng();
  return pdfBufferFromBuilder((doc) => {
    const bh = drawStandardDocumentHeader(doc, 'Payment receipt', { logoBuf });
    doc.x = 48;
    doc.y = bh + 16;
    doc.fontSize(10).fillColor('#111');
    doc.text(`PNR: ${booking.pnr}`);
    doc.text(`Receipt for payment ${payment.id}`);
    doc.text(`Type: ${payment.payment_type} · Status: ${payment.payment_status}`);
    doc.text(`Amount: ${money(payment.amount)} ${payment.currency}`);
    doc.text(`Reference: ${payment.transaction_ref || '—'}`);
    doc.text(`Processed: ${formatWhen(payment.processed_at)}`);
    doc.moveDown();
    doc.fontSize(8).fillColor('#64748b').text('Retain for your records. This is not a travel document.');
    drawStandardPdfFooter(doc, 48, doc.page.height - 88, doc.page.width - 96, { withLogo: true, logoBuf });
  });
}

function getSmtpTransport() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined
  });
}

export function isSmtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendEticketEmail({ to, subject, pdfBuffer, filename, pnr, ticketNo }) {
  const transport = getSmtpTransport();
  if (!transport) {
    const err = new Error('Email is not configured (set SMTP_HOST and SMTP_FROM).');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }
  const from = process.env.SMTP_FROM;
  const logoBuf = readOptionalBrandLogoPng();
  const attachments = [{ filename: filename || `e-ticket-${ticketNo}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }];
  if (logoBuf) {
    attachments.push({
      filename: 'hawana-logo.png',
      content: logoBuf,
      cid: 'hawana-brand-logo',
      contentType: 'image/png'
    });
  }
  const safePnr = escHtml(pnr);
  const safeTkt = escHtml(ticketNo);
  const brandHeader = logoBuf
    ? `<div style="border-bottom:2px solid #0047AB;padding-bottom:14px;margin-bottom:16px">
  <img src="cid:hawana-brand-logo" width="180" alt="${escHtml(AIRLINE_NAME)}" style="max-width:180px;height:auto;display:block" />
  <p style="margin:10px 0 0;font-size:18px;font-weight:bold;color:#001f5b;letter-spacing:0.02em">${escHtml(AIRLINE_NAME)}</p>
  <p style="margin:4px 0 0;font-size:12px;font-weight:600;color:#0047AB">${escHtml(HAWANA_BRAND.systemShort)} · ${escHtml(HAWANA_BRAND.tagline)}</p>
</div>`
    : `<div style="border-bottom:2px solid #0047AB;padding-bottom:14px;margin-bottom:16px">
  <p style="margin:0;font-size:18px;font-weight:bold;color:#001f5b">${escHtml(AIRLINE_NAME)}</p>
  <p style="margin:4px 0 0;font-size:12px;font-weight:600;color:#0047AB">${escHtml(HAWANA_BRAND.systemShort)} · ${escHtml(HAWANA_BRAND.tagline)}</p>
</div>`;
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;color:#0f172a;max-width:560px">
${brandHeader}
  <p style="margin:0 0 12px;font-size:15px">Dear passenger,</p>
  <p style="margin:0 0 12px;font-size:14px;line-height:1.5">Your electronic ticket <strong>${safeTkt}</strong> for PNR <strong>${safePnr}</strong> is attached as a PDF.</p>
  <p style="margin:16px 0 0;font-size:13px;color:#64748b">${escHtml(AIRLINE_NAME)}<br/>${escHtml(HAWANA_BRAND.systemFull)}</p>
</div>`;

  await transport.sendMail({
    from,
    to,
    subject: subject || `${AIRLINE_NAME} e-ticket ${ticketNo} · PNR ${pnr}`,
    text: `Dear passenger,\n\nPlease find your electronic ticket (${ticketNo}) for PNR ${pnr} attached as a PDF.\n\n${AIRLINE_NAME}\n${HAWANA_BRAND.systemFull}`,
    html,
    attachments
  });
}
