import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { subscribeInAppDataSync } from '../lib/sync';
import { roleBasePath } from '../config/rbac';

type WalkInSale = {
  paymentId: number;
  date: string;
  type: 'CONSULTATION' | 'APPOINTMENT' | 'MEDICINE';
  status: 'PAID' | 'CANCELLED';
  paymentMethod: 'CASH' | 'CARD' | 'ONLINE_TRANSFER' | 'E_WALLET';
  amount: number | string;
  patient?: {
    patientId: number;
    name: string;
    icOrPassport: string;
    phone: string;
  };
  medicineItems: Array<{
    itemId: number;
    qty: number;
    subtotal: number | string;
    medicine?: {
      medicineId: number;
      name: string;
      batchNumber: string;
      quantity: number;
    };
  }>;
  receipt?: {
    receiptNo: string;
    totalAmount: number | string;
  } | null;
};

const formatMoney = (value: number | string) => {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
};

const prettifyMethod = (method: WalkInSale['paymentMethod']) => {
  if (method === 'ONLINE_TRANSFER') return 'Online Transfer';
  if (method === 'E_WALLET') return 'E-Wallet';
  return method.charAt(0) + method.slice(1).toLowerCase();
};

const prettifyType = (type: WalkInSale['type']) => {
  if (type === 'CONSULTATION') return 'Consultation Fee';
  if (type === 'APPOINTMENT') return 'Appointment Fee';
  return 'Walk-in Medicine';
};

const getApiErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'object' && error !== null) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    const message = response?.data?.message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return fallback;
};

