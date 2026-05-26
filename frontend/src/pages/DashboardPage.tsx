import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { subscribeInAppDataSync } from '../lib/sync';
import { useAuth } from '../context/AuthContext';
import { roleBasePath } from '../config/rbac';

type Patient = {
  patientId: number;
  name: string;
  icOrPassport?: string | null;
  createdAt?: string;
};

type Appointment = {
  appointmentId: number;
  dateTime: string;
  status: 'PENDING' | 'ARRIVED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  type?: 'NEW' | 'FOLLOW_UP';
  createdAt?: string;
  previousPrescriptionId?: number | null;
  followUpFromConsultationId?: number | null;
  patient?: { name: string; icOrPassport?: string | null } | null;
};

type Consultation = {
  consultationId: number;
  createdAt: string;
  status: 'WAITING' | 'IN_PROGRESS' | 'COMPLETED';
  consultationType?: string;
  patient?: { name: string } | null;
};

type Prescription = {
  prescriptionId: number;
  date: string;
  status?: 'PENDING_VERIFICATION' | 'VERIFIED' | 'DISPENSED' | 'REJECTED';
  patient?: { name: string } | null;
  items?: Array<{ medicineId: number; medicine?: { name: string } | null }>;
};

type Medicine = {
  medicineId: number;
  name: string;
  category?: 'MEDICINE' | 'SUPPLEMENT' | 'VITAMIN' | 'CONTROLLED_MEDICINE';
  batchNumber?: string;
  quantity: number;
  stockUnit?: string;
  expiryDate: string;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt?: string;
};

type Payment = {
  paymentId: number;
  date: string;
  type: 'CONSULTATION' | 'APPOINTMENT' | 'MEDICAL_CHECKUP' | 'MEDICINE' | 'CUSTOM';
  amount: number | string;
  status: 'PENDING_PAYMENT' | 'PAID' | 'PENDING_DISPENSE' | 'DISPENSED' | 'CANCELLED';
  patient?: { name: string; icOrPassport?: string | null } | null;
  receipt?: { receiptNo?: string; totalAmount?: number | string } | null;
  medicineItems?: Array<{ qty: number; subtotal: number | string; medicine?: { name: string } | null }>;
};

type AuditLog = {
  logId: number;
  activityType?: string;
  action?: string;
  createdAt?: string;
  timestamp?: string;
  user?: { username?: string | null } | null;
};

type DashboardData = {
  patients: Patient[];
  appointments: Appointment[];
  consultations: Consultation[];
  prescriptions: Prescription[];
  medicines: Medicine[];
  payments: Payment[];
  pendingPayments: Payment[];
  sales: Payment[];
  auditLogs: AuditLog[];
};

type ChartMode = 'daily' | 'weekly' | 'monthly';
type ChartFormat = 'money' | 'number';
type Severity = 'critical' | 'warning' | 'good' | 'neutral' | 'verified';

const emptyData: DashboardData = {
  patients: [],
  appointments: [],
  consultations: [],
  prescriptions: [],
  medicines: [],
  payments: [],
  pendingPayments: [],
  sales: [],
  auditLogs: [],
};

const todayKey = () => toDateKey(new Date());

const toDateKey = (value: string | Date | null | undefined) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const formatMoney = (value: number | string | null | undefined) => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : '0.00';
};

const sumAmount = (payments: Payment[]) => payments.reduce((sum, payment) => sum + Number(payment.receipt?.totalAmount ?? payment.amount ?? 0), 0);

const statusClass = (status: string | undefined) => {
  if (!status) return 'status-neutral';
  if (['COMPLETED', 'PAID', 'DISPENSED', 'APPROVED'].includes(status)) return 'status-good';
  if (['PENDING', 'ARRIVED', 'WAITING', 'IN_PROGRESS', 'PENDING_PAYMENT', 'PENDING_DISPENSE', 'PENDING_VERIFICATION', 'NEAR_EXPIRY', 'LOW_STOCK'].includes(status)) return 'status-warning';
  if (['VERIFIED'].includes(status)) return 'status-verified';
  return 'status-critical';
};

const prettify = (value: string | undefined) => (value ?? '-').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());

const daysUntil = (value: string) => {
  const expiry = new Date(value);
  expiry.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((expiry.getTime() - now.getTime()) / 86_400_000);
};

