import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';
import { subscribeInAppDataSync } from '../lib/sync';
import { useAuth } from '../context/AuthContext';

type ReportType = 'PATIENT' | 'PRESCRIPTION' | 'INVENTORY' | 'PAYMENT' | 'RECEIPT';
type PaymentType = 'CONSULTATION' | 'APPOINTMENT';

type PatientOption = {
  patientId: number;
  name: string;
};

type MedicineOption = {
  medicineId: number;
  name: string;
  batchNumber: string;
};

type PatientReportItem = {
  patientId: number;
  name: string;
  icOrPassport: string;
  phone: string;
  address?: string | null;
  createdAt: string;
  prescriptionsCount: number;
  paymentsCount: number;
  totalPaid: number;
};

type PrescriptionReportItem = {
  prescriptionId: number;
  date: string;
  patient: { patientId: number; name: string; icOrPassport: string };
  doctor: { userId: number; username: string };
  items: Array<{
    pmId: number;
    qty: number;
    dosage: string;
    frequency: string;
    duration: string;
    medicine: { medicineId: number; name: string; batchNumber: string };
  }>;
};

type MedicineReportItem = {
  medicineId: number;
  name: string;
  batchNumber: string;
  quantity: number;
  expiryDate: string;
  price: number | string;
};

type PaymentReportItem = {
  paymentId: number;
  date: string;
  type: PaymentType;
  amount: number | string;
  patient?: { patientId: number; name: string };
  receipt?: { receiptNo: string } | null;
};

type PaymentSummaryResponse = {
  count: number;
  total: number;
  payments: PaymentReportItem[];
};

type ReceiptReportItem = {
  receiptId: number;
  receiptNo: string;
  date: string;
  totalAmount: number | string;
  payment?: {
    paymentId: number;
    type: PaymentType;
    patient?: { name: string };
  };
};

type Filters = {
  dateFrom: string;
  dateTo: string;
  patientId: number | '';
  medicineId: number | '';
  paymentType: PaymentType | '';
  receiptNo: string;
  query: string;
  expiringDays: number;
};

