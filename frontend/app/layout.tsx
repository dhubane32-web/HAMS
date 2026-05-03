import './globals.css';
import type { Metadata } from 'next';
import { Suspense } from 'react';
import UiProvider from '@/components/providers/UiProvider';

export const metadata: Metadata = {
  title: 'Hawana Airways',
  description: 'Hawana Airways Airline Management System'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
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
