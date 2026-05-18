'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import BrandLogo from '@/components/BrandLogo';
import { usePathname, useRouter } from 'next/navigation';
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
import { navForRole, isNavActive, type NavItem } from '@/lib/nav-config';
import { APP_BUILD_ID } from '@/lib/build-meta';
import { roleDisplayName } from '@/lib/roles';
import { clearClientSession, readSessionUser, type SessionUser } from '@/lib/auth-session';
import { BRAND } from '@/lib/brand';
import { notifyServerLogout } from '@/lib/auth-api';
import { canAccessModule } from '@/lib/airline-rbac';
import ModuleAccessGate from '@/components/layout/ModuleAccessGate';

type Props = { children: React.ReactNode };

const SidebarNav = memo(function SidebarNav({
  nav,
  pathname,
  collapsed,
  onNavigate
}: {
  nav: NavItem[];
  pathname: string;
  collapsed: boolean;
  onNavigate: () => void;
}) {
  return (
    <>
      {nav.map((item) => {
        const Icon = item.icon;
        const active = isNavActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`hams-nav-item ${active ? 'active' : ''}`}
            onClick={onNavigate}
          >
            <Icon size={18} aria-hidden />
            {!collapsed && <span>{item.label}</span>}
            {active && <span className="hams-active-line" aria-hidden />}
          </Link>
        );
      })}
    </>
  );
});

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
  const canCs = user?.role ? canAccessModule(user.role, 'customers') : false;
  const canNotify = user?.role ? canAccessModule(user.role, 'notifications') : true;

  const pageName = useMemo(() => {
    const item = nav.find((n) => isNavActive(pathname, n.href));
    return item?.label ?? BRAND.systemName;
  }, [pathname, nav]);

  const closeMobile = useCallback(() => setMobileOpen(false), []);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    document.body.classList.add('hams-drawer-open');
    return () => {
      document.body.classList.remove('hams-drawer-open');
    };
  }, [mobileOpen]);

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

  async function handleLogout() {
    await notifyServerLogout();
    clearClientSession();
    setUser(null);
    setHasToken(false);
    router.replace('/login');
  }

  return (
    <div className={`hams-shell${collapsed ? ' sidebar-collapsed' : ''}${mobileOpen ? ' mobile-nav-open' : ''}`}>
      {mobileOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          onClick={closeMobile}
          aria-label="Close menu"
        />
      ) : null}

      <aside
        className={`hams-sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'open' : ''}`}
        data-hams-build={APP_BUILD_ID}
        aria-hidden={mobileOpen ? false : undefined}
      >
        <div className="hams-sidebar-top">
          <div className="hams-brand hams-drawer-brand">
            <BrandLogo
              variant="dark"
              placement={collapsed ? 'sidebarCollapsed' : 'sidebar'}
              className="hams-drawer-logo"
              priority
            />
            {!collapsed && (
              <div>
                <h1>{BRAND.companyName.toUpperCase()}</h1>
                <p>{BRAND.fullSystemName}</p>
              </div>
            )}
          </div>
          <button
            type="button"
            className="icon-btn hams-sidebar-collapse-btn"
            onClick={() => setCollapsed((v) => !v)}
            aria-label="Collapse sidebar"
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>

        <nav className="hams-nav-list" aria-label="Primary" data-nav-build={APP_BUILD_ID}>
          <SidebarNav nav={nav} pathname={pathname} collapsed={collapsed} onNavigate={closeMobile} />
        </nav>

        <div className="hams-status-card">
          <p>System Status</p>
          <strong>
            <span /> Operational
          </strong>
          {!collapsed && <small>Core services connected</small>}
        </div>
        <div className="hams-sidebar-footer">
          © {new Date().getFullYear()} {BRAND.companyName}
        </div>
      </aside>

      <main className="hams-main-content">
        <header className="hams-topbar">
          <button
            type="button"
            className="icon-btn mobile-only hams-menu-btn"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            <Menu size={20} aria-hidden />
          </button>
          <div className="hams-page-title hams-page-title-with-brand">
            <div className="hidden min-w-0 shrink-0 overflow-hidden sm:block">
              <BrandLogo variant="light" placement="navbar" />
            </div>
            <div className="min-w-0">
              <h2 title={pageName}>{pageName}</h2>
              <p className="hams-page-subtitle">
                {user ? (
                  <>
                    Signed in as <strong>{user.name}</strong> · {roleLabel}
                  </>
                ) : (
                  'Sign in to continue'
                )}
              </p>
            </div>
          </div>
          <div className="hams-search hams-desktop-only">
            <Search size={16} aria-hidden />
            <input placeholder="Search flights, bookings, passengers…" aria-label="Global search" />
          </div>
          <div className="hams-topbar-actions">
            {canNotify && (
              <Link
                href="/notifications"
                className="icon-btn badge-btn hams-icon-link"
                aria-label="Notifications"
                onClick={closeMobile}
              >
                <Bell size={16} />
              </Link>
            )}
            {canCs && (
              <Link
                href="/customers"
                className="icon-btn badge-btn hams-icon-link"
                aria-label="Customer service workspace"
                onClick={closeMobile}
              >
                <Mail size={16} />
              </Link>
            )}
            <button type="button" className="icon-btn hams-desktop-only" onClick={toggleFullscreen} aria-label="Fullscreen">
              <Maximize2 size={15} />
            </button>
            <button type="button" className="icon-btn" onClick={() => void handleLogout()} aria-label="Sign out" title="Sign out">
              <LogOut size={16} />
            </button>
            <Link href="/workspace-settings" className="hams-profile-btn" onClick={closeMobile}>
              <Image src="/admin-avatar.svg" alt="" width={32} height={32} unoptimized />
              <span className="hams-profile-text">
                <strong>{user?.name ?? 'Account'}</strong>
                <small>{roleLabel}</small>
              </span>
              <ChevronRight size={14} className={isFullscreen ? 'rotate' : ''} aria-hidden />
            </Link>
          </div>
        </header>
        <section className="hams-page-transition">
          <ModuleAccessGate>{children}</ModuleAccessGate>
        </section>
      </main>
    </div>
  );
}