'use client';

import { useEffect, useMemo, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { usePathname } from 'next/navigation';
import NProgress from 'nprogress';

import 'nprogress/nprogress.css';
import AuthCookieSync from '@/components/AuthCookieSync';

type Props = {
  children: React.ReactNode;
};

NProgress.configure({ showSpinner: false, trickleSpeed: 120 });

export default function UiProvider({ children }: Props) {
  const pathname = usePathname();
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
