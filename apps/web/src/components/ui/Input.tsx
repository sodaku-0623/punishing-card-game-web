'use client';

import React from 'react';
import { cn } from '@/lib/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
  hint?: string;
  containerClassName?: string;
  leftSlot?: React.ReactNode;
  rightSlot?: React.ReactNode;
}

/**
 * 直角战术表单输入框 (docs/design/design-spec.md 5.6)
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input(
    {
      label,
      error,
      hint,
      id,
      className,
      containerClassName,
      leftSlot,
      rightSlot,
      ...props
    },
    ref,
  ) {
    const generatedId = React.useId();
    const inputId = id ?? generatedId;

    return (
      <div className={cn('w-full', containerClassName)}>
        {label && (
          <label
            htmlFor={inputId}
            className="block text-caption text-fg-muted mb-1.5 font-medium"
          >
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftSlot && (
            <div className="pointer-events-none absolute left-3 flex items-center text-fg-muted">
              {leftSlot}
            </div>
          )}
          <input
            ref={ref}
            id={inputId}
            aria-invalid={error ? 'true' : undefined}
            className={cn(
              'w-full h-9 px-3 bg-ink-800 border text-body text-fg placeholder:text-fg-disabled rounded-none',
              'transition-colors duration-fast ease-enter focus:outline-none',
              error
                ? 'border-crimson-400 focus:border-crimson-400'
                : 'border-line focus:border-teal-400',
              leftSlot && 'pl-9',
              rightSlot && 'pr-9',
              className,
            )}
            {...props}
          />
          {rightSlot && (
            <div className="absolute right-2.5 flex items-center text-fg-muted">
              {rightSlot}
            </div>
          )}
        </div>
        {error ? (
          <p className="mt-1 text-caption text-crimson-400">{error}</p>
        ) : hint ? (
          <p className="mt-1 text-caption text-fg-muted">{hint}</p>
        ) : null}
      </div>
    );
  },
);
