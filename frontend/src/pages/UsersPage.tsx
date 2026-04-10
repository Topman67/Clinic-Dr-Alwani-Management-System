import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';

type Role = 'DOCTOR' | 'RECEPTIONIST' | 'PHARMACIST';
type UserStatus = 'ACTIVE' | 'INACTIVE';

type User = {
  userId: number;
  username: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
};

type CreateForm = {
  username: string;
  password: string;
  role: Extract<Role, 'RECEPTIONIST' | 'PHARMACIST'>;
};

type UpdateForm = {
  username: string;
  role: Role;
  status: UserStatus;
};

const initialCreateForm: CreateForm = {
  username: '',
  password: '',
  role: 'RECEPTIONIST',
};

const initialUpdateForm: UpdateForm = {
  username: '',
  role: 'RECEPTIONIST',
  status: 'ACTIVE',
};

const prettifyRole = (role: Role) => {
  if (role === 'RECEPTIONIST') return 'Receptionist';
  if (role === 'PHARMACIST') return 'Pharmacist';
  return 'Doctor';
};

const getApiErrorMessage = (err: unknown, fallback: string) => {
  if (typeof err === 'object' && err !== null) {
    const response = (err as { response?: { data?: { message?: string } } }).response;
    const message = response?.data?.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
};

export const UsersPage = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [query, setQuery] = useState('');
  const [createForm, setCreateForm] = useState<CreateForm>(initialCreateForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [updateForm, setUpdateForm] = useState<UpdateForm>(initialUpdateForm);
  const [resetPasswordForId, setResetPasswordForId] = useState<number | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/users');
      setUsers(response.data as User[]);
    } catch {
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      return (
        u.username.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q) ||
        u.status.toLowerCase().includes(q) ||
        String(u.userId).includes(q)
      );
    });
  }, [users, query]);

  const onCreateStaff = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (createForm.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setSaving(true);
    try {
      await api.post('/users', createForm);
      setCreateForm(initialCreateForm);
      await loadUsers();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to create staff account'));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (user: User) => {
    setEditingId(user.userId);
    setUpdateForm({
      username: user.username,
      role: user.role,
      status: user.status,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setUpdateForm(initialUpdateForm);
  };

  const onSaveUser = async () => {
    if (!editingId) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/users/${editingId}`, updateForm);
      cancelEdit();
      await loadUsers();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to update user details'));
    } finally {
      setSaving(false);
    }
  };

  const onDeactivateUser = async (userId: number) => {
    const confirmed = window.confirm('Deactivate this user account?');
    if (!confirmed) return;

    setError(null);
    try {
      await api.put(`/users/${userId}/deactivate`);
      await loadUsers();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to deactivate user'));
    }
  };

  const onDeleteUser = async (userId: number) => {
    const confirmed = window.confirm('Delete this user permanently? This cannot be undone.');
    if (!confirmed) return;

    setError(null);
    try {
      await api.delete(`/users/${userId}`);
      if (editingId === userId) cancelEdit();
      if (resetPasswordForId === userId) {
        setResetPasswordForId(null);
        setNewPassword('');
      }
      await loadUsers();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to delete user'));
    }
  };

  const onResetPassword = async () => {
    if (!resetPasswordForId) return;
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await api.put(`/users/${resetPasswordForId}/password`, { password: newPassword });
      setResetPasswordForId(null);
      setNewPassword('');
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to reset password'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <div className="section-head">
        <h1>Manage User Account</h1>
        <p className="muted">Register staff (Receptionist/Pharmacist), update role/status, reset password, deactivate or delete accounts.</p>
      </div>

      <form onSubmit={onCreateStaff} className="users-create-grid">
        <input
          value={createForm.username}
          onChange={(e) => setCreateForm((prev) => ({ ...prev, username: e.target.value }))}
          placeholder="Staff username"
          required
        />
        <input
          type="password"
          value={createForm.password}
          onChange={(e) => setCreateForm((prev) => ({ ...prev, password: e.target.value }))}
          placeholder="Initial password"
          required
        />
        <select
          value={createForm.role}
          onChange={(e) =>
            setCreateForm((prev) => ({ ...prev, role: e.target.value as 'RECEPTIONIST' | 'PHARMACIST' }))
          }
        >
          <option value="RECEPTIONIST">Receptionist</option>
          <option value="PHARMACIST">Pharmacist</option>
        </select>
        <button type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Staff'}</button>
      </form>

      <div className="form-row" style={{ marginTop: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search username / role / status / user id"
        />
      </div>

      {editingId && (
        <section className="card users-subcard" style={{ marginTop: 14 }}>
          <div className="section-head">
            <h3>Update User Details</h3>
          </div>
          <div className="users-edit-grid">
            <input
              value={updateForm.username}
              onChange={(e) => setUpdateForm((prev) => ({ ...prev, username: e.target.value }))}
              placeholder="Username"
              required
            />
            <select
              value={updateForm.role}
              onChange={(e) => setUpdateForm((prev) => ({ ...prev, role: e.target.value as Role }))}
            >
              <option value="DOCTOR">Doctor</option>
              <option value="RECEPTIONIST">Receptionist</option>
              <option value="PHARMACIST">Pharmacist</option>
            </select>
            <select
              value={updateForm.status}
              onChange={(e) => setUpdateForm((prev) => ({ ...prev, status: e.target.value as UserStatus }))}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
          <div className="action-row" style={{ marginTop: 10 }}>
            <button type="button" onClick={() => void onSaveUser()} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button type="button" className="btn-secondary" onClick={cancelEdit}>Cancel</button>
          </div>
        </section>
      )}

      {resetPasswordForId && (
        <section className="card users-subcard" style={{ marginTop: 14 }}>
          <div className="section-head">
            <h3>Reset Password</h3>
          </div>
          <div className="users-password-grid">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password (min 6 chars)"
            />
            <button type="button" onClick={() => void onResetPassword()} disabled={saving}>
              {saving ? 'Updating...' : 'Update Password'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setResetPasswordForId(null);
                setNewPassword('');
              }}
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading...</p>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>User ID</th>
              <th>Username</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.map((user) => (
              <tr key={user.userId}>
                <td>{user.userId}</td>
                <td>{user.username}</td>
                <td>{prettifyRole(user.role)}</td>
                <td>
                  <span className={`status-badge ${user.status === 'ACTIVE' ? 'status-good' : 'status-warning'}`}>
                    {user.status}
                  </span>
                </td>
                <td>{new Date(user.createdAt).toLocaleString()}</td>
                <td>
                  <div className="action-row">
                    <button type="button" className="btn-secondary" onClick={() => startEdit(user)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setResetPasswordForId(user.userId);
                        setNewPassword('');
                      }}
                    >
                      Reset Password
                    </button>
                    <button type="button" className="btn-warning" onClick={() => void onDeactivateUser(user.userId)}>
                      Deactivate
                    </button>
                    <button type="button" className="btn-danger" onClick={() => void onDeleteUser(user.userId)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mobile-cards">
        {filteredUsers.map((user) => (
          <article key={user.userId} className="mobile-card">
            <h4>{user.username}</h4>
            <dl className="kv">
              <div>
                <dt>User ID</dt>
                <dd>{user.userId}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{prettifyRole(user.role)}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <span className={`status-badge ${user.status === 'ACTIVE' ? 'status-good' : 'status-warning'}`}>
                    {user.status}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{new Date(user.createdAt).toLocaleDateString()}</dd>
              </div>
            </dl>
            <div className="action-row" style={{ marginTop: 10 }}>
              <button type="button" className="btn-secondary" onClick={() => startEdit(user)}>
                Edit
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setResetPasswordForId(user.userId);
                  setNewPassword('');
                }}
              >
                Reset Password
              </button>
              <button type="button" className="btn-warning" onClick={() => void onDeactivateUser(user.userId)}>
                Deactivate
              </button>
              <button type="button" className="btn-danger" onClick={() => void onDeleteUser(user.userId)}>
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>

      {!loading && filteredUsers.length === 0 && <p className="muted">No users found.</p>}
    </section>
  );
};
