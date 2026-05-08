import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';
import { subscribeInAppDataSync } from '../lib/sync';
import { useAuth } from '../context/AuthContext';

type MedicineApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

type Medicine = {
  medicineId: number;
  name: string;
  batchNumber: string;
  quantity: number;
  expiryDate: string;
  price: number | string;
  approvalStatus: MedicineApprovalStatus;
  requestedByUsername?: string | null;
  approvedByUsername?: string | null;
  approvedAt?: string | null;
  rejectedByUsername?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
};

type MedicineForm = {
  name: string;
  batchNumber: string;
  quantity: number;
  expiryDate: string;
  price: number;
};

const initialForm: MedicineForm = {
  name: '',
  batchNumber: '',
  quantity: 0,
  expiryDate: '',
  price: 0,
};

const toDateInput = (isoDate: string) => {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const formatMoney = (value: number | string) => {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
};

const daysUntil = (isoDate: string) => {
  const target = new Date(isoDate).getTime();
  const now = new Date().getTime();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
};

const stockClass = (qty: number) => {
  if (qty <= 0) return 'status-badge status-critical';
  if (qty <= 20) return 'status-badge status-warning';
  return 'status-badge status-good';
};

const expiryClass = (expiryDate: string) => {
  const d = daysUntil(expiryDate);
  if (d < 0) return 'status-badge status-critical';
  if (d <= 30) return 'status-badge status-warning';
  return 'status-badge status-good';
};

const approvalClass = (status: MedicineApprovalStatus) => {
  if (status === 'APPROVED') return 'status-badge status-good';
  if (status === 'REJECTED') return 'status-badge status-critical';
  return 'status-badge status-warning';
};

const approvalLabel = (status: MedicineApprovalStatus) => {
  if (status === 'APPROVED') return 'Approved';
  if (status === 'REJECTED') return 'Rejected';
  return 'Pending Approval';
};

export const InventoryPage = () => {
  const { role } = useAuth();
  const canManage = role === 'PHARMACIST';
  const canApprove = role === 'DOCTOR';

  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | MedicineApprovalStatus>('ALL');
  const [form, setForm] = useState<MedicineForm>(initialForm);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [resubmittingId, setResubmittingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const getApiErrorMessage = (err: unknown, fallback: string) => {
    if (typeof err === 'object' && err !== null) {
      const response = (err as { response?: { data?: { message?: string } } }).response;
      const message = response?.data?.message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
  };

  const loadMedicines = useCallback(async (q = '', status: 'ALL' | MedicineApprovalStatus = 'ALL') => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/medicine', {
        params: {
          query: q,
          includePending: true,
          approvalStatus: status === 'ALL' ? undefined : status,
        },
      });
      setMedicines(response.data as Medicine[]);
    } catch {
      setError('Failed to load medicine inventory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMedicines('', statusFilter);
  }, [loadMedicines, statusFilter]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void loadMedicines(query, statusFilter);
    });
  }, [loadMedicines, query, statusFilter]);

  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    await loadMedicines(query, statusFilter);
  };

  const validateForm = () => {
    const nextErrors: Record<string, boolean> = {};

    if (!form.name.trim()) nextErrors.name = true;
    if (!form.batchNumber.trim()) nextErrors.batchNumber = true;
    if (!form.expiryDate) nextErrors.expiryDate = true;
    if (!Number.isFinite(form.quantity) || form.quantity < 0) nextErrors.quantity = true;
    if (!Number.isFinite(form.price) || form.price < 0) nextErrors.price = true;

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const updateField = <K extends keyof MedicineForm>(key: K, value: MedicineForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!prev[String(key)]) return prev;
      const next = { ...prev };
      delete next[String(key)];
      return next;
    });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canManage) return;

    setError(null);
    setSuccess(null);

    if (!validateForm()) {
      setError('Missing or invalid fields.');
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/medicine/${editingId}`, form);
        setSuccess('Medicine Updated Successfully');
      } else {
        const response = await api.post('/medicine', form);
        const data = response.data as { message?: string };
        setSuccess(data.message || 'Medicine submitted for approval.');
      }
      setForm(initialForm);
      setEditingId(null);
      setFieldErrors({});
      setShowForm(false);
      await loadMedicines(query, statusFilter);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to save medicine'));
    } finally {
      setSaving(false);
    }
  };

  const onApprove = async (medicineId: number) => {
    if (!canApprove) return;
    setApprovingId(medicineId);
    setError(null);
    setSuccess(null);
    try {
      const response = await api.patch(`/medicine/${medicineId}/approve`);
      const data = response.data as { message?: string };
      setSuccess(data.message || 'Medicine approved successfully.');
      await loadMedicines(query);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to approve medicine'));
    } finally {
      setApprovingId(null);
    }
  };

  const onReject = async (medicineId: number) => {
    if (!canApprove) return;
    setRejectingId(medicineId);
    setError(null);
    setSuccess(null);
    const rejectionReason = window.prompt('Rejection reason (optional):', '') ?? '';
    try {
      const response = await api.patch(`/medicine/${medicineId}/reject`, {
        rejectionReason: rejectionReason.trim() || undefined,
      });
      const data = response.data as { message?: string };
      setSuccess(data.message || 'Medicine rejected successfully.');
      await loadMedicines(query, statusFilter);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to reject medicine'));
    } finally {
      setRejectingId(null);
    }
  };

  const onResubmit = async (medicineId: number) => {
    if (!canManage) return;
    setResubmittingId(medicineId);
    setError(null);
    setSuccess(null);
    try {
      const response = await api.patch(`/medicine/${medicineId}/resubmit`);
      const data = response.data as { message?: string };
      setSuccess(data.message || 'Medicine resubmitted for review.');
      await loadMedicines(query, statusFilter);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to resubmit medicine'));
    } finally {
      setResubmittingId(null);
    }
  };

  const onEdit = (medicine: Medicine) => {
    if (!canManage) return;
    setEditingId(medicine.medicineId);
    setShowForm(true);
    setError(null);
    setSuccess(null);
    setForm({
      name: medicine.name,
      batchNumber: medicine.batchNumber,
      quantity: medicine.quantity,
      expiryDate: toDateInput(medicine.expiryDate),
      price: Number(medicine.price),
    });
  };

  const onDelete = async (medicineId: number) => {
    if (!canManage) return;
    const confirmed = window.confirm('Delete this medicine record?');
    if (!confirmed) return;

    setError(null);
    setSuccess(null);
    try {
      await api.delete(`/medicine/${medicineId}`);
      if (editingId === medicineId) {
        setEditingId(null);
        setForm(initialForm);
      }
      setSuccess('Medicine Deleted Successfully');
      await loadMedicines(query, statusFilter);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to delete medicine'));
    }
  };

  const onCancelEdit = () => {
    setEditingId(null);
    setForm(initialForm);
    setFieldErrors({});
    setError(null);
    setSuccess(null);
    setShowForm(false);
  };

  const pendingMedicines = useMemo(() => medicines.filter((m) => m.approvalStatus === 'PENDING'), [medicines]);
  const approvedMedicines = useMemo(() => medicines.filter((m) => m.approvalStatus === 'APPROVED'), [medicines]);
  const rejectedMedicines = useMemo(() => medicines.filter((m) => m.approvalStatus === 'REJECTED'), [medicines]);
  const lowStockCount = useMemo(() => approvedMedicines.filter((m) => m.quantity <= 20).length, [approvedMedicines]);
  const expiringSoonCount = useMemo(() => approvedMedicines.filter((m) => daysUntil(m.expiryDate) <= 30).length, [approvedMedicines]);

  return (
    <section className="card">
      <div className="section-head">
        <h1>Manage Inventory</h1>
        <p className="muted">
          {canManage
            ? 'Pharmacist can submit new medicines and maintain inventory records.'
            : 'Doctor can review inventory and confirm pending medicine requests.'}
        </p>
      </div>

      <div className="stats-row">
        <div className="stat-chip">Approved: {approvedMedicines.length}</div>
        <div className="stat-chip warning">Pending approval: {pendingMedicines.length}</div>
        <div className="stat-chip" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>Rejected: {rejectedMedicines.length}</div>
        <div className="stat-chip warning">Low stock: {lowStockCount}</div>
        <div className="stat-chip warning">Expiring {'<='} 30 days: {expiringSoonCount}</div>
      </div>

      <form onSubmit={onSearch} className="form-row" style={{ marginTop: 10 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search medicine name / batch"
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'ALL' | MedicineApprovalStatus)}>
          <option value="ALL">All status</option>
          <option value="PENDING">Pending</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <button type="submit" className="btn-secondary">Search</button>
      </form>

      {canManage && (
        <div className="action-row" style={{ marginTop: 12 }}>
          {!showForm ? (
            <button
              type="button"
              onClick={() => {
                setShowForm(true);
                setEditingId(null);
                setForm(initialForm);
                setFieldErrors({});
                setError(null);
                setSuccess(null);
              }}
            >
              Submit New Medicine
            </button>
          ) : (
            <button type="button" className="btn-secondary" onClick={onCancelEdit}>
              Cancel
            </button>
          )}
        </div>
      )}

      {canManage && showForm && (
        <form onSubmit={onSubmit} className="form-grid" style={{ marginTop: 14 }}>
          <div className="section-head">
            <h3>{editingId ? 'Update Medicine' : 'Submit Medicine for Approval'}</h3>
            {!editingId && <p className="muted">This request will appear on the doctor inventory page for confirmation.</p>}
          </div>

          <div className="inventory-grid">
            <div className="field-block">
              <input
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="Medicine name"
                className={fieldErrors.name ? 'field-invalid' : undefined}
                required
              />
              {fieldErrors.name && <small className="field-helper">Medicine name is required.</small>}
            </div>

            <div className="field-block">
              <input
                value={form.batchNumber}
                onChange={(e) => updateField('batchNumber', e.target.value)}
                placeholder="Batch number"
                className={fieldErrors.batchNumber ? 'field-invalid' : undefined}
                required
              />
              {fieldErrors.batchNumber && <small className="field-helper">Batch number is required.</small>}
            </div>

            <div className="field-block">
              <input
                type="number"
                min={0}
                value={form.quantity}
                onChange={(e) => updateField('quantity', Number(e.target.value) || 0)}
                placeholder="Quantity"
                className={fieldErrors.quantity ? 'field-invalid' : undefined}
                required
              />
              {fieldErrors.quantity && <small className="field-helper">Quantity must be 0 or higher.</small>}
            </div>

            <div className="field-block">
              <input
                type="date"
                value={form.expiryDate}
                onChange={(e) => updateField('expiryDate', e.target.value)}
                className={fieldErrors.expiryDate ? 'field-invalid' : undefined}
                required
              />
              {fieldErrors.expiryDate && <small className="field-helper">Expiry date is required.</small>}
            </div>

            <div className="field-block">
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.price}
                onChange={(e) => updateField('price', Number(e.target.value) || 0)}
                placeholder="Price"
                className={fieldErrors.price ? 'field-invalid' : undefined}
                required
              />
              {fieldErrors.price && <small className="field-helper">Price must be 0 or higher.</small>}
            </div>
          </div>

          <div className="action-row">
            <button type="submit" disabled={saving}>{saving ? 'Saving...' : editingId ? 'Update/Save' : 'Submit Request'}</button>
            <button type="button" className="btn-secondary" onClick={onCancelEdit}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {canApprove && pendingMedicines.length > 0 && (
        <section className="card users-subcard" style={{ marginTop: 14 }}>
          <div className="section-head">
            <h3>Pending Medicine Requests</h3>
            <p className="muted">Review pharmacist submissions and confirm them to make them available everywhere else.</p>
          </div>

          <div className="mobile-cards" style={{ display: 'grid' }}>
            {pendingMedicines.map((medicine) => (
              <article key={`pending-${medicine.medicineId}`} className="mobile-card">
                <h4>{medicine.name}</h4>
                <dl className="kv">
                  <div>
                    <dt>Batch</dt>
                    <dd>{medicine.batchNumber}</dd>
                  </div>
                  <div>
                    <dt>Stock</dt>
                    <dd>{medicine.quantity}</dd>
                  </div>
                  <div>
                    <dt>Expiry</dt>
                    <dd>{toDateInput(medicine.expiryDate) || '-'}</dd>
                  </div>
                  <div>
                    <dt>Price</dt>
                    <dd>RM {formatMoney(medicine.price)}</dd>
                  </div>
                  <div>
                    <dt>Requested By</dt>
                    <dd>{medicine.requestedByUsername || '-'}</dd>
                  </div>
                  {medicine.rejectionReason && (
                    <div>
                      <dt>Reason</dt>
                      <dd>{medicine.rejectionReason}</dd>
                    </div>
                  )}
                </dl>
                <div className="action-row" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    disabled={approvingId === medicine.medicineId}
                    onClick={() => void onApprove(medicine.medicineId)}
                  >
                    {approvingId === medicine.medicineId ? 'Approving...' : 'Confirm Medicine'}
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={rejectingId === medicine.medicineId}
                    onClick={() => void onReject(medicine.medicineId)}
                  >
                    {rejectingId === medicine.medicineId ? 'Rejecting...' : 'Reject Medicine'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {error && <p className="error">{error}</p>}
      {success && <p className="muted" style={{ color: 'var(--primary)' }}>{success}</p>}
      {loading && <p className="muted">Loading...</p>}

      <div className="table-wrap">
        <table className="data-table inventory-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Batch</th>
              <th>Status</th>
              <th>Stock</th>
              <th>Expiry</th>
              <th>Price (RM)</th>
              <th>Approval</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {medicines.map((medicine) => (
              <tr key={medicine.medicineId}>
                <td className="inventory-cell-text" title={medicine.name}>{medicine.name}</td>
                <td className="inventory-cell-text" title={medicine.batchNumber}>{medicine.batchNumber}</td>
                <td>
                  <span className={approvalClass(medicine.approvalStatus)}>{approvalLabel(medicine.approvalStatus)}</span>
                </td>
                <td>
                  <span className={stockClass(medicine.quantity)}>{medicine.quantity}</span>
                </td>
                <td>
                  <span className={expiryClass(medicine.expiryDate)}>{toDateInput(medicine.expiryDate) || '-'}</span>
                </td>
                <td>{formatMoney(medicine.price)}</td>
                <td>
                  <div className="inventory-approval-cell">
                    <span>{medicine.approvalStatus === 'APPROVED' ? 'Approved' : medicine.approvalStatus === 'REJECTED' ? 'Rejected' : 'Pending'}</span>
                    {medicine.approvalStatus === 'REJECTED' && (
                      <small
                        className="inventory-approval-note"
                        title={
                          medicine.rejectionReason
                            ? `Rejected by doctor${medicine.rejectedByUsername ? ` (${medicine.rejectedByUsername})` : ''}: ${medicine.rejectionReason}`
                            : `Rejected by doctor${medicine.rejectedByUsername ? ` (${medicine.rejectedByUsername})` : ''}`
                        }
                      >
                        {medicine.rejectionReason
                          ? `Rejected by doctor: ${medicine.rejectionReason}`
                          : 'Rejected by doctor'}
                      </small>
                    )}
                  </div>
                </td>
                <td>
                  {canApprove && medicine.approvalStatus === 'PENDING' ? (
                    <div className="action-row inventory-action-row">
                      <button
                        type="button"
                        className="inventory-action-btn"
                        disabled={approvingId === medicine.medicineId}
                        onClick={() => void onApprove(medicine.medicineId)}
                      >
                        {approvingId === medicine.medicineId ? 'Approving...' : 'Confirm'}
                      </button>
                      <button
                        type="button"
                        className="btn-danger inventory-action-btn"
                        disabled={rejectingId === medicine.medicineId}
                        onClick={() => void onReject(medicine.medicineId)}
                      >
                        {rejectingId === medicine.medicineId ? 'Rejecting...' : 'Reject'}
                      </button>
                    </div>
                  ) : canManage && medicine.approvalStatus === 'REJECTED' ? (
                    <div className="action-row inventory-action-row">
                      <button type="button" className="btn-secondary inventory-action-btn" onClick={() => onEdit(medicine)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="inventory-action-btn"
                        disabled={resubmittingId === medicine.medicineId}
                        onClick={() => void onResubmit(medicine.medicineId)}
                      >
                        {resubmittingId === medicine.medicineId ? 'Resubmitting...' : 'Resubmit'}
                      </button>
                    </div>
                  ) : canManage ? (
                    <div className="action-row inventory-action-row">
                      <button type="button" className="btn-secondary inventory-action-btn" onClick={() => onEdit(medicine)}>
                        Edit
                      </button>
                      {medicine.approvalStatus !== 'REJECTED' && (
                        <button type="button" className="btn-danger inventory-action-btn" onClick={() => onDelete(medicine.medicineId)}>
                          Delete
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="muted">View only</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mobile-cards">
        {medicines.map((medicine) => (
          <article key={medicine.medicineId} className="mobile-card">
            <h4>{medicine.name}</h4>
            <dl className="kv">
              <div>
                <dt>Batch</dt>
                <dd>{medicine.batchNumber}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd><span className={approvalClass(medicine.approvalStatus)}>{approvalLabel(medicine.approvalStatus)}</span></dd>
              </div>
              <div>
                <dt>Stock</dt>
                <dd><span className={stockClass(medicine.quantity)}>{medicine.quantity}</span></dd>
              </div>
              <div>
                <dt>Expiry</dt>
                <dd><span className={expiryClass(medicine.expiryDate)}>{toDateInput(medicine.expiryDate) || '-'}</span></dd>
              </div>
              <div>
                <dt>Price</dt>
                <dd>RM {formatMoney(medicine.price)}</dd>
              </div>
              {medicine.approvalStatus === 'REJECTED' && (
                <div>
                  <dt>Rejected</dt>
                  <dd>{medicine.rejectedByUsername ? `Rejected by doctor ${medicine.rejectedByUsername}` : 'Rejected by doctor'}</dd>
                </div>
              )}
              {medicine.rejectionReason && (
                <div>
                  <dt>Reason</dt>
                  <dd>{medicine.rejectionReason}</dd>
                </div>
              )}
            </dl>
            {canApprove && medicine.approvalStatus === 'PENDING' ? (
              <div className="action-row" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  disabled={approvingId === medicine.medicineId}
                  onClick={() => void onApprove(medicine.medicineId)}
                >
                  {approvingId === medicine.medicineId ? 'Approving...' : 'Confirm Medicine'}
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={rejectingId === medicine.medicineId}
                  onClick={() => void onReject(medicine.medicineId)}
                >
                  {rejectingId === medicine.medicineId ? 'Rejecting...' : 'Reject Medicine'}
                </button>
              </div>
            ) : canManage && medicine.approvalStatus === 'REJECTED' ? (
              <div className="action-row" style={{ marginTop: 10 }}>
                <button type="button" className="btn-secondary" onClick={() => onEdit(medicine)}>
                  Edit
                </button>
                <button
                  type="button"
                  disabled={resubmittingId === medicine.medicineId}
                  onClick={() => void onResubmit(medicine.medicineId)}
                >
                  {resubmittingId === medicine.medicineId ? 'Resubmitting...' : 'Resubmit'}
                </button>
              </div>
            ) : canManage ? (
              <div className="action-row" style={{ marginTop: 10 }}>
                <button type="button" className="btn-secondary" onClick={() => onEdit(medicine)}>
                  Edit
                </button>
                {medicine.approvalStatus !== 'REJECTED' && (
                  <button type="button" className="btn-danger" onClick={() => onDelete(medicine.medicineId)}>
                    Delete
                  </button>
                )}
              </div>
            ) : (
              <p className="muted" style={{ marginTop: 10 }}>View only</p>
            )}
          </article>
        ))}
      </div>

      {!loading && medicines.length === 0 && <p className="muted">No medicine records found.</p>}
    </section>
  );
};
