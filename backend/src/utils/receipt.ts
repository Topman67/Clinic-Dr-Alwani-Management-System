import { format } from 'date-fns';

export const generateReceiptNo = () => {
  const dateTimePart = format(new Date(), 'yyyyMMdd-HHmmssSSS');
  const randomSuffix = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `RCP-${dateTimePart}-${randomSuffix}`;
};
