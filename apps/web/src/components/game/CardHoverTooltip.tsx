'use client';

import React, { useEffect, useState } from 'react';
import { CardInstance, CardType, ElementAttribute } from '@zhanshuang/shared';
import { findCardByNumberOrId, formatCardType } from '@/lib/cards-data';
import { getCardThumbnailUrl, getCardFullImageUrl, handleThumbnailError } from '@/lib/card-image';
import {
  Flame,
  Zap,
  Moon,
  Snowflake,
  Shield,
  Layers,
  Sparkles,
  Swords,
  Info,
} from 'lucide-react';

interface CardHoverTooltipProps {
  card: CardInstance | null;
}

type Point = { x: number; y: number };

/**
 * 仅在有卡牌悬停时监听鼠标位置，并以 requestAnimationFrame 节流。
 * (位置状态收敛在浮窗组件内部，避免整张对局桌面随鼠标移动反复重渲染)
 */
function useCursorPosition(active: boolean): Point | null {
  const [position, setPosition] = useState<Point | null>(null);

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let latest: Point | null = null;
    const handleMouseMove = (e: MouseEvent) => {
      latest = { x: e.clientX, y: e.clientY };
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          setPosition(latest);
        });
      }
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [active]);

  return position;
}

function computeTooltipStyle(position: Point | null): React.CSSProperties {
  if (!position) {
    // 默认停靠在左下侧偏中
    return {
      left: '16px',
      bottom: '80px',
    };
  }

  const { x, y } = position;
  const tooltipWidth = 320;
  const tooltipHeight = 440;
  const winWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const winHeight = typeof window !== 'undefined' ? window.innerHeight : 1080;

  let posX = x + 18;
  let posY = y - 120;

  // 水平越界修正：若右侧空间不足，则显示在鼠标左侧
  if (posX + tooltipWidth > winWidth - 16) {
    posX = Math.max(16, x - tooltipWidth - 18);
  }

  // 垂直越界修正
  if (posY + tooltipHeight > winHeight - 16) {
    posY = Math.max(16, winHeight - tooltipHeight - 16);
  }
  if (posY < 16) {
    posY = 16;
  }

  return {
    left: `${posX}px`,
    top: `${posY}px`,
  };
}

