import React from 'react';
import { cn } from '@/lib/cn';

export type BadgeVariant = 'neutral' | 'crimson' | 'teal' | 'gold' | 'success';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: 'bg-ink-700 text-fg-secondary border border-line',
  crimson: 'bg-crimson-500 text-fg border border-crimson-500',
  teal: 'bg-teal-400/10 text-teal-400 border border-teal-400/60',
  gold: 'bg-gold-300/10 text-gold-300 border border-gold-300/50',
  success: 'bg-success/10 text-success border border-success/50',
};

/**
 * 直角战术徽标 (docs/design/design-spec.md 5.8)
 */
export function Badge({
  variant = 'neutral',
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 h-5 px-2 text-caption font-medium rounded-none whitespace-nowrap leading-none',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
