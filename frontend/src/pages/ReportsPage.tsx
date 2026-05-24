import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';
import { subscribeInAppDataSync } from '../lib/sync';
import { usePagination } from '../lib/pagination';
import { useAuth } from '../context/AuthContext';
import { DateRangeFilter, getDateRangeForPreset } from '../components/DateRangeFilter';
import { Pagination } from '../components/Pagination';
import { Button, Input, Select } from '../components/ui';
import { exportReportExcel, exportReportPdf, type DocumentExportOptions } from '../lib/exportDocuments';
import clinicLogo from '../assets/Logo_Clinic_Dr.Alwani.png';

type ReportType = 'PATIENT' | 'PRESCRIPTION' | 'CONSULTATION' | 'INVENTORY' | 'SALES' | 'PAYMENT' | 'RECEIPT';
type PaymentType = 'CONSULTATION' | 'APPOINTMENT' | 'MEDICAL_CHECKUP' | 'MEDICINE' | 'CUSTOM';

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

type ConsultationReportItem = {
  consultationId: number;
  createdAt: string;
  consultationType: string;
  status: string;
  diagnosis?: string | null;
  patient: { name: string; icOrPassport: string; phone: string };
  doctor: { username: string };
  appointment?: { appointmentId: number; dateTime: string; type: string } | null;
  prescription?: { prescriptionId: number } | null;
  payment?: { paymentId: number; status: string; amount: number | string } | null;
};

type SalesReportItem = {
  paymentId: number;
  date: string;
  type: PaymentType;
  status: string;
  amount: number | string;
  paymentMethod: string;
  patient?: { name: string; icOrPassport: string; phone: string } | null;
  receipt?: { receiptNo: string; totalAmount: number | string } | null;
  medicineItems: Array<{
    qty: number;
    subtotal: number | string;
    medicine?: { name: string; batchNumber: string; stockUnit: string } | null;
  }>;
};

type SalesSummaryResponse = {
  count: number;
  total: number;
  sales: SalesReportItem[];
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
  consultationStatus: string;
  saleStatus: string;
};

