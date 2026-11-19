'use client';

import React from 'react';
import { CardInstance, PublicGameState } from '@zhanshuang/shared';
import { findCardByNumberOrId, formatCardType } from '@/lib/cards-data';
import { Layers, Zap } from 'lucide-react';
import { getCardThumbnailUrl, handleThumbnailError } from '@/lib/card-image';
import { HudBrackets } from '@/components/ui';

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
  const processingCards = Object.values(gameState.publicCards || {}).filter(
    (c) => c.zone === 'PROCESSING' && (c.controllerPlayerId === playerId || isMyZone)
  );

  const activeCard = processingCards[processingCards.length - 1];
  const activeDef = activeCard ? findCardByNumberOrId(activeCard.cardNumber || activeCard.cardId) : null;
  const hasPendingChoice = !!gameState.currentPendingChoice && isMyZone;

  if (compact) {
    return (
      <div
        className={`relative flex flex-col items-center justify-center p-2 border border-dashed bg-ink-900/75 hover:bg-ink-900/90 transition-colors duration-fast w-24 sm:w-28 md:w-32 h-full max-h-[360px] flex-shrink-0 select-none group ${
          activeCard ? 'border-teal-400/70' : 'border-line-strong'
        }`}
      >
        <HudBrackets size="sm" color={activeCard ? 'teal' : 'steel'} />

        <div className="text-hud tracking-wider text-fg-muted font-sans flex items-center gap-1 mb-1.5 select-none">
          <Zap className="w-3 h-3 text-teal-400" />
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
            className="flex flex-col items-center gap-1.5 p-1 border border-teal-400/70 bg-teal-400/10 transition-colors duration-fast cursor-pointer hover:border-teal-400 w-full"
            title="点击检视生效中的卡牌效果"
          >
            <div className="relative w-14 sm:w-16 aspect-[63/88] rounded-card overflow-hidden border border-teal-400/50 bg-ink-950">
              {activeDef?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={getCardThumbnailUrl(activeDef.imageUrl, activeDef.cardNumber)}
                  onError={(e) => handleThumbnailError(e, activeDef.imageUrl)}
                  alt={activeDef.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-hud text-fg-muted font-num">
                  {activeCard.cardNumber}
                </div>
              )}
              <div className="absolute bottom-0 inset-x-0 bg-ink-950/90 text-hud text-center text-teal-400 font-sans py-px">
                生效中
              </div>
            </div>

            <span className="text-hud font-semibold text-fg tracking-wide truncate max-w-[90px] text-center">
              {activeDef?.name || activeCard.cardNumber}
            </span>

            {hasPendingChoice && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onResolveClick?.();
                }}
                className="w-full py-0.5 clip-corner-sm bg-teal-400 hover:bg-teal-400/90 text-ink-950 text-hud font-semibold font-sans flex items-center justify-center gap-0.5 cursor-pointer transition-colors"
              >
                <Zap className="w-2.5 h-2.5 fill-current" />
                <span>处理决策</span>
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-4 text-fg-disabled select-none">
            <Layers className="w-5 h-5 stroke-[1.5] mb-1 text-fg-disabled" />
            <span className="text-hud font-sans text-fg-muted">等待发动</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`relative flex flex-col items-center justify-center p-3 border border-dashed bg-ink-900/75 hover:bg-ink-900/90 transition-colors duration-fast min-h-[140px] sm:min-h-[160px] w-full ${
        activeCard ? 'border-teal-400/70' : 'border-line-strong'
      }`}
    >
      <HudBrackets size="sm" color={activeCard ? 'teal' : 'steel'} />

      <div className="text-caption tracking-wider text-fg-secondary font-sans flex items-center gap-1.5 mb-2 select-none">
        <span>处理区</span>
        <span className="text-hud text-fg-muted font-display uppercase tracking-widest">
          PROCESSING
        </span>
      </div>

      {activeCard ? (
        <div
          onClick={() => onCardClick?.(activeCard)}
          onContextMenu={(e) => {
            e.preventDefault();
            onCardLongPress?.(activeCard);
          }}
          className="relative flex items-center gap-3 p-2.5 border border-teal-400/70 bg-teal-400/10 transition-colors duration-fast cursor-pointer hover:border-teal-400"
        >
          <div className="relative w-12 h-16 rounded-card overflow-hidden border border-teal-400/50 flex-shrink-0 bg-ink-950">
            {activeDef?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={getCardThumbnailUrl(activeDef.imageUrl, activeDef.cardNumber)}
                onError={(e) => handleThumbnailError(e, activeDef.imageUrl)}
                alt={activeDef.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-hud text-fg-muted font-num">
                {activeCard.cardNumber}
              </div>
            )}
            <div className="absolute bottom-0 inset-x-0 bg-ink-950/90 text-hud text-center text-teal-400 font-sans">
              生效中
            </div>
          </div>

          <div className="flex flex-col text-left max-w-[200px]">
            <div className="flex items-center gap-1.5">
              <span className="text-caption font-semibold text-fg tracking-wide truncate">
                {activeDef?.name || activeCard.cardNumber}
              </span>
              <span className="text-hud px-1 py-px bg-teal-400/15 border border-teal-400/40 text-teal-400 font-sans">
                {formatCardType(activeDef?.cardType, activeDef?.isInstant)}
              </span>
            </div>
            <p className="text-hud text-fg-secondary line-clamp-2 mt-1 leading-relaxed">
              {activeDef?.rulesText || '效果正在处理中...'}
            </p>

            {hasPendingChoice && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onResolveClick?.();
                }}
                className="mt-1.5 px-2.5 py-0.5 clip-corner-sm bg-teal-400 hover:bg-teal-400/90 text-ink-950 text-hud font-semibold font-sans flex items-center gap-1 cursor-pointer transition-colors"
              >
                <Zap className="w-3 h-3 fill-current" />
                <span>处理决策</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-2 text-fg-disabled select-none">
          <Layers className="w-6 h-6 stroke-[1.5] mb-1 text-fg-disabled" />
          <span className="text-hud text-fg-muted">战术卡 / 装备卡 / 能力生效区</span>
        </div>
      )}
    </div>
  );
}
