/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../lib/api';
import type { UserRole } from '../config/rbac';

type AuthState = {
  token: string | null;
  role: UserRole | null;
  username: string | null;
};

type LoginPayload = {
  username: string;
  password: string;
};

type AuthContextValue = AuthState & {
  isReady: boolean;
  isAuthenticated: boolean;
  login: (payload: LoginPayload) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = 'cms_token';
const ROLE_KEY = 'cms_role';
const USERNAME_KEY = 'cms_username';

const isUserRole = (value: unknown): value is UserRole => {
  return value === 'DOCTOR' || value === 'RECEPTIONIST' || value === 'PHARMACIST';
};

const parseJwtPayload = (token: string): Record<string, unknown> | null => {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = atob(padded);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const getInitialAuthState = (): AuthState => {
  const token = localStorage.getItem(TOKEN_KEY);
  const storedRole = localStorage.getItem(ROLE_KEY);
  const storedUsername = localStorage.getItem(USERNAME_KEY);

  if (!token) {
    return { token: null, role: null, username: null };
  }

  const payload = parseJwtPayload(token);
  const payloadRole = payload?.role;
  const payloadUsername = payload?.username;

  const role = isUserRole(storedRole)
    ? storedRole
    : isUserRole(payloadRole)
      ? payloadRole
      : null;

  const username =
    storedUsername || (typeof payloadUsername === 'string' && payloadUsername.trim().length > 0 ? payloadUsername : null);

  return { token, role, username };
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const initialAuth = getInitialAuthState();
  const [token, setToken] = useState<string | null>(initialAuth.token);
  const [role, setRole] = useState<UserRole | null>(initialAuth.role);
  const [username, setUsername] = useState<string | null>(initialAuth.username);
  const [isReady] = useState(true);

  const login = async ({ username, password }: LoginPayload) => {
    const response = await api.post('/auth/login', { username, password });
    const data = response.data as { token: string; role: UserRole; username: string };

    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(ROLE_KEY, data.role);
    localStorage.setItem(USERNAME_KEY, data.username);

    setToken(data.token);
    setRole(data.role);
    setUsername(data.username);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(USERNAME_KEY);
    setToken(null);
    setRole(null);
    setUsername(null);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      token,
      role,
      username,
      isReady,
      login,
      logout,
      isAuthenticated: Boolean(token && role),
    }),
    [token, role, username, isReady],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
};
