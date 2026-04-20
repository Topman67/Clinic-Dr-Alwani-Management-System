import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { subscribeInAppDataSync } from '../lib/sync';

type Patient = {
  patientId: number;
  name: string;
  icOrPassport: string;
  phone: string;
  address: string | null;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | null;
  dateOfBirth: string | null;
};

type PatientDetails = Patient & {
  prescriptions: Array<{ prescriptionId: number; date: string; notes?: string | null }>;
  payments: Array<{ paymentId: number; date: string; type: string; amount: number | string; status: string }>;
};

type Medicine = {
  medicineId: number;
  name: string;
  quantity: number;
};

type PrescriptionItem = {
  pmId: number;
  medicineId: number;
  dosage: string;
  frequency: string;
  duration: string;
  qty: number;
  medicine?: { name: string };
};

type Prescription = {
  prescriptionId: number;
  patientId: number;
  doctorId: number;
  date: string;
  notes?: string | null;
  patient?: { name: string };
  items: PrescriptionItem[];
};

type ItemForm = {
  medicineId: number;
  dosage: string;
  frequency: string;
  duration: string;
  qty: number;
};

type PrescriptionForm = {
  patientId: number;
  notes: string;
  items: ItemForm[];
};

const WALKIN_CUSTOMER_IC = 'WALKIN-CUSTOMER';

const emptyItem = (): ItemForm => ({
  medicineId: 0,
  dosage: '',
  frequency: '',
  duration: '',
  qty: 1,
});

const initialForm: PrescriptionForm = {
  patientId: 0,
  notes: '',
  items: [emptyItem()],
};

const getApiErrorMessage = (error: unknown, fallback: string) => {
  if (typeof error === 'object' && error !== null) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    const message = response?.data?.message;
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return fallback;
};

const toDateInput = (value: string | null | undefined) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toISOString().slice(0, 10);
};

const prettifyGender = (value: PatientDetails['gender']) => {
  if (value === 'MALE') return 'Male';
  if (value === 'FEMALE') return 'Female';
  if (value === 'OTHER') return 'Other';
  return '-';
};

const parseUserIdFromToken = (token: string | null): number | null => {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(normalized)
        .split('')
        .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(''),
    );
    const parsed = JSON.parse(json) as { userId?: number };
    return typeof parsed.userId === 'number' ? parsed.userId : null;
  } catch {
    return null;
  }
};

