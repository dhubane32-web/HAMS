'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { getPublicApiBaseUrl } from '@/lib/api-base';
import BrandLogo from '@/components/BrandLogo';

const API_BASE_URL = getPublicApiBaseUrl();

function ResetPasswordForm() {
  const search = useSearchParams();
  const [token, setToken] = useState(() => search.get('token') || '');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), newPassword })
      });
      const data = (await res.json()) as { message?: string };
      if (!res.ok) {
        toast.error(data.message || 'Reset failed.');
        return;
      }
      toast.success(data.message || 'Password updated.');
    } catch {
      toast.error('Unable to reach the server.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="module-page" style={{ minHeight: '100vh', padding: '2rem', maxWidth: 420, margin: '0 auto' }}>
      <div style={{ marginBottom: '1.25rem', display: 'flex', justifyContent: 'center' }}>
        <BrandLogo variant="light" placement="login" priority />
      </div>
      <h1 style={{ color: '#001f5b' }}>Set new password</h1>
      <form className="module-card module-form-grid" onSubmit={handleSubmit} style={{ marginTop: '1rem' }}>
        <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Reset token" required />
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="New password (min 8)"
          minLength={8}
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? 'Saving…' : 'Update password'}
        </button>
      </form>
      <p style={{ marginTop: '1rem' }}>
        <Link href="/login">Sign in</Link>
      </p>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<main className="module-page">Loading…</main>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
