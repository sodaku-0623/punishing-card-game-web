'use client';

import React from 'react';
import { CardInstance } from '@zhanshuang/shared';
import { findCardByNumberOrId } from '@/lib/cards-data';
import { Archive, Skull } from 'lucide-react';
import { getCardThumbnailUrl, handleThumbnailError } from '@/lib/card-image';

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
  isOpponent = false,
  onClick,
  onCardHover,
}) => {
  const topCard = cards[cards.length - 1];
  const topDef = topCard ? findCardByNumberOrId(topCard.cardNumber || topCard.cardId) : null;
  const count = cards.length;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => {
        if (topCard && onCardHover) onCardHover(topCard);
      }}
      onMouseLeave={() => {
        if (onCardHover) onCardHover(null);
      }}
      className={`relative flex flex-col items-center justify-center p-1.5 rounded-xl border border-dashed transition-all cursor-pointer w-24 sm:w-28 flex-shrink-0 select-none shadow-sm group ${
        count > 0
          ? 'border-neutral-600 bg-neutral-950/70 hover:border-terminalCyan hover:shadow-[0_0_15px_rgba(0,240,255,0.25)]'
          : 'border-terminalBorder/50 bg-surface/30 hover:border-terminalBorder hover:bg-surface/50'
      }`}
      title={`点击检视${label} (${count}张)`}
    >
      {/* 科技角标 */}
      <div className="absolute top-1 left-1.5 text-neutral-600 font-mono text-[9px] select-none">┌</div>
      <div className="absolute top-1 right-1.5 text-neutral-600 font-mono text-[9px] select-none">┐</div>
      <div className="absolute bottom-1 left-1.5 text-neutral-600 font-mono text-[9px] select-none">└</div>
      <div className="absolute bottom-1 right-1.5 text-neutral-600 font-mono text-[9px] select-none">┘</div>

      <div className="text-[10px] font-mono text-neutral-400 mb-1 flex items-center gap-1 group-hover:text-terminalCyan transition-colors">
        <Archive className="w-3 h-3 text-neutral-400 group-hover:text-terminalCyan" />
        <span className="font-bold">{label}</span>
      </div>

      {/* 墓地卡堆外观 */}
      <div className="relative w-14 sm:w-16 aspect-[63/88] rounded-lg overflow-hidden border border-neutral-700 bg-neutral-950 shadow flex items-center justify-center">
        {topDef?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={getCardThumbnailUrl(topDef.imageUrl, topDef.cardNumber)}
            onError={(e) => handleThumbnailError(e, topDef.imageUrl)}
            alt={topDef.name}
            className="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all"
          />
        ) : (
          <div className="flex flex-col items-center justify-center text-neutral-600">
            <Skull className="w-5 h-5 stroke-1 mb-0.5 text-neutral-700 group-hover:text-neutral-500" />
            <span className="text-[8px] font-mono text-neutral-600">EMPTY</span>
          </div>
        )}

        {/* 墓地张数胶囊 */}
        <div className="absolute bottom-1 inset-x-1 py-px rounded bg-black/85 text-[9px] text-center font-bold font-mono text-terminalCyan border border-neutral-800">
          {count} 张
        </div>
      </div>
    </div>
  );
});

GraveyardZoneView.displayName = 'GraveyardZoneView';
