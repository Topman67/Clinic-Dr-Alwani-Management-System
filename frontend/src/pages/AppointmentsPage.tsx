import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { subscribeInAppDataSync } from '../lib/sync';

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

const getApiErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'object' && error !== null) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    const message = response?.data?.message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return fallback;
};

export const AppointmentsPage = () => {
  const { role } = useAuth();
  const navigate = useNavigate();

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
  const [queryFilter, setQueryFilter] = useState('');

  const [patientSearch, setPatientSearch] = useState('');
  const [matchedPatients, setMatchedPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<number | ''>('');
  const [appointmentDateTime, setAppointmentDateTime] = useState(() => toDateTimeLocalInput(new Date(Date.now() + 30 * 60000)));
  const [appointmentNotes, setAppointmentNotes] = useState('');
  const [newPatientForm, setNewPatientForm] = useState<NewPatientForm>(initialNewPatientForm);
  const [showCreatePatientForm, setShowCreatePatientForm] = useState(false);

  const [followUpDateTime, setFollowUpDateTime] = useState(() => toDateTimeLocalInput(new Date(Date.now() + 24 * 60 * 60000)));
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [followUpPrescriptionId, setFollowUpPrescriptionId] = useState('');
  const [followUpSourceAppointmentId, setFollowUpSourceAppointmentId] = useState<number | null>(null);

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.get('/appointments', {
        params: {
          date: dateFilter || undefined,
          status: statusFilter || undefined,
          type: typeFilter || undefined,
          query: queryFilter.trim() || undefined,
        },
      });
      setAppointments(response.data as Appointment[]);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load appointments'));
    } finally {
      setLoading(false);
    }
  }, [dateFilter, queryFilter, statusFilter, typeFilter]);

  useEffect(() => {
    void loadAppointments();
  }, [loadAppointments]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void loadAppointments();
    });
  }, [loadAppointments]);

  const pendingCount = useMemo(() => appointments.filter((a) => a.status === 'PENDING').length, [appointments]);
  const arrivedCount = useMemo(() => appointments.filter((a) => a.status === 'ARRIVED').length, [appointments]);

  const searchPatient = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const query = patientSearch.trim();
    if (!query) {
      setMatchedPatients([]);
      setSelectedPatientId('');
      return;
    }

    try {
      const response = await api.get('/patients', { params: { query } });
      const list = response.data as Patient[];
      setMatchedPatients(list);
      if (list.length > 0) {
        setSelectedPatientId(list[0].patientId);
        setShowCreatePatientForm(false);
      } else {
        setSelectedPatientId('');
        setShowCreatePatientForm(true);
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to search patient records'));
    }
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
      });

      const created = response.data as Patient;
      setMatchedPatients([created]);
      setSelectedPatientId(created.patientId);
      setShowCreatePatientForm(false);
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

    if (!selectedPatientId) {
      setError('Please select a patient first.');
      return;
    }

    setSaving(true);
    try {
      const createdDate = toDateInput(new Date(appointmentDateTime));
      await api.post('/appointments', {
        patientId: selectedPatientId,
        dateTime: new Date(appointmentDateTime).toISOString(),
        notes: appointmentNotes.trim() || undefined,
      });
      setSuccess('Appointment created successfully.');
      setDateFilter(createdDate);
      setAppointmentNotes('');
      await loadAppointments();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to create appointment'));
    } finally {
      setSaving(false);
    }
  };

  const onStatusChange = async (appointmentId: number, status: AppointmentStatus) => {
    setError(null);
    setSuccess(null);
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
    try {
      const response = await api.post(`/appointments/${appointmentId}/start-consultation`);
      const payload = response.data as { openPrescriptionWith?: { patientId: number; appointmentId: number } };
      const info = payload.openPrescriptionWith;
      if (!info) {
        setError('Unable to start consultation for this appointment.');
        return;
      }
      navigate(`/doctor/prescriptions?patientId=${info.patientId}&appointmentId=${info.appointmentId}`);
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

  const openReschedulePrompt = async (appointmentId: number, currentDateTime: string) => {
    const input = window.prompt('Enter new date and time (YYYY-MM-DDTHH:mm)', toDateTimeLocalInput(new Date(currentDateTime)));
    if (!input) return;

    setError(null);
    setSuccess(null);
    try {
      await api.patch(`/appointments/${appointmentId}/reschedule`, {
        dateTime: new Date(input).toISOString(),
      });
      setSuccess('Appointment rescheduled successfully.');
      await loadAppointments();
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to reschedule appointment'));
    }
  };

  const visibleAppointments = useMemo(() => {
    if (!isDoctor) return appointments;
    return appointments.filter((a) => a.status === 'ARRIVED' || a.status === 'PENDING' || a.status === 'COMPLETED');
  }, [appointments, isDoctor]);

  return (
    <section className="card">
      <div className="section-head">
        <h1>Appointments</h1>
        <p className="muted">
          {isReceptionist
            ? 'Create and manage doctor appointments for registered patients.'
            : 'Review appointment queue, start consultation, and create follow-up appointments.'}
        </p>
      </div>

      <div className="stats-row" style={{ marginBottom: 12 }}>
        <div className="stat-chip">Total: {appointments.length}</div>
        <div className="stat-chip">Pending: {pendingCount}</div>
        <div className="stat-chip">Arrived: {arrivedCount}</div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void loadAppointments();
        }}
        className="filters-grid"
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
        <input
          value={queryFilter}
          onChange={(e) => setQueryFilter(e.target.value)}
          placeholder="Search name / IC / phone"
        />
        <button type="submit" className="btn-secondary" disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </form>

      {isReceptionist && (
        <section className="card users-subcard" style={{ marginTop: 14 }}>
          <div className="section-head">
            <h3>Create Appointment</h3>
            <p className="muted">Find patient first. If not found, register directly and continue booking.</p>
          </div>

          <form onSubmit={searchPatient} className="form-row">
            <input
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
              placeholder="Search by name / IC / phone"
            />
            <button type="submit" className="btn-secondary">Find Patient</button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setShowCreatePatientForm((prev) => !prev)}
            >
              {showCreatePatientForm ? 'Hide Register Form' : 'Register New Patient'}
            </button>
          </form>

          {matchedPatients.length > 0 && (
            <div className="form-row" style={{ marginTop: 10 }}>
              <select
                value={selectedPatientId}
                onChange={(e) => setSelectedPatientId(e.target.value ? Number(e.target.value) : '')}
              >
                {matchedPatients.map((p) => (
                  <option key={p.patientId} value={p.patientId}>
                    {p.name} — {p.icOrPassport} / {p.phone}
                  </option>
                ))}
              </select>
            </div>
          )}

          {showCreatePatientForm && (
            <form onSubmit={onCreatePatient} className="form-grid" style={{ marginTop: 10 }}>
              <input
                value={newPatientForm.name}
                onChange={(e) => setNewPatientForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="Patient name"
                required
              />
              <input
                value={newPatientForm.icOrPassport}
                onChange={(e) => setNewPatientForm((prev) => ({ ...prev, icOrPassport: e.target.value }))}
                placeholder="IC / ID"
                required
              />
              <input
                value={newPatientForm.phone}
                onChange={(e) => setNewPatientForm((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder="Phone"
                required
              />
              <textarea
                value={newPatientForm.address}
                onChange={(e) => setNewPatientForm((prev) => ({ ...prev, address: e.target.value }))}
                placeholder="Address"
                rows={2}
                required
              />
              <div className="form-row">
                <select
                  value={newPatientForm.gender}
                  onChange={(e) => setNewPatientForm((prev) => ({ ...prev, gender: e.target.value as Gender }))}
                  required
                >
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                </select>
                <input
                  type="date"
                  value={newPatientForm.dateOfBirth}
                  onChange={(e) => setNewPatientForm((prev) => ({ ...prev, dateOfBirth: e.target.value }))}
                  required
                />
                <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save Patient'}</button>
              </div>
            </form>
          )}

          <form onSubmit={onCreateAppointment} className="form-grid" style={{ marginTop: 12 }}>
            <div className="form-row">
              <input
                type="datetime-local"
                value={appointmentDateTime}
                onChange={(e) => setAppointmentDateTime(e.target.value)}
                required
              />
              <textarea
                value={appointmentNotes}
                onChange={(e) => setAppointmentNotes(e.target.value)}
                placeholder="Notes (optional)"
                rows={2}
              />
              <button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Create Appointment'}</button>
            </div>
          </form>
        </section>
      )}

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

      <div className="table-wrap" style={{ marginTop: 12 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
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
                <td>#{appointment.appointmentId}</td>
                <td>{formatDateTime(appointment.dateTime)}</td>
                <td>
                  <strong>{appointment.patient.name}</strong>
                  <br />
                  <span className="muted">{appointment.patient.icOrPassport} / {appointment.patient.phone}</span>
                </td>
                <td>{appointment.type === 'FOLLOW_UP' ? 'Follow-up' : 'New'}</td>
                <td>{statusLabel(appointment.status)}</td>
                <td>{appointment.notes || '-'}</td>
                <td>
                  <div className="action-row" style={{ gap: 6 }}>
                    {isReceptionist && appointment.status === 'PENDING' && (
                      <>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void onStatusChange(appointment.appointmentId, 'ARRIVED')}
                        >
                          Mark Arrived
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void openReschedulePrompt(appointment.appointmentId, appointment.dateTime)}
                        >
                          Reschedule
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void onStatusChange(appointment.appointmentId, 'NO_SHOW')}
                        >
                          No Show
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void onStatusChange(appointment.appointmentId, 'CANCELLED')}
                        >
                          Cancel
                        </button>
                      </>
                    )}

                    {isDoctor && appointment.status === 'ARRIVED' && (
                      <>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void onStartConsultation(appointment.appointmentId)}
                        >
                          Start Consultation
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => setFollowUpSourceAppointmentId(appointment.appointmentId)}
                        >
                          Create Follow-up
                        </button>
                      </>
                    )}

                    {isDoctor && appointment.status === 'COMPLETED' && (
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => setFollowUpSourceAppointmentId(appointment.appointmentId)}
                      >
                        Create Follow-up
                      </button>
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
    </section>
  );
};
