import type { Metadata } from 'next';
import AppShell from '@/components/layout/AppShell';
import BuildStamp from '@/components/layout/BuildStamp';
import ProtectedAuthGate from '@/components/layout/ProtectedAuthGate';

/** Authenticated workspace is not intended for public indexing. */
export const metadata: Metadata = {
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } }
};

/** Never cache authenticated shell HTML — sidebar labels must update on every deploy. */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedAuthGate>
      <BuildStamp />
      <AppShell>{children}</AppShell>
    </ProtectedAuthGate>
  );
}
