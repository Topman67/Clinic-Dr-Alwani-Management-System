import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../lib/api';
import { subscribeInAppDataSync } from '../lib/sync';
import { usePagination } from '../lib/pagination';
import { useAuth } from '../context/AuthContext';
import { DateRangeFilter } from '../components/DateRangeFilter';
import { getDateRangeForPreset } from '../lib/dateRange';
import { Pagination } from '../components/Pagination';
import { Button, Input, Select } from '../components/ui';
import { exportReceiptPdf, exportReportCsv, exportReportPdf, type DocumentExportOptions } from '../lib/exportDocuments';
import clinicLogo from '../assets/Logo_Clinic_Dr.Alwani.png';

type ReportType = 'PATIENT' | 'PRESCRIPTION' | 'CONSULTATION' | 'INVENTORY' | 'SALES' | 'PAYMENT' | 'RECEIPT';
type ChartMode = 'daily' | 'weekly' | 'monthly';
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
  consultationsCount?: number;
  paymentsCount: number;
  totalPaid: number;
  isActive?: boolean;
};

type PrescriptionReportItem = {
  prescriptionId: number;
  date: string;
  status?: 'PENDING_VERIFICATION' | 'VERIFIED' | 'DISPENSED' | 'REJECTED';
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
  category?: string;
  companyName?: string | null;
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
  paymentMethod?: string;
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
    paymentMethod?: string;
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

type InventoryAlertReportItem = MedicineReportItem & { alertType: string };

type ReportExportOptions =
  | DocumentExportOptions<PatientReportItem>
  | DocumentExportOptions<PrescriptionReportItem>
  | DocumentExportOptions<ConsultationReportItem>
  | DocumentExportOptions<InventoryAlertReportItem>
  | DocumentExportOptions<SalesReportItem>
  | DocumentExportOptions<PaymentReportItem>
  | DocumentExportOptions<ReceiptReportItem>;

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

const reportTypeDescription = (type: ReportType) => {
  if (type === 'PATIENT') return 'Patient registration, activity, and payment contribution overview.';
  if (type === 'PRESCRIPTION') return 'Prescription volume, medicine mix, and dispensing readiness.';
  if (type === 'CONSULTATION') return 'Consultation workflow, diagnosis, follow-up, and billing status.';
  if (type === 'INVENTORY') return 'Low stock and expiry risk report for pharmacy operations.';
  if (type === 'SALES') return 'Revenue movement across medicine sales and clinic fees.';
  if (type === 'PAYMENT') return 'Payment collection, receipt, and revenue category summary.';
  return 'Receipt register for payment audit and patient record keeping.';
};

const getStatusTone = (value: string | undefined) => {
  const status = (value ?? '').toUpperCase();
  if (['COMPLETED', 'PAID', 'DISPENSED', 'VERIFIED', 'ACTIVE'].includes(status)) return 'good';
  if (['PENDING', 'PENDING_PAYMENT', 'PENDING_DISPENSE', 'PENDING_VERIFICATION', 'WAITING', 'IN_PROGRESS', 'LOW_STOCK', 'NEAR_EXPIRY'].includes(status)) return 'warning';
  if (['EXPIRED', 'REJECTED', 'CANCELLED', 'NO_SHOW'].includes(status)) return 'critical';
  return 'neutral';
};

const getTypeClass = (type: PaymentType | string) => {
  if (type === 'CONSULTATION') return 'type-consultation';
  if (type === 'MEDICAL_CHECKUP' || type === 'MEDICINE') return 'type-medical';
  return 'type-appointment';
};

const getPaymentMethodClass = (method: string | undefined) => {
  if (method === 'CASH') return 'payment-method-cash';
  if (method === 'CARD') return 'payment-method-card';
  if (method === 'ONLINE_TRANSFER') return 'payment-method-online';
  return 'payment-method-other';
};

const formatExpiryCountdown = (isoDate: string) => {
  const days = daysUntil(isoDate);
  if (days < 0) return `Expired ${Math.abs(days)} days ago`;
  if (days === 0) return 'Expires today';
  return `Expires in ${days} days`;
};

const formatShortMoney = (value: number) => {
  if (value >= 1000) return `RM ${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return `RM ${value.toFixed(0)}`;
};

const ReportBadge = ({ children, tone = 'neutral', className = '' }: { children: ReactNode; tone?: string; className?: string }) => (
  <span className={`status-badge status-${tone} ${className}`}>{children}</span>
);

const MetricCard = ({ icon, label, value, tone = 'neutral' }: { icon: string; label: string; value: string | number; tone?: string }) => (
  <div className={`metric-card report-metric-card report-metric-${tone}`}>
    <span className="report-metric-icon">{icon}</span>
    <div>
      <p>{label}</p>
      <strong>{value}</strong>
    </div>
  </div>
);

const EmptyReportState = ({ message }: { message: string }) => (
  <div className="report-empty-state">
    <span aria-hidden="true">0</span>
    <strong>{message}</strong>
    <p>Adjust filters or broaden the date range to see records.</p>
  </div>
);

const ReportSection = ({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) => (
  <article className="report-card">
    <div className="report-section-head">
      <div>
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="report-card-actions">{actions}</div>}
    </div>
    {children}
  </article>
);

const MedicineTags = ({ items }: { items: PrescriptionReportItem['items'] | SalesReportItem['medicineItems'] }) => (
  <div className="report-tag-stack">
    {items.length > 0 ? items.slice(0, 4).map((item, index) => (
      <span key={`${item.medicine?.name ?? 'Medicine'}-${index}`} className="report-tag">
        {item.medicine?.name ?? 'Medicine'} x{item.qty}
      </span>
    )) : <span className="muted">-</span>}
    {items.length > 4 && <span className="report-tag report-tag-muted">+{items.length - 4} more</span>}
  </div>
);

const ReportChart = ({ data, mode }: { data: Array<{ label: string; value: number }>; mode: ChartMode }) => {
  const max = Math.max(...data.map((item) => item.value), 1);

  return (
    <div className="report-chart" role="img" aria-label={`${mode} sales chart`}>
      {data.map((item) => (
        <div key={item.label} className="report-chart-bar">
          <span data-tooltip={`${item.label}: RM ${formatMoney(item.value)}`} title={`${item.label}: RM ${formatMoney(item.value)}`} style={{ height: `${Math.max(8, (item.value / max) * 100)}%` }} />
          <small>{item.label}</small>
          <b>{formatShortMoney(item.value)}</b>
        </div>
      ))}
    </div>
  );
};

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
  const [salesChartMode, setSalesChartMode] = useState<ChartMode>('daily');
  const [paymentChartMode, setPaymentChartMode] = useState<ChartMode>('daily');
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [debouncedFilters, setDebouncedFilters] = useState<Filters>(initialFilters);
  const [dateRange, setDateRange] = useState(() => getDateRangeForPreset('last7'));

  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [medicines, setMedicines] = useState<MedicineOption[]>([]);

  const [patientItems, setPatientItems] = useState<PatientReportItem[]>([]);
  const [prescriptionItems, setPrescriptionItems] = useState<PrescriptionReportItem[]>([]);
  const [lowStockItems, setLowStockItems] = useState<MedicineReportItem[]>([]);
  const [expiringItems, setExpiringItems] = useState<MedicineReportItem[]>([]);
  const [paymentSummary, setPaymentSummary] = useState<PaymentSummaryResponse | null>(null);
  const [receiptItems, setReceiptItems] = useState<ReceiptReportItem[]>([]);
  const [previewReceipt, setPreviewReceipt] = useState<ReceiptReportItem | null>(null);
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
    if (debouncedFilters.dateFrom && debouncedFilters.dateTo && debouncedFilters.dateFrom > debouncedFilters.dateTo) {
      setError('Date from cannot be later than date to.');
      return false;
    }
    return true;
  }, [debouncedFilters.dateFrom, debouncedFilters.dateTo]);

  const generateReport = useCallback(async () => {
    if (!validateFilters()) return;

    setLoading(true);
    setError(null);
    try {
      if (reportType === 'PATIENT') {
        const response = await api.get('/reports/patients', {
          params: {
            query: debouncedFilters.query || undefined,
          },
        });
        setPatientItems(response.data as PatientReportItem[]);
      }

      if (reportType === 'PRESCRIPTION') {
        const response = await api.get('/reports/prescriptions', {
          params: {
            patientId: debouncedFilters.patientId || undefined,
            medicineId: debouncedFilters.medicineId || undefined,
            dateFrom: debouncedFilters.dateFrom || undefined,
            dateTo: debouncedFilters.dateTo || undefined,
          },
        });
        setPrescriptionItems(response.data as PrescriptionReportItem[]);
      }

      if (reportType === 'CONSULTATION') {
        const response = await api.get('/reports/consultations', {
          params: {
            patientId: debouncedFilters.patientId || undefined,
            query: debouncedFilters.query || undefined,
            status: debouncedFilters.consultationStatus || undefined,
            dateFrom: debouncedFilters.dateFrom || undefined,
            dateTo: debouncedFilters.dateTo || undefined,
          },
        });
        setConsultationItems(response.data as ConsultationReportItem[]);
      }

      if (reportType === 'INVENTORY') {
        const [lowStockRes, expiringRes] = await Promise.all([
          api.get('/reports/inventory/low-stock'),
          api.get('/reports/inventory/expiring', {
            params: {
              days: debouncedFilters.expiringDays,
            },
          }),
        ]);

        setLowStockItems(lowStockRes.data as MedicineReportItem[]);
        setExpiringItems(expiringRes.data as MedicineReportItem[]);
      }

      if (reportType === 'PAYMENT') {
        const response = await api.get('/reports/payments', {
          params: {
            type: debouncedFilters.paymentType || undefined,
            dateFrom: debouncedFilters.dateFrom || undefined,
            dateTo: debouncedFilters.dateTo || undefined,
          },
        });
        setPaymentSummary(response.data as PaymentSummaryResponse);
      }

      if (reportType === 'SALES') {
        const response = await api.get('/reports/sales', {
          params: {
            type: debouncedFilters.paymentType || undefined,
            status: debouncedFilters.saleStatus || undefined,
            query: debouncedFilters.query || undefined,
            dateFrom: debouncedFilters.dateFrom || undefined,
            dateTo: debouncedFilters.dateTo || undefined,
          },
        });
        setSalesSummary(response.data as SalesSummaryResponse);
      }

      if (reportType === 'RECEIPT') {
        const response = await api.get('/reports/receipts', {
          params: {
            type: debouncedFilters.paymentType || undefined,
            receiptNo: debouncedFilters.receiptNo || undefined,
            dateFrom: debouncedFilters.dateFrom || undefined,
            dateTo: debouncedFilters.dateTo || undefined,
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
  }, [debouncedFilters, reportType, validateFilters]);

  useEffect(() => {
    void (async () => {
      try {
        await loadLookups();
      } catch {
        setError('Failed to load report module.');
      }
    })();
  }, [loadLookups]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedFilters(filters);
    }, 400);

    return () => window.clearTimeout(timeout);
  }, [filters]);

  useEffect(() => {
    void generateReport();
  }, [generateReport]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void generateReport();
    });
  }, [generateReport]);

  const buildExportOptions = (): ReportExportOptions => {
    const base = {
      title: reportLabel,
      filename: `${reportType.toLowerCase()}-report-${new Date().toISOString().slice(0, 10)}`,
      logoUrl: clinicLogo,
      generatedAt: generatedAt ?? undefined,
      filters: activeFilterTags.map((tag) => tag.label),
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
          { header: 'Alert Type', value: (r: InventoryAlertReportItem) => r.alertType },
          { header: 'Medicine', value: (r: InventoryAlertReportItem) => r.name },
          { header: 'Batch', value: (r: InventoryAlertReportItem) => r.batchNumber },
          { header: 'Quantity', value: (r: InventoryAlertReportItem) => r.quantity },
          { header: 'Expiry Date', value: (r: InventoryAlertReportItem) => toDateInput(r.expiryDate) },
          { header: 'Days To Expiry', value: (r: InventoryAlertReportItem) => daysUntil(r.expiryDate) },
          { header: 'Price (RM)', value: (r: InventoryAlertReportItem) => formatMoney(r.price) },
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
    const tags: Array<{ key: keyof Filters | 'dateRange'; label: string; clearable: boolean }> = [];

    if (filters.dateFrom || filters.dateTo) {
      tags.push({ key: 'dateRange', label: `${filters.dateFrom || 'Start'} to ${filters.dateTo || 'Today'}`, clearable: true });
    } else {
      tags.push({ key: 'dateRange', label: 'All Dates', clearable: false });
    }
    if (filters.paymentType) tags.push({ key: 'paymentType', label: prettifyPaymentType(filters.paymentType), clearable: true });
    if (filters.consultationStatus) tags.push({ key: 'consultationStatus', label: prettifyEnum(filters.consultationStatus), clearable: true });
    if (filters.saleStatus) tags.push({ key: 'saleStatus', label: prettifyEnum(filters.saleStatus), clearable: true });
    if (filters.receiptNo) tags.push({ key: 'receiptNo', label: `Receipt ${filters.receiptNo}`, clearable: true });
    if (filters.query) tags.push({ key: 'query', label: filters.query, clearable: true });
    if (filters.patientId) {
      const patient = patients.find((p) => p.patientId === filters.patientId);
      tags.push({ key: 'patientId', label: patient?.name ?? `Patient #${filters.patientId}`, clearable: true });
    }
    if (filters.medicineId) {
      const medicine = medicines.find((m) => m.medicineId === filters.medicineId);
      tags.push({ key: 'medicineId', label: medicine ? `${medicine.name} (${medicine.batchNumber})` : `Medicine #${filters.medicineId}`, clearable: true });
    }
    if (reportType === 'INVENTORY') tags.push({ key: 'expiringDays', label: `Expiring ${filters.expiringDays} days`, clearable: filters.expiringDays !== initialFilters.expiringDays });

    return tags;
  }, [filters, medicines, patients, reportType]);

  const clearFilterChip = (key: keyof Filters | 'dateRange') => {
    if (key === 'dateRange') {
      setDateRange({ preset: 'all', dateFrom: '', dateTo: '' });
      setFilters((prev) => ({ ...prev, dateFrom: '', dateTo: '' }));
      return;
    }

    setFilters((prev) => ({ ...prev, [key]: initialFilters[key] }));
  };

  const exportActions = (
    <>
      <Button className="report-export-btn" variant="secondary" onClick={() => exportReportPdf(buildExportOptions() as unknown as DocumentExportOptions<unknown>)} disabled={loading}>
        <span className="report-action-icon" aria-hidden="true">PDF</span>
        <span>Export PDF</span>
      </Button>
      <Button className="report-export-btn" variant="secondary" onClick={() => exportReportCsv(buildExportOptions() as unknown as DocumentExportOptions<unknown>)} disabled={loading}>
        <span className="report-action-icon" aria-hidden="true">CSV</span>
        <span>Export CSV</span>
      </Button>
    </>
  );

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

  const paymentReportItems = useMemo(() => paymentSummary?.payments ?? [], [paymentSummary]);
  const salesReportItems = useMemo(() => salesSummary?.sales ?? [], [salesSummary]);
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

  const walkInPatientCount = patientItems.filter((item) => item.icOrPassport?.toUpperCase().startsWith('WALKIN')).length;
  const activePatientCount = patientItems.filter((item) => item.isActive !== false).length;
  const prescriptionMedicineCount = prescriptionItems.reduce((sum, item) => sum + item.items.reduce((itemSum, med) => itemSum + med.qty, 0), 0);
  const consultationFeeTotal = consultationItems.reduce((sum, item) => sum + Number(item.payment?.amount ?? 0), 0);
  const salesMedicineTotal = salesReportItems.filter((item) => item.type === 'MEDICINE').reduce((sum, item) => sum + Number(item.receipt?.totalAmount ?? item.amount), 0);
  const averageSale = salesReportItems.length ? Number(salesSummary?.total ?? 0) / salesReportItems.length : 0;
  const paymentMedicineTotal = paymentReportItems.filter((item) => item.type === 'MEDICINE').reduce((sum, item) => sum + Number(item.amount), 0);
  const expiredInventoryCount = expiringItems.filter((item) => daysUntil(item.expiryDate) < 0).length;

  const salesChartData = useMemo(() => {
    const source = salesReportItems.length ? salesReportItems : [];
    const buckets = salesChartMode === 'daily' ? 7 : 6;
    const now = new Date();

    return Array.from({ length: buckets }, (_, index) => {
      const offset = buckets - 1 - index;
      const date = new Date(now);

      if (salesChartMode === 'monthly') {
        date.setMonth(now.getMonth() - offset, 1);
        const key = `${date.getFullYear()}-${date.getMonth()}`;
        return {
          label: date.toLocaleString(undefined, { month: 'short' }),
          value: source.filter((item) => {
            const itemDate = new Date(item.date);
            return `${itemDate.getFullYear()}-${itemDate.getMonth()}` === key;
          }).reduce((sum, item) => sum + Number(item.receipt?.totalAmount ?? item.amount), 0),
        };
      }

      if (salesChartMode === 'weekly') {
        date.setDate(now.getDate() - (offset * 7));
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - weekStart.getDay());
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);

        return {
          label: `${weekStart.toLocaleDateString(undefined, { month: 'short', day: '2-digit' })}`,
          value: source.filter((item) => {
            const itemDate = new Date(item.date);
            return itemDate >= weekStart && itemDate <= weekEnd;
          }).reduce((sum, item) => sum + Number(item.receipt?.totalAmount ?? item.amount), 0),
        };
      }

      date.setDate(now.getDate() - offset);
      const key = toDateInput(date.toISOString());
      return {
        label: date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }),
        value: source.filter((item) => toDateInput(item.date) === key).reduce((sum, item) => sum + Number(item.receipt?.totalAmount ?? item.amount), 0),
      };
    });
  }, [salesChartMode, salesReportItems]);

  const paymentChartData = useMemo(() => {
    const source = paymentReportItems.length ? paymentReportItems : [];
    const buckets = paymentChartMode === 'daily' ? 7 : 6;
    const now = new Date();

    return Array.from({ length: buckets }, (_, index) => {
      const offset = buckets - 1 - index;
      const date = new Date(now);

      if (paymentChartMode === 'monthly') {
        date.setMonth(now.getMonth() - offset, 1);
        const key = `${date.getFullYear()}-${date.getMonth()}`;
        return {
          label: date.toLocaleString(undefined, { month: 'short' }),
          value: source.filter((item) => {
            const itemDate = new Date(item.date);
            return `${itemDate.getFullYear()}-${itemDate.getMonth()}` === key;
          }).reduce((sum, item) => sum + Number(item.amount), 0),
        };
      }

      if (paymentChartMode === 'weekly') {
        date.setDate(now.getDate() - (offset * 7));
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - weekStart.getDay());
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);

        return {
          label: weekStart.toLocaleDateString(undefined, { month: 'short', day: '2-digit' }),
          value: source.filter((item) => {
            const itemDate = new Date(item.date);
            return itemDate >= weekStart && itemDate <= weekEnd;
          }).reduce((sum, item) => sum + Number(item.amount), 0),
        };
      }

      date.setDate(now.getDate() - offset);
      const key = toDateInput(date.toISOString());
      return {
        label: date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }),
        value: source.filter((item) => toDateInput(item.date) === key).reduce((sum, item) => sum + Number(item.amount), 0),
      };
    });
  }, [paymentChartMode, paymentReportItems]);

  const exportReceiptRecord = (receipt: ReceiptReportItem) => {
    exportReceiptPdf({
      filename: `receipt-${receipt.receiptNo}`,
      logoUrl: clinicLogo,
      clinicName: 'Clinic Dr Alwani',
      receiptNo: receipt.receiptNo,
      patientDetails: [
        { label: 'Patient / Customer', value: receipt.payment?.patient?.name ?? '-' },
      ],
      paymentDetails: [
        { label: 'Payment ID', value: receipt.payment?.paymentId ? `#${receipt.payment.paymentId}` : '-' },
        { label: 'Payment Date', value: new Date(receipt.date).toLocaleString() },
        { label: 'Payment Method', value: prettifyEnum(receipt.payment?.paymentMethod ?? '-') },
        { label: 'Payment Type', value: receipt.payment ? prettifyPaymentType(receipt.payment.type) : '-' },
      ],
      breakdown: [
        { label: receipt.payment ? prettifyPaymentType(receipt.payment.type) : 'Payment', value: `RM ${formatMoney(receipt.totalAmount)}` },
      ],
      grandTotal: formatMoney(receipt.totalAmount),
      paidStatus: 'Paid',
      footerNote: 'Thank you for your payment. Please keep this receipt for your records.',
    });
  };

  return (
    <section className="report-page report-print-area">
      <div className="report-hero">
        <div className="section-head">
          <span className="report-eyebrow">Clinic Analytics</span>
          <h1>Reports</h1>
          <p>Generate operational, financial, inventory, and receipt reports for Clinic Dr Alwani.</p>
        </div>
        <div className="report-hero-meta">
          <span>{loading ? 'Refreshing reports...' : generatedAt ? `Generated ${new Date(generatedAt).toLocaleString()}` : 'Preparing report data'}</span>
        </div>
      </div>

      <div className="report-filter-controls">
        <div className="report-controls-head">
          <div>
            <h3>Report Filters</h3>
            <p>{reportTypeDescription(reportType)}</p>
          </div>
          <div className="report-filter-chips">
            {activeFilterTags.map((tag) => (
              <button
                key={`${tag.key}-${tag.label}`}
                type="button"
                className={tag.clearable ? 'is-clearable' : undefined}
                onClick={() => tag.clearable && clearFilterChip(tag.key)}
                disabled={!tag.clearable}
                title={tag.clearable ? `Clear ${tag.label}` : tag.label}
              >
                {tag.label}
                {tag.clearable && <span aria-hidden="true">x</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="report-filter-grid report-filter-grid-primary">
          <label>
            <span>Report Type</span>
            <Select value={reportType} onChange={(e) => setReportType(e.target.value as ReportType)}>
              <option value="PATIENT">Patient Report</option>
              <option value="PRESCRIPTION">Prescription Report</option>
              <option value="CONSULTATION">Consultation Report</option>
              <option value="INVENTORY">Inventory Report</option>
              <option value="SALES">Sales Report</option>
              <option value="PAYMENT">Payment Report</option>
              <option value="RECEIPT">Receipt Report</option>
            </Select>
          </label>

          <label>
            <span>Search Keyword</span>
            <Input
              value={filters.query}
              onChange={(e) => setFilters((prev) => ({ ...prev, query: e.target.value }))}
              placeholder="Search patient, receipt, medicine..."
              disabled={!(reportType === 'PATIENT' || reportType === 'PRESCRIPTION' || reportType === 'CONSULTATION' || reportType === 'SALES')}
            />
          </label>

          <div className="report-date-field">
            <span>Date Range</span>
            <DateRangeFilter
              value={dateRange}
              onChange={(nextRange) => {
                setDateRange(nextRange);
                setFilters((prev) => ({ ...prev, dateFrom: nextRange.dateFrom, dateTo: nextRange.dateTo }));
              }}
              includeAll
            />
          </div>

          <Button
            className="report-reset-btn"
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
        </div>

        <div className="report-filter-grid report-filter-grid-secondary">
          {(reportType === 'PRESCRIPTION' || reportType === 'CONSULTATION') && (
            <label>
              <span>Patient</span>
              <Select
                value={filters.patientId}
                onChange={(e) => setFilters((prev) => ({ ...prev, patientId: e.target.value ? Number(e.target.value) : '' }))}
              >
                <option value="">All patients</option>
                {patients.map((p) => (
                  <option key={p.patientId} value={p.patientId}>{p.name}</option>
                ))}
              </Select>
            </label>
          )}

          {reportType === 'PRESCRIPTION' && medicines.length > 0 && (
            <label>
              <span>Medicine</span>
              <Select
                value={filters.medicineId}
                onChange={(e) => setFilters((prev) => ({ ...prev, medicineId: e.target.value ? Number(e.target.value) : '' }))}
              >
                <option value="">All medicines</option>
                {medicines.map((m) => (
                  <option key={m.medicineId} value={m.medicineId}>{m.name} ({m.batchNumber})</option>
                ))}
              </Select>
            </label>
          )}

          {reportType === 'CONSULTATION' && (
            <label>
              <span>Status</span>
              <Select value={filters.consultationStatus} onChange={(e) => setFilters((prev) => ({ ...prev, consultationStatus: e.target.value }))}>
                <option value="">All consultation statuses</option>
                <option value="WAITING">Waiting</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="COMPLETED">Completed</option>
              </Select>
            </label>
          )}

          {reportType === 'INVENTORY' && (
            <label>
              <span>Expiring Days</span>
              <Input
                type="number"
                min={1}
                value={filters.expiringDays}
                onChange={(e) => setFilters((prev) => ({ ...prev, expiringDays: Math.max(1, Number(e.target.value) || 30) }))}
                placeholder="Expiring days"
              />
            </label>
          )}

          {(reportType === 'PAYMENT' || reportType === 'RECEIPT' || reportType === 'SALES') && (
            <label>
              <span>Payment Type</span>
              <Select value={filters.paymentType} onChange={(e) => setFilters((prev) => ({ ...prev, paymentType: (e.target.value as PaymentType | '') || '' }))}>
                <option value="">All payment types</option>
                <option value="CONSULTATION">Consultation Fee</option>
                <option value="APPOINTMENT">Appointment</option>
                <option value="MEDICAL_CHECKUP">Medical Checkup</option>
                <option value="MEDICINE">Medicine Sale</option>
              </Select>
            </label>
          )}

          {reportType === 'SALES' && (
            <label>
              <span>Sale Status</span>
              <Select value={filters.saleStatus} onChange={(e) => setFilters((prev) => ({ ...prev, saleStatus: e.target.value }))}>
                <option value="">All sale statuses</option>
                <option value="PAID">Paid</option>
                <option value="PENDING_DISPENSE">Pending Dispense</option>
                <option value="DISPENSED">Dispensed</option>
                <option value="CANCELLED">Cancelled</option>
              </Select>
            </label>
          )}

          {reportType === 'RECEIPT' && (
            <label>
              <span>Receipt No</span>
              <Input value={filters.receiptNo} onChange={(e) => setFilters((prev) => ({ ...prev, receiptNo: e.target.value }))} placeholder="Receipt no" />
            </label>
          )}
        </div>

      </div>

      {error && <p className="error report-feedback">{error}</p>}

      {!loading && reportType === 'PATIENT' && (
        <ReportSection title="Patient Report" subtitle="Patient list with registration status, activity, and paid contribution." actions={exportActions}>
          <div className="metrics-grid report-metrics-grid">
            <MetricCard icon="PT" label="Total Patients" value={patientItems.length} />
            <MetricCard icon="WI" label="Walk-in Count" value={walkInPatientCount} tone="warning" />
            <MetricCard icon="AC" label="Active Patients" value={activePatientCount} tone="good" />
            <MetricCard icon="CT" label="Consultations" value={patientItems.reduce((sum, item) => sum + (item.consultationsCount ?? 0), 0)} />
          </div>
          <div className="table-wrap report-table-wrap">
            <table className="data-table report-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Status</th>
                  <th>Registered</th>
                  <th>IC / Passport</th>
                  <th>Phone</th>
                  <th>Consultations</th>
                  <th>Total Paid (RM)</th>
                </tr>
              </thead>
              <tbody>
                {paginatedPatientItems.map((item) => (
                  <tr key={item.patientId}>
                    <td><strong>{item.name}</strong></td>
                    <td><ReportBadge tone={item.isActive === false ? 'neutral' : 'good'}>{item.isActive === false ? 'Archived' : 'Active'}</ReportBadge></td>
                    <td>{toDateInput(item.createdAt)}</td>
                    <td>{item.icOrPassport}</td>
                    <td>{item.phone}</td>
                    <td>{item.consultationsCount ?? '-'}</td>
                    <td>{formatMoney(item.totalPaid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={patientPage} totalPages={patientTotalPages} onPageChange={setPatientPage} />
          {patientItems.length === 0 && <EmptyReportState message="No patient records found." />}
        </ReportSection>
      )}

      {!loading && reportType === 'PRESCRIPTION' && (
        <ReportSection title="Prescription Report" subtitle="Medicine tags, status, and dispensing readiness by prescription." actions={exportActions}>
          <div className="metrics-grid report-metrics-grid">
            <MetricCard icon="RX" label="Prescriptions" value={prescriptionItems.length} />
            <MetricCard icon="MD" label="Total Medicines" value={prescriptionMedicineCount} />
            <MetricCard icon="OK" label="Dispensed" value={prescriptionItems.filter((item) => item.status === 'DISPENSED').length} tone="good" />
            <MetricCard icon="PN" label="Pending" value={prescriptionItems.filter((item) => item.status === 'PENDING_VERIFICATION').length} tone="warning" />
          </div>
          <div className="table-wrap report-table-wrap">
            <table className="data-table report-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Medicines</th>
                  <th>Total Meds</th>
                  <th>Status</th>
                  <th>Dispensing</th>
                </tr>
              </thead>
              <tbody>
                {paginatedPrescriptionItems.map((item) => (
                  <tr key={item.prescriptionId}>
                    <td>{new Date(item.date).toLocaleString()}</td>
                    <td>{item.patient.name}</td>
                    <td>{item.doctor.username}</td>
                    <td><MedicineTags items={item.items} /></td>
                    <td>{item.items.reduce((sum, med) => sum + med.qty, 0)}</td>
                    <td><ReportBadge tone={getStatusTone(item.status)}>{prettifyEnum(item.status ?? 'PENDING')}</ReportBadge></td>
                    <td><ReportBadge tone={item.status === 'DISPENSED' ? 'good' : item.status === 'REJECTED' ? 'critical' : 'warning'}>{item.status === 'DISPENSED' ? 'Dispensed' : item.status === 'REJECTED' ? 'Rejected' : 'Pending'}</ReportBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={prescriptionPage} totalPages={prescriptionTotalPages} onPageChange={setPrescriptionPage} />
          {prescriptionItems.length === 0 && <EmptyReportState message="No prescription records found." />}
        </ReportSection>
      )}

      {!loading && reportType === 'CONSULTATION' && (
        <ReportSection title="Consultation Report" subtitle="Consultation workload, follow-ups, fees, and clinical status at a glance." actions={exportActions}>
          <div className="metrics-grid report-metrics-grid">
            <MetricCard icon="DR" label="Consultations" value={consultationItems.length} />
            <MetricCard icon="OK" label="Completed" value={consultationItems.filter((item) => item.status === 'COMPLETED').length} tone="good" />
            <MetricCard icon="FU" label="Follow-ups" value={consultationItems.filter((item) => item.appointment?.type === 'FOLLOW_UP').length} tone="warning" />
            <MetricCard icon="RM" label="Consultation Fees" value={`RM ${formatMoney(consultationFeeTotal)}`} />
          </div>
          <div className="table-wrap report-table-wrap">
            <table className="data-table report-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Patient</th>
                  <th>Doctor</th>
                  <th>Type</th>
                  <th>Follow-up</th>
                  <th>Status</th>
                  <th>Diagnosis</th>
                  <th>Fee</th>
                </tr>
              </thead>
              <tbody>
                {paginatedConsultationItems.map((item) => (
                  <tr key={item.consultationId}>
                    <td>{new Date(item.createdAt).toLocaleString()}</td>
                    <td>{item.patient.name}</td>
                    <td>{item.doctor.username}</td>
                    <td><ReportBadge tone="neutral">{prettifyEnum(item.consultationType)}</ReportBadge></td>
                    <td>
                      <ReportBadge tone={item.appointment?.type === 'FOLLOW_UP' ? 'warning' : 'neutral'}>
                        {item.appointment?.type === 'FOLLOW_UP' ? 'Follow-up' : 'Standard'}
                      </ReportBadge>
                    </td>
                    <td><ReportBadge tone={getStatusTone(item.status)}>{prettifyEnum(item.status)}</ReportBadge></td>
                    <td>
                      <span className="report-diagnosis" title={item.diagnosis ?? 'No diagnosis recorded'}>
                        {item.diagnosis ?? '-'}
                      </span>
                    </td>
                    <td>{item.payment ? `RM ${formatMoney(item.payment.amount)}` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={consultationPage} totalPages={consultationTotalPages} onPageChange={setConsultationPage} />
          {consultationItems.length === 0 && <EmptyReportState message="No consultation records found." />}
        </ReportSection>
      )}

      {!loading && reportType === 'INVENTORY' && (
        <ReportSection title="Inventory Report" subtitle="Low stock and expiry risk split into compact operational queues." actions={exportActions}>
          <div className="metrics-grid report-metrics-grid">
            <MetricCard icon="LS" label="Low Stock (<10)" value={lowStockItems.length} tone="danger" />
            <MetricCard icon="EX" label={`Expiring <= ${filters.expiringDays} days`} value={expiringItems.length} tone="warning" />
            <MetricCard icon="XP" label="Expired" value={expiredInventoryCount} tone={expiredInventoryCount > 0 ? 'danger' : 'good'} />
            <MetricCard icon="AL" label="Total Alerts" value={lowStockItems.length + expiringItems.length} tone="warning" />
          </div>

          <div className="report-inventory-grid">
            <div className="report-card report-subsection">
              <div className="report-section-head report-subsection-head">
                <div>
                  <h3>Low Stock</h3>
                  <p className="muted">Medicines below reorder threshold.</p>
                </div>
                <ReportBadge tone={lowStockItems.length > 0 ? 'critical' : 'good'}>{lowStockItems.length} items</ReportBadge>
              </div>
              <div className="table-wrap report-table-wrap">
                <table className="data-table report-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Category</th>
                      <th>Supplier</th>
                      <th>Batch</th>
                      <th>Qty</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedLowStockItems.map((item) => (
                      <tr key={item.medicineId}>
                        <td>{item.name}</td>
                        <td>{item.category ?? 'Medicine'}</td>
                        <td>{item.companyName ?? '-'}</td>
                        <td>{item.batchNumber}</td>
                        <td>{item.quantity}</td>
                        <td><ReportBadge tone={item.quantity <= 0 ? 'critical' : 'warning'}>{item.quantity <= 0 ? 'Out of stock' : 'Low stock'}</ReportBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Pagination page={lowStockPage} totalPages={lowStockTotalPages} onPageChange={setLowStockPage} />
              {lowStockItems.length === 0 && <EmptyReportState message="All medicines are sufficiently stocked." />}
            </div>

            <div className="report-card report-subsection">
              <div className="report-section-head report-subsection-head">
                <div>
                  <h3>Expiring Soon</h3>
                  <p className="muted">Medicines reaching expiry window.</p>
                </div>
                <ReportBadge tone={expiringItems.length > 0 ? 'warning' : 'good'}>{expiringItems.length} items</ReportBadge>
              </div>
              <div className="table-wrap report-table-wrap">
                <table className="data-table report-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Category</th>
                      <th>Supplier</th>
                      <th>Batch</th>
                      <th>Expiry</th>
                      <th>Expiry Countdown</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedExpiringItems.map((item) => (
                      <tr key={item.medicineId}>
                        <td>{item.name}</td>
                        <td>{item.category ?? 'Medicine'}</td>
                        <td>{item.companyName ?? '-'}</td>
                        <td>{item.batchNumber}</td>
                        <td>{toDateInput(item.expiryDate)}</td>
                        <td>{formatExpiryCountdown(item.expiryDate)}</td>
                        <td><ReportBadge tone={daysUntil(item.expiryDate) < 0 ? 'critical' : 'warning'}>{daysUntil(item.expiryDate) < 0 ? 'Expired' : 'Near expiry'}</ReportBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Pagination page={expiringPage} totalPages={expiringTotalPages} onPageChange={setExpiringPage} />
              {expiringItems.length === 0 && <EmptyReportState message="No medicines are close to expiry." />}
            </div>
          </div>

          {lowStockItems.length === 0 && expiringItems.length === 0 && <EmptyReportState message="No inventory alerts found." />}
        </ReportSection>
      )}

      {!loading && reportType === 'PAYMENT' && (
        <ReportSection title="Payment Report" subtitle="Revenue breakdown by payment type, method, receipt, and patient." actions={exportActions}>
          <div className="metrics-grid report-metrics-grid">
            <MetricCard icon="TX" label="Total Payments" value={paymentSummary?.count ?? 0} />
            <MetricCard icon="DR" label="Consultation Revenue" value={`RM ${formatMoney(paymentConsultationTotal)}`} />
            <MetricCard icon="AP" label="Appointment Revenue" value={`RM ${formatMoney(paymentAppointmentTotal)}`} />
            <MetricCard icon="MD" label="Medicine Revenue" value={`RM ${formatMoney(paymentMedicineTotal)}`} tone="good" />
          </div>

          <div className="report-chart-panel">
            <div className="report-chart-toolbar">
              <div>
                <h3>Collection Trend</h3>
                <p className="muted">Total {formatShortMoney(paymentSummary?.total ?? 0)} across {paymentSummary?.count ?? 0} payments</p>
              </div>
              <div className="report-chart-controls" aria-label="Payment chart grouping">
                {(['daily', 'weekly', 'monthly'] as ChartMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={paymentChartMode === mode ? 'is-active' : ''}
                    onClick={() => setPaymentChartMode(mode)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            <ReportChart data={paymentChartData} mode={paymentChartMode} />
          </div>

          <div className="table-wrap report-table-wrap">
            <table className="data-table report-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Method</th>
                  <th>Patient</th>
                  <th>Amount (RM)</th>
                  <th>Receipt</th>
                </tr>
              </thead>
              <tbody>
                {paginatedPaymentItems.map((item) => (
                  <tr key={item.paymentId}>
                    <td>{new Date(item.date).toLocaleString()}</td>
                    <td><span className={`status-badge ${getTypeClass(item.type)}`}>{prettifyPaymentType(item.type)}</span></td>
                    <td><span className={`status-badge ${getPaymentMethodClass(item.paymentMethod)}`}>{item.paymentMethod ? prettifyEnum(item.paymentMethod) : '-'}</span></td>
                    <td>{item.patient?.name ?? '-'}</td>
                    <td>{formatMoney(item.amount)}</td>
                    <td>
                      {item.receipt?.receiptNo ? (
                        <button
                          type="button"
                          className="report-link-button"
                          onClick={() => {
                            setReportType('RECEIPT');
                            setFilters((prev) => ({ ...prev, receiptNo: item.receipt?.receiptNo ?? '' }));
                          }}
                        >
                          {item.receipt.receiptNo}
                        </button>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={paymentPage} totalPages={paymentTotalPages} onPageChange={setPaymentPage} />

          {(paymentSummary?.payments.length ?? 0) === 0 && <EmptyReportState message="No payment transactions found." />}
        </ReportSection>
      )}

      {!loading && reportType === 'SALES' && (
        <ReportSection title="Sales Report" subtitle="Sales trend, receipt status, and medicine items in one readable view." actions={exportActions}>
          <div className="metrics-grid report-metrics-grid">
            <MetricCard icon="TX" label="Total Sales" value={salesSummary?.count ?? 0} />
            <MetricCard icon="RM" label="Revenue" value={`RM ${formatMoney(salesSummary?.total ?? 0)}`} tone="good" />
            <MetricCard icon="AV" label="Average Sale" value={`RM ${formatMoney(averageSale)}`} />
            <MetricCard icon="MD" label="Medicine Sales" value={`RM ${formatMoney(salesMedicineTotal)}`} />
          </div>

          <div className="report-chart-panel">
            <div className="report-chart-toolbar">
              <div>
                <h3>Revenue Trend</h3>
                <p className="muted">Total {formatShortMoney(salesSummary?.total ?? 0)} across {salesSummary?.count ?? 0} transactions</p>
              </div>
              <div className="report-chart-controls" aria-label="Sales chart grouping">
                {(['daily', 'weekly', 'monthly'] as ChartMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={salesChartMode === mode ? 'is-active' : ''}
                    onClick={() => setSalesChartMode(mode)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
            <ReportChart data={salesChartData} mode={salesChartMode} />
          </div>

          <div className="table-wrap report-table-wrap">
            <table className="data-table report-table">
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
                    <td><span className={`status-badge ${getTypeClass(item.type)}`}>{prettifyPaymentType(item.type)}</span></td>
                    <td>{item.patient?.name ?? '-'}</td>
                    <td>
                      {item.receipt?.receiptNo ? (
                        <button
                          type="button"
                          className="report-link-button"
                          onClick={() => {
                            setReportType('RECEIPT');
                            setFilters((prev) => ({ ...prev, receiptNo: item.receipt?.receiptNo ?? '' }));
                          }}
                        >
                          {item.receipt.receiptNo}
                        </button>
                      ) : '-'}
                    </td>
                    <td><MedicineTags items={item.medicineItems} /></td>
                    <td><ReportBadge tone={getStatusTone(item.status)}>{prettifyEnum(item.status)}</ReportBadge></td>
                    <td>{formatMoney(item.receipt?.totalAmount ?? item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={salesPage} totalPages={salesTotalPages} onPageChange={setSalesPage} />
          {(salesSummary?.sales.length ?? 0) === 0 && <EmptyReportState message="No sales transactions found." />}
        </ReportSection>
      )}

      {!loading && reportType === 'RECEIPT' && (
        <ReportSection title="Receipt Report" subtitle="Receipt lookup with compact actions for viewing, printing, and PDF export." actions={exportActions}>
          {previewReceipt && (
            <div className="report-receipt-preview" role="region" aria-label="Receipt preview">
              <div>
                <span className="report-receipt-label">Preview</span>
                <strong>{previewReceipt.receiptNo}</strong>
                <p className="muted">
                  {previewReceipt.payment?.patient?.name ?? 'Walk-in customer'} - {previewReceipt.payment ? prettifyPaymentType(previewReceipt.payment.type) : 'Receipt'}
                </p>
              </div>
              <div>
                <span className="report-receipt-total">RM {formatMoney(previewReceipt.totalAmount)}</span>
                <button type="button" className="btn btn-ghost report-icon-btn" onClick={() => setPreviewReceipt(null)}>Close</button>
              </div>
            </div>
          )}

          <div className="table-wrap report-table-wrap">
            <table className="data-table report-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Receipt No</th>
                  <th>Patient</th>
                  <th>Type</th>
                  <th>Total (RM)</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedReceiptItems.map((item) => (
                  <tr key={item.receiptId}>
                    <td>{new Date(item.date).toLocaleString()}</td>
                    <td><button type="button" className="report-link-button" onClick={() => setPreviewReceipt(item)}>{item.receiptNo}</button></td>
                    <td>{item.payment?.patient?.name ?? '-'}</td>
                    <td>{item.payment ? <span className={`status-badge ${getTypeClass(item.payment.type)}`}>{prettifyPaymentType(item.payment.type)}</span> : '-'}</td>
                    <td>{formatMoney(item.totalAmount)}</td>
                    <td>
                      <div className="report-row-actions">
                        <button type="button" className="btn btn-ghost report-icon-btn" onClick={() => setPreviewReceipt(item)}>View</button>
                        <button type="button" className="btn btn-ghost report-icon-btn" onClick={() => exportReceiptRecord(item)}>Print</button>
                        <button type="button" className="btn btn-ghost report-icon-btn" onClick={() => exportReceiptRecord(item)}>PDF</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={receiptPage} totalPages={receiptTotalPages} onPageChange={setReceiptPage} />

          {receiptItems.length === 0 && <EmptyReportState message="No receipts found." />}
        </ReportSection>
      )}
    </section>
  );
};

