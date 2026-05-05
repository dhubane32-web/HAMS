/**
 * Branded flight manifest PDF (passenger list for a flight leg).
 */

import PDFDocument from 'pdfkit';
import { computeBoardingDisplayIso } from './checkinBoardingService.js';
import {
  readOptionalBrandLogoPng,
  drawStandardDocumentHeader,
  drawStandardPdfFooter
} from '../lib/hawanaBranding.js';

function pdfLetterFromBuilder(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 36, info: { Producer: 'HAMS DCS', Title: 'Flight manifest' } });
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

/**
 * @param {import('pg').Pool} pool
 * @param {string} flightId UUID
 * @returns {Promise<Buffer|null>}
 */
export async function buildFlightManifestPdfFromPool(pool, flightId) {
  const flightResult = await pool.query(
    `SELECT id, flight_number, departure_airport, arrival_airport, departure_time, arrival_time, gate, boarding_time, status,
            checkin_closed_at, checkin_closed_by
     FROM flights WHERE id = $1`,
    [flightId]
  );
  const flight = flightResult.rows[0];
  if (!flight) return null;

  const rows = await pool.query(
    `SELECT
      b.id AS booking_id,
      b.pnr,
      p.id AS passenger_id,
      p.first_name,
      p.last_name,
      p.travel_status AS passenger_travel_status,
      c.id AS checkin_id,
      c.seat_number,
      c.boarding_pass_no,
      c.checkin_time,
      c.boarding_status,
      c.checkin_status,
      c.boarded_at,
      c.boarding_gate,
      c.boarding_sequence,
      (SELECT COALESCE(SUM(bg.weight_kg), 0) FROM baggage bg WHERE bg.checkin_id = c.id) AS baggage_weight_kg,
      (SELECT COALESCE(SUM(bg.pieces), 0)::int FROM baggage bg WHERE bg.checkin_id = c.id) AS baggage_pieces,
      (
        SELECT t.ticket_number
        FROM tickets t
        WHERE t.booking_id = b.id AND t.passenger_id = p.id
        ORDER BY t.issued_at DESC
        LIMIT 1
      ) AS ticket_number
    FROM booking_flights bf
    JOIN bookings b ON b.id = bf.booking_id
    JOIN booking_passengers bp ON bp.booking_id = b.id
    JOIN passengers p ON p.id = bp.passenger_id
    LEFT JOIN checkins c
      ON c.booking_id = b.id AND c.passenger_id = p.id AND c.flight_id = bf.flight_id
    WHERE bf.flight_id = $1
      AND UPPER(TRIM(b.booking_status)) = 'CONFIRMED'
      AND UPPER(TRIM(COALESCE(b.payment_status, ''))) = 'PAID'
    ORDER BY b.pnr ASC, p.last_name ASC, p.first_name ASC`,
    [flightId]
  );

  const list = rows.rows;
  const checkedIn = list.filter((r) => r.checkin_id);
  const notCheckedIn = list.filter((r) => !r.checkin_id);
  const boarded = list.filter((r) => r.checkin_id && String(r.boarding_status || '').toUpperCase() === 'BOARDED');
  const boarding = list.filter((r) => r.checkin_id && String(r.boarding_status || '').toUpperCase() === 'BOARDING');
  const noShows = list.filter((r) => r.checkin_id && String(r.boarding_status || '').toUpperCase() === 'NO_SHOW');

  const bagTotals = await pool.query(
    `SELECT COALESCE(SUM(b.weight_kg), 0)::numeric AS total_kg, COALESCE(SUM(b.pieces), 0)::int AS total_pieces
     FROM baggage b
     JOIN checkins c ON c.id = b.checkin_id
     WHERE c.flight_id = $1`,
    [flightId]
  );

  const boardingDisplayTime = computeBoardingDisplayIso(flight);
  const logoBuf = readOptionalBrandLogoPng();

  return pdfLetterFromBuilder((doc) => {
    const bh0 = drawStandardDocumentHeader(doc, 'Flight manifest', { logoBuf });
    doc.fillColor('#111').fontSize(10);
    doc.x = 48;
    doc.y = bh0 + 14;

    doc.font('Helvetica-Bold').text(
      `${flight.flight_number || '—'}  ${flight.departure_airport || ''} → ${flight.arrival_airport || ''}`,
      { continued: false }
    );
    doc.font('Helvetica').fontSize(9);
    doc.text(
      `Departure: ${flight.departure_time || '—'} · Gate: ${flight.gate || 'TBD'} · Boarding: ${boardingDisplayTime || '—'} · Status: ${flight.status || '—'}`
    );
    if (flight.checkin_closed_at) {
      doc.text(`Check-in closed: ${flight.checkin_closed_at}`);
    }
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(9).text('Summary');
    doc.font('Helvetica').fontSize(8.5);
    doc.text(
      `Expected: ${list.length} · Checked in: ${checkedIn.length} · Pending: ${notCheckedIn.length} · Boarding: ${boarding.length} · Boarded: ${boarded.length} · No-show: ${noShows.length} · Baggage: ${Number(bagTotals.rows[0]?.total_pieces || 0)} pcs / ${Number(bagTotals.rows[0]?.total_kg || 0).toFixed(1)} kg`
    );
    doc.moveDown();

    const col = { pnr: 48, name: 118, seat: 268, ticket: 312, status: 400, bp: 470 };
    const rowH = 11;
    const bottom = doc.page.height - doc.page.margins.bottom - 56;

    function drawTableHeader(y0) {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#475569');
      doc.text('PNR', col.pnr, y0, { width: 64 });
      doc.text('Passenger', col.name, y0, { width: 140 });
      doc.text('Seat', col.seat, y0, { width: 36 });
      doc.text('Ticket', col.ticket, y0, { width: 78 });
      doc.text('Boarding', col.status, y0, { width: 62 });
      doc.text('BP #', col.bp, y0, { width: 72 });
      doc.fillColor('#111');
      return y0 + rowH + 2;
    }

    function drawRow(r, y0) {
      const name = `${r.first_name || ''} ${r.last_name || ''}`.trim();
      const st = r.checkin_id ? String(r.boarding_status || r.checkin_status || '—') : 'Not checked in';
      doc.font('Helvetica').fontSize(7.5);
      doc.text(String(r.pnr || '—'), col.pnr, y0, { width: 64 });
      doc.text(name || '—', col.name, y0, { width: 140 });
      doc.text(String(r.seat_number || '—'), col.seat, y0, { width: 36 });
      doc.text(String(r.ticket_number || '—'), col.ticket, y0, { width: 78 });
      doc.text(st, col.status, y0, { width: 62 });
      doc.text(String(r.boarding_pass_no || '—'), col.bp, y0, { width: 72 });
      return y0 + rowH;
    }

    let y = doc.y + 4;
    y = drawTableHeader(y);
    doc.font('Helvetica').fillColor('#0f172a');

    for (const r of list) {
      if (y > bottom) {
        doc.addPage();
        const bh1 = drawStandardDocumentHeader(doc, 'Flight manifest (cont.)', {
          logoBuf,
          generatedAt: false
        });
        doc.x = 48;
        doc.y = bh1 + 10;
        y = drawTableHeader(doc.y);
      }
      y = drawRow(r, y);
    }

    drawStandardPdfFooter(doc, 48, doc.page.height - 88, doc.page.width - 96, { withLogo: true, logoBuf });
  });
}
