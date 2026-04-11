import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';
import { subscribeInAppDataSync } from '../lib/sync';
import { useAuth } from '../context/AuthContext';

type Patient = {
  patientId: number;
  name: string;
  icOrPassport?: string;
  phone?: string;
  address?: string | null;
};

type Receipt = {
  receiptId: number;
  receiptNo: string;
  date: string;
  totalAmount: number | string;
};

type PaymentType = 'CONSULTATION' | 'APPOINTMENT';
type PaymentMethod = 'CASH' | 'CARD' | 'ONLINE_TRANSFER' | 'E_WALLET';

type PaymentStatus = 'PAID' | 'CANCELLED';

type Payment = {
  paymentId: number;
  patientId: number;
  recordedById: number;
  type: PaymentType;
  amount: number | string;
  paymentMethod: PaymentMethod;
  remarks?: string | null;
  date: string;
  status: PaymentStatus;
  patient?: { name: string; icOrPassport?: string; phone?: string; address?: string | null };
  receipt?: Receipt | null;
};

type PaymentForm = {
  patientId: number;
  type: PaymentType;
  amount: number;
  paymentMethod: PaymentMethod;
  remarks: string;
};

const initialForm: PaymentForm = {
  patientId: 0,
  type: 'CONSULTATION',
  amount: 0,
  paymentMethod: 'CASH',
  remarks: '',
};

const formatMoney = (value: number | string) => {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
};

const prettifyType = (t: PaymentType) => (t === 'CONSULTATION' ? 'Consultation Fee' : 'Appointment Fee');

const prettifyMethod = (method: PaymentMethod) => {
  if (method === 'ONLINE_TRANSFER') return 'Online Transfer';
  if (method === 'E_WALLET') return 'E-Wallet';
  return method.charAt(0) + method.slice(1).toLowerCase();
};

