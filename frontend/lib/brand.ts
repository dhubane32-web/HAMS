/**
 * Canonical Hawana Airways + HAMS branding (paths under /public/brand).
 * Regenerate raster assets: `npm run brand:build` (from frontend/).
 */

export const BRAND = {
  companyName: 'Hawana Airways',
  systemName: 'HAMS',
  fullSystemName: 'Hawana Airways Management System',
  logoPath: '/brand/hawana-logo.png',
  logoDarkPath: '/brand/hawana-logo-dark.png',
  faviconPath: '/brand/favicon.ico',
  /** Vector companion when available (may mirror company artwork) */
  logoSvgPath: '/brand/hawana-logo.svg',
  tagline: 'Your journey, elevated.',
  colors: {
    primary: '#0047AB',
    navy: '#001f5b',
    gold: '#FFD700'
  }
} as const;

/** Matches backend `HAWANA_BRAND.systemFull` and PDF footers */
export const BRAND_SYSTEM_FULL = `${BRAND.fullSystemName} (${BRAND.systemName})` as const;
