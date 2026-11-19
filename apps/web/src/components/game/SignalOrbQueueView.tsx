'use client';

import React, { useMemo } from 'react';
import { CardInstance, SignalOrbType } from '@zhanshuang/shared';
import { Layers, Zap } from 'lucide-react';
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

const ORB_HOTKEYS = ['Q', 'W', 'E', 'R', 'T', 'Y'] as const;

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

    const color0 = orbList.find((o) => o.instanceId === sorted[0])?.color;
    const color1 = orbList.find((o) => o.instanceId === sorted[1])?.color;
    const color2 = orbList.find((o) => o.instanceId === sorted[2])?.color;
    const isSameColor =
      color0 && color0 !== 'UNKNOWN' && color0 === color1 && color1 === color2;

    return isAdjacent || isSameColor;
  }, [selectedOrbIds, onEliminate, orbs, orbList]);

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
        return 'bg-orb-red border-fg/40 text-fg';
      case 'BLUE':
        return 'bg-orb-blue border-fg/40 text-fg';
      case 'YELLOW':
        return 'bg-orb-yellow border-fg/50 text-ink-950';
      default:
        return 'bg-ink-700 border-line-strong text-fg';
    }
  }

  function handleOrbClick(clickedId: string) {
    if (onToggleSelectOrb) {
      onToggleSelectOrb(clickedId);
    }
  }

  if (compact) {
    return (
      <div className="flex items-center justify-between px-3 py-1 border border-line bg-ink-900/90 backdrop-blur-sm select-none w-full gap-2 text-caption h-11">
        {/* 左侧：标签与三色计数 */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-fg-secondary font-semibold flex items-center gap-1 text-hud">
            <Zap className="w-3.5 h-3.5 text-teal-400" />
            <span>信号球</span>
          </span>
          <div className="flex items-center gap-1.5 text-hud font-num tabular-nums">
            <span
              className={`px-1 flex items-center gap-1 ${
                counts.red >= 3 ? 'text-orb-red font-bold' : 'text-fg-muted'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-orb-red" />
              <span>{counts.red}</span>
            </span>
            <span
              className={`px-1 flex items-center gap-1 ${
                counts.blue >= 3 ? 'text-orb-blue font-bold' : 'text-fg-muted'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-orb-blue" />
              <span>{counts.blue}</span>
            </span>
            <span
              className={`px-1 flex items-center gap-1 ${
                counts.yellow >= 3 ? 'text-orb-yellow font-bold' : 'text-fg-muted'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-orb-yellow" />
              <span>{counts.yellow}</span>
            </span>
          </div>
        </div>

        {/* 中间：横向球槽队列 */}
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 px-1 flex-1 justify-center">
          {orbList.length === 0 ? (
            <span className="text-hud text-fg-muted">空 · 通过战术或出牌充能</span>
          ) : (
            orbList.map((orb) => {
              const isSelected = selectedOrbIds.includes(orb.instanceId);
              const isPartOfAvailableTriple =
                availableTriple?.orbIds.includes(orb.instanceId);

              return (
                <button
                  key={orb.instanceId}
                  type="button"
                  disabled={isOpponent}
                  onClick={() => handleOrbClick(orb.instanceId)}
                  className={`relative w-7 h-7 rounded-full border transition-all duration-fast flex items-center justify-center font-bold text-hud font-sans select-none shrink-0 cursor-pointer disabled:cursor-default ${getOrbStyle(
                    orb.color
                  )} ${
                    isSelected
                      ? 'ring-2 ring-fg scale-110 z-10'
                      : isPartOfAvailableTriple
                      ? 'ring-1 ring-gold-300/80 hover:scale-105'
                      : 'opacity-90 hover:opacity-100 hover:scale-105'
                  }`}
                  title={`${orb.name} (第${orb.index + 1}球${orb.index < ORB_HOTKEYS.length ? `，快捷键: ${ORB_HOTKEYS[orb.index]}` : ''})`}
                >
                  <span className="leading-none">{orb.label}</span>
                  {!isOpponent && orb.index < ORB_HOTKEYS.length && (
                    <span className="absolute -bottom-1 -left-1 px-0.5 bg-ink-950 border border-teal-400/60 text-hud text-teal-400 font-num font-bold leading-none pointer-events-none scale-75 origin-bottom-left">
                      {ORB_HOTKEYS[orb.index]}
                    </span>
                  )}
                  {isPartOfAvailableTriple && !isSelected && (
                    <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-gold-300 border border-ink-950" />
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
                className="pgr-sweep px-2.5 py-1 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 font-semibold text-hud font-sans flex items-center gap-1 active:scale-95 transition-all duration-fast cursor-pointer"
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
                className="pgr-sweep px-2.5 py-1 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 font-semibold text-hud font-sans flex items-center gap-1 active:scale-95 transition-all duration-fast cursor-pointer"
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
    <div className="flex flex-col gap-2 p-3 border border-line bg-ink-900/75 backdrop-blur-sm select-none w-full">
      {/* 标题 + 球色数量统计 */}
      <div className="flex justify-between items-center text-caption">
        <span className="flex items-center gap-1.5 text-fg font-semibold tracking-wider">
          <span className="text-teal-400 font-num">[</span>
          <span>{isOpponent ? '对方信号球区' : '信号球区'}</span>
          <span className="text-teal-400 font-num">]</span>
          <span className="text-hud text-fg-muted font-display uppercase tracking-widest">
            SIGNAL ORB
          </span>
        </span>

        <div className="flex items-center gap-2 text-hud font-num tabular-nums">
          <span
            className={`px-1.5 py-0.5 flex items-center gap-1 border ${
              counts.red >= 3
                ? 'bg-orb-red/20 border-orb-red text-fg font-bold'
                : 'bg-ink-950 border-line text-fg-muted'
            }`}
            title="红球数量 (达到3球可触发红球三消抽卡与对应红球被动)"
          >
            <span className="w-2 h-2 rounded-full bg-orb-red" />
            <span>红 {counts.red}</span>
            {counts.red >= 3 && <span className="text-gold-300 font-sans">可消</span>}
          </span>

          <span
            className={`px-1.5 py-0.5 flex items-center gap-1 border ${
              counts.blue >= 3
                ? 'bg-orb-blue/20 border-orb-blue text-fg font-bold'
                : 'bg-ink-950 border-line text-fg-muted'
            }`}
            title="蓝球数量"
          >
            <span className="w-2 h-2 rounded-full bg-orb-blue" />
            <span>蓝 {counts.blue}</span>
            {counts.blue >= 3 && <span className="text-gold-300 font-sans">可消</span>}
          </span>

          <span
            className={`px-1.5 py-0.5 flex items-center gap-1 border ${
              counts.yellow >= 3
                ? 'bg-orb-yellow/20 border-orb-yellow text-fg font-bold'
                : 'bg-ink-950 border-line text-fg-muted'
            }`}
            title="黄球数量"
          >
            <span className="w-2 h-2 rounded-full bg-orb-yellow" />
            <span>黄 {counts.yellow}</span>
            {counts.yellow >= 3 && <span className="text-gold-300 font-sans">可消</span>}
          </span>

          <span className="text-fg-muted">
            共 {orbs.length} 球
          </span>
        </div>
      </div>

      {/* 信号球物理队列与操作条 */}
      <div className="flex items-center gap-2 overflow-x-auto py-1 min-h-[50px] px-1">
        {orbList.length === 0 ? (
          <span className="text-caption text-fg-muted">
            暂无信号球（通过战斗充能或战术卡牌获得）
          </span>
        ) : (
          orbList.map((orb) => {
            const isSelected = selectedOrbIds.includes(orb.instanceId);
            const isPartOfAvailableTriple =
              availableTriple?.orbIds.includes(orb.instanceId);

            return (
              <button
                key={orb.instanceId}
                type="button"
                disabled={isOpponent}
                onClick={() => handleOrbClick(orb.instanceId)}
                className={`relative w-9 h-9 rounded-full border-2 transition-all duration-fast flex flex-col items-center justify-center font-bold text-caption font-sans select-none shrink-0 cursor-pointer disabled:cursor-default ${getOrbStyle(
                  orb.color
                )} ${
                  isSelected
                    ? 'ring-2 ring-fg scale-110 -translate-y-1 z-10'
                    : isPartOfAvailableTriple
                    ? 'hover:scale-105 ring-1 ring-gold-300/80'
                    : 'hover:scale-105 opacity-90 hover:opacity-100'
                }`}
                title={`第 ${orb.index + 1} 球: ${orb.name} (${orb.cardNumber})${orb.index < ORB_HOTKEYS.length ? `，快捷键: ${ORB_HOTKEYS[orb.index]}` : ''}`}
              >
                <span className="text-hud font-bold leading-none">
                  {orb.label}
                </span>
                <span className="text-hud font-num opacity-80 leading-none scale-75">
                  {orb.index + 1}
                </span>

                {!isOpponent && orb.index < ORB_HOTKEYS.length && (
                  <span className="absolute -bottom-1 -left-1 px-1 bg-ink-950 border border-teal-400/60 text-hud text-teal-400 font-num font-bold leading-none pointer-events-none scale-75 origin-bottom-left">
                    {ORB_HOTKEYS[orb.index]}
                  </span>
                )}

                {isPartOfAvailableTriple && !isSelected && (
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-gold-300 border border-ink-950" />
                )}
              </button>
            );
          })
        )}

        {/* 操作按钮区 */}
        {!isOpponent && onEliminate && (
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {canEliminateSelected && sortedSelectedIds && (
              <button
                type="button"
                onClick={() => onEliminate(sortedSelectedIds)}
                className="pgr-sweep px-3.5 py-1.5 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 font-semibold text-caption font-sans flex items-center gap-1.5 transition-all duration-fast active:scale-95 cursor-pointer"
                title="消除所选的 3 张信号球并抽 1 张牌 (快捷键: X)"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>三消抽牌 [X]</span>
              </button>
            )}

            {!canEliminateSelected && availableTriple && (
              <button
                type="button"
                onClick={() => onEliminate(availableTriple.orbIds)}
                className={`pgr-sweep px-3 py-1.5 clip-corner-sm font-semibold text-caption font-sans flex items-center gap-1.5 transition-all duration-fast active:scale-95 cursor-pointer border ${
                  availableTriple.type === 'RED'
                    ? 'bg-crimson-500 hover:bg-crimson-400 text-fg border-fg/30'
                    : availableTriple.type === 'BLUE'
                    ? 'bg-orb-blue hover:bg-orb-blue/90 text-fg border-fg/30'
                    : availableTriple.type === 'YELLOW'
                    ? 'bg-orb-yellow hover:bg-orb-yellow/90 text-ink-950 border-ink-950/20'
                    : 'bg-teal-400 hover:bg-teal-400/90 text-ink-950 border-ink-950/20'
                }`}
                title={`一键触发【${availableTriple.label}】并抽 1 张牌 (6.4.1.b.5)`}
              >
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>{availableTriple.label}（抽 1 张牌）</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

SignalOrbQueueView.displayName = 'SignalOrbQueueView';
