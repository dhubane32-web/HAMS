'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, Eye, EyeOff, Loader2, Lock, ShieldCheck, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { getPublicApiBaseUrl } from '@/lib/api-base';
import { authFetch } from '@/lib/auth-api';
import { persistSessionCookie } from '@/lib/auth-session';
import type { UserRole } from '@/lib/roles';
import { roleDisplayName } from '@/lib/roles';

type LoginUser = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
};

type LoginSuccess = {
  token: string;
  user: LoginUser;
  expiresInSec?: number;
};

type LoginTwoFactor = {
  requiresTwoFactor: true;
  twoFactorToken: string;
  user: LoginUser;
};

type LoginPasswordExpired = {
  passwordChangeRequired: true;
  changePasswordToken: string;
  user: LoginUser;
};

const API_BASE_URL = getPublicApiBaseUrl();
const SAVED_LOGIN_KEY = 'hawana_saved_login';
const EMAIL_MAX = 254;
const PASSWORD_MAX = 128;
const PASSWORD_MIN = 10;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function validateClient(email: string, password: string): { email?: string; password?: string } {
  const e = email.trim();
  const errs: { email?: string; password?: string } = {};
  if (!e) errs.email = 'Enter your work email.';
  else if (e.length > EMAIL_MAX) errs.email = 'Email is too long.';
  else if (!emailPattern.test(e)) errs.email = 'Enter a valid email address.';
  if (!password) errs.password = 'Enter your password.';
  else if (password.length < PASSWORD_MIN) errs.password = `Use at least ${PASSWORD_MIN} characters.`;
  else if (password.length > PASSWORD_MAX) errs.password = 'Password is too long.';
  return errs;
}

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [rememberEmail, setRememberEmail] = useState(true);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [authStep, setAuthStep] = useState<'password' | 'totp' | 'pwd_expired'>('password');
  const [twoFactorToken, setTwoFactorToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [changePasswordToken, setChangePasswordToken] = useState('');
  const [newPasswordExpiry, setNewPasswordExpiry] = useState('');
  const [confirmNewPasswordExpiry, setConfirmNewPasswordExpiry] = useState('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_LOGIN_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { email?: string; rememberEmail?: boolean };
      if (parsed.rememberEmail && parsed.email) {
        setEmail(parsed.email);
        setRememberEmail(true);
      }
    } catch {
      // ignore
    }
  }, []);

  function clearErrors() {
    setFormError('');
    setFieldErrors({});
  }

  function notifySsoComingSoon(provider: string) {
    toast(`${provider} sign-in can be enabled for your organization. Contact IT to connect SSO.`, {
      icon: 'ℹ️',
      duration: 4500
    });
  }

  function finishLoginSuccess(result: LoginSuccess, trimmedEmail: string) {
    localStorage.setItem('hams_token', result.token);
    localStorage.setItem('hams_user', JSON.stringify(result.user));
    if (rememberEmail) {
      localStorage.setItem(SAVED_LOGIN_KEY, JSON.stringify({ email: trimmedEmail, rememberEmail: true }));
    } else {
      localStorage.removeItem(SAVED_LOGIN_KEY);
    }
    persistSessionCookie(result.token, result.expiresInSec);

    const nextPath =
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('next') : null;
    const safeNext =
      nextPath && nextPath.startsWith('/') && !nextPath.startsWith('//') && !nextPath.startsWith('/login')
        ? nextPath
        : '/dashboard';

    toast.success(`Welcome ${result.user.name} (${roleDisplayName(result.user.role)})`);
    router.push(safeNext);
  }

  async function submitPasswordExpiry(trimmedEmail: string) {
    const np = newPasswordExpiry.trim();
    const cp = confirmNewPasswordExpiry.trim();
    if (np.length < PASSWORD_MIN || np.length > PASSWORD_MAX) {
      setFormError(`New password must be between ${PASSWORD_MIN} and ${PASSWORD_MAX} characters.`);
      return;
    }
    if (np !== cp) {
      setFormError('New passwords do not match.');
      return;
    }
    setIsLoading(true);
    clearErrors();
    try {
      const response = await authFetch('/api/auth/change-password-expired', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changePasswordToken, newPassword: np })
      });
      const result = (await response.json().catch(() => ({}))) as LoginSuccess | { message?: string };
      if (!response.ok || !('token' in result)) {
        const msg = (result as { message?: string }).message || 'Could not update password.';
        setFormError(msg);
        toast.error(msg);
        return;
      }
      setAuthStep('password');
      setChangePasswordToken('');
      setNewPasswordExpiry('');
      setConfirmNewPasswordExpiry('');
      finishLoginSuccess(result as LoginSuccess, trimmedEmail);
    } catch {
      const msg = 'Unable to reach the authentication service.';
      setFormError(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  }

  async function verifyTotp(trimmedEmail: string) {
    const code = totpCode.replace(/\s/g, '');
    if (!/^\d{6,8}$/.test(code)) {
      setFormError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setIsLoading(true);
    clearErrors();
    try {
      const response = await authFetch('/api/auth/login/2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ twoFactorToken, code })
      });
      const result = (await response.json().catch(() => ({}))) as LoginSuccess | { message?: string };
      if (!response.ok || !('token' in result)) {
        const msg = (result as { message?: string }).message || 'Verification failed.';
        setFormError(msg);
        toast.error(msg);
        return;
      }
      finishLoginSuccess(result as LoginSuccess, trimmedEmail);
    } catch {
      const msg = 'Unable to reach the authentication service.';
      setFormError(msg);
      toast.error(msg);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearErrors();
    const trimmedEmail = email.trim();

    if (authStep === 'totp') {
      await verifyTotp(trimmedEmail);
      return;
    }

    const clientErrs = validateClient(email, password);
    if (Object.keys(clientErrs).length > 0) {
      setFieldErrors(clientErrs);
      setFormError('Please correct the highlighted fields.');
      return;
    }

    setIsLoading(true);

    try {
      const response = await authFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, password })
      });

      let result: LoginSuccess | LoginTwoFactor | LoginPasswordExpired | { message?: string };
      try {
        result = (await response.json()) as LoginSuccess | LoginTwoFactor | { message?: string };
      } catch {
        setFormError('The server returned an invalid response. Try again or contact support.');
        toast.error('Invalid response from server.');
        return;
      }

      if (response.status === 423) {
        const msg =
          (result as { message?: string }).message || 'This account is temporarily locked. Try again later.';
        setFormError(msg);
        toast.error(msg);
        return;
      }

      if (response.status === 503 || response.status === 502) {
        const body = result as { hint?: string; message?: string; error?: string };
        const msg =
          body.hint ||
          body.message ||
          body.error ||
          'Authentication service is not connected. Operations must set HAMS_BACKEND_INTERNAL_URL on Vercel to the live Railway API URL.';
        setFormError(msg);
        toast.error('Unable to connect to backend service.');
        return;
      }

      if (!response.ok) {
        const msg = (result as { message?: string }).message || 'Sign-in failed. Check your email and password.';
        setFormError(msg);
        toast.error(msg);
        return;
      }

      if ('requiresTwoFactor' in result && result.requiresTwoFactor) {
        setTwoFactorToken(result.twoFactorToken);
        setAuthStep('totp');
        setTotpCode('');
        setFormError('');
        toast.success('Enter your authenticator code to continue.');
        return;
      }

      if ('passwordChangeRequired' in result && result.passwordChangeRequired) {
        const pr = result as LoginPasswordExpired;
        setChangePasswordToken(pr.changePasswordToken);
        setNewPasswordExpiry('');
        setConfirmNewPasswordExpiry('');
        setAuthStep('pwd_expired');
        setFormError('');
        toast.success('Your password has expired. Choose a new one to continue.');
        return;
      }

      if (!('token' in result)) {
        setFormError('Unexpected login response.');
        return;
      }

      finishLoginSuccess(result as LoginSuccess, trimmedEmail);
    } catch {
      const apiHint = API_BASE_URL ? ` API: ${API_BASE_URL}` : '';
      const msg = `Unable to reach the authentication service. Check your connection and API URL.${apiHint}`;
      setFormError(msg);
      toast.error('Unable to connect to backend service.');
    } finally {
      setIsLoading(false);
    }
  }

  const inputRing =
    'focus-visible:border-hawana-blue focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-hawana-blue/30';
  const inputBase =
    'w-full rounded-xl border bg-white/70 py-3 pl-10 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300';

  return (
    <div className="w-full">
      <div className="mb-4 flex justify-end">
        <span className="rounded-full border border-slate-200/80 bg-white/60 px-3 py-1 text-xs font-medium text-slate-600">
          English
        </span>
      </div>

      <form method="post" onSubmit={handleSubmit} className="flex flex-col gap-3 sm:gap-4" noValidate>
        <div className="space-y-2 text-center sm:space-y-3">
          <h2 className="text-balance text-lg font-bold tracking-tight text-slate-900 sm:text-2xl">Welcome back</h2>
          <p className="text-pretty text-sm leading-relaxed text-slate-600">
            Corporate sign-in — access follows your assigned role
          </p>
        </div>

        {formError ? (
          <div
            role="alert"
            className="mb-4 flex gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
            <span>{formError}</span>
          </div>
        ) : null}

        <div className="space-y-4 sm:space-y-5">
          {authStep === 'pwd_expired' ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Password policy requires a new password for <strong>{email.trim()}</strong>.
              </p>
              <div>
                <label htmlFor="npw" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  New password
                </label>
                <input
                  id="npw"
                  type="password"
                  autoComplete="new-password"
                  value={newPasswordExpiry}
                  onChange={(e) => setNewPasswordExpiry(e.target.value)}
                  className={`${inputBase} pl-3 pr-3 ${inputRing} border-slate-200`}
                  maxLength={PASSWORD_MAX}
                />
              </div>
              <div>
                <label htmlFor="cpw" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Confirm new password
                </label>
                <input
                  id="cpw"
                  type="password"
                  autoComplete="new-password"
                  value={confirmNewPasswordExpiry}
                  onChange={(e) => setConfirmNewPasswordExpiry(e.target.value)}
                  className={`${inputBase} pl-3 pr-3 ${inputRing} border-slate-200`}
                  maxLength={PASSWORD_MAX}
                />
              </div>
              <button
                type="button"
                className="text-sm font-medium text-hawana-blue underline-offset-2 hover:underline"
                onClick={() => {
                  setAuthStep('password');
                  setChangePasswordToken('');
                  setNewPasswordExpiry('');
                  setConfirmNewPasswordExpiry('');
                  clearErrors();
                }}
              >
                Back to sign-in
              </button>
            </div>
          ) : null}

          {authStep === 'totp' ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Two-factor authentication is enabled for <strong>{email.trim()}</strong>. Enter the code from your
                authenticator app.
              </p>
              <div>
                <label htmlFor="totp" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Authenticator code
                </label>
                <input
                  id="totp"
                  name="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/[^\d]/g, '').slice(0, 8))}
                  className={`${inputBase} pl-3 pr-3 ${inputRing} border-slate-200`}
                />
              </div>
              <button
                type="button"
                className="text-sm font-medium text-hawana-blue underline-offset-2 hover:underline"
                onClick={() => {
                  setAuthStep('password');
                  setTwoFactorToken('');
                  setTotpCode('');
                  clearErrors();
                }}
              >
                Use a different account
              </button>
            </div>
          ) : null}

          {authStep === 'password' ? (
            <>
          <div>
            <label htmlFor="email" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Work email
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <User size={18} strokeWidth={1.75} aria-hidden />
              </span>
              <input
                id="email"
                type="email"
                name="email"
                autoComplete="username"
                inputMode="email"
                placeholder="you@hawanaairways.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (formError || fieldErrors.email) clearErrors();
                }}
                maxLength={EMAIL_MAX}
                aria-invalid={Boolean(fieldErrors.email)}
                aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                className={`${inputBase} pl-10 pr-3 ${inputRing} ${
                  fieldErrors.email ? 'border-red-400 bg-red-50/50' : 'border-slate-200'
                }`}
              />
            </div>
            {fieldErrors.email ? (
              <p id="email-error" className="mt-1.5 text-xs font-medium text-red-600">
                {fieldErrors.email}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Password
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <Lock size={18} strokeWidth={1.75} aria-hidden />
              </span>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (formError || fieldErrors.password) clearErrors();
                }}
                maxLength={PASSWORD_MAX}
                minLength={PASSWORD_MIN}
                aria-invalid={Boolean(fieldErrors.password)}
                aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                className={`${inputBase} pl-10 pr-11 ${inputRing} ${
                  fieldErrors.password ? 'border-red-400 bg-red-50/50' : 'border-slate-200'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 active:scale-95"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {fieldErrors.password ? (
              <p id="password-error" className="mt-1.5 text-xs font-medium text-red-600">
                {fieldErrors.password}
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-slate-400">Minimum {PASSWORD_MIN} characters. Never share your password.</p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <label className="flex cursor-pointer select-none items-center gap-2 text-slate-600 transition hover:text-slate-800">
              <input
                type="checkbox"
                checked={rememberEmail}
                onChange={(e) => setRememberEmail(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-hawana-blue focus:ring-hawana-blue"
              />
              Remember my email
            </label>
            <Link
              href="/forgot-password"
              className="font-medium text-hawana-blue underline-offset-2 transition hover:text-hawana-navy hover:underline"
            >
              Forgot password?
            </Link>
          </div>
            </>
          ) : null}

          <button
            type="submit"
            disabled={isLoading}
            className="group flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-hawana-blue to-hawana-navy py-3.5 text-base font-semibold text-white shadow-lg shadow-hawana-navy/25 transition duration-200 hover:shadow-xl hover:brightness-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hawana-blue focus-visible:ring-offset-2 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-55"
          >
            {isLoading ? (
              <Loader2 className="h-[18px] w-[18px] shrink-0 animate-spin" aria-hidden />
            ) : (
              <ArrowRight
                size={18}
                strokeWidth={2.25}
                className="shrink-0 transition group-hover:translate-x-0.5"
                aria-hidden
              />
            )}
            {isLoading
              ? authStep === 'totp'
                ? 'Verifying…'
                : authStep === 'pwd_expired'
                  ? 'Updating…'
                  : 'Authenticating…'
              : authStep === 'totp'
                ? 'Verify code'
                : authStep === 'pwd_expired'
                  ? 'Set new password'
                  : 'Sign in securely'}
          </button>
        </div>

        <div className="relative my-4 sm:my-6">
          <div className="absolute inset-0 flex items-center" aria-hidden>
            <div className="w-full border-t border-slate-200" />
          </div>
          <div className="relative flex justify-center text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-slate-500">
            <span className="bg-white/90 px-3">Or continue with</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => notifySsoComingSoon('Google')}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:shadow active:scale-[0.99]"
          >
            <GoogleMark />
            Google
          </button>
          <button
            type="button"
            onClick={() => notifySsoComingSoon('Microsoft')}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:shadow active:scale-[0.99]"
          >
            <MicrosoftMark />
            Microsoft
          </button>
        </div>

        <p className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50/60 px-3 py-2.5 text-left text-xs text-slate-600 sm:mt-6">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" strokeWidth={1.75} aria-hidden />
          <span>
            <strong className="text-slate-800">Role-based access.</strong> Your permissions are enforced server-side from
            your Hawana Airways account. Use only trusted devices; session cookies apply when enabled by operations.
          </span>
        </p>
      </form>

      <p className="mt-4 text-center text-xs text-slate-500">
        <Link href="/" className="font-medium text-hawana-blue hover:underline">
          Public site
        </Link>
      </p>
    </div>
  );
}
