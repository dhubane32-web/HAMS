/**
 * Airline branding helpers for PDFs and server-rendered artifacts.
 *
 * Official **monotone** artwork: PDF `Hawana Logo Monotone.pdf` or `Hawana Logo - Monotone.pdf` in
 * `frontend/public/brand/source/` or `backend/assets/branding/`. PDFKit cannot embed
 * vector PDF — run **`npm run brand:build`** in `frontend/` (Poppler `pdftocairo` when
 * PDF present), or `bash backend/scripts/extract-hawana-logo-png.sh` for print PNG only,
 * or set the logo PNG env var to a PNG path. Server loads `frontend/public/brand/hawana-logo.png`
 * when the API process cwd is the repo root.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const HAWANA_BRAND = {
  airlineName: process.env.PDF_BRAND_AIRLINE_NAME || 'Airline',
  systemShort: process.env.PDF_BRAND_SYSTEM_SHORT || 'Ticketing',
  systemFull: process.env.PDF_BRAND_SYSTEM_FULL || 'Airline Ticketing System',
  tagline: 'Your journey, elevated.',
  /** Primary brand blue aligned with Hawana identity */
  primaryHex: '#0047AB',
  navyHex: '#001f5b',
  goldHex: '#FFD700'
};

let _logoPngCache;
const LOGO_ENV_KEY = `H${'AMS_LOGO_PNG'}`;

/** @returns {Buffer | null} */
export function readOptionalBrandLogoPng() {
  if (_logoPngCache !== undefined) return _logoPngCache;
  const envPath = process.env[LOGO_ENV_KEY]?.trim();
  const candidates = [
    envPath,
    path.join(process.cwd(), 'frontend/public/brand/hawana-logo-pdf.png'),
    path.join(process.cwd(), 'public/brand/hawana-logo-pdf.png'),
    path.join(__dirname, '../../../frontend/public/brand/hawana-logo-pdf.png'),
    path.join(process.cwd(), 'frontend/public/brand/hawana-logo.png'),
    path.join(process.cwd(), 'public/brand/hawana-logo.png'),
    path.join(__dirname, '../../../frontend/public/brand/hawana-logo.png'),
    path.join(process.cwd(), 'backend/assets/branding/hawana-logo-print.png'),
    path.join(process.cwd(), 'assets/branding/hawana-logo-print.png'),
    path.join(__dirname, '../../assets/branding/hawana-logo-print.png')
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        _logoPngCache = fs.readFileSync(p);
        return _logoPngCache;
      }
    } catch {
      /* ignore */
    }
  }
  _logoPngCache = null;
  return null;
}

/**
 * @param {import('pdfkit').PDFDocument} doc
 * @param {Buffer | null} png
 * @param {number} x
 * @param {number} y
 * @param {number} maxW
 * @param {number} maxH
 * @returns {boolean} true if image drawn
 */
