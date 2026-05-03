'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/system-administration');
  }, [router]);
  return (
    <main className="module-page" style={{ padding: '1rem' }}>
      <p>Redirecting to System Administration…</p>
    </main>
  );
}
