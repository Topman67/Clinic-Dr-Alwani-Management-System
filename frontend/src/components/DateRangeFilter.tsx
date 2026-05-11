export type DateRangePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'custom' | 'all';

export type DateRangeValue = {
  preset: DateRangePreset;
  dateFrom: string;
  dateTo: string;
};

type DateRangeFilterProps = {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  includeAll?: boolean;
  className?: string;
};

const toDateInput = (value: Date) => {
  const copy = new Date(value);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
};

const addDays = (value: Date, days: number) => {
  const copy = new Date(value);
  copy.setDate(copy.getDate() + days);
  return copy;
};

export const getDateRangeForPreset = (preset: DateRangePreset): DateRangeValue => {
  const today = new Date();

  if (preset === 'all') return { preset, dateFrom: '', dateTo: '' };
  if (preset === 'yesterday') {
    const yesterday = toDateInput(addDays(today, -1));
    return { preset, dateFrom: yesterday, dateTo: yesterday };
  }
  if (preset === 'last7') return { preset, dateFrom: toDateInput(addDays(today, -6)), dateTo: toDateInput(today) };
  if (preset === 'last30') return { preset, dateFrom: toDateInput(addDays(today, -29)), dateTo: toDateInput(today) };
  if (preset === 'thisMonth') {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { preset, dateFrom: toDateInput(start), dateTo: toDateInput(today) };
  }

  return { preset: 'today', dateFrom: toDateInput(today), dateTo: toDateInput(today) };
};

export const DateRangeFilter = ({ value, onChange, includeAll = true, className = '' }: DateRangeFilterProps) => {
  const updatePreset = (preset: DateRangePreset) => {
    if (preset === 'custom') {
      onChange({ ...value, preset });
      return;
    }
    onChange(getDateRangeForPreset(preset));
  };

  const updateCustomDate = (key: 'dateFrom' | 'dateTo', nextValue: string) => {
    onChange({ ...value, preset: 'custom', [key]: nextValue });
  };

  return (
    <div className={`date-range-filter ${className}`.trim()}>
      <select value={value.preset} onChange={(event) => updatePreset(event.target.value as DateRangePreset)} aria-label="Date range">
        {includeAll && <option value="all">All dates</option>}
        <option value="today">Today</option>
        <option value="yesterday">Yesterday</option>
        <option value="last7">Last 7 Days</option>
        <option value="last30">Last 30 Days</option>
        <option value="thisMonth">This Month</option>
        <option value="custom">Custom Date Range</option>
      </select>

      {value.preset === 'custom' && (
        <>
          <input type="date" value={value.dateFrom} onChange={(event) => updateCustomDate('dateFrom', event.target.value)} aria-label="Date from" />
          <input type="date" value={value.dateTo} onChange={(event) => updateCustomDate('dateTo', event.target.value)} aria-label="Date to" />
        </>
      )}
    </div>
  );
};
