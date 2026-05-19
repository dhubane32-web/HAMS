import type { MetadataRoute } from 'next';

/**
 * Crawlers are steered by page-level `noindex` for auth and the authenticated shell.
 * Keep this file minimal to avoid fighting Next’s many dynamic app routes.
 */
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    ...(base ? { sitemap: `${base}/sitemap.xml` } : {})
  };
}
