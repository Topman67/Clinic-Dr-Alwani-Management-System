import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, MouseEvent as ReactMouseEvent } from 'react';
import { api } from '../lib/api';
import { subscribeInAppDataSync } from '../lib/sync';
import { usePagination } from '../lib/pagination';
import { Pagination } from '../components/Pagination';
import PageHeader from '../components/common/PageHeader';

type Role = 'DOCTOR' | 'RECEPTIONIST' | 'PHARMACIST';
type StaffRole = Extract<Role, 'RECEPTIONIST' | 'PHARMACIST'>;
type UserStatus = 'ACTIVE' | 'INACTIVE';
type RoleFilter = 'ALL' | StaffRole;
type StatusFilter = 'ALL' | UserStatus;
type Toast = { type: 'success' | 'error'; message: string } | null;

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
  confirmPassword: string;
  role: StaffRole;
};

type UpdateForm = {
  username: string;
  role: Role;
  status: UserStatus;
};

type ResetPasswordForm = {
  password: string;
  confirmPassword: string;
};

type ConfirmAction = {
  type: 'deactivate' | 'activate' | 'delete';
  user: User;
  title: string;
  message: string;
  danger?: boolean;
} | null;

type ActionMenuPosition = {
  top: number;
  left: number;
  direction: 'up' | 'down';
};

const initialCreateForm: CreateForm = {
  username: '',
  password: '',
  confirmPassword: '',
  role: 'RECEPTIONIST',
};

const initialUpdateForm: UpdateForm = {
  username: '',
  role: 'RECEPTIONIST',
  status: 'ACTIVE',
};

const initialResetForm: ResetPasswordForm = {
  password: '',
  confirmPassword: '',
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

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
};

const normalize = (value: string) => value.trim().toLowerCase();

