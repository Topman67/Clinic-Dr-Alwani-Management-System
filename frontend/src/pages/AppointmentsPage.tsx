import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { subscribeInAppDataSync } from '../lib/sync';
import { PatientAutocomplete, type PatientAutocompleteOption } from '../components/PatientAutocomplete';
import { DateRangeFilter, getDateRangeForPreset, type DateRangeValue } from '../components/DateRangeFilter';

type AppointmentStatus = 'PENDING' | 'ARRIVED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
type AppointmentType = 'NEW' | 'FOLLOW_UP';
type Gender = 'MALE' | 'FEMALE' | 'OTHER';

type Appointment = {
  appointmentId: number;
  patientId: number;
  doctorId: number;
  dateTime: string;
  status: AppointmentStatus;
  type: AppointmentType;
  notes?: string | null;
  previousPrescriptionId?: number | null;
  followUpFromConsultationId?: number | null;
  followUpFromConsultation?: {
    consultationId: number;
    createdAt: string;
    diagnosis?: string | null;
  } | null;
  patient: {
    patientId: number;
    name: string;
    icOrPassport: string;
    phone: string;
  };
};

type Patient = {
  patientId: number;
  name: string;
  icOrPassport: string;
  phone: string;
};

type NewPatientForm = {
  name: string;
  icOrPassport: string;
  phone: string;
  address: string;
  gender: Gender;
  dateOfBirth: string;
};

type AppointmentFilters = {
  dateRange: DateRangeValue;
  statusFilter: string;
  typeFilter: string;
  patientFilter: PatientAutocompleteOption | null;
};

const appointmentTypeLabel = (type: AppointmentType) => {
  if (type === 'FOLLOW_UP') return 'Follow-up';
  return 'First Visit';
};

const appointmentLinkedRecordLabel = (appointment: Appointment) => {
  if (appointment.followUpFromConsultation?.consultationId) {
    return `Consultation #${appointment.followUpFromConsultation.consultationId}`;
  }
  if (appointment.previousPrescriptionId) {
    return `Prescription #${appointment.previousPrescriptionId}`;
  }
  return '-';
};

const initialNewPatientForm: NewPatientForm = {
  name: '',
  icOrPassport: '',
  phone: '',
  address: '',
  gender: 'MALE',
  dateOfBirth: '',
};

const toDateInput = (value: Date) => value.toISOString().slice(0, 10);

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

const getDobValidationMessage = (value: string) => {
  if (!value) return null;
  const dob = parseDateInput(value);
  if (!dob) return 'Date of birth is invalid.';
  if (dob.getTime() > Date.now()) return 'Date of birth cannot be in the future.';
  return null;
};

const toDateTimeLocalInput = (value: Date) => {
  const adjusted = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 16);
};

const formatDateTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString();
};

const statusLabel = (status: AppointmentStatus) => status.replace('_', ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

const statusClass = (status: AppointmentStatus) => {
  if (status === 'PENDING') return 'status-warning';
  if (status === 'ARRIVED') return 'type-consultation';
  if (status === 'COMPLETED') return 'status-good';
  if (status === 'CANCELLED' || status === 'NO_SHOW') return 'status-archived';
  return 'status-neutral';
};

const getApiErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'object' && error !== null) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    const message = response?.data?.message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return fallback;
};

const isAppointmentPatientEligible = (patient: PatientAutocompleteOption) => {
  if (patient.isActive === false) return false;
  const consultations = patient.consultations ?? [];
  const hasActiveConsultation = consultations.some((consultation) => {
    const status = consultation.status;
    return status === 'WAITING' || status === 'IN_PROGRESS';
  });
  const hasActiveAppointment = (patient.appointments ?? []).some((appointment) => {
    const status = appointment.status;
    return status === 'PENDING' || status === 'ARRIVED';
  });
  return !hasActiveConsultation && !hasActiveAppointment;
};

