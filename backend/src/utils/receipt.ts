import { format } from 'date-fns';

let counter = 1;

export const generateReceiptNo = () => {
  const datePart = format(new Date(), 'yyyyMMdd');
  const suffix = counter.toString().padStart(4, '0');
  counter += 1;
  return `RCP-${datePart}-${suffix}`;
};
