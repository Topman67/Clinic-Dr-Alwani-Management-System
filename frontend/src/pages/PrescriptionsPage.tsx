import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { subscribeInAppDataSync } from '../lib/sync';
import { PatientAutocomplete, type PatientAutocompleteOption } from '../components/PatientAutocomplete';
import { DateRangeFilter, getDateRangeForPreset, type DateRangeValue } from '../components/DateRangeFilter';
import clinicLogo from '../assets/Logo_Clinic_Dr.Alwani.png';

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
  batchNumber?: string;
  quantity: number;
  expiryDate: string;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
};

type PrescriptionItem = {
  pmId: number;
  medicineId: number;
  dosage: string;
  frequency: string;
  duration: string;
  qty: number;
  medicine?: { name: string; batchNumber?: string; expiryDate?: string; quantity?: number };
};

type Prescription = {
  prescriptionId: number;
  patientId: number;
  doctorId: number;
  consultationId?: number | null;
  date: string;
  notes?: string | null;
  patient?: { name: string; icOrPassport?: string | null; phone?: string | null };
  doctor?: { username: string };
  consultation?: { consultationId: number; createdAt?: string; diagnosis?: string | null } | null;
  items: PrescriptionItem[];
};

type ConsultationOption = {
  consultationId: number;
  appointmentId?: number | null;
  createdAt: string;
  status: 'WAITING' | 'IN_PROGRESS' | 'COMPLETED';
  diagnosis?: string | null;
  prescription?: { prescriptionId: number; date: string } | null;
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
const CLINIC_NAME = 'Clinic Dr. Alwani';

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

const toDisplayDateTime = (value: string | null | undefined) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
};

const getMedicineExpiryStatus = (medicine: Medicine | undefined) => {
  if (!medicine?.expiryDate) return 'OK' as const;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(medicine.expiryDate);
  expiry.setHours(0, 0, 0, 0);
  const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / 86_400_000);
  if (daysUntilExpiry < 0) return 'EXPIRED' as const;
  if (daysUntilExpiry <= 30) return 'NEAR_EXPIRY' as const;
  return 'OK' as const;
};

const getMedicineOptionLabel = (medicine: Medicine) => {
  const status = getMedicineExpiryStatus(medicine);
  const statusLabel = status === 'EXPIRED' ? ' - Expired' : status === 'NEAR_EXPIRY' ? ' - Near Expiry' : '';
  const batchLabel = medicine.batchNumber ? `Batch: ${medicine.batchNumber} - ` : '';
  return `${medicine.name} - ${batchLabel}Stock: ${medicine.quantity} - Exp: ${toDateInput(medicine.expiryDate)}${statusLabel}`;
};

