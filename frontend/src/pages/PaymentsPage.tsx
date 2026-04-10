import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';

type Patient = {
  patientId: number;
  name: string;
};

type Receipt = {
  receiptId: number;
  receiptNo: string;
  date: string;
  totalAmount: number | string;
};

type PaymentType = 'CONSULTATION' | 'APPOINTMENT';

type PaymentStatus = 'PAID' | 'CANCELLED';

type Payment = {
  paymentId: number;
  patientId: number;
  recordedById: number;
  type: PaymentType;
  amount: number | string;
  date: string;
  status: PaymentStatus;
  patient?: { name: string };
  receipt?: Receipt | null;
};

type PaymentForm = {
  patientId: number;
  type: PaymentType;
  amount: number;
};

const initialForm: PaymentForm = {
  patientId: 0,
  type: 'CONSULTATION',
  amount: 0,
};

const parseUserIdFromToken = (token: string | null): number | null => {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(normalized)
        .split('')
        .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(''),
    );
    const parsed = JSON.parse(json) as { userId?: number };
    return typeof parsed.userId === 'number' ? parsed.userId : null;
  } catch {
    return null;
  }
};

const formatMoney = (value: number | string) => {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
};

const prettifyType = (t: PaymentType) => (t === 'CONSULTATION' ? 'Consultation' : 'Appointment');

