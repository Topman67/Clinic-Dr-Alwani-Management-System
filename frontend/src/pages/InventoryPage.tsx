import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';
import { subscribeInAppDataSync } from '../lib/sync';
import { useAuth } from '../context/AuthContext';

type MedicineApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
type InventoryCategory = 'MEDICINE' | 'SUPPLEMENT' | 'VITAMIN' | 'CONTROLLED_MEDICINE';
type ExpiryFilter = 'ALL' | 'VALID' | 'NEAR_EXPIRY' | 'EXPIRED';

type Medicine = {
  medicineId: number;
  name: string;
  category: InventoryCategory;
  brand?: string | null;
  content?: string | null;
  packaging?: string | null;
  companyName?: string | null;
  availableForPrescription: boolean;
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
  createdAt?: string;
};

type MedicineForm = {
  name: string;
  category: InventoryCategory;
  brand: string;
  content: string;
  packaging: string;
  companyName: string;
  availableForPrescription: boolean;
  batchNumber: string;
  quantity: number;
  expiryDate: string;
  price: number;
};

type InventoryLog = {
  logId: number;
  itemName: string;
  batchNumber: string;
  quantityChange: number;
  actionType: string;
  performedByUsername?: string | null;
  relatedPrescriptionId?: number | null;
  createdAt: string;
};

const initialForm: MedicineForm = {
  name: '',
  category: 'MEDICINE',
  brand: '',
  content: '',
  packaging: '',
  companyName: '',
  availableForPrescription: true,
  batchNumber: '',
  quantity: 0,
  expiryDate: '',
  price: 0,
};

const categoryOptions: InventoryCategory[] = ['MEDICINE', 'SUPPLEMENT', 'VITAMIN', 'CONTROLLED_MEDICINE'];

const toDateInput = (isoDate: string | null | undefined) => {
  if (!isoDate) return '';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const formatMoney = (value: number | string) => {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
};

const daysUntil = (isoDate: string) => {
  const target = new Date(isoDate);
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
};

const categoryLabel = (category: InventoryCategory) => {
  if (category === 'CONTROLLED_MEDICINE') return 'Controlled';
  return category.charAt(0) + category.slice(1).toLowerCase();
};

const approvalLabel = (status: MedicineApprovalStatus) => {
  if (status === 'APPROVED') return 'Approved';
  if (status === 'REJECTED') return 'Rejected';
  return 'Pending Approval';
};

const approvalClass = (status: MedicineApprovalStatus) => {
  if (status === 'APPROVED') return 'status-badge status-good';
  if (status === 'REJECTED') return 'status-badge status-critical';
  return 'status-badge status-warning';
};

const stockInfo = (qty: number) => {
  if (qty <= 0) return { label: 'Out of Stock', className: 'status-badge status-critical' };
  if (qty <= 10) return { label: `Low Stock (${qty})`, className: 'status-badge status-warning' };
  return { label: `${qty} in stock`, className: 'status-badge status-good' };
};

const expiryInfo = (expiryDate: string) => {
  const days = daysUntil(expiryDate);
  if (days < 0) return { status: 'EXPIRED' as const, label: 'Expired', helper: toDateInput(expiryDate), className: 'status-badge status-critical' };
  if (days <= 30) return { status: 'NEAR_EXPIRY' as const, label: 'Near Expiry', helper: `Expires in ${days} days`, className: 'status-badge status-warning' };
  return { status: 'VALID' as const, label: toDateInput(expiryDate), helper: '', className: 'status-badge status-good' };
};

const logLabel = (actionType: string) => actionType.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());

