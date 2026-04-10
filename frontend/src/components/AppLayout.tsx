import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { roleModules, roleBasePath } from '../config/rbac';
import { getCurrentTabId, notifyInAppDataSync, subscribeDataChanged } from '../lib/sync';

const prettify = (slug: string) => slug.replace('-', ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const moduleIcons: Record<string, string> = {
  dashboard: '🏠',
  users: '👥',
  patients: '🧑‍⚕️',
  prescriptions: '📝',
  inventory: '📦',
  payments: '💳',
  reports: '📊',
  'audit-logs': '🛡️',
};

export const AppLayout = () => {
  const { role, username, logout } = useAuth();
  const location = useLocation();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('cms_theme');
    return stored === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cms_theme', theme);
  }, [theme]);

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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-head">
          <h2>Clinic CMS</h2>
          <button
            type="button"
            className="theme-toggle"
            onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
            aria-label="Toggle theme"
          >
            {theme === 'light' ? '🌙 Dark' : '☀️ Light'}
          </button>
        </div>
        <div className="sidebar-meta">
          <p className="muted">{role}</p>
          <p className="muted">{username}</p>
        </div>
        <nav>
          <NavLink to={`${basePath}/dashboard`}>
            <span aria-hidden>{moduleIcons.dashboard}</span>
            <span className="nav-label">Dashboard</span>
          </NavLink>
          {modules.map((module) => (
            <NavLink key={module} to={`${basePath}/${module}`}>
              <span aria-hidden>{moduleIcons[module] ?? '📁'}</span>
              <span className="nav-label">{prettify(module)}</span>
            </NavLink>
          ))}
        </nav>
        <button onClick={logout} className="logout-btn">🚪 Logout</button>
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
            <NavLink key={module} to={`${basePath}/${module}`}>
              <span aria-hidden>{moduleIcons[module] ?? '📁'}</span>
              <span>{label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
};
