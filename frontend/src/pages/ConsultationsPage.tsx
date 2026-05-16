import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { subscribeInAppDataSync } from '../lib/sync';
import { usePagination } from '../lib/pagination';
import { PatientAutocomplete, type PatientAutocompleteOption } from '../components/PatientAutocomplete';
import { DateRangeFilter, getDateRangeForPreset, type DateRangeValue } from '../components/DateRangeFilter';
import { Pagination } from '../components/Pagination';
import clinicLogo from '../assets/Logo_Clinic_Dr.Alwani.png';

type ConsultationStatus = 'WAITING' | 'IN_PROGRESS' | 'COMPLETED';
type AppointmentStatus = 'PENDING' | 'ARRIVED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
type MedicalCertificateStatus = 'DRAFT' | 'ISSUED' | 'CANCELLED';
type ConsultationType = 'GENERAL_CONSULTATION' | 'MEDICAL_CHECKUP' | 'FOLLOW_UP' | 'MINOR_INJURY';
type PaymentType = 'CONSULTATION' | 'APPOINTMENT' | 'MEDICAL_CHECKUP' | 'MEDICINE' | 'CUSTOM';
type PaymentStatus = 'PENDING_PAYMENT' | 'PAID' | 'PENDING_DISPENSE' | 'DISPENSED' | 'CANCELLED';

type ConsultationFollowUpAppointment = {
  appointmentId: number;
  dateTime: string;
  status: AppointmentStatus;
  type: 'FOLLOW_UP';
  notes?: string | null;
};

type MedicalCertificate = {
  medicalCertificateId: number;
  startDate: string;
  days: number;
  returnToWorkDate: string;
  diagnosis: string;
  notes?: string | null;
  status: MedicalCertificateStatus;
  createdAt: string;
  doctor?: {
    username: string;
  } | null;
};

type Consultation = {
  consultationId: number;
  patientId: number;
  appointmentId?: number | null;
  doctorId: number;
  consultationType: ConsultationType;
  symptoms?: string | null;
  diagnosis?: string | null;
  consultationNotes?: string | null;
  temperature?: string | null;
  bloodPressure?: string | null;
  weight?: string | null;
  height?: string | null;
  bmi?: string | null;
  heartRate?: string | null;
  checkupNotes?: string | null;
  status: ConsultationStatus;
  createdAt: string;
  patient: {
    patientId: number;
    name: string;
    icOrPassport: string;
    phone: string;
    gender?: string | null;
    dateOfBirth?: string | null;
  };
  appointment?: {
    appointmentId: number;
    dateTime: string;
    status: string;
    type: string;
  } | null;
  prescription?: {
    prescriptionId: number;
    date: string;
  } | null;
  payment?: {
    paymentId: number;
    status: PaymentStatus;
    type: PaymentType;
    amount: number | string;
  } | null;
  followUpAppointments?: ConsultationFollowUpAppointment[];
  medicalCertificates?: MedicalCertificate[];
  doctor?: {
    username: string;
  } | null;
};

type ConsultationForm = {
  consultationType: ConsultationType;
  symptoms: string;
  diagnosis: string;
  consultationNotes: string;
  temperature: string;
  bloodPressure: string;
  weight: string;
  height: string;
  bmi: string;
  heartRate: string;
  checkupNotes: string;
};

type MedicalCertificateForm = {
  startDate: string;
  days: string;
  diagnosis: string;
  notes: string;
  status: Exclude<MedicalCertificateStatus, 'CANCELLED'>;
};

type ConsultationStatusFilter = 'ACTIVE' | ConsultationStatus | '';
type HistoryTypeFilter = 'ALL' | 'CONSULTATION' | 'PRESCRIPTION' | 'MC' | 'FOLLOW_UP' | 'PAYMENT';

type PatientHistoryDetails = Consultation['patient'] & {
  consultations: Array<{
    consultationId: number;
    createdAt: string;
    status: ConsultationStatus;
    symptoms?: string | null;
    diagnosis?: string | null;
    consultationNotes?: string | null;
    prescription?: { prescriptionId: number; date: string } | null;
    medicalCertificates?: Array<{
      medicalCertificateId: number;
      startDate: string;
      days: number;
      returnToWorkDate: string;
      status: MedicalCertificateStatus;
    }>;
  }>;
  prescriptions: Array<{
    prescriptionId: number;
    date: string;
    notes?: string | null;
    items?: Array<{
      pmId: number;
      dosage: string;
      frequency: string;
      duration: string;
      qty: number;
      medicine?: { name: string } | null;
    }>;
  }>;
  medicalCertificates: Array<{
    medicalCertificateId: number;
    startDate: string;
    days: number;
    returnToWorkDate: string;
    diagnosis: string;
    notes?: string | null;
    status: MedicalCertificateStatus;
    createdAt: string;
    consultation?: { consultationId: number; createdAt: string; diagnosis?: string | null } | null;
  }>;
  appointments: Array<{
    appointmentId: number;
    status: AppointmentStatus;
    type: 'NEW' | 'FOLLOW_UP';
    dateTime: string;
    notes?: string | null;
    followUpFromConsultation?: { consultationId: number; createdAt: string; diagnosis?: string | null } | null;
    previousPrescription?: { prescriptionId: number; date: string } | null;
  }>;
  payments: Array<{
    paymentId: number;
    type: string;
    amount: number | string;
    date: string;
    status: string;
    receipt?: { receiptNo: string } | null;
  }>;
};

type HistoryTimelineItem = {
  key: string;
  category: HistoryTypeFilter;
  date: string;
  title: string;
  subtitle: string;
  details: Array<{ label: string; value: string }>;
  searchableText: string;
  status?: string;
};

const emptyForm: ConsultationForm = {
  consultationType: 'GENERAL_CONSULTATION',
  symptoms: '',
  diagnosis: '',
  consultationNotes: '',
  temperature: '',
  bloodPressure: '',
  weight: '',
  height: '',
  bmi: '',
  heartRate: '',
  checkupNotes: '',
};

const consultationTypeOptions: Array<{ value: ConsultationType; label: string }> = [
  { value: 'GENERAL_CONSULTATION', label: 'General Consultation' },
  { value: 'MEDICAL_CHECKUP', label: 'Medical Checkup' },
  { value: 'FOLLOW_UP', label: 'Follow-up' },
  { value: 'MINOR_INJURY', label: 'Minor Injury' },
];

const CLINIC_NAME = 'Clinic Dr. Alwani';

const getApiErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'object' && error !== null) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    const message = response?.data?.message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return fallback;
};

const formatStatus = (status: ConsultationStatus) => status.replace('_', ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

const formatConsultationType = (type?: ConsultationType | null) => {
  const option = consultationTypeOptions.find((item) => item.value === type);
  return option?.label ?? 'General Consultation';
};

const statusClass = (status: ConsultationStatus) => {
  if (status === 'WAITING') return 'status-warning';
  if (status === 'IN_PROGRESS') return 'type-consultation';
  return 'status-good';
};

const toDateTimeLocalInput = (value: Date) => {
  const adjusted = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 16);
};

const toDateInput = (value: Date) => value.toISOString().slice(0, 10);

const toDisplayDate = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

const addDaysToDateInput = (dateInput: string, days: number) => {
  const date = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(date.getTime()) || !Number.isFinite(days)) return '';
  date.setDate(date.getDate() + Math.max(1, days));
  return toDateInput(date);
};

const formatMcStatus = (status: MedicalCertificateStatus) => status.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

const mcStatusClass = (status: MedicalCertificateStatus) => {
  if (status === 'ISSUED') return 'status-good';
  if (status === 'DRAFT') return 'status-warning';
  return 'status-archived';
};