export const UsersPage = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(initialCreateForm);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [updateForm, setUpdateForm] = useState<UpdateForm>(initialUpdateForm);
  const [resetForm, setResetForm] = useState<ResetPasswordForm>(initialResetForm);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [showCreateConfirmPassword, setShowCreateConfirmPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [openActionForId, setOpenActionForId] = useState<number | null>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState<ActionMenuPosition | null>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ type, message });
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/users');
      setUsers(response.data as User[]);
    } catch {
      showToast('error', 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void loadUsers();
    });
  }, [loadUsers]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const closeActionMenu = () => {
      setOpenActionForId(null);
      setActionMenuPosition(null);
    };

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest('.users-action-panel') && !target.closest('.users-action-trigger')) {
        closeActionMenu();
      }
    };

    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeActionMenu();
        setCreateDrawerOpen(false);
        setEditUser(null);
        setConfirmAction(null);
      }
    };

    const onViewportChange = () => closeActionMenu();

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onEscape);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onEscape);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, []);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch =
        !q ||
        user.username.toLowerCase().includes(q) ||
        user.role.toLowerCase().includes(q) ||
        user.status.toLowerCase().includes(q) ||
        String(user.userId).includes(q);
      const matchesRole = roleFilter === 'ALL' || user.role === roleFilter;
      const matchesStatus = statusFilter === 'ALL' || user.status === statusFilter;
      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, query, roleFilter, statusFilter]);

  const { page, setPage, totalPages, paginated: paginatedUsers } = usePagination(filteredUsers, 10, [
    query,
    roleFilter,
    statusFilter,
  ]);

  const pageStart = filteredUsers.length === 0 ? 0 : (page - 1) * 10 + 1;
  const pageEnd = Math.min(page * 10, filteredUsers.length);
  const selectedActionUser = openActionForId ? users.find((user) => user.userId === openActionForId) ?? null : null;

  const usernameExists = (username: string, ignoreUserId?: number) => {
    const candidate = normalize(username);
    return users.some((user) => user.userId !== ignoreUserId && normalize(user.username) === candidate);
  };

  const validateCreateForm = () => {
    if (!createForm.username.trim()) return 'Username is required.';
    if (createForm.username.trim().length < 3) return 'Username must be at least 3 characters.';
    if (createForm.password.length < 6) return 'Password must be at least 6 characters.';
    if (createForm.password !== createForm.confirmPassword) return 'Passwords must match.';
    if (usernameExists(createForm.username)) return 'Username already exists.';
    return null;
  };

  const validateUpdateForm = () => {
    if (!editUser) return 'No user selected.';
    if (!updateForm.username.trim()) return 'Username is required.';
    if (updateForm.username.trim().length < 3) return 'Username must be at least 3 characters.';
    if (usernameExists(updateForm.username, editUser.userId)) return 'Username already exists.';
    if (editUser.role === 'DOCTOR' && updateForm.role !== 'DOCTOR') return 'Doctor role cannot be changed.';
    if (editUser.role === 'DOCTOR' && updateForm.status !== 'ACTIVE') return 'Primary doctor account must remain active.';
    return null;
  };

  const validateResetForm = () => {
    if (!resetForm.password && !resetForm.confirmPassword) return null;
    if (resetForm.password.length < 6) return 'New password must be at least 6 characters.';
    if (resetForm.password !== resetForm.confirmPassword) return 'Passwords must match.';
    return null;
  };

  const closeCreateDrawer = () => {
    setCreateDrawerOpen(false);
    setCreateForm(initialCreateForm);
    setShowCreatePassword(false);
    setShowCreateConfirmPassword(false);
  };

  const onCreateStaff = async (event: FormEvent) => {
    event.preventDefault();
    const validationMessage = validateCreateForm();
    if (validationMessage) {
      showToast('error', validationMessage);
      return;
    }

    setSaving(true);
    try {
      await api.post('/users', {
        username: createForm.username.trim(),
        password: createForm.password,
        role: createForm.role,
      });
      closeCreateDrawer();
      showToast('success', 'Staff account created successfully.');
      await loadUsers();
    } catch (err: unknown) {
      showToast('error', getApiErrorMessage(err, 'Failed to create staff account.'));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (user: User) => {
    setEditUser(user);
    setUpdateForm({
      username: user.username,
      role: user.role,
      status: user.status,
    });
    setResetForm(initialResetForm);
    setShowResetPassword(false);
    setShowResetConfirmPassword(false);
  };

  const onSaveUser = async () => {
    if (!editUser) return;
    const validationMessage = validateUpdateForm() ?? validateResetForm();
    if (validationMessage) {
      showToast('error', validationMessage);
      return;
    }

    const payload =
      editUser.role === 'DOCTOR'
        ? { username: updateForm.username.trim(), role: 'DOCTOR' as const, status: 'ACTIVE' as const }
        : { username: updateForm.username.trim(), role: updateForm.role, status: updateForm.status };

    setSaving(true);
    try {
      await api.put(`/users/${editUser.userId}`, payload);
      if (resetForm.password) {
        await api.put(`/users/${editUser.userId}/password`, { password: resetForm.password });
      }
      setEditUser(null);
      setResetForm(initialResetForm);
      setShowResetPassword(false);
      setShowResetConfirmPassword(false);
      showToast('success', resetForm.password ? 'User details and password updated successfully.' : 'User details updated successfully.');
      await loadUsers();
    } catch (err: unknown) {
      showToast('error', getApiErrorMessage(err, 'Failed to update user details.'));
    } finally {
      setSaving(false);
    }
  };

  const onDeactivateUser = async (user: User) => {
    setSaving(true);
    try {
      await api.put(`/users/${user.userId}/deactivate`);
      setConfirmAction(null);
      showToast('success', `${user.username} has been deactivated.`);
      await loadUsers();
    } catch (err: unknown) {
      showToast('error', getApiErrorMessage(err, 'Failed to deactivate user.'));
    } finally {
      setSaving(false);
    }
  };

  const onActivateUser = async (user: User) => {
    setSaving(true);
    try {
      await api.put(`/users/${user.userId}`, { username: user.username, role: user.role, status: 'ACTIVE' });
      setConfirmAction(null);
      showToast('success', `${user.username} has been activated.`);
      await loadUsers();
    } catch (err: unknown) {
      showToast('error', getApiErrorMessage(err, 'Failed to activate user.'));
    } finally {
      setSaving(false);
    }
  };

  const onDeleteUser = async (user: User) => {
    setSaving(true);
    try {
      await api.delete(`/users/${user.userId}`);
      setConfirmAction(null);
      setEditUser((current) => (current?.userId === user.userId ? null : current));
      showToast('success', `${user.username} has been deleted.`);
      await loadUsers();
    } catch (err: unknown) {
      showToast('error', getApiErrorMessage(err, 'Failed to delete user.'));
    } finally {
      setSaving(false);
    }
  };

  const openActionMenu = (event: ReactMouseEvent<HTMLButtonElement>, user: User) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const panelWidth = 136;
    const panelHeight = user.role === 'DOCTOR' ? 48 : 136;
    const direction: ActionMenuPosition['direction'] =
      window.innerHeight - rect.bottom < panelHeight + 20 ? 'up' : 'down';
    const left = Math.max(12, Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 12));
    const top = direction === 'up' ? rect.top - 8 : rect.bottom + 8;

    setOpenActionForId((current) => (current === user.userId ? null : user.userId));
    setActionMenuPosition((current) => (openActionForId === user.userId && current ? null : { top, left, direction }));
  };

  const resetFilters = () => {
    setQuery('');
    setRoleFilter('ALL');
    setStatusFilter('ALL');
    setPage(1);
  };

  const renderStatusBadge = (status: UserStatus) => (
    <span className={`status-badge ${status === 'ACTIVE' ? 'status-good' : 'status-danger'}`}>
      {status === 'ACTIVE' ? 'Active' : 'Inactive'}
    </span>
  );

  const renderDoctorBadge = (user: User) =>
    user.role === 'DOCTOR' ? <span className="status-badge users-doctor-badge">Primary Doctor Account</span> : null;

  const renderActionTrigger = (user: User) => (
    <button
      type="button"
      className={`action-menu__trigger users-action-trigger ${openActionForId === user.userId ? 'is-open' : ''}`}
      aria-haspopup="menu"
      aria-expanded={openActionForId === user.userId}
      onClick={(event) => openActionMenu(event, user)}
    >
      <span aria-hidden="true">⋮</span>
      <span className="sr-only">Actions</span>
    </button>
  );

  const renderFloatingActionPanel = () => {
    if (!selectedActionUser || !actionMenuPosition) return null;
    const user = selectedActionUser;
    const isDoctor = user.role === 'DOCTOR';
    const canActivate = !isDoctor && user.status === 'INACTIVE';
    const canDeactivate = !isDoctor && user.status === 'ACTIVE';

    return (
      <div
        className={`action-menu__panel users-action-panel users-floating-action-panel is-${actionMenuPosition.direction}`}
        role="menu"
        style={{ top: actionMenuPosition.top, left: actionMenuPosition.left }}
      >
        <button
          type="button"
          className="action-menu__item"
          role="menuitem"
          onClick={() => {
            setOpenActionForId(null);
            setActionMenuPosition(null);
            startEdit(user);
          }}
        >
          Edit
        </button>
        {!isDoctor && canDeactivate && (
          <button
            type="button"
            className="action-menu__item action-menu__item--danger"
            role="menuitem"
            onClick={() => {
              setOpenActionForId(null);
              setActionMenuPosition(null);
              setConfirmAction({
                type: 'deactivate',
                user,
                title: 'Deactivate this account?',
                message: `Are you sure you want to deactivate ${user.username}? The account will no longer be able to sign in.`,
                danger: true,
              });
            }}
          >
            Deactivate
          </button>
        )}
        {!isDoctor && canActivate && (
          <button
            type="button"
            className="action-menu__item"
            role="menuitem"
            onClick={() => {
              setOpenActionForId(null);
              setActionMenuPosition(null);
              setConfirmAction({
                type: 'activate',
                user,
                title: 'Activate this account?',
                message: `${user.username} will be able to sign in again after activation.`,
              });
            }}
          >
            Activate
          </button>
        )}
        {!isDoctor && (
          <button
            type="button"
            className="action-menu__item action-menu__item--danger"
            role="menuitem"
            onClick={() => {
              setOpenActionForId(null);
              setActionMenuPosition(null);
              setConfirmAction({
                type: 'delete',
                user,
                title: 'Delete this account?',
                message: `This action cannot be undone. Delete ${user.username} permanently only if the account has no related records.`,
                danger: true,
              });
            }}
          >
            Delete
          </button>
        )}
      </div>
    );
  };

  const renderPasswordField = (
    label: string,
    value: string,
    onChange: (value: string) => void,
    visible: boolean,
    setVisible: (value: boolean) => void,
    placeholder: string,
    required = true,
  ) => (
    <label className="field-block users-password-field">
      <span>{label}</span>
      <div className="users-password-control">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
        />
        <button type="button" className="btn-secondary" onClick={() => setVisible(!visible)}>
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </label>
  );

  return (
    <section className="users-page">
      <PageHeader
        eyebrow="Staff Management"
        title="Manage User Account"
        subtitle="Manage small-clinic staff access without changing authentication or role permissions."
        actions={<button type="button" className="btn btn-primary" onClick={() => setCreateDrawerOpen(true)}>+ Create Staff</button>}
        notice={(
          <div className="users-rule-strip">
          <span className="status-badge users-doctor-badge">Primary Doctor Account</span>
          <p>Primary Doctor Account is protected.</p>
          </div>
        )}
      />

      {toast && (
        <div className={`users-toast users-toast--${toast.type}`} role="status">
          {toast.message}
          <button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)}>
            x
          </button>
        </div>
      )}

      <section className="table-card users-table-card">
        <div className="card-header-row users-table-head">
          <div>
            <h3 className="section-title">Staff Directory</h3>
            <p className="section-subtitle">Showing {pageStart}-{pageEnd} of {filteredUsers.length} users</p>
          </div>
          <div className="users-filters">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search username, role, user ID"
            />
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}>
              <option value="ALL">All Roles</option>
              <option value="RECEPTIONIST">Receptionist</option>
              <option value="PHARMACIST">Pharmacist</option>
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
              <option value="ALL">All Status</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
            <button type="button" className="btn btn-outline" onClick={resetFilters}>Reset</button>
          </div>
        </div>

        {loading && <p className="muted">Loading users...</p>}

        <div className="table-wrap users-table-wrap">
          <table className="data-table users-table">
            <thead>
              <tr>
                <th>User ID</th>
                <th>Username</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created Date</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedUsers.map((user) => (
                <tr key={user.userId}>
                  <td>#{user.userId}</td>
                  <td>
                    <div className="users-name-cell">
                      <strong>{user.username}</strong>
                      {renderDoctorBadge(user)}
                    </div>
                  </td>
                  <td>{prettifyRole(user.role)}</td>
                  <td>{renderStatusBadge(user.status)}</td>
                  <td>{formatDateTime(user.createdAt)}</td>
                  <td>{renderActionTrigger(user)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />

        <div className="mobile-cards users-mobile-list">
          {paginatedUsers.map((user) => (
            <article key={user.userId} className="mobile-card users-mobile-card">
              <div className="users-mobile-head">
                <div>
                  <h4>{user.username}</h4>
                  <p>User #{user.userId} / {prettifyRole(user.role)}</p>
                </div>
                {renderStatusBadge(user.status)}
              </div>
              {renderDoctorBadge(user)}
              <dl className="kv">
                <div>
                  <dt>Created</dt>
                  <dd>{formatDateTime(user.createdAt)}</dd>
                </div>
              </dl>
              <div className="mobile-card-actions">{renderActionTrigger(user)}</div>
            </article>
          ))}
        </div>

        {!loading && filteredUsers.length === 0 && <p className="muted">No users found.</p>}
      </section>

      {renderFloatingActionPanel()}

      {createDrawerOpen && (
        <div className="users-drawer-layer" role="presentation">
          <button type="button" className="users-modal-backdrop" aria-label="Close create staff drawer" onClick={closeCreateDrawer} />
          <aside className="users-drawer" role="dialog" aria-modal="true" aria-labelledby="create-staff-title">
            <form onSubmit={onCreateStaff} className="users-drawer-form">
              <div className="users-modal-head">
                <div>
                  <h3 id="create-staff-title">Create Staff Account</h3>
                  <p className="muted">Create receptionist and pharmacist accounts securely.</p>
                </div>
                <button type="button" className="btn-secondary" onClick={closeCreateDrawer}>Close</button>
              </div>
              <div className="users-modal-body users-drawer-body">
                <label className="field-block">
                  <span>Username</span>
                  <input
                    value={createForm.username}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, username: event.target.value }))}
                    placeholder="Staff username"
                    required
                  />
                </label>
                {renderPasswordField(
                  'Initial Password',
                  createForm.password,
                  (value) => setCreateForm((prev) => ({ ...prev, password: value })),
                  showCreatePassword,
                  setShowCreatePassword,
                  'Minimum 6 characters',
                )}
                {renderPasswordField(
                  'Confirm Password',
                  createForm.confirmPassword,
                  (value) => setCreateForm((prev) => ({ ...prev, confirmPassword: value })),
                  showCreateConfirmPassword,
                  setShowCreateConfirmPassword,
                  'Confirm password',
                )}
                <label className="field-block">
                  <span>Role</span>
                  <select
                    value={createForm.role}
                    onChange={(event) => setCreateForm((prev) => ({ ...prev, role: event.target.value as StaffRole }))}
                  >
                    <option value="RECEPTIONIST">Receptionist</option>
                    <option value="PHARMACIST">Pharmacist</option>
                  </select>
                </label>
                <p className="field-helper users-password-helper">Password must be at least 6 characters. Doctor accounts are not created from this form.</p>
              </div>
              <div className="users-modal-footer">
                <button type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create Staff'}</button>
                <button type="button" className="btn-secondary" onClick={closeCreateDrawer} disabled={saving}>Cancel</button>
              </div>
            </form>
          </aside>
        </div>
      )}

      {editUser && (
        <div className="users-modal-layer" role="presentation">
          <button type="button" className="users-modal-backdrop" aria-label="Close update user dialog" onClick={() => setEditUser(null)} />
          <section className="users-modal" role="dialog" aria-modal="true" aria-labelledby="update-user-title">
            <div className="users-modal-head">
              <div>
                <h3 id="update-user-title">Manage Staff Account</h3>
                <p className="muted">{editUser.role === 'DOCTOR' ? 'Primary doctor status and role are protected.' : 'Update staff username, role, and account status.'}</p>
              </div>
              <button type="button" className="btn-secondary" onClick={() => setEditUser(null)}>Close</button>
            </div>
            <div className="users-modal-body users-form-grid">
              <label className="field-block">
                <span>Username</span>
                <input
                  value={updateForm.username}
                  onChange={(event) => setUpdateForm((prev) => ({ ...prev, username: event.target.value }))}
                  required
                />
              </label>
              <label className="field-block">
                <span>Role</span>
                <select
                  value={updateForm.role}
                  disabled={editUser.role === 'DOCTOR'}
                  onChange={(event) => setUpdateForm((prev) => ({ ...prev, role: event.target.value as Role }))}
                >
                  {editUser.role === 'DOCTOR' && <option value="DOCTOR">Doctor</option>}
                  <option value="RECEPTIONIST">Receptionist</option>
                  <option value="PHARMACIST">Pharmacist</option>
                </select>
              </label>
              <label className="field-block">
                <span>Status</span>
                <select
                  value={updateForm.status}
                  disabled={editUser.role === 'DOCTOR'}
                  onChange={(event) => setUpdateForm((prev) => ({ ...prev, status: event.target.value as UserStatus }))}
                >
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </label>
              <div className="users-reset-section">
                <div>
                  <h4>Reset Password</h4>
                  <p className="muted">Leave both fields empty to keep the current password.</p>
                </div>
                {renderPasswordField(
                  'New Password',
                  resetForm.password,
                  (value) => setResetForm((prev) => ({ ...prev, password: value })),
                  showResetPassword,
                  setShowResetPassword,
                  'Optional new password',
                  false,
                )}
                {renderPasswordField(
                  'Confirm Password',
                  resetForm.confirmPassword,
                  (value) => setResetForm((prev) => ({ ...prev, confirmPassword: value })),
                  showResetConfirmPassword,
                  setShowResetConfirmPassword,
                  'Confirm optional password',
                  false,
                )}
              </div>
            </div>
            <div className="users-modal-footer">
              <button type="button" onClick={() => void onSaveUser()} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setEditUser(null)}>Cancel</button>
            </div>
          </section>
        </div>
      )}

      {confirmAction && (
        <div className="users-modal-layer" role="presentation">
          <button type="button" className="users-modal-backdrop" aria-label="Cancel confirmation" onClick={() => setConfirmAction(null)} disabled={saving} />
          <section className="users-modal users-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-action-title">
            <div className="users-modal-head">
              <div>
                <h3 id="confirm-action-title">{confirmAction.title}</h3>
                <p className="muted">{confirmAction.message}</p>
              </div>
            </div>
            <div className="users-modal-footer">
              <button
                type="button"
                className={confirmAction.danger ? 'btn-danger' : undefined}
                disabled={saving}
                onClick={() => {
                  if (confirmAction.type === 'deactivate') void onDeactivateUser(confirmAction.user);
                  if (confirmAction.type === 'activate') void onActivateUser(confirmAction.user);
                  if (confirmAction.type === 'delete') void onDeleteUser(confirmAction.user);
                }}
              >
                {saving ? 'Processing...' : 'Confirm'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setConfirmAction(null)} disabled={saving}>Cancel</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
};
