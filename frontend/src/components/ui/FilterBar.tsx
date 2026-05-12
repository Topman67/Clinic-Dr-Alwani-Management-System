import type { FormHTMLAttributes } from 'react';
import { cn, ui } from '../../styles/ui';

export const FilterBar = ({ className, ...props }: FormHTMLAttributes<HTMLFormElement>) => (
  <form className={cn(ui.filterBar, className)} {...props} />
);
