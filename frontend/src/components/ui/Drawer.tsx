import type { HTMLAttributes } from 'react';
import { cn, ui } from '../../styles/ui';

export const DrawerLayer = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(ui.drawerLayer, className)} {...props} />
);

export const DrawerPanel = ({ className, ...props }: HTMLAttributes<HTMLElement>) => (
  <aside className={cn(ui.drawerPanel, className)} {...props} />
);

export const DrawerBody = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(ui.drawerBody, className)} {...props} />
);

export const DrawerFooter = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn(ui.drawerFooter, className)} {...props} />
);
