import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';
import { subscribeInAppDataSync } from '../lib/sync';
import { useAuth } from '../context/AuthContext';

type MedicineApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
type InventoryCategory = 'MEDICINE' | 'SUPPLEMENT' | 'VITAMIN' | 'CONTROLLED_MEDICINE';
type StockUnit = 'tablet' | 'capsule' | 'bottle' | 'tube' | 'sachet' | 'pack' | 'box';
type ExpiryFilter = 'ALL' | 'VALID' | 'NEAR_EXPIRY' | 'EXPIRED';
type InventoryTab = 'ITEMS' | 'MOVEMENT';
type MovementDateFilter = 'ALL' | 'TODAY' | '7_DAYS';

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
  stockUnit: StockUnit;
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
  stockUnit: StockUnit;
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
  stockUnit: 'tablet',
  quantity: 0,
  expiryDate: '',
  price: 0,
};

const categoryOptions: InventoryCategory[] = ['MEDICINE', 'SUPPLEMENT', 'VITAMIN', 'CONTROLLED_MEDICINE'];
const stockUnitOptions: StockUnit[] = ['tablet', 'capsule', 'bottle', 'tube', 'sachet', 'pack', 'box'];
const inventoryPageSize = 10;
const pendingRequestPreviewSize = 5;

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

const formatStockUnit = (unit: StockUnit | string | null | undefined, qty?: number) => {
  const normalized = unit || 'unit';
  return qty === 1 ? normalized : `${normalized}s`;
};

const formatStock = (medicine: Pick<Medicine, 'quantity' | 'stockUnit'>) => {
  return `${medicine.quantity} ${formatStockUnit(medicine.stockUnit, medicine.quantity)}`;
};