const formatShortValue = (value: number, format: ChartFormat) => {
  if (format === 'money') {
    if (value >= 1000) return `RM ${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
    return `RM ${value.toFixed(0)}`;
  }
  return String(Math.round(value));
};

const formatDelta = (current: number, previous: number, unit = '') => {
  const difference = current - previous;
  if (difference === 0) return current === 0 ? 'No activity today' : 'No change from yesterday';
  const suffix = unit ? ` ${unit}` : '';
  return `${difference > 0 ? '+' : ''}${difference}${suffix} from yesterday`;
};

const categoryLabel = (category: Medicine['category']) => {
  if (category === 'CONTROLLED_MEDICINE') return 'Controlled';
  if (category === 'SUPPLEMENT') return 'Supplement';
  if (category === 'VITAMIN') return 'Vitamin';
  return 'Medicine';
};

const getApiErrorMessage = (error: unknown) => {
  if (typeof error === 'object' && error !== null) {
    const message = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
    if (message) return message;
  }
  return 'Failed to load dashboard data.';
};

const fetchOrEmpty = async <T,>(path: string, params?: Record<string, unknown>) => {
  try {
    const response = await api.get(path, { params });
    return normalizeList<T>(response.data);
  } catch {
    return [];
  }
};

const normalizeList = <T,>(payload: unknown): T[] => {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const listKeys = ['data', 'items', 'results', 'patients', 'appointments', 'consultations', 'prescriptions', 'medicines', 'payments', 'sales', 'logs'];
    for (const key of listKeys) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
  }
  return [];
};

const buildSeries = (payments: Payment[], mode: ChartMode) => {
  const buckets = mode === 'monthly' ? 6 : mode === 'weekly' ? 7 : 7;
  const labels: string[] = [];
  const values: number[] = [];
  const now = new Date();

  for (let i = buckets - 1; i >= 0; i -= 1) {
    const start = new Date(now);
    if (mode === 'monthly') {
      start.setMonth(now.getMonth() - i, 1);
      start.setHours(0, 0, 0, 0);
      const key = `${start.getFullYear()}-${start.getMonth()}`;
      labels.push(start.toLocaleString(undefined, { month: 'short' }));
      values.push(payments.filter((payment) => {
        const date = new Date(payment.date);
        return `${date.getFullYear()}-${date.getMonth()}` === key;
      }).reduce((sum, payment) => sum + Number(payment.receipt?.totalAmount ?? payment.amount ?? 0), 0));
      continue;
    }

    start.setDate(now.getDate() - i);
    start.setHours(0, 0, 0, 0);
    const key = toDateKey(start);
    labels.push(mode === 'weekly' ? start.toLocaleDateString(undefined, { weekday: 'short' }) : start.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }));
    values.push(payments.filter((payment) => toDateKey(payment.date) === key).reduce((sum, payment) => sum + Number(payment.receipt?.totalAmount ?? payment.amount ?? 0), 0));
  }

  return labels.map((label, index) => ({ label, value: values[index] }));
};

const buildCountSeries = <T extends { dateTime?: string; date?: string; createdAt?: string }>(items: T[], mode: ChartMode, dateKey: keyof T) => {
  const buckets = mode === 'monthly' ? 6 : 7;
  const now = new Date();

  return Array.from({ length: buckets }, (_, index) => {
    const offset = buckets - 1 - index;
    const start = new Date(now);

    if (mode === 'monthly') {
      start.setMonth(now.getMonth() - offset, 1);
      start.setHours(0, 0, 0, 0);
      const key = `${start.getFullYear()}-${start.getMonth()}`;
      return {
        label: start.toLocaleString(undefined, { month: 'short' }),
        value: items.filter((item) => {
          const raw = item[dateKey];
          const date = raw ? new Date(String(raw)) : null;
          return date && `${date.getFullYear()}-${date.getMonth()}` === key;
        }).length,
      };
    }

    start.setDate(now.getDate() - offset);
    start.setHours(0, 0, 0, 0);
    const key = toDateKey(start);
    return {
      label: mode === 'weekly' ? start.toLocaleDateString(undefined, { weekday: 'short' }) : start.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }),
      value: items.filter((item) => toDateKey(String(item[dateKey] ?? '')) === key).length,
    };
  });
};

const EmptyState = ({ icon = '-', message }: { icon?: string; message: string }) => (
  <div className="dashboard-empty">
    <span aria-hidden="true">{icon}</span>
    <p>{message}</p>
  </div>
);

const buildSmoothPath = (points: Array<{ x: number; y: number }>) => {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  return points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = points[index - 1];
    const controlX = (previous.x + point.x) / 2;
    return `${path} Q ${controlX} ${previous.y} ${point.x} ${point.y}`;
  }, '');
};

const ValueChart = ({ data, format = 'number', variant = 'area', summary }: { data: Array<{ label: string; value: number }>; format?: ChartFormat; variant?: 'area' | 'bar'; summary?: string }) => {
  if (data.length === 0 || data.every((item) => item.value === 0)) {
    return <EmptyState icon="-" message={format === 'money' ? 'No paid transactions in this period.' : 'No chart data available yet.'} />;
  }

  const width = 640;
  const height = 260;
  const padding = { top: 22, right: 24, bottom: 42, left: 66 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const max = Math.max(...data.map((item) => item.value), 1);
  const yTicks = [0, 0.5, 1].map((ratio) => Math.round(max * ratio));
  const xStep = data.length > 1 ? chartWidth / (data.length - 1) : chartWidth;
  const points = data.map((item, index) => {
    const x = padding.left + (data.length > 1 ? index * xStep : chartWidth / 2);
    const y = padding.top + chartHeight - (item.value / max) * chartHeight;
    return { ...item, x, y };
  });
  const path = buildSmoothPath(points);
  const areaPath = `${path} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`;

  return (
    <div className="dashboard-chart-card">
      {summary && <span className="dashboard-chart-summary">{summary}</span>}
      <svg className="dashboard-svg-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Dashboard analytics chart">
        <defs>
          <linearGradient id="dashboardAreaFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {yTicks.map((tick) => {
          const y = padding.top + chartHeight - (tick / max) * chartHeight;
          return (
            <g key={tick}>
              <line className="dashboard-chart-gridline" x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
              <text className="dashboard-chart-axis" x={padding.left - 10} y={y + 4} textAnchor="end">{formatShortValue(tick, format)}</text>
            </g>
          );
        })}
        <line className="dashboard-chart-axis-line" x1={padding.left} x2={width - padding.right} y1={padding.top + chartHeight} y2={padding.top + chartHeight} />
        <line className="dashboard-chart-axis-line" x1={padding.left} x2={padding.left} y1={padding.top} y2={padding.top + chartHeight} />

        {variant === 'bar' ? points.map((point, index) => {
          const barWidth = Math.min(44, chartWidth / data.length - 10);
          const barHeight = padding.top + chartHeight - point.y;
          return (
            <g key={point.label}>
              <rect
                className="dashboard-chart-bar"
                x={point.x - barWidth / 2}
                y={point.y}
                width={barWidth}
                height={Math.max(2, barHeight)}
                rx="6"
              >
                <title>{`${point.label}: ${formatShortValue(point.value, format)}`}</title>
              </rect>
              <text className="dashboard-chart-value" x={point.x} y={Math.max(14, point.y - 8)} textAnchor="middle">{formatShortValue(point.value, format)}</text>
              <text className="dashboard-chart-axis" x={point.x} y={height - 14} textAnchor="middle">{point.label}</text>
              {index < points.length - 1 && <line className="dashboard-chart-tick" x1={point.x} x2={point.x} y1={padding.top + chartHeight} y2={padding.top + chartHeight + 5} />}
            </g>
          );
        }) : (
          <>
            <path className="dashboard-chart-area" d={areaPath} />
            <path className="dashboard-chart-line" d={path} />
            {points.map((point) => (
              <g key={point.label}>
                <circle className="dashboard-chart-point" cx={point.x} cy={point.y} r="4.5">
                  <title>{`${point.label}: ${formatShortValue(point.value, format)}`}</title>
                </circle>
                <text className="dashboard-chart-value" x={point.x} y={Math.max(14, point.y - 9)} textAnchor="middle">{formatShortValue(point.value, format)}</text>
                <text className="dashboard-chart-axis" x={point.x} y={height - 14} textAnchor="middle">{point.label}</text>
              </g>
            ))}
          </>
        )}
      </svg>
    </div>
  );
};

const HorizontalBarChart = ({ data, format = 'number', emptyMessage }: { data: Array<{ label: string; value: number; color?: string }>; format?: ChartFormat; emptyMessage: string }) => {
  const max = Math.max(...data.map((item) => item.value), 0);
  if (max === 0) return <EmptyState icon="-" message={emptyMessage} />;

  return (
    <div className="dashboard-hbar-chart" role="img" aria-label="Dashboard bar chart">
      {data.map((item) => (
        <div key={item.label} className="dashboard-hbar-row">
          <span>{item.label}</span>
          <div className="dashboard-hbar-track">
            <i style={{ width: `${Math.max(5, (item.value / max) * 100)}%`, background: item.color }}>
              <title>{`${item.label}: ${formatShortValue(item.value, format)}`}</title>
            </i>
          </div>
          <b>{formatShortValue(item.value, format)}</b>
        </div>
      ))}
    </div>
  );
};

const FlowStrip = ({ items }: { items: Array<{ label: string; value: number | string; tone?: Severity }> }) => (
  <div className="dashboard-flow-strip">
    {items.map((item) => (
      <article key={item.label} className={item.tone ? `is-${item.tone}` : undefined}>
        <span>{item.label}</span>
        <strong>{item.value}</strong>
      </article>
    ))}
  </div>
);

const SeverityPill = ({ label, severity }: { label: string; severity: Severity }) => (
  <span className={`dashboard-severity dashboard-severity-${severity}`}>{label}</span>
);

const WorkflowList = ({ items, emptyMessage }: { items: Array<{ title: string; meta: string; status?: string; severity?: Severity }>; emptyMessage: string }) => (
  <div className="dashboard-workflow-list">
    {items.length > 0 ? items.map((item, index) => (
      <article key={`${item.title}-${item.meta}-${index}`}>
        <div>
          <strong>{item.title}</strong>
          <small>{item.meta}</small>
        </div>
        {item.severity ? <SeverityPill label={item.status ?? prettify(item.severity)} severity={item.severity} /> : item.status ? <span className={`status-badge ${statusClass(item.status.toUpperCase().replace(/ /g, '_'))}`}>{item.status}</span> : null}
      </article>
    )) : <EmptyState icon="OK" message={emptyMessage} />}
  </div>
);

const DashboardPanel = ({ title, subtitle, action, children }: { title: string; subtitle: string; action?: ReactNode; children: ReactNode }) => (
  <section className="dashboard-panel">
    <div className="dashboard-panel-head">
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
    {children}
  </section>
);

const DashboardTable = ({ headers, rows, statusColumn, emptyMessage, emptyIcon = '-' }: { headers: string[]; rows: string[][]; statusColumn?: number; emptyMessage: string; emptyIcon?: string }) => (
  <div className="dashboard-table-wrap">
    <table className="dashboard-table">
      <thead>
        <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.length > 0 ? rows.map((row, index) => (
          <tr key={`${row.join('-')}-${index}`}>
            {row.map((cell, cellIndex) => (
              <td key={`${cell}-${cellIndex}`}>
                {statusColumn === cellIndex ? <span className={`status-badge ${statusClass(cell.toUpperCase().replace(/ /g, '_'))}`}>{cell}</span> : cell}
              </td>
            ))}
          </tr>
        )) : (
          <tr>
            <td colSpan={headers.length}>
              <EmptyState icon={emptyIcon} message={emptyMessage} />
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);

const Timeline = ({ items }: { items: Array<{ text: string; date: string }> }) => (
  <div className="dashboard-timeline">
    {items.length > 0 ? items.map((item, index) => (
      <article key={`${item.text}-${index}`}>
        <span />
        <div>
          <strong>{item.text}</strong>
          <small>{item.date ? new Date(item.date).toLocaleString() : '-'}</small>
        </div>
      </article>
    )) : <EmptyState icon="OK" message="No meaningful clinic activity yet." />}
  </div>
);

export const DashboardPage = () => {
  const { role, username } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData>(emptyData);
  const [chartMode, setChartMode] = useState<ChartMode>('daily');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const basePath = role ? roleBasePath[role] : '';
  const today = todayKey();

  const loadDashboard = async () => {
    if (!role) return;
    setLoading(true);
    setError(null);

    try {
      const common = {
        patients: fetchOrEmpty<Patient>('/patients'),
        prescriptions: role !== 'RECEPTIONIST' ? fetchOrEmpty<Prescription>('/prescriptions') : Promise.resolve([]),
        medicines: role !== 'RECEPTIONIST' ? fetchOrEmpty<Medicine>('/medicine', { includePending: true }) : Promise.resolve([]),
        sales: fetchOrEmpty<Payment>('/payments/sales'),
      };

      const [patients, appointments, consultations, prescriptions, medicines, payments, pendingPayments, sales, auditLogs] = await Promise.all([
        common.patients,
        role !== 'PHARMACIST' ? fetchOrEmpty<Appointment>('/appointments') : Promise.resolve([]),
        role === 'DOCTOR' ? fetchOrEmpty<Consultation>('/consultations') : Promise.resolve([]),
        common.prescriptions,
        common.medicines,
        role !== 'PHARMACIST' ? fetchOrEmpty<Payment>('/payments') : Promise.resolve([]),
        role === 'RECEPTIONIST' ? fetchOrEmpty<Payment>('/payments/pending') : Promise.resolve([]),
        common.sales,
        role === 'DOCTOR' ? fetchOrEmpty<AuditLog>('/audit-logs') : Promise.resolve([]),
      ]);

      setData({ patients, appointments, consultations, prescriptions, medicines, payments, pendingPayments, sales, auditLogs });
    } catch (err: unknown) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, [role]);

  useEffect(() => subscribeInAppDataSync(() => void loadDashboard()), [role]);

  const paidClinicPayments = data.payments.filter((payment) => payment.status === 'PAID');
  const paidSales = data.sales.filter((payment) => payment.status === 'PAID' || payment.status === 'DISPENSED' || payment.type !== 'MEDICINE');
  const allRevenue = [...paidClinicPayments, ...paidSales];
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = toDateKey(yesterday);
  const todayRevenue = sumAmount(allRevenue.filter((payment) => toDateKey(payment.date) === today));
  const yesterdayRevenue = sumAmount(allRevenue.filter((payment) => toDateKey(payment.date) === yesterdayKey));
  const todayPatients = data.patients.filter((patient) => toDateKey(patient.createdAt) === today);
  const yesterdayPatients = data.patients.filter((patient) => toDateKey(patient.createdAt) === yesterdayKey);
  const todayAppointments = data.appointments.filter((appointment) => toDateKey(appointment.dateTime) === today);
  const yesterdayAppointments = data.appointments.filter((appointment) => toDateKey(appointment.dateTime) === yesterdayKey);
  const todayConsultations = data.consultations.filter((consultation) => consultation.status === 'COMPLETED' && toDateKey(consultation.createdAt) === today);
  const yesterdayConsultations = data.consultations.filter((consultation) => consultation.status === 'COMPLETED' && toDateKey(consultation.createdAt) === yesterdayKey);
  const todayPrescriptions = data.prescriptions.filter((prescription) => toDateKey(prescription.date) === today);
  const yesterdayPrescriptions = data.prescriptions.filter((prescription) => toDateKey(prescription.date) === yesterdayKey);
  const approvedMedicines = data.medicines.filter((medicine) => !medicine.approvalStatus || medicine.approvalStatus === 'APPROVED');
  const pendingInventory = data.medicines.filter((medicine) => medicine.approvalStatus === 'PENDING');
  const expiredMedicines = approvedMedicines.filter((medicine) => daysUntil(medicine.expiryDate) < 0);
  const outOfStock = approvedMedicines.filter((medicine) => medicine.quantity <= 0);
  const lowStock = approvedMedicines.filter((medicine) => medicine.quantity > 0 && medicine.quantity <= 10);
  const nearExpiry = approvedMedicines.filter((medicine) => daysUntil(medicine.expiryDate) >= 0 && daysUntil(medicine.expiryDate) <= 30);
  const pendingPrescriptions = data.prescriptions.filter((prescription) => prescription.status === 'PENDING_VERIFICATION' || prescription.status === 'VERIFIED');
  const verifiedPrescriptions = data.prescriptions.filter((prescription) => prescription.status === 'VERIFIED');
  const dispensedToday = data.prescriptions.filter((prescription) => prescription.status === 'DISPENSED' && toDateKey(prescription.date) === today);
  const dispensedYesterday = data.prescriptions.filter((prescription) => prescription.status === 'DISPENSED' && toDateKey(prescription.date) === yesterdayKey);
  const pendingDispenseSales = data.sales.filter((sale) => sale.status === 'PENDING_DISPENSE');
  const walkInToday = data.sales.filter((sale) => sale.type === 'MEDICINE' && toDateKey(sale.date) === today);
  const walkInYesterday = data.sales.filter((sale) => sale.type === 'MEDICINE' && toDateKey(sale.date) === yesterdayKey);
  const waitingConsultations = data.consultations.filter((consultation) => consultation.status === 'WAITING' || consultation.status === 'IN_PROGRESS');
  const followUpAppointments = data.appointments.filter((appointment) => appointment.type === 'FOLLOW_UP' || appointment.previousPrescriptionId || appointment.followUpFromConsultationId);
  const receptionistQueue = todayAppointments.filter((appointment) => appointment.status === 'PENDING' || appointment.status === 'ARRIVED');
  const upcomingAppointments = data.appointments.filter((appointment) => new Date(appointment.dateTime).getTime() >= Date.now() && appointment.status !== 'CANCELLED' && appointment.status !== 'NO_SHOW');
  const recentPatients = [...data.patients].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
  const recentPayments = [...data.payments, ...data.sales].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const summaryCards = useMemo(() => {
    if (role === 'RECEPTIONIST') {
      return [
        { title: 'Today Queue', value: receptionistQueue.length, icon: 'Q', subtitle: `${todayAppointments.length} appointments today` },
        { title: 'Pending Payments', value: data.pendingPayments.length, icon: 'P', subtitle: data.pendingPayments.length ? `${data.pendingPayments.length} pending confirmation` : 'No pending payments' },
        { title: 'Walk-in Patients', value: walkInToday.length, icon: 'W', subtitle: formatDelta(walkInToday.length, walkInYesterday.length, 'walk-ins') },
        { title: 'Today Revenue', value: `RM ${formatMoney(todayRevenue)}`, icon: 'RM', subtitle: yesterdayRevenue === 0 && todayRevenue === 0 ? 'No payment activity today' : `RM ${formatMoney(todayRevenue - yesterdayRevenue)} from yesterday` },
      ];
    }

    if (role === 'PHARMACIST') {
      return [
        { title: 'Pending Dispense', value: verifiedPrescriptions.length + pendingDispenseSales.length, icon: 'D', subtitle: `${verifiedPrescriptions.length} prescriptions ready` },
        { title: 'Dispensed Today', value: dispensedToday.length, icon: 'V', subtitle: formatDelta(dispensedToday.length, dispensedYesterday.length, 'dispensed') },
        { title: 'Low Stock Medicines', value: lowStock.length + outOfStock.length, icon: 'L', subtitle: outOfStock.length ? `${outOfStock.length} out of stock` : 'Stock levels acceptable' },
        { title: 'Pending Approvals', value: pendingInventory.length, icon: 'A', subtitle: pendingInventory.length ? 'Awaiting doctor review' : 'No pending inventory approvals' },
        { title: 'Today Medicine Sales', value: `RM ${formatMoney(sumAmount(walkInToday))}`, icon: 'RM', subtitle: `${walkInToday.length} walk-in sales today` },
      ];
    }

    return [
      { title: 'Waiting Consultations', value: waitingConsultations.length, icon: 'W', subtitle: waitingConsultations.length ? `${waitingConsultations.filter((item) => item.status === 'IN_PROGRESS').length} in progress` : 'No patients waiting' },
      { title: 'Appointments Today', value: todayAppointments.length, icon: 'A', subtitle: formatDelta(todayAppointments.length, yesterdayAppointments.length, 'appointments') },
      { title: 'Completed Today', value: todayConsultations.length, icon: 'C', subtitle: formatDelta(todayConsultations.length, yesterdayConsultations.length, 'consultations') },
      { title: 'Pending Prescriptions', value: pendingPrescriptions.length, icon: 'Rx', subtitle: pendingPrescriptions.length ? `${verifiedPrescriptions.length} ready to dispense` : 'No pending prescriptions' },
      { title: 'Today Revenue', value: `RM ${formatMoney(todayRevenue)}`, icon: 'RM', subtitle: yesterdayRevenue === 0 && todayRevenue === 0 ? 'No revenue today' : `RM ${formatMoney(todayRevenue - yesterdayRevenue)} from yesterday` },
    ];
  }, [role, receptionistQueue.length, todayAppointments.length, data.pendingPayments.length, walkInToday, walkInYesterday.length, todayRevenue, yesterdayRevenue, verifiedPrescriptions.length, pendingDispenseSales.length, dispensedToday.length, dispensedYesterday.length, lowStock.length, outOfStock.length, pendingInventory.length, waitingConsultations, yesterdayAppointments.length, todayConsultations.length, yesterdayConsultations.length, pendingPrescriptions.length]);

  const categoryChart = ['MEDICINE', 'VITAMIN', 'SUPPLEMENT', 'CONTROLLED_MEDICINE'].map((category, index) => ({
    label: categoryLabel(category as Medicine['category']),
    value: approvedMedicines.filter((medicine) => (medicine.category ?? 'MEDICINE') === category).length,
    color: ['#38bdf8', '#34d399', '#fbbf24', '#f87171'][index],
  }));

  const appointmentChart = ['PENDING', 'ARRIVED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'].map((status, index) => ({
    label: prettify(status),
    value: data.appointments.filter((appointment) => appointment.status === status).length,
    color: ['#fbbf24', '#38bdf8', '#34d399', '#f87171', '#94a3b8'][index],
  }));

  const topMedicines = Object.entries(data.sales.flatMap((sale) => sale.medicineItems ?? []).reduce<Record<string, number>>((acc, item) => {
    const name = item.medicine?.name ?? 'Medicine';
    acc[name] = (acc[name] ?? 0) + item.qty;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([label, value]) => ({ label, value }));

  const graphData = role === 'RECEPTIONIST'
    ? buildSeries(paidClinicPayments, chartMode)
    : role === 'PHARMACIST'
      ? buildCountSeries(data.sales.filter((sale) => sale.type === 'MEDICINE'), chartMode, 'date')
      : buildSeries(allRevenue, chartMode);
  const sideChartData = role === 'RECEPTIONIST' ? appointmentChart : categoryChart;

  const quickActions = role === 'RECEPTIONIST'
    ? [
        ['Register Patient', `${basePath}/patients`],
        ['Create Appointment', `${basePath}/appointments`],
        ['Record Payment', `${basePath}/payments`],
      ]
    : role === 'PHARMACIST'
      ? [
          ['Dispense Medicine', `${basePath}/prescriptions`],
          ['Add Inventory', `${basePath}/inventory`],
          ['View Sales', `${basePath}/sales`],
        ]
      : [
          ['Add Patient', `${basePath}/patients`],
          ['Start Consultation', `${basePath}/consultations`],
          ['Create Prescription', `${basePath}/prescriptions`],
        ];

  const activity = [
    ...data.prescriptions
      .filter((item) => item.status === 'DISPENSED')
      .map((item) => ({ text: `Prescription #${item.prescriptionId} dispensed`, date: item.date })),
    ...allRevenue.map((item) => ({ text: `Payment received from ${item.patient?.name ?? 'patient'}`, date: item.date })),
    ...data.appointments.map((item) => ({ text: `Appointment created for ${item.patient?.name ?? 'patient'}`, date: item.createdAt ?? item.dateTime })),
    ...data.consultations
      .filter((item) => item.status === 'COMPLETED')
      .map((item) => ({ text: `Consultation completed for ${item.patient?.name ?? 'patient'}`, date: item.createdAt })),
    ...pendingInventory.map((item) => ({ text: `Inventory approval pending: ${item.name}`, date: item.createdAt ?? item.expiryDate })),
    ...outOfStock.map((item) => ({ text: `Out of stock alert: ${item.name}`, date: item.createdAt ?? item.expiryDate })),
    ...nearExpiry.map((item) => ({ text: `Expiry warning: ${item.name}`, date: item.expiryDate })),
    ...data.auditLogs
      .filter((item) => {
        const action = (item.activityType ?? item.action ?? '').toLowerCase();
        return action && !action.includes('login') && /(dispense|payment|appointment|consultation|inventory|medicine)/.test(action);
      })
      .map((item) => ({
        text: prettify(item.activityType ?? item.action),
        date: item.timestamp ?? item.createdAt ?? '',
      })),
  ].filter((item) => item.date).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5);

  const allInventoryAlertItems = [
    ...expiredMedicines.map((item) => ({ title: item.name, meta: `${item.quantity} ${item.stockUnit ?? 'unit'} - Expired ${new Date(item.expiryDate).toLocaleDateString()}`, status: 'Expired', severity: 'critical' as Severity })),
    ...outOfStock.map((item) => ({ title: item.name, meta: `${item.batchNumber ?? 'No batch'} - ${new Date(item.expiryDate).toLocaleDateString()}`, status: 'Out of stock', severity: 'critical' as Severity })),
    ...nearExpiry.map((item) => ({ title: item.name, meta: `${item.quantity} ${item.stockUnit ?? 'unit'} - expires in ${daysUntil(item.expiryDate)} days`, status: 'Near expiry', severity: 'warning' as Severity })),
    ...lowStock.map((item) => ({ title: item.name, meta: `${item.quantity} ${item.stockUnit ?? 'unit'} remaining`, status: 'Low stock', severity: 'warning' as Severity })),
  ];
  const inventoryAlertItems = allInventoryAlertItems.slice(0, 3);
  const chartSummary = role === 'PHARMACIST'
    ? `${topMedicines.reduce((sum, item) => sum + item.value, 0)} sold`
    : `RM ${formatMoney(graphData.reduce((sum, item) => sum + item.value, 0))} ${chartMode === 'monthly' ? 'period' : 'this week'}`;

  const flowItems = role === 'RECEPTIONIST'
    ? [
        { label: 'In Queue', value: receptionistQueue.length, tone: receptionistQueue.length ? 'warning' as Severity : 'good' as Severity },
        { label: 'Upcoming', value: upcomingAppointments.length },
        { label: 'Pending Payment', value: data.pendingPayments.length, tone: data.pendingPayments.length ? 'warning' as Severity : 'good' as Severity },
        { label: 'Walk-ins', value: walkInToday.length },
      ]
    : role === 'PHARMACIST'
      ? [
          { label: 'Rx Ready', value: verifiedPrescriptions.length, tone: verifiedPrescriptions.length ? 'warning' as Severity : 'good' as Severity },
          { label: 'Sales To Dispense', value: pendingDispenseSales.length, tone: pendingDispenseSales.length ? 'warning' as Severity : 'good' as Severity },
          { label: 'Low Stock', value: lowStock.length + outOfStock.length, tone: lowStock.length + outOfStock.length ? 'critical' as Severity : 'good' as Severity },
          { label: 'Near Expiry', value: nearExpiry.length, tone: nearExpiry.length ? 'warning' as Severity : 'good' as Severity },
        ]
      : [
          { label: 'Waiting', value: waitingConsultations.length, tone: waitingConsultations.length ? 'warning' as Severity : 'good' as Severity },
          { label: 'Follow-ups', value: followUpAppointments.length },
          { label: 'Patients Today', value: todayPatients.length, tone: todayPatients.length > yesterdayPatients.length ? 'verified' as Severity : 'neutral' as Severity },
          { label: 'Rx Created', value: todayPrescriptions.length, tone: todayPrescriptions.length > yesterdayPrescriptions.length ? 'verified' as Severity : 'neutral' as Severity },
        ];

  return (
    <section className="dashboard-page">
      <div className="dashboard-hero">
        <div>
          <span>{role ? prettify(role) : 'Clinic'} Dashboard</span>
          <h1>Welcome, {username ?? 'team'}.</h1>
          <p>Today&apos;s clinic flow, revenue, prescriptions, and inventory health at a glance.</p>
        </div>
        <div className="dashboard-quick-actions">
          {quickActions.map(([label, path]) => (
            <button key={label} type="button" onClick={() => navigate(path)}>{label}</button>
          ))}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading dashboard...</p>}

      <div className="dashboard-summary-grid">
        {summaryCards.map((card) => (
          <article key={card.title} className="dashboard-summary-card">
            <span>{card.icon}</span>
            <div>
              <p>{card.title}</p>
              <strong>{card.value}</strong>
              <small>{card.subtitle}</small>
            </div>
          </article>
        ))}
      </div>

      {role !== 'DOCTOR' && <FlowStrip items={flowItems} />}

      <div className="dashboard-chart-grid">
        <section className="dashboard-panel dashboard-main-chart">
          <div className="dashboard-panel-head">
            <div>
              <h3>{role === 'PHARMACIST' ? 'Top Selling Medicines' : role === 'RECEPTIONIST' ? 'Daily Payment / Revenue' : 'Revenue / Sales'}</h3>
              <p>{role === 'PHARMACIST' ? 'Quantity sold by medicine with readable values' : 'Paid transactions grouped by period'}</p>
            </div>
            <div className="dashboard-chart-tools">
              <strong>{chartSummary}</strong>
              {role !== 'PHARMACIST' && (
                <div className="dashboard-segment">
                  {(['daily', 'weekly', 'monthly'] as ChartMode[]).map((mode) => (
                    <button key={mode} type="button" className={chartMode === mode ? 'is-active' : ''} onClick={() => setChartMode(mode)}>{prettify(mode)}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
          {role === 'PHARMACIST' ? (
            <HorizontalBarChart data={topMedicines} emptyMessage="No medicine sales recorded yet." />
          ) : (
            <ValueChart data={graphData} format="money" variant="area" summary={chartSummary} />
          )}
        </section>

        <section className="dashboard-panel">
          <div className="dashboard-panel-head">
            <div>
              <h3>{role === 'RECEPTIONIST' ? 'Appointment Status' : 'Medicine Categories'}</h3>
              <p>{role === 'RECEPTIONIST' ? 'Clinic flow by status' : 'Approved inventory category distribution'}</p>
            </div>
          </div>
          <HorizontalBarChart data={sideChartData} emptyMessage={role === 'RECEPTIONIST' ? 'No appointments to visualize yet.' : 'No approved inventory to visualize yet.'} />
        </section>
      </div>

      <div className="dashboard-lower-grid">
        <DashboardPanel
          title={role === 'PHARMACIST' ? 'Pending Prescriptions' : role === 'RECEPTIONIST' ? "Today's Queue" : 'Waiting Consultations'}
          subtitle={role === 'PHARMACIST' ? 'Verified prescriptions ready to dispense' : role === 'RECEPTIONIST' ? 'Patients expected or already arrived today' : 'Patients waiting for consultation workflow'}
        >
          {role === 'PHARMACIST' ? (
            <DashboardTable rows={verifiedPrescriptions.slice(0, 7).map((item) => [item.patient?.name ?? 'Patient', String(item.items?.length ?? 0), prettify(item.status)])} headers={['Patient', 'Medicine Count', 'Status']} statusColumn={2} emptyMessage="No pending prescriptions today." />
          ) : role === 'RECEPTIONIST' ? (
            <DashboardTable rows={receptionistQueue.slice(0, 7).map((item) => [item.patient?.name ?? 'Patient', new Date(item.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), prettify(item.status)])} headers={['Patient', 'Time', 'Status']} statusColumn={2} emptyMessage="No patients in today's queue." />
          ) : (
            <DashboardTable rows={waitingConsultations.slice(0, 7).map((item) => [item.patient?.name ?? 'Patient', prettify(item.consultationType), prettify(item.status)])} headers={['Patient', 'Type', 'Status']} statusColumn={2} emptyMessage="No waiting consultations." />
          )}
        </DashboardPanel>

        <DashboardPanel
          title={role === 'RECEPTIONIST' ? 'Pending Payments' : role === 'PHARMACIST' ? 'Low Stock Medicines' : 'Inventory Alerts'}
          subtitle={role === 'DOCTOR' ? 'Critical and warning inventory conditions separated by severity' : 'Items that need attention'}
          action={role !== 'RECEPTIONIST' && allInventoryAlertItems.length > 3 ? <button type="button" className="dashboard-panel-action" onClick={() => navigate(`${basePath}/inventory`)}>View All</button> : undefined}
        >
          {role === 'RECEPTIONIST' ? (
            <DashboardTable rows={data.pendingPayments.slice(0, 5).map((item) => [item.patient?.name ?? 'Patient', `RM ${formatMoney(item.amount)}`, prettify(item.status)])} headers={['Patient', 'Total', 'Status']} statusColumn={2} emptyMessage="No pending payments." />
          ) : role === 'PHARMACIST' ? (
            <WorkflowList items={[...outOfStock, ...lowStock].slice(0, 4).map((item) => ({ title: item.name, meta: `${item.quantity} ${item.stockUnit ?? 'unit'} remaining`, status: item.quantity <= 0 ? 'Out of stock' : 'Low stock', severity: item.quantity <= 0 ? 'critical' : 'warning' }))} emptyMessage="All medicines are sufficiently stocked." />
          ) : (
            <WorkflowList items={inventoryAlertItems} emptyMessage="All medicines are sufficiently stocked." />
          )}
        </DashboardPanel>
      </div>

      <div className="dashboard-footer-grid">
        <DashboardPanel
          title={role === 'PHARMACIST' ? 'Recent Sales' : role === 'RECEPTIONIST' ? 'Upcoming Appointments' : 'Follow-up Appointments'}
          subtitle={role === 'PHARMACIST' ? 'Latest medicine sales and dispense status' : role === 'RECEPTIONIST' ? 'Next appointments to prepare for' : 'Follow-up visits linked to earlier care'}
          action={<button type="button" className="dashboard-panel-action" onClick={() => navigate(role === 'PHARMACIST' ? `${basePath}/sales` : `${basePath}/appointments`)}>View More</button>}
        >
          {role === 'PHARMACIST' ? (
            <DashboardTable rows={data.sales.slice(0, 5).map((item) => [item.patient?.name ?? 'Customer', `RM ${formatMoney(item.amount)}`, prettify(item.status)])} headers={['Customer', 'Total', 'Status']} statusColumn={2} emptyMessage="No recent medicine sales." />
          ) : role === 'RECEPTIONIST' ? (
            <DashboardTable rows={upcomingAppointments.slice(0, 5).map((item) => [item.patient?.name ?? 'Patient', new Date(item.dateTime).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }), prettify(item.status)])} headers={['Patient', 'Date / Time', 'Status']} statusColumn={2} emptyMessage="No upcoming appointments." />
          ) : (
            <DashboardTable rows={followUpAppointments.slice(0, 5).map((item) => [item.patient?.name ?? 'Patient', new Date(item.dateTime).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }), prettify(item.status)])} headers={['Patient', 'Date / Time', 'Status']} statusColumn={2} emptyMessage="No upcoming follow-up appointments." />
          )}
        </DashboardPanel>

        <DashboardPanel
          title={role === 'PHARMACIST' ? 'Near Expiry Medicines' : role === 'RECEPTIONIST' ? 'Recent Payments' : 'Recent Patients'}
          subtitle={role === 'PHARMACIST' ? 'Expiry warnings within 30 days' : role === 'RECEPTIONIST' ? 'Latest received and pending transactions' : 'Recently registered patients'}
          action={role === 'RECEPTIONIST' ? <button type="button" className="dashboard-panel-action" onClick={() => navigate(`${basePath}/payments`)}>View More</button> : undefined}
        >
          {role === 'PHARMACIST' ? (
            <WorkflowList items={nearExpiry.slice(0, 4).map((item) => ({ title: item.name, meta: `${item.batchNumber ?? 'No batch'} - expires ${new Date(item.expiryDate).toLocaleDateString()}`, status: 'Near expiry', severity: 'warning' }))} emptyMessage="No near expiry medicines." />
          ) : role === 'RECEPTIONIST' ? (
            <DashboardTable rows={recentPayments.slice(0, 5).map((item) => [item.patient?.name ?? 'Patient', `RM ${formatMoney(item.amount)}`, prettify(item.status)])} headers={['Patient', 'Total', 'Status']} statusColumn={2} emptyMessage="No recent payments." />
          ) : (
            <DashboardTable rows={recentPatients.slice(0, 7).map((item) => [item.name, item.icOrPassport ?? '-', item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '-'])} headers={['Patient', 'IC / ID', 'Registered']} emptyMessage="No recent patients." />
          )}
        </DashboardPanel>
      </div>

      <div className="dashboard-footer-grid">
        {role === 'PHARMACIST' && (
          <DashboardPanel title="Pending Inventory Approvals" subtitle="Inventory requests waiting for doctor review">
            <DashboardTable rows={pendingInventory.slice(0, 7).map((item) => [item.name, item.batchNumber ?? '-', item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '-'])} headers={['Medicine', 'Batch', 'Requested']} emptyMessage="No pending inventory approvals." />
          </DashboardPanel>
        )}

        <DashboardPanel
          title="Activity Timeline"
          subtitle="Meaningful clinic activity only"
          action={role === 'DOCTOR' ? <button type="button" className="dashboard-panel-action" onClick={() => navigate(`${basePath}/audit-logs`)}>View Audit Logs</button> : undefined}
        >
          <Timeline items={activity} />
        </DashboardPanel>
      </div>
    </section>
  );
};
