'use client';

import React from 'react';
import { CardInstance, CardType, ElementAttribute } from '@zhanshuang/shared';
import { findCardByNumberOrId, formatCardType } from '@/lib/cards-data';
import {
  Flame,
  Zap,
  Moon,
  Snowflake,
  Shield,
  Layers,
  Sparkles,
  Swords,
  Maximize2,
  X,
} from 'lucide-react';
import { getCardThumbnailUrl, handleThumbnailError } from '@/lib/card-image';

interface CardHoverPreviewProps {
  card: CardInstance | null;
  onOpenFullModal?: () => void;
  onClose?: () => void;
}

export const CardHoverPreview: React.FC<CardHoverPreviewProps> = ({
  card,
  onOpenFullModal,
  onClose,
}) => {
  if (!card) return null;

  const cardDef = findCardByNumberOrId(card.cardNumber || card.cardId);
  const fullImgSrc = card.imageUrl || `/cards/${card.cardNumber}.png`;
  const cardImgSrc = getCardThumbnailUrl(card.imageUrl, card.cardNumber);

  const getElementBadge = (attr?: ElementAttribute, attrName?: string) => {
    if (attrName === '空' || attr === ElementAttribute.VOID || (attr as any) === 'VOID') {
      return (
        <span className="px-1.5 py-0.5 rounded bg-cyan-400/20 text-cyan-300 border border-cyan-400/40 text-[10px] flex items-center gap-1">
          <Sparkles className="w-3 h-3 text-cyan-300" /> 空属性
        </span>
      );
    }
    switch (attr) {
      case ElementAttribute.FIRE:
        return (
          <span className="px-1.5 py-0.5 rounded bg-red-600/20 text-red-400 border border-red-500/40 text-[10px] flex items-center gap-1">
            <Flame className="w-3 h-3 text-red-500" /> 火属性
          </span>
        );
      case ElementAttribute.LIGHTNING:
        return (
          <span className="px-1.5 py-0.5 rounded bg-yellow-400/20 text-yellow-300 border border-yellow-400/40 text-[10px] flex items-center gap-1">
            <Zap className="w-3 h-3 text-yellow-400" /> 雷属性
          </span>
        );
      case ElementAttribute.DARK:
        return (
          <span className="px-1.5 py-0.5 rounded bg-purple-600/20 text-purple-300 border border-purple-500/40 text-[10px] flex items-center gap-1">
            <Moon className="w-3 h-3 text-purple-400" /> 暗属性
          </span>
        );
      case ElementAttribute.ICE:
        return (
          <span className="px-1.5 py-0.5 rounded bg-cyan-400/20 text-cyan-300 border border-cyan-400/40 text-[10px] flex items-center gap-1">
            <Snowflake className="w-3 h-3 text-cyan-300" /> 冰属性
          </span>
        );
      case ElementAttribute.PHYSICAL:
        return (
          <span className="px-1.5 py-0.5 rounded bg-neutral-700/40 text-neutral-300 border border-neutral-600 text-[10px] flex items-center gap-1">
            <Shield className="w-3 h-3 text-neutral-400" /> 物理属性
          </span>
        );
      default:
        return null;
    }
  };

  const totalPP = (cardDef?.basePP ?? 0) + (card.tempPPBonus ?? 0);
  const totalDP = (cardDef?.baseDP ?? 0) + (card.tempDPBonus ?? 0);

  return (
    <div className="absolute left-4 top-16 z-40 w-64 rounded-2xl border border-terminalCyan/50 bg-neutral-950/95 p-3.5 shadow-[0_12px_40px_rgba(0,0,0,0.85)] backdrop-blur-xl font-mono text-xs flex flex-col gap-2.5 animate-in fade-in slide-in-from-left-4 duration-150 select-none">
      {/* 头部：卡号与操作 */}
      <div className="flex items-center justify-between border-b border-terminalBorder/60 pb-2">
        <div className="flex items-center gap-1.5 text-terminalCyan font-bold text-[11px]">
          <Sparkles className="w-3.5 h-3.5" />
          <span>{card.cardNumber}</span>
        </div>

        <div className="flex items-center gap-1">
          {onOpenFullModal && (
            <button
              onClick={onOpenFullModal}
              className="p-1 rounded hover:bg-neutral-800 text-neutral-400 hover:text-terminalCyan transition-colors"
              title="全屏大图查看 (F)"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white transition-colors"
              title="关闭预览 (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 卡图展示 */}
      <div className="relative w-full h-44 rounded-xl overflow-hidden border border-terminalBorder/80 bg-neutral-900 group">
        <img
          src={cardImgSrc}
          alt={card.cardNumber}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          loading="lazy"
          onError={(e) => {
            handleThumbnailError(e, fullImgSrc);
          }}
        />

        {/* 费用徽章 */}
        {cardDef && cardDef.cost !== undefined && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-neutral-950/90 text-terminalCyan border border-terminalCyan/60 font-black text-xs shadow-lg">
            费用: {cardDef.cost}
          </div>
        )}

        {/* 叠层指示 */}
        {card.underneathCardIds && card.underneathCardIds.length > 0 && (
          <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-purple-950/90 border border-purple-500/80 text-purple-300 text-[10px] font-mono flex items-center gap-0.5 shadow">
            <Layers className="w-3 h-3" />
            <span>+{card.underneathCardIds.length}</span>
          </div>
        )}

        {/* PP / DP 战斗数值浮动条 */}
        {cardDef?.cardType === CardType.ROLE && (
          <div className="absolute bottom-2 inset-x-2 flex items-center justify-between px-2.5 py-1 rounded-lg bg-black/85 border border-terminalBorder/80 text-xs backdrop-blur-sm">
            <div className="flex items-center gap-1 text-terminalCyan font-black">
              <Swords className="w-3.5 h-3.5" />
              <span>PP {totalPP}</span>
              {card.tempPPBonus ? (
                <span className="text-emerald-400 text-[10px]">(+{card.tempPPBonus})</span>
              ) : null}
            </div>

            <div className="flex items-center gap-1 text-terminalGold font-black">
              <Shield className="w-3.5 h-3.5" />
              <span>DP {totalDP}</span>
              {card.tempDPBonus ? (
                <span className="text-emerald-400 text-[10px]">(+{card.tempDPBonus})</span>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* 卡名与属性特征 */}
      <div>
        <h4 className="font-bold text-white text-sm tracking-wide leading-tight">
          {cardDef?.name || card.cardNumber}
        </h4>
        <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
          <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 text-[10px]">
            {formatCardType(cardDef?.cardType, cardDef?.isInstant)}
          </span>
          {getElementBadge(cardDef?.attribute, cardDef?.attributeName)}
          {cardDef?.traits?.map((t, idx) => (
            <span
              key={idx}
              className="px-1.5 py-0.5 rounded bg-neutral-800/80 text-neutral-400 text-[10px]"
            >
              #{t}
            </span>
          ))}
        </div>
      </div>

      {/* 规则效果文 */}
      <div className="max-h-36 overflow-y-auto rounded-lg bg-neutral-900/90 border border-terminalBorder/50 p-2 text-[11px] text-neutral-300 leading-relaxed font-sans">
        {cardDef?.rulesText ? (
          <p className="whitespace-pre-line">{cardDef.rulesText}</p>
        ) : (
          <p className="text-neutral-500 italic">暂无特殊规则效果描述</p>
        )}
      </div>

      <div className="text-[10px] text-neutral-500 text-center flex items-center justify-center gap-1">
        <span>按快捷键</span>
        <kbd className="px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-white font-mono text-[9px]">
          F
        </kbd>
        <span>查看超清大图与全屏详情</span>
      </div>
    </div>
  );
};
