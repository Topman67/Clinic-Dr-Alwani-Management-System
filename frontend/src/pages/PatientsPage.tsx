import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { subscribeInAppDataSync } from '../lib/sync';
import { usePagination } from '../lib/pagination';
import { useAuth } from '../context/AuthContext';
import { PatientAutocomplete, type PatientAutocompleteOption } from '../components/PatientAutocomplete';
import { DateRangeFilter } from '../components/DateRangeFilter';
import { getDateRangeForPreset, type DateRangeValue } from '../lib/dateRange';
import { Pagination } from '../components/Pagination';
import PageHeader from '../components/common/PageHeader';

type Gender = 'MALE' | 'FEMALE' | 'OTHER';

type Patient = {
  patientId: number;
  name: string;
  icOrPassport: string;
  phone: string;
  address: string | null;
  gender: Gender | null;
  dateOfBirth: string | null;
  isActive: boolean;
  archivedAt?: string | null;
  archivedBy?: string | null;
  _count?: {
    prescriptions: number;
    appointments?: number;
    consultations: number;
    payments: number;
    medicalCertificates?: number;
  };
  consultations?: Array<{
    consultationId: number;
    status: ConsultationStatus;
    createdAt: string;
    updatedAt: string;
    diagnosis?: string | null;
    doctor?: { username: string; role: string };
    prescription?: { prescriptionId: number; date: string } | null;
    medicalCertificates?: Array<{
      medicalCertificateId: number;
      startDate: string;
      days: number;
      returnToWorkDate: string;
      status: MedicalCertificateStatus;
    }>;
  }>;
  appointments?: Array<{
    appointmentId: number;
    status: AppointmentStatus;
    type?: AppointmentType;
    dateTime: string;
    updatedAt: string;
    notes?: string | null;
    followUpFromConsultation?: { consultationId: number; createdAt: string; diagnosis?: string | null } | null;
    previousPrescription?: { prescriptionId: number; date: string } | null;
  }>;
};

type PatientDetails = Patient & {
  prescriptions: Array<{
    prescriptionId: number;
    date: string;
    notes?: string | null;
    doctor?: { username: string; role: string };
  }>;
  consultations: Array<{
    consultationId: number;
    createdAt: string;
    status: string;
    diagnosis?: string | null;
    doctor?: { username: string; role: string };
    prescription?: { prescriptionId: number; date: string } | null;
    medicalCertificates?: Array<{
      medicalCertificateId: number;
      startDate: string;
      days: number;
      returnToWorkDate: string;
      status: MedicalCertificateStatus;
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
    doctor?: { username: string; role: string };
    consultation?: { consultationId: number; createdAt: string; diagnosis?: string | null } | null;
  }>;
  payments: Array<{
    paymentId: number;
    type: string;
    amount: number | string;
    date: string;
    status: string;
    receipt?: { receiptNo: string } | null;
  }>;
  appointments: Array<{
    appointmentId: number;
    status: AppointmentStatus;
    type: AppointmentType;
    dateTime: string;
    notes?: string | null;
    followUpFromConsultation?: { consultationId: number; createdAt: string; diagnosis?: string | null } | null;
    previousPrescription?: { prescriptionId: number; date: string } | null;
  }>;
};

type PatientForm = {
  name: string;
  icOrPassport: string;
  phone: string;
  address: string;
  gender: Gender;
  dateOfBirth: string;
};

type PatientStatusFilter = 'active' | 'archived' | 'all';
type ConsultationStatus = 'WAITING' | 'IN_PROGRESS' | 'COMPLETED';
type AppointmentStatus = 'PENDING' | 'ARRIVED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
type AppointmentType = 'NEW' | 'FOLLOW_UP';
type MedicalCertificateStatus = 'DRAFT' | 'ISSUED' | 'CANCELLED';
type PatientPanelMode = 'details' | 'history';

const initialForm: PatientForm = {
  name: '',
  icOrPassport: '',
  phone: '',
  address: '',
  gender: 'MALE',
  dateOfBirth: '',
};

const prettifyGender = (gender: Gender) => {
  if (gender === 'MALE') return 'Male';
  if (gender === 'FEMALE') return 'Female';
  return 'Other';
};

const formatMoney = (value: number | string) => {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n.toFixed(2) : '0.00';
};

const toDateInput = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const todayInputValue = () => new Date().toISOString().slice(0, 10);

const normalizeIc = (value: string) => value.replace(/\D/g, '');

const parseDateInput = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
};

