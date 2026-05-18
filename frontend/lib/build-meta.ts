import {
  APP_BUILD_ID as GENERATED_BUILD_ID,
  APP_BUILD_TIME as GENERATED_BUILD_TIME,
  NAV_CONFIG_VERSION as GENERATED_NAV_VERSION
} from './build-meta.generated';

/** Inlined at build time from .env.production.local when generate-build-meta runs. */
export const APP_BUILD_ID = process.env.NEXT_PUBLIC_APP_BUILD_ID || GENERATED_BUILD_ID;
export const APP_BUILD_TIME = process.env.NEXT_PUBLIC_APP_BUILD_TIME || GENERATED_BUILD_TIME;
export const NAV_CONFIG_VERSION = process.env.NEXT_PUBLIC_NAV_CONFIG_VERSION || GENERATED_NAV_VERSION;
