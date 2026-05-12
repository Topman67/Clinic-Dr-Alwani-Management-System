import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import { cn, ui } from '../../styles/ui';

type ButtonVariant = 'primary' | 'secondary' | 'danger';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} className={cn(ui.button.base, ui.button[variant], className)} {...props} />
  ),
);

Button.displayName = 'Button';
