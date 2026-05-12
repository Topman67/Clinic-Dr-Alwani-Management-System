import type { HTMLAttributes } from 'react';
import { cn, ui } from '../../styles/ui';

export const ModalLayer = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(ui.modalLayer, className)} {...props} />
);

export const ModalPanel = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(ui.modalPanel, className)} {...props} />
);