export const InventoryPage = () => {
  const { role } = useAuth();
  const canManage = role === 'PHARMACIST';
  const canApprove = role === 'DOCTOR';

  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [history, setHistory] = useState<InventoryLog[]>([]);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'ALL' | InventoryCategory>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | MedicineApprovalStatus>('ALL');
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>('ALL');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [form, setForm] = useState<MedicineForm>(initialForm);
  const [drawerOpen, setDrawerOpen] = useState(false);
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

  const loadHistory = useCallback(async () => {
    try {
      const response = await api.get('/medicine/history');
      setHistory(response.data as InventoryLog[]);
    } catch {
      setHistory([]);
    }
  }, []);

  const loadMedicines = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/medicine', {
        params: {
          query,
          includePending: true,
          category: categoryFilter === 'ALL' ? undefined : categoryFilter,
          approvalStatus: statusFilter === 'ALL' ? undefined : statusFilter,
          expiryStatus: expiryFilter === 'ALL' ? undefined : expiryFilter,
          lowStock: lowStockOnly ? 'true' : undefined,
        },
      });
      setMedicines(response.data as Medicine[]);
    } catch {
      setError('Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, expiryFilter, lowStockOnly, query, statusFilter]);

  useEffect(() => {
    void loadMedicines();
    void loadHistory();
  }, [loadHistory, loadMedicines]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void loadMedicines();
      void loadHistory();
    });
  }, [loadHistory, loadMedicines]);

  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    await loadMedicines();
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

  const openCreateDrawer = () => {
    setEditingId(null);
    setForm(initialForm);
    setFieldErrors({});
    setError(null);
    setSuccess(null);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setEditingId(null);
    setForm(initialForm);
    setFieldErrors({});
    setDrawerOpen(false);
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
        setSuccess('Inventory item updated.');
      } else {
        const response = await api.post('/medicine', form);
        const data = response.data as { message?: string };
        setSuccess(data.message || 'Inventory request submitted for approval.');
      }
      closeDrawer();
      await loadMedicines();
      await loadHistory();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to save inventory item'));
    } finally {
      setSaving(false);
    }
  };

  const onEdit = (medicine: Medicine) => {
    if (!canManage) return;
    setEditingId(medicine.medicineId);
    setForm({
      name: medicine.name,
      category: medicine.category ?? 'MEDICINE',
      brand: medicine.brand ?? '',
      content: medicine.content ?? '',
      packaging: medicine.packaging ?? '',
      companyName: medicine.companyName ?? '',
      availableForPrescription: medicine.availableForPrescription ?? true,
      batchNumber: medicine.batchNumber,
      quantity: medicine.quantity,
      expiryDate: toDateInput(medicine.expiryDate),
      price: Number(medicine.price),
    });
    setFieldErrors({});
    setError(null);
    setSuccess(null);
    setDrawerOpen(true);
  };

  const onApprove = async (medicineId: number) => {
    if (!canApprove) return;
    setApprovingId(medicineId);
    setError(null);
    setSuccess(null);
    try {
      const response = await api.patch(`/medicine/${medicineId}/approve`);
      const data = response.data as { message?: string };
      setSuccess(data.message || 'Inventory item approved.');
      await loadMedicines();
      await loadHistory();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to approve inventory item'));
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
      setSuccess(data.message || 'Inventory item rejected.');
      await loadMedicines();
      await loadHistory();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to reject inventory item'));
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
      setSuccess(data.message || 'Inventory item resubmitted for review.');
      await loadMedicines();
      await loadHistory();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to resubmit inventory item'));
    } finally {
      setResubmittingId(null);
    }
  };

  const onDelete = async (medicineId: number) => {
    if (!canManage) return;
    const confirmed = window.confirm('Delete this inventory record?');
    if (!confirmed) return;
    setError(null);
    setSuccess(null);
    try {
      await api.delete(`/medicine/${medicineId}`);
      setSuccess('Inventory item deleted.');
      await loadMedicines();
      await loadHistory();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to delete inventory item'));
    }
  };

  const pendingMedicines = useMemo(() => medicines.filter((m) => m.approvalStatus === 'PENDING'), [medicines]);
  const approvedMedicines = useMemo(() => medicines.filter((m) => m.approvalStatus === 'APPROVED'), [medicines]);
  const rejectedMedicines = useMemo(() => medicines.filter((m) => m.approvalStatus === 'REJECTED'), [medicines]);
  const visibleInventoryMedicines = useMemo(
    () => (canApprove ? medicines.filter((m) => m.approvalStatus !== 'PENDING') : medicines),
    [canApprove, medicines],
  );
  const lowStockCount = useMemo(() => approvedMedicines.filter((m) => m.quantity <= 10).length, [approvedMedicines]);
  const expiringSoonCount = useMemo(() => approvedMedicines.filter((m) => expiryInfo(m.expiryDate).status === 'NEAR_EXPIRY').length, [approvedMedicines]);

  const renderActions = (medicine: Medicine, compact = false) => {
    if (canApprove && medicine.approvalStatus === 'PENDING') {
      return (
        <div className="action-row inventory-action-row">
          <button type="button" className="inventory-action-btn" disabled={approvingId === medicine.medicineId} onClick={() => void onApprove(medicine.medicineId)}>
            {approvingId === medicine.medicineId ? 'Approving...' : compact ? 'Confirm' : 'Confirm Medicine'}
          </button>
          <button type="button" className="btn-danger inventory-action-btn" disabled={rejectingId === medicine.medicineId} onClick={() => void onReject(medicine.medicineId)}>
            {rejectingId === medicine.medicineId ? 'Rejecting...' : compact ? 'Reject' : 'Reject Medicine'}
          </button>
        </div>
      );
    }

    if (canManage && medicine.approvalStatus === 'REJECTED') {
      return (
        <div className="action-row inventory-action-row">
          <button type="button" className="btn-secondary inventory-action-btn" onClick={() => onEdit(medicine)}>Edit</button>
          <button type="button" className="inventory-action-btn" disabled={resubmittingId === medicine.medicineId} onClick={() => void onResubmit(medicine.medicineId)}>
            {resubmittingId === medicine.medicineId ? 'Resubmitting...' : 'Resubmit'}
          </button>
        </div>
      );
    }

    if (canManage) {
      return (
        <div className="action-row inventory-action-row">
          <button type="button" className="btn-secondary inventory-action-btn" onClick={() => onEdit(medicine)}>Edit</button>
          {medicine.approvalStatus !== 'REJECTED' && (
            <button type="button" className="btn-danger inventory-action-btn" onClick={() => onDelete(medicine.medicineId)}>Delete</button>
          )}
        </div>
      );
    }

    return <span className="muted">View only</span>;
  };

  return (
    <section className="inventory-page">
      <div className="section-head inventory-page-head">
        <div>
          <h1>Manage Inventory</h1>
          <p className="muted">
            {canManage
              ? 'Submit medicine, supplement, and vitamin stock for doctor approval.'
              : 'Review pharmacist inventory requests and monitor approved stock.'}
          </p>
        </div>
        {canManage && <button type="button" onClick={openCreateDrawer}>+ Add Inventory Request</button>}
      </div>

      <section className="inventory-summary-grid">
        <div className="stat-chip">Approved: {approvedMedicines.length}</div>
        <div className="stat-chip warning">Pending: {pendingMedicines.length}</div>
        <div className="stat-chip" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>Rejected: {rejectedMedicines.length}</div>
        <div className="stat-chip warning">Low stock: {lowStockCount}</div>
        <div className="stat-chip warning">Expiring: {expiringSoonCount}</div>
      </section>

      <section className="card inventory-filter-card">
        <form onSubmit={onSearch} className="inventory-filter-grid">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search medicine / batch / brand / supplier" />
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value as 'ALL' | InventoryCategory)}>
            <option value="ALL">All categories</option>
            {categoryOptions.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'ALL' | MedicineApprovalStatus)}>
            <option value="ALL">All approval</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </select>
          <select value={expiryFilter} onChange={(e) => setExpiryFilter(e.target.value as ExpiryFilter)}>
            <option value="ALL">All expiry</option>
            <option value="VALID">Valid</option>
            <option value="NEAR_EXPIRY">Near expiry</option>
            <option value="EXPIRED">Expired</option>
          </select>
          <label className="inventory-check-filter">
            <input type="checkbox" checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} />
            Low stock
          </label>
          <button type="submit" className="btn-secondary">Search</button>
        </form>
      </section>

      {error && <p className="error">{error}</p>}
      {success && <p className="success-text">{success}</p>}
      {loading && <p className="muted">Loading inventory...</p>}

      {canApprove && (
        <section className="card inventory-approval-section">
          <div className="section-head compact-section-head">
            <div>
              <h3>Pending Inventory Requests</h3>
              <p className="muted">Review pharmacist submissions before they enter active stock.</p>
            </div>
          </div>
          <div className="inventory-approval-grid">
            {pendingMedicines.map((medicine) => {
              const expiry = expiryInfo(medicine.expiryDate);
              return (
                <article key={`pending-${medicine.medicineId}`} className="inventory-approval-card">
                  <div className="inventory-card-head">
                    <div>
                      <h4 title={medicine.name}>{medicine.name}</h4>
                      <p>
                        {categoryLabel(medicine.category)} &bull; Batch {medicine.batchNumber} &bull; {medicine.quantity} stock &bull; {expiry.label} &bull; RM {formatMoney(medicine.price)}
                      </p>
                    </div>
                    <span className="status-badge status-warning">Pending</span>
                  </div>
                  <p className="inventory-request-user">Requested by {medicine.requestedByUsername || '-'}</p>
                  <details className="inventory-more-details">
                    <summary>View more</summary>
                    <dl className="inventory-detail-grid">
                      <div><dt>Brand</dt><dd>{medicine.brand || '-'}</dd></div>
                      <div><dt>Content</dt><dd>{medicine.content || '-'}</dd></div>
                      <div><dt>Packaging</dt><dd>{medicine.packaging || '-'}</dd></div>
                      <div><dt>Supplier</dt><dd>{medicine.companyName || '-'}</dd></div>
                    </dl>
                  </details>
                  <div className="inventory-card-actions">{renderActions(medicine, true)}</div>
                </article>
              );
            })}
            {pendingMedicines.length === 0 && <p className="muted">No pending requests.</p>}
          </div>
        </section>
      )}

      <section className="card inventory-table-card">
        <div className="section-head compact-section-head">
          <div>
            <h3>Inventory Table</h3>
            <p className="muted">Compare stock, expiry, price, and approval status in one compact view.</p>
          </div>
        </div>

        <div className="table-wrap inventory-table-wrap">
          <table className="data-table inventory-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Batch</th>
                <th>Stock</th>
                <th>Expiry</th>
                <th>Price</th>
                <th>Approval</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleInventoryMedicines.map((medicine) => {
                const stock = stockInfo(medicine.quantity);
                const expiry = expiryInfo(medicine.expiryDate);
                return (
                  <tr key={medicine.medicineId}>
                    <td>
                      <div className="inventory-name-cell">
                        <strong title={medicine.name}>{medicine.name}</strong>
                        <small title={medicine.companyName || medicine.brand || ''}>
                          {[medicine.brand, medicine.companyName].filter(Boolean).join(' / ') || 'Inventory item'}
                        </small>
                      </div>
                    </td>
                    <td><span className="inventory-cell-text" title={categoryLabel(medicine.category)}>{categoryLabel(medicine.category)}</span></td>
                    <td><span className="inventory-cell-text" title={medicine.batchNumber}>{medicine.batchNumber}</span></td>
                    <td><span className={stock.className}>{stock.label}</span></td>
                    <td>
                      <div className="inventory-expiry-cell">
                        <span className={expiry.className}>{expiry.label}</span>
                        {expiry.helper && <small>{expiry.helper}</small>}
                      </div>
                    </td>
                    <td className="inventory-price-cell">RM {formatMoney(medicine.price)}</td>
                    <td>
                      <div className="inventory-approval-cell">
                        <span className={approvalClass(medicine.approvalStatus)}>{approvalLabel(medicine.approvalStatus)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="inventory-table-actions">{renderActions(medicine, true)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mobile-cards inventory-mobile-list">
          {visibleInventoryMedicines.map((medicine) => {
            const stock = stockInfo(medicine.quantity);
            const expiry = expiryInfo(medicine.expiryDate);
            return (
              <article key={`mobile-${medicine.medicineId}`} className="mobile-card inventory-mobile-card">
                <div className="inventory-card-head">
                  <div>
                    <h4 title={medicine.name}>{medicine.name}</h4>
                    <p>{categoryLabel(medicine.category)} &bull; Batch {medicine.batchNumber}</p>
                  </div>
                  <span className={approvalClass(medicine.approvalStatus)}>{approvalLabel(medicine.approvalStatus)}</span>
                </div>
                <div className="inventory-mobile-meta">
                  <span className={stock.className}>{stock.label}</span>
                  <span className={expiry.className}>{expiry.label}</span>
                  <strong>RM {formatMoney(medicine.price)}</strong>
                </div>
                <details className="inventory-more-details">
                  <summary>View details</summary>
                  <dl className="inventory-detail-grid">
                    <div><dt>Brand</dt><dd>{medicine.brand || '-'}</dd></div>
                    <div><dt>Content</dt><dd>{medicine.content || '-'}</dd></div>
                    <div><dt>Packaging</dt><dd>{medicine.packaging || '-'}</dd></div>
                    <div><dt>Supplier</dt><dd>{medicine.companyName || '-'}</dd></div>
                    <div><dt>Requested By</dt><dd>{medicine.requestedByUsername || '-'}</dd></div>
                    <div><dt>Created</dt><dd>{medicine.createdAt ? new Date(medicine.createdAt).toLocaleString() : '-'}</dd></div>
                  </dl>
                </details>
                <div className="inventory-card-actions">{renderActions(medicine, true)}</div>
              </article>
            );
          })}
        </div>

        {!loading && visibleInventoryMedicines.length === 0 && <p className="muted">No inventory records found.</p>}
      </section>

      <section className="card inventory-history-card">
        <div className="section-head compact-section-head">
          <div>
            <h3>Recent Stock Movement</h3>
            <p className="muted">Latest inventory activity.</p>
          </div>
        </div>
        <div className="inventory-history-list">
          {history.slice(0, 8).map((log) => (
            <article key={log.logId} className="inventory-history-item">
              <span className={log.quantityChange < 0 ? 'status-badge status-critical' : log.quantityChange > 0 ? 'status-badge status-good' : 'status-badge status-neutral'}>
                {log.quantityChange > 0 ? '+' : log.quantityChange < 0 ? '-' : '0'}
              </span>
              <div>
                <strong>{logLabel(log.actionType)}</strong>
                <span title={log.itemName}>
                  {log.itemName} &bull; Qty {Math.abs(log.quantityChange)}
                  {log.relatedPrescriptionId ? ` &bull; Rx #${log.relatedPrescriptionId}` : ''}
                </span>
              </div>
              <small>By {log.performedByUsername || '-'} &bull; {new Date(log.createdAt).toLocaleString()}</small>
            </article>
          ))}
          {history.length === 0 && <p className="muted">No stock movement recorded yet.</p>}
        </div>
      </section>

      {canManage && drawerOpen && (
        <div className="inventory-drawer-layer" role="presentation">
          <button type="button" className="patient-drawer-backdrop" aria-label="Close inventory drawer" onClick={closeDrawer} disabled={saving} />
          <aside className="inventory-drawer" role="dialog" aria-modal="true" aria-labelledby="inventory-drawer-title">
            <div className="patient-drawer-head">
              <div>
                <h3 id="inventory-drawer-title">{editingId ? 'Update Inventory Item' : 'Add Inventory Request'}</h3>
                <p className="muted">Submitted requests remain pending until a doctor confirms them.</p>
              </div>
              <button type="button" className="patient-drawer-close" onClick={closeDrawer} disabled={saving}>X</button>
            </div>
            <form onSubmit={onSubmit} className="inventory-drawer-form">
              <div className="inventory-drawer-body">
                <section className="inventory-form-section">
                  <h4>Basic Info</h4>
                  <div className="inventory-form-grid">
                    <label className="field-block">
                      <span>Name</span>
                      <input value={form.name} onChange={(e) => updateField('name', e.target.value)} className={fieldErrors.name ? 'field-invalid' : undefined} required />
                    </label>
                    <label className="field-block">
                      <span>Category</span>
                      <select value={form.category} onChange={(e) => updateField('category', e.target.value as InventoryCategory)}>
                        {categoryOptions.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}
                      </select>
                    </label>
                    <label className="field-block"><span>Brand</span><input value={form.brand} onChange={(e) => updateField('brand', e.target.value)} placeholder="Appeton" /></label>
                  </div>
                </section>

                <section className="inventory-form-section">
                  <h4>Product Details</h4>
                  <div className="inventory-form-grid">
                    <label className="field-block"><span>Content</span><input value={form.content} onChange={(e) => updateField('content', e.target.value)} placeholder="Vitamin C + Zinc" /></label>
                    <label className="field-block"><span>Packaging</span><input value={form.packaging} onChange={(e) => updateField('packaging', e.target.value)} placeholder="30 tablets" /></label>
                    <label className="field-block inventory-form-wide"><span>Supplier</span><input value={form.companyName} onChange={(e) => updateField('companyName', e.target.value)} placeholder="Kotra Pharma" /></label>
                  </div>
                </section>

                <section className="inventory-form-section">
                  <h4>Inventory</h4>
                  <div className="inventory-form-grid">
                    <label className="field-block"><span>Batch</span><input value={form.batchNumber} onChange={(e) => updateField('batchNumber', e.target.value)} className={fieldErrors.batchNumber ? 'field-invalid' : undefined} required /></label>
                    <label className="field-block"><span>Stock</span><input type="number" min={0} value={form.quantity} onChange={(e) => updateField('quantity', Number(e.target.value) || 0)} className={fieldErrors.quantity ? 'field-invalid' : undefined} required /></label>
                    <label className="field-block"><span>Expiry</span><input type="date" value={form.expiryDate} onChange={(e) => updateField('expiryDate', e.target.value)} className={fieldErrors.expiryDate ? 'field-invalid' : undefined} required /></label>
                    <label className="field-block"><span>Price</span><input type="number" min={0} step="0.01" value={form.price} onChange={(e) => updateField('price', Number(e.target.value) || 0)} className={fieldErrors.price ? 'field-invalid' : undefined} required /></label>
                  </div>
                </section>
              </div>
              <div className="inventory-drawer-footer">
                <button type="button" className="btn-secondary" onClick={closeDrawer} disabled={saving}>Cancel</button>
                <button type="submit" disabled={saving}>{saving ? 'Saving...' : editingId ? 'Update Item' : 'Submit Request'}</button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </section>
  );
};
