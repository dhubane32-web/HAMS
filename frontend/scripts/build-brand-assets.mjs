/**
 * HAMS official branding build.
 *
 * Source of truth (only): `frontend/public/brand/source/Hawana Logo Monotone.pdf`
 * Outputs: `hawana-logo.png`, `hawana-logo-dark.png`, `favicon.ico` and optional `hawana-logo.svg`
 * under `frontend/public/brand/`.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(__dirname, '..');
const BRAND_OUT = path.join(FRONTEND, 'public', 'brand');
const SOURCE = path.join(BRAND_OUT, 'source');
const BACKEND_BRAND = path.join(FRONTEND, '..', 'backend', 'assets', 'branding');
const OFFICIAL_SOURCE_NAME = 'Hawana Logo Monotone.pdf';
const OFFICIAL_SOURCE_PDF = path.join(SOURCE, OFFICIAL_SOURCE_NAME);

/** If the canonical file is missing, accept env path or a single known-alias filename in `source/`. */
function ensureOfficialSourcePdf() {
  fs.mkdirSync(SOURCE, { recursive: true });
  if (fs.existsSync(OFFICIAL_SOURCE_PDF)) return;

  const envSrc = process.env.HAMS_BRAND_SOURCE_PDF?.trim();
  if (envSrc && fs.existsSync(envSrc)) {
    fs.copyFileSync(envSrc, OFFICIAL_SOURCE_PDF);
    console.warn('Copied official PDF from HAMS_BRAND_SOURCE_PDF to', OFFICIAL_SOURCE_PDF);
    return;
  }

  const aliases = ['Hawana Logo - Monotone.pdf', 'hawana-logo-monotone.pdf', 'Hawana-Logo-Monotone.pdf', 'hawana-logo.pdf'];
  for (const a of aliases) {
    const p = path.join(SOURCE, a);
    if (fs.existsSync(p)) {
      fs.renameSync(p, OFFICIAL_SOURCE_PDF);
      console.warn(`Renamed "${a}" -> "${OFFICIAL_SOURCE_NAME}" in public/brand/source/`);
      return;
    }
  }
}

function assertSingleOfficialSourcePdf() {
  fs.mkdirSync(SOURCE, { recursive: true });
  const sourceEntries = fs.readdirSync(SOURCE, { withFileTypes: true });
  const pdfs = sourceEntries.filter((e) => e.isFile() && /\.pdf$/i.test(e.name)).map((e) => e.name);
  const duplicates = pdfs.filter((n) => n !== OFFICIAL_SOURCE_NAME);
  if (!fs.existsSync(OFFICIAL_SOURCE_PDF)) {
    throw new Error(
      `Missing official source PDF: ${OFFICIAL_SOURCE_PDF}. ` +
        `Place "${OFFICIAL_SOURCE_NAME}" in frontend/public/brand/source/ before running brand build.`
    );
  }
  if (duplicates.length) {
    throw new Error(
      `Duplicate source PDF(s) detected in ${SOURCE}: ${duplicates.join(', ')}. ` +
        `Keep only "${OFFICIAL_SOURCE_NAME}".`
    );
  }
  const legacyCandidates = [
    path.join(BACKEND_BRAND, 'Hawana Logo Monotone.pdf'),
    path.join(BACKEND_BRAND, 'Hawana Logo - Monotone.pdf'),
    path.join(BACKEND_BRAND, 'hawana-logo-monotone.pdf'),
    path.join(BACKEND_BRAND, 'Hawana-Logo-Monotone.pdf'),
    path.join(BACKEND_BRAND, 'hawana-logo.pdf')
  ];
  const legacyFound = legacyCandidates.filter((p) => fs.existsSync(p));
  if (legacyFound.length) {
    throw new Error(
      `Legacy source PDF(s) found outside official source folder: ${legacyFound.join(', ')}. ` +
        `Remove them to enforce source lock.`
    );
  }
}

function popplerEnv() {
  const prefix = ['/opt/homebrew/bin', '/usr/local/bin'].filter((d) => fs.existsSync(d)).join(path.delimiter);
  return { ...process.env, PATH: `${prefix}${path.delimiter}${process.env.PATH || ''}` };
}

