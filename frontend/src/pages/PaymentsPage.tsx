import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { subscribeInAppDataSync } from '../lib/sync';
import { useAuth } from '../context/AuthContext';
import { PatientAutocomplete, type PatientAutocompleteOption } from '../components/PatientAutocomplete';
import { DateRangeFilter, getDateRangeForPreset, type DateRangeValue } from '../components/DateRangeFilter';
import { roleBasePath } from '../config/rbac';
import clinicLogo from '../assets/Logo_Clinic_Dr.Alwani.png';

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

type PaymentType = 'CONSULTATION' | 'APPOINTMENT' | 'MEDICAL_CHECKUP' | 'MEDICINE' | 'CUSTOM';
type PaymentMethod = 'CASH' | 'CARD' | 'ONLINE_TRANSFER' | 'E_WALLET';

type PaymentStatus = 'PENDING_PAYMENT' | 'PAID' | 'PENDING_DISPENSE' | 'DISPENSED' | 'CANCELLED';

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
  dispensedAt?: string | null;
  dispensedById?: number | null;
  dispensedByUsername?: string | null;
  patient?: { name: string; icOrPassport?: string; phone?: string; address?: string | null };
  receipt?: Receipt | null;
  consultation?: { consultationId: number; appointmentId?: number | null; consultationType?: string; status: string; createdAt: string } | null;
  prescription?: { prescriptionId: number; status: string; date: string } | null;
  appointment?: { appointmentId: number; status: string; type?: string; dateTime: string } | null;
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
  category?: 'MEDICINE' | 'SUPPLEMENT' | 'VITAMIN' | 'CONTROLLED_MEDICINE';
  brand?: string | null;
  packaging?: string | null;
  batchNumber: string;
  quantity: number;
  price: number | string;
  expiryDate: string;
};

type WalkInFormItem = {
  medicineId: number;
  qty: number;
};

type WalkInCategoryFilter = 'ALL' | NonNullable<WalkInMedicine['category']>;

type ReceptionPaymentMode = 'PENDING' | 'WALKIN';

const formatMoney = (value: number | string) => {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
};

const CONSULTATION_FEE_OPTIONS = [10, 15, 20, 25, 30];
const DEFAULT_CONSULTATION_FEE = 20;
const APPOINTMENT_FEE = 5;
const MEDICAL_CHECKUP_FEE = 40;

const toDateInput = (value: string | null | undefined) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toISOString().slice(0, 10);
};

const prettifyType = (t: PaymentType) => {
  if (t === 'CONSULTATION') return 'Consultation';
  if (t === 'APPOINTMENT') return 'Appointment';
  if (t === 'MEDICAL_CHECKUP') return 'Medical Checkup';
  if (t === 'CUSTOM') return 'Payment';
  return 'Medicine Sale';
};

const prettifyMethod = (method: PaymentMethod) => {
  if (method === 'ONLINE_TRANSFER') return 'Online Transfer';
  if (method === 'E_WALLET') return 'E-Wallet';
  return method.charAt(0) + method.slice(1).toLowerCase();
};

const statusLabel = (status: PaymentStatus) => {
  if (status === 'PENDING_PAYMENT') return 'Pending Payment';
  if (status === 'PENDING_DISPENSE') return 'Pending Dispense';
  return status.charAt(0) + status.slice(1).toLowerCase();
};

const statusClass = (status: PaymentStatus) => {
  if (status === 'DISPENSED' || status === 'PAID') return 'status-good';
  if (status === 'PENDING_DISPENSE') return 'status-pending-dispense';
  if (status === 'CANCELLED') return 'status-critical';
  return 'status-warning';
};