const formatDisplayDate = (value: string) => {
  const date = parseDateInput(value);
  if (!date) return '';
  return [
    String(date.getDate()).padStart(2, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    date.getFullYear(),
  ].join('/');
};

const formatLongDate = (value?: string | null) => {
  if (!value) return '-';
  const inputValue = toDateInput(value);
  const date = parseDateInput(inputValue);
  if (!date) return '-';
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

const calculateAge = (value: string) => {
  const dob = parseDateInput(value);
  if (!dob) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const hasBirthdayPassed =
    today.getMonth() > dob.getMonth() ||
    (today.getMonth() === dob.getMonth() && today.getDate() >= dob.getDate());
  if (!hasBirthdayPassed) age -= 1;
  return age >= 0 ? age : null;
};

const extractDobFromMalaysianIc = (value: string) => {
  const digits = normalizeIc(value);
  if (!/^\d{12}$/.test(digits)) return null;

  const yy = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  const currentYear = new Date().getFullYear();
  const currentShortYear = currentYear % 100;
  const year = yy > currentShortYear ? 1900 + yy : 2000 + yy;
  const date = new Date(year, month - 1, day);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  if (date.getTime() > Date.now()) return null;
  return [
    year,
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
};

const getIcValidationMessage = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const compact = normalizeIc(trimmed);
  const looksNumericIc = /^[\d-]+$/.test(trimmed) && compact.length >= 6;
  if (!looksNumericIc) return null;
  if (!/^\d{6}-?\d{2}-?\d{4}$/.test(trimmed)) {
    return 'Malaysian IC must use 12 digits, with optional hyphens.';
  }
  if (!extractDobFromMalaysianIc(trimmed)) {
    return 'IC date segment is invalid or in the future.';
  }
  return null;
};

const formatPatientId = (patientId: number) => `PT-${String(patientId).padStart(4, '0')}`;

const getPatientInitials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'PT';
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
};

const formatConsultationStatus = (status?: ConsultationStatus) => {
  if (!status) return 'No active visit';
  if (status === 'WAITING') return 'Waiting Consultation';
  if (status === 'IN_PROGRESS') return 'In Consultation';
  return 'Completed';
};

const formatAppointmentStatus = (status?: AppointmentStatus) => {
  if (status === 'ARRIVED') return 'Appointment Arrived';
  if (status === 'PENDING') return 'Appointment';
  return 'Appointment';
};

const formatAppointmentType = (type?: AppointmentType) => (type === 'FOLLOW_UP' ? 'Follow-up Appointment' : 'First Visit Appointment');

const formatMedicalCertificateStatus = (status: MedicalCertificateStatus) => status.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

const medicalCertificateStatusClass = (status: MedicalCertificateStatus) => {
  if (status === 'ISSUED') return 'status-good';
  if (status === 'DRAFT') return 'status-warning';
  return 'status-archived';
};

const buildPatientTimeline = (patient: PatientDetails) => {
  const consultationItems = patient.consultations.map((item) => ({
    key: `c-${item.consultationId}`,
    date: item.createdAt,
    badge: <span className="status-badge type-consultation">Consultation</span>,
    detail: [
      item.status,
      item.diagnosis || '',
      item.prescription?.prescriptionId ? `Prescription #${item.prescription.prescriptionId}` : '',
      ...(item.medicalCertificates ?? []).map((mc) => `MC #${mc.medicalCertificateId}`),
    ].filter(Boolean).join(' - '),
  }));

  const appointmentItems = patient.appointments.map((item) => ({
    key: `a-${item.appointmentId}`,
    date: item.dateTime,
    badge: <span className="status-badge status-warning">{formatAppointmentType(item.type)}</span>,
    detail: [
      item.status,
      item.followUpFromConsultation?.consultationId ? `Consultation #${item.followUpFromConsultation.consultationId}` : '',
      item.previousPrescription?.prescriptionId ? `Prescription #${item.previousPrescription.prescriptionId}` : '',
      item.notes || '',
    ].filter(Boolean).join(' - '),
  }));

  const prescriptionItems = patient.prescriptions.map((item) => ({
    key: `p-${item.prescriptionId}`,
    date: item.date,
    badge: <span className="status-badge status-neutral">Prescription</span>,
    detail: item.notes || `By ${item.doctor?.username ?? 'Doctor'}`,
  }));

  const medicalCertificateItems = patient.medicalCertificates.map((item) => ({
    key: `mc-${item.medicalCertificateId}`,
    date: item.createdAt,
    badge: <span className={`status-badge ${medicalCertificateStatusClass(item.status)}`}>MC</span>,
    detail: [
      `MC #${item.medicalCertificateId}`,
      `Consultation #${item.consultation?.consultationId ?? '-'}`,
      `${item.days} day${item.days === 1 ? '' : 's'}`,
      `Return ${formatLongDate(item.returnToWorkDate)}`,
      item.diagnosis,
      formatMedicalCertificateStatus(item.status),
    ].filter(Boolean).join(' - '),
  }));

  const paymentItems = patient.payments.map((item) => ({
    key: `pay-${item.paymentId}`,
    date: item.date,
    badge: <span className="status-badge status-good">Payment</span>,
    detail: `${item.type} - RM ${formatMoney(item.amount)} - ${item.status}${item.receipt?.receiptNo ? ` - ${item.receipt.receiptNo}` : ''}`,
  }));

  return [...consultationItems, ...appointmentItems, ...prescriptionItems, ...medicalCertificateItems, ...paymentItems].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );
};

const getLatestConsultation = (patient: Patient) => patient.consultations?.[0] ?? null;

const getActiveConsultation = (patient: Patient) =>
  patient.consultations?.find((consultation) => consultation.status === 'WAITING' || consultation.status === 'IN_PROGRESS') ?? null;

