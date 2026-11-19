'use client';

import React from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-crimson-500 text-fg clip-corner-sm pgr-sweep hover:bg-crimson-hover active:bg-crimson-700 active:scale-[0.98] disabled:bg-ink-600 disabled:text-fg-disabled disabled:hover:bg-ink-600 disabled:active:scale-100',
  secondary:
    'bg-transparent border border-line-strong text-fg pgr-sweep hover:bg-ink-800 hover:border-fg/50 active:bg-ink-700 active:scale-[0.98] disabled:bg-ink-600 disabled:border-line disabled:text-fg-disabled',
  ghost:
    'bg-transparent text-fg-secondary hover:text-fg hover:bg-ink-800/70 active:bg-ink-700 disabled:text-fg-disabled disabled:hover:bg-transparent',
  danger:
    'bg-transparent border border-crimson-500/70 text-crimson-400 hover:bg-crimson-700/30 hover:border-crimson-400 active:bg-crimson-700/50 active:scale-[0.98] disabled:bg-ink-600 disabled:border-line disabled:text-fg-disabled',
  icon:
    'bg-transparent border border-line text-fg-secondary hover:text-fg hover:border-line-strong hover:bg-ink-800 active:bg-ink-700 disabled:bg-ink-600 disabled:text-fg-disabled',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-caption gap-1.5',
  md: 'h-9 px-4 text-body-sm gap-2',
  lg: 'h-11 px-6 text-body gap-2',
};

const ICON_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-7 w-7 p-0',
  md: 'h-8 w-8 p-0',
  lg: 'h-10 w-10 p-0',
};

/**
 * 战双战术按钮 (docs/design/design-spec.md 5.1)
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = 'secondary',
      size = 'md',
      loading = false,
      disabled,
      className,
      children,
      type = 'button',
      ...props
    },
    ref,
  ) {
    const isDisabled = disabled || loading;

    return (
      <button
        ref={ref}
        type={type}
        disabled={isDisabled}
        className={cn(
          'inline-flex items-center justify-center font-medium whitespace-nowrap rounded-none select-none',
          'transition-all duration-fast ease-enter cursor-pointer disabled:cursor-not-allowed',
          VARIANT_CLASSES[variant],
          variant === 'icon' ? ICON_SIZE_CLASSES[size] : SIZE_CLASSES[size],
          className,
        )}
        {...props}
      >
        {loading && (
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 border border-current border-t-transparent rounded-full animate-spin"
          />
        )}
        {children}
      </button>
    );
  },
);
