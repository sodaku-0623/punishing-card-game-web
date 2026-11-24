'use client';

import React, { useMemo } from 'react';
import { CardInstance } from '@zhanshuang/shared';
import { Layers, Zap, Lock } from 'lucide-react';
import { findCardByNumberOrId } from '@/lib/cards-data';
import {
  OrbColorType,
  OrbDisplayInfo,
  resolveOrbDisplayInfo,
  validateOrbElimination,
  findAvailableOrbTriple,
} from '@/lib/signal-orbs';
import type { ActivatedAbilityOption } from '@/lib/battle-actions';

export type { OrbColorType, OrbDisplayInfo };

interface SignalOrbQueueViewProps {
  orbs: CardInstance[];
  selectedOrbIds: string[];
  onToggleSelectOrb?: (orbId: string) => void;
  onEliminate?: (orbIds: string[]) => void;
  isOpponent?: boolean;
  compact?: boolean;
  abilityOptionsByCardId?: Record<string, ActivatedAbilityOption[]>;
  onActivateAbility?: (card: CardInstance, abilityIndex: number) => void;
  onInspectCard?: (card: CardInstance) => void;
  onContextMenu?: (card: CardInstance, e: React.MouseEvent) => void;
}

const ORB_HOTKEYS = ['Q', 'W', 'E', 'R', 'T', 'Y'] as const;

