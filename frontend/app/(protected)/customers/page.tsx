'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Legacy nav target — CRM is served by Customer Service + Commercial hub. */
export default function CustomersRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/customer-service');
  }, [router]);
  return (
    <main className="module-page">
      <section className="module-card">
        <p style={{ margin: 0, color: '#64748b' }}>Redirecting to Customer Service…</p>
      </section>
    </main>
  );
}
