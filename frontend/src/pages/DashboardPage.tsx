import { useAuth } from '../context/AuthContext';
import { Card } from '../components/ui';
import { ui } from '../styles/ui';

export const DashboardPage = () => {
  const { role, username } = useAuth();

  return (
    <Card>
      <h1 className={ui.sectionTitle}>{role} Dashboard</h1>
      <p>Welcome, {username}.</p>
      <p className={ui.muted}>Use the left menu to manage clinic modules.</p>
    </Card>
  );
};
