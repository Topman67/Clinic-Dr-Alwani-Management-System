import type { HTMLAttributes } from 'react';
import { cn, ui } from '../../styles/ui';

type BadgeTone = keyof typeof ui.badgeTone;

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
};

export const Badge = ({ className, tone = 'neutral', ...props }: BadgeProps) => (
  <span className={cn(ui.badge, ui.badgeTone[tone], className)} {...props} />
);
