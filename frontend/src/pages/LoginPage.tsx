import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { roleBasePath } from '../config/rbac';

export const LoginPage = () => {
  const navigate = useNavigate();
  const { login, role, isAuthenticated } = useAuth();

  const [username, setUsername] = useState('doctor');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated && role) {
      navigate(`${roleBasePath[role]}/dashboard`, { replace: true });
    }
  }, [isAuthenticated, role, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login({ username, password });
      const nextRole = role ?? (localStorage.getItem('cms_role') as keyof typeof roleBasePath | null);
      if (nextRole) {
        navigate(`${roleBasePath[nextRole]}/dashboard`, { replace: true });
      }
    } catch {
      setError('Login failed. Please check credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card" onSubmit={onSubmit}>
        <div className="section-head">
          <h1>Clinic Dr. Alwani CMS</h1>
          <p className="muted">Sign in to continue</p>
        </div>

        <label>Username</label>
        <input value={username} onChange={(e) => setUsername(e.target.value)} required />

        <label>Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />

        {error && <p className="error">{error}</p>}

        <button type="submit" disabled={loading}>{loading ? 'Signing in...' : 'Login'}</button>
      </form>
    </div>
  );
};
