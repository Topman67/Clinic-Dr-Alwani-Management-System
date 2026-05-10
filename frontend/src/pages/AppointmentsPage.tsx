import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { subscribeInAppDataSync } from '../lib/sync';
import { PatientAutocomplete, type PatientAutocompleteOption } from '../components/PatientAutocomplete';

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
  dateFilter: string;
  statusFilter: string;
  typeFilter: string;
  patientFilter: PatientAutocompleteOption | null;
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

const isToday = (value?: string | null) => {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return toDateInput(date) === toDateInput(new Date());
};

const isAppointmentPatientEligible = (patient: PatientAutocompleteOption) => {
  if (patient.isActive === false) return false;
  const consultations = patient.consultations ?? [];
  return !consultations.some((consultation) => {
    const status = consultation.status;
    return status === 'WAITING' || status === 'IN_PROGRESS' || (status === 'COMPLETED' && isToday(consultation.updatedAt ?? consultation.createdAt));
  });
};

export const AppointmentsPage = () => {
  const { role } = useAuth();
  const navigate = useNavigate();
  const actionMenuRef = useRef<HTMLDivElement | null>(null);

  const isReceptionist = role === 'RECEPTIONIST';
  const isDoctor = role === 'DOCTOR';

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [dateFilter, setDateFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedPatientFilter, setSelectedPatientFilter] = useState<PatientAutocompleteOption | null>(null);
  const [selectedBookingPatient, setSelectedBookingPatient] = useState<PatientAutocompleteOption | null>(null);
  const [appointmentDateTime, setAppointmentDateTime] = useState(() => toDateTimeLocalInput(new Date(Date.now() + 30 * 60000)));
  const [appointmentNotes, setAppointmentNotes] = useState('');
  const [newPatientForm, setNewPatientForm] = useState<NewPatientForm>(initialNewPatientForm);
  const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false);
  const [isPatientDrawerOpen, setIsPatientDrawerOpen] = useState(false);
  const [openActionMenuId, setOpenActionMenuId] = useState<number | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<Appointment | null>(null);
  const [rescheduleDateTime, setRescheduleDateTime] = useState('');
  const [rescheduleNotes, setRescheduleNotes] = useState('');

  const [followUpDateTime, setFollowUpDateTime] = useState(() => toDateTimeLocalInput(new Date(Date.now() + 24 * 60 * 60000)));
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [followUpPrescriptionId, setFollowUpPrescriptionId] = useState('');
  const [followUpSourceAppointmentId, setFollowUpSourceAppointmentId] = useState<number | null>(null);

  const loadAppointments = useCallback(async (overrides: Partial<AppointmentFilters> = {}) => {
    const nextDateFilter = overrides.dateFilter ?? dateFilter;
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
          date: nextDateFilter || undefined,
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
  }, [dateFilter, selectedPatientFilter, statusFilter, typeFilter]);

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

  const onCreatePatient = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!newPatientForm.name.trim() || !newPatientForm.icOrPassport.trim() || !newPatientForm.phone.trim()) {
      setError('Name, IC/ID and phone are required for new patient.');
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
        createInitialVisit: false,
      });
      const created = response.data as Patient;
      setSelectedBookingPatient(created);
      setIsPatientDrawerOpen(false);
      setSuccess('New patient registered and selected for appointment.');
      setNewPatientForm(initialNewPatientForm);
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
      setDateFilter(createdDate);
      setStatusFilter('');
      setTypeFilter('');
      setSelectedPatientFilter(null);
      resetAppointmentForm();
      setIsCreateDrawerOpen(false);
      await loadAppointments({ dateFilter: createdDate, statusFilter: '', typeFilter: '', patientFilter: null });
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
    if (!followUpSourceAppointmentId) return;

    setError(null);
    setSuccess(null);
    setSaving(true);

    const normalizedPrescriptionId = followUpPrescriptionId.trim();

    try {
      await api.post(`/appointments/${followUpSourceAppointmentId}/follow-up`, {
        dateTime: new Date(followUpDateTime).toISOString(),
        notes: followUpNotes.trim() || undefined,
        previousPrescriptionId: normalizedPrescriptionId ? Number(normalizedPrescriptionId) : undefined,
      });
      setSuccess('Follow-up appointment created successfully.');
      setFollowUpSourceAppointmentId(null);
      setFollowUpNotes('');
      setFollowUpPrescriptionId('');
      await loadAppointments();
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
      setSuccess('Appointment rescheduled successfully.');
      setDateFilter(nextDate);
      setRescheduleTarget(null);
      await loadAppointments({ dateFilter: nextDate });
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
        <input type="date" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} aria-label="Date" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All status</option>
          <option value="PENDING">Pending</option>
          <option value="ARRIVED">Arrived</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
          <option value="NO_SHOW">No Show</option>
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          <option value="NEW">New</option>
          <option value="FOLLOW_UP">Follow-up</option>
        </select>
        <PatientAutocomplete
          selectedPatient={selectedPatientFilter}
          onSelect={setSelectedPatientFilter}
          placeholder="Search patient name / IC / phone"
        />
        <button type="submit" className="btn-secondary patient-compact-button" disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </form>

      {followUpSourceAppointmentId && (
        <section className="card users-subcard" style={{ marginTop: 14 }}>
          <div className="section-head">
            <h3>Create Follow-up Appointment</h3>
            <p className="muted">Appointment ID: {followUpSourceAppointmentId}</p>
          </div>
          <form onSubmit={onCreateFollowUp} className="form-grid">
            <input
              type="datetime-local"
              value={followUpDateTime}
              onChange={(e) => setFollowUpDateTime(e.target.value)}
              required
            />
            <textarea
              value={followUpNotes}
              onChange={(e) => setFollowUpNotes(e.target.value)}
              placeholder="Follow-up notes (optional)"
              rows={2}
            />
            <input
              value={followUpPrescriptionId}
              onChange={(e) => setFollowUpPrescriptionId(e.target.value)}
              placeholder="Previous Prescription ID (optional)"
              inputMode="numeric"
            />
            <div className="action-row">
              <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Follow-up'}</button>
              <button type="button" className="btn-secondary" onClick={() => setFollowUpSourceAppointmentId(null)}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {error && <p className="error">{error}</p>}
      {success && <p className="muted" style={{ color: 'var(--primary)' }}>{success}</p>}

      <div className="table-wrap appointment-table-wrap">
        <table className="data-table appointment-table">
          <thead>
            <tr>
              <th>Date & Time</th>
              <th>Patient</th>
              <th>Type</th>
              <th>Status</th>
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
                <td>{appointment.type === 'FOLLOW_UP' ? 'Follow-up' : 'New'}</td>
                <td><span className={`status-badge ${statusClass(appointment.status)}`}>{statusLabel(appointment.status)}</span></td>
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
                              setOpenActionMenuId(null);
                              setFollowUpSourceAppointmentId(appointment.appointmentId);
                            }}>
                              Create Follow-up
                            </button>
                          </>
                        )}

                        {isDoctor && appointment.status === 'COMPLETED' && (
                          <button type="button" className="patient-action-menu-item" onClick={() => {
                            setOpenActionMenuId(null);
                            setFollowUpSourceAppointmentId(appointment.appointmentId);
                          }}>
                            Create Follow-up
                          </button>
                        )}

                        <button type="button" className="patient-action-menu-item" onClick={() => {
                          setOpenActionMenuId(null);
                          navigate(`${isDoctor ? '/doctor' : '/receptionist'}/patients`);
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
                    <input value={newPatientForm.name} onChange={(e) => setNewPatientForm((prev) => ({ ...prev, name: e.target.value }))} required />
                  </label>
                  <label className="field-block">
                    <span>IC / ID</span>
                    <input value={newPatientForm.icOrPassport} onChange={(e) => setNewPatientForm((prev) => ({ ...prev, icOrPassport: e.target.value }))} required />
                  </label>
                  <label className="field-block">
                    <span>Phone</span>
                    <input value={newPatientForm.phone} onChange={(e) => setNewPatientForm((prev) => ({ ...prev, phone: e.target.value }))} required />
                  </label>
                  <label className="field-block">
                    <span>Date of Birth</span>
                    <input type="date" value={newPatientForm.dateOfBirth} onChange={(e) => setNewPatientForm((prev) => ({ ...prev, dateOfBirth: e.target.value }))} required />
                  </label>
                  <label className="field-block">
                    <span>Gender</span>
                    <select value={newPatientForm.gender} onChange={(e) => setNewPatientForm((prev) => ({ ...prev, gender: e.target.value as Gender }))} required>
                      <option value="MALE">Male</option>
                      <option value="FEMALE">Female</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </label>
                  <label className="field-block patient-address-field">
                    <span>Address</span>
                    <textarea value={newPatientForm.address} onChange={(e) => setNewPatientForm((prev) => ({ ...prev, address: e.target.value }))} rows={3} required />
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
