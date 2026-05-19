import './globals.css';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Inter } from 'next/font/google';
import UiProvider from '@/components/providers/UiProvider';
import { BRAND } from '@/lib/brand';

function resolveMetadataBase(): URL | undefined {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) {
    try {
      return new URL(site.replace(/\/+$/, ''));
    } catch {
      /* ignore */
    }
  }
  if (process.env.VERCEL_URL) {
    try {
      return new URL(`https://${process.env.VERCEL_URL}`);
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter'
});

const metadataBase = resolveMetadataBase();

export const metadata: Metadata = {
  ...(metadataBase ? { metadataBase } : {}),
  title: { default: `${BRAND.companyName} · ${BRAND.systemName}`, template: `%s · ${BRAND.companyName}` },
  description: `${BRAND.companyName} — ${BRAND.fullSystemName}`,
  icons: {
    icon: BRAND.faviconPath,
    shortcut: BRAND.faviconPath,
    apple: BRAND.logoPath
  }
};

/** iOS safe-area + prevent accidental zoom on form focus in standalone web app chrome */
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover' as const
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className={`${inter.className} antialiased`}>
        <Suspense
          fallback={
            <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f4f7fc', color: '#64748b' }}>
              Loading…
            </div>
          }
        >
          <UiProvider>{children}</UiProvider>
        </Suspense>
      </body>
    </html>
  );
}
