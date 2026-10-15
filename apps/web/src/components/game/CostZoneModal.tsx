'use client';

import React from 'react';
import { CardInstance } from '@zhanshuang/shared';
import { CardView } from './CardView';
import { findCardByNumberOrId, formatCardType } from '@/lib/cards-data';
import { X, Coins, Moon, Zap, Eye, CheckCircle2, AlertCircle } from 'lucide-react';

interface CostZoneModalProps {
  isOpen: boolean;
  onClose: () => void;
  cards: CardInstance[];
  availableCount: number;
  totalCount: number;
  hiddenCount: number;
  isOpponent?: boolean;
  onInspectCard?: (card: CardInstance) => void;
}

export const CostZoneModal: React.FC<CostZoneModalProps> = ({
  isOpen,
  onClose,
  cards,
  availableCount,
  totalCount,
  hiddenCount,
  isOpponent = false,
  onInspectCard,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200 select-none"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl bg-surface/95 border border-terminalBorder rounded-2xl p-5 shadow-2xl flex flex-col gap-4 font-mono max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-terminalBorder/70 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-terminalGold/15 border border-terminalGold/50 flex items-center justify-center text-terminalGold">
              <Coins className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-base">
                  {isOpponent ? '对方费用区卡牌检视' : '我方费用区卡牌检视'}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-terminalCyan/15 text-terminalCyan border border-terminalCyan/40 font-black">
                  可用: {availableCount} / {totalCount}
                </span>
              </div>
              <div className="text-[11px] text-neutral-400 mt-0.5 flex items-center gap-3">
                <span>共 {cards.length} 张卡牌</span>
                {hiddenCount > 0 && (
                  <span className="text-purple-400 flex items-center gap-1 font-bold">
                    <Moon className="w-3 h-3" /> 暗费: {hiddenCount} 张
                  </span>
                )}
                <span className="text-neutral-500">规则 3.6 • 费用区卡牌每回合重置为竖直可用</span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl border border-neutral-700 hover:border-terminalCyan/60 text-neutral-400 hover:text-white bg-neutral-900/80 transition-colors"
            title="关闭窗口 (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 卡牌展示区 */}
        <div className="flex-1 overflow-y-auto pr-1">
          {cards.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-neutral-500 gap-2">
              <Coins className="w-10 h-10 opacity-30" />
              <span className="text-sm">当前费用区暂无任何卡牌</span>
              <span className="text-xs text-neutral-600">
                {isOpponent
                  ? '对方尚未在抽牌填充阶段充能或使用费用'
                  : '在每回合的【抽牌填充阶段】，可从手牌选择 1 张卡充能为可用明费'}
              </span>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 p-2">
              {cards.map((card, idx) => {
                const isHidden = !card.isFaceUp;
                const def = isHidden ? null : findCardByNumberOrId(card.cardNumber || card.cardId);
                const isReady = card.isReady;

                return (
                  <div
                    key={card.instanceId}
                    className="flex flex-col items-center gap-1.5 p-2 rounded-xl border border-terminalBorder/60 bg-neutral-950/70 hover:border-terminalCyan/60 transition-all group"
                  >
                    {/* 卡牌状态顶标 */}
                    <div className="flex items-center justify-between w-full text-[10px] px-1 font-mono">
                      <span className="text-neutral-500">#{idx + 1}</span>
                      {isHidden ? (
                        <span className="px-1.5 py-0.2 rounded bg-purple-950 text-purple-300 border border-purple-600/60 font-bold flex items-center gap-0.5">
                          <Moon className="w-2.5 h-2.5" /> 暗费
                        </span>
                      ) : isReady ? (
                        <span className="px-1.5 py-0.2 rounded bg-terminalCyan/20 text-terminalCyan border border-terminalCyan/40 font-bold flex items-center gap-0.5">
                          <CheckCircle2 className="w-2.5 h-2.5" /> 可用明费
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.2 rounded bg-neutral-800 text-neutral-400 border border-neutral-700 font-bold">
                          已横置消耗
                        </span>
                      )}
                    </div>

                    {/* 卡牌实体视图 */}
                    <div
                      className="relative cursor-pointer transition-transform group-hover:scale-105"
                      onClick={() => {
                        if (!isHidden) {
                          onInspectCard?.(card);
                        }
                      }}
                      title={isHidden ? '暗费未公开' : '点击全屏检视卡牌详情'}
                    >
                      <CardView
                        card={card}
                        isFaceDown={isHidden && isOpponent}
                        isRested={!isReady}
                        size="sm"
                      />
                      {!isHidden && (
                        <div className="absolute inset-0 bg-terminalCyan/0 group-hover:bg-terminalCyan/10 transition-colors rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-events-none">
                          <span className="px-2 py-1 rounded bg-black/80 text-[10px] text-terminalCyan font-mono border border-terminalCyan/40 flex items-center gap-1 shadow">
                            <Eye className="w-3 h-3" /> 查看
                          </span>
                        </div>
                      )}
                    </div>

                    {/* 卡牌底部名称与费用类型 */}
                    <div className="text-center w-full truncate">
                      {isHidden ? (
                        <span className="text-xs text-purple-300 font-bold">
                          {isOpponent ? '暗费 (对手隐藏)' : `我方暗费: ${card.cardNumber}`}
                        </span>
                      ) : (
                        <>
                          <div className="text-xs text-white font-bold truncate">
                            {def?.name || card.cardNumber}
                          </div>
                          <div className="text-[10px] text-neutral-400 font-mono">
                            {formatCardType(def?.cardType, def?.isInstant)} • 原费: {def?.cost ?? 0}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 底部说明 */}
        <div className="border-t border-terminalBorder/60 pt-2.5 flex items-center justify-between text-xs text-neutral-400">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-terminalCyan" />
            <span>点击任意明费卡牌可查看其全息技能与属性详情</span>
          </div>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white font-bold transition-colors cursor-pointer"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
};