export const PrescriptionsPage = () => {
  const { role } = useAuth();
  const isDoctor = role === 'DOCTOR';
  const canCreate = role === 'DOCTOR';
  const canViewDetails = role === 'DOCTOR' || role === 'PHARMACIST';

  const [patients, setPatients] = useState<Patient[]>([]);
  const [matchedPatients, setMatchedPatients] = useState<Patient[]>([]);
  const [patientSearchInput, setPatientSearchInput] = useState('');
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [queryPatientId, setQueryPatientId] = useState<number | ''>('');
  const [selectedPatientId, setSelectedPatientId] = useState<number | ''>('');
  const [selectedPatientDetails, setSelectedPatientDetails] = useState<PatientDetails | null>(null);
  const [queryDateFrom, setQueryDateFrom] = useState('');
  const [queryDateTo, setQueryDateTo] = useState('');
  const [form, setForm] = useState<PrescriptionForm>(initialForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [patientLookupLoading, setPatientLookupLoading] = useState(false);
  const [selectedPrescription, setSelectedPrescription] = useState<Prescription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const doctorId = useMemo(() => parseUserIdFromToken(sessionStorage.getItem('cms_token')), []);

  const filterPatientsForRole = useCallback(
    (list: Patient[]) => {
      if (!isDoctor) return list;
      return list.filter((p) => p.icOrPassport !== WALKIN_CUSTOMER_IC);
    },
    [isDoctor],
  );

  const loadLookups = useCallback(async () => {
    const [patientsRes, medicinesRes] = await Promise.all([
      api.get('/patients'),
      api.get('/medicine'),
    ]);
    setPatients(filterPatientsForRole(patientsRes.data as Patient[]));
    setMedicines(medicinesRes.data as Medicine[]);
  }, [filterPatientsForRole]);

  const loadPatientDetails = useCallback(async (patientId: number) => {
    try {
      const response = await api.get(`/patients/${patientId}`);
      setSelectedPatientDetails(response.data as PatientDetails);
    } catch (err: unknown) {
      setSelectedPatientDetails(null);
      setError(getApiErrorMessage(err, 'Patient record not found.'));
    }
  }, []);

  const loadPrescriptions = useCallback(async (filters?: { patientId?: number; dateFrom?: string; dateTo?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/prescriptions', {
        params: {
          patientId: filters?.patientId,
          dateFrom: filters?.dateFrom || undefined,
          dateTo: filters?.dateTo || undefined,
        },
      });
      setPrescriptions(response.data as Prescription[]);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load prescriptions'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await loadLookups();
        await loadPrescriptions();
      } catch {
        setError('Failed to load required data');
      }
    })();
  }, [loadLookups, loadPrescriptions]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void (async () => {
        await loadLookups();
        if (selectedPatientId !== '') {
          await loadPatientDetails(Number(selectedPatientId));
        }
        await loadPrescriptions({
          patientId: queryPatientId === '' ? undefined : Number(queryPatientId),
          dateFrom: queryDateFrom || undefined,
          dateTo: queryDateTo || undefined,
        });
      })();
    });
  }, [loadLookups, loadPatientDetails, loadPrescriptions, queryDateFrom, queryDateTo, queryPatientId, selectedPatientId]);

  const onSearchPatient = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const query = patientSearchInput.trim();
    if (!query) {
      setMatchedPatients([]);
      return;
    }

    setPatientLookupLoading(true);
    try {
      const response = await api.get('/patients', { params: { query } });
      const results = filterPatientsForRole(response.data as Patient[]);
      setMatchedPatients(results);
      if (results.length === 0) {
        setError('Patient record not found.');
        setSelectedPatientId('');
        setSelectedPatientDetails(null);
        return;
      }
      const nextId = results[0].patientId;
      setSelectedPatientId(nextId);
      setQueryPatientId(nextId);
      if (canCreate) {
        setForm((prev) => ({ ...prev, patientId: nextId }));
      }
      await loadPatientDetails(nextId);
      await loadPrescriptions({ patientId: nextId });
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to search patient records'));
    } finally {
      setPatientLookupLoading(false);
    }
  };

  const onSelectPatient = async (patientId: number) => {
    setSelectedPatientId(patientId);
    setQueryPatientId(patientId);
    if (canCreate) {
      setForm((prev) => ({ ...prev, patientId }));
    }
    await loadPatientDetails(patientId);
    await loadPrescriptions({ patientId });
  };

  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    await loadPrescriptions({
      patientId: queryPatientId === '' ? undefined : Number(queryPatientId),
      dateFrom: queryDateFrom || undefined,
      dateTo: queryDateTo || undefined,
    });
  };

  const onViewDetails = async (prescriptionId: number) => {
    if (!canViewDetails) return;
    setDetailsLoading(true);
    setError(null);
    try {
      const response = await api.get(`/prescriptions/${prescriptionId}`);
      setSelectedPrescription(response.data as Prescription);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load prescription details'));
    } finally {
      setDetailsLoading(false);
    }
  };

  const onAddItem = () => {
    setForm((prev) => ({ ...prev, items: [...prev.items, emptyItem()] }));
  };

  const onRemoveItem = (idx: number) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.length === 1 ? prev.items : prev.items.filter((_, i) => i !== idx),
    }));
  };

  const onUpdateItem = <K extends keyof ItemForm>(idx: number, key: K, value: ItemForm[K]) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === idx ? { ...it, [key]: value } : it)),
    }));
  };

  const resetForm = () => setForm(initialForm);

  const getFieldKey = (idx: number, key: keyof ItemForm) => `item-${idx}-${key}`;

  const validateForm = () => {
    const nextErrors: Record<string, boolean> = {};
    if (!form.patientId) nextErrors.patientId = true;

    form.items.forEach((item, idx) => {
      if (!item.medicineId) nextErrors[getFieldKey(idx, 'medicineId')] = true;
      if (!item.dosage.trim()) nextErrors[getFieldKey(idx, 'dosage')] = true;
      if (!item.frequency.trim()) nextErrors[getFieldKey(idx, 'frequency')] = true;
      if (!item.duration.trim()) nextErrors[getFieldKey(idx, 'duration')] = true;
      if (item.qty <= 0) nextErrors[getFieldKey(idx, 'qty')] = true;
    });

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!doctorId) {
      setError('Cannot determine doctor account from token. Please login again.');
      return;
    }

    if (!validateForm()) {
      setError('Incomplete prescription data.');
      return;
    }

    setSaving(true);
    try {
      await api.post('/prescriptions', {
        patientId: form.patientId,
        doctorId,
        notes: form.notes || undefined,
        items: form.items,
      });
      resetForm();
      setFieldErrors({});
      setSuccess('Prescription Saved Successfully');
      await loadPrescriptions({
        patientId: queryPatientId === '' ? undefined : Number(queryPatientId),
        dateFrom: queryDateFrom || undefined,
        dateTo: queryDateTo || undefined,
      });
      if (selectedPatientId !== '') {
        await loadPatientDetails(Number(selectedPatientId));
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to create prescription'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card">
      <div className="section-head">
        <h1>Manage Prescription</h1>
        <p className="muted">Doctors create prescriptions. Pharmacists can view and fulfill details.</p>
      </div>

      <form onSubmit={onSearchPatient} className="form-row">
        <input
          value={patientSearchInput}
          onChange={(e) => setPatientSearchInput(e.target.value)}
          placeholder="Search patient by IC/ID or phone"
        />
        <button type="submit" className="btn-secondary" disabled={patientLookupLoading}>
          {patientLookupLoading ? 'Searching...' : 'Find Patient'}
        </button>
      </form>

      {matchedPatients.length > 0 && (
        <div className="form-row" style={{ marginTop: 10 }}>
          <select
            value={selectedPatientId}
            onChange={(e) => {
              const nextId = Number(e.target.value) || 0;
              if (nextId > 0) {
                void onSelectPatient(nextId);
              }
            }}
          >
            {matchedPatients.map((p) => (
              <option key={p.patientId} value={p.patientId}>
                {p.name} — {p.icOrPassport} / {p.phone}
              </option>
            ))}
          </select>
        </div>
      )}

      {selectedPatientDetails && (
        <section className="card users-subcard" style={{ marginTop: 14 }}>
          <div className="section-head">
            <h3>Patient Information</h3>
            <p className="muted">Profile and prescription history (if available).</p>
          </div>
          <div className="form-grid">
            <p><strong>Name:</strong> {selectedPatientDetails.name}</p>
            <p><strong>IC/ID:</strong> {selectedPatientDetails.icOrPassport}</p>
            <p><strong>Phone:</strong> {selectedPatientDetails.phone}</p>
            <p><strong>Address:</strong> {selectedPatientDetails.address || '-'}</p>
            <p><strong>Gender:</strong> {prettifyGender(selectedPatientDetails.gender)}</p>
            <p><strong>DOB:</strong> {toDateInput(selectedPatientDetails.dateOfBirth)}</p>
          </div>
          <div className="stats-row" style={{ marginTop: 8 }}>
            <div className="stat-chip">Prescriptions: {selectedPatientDetails.prescriptions.length}</div>
            <div className="stat-chip">Payments: {selectedPatientDetails.payments.length}</div>
          </div>
        </section>
      )}

      <form onSubmit={onSearch} className="filters-grid">
        <select
          value={queryPatientId}
          onChange={(e) => setQueryPatientId(e.target.value ? Number(e.target.value) : '')}
        >
          <option value="">All patients</option>
          {patients.map((p) => (
            <option key={p.patientId} value={p.patientId}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={queryDateFrom}
          onChange={(e) => setQueryDateFrom(e.target.value)}
          aria-label="Date from"
        />
        <input
          type="date"
          value={queryDateTo}
          onChange={(e) => setQueryDateTo(e.target.value)}
          aria-label="Date to"
        />
        <button type="submit" className="btn-secondary">Search</button>
      </form>

      {canCreate && (
          <form onSubmit={onSubmit} className="form-grid" style={{ marginTop: 14 }}>
            <div className="section-head">
              <h3>Create Prescription</h3>
            </div>
          <select
            value={form.patientId || ''}
            onChange={(e) => setForm((prev) => ({ ...prev, patientId: Number(e.target.value) || 0 }))}
            style={fieldErrors.patientId ? { borderColor: 'var(--danger)' } : undefined}
            required
          >
            <option value="">Select patient</option>
            {patients.map((p) => (
              <option key={p.patientId} value={p.patientId}>
                {p.name}
              </option>
            ))}
          </select>

          <textarea
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
            placeholder="Notes (optional)"
            rows={3}
          />

          {form.items.map((item, idx) => (
            <div key={idx} className="items-grid">
              <select
                value={item.medicineId || ''}
                onChange={(e) => onUpdateItem(idx, 'medicineId', Number(e.target.value) || 0)}
                style={fieldErrors[getFieldKey(idx, 'medicineId')] ? { borderColor: 'var(--danger)' } : undefined}
                required
              >
                <option value="">Select medicine</option>
                {medicines.map((m) => (
                  <option key={m.medicineId} value={m.medicineId}>
                    {m.name} (Stock: {m.quantity})
                  </option>
                ))}
              </select>
              <input
                value={item.dosage}
                onChange={(e) => onUpdateItem(idx, 'dosage', e.target.value)}
                placeholder="Dosage"
                style={fieldErrors[getFieldKey(idx, 'dosage')] ? { borderColor: 'var(--danger)' } : undefined}
                required
              />
              <input
                value={item.frequency}
                onChange={(e) => onUpdateItem(idx, 'frequency', e.target.value)}
                placeholder="Frequency"
                style={fieldErrors[getFieldKey(idx, 'frequency')] ? { borderColor: 'var(--danger)' } : undefined}
                required
              />
              <input
                value={item.duration}
                onChange={(e) => onUpdateItem(idx, 'duration', e.target.value)}
                placeholder="Duration"
                style={fieldErrors[getFieldKey(idx, 'duration')] ? { borderColor: 'var(--danger)' } : undefined}
                required
              />
              <input
                type="number"
                min={1}
                value={item.qty}
                onChange={(e) => onUpdateItem(idx, 'qty', Number(e.target.value) || 1)}
                placeholder="Qty"
                style={fieldErrors[getFieldKey(idx, 'qty')] ? { borderColor: 'var(--danger)' } : undefined}
                required
              />
              <button type="button" className="btn-danger" onClick={() => onRemoveItem(idx)}>
                Remove
              </button>
            </div>
          ))}

          <div className="action-row">
            <button type="button" className="btn-secondary" onClick={onAddItem}>
              Add Item
            </button>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save Prescription'}
            </button>
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
              <th>Date</th>
              <th>Patient</th>
              <th>Notes</th>
              <th>Items</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {prescriptions.map((p) => (
              <tr key={p.prescriptionId}>
                <td>{new Date(p.date).toLocaleString()}</td>
                <td>{p.patient?.name ?? p.patientId}</td>
                <td>{p.notes || '-'}</td>
                <td>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {p.items.map((item) => (
                      <li key={item.pmId}>
                        {item.medicine?.name ?? `Medicine #${item.medicineId}`} — {item.dosage}, {item.frequency},{' '}
                        {item.duration}, qty {item.qty}
                      </li>
                    ))}
                  </ul>
                </td>
                <td>
                  {canViewDetails ? (
                    <button type="button" className="btn-secondary" onClick={() => onViewDetails(p.prescriptionId)}>
                      View Details
                    </button>
                  ) : (
                    <span className="muted">Restricted</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mobile-cards">
        {prescriptions.map((p) => (
          <article key={p.prescriptionId} className="mobile-card">
            <h4>{p.patient?.name ?? `Patient #${p.patientId}`}</h4>
            <dl className="kv">
              <div>
                <dt>Date</dt>
                <dd>{new Date(p.date).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Notes</dt>
                <dd>{p.notes || '-'}</dd>
              </div>
            </dl>
            <ul className="mobile-list">
              {p.items.map((item) => (
                <li key={item.pmId}>
                  {item.medicine?.name ?? `Medicine #${item.medicineId}`} — {item.dosage}, {item.frequency},{' '}
                  {item.duration}, qty {item.qty}
                </li>
              ))}
            </ul>
            {canViewDetails && (
              <div className="action-row" style={{ marginTop: 10 }}>
                <button type="button" className="btn-secondary" onClick={() => onViewDetails(p.prescriptionId)}>
                  View Details
                </button>
              </div>
            )}
          </article>
        ))}
      </div>

      {!loading && prescriptions.length === 0 && <p className="muted">No prescriptions found for current filters.</p>}

      {(detailsLoading || selectedPrescription) && canViewDetails && (
        <section className="card prescription-details prescription-print-area" style={{ marginTop: 16 }}>
          <div className="section-head">
            <h3>Prescription Details</h3>
            <p className="muted">Detailed view for doctor/pharmacist review.</p>
          </div>

          {detailsLoading && <p className="muted">Loading details...</p>}

          {!detailsLoading && selectedPrescription && (
            <div className="stack">
              <dl className="kv">
                <div>
                  <dt>Prescription ID</dt>
                  <dd>#{selectedPrescription.prescriptionId}</dd>
                </div>
                <div>
                  <dt>Patient</dt>
                  <dd>{selectedPrescription.patient?.name ?? `Patient #${selectedPrescription.patientId}`}</dd>
                </div>
                <div>
                  <dt>Date</dt>
                  <dd>{new Date(selectedPrescription.date).toLocaleString()}</dd>
                </div>
                <div>
                  <dt>Notes</dt>
                  <dd>{selectedPrescription.notes || '-'}</dd>
                </div>
              </dl>

              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Medicine</th>
                      <th>Dosage</th>
                      <th>Frequency</th>
                      <th>Duration</th>
                      <th>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedPrescription.items.map((item) => (
                      <tr key={item.pmId}>
                        <td>{item.medicine?.name ?? `Medicine #${item.medicineId}`}</td>
                        <td>{item.dosage}</td>
                        <td>{item.frequency}</td>
                        <td>{item.duration}</td>
                        <td>{item.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="action-row prescription-print-actions">
                <button type="button" className="prescription-print-button" onClick={() => window.print()}>
                  Print Prescription
                </button>
                <button type="button" className="btn-secondary" onClick={() => setSelectedPrescription(null)}>
                  Close Details
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </section>
  );
};
