'use client';

import React from 'react';
import { Layers } from 'lucide-react';

interface DeckZoneViewProps {
  cardCount: number;
  label?: string;
  isMyDeck?: boolean;
}

export const DeckZoneView: React.FC<DeckZoneViewProps> = React.memo(({
  cardCount,
  label = '牌库',
  isMyDeck = true,
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-2 border border-line bg-ink-900/85 w-24 sm:w-28 shrink-0 select-none">
      <div className="text-hud text-fg-muted mb-1.5 flex items-center gap-1">
        <Layers className="w-3 h-3" />
        <span>{label}</span>
      </div>

      <div
        className={`relative w-16 sm:w-20 aspect-[63/88] rounded-card overflow-hidden border bg-ink-950 flex flex-col items-center justify-center p-1.5 ${
          isMyDeck ? 'border-teal-400/40' : 'border-crimson-500/40'
        }`}
      >
        <div className="w-full h-full border border-crimson-500/30 flex flex-col items-center justify-center p-1 bg-crimson-700/10">
          <div className="h-6 w-6 border border-crimson-500/60 flex items-center justify-center font-display text-hud text-crimson-400 font-bold mb-1">
            PR
          </div>
          <span className="font-display text-hud text-fg-muted text-center leading-none">
            DECK
          </span>
        </div>

        <div className="absolute bottom-1 inset-x-1 py-0.5 bg-ink-950/90 text-caption text-center font-num tabular-nums font-bold text-fg border border-line">
          {cardCount}
        </div>
      </div>
    </div>
  );
});

DeckZoneView.displayName = 'DeckZoneView';
