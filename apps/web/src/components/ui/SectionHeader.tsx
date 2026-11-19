import React from 'react';
import { cn } from '@/lib/cn';

export interface SectionHeaderProps {
  title: string;
  subtitle: string;
  code?: string;
  pageLabel?: string;
  watermark?: string;
  variant?: 'default' | 'card';
  align?: 'center' | 'left';
  action?: React.ReactNode;
  className?: string;
}

/**
 * 战双标志性区块标题 (docs/design/design-spec.md 5.3)
 */
export function SectionHeader({
  title,
  subtitle,
  code,
  pageLabel,
  watermark,
  variant = 'default',
  align = 'left',
  action,
  className,
}: SectionHeaderProps) {
  if (variant === 'card') {
    return (
      <div
        className={cn(
          'relative overflow-hidden border border-line bg-steel-grid px-6 py-6',
          className,
        )}
      >
        {watermark && (
          <span
            aria-hidden="true"
            className="pointer-events-none select-none absolute -right-4 -bottom-4 font-display font-bold uppercase text-fg/[0.04] pgr-watermark"
          >
            {watermark}
          </span>
        )}
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            {code && (
              <div className="flex items-center gap-2 mb-1.5">
                <span aria-hidden="true" className="h-0.5 w-5 bg-crimson-500" />
                <span className="font-display text-hud uppercase text-steel-300">
                  {code}
                </span>
              </div>
            )}
            <h1 className="text-display font-bold italic tracking-wide text-fg title-offset">
              {title}
            </h1>
            <p className="mt-1 font-display text-hud uppercase text-steel-300">
              {subtitle}
            </p>
          </div>
          {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
        </div>
      </div>
    );
  }

  if (align === 'center') {
    return (
      <div className={cn('relative py-4 text-center', className)}>
        {watermark && (
          <span
            aria-hidden="true"
            className="pointer-events-none select-none absolute inset-x-0 top-1/2 -translate-y-1/2 font-display font-bold uppercase text-fg/[0.04] pgr-watermark overflow-hidden whitespace-nowrap"
          >
            {watermark}
          </span>
        )}
        <div className="relative z-10">
          <div className="flex items-center justify-center gap-3">
            <span aria-hidden="true" className="h-px flex-1 max-w-28 bg-line" />
            {code && (
              <span
                aria-hidden="true"
                className="hidden sm:inline font-display text-hud uppercase text-fg-muted"
              >
                · {code} ╲
              </span>
            )}
            <h2 className="text-title font-bold text-fg tracking-wider">{title}</h2>
            {code && (
              <span
                aria-hidden="true"
                className="hidden sm:inline font-display text-hud uppercase text-fg-muted"
              >
                ╱ {code} ·
              </span>
            )}
            <span aria-hidden="true" className="h-px flex-1 max-w-28 bg-line" />
          </div>
          <div className="mt-1.5 flex items-center justify-center gap-2.5">
            <span aria-hidden="true" className="h-0.5 w-6 bg-crimson-500" />
            <span className="font-display text-hud uppercase text-fg-muted">
              {subtitle}
            </span>
            <span aria-hidden="true" className="h-0.5 w-6 bg-crimson-500" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-line pb-4',
        className,
      )}
    >
      <div className="relative z-10 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span aria-hidden="true" className="h-3.5 w-0.5 bg-crimson-500" />
          {code && (
            <span className="font-display text-hud uppercase text-fg-muted">
              {code}
            </span>
          )}
          {pageLabel && (
            <>
              <span aria-hidden="true" className="text-fg-disabled text-hud">/</span>
              <span className="font-num text-hud text-fg-muted">{pageLabel}</span>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-display font-bold text-fg tracking-wide">{title}</h1>
          <span className="font-display text-hud uppercase text-fg-muted flex items-center gap-2">
            <span aria-hidden="true" className="h-px w-4 bg-crimson-500" />
            {subtitle}
          </span>
        </div>
      </div>
      {action && <div className="relative z-10 shrink-0 flex items-center gap-2">{action}</div>}
    </div>
  );
}