const stockInfo = (qty: number, unit: StockUnit) => {
  const stockLabel = formatStockUnit(unit, qty);
  if (qty <= 0) return { label: 'Out of Stock', className: 'status-badge status-critical' };
  if (qty <= 10) return { label: `Low Stock (${qty} ${stockLabel})`, className: 'status-badge status-warning' };
  return { label: `${qty} ${stockLabel} in stock`, className: 'status-badge status-good' };
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
  const [showExpired, setShowExpired] = useState(false);
  const [activeTab, setActiveTab] = useState<InventoryTab>('ITEMS');
  const [inventoryPage, setInventoryPage] = useState(1);
  const [movementTypeFilter, setMovementTypeFilter] = useState('ALL');
  const [movementDateFilter, setMovementDateFilter] = useState<MovementDateFilter>('ALL');
  const [form, setForm] = useState<MedicineForm>(initialForm);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [resubmittingId, setResubmittingId] = useState<number | null>(null);
  const [detailMedicine, setDetailMedicine] = useState<Medicine | null>(null);
  const [rejectMedicine, setRejectMedicine] = useState<Medicine | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [openActionMenuId, setOpenActionMenuId] = useState<number | null>(null);
  const [showAllPendingRequests, setShowAllPendingRequests] = useState(false);
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

  useEffect(() => {
    setInventoryPage(1);
  }, [categoryFilter, expiryFilter, lowStockOnly, medicines, query, showExpired, statusFilter]);

  useEffect(() => {
    if (!openActionMenuId) return undefined;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.inventory-action-menu')) return;
      setOpenActionMenuId(null);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openActionMenuId]);

  useEffect(() => {
    if (!detailMedicine && !rejectMedicine && !openActionMenuId) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenActionMenuId(null);
      setDetailMedicine(null);
      if (!rejectingId) closeRejectModal();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [detailMedicine, openActionMenuId, rejectMedicine, rejectingId]);

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
      stockUnit: medicine.stockUnit ?? 'tablet',
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

  const openRejectModal = (medicine: Medicine) => {
    if (!canApprove) return;
    setRejectMedicine(medicine);
    setRejectionReason('');
    setError(null);
    setSuccess(null);
  };

  const closeRejectModal = () => {
    if (rejectingId) return;
    setRejectMedicine(null);
    setRejectionReason('');
  };

  const onReject = async () => {
    if (!canApprove || !rejectMedicine) return;
    setRejectingId(rejectMedicine.medicineId);
    setError(null);
    setSuccess(null);
    try {
      const response = await api.patch(`/medicine/${rejectMedicine.medicineId}/reject`, {
        rejectionReason: rejectionReason.trim() || undefined,
      });
      const data = response.data as { message?: string };
      setSuccess(data.message || 'Inventory item rejected.');
      setRejectMedicine(null);
      setRejectionReason('');
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
  const visiblePendingMedicines = useMemo(
    () => (showAllPendingRequests ? pendingMedicines : pendingMedicines.slice(0, pendingRequestPreviewSize)),
    [pendingMedicines, showAllPendingRequests],
  );
  const approvedMedicines = useMemo(() => medicines.filter((m) => m.approvalStatus === 'APPROVED'), [medicines]);
  const rejectedMedicines = useMemo(() => medicines.filter((m) => m.approvalStatus === 'REJECTED'), [medicines]);
  const visibleInventoryMedicines = useMemo(() => {
    const base = canApprove ? medicines.filter((m) => m.approvalStatus !== 'PENDING') : medicines;
    if (showExpired || expiryFilter === 'EXPIRED') return base;
    return base.filter((m) => expiryInfo(m.expiryDate).status !== 'EXPIRED');
  }, [canApprove, expiryFilter, medicines, showExpired]);
  const inventoryPageCount = Math.max(1, Math.ceil(visibleInventoryMedicines.length / inventoryPageSize));
  const currentInventoryPage = Math.min(inventoryPage, inventoryPageCount);
  const paginatedInventoryMedicines = useMemo(() => {
    const start = (currentInventoryPage - 1) * inventoryPageSize;
    return visibleInventoryMedicines.slice(start, start + inventoryPageSize);
  }, [currentInventoryPage, visibleInventoryMedicines]);
  const movementTypeOptions = useMemo(() => Array.from(new Set(history.map((log) => log.actionType))).sort(), [history]);
  const filteredHistory = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    return history.filter((log) => {
      const matchesType = movementTypeFilter === 'ALL' || log.actionType === movementTypeFilter;
      const createdAt = new Date(log.createdAt);
      const matchesDate =
        movementDateFilter === 'ALL'
          || (movementDateFilter === 'TODAY' && createdAt >= today)
          || (movementDateFilter === '7_DAYS' && createdAt >= sevenDaysAgo);
      return matchesType && matchesDate;
    });
  }, [history, movementDateFilter, movementTypeFilter]);
  const lowStockCount = useMemo(() => approvedMedicines.filter((m) => m.quantity <= 10).length, [approvedMedicines]);
  const expiringSoonCount = useMemo(() => approvedMedicines.filter((m) => expiryInfo(m.expiryDate).status === 'NEAR_EXPIRY').length, [approvedMedicines]);

  const renderActions = (medicine: Medicine, compact = false) => {
    if (canApprove && medicine.approvalStatus === 'PENDING') {
      return (
        <div className="action-row inventory-action-row">
          <button type="button" className="inventory-action-btn" disabled={approvingId === medicine.medicineId} onClick={() => void onApprove(medicine.medicineId)}>
            {approvingId === medicine.medicineId ? 'Approving...' : compact ? 'Confirm' : 'Confirm Medicine'}
          </button>
          <button type="button" className="btn-danger inventory-action-btn" disabled={rejectingId === medicine.medicineId} onClick={() => openRejectModal(medicine)}>
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

  const renderActionMenu = (medicine: Medicine) => {
    const isRejected = medicine.approvalStatus === 'REJECTED';
    const closeMenu = () => setOpenActionMenuId(null);
    return (
      <details
        className="inventory-action-menu"
        open={openActionMenuId === medicine.medicineId}
        onToggle={(event) => {
          if (event.currentTarget.open) {
            setOpenActionMenuId(medicine.medicineId);
          } else if (openActionMenuId === medicine.medicineId) {
            setOpenActionMenuId(null);
          }
        }}
      >
        <summary aria-label={`Open actions for ${medicine.name}`}>...</summary>
        <div>
          <button type="button" onClick={() => { closeMenu(); setDetailMedicine(medicine); }}>View Details</button>
          {canManage && (
            <button type="button" onClick={() => { closeMenu(); onEdit(medicine); }}>Edit</button>
          )}
          {canManage && isRejected && (
            <button type="button" disabled={resubmittingId === medicine.medicineId} onClick={() => { closeMenu(); void onResubmit(medicine.medicineId); }}>
              {resubmittingId === medicine.medicineId ? 'Resubmitting...' : 'Resubmit'}
            </button>
          )}
          {canManage && !isRejected && (
            <button type="button" className="danger" onClick={() => { closeMenu(); onDelete(medicine.medicineId); }}>Delete</button>
          )}
        </div>
      </details>
    );
  };

  const logTone = (log: InventoryLog) => {
    const action = log.actionType.toUpperCase();
    if (action.includes('REJECT') || action.includes('DELETE') || log.quantityChange < 0) return 'critical';
    if (action.includes('EDIT') || action.includes('UPDATE')) return 'info';
    if (action.includes('PENDING') || action.includes('SUBMIT')) return 'warning';
    if (action.includes('APPROVE') || action.includes('ADD') || log.quantityChange > 0) return 'good';
    return 'neutral';
  };

  const logIcon = (log: InventoryLog) => {
    const tone = logTone(log);
    if (tone === 'critical') return '-';
    if (tone === 'warning') return '!';
    if (tone === 'info') return 'i';
    if (tone === 'good') return '+';
    return '0';
  };

  const relativeTime = (isoDate: string) => {
    const diffMs = Date.now() - new Date(isoDate).getTime();
    if (!Number.isFinite(diffMs)) return new Date(isoDate).toLocaleString();
    const minutes = Math.round(diffMs / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} mins ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} hours ago`;
    const days = Math.round(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    return new Date(isoDate).toLocaleString();
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

      <nav className="inventory-tabs" aria-label="Inventory sections">
        <button type="button" className={activeTab === 'ITEMS' ? 'is-active' : undefined} onClick={() => setActiveTab('ITEMS')}>
          Inventory Items
        </button>
        <button type="button" className={activeTab === 'MOVEMENT' ? 'is-active' : undefined} onClick={() => setActiveTab('MOVEMENT')}>
          Stock Movement
        </button>
      </nav>

      {error && <p className="error">{error}</p>}
      {success && <p className="success-text">{success}</p>}
      {loading && <p className="muted">Loading inventory...</p>}

      {activeTab === 'ITEMS' && (
        <>
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
              <label className="inventory-check-filter">
                <input type="checkbox" checked={showExpired} onChange={(e) => setShowExpired(e.target.checked)} />
                Show expired
              </label>
              <button type="submit" className="btn-secondary">Search</button>
            </form>
          </section>

          {canApprove && (
            <section className="card inventory-approval-section">
              <div className="section-head compact-section-head">
                <div>
                  <h3>Pending Inventory Requests</h3>
                  <p className="muted">Review pharmacist submissions before they enter active stock.</p>
                </div>
              </div>
              {pendingMedicines.length > 0 ? (
                <>
                  <div className="table-wrap inventory-pending-table-wrap">
                    <table className="data-table inventory-pending-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Category</th>
                          <th>Batch</th>
                          <th>Stock</th>
                          <th>Expiry</th>
                          <th>Price Per Unit</th>
                          <th>Requested By</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visiblePendingMedicines.map((medicine) => {
                          const expiry = expiryInfo(medicine.expiryDate);
                          const requester = medicine.requestedByUsername || '-';
                          return (
                            <tr key={`pending-row-${medicine.medicineId}`}>
                              <td title={medicine.name}>
                                <div className="inventory-name-cell">
                                  <strong>{medicine.name}</strong>
                                  <small title={medicine.companyName || medicine.brand || ''}>{medicine.companyName || medicine.brand || 'Pending pharmacist request'}</small>
                                </div>
                              </td>
                              <td title={categoryLabel(medicine.category)}>{categoryLabel(medicine.category)}</td>
                              <td title={medicine.batchNumber}>{medicine.batchNumber}</td>
                              <td title={formatStock(medicine)}>{formatStock(medicine)}</td>
                              <td title={expiry.helper || expiry.label}>{expiry.label}</td>
                              <td title={`RM ${formatMoney(medicine.price)} per ${medicine.stockUnit}`}>RM {formatMoney(medicine.price)} / {medicine.stockUnit}</td>
                              <td title={requester}>{requester}</td>
                              <td>
                                <div className="inventory-pending-actions">
                                  <button type="button" className="inventory-details-link" onClick={() => setDetailMedicine(medicine)}>View Details</button>
                                  {renderActions(medicine, true)}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="mobile-cards inventory-pending-mobile-list">
                    {visiblePendingMedicines.map((medicine) => {
                      const expiry = expiryInfo(medicine.expiryDate);
                      const requester = medicine.requestedByUsername || '-';
                      return (
                        <article key={`pending-mobile-${medicine.medicineId}`} className="mobile-card inventory-approval-card">
                          <div className="inventory-card-head">
                            <div>
                              <h4 title={medicine.name}>{medicine.name}</h4>
                              <p title={medicine.companyName || medicine.brand || ''}>{medicine.companyName || medicine.brand || 'Pending pharmacist request'}</p>
                            </div>
                            <span className={approvalClass(medicine.approvalStatus)}>{approvalLabel(medicine.approvalStatus)}</span>
                          </div>
                          <div className="inventory-request-meta-grid">
                            <span title={categoryLabel(medicine.category)}><b>Category</b>{categoryLabel(medicine.category)}</span>
                            <span title={medicine.batchNumber}><b>Batch</b>{medicine.batchNumber}</span>
                            <span title={formatStock(medicine)}><b>Stock</b>{formatStock(medicine)}</span>
                            <span title={expiry.helper || expiry.label}><b>Expiry</b>{expiry.label}</span>
                            <span title={`RM ${formatMoney(medicine.price)} per ${medicine.stockUnit}`}><b>Price</b>RM {formatMoney(medicine.price)} / {medicine.stockUnit}</span>
                            <span title={requester}><b>Requested By</b>{requester}</span>
                          </div>
                          <div className="inventory-pending-actions">
                            <button type="button" className="inventory-details-link" onClick={() => setDetailMedicine(medicine)}>View Details</button>
                            {renderActions(medicine, true)}
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  {pendingMedicines.length > pendingRequestPreviewSize && (
                    <div className="inventory-pending-footer">
                      <button type="button" className="btn-secondary" onClick={() => setShowAllPendingRequests((value) => !value)}>
                        {showAllPendingRequests ? 'Show Fewer Pending Requests' : `View All Pending Requests (${pendingMedicines.length})`}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <p className="muted">No pending requests.</p>
              )}
            </section>
          )}

          <section className="card inventory-table-card">
            <div className="section-head compact-section-head">
              <div>
                <h3>Inventory Table</h3>
                <p className="muted">Showing {paginatedInventoryMedicines.length} of {visibleInventoryMedicines.length} records.</p>
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
                    <th>Price Per Unit</th>
                    <th>Approval</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedInventoryMedicines.map((medicine) => {
                    const stock = stockInfo(medicine.quantity, medicine.stockUnit);
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
                        <td className="inventory-price-cell">RM {formatMoney(medicine.price)} / {medicine.stockUnit}</td>
                        <td>
                          <div className="inventory-approval-cell">
                            <span className={approvalClass(medicine.approvalStatus)}>{approvalLabel(medicine.approvalStatus)}</span>
                            {medicine.approvalStatus === 'REJECTED' && medicine.rejectionReason && (
                              <small className="inventory-approval-note" title={`Rejected: ${medicine.rejectionReason}`}>Rejected: {medicine.rejectionReason}</small>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="inventory-table-actions">{renderActionMenu(medicine)}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mobile-cards inventory-mobile-list">
              {paginatedInventoryMedicines.map((medicine) => {
                const stock = stockInfo(medicine.quantity, medicine.stockUnit);
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
                      <strong>RM {formatMoney(medicine.price)} / {medicine.stockUnit}</strong>
                    </div>
                    <details className="inventory-more-details">
                      <summary>Quick details</summary>
                      <dl className="inventory-detail-grid">
                        <div><dt>Brand</dt><dd>{medicine.brand || '-'}</dd></div>
                        <div><dt>Content</dt><dd>{medicine.content || '-'}</dd></div>
                        <div><dt>Packaging</dt><dd>{medicine.packaging || '-'}</dd></div>
                        <div><dt>Stock Unit</dt><dd>{medicine.stockUnit}</dd></div>
                        <div><dt>Supplier</dt><dd>{medicine.companyName || '-'}</dd></div>
                        <div><dt>Requested By</dt><dd>{medicine.requestedByUsername || '-'}</dd></div>
                        <div><dt>Created</dt><dd>{medicine.createdAt ? new Date(medicine.createdAt).toLocaleString() : '-'}</dd></div>
                      </dl>
                    </details>
                    <button type="button" className="inventory-details-link" onClick={() => setDetailMedicine(medicine)}>View Details</button>
                    <div className="inventory-card-actions">{renderActions(medicine, true)}</div>
                  </article>
                );
              })}
            </div>

            <div className="inventory-pagination">
              <button type="button" className="btn-secondary" disabled={currentInventoryPage <= 1} onClick={() => setInventoryPage((page) => Math.max(1, page - 1))}>Previous</button>
              <span>Page {currentInventoryPage} of {inventoryPageCount}</span>
              <button type="button" className="btn-secondary" disabled={currentInventoryPage >= inventoryPageCount} onClick={() => setInventoryPage((page) => Math.min(inventoryPageCount, page + 1))}>Next</button>
            </div>

            {!loading && visibleInventoryMedicines.length === 0 && <p className="muted">No inventory records found.</p>}
          </section>
        </>
      )}

      {activeTab === 'MOVEMENT' && (
        <section className="card inventory-history-card">
          <div className="section-head compact-section-head">
            <div>
              <h3>Stock Movement</h3>
              <p className="muted">Audit stock changes, approvals, rejections, edits, deletions, and dispensing deductions.</p>
            </div>
          </div>
          <div className="inventory-movement-filters">
            <select value={movementTypeFilter} onChange={(e) => setMovementTypeFilter(e.target.value)}>
              <option value="ALL">All movement types</option>
              {movementTypeOptions.map((type) => <option key={type} value={type}>{logLabel(type)}</option>)}
            </select>
            <select value={movementDateFilter} onChange={(e) => setMovementDateFilter(e.target.value as MovementDateFilter)}>
              <option value="ALL">All dates</option>
              <option value="TODAY">Today</option>
              <option value="7_DAYS">Last 7 days</option>
            </select>
          </div>
          <div className="inventory-history-list">
            {filteredHistory.map((log) => (
              <article key={log.logId} className="inventory-history-item">
                <span className={`inventory-activity-icon inventory-activity-${logTone(log)}`}>{logIcon(log)}</span>
                <div>
                  <strong>{logLabel(log.actionType)}</strong>
                  <span title={log.itemName}>
                    {log.itemName} &bull; Qty {Math.abs(log.quantityChange)}
                    {log.relatedPrescriptionId ? ` &bull; Rx #${log.relatedPrescriptionId}` : ''}
                  </span>
                </div>
                <small title={new Date(log.createdAt).toLocaleString()}>{log.performedByUsername || '-'} &bull; {relativeTime(log.createdAt)}</small>
              </article>
            ))}
            {filteredHistory.length === 0 && <p className="muted">No stock movement found for this filter.</p>}
          </div>
        </section>
      )}

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
                    <label className="field-block"><span>Packaging</span><input value={form.packaging} onChange={(e) => updateField('packaging', e.target.value)} placeholder="10 tablets/strip, 60ml bottle" /></label>
                    <label className="field-block inventory-form-wide"><span>Supplier</span><input value={form.companyName} onChange={(e) => updateField('companyName', e.target.value)} placeholder="Kotra Pharma" /></label>
                  </div>
                </section>

                <section className="inventory-form-section">
                  <h4>Inventory</h4>
                  <div className="inventory-form-grid">
                    <label className="field-block"><span>Batch</span><input value={form.batchNumber} onChange={(e) => updateField('batchNumber', e.target.value)} className={fieldErrors.batchNumber ? 'field-invalid' : undefined} required /></label>
                    <label className="field-block">
                      <span>Stock Unit</span>
                      <select value={form.stockUnit} onChange={(e) => updateField('stockUnit', e.target.value as StockUnit)}>
                        {stockUnitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                      </select>
                    </label>
                    <label className="field-block"><span>Stock Quantity</span><input type="number" min={0} value={form.quantity} onChange={(e) => updateField('quantity', Number(e.target.value) || 0)} className={fieldErrors.quantity ? 'field-invalid' : undefined} required /></label>
                    <label className="field-block"><span>Expiry</span><input type="date" value={form.expiryDate} onChange={(e) => updateField('expiryDate', e.target.value)} className={fieldErrors.expiryDate ? 'field-invalid' : undefined} required /></label>
                    <label className="field-block"><span>Price Per Unit</span><input type="number" min={0} step="0.01" value={form.price} onChange={(e) => updateField('price', Number(e.target.value) || 0)} className={fieldErrors.price ? 'field-invalid' : undefined} required /></label>
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

      {detailMedicine && (
        <div className="inventory-modal-layer" role="presentation">
          <button type="button" className="inventory-modal-backdrop" aria-label="Close inventory details" onClick={() => setDetailMedicine(null)} />
          <section className="inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-detail-title">
            <div className="inventory-modal-head">
              <div>
                <h3 id="inventory-detail-title" title={detailMedicine.name}>{detailMedicine.name}</h3>
                <p className="muted">{categoryLabel(detailMedicine.category)} &bull; Batch {detailMedicine.batchNumber}</p>
              </div>
              <button type="button" className="patient-drawer-close" onClick={() => setDetailMedicine(null)}>X</button>
            </div>
            <div className="inventory-modal-body">
              <section className="inventory-detail-section">
                <h4>Product Info</h4>
                <dl className="inventory-detail-modal-grid">
                  <div><dt>Name</dt><dd title={detailMedicine.name}>{detailMedicine.name}</dd></div>
                  <div><dt>Category</dt><dd>{categoryLabel(detailMedicine.category)}</dd></div>
                  <div><dt>Brand</dt><dd title={detailMedicine.brand || '-'}>{detailMedicine.brand || '-'}</dd></div>
                  <div><dt>Content</dt><dd title={detailMedicine.content || '-'}>{detailMedicine.content || '-'}</dd></div>
                  <div><dt>Packaging</dt><dd title={detailMedicine.packaging || '-'}>{detailMedicine.packaging || '-'}</dd></div>
                  <div><dt>Supplier</dt><dd title={detailMedicine.companyName || '-'}>{detailMedicine.companyName || '-'}</dd></div>
                </dl>
              </section>
              <section className="inventory-detail-section">
                <h4>Inventory Info</h4>
                <dl className="inventory-detail-modal-grid">
                  <div><dt>Batch</dt><dd title={detailMedicine.batchNumber}>{detailMedicine.batchNumber}</dd></div>
                  <div><dt>Stock</dt><dd>{formatStock(detailMedicine)}</dd></div>
                  <div><dt>Stock Unit</dt><dd>{detailMedicine.stockUnit}</dd></div>
                  <div><dt>Expiry</dt><dd>{toDateInput(detailMedicine.expiryDate) || '-'}</dd></div>
                  <div><dt>Price Per Unit</dt><dd>RM {formatMoney(detailMedicine.price)} / {detailMedicine.stockUnit}</dd></div>
                  <div><dt>Approval</dt><dd><span className={approvalClass(detailMedicine.approvalStatus)}>{approvalLabel(detailMedicine.approvalStatus)}</span></dd></div>
                </dl>
              </section>
              <section className="inventory-detail-section">
                <h4>Workflow</h4>
                <dl className="inventory-detail-modal-grid">
                  <div><dt>Requested By</dt><dd>{detailMedicine.requestedByUsername || '-'}</dd></div>
                  <div><dt>Created</dt><dd>{detailMedicine.createdAt ? new Date(detailMedicine.createdAt).toLocaleString() : '-'}</dd></div>
                  <div><dt>Approved By</dt><dd>{detailMedicine.approvedByUsername || '-'}</dd></div>
                  <div><dt>Approved At</dt><dd>{detailMedicine.approvedAt ? new Date(detailMedicine.approvedAt).toLocaleString() : '-'}</dd></div>
                  <div><dt>Rejected By</dt><dd>{detailMedicine.rejectedByUsername || '-'}</dd></div>
                  <div><dt>Rejected At</dt><dd>{detailMedicine.rejectedAt ? new Date(detailMedicine.rejectedAt).toLocaleString() : '-'}</dd></div>
                </dl>
              </section>
              {detailMedicine.rejectionReason && (
                <div className="inventory-rejection-panel">
                  <strong>Rejection notes</strong>
                  <p>{detailMedicine.rejectionReason}</p>
                </div>
              )}
            </div>
            <div className="inventory-modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setDetailMedicine(null)}>Close</button>
            </div>
          </section>
        </div>
      )}

      {rejectMedicine && (
        <div className="inventory-modal-layer" role="presentation">
          <button type="button" className="inventory-modal-backdrop" aria-label="Cancel rejection" onClick={closeRejectModal} disabled={Boolean(rejectingId)} />
          <section className="inventory-modal inventory-reject-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-reject-title">
            <div className="inventory-modal-head">
              <div>
                <h3 id="inventory-reject-title">Reject Inventory Request</h3>
                <p className="muted" title={rejectMedicine.name}>{rejectMedicine.name}</p>
              </div>
              <button type="button" className="patient-drawer-close" onClick={closeRejectModal} disabled={Boolean(rejectingId)}>X</button>
            </div>
            <div className="inventory-modal-body">
              <label className="field-block">
                <span>Reason for rejection</span>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Example: Incorrect expiry information, missing supplier, duplicate medicine..."
                  rows={5}
                />
              </label>
              <div className="inventory-reason-chips">
                {['Duplicate medicine', 'Expired stock', 'Invalid details', 'Missing supplier', 'Incorrect packaging'].map((reason) => (
                  <button key={reason} type="button" className="btn-secondary" onClick={() => setRejectionReason(reason)}>
                    {reason}
                  </button>
                ))}
              </div>
            </div>
            <div className="inventory-modal-footer">
              <button type="button" className="btn-secondary" onClick={closeRejectModal} disabled={Boolean(rejectingId)}>Cancel</button>
              <button type="button" className="btn-danger" onClick={() => void onReject()} disabled={Boolean(rejectingId)}>
                {rejectingId ? 'Rejecting...' : 'Confirm Reject'}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
};