const initialFilters: Filters = {
  dateFrom: '',
  dateTo: '',
  patientId: '',
  medicineId: '',
  paymentType: '',
  receiptNo: '',
  query: '',
  expiringDays: 30,
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

const prettifyPaymentType = (value: PaymentType) => (value === 'CONSULTATION' ? 'Consultation Fee' : 'Appointment Fee');

const getApiErrorMessage = (err: unknown, fallback: string) => {
  if (typeof err === 'object' && err !== null) {
    const response = (err as { response?: { data?: { message?: string } } }).response;
    const message = response?.data?.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
};

export const ReportsPage = () => {
  const { role } = useAuth();
  const canReadMedicine = role === 'DOCTOR' || role === 'PHARMACIST';

  const [reportType, setReportType] = useState<ReportType>('PAYMENT');
  const [filters, setFilters] = useState<Filters>(initialFilters);

  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [medicines, setMedicines] = useState<MedicineOption[]>([]);

  const [patientItems, setPatientItems] = useState<PatientReportItem[]>([]);
  const [prescriptionItems, setPrescriptionItems] = useState<PrescriptionReportItem[]>([]);
  const [lowStockItems, setLowStockItems] = useState<MedicineReportItem[]>([]);
  const [expiringItems, setExpiringItems] = useState<MedicineReportItem[]>([]);
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummaryResponse | null>(null);
  const [receiptItems, setReceiptItems] = useState<ReceiptReportItem[]>([]);

  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLookups = useCallback(async () => {
    const patientsRes = await api.get('/patients', { params: { query: undefined } });
    setPatients((patientsRes.data as PatientOption[]) ?? []);

    if (!canReadMedicine) {
      setMedicines([]);
      return;
    }

    try {
      const medicinesRes = await api.get('/medicine', { params: { query: undefined } });
      setMedicines((medicinesRes.data as MedicineOption[]) ?? []);
    } catch {
      setMedicines([]);
    }
  }, [canReadMedicine]);

  const validateFilters = useCallback(() => {
    if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
      setError('Date from cannot be later than date to.');
      return false;
    }
    return true;
  }, [filters.dateFrom, filters.dateTo]);

  const generateReport = useCallback(async () => {
    if (!validateFilters()) return;

    setLoading(true);
    setError(null);
    try {
      if (reportType === 'PATIENT') {
        const response = await api.get('/reports/patients', {
          params: {
            query: filters.query || undefined,
          },
        });
        setPatientItems(response.data as PatientReportItem[]);
      }

      if (reportType === 'PRESCRIPTION') {
        const response = await api.get('/reports/prescriptions', {
          params: {
            patientId: filters.patientId || undefined,
            medicineId: filters.medicineId || undefined,
            dateFrom: filters.dateFrom || undefined,
            dateTo: filters.dateTo || undefined,
          },
        });
        setPrescriptionItems(response.data as PrescriptionReportItem[]);
      }

      if (reportType === 'INVENTORY') {
        const [lowStockRes, expiringRes] = await Promise.all([
          api.get('/reports/inventory/low-stock'),
          api.get('/reports/inventory/expiring', {
            params: {
              days: filters.expiringDays,
            },
          }),
        ]);

        setLowStockItems(lowStockRes.data as MedicineReportItem[]);
        setExpiringItems(expiringRes.data as MedicineReportItem[]);
      }

      if (reportType === 'PAYMENT') {
        const response = await api.get('/reports/payments', {
          params: {
            type: filters.paymentType || undefined,
            dateFrom: filters.dateFrom || undefined,
            dateTo: filters.dateTo || undefined,
          },
        });
        setPaymentSummary(response.data as PaymentSummaryResponse);
      }

      if (reportType === 'RECEIPT') {
        const response = await api.get('/reports/receipts', {
          params: {
            type: filters.paymentType || undefined,
            receiptNo: filters.receiptNo || undefined,
            dateFrom: filters.dateFrom || undefined,
            dateTo: filters.dateTo || undefined,
          },
        });
        setReceiptItems(response.data as ReceiptReportItem[]);
      }

      setGeneratedAt(new Date().toISOString());
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to generate report.'));
    } finally {
      setLoading(false);
    }
  }, [filters, reportType, validateFilters]);

  useEffect(() => {
    void (async () => {
      try {
        await loadLookups();
        await generateReport();
      } catch {
        setError('Failed to load report module.');
      }
    })();
  }, [generateReport, loadLookups]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void generateReport();
    });
  }, [generateReport]);

  const exportCsv = () => {
    const lines: string[] = [];

    if (reportType === 'PATIENT') {
      lines.push('Patient ID,Name,IC/Passport,Phone,Address,Prescriptions,Payments,Total Paid');
      patientItems.forEach((item) => {
        lines.push(
          `${item.patientId},"${item.name}","${item.icOrPassport}","${item.phone}","${item.address ?? ''}",${item.prescriptionsCount},${item.paymentsCount},${formatMoney(item.totalPaid)}`,
        );
      });
    }

    if (reportType === 'PRESCRIPTION') {
      lines.push('Prescription ID,Date,Patient,Doctor,Medicines');
      prescriptionItems.forEach((item) => {
        const medicinesSummary = item.items.map((it) => `${it.medicine.name} x${it.qty}`).join(' | ');
        lines.push(
          `${item.prescriptionId},"${new Date(item.date).toLocaleString()}","${item.patient.name}","${item.doctor.username}","${medicinesSummary}"`,
        );
      });
    }

    if (reportType === 'INVENTORY') {
      lines.push('Alert Type,Medicine,Batch,Quantity,Expiry Date,Days To Expiry');
      lowStockItems.forEach((item) => {
        lines.push(`Low Stock,"${item.name}","${item.batchNumber}",${item.quantity},"${toDateInput(item.expiryDate)}",${daysUntil(item.expiryDate)}`);
      });
      expiringItems.forEach((item) => {
        lines.push(`Expiring,"${item.name}","${item.batchNumber}",${item.quantity},"${toDateInput(item.expiryDate)}",${daysUntil(item.expiryDate)}`);
      });
    }

    if (reportType === 'PAYMENT') {
      lines.push('Payment ID,Date,Type,Patient,Amount,Receipt No');
      (paymentSummary?.payments ?? []).forEach((item) => {
        lines.push(
          `${item.paymentId},"${new Date(item.date).toLocaleString()}","${prettifyPaymentType(item.type)}","${item.patient?.name ?? '-'}",${formatMoney(item.amount)},"${item.receipt?.receiptNo ?? '-'}"`,
        );
      });
    }

    if (reportType === 'RECEIPT') {
      lines.push('Receipt No,Date,Patient,Payment Type,Total');
      receiptItems.forEach((item) => {
        lines.push(
          `"${item.receiptNo}","${new Date(item.date).toLocaleString()}","${item.payment?.patient?.name ?? '-'}","${item.payment ? prettifyPaymentType(item.payment.type) : '-'}",${formatMoney(item.totalAmount)}`,
        );
      });
    }

    const csv = lines.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${reportType.toLowerCase()}-report-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const paymentConsultationTotal = useMemo(() => {
    if (!paymentSummary) return 0;
    return paymentSummary.payments
      .filter((p) => p.type === 'CONSULTATION')
      .reduce((sum, p) => sum + Number(p.amount), 0);
  }, [paymentSummary]);

  const paymentAppointmentTotal = useMemo(() => {
    if (!paymentSummary) return 0;
    return paymentSummary.payments
      .filter((p) => p.type === 'APPOINTMENT')
      .reduce((sum, p) => sum + Number(p.amount), 0);
  }, [paymentSummary]);

  const reportLabel = useMemo(() => {
    if (reportType === 'PATIENT') return 'Patient Report';
    if (reportType === 'PRESCRIPTION') return 'Prescription Report';
    if (reportType === 'INVENTORY') return 'Inventory Report';
    if (reportType === 'PAYMENT') return 'Payment Report';
    return 'Receipt Report';
  }, [reportType]);

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];

    if (filters.dateFrom) tags.push(`From: ${filters.dateFrom}`);
    if (filters.dateTo) tags.push(`To: ${filters.dateTo}`);
    if (filters.paymentType) tags.push(`Payment Type: ${prettifyPaymentType(filters.paymentType)}`);
    if (filters.receiptNo) tags.push(`Receipt No: ${filters.receiptNo}`);
    if (filters.query) tags.push(`Keyword: ${filters.query}`);
    if (filters.patientId) {
      const patient = patients.find((p) => p.patientId === filters.patientId);
      tags.push(`Patient: ${patient?.name ?? `#${filters.patientId}`}`);
    }
    if (filters.medicineId) {
      const medicine = medicines.find((m) => m.medicineId === filters.medicineId);
      tags.push(`Medicine: ${medicine ? `${medicine.name} (${medicine.batchNumber})` : `#${filters.medicineId}`}`);
    }
    if (reportType === 'INVENTORY') tags.push(`Expiring Days: ${filters.expiringDays}`);

    return tags;
  }, [filters, medicines, patients, reportType]);

  return (
    <section className="card report-print-area">
      <div className="section-head">
        <h1>Generate Report</h1>
        <p className="muted">Select report type, apply filters, generate output, then view/print/export.</p>
      </div>

      <div className="report-print-header" style={{ marginBottom: 10 }}>
        <h3 style={{ marginBottom: 6 }}>{reportLabel}</h3>
        <p className="muted" style={{ margin: 0 }}>
          Generated: {generatedAt ? new Date(generatedAt).toLocaleString() : 'Not generated yet'}
        </p>
        <p className="muted" style={{ marginTop: 4 }}>
          Applied filters: {activeFilterTags.length > 0 ? activeFilterTags.join(' | ') : 'None'}
        </p>
      </div>

      <form
        className="form-grid report-filter-controls"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void generateReport();
        }}
      >
        <div className="filters-grid">
          <select value={reportType} onChange={(e) => setReportType(e.target.value as ReportType)}>
            <option value="PATIENT">Patient Report</option>
            <option value="PRESCRIPTION">Prescription Report</option>
            <option value="INVENTORY">Inventory Report</option>
            <option value="PAYMENT">Payment Report</option>
            <option value="RECEIPT">Receipt Report</option>
          </select>

          {(reportType === 'PATIENT' || reportType === 'PRESCRIPTION') && (
            <input
              value={filters.query}
              onChange={(e) => setFilters((prev) => ({ ...prev, query: e.target.value }))}
              placeholder="Search keyword"
            />
          )}

          {(reportType === 'PRESCRIPTION' || reportType === 'PAYMENT' || reportType === 'RECEIPT') && (
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
              aria-label="Date from"
            />
          )}

          {(reportType === 'PRESCRIPTION' || reportType === 'PAYMENT' || reportType === 'RECEIPT') && (
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
              aria-label="Date to"
            />
          )}

          <button type="submit">Generate</button>
        </div>

        {reportType === 'PRESCRIPTION' && (
          <div className="filters-grid">
            <select
              value={filters.patientId}
              onChange={(e) => setFilters((prev) => ({ ...prev, patientId: e.target.value ? Number(e.target.value) : '' }))}
            >
              <option value="">All patients</option>
              {patients.map((p) => (
                <option key={p.patientId} value={p.patientId}>
                  {p.name}
                </option>
              ))}
            </select>

            {medicines.length > 0 ? (
              <select
                value={filters.medicineId}
                onChange={(e) => setFilters((prev) => ({ ...prev, medicineId: e.target.value ? Number(e.target.value) : '' }))}
              >
                <option value="">All medicines</option>
                {medicines.map((m) => (
                  <option key={m.medicineId} value={m.medicineId}>
                    {m.name} ({m.batchNumber})
                  </option>
                ))}
              </select>
            ) : (
              <p className="muted" style={{ margin: 0 }}>Medicine filter is unavailable for this account.</p>
            )}
          </div>
        )}

        {reportType === 'INVENTORY' && (
          <div className="form-row">
            <input
              type="number"
              min={1}
              value={filters.expiringDays}
              onChange={(e) => setFilters((prev) => ({ ...prev, expiringDays: Math.max(1, Number(e.target.value) || 30) }))}
              placeholder="Expiring days"
            />
          </div>
        )}

        {(reportType === 'PAYMENT' || reportType === 'RECEIPT') && (
          <div className="filters-grid">
            <select
              value={filters.paymentType}
              onChange={(e) => setFilters((prev) => ({ ...prev, paymentType: (e.target.value as PaymentType | '') || '' }))}
            >
              <option value="">All payment types</option>
              <option value="CONSULTATION">Consultation Fee</option>
              <option value="APPOINTMENT">Appointment Fee</option>
            </select>

            {reportType === 'RECEIPT' && (
              <input
                value={filters.receiptNo}
                onChange={(e) => setFilters((prev) => ({ ...prev, receiptNo: e.target.value }))}
                placeholder="Receipt no"
              />
            )}
          </div>
        )}
      </form>

      <div className="action-row report-print-actions" style={{ marginTop: 12 }}>
        <button type="button" className="btn-secondary" onClick={() => window.print()} disabled={loading}>
          Print
        </button>
        <button type="button" className="btn-secondary" onClick={exportCsv} disabled={loading}>
          Export CSV
        </button>
      </div>

      {generatedAt && <p className="muted" style={{ marginTop: 10 }}>Generated at: {new Date(generatedAt).toLocaleString()}</p>}
      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Generating report...</p>}

      {!loading && reportType === 'PATIENT' && (
        <article className="report-card" style={{ marginTop: 14 }}>
          <h3>Patient Report</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>IC / Passport</th>
                  <th>Phone</th>
                  <th>Prescriptions</th>
                  <th>Payments</th>
                  <th>Total Paid (RM)</th>
                </tr>
              </thead>
              <tbody>
                {patientItems.map((item) => (
                  <tr key={item.patientId}>
                    <td>{item.name}</td>
                    <td>{item.icOrPassport}</td>
                    <td>{item.phone}</td>
                    <td>{item.prescriptionsCount}</td>
                    <td>{item.paymentsCount}</td>
                    <td>{formatMoney(item.totalPaid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {patientItems.length === 0 && <p className="muted">No patient records found.</p>}
        </article>
      )}

      {!loading && reportType === 'PRESCRIPTION' && (
        <article className="report-card" style={{ marginTop: 14 }}>
          <h3>Prescription Report</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Medicines</th>
                </tr>
              </thead>
              <tbody>
                {prescriptionItems.map((item) => (
                  <tr key={item.prescriptionId}>
                    <td>{new Date(item.date).toLocaleString()}</td>
                    <td>{item.patient.name}</td>
                    <td>{item.doctor.username}</td>
                    <td>{item.items.map((m) => `${m.medicine.name} x${m.qty}`).join(', ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {prescriptionItems.length === 0 && <p className="muted">No prescriptions found.</p>}
        </article>
      )}

      {!loading && reportType === 'INVENTORY' && (
        <article className="report-card" style={{ marginTop: 14 }}>
          <h3>Inventory Report</h3>
          <div className="metrics-grid" style={{ marginTop: 10 }}>
            <div className="metric-card warning">
              <p className="muted">Low Stock (&lt; 10)</p>
              <strong>{lowStockItems.length}</strong>
            </div>
            <div className="metric-card warning">
              <p className="muted">Expiring ≤ {filters.expiringDays} days</p>
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

          {lowStockItems.length === 0 && expiringItems.length === 0 && <p className="muted">No inventory alerts found.</p>}
        </article>
      )}

      {!loading && reportType === 'PAYMENT' && (
        <article className="report-card" style={{ marginTop: 14 }}>
          <h3>Payment Report</h3>

          <div className="metrics-grid">
            <div className="metric-card">
              <p className="muted">Transactions</p>
              <strong>{paymentSummary?.count ?? 0}</strong>
            </div>
            <div className="metric-card">
              <p className="muted">Total (RM)</p>
              <strong>{formatMoney(paymentSummary?.total ?? 0)}</strong>
            </div>
            <div className="metric-card">
              <p className="muted">Consultation (RM)</p>
              <strong>{formatMoney(paymentConsultationTotal)}</strong>
            </div>
            <div className="metric-card">
              <p className="muted">Appointment (RM)</p>
              <strong>{formatMoney(paymentAppointmentTotal)}</strong>
            </div>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Patient</th>
                  <th>Amount (RM)</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {(paymentSummary?.payments ?? []).map((item) => (
                  <tr key={item.paymentId}>
                    <td>{new Date(item.date).toLocaleString()}</td>
                    <td>{prettifyPaymentType(item.type)}</td>
                    <td>{item.patient?.name ?? '-'}</td>
                    <td>{formatMoney(item.amount)}</td>
                    <td>{item.receipt?.receiptNo ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(paymentSummary?.payments.length ?? 0) === 0 && <p className="muted">No payment transactions found.</p>}
        </article>
      )}

      {!loading && reportType === 'RECEIPT' && (
        <article className="report-card" style={{ marginTop: 14 }}>
          <h3>Receipt Report</h3>
          <p className="muted">Includes consultation fee and appointment fee transactions.</p>

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
                {receiptItems.map((item) => (
                  <tr key={item.receiptId}>
                    <td>{new Date(item.date).toLocaleString()}</td>
                    <td>{item.receiptNo}</td>
                    <td>{item.payment?.patient?.name ?? '-'}</td>
                    <td>{item.payment ? prettifyPaymentType(item.payment.type) : '-'}</td>
                    <td>{formatMoney(item.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {receiptItems.length === 0 && <p className="muted">No receipts found.</p>}
        </article>
      )}
    </section>
  );
};