const initialFilters: Filters = {
  dateFrom: getDateRangeForPreset('last7').dateFrom,
  dateTo: getDateRangeForPreset('last7').dateTo,
  patientId: '',
  medicineId: '',
  paymentType: '',
  receiptNo: '',
  query: '',
  expiringDays: 30,
  consultationStatus: '',
  saleStatus: '',
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

const prettifyPaymentType = (value: PaymentType) => {
  if (value === 'CONSULTATION') return 'Consultation Fee';
  if (value === 'APPOINTMENT') return 'Appointment';
  if (value === 'MEDICAL_CHECKUP') return 'Medical Checkup';
  if (value === 'MEDICINE') return 'Medicine Sale';
  return 'Payment';
};

const prettifyEnum = (value: string) => value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());

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
  const [dateRange, setDateRange] = useState(() => getDateRangeForPreset('last7'));

  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [medicines, setMedicines] = useState<MedicineOption[]>([]);

  const [patientItems, setPatientItems] = useState<PatientReportItem[]>([]);
  const [prescriptionItems, setPrescriptionItems] = useState<PrescriptionReportItem[]>([]);
  const [lowStockItems, setLowStockItems] = useState<MedicineReportItem[]>([]);
  const [expiringItems, setExpiringItems] = useState<MedicineReportItem[]>([]);
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummaryResponse | null>(null);
  const [receiptItems, setReceiptItems] = useState<ReceiptReportItem[]>([]);
  const [consultationItems, setConsultationItems] = useState<ConsultationReportItem[]>([]);
  const [salesSummary, setSalesSummary] = useState<SalesSummaryResponse | null>(null);

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

      if (reportType === 'CONSULTATION') {
        const response = await api.get('/reports/consultations', {
          params: {
            patientId: filters.patientId || undefined,
            query: filters.query || undefined,
            status: filters.consultationStatus || undefined,
            dateFrom: filters.dateFrom || undefined,
            dateTo: filters.dateTo || undefined,
          },
        });
        setConsultationItems(response.data as ConsultationReportItem[]);
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

      if (reportType === 'SALES') {
        const response = await api.get('/reports/sales', {
          params: {
            type: filters.paymentType || undefined,
            status: filters.saleStatus || undefined,
            query: filters.query || undefined,
            dateFrom: filters.dateFrom || undefined,
            dateTo: filters.dateTo || undefined,
          },
        });
        setSalesSummary(response.data as SalesSummaryResponse);
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

  const buildExportOptions = (): DocumentExportOptions<any> => {
    const base = {
      title: reportLabel,
      filename: `${reportType.toLowerCase()}-report-${new Date().toISOString().slice(0, 10)}`,
      logoUrl: clinicLogo,
      generatedAt: generatedAt ?? undefined,
      filters: activeFilterTags,
      footerNote: 'Generated by Clinic Dr Alwani for audit and record keeping.',
    };

    if (reportType === 'PATIENT') {
      return {
        ...base,
        summary: [{ label: 'Patients', value: patientItems.length }, { label: 'Total Paid (RM)', value: formatMoney(patientItems.reduce((sum, p) => sum + Number(p.totalPaid), 0)) }],
        rows: patientItems,
        columns: [
          { header: 'Patient ID', value: (r: PatientReportItem) => r.patientId },
          { header: 'Name', value: (r: PatientReportItem) => r.name },
          { header: 'IC / Passport', value: (r: PatientReportItem) => r.icOrPassport },
          { header: 'Phone', value: (r: PatientReportItem) => r.phone },
          { header: 'Address', value: (r: PatientReportItem) => r.address ?? '-' },
          { header: 'Prescriptions', value: (r: PatientReportItem) => r.prescriptionsCount },
          { header: 'Payments', value: (r: PatientReportItem) => r.paymentsCount },
          { header: 'Total Paid (RM)', value: (r: PatientReportItem) => formatMoney(r.totalPaid) },
        ],
      };
    }

    if (reportType === 'PRESCRIPTION') {
      return {
        ...base,
        summary: [{ label: 'Prescriptions', value: prescriptionItems.length }],
        rows: prescriptionItems,
        columns: [
          { header: 'Prescription ID', value: (r: PrescriptionReportItem) => r.prescriptionId },
          { header: 'Date', value: (r: PrescriptionReportItem) => new Date(r.date).toLocaleString() },
          { header: 'Patient', value: (r: PrescriptionReportItem) => r.patient.name },
          { header: 'Doctor', value: (r: PrescriptionReportItem) => r.doctor.username },
          { header: 'Medicines', value: (r: PrescriptionReportItem) => r.items.map((m) => `${m.medicine.name} x${m.qty}`).join(', ') || '-' },
        ],
      };
    }

    if (reportType === 'CONSULTATION') {
      return {
        ...base,
        summary: [{ label: 'Consultations', value: consultationItems.length }, { label: 'Completed', value: consultationItems.filter((c) => c.status === 'COMPLETED').length }],
        rows: consultationItems,
        columns: [
          { header: 'Consultation ID', value: (r: ConsultationReportItem) => r.consultationId },
          { header: 'Date', value: (r: ConsultationReportItem) => new Date(r.createdAt).toLocaleString() },
          { header: 'Patient', value: (r: ConsultationReportItem) => r.patient.name },
          { header: 'Doctor', value: (r: ConsultationReportItem) => r.doctor.username },
          { header: 'Type', value: (r: ConsultationReportItem) => prettifyEnum(r.consultationType) },
          { header: 'Status', value: (r: ConsultationReportItem) => prettifyEnum(r.status) },
          { header: 'Diagnosis', value: (r: ConsultationReportItem) => r.diagnosis ?? '-' },
          { header: 'Payment', value: (r: ConsultationReportItem) => r.payment ? `${r.payment.status} RM ${formatMoney(r.payment.amount)}` : '-' },
        ],
      };
    }

    if (reportType === 'INVENTORY') {
      const rows = [
        ...lowStockItems.map((item) => ({ alertType: 'Low Stock', ...item })),
        ...expiringItems.map((item) => ({ alertType: 'Expiring Soon', ...item })),
      ];
      return {
        ...base,
        summary: [{ label: 'Low Stock', value: lowStockItems.length }, { label: 'Expiring Soon', value: expiringItems.length }],
        rows,
        columns: [
          { header: 'Alert Type', value: (r: MedicineReportItem & { alertType: string }) => r.alertType },
          { header: 'Medicine', value: (r: MedicineReportItem & { alertType: string }) => r.name },
          { header: 'Batch', value: (r: MedicineReportItem & { alertType: string }) => r.batchNumber },
          { header: 'Quantity', value: (r: MedicineReportItem & { alertType: string }) => r.quantity },
          { header: 'Expiry Date', value: (r: MedicineReportItem & { alertType: string }) => toDateInput(r.expiryDate) },
          { header: 'Days To Expiry', value: (r: MedicineReportItem & { alertType: string }) => daysUntil(r.expiryDate) },
          { header: 'Price (RM)', value: (r: MedicineReportItem & { alertType: string }) => formatMoney(r.price) },
        ],
      };
    }

    if (reportType === 'SALES') {
      const sales = salesSummary?.sales ?? [];
      return {
        ...base,
        summary: [{ label: 'Transactions', value: salesSummary?.count ?? 0 }, { label: 'Total (RM)', value: formatMoney(salesSummary?.total ?? 0) }],
        rows: sales,
        columns: [
          { header: 'Payment ID', value: (r: SalesReportItem) => r.paymentId },
          { header: 'Date', value: (r: SalesReportItem) => new Date(r.date).toLocaleString() },
          { header: 'Type', value: (r: SalesReportItem) => prettifyPaymentType(r.type) },
          { header: 'Customer', value: (r: SalesReportItem) => r.patient?.name ?? '-' },
          { header: 'Receipt', value: (r: SalesReportItem) => r.receipt?.receiptNo ?? '-' },
          { header: 'Items', value: (r: SalesReportItem) => r.medicineItems.map((m) => `${m.medicine?.name ?? 'Medicine'} x${m.qty}`).join(', ') || '-' },
          { header: 'Status', value: (r: SalesReportItem) => prettifyEnum(r.status) },
          { header: 'Total (RM)', value: (r: SalesReportItem) => formatMoney(r.receipt?.totalAmount ?? r.amount) },
        ],
      };
    }

    if (reportType === 'PAYMENT') {
      return {
        ...base,
        summary: [{ label: 'Transactions', value: paymentSummary?.count ?? 0 }, { label: 'Total (RM)', value: formatMoney(paymentSummary?.total ?? 0) }],
        rows: paymentSummary?.payments ?? [],
        columns: [
          { header: 'Payment ID', value: (r: PaymentReportItem) => r.paymentId },
          { header: 'Date', value: (r: PaymentReportItem) => new Date(r.date).toLocaleString() },
          { header: 'Type', value: (r: PaymentReportItem) => prettifyPaymentType(r.type) },
          { header: 'Patient', value: (r: PaymentReportItem) => r.patient?.name ?? '-' },
          { header: 'Amount (RM)', value: (r: PaymentReportItem) => formatMoney(r.amount) },
          { header: 'Receipt No', value: (r: PaymentReportItem) => r.receipt?.receiptNo ?? '-' },
        ],
      };
    }

    return {
      ...base,
      summary: [{ label: 'Receipts', value: receiptItems.length }, { label: 'Total (RM)', value: formatMoney(receiptItems.reduce((sum, r) => sum + Number(r.totalAmount), 0)) }],
      rows: receiptItems,
      columns: [
        { header: 'Receipt No', value: (r: ReceiptReportItem) => r.receiptNo },
        { header: 'Date', value: (r: ReceiptReportItem) => new Date(r.date).toLocaleString() },
        { header: 'Patient', value: (r: ReceiptReportItem) => r.payment?.patient?.name ?? '-' },
        { header: 'Payment Type', value: (r: ReceiptReportItem) => (r.payment ? prettifyPaymentType(r.payment.type) : '-') },
        { header: 'Total (RM)', value: (r: ReceiptReportItem) => formatMoney(r.totalAmount) },
      ],
    };
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
    if (reportType === 'CONSULTATION') return 'Consultation Report';
    if (reportType === 'INVENTORY') return 'Inventory Report';
    if (reportType === 'SALES') return 'Sales Report';
    if (reportType === 'PAYMENT') return 'Payment Report';
    return 'Receipt Report';
  }, [reportType]);

  const activeFilterTags = useMemo(() => {
    const tags: string[] = [];

    if (filters.dateFrom) tags.push(`From: ${filters.dateFrom}`);
    if (filters.dateTo) tags.push(`To: ${filters.dateTo}`);
    if (filters.paymentType) tags.push(`Payment Type: ${prettifyPaymentType(filters.paymentType)}`);
    if (filters.consultationStatus) tags.push(`Consultation Status: ${prettifyEnum(filters.consultationStatus)}`);
    if (filters.saleStatus) tags.push(`Sale Status: ${prettifyEnum(filters.saleStatus)}`);
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

  const {
    page: patientPage,
    setPage: setPatientPage,
    totalPages: patientTotalPages,
    paginated: paginatedPatientItems,
  } = usePagination(patientItems, 10, [reportType, generatedAt]);

  const {
    page: prescriptionPage,
    setPage: setPrescriptionPage,
    totalPages: prescriptionTotalPages,
    paginated: paginatedPrescriptionItems,
  } = usePagination(prescriptionItems, 10, [reportType, generatedAt]);

  const {
    page: consultationPage,
    setPage: setConsultationPage,
    totalPages: consultationTotalPages,
    paginated: paginatedConsultationItems,
  } = usePagination(consultationItems, 10, [reportType, generatedAt]);

  const {
    page: lowStockPage,
    setPage: setLowStockPage,
    totalPages: lowStockTotalPages,
    paginated: paginatedLowStockItems,
  } = usePagination(lowStockItems, 10, [reportType, generatedAt]);

  const {
    page: expiringPage,
    setPage: setExpiringPage,
    totalPages: expiringTotalPages,
    paginated: paginatedExpiringItems,
  } = usePagination(expiringItems, 10, [reportType, generatedAt]);

  const paymentReportItems = paymentSummary?.payments ?? [];
  const salesReportItems = salesSummary?.sales ?? [];
  const {
    page: salesPage,
    setPage: setSalesPage,
    totalPages: salesTotalPages,
    paginated: paginatedSalesItems,
  } = usePagination(salesReportItems, 10, [reportType, generatedAt]);

  const {
    page: paymentPage,
    setPage: setPaymentPage,
    totalPages: paymentTotalPages,
    paginated: paginatedPaymentItems,
  } = usePagination(paymentReportItems, 10, [reportType, generatedAt]);

  const {
    page: receiptPage,
    setPage: setReceiptPage,
    totalPages: receiptTotalPages,
    paginated: paginatedReceiptItems,
  } = usePagination(receiptItems, 10, [reportType, generatedAt]);

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
          <Select value={reportType} onChange={(e) => setReportType(e.target.value as ReportType)}>
            <option value="PATIENT">Patient Report</option>
            <option value="PRESCRIPTION">Prescription Report</option>
            <option value="CONSULTATION">Consultation Report</option>
            <option value="INVENTORY">Inventory Report</option>
            <option value="SALES">Sales Report</option>
            <option value="PAYMENT">Payment Report</option>
            <option value="RECEIPT">Receipt Report</option>
          </Select>

          {(reportType === 'PATIENT' || reportType === 'PRESCRIPTION' || reportType === 'CONSULTATION' || reportType === 'SALES') && (
            <Input
              value={filters.query}
              onChange={(e) => setFilters((prev) => ({ ...prev, query: e.target.value }))}
              placeholder="Search keyword"
            />
          )}

          {(reportType === 'PRESCRIPTION' || reportType === 'CONSULTATION' || reportType === 'SALES' || reportType === 'PAYMENT' || reportType === 'RECEIPT') && (
            <DateRangeFilter
              value={dateRange}
              onChange={(nextRange) => {
                setDateRange(nextRange);
                setFilters((prev) => ({ ...prev, dateFrom: nextRange.dateFrom, dateTo: nextRange.dateTo }));
              }}
              includeAll
            />
          )}

          <Button type="submit">Generate</Button>
        </div>

        {(reportType === 'PRESCRIPTION' || reportType === 'CONSULTATION') && (
          <div className="filters-grid">
            <Select
              value={filters.patientId}
              onChange={(e) => setFilters((prev) => ({ ...prev, patientId: e.target.value ? Number(e.target.value) : '' }))}
            >
              <option value="">All patients</option>
              {patients.map((p) => (
                <option key={p.patientId} value={p.patientId}>
                  {p.name}
                </option>
              ))}
            </Select>

            {reportType === 'PRESCRIPTION' && medicines.length > 0 ? (
              <Select
                value={filters.medicineId}
                onChange={(e) => setFilters((prev) => ({ ...prev, medicineId: e.target.value ? Number(e.target.value) : '' }))}
              >
                <option value="">All medicines</option>
                {medicines.map((m) => (
                  <option key={m.medicineId} value={m.medicineId}>
                    {m.name} ({m.batchNumber})
                  </option>
                ))}
              </Select>
            ) : reportType === 'PRESCRIPTION' ? (
              <p className="muted" style={{ margin: 0 }}>Medicine filter is unavailable for this account.</p>
            ) : null}
            {reportType === 'CONSULTATION' && (
              <Select
                value={filters.consultationStatus}
                onChange={(e) => setFilters((prev) => ({ ...prev, consultationStatus: e.target.value }))}
              >
                <option value="">All consultation statuses</option>
                <option value="WAITING">Waiting</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="COMPLETED">Completed</option>
              </Select>
            )}
          </div>
        )}

        {reportType === 'INVENTORY' && (
          <div className="form-row">
            <Input
              type="number"
              min={1}
              value={filters.expiringDays}
              onChange={(e) => setFilters((prev) => ({ ...prev, expiringDays: Math.max(1, Number(e.target.value) || 30) }))}
              placeholder="Expiring days"
            />
          </div>
        )}

        {(reportType === 'PAYMENT' || reportType === 'RECEIPT' || reportType === 'SALES') && (
          <div className="filters-grid">
            <Select
              value={filters.paymentType}
              onChange={(e) => setFilters((prev) => ({ ...prev, paymentType: (e.target.value as PaymentType | '') || '' }))}
            >
              <option value="">All payment types</option>
              <option value="CONSULTATION">Consultation Fee</option>
              <option value="APPOINTMENT">Appointment</option>
              <option value="MEDICAL_CHECKUP">Medical Checkup</option>
              <option value="MEDICINE">Medicine Sale</option>
            </Select>

            {reportType === 'SALES' && (
              <Select
                value={filters.saleStatus}
                onChange={(e) => setFilters((prev) => ({ ...prev, saleStatus: e.target.value }))}
              >
                <option value="">All sale statuses</option>
                <option value="PAID">Paid</option>
                <option value="PENDING_DISPENSE">Pending Dispense</option>
                <option value="DISPENSED">Dispensed</option>
                <option value="CANCELLED">Cancelled</option>
              </Select>
            )}

            {reportType === 'RECEIPT' && (
              <Input
                value={filters.receiptNo}
                onChange={(e) => setFilters((prev) => ({ ...prev, receiptNo: e.target.value }))}
                placeholder="Receipt no"
              />
            )}
          </div>
        )}
      </form>

      <div className="action-row report-print-actions" style={{ marginTop: 12 }}>
        <Button
          variant="secondary"
          onClick={() => {
            const nextRange = getDateRangeForPreset('last7');
            setDateRange(nextRange);
            setFilters({ ...initialFilters, dateFrom: nextRange.dateFrom, dateTo: nextRange.dateTo });
          }}
          disabled={loading}
        >
          Reset Filters
        </Button>
        <Button variant="secondary" onClick={() => exportReportPdf(buildExportOptions())} disabled={loading}>
          Export PDF
        </Button>
        <Button variant="secondary" onClick={() => exportReportExcel(buildExportOptions())} disabled={loading}>
          Export Excel (.xlsx)
        </Button>
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
                {paginatedPatientItems.map((item) => (
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

          <Pagination page={patientPage} totalPages={patientTotalPages} onPageChange={setPatientPage} />
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
                {paginatedPrescriptionItems.map((item) => (
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

          <Pagination page={prescriptionPage} totalPages={prescriptionTotalPages} onPageChange={setPrescriptionPage} />
          {prescriptionItems.length === 0 && <p className="muted">No prescriptions found.</p>}
        </article>
      )}

      {!loading && reportType === 'CONSULTATION' && (
        <article className="report-card" style={{ marginTop: 14 }}>
          <h3>Consultation Report</h3>
          <div className="metrics-grid">
            <div className="metric-card">
              <p className="muted">Consultations</p>
              <strong>{consultationItems.length}</strong>
            </div>
            <div className="metric-card">
              <p className="muted">Completed</p>
              <strong>{consultationItems.filter((item) => item.status === 'COMPLETED').length}</strong>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Diagnosis</th>
                  <th>Payment</th>
                </tr>
              </thead>
              <tbody>
                {paginatedConsultationItems.map((item) => (
                  <tr key={item.consultationId}>
                    <td>{new Date(item.createdAt).toLocaleString()}</td>
                    <td>{item.patient.name}</td>
                    <td>{item.doctor.username}</td>
                    <td>{prettifyEnum(item.consultationType)}</td>
                    <td>{prettifyEnum(item.status)}</td>
                    <td>{item.diagnosis ?? '-'}</td>
                    <td>{item.payment ? `${prettifyEnum(item.payment.status)} - RM ${formatMoney(item.payment.amount)}` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={consultationPage} totalPages={consultationTotalPages} onPageChange={setConsultationPage} />
          {consultationItems.length === 0 && <p className="muted">No consultations found.</p>}
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
                    {paginatedLowStockItems.map((item) => (
                      <tr key={item.medicineId}>
                        <td>{item.name}</td>
                        <td>{item.batchNumber}</td>
                        <td><span className="status-badge status-critical">{item.quantity}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Pagination page={lowStockPage} totalPages={lowStockTotalPages} onPageChange={setLowStockPage} />
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
                    {paginatedExpiringItems.map((item) => (
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

              <Pagination page={expiringPage} totalPages={expiringTotalPages} onPageChange={setExpiringPage} />
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
                {paginatedPaymentItems.map((item) => (
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

          <Pagination page={paymentPage} totalPages={paymentTotalPages} onPageChange={setPaymentPage} />

          {(paymentSummary?.payments.length ?? 0) === 0 && <p className="muted">No payment transactions found.</p>}
        </article>
      )}

      {!loading && reportType === 'SALES' && (
        <article className="report-card" style={{ marginTop: 14 }}>
          <h3>Sales Report</h3>

          <div className="metrics-grid">
            <div className="metric-card">
              <p className="muted">Transactions</p>
              <strong>{salesSummary?.count ?? 0}</strong>
            </div>
            <div className="metric-card">
              <p className="muted">Total (RM)</p>
              <strong>{formatMoney(salesSummary?.total ?? 0)}</strong>
            </div>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Customer</th>
                  <th>Receipt</th>
                  <th>Items</th>
                  <th>Status</th>
                  <th>Total (RM)</th>
                </tr>
              </thead>
              <tbody>
                {paginatedSalesItems.map((item) => (
                  <tr key={item.paymentId}>
                    <td>{new Date(item.date).toLocaleString()}</td>
                    <td>{prettifyPaymentType(item.type)}</td>
                    <td>{item.patient?.name ?? '-'}</td>
                    <td>{item.receipt?.receiptNo ?? '-'}</td>
                    <td>{item.medicineItems.map((m) => `${m.medicine?.name ?? 'Medicine'} x${m.qty}`).join(', ') || '-'}</td>
                    <td>{prettifyEnum(item.status)}</td>
                    <td>{formatMoney(item.receipt?.totalAmount ?? item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={salesPage} totalPages={salesTotalPages} onPageChange={setSalesPage} />
          {(salesSummary?.sales.length ?? 0) === 0 && <p className="muted">No sales transactions found.</p>}
        </article>
      )}

      {!loading && reportType === 'RECEIPT' && (
        <article className="report-card" style={{ marginTop: 14 }}>
          <h3>Receipt Report</h3>
          <p className="muted">Includes consultation, appointment, and medicine-sale transactions.</p>

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
                {paginatedReceiptItems.map((item) => (
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

          <Pagination page={receiptPage} totalPages={receiptTotalPages} onPageChange={setReceiptPage} />

          {receiptItems.length === 0 && <p className="muted">No receipts found.</p>}
        </article>
      )}
    </section>
  );
};
