import './globals.css';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Inter } from 'next/font/google';
import UiProvider from '@/components/providers/UiProvider';
import { BRAND } from '@/lib/brand';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter'
});

export const metadata: Metadata = {
  title: 'Hawana Airways · HAMS',
  description: `${BRAND.companyName} — ${BRAND.fullSystemName}`,
  icons: {
    icon: BRAND.faviconPath,
    shortcut: BRAND.faviconPath,
    apple: BRAND.logoPath
  }
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
