'use client';

import { useEffect, useMemo, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { usePathname, useRouter } from 'next/navigation';
import NProgress from 'nprogress';

import 'nprogress/nprogress.css';
import AuthCookieSync from '@/components/AuthCookieSync';
import { clearClientSession, getClientAuthToken } from '@/lib/auth-session';

type Props = {
  children: React.ReactNode;
};

NProgress.configure({ showSpinner: false, trickleSpeed: 120 });

function readJwtExpSec(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const p = JSON.parse(atob(padded)) as { exp?: number };
    return typeof p.exp === 'number' ? p.exp : null;
  } catch {
    return null;
  }
}

export default function UiProvider({ children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem('hams_theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const useDark = stored ? stored === 'dark' : prefersDark;
    setDarkMode(useDark);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    localStorage.setItem('hams_theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  useEffect(() => {
    NProgress.start();
    const timeout = setTimeout(() => NProgress.done(), 300);
    return () => clearTimeout(timeout);
  }, [pathname]);

  useEffect(() => {
    const onThemeToggle = () => setDarkMode((prev) => !prev);
    window.addEventListener('hams:theme-toggle', onThemeToggle);
    return () => window.removeEventListener('hams:theme-toggle', onThemeToggle);
  }, []);

  /** Client-side session timeout when JWT reaches expiry (aligned with server session). */
  useEffect(() => {
    if (pathname.startsWith('/login') || pathname.startsWith('/forgot-password') || pathname.startsWith('/reset-password')) {
      return;
    }
    const token = getClientAuthToken();
    if (!token) return;
    const exp = readJwtExpSec(token);
    if (exp == null) return;
    const ms = exp * 1000 - Date.now() - 10_000;
    if (ms <= 0) {
      clearClientSession();
      router.replace('/login?reason=session_expired');
      return;
    }
    const id = window.setTimeout(() => {
      clearClientSession();
      router.replace('/login?reason=session_expired');
    }, ms);
    return () => window.clearTimeout(id);
  }, [pathname, router]);

  /** Optional idle logout (NEXT_PUBLIC_SESSION_IDLE_MS, milliseconds). */
  useEffect(() => {
    const raw = process.env.NEXT_PUBLIC_SESSION_IDLE_MS;
    const idleMs = raw ? Number(raw) : 0;
    if (!idleMs || idleMs < 60_000) return;
    if (pathname.startsWith('/login') || pathname.startsWith('/forgot-password') || pathname.startsWith('/reset-password')) {
      return;
    }
    if (!getClientAuthToken()) return;
    let last = Date.now();
    let timer = window.setTimeout(() => {}, 0);
    const bump = () => {
      last = Date.now();
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (Date.now() - last >= idleMs - 500) {
          clearClientSession();
          router.replace('/login?reason=idle_timeout');
        }
      }, idleMs);
    };
    bump();
    const ev = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;
    ev.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      ev.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [pathname, router]);

  const toastStyle = useMemo(
    () => ({
      background: darkMode ? 'rgba(15, 23, 42, 0.85)' : 'rgba(15, 23, 42, 0.8)',
      color: '#fff',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      backdropFilter: 'blur(14px)',
      borderRadius: '14px'
    }),
    [darkMode]
  );

  return (
    <>
      <AuthCookieSync />
      {children}
      <Toaster
        position="top-right"
        toastOptions={{
          style: toastStyle
        }}
      />
    </>
  );
}