export const SignalOrbQueueView: React.FC<SignalOrbQueueViewProps> = React.memo(({
  orbs,
  selectedOrbIds,
  onToggleSelectOrb,
  onEliminate,
  isOpponent = false,
  compact = false,
  abilityOptionsByCardId,
  onActivateAbility,
  onInspectCard,
  onContextMenu,
}) => {
  // 解析信号球颜色、等效球数、禁止状态与正背面信息
  const orbList: OrbDisplayInfo[] = useMemo(() => {
    return orbs.map((orb, index) => resolveOrbDisplayInfo(orb, index));
  }, [orbs]);

  // 各颜色有效正面信号球统计（按等效球数累加，支持多色「视为」与单卡 3 球）
  const counts = useMemo(() => {
    let red = 0;
    let blue = 0;
    let yellow = 0;
    for (const item of orbList) {
      if (!item.isFaceUp || item.orbValue <= 0) continue;
      if (item.colors.includes('RED')) red += item.orbValue;
      if (item.colors.includes('BLUE')) blue += item.orbValue;
      if (item.colors.includes('YELLOW')) yellow += item.orbValue;
    }
    return { red, blue, yellow };
  }, [orbList]);

  // 检测物理相邻且可消除的一键三消组合 (4.16.2 + Q&A·1)
  const availableTriple = useMemo(() => findAvailableOrbTriple(orbs), [orbs]);

  // 严格校验当前已选信号球是否满足 4.16.2 物理相邻 + 等效 3 球 + 可消除
  const selectionCheck = useMemo(
    () => validateOrbElimination(orbs, selectedOrbIds),
    [orbs, selectedOrbIds]
  );

  // 己方正面信号球卡的【起】动能力列表（如 BP04-061）
  const orbAbilityEntries = useMemo(() => {
    if (isOpponent || !abilityOptionsByCardId) return [];
    const list: Array<{ card: CardInstance; option: ActivatedAbilityOption; name: string }> = [];
    for (const orb of orbs) {
      if (!orb.isFaceUp) continue;
      const opts = abilityOptionsByCardId[orb.instanceId];
      if (!opts?.length) continue;
      const def = findCardByNumberOrId(orb.cardNumber || orb.cardId);
      const name = def?.name || orb.cardNumber;
      for (const option of opts) {
        list.push({ card: orb, option, name });
      }
    }
    return list;
  }, [isOpponent, abilityOptionsByCardId, orbs]);

  const canEliminateSelected = Boolean(onEliminate && selectionCheck.valid);
  const sortedSelectedIds = selectionCheck.valid ? selectionCheck.sortedIds : null;

  function getOrbStyle(orb: OrbDisplayInfo) {
    if (!orb.isFaceUp) {
      return 'bg-ink-950 border-steel-500/70 text-steel-300 border-dashed';
    }
    if (orb.cannotEliminate) {
      return 'bg-ink-850 border-line-strong text-fg-muted opacity-65';
    }
    switch (orb.color) {
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

  function buildOrbTitle(orb: OrbDisplayInfo): string {
    if (!orb.isFaceUp) {
      return `第 ${orb.index + 1} 位: 背面信号球（不可消除）`;
    }
    const parts = [`第 ${orb.index + 1} 球: ${orb.name}`];
    if (orb.orbValue > 1) parts.push(`视为 ${orb.orbValue} 球`);
    if (orb.cannotEliminate) parts.push('当前不能被消除');
    else if (!orb.isEliminatable) parts.push('无信号球标记，不可消除');
    if (!isOpponent && orb.isEliminatable && orb.index < ORB_HOTKEYS.length) {
      parts.push(`快捷键: ${ORB_HOTKEYS[orb.index]}`);
    }
    return parts.join(' · ');
  }

  function handleOrbClick(orb: OrbDisplayInfo) {
    const rawOrb = orbs[orb.index];
    if (isOpponent || !orb.isEliminatable) {
      if (orb.isFaceUp && rawOrb) {
        onInspectCard?.(rawOrb);
      }
      return;
    }
    onToggleSelectOrb?.(orb.instanceId);
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
              const rawOrb = orbs[orb.index];
              const isSelected = selectedOrbIds.includes(orb.instanceId);
              const isPartOfAvailableTriple =
                availableTriple?.orbIds.includes(orb.instanceId);
              const buttonDisabled =
                (!onInspectCard || !orb.isFaceUp) && (isOpponent || !orb.isEliminatable);

              return (
                <div
                  key={orb.instanceId}
                  onContextMenu={(e) => {
                    if (orb.isFaceUp && rawOrb && onContextMenu) {
                      e.preventDefault();
                      onContextMenu(rawOrb, e);
                    }
                  }}
                  className="inline-flex shrink-0"
                >
                  <button
                    type="button"
                    disabled={buttonDisabled}
                    onClick={() => handleOrbClick(orb)}
                    className={`relative w-7 h-7 rounded-full border transition-all duration-fast flex items-center justify-center font-bold text-hud font-sans select-none shrink-0 cursor-pointer disabled:cursor-not-allowed ${getOrbStyle(
                      orb
                    )} ${
                      isSelected
                        ? 'ring-2 ring-fg scale-110 z-10'
                        : isPartOfAvailableTriple
                        ? 'ring-1 ring-gold-300/80 hover:scale-105'
                        : orb.isEliminatable
                        ? 'opacity-90 hover:opacity-100 hover:scale-105'
                        : ''
                    }`}
                    title={buildOrbTitle(orb)}
                  >
                    <span className="leading-none">{orb.label}</span>
                    {!isOpponent && orb.isEliminatable && orb.index < ORB_HOTKEYS.length && (
                      <span className="absolute -bottom-1 -left-1 px-0.5 bg-ink-950 border border-teal-400/60 text-hud text-teal-400 font-num font-bold leading-none pointer-events-none scale-75 origin-bottom-left">
                        {ORB_HOTKEYS[orb.index]}
                      </span>
                    )}
                    {orb.orbValue > 1 && orb.isFaceUp && (
                      <span className="absolute -top-1 -right-1 px-1 bg-ink-950 border border-gold-300 text-gold-300 font-num text-hud font-bold leading-none pointer-events-none scale-75 origin-top-right">
                        x{orb.orbValue}
                      </span>
                    )}
                    {orb.isFaceUp && orb.cannotEliminate && (
                      <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-ink-950 border border-crimson-500/80 flex items-center justify-center pointer-events-none">
                        <Lock className="w-2 h-2 text-crimson-400" />
                      </span>
                    )}
                    {isPartOfAvailableTriple && !isSelected && orb.orbValue <= 1 && (
                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-gold-300 border border-ink-950" />
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* 右侧：紧凑三消按钮 & 信号球【起】触发按钮 */}
        {!isOpponent && (onEliminate || (onActivateAbility && orbAbilityEntries.length > 0)) && (
          <div className="flex items-center gap-1.5 shrink-0">
            {onActivateAbility &&
              orbAbilityEntries.map(({ card, option, name }) => (
                <button
                  key={`orb-act-compact-${card.instanceId}-${option.abilityIndex}`}
                  type="button"
                  disabled={option.disabled}
                  onClick={() => onActivateAbility(card, option.abilityIndex)}
                  title={option.disabled ? option.reason : `${name}：${option.label}`}
                  className="px-2 py-1 clip-corner-sm bg-teal-400 hover:bg-teal-400/90 text-ink-950 font-semibold text-hud font-sans flex items-center gap-1 active:scale-95 transition-all duration-fast cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Zap className="w-3 h-3 fill-current" />
                  <span>信号球【起】</span>
                </button>
              ))}
            {onEliminate && canEliminateSelected && sortedSelectedIds && (
              <button
                type="button"
                onClick={() => onEliminate(sortedSelectedIds)}
                className="pgr-sweep px-2.5 py-1 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 font-semibold text-hud font-sans flex items-center gap-1 active:scale-95 transition-all duration-fast cursor-pointer"
                title="消除所选的相邻信号球 (等效3球) 并抽 1 张牌 (快捷键: X)"
              >
                <Layers className="w-3 h-3" />
                <span>三消抽牌 [X]</span>
              </button>
            )}
            {onEliminate && !canEliminateSelected && availableTriple && (
              <button
                type="button"
                onClick={() => onEliminate(availableTriple.orbIds)}
                className="pgr-sweep px-2.5 py-1 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 font-semibold text-hud font-sans flex items-center gap-1 active:scale-95 transition-all duration-fast cursor-pointer"
                title={`一键发动【${availableTriple.label}】并抽 1 张牌`}
              >
                <Zap className="w-3 h-3 fill-current" />
                <span>{availableTriple.orbIds.length === 1 ? '单卡三消' : '一键三消'}</span>
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
            title="正面红球等效数量"
          >
            <span className="w-2 h-2 rounded-full bg-orb-red" />
            <span>红 {counts.red}</span>
          </span>

          <span
            className={`px-1.5 py-0.5 flex items-center gap-1 border ${
              counts.blue >= 3
                ? 'bg-orb-blue/20 border-orb-blue text-fg font-bold'
                : 'bg-ink-950 border-line text-fg-muted'
            }`}
            title="正面蓝球等效数量"
          >
            <span className="w-2 h-2 rounded-full bg-orb-blue" />
            <span>蓝 {counts.blue}</span>
          </span>

          <span
            className={`px-1.5 py-0.5 flex items-center gap-1 border ${
              counts.yellow >= 3
                ? 'bg-orb-yellow/20 border-orb-yellow text-fg font-bold'
                : 'bg-ink-950 border-line text-fg-muted'
            }`}
            title="正面黄球等效数量"
          >
            <span className="w-2 h-2 rounded-full bg-orb-yellow" />
            <span>黄 {counts.yellow}</span>
          </span>

          <span className="text-fg-muted">
            共 {orbs.length} 张
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
            const rawOrb = orbs[orb.index];
            const isSelected = selectedOrbIds.includes(orb.instanceId);
            const isPartOfAvailableTriple =
              availableTriple?.orbIds.includes(orb.instanceId);
            const buttonDisabled =
              (!onInspectCard || !orb.isFaceUp) && (isOpponent || !orb.isEliminatable);

            return (
              <div
                key={orb.instanceId}
                onContextMenu={(e) => {
                  if (orb.isFaceUp && rawOrb && onContextMenu) {
                    e.preventDefault();
                    onContextMenu(rawOrb, e);
                  }
                }}
                className="inline-flex shrink-0"
              >
                <button
                  type="button"
                  disabled={buttonDisabled}
                  onClick={() => handleOrbClick(orb)}
                  className={`relative w-9 h-9 rounded-full border-2 transition-all duration-fast flex flex-col items-center justify-center font-bold text-caption font-sans select-none shrink-0 cursor-pointer disabled:cursor-not-allowed ${getOrbStyle(
                    orb
                  )} ${
                    isSelected
                      ? 'ring-2 ring-fg scale-110 -translate-y-1 z-10'
                      : isPartOfAvailableTriple
                      ? 'hover:scale-105 ring-1 ring-gold-300/80'
                      : orb.isEliminatable
                      ? 'hover:scale-105 opacity-90 hover:opacity-100'
                      : ''
                  }`}
                  title={buildOrbTitle(orb)}
                >
                  <span className="text-hud font-bold leading-none">
                    {orb.label}
                  </span>
                  <span className="text-hud font-num opacity-80 leading-none scale-75">
                    {orb.orbValue > 1 && orb.isFaceUp ? `x${orb.orbValue}` : orb.index + 1}
                  </span>

                  {!isOpponent && orb.isEliminatable && orb.index < ORB_HOTKEYS.length && (
                    <span className="absolute -bottom-1 -left-1 px-1 bg-ink-950 border border-teal-400/60 text-hud text-teal-400 font-num font-bold leading-none pointer-events-none scale-75 origin-bottom-left">
                      {ORB_HOTKEYS[orb.index]}
                    </span>
                  )}

                  {orb.isFaceUp && orb.cannotEliminate && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-ink-950 border border-crimson-500/80 flex items-center justify-center pointer-events-none">
                      <Lock className="w-2.5 h-2.5 text-crimson-400" />
                    </span>
                  )}

                  {isPartOfAvailableTriple && !isSelected && !orb.cannotEliminate && (
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-gold-300 border border-ink-950" />
                  )}
                </button>
              </div>
            );
          })
        )}

        {/* 操作按钮区 */}
        {!isOpponent && (onEliminate || (onActivateAbility && orbAbilityEntries.length > 0)) && (
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {onActivateAbility &&
              orbAbilityEntries.map(({ card, option, name }) => (
                <button
                  key={`orb-act-${card.instanceId}-${option.abilityIndex}`}
                  type="button"
                  disabled={option.disabled}
                  onClick={() => onActivateAbility(card, option.abilityIndex)}
                  title={option.disabled ? option.reason : `${name}：${option.label}`}
                  className="px-3 py-1.5 clip-corner-sm bg-teal-400 hover:bg-teal-400/90 text-ink-950 font-semibold text-caption font-sans flex items-center gap-1.5 transition-all duration-fast active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Zap className="w-3.5 h-3.5 fill-current" />
                  <span>信号球【起】· {name}</span>
                </button>
              ))}

            {onEliminate && canEliminateSelected && sortedSelectedIds && (
              <button
                type="button"
                onClick={() => onEliminate(sortedSelectedIds)}
                className="pgr-sweep px-3.5 py-1.5 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 font-semibold text-caption font-sans flex items-center gap-1.5 transition-all duration-fast active:scale-95 cursor-pointer"
                title="消除所选相邻信号球 (等效3球) 并抽 1 张牌 (快捷键: X)"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>三消抽牌 [X]</span>
              </button>
            )}

            {onEliminate && !canEliminateSelected && availableTriple && (
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
                title={`一键触发【${availableTriple.label}】并抽 1 张牌 (4.16.2 / 6.4.1.b.5)`}
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