const formatWaitingTime = (createdAt: string) => {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return '-';
  const minutes = Math.max(0, Math.floor((Date.now() - created) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
};

const formatLinkedRecords = (consultation: Consultation) => {
  const records = [consultation.appointmentId ? `Appointment #${consultation.appointmentId}` : 'Walk-in'];
  if (consultation.prescription) records.push(`Prescription #${consultation.prescription.prescriptionId}`);
  const medicalCertificate = consultation.medicalCertificates?.[0];
  if (medicalCertificate) records.push(`MC #${medicalCertificate.medicalCertificateId}`);
  return records;
};

const toForm = (consultation: Consultation): ConsultationForm => ({
  consultationType: consultation.consultationType ?? 'GENERAL_CONSULTATION',
  symptoms: consultation.symptoms ?? '',
  diagnosis: consultation.diagnosis ?? '',
  consultationNotes: consultation.consultationNotes ?? '',
  temperature: consultation.temperature ?? '',
  bloodPressure: consultation.bloodPressure ?? '',
  weight: consultation.weight ?? '',
  height: consultation.height ?? '',
  bmi: consultation.bmi ?? '',
  heartRate: consultation.heartRate ?? '',
  checkupNotes: consultation.checkupNotes ?? '',
});

const parseMeasurement = (value: string) => {
  const match = value.replace(',', '.').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
};

const calculateBmi = (weight: string, height: string) => {
  const weightKg = parseMeasurement(weight);
  const heightValue = parseMeasurement(height);
  if (!Number.isFinite(weightKg) || !Number.isFinite(heightValue) || weightKg <= 0 || heightValue <= 0) return '';
  const heightM = heightValue > 3 ? heightValue / 100 : heightValue;
  if (heightM <= 0) return '';
  return (weightKg / (heightM * heightM)).toFixed(1);
};

const formatMoney = (value: number | string) => {
  const amount = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00';
};

const historyCategoryClass = (category: HistoryTypeFilter) => {
  if (category === 'CONSULTATION') return 'type-consultation';
  if (category === 'PRESCRIPTION') return 'status-neutral';
  if (category === 'MC') return 'status-good';
  if (category === 'FOLLOW_UP') return 'status-warning';
  if (category === 'PAYMENT') return 'type-appointment';
  return 'status-neutral';
};

const formatHistoryCategory = (category: HistoryTypeFilter) => {
  if (category === 'MC') return 'MC';
  if (category === 'FOLLOW_UP') return 'Follow-up';
  if (category === 'ALL') return 'All';
  return category.toLowerCase().replace(/\b\w/g, (match) => match.toUpperCase());
};

const getPrescriptionSummary = (prescription?: PatientHistoryDetails['prescriptions'][number] | null) => {
  const items = prescription?.items ?? [];
  if (items.length === 0) return prescription?.notes || '-';
  return items
    .map((item) => `${item.medicine?.name ?? 'Medicine'} x${item.qty} (${item.dosage}, ${item.frequency}, ${item.duration})`)
    .join(' | ');
};

const buildHistoryTimeline = (patient: PatientHistoryDetails): HistoryTimelineItem[] => {
  const consultationItems = patient.consultations.map((item) => {
    const mcSummary = (item.medicalCertificates ?? []).map((mc) => `MC #${mc.medicalCertificateId}`).join(', ');
    const details = [
      { label: 'Symptoms', value: item.symptoms || '-' },
      { label: 'Diagnosis', value: item.diagnosis || '-' },
      { label: 'Notes', value: item.consultationNotes || '-' },
      { label: 'Prescription', value: item.prescription ? `Prescription #${item.prescription.prescriptionId}` : '-' },
      { label: 'MC', value: mcSummary || '-' },
    ];
    return {
      key: `consultation-${item.consultationId}`,
      category: 'CONSULTATION' as const,
      date: item.createdAt,
      title: `Consultation #${item.consultationId}`,
      subtitle: item.diagnosis || 'Consultation record',
      details,
      status: formatStatus(item.status),
      searchableText: details.map((detail) => detail.value).join(' '),
    };
  });

  const prescriptionItems = patient.prescriptions.map((item) => {
    const summary = getPrescriptionSummary(item);
    return {
      key: `prescription-${item.prescriptionId}`,
      category: 'PRESCRIPTION' as const,
      date: item.date,
      title: `Prescription #${item.prescriptionId}`,
      subtitle: summary,
      details: [
        { label: 'Medicines', value: summary },
        { label: 'Notes', value: item.notes || '-' },
      ],
      searchableText: `${summary} ${item.notes ?? ''}`,
    };
  });

  const mcItems = patient.medicalCertificates.map((item) => ({
    key: `mc-${item.medicalCertificateId}`,
    category: 'MC' as const,
    date: item.createdAt,
    title: `MC #${item.medicalCertificateId}`,
    subtitle: `${item.days} day${item.days === 1 ? '' : 's'} - Return ${toDisplayDate(item.returnToWorkDate)}`,
    details: [
      { label: 'Diagnosis', value: item.diagnosis },
      { label: 'Start Date', value: toDisplayDate(item.startDate) },
      { label: 'Return Date', value: toDisplayDate(item.returnToWorkDate) },
      { label: 'Notes', value: item.notes || '-' },
      { label: 'Consultation', value: item.consultation ? `#${item.consultation.consultationId}` : '-' },
    ],
    status: formatMcStatus(item.status),
    searchableText: `${item.diagnosis} ${item.notes ?? ''}`,
  }));

  const followUpItems = patient.appointments
    .filter((item) => item.type === 'FOLLOW_UP')
    .map((item) => ({
      key: `follow-up-${item.appointmentId}`,
      category: 'FOLLOW_UP' as const,
      date: item.dateTime,
      title: `Follow-up Appointment #${item.appointmentId}`,
      subtitle: item.notes || item.followUpFromConsultation?.diagnosis || 'Follow-up appointment',
      details: [
        { label: 'Status', value: item.status.replace('_', ' ') },
        { label: 'Notes', value: item.notes || '-' },
        { label: 'From Consultation', value: item.followUpFromConsultation ? `#${item.followUpFromConsultation.consultationId}` : '-' },
        { label: 'Previous Prescription', value: item.previousPrescription ? `#${item.previousPrescription.prescriptionId}` : '-' },
      ],
      status: item.status.replace('_', ' '),
      searchableText: `${item.notes ?? ''} ${item.followUpFromConsultation?.diagnosis ?? ''}`,
    }));

  const paymentItems = patient.payments.map((item) => ({
    key: `payment-${item.paymentId}`,
    category: 'PAYMENT' as const,
    date: item.date,
    title: `Payment #${item.paymentId}`,
    subtitle: `${item.type} - RM ${formatMoney(item.amount)}`,
    details: [
      { label: 'Type', value: item.type },
      { label: 'Amount', value: `RM ${formatMoney(item.amount)}` },
      { label: 'Status', value: item.status },
      { label: 'Receipt', value: item.receipt?.receiptNo ?? '-' },
    ],
    status: item.status,
    searchableText: `${item.type} ${item.status} ${item.receipt?.receiptNo ?? ''}`,
  }));

  return [...consultationItems, ...prescriptionItems, ...mcItems, ...followUpItems, ...paymentItems].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
};

export const ConsultationsPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [statusFilter, setStatusFilter] = useState<ConsultationStatusFilter>('ACTIVE');
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => getDateRangeForPreset('today'));
  const [selectedPatientFilter, setSelectedPatientFilter] = useState<PatientAutocompleteOption | null>(null);
  const [active, setActive] = useState<Consultation | null>(null);
  const [form, setForm] = useState<ConsultationForm>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const [followUpDateTime, setFollowUpDateTime] = useState(() => toDateTimeLocalInput(new Date(Date.now() + 7 * 24 * 60 * 60000)));
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [scheduledFollowUpSummary, setScheduledFollowUpSummary] = useState<{ dateTime: string; notes: string } | null>(null);
  const [mcOpen, setMcOpen] = useState(false);
  const [mcSaving, setMcSaving] = useState(false);
  const [selectedMc, setSelectedMc] = useState<MedicalCertificate | null>(null);
  const [mcForm, setMcForm] = useState<MedicalCertificateForm>({
    startDate: toDateInput(new Date()),
    days: '1',
    diagnosis: '',
    notes: '',
    status: 'ISSUED',
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPatient, setHistoryPatient] = useState<PatientHistoryDetails | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const [historyDateRange, setHistoryDateRange] = useState<DateRangeValue>(() => getDateRangeForPreset('last30'));
  const [historyTypeFilter, setHistoryTypeFilter] = useState<HistoryTypeFilter>('ALL');
  const [historyFilterOpen, setHistoryFilterOpen] = useState(false);
  const [expandedHistoryItem, setExpandedHistoryItem] = useState<string | null>(null);

  const requestedConsultationId = useMemo(() => Number(searchParams.get('consultationId') || 0), [searchParams]);

  const loadConsultations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/consultations', {
        params: {
          status: statusFilter === 'ACTIVE' ? 'WAITING,IN_PROGRESS' : statusFilter || undefined,
          dateFrom: dateRange.dateFrom || undefined,
          dateTo: dateRange.dateTo || undefined,
          patientId: selectedPatientFilter?.patientId,
        },
      });
      const nextConsultations = response.data as Consultation[];
      setConsultations(nextConsultations);
      setActive((current) => {
        if (!current) return current;
        return nextConsultations.find((consultation) => consultation.consultationId === current.consultationId) ?? current;
      });
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load consultation queue'));
    } finally {
      setLoading(false);
    }
  }, [dateRange.dateFrom, dateRange.dateTo, selectedPatientFilter, statusFilter]);

  useEffect(() => {
    void loadConsultations();
  }, [loadConsultations]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void loadConsultations();
    });
  }, [loadConsultations]);

  useEffect(() => {
    if (!requestedConsultationId) return;

    void (async () => {
      try {
        const response = await api.get(`/consultations/${requestedConsultationId}`);
        const consultation = response.data as Consultation;
        setActive(consultation);
        setForm(toForm(consultation));
        setScheduledFollowUpSummary(null);
        setSelectedMc(consultation.medicalCertificates?.[0] ?? null);
        setSearchParams({});
      } catch (err: unknown) {
        setError(getApiErrorMessage(err, 'Failed to open consultation'));
      }
    })();
  }, [requestedConsultationId, setSearchParams]);

  const stats = useMemo(() => ({
    waiting: consultations.filter((c) => c.status === 'WAITING').length,
    inProgress: consultations.filter((c) => c.status === 'IN_PROGRESS').length,
    completed: consultations.filter((c) => c.status === 'COMPLETED').length,
  }), [consultations]);

  const {
    page: listPage,
    setPage: setListPage,
    totalPages: listTotalPages,
    paginated: paginatedConsultations,
  } = usePagination(consultations, 10, [statusFilter, dateRange.dateFrom, dateRange.dateTo, selectedPatientFilter?.patientId]);

  const activeFollowUp = active?.followUpAppointments?.[0] ?? null;
  const latestMedicalCertificate = active?.medicalCertificates?.[0] ?? null;
  const activePayment = active?.payment ?? null;
  const calculatedBmi = useMemo(() => calculateBmi(form.weight, form.height), [form.height, form.weight]);
  const displayedBmi = calculatedBmi || form.bmi;
  const isMedicalCheckup = form.consultationType === 'MEDICAL_CHECKUP';
  const canSendMedicalCheckupToPayment = Boolean(
    active &&
    active.status === 'COMPLETED' &&
    active.consultationType === 'MEDICAL_CHECKUP' &&
    !active.prescription &&
    !activePayment,
  );
  const mcReturnToWorkDate = useMemo(() => addDaysToDateInput(mcForm.startDate, Number(mcForm.days)), [mcForm.days, mcForm.startDate]);
  const historyTimeline = useMemo(() => {
    if (!historyPatient) return [];

    const timeline = buildHistoryTimeline(historyPatient);
    const search = historySearch.trim().toLowerCase();
    const from = historyDateRange.dateFrom ? new Date(`${historyDateRange.dateFrom}T00:00:00`).getTime() : null;
    const to = historyDateRange.dateTo ? new Date(`${historyDateRange.dateTo}T23:59:59`).getTime() : null;

    return timeline.filter((item) => {
      if (historyTypeFilter !== 'ALL' && item.category !== historyTypeFilter) return false;

      const itemTime = new Date(item.date).getTime();
      if (from && itemTime < from) return false;
      if (to && itemTime > to) return false;

      if (search) {
        const haystack = `${item.title} ${item.subtitle} ${item.searchableText}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }

      return true;
    });
  }, [historyDateRange.dateFrom, historyDateRange.dateTo, historyPatient, historySearch, historyTypeFilter]);

  const historySummary = useMemo(() => {
    if (!historyPatient) return null;
    const consultations = [...historyPatient.consultations].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const prescriptions = [...historyPatient.prescriptions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const diagnoses = consultations.map((item) => item.diagnosis?.trim()).filter((value): value is string => Boolean(value));
    const repeatedDiagnoses = diagnoses.filter((diagnosis, index) => diagnoses.indexOf(diagnosis) !== index);

    return {
      totalVisits: historyPatient.consultations.length,
      lastVisitDate: consultations[0]?.createdAt ?? null,
      lastDiagnosis: diagnoses[0] ?? 'Not recorded',
      lastPrescription: getPrescriptionSummary(prescriptions[0]),
      chronicConditions: repeatedDiagnoses.length > 0 ? [...new Set(repeatedDiagnoses)].slice(0, 3).join(', ') : 'Not recorded',
      allergies: 'Not recorded',
      mcCount: historyPatient.medicalCertificates.length,
      followUpCount: historyPatient.appointments.filter((item) => item.type === 'FOLLOW_UP').length,
    };
  }, [historyPatient]);

  const selectConsultation = (consultation: Consultation) => {
    setActive(consultation);
    setForm(toForm(consultation));
    setScheduledFollowUpSummary(null);
    setSelectedMc(consultation.medicalCertificates?.[0] ?? null);
    setError(null);
    setSuccess(null);
  };

  const openPatientHistory = async () => {
    if (!active || historyLoading) return;

    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistorySearch('');
    setHistoryTypeFilter('ALL');
    setHistoryFilterOpen(false);
    setExpandedHistoryItem(null);
    setHistoryDateRange(getDateRangeForPreset('last30'));
    setError(null);

    try {
      const response = await api.get(`/patients/${active.patientId}`);
      setHistoryPatient(response.data as PatientHistoryDetails);
    } catch (err: unknown) {
      setHistoryPatient(null);
      setError(getApiErrorMessage(err, 'Failed to load patient history'));
    } finally {
      setHistoryLoading(false);
    }
  };

  const closePatientHistory = () => {
    if (historyLoading) return;
    setHistoryOpen(false);
  };

  const startConsultation = async (consultationId: number) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await api.patch(`/consultations/${consultationId}/start`);
      const consultation = response.data as Consultation;
      setActive(consultation);
      setForm(toForm(consultation));
      setScheduledFollowUpSummary(null);
      setSelectedMc(consultation.medicalCertificates?.[0] ?? null);
      setSuccess('Consultation started.');
      await loadConsultations();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to start consultation'));
    } finally {
      setSaving(false);
    }
  };

  const saveConsultation = async (e: Pick<FormEvent, 'preventDefault'>, complete: boolean) => {
    e.preventDefault();
    if (!active) return;

    if (complete && !isMedicalCheckup && (!form.symptoms.trim() || !form.diagnosis.trim())) {
      setError('Symptoms and diagnosis are required before saving consultation.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await api.patch(`/consultations/${active.consultationId}`, {
        ...form,
        bmi: displayedBmi || undefined,
        status: complete ? 'COMPLETED' : 'IN_PROGRESS',
      });
      const consultation = response.data as Consultation;
      setActive(consultation);
      setForm(toForm(consultation));
      setSelectedMc(consultation.medicalCertificates?.[0] ?? selectedMc);
      setSuccess(complete ? 'Consultation completed.' : 'Consultation notes saved.');
      await loadConsultations();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to save consultation'));
    } finally {
      setSaving(false);
    }
  };

  const createPrescription = () => {
    if (!active || active.status !== 'COMPLETED' || active.prescription) return;
    const params = new URLSearchParams({
      patientId: String(active.patientId),
      consultationId: String(active.consultationId),
    });
    if (active.appointmentId) {
      params.set('appointmentId', String(active.appointmentId));
    }
    navigate(`/doctor/prescriptions?${params.toString()}`);
  };

  const sendMedicalCheckupToPayment = async () => {
    if (!active || !canSendMedicalCheckupToPayment) return;

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await api.post(`/consultations/${active.consultationId}/send-to-payment`);
      const data = response.data as { consultation: Consultation; payment: Consultation['payment'] };
      const consultation = data.consultation ?? { ...active, payment: data.payment };
      setActive(consultation);
      setForm(toForm(consultation));
      setSuccess('Medical checkup sent to pending payment.');
      await loadConsultations();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to send medical checkup to payment'));
    } finally {
      setSaving(false);
    }
  };

  const openMedicalCertificateDrawer = () => {
    if (!active || active.status === 'WAITING') return;
    const currentMc = active.medicalCertificates?.[0] ?? null;
    setSelectedMc(currentMc);
    setMcForm({
      startDate: currentMc ? toDateInput(new Date(currentMc.startDate)) : toDateInput(new Date()),
      days: currentMc ? String(currentMc.days) : '1',
      diagnosis: form.diagnosis.trim() || currentMc?.diagnosis || '',
      notes: currentMc?.notes ?? '',
      status: currentMc?.status === 'DRAFT' ? 'DRAFT' : 'ISSUED',
    });
    setError(null);
    setMcOpen(true);
  };

  const printMedicalCertificate = () => {
    document.body.classList.add('mc-printing');
    window.setTimeout(() => {
      window.print();
      window.setTimeout(() => document.body.classList.remove('mc-printing'), 250);
    }, 0);
  };

  const saveMedicalCertificate = async (e: FormEvent) => {
    e.preventDefault();
    if (!active || mcSaving) return;

    const days = Number(mcForm.days);
    if (!mcForm.startDate) {
      setError('MC start date is required.');
      return;
    }
    if (!Number.isInteger(days) || days <= 0) {
      setError('Number of MC days must be at least 1.');
      return;
    }
    if (!mcForm.diagnosis.trim()) {
      setError('Diagnosis / reason is required.');
      return;
    }

    setMcSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = {
        startDate: mcForm.startDate,
        days,
        diagnosis: mcForm.diagnosis.trim(),
        notes: mcForm.notes.trim() || undefined,
        status: mcForm.status,
      };
      const response = selectedMc
        ? await api.patch(`/consultations/${active.consultationId}/medical-certificates/${selectedMc.medicalCertificateId}`, payload)
        : await api.post(`/consultations/${active.consultationId}/medical-certificates`, payload);
      const medicalCertificate = response.data as MedicalCertificate;
      setSelectedMc(medicalCertificate);
      setActive((current) => current
        ? {
            ...current,
            medicalCertificates: selectedMc
              ? (current.medicalCertificates ?? []).map((mc) => mc.medicalCertificateId === medicalCertificate.medicalCertificateId ? medicalCertificate : mc)
              : [medicalCertificate],
          }
        : current);
      setSuccess(`Medical Certificate #${medicalCertificate.medicalCertificateId} ${selectedMc ? 'updated' : medicalCertificate.status === 'DRAFT' ? 'saved as draft' : 'issued'}.`);
      await loadConsultations();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to generate medical certificate'));
    } finally {
      setMcSaving(false);
    }
  };

  const deleteMedicalCertificate = async () => {
    if (!active || !selectedMc || mcSaving) return;
    setMcSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await api.delete(`/consultations/${active.consultationId}/medical-certificates/${selectedMc.medicalCertificateId}`);
      setActive((current) => current
        ? {
            ...current,
            medicalCertificates: (current.medicalCertificates ?? []).filter((mc) => mc.medicalCertificateId !== selectedMc.medicalCertificateId),
          }
        : current);
      setSelectedMc(null);
      setMcOpen(false);
      setSuccess('Medical Certificate removed.');
      await loadConsultations();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to remove medical certificate'));
    } finally {
      setMcSaving(false);
    }
  };

  const updateMedicalCertificateStatus = async (status: MedicalCertificateStatus) => {
    if (!active || !selectedMc || mcSaving) return;
    setMcSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await api.patch(
        `/consultations/${active.consultationId}/medical-certificates/${selectedMc.medicalCertificateId}/status`,
        { status },
      );
      const updated = response.data as MedicalCertificate;
      setSelectedMc(updated);
      setActive((current) => current
        ? {
            ...current,
            medicalCertificates: (current.medicalCertificates ?? []).map((mc) =>
              mc.medicalCertificateId === updated.medicalCertificateId ? updated : mc,
            ),
          }
        : current);
      setSuccess(`Medical Certificate #${updated.medicalCertificateId} marked ${formatMcStatus(updated.status)}.`);
      await loadConsultations();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to update medical certificate'));
    } finally {
      setMcSaving(false);
    }
  };

  const openFollowUpDrawer = () => {
    if (!active) return;
    if (activeFollowUp) {
      setError('This consultation already has an active follow-up appointment.');
      return;
    }
    setFollowUpDateTime(toDateTimeLocalInput(new Date(Date.now() + 7 * 24 * 60 * 60000)));
    setFollowUpNotes('');
    setFollowUpOpen(true);
  };

  const viewFollowUp = () => {
    if (!activeFollowUp) return;
    navigate(`/doctor/appointments?date=${toDateInput(new Date(activeFollowUp.dateTime))}&type=FOLLOW_UP`);
  };

  const applyFollowUpPreset = (days: number) => {
    setFollowUpDateTime(toDateTimeLocalInput(new Date(Date.now() + days * 24 * 60 * 60000)));
  };

  const createFollowUp = async (e: FormEvent) => {
    e.preventDefault();
    if (!active || followUpSaving) return;

    if (activeFollowUp) {
      setError('This consultation already has an active follow-up appointment.');
      setFollowUpOpen(false);
      return;
    }

    setFollowUpSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await api.post(`/consultations/${active.consultationId}/follow-up`, {
        dateTime: new Date(followUpDateTime).toISOString(),
        notes: followUpNotes.trim() || undefined,
      });
      const followUp = response.data as ConsultationFollowUpAppointment;
      setActive((current) => current
        ? { ...current, followUpAppointments: [followUp] }
        : current);
      setScheduledFollowUpSummary({ dateTime: followUpDateTime, notes: followUpNotes.trim() });
      setSuccess('Follow-up appointment created successfully.');
      setFollowUpOpen(false);
      setFollowUpNotes('');
      await loadConsultations();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to create follow-up appointment'));
    } finally {
      setFollowUpSaving(false);
    }
  };

  const printSummary = () => {
    window.print();
  };

  return (
    <section className="consultation-page">
      <div className="section-head consultation-page-head">
        <div>
          <h1>Consultation</h1>
          <p className="muted">Doctor queue, clinical notes, vital signs, follow-ups, and prescription handoff.</p>
        </div>
      </div>

      <div className="stats-row appointment-summary-row">
        <div className="stat-chip patient-stat-chip warning"><span>Waiting</span><strong>{stats.waiting}</strong></div>
        <div className="stat-chip patient-stat-chip"><span>In Progress</span><strong>{stats.inProgress}</strong></div>
        <div className="stat-chip patient-stat-chip"><span>Completed</span><strong>{stats.completed}</strong></div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void loadConsultations();
        }}
        className="consultation-toolbar"
      >
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ConsultationStatusFilter)} aria-label="Consultation status">
          <option value="ACTIVE">Active Queue</option>
          <option value="">All</option>
          <option value="WAITING">Waiting</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="COMPLETED">Completed</option>
        </select>
        <DateRangeFilter value={dateRange} onChange={setDateRange} includeAll />
        <PatientAutocomplete
          selectedPatient={selectedPatientFilter}
          onSelect={setSelectedPatientFilter}
          placeholder="Search patient..."
        />
        <button
          type="button"
          className="btn-secondary consultation-clear-button"
          onClick={() => {
            setStatusFilter('ACTIVE');
            setDateRange(getDateRangeForPreset('today'));
            setSelectedPatientFilter(null);
          }}
        >
          Clear Filters
        </button>
        <button type="submit" className="btn-secondary patient-compact-button consultation-refresh-button" disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {success && <p className="muted" style={{ color: 'var(--primary)' }}>{success}</p>}

      <div className="table-wrap consultation-table-wrap">
        <table className="data-table consultation-table">
          <thead>
            <tr>
              <th>Queue Number</th>
              <th>Patient</th>
              <th>Status</th>
              <th>Linked Record</th>
              <th>Waiting Time</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {paginatedConsultations.map((consultation) => (
              <tr key={consultation.consultationId}>
                <td>
                  <strong>#{consultation.consultationId}</strong>
                  <small>{new Date(consultation.createdAt).toLocaleString()}</small>
                </td>
                <td>
                  <div className="appointment-patient-cell">
                    <strong>{consultation.patient.name}</strong>
                    <small>{consultation.patient.icOrPassport} / {consultation.patient.phone}</small>
                  </div>
                </td>
                <td><span className={`status-badge ${statusClass(consultation.status)}`}>{formatStatus(consultation.status)}</span></td>
                <td>
                  <div className="consultation-linked-records">
                    {formatLinkedRecords(consultation).map((record) => (
                      <span key={record} className="status-badge status-neutral">{record}</span>
                    ))}
                  </div>
                </td>
                <td>{formatWaitingTime(consultation.createdAt)}</td>
                <td>
                  <div className="action-row consultation-row-actions">
                    <button type="button" className="btn-secondary patient-compact-button" onClick={() => selectConsultation(consultation)}>
                      Open
                    </button>
                    {consultation.status === 'WAITING' && (
                      <button type="button" className="patient-compact-button" onClick={() => void startConsultation(consultation.consultationId)} disabled={saving}>
                        Start
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={listPage} totalPages={listTotalPages} onPageChange={setListPage} />

      <div className="mobile-cards">
        {paginatedConsultations.map((consultation) => (
          <article key={consultation.consultationId} className="mobile-card">
            <h4>{consultation.patient.name}</h4>
            <dl className="kv">
              <div>
                <dt>Queue</dt>
                <dd>#{consultation.consultationId}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd><span className={`status-badge ${statusClass(consultation.status)}`}>{formatStatus(consultation.status)}</span></dd>
              </div>
              <div>
                <dt>Record</dt>
                <dd>{formatLinkedRecords(consultation).join(' / ')}</dd>
              </div>
            </dl>
            <div className="action-row" style={{ marginTop: 10 }}>
              <button type="button" className="btn-secondary" onClick={() => selectConsultation(consultation)}>
                Open
              </button>
              {consultation.status === 'WAITING' && (
                <button type="button" onClick={() => void startConsultation(consultation.consultationId)} disabled={saving}>
                  Start
                </button>
              )}
            </div>
          </article>
        ))}
      </div>

      {!loading && consultations.length === 0 && <p className="muted">No consultations found for current filters.</p>}

      {active && (
        <section className="consultation-workspace consultation-print-area">
          <div className="consultation-workspace-head">
            <div>
              <h3>Consultation #{active.consultationId}</h3>
              <p className="muted">{active.patient.name} / {formatStatus(active.status)}</p>
            </div>
            <div className="action-row consultation-head-actions">
              <button type="button" className="btn-secondary" onClick={printSummary}>
                Print Summary
              </button>
              <button type="button" className="btn-secondary" onClick={printSummary}>
                Export PDF
              </button>
              <button type="button" className="btn-secondary" onClick={() => void openPatientHistory()} disabled={historyLoading}>
                View History
              </button>
              <button type="button" className="btn-secondary" onClick={() => setActive(null)}>
                Close
              </button>
            </div>
          </div>

          <section className="consultation-print-summary">
            <div className="consultation-print-header">
              <img src={clinicLogo} alt="Clinic Dr. Alwani" />
              <div>
                <h2>Consultation Summary</h2>
                <p>Generated on {new Date().toLocaleString()}</p>
              </div>
            </div>
          </section>

          <div className="consultation-section-grid">
            <article className="consultation-card">
              <div className="patient-card-head">
                <div>
                  <h3>Patient Information</h3>
                  <p className="muted">Core details and linked records.</p>
                </div>
                <button type="button" className="btn-secondary patient-compact-button" onClick={() => void openPatientHistory()} disabled={historyLoading}>
                  View History
                </button>
              </div>
              <dl className="kv consultation-kv">
                <div><dt>Patient</dt><dd>{active.patient.name}</dd></div>
                <div><dt>IC / ID</dt><dd>{active.patient.icOrPassport}</dd></div>
                <div><dt>Phone</dt><dd>{active.patient.phone}</dd></div>
                <div><dt>Gender</dt><dd>{active.patient.gender ?? '-'}</dd></div>
                <div><dt>Date of Birth</dt><dd>{active.patient.dateOfBirth ? new Date(active.patient.dateOfBirth).toLocaleDateString() : '-'}</dd></div>
                <div>
                  <dt>Linked Record</dt>
                  <dd>{formatLinkedRecords(active).join(' / ')}</dd>
                </div>
              </dl>
            </article>

            <article className="consultation-card">
              <div className="patient-card-head">
                <div>
                  <h3>Consultation Type</h3>
                  <p className="muted">Choose the visit category for this consultation.</p>
                </div>
              </div>
              <label className="field-block">
                <span>Consultation Type</span>
                <select
                  value={form.consultationType}
                  onChange={(e) => setForm((prev) => ({ ...prev, consultationType: e.target.value as ConsultationType }))}
                  disabled={active.status === 'WAITING' || active.status === 'COMPLETED'}
                >
                  {consultationTypeOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <dl className="kv consultation-kv consultation-type-summary">
                <div><dt>Current Type</dt><dd>{formatConsultationType(form.consultationType)}</dd></div>
                <div><dt>Prescription</dt><dd>{active.prescription ? `Prescription #${active.prescription.prescriptionId}` : 'Optional if medicine is needed'}</dd></div>
              </dl>
            </article>
          </div>

          {isMedicalCheckup ? (
            <article className="consultation-card medical-checkup-card">
              <div className="patient-card-head">
                <div>
                  <h3>Medical Checkup</h3>
                  <p className="muted">Structured checkup measurements. BMI is calculated from weight and height.</p>
                </div>
              </div>
              <div className="medical-checkup-grid">
                <label className="field-block">
                  <span>Blood Pressure</span>
                  <input
                    value={form.bloodPressure}
                    onChange={(e) => setForm((prev) => ({ ...prev, bloodPressure: e.target.value }))}
                    placeholder="e.g. 120/80"
                    disabled={active.status === 'WAITING' || active.status === 'COMPLETED'}
                  />
                </label>
                <label className="field-block">
                  <span>Weight</span>
                  <input
                    value={form.weight}
                    onChange={(e) => setForm((prev) => ({ ...prev, weight: e.target.value }))}
                    placeholder="e.g. 60 kg"
                    disabled={active.status === 'WAITING' || active.status === 'COMPLETED'}
                  />
                </label>
                <label className="field-block">
                  <span>Height</span>
                  <input
                    value={form.height}
                    onChange={(e) => setForm((prev) => ({ ...prev, height: e.target.value }))}
                    placeholder="e.g. 165 cm"
                    disabled={active.status === 'WAITING' || active.status === 'COMPLETED'}
                  />
                </label>
                <label className="field-block">
                  <span>BMI</span>
                  <output className="age-output">{displayedBmi || '-'}</output>
                </label>
                <label className="field-block">
                  <span>Temperature</span>
                  <input
                    value={form.temperature}
                    onChange={(e) => setForm((prev) => ({ ...prev, temperature: e.target.value }))}
                    placeholder="e.g. 37.0 C"
                    disabled={active.status === 'WAITING' || active.status === 'COMPLETED'}
                  />
                </label>
                <label className="field-block">
                  <span>Heart Rate</span>
                  <input
                    value={form.heartRate}
                    onChange={(e) => setForm((prev) => ({ ...prev, heartRate: e.target.value }))}
                    placeholder="e.g. 78 bpm"
                    disabled={active.status === 'WAITING' || active.status === 'COMPLETED'}
                  />
                </label>
                <label className="field-block medical-checkup-wide">
                  <span>Notes</span>
                  <textarea
                    value={form.checkupNotes}
                    onChange={(e) => setForm((prev) => ({ ...prev, checkupNotes: e.target.value }))}
                    placeholder="Checkup observations, advice, or follow-up notes"
                    rows={3}
                    disabled={active.status === 'WAITING' || active.status === 'COMPLETED'}
                  />
                </label>
              </div>
            </article>
          ) : (
            <article className="consultation-card">
              <div className="patient-card-head">
                <div>
                  <h3>Vital Signs</h3>
                  <p className="muted">Optional baseline measurements.</p>
                </div>
              </div>
              <div className="consultation-vitals-grid">
                <label className="field-block">
                  <span>Temperature</span>
                  <input
                    value={form.temperature}
                    onChange={(e) => setForm((prev) => ({ ...prev, temperature: e.target.value }))}
                    placeholder="e.g. 37.0 C"
                    disabled={active.status === 'WAITING' || active.status === 'COMPLETED'}
                  />
                </label>
                <label className="field-block">
                  <span>Blood Pressure</span>
                  <input
                    value={form.bloodPressure}
                    onChange={(e) => setForm((prev) => ({ ...prev, bloodPressure: e.target.value }))}
                    placeholder="e.g. 120/80"
                    disabled={active.status === 'WAITING' || active.status === 'COMPLETED'}
                  />
                </label>
                <label className="field-block">
                  <span>Weight</span>
                  <input
                    value={form.weight}
                    onChange={(e) => setForm((prev) => ({ ...prev, weight: e.target.value }))}
                    placeholder="e.g. 60 kg"
                    disabled={active.status === 'WAITING' || active.status === 'COMPLETED'}
                  />
                </label>
              </div>
            </article>
          )}

          {active.status === 'WAITING' ? (
            <article className="consultation-card">
              <div className="patient-card-head">
                <div>
                  <h3>Ready For Consultation</h3>
                  <p className="muted">Start this queue item to begin clinical documentation.</p>
                </div>
              </div>
              <button type="button" onClick={() => void startConsultation(active.consultationId)} disabled={saving}>
                {saving ? 'Starting...' : 'Start Consultation'}
              </button>
            </article>
          ) : (
            <form className="consultation-form-shell" onSubmit={(e) => void saveConsultation(e, false)}>
              <div className="consultation-section-grid">
                <article className="consultation-card">
                  <div className="patient-card-head">
                    <div>
                      <h3>Clinical Assessment</h3>
                      <p className="muted">Symptoms and diagnosis.</p>
                    </div>
                  </div>
                  <label className="field-block">
                    <span>Symptoms</span>
                    <textarea
                      value={form.symptoms}
                      onChange={(e) => setForm((prev) => ({ ...prev, symptoms: e.target.value }))}
                      placeholder="Symptoms"
                      rows={4}
                      disabled={active.status === 'COMPLETED'}
                    />
                  </label>
                  <label className="field-block">
                    <span>Diagnosis</span>
                    <textarea
                      value={form.diagnosis}
                      onChange={(e) => setForm((prev) => ({ ...prev, diagnosis: e.target.value }))}
                      placeholder="Diagnosis"
                      rows={4}
                      disabled={active.status === 'COMPLETED'}
                    />
                  </label>
                </article>

                <article className="consultation-card">
                  <div className="patient-card-head">
                    <div>
                      <h3>Consultation Notes</h3>
                      <p className="muted">Plan, advice, and clinical remarks.</p>
                    </div>
                  </div>
                  <label className="field-block">
                    <span>Notes</span>
                    <textarea
                      value={form.consultationNotes}
                      onChange={(e) => setForm((prev) => ({ ...prev, consultationNotes: e.target.value }))}
                      placeholder="Consultation notes"
                      rows={9}
                      disabled={active.status === 'COMPLETED'}
                    />
                  </label>
                </article>
              </div>

              <div className="consultation-action-bar">
                {active.status !== 'COMPLETED' && (
                  <button type="submit" className="btn-secondary" disabled={saving}>
                    {saving ? 'Saving...' : 'Save Draft'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void openPatientHistory()}
                  disabled={historyLoading}
                >
                  View History
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={createPrescription}
                  disabled={active.status !== 'COMPLETED' || Boolean(active.prescription)}
                >
                  {active.prescription ? 'Prescription Created' : 'Create Prescription'}
                </button>
                {active.consultationType === 'MEDICAL_CHECKUP' && !active.prescription && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void sendMedicalCheckupToPayment()}
                    disabled={!canSendMedicalCheckupToPayment || saving}
                  >
                    {activePayment ? 'Payment Created' : 'Send to Payment'}
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={openMedicalCertificateDrawer}
                  disabled={mcSaving}
                >
                  {latestMedicalCertificate ? 'View MC' : 'Generate MC'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={activeFollowUp ? viewFollowUp : openFollowUpDrawer}
                  disabled={followUpSaving}
                >
                  {activeFollowUp ? 'View Follow-up' : 'Schedule Follow-up'}
                </button>
                {active.status !== 'COMPLETED' && (
                  <button type="button" onClick={(e) => void saveConsultation(e, true)} disabled={saving}>
                    {saving ? 'Saving...' : 'Complete Consultation'}
                  </button>
                )}
              </div>
            </form>
          )}

          {(active.medicalCertificates?.length ?? 0) > 0 && (
            <section className="consultation-card mc-history-card">
              <div className="patient-card-head">
                <div>
                  <h3>Medical Certificates</h3>
                  <p className="muted">MC records linked to this consultation.</p>
                </div>
              </div>
              <div className="mc-history-list">
                {active.medicalCertificates?.map((mc) => (
                  <button
                    key={mc.medicalCertificateId}
                    type="button"
                    className="mc-history-item"
                    onClick={() => {
                      setSelectedMc(mc);
                      setMcOpen(true);
                    }}
                  >
                    <span>
                      <strong>MC #{mc.medicalCertificateId}</strong>
                      <small>{toDisplayDate(mc.startDate)} - {mc.days} day{mc.days === 1 ? '' : 's'} / Return {toDisplayDate(mc.returnToWorkDate)}</small>
                    </span>
                    <span className={`status-badge ${mcStatusClass(mc.status)}`}>{formatMcStatus(mc.status)}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="consultation-print-summary">
            <h3>Clinical Details</h3>
            <dl className="kv consultation-kv">
              <div><dt>Consultation Type</dt><dd>{formatConsultationType(form.consultationType)}</dd></div>
              <div><dt>Symptoms</dt><dd>{form.symptoms || '-'}</dd></div>
              <div><dt>Diagnosis</dt><dd>{form.diagnosis || '-'}</dd></div>
              <div><dt>Notes</dt><dd>{form.consultationNotes || '-'}</dd></div>
              <div><dt>Temperature</dt><dd>{form.temperature || '-'}</dd></div>
              <div><dt>Blood Pressure</dt><dd>{form.bloodPressure || '-'}</dd></div>
              <div><dt>Weight</dt><dd>{form.weight || '-'}</dd></div>
              <div><dt>Height</dt><dd>{form.height || '-'}</dd></div>
              <div><dt>BMI</dt><dd>{displayedBmi || '-'}</dd></div>
              <div><dt>Heart Rate</dt><dd>{form.heartRate || '-'}</dd></div>
              <div><dt>Checkup Notes</dt><dd>{form.checkupNotes || '-'}</dd></div>
              <div><dt>Prescription</dt><dd>{active.prescription ? `Prescription #${active.prescription.prescriptionId}` : '-'}</dd></div>
              <div>
                <dt>Medical Certificate</dt>
                <dd>
                  {latestMedicalCertificate
                    ? `MC #${latestMedicalCertificate.medicalCertificateId} - ${latestMedicalCertificate.days} day${latestMedicalCertificate.days === 1 ? '' : 's'} (${formatMcStatus(latestMedicalCertificate.status)})`
                    : 'Not generated'}
                </dd>
              </div>
              <div>
                <dt>Follow-up</dt>
                <dd>
                  {scheduledFollowUpSummary
                    ? `${new Date(scheduledFollowUpSummary.dateTime).toLocaleString()}${scheduledFollowUpSummary.notes ? ` - ${scheduledFollowUpSummary.notes}` : ''}`
                    : activeFollowUp
                      ? `Appointment #${activeFollowUp.appointmentId} - ${new Date(activeFollowUp.dateTime).toLocaleString()} (${activeFollowUp.status.replace('_', ' ')})`
                      : 'Not scheduled'}
                </dd>
              </div>
            </dl>
          </section>
        </section>
      )}

      {historyOpen && active && (
        <div className="appointment-drawer-layer consultation-history-layer" role="presentation">
          <button type="button" className="patient-drawer-backdrop" aria-label="Close history drawer" onClick={closePatientHistory} disabled={historyLoading} />
          <aside className="patient-drawer appointment-drawer consultation-history-drawer" role="dialog" aria-modal="true" aria-labelledby="consultation-history-title">
            <div className="patient-drawer-head">
              <div>
                <h3 id="consultation-history-title">Patient History</h3>
                <p className="muted">{active.patient.name} / {active.patient.icOrPassport}</p>
              </div>
              <button type="button" className="patient-drawer-close" onClick={closePatientHistory} disabled={historyLoading}>
                X
              </button>
            </div>

            <div className="patient-drawer-body consultation-history-body">
              {historyLoading && <p className="muted">Loading patient history...</p>}

              {!historyLoading && historyPatient && historySummary && (
                <>
                  <section className="history-summary-strip">
                    <div>
                      <span>Last Visit</span>
                      <strong>{historySummary.lastVisitDate ? toDisplayDate(historySummary.lastVisitDate) : '-'}</strong>
                    </div>
                    <div>
                      <span>Last Diagnosis</span>
                      <strong>{historySummary.lastDiagnosis}</strong>
                    </div>
                    <div>
                      <span>Allergies</span>
                      <strong>{historySummary.allergies}</strong>
                    </div>
                    <span className="history-visit-badge">Visits {historySummary.totalVisits}</span>
                  </section>

                  <div className="history-quick-filter">
                    <input
                      value={historySearch}
                      onChange={(e) => setHistorySearch(e.target.value)}
                      placeholder="Search history..."
                    />
                    <label className="history-type-select">
                      <span>History Type</span>
                      <select value={historyTypeFilter} onChange={(e) => setHistoryTypeFilter(e.target.value as HistoryTypeFilter)}>
                        <option value="ALL">All History</option>
                        <option value="CONSULTATION">Consultations</option>
                        <option value="PRESCRIPTION">Prescriptions</option>
                        <option value="MC">MC</option>
                        <option value="FOLLOW_UP">Follow-ups</option>
                        <option value="PAYMENT">Payments</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="btn-secondary consultation-clear-button"
                      onClick={() => setHistoryFilterOpen((current) => !current)}
                      aria-expanded={historyFilterOpen}
                    >
                      Filter
                    </button>
                  </div>

                  {historyFilterOpen && (
                    <div className="history-filter-panel">
                      <DateRangeFilter value={historyDateRange} onChange={setHistoryDateRange} includeAll />
                      <button
                        type="button"
                        className="btn-secondary consultation-clear-button"
                        onClick={() => {
                          setHistorySearch('');
                          setHistoryDateRange(getDateRangeForPreset('last30'));
                          setHistoryTypeFilter('ALL');
                        }}
                      >
                        Reset
                      </button>
                    </div>
                  )}

                  <div className="history-results-area">
                    <div className="history-timeline" aria-live="polite">
                      {historyTimeline.map((item) => (
                        <article key={item.key} className="history-timeline-card">
                          <div className="history-timeline-marker" />
                          <div className="history-card-head">
                            <div>
                              <span className={`status-badge ${historyCategoryClass(item.category)}`}>{formatHistoryCategory(item.category)}</span>
                              {item.status && <span className="status-badge status-neutral">{item.status}</span>}
                            </div>
                            <time>{new Date(item.date).toLocaleString()}</time>
                          </div>
                          <h4>{item.title}</h4>
                          <p className="muted">{item.subtitle}</p>
                          <button
                            type="button"
                            className="history-details-toggle"
                            onClick={() => setExpandedHistoryItem((current) => (current === item.key ? null : item.key))}
                          >
                            {expandedHistoryItem === item.key ? 'Hide Details' : 'View Details'}
                          </button>
                          {expandedHistoryItem === item.key && (
                            <dl className="history-detail-grid">
                              {item.details.map((detail) => (
                                <div key={`${item.key}-${detail.label}`}>
                                  <dt>{detail.label}</dt>
                                  <dd>{detail.value}</dd>
                                </div>
                              ))}
                            </dl>
                          )}
                        </article>
                      ))}
                    </div>

                    {historyTimeline.length === 0 && <p className="muted history-empty-state">No history records match the current filters.</p>}
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>
      )}

      {mcOpen && active && (
        <div className="appointment-drawer-layer mc-drawer-layer" role="presentation">
          <button type="button" className="patient-drawer-backdrop" aria-label="Close MC drawer" onClick={() => setMcOpen(false)} disabled={mcSaving} />
          <aside className="patient-drawer appointment-drawer mc-drawer" role="dialog" aria-modal="true" aria-labelledby="consultation-mc-title">
            <div className="patient-drawer-head">
              <div>
                <h3 id="consultation-mc-title">{selectedMc ? `Medical Certificate #${selectedMc.medicalCertificateId}` : 'Generate Medical Certificate'}</h3>
                <p className="muted">{active.patient.name} / Consultation #{active.consultationId}</p>
              </div>
              <button type="button" className="patient-drawer-close" onClick={() => setMcOpen(false)} disabled={mcSaving}>
                X
              </button>
            </div>

            <div className="patient-drawer-body">
              <div className="mc-autofill-grid">
                <div>
                  <span>Patient</span>
                  <strong>{active.patient.name}</strong>
                  <small>{active.patient.icOrPassport}</small>
                </div>
                <div>
                  <span>Consultation Date</span>
                  <strong>{toDisplayDate(active.createdAt)}</strong>
                  <small>Consultation #{active.consultationId}</small>
                </div>
                <div>
                  <span>Doctor</span>
                  <strong>{active.doctor?.username ?? 'Doctor'}</strong>
                  <small>{CLINIC_NAME}</small>
                </div>
              </div>

              <form onSubmit={saveMedicalCertificate} className="patient-registration-form mc-form">
                <div className="mc-form-grid">
                  <label className="field-block">
                    <span>MC Start Date</span>
                    <input
                      type="date"
                      value={mcForm.startDate}
                      onChange={(e) => setMcForm((prev) => ({ ...prev, startDate: e.target.value }))}
                      disabled={mcSaving}
                      required
                    />
                  </label>
                  <label className="field-block">
                    <span>Number of MC Days</span>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={mcForm.days}
                      onChange={(e) => setMcForm((prev) => ({ ...prev, days: e.target.value }))}
                      disabled={mcSaving}
                      required
                    />
                  </label>
                  <label className="field-block">
                    <span>Return to Work Date</span>
                    <output className="age-output">{mcReturnToWorkDate ? toDisplayDate(`${mcReturnToWorkDate}T00:00:00`) : '-'}</output>
                  </label>
                  <label className="field-block">
                    <span>MC Status</span>
                    <select
                      value={mcForm.status}
                      onChange={(e) => setMcForm((prev) => ({ ...prev, status: e.target.value as MedicalCertificateForm['status'] }))}
                      disabled={mcSaving}
                    >
                      <option value="ISSUED">Issued</option>
                      <option value="DRAFT">Draft</option>
                    </select>
                  </label>
                  <label className="field-block mc-form-wide">
                    <span>Diagnosis / Reason</span>
                    <textarea
                      value={mcForm.diagnosis}
                      onChange={(e) => setMcForm((prev) => ({ ...prev, diagnosis: e.target.value }))}
                      placeholder="Diagnosis or reason for medical leave"
                      rows={3}
                      disabled={mcSaving}
                      required
                    />
                  </label>
                  <label className="field-block mc-form-wide">
                    <span>Additional Notes</span>
                    <textarea
                      value={mcForm.notes}
                      onChange={(e) => setMcForm((prev) => ({ ...prev, notes: e.target.value }))}
                      placeholder="Optional remarks for the certificate"
                      rows={3}
                      disabled={mcSaving}
                    />
                  </label>
                </div>

                <div className="mc-actions">
                  <button type="submit" disabled={mcSaving}>
                    {mcSaving ? 'Saving MC...' : selectedMc ? 'Update MC' : 'Generate MC'}
                  </button>
                  {selectedMc && (
                    <>
                      {selectedMc.status === 'DRAFT' && (
                        <button type="button" className="btn-secondary" onClick={() => void updateMedicalCertificateStatus('ISSUED')} disabled={mcSaving}>
                          Issue MC
                        </button>
                      )}
                      <button type="button" className="btn-secondary" onClick={printMedicalCertificate}>
                        Print MC
                      </button>
                      <button type="button" className="btn-secondary" onClick={printMedicalCertificate}>
                        Export PDF
                      </button>
                      {selectedMc.status !== 'CANCELLED' && (
                        <button type="button" className="btn-secondary" onClick={() => void updateMedicalCertificateStatus('CANCELLED')} disabled={mcSaving}>
                          Cancel MC
                        </button>
                      )}
                      <button type="button" className="btn-danger" onClick={() => void deleteMedicalCertificate()} disabled={mcSaving}>
                        Remove MC
                      </button>
                    </>
                  )}
                </div>
              </form>

              {selectedMc && (
                <section className="mc-preview mc-print-area">
                  <div className="mc-preview-header">
                    <img src={clinicLogo} alt={CLINIC_NAME} />
                    <div>
                      <h2>{CLINIC_NAME}</h2>
                      <p>Medical Certificate</p>
                    </div>
                    <span className={`status-badge ${mcStatusClass(selectedMc.status)}`}>{formatMcStatus(selectedMc.status)}</span>
                  </div>

                  <div className="mc-preview-reference">
                    <span>MC #{selectedMc.medicalCertificateId}</span>
                    <span>Consultation #{active.consultationId}</span>
                    <span>Issued {toDisplayDate(selectedMc.createdAt)}</span>
                  </div>

                  <p className="mc-certificate-copy">
                    This is to certify that <strong>{active.patient.name}</strong> (IC/ID: <strong>{active.patient.icOrPassport}</strong>)
                    was seen at {CLINIC_NAME} on <strong>{toDisplayDate(active.createdAt)}</strong> and is unfit for work
                    for <strong>{selectedMc.days} day{selectedMc.days === 1 ? '' : 's'}</strong> from <strong>{toDisplayDate(selectedMc.startDate)}</strong>.
                  </p>

                  <dl className="kv consultation-kv mc-preview-kv">
                    <div><dt>Return to Work</dt><dd>{toDisplayDate(selectedMc.returnToWorkDate)}</dd></div>
                    <div><dt>Diagnosis / Reason</dt><dd>{selectedMc.diagnosis}</dd></div>
                    <div><dt>Additional Notes</dt><dd>{selectedMc.notes || '-'}</dd></div>
                    <div><dt>Doctor</dt><dd>{selectedMc.doctor?.username ?? active.doctor?.username ?? 'Doctor'}</dd></div>
                  </dl>

                  <div className="mc-signature-row">
                    <div>
                      <span />
                      <strong>Doctor Signature</strong>
                      <small>{selectedMc.doctor?.username ?? active.doctor?.username ?? 'Doctor'}</small>
                    </div>
                    <div>
                      <span />
                      <strong>Clinic Stamp</strong>
                      <small>{CLINIC_NAME}</small>
                    </div>
                  </div>
                </section>
              )}
            </div>
          </aside>
        </div>
      )}

      {followUpOpen && active && (
        <div className="appointment-drawer-layer" role="presentation">
          <button type="button" className="patient-drawer-backdrop" aria-label="Close follow-up drawer" onClick={() => setFollowUpOpen(false)} disabled={followUpSaving} />
          <aside className="patient-drawer appointment-drawer" role="dialog" aria-modal="true" aria-labelledby="consultation-follow-up-title">
            <div className="patient-drawer-head">
              <div>
                <h3 id="consultation-follow-up-title">Schedule Follow-up</h3>
                <p className="muted">{active.patient.name} / Consultation #{active.consultationId}</p>
              </div>
              <button type="button" className="patient-drawer-close" onClick={() => setFollowUpOpen(false)} disabled={followUpSaving}>
                X
              </button>
            </div>

            <form onSubmit={createFollowUp} className="patient-registration-form patient-drawer-form">
              <div className="patient-drawer-body">
                <div className="appointment-drawer-stack">
                  <div className="consultation-preset-row">
                    <button type="button" className="btn-secondary" onClick={() => applyFollowUpPreset(7)} disabled={followUpSaving}>1 week</button>
                    <button type="button" className="btn-secondary" onClick={() => applyFollowUpPreset(14)} disabled={followUpSaving}>2 weeks</button>
                    <button type="button" className="btn-secondary" onClick={() => applyFollowUpPreset(30)} disabled={followUpSaving}>1 month</button>
                  </div>
                  <label className="field-block">
                    <span>Follow-up Date & Time</span>
                    <input
                      type="datetime-local"
                      value={followUpDateTime}
                      onChange={(e) => setFollowUpDateTime(e.target.value)}
                      disabled={followUpSaving}
                      required
                    />
                  </label>
                  <label className="field-block">
                    <span>Follow-up Reason / Notes</span>
                    <textarea
                      value={followUpNotes}
                      onChange={(e) => setFollowUpNotes(e.target.value)}
                      placeholder="Optional"
                      rows={4}
                      disabled={followUpSaving}
                    />
                  </label>
                </div>
              </div>

              <div className="patient-drawer-footer">
                <button type="submit" disabled={followUpSaving}>{followUpSaving ? 'Creating Follow-up...' : 'Create Follow-up'}</button>
                <button className="btn-secondary" type="button" onClick={() => setFollowUpOpen(false)} disabled={followUpSaving}>
                  Cancel
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}
    </section>
  );
};
