import { forwardRef } from 'react';
import type { InputHTMLAttributes, LabelHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn, ui } from '../../styles/ui';

export const Field = ({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) => (
  <label className={cn(ui.field, className)} {...props} />
);

export const FieldLabel = ({ className, ...props }: LabelHTMLAttributes<HTMLSpanElement>) => (
  <span className={cn(ui.fieldLabel, className)} {...props} />
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(ui.formControl, className)} {...props} />,
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} className={cn(ui.formControl, className)} {...props} />,
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(ui.formControl, 'min-h-[88px] resize-y', className)} {...props} />,
);

Input.displayName = 'Input';
Select.displayName = 'Select';
Textarea.displayName = 'Textarea';
