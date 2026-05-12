import type { ElementType, HTMLAttributes } from 'react';
import { cn, ui } from '../../styles/ui';

type CardProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType;
};

export const Card = ({ as: Component = 'section', className, ...props }: CardProps) => (
  <Component className={cn(ui.card, className)} {...props} />
);