export const SalesPage = () => {
  const { role } = useAuth();
  const isReceptionist = role === 'RECEPTIONIST';
  const isPharmacist = role === 'PHARMACIST';
  const navigate = useNavigate();

  const [sales, setSales] = useState<WalkInSale[]>([]);
  const [selectedSale, setSelectedSale] = useState<WalkInSale | null>(null);
  const [queryDateFrom, setQueryDateFrom] = useState('');
  const [queryDateTo, setQueryDateTo] = useState('');
  const [queryCustomerId, setQueryCustomerId] = useState('');
  const [queryType, setQueryType] = useState<WalkInSale['type'] | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSales = useCallback(async (filters?: { dateFrom?: string; dateTo?: string; customerId?: string; type?: WalkInSale['type'] }) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/payments/sales', {
        params: {
          dateFrom: filters?.dateFrom || undefined,
          dateTo: filters?.dateTo || undefined,
          customerId: filters?.customerId || undefined,
          type: filters?.type || undefined,
        },
      });
      setSales(response.data as WalkInSale[]);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load sales data'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSales();
  }, [loadSales]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void loadSales({
        dateFrom: queryDateFrom || undefined,
        dateTo: queryDateTo || undefined,
        customerId: queryCustomerId.trim() || undefined,
        type: queryType || undefined,
      });
    });
  }, [loadSales, queryCustomerId, queryDateFrom, queryDateTo, queryType]);

  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    await loadSales({
      dateFrom: queryDateFrom || undefined,
      dateTo: queryDateTo || undefined,
      customerId: queryCustomerId.trim() || undefined,
      type: queryType || undefined,
    });
  };

  const totalQuantity = useMemo(
    () => sales.reduce((sum, sale) => sum + sale.medicineItems.reduce((inner, item) => inner + item.qty, 0), 0),
    [sales],
  );

  const basePath = role ? roleBasePath[role] : '/';

  return (
    <section className="card">
      <div className="section-head">
        <h1>Sales</h1>
        <p className="muted">
          {isReceptionist
            ? 'Create sales, handle payment, and review all standard and walk-in sales.'
            : 'View standard and walk-in sales, check medicine sold, and monitor stock usage.'}
        </p>
      </div>

      <form onSubmit={onSearch} className="filters-grid">
        <input
          value={queryCustomerId}
          onChange={(e) => setQueryCustomerId(e.target.value)}
          placeholder="Customer ID"
        />
        <select value={queryType} onChange={(e) => setQueryType((e.target.value as WalkInSale['type']) || '')}>
          <option value="">All Types</option>
          <option value="CONSULTATION">Consultation Fee</option>
          <option value="APPOINTMENT">Appointment Fee</option>
          <option value="MEDICINE">Walk-in Medicine</option>
        </select>
        <input
          type="date"
          value={queryDateFrom}
          onChange={(e) => setQueryDateFrom(e.target.value)}
          aria-label="Date from"
        />
        <input
          type="date"
          value={queryDateTo}
          onChange={(e) => setQueryDateTo(e.target.value)}
          aria-label="Date to"
        />
        <button type="submit" className="btn-secondary">Search</button>
      </form>

      <div className="stats-row" style={{ marginTop: 12 }}>
        <div className="stat-chip">Walk-in purchases: {sales.filter((sale) => sale.type === 'MEDICINE').length}</div>
        <div className="stat-chip">Standard payments: {sales.filter((sale) => sale.type !== 'MEDICINE').length}</div>
        <div className="stat-chip">Items sold (qty): {totalQuantity}</div>
      </div>

      {isReceptionist && (
        <div className="action-row" style={{ marginTop: 12 }}>
          <button type="button" onClick={() => navigate(`${basePath}/payments`)}>
            Create Sale & Handle Payment
          </button>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading...</p>}

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Walk-in Customer</th>
              <th>Receipt</th>
              <th>Items Sold</th>
              <th>Quantity</th>
              <th>Amount (RM)</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((sale) => {
              const qty = sale.medicineItems.reduce((sum, item) => sum + item.qty, 0);
              const itemSummary = sale.medicineItems.map((item) => item.medicine?.name ?? `Medicine #${item.medicine?.medicineId ?? ''}`);

              return (
                <tr key={`sale-${sale.paymentId}`}>
                  <td>{new Date(sale.date).toLocaleString()}</td>
                  <td>{prettifyType(sale.type)}</td>
                  <td>
                    {sale.patient?.name || '-'}
                    <br />
                    <small className="muted">{sale.patient?.icOrPassport || '-'}</small>
                  </td>
                  <td>{sale.receipt?.receiptNo || '-'}</td>
                  <td>{sale.type === 'MEDICINE' ? itemSummary.join(', ') || '-' : '-'}</td>
                  <td>{sale.type === 'MEDICINE' ? qty : '-'}</td>
                  <td>{formatMoney(sale.receipt?.totalAmount ?? sale.amount)}</td>
                  <td>{sale.status}</td>
                  <td>
                    <button type="button" className="btn-secondary sales-view-btn" onClick={() => setSelectedSale(sale)}>
                      View Details
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!loading && sales.length === 0 && <p className="muted">No sales found for current filters.</p>}

      {selectedSale && (
        <section className="card" style={{ marginTop: 14 }}>
          <div className="section-head">
            <h3>Sale Details</h3>
            <p className="muted">Walk-in purchases, receipt, quantity sold, date, and stock usage snapshot.</p>
          </div>

          <dl className="kv">
            <div>
              <dt>Sale ID</dt>
              <dd>#{selectedSale.paymentId}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{new Date(selectedSale.date).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Customer</dt>
              <dd>{selectedSale.patient?.name || '-'}</dd>
            </div>
            <div>
              <dt>Customer ID</dt>
              <dd>{selectedSale.patient?.icOrPassport || '-'}</dd>
            </div>
            <div>
              <dt>Payment Method</dt>
              <dd>{prettifyMethod(selectedSale.paymentMethod)}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{prettifyType(selectedSale.type)}</dd>
            </div>
            <div>
              <dt>Receipt</dt>
              <dd>{selectedSale.receipt?.receiptNo || '-'}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>RM {formatMoney(selectedSale.receipt?.totalAmount ?? selectedSale.amount)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{selectedSale.status}</dd>
            </div>
          </dl>

          {selectedSale.type === 'MEDICINE' ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Batch</th>
                    <th>Qty</th>
                    <th>Subtotal (RM)</th>
                    {isPharmacist && <th>Current Stock</th>}
                  </tr>
                </thead>
                <tbody>
                  {selectedSale.medicineItems.map((item) => (
                    <tr key={`sale-item-${item.itemId}`}>
                      <td>{item.medicine?.name ?? `Medicine #${item.medicine?.medicineId ?? ''}`}</td>
                      <td>{item.medicine?.batchNumber ?? '-'}</td>
                      <td>{item.qty}</td>
                      <td>{formatMoney(item.subtotal)}</td>
                      {isPharmacist && <td>{item.medicine?.quantity ?? '-'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No medicine items for this standard payment type.</p>
          )}

          <div className="action-row" style={{ marginTop: 10 }}>
            <button type="button" className="btn-secondary" onClick={() => setSelectedSale(null)}>
              Close Details
            </button>
          </div>
        </section>
      )}
    </section>
  );
};
