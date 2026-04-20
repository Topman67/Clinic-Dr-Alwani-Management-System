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

type PaymentType = 'CONSULTATION' | 'APPOINTMENT' | 'MEDICINE';
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
  medicineItems?: Array<{
    itemId: number;
    qty: number;
    unitPrice: number | string;
    subtotal: number | string;
    medicine?: {
      medicineId: number;
      name: string;
      batchNumber: string;
    };
  }>;
};

type WalkInMedicine = {
  medicineId: number;
  name: string;
  batchNumber: string;
  quantity: number;
  price: number | string;
  expiryDate: string;
};

type WalkInFormItem = {
  medicineId: number;
  qty: number;
};

type ReceptionPaymentMode = 'STANDARD' | 'WALKIN';

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

const prettifyType = (t: PaymentType) => {
  if (t === 'CONSULTATION') return 'Consultation Fee';
  if (t === 'APPOINTMENT') return 'Appointment Fee';
  return 'Medicine Sale';
};

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
  const [walkInSaving, setWalkInSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [walkInMedicines, setWalkInMedicines] = useState<WalkInMedicine[]>([]);
  const [walkInItems, setWalkInItems] = useState<WalkInFormItem[]>([]);
  const [walkInMethod, setWalkInMethod] = useState<PaymentMethod>('CASH');
  const [walkInRemarks, setWalkInRemarks] = useState('');
  const [receptionMode, setReceptionMode] = useState<ReceptionPaymentMode>('STANDARD');

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

  const loadWalkInMedicines = useCallback(async () => {
    if (!isReceptionist) {
      setWalkInMedicines([]);
      return;
    }

    try {
      const response = await api.get('/payments/walkin-medicines');
      setWalkInMedicines(response.data as WalkInMedicine[]);
    } catch {
      setWalkInMedicines([]);
    }
  }, [isReceptionist]);

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
        if (isReceptionist) {
          await loadWalkInMedicines();
        }
      } catch {
        setError('Failed to load required data');
      }
    })();
  }, [isDoctor, isReceptionist, loadPatients, loadPayments, loadWalkInMedicines]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void (async () => {
        try {
          await loadPatients(patientSearch);
          if (isDoctor) {
            await loadPayments(buildCurrentFilters());
          }
          if (isReceptionist) {
            await loadWalkInMedicines();
          }
        } catch {
          setError('Failed to sync latest data');
        }
      })();
    });
  }, [buildCurrentFilters, isDoctor, isReceptionist, loadPatients, loadPayments, loadWalkInMedicines, patientSearch]);

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
    setSuccess(null);
    try {
      const response = await api.get('/patients', { params: { query: patientSearch || undefined } });
      const result = response.data as Patient[];
      setPatients(result);

      if (patientSearch.trim() && result.length === 0) {
        setError('Patient record not found.');
        setForm(initialForm);
        setFieldErrors({});
        return;
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to search patients'));
    }
  };

  const onCancelPayment = () => {
    setForm(initialForm);
    setFieldErrors({});
    setError(null);
    setSuccess(null);
    setSelectedPayment(null);
  };

  const getWalkInMedicineById = (medicineId: number) => {
    return walkInMedicines.find((m) => m.medicineId === medicineId) ?? null;
  };

  const addWalkInItem = () => {
    setWalkInItems((prev) => [...prev, { medicineId: 0, qty: 1 }]);
  };

  const removeWalkInItem = (index: number) => {
    setWalkInItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateWalkInItem = (index: number, patch: Partial<WalkInFormItem>) => {
    setWalkInItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const walkInTotal = useMemo(() => {
    return walkInItems.reduce((sum, item) => {
      const medicine = walkInMedicines.find((m) => m.medicineId === item.medicineId);
      if (!medicine) return sum;
      return sum + Number(medicine.price) * item.qty;
    }, 0);
  }, [walkInItems, walkInMedicines]);

  const onSubmitWalkInSale = async (e: FormEvent) => {
    e.preventDefault();
    if (!isReceptionist) return;

    setError(null);
    setSuccess(null);

    const normalizedItems = walkInItems
      .map((item) => ({
        medicineId: Number(item.medicineId),
        qty: Math.trunc(Number(item.qty)),
      }))
      .filter((item) => Number.isInteger(item.medicineId) && item.medicineId > 0 && Number.isInteger(item.qty) && item.qty > 0);

    if (normalizedItems.length === 0) {
      setError('Please add at least one medicine item.');
      return;
    }

    setWalkInSaving(true);
    try {
      const response = await api.post('/payments/walkin-medicine', {
        patientId: form.patientId > 0 ? form.patientId : undefined,
        paymentMethod: walkInMethod,
        remarks: walkInRemarks.trim() || undefined,
        items: normalizedItems,
      });

      const data = response.data as {
        message?: string;
        payment: Payment;
        receipt: Receipt;
        patient: Patient;
        items?: Payment['medicineItems'];
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
        medicineItems: data.items,
      };

      setSuccess(data.message || 'Walk-in Medicine Sale Successful');
      setSelectedPayment(createdPayment);
      setWalkInItems([]);
      setWalkInRemarks('');
      setWalkInMethod('CASH');
      await loadWalkInMedicines();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to record walk-in medicine sale'));
    } finally {
      setWalkInSaving(false);
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
          <div className="action-row" style={{ marginTop: 14 }}>
            <button
              type="button"
              className={receptionMode === 'STANDARD' ? '' : 'btn-secondary'}
              onClick={() => {
                setReceptionMode('STANDARD');
                setError(null);
                setSuccess(null);
              }}
            >
              Standard Payment
            </button>
            <button
              type="button"
              className={receptionMode === 'WALKIN' ? '' : 'btn-secondary'}
              onClick={() => {
                setReceptionMode('WALKIN');
                setError(null);
                setSuccess(null);
              }}
            >
              Walk-in Medicine Sale
            </button>
          </div>

          {receptionMode === 'STANDARD' && (
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
                  <button type="button" className="btn-secondary" onClick={onCancelPayment} disabled={saving}>
                    Cancel
                  </button>
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

          {receptionMode === 'WALKIN' && (
            <form onSubmit={onSubmitWalkInSale} className="form-grid" style={{ marginTop: 14 }}>
              <div className="section-head">
                <h3>Walk-in Medicine Sale</h3>
                <p className="muted">Select medicine items and quantity, then confirm sale for a walk-in customer.</p>
              </div>

              <div className="report-card">
                <small className="muted">This flow is recorded automatically under Walk-in Customer.</small>
              </div>

              <div className="action-row">
                <button type="button" className="btn-secondary" onClick={addWalkInItem}>Add Medicine Item</button>
              </div>

              {walkInItems.map((item, index) => {
                const selectedMedicine = getWalkInMedicineById(item.medicineId);
                const itemSubtotal = selectedMedicine ? Number(selectedMedicine.price) * item.qty : 0;

                return (
                  <div key={`walkin-item-${index}`} className="payments-grid">
                    <select
                      value={item.medicineId || ''}
                      onChange={(e) => updateWalkInItem(index, { medicineId: Number(e.target.value) || 0 })}
                      required
                    >
                      <option value="">Select medicine</option>
                      {walkInMedicines.map((medicine) => (
                        <option key={`${medicine.medicineId}-${medicine.batchNumber}`} value={medicine.medicineId}>
                          {medicine.name} ({medicine.batchNumber}) - Stock: {medicine.quantity}
                        </option>
                      ))}
                    </select>

                    <input
                      type="number"
                      min={1}
                      value={item.qty}
                      onChange={(e) => updateWalkInItem(index, { qty: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })}
                      placeholder="Qty"
                      required
                    />

                    <input
                      value={selectedMedicine ? `RM ${formatMoney(selectedMedicine.price)}` : '-'}
                      readOnly
                      placeholder="Unit Price"
                    />

                    <input
                      value={`RM ${formatMoney(itemSubtotal)}`}
                      readOnly
                      placeholder="Subtotal"
                    />

                    <button type="button" className="btn-danger" onClick={() => removeWalkInItem(index)}>
                      Remove
                    </button>
                  </div>
                );
              })}

              <div className="payments-grid">
                <select
                  value={walkInMethod}
                  onChange={(e) => setWalkInMethod(e.target.value as PaymentMethod)}
                >
                  <option value="CASH">Cash</option>
                  <option value="CARD">Card</option>
                  <option value="ONLINE_TRANSFER">Online Transfer</option>
                  <option value="E_WALLET">E-Wallet</option>
                </select>

                <input value={`Total: RM ${formatMoney(walkInTotal)}`} readOnly />
              </div>

              <textarea
                value={walkInRemarks}
                onChange={(e) => setWalkInRemarks(e.target.value)}
                placeholder="Remarks for walk-in medicine sale (optional)"
                rows={3}
                maxLength={500}
              />

              <div className="action-row">
                <button type="submit" disabled={walkInSaving}>{walkInSaving ? 'Processing...' : 'Confirm Walk-in Sale'}</button>
              </div>
            </form>
          )}
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
            {selectedPayment.medicineItems && selectedPayment.medicineItems.length > 0 && (
              <div style={{ gridColumn: '1 / -1' }}>
                <dt>Medicine Items</dt>
                <dd>
                  {selectedPayment.medicineItems
                    .map(
                      (item) =>
                        `${item.medicine?.name ?? `Medicine #${item.medicine?.medicineId ?? ''}`} (${item.medicine?.batchNumber ?? '-'}) x${item.qty} = RM ${formatMoney(item.subtotal)}`,
                    )
                    .join(' | ')}
                </dd>
              </div>
            )}
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