function rasterizePdfToPng(pdfPath, outPng) {
  const tmpBase = path.join(BRAND_OUT, '._hawana_pdf_raster');
  fs.mkdirSync(BRAND_OUT, { recursive: true });
  const env = popplerEnv();
  let produced;
  try {
    execFileSync('pdftocairo', ['-png', '-transp', '-singlefile', '-r', '300', pdfPath, tmpBase], { env, stdio: 'inherit' });
    produced = `${tmpBase}.png`;
  } catch (e) {
    if (e?.code !== 'ENOENT' && e?.status !== 127) throw e;
    execFileSync('pdftoppm', ['-png', '-f', '1', '-l', '1', '-r', '300', pdfPath, tmpBase], { env, stdio: 'inherit' });
    produced = `${tmpBase}-1.png`;
  }
  if (!fs.existsSync(produced)) {
    throw new Error(
      `Poppler did not produce ${produced}. Install Poppler (macOS: brew install poppler) so pdftocairo or pdftoppm is available.`
    );
  }
  fs.renameSync(produced, outPng);
}

async function normalizeLogoPng(inputPath, outPath, maxWidth = 900) {
  const meta = await sharp(inputPath).metadata();
  const w = meta.width || 800;
  const pipeline = sharp(inputPath).ensureAlpha().png({ compressionLevel: 9 });
  if (w > maxWidth) {
    pipeline.resize({ width: maxWidth, withoutEnlargement: true });
  }
  await pipeline.toFile(outPath);
}

async function buildDarkVariant(lightPngPath, outPath) {
  const { data, info } = await sharp(lightPngPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (channels !== 4) throw new Error('Expected RGBA');
  const buf = Buffer.from(data);
  for (let i = 0; i < buf.length; i += 4) {
    const a = buf[i + 3];
    if (a === 0) continue;
    buf[i] = 255 - buf[i];
    buf[i + 1] = 255 - buf[i + 1];
    buf[i + 2] = 255 - buf[i + 2];
  }
  await sharp(buf, { raw: { width, height, channels: 4 } }).png().toFile(outPath);
}

async function buildFavicon(lightPngPath, icoPath) {
  const sizes = [16, 32, 48];
  const bufs = await Promise.all(
    sizes.map((s) => sharp(lightPngPath).resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer())
  );
  const ico = await pngToIco(bufs);
  fs.writeFileSync(icoPath, ico);
}

function tryPdf2Svg(pdfPath, outSvg) {
  const env = popplerEnv();
  const candidates = ['pdf2svg', '/opt/homebrew/bin/pdf2svg', '/usr/local/bin/pdf2svg'];
  for (const bin of candidates) {
    try {
      execFileSync(bin, [pdfPath, outSvg], { env, stdio: 'pipe' });
      return fs.existsSync(outSvg);
    } catch {
      /* try next */
    }
  }
  return false;
}

async function main() {
  fs.mkdirSync(SOURCE, { recursive: true });
  fs.mkdirSync(BRAND_OUT, { recursive: true });

  const outLight = path.join(BRAND_OUT, 'hawana-logo.png');
  const outDark = path.join(BRAND_OUT, 'hawana-logo-dark.png');
  const outIco = path.join(BRAND_OUT, 'favicon.ico');
  const outSvg = path.join(BRAND_OUT, 'hawana-logo.svg');

  ensureOfficialSourcePdf();
  assertSingleOfficialSourcePdf();
  const tmpRaw = path.join(BRAND_OUT, '._hawana_raw.png');

  console.log('Using official PDF source:', OFFICIAL_SOURCE_PDF);
  rasterizePdfToPng(OFFICIAL_SOURCE_PDF, tmpRaw);
  await normalizeLogoPng(tmpRaw, outLight);
  fs.unlinkSync(tmpRaw);
  if (tryPdf2Svg(OFFICIAL_SOURCE_PDF, outSvg)) {
    console.log('Wrote vector SVG via pdf2svg');
  } else {
    console.log('Optional: install pdf2svg to emit public/brand/hawana-logo.svg from the official PDF.');
  }

  await buildDarkVariant(outLight, outDark);
  await buildFavicon(outLight, outIco);

  const printBackend = path.join(BACKEND_BRAND, 'hawana-logo-print.png');
  if (fs.existsSync(BACKEND_BRAND)) {
    fs.copyFileSync(outLight, printBackend);
    console.log('Synced print PNG to', printBackend);
  }

  console.log('Brand assets OK:', outLight, outDark, outIco, outSvg);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
