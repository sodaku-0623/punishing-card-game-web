import React from 'react';
import { cn } from '@/lib/cn';

export interface HudStripesProps {
  className?: string;
}

/**
 * 45° 斜线条纹装饰块 (docs/design/design-spec.md 5.9)
 */
export function HudStripes({ className }: HudStripesProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('hud-stripes h-3 w-20 pointer-events-none select-none opacity-60', className)}
    />
  );
}
