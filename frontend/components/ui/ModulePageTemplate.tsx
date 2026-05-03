'use client';

import Link from 'next/link';

type Props = {
  title: string;
  description: string;
};

export default function ModulePageTemplate({ title, description }: Props) {
  return (
    <main className="module-template">
      <section className="panel">
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="template-actions">
          <Link href="/dashboard">Back to Dashboard</Link>
          <Link href="/reports-analytics">Open Reports</Link>
        </div>
      </section>
    </main>
  );
}
