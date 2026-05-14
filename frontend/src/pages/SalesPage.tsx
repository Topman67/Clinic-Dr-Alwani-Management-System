import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { subscribeInAppDataSync } from '../lib/sync';
import { roleBasePath } from '../config/rbac';
import { DateRangeFilter, getDateRangeForPreset, type DateRangeValue } from '../components/DateRangeFilter';

type SaleType = 'CONSULTATION' | 'APPOINTMENT' | 'MEDICINE';

const SALE_TYPE_OPTIONS: Array<{ value: SaleType; label: string }> = [
  { value: 'CONSULTATION', label: 'Consultation Fee' },
  { value: 'APPOINTMENT', label: 'Appointment Fee' },
  { value: 'MEDICINE', label: 'Walk-in Medicine' },
];

type WalkInSale = {
  paymentId: number;
  date: string;
  type: SaleType;
  status: 'PENDING_PAYMENT' | 'PAID' | 'PENDING_DISPENSE' | 'DISPENSED' | 'CANCELLED';
  paymentMethod: 'CASH' | 'CARD' | 'ONLINE_TRANSFER' | 'E_WALLET';
  amount: number | string;
  dispensedAt?: string | null;
  dispensedById?: number | null;
  dispensedByUsername?: string | null;
  patient?: {
    patientId: number;
    name: string;
    icOrPassport: string;
    phone: string;
  };
  medicineItems: Array<{
    itemId: number;
    qty: number;
    unitPrice?: number | string;
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

const statusLabel = (status: WalkInSale['status']) => {
  if (status === 'PENDING_PAYMENT') return 'Pending Payment';
  if (status === 'PENDING_DISPENSE') return 'Pending Dispense';
  return status.charAt(0) + status.slice(1).toLowerCase();
};

const statusClass = (status: WalkInSale['status']) => {
  if (status === 'DISPENSED') return 'status-good';
  if (status === 'PAID') return 'status-paid';
  if (status === 'PENDING_DISPENSE') return 'status-pending-dispense';
  if (status === 'CANCELLED') return 'status-critical';
  return 'status-warning';
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
  const [dispenseSale, setDispenseSale] = useState<WalkInSale | null>(null);
  const [dispensingId, setDispensingId] = useState<number | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => getDateRangeForPreset('today'));
  const [queryCustomerId, setQueryCustomerId] = useState('');
  const [queryType, setQueryType] = useState<SaleType | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSales = useCallback(async (filters?: { dateFrom?: string; dateTo?: string; customerId?: string; type?: SaleType }) => {
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
    void loadSales({
      dateFrom: dateRange.dateFrom || undefined,
      dateTo: dateRange.dateTo || undefined,
      customerId: queryCustomerId.trim() || undefined,
      type: queryType || undefined,
    });
  }, [dateRange.dateFrom, dateRange.dateTo, loadSales, queryCustomerId, queryType]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void loadSales({
        dateFrom: dateRange.dateFrom || undefined,
        dateTo: dateRange.dateTo || undefined,
        customerId: queryCustomerId.trim() || undefined,
        type: queryType || undefined,
      });
    });
  }, [dateRange.dateFrom, dateRange.dateTo, loadSales, queryCustomerId, queryType]);

  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    await loadSales({
      dateFrom: dateRange.dateFrom || undefined,
      dateTo: dateRange.dateTo || undefined,
      customerId: queryCustomerId.trim() || undefined,
      type: queryType || undefined,
    });
  };

  const totalQuantity = useMemo(
    () => sales.reduce((sum, sale) => sum + sale.medicineItems.reduce((inner, item) => inner + item.qty, 0), 0),
    [sales],
  );

  const basePath = role ? roleBasePath[role] : '/';

  const onDispenseSale = async () => {
    if (!dispenseSale || !isPharmacist) return;
    setDispensingId(dispenseSale.paymentId);
    setError(null);
    try {
      const response = await api.post(`/payments/${dispenseSale.paymentId}/dispense`);
      const updated = response.data as WalkInSale;
      setSales((current) => current.map((sale) => (sale.paymentId === updated.paymentId ? updated : sale)));
      setSelectedSale((current) => (current?.paymentId === updated.paymentId ? updated : current));
      setDispenseSale(null);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to dispense sale'));
    } finally {
      setDispensingId(null);
    }
  };

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
          placeholder="Search customer, receipt, medicine..."
        />
        <select value={queryType} onChange={(e) => setQueryType((e.target.value as SaleType) || '')}>
          <option value="">All Types</option>
          {SALE_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <DateRangeFilter value={dateRange} onChange={setDateRange} includeAll />
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            const today = getDateRangeForPreset('today');
            setDateRange(today);
            setQueryCustomerId('');
            setQueryType('');
            void loadSales({ dateFrom: today.dateFrom, dateTo: today.dateTo });
          }}
        >
          Reset
        </button>
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
              <th>Customer</th>
              <th>Receipt</th>
              <th>Items Sold</th>
              <th>Quantity</th>
              <th>Amount (RM)</th>
              <th>Status</th>
              <th>Dispense Date</th>
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
                  <td>
                    {sale.patient?.name || '-'}
                    <br />
                    <small className="muted">{sale.patient?.icOrPassport || '-'}</small>
                  </td>
                  <td>{sale.receipt?.receiptNo || '-'}</td>
                  <td>{sale.type === 'MEDICINE' ? itemSummary.join(', ') || '-' : '-'}</td>
                  <td>{sale.type === 'MEDICINE' ? qty : '-'}</td>
                  <td>{formatMoney(sale.receipt?.totalAmount ?? sale.amount)}</td>
                  <td><span className={`status-badge ${statusClass(sale.status)}`}>{statusLabel(sale.status)}</span></td>
                  <td>{sale.dispensedAt ? new Date(sale.dispensedAt).toLocaleString() : '-'}</td>
                  <td>
                    <div className="sales-actions">
                      <button type="button" className="btn-secondary sales-view-btn" onClick={() => setSelectedSale(sale)}>View Details</button>
                      {isPharmacist && sale.type === 'MEDICINE' && sale.status === 'PENDING_DISPENSE' && (
                        <button type="button" onClick={() => setDispenseSale(sale)} disabled={dispensingId === sale.paymentId}>Dispense</button>
                      )}
                      <button type="button" className="btn-secondary" onClick={() => window.print()}>Print Receipt</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!loading && sales.length === 0 && <p className="muted">No sales found for current filters.</p>}

      {selectedSale && (
        <section className="card sales-detail-panel">
          <div className="sales-detail-head">
            <div>
              <h3>Sale Details</h3>
              <p className="muted">Sale #{selectedSale.paymentId} processed successfully.</p>
            </div>
            <span className={`status-badge ${statusClass(selectedSale.status)}`}>{statusLabel(selectedSale.status)}</span>
          </div>

          <div className="sales-detail-grid">
            <section className="sales-detail-card sales-detail-wide">
              <div className="sales-summary-strip">
                <div><span>Receipt Number</span><strong>{selectedSale.receipt?.receiptNo || '-'}</strong></div>
                <div><span>Payment Date</span><strong>{new Date(selectedSale.date).toLocaleString()}</strong></div>
                <div><span>Total</span><strong>RM {formatMoney(selectedSale.receipt?.totalAmount ?? selectedSale.amount)}</strong></div>
              </div>
              <div className="sales-detail-actions">
                <button type="button" className="btn-secondary" onClick={() => window.print()}>Print Receipt</button>
                <button type="button" className="btn-secondary" onClick={() => setSelectedSale(null)}>Close</button>
              </div>
            </section>

            <section className="sales-detail-card">
              <h4>Customer Information</h4>
              <dl className="sales-detail-kv">
                <div><dt>Customer Name</dt><dd>{selectedSale.patient?.name || '-'}</dd></div>
                <div><dt>Phone Number</dt><dd>{selectedSale.patient?.phone || 'Not provided'}</dd></div>
                <div><dt>Customer ID</dt><dd>{selectedSale.patient?.icOrPassport || '-'}</dd></div>
                <div><dt>Payment Method</dt><dd>{prettifyMethod(selectedSale.paymentMethod)}</dd></div>
              </dl>
            </section>

            <section className="sales-detail-card">
              <h4>Dispense Information</h4>
              <dl className="sales-detail-kv">
                <div><dt>Status</dt><dd><span className={`status-badge ${statusClass(selectedSale.status)}`}>{statusLabel(selectedSale.status)}</span></dd></div>
                <div><dt>Dispensed By</dt><dd>{selectedSale.dispensedByUsername || '-'}</dd></div>
                <div><dt>Dispensed At</dt><dd>{selectedSale.dispensedAt ? new Date(selectedSale.dispensedAt).toLocaleString() : '-'}</dd></div>
              </dl>
              {isPharmacist && selectedSale.type === 'MEDICINE' && selectedSale.status === 'PENDING_DISPENSE' && (
                <button type="button" onClick={() => setDispenseSale(selectedSale)} disabled={dispensingId === selectedSale.paymentId}>Dispense Medicine</button>
              )}
            </section>

            <section className="sales-detail-card sales-detail-wide">
              <h4>Medicine Items</h4>
              {selectedSale.type === 'MEDICINE' ? (
                <>
                  <div className="table-wrap sales-detail-table-wrap">
                    <table className="data-table sales-detail-table">
                      <thead>
                        <tr>
                          <th>Medicine Name</th>
                          <th>Batch</th>
                          <th>Quantity</th>
                          <th>Unit Price</th>
                          <th>Subtotal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedSale.medicineItems.map((item) => (
                          <tr key={`sale-item-${item.itemId}`}>
                            <td>{item.medicine?.name ?? `Medicine #${item.medicine?.medicineId ?? ''}`}</td>
                            <td>{item.medicine?.batchNumber ?? '-'}</td>
                            <td>{item.qty}</td>
                            <td>RM {formatMoney(item.unitPrice ?? Number(item.subtotal) / Math.max(1, item.qty))}</td>
                            <td>RM {formatMoney(item.subtotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="sales-grand-total">
                    <span>Grand Total</span>
                    <strong>RM {formatMoney(selectedSale.receipt?.totalAmount ?? selectedSale.amount)}</strong>
                  </div>
                </>
              ) : (
                <p className="muted">No medicine items for this standard payment type.</p>
              )}
            </section>
          </div>
        </section>
      )}

      {dispenseSale && (
        <div className="inventory-modal-layer" role="presentation">
          <button type="button" className="inventory-modal-backdrop" aria-label="Cancel dispense" onClick={() => setDispenseSale(null)} disabled={Boolean(dispensingId)} />
          <section className="inventory-modal inventory-reject-modal" role="dialog" aria-modal="true" aria-labelledby="dispense-sale-title">
            <div className="inventory-modal-head">
              <div>
                <h3 id="dispense-sale-title">Dispense Sale #{dispenseSale.paymentId}</h3>
                <p className="muted">{dispenseSale.patient?.name || 'Walk-in Customer'} - {dispenseSale.receipt?.receiptNo || '-'}</p>
              </div>
              <button type="button" className="patient-drawer-close" onClick={() => setDispenseSale(null)} disabled={Boolean(dispensingId)}>X</button>
            </div>
            <div className="inventory-modal-body">
              <p className="muted">Confirm medicines have been checked and are ready to hand to the customer. Inventory stock will be deducted now.</p>
            </div>
            <div className="inventory-modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setDispenseSale(null)} disabled={Boolean(dispensingId)}>Cancel</button>
              <button type="button" onClick={() => void onDispenseSale()} disabled={Boolean(dispensingId)}>
                {dispensingId ? 'Dispensing...' : 'Confirm Dispense'}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
};
