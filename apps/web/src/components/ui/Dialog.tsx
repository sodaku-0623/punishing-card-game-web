'use client';

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  blurBackdrop?: boolean;
  closeOnBackdrop?: boolean;
  hideCloseButton?: boolean;
  footer?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

const SIZE_CLASSES: Record<NonNullable<DialogProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  full: 'max-w-6xl',
};

/**
 * 战双切角模态弹窗 (docs/design/design-spec.md 5.7)
 * 支持 role="dialog"、aria-modal、Esc 关闭与焦点锁定
 */
export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  blurBackdrop = false,
  closeOnBackdrop = true,
  hideCloseButton = false,
  footer,
  className,
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = React.useId();

  useEffect(() => {
    if (!open) return;

    const prevActive = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }

      // Tab 焦点锁定在弹窗内 (5.7)
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || document.activeElement === panelRef.current) {
            e.preventDefault();
            last.focus();
          }
        } else if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      prevActive?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-modal flex items-center justify-center p-4 bg-overlay animate-in fade-in duration-fast',
        blurBackdrop && 'backdrop-blur-md',
      )}
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          'relative w-full bg-ink-900 border border-line-strong clip-corner-md shadow-overlay',
          'flex flex-col max-h-[90vh] overflow-hidden focus:outline-none',
          'animate-in fade-in zoom-in-95 duration-fast',
          SIZE_CLASSES[size],
          className,
        )}
      >
        {(title || !hideCloseButton) && (
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <span aria-hidden="true" className="h-4 w-0.5 shrink-0 bg-crimson-500" />
              <div className="min-w-0">
                {title && (
                  <h2 id={titleId} className="text-title-sm font-semibold text-fg truncate">
                    {title}
                  </h2>
                )}
                {subtitle && (
                  <p className="font-display text-hud uppercase text-fg-muted truncate">
                    {subtitle}
                  </p>
                )}
              </div>
            </div>
            {!hideCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭弹窗"
                className="h-8 w-8 inline-flex items-center justify-center border border-line text-fg-secondary hover:text-fg hover:border-line-strong hover:bg-ink-800 transition-colors duration-fast cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-3 border-t border-line px-5 py-3 bg-ink-950/60 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
