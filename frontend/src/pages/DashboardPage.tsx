import { useAuth } from '../context/AuthContext';

export const DashboardPage = () => {
  const { role, username } = useAuth();

  return (
    <section className="card">
      <h1>{role} Dashboard</h1>
      <p>Welcome, {username}.</p>
      <p className="muted">Use the left menu to manage clinic modules.</p>
    </section>
  );
};
