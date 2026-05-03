'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { getPublicApiBaseUrl } from '@/lib/api-base';

const API_BASE_URL = getPublicApiBaseUrl();

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [devToken, setDevToken] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setDevToken('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() })
      });
      const data = (await res.json()) as { message?: string; devResetToken?: string };
      if (!res.ok) {
        toast.error(data.message || 'Request failed.');
        return;
      }
      toast.success(data.message || 'Check your email.');
      if (data.devResetToken) setDevToken(data.devResetToken);
    } catch {
      toast.error('Unable to reach the server.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="module-page" style={{ minHeight: '100vh', padding: '2rem', maxWidth: 420, margin: '0 auto' }}>
      <h1 style={{ color: '#001f5b' }}>Reset password</h1>
      <p style={{ color: '#64748b' }}>Enter your work email. If an active account exists, you can set a new password.</p>
      <form className="module-card module-form-grid" onSubmit={handleSubmit} style={{ marginTop: '1rem' }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@hawana.aero"
          required
          autoComplete="email"
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Sending…' : 'Request reset'}
        </button>
      </form>
      {devToken && (
        <section className="module-card" style={{ marginTop: '1rem', background: '#fffbeb' }}>
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            <strong>Development only:</strong> use this token with <code>/reset-password</code> (POST{' '}
            <code>token</code>, <code>newPassword</code>).
          </p>
          <pre style={{ wordBreak: 'break-all', fontSize: '0.75rem' }}>{devToken}</pre>
        </section>
      )}
      <p style={{ marginTop: '1.25rem' }}>
        <Link href="/login">Back to sign in</Link>
      </p>
    </main>
  );
}
