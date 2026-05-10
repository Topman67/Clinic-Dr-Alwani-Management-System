import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { roleModules, roleBasePath } from '../config/rbac';
import { getCurrentTabId, notifyInAppDataSync, subscribeDataChanged } from '../lib/sync';
import sidebarLogo from '../assets/Logo_sidebar.png';
import sidebarLogoDark from '../assets/logo_sidebar_darkmode.png';

const prettify = (slug: string) => slug.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const prettifyRole = (value: string) => value.replace('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const moduleIcons: Record<string, string> = {
  dashboard: '⌂',
  users: '👥',
  patients: '⚕',
  appointments: '◷',
  consultations: '✚',
  prescriptions: '✎',
  inventory: '▣',
  payments: '◈',
  sales: '▤',
  reports: '▥',
  'audit-logs': '◇',
};

export const AppLayout = () => {
  const { role, username, logout } = useAuth();
  const location = useLocation();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('cms_theme');
    return stored === 'light' ? 'light' : 'dark';
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('cms_sidebar_collapsed') === 'true');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cms_theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('cms_sidebar_collapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    const currentTabId = getCurrentTabId();
    return subscribeDataChanged((payload) => {
      if (payload.sourceTabId === currentTabId) return;
      notifyInAppDataSync(payload);
    });
  }, []);

  if (!role) return null;

  const basePath = roleBasePath[role];
  const modules = roleModules[role];
  const navItems = ['dashboard', ...modules];
  const activeSidebarLogo = theme === 'dark' ? sidebarLogoDark : sidebarLogo;
  const usernameInitial = (username?.trim().charAt(0) || role.charAt(0)).toUpperCase();
  const displayName = username?.trim() || prettifyRole(role);
  const displayRole = prettifyRole(role);
  const shellClassName = [
    'app-shell',
    sidebarCollapsed ? 'sidebar-collapsed' : '',
    mobileSidebarOpen ? 'sidebar-mobile-open' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const renderNavItem = (module: string) => {
    const label = module === 'dashboard' ? 'Dashboard' : prettify(module);
    return (
      <NavLink
        key={module}
        to={`${basePath}/${module}`}
        data-tooltip={label}
        title={sidebarCollapsed ? label : undefined}
        onClick={() => setMobileSidebarOpen(false)}
      >
        <span aria-hidden>{moduleIcons[module] ?? '□'}</span>
        <span className="nav-label">{label}</span>
      </NavLink>
    );
  };

  return (
    <div className={shellClassName}>
      <button
        type="button"
        className="mobile-sidebar-toggle"
        onClick={() => setMobileSidebarOpen(true)}
        aria-label="Open sidebar"
      >
        <span aria-hidden className="sidebar-toggle-bars">
          <span />
          <span />
          <span />
        </span>
      </button>

      {mobileSidebarOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          onClick={() => setMobileSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      )}

      <aside className="sidebar">
        <div className="sidebar-head">
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed((prev) => !prev)}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!sidebarCollapsed}
          >
            <span aria-hidden className="sidebar-toggle-bars">
              <span />
              <span />
              <span />
            </span>
          </button>

          <div className="sidebar-brand">
            <img className="sidebar-logo" src={activeSidebarLogo} alt="Clinic Dr. Alwani" />
          </div>

          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
            data-short-mode={theme === 'light' ? 'D' : 'L'}
            aria-label="Toggle theme"
          >
            {theme === 'light' ? 'Dark' : 'Light'}
          </button>
        </div>

        <div className="sidebar-meta" title={sidebarCollapsed ? `${displayName} - ${displayRole}` : undefined}>
          <div className="profile-avatar" aria-hidden>
            <span>{usernameInitial}</span>
            <span className="profile-status" />
          </div>
          <div className="profile-copy">
            <p className="profile-name">{displayName}</p>
            <p className="profile-role">{displayRole}</p>
          </div>
        </div>

        <nav>{navItems.map(renderNavItem)}</nav>

        <button
          onClick={logout}
          className="logout-btn"
          data-tooltip="Logout"
          title={sidebarCollapsed ? 'Logout' : undefined}
        >
          <span aria-hidden className="logout-icon">
            ↪
          </span>
          <span className="logout-label">Logout</span>
        </button>
      </aside>

      <main className="content">
        <div key={location.pathname} className="page-transition">
          <Outlet />
        </div>
      </main>

      <nav className="bottom-nav" aria-label="Mobile navigation">
        {navItems.map((module) => {
          const label = module === 'dashboard' ? 'Dashboard' : prettify(module);
          return (
            <NavLink key={module} to={`${basePath}/${module}`} onClick={() => setMobileSidebarOpen(false)}>
              <span aria-hidden>{moduleIcons[module] ?? '□'}</span>
              <span>{label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
};
