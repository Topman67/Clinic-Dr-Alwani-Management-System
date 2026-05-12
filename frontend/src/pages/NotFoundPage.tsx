import { Link } from 'react-router-dom';
import { Card } from '../components/ui';
import { ui } from '../styles/ui';

export const NotFoundPage = () => (
  <Card>
    <div className={ui.sectionHead}>
      <h1 className={ui.sectionTitle}>Page Not Found</h1>
      <p className={ui.sectionSubtitle}>The page you requested doesn't exist or has been moved.</p>
    </div>
    <Link className={ui.linkCta} to="/login">Back to Login</Link>
  </Card>
);
