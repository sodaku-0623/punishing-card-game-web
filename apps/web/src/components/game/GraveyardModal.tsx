'use client';

import React from 'react';
import { CardInstance } from '@zhanshuang/shared';
import { findCardByNumberOrId, formatCardType } from '@/lib/cards-data';
import { X, Archive, Eye } from 'lucide-react';

interface GraveyardModalProps {
  isOpen: boolean;
  onClose: () => void;
  cards: CardInstance[];
  title?: string;
  onSelectCard?: (card: CardInstance) => void;
  onLongPress?: (card: CardInstance) => void;
}

export function GraveyardModal({
  isOpen,
  onClose,
  cards,
  title = '「 墓地 」卡牌清单',
  onSelectCard,
  onLongPress,
}: GraveyardModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-surface border border-terminalBorder rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* 头部标题栏 */}
        <div className="px-6 py-4 bg-neutral-900 border-b border-terminalBorder flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <Archive className="w-5 h-5 text-neutral-400" />
            <h2 className="text-base font-bold font-mono tracking-wider">
              {title} • GRAVEYARD ({cards.length} 张)
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 卡牌列表区 */}
        <div className="p-6 overflow-y-auto flex-1">
          {cards.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-500 font-mono text-xs">
              <Archive className="w-12 h-12 stroke-1 mb-2 text-neutral-700" />
              <span>当前墓地为空</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {cards.map((c, idx) => {
                const def = findCardByNumberOrId(c.cardNumber || c.cardId);
                return (
                  <div
                    key={`${c.instanceId}-${idx}`}
                    onClick={() => onSelectCard?.(c)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onLongPress?.(c);
                    }}
                    className="relative group rounded-xl border border-terminalBorder bg-neutral-950 p-2 flex flex-col items-center hover:border-terminalCyan transition-all cursor-pointer shadow hover:shadow-cyan-900/30"
                  >
                    {/* 卡图 */}
                    <div className="relative w-full aspect-[63/88] rounded-lg overflow-hidden bg-neutral-900 mb-2">
                      {def?.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={def.imageUrl}
                          alt={def.name}
                          className="w-full h-full object-cover transition-transform group-hover:scale-105"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs font-mono text-neutral-500">
                          {c.cardNumber}
                        </div>
                      )}
                      <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/80 text-[9px] font-mono text-terminalCyan">
                        {formatCardType(def?.cardType, def?.isInstant)}
                      </div>
                    </div>

                    <div className="text-center w-full">
                      <div className="text-xs font-bold text-white truncate">
                        {def?.name || c.cardNumber}
                      </div>
                      <div className="text-[10px] text-neutral-400 font-mono">
                        {c.cardNumber}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部 */}
        <div className="px-6 py-3 bg-neutral-900 border-t border-terminalBorder flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-neutral-800 text-neutral-200 hover:text-white text-xs font-mono transition-colors"
          >
            关闭检视
          </button>
        </div>
      </div>
    </div>
  );
}
