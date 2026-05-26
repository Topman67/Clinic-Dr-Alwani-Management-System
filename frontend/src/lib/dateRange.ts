export type DateRangePreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'custom' | 'all';

export type DateRangeValue = {
  preset: DateRangePreset;
  dateFrom: string;
  dateTo: string;
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
