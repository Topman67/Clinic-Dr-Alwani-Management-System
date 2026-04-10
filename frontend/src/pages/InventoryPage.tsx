import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';

type Medicine = {
  medicineId: number;
  name: string;
  batchNumber: string;
  quantity: number;
  expiryDate: string;
  price: number | string;
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

export const InventoryPage = () => {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<MedicineForm>(initialForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMedicines = async (q = '') => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/medicine', { params: { query: q } });
      setMedicines(response.data as Medicine[]);
    } catch {
      setError('Failed to load medicine inventory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMedicines();
  }, []);

  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    await loadMedicines(query);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.expiryDate) {
      setError('Please set an expiry date.');
      return;
    }

    if (form.quantity < 0 || form.price < 0) {
      setError('Quantity and price must be zero or above.');
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await api.put(`/medicine/${editingId}`, form);
      } else {
        await api.post('/medicine', form);
      }
      setForm(initialForm);
      setEditingId(null);
      await loadMedicines(query);
    } catch {
      setError('Failed to save medicine');
    } finally {
      setSaving(false);
    }
  };

  const onEdit = (medicine: Medicine) => {
    setEditingId(medicine.medicineId);
    setForm({
      name: medicine.name,
      batchNumber: medicine.batchNumber,
      quantity: medicine.quantity,
      expiryDate: toDateInput(medicine.expiryDate),
      price: Number(medicine.price),
    });
  };

  const onDelete = async (medicineId: number) => {
    const confirmed = window.confirm('Delete this medicine record?');
    if (!confirmed) return;

    setError(null);
    try {
      await api.delete(`/medicine/${medicineId}`);
      if (editingId === medicineId) {
        setEditingId(null);
        setForm(initialForm);
      }
      await loadMedicines(query);
    } catch {
      setError('Failed to delete medicine');
    }
  };

  const onCancelEdit = () => {
    setEditingId(null);
    setForm(initialForm);
  };

  const lowStockCount = useMemo(() => medicines.filter((m) => m.quantity <= 20).length, [medicines]);
  const expiringSoonCount = useMemo(() => medicines.filter((m) => daysUntil(m.expiryDate) <= 30).length, [medicines]);

  return (
    <section className="card">
      <div className="section-head">
        <h1>Manage Inventory</h1>
        <p className="muted">Track medicine stock, expiry dates, and pricing for safe dispensing.</p>
      </div>

      <div className="stats-row">
        <div className="stat-chip">Total: {medicines.length}</div>
        <div className="stat-chip warning">Low stock: {lowStockCount}</div>
        <div className="stat-chip warning">Expiring ≤ 30 days: {expiringSoonCount}</div>
      </div>

      <form onSubmit={onSearch} className="form-row" style={{ marginTop: 10 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search medicine name / batch"
        />
        <button type="submit" className="btn-secondary">Search</button>
      </form>

      <form onSubmit={onSubmit} className="form-grid" style={{ marginTop: 14 }}>
        <div className="section-head">
          <h3>{editingId ? 'Update Medicine' : 'Add Medicine'}</h3>
        </div>

        <div className="inventory-grid">
          <input
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Medicine name"
            required
          />
          <input
            value={form.batchNumber}
            onChange={(e) => setForm((prev) => ({ ...prev, batchNumber: e.target.value }))}
            placeholder="Batch number"
            required
          />
          <input
            type="number"
            min={0}
            value={form.quantity}
            onChange={(e) => setForm((prev) => ({ ...prev, quantity: Number(e.target.value) || 0 }))}
            placeholder="Quantity"
            required
          />
          <input
            type="date"
            value={form.expiryDate}
            onChange={(e) => setForm((prev) => ({ ...prev, expiryDate: e.target.value }))}
            required
          />
          <input
            type="number"
            min={0}
            step="0.01"
            value={form.price}
            onChange={(e) => setForm((prev) => ({ ...prev, price: Number(e.target.value) || 0 }))}
            placeholder="Price"
            required
          />
        </div>

        <div className="action-row">
          <button type="submit" disabled={saving}>{saving ? 'Saving...' : editingId ? 'Update Medicine' : 'Add Medicine'}</button>
          {editingId && (
            <button type="button" className="btn-secondary" onClick={onCancelEdit}>
              Cancel
            </button>
          )}
        </div>
      </form>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading...</p>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Batch</th>
              <th>Stock</th>
              <th>Expiry</th>
              <th>Price (RM)</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {medicines.map((medicine) => (
              <tr key={medicine.medicineId}>
                <td>{medicine.name}</td>
                <td>{medicine.batchNumber}</td>
                <td>
                  <span className={stockClass(medicine.quantity)}>{medicine.quantity}</span>
                </td>
                <td>
                  <span className={expiryClass(medicine.expiryDate)}>{toDateInput(medicine.expiryDate) || '-'}</span>
                </td>
                <td>{formatMoney(medicine.price)}</td>
                <td>
                  <div className="action-row">
                    <button type="button" className="btn-secondary" onClick={() => onEdit(medicine)}>
                      Edit
                    </button>
                    <button type="button" className="btn-danger" onClick={() => onDelete(medicine.medicineId)}>
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
        {medicines.map((medicine) => (
          <article key={medicine.medicineId} className="mobile-card">
            <h4>{medicine.name}</h4>
            <dl className="kv">
              <div>
                <dt>Batch</dt>
                <dd>{medicine.batchNumber}</dd>
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
            </dl>
            <div className="action-row" style={{ marginTop: 10 }}>
              <button type="button" className="btn-secondary" onClick={() => onEdit(medicine)}>
                Edit
              </button>
              <button type="button" className="btn-danger" onClick={() => onDelete(medicine.medicineId)}>
                Delete
              </button>
            </div>
          </article>
        ))}
      </div>

      {!loading && medicines.length === 0 && <p className="muted">No medicine records found.</p>}
    </section>
  );
};
