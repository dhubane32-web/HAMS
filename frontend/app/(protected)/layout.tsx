import AppShell from '@/components/layout/AppShell';
import ProtectedAuthGate from '@/components/layout/ProtectedAuthGate';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedAuthGate>
      <AppShell>{children}</AppShell>
    </ProtectedAuthGate>
  );
}
