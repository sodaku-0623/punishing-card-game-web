'use client';

import React from 'react';
import { CardInstance } from '@zhanshuang/shared';
import { findCardByNumberOrId } from '@/lib/cards-data';
import { Moon, Coins, Eye } from 'lucide-react';
import { getCardThumbnailUrl, handleThumbnailError } from '@/lib/card-image';

interface CostZoneViewProps {
  cards: CardInstance[];
  availableCount: number;
  totalCount: number;
  hiddenCount: number;
  isOpponent?: boolean;
  compact?: boolean;
  onOpenModal?: () => void;
  onCardClick?: (card: CardInstance) => void;
  onCardLongPress?: (card: CardInstance) => void;
}

export const CostZoneView: React.FC<CostZoneViewProps> = React.memo(({
  cards,
  availableCount,
  totalCount,
  hiddenCount,
  isOpponent = false,
  compact = false,
  onOpenModal,
  onCardClick,
  onCardLongPress,
}) => {
  // 紧凑单行模式 (节约对战桌面高度，点击可弹窗检视全部明/暗费)
  if (compact) {
    return (
      <button
        type="button"
        onClick={onOpenModal}
        className="flex items-center justify-between px-2.5 py-1 border border-line bg-ink-900/90 backdrop-blur-sm select-none w-full text-caption cursor-pointer hover:border-teal-400/60 hover:bg-ink-850 active:scale-[0.99] transition-all duration-fast group text-left"
        title="点击检视费用区卡牌明细 (明费公开透明 / 暗费保密)"
      >
        <div className="flex items-center gap-1.5">
          <Coins className="w-3.5 h-3.5 text-gold-300 flex-shrink-0" />
          <span className="text-hud font-sans font-semibold text-fg-secondary group-hover:text-teal-400 transition-colors">
            {isOpponent ? '对方费用' : '费用'}
          </span>
          <span className="px-1.5 py-px bg-ink-800 text-teal-400 text-hud border border-line flex items-center gap-0.5 opacity-80 group-hover:opacity-100 group-hover:border-teal-400/40 transition-all">
            <Eye className="w-2.5 h-2.5" />
            <span>检视</span>
          </span>
        </div>

        {/* 费用晶格阵列 */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-0.5">
            {Array.from({ length: totalCount }).map((_, i) => {
              const isAvailable = i < availableCount;
              const isDark = i >= totalCount - hiddenCount;
              return (
                <div
                  key={i}
                  className={`w-2 h-2 transition-colors duration-fast ${
                    isDark
                      ? 'bg-steel-500 border border-steel-300/60'
                      : isAvailable
                      ? 'bg-teal-400'
                      : 'bg-ink-800 border border-line'
                  }`}
                  title={isDark ? '暗费' : isAvailable ? '可用明费' : '已横置已用'}
                />
              );
            })}
          </div>

          <span className="text-teal-400 font-num tabular-nums font-bold text-caption ml-0.5">
            {availableCount}/{totalCount}
          </span>

          {hiddenCount > 0 && (
            <span className="text-steel-300 font-num tabular-nums font-semibold flex items-center gap-0.5 text-hud">
              <Moon className="w-2.5 h-2.5" />
              <span>{hiddenCount}</span>
            </span>
          )}
        </div>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3 border border-line bg-ink-900/70 backdrop-blur-sm select-none w-full">
      {/* 头部摘要统计 */}
      <div className="flex justify-between items-center text-caption">
        <span className="flex items-center gap-1.5 text-fg font-semibold tracking-wide">
          <Coins className="w-3.5 h-3.5 text-gold-300" />
          <span>{isOpponent ? '对方费用区' : '费用区 (3.6)'}</span>
          <span className="text-hud text-fg-muted font-display uppercase tracking-widest">
            COST ZONE
          </span>
        </span>
        <div className="flex items-center gap-2">
          {onOpenModal && (
            <button
              type="button"
              onClick={onOpenModal}
              className="px-2 py-0.5 bg-teal-400/10 hover:bg-teal-400/20 text-teal-400 border border-teal-400/40 text-hud flex items-center gap-1 cursor-pointer transition-colors duration-fast"
              title="检视费用区卡牌完整清单"
            >
              <Eye className="w-3 h-3" />
              <span>检视全部</span>
            </button>
          )}
          <span className="text-teal-400 font-bold font-num tabular-nums">
            可用: {availableCount} / {totalCount}
          </span>
          {hiddenCount > 0 && (
            <span className="text-steel-300 font-semibold font-num tabular-nums flex items-center gap-0.5 text-hud">
              <Moon className="w-3 h-3" /> 暗: {hiddenCount}
            </span>
          )}
        </div>
      </div>

      {/* 费用卡牌阵列 */}
      <div className="flex items-center gap-2 overflow-x-auto py-1 min-h-[64px] px-1">
        {cards.length === 0 ? (
          <span className="text-caption text-fg-muted">
            费用区为空 (抽牌填充阶段可充能明费)
          </span>
        ) : (
          cards.map((c) => {
            const isHidden = !c.isFaceUp;
            const def = isHidden ? null : findCardByNumberOrId(c.cardNumber || c.cardId);

            return (
              <div
                key={c.instanceId}
                onClick={() => onCardClick?.(c)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onCardLongPress?.(c);
                }}
                className={`relative w-10 sm:w-11 aspect-[63/88] rounded-card border flex-shrink-0 transition-all duration-fast cursor-pointer overflow-hidden group ${
                  !c.isReady ? 'rotate-90 origin-center opacity-70 my-1' : 'hover:-translate-y-1'
                } ${
                  isHidden
                    ? 'border-steel-500/70 bg-ink-850 text-steel-300'
                    : c.isReady
                    ? 'border-teal-400/80 bg-ink-900'
                    : 'border-line bg-ink-900'
                }`}
                title={
                  isHidden
                    ? '暗费 (背面竖直)'
                    : `${def?.name || c.cardNumber} (${c.isReady ? '可用竖直明费' : '已横置明费'})`
                }
              >
                {isHidden ? (
                  <div className="w-full h-full flex flex-col items-center justify-center p-0.5 bg-steel-700/25">
                    <Moon className="w-3.5 h-3.5 text-steel-300" />
                    <span className="text-hud font-sans text-steel-300 mt-0.5">
                      暗费
                    </span>
                  </div>
                ) : (
                  <>
                    {def?.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={getCardThumbnailUrl(def.imageUrl, def.cardNumber)}
                        onError={(e) => handleThumbnailError(e, def.imageUrl)}
                        alt={def.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center text-hud font-num text-teal-400 p-0.5">
                        <span>{def?.attribute || '明'}</span>
                        <span className="text-fg-muted">{c.cardNumber}</span>
                      </div>
                    )}
                    <div className="absolute bottom-0 inset-x-0 bg-ink-950/85 text-hud text-center font-sans text-teal-400 leading-tight py-px">
                      {c.isReady ? '可用' : '已用'}
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});

CostZoneView.displayName = 'CostZoneView';
