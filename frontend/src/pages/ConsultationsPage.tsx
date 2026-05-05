import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { subscribeInAppDataSync } from '../lib/sync';
import { PatientAutocomplete, type PatientAutocompleteOption } from '../components/PatientAutocomplete';

type ConsultationStatus = 'WAITING' | 'IN_PROGRESS' | 'COMPLETED';

type Consultation = {
  consultationId: number;
  patientId: number;
  appointmentId?: number | null;
  doctorId: number;
  symptoms?: string | null;
  diagnosis?: string | null;
  consultationNotes?: string | null;
  temperature?: string | null;
  bloodPressure?: string | null;
  weight?: string | null;
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
};

type ConsultationForm = {
  symptoms: string;
  diagnosis: string;
  consultationNotes: string;
  temperature: string;
  bloodPressure: string;
  weight: string;
};

const emptyForm: ConsultationForm = {
  symptoms: '',
  diagnosis: '',
  consultationNotes: '',
  temperature: '',
  bloodPressure: '',
  weight: '',
};

const getApiErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'object' && error !== null) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    const message = response?.data?.message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return fallback;
};

const formatStatus = (status: ConsultationStatus) => status.replace('_', ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

const toForm = (consultation: Consultation): ConsultationForm => ({
  symptoms: consultation.symptoms ?? '',
  diagnosis: consultation.diagnosis ?? '',
  consultationNotes: consultation.consultationNotes ?? '',
  temperature: consultation.temperature ?? '',
  bloodPressure: consultation.bloodPressure ?? '',
  weight: consultation.weight ?? '',
});

export const ConsultationsPage = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [statusFilter, setStatusFilter] = useState<ConsultationStatus | ''>('WAITING');
  const [selectedPatientFilter, setSelectedPatientFilter] = useState<PatientAutocompleteOption | null>(null);
  const [active, setActive] = useState<Consultation | null>(null);
  const [form, setForm] = useState<ConsultationForm>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const requestedConsultationId = useMemo(() => Number(searchParams.get('consultationId') || 0), [searchParams]);

  const loadConsultations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/consultations', {
        params: {
          status: statusFilter || undefined,
          patientId: selectedPatientFilter?.patientId,
        },
      });
      setConsultations(response.data as Consultation[]);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load consultation queue'));
    } finally {
      setLoading(false);
    }
  }, [selectedPatientFilter, statusFilter]);

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

  const selectConsultation = (consultation: Consultation) => {
    setActive(consultation);
    setForm(toForm(consultation));
    setError(null);
    setSuccess(null);
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

    if (!form.symptoms.trim() || !form.diagnosis.trim()) {
      setError('Symptoms and diagnosis are required before saving consultation.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await api.patch(`/consultations/${active.consultationId}`, {
        ...form,
        status: complete ? 'COMPLETED' : 'IN_PROGRESS',
      });
      const consultation = response.data as Consultation;
      setActive(consultation);
      setForm(toForm(consultation));
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

  return (
    <section className="card">
      <div className="section-head">
        <h1>Consultation</h1>
        <p className="muted">Doctor queue, clinical notes, vital signs, and prescription handoff.</p>
      </div>

      <div className="stats-row" style={{ marginBottom: 12 }}>
        <div className="stat-chip warning">Waiting: {stats.waiting}</div>
        <div className="stat-chip">In Progress: {stats.inProgress}</div>
        <div className="stat-chip">Completed: {stats.completed}</div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void loadConsultations();
        }}
        className="form-row"
      >
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as ConsultationStatus | '')}>
          <option value="">All status</option>
          <option value="WAITING">Waiting</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="COMPLETED">Completed</option>
        </select>
        <PatientAutocomplete
          selectedPatient={selectedPatientFilter}
          onSelect={setSelectedPatientFilter}
          placeholder="Search patient name / IC / phone"
        />
        <button type="submit" className="btn-secondary" disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}
      {success && <p className="muted" style={{ color: 'var(--primary)' }}>{success}</p>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Queue</th>
              <th>Patient</th>
              <th>Status</th>
              <th>Linked Record</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {consultations.map((consultation) => (
              <tr key={consultation.consultationId}>
                <td>
                  #{consultation.consultationId}
                  <br />
                  <span className="muted">{new Date(consultation.createdAt).toLocaleString()}</span>
                </td>
                <td>
                  <strong>{consultation.patient.name}</strong>
                  <br />
                  <span className="muted">{consultation.patient.icOrPassport} / {consultation.patient.phone}</span>
                </td>
                <td>{formatStatus(consultation.status)}</td>
                <td>
                  {consultation.appointmentId ? `Appointment #${consultation.appointmentId}` : 'Walk-in registration'}
                  {consultation.prescription ? ` / Prescription #${consultation.prescription.prescriptionId}` : ''}
                </td>
                <td>
                  <div className="action-row" style={{ gap: 6 }}>
                    <button type="button" className="btn-secondary" onClick={() => selectConsultation(consultation)}>
                      Open
                    </button>
                    {consultation.status === 'WAITING' && (
                      <button type="button" onClick={() => void startConsultation(consultation.consultationId)} disabled={saving}>
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

      <div className="mobile-cards">
        {consultations.map((consultation) => (
          <article key={consultation.consultationId} className="mobile-card">
            <h4>{consultation.patient.name}</h4>
            <dl className="kv">
              <div>
                <dt>Queue</dt>
                <dd>#{consultation.consultationId}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{formatStatus(consultation.status)}</dd>
              </div>
              <div>
                <dt>Record</dt>
                <dd>{consultation.appointmentId ? `Appointment #${consultation.appointmentId}` : 'Walk-in'}</dd>
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
        <section className="card users-subcard" style={{ marginTop: 14 }}>
          <div className="section-head">
            <h3>Consultation #{active.consultationId}</h3>
            <p className="muted">
              {active.patient.name} / {formatStatus(active.status)}
            </p>
          </div>

          <div className="form-grid" style={{ marginBottom: 12 }}>
            <p><strong>IC/ID:</strong> {active.patient.icOrPassport}</p>
            <p><strong>Phone:</strong> {active.patient.phone}</p>
            <p><strong>Appointment:</strong> {active.appointmentId ? `#${active.appointmentId}` : '-'}</p>
          </div>

          {active.status === 'WAITING' ? (
            <div className="action-row">
              <button type="button" onClick={() => void startConsultation(active.consultationId)} disabled={saving}>
                {saving ? 'Starting...' : 'Start Consultation'}
              </button>
            </div>
          ) : (
            <form className="form-grid" onSubmit={(e) => void saveConsultation(e, false)}>
              <textarea
                value={form.symptoms}
                onChange={(e) => setForm((prev) => ({ ...prev, symptoms: e.target.value }))}
                placeholder="Symptoms"
                rows={3}
                required
              />
              <textarea
                value={form.diagnosis}
                onChange={(e) => setForm((prev) => ({ ...prev, diagnosis: e.target.value }))}
                placeholder="Diagnosis"
                rows={3}
                required
              />
              <textarea
                value={form.consultationNotes}
                onChange={(e) => setForm((prev) => ({ ...prev, consultationNotes: e.target.value }))}
                placeholder="Consultation notes"
                rows={3}
              />
              <div className="form-row">
                <input
                  value={form.temperature}
                  onChange={(e) => setForm((prev) => ({ ...prev, temperature: e.target.value }))}
                  placeholder="Temperature (optional)"
                />
                <input
                  value={form.bloodPressure}
                  onChange={(e) => setForm((prev) => ({ ...prev, bloodPressure: e.target.value }))}
                  placeholder="Blood pressure (optional)"
                />
                <input
                  value={form.weight}
                  onChange={(e) => setForm((prev) => ({ ...prev, weight: e.target.value }))}
                  placeholder="Weight (optional)"
                />
              </div>
              <div className="action-row">
                {active.status !== 'COMPLETED' && (
                  <>
                    <button type="submit" className="btn-secondary" disabled={saving}>
                      {saving ? 'Saving...' : 'Save Notes'}
                    </button>
                    <button type="button" onClick={(e) => void saveConsultation(e, true)} disabled={saving}>
                      {saving ? 'Saving...' : 'Save Consultation'}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={createPrescription}
                  disabled={active.status !== 'COMPLETED' || Boolean(active.prescription)}
                >
                  {active.prescription ? 'Prescription Created' : 'Create Prescription'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => setActive(null)}>
                  Close
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </section>
  );
};
