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
  // 严格按 controllerPlayerId 隔离，避免混显对手处理区卡牌
  const processingCards = Object.values(gameState.publicCards || {}).filter(
    (c) => c.zone === 'PROCESSING' && c.controllerPlayerId === playerId
  );

  const airborneCards = processingCards.filter((c) => c.isAirborne === true);
  const resolvingCards = processingCards.filter((c) => !c.isAirborne);
  const activeCard = resolvingCards[resolvingCards.length - 1];
  const hasAnyCard = airborneCards.length > 0 || Boolean(activeCard);
  const hasPendingChoice = !!gameState.currentPendingChoice && isMyZone;

  const renderCardTile = (card: CardInstance, isAirborneCard: boolean, isCompactMode: boolean) => {
    const def = findCardByNumberOrId(card.cardNumber || card.cardId);

    if (isCompactMode) {
      return (
        <div
          key={card.instanceId}
          onClick={() => onCardClick?.(card)}
          onContextMenu={(e) => {
            e.preventDefault();
            onCardLongPress?.(card);
          }}
          onMouseEnter={() => onCardHover?.(card)}
          onMouseLeave={() => onCardHover?.(null)}
          className={`flex flex-col items-center gap-1 p-1 border transition-colors duration-fast cursor-pointer shrink-0 ${
            isAirborneCard
              ? 'border-gold-300/70 bg-gold-300/10 hover:border-gold-300 w-16'
              : 'border-teal-400/70 bg-teal-400/10 hover:border-teal-400 w-full'
          }`}
          title={isAirborneCard ? '浮空模式中（下回合开始时回到战场）' : '点击检视生效中的卡牌效果'}
        >
          <div
            className={`relative w-12 sm:w-14 aspect-[63/88] rounded-card overflow-hidden border bg-ink-950 ${
              isAirborneCard ? 'border-gold-300/60' : 'border-teal-400/50'
            }`}
          >
            {def?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={getCardThumbnailUrl(def.imageUrl, def.cardNumber)}
                onError={(e) => handleThumbnailError(e, def.imageUrl)}
                alt={def.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-hud text-fg-muted font-num">
                {card.cardNumber}
              </div>
            )}
            <div
              className={`absolute bottom-0 inset-x-0 bg-ink-950/90 text-hud text-center font-sans py-px ${
                isAirborneCard ? 'text-gold-300 font-semibold' : 'text-teal-400'
              }`}
            >
              {isAirborneCard ? '浮空' : '生效中'}
            </div>
          </div>

          <span className="text-hud font-semibold text-fg tracking-wide truncate max-w-full text-center">
            {def?.name || card.cardNumber}
          </span>

          {!isAirborneCard && hasPendingChoice && (
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
      );
    }

    return (
      <div
        key={card.instanceId}
        onClick={() => onCardClick?.(card)}
        onContextMenu={(e) => {
          e.preventDefault();
          onCardLongPress?.(card);
        }}
        onMouseEnter={() => onCardHover?.(card)}
        onMouseLeave={() => onCardHover?.(null)}
        className={`relative flex items-center gap-3 p-2.5 border transition-colors duration-fast cursor-pointer shrink-0 ${
          isAirborneCard
            ? 'border-gold-300/70 bg-gold-300/10 hover:border-gold-300'
            : 'border-teal-400/70 bg-teal-400/10 hover:border-teal-400'
        }`}
      >
        <div
          className={`relative w-12 h-16 rounded-card overflow-hidden border flex-shrink-0 bg-ink-950 ${
            isAirborneCard ? 'border-gold-300/60' : 'border-teal-400/50'
          }`}
        >
          {def?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={getCardThumbnailUrl(def.imageUrl, def.cardNumber)}
              onError={(e) => handleThumbnailError(e, def.imageUrl)}
              alt={def.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-hud text-fg-muted font-num">
              {card.cardNumber}
            </div>
          )}
          <div
            className={`absolute bottom-0 inset-x-0 bg-ink-950/90 text-hud text-center font-sans ${
              isAirborneCard ? 'text-gold-300 font-semibold' : 'text-teal-400'
            }`}
          >
            {isAirborneCard ? '浮空' : '生效中'}
          </div>
        </div>

        <div className="flex flex-col text-left max-w-[200px]">
          <div className="flex items-center gap-1.5">
            <span className="text-caption font-semibold text-fg tracking-wide truncate">
              {def?.name || card.cardNumber}
            </span>
            <span
              className={`text-hud px-1 py-px border font-sans shrink-0 ${
                isAirborneCard
                  ? 'bg-gold-300/15 border-gold-300/50 text-gold-300'
                  : 'bg-teal-400/15 border-teal-400/40 text-teal-400'
              }`}
            >
              {isAirborneCard ? '浮空' : formatCardType(def?.cardType, def?.isInstant)}
            </span>
          </div>
          <p className="text-hud text-fg-secondary line-clamp-2 mt-1 leading-relaxed">
            {def?.rulesText || '效果正在处理中...'}
          </p>

          {!isAirborneCard && hasPendingChoice && (
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
    );
  };

  if (compact) {
    return (
      <div
        className={`relative flex flex-col items-center justify-center p-2 border border-dashed bg-ink-900/75 hover:bg-ink-900/90 transition-colors duration-fast w-24 sm:w-28 md:w-32 h-full max-h-[360px] flex-shrink-0 select-none group ${
          hasAnyCard ? 'border-teal-400/70' : 'border-line-strong'
        }`}
      >
        <HudBrackets size="sm" color={hasAnyCard ? 'teal' : 'steel'} />

        <div className="text-hud tracking-wider text-fg-muted font-sans flex items-center gap-1 mb-1.5 select-none">
          <Zap className="w-3 h-3 text-teal-400" />
          <span>处理区</span>
          {airborneCards.length > 0 && (
            <span className="font-num text-gold-300">({airborneCards.length})</span>
          )}
        </div>

        {hasAnyCard ? (
          <div className="flex items-stretch gap-1.5 overflow-x-auto w-full pb-0.5">
            {activeCard && renderCardTile(activeCard, false, true)}
            {airborneCards.map((c) => renderCardTile(c, true, true))}
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
        hasAnyCard ? 'border-teal-400/70' : 'border-line-strong'
      }`}
    >
      <HudBrackets size="sm" color={hasAnyCard ? 'teal' : 'steel'} />

      <div className="text-caption tracking-wider text-fg-secondary font-sans flex items-center gap-1.5 mb-2 select-none">
        <span>处理区</span>
        <span className="text-hud text-fg-muted font-display uppercase tracking-widest">
          PROCESSING
        </span>
      </div>

      {hasAnyCard ? (
        <div className="flex items-stretch gap-2 overflow-x-auto w-full justify-start py-0.5">
          {activeCard && renderCardTile(activeCard, false, false)}
          {airborneCards.map((c) => renderCardTile(c, true, false))}
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
