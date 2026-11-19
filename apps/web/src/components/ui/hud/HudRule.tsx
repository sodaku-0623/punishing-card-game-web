import React from 'react';
import { cn } from '@/lib/cn';

export interface HudRuleProps {
  code?: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

/**
 * 细线 + 两端小点 + 可选编号 (docs/design/design-spec.md 5.9)
 */
export function HudRule({ code, align = 'left', className }: HudRuleProps) {
  return (
    <div
      aria-hidden="true"
      className={cn('flex items-center gap-2 select-none pointer-events-none', className)}
    >
      <span className="h-1 w-1 shrink-0 bg-line-strong" />
      <span className="h-px flex-1 bg-line" />
      {code && (
        <span
          className={cn(
            'font-display text-hud uppercase text-fg-muted shrink-0',
            align === 'center' && 'px-1',
          )}
        >
          {code}
        </span>
      )}
      {code && <span className="h-px flex-1 bg-line" />}
      <span className="h-1 w-1 shrink-0 bg-line-strong" />
    </div>
  );
}
