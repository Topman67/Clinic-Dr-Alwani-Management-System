import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { roleBasePath } from '../config/rbac';
import clinicLogo from '../assets/Logo_Clinic_Dr.Alwani.png';

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
      const nextRole = role ?? (sessionStorage.getItem('cms_role') as keyof typeof roleBasePath | null);
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
      <form className="card login-card" onSubmit={onSubmit}>
        <div className="section-head login-head">
          <img className="login-logo" src={clinicLogo} alt="Clinic Dr. Alwani" />
          <h1>Welcome Back</h1>
          <p className="muted">Sign in to continue</p>
        </div>

        <div className="field-block">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            className="login-input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>

        <div className="field-block">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            className="login-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && <p className="error login-error">{error}</p>}

        <button className="login-button" type="submit" disabled={loading}>
          {loading ? 'Signing in...' : 'Login'}
        </button>
      </form>
    </div>
  );
};
