import { Link } from 'react-router-dom';

export const NotFoundPage = () => (
  <section className="card">
    <div className="section-head">
      <h1>Page Not Found</h1>
      <p className="muted">The page you requested doesn't exist or has been moved.</p>
    </div>
    <Link className="link-cta" to="/login">Back to Login</Link>
  </section>
);
