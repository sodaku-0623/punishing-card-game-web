'use client';

import React from 'react';
import { ShieldAlert, Skull, Activity } from 'lucide-react';

interface ErosionBarProps {
  current: number; // 0..7 (or up to 10 on the mat)
  playerName: string;
  isOpponent?: boolean;
  compact?: boolean;
}

export const ErosionBar: React.FC<ErosionBarProps> = React.memo(({
  current,
  playerName,
  isOpponent = false,
  compact = false,
}) => {
  const isDanger = current >= 5;
  const isLoss = current >= 7;

  // 对应场地图 0 到 10 的水平刻度标尺
  const TICKS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  // 紧凑单行胶囊模式 (用于 1080p 紧凑 HUD，极大地压缩高度与宽度)
  if (compact) {
    return (
      <div
        {...(isOpponent ? { 'data-opponent-player-target': 'true' } : {})}
        className={`flex items-center justify-between px-2.5 py-1 rounded-xl border backdrop-blur-md transition-all select-none font-mono ${
          isDanger
            ? 'border-erosionRed/80 bg-erosionRed/20 shadow-[0_0_12px_rgba(255,42,109,0.35)]'
            : 'border-terminalBorder/70 bg-surface/75'
        }`}
      >
        <div className="flex items-center gap-1.5 text-xs">
          {isDanger ? (
            <ShieldAlert className="w-3.5 h-3.5 text-erosionRed animate-bounce" />
          ) : (
            <Activity className="w-3.5 h-3.5 text-terminalCyan" />
          )}
          <span className="font-bold text-white text-[11px] truncate max-w-[65px]">
            {playerName}
          </span>
          <span className="text-[10px] text-neutral-400 font-normal">
            {isOpponent ? '侵蚀' : '我方侵蚀'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* 7 个微型晶格指示灯 */}
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5, 6, 7].map((val) => {
              const filled = val <= current;
              return (
                <div
                  key={val}
                  className={`w-1.5 h-3 rounded-xs transition-all ${
                    filled
                      ? val >= 5
                        ? 'bg-erosionRed shadow-[0_0_6px_#ff2a5f]'
                        : 'bg-terminalCyan shadow-[0_0_4px_#00f0ff]'
                      : 'bg-neutral-800'
                  }`}
                  title={`侵蚀格 ${val}`}
                />
              );
            })}
          </div>

          <span
            className={`font-black text-xs px-1.5 py-px rounded ${
              isDanger
                ? 'bg-erosionRed text-white font-bold animate-pulse'
                : 'bg-neutral-900 text-terminalCyan border border-terminalCyan/40'
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
      {...(isOpponent ? { 'data-opponent-player-target': 'true' } : {})}
      className={`flex flex-col gap-1.5 p-3 rounded-2xl border backdrop-blur-md transition-all select-none ${
        isDanger
          ? 'border-erosionRed/60 bg-erosionRed/10 shadow-[0_0_20px_rgba(255,42,109,0.2)]'
          : 'border-terminalBorder/60 bg-surface/50'
      }`}
    >
      {/* 顶部玩家信息与数值 */}
      <div className="flex justify-between items-center text-xs font-mono">
        <span className="flex items-center gap-1.5 text-white font-bold tracking-wide">
          {isDanger ? (
            <ShieldAlert className="w-4 h-4 text-erosionRed animate-bounce" />
          ) : (
            <Activity className="w-3.5 h-3.5 text-terminalCyan" />
          )}
          <span>{playerName}</span>
          <span className="text-[10px] text-neutral-400 font-normal">
            {isOpponent ? '(对手)' : '(我方)'}
          </span>
        </span>

        <div className="flex items-center gap-2">
          <span className="text-[10px] text-neutral-400 font-mono">
            败北界限: 7
          </span>
          <span
            className={`font-bold font-mono px-2 py-0.5 rounded text-xs ${
              isDanger
                ? 'bg-erosionRed/20 text-erosionRed border border-erosionRed/40 animate-pulse'
                : 'bg-terminalCyan/20 text-terminalCyan border border-terminalCyan/30'
            }`}
          >
            侵蚀度: {current}
          </span>
        </div>
      </div>

      {/* 场地图风格的水平标尺: 侵蚀计数 0 1 2 3 4 5 6 7 8 9 10 */}
      <div className="flex flex-col gap-1 bg-neutral-950/90 p-2 rounded-xl border border-terminalBorder/40">
        <div className="flex items-center justify-between text-[11px] font-mono px-1">
          <span className="text-neutral-400 font-bold tracking-widest text-[10px]">
            侵蚀计数
          </span>
          <div className="flex items-center gap-2 sm:gap-3 text-neutral-400 font-bold">
            {TICKS.map((val) => {
              const isCurrent = val === current;
              const isThreshold = val === 7;
              return (
                <span
                  key={val}
                  className={`transition-all text-center min-w-[14px] ${
                    isCurrent
                      ? 'text-white font-black text-sm scale-125 text-terminalCyan drop-shadow-[0_0_8px_rgba(0,240,255,0.8)]'
                      : isThreshold
                      ? 'text-erosionRed/80 font-bold'
                      : 'text-neutral-500'
                  }`}
                >
                  {val}
                </span>
              );
            })}
          </div>
        </div>

        {/* 晶格标尺滑轨 */}
        <div className="grid grid-cols-11 gap-1 h-2.5 w-full bg-neutral-900 rounded p-0.5">
          {TICKS.map((val) => {
            const filled = val <= current;
            let barColor = 'bg-terminalCyan';
            if (val >= 4) barColor = 'bg-terminalGold';
            if (val >= 6) barColor = 'bg-erosionRed';

            return (
              <div
                key={val}
                className={`h-full rounded-sm transition-all duration-300 ${
                  filled ? `${barColor} shadow-sm` : 'bg-neutral-800/40'
                } ${val === 7 ? 'border-r-2 border-red-500' : ''}`}
              />
            );
          })}
        </div>
      </div>

      {isLoss && (
        <div className="flex items-center justify-center gap-1.5 text-xs text-erosionRed font-bold font-mono py-0.5 animate-pulse">
          <Skull className="w-4 h-4" />
          <span>侵蚀超限 • 达到 7 败北判定 (1.2.2.a)</span>
        </div>
      )}
    </div>
  );
});

ErosionBar.displayName = 'ErosionBar';
