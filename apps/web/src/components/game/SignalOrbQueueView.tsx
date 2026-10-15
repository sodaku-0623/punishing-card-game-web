'use client';

import React, { useMemo } from 'react';
import { CardInstance, SignalOrbType } from '@zhanshuang/shared';
import { Layers, Zap, Sparkles } from 'lucide-react';
import { findCardByNumberOrId } from '@/lib/cards-data';

interface SignalOrbQueueViewProps {
  orbs: CardInstance[];
  selectedOrbIds: string[];
  onToggleSelectOrb?: (orbId: string) => void;
  onEliminate?: (orbIds: [string, string, string]) => void;
  isOpponent?: boolean;
  compact?: boolean;
}

export type OrbColorType = 'RED' | 'BLUE' | 'YELLOW' | 'UNKNOWN';

export interface OrbDisplayInfo {
  instanceId: string;
  cardNumber: string;
  color: OrbColorType;
  label: string;
  name: string;
  index: number;
}

export const SignalOrbQueueView: React.FC<SignalOrbQueueViewProps> = React.memo(({
  orbs,
  selectedOrbIds,
  onToggleSelectOrb,
  onEliminate,
  isOpponent = false,
  compact = false,
}) => {
  // 解析信号球颜色与定义信息
  const orbList: OrbDisplayInfo[] = useMemo(() => {
    return orbs.map((orb, index) => {
      const def = findCardByNumberOrId(orb.cardNumber || orb.cardId);
      const num = (orb.cardNumber || '').toUpperCase();
      const name = def?.name || '';
      const traits = def?.traits || [];
      const signalOrb = def?.signalOrb;

      let color: OrbColorType = 'UNKNOWN';
      let label = '球';

      // 1. 优先使用卡牌定义中的权威 signalOrb 字段
      if (signalOrb === SignalOrbType.RED) {
        color = 'RED';
        label = '红';
      } else if (signalOrb === SignalOrbType.BLUE) {
        color = 'BLUE';
        label = '蓝';
      } else if (signalOrb === SignalOrbType.YELLOW) {
        color = 'YELLOW';
        label = '黄';
      } else if (
        traits.some((t) => t === '信号球·红' || t.includes('球·红')) ||
        num.includes('ORB-RED') ||
        num.endsWith('-RED') ||
        name.includes('信号球·红') ||
        name.includes('红球')
      ) {
        color = 'RED';
        label = '红';
      } else if (
        traits.some((t) => t === '信号球·蓝' || t.includes('球·蓝')) ||
        num.includes('ORB-BLUE') ||
        num.endsWith('-BLUE') ||
        name.includes('信号球·蓝') ||
        name.includes('蓝球')
      ) {
        color = 'BLUE';
        label = '蓝';
      } else if (
        traits.some((t) => t === '信号球·黄' || t.includes('球·黄')) ||
        num.includes('ORB-YELLOW') ||
        num.endsWith('-YELLOW') ||
        name.includes('信号球·黄') ||
        name.includes('黄球')
      ) {
        color = 'YELLOW';
        label = '黄';
      }

      return {
        instanceId: orb.instanceId,
        cardNumber: orb.cardNumber,
        color,
        label,
        name: name || `信号球·${label}`,
        index,
      };
    });
  }, [orbs]);

  // 各颜色信号球统计
  const counts = useMemo(() => {
    let red = 0;
    let blue = 0;
    let yellow = 0;
    for (const item of orbList) {
      if (item.color === 'RED') red++;
      else if (item.color === 'BLUE') blue++;
      else if (item.color === 'YELLOW') yellow++;
    }
    return { red, blue, yellow };
  }, [orbList]);

  // 检测是否存在可一键触发的三消组合 (同色三消优先，其次物理相邻三消)
  const availableTriple = useMemo<{
    type: 'RED' | 'BLUE' | 'YELLOW' | 'ADJACENT';
    label: string;
    orbIds: [string, string, string];
  } | null>(() => {
    // 1. 同色三消 (如三颗红球到达3)
    const redOrbs = orbList.filter((o) => o.color === 'RED');
    if (redOrbs.length >= 3) {
      return {
        type: 'RED',
        label: '红球三消',
        orbIds: [redOrbs[0]!.instanceId, redOrbs[1]!.instanceId, redOrbs[2]!.instanceId],
      };
    }
    const blueOrbs = orbList.filter((o) => o.color === 'BLUE');
    if (blueOrbs.length >= 3) {
      return {
        type: 'BLUE',
        label: '蓝球三消',
        orbIds: [blueOrbs[0]!.instanceId, blueOrbs[1]!.instanceId, blueOrbs[2]!.instanceId],
      };
    }
    const yellowOrbs = orbList.filter((o) => o.color === 'YELLOW');
    if (yellowOrbs.length >= 3) {
      return {
        type: 'YELLOW',
        label: '黄球三消',
        orbIds: [yellowOrbs[0]!.instanceId, yellowOrbs[1]!.instanceId, yellowOrbs[2]!.instanceId],
      };
    }

    // 2. 任意连续相邻三消
    if (orbList.length >= 3) {
      return {
        type: 'ADJACENT',
        label: '三球连消',
        orbIds: [orbList[0]!.instanceId, orbList[1]!.instanceId, orbList[2]!.instanceId],
      };
    }

    return null;
  }, [orbList]);

  // 校验当前选中的 3 颗球是否合法 (按位置排序后相邻，或者颜色相同)
  const canEliminateSelected = useMemo(() => {
    if (selectedOrbIds.length !== 3 || !onEliminate) return false;

    const orbIds = orbs.map((o) => o.instanceId);
    const sorted = [...selectedOrbIds].sort(
      (a, b) => orbIds.indexOf(a) - orbIds.indexOf(b)
    );
    const idx0 = orbIds.indexOf(sorted[0]!);
    const idx1 = orbIds.indexOf(sorted[1]!);
    const idx2 = orbIds.indexOf(sorted[2]!);

    if (idx0 === -1 || idx1 === -1 || idx2 === -1) return false;

    const isAdjacent = idx1 === idx0 + 1 && idx2 === idx1 + 1;

    // 同色判定
    const color0 = orbList.find((o) => o.instanceId === sorted[0])?.color;
    const color1 = orbList.find((o) => o.instanceId === sorted[1])?.color;
    const color2 = orbList.find((o) => o.instanceId === sorted[2])?.color;
    const isSameColor =
      color0 && color0 !== 'UNKNOWN' && color0 === color1 && color1 === color2;

    return isAdjacent || isSameColor;
  }, [selectedOrbIds, onEliminate, orbs, orbList]);

  // 获得选中三球的 ID 列表并保证顺序
  const sortedSelectedIds = useMemo<[string, string, string] | null>(() => {
    if (selectedOrbIds.length !== 3) return null;
    const orbIds = orbs.map((o) => o.instanceId);
    const sorted = [...selectedOrbIds].sort(
      (a, b) => orbIds.indexOf(a) - orbIds.indexOf(b)
    );
    return [sorted[0]!, sorted[1]!, sorted[2]!];
  }, [selectedOrbIds, orbs]);

  function getOrbStyle(color: OrbColorType) {
    switch (color) {
      case 'RED':
        return 'bg-gradient-to-br from-red-500 via-red-600 to-rose-700 border-red-400 text-white shadow-[0_0_12px_rgba(239,68,68,0.6)]';
      case 'BLUE':
        return 'bg-gradient-to-br from-blue-500 via-blue-600 to-cyan-700 border-blue-400 text-white shadow-[0_0_12px_rgba(59,130,246,0.6)]';
      case 'YELLOW':
        return 'bg-gradient-to-br from-amber-400 via-amber-500 to-yellow-600 border-amber-300 text-neutral-950 shadow-[0_0_12px_rgba(245,158,11,0.6)]';
      default:
        return 'bg-neutral-700 border-neutral-400 text-white';
    }
  }

  // 智能点击：若当前未选满3球且点击的球属于可用三消组合，可一键高亮整组
  function handleOrbClick(clickedId: string) {
    if (onToggleSelectOrb) {
      onToggleSelectOrb(clickedId);
    }
  }

  if (compact) {
    return (
      <div className="flex items-center justify-between px-3 py-1 rounded-xl border border-terminalBorder/60 bg-surface/50 backdrop-blur-sm select-none w-full gap-2 text-xs font-mono h-11 shadow-sm">
        {/* 左侧：微型标签与计数 */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-neutral-300 font-bold flex items-center gap-1 text-[11px]">
            <Zap className="w-3.5 h-3.5 text-terminalCyan" />
            <span>信号球</span>
          </span>
          <div className="flex items-center gap-1.5 text-[10px]">
            <span
              className={`px-1 rounded flex items-center gap-0.5 ${
                counts.red >= 3 ? 'text-red-400 font-bold' : 'text-neutral-400'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              <span>{counts.red}</span>
            </span>
            <span
              className={`px-1 rounded flex items-center gap-0.5 ${
                counts.blue >= 3 ? 'text-blue-400 font-bold' : 'text-neutral-400'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              <span>{counts.blue}</span>
            </span>
            <span
              className={`px-1 rounded flex items-center gap-0.5 ${
                counts.yellow >= 3 ? 'text-amber-400 font-bold' : 'text-neutral-400'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span>{counts.yellow}</span>
            </span>
          </div>
        </div>

        {/* 中间：横向球槽队列 */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 px-1 flex-1 justify-center">
          {orbList.length === 0 ? (
            <span className="text-[10px] text-neutral-500 italic">空 (通过战术或出牌充能)</span>
          ) : (
            orbList.map((orb) => {
              const isSelected = selectedOrbIds.includes(orb.instanceId);
              const isPartOfAvailableTriple =
                availableTriple?.orbIds.includes(orb.instanceId);

              const ORB_HOTKEYS = ['Q', 'W', 'E', 'R', 'T', 'Y'];
              return (
                <button
                  key={orb.instanceId}
                  type="button"
                  disabled={isOpponent}
                  onClick={() => handleOrbClick(orb.instanceId)}
                  className={`relative w-7 h-7 rounded-full border transition-all flex items-center justify-center font-bold text-[10px] font-mono select-none shrink-0 ${getOrbStyle(
                    orb.color
                  )} ${
                    isSelected
                      ? 'ring-2 ring-white scale-110 shadow-[0_0_10px_rgba(255,255,255,0.85)] z-10'
                      : isPartOfAvailableTriple
                      ? 'ring-1 ring-terminalGold/70 shadow-[0_0_6px_rgba(255,200,0,0.5)]'
                      : 'opacity-90 hover:opacity-100 hover:scale-105'
                  }`}
                  title={`${orb.name} (第${orb.index + 1}球${orb.index < ORB_HOTKEYS.length ? `，快捷键: ${ORB_HOTKEYS[orb.index]}` : ''})`}
                >
                  <span className="leading-none">{orb.label}</span>
                  {!isOpponent && orb.index < ORB_HOTKEYS.length && (
                    <span className="absolute -bottom-1 -left-1 px-0.5 rounded bg-black/85 border border-cyan-500/50 text-[7px] text-cyan-300 font-mono font-bold leading-tight pointer-events-none shadow">
                      {ORB_HOTKEYS[orb.index]}
                    </span>
                  )}
                  {isPartOfAvailableTriple && !isSelected && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-yellow-400 border border-neutral-950 animate-ping" />
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* 右侧：紧凑三消按钮 */}
        {!isOpponent && onEliminate && (
          <div className="flex items-center gap-1.5 shrink-0">
            {canEliminateSelected && sortedSelectedIds && (
              <button
                type="button"
                onClick={() => onEliminate(sortedSelectedIds)}
                className="px-2.5 py-1 rounded-lg bg-terminalGold hover:bg-yellow-400 text-neutral-950 font-black text-[10px] font-mono flex items-center gap-1 shadow animate-bounce active:scale-95"
                title="消除所选的 3 张信号球并抽 1 张牌 (快捷键: X)"
              >
                <Layers className="w-3 h-3" />
                <span>三消抽牌 [X]</span>
              </button>
            )}
            {!canEliminateSelected && availableTriple && (
              <button
                type="button"
                onClick={() => onEliminate(availableTriple.orbIds)}
                className="px-2.5 py-1 rounded-lg bg-terminalGold hover:bg-yellow-400 text-neutral-950 font-black text-[10px] font-mono flex items-center gap-1 shadow animate-pulse hover:brightness-110 active:scale-95"
                title="一键发动可用三消组合并抽牌"
              >
                <Zap className="w-3 h-3 fill-current" />
                <span>一键三消</span>
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3 rounded-2xl border border-terminalBorder/60 bg-surface/40 backdrop-blur-sm select-none w-full">
      {/* 场地图视觉标题：〔 信号球区 〕 + 球色数量统计 */}
      <div className="flex justify-between items-center text-xs font-mono">
        <span className="flex items-center gap-1.5 text-neutral-200 font-bold tracking-wider">
          <span className="text-terminalCyan font-mono">〔</span>
          <span>{isOpponent ? '对方信号球区' : '信号球区'}</span>
          <span className="text-terminalCyan font-mono">〕</span>
          <span className="text-[10px] text-neutral-500 font-normal font-sans">
            SIGNAL ORB
          </span>
        </span>

        {/* 信号球存量与三色分类指示 */}
        <div className="flex items-center gap-2 text-[11px] font-mono">
          <span
            className={`px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1 border ${
              counts.red >= 3
                ? 'bg-red-500/20 border-red-500 text-red-300 font-bold shadow-[0_0_10px_rgba(239,68,68,0.5)] animate-pulse'
                : 'bg-neutral-900 border-neutral-800 text-neutral-400'
            }`}
            title="红球数量 (达到3球可触发红球三消抽卡与对应红球被动)"
          >
            <span className="w-2 h-2 rounded-full bg-red-500" />
            <span>红 {counts.red}</span>
            {counts.red >= 3 && <span className="text-[9px] text-yellow-300 font-bold">★可消</span>}
          </span>

          <span
            className={`px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1 border ${
              counts.blue >= 3
                ? 'bg-blue-500/20 border-blue-500 text-blue-300 font-bold shadow-[0_0_10px_rgba(59,130,246,0.5)] animate-pulse'
                : 'bg-neutral-900 border-neutral-800 text-neutral-400'
            }`}
            title="蓝球数量"
          >
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <span>蓝 {counts.blue}</span>
            {counts.blue >= 3 && <span className="text-[9px] text-yellow-300 font-bold">★可消</span>}
          </span>

          <span
            className={`px-1.5 py-0.5 rounded text-[10px] flex items-center gap-1 border ${
              counts.yellow >= 3
                ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold shadow-[0_0_10px_rgba(245,158,11,0.5)] animate-pulse'
                : 'bg-neutral-900 border-neutral-800 text-neutral-400'
            }`}
            title="黄球数量"
          >
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            <span>黄 {counts.yellow}</span>
            {counts.yellow >= 3 && <span className="text-[9px] text-yellow-300 font-bold">★可消</span>}
          </span>

          <span className="text-neutral-500 text-[10px]">
            共 {orbs.length} 球
          </span>
        </div>
      </div>

      {/* 信号球物理队列与操作条 */}
      <div className="flex items-center gap-2 overflow-x-auto py-1 min-h-[50px] px-1">
        {orbList.length === 0 ? (
          <span className="text-[11px] text-neutral-500 font-mono italic">
            暂无信号球（通过战斗充能或战术卡牌获得）
          </span>
        ) : (
          orbList.map((orb) => {
            const isSelected = selectedOrbIds.includes(orb.instanceId);
            const isPartOfAvailableTriple =
              availableTriple?.orbIds.includes(orb.instanceId);

            const ORB_HOTKEYS = ['Q', 'W', 'E', 'R', 'T', 'Y'];
            return (
              <button
                key={orb.instanceId}
                type="button"
                disabled={isOpponent}
                onClick={() => handleOrbClick(orb.instanceId)}
                className={`relative w-9 h-9 rounded-full border-2 transition-all duration-200 flex flex-col items-center justify-center font-bold text-xs font-mono select-none shrink-0 ${getOrbStyle(
                  orb.color
                )} ${
                  isSelected
                    ? 'ring-2 ring-white scale-115 -translate-y-1.5 shadow-[0_0_15px_rgba(255,255,255,0.85)] z-10'
                    : isPartOfAvailableTriple
                    ? 'hover:scale-110 ring-1 ring-terminalGold/60 shadow-[0_0_8px_rgba(255,200,0,0.5)]'
                    : 'hover:scale-110 opacity-90 hover:opacity-100'
                }`}
                title={`第 ${orb.index + 1} 球: ${orb.name} (${orb.cardNumber})${orb.index < ORB_HOTKEYS.length ? `，快捷键: ${ORB_HOTKEYS[orb.index]}` : ''}`}
              >
                <span className="text-[11px] font-black leading-none">
                  {orb.label}
                </span>
                <span className="text-[8px] opacity-80 leading-none mt-0.5">
                  {orb.index + 1}
                </span>

                {!isOpponent && orb.index < ORB_HOTKEYS.length && (
                  <span className="absolute -bottom-1 -left-1 px-1 py-0.2 rounded bg-black/85 border border-cyan-500/50 text-[8px] text-cyan-300 font-mono font-bold leading-tight pointer-events-none shadow">
                    {ORB_HOTKEYS[orb.index]}
                  </span>
                )}

                {/* 可三消发光小标记 */}
                {isPartOfAvailableTriple && !isSelected && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-yellow-400 border border-neutral-950 flex items-center justify-center animate-ping" />
                )}
              </button>
            );
          })
        )}

        {/* ================= 操作按钮区 (智能一键三消与多选三消) ================= */}
        {!isOpponent && onEliminate && (
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {/* 1. 已选中 3 球时的消除按钮 */}
            {canEliminateSelected && sortedSelectedIds && (
              <button
                type="button"
                onClick={() => onEliminate(sortedSelectedIds)}
                className="px-3.5 py-1.5 rounded-xl bg-terminalGold hover:bg-yellow-400 text-neutral-950 font-bold text-xs font-mono flex items-center gap-1.5 shadow-[0_0_12px_rgba(255,200,0,0.6)] animate-bounce transition-all active:scale-95"
                title="消除所选的 3 张信号球并抽 1 张牌 (快捷键: X)"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>三消抽牌 [X]</span>
              </button>
            )}

            {/* 2. 未手动选满 3 球时，若存在可用三消组合 (如红球达到3)，提供一键快速三消 */}
            {!canEliminateSelected && availableTriple && (
              <button
                type="button"
                onClick={() => onEliminate(availableTriple.orbIds)}
                className={`px-3 py-1.5 rounded-xl font-black text-xs font-mono flex items-center gap-1.5 shadow-lg transition-all active:scale-95 hover:scale-105 cursor-pointer ${
                  availableTriple.type === 'RED'
                    ? 'bg-erosionRed hover:bg-red-500 text-white shadow-[0_0_14px_rgba(255,50,80,0.6)] border border-red-300/50 animate-pulse'
                    : availableTriple.type === 'BLUE'
                    ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_14px_rgba(59,130,246,0.6)] border border-blue-300/50 animate-pulse'
                    : availableTriple.type === 'YELLOW'
                    ? 'bg-amber-500 hover:bg-amber-400 text-neutral-950 shadow-[0_0_14px_rgba(245,158,11,0.6)] border border-amber-200/50 animate-pulse'
                    : 'bg-terminalCyan hover:bg-terminalCyan/90 text-neutral-950 shadow-[0_0_14px_rgba(0,240,255,0.6)]'
                }`}
                title={`一键触发【${availableTriple.label}】并抽 1 张牌 (6.4.1.b.5)`}
              >
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>⚡ {availableTriple.label} (抽1张牌)</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

SignalOrbQueueView.displayName = 'SignalOrbQueueView';
