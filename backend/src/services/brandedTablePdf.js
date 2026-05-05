/**
 * Generic branded LETTER PDF with Hawana header + optional column table + footer.
 */

import PDFDocument from 'pdfkit';
import { readOptionalBrandLogoPng, drawStandardDocumentHeader, drawStandardPdfFooter, drawDocumentHeaderPdf } from '../lib/hawanaBranding.js';

export { drawStandardDocumentHeader, drawDocumentHeaderPdf, drawStandardPdfFooter, readOptionalBrandLogoPng };

/**
 * @param {(doc: import('pdfkit').PDFDocument) => void} buildFn
 * @param {{ title?: string }} [meta]
 */
export function pdfLetterFromBuilder(buildFn, meta = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 48,
      info: { Producer: 'HAMS', Title: meta.title || 'Report', Creator: 'Hawana Airways' }
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

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {Date} [opts.generatedAt]
 * @param {string[]} [opts.subtitles]
 * @param {{ label: string, width?: number }[]} opts.columns
 * @param {(string|number|null|undefined)[][]} opts.rows
 * @returns {Promise<Buffer>}
 */
export async function buildBrandedTablePdfBuffer(opts) {
  const logoBuf = readOptionalBrandLogoPng();
  const genAt = opts.generatedAt ?? new Date();
  const title = opts.title || 'Report';
  const subtitles = opts.subtitles || [];
  const columns = opts.columns || [];
  const rowData = opts.rows || [];
  const rowH = 11;
  const headH = 13;
  const left = 48;
  const right = 48;
  const gap = 5;
  const footReserve = 88;

  return pdfLetterFromBuilder((doc) => {
    const innerW = doc.page.width - left - right;
    const cw = columns.map((c, i, arr) => {
      if (c.width != null) return c.width;
      const sumFixed = columns.reduce((s, x, j) => s + (x.width != null ? x.width : 0), 0);
      const flex = columns.filter((x) => x.width == null).length;
      const rest = innerW - sumFixed - gap * (Math.max(arr.length, 1) - 1);
      return flex > 0 ? Math.max(40, Math.floor(rest / flex)) : 80;
    });

    let y = 88;

    const bottomLimit = () => doc.page.height - doc.page.margins.bottom - footReserve;

    function drawPageHeader(cont) {
      const bh = drawStandardDocumentHeader(doc, cont ? `${title} (continued)` : title, {
        logoBuf,
        generatedAt: cont ? false : genAt
      });
      y = bh + 12;
      doc.fillColor('#111');
      doc.fontSize(9);
      if (cont) {
        doc.font('Helvetica').fillColor('#64748b').text(`Period / context — see prior page (${title}).`, left, y, {
          width: innerW,
          ellipsis: true
        });
        y += 14;
      } else if (subtitles.length) {
        doc.font('Helvetica').fillColor('#475569');
        for (const s of subtitles) {
          doc.text(s, left, y, { width: innerW, ellipsis: true });
          y += 12;
        }
      }
      doc.fillColor('#0f172a');
      let x = left;
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#1e293b');
      columns.forEach((col, i) => {
        doc.text(col.label, x, y, { width: cw[i], ellipsis: true });
        x += cw[i] + gap;
      });
      y += headH;
      doc.font('Helvetica').fillColor('#0f172a').fontSize(7.5);
    }

    drawPageHeader(false);

    for (const cells of rowData) {
      if (y + rowH > bottomLimit()) {
        doc.addPage();
        drawPageHeader(true);
      }
      let x = left;
      const padded = [...cells];
      while (padded.length < columns.length) padded.push('');
      columns.forEach((_col, i) => {
        doc.text(String(padded[i] ?? ''), x, y, { width: cw[i], ellipsis: true });
        x += cw[i] + gap;
      });
      y += rowH;
    }

    drawStandardPdfFooter(doc, left, doc.page.height - doc.page.margins.bottom - 76, innerW, { withLogo: true, logoBuf });
  }, { title });
}

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {{ label: string, value: string }[]} opts.lines
 */
export async function buildBrandedKpiPdfBuffer(opts) {
  const logoBuf = readOptionalBrandLogoPng();
  const genAt = opts.generatedAt ?? new Date();
  return pdfLetterFromBuilder((doc) => {
    const bh = drawStandardDocumentHeader(doc, opts.title || 'Key performance indicators', { logoBuf, generatedAt: genAt });
    doc.x = 48;
    doc.y = bh + 16;
    doc.font('Helvetica-Bold').fillColor('#0f172a').fontSize(11).text(opts.rangeLine || '');
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(10);
    for (const row of opts.lines || []) {
      doc.fillColor('#64748b').text(`${row.label}:`, { continued: true });
      doc.fillColor('#0f172a').text(`  ${row.value}`);
    }
    doc.moveDown();
    doc.fontSize(8).fillColor('#94a3b8').text(opts.note || '');
    drawStandardPdfFooter(doc, 48, doc.page.height - 88, doc.page.width - 96, { withLogo: true, logoBuf });
  }, { title: opts.title });
}