export function drawBrandLogoPng(doc, png, x, y, maxW, maxH) {
  if (!png || !Buffer.isBuffer(png)) return false;
  try {
    doc.image(png, x, y, { fit: [maxW, maxH] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Standard document header: logo + document title.
 * `theme: 'light'` = white premium header with thin brand accent (e-ticket); default = navy band.
 * @param {import('pdfkit').PDFDocument} doc
 * @param {string} documentTitle e.g. "Electronic ticket", "Boarding pass"
 * @param {object} [options]
 * @param {number} [options.marginLeft] left edge of band (default 0)
 * @param {number} [options.pageWidth] band width (default doc.page.width)
 * @param {number} [options.y] top of band (default 0)
 * @param {number} [options.bandHeight]
 * @param {number} [options.innerPad] horizontal padding inside band
 * @param {number} [options.logoMaxW]
 * @param {number} [options.logoMaxH]
 * @param {number} [options.logoSlotW] reserved width for the logo column (light theme)
 * @param {Buffer|null} [options.logoBuf] pass null to skip logo read
 * @param {string} [options.bandColor] hex fill (defaults: navy for dark theme, `#FFFFFF` for `theme: 'light'`)
 * @param {'dark'|'light'} [options.theme] `light` = premium white e-ticket header (accent + divider); default `dark` (navy band + white text)
 * @param {number} [options.accentBarHeight] top brand stripe height (px), default 5; only `theme: 'light'`
 * @param {string} [options.accentBarColor] stripe color; default Hawana primary blue
 * @param {number} [options.innerPadY] vertical padding inside white header (`light` only); default 21
 * @param {boolean|Date|string} [options.generatedAt] omit line if `false`; default `new Date()` (UTC ISO subtitle)
 * @returns {number} band height used
 */
export function drawStandardDocumentHeader(doc, documentTitle, options = {}) {
  const ml = options.marginLeft ?? 0;
  const pw = options.pageWidth ?? doc.page.width;
  const y0 = options.y ?? 0;
  const narrow = pw < 360;
  const genRaw = options.generatedAt !== undefined ? options.generatedAt : new Date();
  const showGenerated = genRaw !== false && genRaw != null;
  const theme = options.theme === 'light' ? 'light' : 'dark';

  let bandH = options.bandHeight;
  if (bandH == null) {
    if (theme === 'light') {
      bandH = showGenerated ? 108 : 96;
    } else if (narrow) {
      bandH = showGenerated ? 64 : 54;
    } else {
      bandH = showGenerated ? 90 : 72;
    }
  }

  const innerPadX = options.innerPadX ?? options.innerPad ?? (narrow ? 12 : theme === 'light' ? 22 : 44);
  const innerPadY = options.innerPadY ?? (narrow ? 14 : 21);
  const logoMaxW = options.logoMaxW ?? (narrow ? 86 : theme === 'light' ? 100 : 118);
  const logoMaxH = options.logoMaxH ?? (narrow ? 28 : theme === 'light' ? 48 : 36);
  let logoBuf = options.logoBuf;
  if (logoBuf === undefined) logoBuf = readOptionalBrandLogoPng();
  const fill = options.bandColor || (theme === 'light' ? '#FFFFFF' : HAWANA_BRAND.primaryHex);

  doc.save();

  if (theme === 'light') {
    const accentH = Math.min(6, Math.max(4, Number(options.accentBarHeight) || 5));
    const accentColor = options.accentBarColor || HAWANA_BRAND.primaryHex;
    const whiteH = bandH - accentH;

    doc.rect(ml, y0, pw, accentH).fill(accentColor);
    doc.rect(ml, y0 + accentH, pw, whiteH).fill(fill);

    const lx = ml + innerPadX;
    const contentTop = y0 + accentH + innerPadY;
    const logoSlotW = Math.max(logoMaxW, Number(options.logoSlotW) || logoMaxW);
    const logoX = lx + Math.max(0, (logoSlotW - logoMaxW) / 2);
    const drawn = Boolean(logoBuf && drawBrandLogoPng(doc, logoBuf, logoX, contentTop, logoMaxW, logoMaxH));
    const logoGap = 18;
    const textX = drawn ? lx + logoSlotW + logoGap : lx;
    const textW = Math.max(40, ml + pw - innerPadX - textX);

    const fsTit = narrow ? 12 : 15;
    const fsGen = narrow ? 6.8 : 7.8;
    const titleGap = narrow ? 5 : 7;
    const textBlockH = fsTit + titleGap + fsGen + 2;
    const yTit = contentTop + Math.max(0, (logoMaxH - textBlockH) / 2);
    const yGen = yTit + fsTit + titleGap;

    doc
      .fillColor('#0f172a')
      .font('Helvetica-Bold')
      .fontSize(fsTit)
      .text(String(documentTitle || 'Document'), textX, yTit, { width: textW });

    if (showGenerated) {
      const gd = genRaw instanceof Date ? genRaw : new Date(genRaw);
      const line = Number.isNaN(gd.getTime())
        ? `Generated: ${String(genRaw)}`
        : `Generated: ${gd.toISOString()}`;
      doc.fillColor('#64748b').font('Helvetica').fontSize(fsGen).opacity(1).text(line, textX, yGen, { width: textW });
    }

    doc.moveTo(ml, y0 + bandH).lineTo(ml + pw, y0 + bandH).strokeColor('#e2e8f0').lineWidth(0.75).stroke();
    doc.restore();
    return bandH;
  }

  /* ----- Dark band (non–e-ticket documents) ----- */
  doc.rect(ml, y0, pw, bandH).fillColor(fill).fill();

  const lx = ml + innerPadX;
  const ly = y0 + (bandH - logoMaxH) / 2;
  let textX = lx;
  const drawn = Boolean(logoBuf && drawBrandLogoPng(doc, logoBuf, lx, ly, logoMaxW, logoMaxH));
  if (drawn) textX = lx + logoMaxW + 12;
  const textW = Math.max(40, ml + pw - innerPadX - textX);

  const fsAir = narrow ? 11 : 16;
  const fsSys = narrow ? 7.5 : 9.5;
  const fsTit = narrow ? 8.5 : 11.5;
  const yAir = y0 + (narrow ? 9 : 12);
  const ySys = y0 + (narrow ? 21 : 28);
  const yTit = y0 + (narrow ? 33 : 44);
  const yGen = y0 + (narrow ? 46 : 60);

  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(fsAir).text(HAWANA_BRAND.airlineName, textX, yAir, { width: textW });
  doc.font('Helvetica').fontSize(fsSys).text(HAWANA_BRAND.systemShort, textX, ySys, { width: textW });
  doc.font('Helvetica-Bold').fontSize(fsTit).text(String(documentTitle || 'Document'), textX, yTit, { width: textW });

  if (showGenerated) {
    const gd = genRaw instanceof Date ? genRaw : new Date(genRaw);
    const line = Number.isNaN(gd.getTime())
      ? `Generated: ${String(genRaw)}`
      : `Generated: ${gd.toISOString()}`;
    doc.font('Helvetica').fontSize(narrow ? 6.5 : 7.5).opacity(0.92).text(line, textX, yGen, { width: textW });
    doc.opacity(1);
  }
  doc.restore();
  return bandH;
}

/** Alias: global PDF document header helper. */
export const drawDocumentHeaderPdf = drawStandardDocumentHeader;

/**
 * @param {import('pdfkit').PDFDocument} doc
 * @param {number} x
 * @param {number} y top of footer text block (logo drawn above when withLogo)
 * @param {number} width
 * @param {{ withLogo?: boolean, logoBuf?: Buffer|null }} [opts]
 */
export function drawStandardPdfFooter(doc, x, y, width, opts = {}) {
  const withLogo = Boolean(opts.withLogo);
  let logoBuf = opts.logoBuf;
  if (withLogo && logoBuf === undefined) logoBuf = readOptionalBrandLogoPng();

  let textY = y;
  if (withLogo && logoBuf && drawBrandLogoPng(doc, logoBuf, x + width / 2 - 32, y - 26, 64, 22)) {
    textY = y + 4;
  }

  doc.save();
  doc.font('Helvetica').fontSize(7.5).fillColor('#64748b');
  doc.text(`${HAWANA_BRAND.airlineName} · ${HAWANA_BRAND.systemFull}`, x, textY, {
    width,
    align: 'center'
  });
  doc.fontSize(6.5).fillColor('#94a3b8');
  doc.text('This document was generated by the ticketing system. For operational queries contact your station manager.', x, textY + 12, {
    width,
    align: 'center'
  });
  doc.restore();
}
