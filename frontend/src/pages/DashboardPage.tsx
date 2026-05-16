import { useEffect, useMemo, useState } from 'react';
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

const MiniBarChart = ({ data }: { data: Array<{ label: string; value: number }> }) => {
  const max = Math.max(...data.map((item) => item.value), 1);
  return (
    <div className="dashboard-bars" role="img" aria-label="Revenue chart">
      {data.map((item) => (
        <div key={item.label} className="dashboard-bar-item">
          <div className="dashboard-bar-track">
            <span style={{ height: `${Math.max(8, (item.value / max) * 100)}%` }} />
          </div>
          <small>{item.label}</small>
        </div>
      ))}
    </div>
  );
};

const PieChart = ({ data }: { data: Array<{ label: string; value: number; color: string }> }) => {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  let cumulative = 0;

  const gradient = total > 0
    ? data.map((item) => {
        const start = (cumulative / total) * 100;
        cumulative += item.value;
        const end = (cumulative / total) * 100;
        return `${item.color} ${start}% ${end}%`;
      }).join(', ')
    : '#334155 0% 100%';

  return (
    <div className="dashboard-pie-wrap">
      <div className="dashboard-pie" style={{ background: `conic-gradient(${gradient})` }}>
        <span>{total}</span>
      </div>
      <div className="dashboard-legend">
        {data.map((item) => (
          <span key={item.label}><i style={{ background: item.color }} />{item.label}<b>{item.value}</b></span>
        ))}
      </div>
    </div>
  );
};

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
        medicines: role !== 'RECEPTIONIST' ? fetchOrEmpty<Medicine>('/medicine') : Promise.resolve([]),
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
  const todayRevenue = sumAmount(allRevenue.filter((payment) => toDateKey(payment.date) === today));
  const todayPatients = data.patients.filter((patient) => toDateKey(patient.createdAt) === today);
  const todayAppointments = data.appointments.filter((appointment) => toDateKey(appointment.dateTime) === today);
  const todayConsultations = data.consultations.filter((consultation) => consultation.status === 'COMPLETED' && toDateKey(consultation.createdAt) === today);
  const todayPrescriptions = data.prescriptions.filter((prescription) => toDateKey(prescription.date) === today);
  const lowStock = data.medicines.filter((medicine) => medicine.quantity <= 10);
  const nearExpiry = data.medicines.filter((medicine) => daysUntil(medicine.expiryDate) >= 0 && daysUntil(medicine.expiryDate) <= 30);
  const pendingPrescriptions = data.prescriptions.filter((prescription) => prescription.status === 'PENDING_VERIFICATION' || prescription.status === 'VERIFIED');
  const dispensedToday = data.prescriptions.filter((prescription) => prescription.status === 'DISPENSED' && toDateKey(prescription.date) === today);
  const pendingDispenseSales = data.sales.filter((sale) => sale.status === 'PENDING_DISPENSE');
  const walkInToday = data.sales.filter((sale) => sale.type === 'MEDICINE' && toDateKey(sale.date) === today);

  const summaryCards = useMemo(() => {
    if (role === 'RECEPTIONIST') {
      return [
        { title: 'Today Appointments', value: todayAppointments.length, icon: 'A', subtitle: 'scheduled today' },
        { title: 'Pending Payments', value: data.pendingPayments.length, icon: 'P', subtitle: 'awaiting confirmation' },
        { title: 'Walk-in Customers', value: walkInToday.length, icon: 'W', subtitle: 'medicine sales today' },
        { title: 'Today Revenue', value: `RM ${formatMoney(todayRevenue)}`, icon: 'R', subtitle: 'paid and sales total' },
      ];
    }

    if (role === 'PHARMACIST') {
      return [
        { title: 'Pending Dispense', value: pendingPrescriptions.length + pendingDispenseSales.length, icon: 'D', subtitle: 'prescriptions and sales' },
        { title: 'Dispensed Today', value: dispensedToday.length, icon: 'V', subtitle: 'prescriptions completed' },
        { title: 'Low Stock Medicines', value: lowStock.length, icon: 'L', subtitle: 'need attention' },
        { title: 'Today Medicine Sales', value: `RM ${formatMoney(sumAmount(walkInToday))}`, icon: 'S', subtitle: 'walk-in medicine revenue' },
      ];
    }

    return [
      { title: 'Patients Today', value: todayPatients.length, icon: 'P', subtitle: 'patients registered' },
      { title: 'Appointments Today', value: todayAppointments.length, icon: 'A', subtitle: 'appointments scheduled' },
      { title: 'Consultations Completed', value: todayConsultations.length, icon: 'C', subtitle: 'completed today' },
      { title: 'Prescriptions Created', value: todayPrescriptions.length, icon: 'Rx', subtitle: 'prescriptions today' },
      { title: 'Today Sales', value: `RM ${formatMoney(todayRevenue)}`, icon: 'RM', subtitle: 'clinic revenue today' },
    ];
  }, [role, todayAppointments.length, data.pendingPayments.length, walkInToday, todayRevenue, pendingPrescriptions.length, pendingDispenseSales.length, dispensedToday.length, lowStock.length, todayPatients.length, todayConsultations.length, todayPrescriptions.length]);

  const categoryPie = ['MEDICINE', 'VITAMIN', 'SUPPLEMENT', 'CONTROLLED_MEDICINE'].map((category, index) => ({
    label: categoryLabel(category as Medicine['category']),
    value: data.medicines.filter((medicine) => (medicine.category ?? 'MEDICINE') === category).length,
    color: ['#38bdf8', '#34d399', '#fbbf24', '#f87171'][index],
  }));

  const appointmentPie = ['PENDING', 'COMPLETED', 'CANCELLED'].map((status, index) => ({
    label: prettify(status),
    value: data.appointments.filter((appointment) => appointment.status === status).length,
    color: ['#fbbf24', '#34d399', '#f87171'][index],
  }));

  const topMedicines = Object.entries(data.sales.flatMap((sale) => sale.medicineItems ?? []).reduce<Record<string, number>>((acc, item) => {
    const name = item.medicine?.name ?? 'Medicine';
    acc[name] = (acc[name] ?? 0) + item.qty;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 7).map(([label, value]) => ({ label, value }));

  const graphData = role === 'PHARMACIST' && topMedicines.length > 0 ? topMedicines : buildSeries(allRevenue, chartMode);
  const pieData = role === 'RECEPTIONIST' ? appointmentPie : categoryPie;

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
    ...data.prescriptions.slice(0, 4).map((item) => ({ text: `Prescription #${item.prescriptionId} ${prettify(item.status)}`, date: item.date })),
    ...allRevenue.slice(0, 4).map((item) => ({ text: `Payment received from ${item.patient?.name ?? 'patient'}`, date: item.date })),
    ...data.auditLogs
      .slice(0, 4)
      .map((item) => ({
        text: (item.activityType ?? item.action ?? '').replace(/_/g, ' '),
        date: item.timestamp ?? item.createdAt ?? '',
      })),
  ].filter((item) => item.date).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5);

  const appointmentsTable = role === 'RECEPTIONIST'
    ? data.appointments.filter((item) => item.status === 'PENDING' || item.status === 'ARRIVED').slice(0, 5)
    : data.appointments.slice(0, 5);
  const alertMedicines = Array.from(new Map([...lowStock, ...nearExpiry].map((item) => [item.medicineId, item])).values()).slice(0, 5);
  const alertRows = role === 'PHARMACIST'
    ? alertMedicines.map((item) => [item.name, item.batchNumber ?? '-', new Date(item.expiryDate).toLocaleDateString()])
    : alertMedicines.map((item) => [item.name, `${item.quantity} ${item.stockUnit ?? 'unit'}`, daysUntil(item.expiryDate) <= 30 ? 'Near Expiry' : 'Low Stock']);

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

      <div className="dashboard-chart-grid">
        <section className="dashboard-panel dashboard-main-chart">
          <div className="dashboard-panel-head">
            <div>
              <h3>{role === 'PHARMACIST' ? 'Top Selling Medicines' : role === 'RECEPTIONIST' ? 'Daily Payment / Revenue' : 'Revenue / Sales'}</h3>
              <p>{role === 'PHARMACIST' ? 'Quantity sold by medicine' : 'Paid transactions grouped by period'}</p>
            </div>
            {role !== 'PHARMACIST' && (
              <div className="dashboard-segment">
                {(['daily', 'weekly', 'monthly'] as ChartMode[]).map((mode) => (
                  <button key={mode} type="button" className={chartMode === mode ? 'is-active' : ''} onClick={() => setChartMode(mode)}>{prettify(mode)}</button>
                ))}
              </div>
            )}
          </div>
          <MiniBarChart data={graphData} />
        </section>

        <section className="dashboard-panel">
          <div className="dashboard-panel-head">
            <div>
              <h3>{role === 'RECEPTIONIST' ? 'Appointment Status' : 'Medicine Categories'}</h3>
              <p>{role === 'RECEPTIONIST' ? 'Pending, completed, and cancelled' : 'Inventory category distribution'}</p>
            </div>
          </div>
          <PieChart data={pieData} />
        </section>
      </div>

      <div className="dashboard-lower-grid">
        <section className="dashboard-panel">
          <div className="dashboard-panel-head">
            <div>
              <h3>{role === 'PHARMACIST' ? 'Pending Prescriptions' : role === 'RECEPTIONIST' ? 'Upcoming Appointments' : 'Recent Appointments'}</h3>
              <p>Most relevant queue for your role</p>
            </div>
          </div>
          {role === 'PHARMACIST' ? (
            <DashboardTable rows={pendingPrescriptions.slice(0, 5).map((item) => [item.patient?.name ?? 'Patient', String(item.items?.length ?? 0), prettify(item.status)])} headers={['Patient', 'Medicine Count', 'Status']} statusColumn={2} />
          ) : (
            <DashboardTable rows={appointmentsTable.map((item) => [item.patient?.name ?? 'Patient', new Date(item.dateTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), prettify(item.status)])} headers={['Patient', 'Time', 'Status']} statusColumn={2} />
          )}
        </section>

        <section className="dashboard-panel">
          <div className="dashboard-panel-head">
            <div>
              <h3>{role === 'RECEPTIONIST' ? 'Pending Payments' : role === 'PHARMACIST' ? 'Near Expiry Medicines' : 'Inventory Alerts'}</h3>
              <p>Items that need attention</p>
            </div>
          </div>
          {role === 'RECEPTIONIST' ? (
            <DashboardTable rows={data.pendingPayments.slice(0, 5).map((item) => [item.patient?.name ?? 'Patient', `RM ${formatMoney(item.amount)}`, prettify(item.status)])} headers={['Patient', 'Total', 'Status']} statusColumn={2} />
          ) : (
            <DashboardTable rows={alertRows} headers={role === 'PHARMACIST' ? ['Medicine', 'Batch', 'Expiry Date'] : ['Medicine', 'Stock', 'Expiry Status']} statusColumn={role === 'PHARMACIST' ? undefined : 2} />
          )}
        </section>
      </div>

      <div className="dashboard-footer-grid">
        <section className="dashboard-panel">
          <div className="dashboard-panel-head">
            <div>
              <h3>{role === 'PHARMACIST' ? 'Recent Walk-in Sales' : role === 'RECEPTIONIST' ? 'Recent Payments' : 'Activity Timeline'}</h3>
              <p>Latest movement in the clinic</p>
            </div>
          </div>
          {role === 'PHARMACIST' ? (
            <DashboardTable rows={data.sales.slice(0, 5).map((item) => [item.patient?.name ?? 'Customer', `RM ${formatMoney(item.amount)}`, prettify(item.status)])} headers={['Customer', 'Total', 'Status']} statusColumn={2} />
          ) : role === 'RECEPTIONIST' ? (
            <DashboardTable rows={[...data.payments, ...data.sales].slice(0, 5).map((item) => [item.patient?.name ?? 'Patient', `RM ${formatMoney(item.amount)}`, prettify(item.status)])} headers={['Patient', 'Total', 'Status']} statusColumn={2} />
          ) : (
            <Timeline items={activity} />
          )}
        </section>

        {role !== 'DOCTOR' && (
          <section className="dashboard-panel">
            <div className="dashboard-panel-head">
              <div>
                <h3>Activity Timeline</h3>
                <p>Recent system activity</p>
              </div>
            </div>
            <Timeline items={activity} />
          </section>
        )}
      </div>
    </section>
  );
};

const DashboardTable = ({ headers, rows, statusColumn }: { headers: string[]; rows: string[][]; statusColumn?: number }) => (
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
          <tr><td colSpan={headers.length}>No records found.</td></tr>
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
    )) : <p className="muted">No recent activity yet.</p>}
  </div>
);
