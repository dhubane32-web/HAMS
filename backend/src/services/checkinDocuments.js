/**
 * IATA-style boarding pass and baggage tag PDFs for DCS / airport operations.
 */

import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';

const AIRLINE_NAME = 'Hawana Airways';
const BRAND_HEX = '#0d47a1';

function formatWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

function pdfBufferFromBuilder(buildFn) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [288, 432], margin: 24, info: { Producer: 'HAMS DCS' } });
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

/** @param {Record<string, unknown>} view Boarding pass fields from buildBoardingPassView */
export async function buildBoardingPassPdfBuffer(view) {
  if (!view) return null;
  const qrPayload = `HAMS|BP|${view.boardingPassNo || view.checkin_id}|${view.pnr || ''}`;
  const qrPng = await QRCode.toBuffer(qrPayload, { type: 'png', margin: 1, width: 120, errorCorrectionLevel: 'M' });

  return pdfBufferFromBuilder((doc) => {
    doc.save();
    doc.rect(0, 0, doc.page.width, 52).fillColor(BRAND_HEX).fill();
    doc.fillColor('#fff').fontSize(11).text(AIRLINE_NAME, 20, 14);
    doc.fontSize(8).text('Boarding pass', 20, 30);
    doc.restore();
    doc.fillColor('#111').fontSize(9);
    let y = 58;
    const line = (t) => {
      doc.text(t, 20, y, { width: doc.page.width - 40 });
      y += 12;
    };
    line(`Passenger: ${view.passengerName || '—'}`);
    line(`PNR: ${view.pnr || '—'}  ·  Ticket: ${view.ticketNumber || '—'}`);
    line(`Flight: ${view.flightNumber || '—'}  ${view.route || ''}`);
    line(`Seat: ${view.seat || '—'}  ·  Gate: ${view.gate || 'TBD'}`);
    line(`Boarding: ${formatWhen(view.boardingTime)}  ·  Departure: ${formatWhen(view.departureTime)}`);
    line(`BP #: ${view.boardingPassNo || '—'}`);
    if (view.boarding_sequence != null) {
      line(`Boarding sequence: ${view.boarding_sequence}`);
    }
    line(`Status: ${view.boarding_status || '—'} / ${view.checkin_status || '—'}`);
    doc.image(qrPng, (doc.page.width - 100) / 2, y + 4, { width: 100, height: 100 });
    doc.fontSize(6).fillColor('#64748b').text('Scan at gate / security', 20, doc.page.height - 28, { align: 'center', width: doc.page.width - 40 });
  });
}

/**
 * @param {object} ctx
 */
export async function buildBagTagPdfBuffer(ctx) {
  const {
    tagNumber,
    pnr,
    passengerName,
    flightNumber,
    departureAirport,
    arrivalAirport,
    weightKg,
    pieces
  } = ctx;
  const qrPayload = `HAMS|BAG|${tagNumber}`;
  const qrPng = await QRCode.toBuffer(qrPayload, { type: 'png', margin: 1, width: 100, errorCorrectionLevel: 'M' });

  return pdfBufferFromBuilder((doc) => {
    doc.rect(0, 0, doc.page.width, 40).fillColor('#1e293b').fill();
    doc.fillColor('#fff').fontSize(10).text('BAGGAGE', 16, 12);
    doc.fillColor('#111').fontSize(10);
    let y = 48;
    doc.font('Helvetica-Bold').text(String(tagNumber || '—'), 16, y, { width: doc.page.width - 32 });
    y += 22;
    doc.font('Helvetica').fontSize(9);
    doc.text(`${flightNumber || '—'}  ${departureAirport || ''}→${arrivalAirport || ''}`, 16, y, { width: doc.page.width - 32 });
    y += 14;
    doc.text(`PNR ${pnr || '—'}`, 16, y);
    y += 14;
    doc.text(passengerName || '—', 16, y, { width: doc.page.width - 32 });
    y += 28;
    doc.text(`Wt ${weightKg != null ? `${weightKg} kg` : '—'}  ·  Pcs ${pieces != null ? pieces : '—'}`, 16, y);
    doc.image(qrPng, doc.page.width - 116, 44, { width: 88, height: 88 });
    doc.fontSize(6).fillColor('#64748b').text('Affix to bag — destination below flight', 16, doc.page.height - 22, {
      width: doc.page.width - 32
    });
  });
}

export async function loadBagTagPdfContext(pool, baggageId) {
  if (!baggageId) return null;
  const r = await pool.query(
    `SELECT bg.id,
            bg.tag_number,
            bg.weight_kg,
            bg.pieces,
            b.pnr,
            p.first_name,
            p.last_name,
            f.flight_number,
            f.departure_airport,
            f.arrival_airport
     FROM baggage bg
     JOIN checkins c ON c.id = bg.checkin_id
     JOIN bookings b ON b.id = c.booking_id
     JOIN passengers p ON p.id = c.passenger_id
     JOIN flights f ON f.id = c.flight_id
     WHERE bg.id = $1`,
    [baggageId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    tagNumber: row.tag_number,
    pnr: row.pnr,
    passengerName: `${row.first_name || ''} ${row.last_name || ''}`.trim(),
    flightNumber: row.flight_number,
    departureAirport: row.departure_airport,
    arrivalAirport: row.arrival_airport,
    weightKg: row.weight_kg,
    pieces: row.pieces
  };
}