export const PaymentsPage = () => {
  const { role } = useAuth();
  const isDoctor = role === 'DOCTOR';
  const isReceptionist = role === 'RECEPTIONIST';
  const navigate = useNavigate();

  const [payments, setPayments] = useState<Payment[]>([]);
  const [pendingPayments, setPendingPayments] = useState<Payment[]>([]);
  const [selectedFilterPatient, setSelectedFilterPatient] = useState<PatientAutocompleteOption | null>(null);
  const [queryType, setQueryType] = useState<PaymentType | ''>('');
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => getDateRangeForPreset('today'));
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [walkInSaving, setWalkInSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [walkInMedicines, setWalkInMedicines] = useState<WalkInMedicine[]>([]);
  const [walkInItems, setWalkInItems] = useState<WalkInFormItem[]>([]);
  const [walkInMethod, setWalkInMethod] = useState<PaymentMethod>('CASH');
  const [confirmMethod, setConfirmMethod] = useState<PaymentMethod>('CASH');
  const [confirmConsultationFee, setConfirmConsultationFee] = useState(DEFAULT_CONSULTATION_FEE);
  const [confirmRemarks, setConfirmRemarks] = useState('');
  const [walkInRemarks, setWalkInRemarks] = useState('');
  const [walkInCustomerName, setWalkInCustomerName] = useState('');
  const [walkInCustomerPhone, setWalkInCustomerPhone] = useState('');
  const [walkInCustomerId, setWalkInCustomerId] = useState('');
  const [medicinePickerOpen, setMedicinePickerOpen] = useState(false);
  const [medicinePickerSearch, setMedicinePickerSearch] = useState('');
  const [medicinePickerCategory, setMedicinePickerCategory] = useState<WalkInCategoryFilter>('ALL');
  const [receptionMode, setReceptionMode] = useState<ReceptionPaymentMode>('PENDING');

  const getApiErrorMessage = (err: unknown, fallback: string) => {
    if (typeof err === 'object' && err !== null) {
      const response = (err as { response?: { data?: { message?: string } } }).response;
      const message = response?.data?.message;
      if (typeof message === 'string' && message.trim()) return message;
    }
    return fallback;
  };

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

  const loadPendingPayments = useCallback(async () => {
    if (!isReceptionist) {
      setPendingPayments([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/payments/pending');
      setPendingPayments(response.data as Payment[]);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load pending payments'));
    } finally {
      setLoading(false);
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
      patientId: selectedFilterPatient?.patientId,
      type: queryType || undefined,
      dateFrom: dateRange.dateFrom || undefined,
      dateTo: dateRange.dateTo || undefined,
    };
  }, [dateRange.dateFrom, dateRange.dateTo, queryType, selectedFilterPatient]);

  useEffect(() => {
    void (async () => {
      try {
        if (isDoctor) {
          await loadPayments(buildCurrentFilters());
        }
        if (isReceptionist) {
          await loadPendingPayments();
          await loadWalkInMedicines();
        }
      } catch {
        setError('Failed to load required data');
      }
    })();
  }, [buildCurrentFilters, isDoctor, isReceptionist, loadPayments, loadPendingPayments, loadWalkInMedicines]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void (async () => {
        try {
          if (isDoctor) {
            await loadPayments(buildCurrentFilters());
          }
          if (isReceptionist) {
            await loadPendingPayments();
            await loadWalkInMedicines();
          }
        } catch {
          setError('Failed to sync latest data');
        }
      })();
    });
  }, [buildCurrentFilters, isDoctor, isReceptionist, loadPayments, loadPendingPayments, loadWalkInMedicines]);

  const getWalkInMedicineById = (medicineId: number) => {
    return walkInMedicines.find((m) => m.medicineId === medicineId) ?? null;
  };

  const goToSales = () => {
    if (!role) return;
    navigate(`${roleBasePath[role]}/sales`);
  };

  const categoryLabel = (category: WalkInMedicine['category']) => {
    if (category === 'CONTROLLED_MEDICINE') return 'Controlled';
    if (category === 'SUPPLEMENT') return 'Supplement';
    if (category === 'VITAMIN') return 'Vitamin';
    return 'Medicine';
  };

  const fefoMedicineOptions = useMemo(() => {
    const byName = new Map<string, WalkInMedicine>();
    [...walkInMedicines]
      .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime())
      .forEach((medicine) => {
        const key = `${medicine.name.toLowerCase()}::${medicine.category ?? 'MEDICINE'}`;
        if (!byName.has(key)) byName.set(key, medicine);
      });
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [walkInMedicines]);

  const filteredMedicineOptions = useMemo(() => {
    const q = medicinePickerSearch.trim().toLowerCase();
    return fefoMedicineOptions.filter((medicine) => {
      const matchesCategory = medicinePickerCategory === 'ALL' || medicine.category === medicinePickerCategory;
      if (!matchesCategory) return false;
      if (!q) return true;
      return [medicine.name, medicine.batchNumber, medicine.brand, categoryLabel(medicine.category)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q));
    });
  }, [fefoMedicineOptions, medicinePickerCategory, medicinePickerSearch]);

  const addWalkInItem = (medicineId: number) => {
    setWalkInItems((prev) => {
      const existingIndex = prev.findIndex((item) => item.medicineId === medicineId);
      if (existingIndex >= 0) {
        return prev.map((item, index) => (index === existingIndex ? { ...item, qty: item.qty + 1 } : item));
      }
      return [...prev, { medicineId, qty: 1 }];
    });
    setMedicinePickerOpen(false);
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

  const getMedicineTotal = (payment: Payment) => {
    return payment.medicineItems?.reduce((sum, item) => sum + Number(item.subtotal), 0) ?? 0;
  };

  const hasAppointmentConsultation = (payment: Payment) => {
    return Boolean(payment.consultation?.appointmentId);
  };

  const isAdjustableConsultationPayment = (payment: Payment) => {
    return payment.type === 'CONSULTATION' && Boolean(payment.consultation?.consultationId);
  };

  const getConsultationFee = (payment: Payment) => {
    if (payment.type === 'MEDICAL_CHECKUP') return 0;
    if (payment.type !== 'CONSULTATION') return 0;
    const fee = Number(payment.amount) - getMedicineTotal(payment) - (hasAppointmentConsultation(payment) ? APPOINTMENT_FEE : 0);
    return CONSULTATION_FEE_OPTIONS.includes(fee) ? fee : DEFAULT_CONSULTATION_FEE;
  };

  const getAppointmentFee = (payment: Payment) => {
    if (payment.type === 'MEDICAL_CHECKUP') return 0;
    if (hasAppointmentConsultation(payment) || payment.type === 'APPOINTMENT') return APPOINTMENT_FEE;
    return 0;
  };

  const getMedicalCheckupFee = (payment: Payment) => {
    return payment.type === 'MEDICAL_CHECKUP' ? MEDICAL_CHECKUP_FEE : 0;
  };

  const getDisplayedConsultationFee = (payment: Payment) => {
    if (payment.status === 'PENDING_PAYMENT' && isAdjustableConsultationPayment(payment)) {
      return confirmConsultationFee;
    }
    return getConsultationFee(payment);
  };

  const getPaymentTypeLabel = (payment: Payment) => {
    if (payment.type === 'MEDICAL_CHECKUP') return 'Medical Checkup';
    if (payment.type === 'CONSULTATION' && hasAppointmentConsultation(payment)) return 'Appointment + Consultation';
    return prettifyType(payment.type);
  };

  const getDisplayTotal = (payment: Payment) => {
    if (payment.receipt) return Number(payment.receipt.totalAmount);
    if (payment.status === 'PENDING_PAYMENT' && isAdjustableConsultationPayment(payment)) {
      return confirmConsultationFee + getAppointmentFee(payment) + getMedicineTotal(payment);
    }
    if (payment.type === 'MEDICAL_CHECKUP') return MEDICAL_CHECKUP_FEE;
    return Number(payment.amount);
  };

  const getReferenceLabel = (payment: Payment) => {
    if (payment.consultation?.consultationId) return `Consultation #${payment.consultation.consultationId}`;
    if (payment.appointment?.appointmentId) return `Appointment #${payment.appointment.appointmentId}`;
    if (payment.prescription?.prescriptionId) return `Prescription #${payment.prescription.prescriptionId}`;
    return `Payment #${payment.paymentId}`;
  };

  useEffect(() => {
    if (!selectedPayment) return;
    setConfirmConsultationFee(getConsultationFee(selectedPayment));
  }, [selectedPayment]);

  const onConfirmPendingPayment = async () => {
    if (!selectedPayment || selectedPayment.status !== 'PENDING_PAYMENT') return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await api.post(`/payments/${selectedPayment.paymentId}/confirm`, {
        paymentMethod: confirmMethod,
        consultationFee: isAdjustableConsultationPayment(selectedPayment) ? confirmConsultationFee : undefined,
        remarks: confirmRemarks.trim() || undefined,
      });
      const data = response.data as { message?: string; payment: Payment; receipt: Receipt };
      const paidPayment = { ...data.payment, receipt: data.receipt };
      setSelectedPayment(paidPayment);
      setSuccess(data.message || 'Payment Successful');
      setConfirmMethod('CASH');
      setConfirmConsultationFee(DEFAULT_CONSULTATION_FEE);
      setConfirmRemarks('');
      await loadPendingPayments();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to confirm payment'));
    } finally {
      setSaving(false);
    }
  };

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
        customerName: walkInCustomerName.trim() || undefined,
        customerPhone: walkInCustomerPhone.trim() || undefined,
        customerId: walkInCustomerId.trim() || undefined,
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

      setSuccess(`${data.message || 'Walk-in Medicine Sale Successful'} (Customer ID: ${data.patient.icOrPassport || '-'})`);
      setSelectedPayment(createdPayment);
      setWalkInItems([]);
      setWalkInRemarks('');
      setWalkInMethod('CASH');
      setWalkInCustomerName('');
      setWalkInCustomerPhone('');
      setWalkInCustomerId('');
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
          <PatientAutocomplete
            selectedPatient={selectedFilterPatient}
            onSelect={(patient) => {
              setSelectedFilterPatient(patient);
              void loadPayments({
                patientId: patient?.patientId,
                type: queryType || undefined,
                dateFrom: dateRange.dateFrom || undefined,
                dateTo: dateRange.dateTo || undefined,
              });
            }}
            placeholder="Filter payments by patient"
          />

          <select value={queryType} onChange={(e) => setQueryType((e.target.value as PaymentType | '') || '')}>
            <option value="">All types</option>
            <option value="CONSULTATION">Consultation</option>
            <option value="APPOINTMENT">Appointment</option>
            <option value="MEDICAL_CHECKUP">Medical Checkup</option>
          </select>

          <DateRangeFilter value={dateRange} onChange={setDateRange} includeAll />

          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setSelectedFilterPatient(null);
              setQueryType('');
              setDateRange(getDateRangeForPreset('today'));
              void loadPayments(getDateRangeForPreset('today'));
            }}
          >
            Reset
          </button>

          <button type="submit" className="btn-secondary">Search</button>
        </form>
      )}

      {isReceptionist && (
        <>
          <div className="action-row" style={{ marginTop: 14 }}>
            <button
              type="button"
              className={receptionMode === 'PENDING' ? '' : 'btn-secondary'}
              onClick={() => {
                setReceptionMode('PENDING');
                setError(null);
                setSuccess(null);
              }}
            >
              Pending Payments
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

          {receptionMode === 'PENDING' && (
            <section className="pending-payment-workflow" style={{ marginTop: 14 }}>
              <div className="section-head">
                <h3>Pending Payment List</h3>
                <p className="muted">Payments appear here after consultation completion, prescription dispense, medical checkup send-to-payment, or appointment completion.</p>
              </div>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Patient Name</th>
                      <th>Patient ID</th>
                      <th>Reference</th>
                      <th>Payment Type</th>
                      <th>Status</th>
                      <th>Total Amount</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingPayments.map((p) => (
                      <tr key={p.paymentId}>
                        <td>{p.patient?.name ?? `Patient #${p.patientId}`}</td>
                        <td>{p.patient?.icOrPassport || p.patientId}</td>
                        <td>{getReferenceLabel(p)}</td>
                        <td><span className={`status-badge ${p.type === 'MEDICAL_CHECKUP' ? 'type-medical' : p.type === 'CONSULTATION' ? 'type-consultation' : 'type-appointment'}`}>{getPaymentTypeLabel(p)}</span></td>
                        <td><span className={`status-badge ${statusClass(p.status)}`}>{statusLabel(p.status)}</span></td>
                        <td>RM {formatMoney(p.type === 'MEDICAL_CHECKUP' ? MEDICAL_CHECKUP_FEE : p.amount)}</td>
                        <td>
                          <div className="action-row">
                            <button type="button" className="btn-secondary" onClick={() => setSelectedPayment(p)}>View Details</button>
                            <button type="button" onClick={() => setSelectedPayment(p)}>Pay Now</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="mobile-cards">
                {pendingPayments.map((p) => (
                  <article key={`pending-card-${p.paymentId}`} className="mobile-card">
                    <h4>{p.patient?.name ?? `Patient #${p.patientId}`}</h4>
                    <dl className="kv">
                      <div><dt>Patient ID</dt><dd>{p.patient?.icOrPassport || p.patientId}</dd></div>
                      <div><dt>Reference</dt><dd>{getReferenceLabel(p)}</dd></div>
                      <div><dt>Type</dt><dd>{getPaymentTypeLabel(p)}</dd></div>
                      <div><dt>Status</dt><dd><span className={`status-badge ${statusClass(p.status)}`}>{statusLabel(p.status)}</span></dd></div>
                      <div><dt>Total</dt><dd>RM {formatMoney(p.type === 'MEDICAL_CHECKUP' ? MEDICAL_CHECKUP_FEE : p.amount)}</dd></div>
                    </dl>
                    <div className="action-row" style={{ marginTop: 10 }}>
                      <button type="button" className="btn-secondary" onClick={() => setSelectedPayment(p)}>View Details</button>
                      <button type="button" onClick={() => setSelectedPayment(p)}>Pay Now</button>
                    </div>
                  </article>
                ))}
              </div>

              {!loading && pendingPayments.length === 0 && <p className="muted">No pending clinic payments right now.</p>}
            </section>
          )}

          {receptionMode === 'WALKIN' && (
            <form onSubmit={onSubmitWalkInSale} className="form-grid" style={{ marginTop: 14 }}>
              <div className="section-head">
                <h3>Walk-in Medicine Sale</h3>
                <p className="muted">Create paid sales for pharmacist dispensing. Stock is deducted when the pharmacist dispenses.</p>
              </div>

              <section className="walkin-sale-layout">
                <div className="card walkin-sale-card">
                  <div className="compact-section-head">
                    <h3>Customer Information</h3>
                    <p className="muted">Optional. The system auto-generates an ID if left blank.</p>
                  </div>
                  <div className="walkin-customer-grid">
                    <input value={walkInCustomerName} onChange={(e) => setWalkInCustomerName(e.target.value)} placeholder="Customer name" maxLength={120} />
                    <input value={walkInCustomerPhone} onChange={(e) => setWalkInCustomerPhone(e.target.value)} placeholder="Customer phone" maxLength={30} />
                    <input value={walkInCustomerId} onChange={(e) => setWalkInCustomerId(e.target.value)} placeholder="Customer ID" maxLength={60} />
                  </div>
                </div>

                <div className="card walkin-sale-card walkin-items-card">
                  <div className="prescription-items-head">
                    <div>
                      <h4>Medicine Items</h4>
                      <p className="muted">FEFO batch is selected automatically.</p>
                    </div>
                    <button type="button" className="btn-secondary" onClick={() => setMedicinePickerOpen(true)}>Add Medicine</button>
                  </div>

                  <div className="walkin-items-list">
                    {walkInItems.map((item, index) => {
                      const selectedMedicine = getWalkInMedicineById(item.medicineId);
                      const itemSubtotal = selectedMedicine ? Number(selectedMedicine.price) * item.qty : 0;

                      return (
                        <div key={`walkin-item-${item.medicineId}`} className="walkin-item-row">
                          <div className="walkin-item-name">
                            <strong>{selectedMedicine?.name ?? 'Medicine'}</strong>
                            <small>{selectedMedicine ? `${categoryLabel(selectedMedicine.category)} - Batch ${selectedMedicine.batchNumber} - Exp ${toDateInput(selectedMedicine.expiryDate)}` : '-'}</small>
                          </div>
                          <label>
                            <span>Qty</span>
                            <input type="number" min={1} value={item.qty} onChange={(e) => updateWalkInItem(index, { qty: Math.max(1, Math.trunc(Number(e.target.value) || 1)) })} required />
                          </label>
                          <label>
                            <span>Unit Price</span>
                            <input value={selectedMedicine ? `RM ${formatMoney(selectedMedicine.price)}` : '-'} readOnly />
                          </label>
                          <label>
                            <span>Subtotal</span>
                            <input value={`RM ${formatMoney(itemSubtotal)}`} readOnly />
                          </label>
                          <button type="button" className="prescription-remove-item" onClick={() => removeWalkInItem(index)}>Remove</button>
                        </div>
                      );
                    })}
                    {walkInItems.length === 0 && <p className="walkin-empty">No medicines selected yet.</p>}
                  </div>
                </div>

                <div className="card walkin-sale-card">
                  <div className="compact-section-head">
                    <h3>Payment Information</h3>
                  </div>
                  <select value={walkInMethod} onChange={(e) => setWalkInMethod(e.target.value as PaymentMethod)}>
                    <option value="CASH">Cash</option>
                    <option value="CARD">Card</option>
                    <option value="ONLINE_TRANSFER">Online Transfer</option>
                    <option value="E_WALLET">E-Wallet</option>
                  </select>
                  <textarea value={walkInRemarks} onChange={(e) => setWalkInRemarks(e.target.value)} placeholder="Remarks for walk-in medicine sale (optional)" rows={3} maxLength={500} />
                </div>

                <div className="card walkin-sale-card walkin-summary-card">
                  <div className="compact-section-head">
                    <h3>Receipt Summary</h3>
                  </div>
                  <dl className="kv">
                    <div><dt>Items</dt><dd>{walkInItems.length}</dd></div>
                    <div><dt>Total</dt><dd>RM {formatMoney(walkInTotal)}</dd></div>
                    <div><dt>Status After Payment</dt><dd><span className="status-badge status-pending-dispense">Pending Dispense</span></dd></div>
                  </dl>
                  <button type="submit" disabled={walkInSaving}>{walkInSaving ? 'Processing...' : 'Confirm Payment'}</button>
                </div>
              </section>

              {medicinePickerOpen && (
                <div className="medicine-picker-modal-layer" role="presentation">
                  <button type="button" className="medicine-picker-modal-backdrop" aria-label="Close medicine picker" onClick={() => setMedicinePickerOpen(false)} />
                  <section className="medicine-picker-modal walkin-medicine-modal" role="dialog" aria-modal="true" aria-labelledby="walkin-picker-title">
                    <div className="medicine-picker-modal-head">
                      <div>
                        <h3 id="walkin-picker-title">Select Medicine</h3>
                        <p className="muted">Search by medicine name, category, or batch. FEFO picks the nearest valid expiry.</p>
                      </div>
                      <button type="button" className="patient-drawer-close" onClick={() => setMedicinePickerOpen(false)}>X</button>
                    </div>
                    <div className="walkin-picker-body">
                      <aside className="walkin-picker-categories">
                        {(['ALL', 'MEDICINE', 'VITAMIN', 'SUPPLEMENT', 'CONTROLLED_MEDICINE'] as WalkInCategoryFilter[]).map((category) => (
                          <button key={category} type="button" className={medicinePickerCategory === category ? 'is-active' : undefined} onClick={() => setMedicinePickerCategory(category)}>
                            {category === 'ALL' ? 'All' : categoryLabel(category)}
                          </button>
                        ))}
                      </aside>
                      <div className="walkin-picker-results">
                        <input value={medicinePickerSearch} onChange={(e) => setMedicinePickerSearch(e.target.value)} placeholder="Search medicine, category, batch" autoFocus />
                        <div className="walkin-medicine-list">
                          {filteredMedicineOptions.map((medicine) => (
                            <article key={`pick-${medicine.medicineId}`} className="walkin-medicine-card">
                              <div>
                                <strong>{medicine.name}</strong>
                                <small>{categoryLabel(medicine.category)} - Batch {medicine.batchNumber}</small>
                              </div>
                              <span>Stock {medicine.quantity}</span>
                              <span>Exp {toDateInput(medicine.expiryDate)}</span>
                              <span>RM {formatMoney(medicine.price)}</span>
                              <span className="status-badge status-good">Available</span>
                              <button type="button" onClick={() => addWalkInItem(medicine.medicineId)}>Add</button>
                            </article>
                          ))}
                          {filteredMedicineOptions.length === 0 && <p className="walkin-empty">No medicine found.</p>}
                        </div>
                      </div>
                    </div>
                  </section>
                </div>
              )}
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
                    <td><span className={`status-badge ${p.type === 'MEDICAL_CHECKUP' ? 'type-medical' : p.type === 'CONSULTATION' ? 'type-consultation' : 'type-appointment'}`}>{getPaymentTypeLabel(p)}</span></td>
                    <td>{formatMoney(p.amount)}</td>
                    <td>{prettifyMethod(p.paymentMethod)}</td>
                    <td><span className={`status-badge ${statusClass(p.status)}`}>{statusLabel(p.status)}</span></td>
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
                    <dd><span className={`status-badge ${p.type === 'MEDICAL_CHECKUP' ? 'type-medical' : p.type === 'CONSULTATION' ? 'type-consultation' : 'type-appointment'}`}>{getPaymentTypeLabel(p)}</span></dd>
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
        <section className="card sales-detail-panel receipt-panel receipt-print-area">
          <div className="receipt-print-header">
            <img src={clinicLogo} alt="Clinic Dr Alwani" />
            <div>
              <h2>Clinic Dr Alwani</h2>
              <p>Official Payment Receipt</p>
            </div>
          </div>
          <div className="sales-detail-head">
            <div>
              <h3>{selectedPayment.status === 'PAID' ? 'Payment Successful' : 'Payment Summary'}</h3>
              <p className="muted">{getReferenceLabel(selectedPayment)} · Payment #{selectedPayment.paymentId}</p>
            </div>
            <span className={`status-badge ${statusClass(selectedPayment.status)}`}>{statusLabel(selectedPayment.status)}</span>
          </div>

          <div className="sales-detail-grid">
            <section className="sales-detail-card sales-detail-wide">
              <div className="sales-summary-strip">
                <div><span>Receipt Number</span><strong>{selectedPayment.receipt?.receiptNo ?? '-'}</strong></div>
                <div><span>Payment Date</span><strong>{new Date(selectedPayment.date).toLocaleString()}</strong></div>
                <div><span>Total</span><strong>RM {formatMoney(getDisplayTotal(selectedPayment))}</strong></div>
              </div>
              {selectedPayment.status === 'PENDING_PAYMENT' && isReceptionist && (
                <div className="pending-confirm-box">
                  {isAdjustableConsultationPayment(selectedPayment) && (
                    <label className="field-inline">
                      <span>Consultation Fee</span>
                      <select value={confirmConsultationFee} onChange={(e) => setConfirmConsultationFee(Number(e.target.value))}>
                        {CONSULTATION_FEE_OPTIONS.map((fee) => (
                          <option key={fee} value={fee}>RM {fee}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {selectedPayment.type === 'MEDICAL_CHECKUP' && (
                    <div className="readonly-fee-pill">Medical Checkup Fee: RM {formatMoney(MEDICAL_CHECKUP_FEE)}</div>
                  )}
                  <select value={confirmMethod} onChange={(e) => setConfirmMethod(e.target.value as PaymentMethod)}>
                    <option value="CASH">Cash</option>
                    <option value="CARD">Card</option>
                    <option value="ONLINE_TRANSFER">Online Transfer</option>
                    <option value="E_WALLET">E-Wallet</option>
                  </select>
                  <input value={confirmRemarks} onChange={(e) => setConfirmRemarks(e.target.value)} placeholder="Payment remarks (optional)" maxLength={500} />
                  <button type="button" onClick={onConfirmPendingPayment} disabled={saving}>{saving ? 'Processing...' : 'Confirm Payment'}</button>
                </div>
              )}
              <div className="sales-detail-actions">
                <button type="button" className="btn-secondary" onClick={() => window.print()}>Print Receipt</button>
                {selectedPayment.type === 'MEDICINE' && <button type="button" className="btn-secondary" onClick={goToSales}>Go To Sales</button>}
                <button type="button" className="btn-secondary" onClick={() => setSelectedPayment(null)}>Close</button>
              </div>
            </section>

            <section className="sales-detail-card">
              <h4>Patient Information</h4>
              <dl className="sales-detail-kv">
                <div><dt>Patient Name</dt><dd>{selectedPayment.patient?.name ?? `Patient #${selectedPayment.patientId}`}</dd></div>
                <div><dt>Patient ID</dt><dd>{selectedPayment.patient?.icOrPassport || '-'}</dd></div>
                <div><dt>Phone Number</dt><dd>{selectedPayment.patient?.phone || 'Not provided'}</dd></div>
                <div><dt>Payment Method</dt><dd>{prettifyMethod(selectedPayment.paymentMethod)}</dd></div>
              </dl>
            </section>

            <section className="sales-detail-card">
              <h4>Consultation / Appointment</h4>
              <dl className="sales-detail-kv">
                <div><dt>Consultation ID</dt><dd>{selectedPayment.consultation?.consultationId ? `#${selectedPayment.consultation.consultationId}` : '-'}</dd></div>
                <div><dt>Appointment ID</dt><dd>{selectedPayment.appointment?.appointmentId ? `#${selectedPayment.appointment.appointmentId}` : '-'}</dd></div>
                <div><dt>Prescription ID</dt><dd>{selectedPayment.prescription?.prescriptionId ? `#${selectedPayment.prescription.prescriptionId}` : '-'}</dd></div>
                <div><dt>Payment Type</dt><dd>{getPaymentTypeLabel(selectedPayment)}</dd></div>
                {selectedPayment.type === 'MEDICAL_CHECKUP' ? (
                  <div><dt>Medical Checkup Fee</dt><dd>RM {formatMoney(getMedicalCheckupFee(selectedPayment))}</dd></div>
                ) : (
                  <>
                    <div><dt>Consultation Fee</dt><dd>RM {formatMoney(getDisplayedConsultationFee(selectedPayment))}</dd></div>
                    <div><dt>Appointment Fee</dt><dd>RM {formatMoney(getAppointmentFee(selectedPayment))}</dd></div>
                  </>
                )}
              </dl>
            </section>

            <section className="sales-detail-card sales-detail-wide">
              <h4>Medicine Items</h4>
              {selectedPayment.medicineItems && selectedPayment.medicineItems.length > 0 ? (
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
                        {selectedPayment.medicineItems.map((item) => (
                          <tr key={`receipt-item-${item.itemId}`}>
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
                    <span>Medicine Total</span>
                    <strong>RM {formatMoney(getMedicineTotal(selectedPayment))}</strong>
                  </div>
                </>
              ) : (
                <p className="muted">No medicine items for this payment.</p>
              )}
            </section>

            <section className="sales-detail-card sales-detail-wide">
              <h4>Payment Breakdown</h4>
              <dl className="receipt-breakdown">
                {selectedPayment.type === 'MEDICAL_CHECKUP' ? (
                  <div><dt>Medical Checkup Fee</dt><dd>RM {formatMoney(getMedicalCheckupFee(selectedPayment))}</dd></div>
                ) : (
                  <>
                    <div><dt>Consultation Fee</dt><dd>RM {formatMoney(getDisplayedConsultationFee(selectedPayment))}</dd></div>
                    <div><dt>Appointment Fee</dt><dd>RM {formatMoney(getAppointmentFee(selectedPayment))}</dd></div>
                  </>
                )}
                <div><dt>Medicine Total</dt><dd>RM {formatMoney(getMedicineTotal(selectedPayment))}</dd></div>
                <div className="receipt-breakdown-total"><dt>Grand Total</dt><dd>RM {formatMoney(getDisplayTotal(selectedPayment))}</dd></div>
              </dl>
            </section>
          </div>
        </section>
      )}
    </section>
  );
};
