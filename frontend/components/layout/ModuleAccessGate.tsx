'use client';

import { usePathname } from 'next/navigation';
import { readSessionUser } from '@/lib/auth-session';
import { pathnameToModule, canAccessModule } from '@/lib/airline-rbac';

type Props = { children: React.ReactNode };

export default function ModuleAccessGate({ children }: Props) {
  const pathname = usePathname();
  const user = readSessionUser();
  const mod = pathnameToModule(pathname || '/');

  if (!user) return <>{children}</>;

  if (!canAccessModule(user.role, mod)) {
    return (
      <main className="module-page">
        <div className="hams-access-denied">
          <h1>Access denied</h1>
          <p>
            Your account role does not include this HAMS module. If you believe this is an error, contact a Super
            Administrator.
          </p>
          <span className="code">RBAC · {String(mod).toUpperCase()}</span>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
