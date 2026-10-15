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
    <div className="flex flex-col items-center justify-center p-2 rounded-xl border border-terminalBorder/60 bg-surface/50 w-24 sm:w-28 flex-shrink-0 select-none">
      <div className="text-[10px] font-mono text-neutral-400 mb-1.5 flex items-center gap-1">
        <Layers className="w-3.5 h-3.5 text-neutral-400" />
        <span>{label}</span>
      </div>

      {/* 3D 牌堆卡背表现 */}
      <div className="relative w-16 sm:w-20 aspect-[63/88] rounded-lg overflow-hidden border border-red-950/80 bg-gradient-to-br from-red-950 via-neutral-950 to-black shadow-lg flex flex-col items-center justify-center p-1.5 group cursor-pointer hover:border-red-600/60 transition-all">
        {/* 卡背边框装饰 */}
        <div className="w-full h-full rounded border border-red-800/40 flex flex-col items-center justify-center p-1 bg-red-950/20">
          <div className="w-6 h-6 rounded-full border border-red-500/40 flex items-center justify-center text-[10px] text-red-400 font-bold mb-1">
            战
          </div>
          <span className="text-[8px] font-mono text-red-300 font-bold tracking-tighter text-center leading-none">
            战双帕弥什
          </span>
          <span className="text-[7px] font-mono text-red-500/80 text-center scale-90">
            卡牌对战
          </span>
        </div>

        {/* 牌库数量徽标 */}
        <div className="absolute bottom-1 inset-x-1 py-0.5 rounded bg-black/85 text-[10px] text-center font-bold font-mono text-white border border-neutral-800">
          {cardCount} 张
        </div>
      </div>
    </div>
  );
});

DeckZoneView.displayName = 'DeckZoneView';
