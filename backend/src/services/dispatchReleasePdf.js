import PDFDocument from 'pdfkit';
import { drawStandardDocumentHeader } from '../lib/hawanaBranding.js';

/**
 * @param {object} payload
 * @returns {Promise<Buffer>}
 */
export function buildDispatchReleasePdf(payload) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 48,
      info: { Producer: 'HAMS', Title: `Dispatch Release ${payload.releaseNumber || ''}` }
    });
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawStandardDocumentHeader(doc, 'Dispatch Release', { subtitle: payload.releaseNumber || '' });

    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#334155');
    const lines = [
      ['Flight', payload.flightNumber || '—'],
      ['Route', payload.route || '—'],
      ['STD / STA', `${payload.std || '—'} / ${payload.sta || '—'}`],
      ['Tail', payload.tail || '—'],
      ['Status', payload.releaseStatus || '—'],
      ['Dispatcher', payload.dispatcher || '—'],
      ['Released', payload.releasedAt || '—']
    ];
    for (const [k, v] of lines) {
      doc.font('Helvetica-Bold').text(`${k}: `, { continued: true });
      doc.font('Helvetica').text(String(v));
    }

    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(11).text('Operational remarks');
    doc.font('Helvetica').fontSize(10).text(payload.operationalRemarks || '—');

    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(11).text('Weather');
    doc.font('Helvetica').fontSize(10).text(payload.weatherNotes || '—');

    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(11).text('MEL / CDL');
    doc.font('Helvetica').fontSize(10).text(payload.melCdlNotes || 'None reported');

    doc.moveDown();
    doc.font('Helvetica-Bold').fontSize(11).text('Checklist');
    const checklist = payload.checklist || {};
    for (const [key, val] of Object.entries(checklist)) {
      doc.font('Helvetica').text(`${val ? '☑' : '☐'} ${key}`);
    }

    doc.end();
  });
}
