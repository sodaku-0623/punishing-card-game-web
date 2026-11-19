import React from 'react';
import { cn } from '@/lib/cn';

export interface HudBracketsProps {
  color?: 'steel' | 'white' | 'crimson' | 'teal';
  size?: 'sm' | 'md';
  /** 开启后，在带有 group 类的父级容器悬停时产生向内锁焦动效 */
  interactive?: boolean;
  className?: string;
}

/**
 * 四角方角括号 ⌐ ¬ (docs/design/design-spec.md 5.9 / 5.2 / 6)
 */
export function HudBrackets({
  color = 'steel',
  size = 'md',
  interactive = false,
  className,
}: HudBracketsProps) {
  const borderColor =
    color === 'white'
      ? 'border-fg'
      : color === 'crimson'
        ? 'border-crimson-500'
        : color === 'teal'
          ? 'border-teal-400'
          : 'border-steel-500';

  const armClass = size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2';
  const hoverMove = interactive
    ? 'transition-all duration-fast ease-enter group-hover:border-fg'
    : '';

  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-0 select-none', className)}
    >
      <span
        className={cn(
          'absolute top-0 left-0 border-t border-l',
          armClass,
          borderColor,
          hoverMove,
          interactive && 'group-hover:translate-x-0.5 group-hover:translate-y-0.5',
        )}
      />
      <span
        className={cn(
          'absolute top-0 right-0 border-t border-r',
          armClass,
          borderColor,
          hoverMove,
          interactive && 'group-hover:-translate-x-0.5 group-hover:translate-y-0.5',
        )}
      />
      <span
        className={cn(
          'absolute bottom-0 left-0 border-b border-l',
          armClass,
          borderColor,
          hoverMove,
          interactive && 'group-hover:translate-x-0.5 group-hover:-translate-y-0.5',
        )}
      />
      <span
        className={cn(
          'absolute bottom-0 right-0 border-b border-r',
          armClass,
          borderColor,
          hoverMove,
          interactive && 'group-hover:-translate-x-0.5 group-hover:-translate-y-0.5',
        )}
      />
    </div>
  );
}
