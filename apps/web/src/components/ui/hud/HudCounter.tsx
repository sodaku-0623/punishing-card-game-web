import React from 'react';
import { cn } from '@/lib/cn';

export interface HudCounterProps {
  current: number | string;
  total: number | string;
  prefix?: string;
  className?: string;
}

function padTwo(value: number | string): string {
  if (typeof value === 'number') {
    return String(value).padStart(2, '0');
  }
  return value;
}

/**
 * 01 / 05 页码指示器，当前数字使用 crimson-500 (docs/design/design-spec.md 5.9)
 */
export function HudCounter({ current, total, prefix, className }: HudCounterProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex items-baseline gap-1 font-num tabular-nums text-caption select-none pointer-events-none',
        className,
      )}
    >
      {prefix && (
        <span className="font-display text-hud uppercase text-fg-muted mr-1">{prefix}</span>
      )}
      <span className="font-semibold text-crimson-500">{padTwo(current)}</span>
      <span className="text-fg-muted">/</span>
      <span className="text-fg-muted">{padTwo(total)}</span>
    </span>
  );
}