const getPrescriptionItemsSummary = (items: PrescriptionItem[]) => {
  if (items.length === 0) return '-';
  const first = items[0];
  const firstName = first.medicine?.name ?? `Medicine #${first.medicineId}`;
  return items.length === 1 ? `${firstName} x${first.qty}` : `${firstName} x${first.qty} + ${items.length - 1} more`;
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
  const [searchParams, setSearchParams] = useSearchParams();
  const isDoctor = role === 'DOCTOR';
  const canCreate = role === 'DOCTOR';
  const canViewDetails = role === 'DOCTOR' || role === 'PHARMACIST';

  const [patients, setPatients] = useState<Patient[]>([]);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [selectedFilterPatient, setSelectedFilterPatient] = useState<PatientAutocompleteOption | null>(null);
  const [selectedFormPatient, setSelectedFormPatient] = useState<PatientAutocompleteOption | null>(null);
  const [selectedPatientDetails, setSelectedPatientDetails] = useState<PatientDetails | null>(null);
  const [dateRange, setDateRange] = useState<DateRangeValue>(() => getDateRangeForPreset('last7'));
  const [form, setForm] = useState<PrescriptionForm>(initialForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [selectedPrescription, setSelectedPrescription] = useState<Prescription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [linkedAppointmentId, setLinkedAppointmentId] = useState<number | null>(null);
  const [linkedConsultationId, setLinkedConsultationId] = useState<number | null>(null);
  const [availableConsultations, setAvailableConsultations] = useState<ConsultationOption[]>([]);

  const doctorId = useMemo(() => parseUserIdFromToken(sessionStorage.getItem('cms_token')), []);
  const initialPatientIdFromQuery = useMemo(() => Number(searchParams.get('patientId') || 0), [searchParams]);
  const initialAppointmentIdFromQuery = useMemo(() => Number(searchParams.get('appointmentId') || 0), [searchParams]);
  const initialConsultationIdFromQuery = useMemo(() => Number(searchParams.get('consultationId') || 0), [searchParams]);
  const medicineById = useMemo(() => new Map(medicines.map((medicine) => [medicine.medicineId, medicine])), [medicines]);
  const selectedConsultation = useMemo(
    () => availableConsultations.find((consultation) => consultation.consultationId === linkedConsultationId) ?? null,
    [availableConsultations, linkedConsultationId],
  );
  const selectedConsultationPrescriptionId = selectedConsultation?.prescription?.prescriptionId ?? null;
  const hasSelectedCompletedConsultation = Boolean(selectedConsultation && selectedConsultation.status === 'COMPLETED');

  const filterPatientsForRole = useCallback(
    (list: Patient[]) => {
      if (!isDoctor) return list;
      return list.filter((p) => p.icOrPassport !== WALKIN_CUSTOMER_IC);
    },
    [isDoctor],
  );

  const findPatientOptionById = useCallback(
    (patientId: number) => {
      return patients.find((patient) => patient.patientId === patientId) ?? null;
    },
    [patients],
  );

  const loadLookups = useCallback(async () => {
    const [patientsRes, medicinesRes] = await Promise.all([
      api.get('/patients'),
      api.get('/medicine'),
    ]);
    setPatients(filterPatientsForRole(patientsRes.data as Patient[]));
    setMedicines(
      [...(medicinesRes.data as Medicine[])].sort((a, b) => {
        const statusRank = (medicine: Medicine) => {
          if (medicine.approvalStatus && medicine.approvalStatus !== 'APPROVED') return 3;
          const expiryStatus = getMedicineExpiryStatus(medicine);
          if (expiryStatus === 'EXPIRED') return 2;
          return 1;
        };
        const rankDiff = statusRank(a) - statusRank(b);
        if (rankDiff !== 0) return rankDiff;
        return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
      }),
    );
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

  const loadAvailableConsultations = useCallback(async (patientId: number) => {
    try {
      const response = await api.get('/consultations', {
        params: {
          status: 'COMPLETED',
          patientId,
        },
      });

      const consultations = response.data as ConsultationOption[];
      setAvailableConsultations(consultations);

      if (linkedConsultationId && consultations.some((consultation) => consultation.consultationId === linkedConsultationId)) {
        return;
      }

      const nextConsultation = consultations.find((consultation) => !consultation.prescription) ?? consultations[0] ?? null;
      setLinkedConsultationId(nextConsultation?.consultationId ?? null);
      setLinkedAppointmentId(nextConsultation?.appointmentId ?? null);
    } catch {
      setAvailableConsultations([]);
    }
  }, [linkedConsultationId]);

  useEffect(() => {
    void (async () => {
      try {
        await loadLookups();
        await loadPrescriptions({
          patientId: selectedFilterPatient?.patientId,
          dateFrom: dateRange.dateFrom,
          dateTo: dateRange.dateTo,
        });
      } catch {
        setError('Failed to load required data');
      }
    })();
  }, [dateRange.dateFrom, dateRange.dateTo, loadLookups, loadPrescriptions, selectedFilterPatient]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void (async () => {
        await loadLookups();
        if (selectedFilterPatient?.patientId) {
          await loadPatientDetails(selectedFilterPatient.patientId);
        }
          await loadPrescriptions({
          patientId: selectedFilterPatient?.patientId,
          dateFrom: dateRange.dateFrom || undefined,
          dateTo: dateRange.dateTo || undefined,
        });
      })();
    });
  }, [dateRange.dateFrom, dateRange.dateTo, loadLookups, loadPatientDetails, loadPrescriptions, selectedFilterPatient]);

  useEffect(() => {
    if (initialPatientIdFromQuery <= 0) return;

    const patient = findPatientOptionById(initialPatientIdFromQuery);
    if (!patient) return;

    setSelectedFilterPatient(patient);
    setSelectedFormPatient(patient);
    setForm((prev) => ({ ...prev, patientId: initialPatientIdFromQuery }));
    void loadPatientDetails(initialPatientIdFromQuery);
    void loadPrescriptions({ patientId: initialPatientIdFromQuery });
    if (canCreate) {
      void loadAvailableConsultations(initialPatientIdFromQuery);
    }

    if (canCreate && initialConsultationIdFromQuery > 0) {
      setLinkedConsultationId(initialConsultationIdFromQuery);
      setLinkedAppointmentId(initialAppointmentIdFromQuery > 0 ? initialAppointmentIdFromQuery : null);
    }
  }, [
    canCreate,
    findPatientOptionById,
    initialAppointmentIdFromQuery,
    initialConsultationIdFromQuery,
    initialPatientIdFromQuery,
    loadAvailableConsultations,
    loadPatientDetails,
    loadPrescriptions,
  ]);

  const onFilterPatientChange = async (patient: PatientAutocompleteOption | null) => {
    setError(null);
    setSuccess(null);
    setSelectedFilterPatient(patient);
    setSelectedPatientDetails(null);
    if (!patient) {
      await loadPrescriptions({
        dateFrom: dateRange.dateFrom || undefined,
        dateTo: dateRange.dateTo || undefined,
      });
      return;
    }

    await loadPatientDetails(patient.patientId);
    await loadPrescriptions({
      patientId: patient.patientId,
      dateFrom: dateRange.dateFrom || undefined,
      dateTo: dateRange.dateTo || undefined,
    });
  };

  const onFormPatientChange = (patient: PatientAutocompleteOption | null) => {
    setSelectedFormPatient(patient);
    setForm((prev) => ({ ...prev, patientId: patient?.patientId ?? 0 }));
    setAvailableConsultations([]);

    if (!canCreate) return;

    if (!patient) {
      setLinkedAppointmentId(null);
      setLinkedConsultationId(null);
      setSearchParams({});
      return;
    }

    setLinkedAppointmentId(null);
    setLinkedConsultationId(null);
    setSearchParams({});
    void loadPatientDetails(patient.patientId);
    void loadAvailableConsultations(patient.patientId);
  };

  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    await loadPrescriptions({
      patientId: selectedFilterPatient?.patientId,
      dateFrom: dateRange.dateFrom || undefined,
      dateTo: dateRange.dateTo || undefined,
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

  const resetForm = () => {
    setForm(initialForm);
    setSelectedFormPatient(null);
  };

  const getFieldKey = (idx: number, key: keyof ItemForm) => `item-${idx}-${key}`;

  const validateForm = () => {
    const nextErrors: Record<string, boolean> = {};
    let validationMessage: string | null = null;
    if (!form.patientId) nextErrors.patientId = true;

    const requestedTotals = new Map<number, number>();
    form.items.forEach((item) => {
      if (item.medicineId > 0) {
        requestedTotals.set(item.medicineId, (requestedTotals.get(item.medicineId) ?? 0) + item.qty);
      }
    });

    form.items.forEach((item, idx) => {
      if (!item.medicineId) nextErrors[getFieldKey(idx, 'medicineId')] = true;
      if (!item.dosage.trim()) nextErrors[getFieldKey(idx, 'dosage')] = true;
      if (!item.frequency.trim()) nextErrors[getFieldKey(idx, 'frequency')] = true;
      if (!item.duration.trim()) nextErrors[getFieldKey(idx, 'duration')] = true;
      if (item.qty <= 0) nextErrors[getFieldKey(idx, 'qty')] = true;

      const medicine = medicineById.get(item.medicineId);
      if (medicine) {
        const expiryStatus = getMedicineExpiryStatus(medicine);
        if (expiryStatus === 'EXPIRED') {
          nextErrors[getFieldKey(idx, 'medicineId')] = true;
          validationMessage = `${medicine.name} is expired and cannot be prescribed.`;
        }
      }
    });

    for (const [medicineId, requestedQty] of requestedTotals.entries()) {
      const medicine = medicineById.get(medicineId);
      if (medicine && requestedQty > medicine.quantity) {
        validationMessage = `Insufficient stock for ${medicine.name}. Available quantity: ${medicine.quantity}.`;
        form.items.forEach((item, idx) => {
          if (item.medicineId === medicineId) {
            nextErrors[getFieldKey(idx, 'qty')] = true;
          }
        });
      }
    }

    setFieldErrors(nextErrors);
    if (validationMessage) setError(validationMessage);
    return Object.keys(nextErrors).length === 0;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setError(null);
    setSuccess(null);

    if (!doctorId) {
      setError('Cannot determine doctor account from token. Please login again.');
      return;
    }

    if (!linkedConsultationId) {
      setError('Create prescriptions from a completed consultation.');
      return;
    }

    if (!hasSelectedCompletedConsultation) {
      setError('Select a completed consultation before creating prescription.');
      return;
    }

    if (selectedConsultationPrescriptionId) {
      setError('This consultation already has a prescription.');
      return;
    }

    if (!validateForm()) {
      setError('Incomplete prescription data.');
      return;
    }

    setSaving(true);
    try {
      const response = await api.post('/prescriptions', {
        patientId: form.patientId,
        doctorId,
        consultationId: linkedConsultationId,
        appointmentId: linkedAppointmentId ?? undefined,
        notes: form.notes || undefined,
        items: form.items,
      });
      const createdPrescription = response.data as Prescription;
      resetForm();
      setLinkedAppointmentId(null);
      setLinkedConsultationId(null);
      setSearchParams({});
      setFieldErrors({});
      setSuccess('Prescription Saved Successfully');
      setSelectedPrescription(createdPrescription);
      await loadLookups();
      await loadPrescriptions({
        patientId: selectedFilterPatient?.patientId,
        dateFrom: dateRange.dateFrom || undefined,
        dateTo: dateRange.dateTo || undefined,
      });
      if (selectedFilterPatient?.patientId) {
        await loadPatientDetails(selectedFilterPatient.patientId);
      }
      if (form.patientId) {
        await loadAvailableConsultations(form.patientId);
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to create prescription'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="prescription-page">
      <div className="section-head prescription-page-head">
        <div>
          <h1>Manage Prescription</h1>
          <p className="muted">Create one prescription per completed consultation and keep medicine stock accurate.</p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {success && <p className="success-text">{success}</p>}

      {linkedConsultationId && (
        <section className="prescription-linked-banner">
          <div>
            <span>Linked Consultation</span>
            <strong>Consultation #{linkedConsultationId}</strong>
            <small>{linkedAppointmentId ? `Appointment #${linkedAppointmentId}` : 'No appointment linked'}</small>
          </div>
          {selectedConsultationPrescriptionId && (
            <button type="button" className="btn-secondary" onClick={() => void onViewDetails(selectedConsultationPrescriptionId)}>
              View Prescription
            </button>
          )}
        </section>
      )}

      <section className="card prescription-filter-card">
        <form onSubmit={onSearch} className="prescription-filter-bar">
          <PatientAutocomplete
            selectedPatient={selectedFilterPatient}
            onSelect={(patient) => {
              void onFilterPatientChange(patient);
            }}
            placeholder="Filter prescriptions by patient"
          />
          <DateRangeFilter value={dateRange} onChange={setDateRange} includeAll />
          <button
            type="button"
            className="btn-secondary consultation-clear-button"
            onClick={() => {
              setSelectedFilterPatient(null);
              setSelectedPatientDetails(null);
              setDateRange(getDateRangeForPreset('last7'));
            }}
          >
            Reset
          </button>
          <button type="submit" className="btn-secondary consultation-refresh-button">Search</button>
        </form>
      </section>

      {canCreate && (
        <div className="prescription-workflow-grid">
          <section className="card prescription-patient-card">
            <div className="section-head compact-section-head">
              <h3>Selected Patient</h3>
              <p className="muted">Patient and consultation context for this prescription.</p>
            </div>

            {selectedPatientDetails ? (
              <>
                <div className="prescription-patient-grid">
                  <div><span>Name</span><strong>{selectedPatientDetails.name}</strong></div>
                  <div><span>IC/ID</span><strong>{selectedPatientDetails.icOrPassport}</strong></div>
                  <div><span>Phone</span><strong>{selectedPatientDetails.phone}</strong></div>
                  <div><span>Gender</span><strong>{prettifyGender(selectedPatientDetails.gender)}</strong></div>
                  <div><span>DOB</span><strong>{toDateInput(selectedPatientDetails.dateOfBirth)}</strong></div>
                  <div className="prescription-address-cell"><span>Address</span><strong>{selectedPatientDetails.address || '-'}</strong></div>
                </div>
                <div className="prescription-mini-stats">
                  <span>Prescriptions {selectedPatientDetails.prescriptions.length}</span>
                  <span>Payments {selectedPatientDetails.payments.length}</span>
                </div>
              </>
            ) : (
              <div className="prescription-empty-panel">
                <strong>No patient selected</strong>
                <span>Search a patient in the creation card to start.</span>
              </div>
            )}
          </section>

          <form onSubmit={onSubmit} className="card prescription-create-card">
            <div className="section-head compact-section-head">
              <h3>Create Prescription</h3>
              <p className="muted">Completed consultations only. Duplicate prescriptions are blocked.</p>
            </div>

            <div className="prescription-context-grid">
              <PatientAutocomplete
                selectedPatient={selectedFormPatient}
                onSelect={onFormPatientChange}
                placeholder="Search patient..."
                invalid={Boolean(fieldErrors.patientId)}
                helperText="Patient selection is required."
                required
              />

              <label className="field-block">
                <span>Completed Consultation</span>
                <select
                  value={linkedConsultationId ?? ''}
                  onChange={(e) => {
                    const consultationId = Number(e.target.value) || 0;
                    const nextConsultation =
                      availableConsultations.find((consultation) => consultation.consultationId === consultationId) ?? null;
                    setLinkedConsultationId(nextConsultation?.consultationId ?? null);
                    setLinkedAppointmentId(nextConsultation?.appointmentId ?? null);
                  }}
                  disabled={!selectedFormPatient || availableConsultations.length === 0}
                >
                  <option value="">
                    {!selectedFormPatient
                      ? 'Select patient first'
                      : availableConsultations.length === 0
                        ? 'No completed consultation available'
                        : 'Select completed consultation'}
                  </option>
                  {availableConsultations.map((consultation) => (
                    <option key={consultation.consultationId} value={consultation.consultationId}>
                      {`Consultation #${consultation.consultationId} - ${toDisplayDateTime(consultation.createdAt)}${
                        consultation.diagnosis ? ` - ${consultation.diagnosis}` : ''
                      }${consultation.prescription ? ' - Prescription Created' : ''}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {selectedFormPatient && !linkedConsultationId && (
              <p className="muted">Complete a consultation for this patient first, then select it here to create the prescription.</p>
            )}

            {selectedConsultation && (
              <section className="prescription-consultation-card">
                <div>
                  <span>Selected Consultation</span>
                  <strong>Consultation #{selectedConsultation.consultationId}</strong>
                  <small>{selectedConsultation.diagnosis ? `Diagnosis: ${selectedConsultation.diagnosis}` : 'Diagnosis not recorded'}</small>
                  <small>Date: {toDisplayDateTime(selectedConsultation.createdAt)}</small>
                </div>
                {selectedConsultationPrescriptionId ? (
                  <span className="status-badge status-warning">Prescription Created</span>
                ) : (
                  <span className="status-badge status-good">Ready</span>
                )}
              </section>
            )}

            {selectedConsultationPrescriptionId && (
              <div className="prescription-duplicate-notice">
                <span>This consultation already has a prescription.</span>
                <button type="button" className="btn-secondary" onClick={() => void onViewDetails(selectedConsultationPrescriptionId)}>
                  View Prescription
                </button>
              </div>
            )}

            <label className="field-block">
              <span>Prescription Notes</span>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
                placeholder="Notes (optional)"
                rows={3}
              />
            </label>

            <div className="prescription-items-head">
              <div>
                <h4>Medicine Items</h4>
                <p className="muted">Expired medicines are blocked. Near-expiry items are marked.</p>
              </div>
              <button type="button" className="btn-secondary" onClick={onAddItem}>
                Add Item
              </button>
            </div>

            <div className="prescription-items-list">
              {form.items.map((item, idx) => {
                const selectedMedicine = medicineById.get(item.medicineId);
                const expiryStatus = getMedicineExpiryStatus(selectedMedicine);
                return (
                  <div key={idx} className="prescription-item-row">
                    <label>
                      <span>Medicine</span>
                      <select
                        value={item.medicineId || ''}
                        onChange={(e) => onUpdateItem(idx, 'medicineId', Number(e.target.value) || 0)}
                        className={fieldErrors[getFieldKey(idx, 'medicineId')] ? 'field-invalid' : undefined}
                        required
                      >
                        <option value="">Select medicine</option>
                        {medicines.map((medicine) => {
                          const status = getMedicineExpiryStatus(medicine);
                          const disabled =
                            status === 'EXPIRED' ||
                            medicine.quantity <= 0 ||
                            (medicine.approvalStatus !== undefined && medicine.approvalStatus !== 'APPROVED');
                          return (
                            <option key={medicine.medicineId} value={medicine.medicineId} disabled={disabled}>
                              {getMedicineOptionLabel(medicine)}{medicine.quantity <= 0 ? ' - Out of Stock' : ''}
                            </option>
                          );
                        })}
                      </select>
                      {expiryStatus === 'NEAR_EXPIRY' && <small className="medicine-warning">Near Expiry</small>}
                      {expiryStatus === 'EXPIRED' && <small className="medicine-danger">Expired</small>}
                    </label>
                    <label>
                      <span>Dosage</span>
                      <input
                        value={item.dosage}
                        onChange={(e) => onUpdateItem(idx, 'dosage', e.target.value)}
                        placeholder="e.g. 500mg"
                        className={fieldErrors[getFieldKey(idx, 'dosage')] ? 'field-invalid' : undefined}
                        required
                      />
                    </label>
                    <label>
                      <span>Frequency</span>
                      <input
                        value={item.frequency}
                        onChange={(e) => onUpdateItem(idx, 'frequency', e.target.value)}
                        placeholder="e.g. 3x/day"
                        className={fieldErrors[getFieldKey(idx, 'frequency')] ? 'field-invalid' : undefined}
                        required
                      />
                    </label>
                    <label>
                      <span>Duration</span>
                      <input
                        value={item.duration}
                        onChange={(e) => onUpdateItem(idx, 'duration', e.target.value)}
                        placeholder="e.g. 5 days"
                        className={fieldErrors[getFieldKey(idx, 'duration')] ? 'field-invalid' : undefined}
                        required
                      />
                    </label>
                    <label>
                      <span>Qty</span>
                      <input
                        type="number"
                        min={1}
                        value={item.qty}
                        onChange={(e) => onUpdateItem(idx, 'qty', Number(e.target.value) || 1)}
                        placeholder="Qty"
                        className={fieldErrors[getFieldKey(idx, 'qty')] ? 'field-invalid' : undefined}
                        required
                      />
                    </label>
                    <button type="button" className="btn-danger prescription-remove-item" onClick={() => onRemoveItem(idx)}>
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="action-row prescription-create-actions">
              <button type="submit" disabled={saving || !hasSelectedCompletedConsultation || Boolean(selectedConsultationPrescriptionId)}>
                {saving ? 'Saving Prescription...' : 'Save Prescription'}
              </button>
            </div>
          </form>
        </div>
      )}

      <section className="card prescription-list-card">
        <div className="section-head compact-section-head">
          <h3>Prescription List</h3>
          <p className="muted">Filtered by the selected patient and date range.</p>
        </div>

        {loading && <p className="muted">Loading prescriptions...</p>}

        <div className="table-wrap">
          <table className="data-table prescription-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Patient</th>
                <th>Consultation</th>
                <th>Items</th>
                <th>Notes</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {prescriptions.map((p) => (
                <tr key={p.prescriptionId}>
                  <td>{toDisplayDateTime(p.date)}</td>
                  <td>
                    <strong>{p.patient?.name ?? `Patient #${p.patientId}`}</strong>
                    <small>{p.patient?.icOrPassport ?? ''}</small>
                  </td>
                  <td>{p.consultationId ? `#${p.consultationId}` : '-'}</td>
                  <td>{getPrescriptionItemsSummary(p.items)}</td>
                  <td className="prescription-notes-cell">{p.notes || '-'}</td>
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
                <div><dt>Date</dt><dd>{toDisplayDateTime(p.date)}</dd></div>
                <div><dt>Consult</dt><dd>{p.consultationId ? `#${p.consultationId}` : '-'}</dd></div>
                <div><dt>Items</dt><dd>{getPrescriptionItemsSummary(p.items)}</dd></div>
                <div><dt>Notes</dt><dd>{p.notes || '-'}</dd></div>
              </dl>
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
      </section>

      {(detailsLoading || selectedPrescription) && canViewDetails && (
        <div className="appointment-drawer-layer prescription-details-layer" role="presentation">
          <button type="button" className="patient-drawer-backdrop" aria-label="Close prescription details" onClick={() => setSelectedPrescription(null)} disabled={detailsLoading} />
          <aside className="patient-drawer prescription-details-drawer" role="dialog" aria-modal="true" aria-labelledby="prescription-details-title">
            <div className="patient-drawer-head">
              <div>
                <h3 id="prescription-details-title">Prescription Details</h3>
                <p className="muted">Read-only prescription review and print view.</p>
              </div>
              <button type="button" className="patient-drawer-close" onClick={() => setSelectedPrescription(null)} disabled={detailsLoading}>
                X
              </button>
            </div>

            <div className="patient-drawer-body">
              {detailsLoading && <p className="muted">Loading details...</p>}

              {!detailsLoading && selectedPrescription && (
                <div className="prescription-details-stack">
                  <section className="prescription-print-area prescription-print-sheet">
                    <div className="prescription-print-header-block">
                      <img src={clinicLogo} alt={CLINIC_NAME} />
                      <div>
                        <h3>{CLINIC_NAME}</h3>
                        <p>Prescription #{selectedPrescription.prescriptionId}</p>
                      </div>
                    </div>

                    <dl className="prescription-details-grid">
                      <div><dt>Patient</dt><dd>{selectedPrescription.patient?.name ?? `Patient #${selectedPrescription.patientId}`}</dd></div>
                      <div><dt>IC/ID</dt><dd>{selectedPrescription.patient?.icOrPassport ?? '-'}</dd></div>
                      <div><dt>Consultation Date</dt><dd>{toDisplayDateTime(selectedPrescription.consultation?.createdAt ?? selectedPrescription.date)}</dd></div>
                      <div><dt>Doctor</dt><dd>{selectedPrescription.doctor?.username ?? 'Doctor'}</dd></div>
                      <div><dt>Consultation</dt><dd>{selectedPrescription.consultationId ? `#${selectedPrescription.consultationId}` : '-'}</dd></div>
                      <div><dt>Diagnosis</dt><dd>{selectedPrescription.consultation?.diagnosis ?? '-'}</dd></div>
                      <div className="prescription-details-wide"><dt>Notes</dt><dd>{selectedPrescription.notes || '-'}</dd></div>
                    </dl>

                    <div className="table-wrap prescription-detail-table-wrap">
                      <table className="data-table prescription-detail-table">
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
                  </section>

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
            </div>
          </aside>
        </div>
      )}
    </section>
  );

  /*
  Legacy inline prescription layout kept out of the runtime after the drawer-based refactor.
  return (
    <section className="card">
      <div className="section-head">
        <h1>Manage Prescription</h1>
        <p className="muted">Doctors create prescriptions from completed consultations. Pharmacists can view and fulfill details.</p>
      </div>

      {linkedConsultationId && (
        <p className="muted" style={{ color: 'var(--primary)', marginBottom: 12 }}>
          Prescription linked to Consultation #{linkedConsultationId}
          {linkedAppointmentId ? ` and Appointment #${linkedAppointmentId}` : ''}.
        </p>
      )}

      {selectedPatientDetails && (
        <section className="card users-subcard" style={{ marginTop: 14 }}>
          <div className="section-head">
            <h3>Patient Information</h3>
            <p className="muted">Profile and prescription history (if available).</p>
          </div>
          <div className="form-grid">
            <p><strong>Name:</strong> {selectedPatientDetails?.name}</p>
            <p><strong>IC/ID:</strong> {selectedPatientDetails?.icOrPassport}</p>
            <p><strong>Phone:</strong> {selectedPatientDetails?.phone}</p>
            <p><strong>Address:</strong> {selectedPatientDetails?.address || '-'}</p>
            <p><strong>Gender:</strong> {prettifyGender(selectedPatientDetails?.gender ?? null)}</p>
            <p><strong>DOB:</strong> {toDateInput(selectedPatientDetails?.dateOfBirth)}</p>
          </div>
          <div className="stats-row" style={{ marginTop: 8 }}>
            <div className="stat-chip">Prescriptions: {selectedPatientDetails?.prescriptions.length ?? 0}</div>
            <div className="stat-chip">Payments: {selectedPatientDetails?.payments.length ?? 0}</div>
          </div>
        </section>
      )}

      <form onSubmit={onSearch} className="filters-grid">
        <PatientAutocomplete
          selectedPatient={selectedFilterPatient}
          onSelect={(patient) => {
            void onFilterPatientChange(patient);
          }}
          placeholder="Filter prescriptions by patient"
        />
        <DateRangeFilter value={dateRange} onChange={setDateRange} includeAll />
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setSelectedFilterPatient(null);
            setSelectedPatientDetails(null);
            setDateRange(getDateRangeForPreset('last7'));
          }}
        >
          Reset
        </button>
        <button type="submit" className="btn-secondary">Search</button>
      </form>

      {canCreate && (
          <form onSubmit={onSubmit} className="form-grid" style={{ marginTop: 14 }}>
            <div className="section-head">
              <h3>Create Prescription</h3>
            </div>
          <PatientAutocomplete
            selectedPatient={selectedFormPatient}
            onSelect={onFormPatientChange}
            placeholder="Select patient for this prescription"
            invalid={Boolean(fieldErrors.patientId)}
            helperText="Patient selection is required."
            required
          />

          <select
            value={linkedConsultationId ?? ''}
            onChange={(e) => {
              const consultationId = Number(e.target.value) || 0;
              const selectedConsultation =
                availableConsultations.find((consultation) => consultation.consultationId === consultationId) ?? null;
              setLinkedConsultationId(selectedConsultation?.consultationId ?? null);
              setLinkedAppointmentId(selectedConsultation?.appointmentId ?? null);
            }}
            disabled={!selectedFormPatient || availableConsultations.length === 0}
          >
            <option value="">
              {!selectedFormPatient
                ? 'Select patient first'
                : availableConsultations.length === 0
                  ? 'No completed consultation available'
                  : 'Select completed consultation'}
            </option>
            {availableConsultations.map((consultation) => (
              <option key={consultation.consultationId} value={consultation.consultationId}>
                {`Consultation #${consultation.consultationId} - ${new Date(consultation.createdAt).toLocaleString()}${
                  consultation.diagnosis ? ` - ${consultation.diagnosis}` : ''
                }`}
              </option>
            ))}
          </select>
          {selectedFormPatient && !linkedConsultationId && (
            <p className="muted">Complete a consultation for this patient first, then select it here to create the prescription.</p>
          )}

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
              <th>Consultation</th>
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
                <td>{p.consultationId ? `#${p.consultationId}` : '-'}</td>
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
              <div>
                <dt>Consult</dt>
                <dd>{p.consultationId ? `#${p.consultationId}` : '-'}</dd>
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
                  <dd>#{selectedPrescription?.prescriptionId}</dd>
                </div>
                <div>
                  <dt>Patient</dt>
                  <dd>{selectedPrescription?.patient?.name ?? `Patient #${selectedPrescription?.patientId}`}</dd>
                </div>
                <div>
                  <dt>Consultation</dt>
                  <dd>{selectedPrescription?.consultationId ? `#${selectedPrescription?.consultationId}` : '-'}</dd>
                </div>
                <div>
                  <dt>Date</dt>
                  <dd>{toDisplayDateTime(selectedPrescription?.date)}</dd>
                </div>
                <div>
                  <dt>Notes</dt>
                  <dd>{selectedPrescription?.notes || '-'}</dd>
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
                    {selectedPrescription?.items.map((item) => (
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
  */
};
