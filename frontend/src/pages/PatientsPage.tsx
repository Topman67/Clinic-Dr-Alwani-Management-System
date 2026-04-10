import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';
import { subscribeInAppDataSync } from '../lib/sync';
import { useAuth } from '../context/AuthContext';

type Gender = 'MALE' | 'FEMALE' | 'OTHER';

type Patient = {
  patientId: number;
  name: string;
  icOrPassport: string;
  phone: string;
  address: string | null;
  gender: Gender | null;
  dateOfBirth: string | null;
  _count?: {
    prescriptions: number;
    payments: number;
  };
};

type PatientDetails = Patient & {
  prescriptions: Array<{
    prescriptionId: number;
    date: string;
    notes?: string | null;
    doctor?: { username: string; role: string };
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

type PatientForm = {
  name: string;
  icOrPassport: string;
  phone: string;
  address: string;
  gender: Gender;
  dateOfBirth: string;
};

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

const getApiErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'object' && error !== null) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    const message = response?.data?.message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return fallback;
};

export const PatientsPage = () => {
  const { role } = useAuth();
  const canManage = role === 'RECEPTIONIST';

  const [patients, setPatients] = useState<Patient[]>([]);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<PatientForm>(initialForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(null);
  const [selectedPatient, setSelectedPatient] = useState<PatientDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const activeSearch = query.trim();

  const loadPatients = useCallback(async (q = '') => {
    setLoading(true);
    try {
      const response = await api.get('/patients', { params: { query: q } });
      setPatients(response.data as Patient[]);
    } catch {
      setError('Failed to load patients');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPatients();
  }, [loadPatients]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void loadPatients(query);
    });
  }, [loadPatients, query]);

  const loadPatientDetails = useCallback(async (patientId: number) => {
    setDetailsLoading(true);
    try {
      const response = await api.get(`/patients/${patientId}`);
      setSelectedPatient(response.data as PatientDetails);
      setSelectedPatientId(patientId);
    } catch {
      setError('Failed to load patient details');
    } finally {
      setDetailsLoading(false);
    }
  }, []);

  const visitedStats = useMemo(() => {
    const visitedCount = patients.filter((p) => ((p._count?.payments ?? 0) + (p._count?.prescriptions ?? 0)) > 0).length;
    return {
      total: patients.length,
      visitedCount,
      neverVisited: patients.length - visitedCount,
    };
  }, [patients]);

  const validateForm = () => {
    if (!form.name.trim() || form.name.trim().length < 2) return 'Name must be at least 2 characters.';
    if (!form.icOrPassport.trim() || form.icOrPassport.trim().length < 4) return 'IC/ID must be at least 4 characters.';
    if (!/^[0-9+\-()\s]{7,20}$/.test(form.phone.trim())) return 'Phone number format is invalid.';
    if (!form.address.trim() || form.address.trim().length < 5) return 'Address must be at least 5 characters.';
    if (!form.dateOfBirth) return 'Date of birth is required.';
    const dob = new Date(form.dateOfBirth);
    if (Number.isNaN(dob.getTime())) return 'Date of birth is invalid.';
    if (dob.getTime() > Date.now()) return 'Date of birth cannot be in the future.';
    return null;
  };

  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    await loadPatients(query);
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
      setEditingId(null);
      await loadPatients(query);
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
  };

  const onCancelEdit = () => {
    setEditingId(null);
    setForm(initialForm);
  };

  const onSelectPatient = async (patient: Patient) => {
    if (canManage) {
      onEdit(patient);
    }
    await loadPatientDetails(patient.patientId);
  };

  return (
    <section className="card">
      <div className="section-head">
        <h1>Manage Patient</h1>
        <p className="muted">
          {canManage
            ? 'Receptionist can register, validate, search, and update patient records.'
            : 'View and search patient records by IC/ID or phone. Registration is receptionist-only.'}
        </p>
      </div>

      <div className="stats-row" style={{ marginBottom: 10 }}>
        <div className="stat-chip">Total: {visitedStats.total}</div>
        <div className="stat-chip">Visited: {visitedStats.visitedCount}</div>
        <div className="stat-chip warning">Not visited yet: {visitedStats.neverVisited}</div>
      </div>

      <form onSubmit={onSearch} className="form-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by IC/ID or phone (or name)"
        />
        <button type="submit" className="btn-secondary">Search</button>
      </form>

      {canManage && (
        <form onSubmit={onSubmit} className="form-grid" style={{ marginTop: 12 }}>
          <input
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Patient name"
            required
          />
          <input
            value={form.icOrPassport}
            onChange={(e) => setForm((prev) => ({ ...prev, icOrPassport: e.target.value }))}
            placeholder="IC / ID"
            required
          />
          <input
            value={form.phone}
            onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
            placeholder="Phone number"
            required
          />
          <textarea
            value={form.address}
            onChange={(e) => setForm((prev) => ({ ...prev, address: e.target.value }))}
            placeholder="Address"
            rows={2}
            required
          />
          <div className="form-row">
            <select
              value={form.gender}
              onChange={(e) => setForm((prev) => ({ ...prev, gender: e.target.value as Gender }))}
              required
            >
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </select>
            <input
              type="date"
              value={form.dateOfBirth}
              onChange={(e) => setForm((prev) => ({ ...prev, dateOfBirth: e.target.value }))}
              required
            />
          </div>
          <div className="action-row">
            <button type="submit" disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Update Patient' : 'Save / Register'}
            </button>
            {!editingId && (
              <button
                className="btn-secondary"
                type="button"
                onClick={() => {
                  setForm(initialForm);
                  setError(null);
                  setSuccess(null);
                }}
              >
                Cancel Registration
              </button>
            )}
            {editingId && (
              <button className="btn-secondary" type="button" onClick={onCancelEdit}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}

      {error && <p className="error">{error}</p>}
      {success && <p className="muted" style={{ color: 'var(--primary)' }}>{success}</p>}
      {loading && <p className="muted">Loading...</p>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>IC/ID</th>
              <th>Phone</th>
              <th>Visited</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {patients.map((patient) => (
              <tr key={patient.patientId}>
                <td>{patient.name}</td>
                <td>{patient.icOrPassport}</td>
                <td>{patient.phone}</td>
                <td>{((patient._count?.payments ?? 0) + (patient._count?.prescriptions ?? 0)) > 0 ? 'Yes' : 'No'}</td>
                <td>
                  <button type="button" className="btn-secondary" onClick={() => void onSelectPatient(patient)}>
                    {canManage ? 'Edit / View' : 'View Details'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mobile-cards">
        {patients.map((patient) => (
          <article key={patient.patientId} className="mobile-card">
            <h4>{patient.name}</h4>
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
                <dt>Visited</dt>
                <dd>{((patient._count?.payments ?? 0) + (patient._count?.prescriptions ?? 0)) > 0 ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
            <div className="action-row" style={{ marginTop: 10 }}>
              <button type="button" className="btn-secondary" onClick={() => void onSelectPatient(patient)}>
                {canManage ? 'Edit / View' : 'View Details'}
              </button>
            </div>
          </article>
        ))}
      </div>

      {detailsLoading && <p className="muted">Loading patient details...</p>}

      {selectedPatient && selectedPatientId && (
        <section className="card users-subcard" style={{ marginTop: 14 }}>
          <div className="section-head">
            <h3>Patient Details</h3>
            <p className="muted">Complete profile and related record history.</p>
          </div>

          <div className="form-grid">
            <p><strong>Name:</strong> {selectedPatient.name}</p>
            <p><strong>IC/ID:</strong> {selectedPatient.icOrPassport}</p>
            <p><strong>Phone:</strong> {selectedPatient.phone}</p>
            <p><strong>Address:</strong> {selectedPatient.address || '-'}</p>
            <p><strong>Gender:</strong> {selectedPatient.gender ? prettifyGender(selectedPatient.gender) : '-'}</p>
            <p><strong>Date of Birth:</strong> {selectedPatient.dateOfBirth ? toDateInput(selectedPatient.dateOfBirth) : '-'}</p>
          </div>

          <div className="section-head" style={{ marginTop: 10 }}>
            <h3>Visit / Record History</h3>
          </div>

          <div className="stats-row">
            <div className="stat-chip">Prescriptions: {selectedPatient.prescriptions.length}</div>
            <div className="stat-chip">Payments: {selectedPatient.payments.length}</div>
          </div>

          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Date</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {selectedPatient.prescriptions.map((item) => (
                  <tr key={`p-${item.prescriptionId}`}>
                    <td>Prescription</td>
                    <td>{new Date(item.date).toLocaleString()}</td>
                    <td>{item.notes || `By ${item.doctor?.username ?? 'Doctor'}`}</td>
                  </tr>
                ))}
                {selectedPatient.payments.map((item) => (
                  <tr key={`pay-${item.paymentId}`}>
                    <td>Payment</td>
                    <td>{new Date(item.date).toLocaleString()}</td>
                    <td>
                      {item.type} • RM {formatMoney(item.amount)} • {item.status}
                      {item.receipt?.receiptNo ? ` • ${item.receipt.receiptNo}` : ''}
                    </td>
                  </tr>
                ))}
                {selectedPatient.prescriptions.length === 0 && selectedPatient.payments.length === 0 && (
                  <tr>
                    <td colSpan={3}>No visit history yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!loading && patients.length === 0 && activeSearch && (
        <p className="muted">No record found</p>
      )}
    </section>
  );
};
