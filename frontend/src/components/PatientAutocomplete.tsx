import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';

export type PatientAutocompleteOption = {
  patientId: number;
  name: string;
  icOrPassport?: string | null;
  phone?: string | null;
  address?: string | null;
  isActive?: boolean;
  consultations?: Array<{
    status?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  }>;
};

type PatientSearchStatus = 'active' | 'archived' | 'all';

type PatientAutocompleteProps = {
  selectedPatient: PatientAutocompleteOption | null;
  onSelect: (patient: PatientAutocompleteOption | null) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
  helperText?: string | null;
  emptyStateLabel?: string;
  status?: PatientSearchStatus;
  filterResults?: (patient: PatientAutocompleteOption) => boolean;
};

const formatPatientMeta = (patient: PatientAutocompleteOption) => {
  const secondary = [patient.icOrPassport, patient.phone].filter(Boolean).join(' / ');
  return secondary.length > 0 ? secondary : `Patient #${patient.patientId}`;
};

export const PatientAutocomplete = ({
  selectedPatient,
  onSelect,
  placeholder = 'Search patient by name / IC / phone',
  disabled = false,
  invalid = false,
  required = false,
  helperText,
  emptyStateLabel = 'No matching patients found.',
  status = 'active',
  filterResults,
}: PatientAutocompleteProps) => {
  const [search, setSearch] = useState(selectedPatient?.name ?? '');
  const [results, setResults] = useState<PatientAutocompleteOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const blurTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (selectedPatient) {
      setSearch(selectedPatient.name);
      return;
    }

    setSearch('');
  }, [selectedPatient]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setResults([]);
      return;
    }

    const keyword = search.trim();
    if (!keyword) {
      setResults([]);
      setOpen(false);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const response = await api.get('/patients', { params: { query: keyword, status } });
          if (cancelled) return;
          const patients = response.data as PatientAutocompleteOption[];
          setResults(filterResults ? patients.filter(filterResults) : patients);
          setOpen(true);
        } catch {
          if (cancelled) return;
          setResults([]);
          setOpen(true);
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      })();
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [disabled, filterResults, search, status]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current !== null) {
        window.clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  const clearBlurTimeout = () => {
    if (blurTimeoutRef.current !== null) {
      window.clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  };

  const handleSelect = (patient: PatientAutocompleteOption) => {
    clearBlurTimeout();
    setSearch(patient.name);
    setResults([]);
    setOpen(false);
    onSelect(patient);
  };

  const handleClear = () => {
    clearBlurTimeout();
    setSearch('');
    setResults([]);
    setOpen(false);
    onSelect(null);
  };

  return (
    <div className="patient-autocomplete">
      <div className="patient-autocomplete__control">
        <input
          value={search}
          onChange={(e) => {
            const nextValue = e.target.value;
            setSearch(nextValue);
            if (!nextValue.trim() && selectedPatient) {
              onSelect(null);
            }
          }}
          onFocus={() => {
            if (search.trim()) {
              setOpen(true);
            }
          }}
          onBlur={() => {
            blurTimeoutRef.current = window.setTimeout(() => {
              setOpen(false);
            }, 140);
          }}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
          className={invalid ? 'field-invalid' : undefined}
        />

        {selectedPatient && (
          <button type="button" className="patient-autocomplete__clear" onClick={handleClear} aria-label="Clear patient filter">
            Clear
          </button>
        )}
      </div>

      {helperText && invalid && <small className="field-helper">{helperText}</small>}

      {selectedPatient && (
        <div className="patient-autocomplete__selected">
          <strong>{selectedPatient.name}</strong>
          <span>{formatPatientMeta(selectedPatient)}</span>
        </div>
      )}

      {open && (
        <div className="patient-autocomplete__menu">
          {loading ? (
            <div className="patient-autocomplete__state">Searching patients...</div>
          ) : results.length > 0 ? (
            results.slice(0, 8).map((patient) => (
              <button
                key={patient.patientId}
                type="button"
                className="patient-autocomplete__option"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(patient);
                }}
              >
                <strong>{patient.name}</strong>
                <span>{formatPatientMeta(patient)}</span>
              </button>
            ))
          ) : (
            <div className="patient-autocomplete__state">{emptyStateLabel}</div>
          )}
        </div>
      )}
    </div>
  );
};
