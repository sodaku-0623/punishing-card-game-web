import React from 'react';
import { cn } from '@/lib/cn';

export interface HudCautionProps {
  label?: string;
  accent?: 'muted' | 'crimson' | 'gold';
  className?: string;
}

/**
 * 倒三角 + CAUTION 警示标识 (docs/design/design-spec.md 5.9)
 */
export function HudCaution({
  label = 'CAUTION',
  accent = 'muted',
  className,
}: HudCautionProps) {
  const colorClass =
    accent === 'crimson'
      ? 'text-crimson-400'
      : accent === 'gold'
        ? 'text-gold-300'
        : 'text-fg-muted';

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex items-center gap-1.5 font-display text-hud uppercase select-none pointer-events-none',
        colorClass,
        className,
      )}
    >
      <svg
        width="8"
        height="7"
        viewBox="0 0 8 7"
        fill="currentColor"
        className="shrink-0"
      >
        <path d="M0 0H8L4 7L0 0Z" />
      </svg>
      <span>{label}</span>
    </span>
  );
}
