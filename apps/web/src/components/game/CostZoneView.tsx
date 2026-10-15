'use client';

import React from 'react';
import { CardInstance } from '@zhanshuang/shared';
import { findCardByNumberOrId } from '@/lib/cards-data';
import { Zap, Moon, Coins, Eye } from 'lucide-react';
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
  // 紧凑单行胶囊模式 (极大地节约对战桌面垂直高度与宽度，支持点击弹窗检视双方所有卡牌)
  if (compact) {
    return (
      <div
        onClick={onOpenModal}
        className="flex items-center justify-between px-2.5 py-1 rounded-xl border border-terminalBorder/70 bg-surface/85 backdrop-blur-md select-none w-full font-mono text-xs cursor-pointer hover:border-terminalCyan/70 hover:bg-neutral-900/90 active:scale-[0.98] transition-all group shadow-sm"
        title="点击检视费用区卡牌明细 (明费公开透明 / 暗费保密)"
      >
        <div className="flex items-center gap-1.5">
          <Coins className="w-3.5 h-3.5 text-terminalGold flex-shrink-0" />
          <span className="text-[11px] font-bold text-neutral-300 group-hover:text-terminalCyan transition-colors">
            {isOpponent ? '对方费用' : '费用'}
          </span>
          <span className="px-1.5 py-px rounded bg-terminalCyan/10 text-terminalCyan text-[9px] border border-terminalCyan/30 flex items-center gap-0.5 opacity-80 group-hover:opacity-100 transition-opacity">
            <Eye className="w-2.5 h-2.5" />
            <span>检视</span>
          </span>
        </div>

        {/* 费用晶格指示灯阵列 */}
        <div className="flex items-center gap-1">
          <div className="flex items-center gap-0.5">
            {Array.from({ length: totalCount }).map((_, i) => {
              const isAvailable = i < availableCount;
              const isDark = i >= totalCount - hiddenCount;
              return (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-all ${
                    isDark
                      ? 'bg-purple-500 shadow-[0_0_4px_rgba(168,85,247,0.7)]'
                      : isAvailable
                      ? 'bg-terminalCyan shadow-[0_0_5px_rgba(0,240,255,0.7)]'
                      : 'bg-neutral-800 border border-neutral-700'
                  }`}
                  title={isDark ? '暗费' : isAvailable ? '可用明费' : '已横置已用'}
                />
              );
            })}
          </div>

          <span className="text-terminalCyan font-black text-xs ml-1">
            {availableCount}/{totalCount}
          </span>

          {hiddenCount > 0 && (
            <span className="text-purple-400 font-bold flex items-center gap-0.5 text-[10px] ml-0.5">
              <Moon className="w-2.5 h-2.5" /> {hiddenCount}
            </span>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 p-3 rounded-2xl border border-terminalBorder/60 bg-surface/40 backdrop-blur-sm select-none w-full">
      {/* 头部摘要统计 */}
      <div className="flex justify-between items-center text-xs font-mono">
        <span className="flex items-center gap-1.5 text-neutral-200 font-bold tracking-wide">
          <Coins className="w-3.5 h-3.5 text-terminalGold" />
          <span>{isOpponent ? '对方费用区' : '费用区 (3.6)'}</span>
          <span className="text-[10px] text-neutral-500 font-normal font-sans">COST ZONE</span>
        </span>
        <div className="flex items-center gap-2">
          {onOpenModal && (
            <button
              type="button"
              onClick={onOpenModal}
              className="px-2 py-0.5 rounded bg-terminalCyan/15 hover:bg-terminalCyan/25 text-terminalCyan border border-terminalCyan/40 text-[10px] flex items-center gap-1 cursor-pointer transition-colors"
              title="检视费用区卡牌完整清单"
            >
              <Eye className="w-3 h-3" />
              <span>检视全部</span>
            </button>
          )}
          <span className="text-terminalCyan font-bold font-mono">
            可用: {availableCount} / {totalCount}
          </span>
          {hiddenCount > 0 && (
            <span className="text-purple-400 font-bold font-mono flex items-center gap-0.5 text-[11px]">
              <Moon className="w-3 h-3" /> 暗: {hiddenCount}
            </span>
          )}
        </div>
      </div>

      {/* 费用卡牌阵列 (对应场地图下方的迷你卡牌展示) */}
      <div className="flex items-center gap-2 overflow-x-auto py-1 min-h-[64px] px-1">
        {cards.length === 0 ? (
          <span className="text-[11px] text-neutral-500 font-mono italic">
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
                className={`relative w-10 sm:w-11 aspect-[63/88] rounded-md border flex-shrink-0 transition-all duration-200 cursor-pointer overflow-hidden shadow group ${
                  !c.isReady ? 'rotate-90 origin-center opacity-70 my-1' : 'hover:-translate-y-1'
                } ${
                  isHidden
                    ? 'border-purple-600/70 bg-gradient-to-br from-purple-950 to-black text-purple-300'
                    : c.isReady
                    ? 'border-terminalCyan/80 bg-neutral-900 ring-1 ring-terminalCyan/30'
                    : 'border-neutral-600 bg-neutral-900'
                }`}
                title={
                  isHidden
                    ? '暗费 (背面竖直)'
                    : `${def?.name || c.cardNumber} (${c.isReady ? '可用竖直明费' : '已横置明费'})`
                }
              >
                {isHidden ? (
                  /* 暗费卡背 */
                  <div className="w-full h-full flex flex-col items-center justify-center p-0.5 bg-purple-950/40">
                    <Moon className="w-3.5 h-3.5 text-purple-400 opacity-80" />
                    <span className="text-[7px] font-mono text-purple-400 mt-0.5 scale-90">
                      暗费
                    </span>
                  </div>
                ) : (
                  /* 明费卡图 */
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
                      <div className="w-full h-full flex flex-col items-center justify-center text-[7px] font-mono text-terminalCyan p-0.5">
                        <span>{def?.attribute || '明'}</span>
                        <span className="text-[6px] text-neutral-400">{c.cardNumber}</span>
                      </div>
                    )}
                    <div className="absolute bottom-0 inset-x-0 bg-black/80 text-[7px] text-center font-mono text-terminalCyan leading-tight py-px">
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
