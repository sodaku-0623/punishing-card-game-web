'use client';

import React from 'react';
import { ShieldAlert, Skull, Activity } from 'lucide-react';

interface ErosionBarProps {
  current: number;
  playerName: string;
  isOpponent?: boolean;
  compact?: boolean;
  isAttackTargetable?: boolean;
}

/**
 * 侵蚀条 (docs/design/design-spec.md 6. 对局界面)
 * crimson-500 实心分段条，每段之间 2px 间隔，无持续闪烁
 */
export const ErosionBar: React.FC<ErosionBarProps> = React.memo(({
  current,
  playerName,
  isOpponent = false,
  compact = false,
  isAttackTargetable = false,
}) => {
  const isDanger = current >= 5;
  const isLoss = current >= 7;
  const TICKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  if (compact) {
    return (
      <div
        {...(isOpponent && isAttackTargetable ? { 'data-opponent-player-target': 'true' } : {})}
        className={`flex items-center justify-between gap-2 px-3 py-1 border bg-ink-900/90 backdrop-blur-md transition-colors duration-fast select-none min-w-[196px] ${
          isDanger ? 'border-crimson-500' : 'border-line'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {isDanger ? (
            <ShieldAlert className="w-3.5 h-3.5 text-crimson-400 shrink-0" />
          ) : (
            <Activity
              className={`w-3.5 h-3.5 shrink-0 ${
                isOpponent ? 'text-crimson-400' : 'text-teal-400'
              }`}
            />
          )}
          <span className="font-semibold text-fg text-caption truncate max-w-[84px]">
            {playerName}
          </span>
          <span className="text-hud text-fg-muted shrink-0">
            侵蚀
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* 7 段 crimson-500 实心分段条，每段 2px 间隔 */}
          <div className="flex items-center gap-[2px]" aria-label={`侵蚀度 ${current} / 7`}>
            {[1, 2, 3, 4, 5, 6, 7].map((val) => {
              const filled = val <= current;
              return (
                <div
                  key={val}
                  className={`w-1.5 h-3 transition-colors duration-base ${
                    filled ? 'bg-crimson-500' : 'bg-ink-700'
                  }`}
                  title={`侵蚀格 ${val}`}
                />
              );
            })}
          </div>

          <span
            className={`font-num tabular-nums font-bold text-caption px-1.5 py-px border ${
              isDanger
                ? 'bg-crimson-500 text-fg border-crimson-500'
                : 'bg-ink-950 text-fg border-line'
            }`}
          >
            {current}/7
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      {...(isOpponent && isAttackTargetable ? { 'data-opponent-player-target': 'true' } : {})}
      className={`flex flex-col gap-2 p-3 border bg-ink-900/90 select-none transition-colors duration-fast ${
        isDanger ? 'border-crimson-500' : 'border-line'
      }`}
    >
      <div className="flex justify-between items-center text-caption">
        <span className="flex items-center gap-1.5 text-fg font-semibold">
          {isDanger ? (
            <ShieldAlert className="w-4 h-4 text-crimson-400" />
          ) : (
            <Activity className={`w-3.5 h-3.5 ${isOpponent ? 'text-crimson-400' : 'text-teal-400'}`} />
          )}
          <span>{playerName}</span>
          <span className="text-hud text-fg-muted font-normal">侵蚀</span>
        </span>

        <div className="flex items-center gap-2">
          <span className="text-hud text-fg-muted">败北界限 7</span>
          <span
            className={`font-num tabular-nums font-bold px-2 py-0.5 border text-caption ${
              isDanger
                ? 'bg-crimson-500 text-fg border-crimson-500'
                : 'bg-ink-850 text-fg border-line'
            }`}
          >
            {current} / 7
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 bg-ink-950 p-2 border border-line">
        <div className="flex items-center justify-between font-num text-hud px-0.5">
          <span className="text-fg-muted font-display uppercase">EROSION</span>
          <div className="flex items-center gap-2 sm:gap-3">
            {TICKS.map((val) => {
              const isCurrent = val === current;
              const isThreshold = val === 7;
              return (
                <span
                  key={val}
                  className={`tabular-nums min-w-[14px] text-center transition-colors ${
                    isCurrent
                      ? 'text-fg font-bold'
                      : isThreshold
                        ? 'text-crimson-400 font-semibold'
                        : 'text-fg-disabled'
                  }`}
                >
                  {val}
                </span>
              );
            })}
          </div>
        </div>

        {/* 实心分段条，每段 2px 间隔 */}
        <div className="grid grid-cols-11 gap-[2px] h-2 w-full">
          {TICKS.map((val) => {
            const filled = val <= current && val > 0;
            return (
              <div
                key={val}
                className={`h-full transition-colors duration-base ${
                  filled ? 'bg-crimson-500' : 'bg-ink-700'
                } ${val === 7 ? 'border-r border-crimson-400' : ''}`}
              />
            );
          })}
        </div>
      </div>

      {isLoss && (
        <div className="flex items-center justify-center gap-1.5 text-caption text-crimson-400 font-semibold py-0.5">
          <Skull className="w-4 h-4" />
          <span>侵蚀超限 · 达到 7 败北判定 (1.2.2.a)</span>
        </div>
      )}
    </div>
  );
});

ErosionBar.displayName = 'ErosionBar';
