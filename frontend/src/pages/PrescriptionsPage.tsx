import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { exportHtmlAsPdf } from '../lib/exportDocuments';
import { useAuth } from '../context/AuthContext';
import { subscribeInAppDataSync } from '../lib/sync';
import { PatientAutocomplete, type PatientAutocompleteOption } from '../components/PatientAutocomplete';
import { DateRangeFilter } from '../components/DateRangeFilter';
import { getDateRangeForPreset, type DateRangeValue } from '../lib/dateRange';
import { MedicineSelectorModal, type MedicineSelectorCategory } from '../components/shared/MedicineSelectorModal';
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
  category?: 'MEDICINE' | 'SUPPLEMENT' | 'VITAMIN' | 'CONTROLLED_MEDICINE';
  brand?: string | null;
  content?: string | null;
  packaging?: string | null;
  stockUnit: 'tablet' | 'capsule' | 'bottle' | 'tube' | 'sachet' | 'pack' | 'box';
  batchNumber?: string;
  quantity: number;
  expiryDate: string;
  price?: number | string;
  approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
  availableForPrescription?: boolean;
};

type PrescriptionItem = {
  pmId: number;
  medicineId: number;
  dosage: string;
  frequency: string;
  duration: string;
  qty: number;
  medicine?: { medicineId?: number; name: string; packaging?: string | null; stockUnit?: Medicine['stockUnit']; batchNumber?: string; expiryDate?: string; quantity?: number; price?: number | string; approvalStatus?: Medicine['approvalStatus'] };
};

type PrescriptionStatus = 'PENDING' | 'PENDING_VERIFICATION' | 'VERIFIED' | 'DISPENSED' | 'REJECTED';
type PrescriptionDetailsTab = 'details' | 'medicines' | 'print' | 'audit';
type DoctorPrescriptionTab = 'create' | 'history';
type MedicinePickerCategory = 'DEFAULT' | 'ALL' | NonNullable<Medicine['category']>;
type MedicinePickerStockFilter = 'IN_STOCK';
type MedicinePickerExpiryFilter = 'VALID';

type Prescription = {
  prescriptionId: number;
  patientId: number;
  doctorId: number;
  consultationId?: number | null;
  date: string;
  status?: PrescriptionStatus;
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
  symptoms?: string | null;
  diagnosis?: string | null;
  prescription?: { prescriptionId: number; date: string } | null;
};

type ItemForm = {
  rowKey: string;
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

const escapePdfText = (value: string | number | null | undefined) =>
  String(value ?? '-')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const prescriptionPdfShell = (title: string, body: string) => `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Export</title>
    <style>
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #fff; color: #1f2933; font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.45; }
      header { display: flex; align-items: center; gap: 14px; border-bottom: 1.5px solid #2f343a; padding-bottom: 12px; margin-bottom: 16px; }
      header img { width: 58px; height: 58px; object-fit: contain; filter: grayscale(100%); }
      h1, h2, h3, p { margin: 0; }
      h1 { font-size: 20px; color: #111827; }
      h2 { font-size: 15px; color: #2f343a; margin-top: 2px; }
      h3 { font-size: 13px; margin: 16px 0 8px; color: #2f343a; }
      .meta { color: #555f6d; margin-top: 4px; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 14px; margin-bottom: 12px; }
      .field { border-bottom: 1px solid #d8dce1; padding: 6px 0; }
      .field span { display: block; color: #4b5563; font-size: 9.5px; text-transform: uppercase; }
      .field strong { display: block; margin-top: 3px; font-weight: 700; color: #111827; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th { background: #f1f2f4; color: #111827; text-align: left; font-weight: 700; }
      th, td { border: 1px solid #cfd4da; padding: 7px; vertical-align: top; }
      tbody tr:nth-child(even) { background: #fafafa; }
      .labels { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .label { min-height: 150px; border: 1px solid #2f343a; padding: 12px; break-inside: avoid; page-break-inside: avoid; }
      .label h3 { margin-top: 0; }
      footer { position: fixed; bottom: 0; left: 0; right: 0; border-top: 1px solid #cfd4da; padding-top: 6px; color: #555f6d; font-size: 9.5px; display: flex; justify-content: space-between; }
      .page-number:after { content: counter(page); }
    </style>
  </head>
  <body>
    <header>
      <img src="${clinicLogo}" alt="${escapePdfText(CLINIC_NAME)}" />
      <div>
        <h1>${escapePdfText(CLINIC_NAME)}</h1>
        <h2>${escapePdfText(title)}</h2>
        <p class="meta">Generated: ${escapePdfText(new Date().toLocaleString())}</p>
      </div>
    </header>
    ${body}
    <footer><span>Generated: ${escapePdfText(new Date().toLocaleString())}</span><span>${escapePdfText(CLINIC_NAME)}</span><span>Page <span class="page-number"></span></span></footer>
  </body>
</html>`;

const createItemRowKey = () => `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const shouldShowLegacyMedicinePicker = () => false;

const emptyItem = (): ItemForm => ({
  rowKey: createItemRowKey(),
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

const formatMoney = (value: number | string | null | undefined) => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(2) : '-';
};

const formatStockUnit = (unit: Medicine['stockUnit'] | string | null | undefined, qty?: number) => {
  const normalized = unit || 'unit';
  return qty === 1 ? normalized : `${normalized}s`;
};

const formatMedicineStock = (medicine: Pick<Medicine, 'quantity' | 'stockUnit'> | undefined) => {
  if (!medicine) return '-';
  return `${medicine.quantity} ${formatStockUnit(medicine.stockUnit, medicine.quantity)}`;
};

const toLocalDateKey = (value: string | Date) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
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

const getMedicineCategoryLabel = (category: Medicine['category']) => {
  if (category === 'CONTROLLED_MEDICINE') return 'Controlled';
  if (category === 'SUPPLEMENT') return 'Supplement';
  if (category === 'VITAMIN') return 'Vitamin';
  return 'Medicine';
};

const isPrescriptionReadyMedicine = (medicine: Medicine) => {
  return (
    medicine.availableForPrescription !== false
    && medicine.quantity > 0
    && getMedicineExpiryStatus(medicine) !== 'EXPIRED'
    && (medicine.approvalStatus === undefined || medicine.approvalStatus === 'APPROVED')
  );
};

const getPrescriptionItemsSummary = (items: PrescriptionItem[]) => {
  if (items.length === 0) return '-';
  return `${items.length} ${items.length === 1 ? 'Medicine' : 'Medicines'}`;
};

const truncateText = (value: string | null | undefined, maxLength = 52) => {
  const normalized = value?.trim();
  if (!normalized) return '';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
};

const reindexRecordAfterRemoval = <T,>(record: Record<number, T>, removedIndex: number) => {
  return Object.entries(record).reduce<Record<number, T>>((next, [key, value]) => {
    const index = Number(key);
    if (index < removedIndex) next[index] = value;
    if (index > removedIndex) next[index - 1] = value;
    return next;
  }, {});
};

const getConsultationOptionLabel = (consultation: ConsultationOption) => {
  const summary = truncateText(consultation.diagnosis || consultation.symptoms || 'No diagnosis recorded', 42);
  const suffix = consultation.prescription ? ' - Prescription Created' : '';
  return `#${consultation.consultationId} - Completed - ${summary}${suffix}`;
};