export const PaymentsPage = () => {
  const { role } = useAuth();
  const isDoctor = role === 'DOCTOR';
  const isReceptionist = role === 'RECEPTIONIST';

  const [patients, setPatients] = useState<Patient[]>([]);
  const [patientSearch, setPatientSearch] = useState('');
  const [payments, setPayments] = useState<Payment[]>([]);
  const [form, setForm] = useState<PaymentForm>(initialForm);
  const [queryPatientId, setQueryPatientId] = useState<number | ''>('');
  const [queryType, setQueryType] = useState<PaymentType | ''>('');
  const [queryDateFrom, setQueryDateFrom] = useState('');
  const [queryDateTo, setQueryDateTo] = useState('');
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
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

  const loadPatients = useCallback(async (q = '') => {
    const response = await api.get('/patients', { params: { query: q || undefined } });
    setPatients(response.data as Patient[]);
  }, []);

  const loadPayments = useCallback(async (filters?: {
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
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load payments'));
    } finally {
      setLoading(false);
    }
  }, []);

  const buildCurrentFilters = useCallback(() => {
    return {
      patientId: queryPatientId === '' ? undefined : Number(queryPatientId),
      type: queryType || undefined,
      dateFrom: queryDateFrom || undefined,
      dateTo: queryDateTo || undefined,
    };
  }, [queryDateFrom, queryDateTo, queryPatientId, queryType]);

  useEffect(() => {
    void (async () => {
      try {
        await loadPatients();
        if (isDoctor) {
          await loadPayments();
        }
      } catch {
        setError('Failed to load required data');
      }
    })();
  }, [isDoctor, loadPatients, loadPayments]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void (async () => {
        try {
          await loadPatients(patientSearch);
          if (isDoctor) {
            await loadPayments(buildCurrentFilters());
          }
        } catch {
          setError('Failed to sync latest data');
        }
      })();
    });
  }, [buildCurrentFilters, isDoctor, loadPatients, loadPayments, patientSearch]);

  const selectedPatient = useMemo(() => {
    if (!form.patientId) return null;
    return patients.find((p) => p.patientId === form.patientId) ?? null;
  }, [form.patientId, patients]);

  const validatePaymentForm = () => {
    const nextErrors: Record<string, boolean> = {};

    if (!form.patientId) nextErrors.patientId = true;
    if (!Number.isFinite(form.amount) || form.amount <= 0) nextErrors.amount = true;

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const onSearchPatients = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await loadPatients(patientSearch);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to search patients'));
    }
  };

  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!isDoctor) return;
    await loadPayments(buildCurrentFilters());
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isReceptionist) return;

    setError(null);
    setSuccess(null);

    if (!validatePaymentForm()) {
      setError('Missing or invalid fields.');
      return;
    }

    setSaving(true);
    try {
      const response = await api.post('/payments', {
        patientId: form.patientId,
        type: form.type,
        amount: form.amount,
        paymentMethod: form.paymentMethod,
        remarks: form.remarks.trim() || undefined,
      });

      const data = response.data as {
        message?: string;
        payment: Payment;
        receipt: Receipt;
        patient: Patient;
      };

      const createdPayment: Payment = {
        ...data.payment,
        patient: {
          name: data.patient.name,
          icOrPassport: data.patient.icOrPassport,
          phone: data.patient.phone,
          address: data.patient.address,
        },
        receipt: data.receipt,
      };

      setSuccess(data.message || 'Payment Successful');
      setSelectedPayment(createdPayment);
      setForm(initialForm);
      setFieldErrors({});
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to record payment'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <div className="section-head">
        <h1>Manage Payment</h1>
        <p className="muted">
          {isDoctor
            ? 'Doctor can search and view payment history and receipt records.'
            : 'Receptionist can record payments and generate receipts.'}
        </p>
      </div>

      {isDoctor && (
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
            <option value="CONSULTATION">Consultation Fee</option>
            <option value="APPOINTMENT">Appointment Fee</option>
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
      )}

      {isReceptionist && (
        <>
          <form onSubmit={onSearchPatients} className="form-row" style={{ marginTop: 14 }}>
            <input
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              placeholder="Search patient by name / IC / phone"
            />
            <button type="submit" className="btn-secondary">Search Patient</button>
          </form>

          <form onSubmit={onSubmit} className="form-grid" style={{ marginTop: 14 }}>
            <div className="section-head">
              <h3>Record Payment</h3>
            </div>

            <div className="payments-grid">
              <div className="field-block">
                <select
                  value={form.patientId || ''}
                  onChange={(e) => {
                    const patientId = Number(e.target.value) || 0;
                    setForm((prev) => ({ ...prev, patientId }));
                    setFieldErrors((prev) => {
                      if (!prev.patientId) return prev;
                      const next = { ...prev };
                      delete next.patientId;
                      return next;
                    });
                  }}
                  className={fieldErrors.patientId ? 'field-invalid' : undefined}
                  required
                >
                  <option value="">Select patient</option>
                  {patients.map((p) => (
                    <option key={p.patientId} value={p.patientId}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {fieldErrors.patientId && <small className="field-helper">Patient selection is required.</small>}
              </div>

              <select
                value={form.type}
                onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value as PaymentType }))}
              >
                <option value="CONSULTATION">Consultation Fee</option>
                <option value="APPOINTMENT">Appointment Fee</option>
              </select>

              <div className="field-block">
                <input
                  type="number"
                  min={0.01}
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => {
                    const amount = Number(e.target.value) || 0;
                    setForm((prev) => ({ ...prev, amount }));
                    setFieldErrors((prev) => {
                      if (!prev.amount) return prev;
                      const next = { ...prev };
                      delete next.amount;
                      return next;
                    });
                  }}
                  placeholder="Amount"
                  className={fieldErrors.amount ? 'field-invalid' : undefined}
                  required
                />
                {fieldErrors.amount && <small className="field-helper">Amount must be greater than 0.</small>}
              </div>

              <select
                value={form.paymentMethod}
                onChange={(e) => setForm((prev) => ({ ...prev, paymentMethod: e.target.value as PaymentMethod }))}
              >
                <option value="CASH">Cash</option>
                <option value="CARD">Card</option>
                <option value="ONLINE_TRANSFER">Online Transfer</option>
                <option value="E_WALLET">E-Wallet</option>
              </select>

              <button type="submit" disabled={saving}>{saving ? 'Processing...' : 'Confirm / Pay'}</button>
            </div>

            <textarea
              value={form.remarks}
              onChange={(e) => setForm((prev) => ({ ...prev, remarks: e.target.value }))}
              placeholder="Remarks (optional)"
              rows={3}
              maxLength={500}
            />

            {selectedPatient && (
              <div className="report-card">
                <h4 style={{ marginTop: 0 }}>Patient Details</h4>
                <dl className="kv">
                  <div>
                    <dt>Name</dt>
                    <dd>{selectedPatient.name}</dd>
                  </div>
                  <div>
                    <dt>IC / Passport</dt>
                    <dd>{selectedPatient.icOrPassport || '-'}</dd>
                  </div>
                  <div>
                    <dt>Phone</dt>
                    <dd>{selectedPatient.phone || '-'}</dd>
                  </div>
                  <div>
                    <dt>Address</dt>
                    <dd>{selectedPatient.address || '-'}</dd>
                  </div>
                </dl>
              </div>
            )}
          </form>
        </>
      )}

      {error && <p className="error">{error}</p>}
      {success && <p className="muted" style={{ color: 'var(--primary)' }}>{success}</p>}
      {loading && <p className="muted">Loading...</p>}

      {isDoctor && (
        <>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Patient</th>
                  <th>Type</th>
                  <th>Amount (RM)</th>
                  <th>Method</th>
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
                    <td>{prettifyMethod(p.paymentMethod)}</td>
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
                    <dt>Method</dt>
                    <dd>{prettifyMethod(p.paymentMethod)}</dd>
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
        </>
      )}

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
              <dt>Payment Type</dt>
              <dd>{prettifyType(selectedPayment.type)}</dd>
            </div>
            <div>
              <dt>Payment Method</dt>
              <dd>{prettifyMethod(selectedPayment.paymentMethod)}</dd>
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
              <dt>Remarks</dt>
              <dd>{selectedPayment.remarks || '-'}</dd>
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
