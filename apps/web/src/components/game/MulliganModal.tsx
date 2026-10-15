'use client';

import React, { useState, useCallback } from 'react';
import { CardInstance } from '@zhanshuang/shared';
import {
  RefreshCw,
  Check,
  CheckCircle2,
  ArrowDownToLine,
  Sparkles,
  Clock,
  Shield,
  Layers,
  Info,
} from 'lucide-react';
import { findCardByNumberOrId, formatCardType } from '@/lib/cards-data';
import { getCardThumbnailUrl, getCardFullImageUrl, handleThumbnailError } from '@/lib/card-image';
import { sfx } from '@/lib/audio';

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
  // 选定放回牌组底的卡牌实例 ID 集合
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 切换选择单张卡牌
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

  // 全选（放回全部手牌）
  const selectAll = useCallback(() => {
    sfx.playClick();
    setSelectedIds(new Set(handCards.map((c) => c.instanceId)));
  }, [handCards]);

  // 清空（全数保留）
  const clearAll = useCallback(() => {
    sfx.playClick();
    setSelectedIds(new Set());
  }, []);

  // 提交：调度指定数量的卡牌
  const handleConfirmMulligan = useCallback(() => {
    sfx.playPhaseChange();
    onConfirm(Array.from(selectedIds));
  }, [selectedIds, onConfirm]);

  // 提交：保留全部手牌（0张调度）
  const handleKeepAll = useCallback(() => {
    sfx.playPhaseChange();
    onConfirm([]);
  }, [onConfirm]);

  if (!isOpen) return null;

  const replaceCount = selectedIds.size;
  const keepCount = handCards.length - replaceCount;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 md:p-6 animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-surface/98 border border-terminalCyan/40 rounded-2xl shadow-2xl flex flex-col overflow-hidden font-mono text-neutral-100 max-h-[92vh]">
        {/* 顶部标题栏 */}
        <div className="px-5 py-4 border-b border-terminalBorder/70 bg-neutral-900/90 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-terminalCyan/15 border border-terminalCyan/40 flex items-center justify-center text-terminalCyan shadow-[0_0_15px_rgba(0,229,255,0.2)]">
              <RefreshCw className="w-5 h-5 animate-spin-slow" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base md:text-lg font-bold text-white tracking-wide">
                  开局手牌调度 • MULLIGAN
                </h2>
                <span className="text-[10px] px-2 py-0.5 rounded bg-terminalCyan/20 text-terminalCyan border border-terminalCyan/40 font-mono">
                  规则 5.2.1.e
                </span>
              </div>
              <p className="text-[11px] text-neutral-400 mt-0.5">
                可选择任意张手牌放回牌组底，抽取相同张数卡牌后洗切牌组。每局仅此一次调度机会。
              </p>
            </div>
          </div>

          {/* 对手状态提示 */}
          <div className="flex items-center gap-2 bg-neutral-950/80 px-3 py-1.5 rounded-lg border border-terminalBorder text-xs">
            <Clock className="w-3.5 h-3.5 text-neutral-400" />
            <span className="text-neutral-400">对手状态:</span>
            {isOpponentReady ? (
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> 已完成调度
              </span>
            ) : (
              <span className="text-terminalGold font-bold flex items-center gap-1 animate-pulse">
                调度确认中...
              </span>
            )}
          </div>
        </div>

        {/* 卡牌选择展示区 */}
        <div className="p-4 md:p-6 overflow-y-auto flex-1 flex flex-col gap-4">
          <div className="flex items-center justify-between text-xs text-neutral-300 pb-1">
            <div className="flex items-center gap-2">
              <span className="font-bold">点击选择要放回牌组底的手牌：</span>
              <span className="text-terminalCyan">
                [ 放回: <strong className="text-amber-400 font-bold">{replaceCount}</strong> 张 / 保留:{' '}
                <strong className="text-emerald-400 font-bold">{keepCount}</strong> 张 ]
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={selectAll}
                className="px-2.5 py-1 rounded text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 hover:border-neutral-500 transition-colors"
              >
                全选
              </button>
              <button
                type="button"
                onClick={clearAll}
                className="px-2.5 py-1 rounded text-xs bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 hover:border-neutral-500 transition-colors"
              >
                清空
              </button>
            </div>
          </div>

          {/* 4张手牌水平居中网格 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4 justify-items-center py-2">
            {handCards.map((card) => {
              const isSelected = selectedIds.has(card.instanceId);
              const cardDef = findCardByNumberOrId(card.cardNumber || card.cardId);
              const rawImg = card.imageUrl || cardDef?.imageUrl || `/cards/${card.cardNumber}.png`;
              const thumbImg = getCardThumbnailUrl(rawImg, card.cardNumber);
              const fullImg = getCardFullImageUrl(rawImg, card.cardNumber);

              return (
                <div
                  key={card.instanceId}
                  onClick={() => toggleCard(card.instanceId)}
                  className={`group relative w-full max-w-[190px] aspect-[5/7] rounded-xl overflow-hidden cursor-pointer transition-all duration-200 select-none border-2 shadow-lg ${
                    isSelected
                      ? 'border-amber-400 ring-4 ring-amber-400/30 scale-[1.02] shadow-[0_0_20px_rgba(251,191,36,0.35)]'
                      : 'border-neutral-700 hover:border-terminalCyan/70 hover:scale-[1.01]'
                  }`}
                >
                  {/* 卡图展示 */}
                  <img
                    src={thumbImg}
                    onError={(e) => handleThumbnailError(e, fullImg)}
                    alt={cardDef?.name || card.cardNumber}
                    className={`w-full h-full object-cover transition-opacity duration-200 ${
                      isSelected ? 'brightness-75' : 'brightness-100'
                    }`}
                    loading="eager"
                  />

                  {/* 状态徽章：放回牌组底 或 保留 */}
                  <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-black/75 border border-white/20 text-neutral-300 font-mono">
                      {card.cardNumber}
                    </span>
                    {isSelected ? (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500 text-neutral-950 text-[10px] font-bold flex items-center gap-1 shadow">
                        <ArrowDownToLine className="w-3 h-3" />
                        放回牌底
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/80 text-white text-[10px] font-bold flex items-center gap-1 shadow">
                        <Check className="w-3 h-3" />
                        保留手牌
                      </span>
                    )}
                  </div>

                  {/* 选定遮罩与居中标识 */}
                  {isSelected && (
                    <div className="absolute inset-0 bg-amber-500/20 backdrop-blur-[1px] flex flex-col items-center justify-center pointer-events-none p-3 text-center">
                      <div className="w-12 h-12 rounded-full bg-amber-500/90 text-neutral-950 flex items-center justify-center shadow-lg mb-1 animate-bounce-short">
                        <ArrowDownToLine className="w-6 h-6" />
                      </div>
                      <span className="text-xs font-bold text-amber-300 drop-shadow">
                        放回牌组底
                      </span>
                    </div>
                  )}

                  {/* 底部简明信息条 */}
                  <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/95 via-black/80 to-transparent flex flex-col justify-end text-left pointer-events-none">
                    <div className="text-xs font-bold text-white truncate drop-shadow">
                      {cardDef?.name || card.cardNumber}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-neutral-400 mt-0.5 font-mono">
                      <span>{formatCardType(cardDef?.cardType || 'ROLE')}</span>
                      <span>费用 {cardDef?.cost ?? 0}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 规则贴心提示 */}
          <div className="rounded-xl p-3 bg-neutral-900/60 border border-terminalBorder/50 text-[11px] text-neutral-400 flex items-start gap-2.5">
            <Info className="w-4 h-4 text-terminalCyan shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong className="text-neutral-200">战术调度建议：</strong>
              若起手高费卡牌较多或缺少 1~2 费角色卡/核心招式，建议勾选高费卡牌放回牌组底；洗牌后双方将以最佳手牌状态直接开启第 1 回合。
            </div>
          </div>
        </div>

        {/* 底部操作决策栏 */}
        <div className="px-5 py-4 border-t border-terminalBorder/70 bg-neutral-900/90 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-neutral-400">
            {replaceCount === 0 ? (
              <span>当前未选择任何手牌，点击右侧将保留全部初始手牌</span>
            ) : (
              <span>
                将放回 <strong className="text-amber-400">{replaceCount}</strong> 张，从牌组顶重抽{' '}
                <strong className="text-terminalCyan">{replaceCount}</strong> 张并洗牌
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {/* 保留全部手牌按钮 */}
            <button
              type="button"
              onClick={handleKeepAll}
              className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-bold text-xs border border-neutral-700 hover:border-neutral-500 transition-all flex items-center gap-1.5"
            >
              <Check className="w-4 h-4 text-emerald-400" />
              <span>保留全部手牌 (不调度)</span>
            </button>

            {/* 确认调度换牌按钮 */}
            <button
              type="button"
              onClick={handleConfirmMulligan}
              disabled={replaceCount === 0}
              className={`px-5 py-2 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 shadow-lg ${
                replaceCount > 0
                  ? 'bg-terminalCyan hover:bg-terminalCyan/90 text-neutral-950 shadow-[0_0_15px_rgba(0,229,255,0.3)] hover:scale-105 active:scale-95'
                  : 'bg-neutral-800 text-neutral-500 border border-neutral-700 cursor-not-allowed'
              }`}
            >
              <RefreshCw className="w-4 h-4" />
              <span>确认调度 ({replaceCount} 张)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
