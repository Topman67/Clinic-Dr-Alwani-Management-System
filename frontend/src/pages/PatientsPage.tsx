import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';

type Patient = {
  patientId: number;
  name: string;
  icOrPassport: string;
  phone: string;
};

type PatientForm = {
  name: string;
  icOrPassport: string;
  phone: string;
};

const initialForm: PatientForm = { name: '', icOrPassport: '', phone: '' };

export const PatientsPage = () => {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<PatientForm>(initialForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPatients = async (q = '') => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/patients', { params: { query: q } });
      setPatients(response.data as Patient[]);
    } catch {
      setError('Failed to load patients');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPatients();
  }, []);

  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    await loadPatients(query);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (editingId) {
        await api.put(`/patients/${editingId}`, form);
      } else {
        await api.post('/patients', form);
      }
      setForm(initialForm);
      setEditingId(null);
      await loadPatients(query);
    } catch {
      setError('Failed to save patient');
    }
  };

  const onEdit = (patient: Patient) => {
    setEditingId(patient.patientId);
    setForm({
      name: patient.name,
      icOrPassport: patient.icOrPassport,
      phone: patient.phone,
    });
  };

  return (
    <section className="card">
      <div className="section-head">
        <h1>Manage Patient</h1>
        <p className="muted">Register, search, and update patient records.</p>
      </div>

      <form onSubmit={onSearch} className="form-row">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name / IC / phone"
        />
        <button type="submit" className="btn-secondary">Search</button>
      </form>

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
          placeholder="IC / Passport"
          required
        />
        <input
          value={form.phone}
          onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
          placeholder="Phone"
          required
        />
        <div className="action-row">
          <button type="submit">{editingId ? 'Update Patient' : 'Create Patient'}</button>
          {editingId && (
            <button
              className="btn-secondary"
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(initialForm);
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {error && <p className="error">{error}</p>}
      {loading && <p className="muted">Loading...</p>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>IC/Passport</th>
              <th>Phone</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {patients.map((patient) => (
              <tr key={patient.patientId}>
                <td>{patient.name}</td>
                <td>{patient.icOrPassport}</td>
                <td>{patient.phone}</td>
                <td>
                  <button type="button" className="btn-secondary" onClick={() => onEdit(patient)}>
                    Edit
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
                <dt>IC/Passport</dt>
                <dd>{patient.icOrPassport}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{patient.phone}</dd>
              </div>
            </dl>
            <div className="action-row" style={{ marginTop: 10 }}>
              <button type="button" className="btn-secondary" onClick={() => onEdit(patient)}>
                Edit
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
};
