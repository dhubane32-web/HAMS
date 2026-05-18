import type { Metadata } from 'next';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Staff sign-in · ${BRAND.companyName}`,
  robots: { index: false, follow: false }
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="login-layout-root hams-login-layout min-h-dvh w-full overflow-x-hidden">{children}</div>
  );
}
