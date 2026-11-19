'use client';

import React from 'react';
import { CardInstance } from '@zhanshuang/shared';
import { findCardByNumberOrId } from '@/lib/cards-data';
import { Archive, Skull } from 'lucide-react';
import { getCardThumbnailUrl, handleThumbnailError } from '@/lib/card-image';
import { HudBrackets } from '@/components/ui';

interface GraveyardZoneViewProps {
  cards: CardInstance[];
  label?: string;
  isOpponent?: boolean;
  onClick?: () => void;
  onCardHover?: (card: CardInstance | null) => void;
}

export const GraveyardZoneView: React.FC<GraveyardZoneViewProps> = React.memo(({
  cards,
  label = '墓地',
  onClick,
  onCardHover,
}) => {
  const topCard = cards[cards.length - 1];
  const topDef = topCard ? findCardByNumberOrId(topCard.cardNumber || topCard.cardId) : null;
  const count = cards.length;

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => {
        if (topCard && onCardHover) onCardHover(topCard);
      }}
      onMouseLeave={() => {
        if (onCardHover) onCardHover(null);
      }}
      aria-label={`检视${label} (${count}张)`}
      title={`点击检视${label} (${count}张)`}
      className="group relative flex flex-col items-center justify-center p-1.5 border border-dashed border-line-strong bg-ink-900/80 hover:border-teal-400 transition-colors duration-fast cursor-pointer w-24 sm:w-28 shrink-0 select-none"
    >
      <HudBrackets color="steel" size="sm" interactive />

      <div className="text-hud text-fg-muted mb-1 flex items-center gap-1 group-hover:text-fg transition-colors">
        <Archive className="w-3 h-3" />
        <span>{label}</span>
      </div>

      <div className="relative w-14 sm:w-16 aspect-[63/88] rounded-card overflow-hidden border border-line bg-ink-950 flex items-center justify-center">
        {topDef?.imageUrl ? (
          <img
            src={getCardThumbnailUrl(topDef.imageUrl, topDef.cardNumber)}
            onError={(e) => handleThumbnailError(e, topDef.imageUrl)}
            alt={topDef.name}
            className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-fg-disabled">
            <Skull className="w-4 h-4 stroke-1 mb-0.5" />
            <span className="font-display text-hud">EMPTY</span>
          </div>
        )}

        <div className="absolute bottom-1 inset-x-1 py-px bg-ink-950/90 text-hud text-center font-num tabular-nums font-bold text-fg border border-line">
          {count}
        </div>
      </div>
    </button>
  );
});

GraveyardZoneView.displayName = 'GraveyardZoneView';