const getActiveAppointment = (patient: Patient) =>
  patient.appointments?.find((appointment) => appointment.status === 'PENDING' || appointment.status === 'ARRIVED') ?? null;

const getPatientWorkflowStatus = (patient: Patient) => {
  const activeConsultation = getActiveConsultation(patient);
  if (activeConsultation) {
    return {
      label: formatConsultationStatus(activeConsultation.status),
      badgeClass: 'status-warning',
      isBlocked: true,
    };
  }

  const activeAppointment = getActiveAppointment(patient);
  if (activeAppointment) {
    return {
      label: formatAppointmentStatus(activeAppointment.status),
      badgeClass: 'type-appointment',
      isBlocked: true,
    };
  }

  return {
    label: 'No active visit',
    badgeClass: 'status-neutral',
    isBlocked: false,
  };
};

const getDobValidationMessage = (value: string) => {
  if (!value) return null;
  const dob = parseDateInput(value);
  if (!dob) return 'Date of birth is invalid.';
  if (dob.getTime() > Date.now()) return 'Date of birth cannot be in the future.';
  return null;
};

const getApiErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'object' && error !== null) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    const message = response?.data?.message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return fallback;
};

const getApiErrorStatus = (error: unknown) => {
  if (typeof error !== 'object' || error === null) return null;
  const response = (error as { response?: { status?: number } }).response;
  return typeof response?.status === 'number' ? response.status : null;
};

