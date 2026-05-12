import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn, ui } from '../../styles/ui';

export const TableWrap = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(ui.tableWrap, className)} {...props} />
);

export const Table = ({ className, ...props }: TableHTMLAttributes<HTMLTableElement>) => (
  <table className={cn(ui.table, className)} {...props} />
);

export const TableHead = ({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) => (
  <thead className={cn(ui.tableHead, className)} {...props} />
);

export const Th = ({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) => (
  <th className={cn(ui.tableHeaderCell, className)} {...props} />
);

export const Td = ({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn(ui.tableCell, className)} {...props} />
);
