import React from 'react';
import { cn } from '@/lib/cn';
import { HudBrackets } from './hud/HudBrackets';

export interface PanelProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  subtitle?: string;
  headerRight?: React.ReactNode;
  brackets?: boolean;
  interactive?: boolean;
  cutCorner?: boolean;
  steel?: boolean;
  padded?: boolean;
}

/**
 * 直角战术面板 (docs/design/design-spec.md 5.2)
 */
export function Panel({
  title,
  subtitle,
  headerRight,
  brackets = false,
  interactive = false,
  cutCorner = false,
  steel = false,
  padded = true,
  className,
  children,
  ...props
}: PanelProps) {
  return (
    <div
      className={cn(
        'relative rounded-none border border-line',
        steel ? 'bg-steel-grid' : 'bg-ink-850',
        cutCorner && 'clip-corner-md',
        interactive && 'group transition-colors duration-fast ease-enter hover:border-line-strong',
        className,
      )}
      {...props}
    >
      {brackets && <HudBrackets interactive={interactive} />}

      {(title || headerRight) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span aria-hidden="true" className="h-4 w-0.5 shrink-0 bg-crimson-500" />
            <div className="min-w-0">
              {title && (
                <h3 className="text-title-sm font-medium text-fg truncate">{title}</h3>
              )}
              {subtitle && (
                <p className="font-display text-hud uppercase text-fg-muted truncate">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {headerRight && <div className="shrink-0 flex items-center gap-2">{headerRight}</div>}
        </div>
      )}

      <div className={cn(padded && 'p-4')}>{children}</div>
    </div>
  );
}
