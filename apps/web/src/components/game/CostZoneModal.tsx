'use client';

import React from 'react';
import { CardInstance } from '@zhanshuang/shared';
import { CardView } from './CardView';
import { findCardByNumberOrId, formatCardType } from '@/lib/cards-data';
import { Coins, Moon, Zap, Eye, CheckCircle2 } from 'lucide-react';
import { Button, Dialog } from '@/components/ui';

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
  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title={isOpponent ? '对方费用区卡牌检视' : '我方费用区卡牌检视'}
      subtitle={`COST ZONE · 可用 ${availableCount}/${totalCount}`}
      size="lg"
      blurBackdrop
      footer={
        <div className="w-full flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-caption text-fg-muted">
            <Zap className="w-3.5 h-3.5 text-teal-400 shrink-0" />
            <span>点击任意明费卡牌可查看其技能与属性详情</span>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 select-none">
        {/* 摘要条 */}
        <div className="flex flex-wrap items-center gap-3 px-3 py-2 bg-ink-950 border border-line text-caption">
          <span className="flex items-center gap-1.5 text-teal-400 font-num tabular-nums font-bold">
            <Coins className="w-3.5 h-3.5 text-gold-300" />
            可用 {availableCount} / {totalCount}
          </span>
          <span className="text-fg-secondary font-num tabular-nums">共 {cards.length} 张</span>
          {hiddenCount > 0 && (
            <span className="text-steel-300 flex items-center gap-1 font-num tabular-nums font-semibold">
              <Moon className="w-3 h-3" /> 暗费 {hiddenCount} 张
            </span>
          )}
          <span className="text-fg-muted text-hud ml-auto">
            规则 3.6 · 费用区卡牌每回合重置为竖直可用
          </span>
        </div>

        {/* 卡牌列表 */}
        {cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-fg-muted gap-2">
            <Coins className="w-9 h-9 opacity-30" />
            <span className="text-body-sm text-fg-secondary">当前费用区暂无任何卡牌</span>
            <span className="text-caption text-fg-muted text-center">
              {isOpponent
                ? '对方尚未在抽牌填充阶段充能或使用费用'
                : '在每回合的【抽牌填充阶段】，可从手牌选择 1 张卡充能为可用明费'}
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[55vh] overflow-y-auto pr-1">
            {cards.map((card, idx) => {
              const isHidden = !card.isFaceUp;
              const def = isHidden ? null : findCardByNumberOrId(card.cardNumber || card.cardId);
              const isReady = card.isReady;

              return (
                <div
                  key={card.instanceId}
                  className="flex flex-col items-center gap-1.5 p-2 border border-line bg-ink-950 hover:border-teal-400/60 transition-colors group"
                >
                  {/* 状态顶标 */}
                  <div className="flex items-center justify-between w-full text-hud px-0.5">
                    <span className="text-fg-muted font-num">#{idx + 1}</span>
                    {isHidden ? (
                      <span className="px-1.5 py-px bg-steel-700/25 text-steel-300 border border-steel-500/50 font-medium flex items-center gap-0.5">
                        <Moon className="w-2.5 h-2.5" /> 暗费
                      </span>
                    ) : isReady ? (
                      <span className="px-1.5 py-px bg-teal-400/15 text-teal-400 border border-teal-400/40 font-medium flex items-center gap-0.5">
                        <CheckCircle2 className="w-2.5 h-2.5" /> 可用明费
                      </span>
                    ) : (
                      <span className="px-1.5 py-px bg-ink-850 text-fg-muted border border-line font-medium">
                        已横置
                      </span>
                    )}
                  </div>

                  {/* 卡牌视图 */}
                  <div
                    className="relative cursor-pointer transition-transform duration-fast group-hover:scale-105"
                    onClick={() => {
                      if (!isHidden) {
                        onInspectCard?.(card);
                      }
                    }}
                    title={isHidden ? '暗费未公开' : '点击检视卡牌详情'}
                  >
                    <CardView
                      card={card}
                      isFaceDown={isHidden && isOpponent}
                      isRested={!isReady}
                      size="sm"
                    />
                    {!isHidden && (
                      <div className="absolute inset-0 bg-ink-950/0 group-hover:bg-ink-950/35 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100 pointer-events-none">
                        <span className="px-2 py-0.5 bg-ink-950/90 text-hud text-teal-400 border border-teal-400/50 flex items-center gap-1">
                          <Eye className="w-3 h-3" /> 查看
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 底部名称 */}
                  <div className="text-center w-full truncate">
                    {isHidden ? (
                      <span className="text-caption text-steel-300 font-medium">
                        {isOpponent ? '暗费 (对手隐藏)' : `我方暗费: ${card.cardNumber}`}
                      </span>
                    ) : (
                      <>
                        <div className="text-caption text-fg font-semibold truncate">
                          {def?.name || card.cardNumber}
                        </div>
                        <div className="text-hud text-fg-muted font-num">
                          {formatCardType(def?.cardType, def?.isInstant)} · 原费 {def?.cost ?? 0}
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
    </Dialog>
  );
};
