/**
 * Client branding defaults + optional localStorage overrides (e.g. System Settings > Branding).
 */
import { BRAND, BRAND_SYSTEM_FULL } from './brand';

export const BRAND_STORAGE_KEY = 'hams_branding_overrides';

export const BRAND_DEFAULTS = {
  airlineName: BRAND.companyName,
  systemShort: BRAND.systemName,
  systemFull: BRAND_SYSTEM_FULL,
  tagline: BRAND.tagline,
  logoLight: BRAND.logoPath,
  logoDark: BRAND.logoDarkPath,
  colors: { ...BRAND.colors }
} as const;

export type BrandingOverrides = Partial<{
  logoLight: string;
  logoDark: string;
  airlineName: string;
  systemShort: string;
  systemFull: string;
  tagline: string;
}>;

export type ResolvedBrand = {
  airlineName: string;
  systemShort: string;
  systemFull: string;
  tagline: string;
  logoLight: string;
  logoDark: string;
  colors: (typeof BRAND_DEFAULTS)['colors'];
};

/** Client-only: merge saved overrides from System Settings > Branding. */
export function getResolvedBrand(): ResolvedBrand {
  const base: ResolvedBrand = { ...BRAND_DEFAULTS };
  if (typeof window === 'undefined') {
    return base;
  }
  try {
    const raw = window.localStorage.getItem(BRAND_STORAGE_KEY);
    if (!raw) return base;
    const o = JSON.parse(raw) as BrandingOverrides;
    return { ...base, ...o };
  } catch {
    return base;
  }
}

export function saveBrandOverrides(overrides: BrandingOverrides) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(BRAND_STORAGE_KEY, JSON.stringify(overrides));
}

export function clearBrandOverrides() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(BRAND_STORAGE_KEY);
}
