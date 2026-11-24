'use client';

import React, { useMemo } from 'react';
import { CardInstance, PublicGameState } from '@zhanshuang/shared';
import { Layers, Play, Zap } from 'lucide-react';
import { Button, Dialog } from '@/components/ui';
import { findCardByNumberOrId, formatCardType } from '@/lib/cards-data';
import { getCardThumbnailUrl, handleThumbnailError } from '@/lib/card-image';
import {
  getCardActivatedAbilityOptions,
  getNonHandPlayAction,
  getUsableNonTacticsInstants,
  type NonHandPlayAction,
} from '@/lib/battle-actions';

interface UnderneathCardsModalProps {
  isOpen: boolean;
  onClose: () => void;
  hostCard: CardInstance | null;
  gameState: PublicGameState;
  myUserId: string;
  isFriendly: boolean;
  usableInstantCardIds?: Set<string>;
  onActivateAbility?: (card: CardInstance, abilityIndex: number) => void;
  onUseInstant?: (cardInstanceId: string) => void;
  onNonHandPlay?: (card: CardInstance, action: NonHandPlayAction) => void;
  onInspectCard?: (card: CardInstance) => void;
}

export const UnderneathCardsModal: React.FC<UnderneathCardsModalProps> = ({
  isOpen,
  onClose,
  hostCard,
  gameState,
  myUserId,
  isFriendly,
  usableInstantCardIds,
  onActivateAbility,
  onUseInstant,
  onNonHandPlay,
  onInspectCard,
}) => {
  const underneathCards = useMemo(() => {
    if (!hostCard?.underneathCardIds?.length) return [];
    const publicCards = gameState.publicCards || {};
    return hostCard.underneathCardIds
      .map((id) => publicCards[id])
      .filter((c): c is CardInstance => Boolean(c));
  }, [hostCard, gameState.publicCards]);

  const resolvedInstantIds = useMemo(() => {
    if (!isFriendly) return new Set<string>();
    if (usableInstantCardIds) return usableInstantCardIds;
    return new Set(
      getUsableNonTacticsInstants(gameState, myUserId).map((item) => item.card.instanceId)
    );
  }, [isFriendly, usableInstantCardIds, gameState, myUserId]);

  const hostDef = hostCard ? findCardByNumberOrId(hostCard.cardNumber || hostCard.cardId) : null;

  return (
    <Dialog
      open={isOpen && Boolean(hostCard)}
      onClose={onClose}
      title={`${hostDef?.name || hostCard?.cardNumber || '角色'} · 下方卡牌`}
      subtitle={`UNDERNEATH · ${underneathCards.length} 张`}
      size="lg"
      blurBackdrop
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          关闭检视
        </Button>
      }
    >
      <div className="max-h-[60vh] overflow-y-auto pr-1 select-none">
        {underneathCards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-fg-muted text-caption">
            <Layers className="w-10 h-10 stroke-[1.5] mb-2 text-fg-disabled" />
            <span>该卡牌下方暂无卡牌</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {underneathCards.map((uCard, idx) => {
              const def = findCardByNumberOrId(uCard.cardNumber || uCard.cardId);
              const abilityOpts =
                isFriendly && hostCard
                  ? getCardActivatedAbilityOptions(
                      gameState,
                      myUserId,
                      uCard,
                      'UNDERNEATH',
                      hostCard
                    )
                  : [];
              const canUseInstant = isFriendly && resolvedInstantIds.has(uCard.instanceId);
              const nonHandAction =
                isFriendly && hostCard
                  ? getNonHandPlayAction(gameState, myUserId, uCard, hostCard)
                  : null;

              return (
                <div
                  key={`${uCard.instanceId}-${idx}`}
                  onClick={() => onInspectCard?.(uCard)}
                  className="relative group border border-line bg-ink-950 p-2 flex flex-col items-center gap-2 hover:border-teal-400/70 transition-colors duration-fast cursor-pointer"
                >
                  <div className="relative w-full aspect-[63/88] rounded-card overflow-hidden bg-ink-900">
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
                        {uCard.cardNumber}
                      </div>
                    )}
                    <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-ink-950/90 border border-line text-hud font-sans text-teal-400">
                      {formatCardType(def?.cardType, def?.isInstant)}
                    </div>
                  </div>

                  <div className="text-center w-full">
                    <div className="text-caption font-semibold text-fg truncate">
                      {def?.name || uCard.cardNumber}
                    </div>
                    <div className="text-hud text-fg-muted font-num">{uCard.cardNumber}</div>
                  </div>

                  {isFriendly && (abilityOpts.length > 0 || canUseInstant || nonHandAction) && (
                    <div className="w-full flex flex-col gap-1">
                      {abilityOpts.map((opt) => (
                        <button
                          key={`u-act-${uCard.instanceId}-${opt.abilityIndex}`}
                          type="button"
                          disabled={opt.disabled}
                          title={opt.disabled ? opt.reason : opt.label}
                          onClick={(e) => {
                            e.stopPropagation();
                            onActivateAbility?.(uCard, opt.abilityIndex);
                            onClose();
                          }}
                          className="w-full px-2 py-1 clip-corner-sm bg-gold-300 hover:bg-gold-300/90 text-ink-950 font-semibold text-hud flex items-center justify-center gap-1 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Zap className="w-3 h-3 fill-current shrink-0" />
                          <span className="truncate">{opt.label}</span>
                        </button>
                      ))}

                      {canUseInstant && onUseInstant && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onUseInstant(uCard.instanceId);
                            onClose();
                          }}
                          className="w-full px-2 py-1 clip-corner-sm bg-teal-400 hover:bg-teal-400/90 text-ink-950 font-semibold text-hud flex items-center justify-center gap-1 cursor-pointer transition-colors"
                        >
                          <Zap className="w-3 h-3 fill-current shrink-0" />
                          <span>发动非战术【瞬时】</span>
                        </button>
                      )}

                      {nonHandAction && onNonHandPlay && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onNonHandPlay(uCard, nonHandAction);
                            onClose();
                          }}
                          className="w-full px-2 py-1 clip-corner-sm bg-teal-400 hover:bg-teal-400/90 text-ink-950 font-semibold text-hud flex items-center justify-center gap-1 cursor-pointer transition-colors"
                        >
                          <Play className="w-3 h-3 shrink-0" />
                          <span className="truncate">{nonHandAction.label}</span>
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
};