export const AppointmentsPage = () => {
  const { role } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  const isReceptionist = role === 'RECEPTIONIST';
  const isDoctor = role === 'DOCTOR';

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [dateRange, setDateRange] = useState<DateRangeValue>(() => {
    const routedDate = searchParams.get('date');
    return routedDate ? { preset: 'custom', dateFrom: routedDate, dateTo: routedDate } : getDateRangeForPreset('today');
  });
  const [statusFilter, setStatusFilter] = useState(() => searchParams.get('status') ?? '');
  const [typeFilter, setTypeFilter] = useState(() => searchParams.get('type') ?? '');
  const [selectedPatientFilter, setSelectedPatientFilter] = useState<PatientAutocompleteOption | null>(null);
  const [selectedBookingPatient, setSelectedBookingPatient] = useState<PatientAutocompleteOption | null>(null);
  const [appointmentDateTime, setAppointmentDateTime] = useState(() => toDateTimeLocalInput(new Date(Date.now() + 30 * 60000)));
  const [appointmentNotes, setAppointmentNotes] = useState('');
  const [newPatientForm, setNewPatientForm] = useState<NewPatientForm>(initialNewPatientForm);
  const [newPatientDobAutoFilled, setNewPatientDobAutoFilled] = useState(false);
  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false);
  const [isPatientDrawerOpen, setIsPatientDrawerOpen] = useState(false);
  const [openActionMenuId, setOpenActionMenuId] = useState<number | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);
  const [rescheduleDateTime, setRescheduleDateTime] = useState('');
  const [rescheduleNotes, setRescheduleNotes] = useState('');

  const [followUpDateTime, setFollowUpDateTime] = useState(() => toDateTimeLocalInput(new Date(Date.now() + 24 * 60 * 60000)));
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [followUpPrescriptionId, setFollowUpPrescriptionId] = useState('');
  const [followUpSourceAppointment, setFollowUpSourceAppointment] = useState<Appointment | null>(null);

  const newPatientIcValidationMessage = useMemo(() => getIcValidationMessage(newPatientForm.icOrPassport), [newPatientForm.icOrPassport]);
  const newPatientDobValidationMessage = useMemo(() => getDobValidationMessage(newPatientForm.dateOfBirth), [newPatientForm.dateOfBirth]);
  const newPatientAge = useMemo(() => calculateAge(newPatientForm.dateOfBirth), [newPatientForm.dateOfBirth]);

  const loadAppointments = useCallback(async (overrides: Partial<AppointmentFilters> = {}) => {
    const nextDateRange = overrides.dateRange ?? dateRange;
    const nextStatusFilter = overrides.statusFilter ?? statusFilter;
    const nextTypeFilter = overrides.typeFilter ?? typeFilter;
    const nextPatientFilter = Object.prototype.hasOwnProperty.call(overrides, 'patientFilter')
      ? overrides.patientFilter
      : selectedPatientFilter;

    setLoading(true);
    setError(null);

    try {
      const response = await api.get('/appointments', {
        params: {
          dateFrom: nextDateRange.dateFrom || undefined,
          dateTo: nextDateRange.dateTo || undefined,
          status: nextStatusFilter || undefined,
          type: nextTypeFilter || undefined,
          patientId: nextPatientFilter?.patientId,
        },
      });
      setAppointments(response.data as Appointment[]);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load appointments'));
    } finally {
      setLoading(false);
    }
  }, [dateRange, selectedPatientFilter, statusFilter, typeFilter]);

  useEffect(() => {
    void loadAppointments();
  }, [loadAppointments]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void loadAppointments();
    });
  }, [loadAppointments]);

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

  const stats = useMemo(() => ({
    total: appointments.length,
    pending: appointments.filter((a) => a.status === 'PENDING').length,
    arrived: appointments.filter((a) => a.status === 'ARRIVED').length,
    completed: appointments.filter((a) => a.status === 'COMPLETED').length,
  }), [appointments]);

  const visibleAppointments = useMemo(() => {
    if (!isDoctor) return appointments;
    return appointments.filter((a) => a.status === 'ARRIVED' || a.status === 'PENDING' || a.status === 'COMPLETED');
  }, [appointments, isDoctor]);

  const resetAppointmentForm = () => {
    setSelectedBookingPatient(null);
    setAppointmentDateTime(toDateTimeLocalInput(new Date(Date.now() + 30 * 60000)));
    setAppointmentNotes('');
  };

  const validateNewPatientForm = () => {
    if (!newPatientForm.name.trim() || newPatientForm.name.trim().length < 2) return 'Name must be at least 2 characters.';
    if (!newPatientForm.icOrPassport.trim() || newPatientForm.icOrPassport.trim().length < 4) return 'IC/ID must be at least 4 characters.';
    if (!/^[0-9+\-()\s]{7,20}$/.test(newPatientForm.phone.trim())) return 'Phone number format is invalid.';
    if (!newPatientForm.address.trim() || newPatientForm.address.trim().length < 5) return 'Address must be at least 5 characters.';
    if (!newPatientForm.dateOfBirth) return 'Date of birth is required.';
    if (newPatientDobValidationMessage) return newPatientDobValidationMessage;
    return null;
  };

  const updateNewPatientIcOrPassport = (value: string) => {
    const extractedDob = extractDobFromMalaysianIc(value);
    setNewPatientForm((prev) => ({
      ...prev,
      icOrPassport: value,
      dateOfBirth: extractedDob ?? prev.dateOfBirth,
    }));
    setNewPatientDobAutoFilled(Boolean(extractedDob));
  };

  const updateNewPatientDateOfBirth = (value: string) => {
    setNewPatientForm((prev) => ({ ...prev, dateOfBirth: value }));
    setNewPatientDobAutoFilled(false);
  };

  const onCreatePatient = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const validationError = validateNewPatientForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      const response = await api.post('/patients', {
        ...newPatientForm,
        name: newPatientForm.name.trim(),
        icOrPassport: newPatientForm.icOrPassport.trim(),
        phone: newPatientForm.phone.trim(),
        address: newPatientForm.address.trim(),
      });
      const created = response.data as Patient;
      setSelectedBookingPatient(created);
      setIsPatientDrawerOpen(false);
      setSuccess('New patient registered and selected for appointment.');
      setNewPatientForm(initialNewPatientForm);
      setNewPatientDobAutoFilled(false);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to register patient'));
    } finally {
      setSaving(false);
    }
  };

  const onCreateAppointment = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!selectedBookingPatient?.patientId) {
      setError('Please select a patient first.');
      return;
    }

    if (!isAppointmentPatientEligible(selectedBookingPatient)) {
      setError('Patient currently has an active visit/consultation and cannot be booked for appointment.');
      return;
    }

    setSaving(true);
    try {
      const createdDate = toDateInput(new Date(appointmentDateTime));
      await api.post('/appointments', {
        patientId: selectedBookingPatient.patientId,
        dateTime: new Date(appointmentDateTime).toISOString(),
        notes: appointmentNotes.trim() || undefined,
      });
      setSuccess('Appointment created successfully.');
      const createdDateRange: DateRangeValue = { preset: 'custom', dateFrom: createdDate, dateTo: createdDate };
      setDateRange(createdDateRange);
      setStatusFilter('');
      setTypeFilter('');
      setSelectedPatientFilter(null);
      resetAppointmentForm();
      setIsCreateDrawerOpen(false);
      await loadAppointments({ dateRange: createdDateRange, statusFilter: '', typeFilter: '', patientFilter: null });
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to create appointment'));
    } finally {
      setSaving(false);
    }
  };

  const onStatusChange = async (appointmentId: number, status: AppointmentStatus) => {
    setError(null);
    setSuccess(null);
    setOpenActionMenuId(null);
    try {
      await api.patch(`/appointments/${appointmentId}/status`, { status });
      setSuccess('Appointment status updated.');
      await loadAppointments();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to update status'));
    }
  };

  const onStartConsultation = async (appointmentId: number) => {
    setError(null);
    setSuccess(null);
    setOpenActionMenuId(null);
    try {
      const response = await api.post(`/appointments/${appointmentId}/start-consultation`);
      const payload = response.data as { openConsultationWith?: { patientId: number; appointmentId: number; consultationId: number } };
      const info = payload.openConsultationWith;
      if (!info) {
        setError('Unable to start consultation for this appointment.');
        return;
      }
      navigate(`/doctor/consultations?consultationId=${info.consultationId}`);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to start consultation'));
    }
  };

  const onCreateFollowUp = async (e: FormEvent) => {
    e.preventDefault();
    if (!followUpSourceAppointment) return;

    setError(null);
    setSuccess(null);
    setSaving(true);

    const normalizedPrescriptionId = followUpPrescriptionId.trim();

    try {
      await api.post(`/appointments/${followUpSourceAppointment.appointmentId}/follow-up`, {
        dateTime: new Date(followUpDateTime).toISOString(),
        notes: followUpNotes.trim() || undefined,
        previousPrescriptionId: normalizedPrescriptionId ? Number(normalizedPrescriptionId) : undefined,
      });
      const followUpDate = toDateInput(new Date(followUpDateTime));
      const followUpDateRange: DateRangeValue = { preset: 'custom', dateFrom: followUpDate, dateTo: followUpDate };
      setSuccess('Follow-up appointment created successfully.');
      setDateRange(followUpDateRange);
      setStatusFilter('');
      setTypeFilter('');
      setSelectedPatientFilter(null);
      setFollowUpSourceAppointment(null);
      setFollowUpDateTime(toDateTimeLocalInput(new Date(Date.now() + 24 * 60 * 60000)));
      setFollowUpNotes('');
      setFollowUpPrescriptionId('');
      await loadAppointments({ dateRange: followUpDateRange, statusFilter: '', typeFilter: '', patientFilter: null });
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to create follow-up appointment'));
    } finally {
      setSaving(false);
    }
  };

  const openRescheduleDialog = (appointment: Appointment) => {
    setOpenActionMenuId(null);
    setRescheduleTarget(appointment);
    setRescheduleDateTime(toDateTimeLocalInput(new Date(appointment.dateTime)));
    setRescheduleNotes(appointment.notes ?? '');
  };

  const openFollowUpDrawer = (appointment: Appointment) => {
    setOpenActionMenuId(null);
    setFollowUpSourceAppointment(appointment);
    setFollowUpDateTime(toDateTimeLocalInput(new Date(Date.now() + 24 * 60 * 60000)));
    setFollowUpNotes('');
    setFollowUpPrescriptionId('');
  };

  const onRescheduleAppointment = async (e: FormEvent) => {
    e.preventDefault();
    if (!rescheduleTarget) return;

    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      await api.patch(`/appointments/${rescheduleTarget.appointmentId}/reschedule`, {
        dateTime: new Date(rescheduleDateTime).toISOString(),
        notes: rescheduleNotes.trim() || undefined,
      });
      const nextDate = toDateInput(new Date(rescheduleDateTime));
      const nextDateRange: DateRangeValue = { preset: 'custom', dateFrom: nextDate, dateTo: nextDate };
      setSuccess('Appointment rescheduled successfully.');
      setDateRange(nextDateRange);
      setRescheduleTarget(null);
      await loadAppointments({ dateRange: nextDateRange });
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to reschedule appointment'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="appointments-page">
      <div className="section-head appointment-page-head">
        <div>
          <h1>Appointments</h1>
          <p className="muted">
            {isReceptionist
              ? 'Create and manage doctor appointments for eligible patients.'
              : 'Review appointment queue, start consultation, and create follow-up appointments.'}
          </p>
        </div>
        {isReceptionist && (
          <button type="button" className="appointment-create-button" onClick={() => setIsCreateDrawerOpen(true)}>
            + Create Appointment
          </button>
        )}
      </div>

      <div className="stats-row appointment-summary-row">
        <div className="stat-chip patient-stat-chip"><span>Total</span><strong>{stats.total}</strong></div>
        <div className="stat-chip patient-stat-chip warning"><span>Pending</span><strong>{stats.pending}</strong></div>
        <div className="stat-chip patient-stat-chip"><span>Arrived</span><strong>{stats.arrived}</strong></div>
        <div className="stat-chip patient-stat-chip"><span>Completed</span><strong>{stats.completed}</strong></div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void loadAppointments();
        }}
        className="appointment-toolbar"
      >
        <DateRangeFilter value={dateRange} onChange={setDateRange} includeAll />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All status</option>
          <option value="PENDING">Pending</option>
          <option value="ARRIVED">Arrived</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="NO_SHOW">No Show</option>
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All appointment types</option>
          <option value="NEW">First Visit</option>
          <option value="FOLLOW_UP">Follow-up</option>
        </select>
        <PatientAutocomplete
          selectedPatient={selectedPatientFilter}
          onSelect={setSelectedPatientFilter}
          placeholder="Search patient name / IC / phone"
        />
        <button
          type="button"
          className="btn-secondary patient-compact-button"
          onClick={() => {
            setDateRange(getDateRangeForPreset('today'));
            setStatusFilter('');
            setTypeFilter('');
            setSelectedPatientFilter(null);
          }}
        >
          Reset
        </button>
        <button type="submit" className="btn-secondary patient-compact-button" disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {success && <p className="muted" style={{ color: 'var(--primary)' }}>{success}</p>}

      <div className="table-wrap appointment-table-wrap">
        <table className="data-table appointment-table">
          <thead>
            <tr>
              <th>Date & Time</th>
              <th>Patient</th>
              <th>Appointment Type</th>
              <th>Status</th>
              <th>Linked Record</th>
              <th>Notes</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {visibleAppointments.map((appointment) => (
              <tr key={appointment.appointmentId}>
                <td>
                  <strong>{formatDateTime(appointment.dateTime)}</strong>
                  <small>#{appointment.appointmentId}</small>
                </td>
                <td>
                  <div className="appointment-patient-cell">
                    <strong>{appointment.patient.name}</strong>
                    <small>{appointment.patient.icOrPassport} / {appointment.patient.phone}</small>
                  </div>
                </td>
                <td>{appointmentTypeLabel(appointment.type)}</td>
                <td><span className={`status-badge ${statusClass(appointment.status)}`}>{statusLabel(appointment.status)}</span></td>
                <td>
                  {appointmentLinkedRecordLabel(appointment) === '-' ? (
                    <span className="muted">-</span>
                  ) : (
                    <span className="status-badge status-neutral">{appointmentLinkedRecordLabel(appointment)}</span>
                  )}
                </td>
                <td className="appointment-note-cell">{appointment.notes || '-'}</td>
                <td>
                  <div className="action-row patient-row-actions" ref={openActionMenuId === appointment.appointmentId ? actionMenuRef : null}>
                    <button
                      type="button"
                      className="btn-secondary patient-action-menu-trigger"
                      aria-label="Open appointment actions"
                      aria-expanded={openActionMenuId === appointment.appointmentId}
                      onClick={() => setOpenActionMenuId((current) => (current === appointment.appointmentId ? null : appointment.appointmentId))}
                    />

                    {openActionMenuId === appointment.appointmentId && (
                      <div className="patient-action-menu appointment-action-menu" role="menu">
                        {isReceptionist && appointment.status === 'PENDING' && (
                          <>
                            <button type="button" className="patient-action-menu-item" onClick={() => void onStatusChange(appointment.appointmentId, 'ARRIVED')}>
                              Mark Arrived
                            </button>
                            <button type="button" className="patient-action-menu-item" onClick={() => openRescheduleDialog(appointment)}>
                              Reschedule
                            </button>
                            <button type="button" className="patient-action-menu-item" onClick={() => void onStatusChange(appointment.appointmentId, 'NO_SHOW')}>
                              No Show
                            </button>
                            <button type="button" className="patient-action-menu-item" onClick={() => void onStatusChange(appointment.appointmentId, 'CANCELLED')}>
                              Cancel
                            </button>
                          </>
                        )}

                        {isDoctor && appointment.status === 'ARRIVED' && (
                          <>
                            <button type="button" className="patient-action-menu-item" onClick={() => void onStartConsultation(appointment.appointmentId)}>
                              Start Consultation
                            </button>
                            <button type="button" className="patient-action-menu-item" onClick={() => {
                              openFollowUpDrawer(appointment);
                            }}>
                              Create Follow-up
                            </button>
                          </>
                        )}

                        {isDoctor && appointment.status === 'COMPLETED' && (
                          <button type="button" className="patient-action-menu-item" onClick={() => {
                            openFollowUpDrawer(appointment);
                          }}>
                            Create Follow-up
                          </button>
                        )}

                        <button type="button" className="patient-action-menu-item" onClick={() => {
                          setOpenActionMenuId(null);
                          navigate(`${isDoctor ? '/doctor' : '/receptionist'}/patients?patientId=${appointment.patient.patientId}`);
                        }}>
                          View Patient
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!loading && visibleAppointments.length === 0 && (
        <p className="muted" style={{ marginTop: 10 }}>
          No appointments found for current filters. Try clearing the date/status/type filters.
        </p>
      )}

      {isReceptionist && isCreateDrawerOpen && (
        <div className="appointment-drawer-layer" role="presentation">
          <button type="button" className="patient-drawer-backdrop" aria-label="Close appointment drawer" onClick={() => setIsCreateDrawerOpen(false)} />
          <aside className="patient-drawer appointment-drawer" role="dialog" aria-modal="true" aria-labelledby="appointment-drawer-title">
            <div className="patient-drawer-head">
              <div>
                <h3 id="appointment-drawer-title">Create Appointment</h3>
                <p className="muted">Book eligible patients who are not in an active visit.</p>
              </div>
              <button type="button" className="patient-drawer-close" onClick={() => setIsCreateDrawerOpen(false)} disabled={saving}>
                X
              </button>
            </div>

            <form onSubmit={onCreateAppointment} className="patient-registration-form patient-drawer-form">
              <div className="patient-drawer-body">
                <div className="appointment-drawer-stack">
                  <label className="field-block">
                    <span>Patient</span>
                    <PatientAutocomplete
                      selectedPatient={selectedBookingPatient}
                      onSelect={setSelectedBookingPatient}
                      placeholder="Search eligible patient by name / IC / phone"
                      filterResults={isAppointmentPatientEligible}
                      emptyStateLabel="No eligible patients found."
                    />
                    <span className="field-hint">Patients in active consultation or visit queue are hidden.</span>
                  </label>

                  {selectedBookingPatient && !isAppointmentPatientEligible(selectedBookingPatient) && (
                    <p className="error appointment-inline-alert">
                      Patient currently has an active visit/consultation and cannot be booked for appointment.
                    </p>
                  )}

                  <button type="button" className="btn-secondary appointment-register-inline" onClick={() => setIsPatientDrawerOpen(true)}>
                    Register New Patient
                  </button>

                  <label className="field-block">
                    <span>Date & Time</span>
                    <input
                      type="datetime-local"
                      value={appointmentDateTime}
                      onChange={(e) => setAppointmentDateTime(e.target.value)}
                      required
                    />
                  </label>

                  <label className="field-block">
                    <span>Notes</span>
                    <textarea
                      value={appointmentNotes}
                      onChange={(e) => setAppointmentNotes(e.target.value)}
                      placeholder="Notes (optional)"
                      rows={4}
                    />
                  </label>
                </div>
              </div>

              <div className="patient-drawer-footer">
                <button type="submit" disabled={saving || !selectedBookingPatient || !isAppointmentPatientEligible(selectedBookingPatient)}>
                  {saving ? 'Saving...' : 'Create Appointment'}
                </button>
                <button className="btn-secondary" type="button" onClick={() => setIsCreateDrawerOpen(false)} disabled={saving}>
                  Cancel
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}

      {isDoctor && followUpSourceAppointment && (
        <div className="appointment-drawer-layer" role="presentation">
          <button type="button" className="patient-drawer-backdrop" aria-label="Close follow-up drawer" onClick={() => setFollowUpSourceAppointment(null)} />
          <aside className="patient-drawer appointment-drawer" role="dialog" aria-modal="true" aria-labelledby="follow-up-drawer-title">
            <div className="patient-drawer-head">
              <div>
                <h3 id="follow-up-drawer-title">Create Follow-up Appointment</h3>
                <p className="muted">
                  {followUpSourceAppointment.patient.name} - #{followUpSourceAppointment.appointmentId}
                </p>
              </div>
              <button type="button" className="patient-drawer-close" onClick={() => setFollowUpSourceAppointment(null)} disabled={saving}>
                X
              </button>
            </div>

            <form onSubmit={onCreateFollowUp} className="patient-registration-form patient-drawer-form">
              <div className="patient-drawer-body">
                <div className="appointment-drawer-stack">
                  <div className="patient-autocomplete__selected">
                    <strong>{followUpSourceAppointment.patient.name}</strong>
                    <span>{followUpSourceAppointment.patient.icOrPassport} / {followUpSourceAppointment.patient.phone}</span>
                  </div>

                  <label className="field-block">
                    <span>Appointment Type</span>
                    <output className="age-output">Follow-up</output>
                  </label>

                  <label className="field-block">
                    <span>Date & Time</span>
                    <input
                      type="datetime-local"
                      value={followUpDateTime}
                      onChange={(e) => setFollowUpDateTime(e.target.value)}
                      required
                    />
                  </label>

                  <label className="field-block">
                    <span>Notes</span>
                    <textarea
                      value={followUpNotes}
                      onChange={(e) => setFollowUpNotes(e.target.value)}
                      placeholder="Follow-up notes (optional)"
                      rows={4}
                    />
                  </label>

                  <label className="field-block">
                    <span>Previous Prescription ID</span>
                    <input
                      value={followUpPrescriptionId}
                      onChange={(e) => setFollowUpPrescriptionId(e.target.value)}
                      placeholder="Optional"
                      inputMode="numeric"
                    />
                  </label>
                </div>
              </div>

              <div className="patient-drawer-footer">
                <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Create Follow-up'}</button>
                <button className="btn-secondary" type="button" onClick={() => setFollowUpSourceAppointment(null)} disabled={saving}>
                  Cancel
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}

      {isReceptionist && isPatientDrawerOpen && (
        <div className="appointment-drawer-layer appointment-nested-drawer-layer" role="presentation">
          <button type="button" className="patient-drawer-backdrop" aria-label="Close patient registration drawer" onClick={() => setIsPatientDrawerOpen(false)} />
          <aside className="patient-drawer appointment-drawer" role="dialog" aria-modal="true" aria-labelledby="appointment-patient-drawer-title">
            <div className="patient-drawer-head">
              <div>
                <h3 id="appointment-patient-drawer-title">Register New Patient</h3>
                <p className="muted">Create patient profile before booking appointment.</p>
              </div>
              <button type="button" className="patient-drawer-close" onClick={() => setIsPatientDrawerOpen(false)} disabled={saving}>
                X
              </button>
            </div>

            <form onSubmit={onCreatePatient} className="patient-registration-form patient-drawer-form">
              <div className="patient-drawer-body">
                <div className="patient-form-grid">
                  <label className="field-block">
                    <span>Patient Name</span>
                    <input
                      value={newPatientForm.name}
                      onChange={(e) => setNewPatientForm((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g. Nur Aina Binti Ahmad"
                      required
                    />
                  </label>
                  <label className="field-block">
                    <span>IC Number / ID</span>
                    <input
                      className={newPatientIcValidationMessage ? 'field-invalid' : undefined}
                      value={newPatientForm.icOrPassport}
                      onChange={(e) => updateNewPatientIcOrPassport(e.target.value)}
                      placeholder="010902-03-0325 or passport"
                      inputMode="text"
                      required
                    />
                    <span className={newPatientIcValidationMessage ? 'field-helper' : 'field-hint'}>
                      {newPatientIcValidationMessage ?? 'Valid Malaysian IC auto-fills DOB. Passport/foreign ID can be entered manually.'}
                    </span>
                  </label>
                  <label className="field-block">
                    <span>Phone</span>
                    <input
                      value={newPatientForm.phone}
                      onChange={(e) => setNewPatientForm((prev) => ({ ...prev, phone: e.target.value }))}
                      placeholder="e.g. 012-345 6789"
                      required
                    />
                  </label>
                  <label className={`field-block dob-field ${newPatientDobAutoFilled ? 'dob-autofilled' : ''}`}>
                    <span>Date of Birth</span>
                    <input
                      className={newPatientDobValidationMessage ? 'field-invalid' : undefined}
                      type="date"
                      value={newPatientForm.dateOfBirth}
                      max={todayInputValue()}
                      onChange={(e) => updateNewPatientDateOfBirth(e.target.value)}
                      required
                    />
                    <span className={newPatientDobValidationMessage ? 'field-helper' : 'field-hint'}>
                      {newPatientDobValidationMessage ??
                        (newPatientDobAutoFilled && newPatientForm.dateOfBirth
                          ? `Auto-filled from IC: ${formatDisplayDate(newPatientForm.dateOfBirth)}`
                          : 'Editable for foreign patients, corrections, and demo records.')}
                    </span>
                  </label>
                  <label className="field-block">
                    <span>Gender</span>
                    <select value={newPatientForm.gender} onChange={(e) => setNewPatientForm((prev) => ({ ...prev, gender: e.target.value as Gender }))} required>
                      <option value="MALE">Male</option>
                      <option value="FEMALE">Female</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </label>
                  <div className="field-block">
                    <span>Age</span>
                    <output className="age-output" aria-live="polite">
                      {newPatientAge !== null ? `${newPatientAge} years old` : 'Enter DOB'}
                    </output>
                    <span className="field-hint">Updates automatically from DOB.</span>
                  </div>
                  <label className="field-block patient-address-field">
                    <span>Address</span>
                    <textarea
                      value={newPatientForm.address}
                      onChange={(e) => setNewPatientForm((prev) => ({ ...prev, address: e.target.value }))}
                      placeholder="Full residential address"
                      rows={3}
                      required
                    />
                  </label>
                </div>
              </div>

              <div className="patient-drawer-footer">
                <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Patient'}</button>
                <button className="btn-secondary" type="button" onClick={() => setIsPatientDrawerOpen(false)} disabled={saving}>
                  Cancel
                </button>
              </div>
            </form>
          </aside>
        </div>
      )}

      {rescheduleTarget && (
        <div className="appointment-modal-layer" role="presentation">
          <button type="button" className="appointment-modal-backdrop" aria-label="Close reschedule dialog" onClick={() => setRescheduleTarget(null)} />
          <section className="appointment-modal" role="dialog" aria-modal="true" aria-labelledby="reschedule-title">
            <div className="patient-card-head">
              <div>
                <h3 id="reschedule-title">Reschedule Appointment</h3>
                <p className="muted">Current time: {formatDateTime(rescheduleTarget.dateTime)}</p>
              </div>
            </div>

            <form onSubmit={onRescheduleAppointment} className="appointment-drawer-stack">
              <label className="field-block">
                <span>New Date & Time</span>
                <input type="datetime-local" value={rescheduleDateTime} onChange={(e) => setRescheduleDateTime(e.target.value)} required />
              </label>
              <label className="field-block">
                <span>Notes / Reason</span>
                <textarea value={rescheduleNotes} onChange={(e) => setRescheduleNotes(e.target.value)} rows={3} placeholder="Optional" />
              </label>
              <div className="appointment-modal-actions">
                <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Confirm Reschedule'}</button>
                <button type="button" className="btn-secondary" onClick={() => setRescheduleTarget(null)} disabled={saving}>
                  Cancel
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
};
