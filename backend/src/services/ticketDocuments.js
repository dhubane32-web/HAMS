/**
 * Branded PDFs (e-ticket, invoice, receipt) and optional email delivery.
 */

import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import nodemailer from 'nodemailer';

const AIRLINE_NAME = 'Hawana Airways';
const AIRLINE_TAGLINE = 'Your journey, elevated.';
const BRAND_HEX = '#0d47a1';

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

function drawBrandHeader(doc, title) {
  doc.save();
  doc.rect(0, 0, doc.page.width, 72).fillColor(BRAND_HEX).fill();
  doc.fillColor('#ffffff').fontSize(18).text(AIRLINE_NAME, 48, 22, { continued: false });
  doc.fontSize(9).text(AIRLINE_TAGLINE, 48, 46);
  doc.fontSize(11).text(title, 48, 58);
  doc.restore();
  doc.fillColor('#111111').fontSize(10);
  doc.y = 88;
}

function pdfBufferFromBuilder(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Producer: 'HAMS' } });
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

export async function buildEticketPdfBuffer(ctx) {
  const { ticket, passenger, flights, seatByFlight, perPaxTotal, fareLines, paxCount } = ctx;
  const pnr = ticket.pnr;
  const tkt = ticket.ticket_number;
  const qrPayload = `HAMS|${pnr}|${tkt}|${ticket.booking_id}`;
  const qrPng = await QRCode.toBuffer(qrPayload, { type: 'png', margin: 1, width: 160, errorCorrectionLevel: 'M' });

  const name = `${passenger.first_name || ''} ${passenger.last_name || ''}`.trim() || 'Passenger';

  const textW = doc => Math.min(400, doc.page.width - 96);

  return pdfBufferFromBuilder((doc) => {
    drawBrandHeader(doc, 'Electronic ticket (e-ticket)');
    doc.x = 48;

    doc.fontSize(12).fillColor(BRAND_HEX).text('Ticket details', { underline: true, width: textW(doc) });
    doc.moveDown(0.3);
    doc.fillColor('#111').fontSize(10);
    doc.text(`PNR: ${pnr}`, { width: textW(doc) });
    doc.text(`Ticket number: ${tkt}`, { width: textW(doc) });
    doc.text(`Passenger: ${name}`, { width: textW(doc) });
    doc.text(`Status: ${ticket.ticket_status || '—'}`, { width: textW(doc) });
    doc.text(`Booking status: ${ticket.booking_status || '—'} · Payment: ${ticket.payment_status || '—'}`, { width: textW(doc) });
    doc.moveDown();

    doc.fontSize(12).fillColor(BRAND_HEX).text('Itinerary', { underline: true, width: textW(doc) });
    doc.moveDown(0.3);
    doc.fillColor('#111').fontSize(10);
    for (const fl of flights) {
      const seat = seatByFlight[fl.id] || '—';
      doc.text(
        `${fl.leg_type === 'INBOUND' ? 'Inbound' : 'Outbound'} · ${fl.flight_number}  ${fl.departure_airport} → ${fl.arrival_airport}`,
        { width: textW(doc) }
      );
      doc.text(`  Date: ${formatWhen(fl.departure_time)} · Seat: ${seat} · Cabin: ${fl.cabin_class || 'ECONOMY'}`, {
        width: textW(doc)
      });
      doc.moveDown(0.35);
    }

    doc.fontSize(12).fillColor(BRAND_HEX).text('Fare & taxes (per passenger)', { underline: true, width: textW(doc) });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#111');
    if (fareLines.length) {
      for (const L of fareLines) {
        const tag = L.type === 'tax' ? '[tax]' : L.type === 'fee' ? '[fee]' : '';
        doc.text(`${L.label} ${tag}: ${money(L.amount)} ${ticket.currency}`, { width: textW(doc) });
      }
    } else {
      doc.text(`Leg base (sum of legs): ${money(ctx.legBaseSum)} ${ticket.currency}`, { width: textW(doc) });
    }
    doc.moveDown(0.2);
    doc.font('Helvetica-Bold').text(`Total due (this passenger, ${paxCount} pax on booking): ${money(perPaxTotal)} ${ticket.currency}`, {
      width: textW(doc)
    });
    doc.font('Helvetica');
    if (ticket.fare_base_total != null) {
      doc.text(`Recorded base (booking): ${money(ticket.fare_base_total)} ${ticket.currency}`, { width: textW(doc) });
    }
    if (ticket.fare_tax_total != null) {
      doc.text(`Recorded taxes (booking): ${money(ticket.fare_tax_total)} ${ticket.currency}`, { width: textW(doc) });
    }
    if (ticket.fare_fee_total != null) {
      doc.text(`Recorded fees (booking): ${money(ticket.fare_fee_total)} ${ticket.currency}`, { width: textW(doc) });
    }
    doc.moveDown();
    doc.fontSize(8).fillColor('#64748b').text(`Issued: ${formatWhen(ticket.issued_at)} · Present this document or QR at check-in.`, {
      width: textW(doc)
    });

    const qrSize = 132;
    const qx = (doc.page.width - qrSize) / 2;
    const qy = Math.min(doc.y + 16, doc.page.height - qrSize - 72);
    doc.image(qrPng, qx, qy, { width: qrSize, height: qrSize });
    doc.y = qy + qrSize + 6;
    doc.fontSize(7).fillColor('#64748b').text('Scan for PNR / ticket verification', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(8).fillColor('#111').font('Courier').text(tkt, { align: 'center' });
    doc.font('Helvetica');
    doc.fontSize(7).fillColor('#64748b').text('Ticket number (numeric)', { align: 'center' });
  });
}

export async function buildInvoicePdfBuffer(ctx) {
  const { booking, flights, passengers, fareLines } = ctx;
  return pdfBufferFromBuilder((doc) => {
    drawBrandHeader(doc, 'Booking invoice');
    doc.x = 48;
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
  });
}

export async function buildReceiptPdfBuffer({ booking, payment }) {
  return pdfBufferFromBuilder((doc) => {
    drawBrandHeader(doc, 'Payment receipt');
    doc.x = 48;
    doc.fontSize(10).fillColor('#111');
    doc.text(`PNR: ${booking.pnr}`);
    doc.text(`Receipt for payment ${payment.id}`);
    doc.text(`Type: ${payment.payment_type} · Status: ${payment.payment_status}`);
    doc.text(`Amount: ${money(payment.amount)} ${payment.currency}`);
    doc.text(`Reference: ${payment.transaction_ref || '—'}`);
    doc.text(`Processed: ${formatWhen(payment.processed_at)}`);
    doc.moveDown();
    doc.fontSize(8).fillColor('#64748b').text('Retain for your records. This is not a travel document.');
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

export async function sendEticketEmail({ to, subject, pdfBuffer, filename, pnr, ticketNo }) {
  const transport = getSmtpTransport();
  if (!transport) {
    const err = new Error('Email is not configured (set SMTP_HOST and SMTP_FROM).');
    err.code = 'SMTP_NOT_CONFIGURED';
    throw err;
  }
  const from = process.env.SMTP_FROM;
  await transport.sendMail({
    from,
    to,
    subject: subject || `${AIRLINE_NAME} e-ticket ${ticketNo} · PNR ${pnr}`,
    text: `Dear passenger,\n\nPlease find your electronic ticket (${ticketNo}) for PNR ${pnr} attached as a PDF.\n\n${AIRLINE_NAME}`,
    attachments: [{ filename: filename || `e-ticket-${ticketNo}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
  });
}