export const PatientsPage = () => {
  const { role } = useAuth();
  const [searchParams] = useSearchParams();
  const canManage = role === 'RECEPTIONIST';
  const canArchive = role === 'DOCTOR';

  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedFilterPatient, setSelectedFilterPatient] = useState<PatientAutocompleteOption | null>(null);
  const [statusFilter, setStatusFilter] = useState<PatientStatusFilter>('active');
  const [form, setForm] = useState<PatientForm>(initialForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<PatientDetails | null>(null);
  const [patientPanelMode, setPatientPanelMode] = useState<PatientPanelMode>('details');
  const [historyDateRange, setHistoryDateRange] = useState<DateRangeValue>(() => getDateRangeForPreset('last30'));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dobAutoFilled, setDobAutoFilled] = useState(false);
  const [isRegistrationDrawerOpen, setIsRegistrationDrawerOpen] = useState(false);
  const [isRegistrationDrawerClosing, setIsRegistrationDrawerClosing] = useState(false);
  const [visitStartingId, setVisitStartingId] = useState<number | null>(null);
  const [openActionMenuId, setOpenActionMenuId] = useState<number | null>(null);
  const actionMenuRef = useRef<HTMLDivElement | null>(null);
  const routedPatientIdRef = useRef<number | null>(null);

  const icValidationMessage = useMemo(() => getIcValidationMessage(form.icOrPassport), [form.icOrPassport]);
  const dobValidationMessage = useMemo(() => getDobValidationMessage(form.dateOfBirth), [form.dateOfBirth]);
  const patientAge = useMemo(() => calculateAge(form.dateOfBirth), [form.dateOfBirth]);
  const selectedPatientAge = useMemo(
    () => calculateAge(selectedPatient?.dateOfBirth ? toDateInput(selectedPatient.dateOfBirth) : ''),
    [selectedPatient?.dateOfBirth],
  );
  const selectedPatientTimeline = useMemo(() => {
    if (!selectedPatient) return [];
    const from = historyDateRange.dateFrom ? new Date(`${historyDateRange.dateFrom}T00:00:00`).getTime() : null;
    const to = historyDateRange.dateTo ? new Date(`${historyDateRange.dateTo}T23:59:59`).getTime() : null;
    return buildPatientTimeline(selectedPatient).filter((item) => {
      const itemTime = new Date(item.date).getTime();
      if (from && itemTime < from) return false;
      if (to && itemTime > to) return false;
      return true;
    });
  }, [historyDateRange.dateFrom, historyDateRange.dateTo, selectedPatient]);

  const {
    page: listPage,
    setPage: setListPage,
    totalPages: listTotalPages,
    paginated: paginatedPatients,
  } = usePagination(patients, 10, [statusFilter, selectedFilterPatient?.patientId]);

  const loadPatients = useCallback(async (patientId?: number, status: PatientStatusFilter = statusFilter) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/patients', { params: { patientId, status } });
      setPatients(response.data as Patient[]);
    } catch (err: unknown) {
      const statusCode = getApiErrorStatus(err);
      if (statusCode === 400) {
        try {
          const fallbackResponse = await api.get('/patients', { params: { patientId } });
          setPatients(fallbackResponse.data as Patient[]);
          return;
        } catch (fallbackErr: unknown) {
          setError(getApiErrorMessage(fallbackErr, 'Failed to load patients'));
          return;
        }
      }
      setError(getApiErrorMessage(err, 'Failed to load patients'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const onCloseRegistrationDrawer = useCallback(() => {
    if (saving || isRegistrationDrawerClosing) return;
    setIsRegistrationDrawerClosing(true);
    window.setTimeout(() => {
      setIsRegistrationDrawerOpen(false);
      setIsRegistrationDrawerClosing(false);
      setEditingId(null);
      setForm(initialForm);
      setDobAutoFilled(false);
      setError(null);
    }, 220);
  }, [isRegistrationDrawerClosing, saving]);

  useEffect(() => {
    void loadPatients();
  }, [loadPatients]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void loadPatients(selectedFilterPatient?.patientId, statusFilter);
    });
  }, [loadPatients, selectedFilterPatient, statusFilter]);

  useEffect(() => {
    if (!isRegistrationDrawerOpen || isRegistrationDrawerClosing) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) {
        onCloseRegistrationDrawer();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isRegistrationDrawerOpen, isRegistrationDrawerClosing, onCloseRegistrationDrawer, saving]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!actionMenuRef.current) return;
      if (!actionMenuRef.current.contains(event.target as Node)) {
        setOpenActionMenuId(null);
      }
    };

    window.addEventListener('mousedown', onPointerDown);
    return () => window.removeEventListener('mousedown', onPointerDown);
  }, []);

  const loadPatientDetails = useCallback(async (patientId: number) => {
    setDetailsLoading(true);
    try {
      const response = await api.get(`/patients/${patientId}`);
      setSelectedPatient(response.data as PatientDetails);
      setHistoryDateRange(getDateRangeForPreset('last30'));
      setSelectedPatientId(patientId);
    } catch {
      setError('Failed to load patient details');
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  useEffect(() => {
    const raw = searchParams.get('patientId');
    if (!raw) return;

    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0) return;
    if (routedPatientIdRef.current === parsed) return;

    routedPatientIdRef.current = parsed;
    setPatientPanelMode('details');
    setSelectedFilterPatient(null);
    setStatusFilter('all');
    void loadPatients(parsed, 'all');
    void loadPatientDetails(parsed);
  }, [loadPatientDetails, loadPatients, searchParams]);

  const visitedStats = useMemo(() => {
    const visitedCount = patients.filter((p) => (
      (p._count?.payments ?? 0) +
      (p._count?.prescriptions ?? 0) +
      (p._count?.consultations ?? 0) +
      (p._count?.medicalCertificates ?? 0)
    ) > 0).length;
    return {
      total: patients.length,
      visitedCount,
      neverVisited: patients.length - visitedCount,
    };
  }, [patients]);

  const getRelatedRecordCount = (patient: Patient) => {
    return (
      (patient._count?.appointments ?? 0) +
      (patient._count?.payments ?? 0) +
      (patient._count?.prescriptions ?? 0) +
      (patient._count?.consultations ?? 0) +
      (patient._count?.medicalCertificates ?? 0)
    );
  };

  const validateForm = () => {
    if (!form.name.trim() || form.name.trim().length < 2) return 'Name must be at least 2 characters.';
    if (!form.icOrPassport.trim() || form.icOrPassport.trim().length < 4) return 'IC/ID must be at least 4 characters.';
    if (!/^[0-9+\-()\s]{7,20}$/.test(form.phone.trim())) return 'Phone number format is invalid.';
    if (!form.address.trim() || form.address.trim().length < 5) return 'Address must be at least 5 characters.';
    if (!form.dateOfBirth) return 'Date of birth is required.';
    if (dobValidationMessage) return dobValidationMessage;
    return null;
  };

  const updateIcOrPassport = (value: string) => {
    const extractedDob = extractDobFromMalaysianIc(value);
    setForm((prev) => ({
      ...prev,
      icOrPassport: value,
      dateOfBirth: extractedDob ?? prev.dateOfBirth,
    }));
    setDobAutoFilled(Boolean(extractedDob));
  };

  const updateDateOfBirth = (value: string) => {
    setForm((prev) => ({ ...prev, dateOfBirth: value }));
    setDobAutoFilled(false);
  };

  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    await loadPatients(selectedFilterPatient?.patientId, statusFilter);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canManage) return;

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      setSuccess(null);
      return;
    }

    setError(null);
    setSuccess(null);
    setSaving(true);

    const payload = {
      ...form,
      name: form.name.trim(),
      icOrPassport: form.icOrPassport.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
    };

    try {
      if (editingId) {
        await api.put(`/patients/${editingId}`, payload);
        setSuccess('Patient details updated successfully.');
      } else {
        await api.post('/patients', payload);
        setSuccess('Patient registered successfully.');
      }
      setForm(initialForm);
      setDobAutoFilled(false);
      setEditingId(null);
      setIsRegistrationDrawerOpen(false);
      setIsRegistrationDrawerClosing(false);
      await loadPatients(selectedFilterPatient?.patientId, statusFilter);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to save patient'));
    } finally {
      setSaving(false);
    }
  };

  const onEdit = (patient: Patient) => {
    if (!canManage) return;
    setEditingId(patient.patientId);
    setSuccess(null);
    setForm({
      name: patient.name,
      icOrPassport: patient.icOrPassport,
      phone: patient.phone,
      address: patient.address ?? '',
      gender: patient.gender ?? 'OTHER',
      dateOfBirth: patient.dateOfBirth ? toDateInput(patient.dateOfBirth) : '',
    });
    setDobAutoFilled(false);
    setIsRegistrationDrawerClosing(false);
    setIsRegistrationDrawerOpen(true);
  };

  const onCancelEdit = () => {
    onCloseRegistrationDrawer();
  };

  const onOpenRegistrationDrawer = () => {
    setEditingId(null);
    setForm(initialForm);
    setDobAutoFilled(false);
    setError(null);
    setSuccess(null);
    setIsRegistrationDrawerClosing(false);
    setIsRegistrationDrawerOpen(true);
  };

  const onSelectPatient = async (patient: Patient) => {
    setPatientPanelMode('details');
    if (canManage) {
      onEdit(patient);
    }
    await loadPatientDetails(patient.patientId);
  };

  const onViewDetails = async (patient: Patient) => {
    setPatientPanelMode('details');
    await loadPatientDetails(patient.patientId);
  };

  const onViewHistory = async (patient: Patient) => {
    setPatientPanelMode('history');
    await loadPatientDetails(patient.patientId);
  };

  const onClosePatientPanel = () => {
    setSelectedPatient(null);
    setSelectedPatientId(null);
    setPatientPanelMode('details');
  };

  const onToggleActionMenu = (patientId: number) => {
    setOpenActionMenuId((current) => (current === patientId ? null : patientId));
  };

  const onStartVisit = async (patient: Patient) => {
    if (!canManage || !patient.isActive) return;

    setVisitStartingId(patient.patientId);
    setError(null);
    setSuccess(null);

    try {
      await api.post('/consultations', { patientId: patient.patientId });
      setSuccess(`${patient.name} has been added to the consultation queue.`);
      await loadPatients(selectedFilterPatient?.patientId, statusFilter);
      if (selectedPatientId === patient.patientId) {
        await loadPatientDetails(patient.patientId);
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to start visit.'));
    } finally {
      setVisitStartingId(null);
    }
  };

  const onArchivePatient = async (patient: Patient) => {
    if (!canArchive || !patient.isActive) return;
    const confirmed = window.confirm('Are you sure you want to archive this patient?');
    if (!confirmed) return;

    setError(null);
    setSuccess(null);

    try {
      const response = await api.put(`/patients/${patient.patientId}/archive`);
      const data = response.data as { message?: string };
      setSuccess(data.message || 'Patient archived successfully.');
      if (selectedPatientId === patient.patientId) {
        await loadPatientDetails(patient.patientId);
      }
      if (selectedFilterPatient?.patientId === patient.patientId) {
        setSelectedFilterPatient(null);
      }
      await loadPatients(undefined, statusFilter);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to archive patient'));
    }
  };

  const onRestorePatient = async (patient: Patient) => {
    if (!canArchive || patient.isActive) return;
    const confirmed = window.confirm(`Restore patient "${patient.name}"?`);
    if (!confirmed) return;

    setError(null);
    setSuccess(null);

    try {
      const response = await api.put(`/patients/${patient.patientId}/restore`);
      const data = response.data as { message?: string };
      setSuccess(data.message || 'Patient restored successfully.');
      if (selectedPatientId === patient.patientId) {
        await loadPatientDetails(patient.patientId);
      }
      await loadPatients(selectedFilterPatient?.patientId, statusFilter);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to restore patient'));
    }
  };

  return (
    <section className="patients-page">
      <PageHeader
        eyebrow="Patient Records"
        title="Manage Patient"
        subtitle={
          canManage
            ? 'Receptionist can register, validate, search, and update patient records.'
            : 'View and search patient records by IC/ID or phone. Registration is receptionist-only.'
        }
        actions={canManage ? (
          <button type="button" className="btn btn-primary patient-register-button" onClick={onOpenRegistrationDrawer}>
            + Register Patient
          </button>
        ) : undefined}
      />

      <div className="stats-row patient-summary-row">
        <div className="stat-chip patient-stat-chip"><span>Total</span><strong>{visitedStats.total}</strong></div>
        <div className="stat-chip patient-stat-chip"><span>Visited</span><strong>{visitedStats.visitedCount}</strong></div>
        <div className="stat-chip patient-stat-chip warning"><span>Not visited</span><strong>{visitedStats.neverVisited}</strong></div>
      </div>

      <div className="patient-toolbar filter-card">
        <form onSubmit={onSearch} className="patient-search-form">
          <div className="patient-search-field">
            <PatientAutocomplete
              selectedPatient={selectedFilterPatient}
              onSelect={(patient) => {
                setSelectedFilterPatient(patient);
                setSelectedPatient(null);
                setSelectedPatientId(null);
                setPatientPanelMode('details');
                void loadPatients(patient?.patientId, statusFilter);
                if (patient) {
                  void loadPatientDetails(patient.patientId);
                }
              }}
              status={statusFilter}
              placeholder="Search patient by name / IC / phone"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => {
              const nextStatus = e.target.value as PatientStatusFilter;
              setStatusFilter(nextStatus);
              setSelectedFilterPatient(null);
              setSelectedPatient(null);
              setSelectedPatientId(null);
              setPatientPanelMode('details');
              void loadPatients(undefined, nextStatus);
            }}
            aria-label="Patient status filter"
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
          <button type="submit" className="btn btn-secondary patient-compact-button">Search</button>
        </form>
      </div>

      {!isRegistrationDrawerOpen && error && <p className="error">{error}</p>}
      {success && <p className="muted" style={{ color: 'var(--primary)' }}>{success}</p>}
      {loading && <p className="muted">Loading...</p>}

      <div className="table-wrap table-card patient-table-wrap">
        <table className="data-table patient-table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Phone</th>
              <th>Queue Status</th>
              <th>Last Visit</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {paginatedPatients.map((patient) => {
              const workflowStatus = getPatientWorkflowStatus(patient);
              const latestConsultation = getLatestConsultation(patient);
              return (
              <tr key={patient.patientId}>
                <td>
                  <div className="patient-list-identity">
                    <span className="patient-list-avatar">{getPatientInitials(patient.name)}</span>
                    <div>
                      <strong>{patient.name}</strong>
                      <small>{formatPatientId(patient.patientId)} - {patient.icOrPassport}</small>
                    </div>
                  </div>
                </td>
                <td>{patient.phone}</td>
                <td>
                  <span className={`status-badge ${workflowStatus.badgeClass}`}>
                    {workflowStatus.label}
                  </span>
                </td>
                <td>{latestConsultation ? new Date(latestConsultation.createdAt).toLocaleString() : '-'}</td>
                <td>
                  <div className="action-row patient-row-actions" ref={openActionMenuId === patient.patientId ? actionMenuRef : null}>
                    <button
                      type="button"
                      className="btn-secondary patient-action-menu-trigger"
                      aria-label="Open patient actions"
                      aria-expanded={openActionMenuId === patient.patientId}
                      onClick={() => onToggleActionMenu(patient.patientId)}
                    >
                      ⋮
                    </button>

                    {openActionMenuId === patient.patientId && (
                      <div className="patient-action-menu" role="menu">
                        {canManage && (
                          <button
                            type="button"
                            className="patient-action-menu-item"
                            disabled={!patient.isActive || workflowStatus.isBlocked || visitStartingId === patient.patientId}
                            onClick={() => {
                              setOpenActionMenuId(null);
                              void onStartVisit(patient);
                            }}
                          >
                            {visitStartingId === patient.patientId ? 'Starting...' : 'Start Visit'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="patient-action-menu-item"
                          onClick={() => {
                            setOpenActionMenuId(null);
                            void onViewDetails(patient);
                          }}
                        >
                          View Details
                        </button>
                        {canManage && (
                          <button
                            type="button"
                            className="patient-action-menu-item"
                            onClick={() => {
                              setOpenActionMenuId(null);
                              void onSelectPatient(patient);
                            }}
                          >
                            Edit Patient
                          </button>
                        )}
                        <button
                          type="button"
                          className="patient-action-menu-item"
                          onClick={() => {
                            setOpenActionMenuId(null);
                            void onViewHistory(patient);
                          }}
                        >
                          History
                        </button>
                        {canArchive && patient.isActive && (
                          <button
                            type="button"
                            className="patient-action-menu-item"
                            onClick={() => {
                              setOpenActionMenuId(null);
                              void onArchivePatient(patient);
                            }}
                          >
                            Archive
                          </button>
                        )}
                        {canArchive && !patient.isActive && (
                          <button
                            type="button"
                            className="patient-action-menu-item"
                            onClick={() => {
                              setOpenActionMenuId(null);
                              void onRestorePatient(patient);
                            }}
                          >
                            Restore
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={listPage} totalPages={listTotalPages} onPageChange={setListPage} />

      <div className="mobile-cards">
        {paginatedPatients.map((patient) => {
          const workflowStatus = getPatientWorkflowStatus(patient);
          const latestConsultation = getLatestConsultation(patient);
          return (
          <article key={patient.patientId} className="mobile-card patient-mobile-card">
            <div className="patient-list-identity">
              <span className="patient-list-avatar">{getPatientInitials(patient.name)}</span>
              <div>
                <h4>{patient.name}</h4>
                <small>{formatPatientId(patient.patientId)}</small>
              </div>
            </div>
            <dl className="kv">
              <div>
                <dt>IC/ID</dt>
                <dd>{patient.icOrPassport}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{patient.phone}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>
                  <span className={`status-badge ${patient.isActive ? 'status-good' : 'status-archived'}`}>
                    {patient.isActive ? 'Active' : 'Archived'}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Visited</dt>
                <dd>
                  <span className={`status-badge ${getRelatedRecordCount(patient) > 0 ? 'status-good' : 'status-neutral'}`}>
                    {getRelatedRecordCount(patient) > 0 ? 'Visited' : 'No visits'}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Queue</dt>
                <dd>
                  <span className={`status-badge ${workflowStatus.badgeClass}`}>
                    {workflowStatus.label}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Last Visit</dt>
                <dd>{latestConsultation ? new Date(latestConsultation.createdAt).toLocaleString() : '-'}</dd>
              </div>
            </dl>
            <div className="action-row patient-row-actions">
              {canManage ? (
                <>
                  <button type="button" className="btn-secondary patient-compact-button" onClick={() => void onSelectPatient(patient)}>
                    Manage
                  </button>
                  <button type="button" className="btn-secondary patient-compact-button" onClick={() => void onViewDetails(patient)}>
                    View Details
                  </button>
                  <button
                    type="button"
                    className="patient-compact-button"
                    onClick={() => void onStartVisit(patient)}
                    disabled={!patient.isActive || workflowStatus.isBlocked || visitStartingId === patient.patientId}
                  >
                    {visitStartingId === patient.patientId ? 'Starting...' : 'Start Visit'}
                  </button>
                </>
              ) : (
                <button type="button" className="btn-secondary patient-compact-button" onClick={() => void onViewDetails(patient)}>
                  View Details
                </button>
              )}
              {canArchive && patient.isActive && (
                <button type="button" className="btn-warning patient-compact-button" onClick={() => void onArchivePatient(patient)}>
                  Archive
                </button>
              )}
              {canArchive && !patient.isActive && (
                <button type="button" className="patient-compact-button" onClick={() => void onRestorePatient(patient)}>
                  Restore
                </button>
              )}
            </div>
          </article>
          );
        })}
      </div>

      {detailsLoading && <p className="muted">Loading patient details...</p>}

      {selectedPatient && selectedPatientId && (
        <section className="patient-details-shell">
          <div className="patient-panel-toolbar">
            <div>
              <h3>{patientPanelMode === 'history' ? 'Patient History' : 'Patient Details'}</h3>
              <p className="muted">{selectedPatient.name} - {formatPatientId(selectedPatient.patientId)}</p>
            </div>
            <button type="button" className="btn-secondary patient-panel-close" onClick={onClosePatientPanel}>
              Close
            </button>
          </div>

          {patientPanelMode === 'details' && (
          <article className="patient-info-card">
            <div className="patient-card-head">
              <div>
                <h3>Patient Information</h3>
                <p className="muted">Core demographic and contact details.</p>
              </div>
            </div>

            <div className="patient-info-grid">
              <div className="patient-info-item">
                <span>Full Name</span>
                <strong>{selectedPatient.name}</strong>
              </div>
              <div className="patient-info-item">
                <span>IC / ID</span>
                <strong>{selectedPatient.icOrPassport}</strong>
              </div>
              <div className="patient-info-item">
                <span>Phone</span>
                <strong>{selectedPatient.phone}</strong>
              </div>
              <div className="patient-info-item">
                <span>Gender</span>
                <strong>{selectedPatient.gender ? prettifyGender(selectedPatient.gender) : '-'}</strong>
              </div>
              <div className="patient-info-item">
                <span>Date of Birth</span>
                <strong>{formatLongDate(selectedPatient.dateOfBirth)}</strong>
              </div>
              <div className="patient-info-item">
                <span>Age</span>
                <strong>{selectedPatientAge !== null ? `${selectedPatientAge} years old` : '-'}</strong>
              </div>
              <div className="patient-info-item patient-info-address">
                <span>Address</span>
                <strong>{selectedPatient.address || '-'}</strong>
              </div>
            </div>

            {!selectedPatient.isActive && (
              <div className="patient-archive-note">
                Archived: {selectedPatient.archivedAt ? new Date(selectedPatient.archivedAt).toLocaleString() : '-'}
                {selectedPatient.archivedBy ? ` by ${selectedPatient.archivedBy}` : ''}
              </div>
            )}
          </article>
          )}

          {patientPanelMode === 'history' && (
          <article className="patient-info-card">
            <div className="patient-card-head">
              <div>
                <h3>Medical History</h3>
                <p className="muted">Consultations, prescriptions, and payment activity.</p>
              </div>
            </div>

            <div className="stats-row patient-history-stats">
              <div className="stat-chip patient-stat-chip"><span>History Items</span><strong>{selectedPatientTimeline.length}</strong></div>
              <div className="stat-chip patient-stat-chip"><span>Appointments</span><strong>{selectedPatientTimeline.filter((item) => item.key.startsWith('a-')).length}</strong></div>
              <div className="stat-chip patient-stat-chip"><span>Prescriptions</span><strong>{selectedPatientTimeline.filter((item) => item.key.startsWith('p-')).length}</strong></div>
              <div className="stat-chip patient-stat-chip"><span>MCs</span><strong>{selectedPatientTimeline.filter((item) => item.key.startsWith('mc-')).length}</strong></div>
              <div className="stat-chip patient-stat-chip"><span>Consultations</span><strong>{selectedPatientTimeline.filter((item) => item.key.startsWith('c-')).length}</strong></div>
              <div className="stat-chip patient-stat-chip"><span>Payments</span><strong>{selectedPatientTimeline.filter((item) => item.key.startsWith('pay-')).length}</strong></div>
            </div>

            <div className="filters-grid" style={{ marginTop: 12 }}>
              <DateRangeFilter value={historyDateRange} onChange={setHistoryDateRange} includeAll />
              <button type="button" className="btn-secondary" onClick={() => setHistoryDateRange(getDateRangeForPreset('last30'))}>
                Reset Filters
              </button>
            </div>

            <div className="table-wrap patient-table-wrap">
              <table className="data-table patient-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Date</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {selectedPatientTimeline.map((item) => (
                  <tr key={item.key}>
                    <td>{item.badge}</td>
                    <td>{new Date(item.date).toLocaleString()}</td>
                    <td>{item.detail || '-'}</td>
                  </tr>
                ))}
                {selectedPatientTimeline.length === 0 && (
                  <tr>
                    <td colSpan={3}>No visit history yet.</td>
                  </tr>
                )}
              </tbody>
              </table>
            </div>
          </article>
          )}
        </section>
      )}

      {!loading && patients.length === 0 && selectedFilterPatient && (
        <p className="muted">No record found</p>
      )}

      {canManage && isRegistrationDrawerOpen && (
        <div className={`patient-drawer-layer ${isRegistrationDrawerClosing ? 'is-closing' : ''}`} role="presentation">
          <button
            type="button"
            className="patient-drawer-backdrop"
            aria-label="Close patient registration drawer"
            onClick={onCloseRegistrationDrawer}
          />
          <aside className="patient-drawer" role="dialog" aria-modal="true" aria-labelledby="patient-drawer-title">
            <div className="patient-drawer-head">
              <div>
                <h3 id="patient-drawer-title">{editingId ? 'Manage Patient' : 'Register Patient'}</h3>
                <p className="muted">
                  {editingId ? 'Update demographic and contact details.' : 'Create a new patient record for clinic workflows.'}
                </p>
              </div>
              <button
                type="button"
                className="patient-drawer-close"
                aria-label="Close drawer"
                onClick={onCloseRegistrationDrawer}
                disabled={saving}
              >
                X
              </button>
            </div>

            <form onSubmit={onSubmit} className="patient-registration-form patient-drawer-form">
              <div className="patient-drawer-body">
                {error && <p className="error patient-drawer-alert">{error}</p>}
                {success && <p className="muted patient-drawer-alert" style={{ color: 'var(--primary)' }}>{success}</p>}

                <div className="patient-form-grid">
                  <label className="field-block">
                    <span>Patient Name</span>
                    <input
                      value={form.name}
                      onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g. Nur Aina Binti Ahmad"
                      required
                    />
                  </label>

                  <label className="field-block">
                    <span>IC Number / ID</span>
                    <input
                      className={icValidationMessage ? 'field-invalid' : undefined}
                      value={form.icOrPassport}
                      onChange={(e) => updateIcOrPassport(e.target.value)}
                      placeholder="010902-03-0325 or passport"
                      inputMode="text"
                      required
                    />
                    <span className={icValidationMessage ? 'field-helper' : 'field-hint'}>
                      {icValidationMessage ?? 'Valid Malaysian IC auto-fills DOB. Passport/foreign ID can be entered manually.'}
                    </span>
                  </label>

                  <label className="field-block">
                    <span>Phone</span>
                    <input
                      value={form.phone}
                      onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                      placeholder="e.g. 012-345 6789"
                      required
                    />
                  </label>

                  <label className={`field-block dob-field ${dobAutoFilled ? 'dob-autofilled' : ''}`}>
                    <span>Date of Birth</span>
                    <input
                      className={dobValidationMessage ? 'field-invalid' : undefined}
                      type="date"
                      value={form.dateOfBirth}
                      max={todayInputValue()}
                      onChange={(e) => updateDateOfBirth(e.target.value)}
                      required
                    />
                    <span className={dobValidationMessage ? 'field-helper' : 'field-hint'}>
                      {dobValidationMessage ??
                        (dobAutoFilled && form.dateOfBirth
                          ? `Auto-filled from IC: ${formatDisplayDate(form.dateOfBirth)}`
                          : 'Editable for foreign patients, corrections, and demo records.')}
                    </span>
                  </label>

                  <label className="field-block">
                    <span>Gender</span>
                    <select
                      value={form.gender}
                      onChange={(e) => setForm((prev) => ({ ...prev, gender: e.target.value as Gender }))}
                      required
                    >
                      <option value="MALE">Male</option>
                      <option value="FEMALE">Female</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </label>

                  <div className="field-block">
                    <span>Age</span>
                    <output className="age-output" aria-live="polite">
                      {patientAge !== null ? `${patientAge} years old` : 'Enter DOB'}
                    </output>
                    <span className="field-hint">Updates automatically from DOB.</span>
                  </div>

                  <label className="field-block patient-address-field">
                    <span>Address</span>
                    <textarea
                      value={form.address}
                      onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
                      placeholder="Full residential address"
                      rows={3}
                      required
                    />
                  </label>
                </div>
              </div>

              <div className="patient-drawer-footer">
                <button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : editingId ? 'Update Patient' : 'Save / Register'}
                </button>
                <button className="btn-secondary" type="button" onClick={editingId ? onCancelEdit : onCloseRegistrationDrawer} disabled={saving}>
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
