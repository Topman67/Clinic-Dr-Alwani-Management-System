import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { roleBasePath } from '../config/rbac';
import clinicLogoDark from '../assets/Logo_Clinic_no_background.png';
import clinicLogoLight from '../assets/Logo_Clinic_Dr.Alwani.png';

export const LoginPage = () => {
  const navigate = useNavigate();
  const { login, role, isAuthenticated } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ username?: string; password?: string }>({});

  useEffect(() => {
    if (isAuthenticated && role) {
      navigate(`${roleBasePath[role]}/dashboard`, { replace: true });
    }
  }, [isAuthenticated, role, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const nextErrors: typeof fieldErrors = {};
    if (!username.trim()) nextErrors.username = 'Username is required.';
    if (!password) nextErrors.password = 'Password is required.';
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    setError(null);
    try {
      await login({ username: username.trim(), password });
      const nextRole = role ?? (sessionStorage.getItem('cms_role') as keyof typeof roleBasePath | null);
      if (nextRole) {
        navigate(`${roleBasePath[nextRole]}/dashboard`, { replace: true });
      }
    } catch {
      setError('Invalid username or password.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={onSubmit}>
        <div className="section-head login-head">
          <img className="login-logo login-logo--light" src={clinicLogoLight} alt="Clinic Dr. Alwani" />
          <img className="login-logo login-logo--dark" src={clinicLogoDark} alt="Clinic Dr. Alwani" />
          <h1>Welcome Back</h1>
          <p className="muted">Sign in to continue to Clinic Dr. Alwani CMS</p>
        </div>

        <label className="field-block login-field" htmlFor="username">
          <span>Username</span>
          <input
            id="username"
            className={`login-input ${fieldErrors.username ? 'field-invalid' : ''}`}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setFieldErrors((prev) => ({ ...prev, username: undefined }));
            }}
            placeholder="Enter username"
            autoComplete="username"
            disabled={loading}
          />
          {fieldErrors.username && <small className="login-field-error">{fieldErrors.username}</small>}
        </label>

        <label className="field-block login-field" htmlFor="password">
          <span>Password</span>
          <div className="login-password-control">
            <input
              id="password"
              className={`login-input ${fieldErrors.password ? 'field-invalid' : ''}`}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setFieldErrors((prev) => ({ ...prev, password: undefined }));
              }}
              placeholder="Enter password"
              autoComplete="current-password"
              disabled={loading}
            />
            <button
              type="button"
              className={`login-password-toggle ${showPassword ? 'is-visible' : ''}`}
              onClick={() => setShowPassword((current) => !current)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              disabled={loading}
            >
              <span className="login-eye" aria-hidden="true" />
            </button>
          </div>
          {fieldErrors.password && <small className="login-field-error">{fieldErrors.password}</small>}
        </label>

        {error && <p className="error login-error">{error}</p>}

        <button className="login-button" type="submit" disabled={loading}>
          {loading && <span className="login-spinner" aria-hidden="true" />}
          {loading ? 'Signing In...' : 'Login'}
        </button>
      </form>
    </div>
  );
};
