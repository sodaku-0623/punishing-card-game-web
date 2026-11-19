'use client';

import React, { useState, useCallback } from 'react';
import { CardInstance } from '@zhanshuang/shared';
import {
  RefreshCw,
  Check,
  CheckCircle2,
  ArrowDownToLine,
  Clock,
  Info,
} from 'lucide-react';
import { findCardByNumberOrId, formatCardType } from '@/lib/cards-data';
import { getCardThumbnailUrl, getCardFullImageUrl, handleThumbnailError } from '@/lib/card-image';
import { sfx } from '@/lib/audio';
import { Button, HudBrackets } from '@/components/ui';

interface MulliganModalProps {
  isOpen: boolean;
  handCards: CardInstance[];
  onConfirm: (cardInstanceIdsToBottom: string[]) => void;
  isOpponentReady?: boolean;
}

export const MulliganModal: React.FC<MulliganModalProps> = React.memo(({
  isOpen,
  handCards,
  onConfirm,
  isOpponentReady = false,
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleCard = useCallback((cardId: string) => {
    sfx.playClick();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    sfx.playClick();
    setSelectedIds(new Set(handCards.map((c) => c.instanceId)));
  }, [handCards]);

  const clearAll = useCallback(() => {
    sfx.playClick();
    setSelectedIds(new Set());
  }, []);

  const handleConfirmMulligan = useCallback(() => {
    sfx.playPhaseChange();
    onConfirm(Array.from(selectedIds));
  }, [selectedIds, onConfirm]);

  const handleKeepAll = useCallback(() => {
    sfx.playPhaseChange();
    onConfirm([]);
  }, [onConfirm]);

  if (!isOpen) return null;

  const replaceCount = selectedIds.size;
  const keepCount = handCards.length - replaceCount;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="开局手牌调度"
      className="fixed inset-0 z-50 bg-ink-950/85 backdrop-blur-md flex items-center justify-center p-3 md:p-6 animate-in fade-in duration-fast"
    >
      <div className="relative w-full max-w-4xl bg-ink-900 border border-line-strong clip-corner-md shadow-overlay flex flex-col overflow-hidden text-fg max-h-[92vh] animate-in zoom-in-95 duration-fast">
        <div className="h-[2px] w-full bg-crimson-500 shrink-0" />

        {/* 顶部标题栏 */}
        <div className="px-5 py-4 border-b border-line bg-ink-950/90 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-teal-400/10 border border-teal-400/50 flex items-center justify-center text-teal-400 shrink-0">
              <RefreshCw className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-title-sm font-bold text-fg tracking-tight">
                  开局手牌调度
                </h2>
                <span className="text-hud font-display uppercase tracking-widest text-fg-muted">
                  MULLIGAN
                </span>
                <span className="text-hud px-2 py-0.5 bg-teal-400/10 text-teal-400 border border-teal-400/40 font-num">
                  规则 5.2.1.e
                </span>
              </div>
              <p className="text-caption text-fg-muted mt-0.5">
                可选择任意张手牌放回牌组底，抽取相同张数卡牌后洗切牌组。每局仅此一次调度机会。
              </p>
            </div>
          </div>

          {/* 对手状态提示 */}
          <div className="flex items-center gap-2 bg-ink-900 px-3 py-1.5 border border-line text-caption">
            <Clock className="w-3.5 h-3.5 text-fg-muted" />
            <span className="text-fg-muted">对手状态</span>
            {isOpponentReady ? (
              <span className="text-success font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> 已完成调度
              </span>
            ) : (
              <span className="text-gold-300 font-semibold">
                调度确认中...
              </span>
            )}
          </div>
        </div>

        {/* 卡牌选择展示区 */}
        <div className="p-4 md:p-6 overflow-y-auto flex-1 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-fg-secondary pb-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-fg">点击选择要放回牌组底的手牌：</span>
              <span className="font-num tabular-nums text-fg-muted">
                [ 放回 <strong className="text-gold-300">{replaceCount}</strong> 张 / 保留{' '}
                <strong className="text-success">{keepCount}</strong> 张 ]
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={selectAll}>
                全选
              </Button>
              <Button variant="secondary" size="sm" onClick={clearAll}>
                清空
              </Button>
            </div>
          </div>

          {/* 手牌网格 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4 justify-items-center py-2">
            {handCards.map((card) => {
              const isSelected = selectedIds.has(card.instanceId);
              const cardDef = findCardByNumberOrId(card.cardNumber || card.cardId);
              const fullImg = getCardFullImageUrl(card.imageUrl || cardDef?.imageUrl, card.cardNumber);
              const thumbImg = getCardThumbnailUrl(card.imageUrl || cardDef?.imageUrl, card.cardNumber);

              return (
                <div
                  key={card.instanceId}
                  onClick={() => toggleCard(card.instanceId)}
                  className={`group relative w-full max-w-[190px] aspect-[63/88] rounded-card overflow-hidden cursor-pointer transition-all duration-fast select-none border-2 ${
                    isSelected
                      ? 'border-gold-300 ring-2 ring-gold-300/40 -translate-y-1'
                      : 'border-line-strong hover:border-teal-400/80 hover:-translate-y-0.5'
                  }`}
                >
                  <HudBrackets size="sm" color={isSelected ? 'crimson' : 'steel'} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={thumbImg}
                    onError={(e) => handleThumbnailError(e, fullImg)}
                    alt={cardDef?.name || card.cardNumber}
                    className={`w-full h-full object-cover transition-all duration-fast ${
                      isSelected ? 'brightness-60' : 'brightness-100'
                    }`}
                    loading="eager"
                  />

                  {/* 状态徽章 */}
                  <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none">
                    <span className="text-hud px-1.5 py-0.5 bg-ink-950/90 border border-line text-fg-secondary font-num">
                      {card.cardNumber}
                    </span>
                    {isSelected ? (
                      <span className="px-2 py-0.5 bg-gold-300 text-ink-950 text-hud font-semibold flex items-center gap-1">
                        <ArrowDownToLine className="w-3 h-3" />
                        放回牌底
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-ink-950/90 border border-success/60 text-success text-hud font-semibold flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        保留
                      </span>
                    )}
                  </div>

                  {/* 选定遮罩 */}
                  {isSelected && (
                    <div className="absolute inset-0 bg-gold-300/15 flex flex-col items-center justify-center pointer-events-none p-3 text-center">
                      <div className="w-11 h-11 bg-gold-300 text-ink-950 flex items-center justify-center mb-1.5 clip-corner-sm">
                        <ArrowDownToLine className="w-5 h-5" />
                      </div>
                      <span className="text-caption font-semibold text-gold-300 bg-ink-950/85 px-2 py-0.5 border border-gold-300/50">
                        放回牌组底
                      </span>
                    </div>
                  )}

                  {/* 底部简明信息条 */}
                  <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-ink-950 via-ink-950/85 to-transparent flex flex-col justify-end text-left pointer-events-none">
                    <div className="text-caption font-semibold text-fg truncate">
                      {cardDef?.name || card.cardNumber}
                    </div>
                    <div className="flex items-center justify-between text-hud text-fg-muted mt-0.5 font-num">
                      <span className="font-sans">{formatCardType(cardDef?.cardType || 'ROLE')}</span>
                      <span>费用 {cardDef?.cost ?? 0}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 调度建议 */}
          <div className="p-3 bg-ink-950 border border-line text-caption text-fg-muted flex items-start gap-2.5">
            <Info className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong className="text-fg">战术调度建议：</strong>
              若起手高费卡牌较多或缺少 1~2 费角色卡，建议勾选高费卡牌放回牌组底；洗牌后双方将直接开启第 1 回合。
            </div>
          </div>
        </div>

        {/* 底部操作决策栏 */}
        <div className="px-5 py-4 border-t border-line bg-ink-950/90 flex flex-wrap items-center justify-between gap-3">
          <div className="text-caption text-fg-muted">
            {replaceCount === 0 ? (
              <span>当前未选择任何手牌，点击右侧将保留全部初始手牌</span>
            ) : (
              <span>
                将放回 <strong className="text-gold-300 font-num">{replaceCount}</strong> 张，从牌组顶重抽{' '}
                <strong className="text-teal-400 font-num">{replaceCount}</strong> 张并洗牌
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button variant="secondary" size="md" onClick={handleKeepAll}>
              <Check className="w-4 h-4 text-success" />
              <span>保留全部手牌</span>
            </Button>

            <Button
              variant="primary"
              size="md"
              onClick={handleConfirmMulligan}
              disabled={replaceCount === 0}
            >
              <RefreshCw className="w-4 h-4" />
              <span>确认调度 ({replaceCount} 张)</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
});

MulliganModal.displayName = 'MulliganModal';
