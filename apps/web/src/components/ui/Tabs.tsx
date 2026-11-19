'use client';

import React from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
  count?: number;
}

export interface TabsProps<T extends string = string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * 官网新闻区风格标签页 (docs/design/design-spec.md 5.5)
 * 当前项白字 + 下方 24px 宽红色短线 + 左上角红色序号 (01)
 */
export function Tabs<T extends string = string>({
  items,
  value,
  onChange,
  className,
}: TabsProps<T>) {
  return (
    <div
      role="tablist"
      className={cn(
        'flex flex-wrap items-end gap-6 border-b border-line',
        className,
      )}
    >
      {items.map((item, idx) => {
        const active = item.id === value;
        const indexLabel = String(idx + 1).padStart(2, '0');

        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.id)}
            className={cn(
              'group relative pb-3 pt-2 text-left transition-colors duration-base ease-enter cursor-pointer',
              active ? 'text-fg' : 'text-fg-muted hover:text-fg-secondary',
            )}
          >
            <div className="flex items-baseline gap-1.5">
              <span
                aria-hidden="true"
                className={cn(
                  'font-num text-hud tabular-nums transition-colors duration-fast',
                  active ? 'text-crimson-400 font-semibold' : 'text-fg-disabled group-hover:text-fg-muted',
                )}
              >
                {indexLabel}
              </span>
              <span className="text-body font-medium">{item.label}</span>
              {typeof item.count === 'number' && (
                <span className="font-num tabular-nums text-caption text-fg-muted">
                  ({item.count})
                </span>
              )}
            </div>
            <span
              aria-hidden="true"
              className={cn(
                'absolute bottom-0 left-0 h-0.5 bg-crimson-500 transition-all duration-base ease-enter',
                active ? 'w-6 opacity-100' : 'w-0 opacity-0 group-hover:w-3 group-hover:opacity-50',
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
