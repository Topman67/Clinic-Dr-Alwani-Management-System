import { NavLink } from 'react-router-dom';
import type { ComponentProps } from 'react';
import { cn, ui } from '../../styles/ui';

type SidebarItemProps = ComponentProps<typeof NavLink>;

export const SidebarItem = ({ className, ...props }: SidebarItemProps) => (
  <NavLink className={(state) => cn(ui.sidebarItem, state.isActive && 'active', typeof className === 'function' ? className(state) : className)} {...props} />
);
