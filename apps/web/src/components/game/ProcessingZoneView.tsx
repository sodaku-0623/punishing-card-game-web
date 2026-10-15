'use client';

import React from 'react';
import { CardInstance, PublicGameState } from '@zhanshuang/shared';
import { findCardByNumberOrId, formatCardType } from '@/lib/cards-data';
import { Sparkles, Layers, ArrowRight, Zap, CheckCircle2 } from 'lucide-react';
import { getCardThumbnailUrl, handleThumbnailError } from '@/lib/card-image';

interface ProcessingZoneViewProps {
  gameState: PublicGameState;
  playerId: string;
  isMyZone: boolean;
  compact?: boolean;
  onCardClick?: (card: CardInstance) => void;
  onCardLongPress?: (card: CardInstance) => void;
  onCardHover?: (card: CardInstance | null) => void;
  onResolveClick?: () => void;
}

export function ProcessingZoneView({
  gameState,
  playerId,
  isMyZone,
  compact = false,
  onCardClick,
  onCardLongPress,
  onCardHover,
  onResolveClick,
}: ProcessingZoneViewProps) {
  // 查找当前玩家或公共处理区中的卡牌
  const processingCards = Object.values(gameState.publicCards || {}).filter(
    (c) => c.zone === 'PROCESSING' && (c.controllerPlayerId === playerId || isMyZone)
  );

  const activeCard = processingCards[processingCards.length - 1];
  const activeDef = activeCard ? findCardByNumberOrId(activeCard.cardNumber || activeCard.cardId) : null;
  const hasPendingChoice = !!gameState.currentPendingChoice && isMyZone;

  if (compact) {
    return (
      <div className="relative flex flex-col items-center justify-center p-2 rounded-xl border border-dashed border-terminalBorder/70 bg-surface/40 hover:bg-surface/60 transition-all w-24 sm:w-28 md:w-32 h-full max-h-[360px] flex-shrink-0 select-none shadow-sm group">
        {/* 科技角标 */}
        <div className="absolute top-1 left-1.5 text-neutral-500 font-mono text-[9px] select-none">┌</div>
        <div className="absolute top-1 right-1.5 text-neutral-500 font-mono text-[9px] select-none">┐</div>
        <div className="absolute bottom-1 left-1.5 text-neutral-500 font-mono text-[9px] select-none">└</div>
        <div className="absolute bottom-1 right-1.5 text-neutral-500 font-mono text-[9px] select-none">┘</div>

        {/* 标题 */}
        <div className="text-[10px] tracking-wider text-neutral-400 font-mono flex items-center gap-1 mb-1.5 select-none">
          <Zap className="w-3 h-3 text-terminalCyan" />
          <span>处理区</span>
        </div>

        {activeCard ? (
          <div
            onClick={() => onCardClick?.(activeCard)}
            onContextMenu={(e) => {
              e.preventDefault();
              onCardLongPress?.(activeCard);
            }}
            onMouseEnter={() => onCardHover?.(activeCard)}
            onMouseLeave={() => onCardHover?.(null)}
            className="flex flex-col items-center gap-1.5 p-1 rounded-lg border border-terminalCyan/70 bg-terminalCyan/10 shadow-[0_0_12px_rgba(0,240,255,0.25)] animate-pulse transition-all cursor-pointer hover:border-terminalCyan w-full"
            title="点击检视生效中的卡牌效果"
          >
            <div className="relative w-14 sm:w-16 aspect-[63/88] rounded overflow-hidden border border-terminalCyan/50 bg-neutral-900 shadow">
              {activeDef?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={getCardThumbnailUrl(activeDef.imageUrl, activeDef.cardNumber)}
                  onError={(e) => handleThumbnailError(e, activeDef.imageUrl)}
                  alt={activeDef.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[9px] text-neutral-400 font-mono">
                  {activeCard.cardNumber}
                </div>
              )}
              <div className="absolute bottom-0 inset-x-0 bg-black/80 text-[8px] text-center text-terminalCyan font-mono py-0.5">
                生效中
              </div>
            </div>

            <span className="text-[10px] font-bold text-white tracking-wide truncate max-w-[90px] text-center">
              {activeDef?.name || activeCard.cardNumber}
            </span>

            {hasPendingChoice && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onResolveClick?.();
                }}
                className="w-full py-0.5 rounded bg-terminalCyan text-neutral-950 text-[9px] font-bold font-mono flex items-center justify-center gap-0.5 hover:brightness-110 shadow animate-bounce"
              >
                <Zap className="w-2.5 h-2.5 fill-current" />
                <span>处理决策</span>
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-4 text-neutral-600 select-none">
            <Layers className="w-6 h-6 stroke-1 mb-1 text-neutral-700" />
            <span className="text-[9px] font-mono text-neutral-500">等待战术发动</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-center justify-center p-3 rounded-xl border border-dashed border-terminalBorder/80 bg-surface/40 hover:bg-surface/60 transition-all min-h-[140px] sm:min-h-[160px] w-full">
      {/* 科技角标 (对应场地图 「 处理区 」 视觉设计) */}
      <div className="absolute top-1 left-2 text-neutral-500 font-mono text-[11px] select-none">┌</div>
      <div className="absolute top-1 right-2 text-neutral-500 font-mono text-[11px] select-none">┐</div>
      <div className="absolute bottom-1 left-2 text-neutral-500 font-mono text-[11px] select-none">└</div>
      <div className="absolute bottom-1 right-2 text-neutral-500 font-mono text-[11px] select-none">┘</div>

      {/* 标题 */}
      <div className="text-[11px] tracking-widest text-neutral-400 font-mono flex items-center gap-1.5 mb-1 select-none">
        <span>「 处理区 」</span>
        <span className="text-[9px] text-neutral-600 font-sans">PROCESSING</span>
      </div>

      {activeCard ? (
        <div
          onClick={() => onCardClick?.(activeCard)}
          onContextMenu={(e) => {
            e.preventDefault();
            onCardLongPress?.(activeCard);
          }}
          className="relative flex items-center gap-3 p-2.5 rounded-lg border border-terminalCyan/60 bg-terminalCyan/10 shadow-[0_0_15px_rgba(0,240,255,0.2)] animate-pulse transition-all cursor-pointer hover:border-terminalCyan"
        >
          {/* 卡面缩略图 */}
          <div className="relative w-12 h-16 rounded overflow-hidden border border-terminalCyan/40 flex-shrink-0 bg-neutral-900">
            {activeDef?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={getCardThumbnailUrl(activeDef.imageUrl, activeDef.cardNumber)}
                  onError={(e) => handleThumbnailError(e, activeDef.imageUrl)}
                alt={activeDef.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[10px] text-neutral-500 font-mono">
                {activeCard.cardNumber}
              </div>
            )}
            <div className="absolute bottom-0 inset-x-0 bg-black/70 text-[8px] text-center text-terminalCyan font-mono">
              生效中
            </div>
          </div>

          {/* 卡牌效果与处理信息 */}
          <div className="flex flex-col text-left max-w-[200px]">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-bold text-white tracking-wide truncate">
                {activeDef?.name || activeCard.cardNumber}
              </span>
              <span className="text-[9px] px-1 py-px rounded bg-terminalCyan/20 text-terminalCyan font-mono">
                {formatCardType(activeDef?.cardType, activeDef?.isInstant)}
              </span>
            </div>
            <p className="text-[10px] text-neutral-300 font-mono line-clamp-2 mt-0.5 leading-tight">
              {activeDef?.rulesText || '效果正在处理中...'}
            </p>

            {hasPendingChoice && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onResolveClick?.();
                }}
                className="mt-1.5 px-2 py-0.5 rounded bg-terminalCyan text-neutral-950 text-[10px] font-bold font-mono flex items-center gap-1 hover:brightness-110 shadow-sm"
              >
                <Zap className="w-3 h-3" />
                <span>处理决策</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-2 text-neutral-600 select-none">
          <Layers className="w-6 h-6 stroke-1 mb-1 text-neutral-700" />
          <span className="text-[10px] font-mono text-neutral-500">战术卡 / 装备卡 / 能力生效区</span>
        </div>
      )}
    </div>
  );
}
