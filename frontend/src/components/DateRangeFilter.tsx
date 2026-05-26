import { getDateRangeForPreset, type DateRangePreset, type DateRangeValue } from '../lib/dateRange';

type DateRangeFilterProps = {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  includeAll?: boolean;
  className?: string;
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
