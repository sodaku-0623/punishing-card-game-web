'use client';

import React from 'react';
import { CardInstance } from '@zhanshuang/shared';
import { findCardByNumberOrId, formatCardType } from '@/lib/cards-data';
import { Archive, Play, Zap } from 'lucide-react';
import { getCardThumbnailUrl, handleThumbnailError } from '@/lib/card-image';
import { Button, Dialog } from '@/components/ui';
import type { ActivatedAbilityOption, NonHandPlayAction } from '@/lib/battle-actions';

interface GraveyardModalProps {
  isOpen: boolean;
  onClose: () => void;
  cards: CardInstance[];
  title?: string;
  isFriendly?: boolean;
  abilityOptionsByCardId?: Record<string, ActivatedAbilityOption[]>;
  nonHandActionsByCardId?: Record<string, NonHandPlayAction>;
  onActivateAbility?: (card: CardInstance, abilityIndex: number) => void;
  onNonHandPlay?: (card: CardInstance, action: NonHandPlayAction) => void;
  onSelectCard?: (card: CardInstance) => void;
  onLongPress?: (card: CardInstance) => void;
}

export function GraveyardModal({
  isOpen,
  onClose,
  cards,
  title = '墓地卡牌清单',
  isFriendly = false,
  abilityOptionsByCardId,
  nonHandActionsByCardId,
  onActivateAbility,
  onNonHandPlay,
  onSelectCard,
  onLongPress,
}: GraveyardModalProps) {
  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title={title}
      subtitle={`GRAVEYARD · ${cards.length} 张`}
      size="lg"
      blurBackdrop
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          关闭检视
        </Button>
      }
    >
      <div className="max-h-[60vh] overflow-y-auto pr-1 select-none">
        {cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-fg-muted text-caption">
            <Archive className="w-10 h-10 stroke-[1.5] mb-2 text-fg-disabled" />
            <span>当前墓地为空</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {cards.map((c, idx) => {
              const def = findCardByNumberOrId(c.cardNumber || c.cardId);
              const abilityOpts = isFriendly ? abilityOptionsByCardId?.[c.instanceId] ?? [] : [];
              const nonHandAction = isFriendly ? nonHandActionsByCardId?.[c.instanceId] : undefined;

              return (
                <div
                  key={`${c.instanceId}-${idx}`}
                  onClick={() => onSelectCard?.(c)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onLongPress?.(c);
                  }}
                  className="relative group border border-line bg-ink-950 p-2 flex flex-col items-center hover:border-teal-400/70 transition-colors duration-fast cursor-pointer"
                >
                  <div className="relative w-full aspect-[63/88] rounded-card overflow-hidden bg-ink-900 mb-2">
                    {def?.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={getCardThumbnailUrl(def.imageUrl, def.cardNumber)}
                        onError={(e) => handleThumbnailError(e, def.imageUrl)}
                        loading="lazy"
                        alt={def.name}
                        className="w-full h-full object-cover transition-transform duration-fast group-hover:scale-105"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-caption font-num text-fg-muted">
                        {c.cardNumber}
                      </div>
                    )}
                    <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-ink-950/90 border border-line text-hud font-sans text-teal-400">
                      {formatCardType(def?.cardType, def?.isInstant)}
                    </div>
                  </div>

                  <div className="text-center w-full">
                    <div className="text-caption font-semibold text-fg truncate">
                      {def?.name || c.cardNumber}
                    </div>
                    <div className="text-hud text-fg-muted font-num">
                      {c.cardNumber}
                    </div>
                  </div>

                  {isFriendly && (abilityOpts.length > 0 || nonHandAction) && (
                    <div className="w-full flex flex-col gap-1 mt-1.5">
                      {abilityOpts.map((opt) => (
                        <button
                          key={`gy-act-${c.instanceId}-${opt.abilityIndex}`}
                          type="button"
                          disabled={opt.disabled}
                          title={opt.disabled ? opt.reason : opt.label}
                          onClick={(e) => {
                            e.stopPropagation();
                            onActivateAbility?.(c, opt.abilityIndex);
                            onClose();
                          }}
                          className="w-full px-2 py-1 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 font-semibold text-hud flex items-center justify-center gap-1 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Zap className="w-3 h-3 fill-current shrink-0" />
                          <span>发动【起】</span>
                        </button>
                      ))}

                      {nonHandAction && onNonHandPlay && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onNonHandPlay(c, nonHandAction);
                          }}
                          className="w-full px-2 py-1 clip-corner-sm bg-teal-400 hover:bg-teal-400/90 text-ink-950 font-semibold text-hud flex items-center justify-center gap-1 cursor-pointer transition-colors"
                        >
                          <Play className="w-3 h-3 shrink-0" />
                          <span>{nonHandAction.label}</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Dialog>
  );
}