export const PaymentsPage = () => {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [form, setForm] = useState<PaymentForm>(initialForm);
  const [queryPatientId, setQueryPatientId] = useState<number | ''>('');
  const [queryType, setQueryType] = useState<PaymentType | ''>('');
  const [queryDateFrom, setQueryDateFrom] = useState('');
  const [queryDateTo, setQueryDateTo] = useState('');
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderId = useMemo(() => parseUserIdFromToken(localStorage.getItem('cms_token')), []);

  const loadPatients = async () => {
    const response = await api.get('/patients');
    setPatients(response.data as Patient[]);
  };

  const loadPayments = async (filters?: {
    patientId?: number;
    type?: PaymentType;
    dateFrom?: string;
    dateTo?: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/payments', {
        params: {
          patientId: filters?.patientId,
          type: filters?.type,
          dateFrom: filters?.dateFrom || undefined,
          dateTo: filters?.dateTo || undefined,
        },
      });
      setPayments(response.data as Payment[]);
    } catch {
      setError('Failed to load payments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void (async () => {
      try {
        await loadPatients();
        await loadPayments();
      } catch {
        setError('Failed to load required data');
      }
    })();
  }, []);

  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    await loadPayments({
      patientId: queryPatientId === '' ? undefined : Number(queryPatientId),
      type: queryType || undefined,
      dateFrom: queryDateFrom || undefined,
      dateTo: queryDateTo || undefined,
    });
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!recorderId) {
      setError('Cannot determine your account from token. Please login again.');
      return;
    }

    if (!form.patientId) {
      setError('Please select a patient.');
      return;
    }

    if (form.amount <= 0) {
      setError('Amount must be greater than 0.');
      return;
    }

    setSaving(true);
    try {
      await api.post('/payments', {
        patientId: form.patientId,
        recordedById: recorderId,
        type: form.type,
        amount: form.amount,
      });

      setForm(initialForm);
      await loadPayments({
        patientId: queryPatientId === '' ? undefined : Number(queryPatientId),
        type: queryType || undefined,
        dateFrom: queryDateFrom || undefined,
        dateTo: queryDateTo || undefined,
      });
    } catch {
      setError('Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <div className="section-head">
        <h1>Manage Payment</h1>
        <p className="muted">Record transactions and review generated receipts.</p>
      </div>

      <form onSubmit={onSearch} className="filters-grid">
        <select
          value={queryPatientId}
          onChange={(e) => setQueryPatientId(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">All patients</option>
          {patients.map((p) => (
            <option key={p.patientId} value={p.patientId}>
              {p.name}
            </option>
          ))}
        </select>

        <select value={queryType} onChange={(e) => setQueryType((e.target.value as PaymentType | '') || '')}>
          <option value="">All types</option>
          <option value="CONSULTATION">Consultation</option>
          <option value="APPOINTMENT">Appointment</option>
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

      <form onSubmit={onSubmit} className="form-grid" style={{ marginTop: 14 }}>
        <div className="section-head">
          <h3>Record Payment</h3>
        </div>

        <div className="payments-grid">
          <select
            value={form.patientId || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, patientId: Number(e.target.value) || 0 }))}
            required
          >
            <option value="">Select patient</option>
            {patients.map((p) => (
              <option key={p.patientId} value={p.patientId}>
                {p.name}
              </option>
            ))}
          </select>

          <select
            value={form.type}
            onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value as PaymentType }))}
          >
            <option value="CONSULTATION">Consultation</option>
            <option value="APPOINTMENT">Appointment</option>
          </select>

          <input
            type="number"
            min={0.01}
            step="0.01"
            value={form.amount}
            onChange={(e) => setForm((prev) => ({ ...prev, amount: Number(e.target.value) || 0 }))}
            placeholder="Amount"
            required
          />

          <button type="submit" disabled={saving}>{saving ? 'Recording...' : 'Record Payment'}</button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading...</p>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Patient</th>
              <th>Type</th>
              <th>Amount (RM)</th>
              <th>Status</th>
              <th>Receipt</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.paymentId}>
                <td>{new Date(p.date).toLocaleString()}</td>
                <td>{p.patient?.name ?? `Patient #${p.patientId}`}</td>
                <td><span className={`status-badge ${p.type === 'CONSULTATION' ? 'type-consultation' : 'type-appointment'}`}>{prettifyType(p.type)}</span></td>
                <td>{formatMoney(p.amount)}</td>
                <td><span className={`status-badge ${p.status === 'PAID' ? 'status-good' : 'status-warning'}`}>{p.status}</span></td>
                <td>{p.receipt?.receiptNo ?? '-'}</td>
                <td>
                  <button type="button" className="btn-secondary" onClick={() => setSelectedPayment(p)}>
                    View Receipt
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mobile-cards">
        {payments.map((p) => (
          <article key={p.paymentId} className="mobile-card">
            <h4>{p.patient?.name ?? `Patient #${p.patientId}`}</h4>
            <dl className="kv">
              <div>
                <dt>Date</dt>
                <dd>{new Date(p.date).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd><span className={`status-badge ${p.type === 'CONSULTATION' ? 'type-consultation' : 'type-appointment'}`}>{prettifyType(p.type)}</span></dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>RM {formatMoney(p.amount)}</dd>
              </div>
              <div>
                <dt>Receipt</dt>
                <dd>{p.receipt?.receiptNo ?? '-'}</dd>
              </div>
            </dl>
            <div className="action-row" style={{ marginTop: 10 }}>
              <button type="button" className="btn-secondary" onClick={() => setSelectedPayment(p)}>
                View Receipt
              </button>
            </div>
          </article>
        ))}
      </div>

      {!loading && payments.length === 0 && <p className="muted">No payments found for current filters.</p>}

      {selectedPayment && (
        <section className="card receipt-panel" style={{ marginTop: 16 }}>
          <div className="section-head">
            <h3>Receipt Details</h3>
            <p className="muted">Generated receipt from payment transaction.</p>
          </div>

          <dl className="kv">
            <div>
              <dt>Payment ID</dt>
              <dd>#{selectedPayment.paymentId}</dd>
            </div>
            <div>
              <dt>Patient</dt>
              <dd>{selectedPayment.patient?.name ?? `Patient #${selectedPayment.patientId}`}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{new Date(selectedPayment.date).toLocaleString()}</dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>{prettifyType(selectedPayment.type)}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>RM {formatMoney(selectedPayment.amount)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{selectedPayment.status}</dd>
            </div>
            <div>
              <dt>Receipt No</dt>
              <dd>{selectedPayment.receipt?.receiptNo ?? '-'}</dd>
            </div>
            <div>
              <dt>Receipt Date</dt>
              <dd>{selectedPayment.receipt?.date ? new Date(selectedPayment.receipt.date).toLocaleString() : '-'}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>RM {selectedPayment.receipt ? formatMoney(selectedPayment.receipt.totalAmount) : formatMoney(selectedPayment.amount)}</dd>
            </div>
          </dl>

          <div className="action-row" style={{ marginTop: 10 }}>
            <button type="button" className="btn-secondary" onClick={() => setSelectedPayment(null)}>
              Close Receipt
            </button>
          </div>
        </section>
      )}
    </section>
  );
};