export const CardHoverTooltip: React.FC<CardHoverTooltipProps> = ({ card }) => {
  const position = useCursorPosition(!!card);
  if (!card) return null;

  const cardDef = findCardByNumberOrId(card.cardNumber || card.cardId);
  const fullImgSrc = getCardFullImageUrl(card.imageUrl, card.cardNumber);
  const cardImgSrc = getCardThumbnailUrl(card.imageUrl, card.cardNumber);

  const totalPP = cardDef ? (cardDef.basePP ?? 0) + (card.tempPPBonus ?? 0) : 0;
  const totalDP = cardDef ? (cardDef.baseDP ?? 0) + (card.tempDPBonus ?? 0) : 0;

  const getElementBadge = (attr?: ElementAttribute) => {
    switch (attr) {
      case ElementAttribute.FIRE:
        return (
          <span className="px-1.5 py-0.5 rounded bg-red-600/20 text-red-400 border border-red-500/40 text-[10px] flex items-center gap-1 font-bold">
            <Flame className="w-3 h-3 text-red-500" /> 火
          </span>
        );
      case ElementAttribute.LIGHTNING:
        return (
          <span className="px-1.5 py-0.5 rounded bg-yellow-400/20 text-yellow-300 border border-yellow-400/40 text-[10px] flex items-center gap-1 font-bold">
            <Zap className="w-3 h-3 text-yellow-400" /> 雷
          </span>
        );
      case ElementAttribute.DARK:
        return (
          <span className="px-1.5 py-0.5 rounded bg-purple-600/20 text-purple-300 border border-purple-500/40 text-[10px] flex items-center gap-1 font-bold">
            <Moon className="w-3 h-3 text-purple-400" /> 暗
          </span>
        );
      case ElementAttribute.ICE:
        return (
          <span className="px-1.5 py-0.5 rounded bg-cyan-400/20 text-cyan-300 border border-cyan-400/40 text-[10px] flex items-center gap-1 font-bold">
            <Snowflake className="w-3 h-3 text-cyan-300" /> 冰
          </span>
        );
      case ElementAttribute.PHYSICAL:
        return (
          <span className="px-1.5 py-0.5 rounded bg-neutral-700/40 text-neutral-300 border border-neutral-600 text-[10px] flex items-center gap-1 font-bold">
            <Shield className="w-3 h-3 text-neutral-400" /> 物
          </span>
        );
      case ElementAttribute.VOID:
      case 'VOID' as any:
        return (
          <span className="px-1.5 py-0.5 rounded bg-cyan-400/20 text-cyan-300 border border-cyan-400/40 text-[10px] flex items-center gap-1 font-bold">
            <Sparkles className="w-3 h-3 text-cyan-300" /> 空
          </span>
        );
      default:
        return null;
    }
  };

  // 格式化规则文本中的关键词高亮
  const formatRulesText = (text: string) => {
    if (!text) return <span className="text-neutral-500 italic">通常卡牌，无特殊效果记述</span>;

    const parts = text.split(/(\\n|\n)/g);
    return parts.map((part, index) => {
      if (part === '\n' || part === '\\n') {
        return <br key={index} />;
      }

      // 高亮标志词
      let content: React.ReactNode = part;
      if (part.includes('【出】')) {
        content = (
          <span>
            {part.split('【出】').map((chunk, i) => (
              <React.Fragment key={i}>
                {i > 0 && (
                  <span className="px-1 py-px rounded bg-terminalCyan/20 text-terminalCyan font-bold border border-terminalCyan/40 text-[10px] mr-1">
                    【出】
                  </span>
                )}
                {chunk}
              </React.Fragment>
            ))}
          </span>
        );
      } else if (part.includes('【起】')) {
        content = (
          <span>
            {part.split('【起】').map((chunk, i) => (
              <React.Fragment key={i}>
                {i > 0 && (
                  <span className="px-1 py-px rounded bg-terminalGold/20 text-terminalGold font-bold border border-terminalGold/40 text-[10px] mr-1">
                    【起】
                  </span>
                )}
                {chunk}
              </React.Fragment>
            ))}
          </span>
        );
      } else if (part.includes('【充能自】') || part.includes('【自】')) {
        const tag = part.includes('【充能自】') ? '【充能自】' : '【自】';
        content = (
          <span>
            {part.split(tag).map((chunk, i) => (
              <React.Fragment key={i}>
                {i > 0 && (
                  <span className="px-1 py-px rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 text-[10px] mr-1">
                    {tag}
                  </span>
                )}
                {chunk}
              </React.Fragment>
            ))}
          </span>
        );
      } else if (part.includes('【永】')) {
        content = (
          <span>
            {part.split('【永】').map((chunk, i) => (
              <React.Fragment key={i}>
                {i > 0 && (
                  <span className="px-1 py-px rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40 text-[10px] mr-1">
                    【永】
                  </span>
                )}
                {chunk}
              </React.Fragment>
            ))}
          </span>
        );
      }

      return <span key={index}>{content}</span>;
    });
  };

  const tooltipStyle = computeTooltipStyle(position);

  return (
    <div
      className="fixed z-50 pointer-events-none select-none w-80 max-w-[90vw] rounded-xl border border-terminalCyan/70 bg-neutral-950/95 backdrop-blur-md shadow-[0_10px_35px_rgba(0,240,255,0.35)] p-3.5 font-mono text-xs animate-in fade-in zoom-in-95 duration-100 flex flex-col gap-2.5"
      style={tooltipStyle}
    >
      {/* 头部：卡名、卡号、费用、属性 */}
      <div className="flex items-start justify-between gap-2 border-b border-terminalBorder/60 pb-2">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-terminalCyan/80 font-bold flex items-center gap-1.5">
            <span>{card.cardNumber || cardDef?.cardNumber}</span>
            <span className="text-neutral-600">•</span>
            <span className="text-neutral-400">{formatCardType(cardDef?.cardType || CardType.ROLE)}</span>
          </div>
          <h4 className="text-sm font-bold text-white truncate mt-0.5">
            {cardDef?.name || card.cardNumber}
          </h4>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {cardDef?.attribute && getElementBadge(cardDef.attribute)}
          <span className="px-2 py-0.5 rounded bg-terminalGold/20 border border-terminalGold/50 text-terminalGold font-black text-xs">
            {cardDef?.cost ?? 0}费
          </span>
        </div>
      </div>

      {/* 中部：微型卡图预览与战斗力数据 */}
      <div className="flex items-center gap-3">
        <div className="w-16 h-22 rounded-md overflow-hidden border border-neutral-700 bg-neutral-900 flex-shrink-0 shadow relative">
          <img
            src={cardImgSrc}
            alt={cardDef?.name || card.cardNumber}
            className="w-full h-full object-cover"
            onError={(e) => handleThumbnailError(e, fullImgSrc)}
          />
        </div>

        <div className="flex-1 flex flex-col justify-center gap-1.5">
          {/* PP / DP 战斗数据 (仅角色牌) */}
          {cardDef?.cardType === CardType.ROLE && (
            <div className="grid grid-cols-2 gap-1.5 bg-neutral-900/80 p-1.5 rounded-lg border border-neutral-800">
              <div className="flex flex-col">
                <span className="text-[9px] text-neutral-400">攻击力 (PP)</span>
                <span className={`text-xs font-black ${card.tempPPBonus ? 'text-terminalCyan animate-pulse' : 'text-white'}`}>
                  {totalPP}
                  {card.tempPPBonus ? ` (+${card.tempPPBonus})` : ''}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-[9px] text-neutral-400">伤害值 (DP)</span>
                <span className={`text-xs font-black ${card.tempDPBonus ? 'text-terminalGold animate-pulse' : 'text-white'}`}>
                  {totalDP}
                  {card.tempDPBonus ? ` (+${card.tempDPBonus})` : ''}
                </span>
              </div>
            </div>
          )}

          {/* 特征词条标签 */}
          {cardDef?.traits && cardDef.traits.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {cardDef.traits.map((trait, i) => (
                <span
                  key={i}
                  className="px-1.5 py-px rounded bg-neutral-800/90 text-neutral-300 text-[9px] border border-neutral-700"
                >
                  &lt;{trait}&gt;
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 下部：效果规则文本 (全文滚动检视) */}
      <div className="bg-neutral-900/90 p-2.5 rounded-lg border border-neutral-800/80 text-[11px] leading-relaxed text-neutral-200 max-h-40 overflow-y-auto">
        {formatRulesText(cardDef?.rulesText || '')}
      </div>

      {/* 底部：卡牌系列与状态 */}
      <div className="flex items-center justify-between text-[9px] text-neutral-500 pt-0.5">
        <span>{cardDef?.flavorText || '战双帕弥什 TCG'}</span>
        {card.isReady !== undefined && (
          <span className={`font-bold ${card.isReady ? 'text-emerald-400' : 'text-amber-400'}`}>
            {card.isReady ? '竖直状态 [Ready]' : '横置状态 [Rest]'}
          </span>
        )}
      </div>
    </div>
  );
};
