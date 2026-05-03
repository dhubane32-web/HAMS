'use client';

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft,
  ChevronRight,
  Menu,
  Bell,
  Mail,
  Maximize2,
  Search,
  LogOut
} from 'lucide-react';
import { navForRole, isNavActive } from '@/lib/nav-config';
import { roleDisplayName } from '@/lib/roles';
import { clearClientSession, readSessionUser, type SessionUser } from '@/lib/auth-session';

type Props = { children: React.ReactNode };

export default function AppShell({ children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [hasToken, setHasToken] = useState(false);

  useLayoutEffect(() => {
    setUser(readSessionUser());
    setHasToken(typeof window !== 'undefined' && Boolean(localStorage.getItem('hams_token')));
  }, [pathname]);

  const nav = useMemo(() => navForRole(user?.role ?? null), [user?.role]);

  const pageName = useMemo(() => {
    const item = nav.find((n) => isNavActive(pathname, n.href));
    return item?.label ?? 'HAMS';
  }, [pathname, nav]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
      if (!key || !event.altKey) return;
      if (key === 'd') router.push('/dashboard');
      if (key === 'b') router.push('/bookings');
      if (key === 'f') router.push('/finance');
      if (key === 'o') router.push('/operations');
      if (key === 'm') router.push('/maintenance');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [router]);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen();
      setIsFullscreen(true);
      return;
    }
    void document.exitFullscreen();
    setIsFullscreen(false);
  }

  const roleLabel = user?.role ? roleDisplayName(user.role) : hasToken ? 'Session active' : 'Guest';

  function handleLogout() {
    clearClientSession();
    setUser(null);
    setHasToken(false);
    router.replace('/login');
  }

  return (
    <div className={`hams-shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      <AnimatePresence>
        {mobileOpen && <button className="sidebar-backdrop" onClick={() => setMobileOpen(false)} aria-label="Close menu" />}
      </AnimatePresence>

      <motion.aside
        className={`hams-sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'open' : ''}`}
        initial={{ x: -32, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
      >
        <div className="hams-sidebar-top">
          <div className="hams-brand">
            <Image src="/hawana-logo.svg" alt="Hawana Airways" width={38} height={38} />
            {!collapsed && (
              <div>
                <h1>HAWANA AIRWAYS</h1>
                <p>Hawana Airways Management System (HAMS)</p>
              </div>
            )}
          </div>
          <button type="button" className="icon-btn" onClick={() => setCollapsed((v) => !v)} aria-label="Collapse sidebar">
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        <nav className="hams-nav-list" aria-label="Primary">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = isNavActive(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} className={`hams-nav-item ${active ? 'active' : ''}`}>
                <Icon size={18} />
                {!collapsed && <span>{item.label}</span>}
                {active && <motion.div layoutId="active-nav" className="hams-active-line" />}
              </Link>
            );
          })}
        </nav>

        <div className="hams-status-card">
          <p>System Status</p>
          <strong>
            <span /> Operational
          </strong>
          {!collapsed && <small>Core services connected</small>}
        </div>
        <div className="hams-sidebar-footer">© 2026 Hawana Airways</div>
      </motion.aside>

      <main className="hams-main-content">
        <header className="hams-topbar">
          <button type="button" className="icon-btn mobile-only" onClick={() => setMobileOpen((v) => !v)} aria-label="Toggle menu">
            <Menu size={18} />
          </button>
          <div className="hams-page-title">
            <h2>{pageName}</h2>
            <p>
              {user ? (
                <>
                  Signed in as <strong>{user.name}</strong> · {roleLabel}
                </>
              ) : (
                'Sign in to continue'
              )}
            </p>
          </div>
          <div className="hams-search">
            <Search size={16} aria-hidden />
            <input placeholder="Search flights, bookings, passengers…" aria-label="Global search" />
          </div>
          <div className="hams-topbar-actions">
            <Link href="/notifications" className="icon-btn badge-btn hams-icon-link" aria-label="Notifications">
              <Bell size={16} />
            </Link>
            <Link href="/customer-service" className="icon-btn badge-btn hams-icon-link" aria-label="Customer service workspace">
              <Mail size={16} />
            </Link>
            <button type="button" className="icon-btn" onClick={toggleFullscreen} aria-label="Fullscreen">
              <Maximize2 size={15} />
            </button>
            <button type="button" className="icon-btn" onClick={handleLogout} aria-label="Sign out" title="Sign out">
              <LogOut size={16} />
            </button>
            <Link href="/workspace-settings" className="hams-profile-btn">
              <Image src="/admin-avatar.svg" alt="" width={32} height={32} />
              <span>
                <strong>{user?.name ?? 'Account'}</strong>
                <small>{roleLabel}</small>
              </span>
              <ChevronRight size={14} className={isFullscreen ? 'rotate' : ''} aria-hidden />
            </Link>
          </div>
        </header>
        <motion.section
          className="hams-page-transition"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
        >
          {children}
        </motion.section>
      </main>
    </div>
  );
}
