import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './AuthContext';
import { ProtectedRoute } from '../components/ProtectedRoute';

const createToken = (payload: Record<string, unknown>): string => {
  const encoded = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `header.${encoded}.signature`;
};

describe('Auth persistence on refresh', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps user on protected page after refresh when token exists', () => {
    sessionStorage.setItem('cms_token', createToken({ role: 'DOCTOR', username: 'doctor' }));

    render(
      <MemoryRouter initialEntries={['/doctor/dashboard']}>
        <AuthProvider>
          <Routes>
            <Route element={<ProtectedRoute allowedRoles={['DOCTOR']} />}>
              <Route path="/doctor/dashboard" element={<div>Dashboard</div>} />
            </Route>
            <Route path="/login" element={<div>Login</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('Dashboard')).toBeTruthy();
    expect(screen.queryByText('Login')).toBeNull();
  });

  it('redirects to login when token is missing', () => {
    render(
      <MemoryRouter initialEntries={['/doctor/dashboard']}>
        <AuthProvider>
          <Routes>
            <Route element={<ProtectedRoute allowedRoles={['DOCTOR']} />}>
              <Route path="/doctor/dashboard" element={<div>Dashboard</div>} />
            </Route>
            <Route path="/login" element={<div>Login</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText('Login')).toBeTruthy();
    expect(screen.queryByText('Dashboard')).toBeNull();
  });
});