const getPrescriptionStatusLabel = (status: PrescriptionStatus | undefined) => {
  if (status === 'VERIFIED') return 'Verified';
  if (status === 'DISPENSED') return 'Dispensed';
  if (status === 'REJECTED') return 'Rejected';
  return 'Pending Verification';
};

const normalizePrescriptionStatus = (status: PrescriptionStatus | undefined) => {
  if (status === 'PENDING' || status === 'PENDING_VERIFICATION' || !status) return 'PENDING' as const;
  return status;
};

const getPrescriptionStatusClass = (status: PrescriptionStatus | undefined) => {
  if (status === 'VERIFIED') return 'type-consultation';
  if (status === 'DISPENSED') return 'status-good';
  if (status === 'REJECTED') return 'status-critical';
  return 'status-warning';
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
  const [statusFilter, setStatusFilter] = useState<PrescriptionStatus | ''>(() => (role === 'PHARMACIST' ? 'PENDING_VERIFICATION' : ''));
  const [form, setForm] = useState<PrescriptionForm>(initialForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [processingPrescriptionId, setProcessingPrescriptionId] = useState<number | null>(null);
  const [selectedPrescription, setSelectedPrescription] = useState<Prescription | null>(null);
  const [detailsTab, setDetailsTab] = useState<PrescriptionDetailsTab>('details');
  const [doctorTab, setDoctorTab] = useState<DoctorPrescriptionTab>('create');
  const [medicinePickerIndex, setMedicinePickerIndex] = useState<number | null>(null);
  const [medicinePickerSearch, setMedicinePickerSearch] = useState<Record<number, string>>({});
  const [medicinePickerCategory, setMedicinePickerCategory] = useState<Record<number, MedicinePickerCategory>>({});
  const [, setMedicinePickerStockFilter] = useState<Record<number, MedicinePickerStockFilter>>({});
  const [, setMedicinePickerExpiryFilter] = useState<Record<number, MedicinePickerExpiryFilter>>({});
  const [, setMedicinePickerPage] = useState<Record<number, number>>({});
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [linkedAppointmentId, setLinkedAppointmentId] = useState<number | null>(null);
  const [linkedConsultationId, setLinkedConsultationId] = useState<number | null>(null);
  const [availableConsultations, setAvailableConsultations] = useState<ConsultationOption[]>([]);
  const bootstrappedQueryRef = useRef<string | null>(null);

  const doctorId = useMemo(() => parseUserIdFromToken(sessionStorage.getItem('cms_token')), []);
  const initialPatientIdFromQuery = Number(searchParams.get('patientId') || 0);
  const initialAppointmentIdFromQuery = Number(searchParams.get('appointmentId') || 0);
  const initialConsultationIdFromQuery = Number(searchParams.get('consultationId') || 0);
  const selectedFilterPatientId = selectedFilterPatient?.patientId ?? 0;
  const medicineById = useMemo(() => new Map(medicines.map((medicine) => [medicine.medicineId, medicine])), [medicines]);
  const prescriptionReadyMedicines = useMemo(
    () => medicines
      .filter(isPrescriptionReadyMedicine)
      .sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()),
    [medicines],
  );
  const selectedConsultation = useMemo(
    () => availableConsultations.find((consultation) => consultation.consultationId === linkedConsultationId) ?? null,
    [availableConsultations, linkedConsultationId],
  );
  const selectedConsultationPrescriptionId = selectedConsultation?.prescription?.prescriptionId ?? null;
  const hasSelectedCompletedConsultation = Boolean(selectedConsultation && selectedConsultation.status === 'COMPLETED');
  const selectedMedicineCount = useMemo(() => form.items.filter((item) => item.medicineId > 0).length, [form.items]);
  const rowsPerPage = 10;

  const prescriptionSummary = useMemo(() => {
    const today = toLocalDateKey(new Date());
    const filtered = prescriptions.map((item) => ({
      ...item,
      normalizedStatus: normalizePrescriptionStatus(item.status),
    }));

    return {
      pending: filtered.filter((item) => item.normalizedStatus === 'PENDING').length,
      verified: filtered.filter((item) => item.normalizedStatus === 'VERIFIED').length,
      dispensedToday: filtered.filter((item) => item.normalizedStatus === 'DISPENSED' && toLocalDateKey(item.date) === today).length,
      rejected: filtered.filter((item) => item.normalizedStatus === 'REJECTED').length,
    };
  }, [prescriptions]);

  const totalPages = Math.max(1, Math.ceil(prescriptions.length / rowsPerPage));
  const paginatedPrescriptions = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    return prescriptions.slice(start, start + rowsPerPage);
  }, [page, prescriptions]);

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
      api.get('/medicine', { params: { availableForPrescription: 'true' } }),
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

  const loadPrescriptions = useCallback(async (filters?: { patientId?: number; dateFrom?: string; dateTo?: string; status?: PrescriptionStatus | '' }) => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/prescriptions', {
        params: {
          patientId: filters?.patientId,
          dateFrom: filters?.dateFrom || undefined,
          dateTo: filters?.dateTo || undefined,
          status: filters?.status || undefined,
        },
      });
      setPrescriptions(response.data as Prescription[]);
      setPage(1);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load prescriptions'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAvailableConsultations = useCallback(async (patientId: number, preferredConsultationId?: number | null) => {
    try {
      const response = await api.get('/consultations', {
        params: {
          status: 'COMPLETED',
          patientId,
        },
      });

      const consultations = response.data as ConsultationOption[];
      setAvailableConsultations(consultations);

      const preferredId = preferredConsultationId ?? null;
      if (preferredId && consultations.some((consultation) => consultation.consultationId === preferredId)) {
        const preferredConsultation = consultations.find((consultation) => consultation.consultationId === preferredId) ?? null;
        setLinkedConsultationId(preferredConsultation?.consultationId ?? null);
        setLinkedAppointmentId(preferredConsultation?.appointmentId ?? null);
        return;
      }

      const nextConsultation = consultations.find((consultation) => !consultation.prescription) ?? consultations[0] ?? null;
      setLinkedConsultationId(nextConsultation?.consultationId ?? null);
      setLinkedAppointmentId(nextConsultation?.appointmentId ?? null);
    } catch {
      setAvailableConsultations([]);
      setLinkedConsultationId(null);
      setLinkedAppointmentId(null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await loadLookups();
      } catch {
        setError('Failed to load required data');
      }
    })();
  }, [loadLookups]);

  useEffect(() => {
    void loadPrescriptions({
      patientId: selectedFilterPatientId || undefined,
      dateFrom: dateRange.dateFrom || undefined,
      dateTo: dateRange.dateTo || undefined,
      status: statusFilter,
    });
  }, [dateRange.dateFrom, dateRange.dateTo, loadPrescriptions, selectedFilterPatientId, statusFilter]);

  useEffect(() => {
    return subscribeInAppDataSync(() => {
      void (async () => {
        await loadLookups();
        if (selectedFilterPatientId) {
          await loadPatientDetails(selectedFilterPatientId);
        }
        await loadPrescriptions({
          patientId: selectedFilterPatientId || undefined,
          dateFrom: dateRange.dateFrom || undefined,
          dateTo: dateRange.dateTo || undefined,
          status: statusFilter,
        });
      })();
    });
  }, [dateRange.dateFrom, dateRange.dateTo, loadLookups, loadPatientDetails, loadPrescriptions, selectedFilterPatientId, statusFilter]);

  useEffect(() => {
    if (medicinePickerIndex === null) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMedicinePickerIndex(null);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [medicinePickerIndex]);

  useEffect(() => {
    if (initialPatientIdFromQuery <= 0) return;
    const bootstrapKey = `${initialPatientIdFromQuery}:${initialAppointmentIdFromQuery}:${initialConsultationIdFromQuery}`;
    if (bootstrappedQueryRef.current === bootstrapKey) return;

    const patient = findPatientOptionById(initialPatientIdFromQuery);
    if (!patient) return;

    bootstrappedQueryRef.current = bootstrapKey;
    setSelectedFilterPatient(patient);
    setSelectedFormPatient(patient);
    setForm((prev) => ({ ...prev, patientId: initialPatientIdFromQuery }));
    void loadPatientDetails(initialPatientIdFromQuery);
    if (canCreate) {
      void loadAvailableConsultations(initialPatientIdFromQuery, initialConsultationIdFromQuery || null);
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
  ]);

  const onFilterPatientChange = async (patient: PatientAutocompleteOption | null) => {
    setError(null);
    setSuccess(null);
    setSelectedFilterPatient(patient);
    setSelectedFormPatient(patient);
    setSelectedPatientDetails(null);
    setForm((prev) => ({ ...prev, patientId: patient?.patientId ?? 0 }));
    setAvailableConsultations([]);
    setLinkedAppointmentId(null);
    setLinkedConsultationId(null);
    setSearchParams({});
    if (!patient) {
      return;
    }

    await loadPatientDetails(patient.patientId);
    if (canCreate) {
      await loadAvailableConsultations(patient.patientId);
    }
  };

  const onSearch = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    await loadPrescriptions({
      patientId: selectedFilterPatientId || undefined,
      dateFrom: dateRange.dateFrom || undefined,
      dateTo: dateRange.dateTo || undefined,
      status: statusFilter,
    });
  };

  const onViewDetails = async (prescriptionId: number) => {
    if (!canViewDetails) return;
    setDetailsLoading(true);
    setDetailsTab('details');
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

  const exportPrescriptionPdf = (prescription: Prescription | null = selectedPrescription) => {
    if (!prescription) return;
    const rows = prescription.items.map((item) => `
      <tr>
        <td>${escapePdfText(item.medicine?.name ?? `Medicine #${item.medicineId}`)}</td>
        <td>${escapePdfText(item.medicine?.batchNumber || '-')}</td>
        <td>${escapePdfText(item.dosage)}</td>
        <td>${escapePdfText(item.frequency)}</td>
        <td>${escapePdfText(item.duration)}</td>
        <td>${escapePdfText(`${item.qty} ${formatStockUnit(item.medicine?.stockUnit, item.qty)}`)}</td>
      </tr>
    `).join('');
    const html = prescriptionPdfShell('Prescription', `
      <section class="grid">
        <div class="field"><span>Prescription</span><strong>#${escapePdfText(prescription.prescriptionId)}</strong></div>
        <div class="field"><span>Status</span><strong>${escapePdfText(getPrescriptionStatusLabel(prescription.status))}</strong></div>
        <div class="field"><span>Patient</span><strong>${escapePdfText(prescription.patient?.name ?? `Patient #${prescription.patientId}`)}</strong></div>
        <div class="field"><span>IC / ID</span><strong>${escapePdfText(prescription.patient?.icOrPassport ?? '-')}</strong></div>
        <div class="field"><span>Doctor</span><strong>${escapePdfText(prescription.doctor?.username ?? 'Doctor')}</strong></div>
        <div class="field"><span>Date</span><strong>${escapePdfText(toDisplayDateTime(prescription.date))}</strong></div>
        <div class="field"><span>Consultation</span><strong>${escapePdfText(prescription.consultationId ? `#${prescription.consultationId}` : '-')}</strong></div>
        <div class="field"><span>Diagnosis</span><strong>${escapePdfText(prescription.consultation?.diagnosis ?? '-')}</strong></div>
      </section>
      <h3>Medicine Items</h3>
      <table>
        <thead><tr><th>Medicine</th><th>Batch</th><th>Dosage</th><th>Frequency</th><th>Duration</th><th>Quantity</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6">No medicine items.</td></tr>'}</tbody>
      </table>
      <h3>Notes</h3>
      <section class="field"><strong>${escapePdfText(prescription.notes || '-')}</strong></section>
    `);
    exportHtmlAsPdf(html, `prescription-${prescription.prescriptionId}`);
  };

  const exportMedicineLabelPdf = (prescription: Prescription | null = selectedPrescription) => {
    if (!prescription) return;
    const labels = prescription.items.map((item) => `
      <article class="label">
        <h3>${escapePdfText(item.medicine?.name ?? `Medicine #${item.medicineId}`)}</h3>
        <p><strong>Patient:</strong> ${escapePdfText(prescription.patient?.name ?? `Patient #${prescription.patientId}`)}</p>
        <p><strong>Dosage:</strong> ${escapePdfText(item.dosage)}</p>
        <p><strong>Frequency:</strong> ${escapePdfText(item.frequency)}</p>
        <p><strong>Duration:</strong> ${escapePdfText(item.duration)}</p>
        <p><strong>Quantity:</strong> ${escapePdfText(`${item.qty} ${formatStockUnit(item.medicine?.stockUnit, item.qty)}`)}</p>
        <p><strong>Batch:</strong> ${escapePdfText(item.medicine?.batchNumber || '-')}</p>
        <p><strong>Prescription:</strong> #${escapePdfText(prescription.prescriptionId)}</p>
      </article>
    `).join('');
    const html = prescriptionPdfShell('Medicine Labels', `
      <section class="grid">
        <div class="field"><span>Prescription</span><strong>#${escapePdfText(prescription.prescriptionId)}</strong></div>
        <div class="field"><span>Patient</span><strong>${escapePdfText(prescription.patient?.name ?? `Patient #${prescription.patientId}`)}</strong></div>
      </section>
      <section class="labels">${labels || '<p>No medicine items.</p>'}</section>
    `);
    exportHtmlAsPdf(html, `medicine-labels-${prescription.prescriptionId}`);
  };

  const onAddItem = () => {
    setForm((prev) => ({ ...prev, items: [...prev.items, emptyItem()] }));
  };

  const onRemoveItem = (idx: number) => {
    setForm((prev) => {
      const items = prev.items.length === 1 ? [emptyItem()] : prev.items.filter((_, i) => i !== idx);
      return { ...prev, items };
    });
    setFieldErrors({});
    setMedicinePickerSearch((prev) => reindexRecordAfterRemoval(prev, idx));
    setMedicinePickerCategory((prev) => reindexRecordAfterRemoval(prev, idx));
    setMedicinePickerStockFilter((prev) => reindexRecordAfterRemoval(prev, idx));
    setMedicinePickerExpiryFilter((prev) => reindexRecordAfterRemoval(prev, idx));
    setMedicinePickerPage((prev) => reindexRecordAfterRemoval(prev, idx));
    setMedicinePickerIndex((current) => {
      if (current === null) return null;
      if (current === idx) return null;
      return current > idx ? current - 1 : current;
    });
  };

  const onUpdateItem = <K extends keyof ItemForm>(idx: number, key: K, value: ItemForm[K]) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === idx ? { ...it, [key]: value } : it)),
    }));
  };

  const resetForm = (nextPatientId = 0) => {
    setForm({ ...initialForm, patientId: nextPatientId });
    if (!nextPatientId) {
      setSelectedFormPatient(null);
    }
    setAvailableConsultations([]);
    setLinkedAppointmentId(null);
    setLinkedConsultationId(null);
  };

  const refreshPrescriptionData = async () => {
    await loadLookups();
    await loadPrescriptions({
      patientId: selectedFilterPatientId || undefined,
      dateFrom: dateRange.dateFrom || undefined,
      dateTo: dateRange.dateTo || undefined,
      status: statusFilter,
    });
    if (selectedFilterPatientId) {
      await loadPatientDetails(selectedFilterPatientId);
    }
  };

  const runPharmacistAction = async (prescriptionId: number, action: 'verify' | 'dispense' | 'reject') => {
    if (role !== 'PHARMACIST' || processingPrescriptionId) return;
    setError(null);
    setSuccess(null);
    setProcessingPrescriptionId(prescriptionId);
    try {
      const response = await api.post(`/prescriptions/${prescriptionId}/${action}`);
      const updatedPrescription = response.data as Prescription;
      setSelectedPrescription((current) => (
        current?.prescriptionId === updatedPrescription.prescriptionId ? updatedPrescription : current
      ));
      setPrescriptions((current) => current.map((item) => (
        item.prescriptionId === updatedPrescription.prescriptionId ? updatedPrescription : item
      )));
      await refreshPrescriptionData();
      if (action === 'verify') setSuccess('Prescription verified.');
      if (action === 'dispense') setSuccess('Medicine dispensed and stock updated.');
      if (action === 'reject') setSuccess('Prescription rejected.');
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, `Failed to ${action} prescription`));
    } finally {
      setProcessingPrescriptionId(null);
    }
  };

  const getFieldKey = (idx: number, key: keyof ItemForm) => `item-${idx}-${key}`;

  const validateForm = () => {
    const nextErrors: Record<string, boolean> = {};
    let validationMessage: string | null = null;
    if (!form.patientId) nextErrors.patientId = true;

    const nearExpiryMedicines = new Set<string>();

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
        } else if (!isPrescriptionReadyMedicine(medicine)) {
          nextErrors[getFieldKey(idx, 'medicineId')] = true;
          validationMessage = `${medicine.name} is not available for prescription.`;
        } else if (expiryStatus === 'NEAR_EXPIRY') {
          nearExpiryMedicines.add(medicine.name);
        }
      }
    });

    setFieldErrors(nextErrors);
    if (validationMessage) setError(validationMessage);
    if (!validationMessage && nearExpiryMedicines.size > 0) {
      window.alert(`Near-expiry medicine selected: ${[...nearExpiryMedicines].join(', ')}.`);
    }
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

    const controlledSelections = form.items
      .map((item) => medicineById.get(item.medicineId))
      .filter((medicine): medicine is Medicine => medicine?.category === 'CONTROLLED_MEDICINE');
    if (controlledSelections.length > 0) {
      const confirmed = window.confirm(`Controlled medicine selected: ${controlledSelections.map((medicine) => medicine.name).join(', ')}. Confirm this prescription?`);
      if (!confirmed) return;
    }

    setSaving(true);
    try {
      const prescriptionItems = form.items.map(({ rowKey, ...item }) => {
        void rowKey;
        return item;
      });
      const response = await api.post('/prescriptions', {
        patientId: form.patientId,
        doctorId,
        consultationId: linkedConsultationId,
        appointmentId: linkedAppointmentId ?? undefined,
        notes: form.notes || undefined,
        items: prescriptionItems,
      });
      const createdPrescription = response.data as Prescription;
      resetForm(selectedFilterPatientId);
      setLinkedAppointmentId(null);
      setLinkedConsultationId(null);
      setSearchParams({});
      setFieldErrors({});
      setSuccess('Prescription sent to pharmacist for verification.');
      setSelectedPrescription(createdPrescription);
      await loadLookups();
      await loadPrescriptions({
        patientId: selectedFilterPatientId || undefined,
        dateFrom: dateRange.dateFrom || undefined,
        dateTo: dateRange.dateTo || undefined,
        status: statusFilter,
      });
      if (selectedFilterPatientId) {
        await loadPatientDetails(selectedFilterPatientId);
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to create prescription'));
    } finally {
      setSaving(false);
    }
  };

  const getFilteredPickerOptions = (idx: number) => {
    const search = medicinePickerSearch[idx] ?? '';
    const category = medicinePickerCategory[idx] ?? 'DEFAULT';
    const normalizedSearch = search.trim().toLowerCase();

    return prescriptionReadyMedicines.filter((medicine) => {
      const matchesCategory =
        category === 'ALL'
          || (category === 'DEFAULT' && (medicine.category === undefined || medicine.category === 'MEDICINE' || medicine.category === 'CONTROLLED_MEDICINE'))
          || medicine.category === category;
      if (!matchesCategory) return false;
      if (!normalizedSearch) return true;
      return [medicine.name, medicine.brand, medicine.batchNumber, medicine.content]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedSearch));
    });
  };

  const openMedicinePicker = (idx: number) => {
    setMedicinePickerIndex(idx);
    setMedicinePickerStockFilter((prev) => ({ ...prev, [idx]: prev[idx] ?? 'IN_STOCK' }));
    setMedicinePickerExpiryFilter((prev) => ({ ...prev, [idx]: prev[idx] ?? 'VALID' }));
    setMedicinePickerPage((prev) => ({ ...prev, [idx]: 1 }));
  };

  const renderMedicinePickerField = (item: ItemForm, idx: number) => {
    const selectedMedicine = medicineById.get(item.medicineId);
    const selectedExpiryStatus = getMedicineExpiryStatus(selectedMedicine);
    const medicineMeta = selectedMedicine
      ? `${getMedicineCategoryLabel(selectedMedicine.category)} • Batch ${selectedMedicine.batchNumber || '-'} • Stock ${selectedMedicine.quantity}`
      : 'Search by name, brand, batch, or content';

    const medicineDisplayMeta = selectedMedicine
      ? `${getMedicineCategoryLabel(selectedMedicine.category)} - Batch ${selectedMedicine.batchNumber || '-'} - Available: ${formatMedicineStock(selectedMedicine)} - RM ${formatMoney(selectedMedicine.price)} per ${selectedMedicine.stockUnit}`
      : medicineMeta;

    return (
      <div className={`medicine-picker ${fieldErrors[getFieldKey(idx, 'medicineId')] ? 'field-invalid' : ''}`}>
        <button type="button" className="medicine-picker-control" onClick={() => openMedicinePicker(idx)}>
          {selectedMedicine ? (
            <span>
              <span className="medicine-picker-name-line">
                <strong title={selectedMedicine.name}>{selectedMedicine.name}</strong>
                {selectedMedicine.category === 'CONTROLLED_MEDICINE' && <em className="medicine-inline-badge danger">Controlled</em>}
                {selectedExpiryStatus === 'NEAR_EXPIRY' && <em className="medicine-inline-badge warning">Near Expiry</em>}
                {selectedExpiryStatus === 'EXPIRED' && <em className="medicine-inline-badge danger">Expired</em>}
              </span>
              <small title={medicineDisplayMeta}>{medicineDisplayMeta}</small>
            </span>
          ) : (
            <span>
              <strong>Select medicine</strong>
              <small>{medicineMeta}</small>
            </span>
          )}
          <b>{selectedMedicine ? 'Change' : 'Select'}</b>
        </button>
      </div>
    );
  };

  const activePickerOptions = medicinePickerIndex !== null ? getFilteredPickerOptions(medicinePickerIndex) : [];
  const activePickerCategory = medicinePickerIndex !== null
    ? medicinePickerCategory[medicinePickerIndex] ?? 'ALL'
    : 'ALL';

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
            placeholder="Search Patient"
          />
          <DateRangeFilter value={dateRange} onChange={setDateRange} includeAll />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as PrescriptionStatus | '')}
            aria-label="Prescription status"
          >
            <option value="">All Statuses</option>
            <option value="PENDING_VERIFICATION">Pending Verification</option>
            <option value="VERIFIED">Verified</option>
            <option value="DISPENSED">Dispensed</option>
            <option value="REJECTED">Rejected</option>
          </select>
          <button
            type="button"
            className="btn-secondary consultation-clear-button"
            onClick={() => {
              setSelectedFilterPatient(null);
              setSelectedFormPatient(null);
              setSelectedPatientDetails(null);
              setAvailableConsultations([]);
              setLinkedAppointmentId(null);
              setLinkedConsultationId(null);
              setForm(initialForm);
              setDateRange(getDateRangeForPreset('last7'));
              setStatusFilter(role === 'PHARMACIST' ? 'PENDING_VERIFICATION' : '');
              setSearchParams({});
            }}
          >
            Reset
          </button>
          <button type="submit" className="btn-secondary consultation-refresh-button">Search</button>
        </form>
      </section>

      {role === 'PHARMACIST' && (
        <>
          <section className="prescription-summary-grid">
            <button type="button" className={statusFilter === 'PENDING_VERIFICATION' ? 'is-active' : ''} onClick={() => setStatusFilter('PENDING_VERIFICATION')}>
              <span>Pending</span>
              <strong>{prescriptionSummary.pending}</strong>
            </button>
            <button type="button" className={statusFilter === 'VERIFIED' ? 'is-active' : ''} onClick={() => setStatusFilter('VERIFIED')}>
              <span>Verified</span>
              <strong>{prescriptionSummary.verified}</strong>
            </button>
            <button type="button" className={statusFilter === 'DISPENSED' ? 'is-active' : ''} onClick={() => setStatusFilter('DISPENSED')}>
              <span>Dispensed Today</span>
              <strong>{prescriptionSummary.dispensedToday}</strong>
            </button>
            <button type="button" className={statusFilter === 'REJECTED' ? 'is-active' : ''} onClick={() => setStatusFilter('REJECTED')}>
              <span>Rejected</span>
              <strong>{prescriptionSummary.rejected}</strong>
            </button>
          </section>

          <nav className="prescription-workflow-tabs" aria-label="Prescription status tabs">
            <button type="button" className={statusFilter === 'PENDING_VERIFICATION' ? 'is-active' : ''} onClick={() => setStatusFilter('PENDING_VERIFICATION')}>Pending</button>
            <button type="button" className={statusFilter === 'VERIFIED' ? 'is-active' : ''} onClick={() => setStatusFilter('VERIFIED')}>Verified</button>
            <button type="button" className={statusFilter === 'DISPENSED' ? 'is-active' : ''} onClick={() => setStatusFilter('DISPENSED')}>Dispensed</button>
            <button type="button" className={statusFilter === 'REJECTED' ? 'is-active' : ''} onClick={() => setStatusFilter('REJECTED')}>Rejected</button>
          </nav>
        </>
      )}

      {canCreate && (
        <nav className="prescription-workflow-tabs" aria-label="Doctor prescription tabs">
          <button type="button" className={doctorTab === 'create' ? 'is-active' : ''} onClick={() => setDoctorTab('create')}>Create Prescription</button>
          <button type="button" className={doctorTab === 'history' ? 'is-active' : ''} onClick={() => setDoctorTab('history')}>Prescription History</button>
        </nav>
      )}

      {!canCreate && selectedPatientDetails && (
        <section className="card prescription-patient-card">
          <div className="section-head compact-section-head">
            <h3>Selected Patient</h3>
            <p className="muted">Compact verification context.</p>
          </div>
          <div className="prescription-patient-grid">
            <div><span>Name</span><strong>{selectedPatientDetails.name}</strong></div>
            <div><span>IC/ID</span><strong>{selectedPatientDetails.icOrPassport}</strong></div>
            <div><span>Phone</span><strong>{selectedPatientDetails.phone}</strong></div>
            <div><span>Gender</span><strong>{prettifyGender(selectedPatientDetails.gender)}</strong></div>
            <div><span>DOB</span><strong>{toDateInput(selectedPatientDetails.dateOfBirth)}</strong></div>
            <div className="prescription-address-cell"><span>Address</span><strong>{selectedPatientDetails.address || '-'}</strong></div>
          </div>
        </section>
      )}

      {canCreate && doctorTab === 'create' && (
        <form onSubmit={onSubmit} className="prescription-create-form">
          <section className="card prescription-patient-card prescription-compact-context-card">
            {selectedPatientDetails ? (
              <>
                <div className="prescription-context-summary">
                  <div><span>Patient</span><strong>{selectedPatientDetails.name}</strong><small>{selectedPatientDetails.icOrPassport} / {selectedPatientDetails.phone}</small></div>
                  <div><span>Consultation</span><strong>{selectedConsultation?.diagnosis || 'Select consultation'}</strong><small>{selectedConsultation ? toDisplayDateTime(selectedConsultation.createdAt) : 'Completed consultations only'}</small></div>
                  <div><span>Status</span><strong>{selectedConsultationPrescriptionId ? 'Prescription Created' : selectedConsultation ? 'Ready' : 'Waiting'}</strong><small>{selectedPatientDetails.prescriptions.length} prescriptions</small></div>
                </div>
                <details className="prescription-collapse">
                  <summary>Patient Details</summary>
                  <div className="prescription-patient-grid">
                    <div><span>Gender</span><strong>{prettifyGender(selectedPatientDetails.gender)}</strong></div>
                    <div><span>DOB</span><strong>{toDateInput(selectedPatientDetails.dateOfBirth)}</strong></div>
                    <div className="prescription-address-cell"><span>Address</span><strong>{selectedPatientDetails.address || '-'}</strong></div>
                  </div>
                </details>
              </>
            ) : (
              <div className="prescription-empty-panel">
                <strong>No patient selected</strong>
                <span>Search and select a patient to view consultation history.</span>
              </div>
            )}
          </section>

          <section className="card prescription-create-card">
            <div className="section-head compact-section-head">
              <h3>Create Prescription</h3>
              <p className="muted">Completed consultations only. Duplicate prescriptions are blocked.</p>
            </div>

            <div className="prescription-context-grid">
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
                      {getConsultationOptionLabel(consultation)}
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
                <div className="prescription-consultation-summary">
                  <div>
                    <span>Consultation ID</span>
                    <strong>#{selectedConsultation.consultationId}</strong>
                  </div>
                  <div>
                    <span>Diagnosis</span>
                    <strong>{truncateText(selectedConsultation.diagnosis, 42) || 'Not recorded'}</strong>
                  </div>
                  <div>
                    <span>Symptoms</span>
                    <strong>{truncateText(selectedConsultation.symptoms, 42) || 'Not recorded'}</strong>
                  </div>
                  <div>
                    <span>Date / Time</span>
                    <strong>{toDisplayDateTime(selectedConsultation.createdAt)}</strong>
                  </div>
                </div>
                {selectedConsultationPrescriptionId ? (
                  <span className="status-badge status-warning">COMPLETED</span>
                ) : (
                  <span className="status-badge status-good">READY</span>
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
                rows={2}
              />
            </label>
          </section>

          <section className="card prescription-medicine-card">
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
                return (
                  <div key={item.rowKey} className="prescription-item-row">
                    <label>
                      <span>Medicine</span>
                      {renderMedicinePickerField(item, idx)}
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
                      <span>Qty Dispensed</span>
                      <input
                        type="number"
                        min={1}
                        max={selectedMedicine?.quantity}
                        value={item.qty}
                        onChange={(e) => onUpdateItem(idx, 'qty', Number(e.target.value) || 1)}
                        placeholder="Qty dispensed"
                        className={fieldErrors[getFieldKey(idx, 'qty')] ? 'field-invalid' : undefined}
                        required
                      />
                      {selectedMedicine && <small className="field-helper">Available: {formatMedicineStock(selectedMedicine)}</small>}
                    </label>
                    <button type="button" className="prescription-remove-item" onClick={() => onRemoveItem(idx)}>
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="action-row prescription-create-actions">
              <span className="prescription-items-summary">
                {selectedMedicineCount} {selectedMedicineCount === 1 ? 'medicine' : 'medicines'} selected
              </span>
              <button type="submit" disabled={saving || !hasSelectedCompletedConsultation || Boolean(selectedConsultationPrescriptionId)}>
                {saving ? 'Saving Prescription...' : 'Save Prescription'}
              </button>
            </div>
          </section>
        </form>
      )}

      {(!canCreate || doctorTab === 'history') && (
      <section className="card prescription-list-card">
        <div className="section-head compact-section-head">
          <h3>Prescription List</h3>
          <p className="muted">{role === 'PHARMACIST' ? 'Pending prescriptions are ready for verification and dispensing.' : 'Filtered by the selected patient, date range, and status.'}</p>
        </div>

        {loading && <p className="muted">Loading prescriptions...</p>}

        <div className="table-wrap">
          <table className="data-table prescription-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Patient</th>
                <th>Status</th>
                <th>Consultation</th>
                <th>Items</th>
                <th>Notes</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedPrescriptions.map((p) => (
                <tr key={p.prescriptionId}>
                  <td>{toDisplayDateTime(p.date)}</td>
                  <td>
                    <strong>{p.patient?.name ?? `Patient #${p.patientId}`}</strong>
                    <small>{p.patient?.icOrPassport ?? ''}</small>
                  </td>
                  <td><span className={`status-badge ${getPrescriptionStatusClass(p.status)}`}>{getPrescriptionStatusLabel(p.status)}</span></td>
                  <td>{p.consultationId ? `#${p.consultationId}` : '-'}</td>
                  <td>{getPrescriptionItemsSummary(p.items)}</td>
                  <td className="prescription-notes-cell">{p.notes || '-'}</td>
                  <td>
                    {canViewDetails ? (
                      <div className="prescription-row-actions">
                        <button type="button" className="btn-secondary" onClick={() => onViewDetails(p.prescriptionId)}>
                          View Details
                        </button>
                        {role === 'PHARMACIST' && (
                          <details className="prescription-more-menu">
                            <summary aria-label="More prescription actions">...</summary>
                            <div>
                              {p.status === 'PENDING_VERIFICATION' && (
                                <>
                                  <button type="button" onClick={() => void runPharmacistAction(p.prescriptionId, 'verify')} disabled={processingPrescriptionId === p.prescriptionId}>Verify</button>
                                  <button type="button" className="danger" onClick={() => void runPharmacistAction(p.prescriptionId, 'reject')} disabled={processingPrescriptionId === p.prescriptionId}>Reject</button>
                                </>
                              )}
                              {p.status === 'VERIFIED' && (
                                <>
                                  <button type="button" onClick={() => void runPharmacistAction(p.prescriptionId, 'dispense')} disabled={processingPrescriptionId === p.prescriptionId}>
                                    {processingPrescriptionId === p.prescriptionId ? 'Dispensing...' : 'Dispense'}
                                  </button>
                                  <button type="button" onClick={() => exportPrescriptionPdf(p)}>Print Prescription</button>
                                  <button type="button" onClick={() => exportMedicineLabelPdf(p)}>Print Medicine Label</button>
                                  <button type="button" className="danger" onClick={() => void runPharmacistAction(p.prescriptionId, 'reject')} disabled={processingPrescriptionId === p.prescriptionId}>Reject</button>
                                </>
                              )}
                              {p.status === 'DISPENSED' && (
                                <>
                                  <button type="button" onClick={() => exportPrescriptionPdf(p)}>Print Prescription</button>
                                  <button type="button" onClick={() => exportMedicineLabelPdf(p)}>Print Medicine Label</button>
                                </>
                              )}
                              {p.status === 'REJECTED' && <span>View only</span>}
                            </div>
                          </details>
                        )}
                      </div>
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
          {paginatedPrescriptions.map((p) => (
            <article key={p.prescriptionId} className="mobile-card">
              <h4>{p.patient?.name ?? `Patient #${p.patientId}`}</h4>
              <dl className="kv">
                <div><dt>Date</dt><dd>{toDisplayDateTime(p.date)}</dd></div>
                <div><dt>Status</dt><dd>{getPrescriptionStatusLabel(p.status)}</dd></div>
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
        {prescriptions.length > rowsPerPage && (
          <div className="prescription-pagination">
            <button type="button" className="btn-secondary" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>
              Previous
            </button>
            <span>Page {page} of {totalPages}</span>
            <button type="button" className="btn-secondary" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages}>
              Next
            </button>
          </div>
        )}
      </section>
      )}

      {(detailsLoading || selectedPrescription) && canViewDetails && (
        <div className="appointment-drawer-layer prescription-details-layer" role="presentation">
          <button type="button" className="patient-drawer-backdrop" aria-label="Close prescription details" onClick={() => setSelectedPrescription(null)} disabled={detailsLoading} />
          <aside className="patient-drawer prescription-details-drawer" role="dialog" aria-modal="true" aria-labelledby="prescription-details-title">
            <div className="patient-drawer-head">
              <div>
                <h3 id="prescription-details-title">Prescription Details</h3>
                <p className="muted">{role === 'PHARMACIST' ? 'Verify, dispense, print prescription, or print medicine labels.' : 'Preview prescription details before pharmacist verification.'}</p>
              </div>
              <button type="button" className="patient-drawer-close" onClick={() => setSelectedPrescription(null)} disabled={detailsLoading}>
                X
              </button>
            </div>

            <div className="patient-drawer-body">
              {detailsLoading && <p className="muted">Loading details...</p>}

              {!detailsLoading && selectedPrescription && (
                <div className="prescription-details-stack">
                  <nav className="prescription-detail-tabs" aria-label="Prescription detail tabs">
                    <button type="button" className={detailsTab === 'details' ? 'is-active' : ''} onClick={() => setDetailsTab('details')}>Details</button>
                    <button type="button" className={detailsTab === 'medicines' ? 'is-active' : ''} onClick={() => setDetailsTab('medicines')}>Medicines</button>
                    <button type="button" className={detailsTab === 'print' ? 'is-active' : ''} onClick={() => setDetailsTab('print')}>Print Preview</button>
                    <button type="button" className={detailsTab === 'audit' ? 'is-active' : ''} onClick={() => setDetailsTab('audit')}>Audit Trail</button>
                  </nav>

                  {detailsTab === 'details' && (
                    <section className="prescription-tab-panel">
                      <dl className="prescription-details-grid">
                        <div><dt>Patient</dt><dd>{selectedPrescription.patient?.name ?? `Patient #${selectedPrescription.patientId}`}</dd></div>
                        <div><dt>IC/ID</dt><dd>{selectedPrescription.patient?.icOrPassport ?? '-'}</dd></div>
                        <div><dt>Status</dt><dd><span className={`status-badge ${getPrescriptionStatusClass(selectedPrescription.status)}`}>{getPrescriptionStatusLabel(selectedPrescription.status)}</span></dd></div>
                        <div><dt>Consultation Date</dt><dd>{toDisplayDateTime(selectedPrescription.consultation?.createdAt ?? selectedPrescription.date)}</dd></div>
                        <div><dt>Doctor</dt><dd>{selectedPrescription.doctor?.username ?? 'Doctor'}</dd></div>
                        <div><dt>Consultation</dt><dd>{selectedPrescription.consultationId ? `#${selectedPrescription.consultationId}` : '-'}</dd></div>
                        <div><dt>Diagnosis</dt><dd>{selectedPrescription.consultation?.diagnosis ?? '-'}</dd></div>
                        <div className="prescription-details-wide"><dt>Notes</dt><dd>{selectedPrescription.notes || '-'}</dd></div>
                      </dl>
                    </section>
                  )}

                  {detailsTab === 'medicines' && (
                    <section className="prescription-tab-panel">
                      <div className="table-wrap prescription-detail-table-wrap">
                        <table className="data-table prescription-detail-table">
                          <thead>
                            <tr>
                              <th>Medicine</th>
                              <th>Expiry</th>
                              <th>Dosage</th>
                              <th>Frequency</th>
                              <th>Duration</th>
                              <th>Qty Dispensed</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedPrescription.items.map((item) => (
                              <tr key={item.pmId}>
                                <td>
                                  <strong>{item.medicine?.name ?? `Medicine #${item.medicineId}`}</strong>
                                  <small>{item.medicine?.batchNumber ? `Batch ${item.medicine.batchNumber}` : ''}</small>
                                  <small>{item.medicine?.packaging ? `Packaging: ${item.medicine.packaging}` : ''}</small>
                                </td>
                                <td>
                                  {toDateInput(item.medicine?.expiryDate)}
                                  {getMedicineExpiryStatus(item.medicine as Medicine | undefined) === 'NEAR_EXPIRY' && <small className="medicine-warning">Near Expiry</small>}
                                  {getMedicineExpiryStatus(item.medicine as Medicine | undefined) === 'EXPIRED' && <small className="medicine-danger">Expired</small>}
                                </td>
                                <td>{item.dosage}</td>
                                <td>{item.frequency}</td>
                                <td>{item.duration}</td>
                                <td>{item.qty} {formatStockUnit(item.medicine?.stockUnit, item.qty)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}

                  {detailsTab === 'print' && (
                    <section className="prescription-print-area prescription-print-sheet prescription-tab-panel">
                      <div className="prescription-print-header-block">
                        <img src={clinicLogo} alt={CLINIC_NAME} />
                        <div className="prescription-picker-medicine-main">
                          <h3>{CLINIC_NAME}</h3>
                          <p>Prescription #{selectedPrescription.prescriptionId}</p>
                        </div>
                      </div>
                      <dl className="prescription-details-grid">
                        <div><dt>Patient</dt><dd>{selectedPrescription.patient?.name ?? `Patient #${selectedPrescription.patientId}`}</dd></div>
                        <div><dt>IC/ID</dt><dd>{selectedPrescription.patient?.icOrPassport ?? '-'}</dd></div>
                        <div><dt>Doctor</dt><dd>{selectedPrescription.doctor?.username ?? 'Doctor'}</dd></div>
                        <div><dt>Date</dt><dd>{toDisplayDateTime(selectedPrescription.date)}</dd></div>
                      </dl>
                      <p className="muted">{selectedPrescription.items.length} medicine item(s). Open Medicines tab for full dispensing detail.</p>
                    </section>
                  )}

                  {detailsTab === 'audit' && (
                    <section className="prescription-tab-panel prescription-audit-panel">
                      <p><strong>Created</strong><span>{toDisplayDateTime(selectedPrescription.date)}</span></p>
                      <p><strong>Status</strong><span>{getPrescriptionStatusLabel(selectedPrescription.status)}</span></p>
                      <p><strong>Dispensing rule</strong><span>Stock is deducted only when pharmacist dispenses.</span></p>
                    </section>
                  )}

                  <div className="action-row prescription-print-actions">
                    {role === 'PHARMACIST' && (
                      <>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => void runPharmacistAction(selectedPrescription.prescriptionId, 'verify')}
                          disabled={processingPrescriptionId === selectedPrescription.prescriptionId || selectedPrescription.status !== 'PENDING_VERIFICATION'}
                        >
                          Verify Prescription
                        </button>
                        <button
                          type="button"
                          onClick={() => void runPharmacistAction(selectedPrescription.prescriptionId, 'dispense')}
                          disabled={processingPrescriptionId === selectedPrescription.prescriptionId || selectedPrescription.status !== 'VERIFIED'}
                        >
                          {processingPrescriptionId === selectedPrescription.prescriptionId ? 'Dispensing...' : 'Dispense Medicine'}
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          onClick={() => void runPharmacistAction(selectedPrescription.prescriptionId, 'reject')}
                          disabled={processingPrescriptionId === selectedPrescription.prescriptionId || selectedPrescription.status === 'DISPENSED' || selectedPrescription.status === 'REJECTED'}
                        >
                          Reject Prescription
                        </button>
                      </>
                    )}
                    {(role !== 'PHARMACIST' || selectedPrescription.status === 'VERIFIED' || selectedPrescription.status === 'DISPENSED') && (
                      <button type="button" className="prescription-print-button" onClick={() => exportPrescriptionPdf(selectedPrescription)}>
                        Print Prescription
                      </button>
                    )}
                    {role === 'PHARMACIST' && (selectedPrescription.status === 'VERIFIED' || selectedPrescription.status === 'DISPENSED') && (
                      <button type="button" className="btn-secondary" onClick={() => exportMedicineLabelPdf(selectedPrescription)}>
                        Print Medicine Label
                      </button>
                    )}
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

      {medicinePickerIndex !== null && form.items[medicinePickerIndex] && (
        <MedicineSelectorModal
          subtitle="Choose approved, in-stock, non-expired inventory for this prescription item."
          medicines={activePickerOptions}
          selectedMedicineId={form.items[medicinePickerIndex].medicineId}
          selectedCategory={(activePickerCategory === 'DEFAULT' ? 'ALL' : activePickerCategory) as MedicineSelectorCategory}
          searchQuery={medicinePickerSearch[medicinePickerIndex] ?? ''}
          onCategoryChange={(category) => {
            setMedicinePickerCategory((prev) => ({ ...prev, [medicinePickerIndex]: category }));
            setMedicinePickerPage((prev) => ({ ...prev, [medicinePickerIndex]: 1 }));
          }}
          onSearchChange={(query) => {
            setMedicinePickerSearch((prev) => ({ ...prev, [medicinePickerIndex]: query }));
            setMedicinePickerPage((prev) => ({ ...prev, [medicinePickerIndex]: 1 }));
          }}
          onSelectMedicine={(medicine) => {
            if (!isPrescriptionReadyMedicine(medicine)) return;
            if (medicinePickerIndex === null) return;
            onUpdateItem(medicinePickerIndex, 'medicineId', medicine.medicineId);
            setMedicinePickerIndex(null);
          }}
          onClose={() => setMedicinePickerIndex(null)}
        />
      )}

      {shouldShowLegacyMedicinePicker() && medicinePickerIndex !== null && form.items[medicinePickerIndex ?? 0] && (
        <div className="medicine-picker-modal-layer" role="presentation">
          <button type="button" className="medicine-picker-modal-backdrop" aria-label="Close medicine picker" onClick={() => setMedicinePickerIndex(null)} />
          <section className="medicine-picker-modal prescription-select-modal" role="dialog" aria-modal="true" aria-labelledby="medicine-picker-title">
            <div className="medicine-picker-modal-head">
              <div>
                <h3 id="medicine-picker-title">Select Medicine</h3>
                <p className="muted">Choose approved, in-stock, non-expired inventory for this prescription item.</p>
              </div>
              <button type="button" className="patient-drawer-close" onClick={() => setMedicinePickerIndex(null)}>X</button>
            </div>

            <div className="walkin-picker-body prescription-picker-body">
              <aside className="walkin-picker-categories">
                {([
                  ['DEFAULT', 'Common'],
                  ['ALL', 'All'],
                  ['MEDICINE', 'Medicine'],
                  ['CONTROLLED_MEDICINE', 'Controlled'],
                  ['VITAMIN', 'Vitamin'],
                  ['SUPPLEMENT', 'Supplement'],
                ] as Array<[MedicinePickerCategory, string]>).map(([category, label]) => (
                  <button
                    key={category}
                    type="button"
                    className={(medicinePickerCategory[medicinePickerIndex ?? 0] ?? 'DEFAULT') === category ? 'is-active' : undefined}
                    onClick={() => {
                      setMedicinePickerCategory((prev) => ({ ...prev, [medicinePickerIndex ?? 0]: category }));
                      setMedicinePickerPage((prev) => ({ ...prev, [medicinePickerIndex ?? 0]: 1 }));
                    }}
                  >
                    {label}
                  </button>
                ))}
              </aside>

              <div className="walkin-picker-results">
                <input
                  value={medicinePickerSearch[medicinePickerIndex ?? 0] ?? ''}
                  onChange={(e) => {
                    setMedicinePickerSearch((prev) => ({ ...prev, [medicinePickerIndex ?? 0]: e.target.value }));
                    setMedicinePickerPage((prev) => ({ ...prev, [medicinePickerIndex ?? 0]: 1 }));
                  }}
                  placeholder="Search medicine, category, batch"
                  autoFocus
                />
                <p className="medicine-picker-helper">Showing approved, in-stock, non-expired items only.</p>

                <div className="walkin-medicine-list prescription-medicine-list">
                  {activePickerOptions.map((medicine) => {
                    const expiryStatus = getMedicineExpiryStatus(medicine);
                    const selected = medicine.medicineId === form.items[medicinePickerIndex ?? 0].medicineId;
                    return (
                      <article key={medicine.medicineId} className={`prescription-picker-medicine-card ${selected ? 'is-selected' : ''}`}>
                        <div className="prescription-picker-medicine-main">
                          <div className="prescription-picker-medicine-title">
                            <strong title={medicine.name}>{medicine.name}</strong>
                            <span className="prescription-picker-category">{getMedicineCategoryLabel(medicine.category)}</span>
                          </div>
                          <small title={`Available: ${formatMedicineStock(medicine)} - Exp ${toDateInput(medicine.expiryDate)} - RM ${formatMoney(medicine.price)} per ${medicine.stockUnit}`}>
                            Available: {formatMedicineStock(medicine)} - Exp {toDateInput(medicine.expiryDate)} - RM {formatMoney(medicine.price)} per {medicine.stockUnit}
                          </small>
                          <small title={`${getMedicineCategoryLabel(medicine.category)} • Batch ${medicine.batchNumber || '-'}`}>
                            {getMedicineCategoryLabel(medicine.category)} • Batch {medicine.batchNumber || '-'}
                          </small>
                        </div>
                        <span className={`status-badge ${expiryStatus === 'NEAR_EXPIRY' ? 'status-warning' : 'status-good'}`}>
                          {expiryStatus === 'NEAR_EXPIRY' ? 'Near Expiry' : 'Available'}
                        </span>
                        <button
                          type="button"
                          className={selected ? 'btn-secondary' : undefined}
                          onClick={() => {
                            if (!isPrescriptionReadyMedicine(medicine)) return;
                            onUpdateItem(medicinePickerIndex ?? 0, 'medicineId', medicine.medicineId);
                            setMedicinePickerIndex(null);
                          }}
                        >
                          {selected ? 'Selected' : 'Add'}
                        </button>
                      </article>
                    );
                  })}
                  {activePickerOptions.length === 0 && <p className="walkin-empty">No medicine found.</p>}
                </div>
              </div>
            </div>
          </section>
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
