'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, Lock, ShieldCheck, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { getPublicApiBaseUrl } from '@/lib/api-base';
import { persistSessionCookie } from '@/lib/auth-session';
import type { UserRole } from '@/lib/roles';
import { roleDisplayName } from '@/lib/roles';

type LoginResponse = {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
  };
};

const API_BASE_URL = getPublicApiBaseUrl();

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M13 1h10v10H13z" />
      <path fill="#00A4EF" d="M1 13h10v10H1z" />
      <path fill="#FFB900" d="M13 13h10v10H13z" />
    </svg>
  );
}

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@hawanaairways.com');
  const [password, setPassword] = useState('Admin123!');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const savedLogin = localStorage.getItem('hawana_saved_login');
    if (!savedLogin) return;
    try {
      const parsed = JSON.parse(savedLogin) as { email?: string; password?: string };
      if (parsed.email) setEmail(parsed.email);
      if (parsed.password) setPassword(parsed.password);
    } catch {
      // ignore
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      let result: LoginResponse | { message?: string };
      try {
        result = (await response.json()) as LoginResponse | { message?: string };
      } catch {
        toast.error('Invalid response from server.');
        return;
      }

      if (!response.ok || !('token' in result)) {
        toast.error((result as { message?: string }).message || 'Login failed.');
        return;
      }

      localStorage.setItem('hams_token', result.token);
      localStorage.setItem('hams_user', JSON.stringify(result.user));
      localStorage.setItem('hawana_saved_login', JSON.stringify({ email, password }));
      persistSessionCookie(result.token);

      const nextPath =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('next')
          : null;
      const safeNext =
        nextPath &&
        nextPath.startsWith('/') &&
        !nextPath.startsWith('//') &&
        !nextPath.startsWith('/login')
          ? nextPath
          : '/dashboard';

      toast.success(`Welcome ${result.user.name} (${roleDisplayName(result.user.role)})`);
      router.push(safeNext);
    } catch {
      toast.error('Unable to connect to backend service.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="strict-right-stack">
      <button type="button" className="language-pill">
        <span>English</span>
      </button>
      <form onSubmit={handleSubmit} className="strict-login-card">
        <div className="strict-brand">
          <h3>Hawana Airways</h3>
          <small>Hawana Airways Management System (HAMS)</small>
        </div>
        <p>Welcome Back</p>
        <span>Sign in to continue to your account</span>
      

        <div className="input-field-wrap">
          <span className="input-icon" aria-hidden>
            <User size={18} strokeWidth={1.75} />
          </span>
          <input
            id="email"
            type="email"
            autoComplete="username"
            placeholder="Username or Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            aria-label="Username or Email"
          />
        </div>

        <div className="input-field-wrap">
          <span className="input-icon" aria-hidden>
            <Lock size={18} strokeWidth={1.75} />
          </span>
          <input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            aria-label="Password"
          />
          <button
            type="button"
            className="input-eye"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>

        <div className="login-row">
          <label className="check-wrap">
            <input type="checkbox" defaultChecked />
            <span>Remember me</span>
          </label>
          <Link className="link-btn" href="/forgot-password">
            Forgot password?
          </Link>
        </div>

        <button type="submit" className="login-submit strict-pulse" disabled={isLoading}>
          <ArrowRight size={18} strokeWidth={2.25} aria-hidden />
          {isLoading ? 'Authenticating...' : 'Sign In'}
        </button>

        <div className="or-divider">
          <span>or continue with</span>
        </div>
        <div className="social-row">
          <button className="social-btn" type="button">
            <GoogleMark />
            Google
          </button>
          <button className="social-btn" type="button">
            <MicrosoftMark />
            Microsoft
          </button>
        </div>
        <p className="secure-note">
          <ShieldCheck size={16} strokeWidth={1.75} aria-hidden />
          Secure access with role-based permissions
        </p>
      </form>
      <p className="strict-login-foot">© 2025 Hawana Airways. All rights reserved.</p>
    </div>
  );
}
