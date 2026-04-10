import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';
import { subscribeInAppDataSync } from '../lib/sync';

type PaymentType = 'CONSULTATION' | 'APPOINTMENT';

type PaymentRecord = {
  paymentId: number;
  type: PaymentType;
  amount: number | string;
  date: string;
};

type PaymentSummaryResponse = {
  count: number;
  total: number;
  payments: PaymentRecord[];
};

type ReceiptRecord = {
  receiptId: number;
  receiptNo: string;
  date: string;
  totalAmount: number | string;
  payment?: {
    paymentId: number;
    patient?: { name: string };
    type: PaymentType;
  };
};

type MedicineReportItem = {
  medicineId: number;
  name: string;
  batchNumber: string;
  quantity: number;
  expiryDate: string;
  price: number | string;
};

const formatMoney = (value: number | string) => {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
};

const toDateInput = (isoDate: string) => {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toISOString().slice(0, 10);
};

const daysUntil = (isoDate: string) => {
  const target = new Date(isoDate).getTime();
  const now = new Date().getTime();
  return Math.ceil((target - now) / (1000 * 60 * 60 * 24));
};

export const ReportsPage = () => {
  const [paymentType, setPaymentType] = useState<PaymentType | ''>('');
  const [paymentDateFrom, setPaymentDateFrom] = useState('');
  const [paymentDateTo, setPaymentDateTo] = useState('');
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummaryResponse | null>(null);

  const [receiptNoQuery, setReceiptNoQuery] = useState('');
  const [receiptDateFrom, setReceiptDateFrom] = useState('');
  const [receiptDateTo, setReceiptDateTo] = useState('');
  const [receipts, setReceipts] = useState<ReceiptRecord[]>([]);

  const [expiringDays, setExpiringDays] = useState(30);
  const [lowStockItems, setLowStockItems] = useState<MedicineReportItem[]>([]);
  const [expiringItems, setExpiringItems] = useState<MedicineReportItem[]>([]);

  const [loadingSummary, setLoadingSummary] = useState(false);
  const [loadingReceipts, setLoadingReceipts] = useState(false);
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPaymentSummary = useCallback(async () => {
    setLoadingSummary(true);
    setError(null);
    try {
      const response = await api.get('/reports/payments', {
        params: {
          type: paymentType || undefined,
          dateFrom: paymentDateFrom || undefined,
          dateTo: paymentDateTo || undefined,
        },
      });
      setPaymentSummary(response.data as PaymentSummaryResponse);
    } catch {
      setError('Failed to load payment summary');
    } finally {
      setLoadingSummary(false);
    }
  }, [paymentDateFrom, paymentDateTo, paymentType]);

  const loadReceipts = useCallback(async () => {
    setLoadingReceipts(true);
    setError(null);
    try {
      const response = await api.get('/reports/receipts', {
        params: {
          receiptNo: receiptNoQuery || undefined,
          dateFrom: receiptDateFrom || undefined,
          dateTo: receiptDateTo || undefined,
        },
      });
      setReceipts(response.data as ReceiptRecord[]);
    } catch {
      setError('Failed to load receipts report');
    } finally {
      setLoadingReceipts(false);
    }
  }, [receiptDateFrom, receiptDateTo, receiptNoQuery]);

  const loadInventoryReports = useCallback(async () => {
    setLoadingInventory(true);
    setError(null);
    try {
      const [lowStockRes, expiringRes] = await Promise.all([
        api.get('/reports/inventory/low-stock'),
        api.get('/reports/inventory/expiring', { params: { days: expiringDays } }),
      ]);

      setLowStockItems(lowStockRes.data as MedicineReportItem[]);
      setExpiringItems(expiringRes.data as MedicineReportItem[]);
    } catch {
      setError('Failed to load inventory report');
    } finally {
      setLoadingInventory(false);
    }
  }, [expiringDays]);

  useEffect(() => {
    void (async () => {
      await Promise.all([loadPaymentSummary(), loadReceipts(), loadInventoryReports()]);
    })();
  }, [loadInventoryReports, loadPaymentSummary, loadReceipts]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void Promise.all([loadPaymentSummary(), loadReceipts(), loadInventoryReports()]);
    });
  }, [loadInventoryReports, loadPaymentSummary, loadReceipts]);

  const onPaymentSearch = async (e: FormEvent) => {
    e.preventDefault();
    await loadPaymentSummary();
  };

  const onReceiptSearch = async (e: FormEvent) => {
    e.preventDefault();
    await loadReceipts();
  };

  const onInventoryRefresh = async (e: FormEvent) => {
    e.preventDefault();
    await loadInventoryReports();
  };

  const consultationTotal = useMemo(() => {
    if (!paymentSummary) return 0;
    return paymentSummary.payments
      .filter((p) => p.type === 'CONSULTATION')
      .reduce((sum, p) => sum + Number(p.amount), 0);
  }, [paymentSummary]);

  const appointmentTotal = useMemo(() => {
    if (!paymentSummary) return 0;
    return paymentSummary.payments
      .filter((p) => p.type === 'APPOINTMENT')
      .reduce((sum, p) => sum + Number(p.amount), 0);
  }, [paymentSummary]);

  return (
    <section className="card">
      <div className="section-head">
        <h1>Generate Report</h1>
        <p className="muted">Track payments, receipts, and inventory risk indicators in one view.</p>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="reports-grid">
        <article className="report-card">
          <div className="section-head">
            <h3>Payment Summary</h3>
          </div>

          <form onSubmit={onPaymentSearch} className="filters-grid report-filters">
            <select value={paymentType} onChange={(e) => setPaymentType((e.target.value as PaymentType | '') || '')}>
              <option value="">All types</option>
              <option value="CONSULTATION">Consultation</option>
              <option value="APPOINTMENT">Appointment</option>
            </select>
            <input type="date" value={paymentDateFrom} onChange={(e) => setPaymentDateFrom(e.target.value)} />
            <input type="date" value={paymentDateTo} onChange={(e) => setPaymentDateTo(e.target.value)} />
            <button type="submit" className="btn-secondary">Refresh</button>
          </form>

          {loadingSummary && <p className="muted">Loading payment summary...</p>}

          {paymentSummary && (
            <div className="metrics-grid">
              <div className="metric-card">
                <p className="muted">Transactions</p>
                <strong>{paymentSummary.count}</strong>
              </div>
              <div className="metric-card">
                <p className="muted">Total (RM)</p>
                <strong>{formatMoney(paymentSummary.total)}</strong>
              </div>
              <div className="metric-card">
                <p className="muted">Consultation (RM)</p>
                <strong>{formatMoney(consultationTotal)}</strong>
              </div>
              <div className="metric-card">
                <p className="muted">Appointment (RM)</p>
                <strong>{formatMoney(appointmentTotal)}</strong>
              </div>
            </div>
          )}
        </article>

        <article className="report-card">
          <div className="section-head">
            <h3>Receipts Report</h3>
          </div>

          <form onSubmit={onReceiptSearch} className="filters-grid report-filters">
            <input
              value={receiptNoQuery}
              onChange={(e) => setReceiptNoQuery(e.target.value)}
              placeholder="Receipt no"
            />
            <input type="date" value={receiptDateFrom} onChange={(e) => setReceiptDateFrom(e.target.value)} />
            <input type="date" value={receiptDateTo} onChange={(e) => setReceiptDateTo(e.target.value)} />
            <button type="submit" className="btn-secondary">Search</button>
          </form>

          {loadingReceipts && <p className="muted">Loading receipts...</p>}

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Receipt No</th>
                  <th>Patient</th>
                  <th>Type</th>
                  <th>Total (RM)</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.receiptId}>
                    <td>{new Date(r.date).toLocaleString()}</td>
                    <td>{r.receiptNo}</td>
                    <td>{r.payment?.patient?.name ?? '-'}</td>
                    <td>{r.payment?.type ?? '-'}</td>
                    <td>{formatMoney(r.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mobile-cards">
            {receipts.map((r) => (
              <article key={r.receiptId} className="mobile-card">
                <h4>{r.receiptNo}</h4>
                <dl className="kv">
                  <div>
                    <dt>Date</dt>
                    <dd>{new Date(r.date).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Patient</dt>
                    <dd>{r.payment?.patient?.name ?? '-'}</dd>
                  </div>
                  <div>
                    <dt>Type</dt>
                    <dd>{r.payment?.type ?? '-'}</dd>
                  </div>
                  <div>
                    <dt>Total</dt>
                    <dd>RM {formatMoney(r.totalAmount)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>

          {!loadingReceipts && receipts.length === 0 && <p className="muted">No receipts found.</p>}
        </article>

        <article className="report-card inventory-report-card">
          <div className="section-head">
            <h3>Inventory Alerts</h3>
          </div>

          <form onSubmit={onInventoryRefresh} className="form-row">
            <input
              type="number"
              min={1}
              value={expiringDays}
              onChange={(e) => setExpiringDays(Math.max(1, Number(e.target.value) || 30))}
              placeholder="Days"
            />
            <button type="submit" className="btn-secondary">Refresh Alerts</button>
          </form>

          {loadingInventory && <p className="muted">Loading inventory alerts...</p>}

          <div className="metrics-grid" style={{ marginTop: 12 }}>
            <div className="metric-card warning">
              <p className="muted">Low Stock (&lt; 10)</p>
              <strong>{lowStockItems.length}</strong>
            </div>
            <div className="metric-card warning">
              <p className="muted">Expiring ≤ {expiringDays} days</p>
              <strong>{expiringItems.length}</strong>
            </div>
          </div>

          <div className="alerts-grid">
            <div>
              <h4>Low Stock</h4>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Batch</th>
                      <th>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockItems.map((item) => (
                      <tr key={item.medicineId}>
                        <td>{item.name}</td>
                        <td>{item.batchNumber}</td>
                        <td><span className="status-badge status-critical">{item.quantity}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h4>Expiring Soon</h4>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Batch</th>
                      <th>Expiry</th>
                      <th>In Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expiringItems.map((item) => (
                      <tr key={item.medicineId}>
                        <td>{item.name}</td>
                        <td>{item.batchNumber}</td>
                        <td>{toDateInput(item.expiryDate)}</td>
                        <td>{daysUntil(item.expiryDate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {!loadingInventory && lowStockItems.length === 0 && expiringItems.length === 0 && (
            <p className="muted">No inventory alerts found.</p>
          )}
        </article>
      </div>
    </section>
  );
};
