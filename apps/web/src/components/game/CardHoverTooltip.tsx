'use client';

import React, { useEffect, useState } from 'react';
import { CardInstance, CardType, ElementAttribute } from '@zhanshuang/shared';
import { isCardApproximatelyImplemented } from '@zhanshuang/game-rules';
import { findCardByNumberOrId, formatCardType } from '@/lib/cards-data';
import { getCardThumbnailUrl, getCardFullImageUrl, handleThumbnailError } from '@/lib/card-image';
import { formatBonus, formatCardModifiers, formatCardProhibitions, getDisplayStats } from '@/lib/card-stats';
import {
  Flame,
  Zap,
  Moon,
  Snowflake,
  Shield,
  Sparkles,
} from 'lucide-react';
import { HudBrackets } from '@/components/ui';

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

  if (posX + tooltipWidth > winWidth - 16) {
    posX = Math.max(16, x - tooltipWidth - 18);
  }
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

  const { pp: totalPP, dp: totalDP, ppBonus, dpBonus } = getDisplayStats(card, cardDef);
  const displayTraits = card.effectiveTraits ?? cardDef?.traits ?? [];
  const activeModifiers = formatCardModifiers(card);
  const activeProhibitions = formatCardProhibitions(card);

  const getElementBadge = (attr?: ElementAttribute) => {
    switch (attr) {
      case ElementAttribute.FIRE:
        return (
          <span className="px-1.5 py-0.5 bg-crimson-500/15 text-crimson-400 border border-crimson-500/40 text-hud flex items-center gap-1 font-medium">
            <Flame className="w-3 h-3 text-crimson-400" /> 火
          </span>
        );
      case ElementAttribute.LIGHTNING:
        return (
          <span className="px-1.5 py-0.5 bg-gold-300/15 text-gold-300 border border-gold-300/40 text-hud flex items-center gap-1 font-medium">
            <Zap className="w-3 h-3 text-gold-300" /> 雷
          </span>
        );
      case ElementAttribute.DARK:
        return (
          <span className="px-1.5 py-0.5 bg-steel-700/25 text-steel-300 border border-steel-500/50 text-hud flex items-center gap-1 font-medium">
            <Moon className="w-3 h-3 text-steel-300" /> 暗
          </span>
        );
      case ElementAttribute.ICE:
        return (
          <span className="px-1.5 py-0.5 bg-teal-400/15 text-teal-400 border border-teal-400/40 text-hud flex items-center gap-1 font-medium">
            <Snowflake className="w-3 h-3 text-teal-400" /> 冰
          </span>
        );
      case ElementAttribute.PHYSICAL:
        return (
          <span className="px-1.5 py-0.5 bg-ink-800 text-fg-secondary border border-line-strong text-hud flex items-center gap-1 font-medium">
            <Shield className="w-3 h-3 text-fg-muted" /> 物
          </span>
        );
      case ElementAttribute.VOID:
      case 'VOID' as any:
        return (
          <span className="px-1.5 py-0.5 bg-teal-400/15 text-teal-400 border border-teal-400/40 text-hud flex items-center gap-1 font-medium">
            <Sparkles className="w-3 h-3 text-teal-400" /> 空
          </span>
        );
      default:
        return null;
    }
  };

  // 格式化规则文本中的关键词高亮
  const formatRulesText = (text: string) => {
    if (!text) return <span className="text-fg-muted">通常卡牌，无特殊效果记述</span>;

    const parts = text.split(/(\\n|\n)/g);
    return parts.map((part, index) => {
      if (part === '\n' || part === '\\n') {
        return <br key={index} />;
      }

      let content: React.ReactNode = part;
      if (part.includes('【出】')) {
        content = (
          <span>
            {part.split('【出】').map((chunk, i) => (
              <React.Fragment key={i}>
                {i > 0 && (
                  <span className="px-1 py-px bg-teal-400/15 text-teal-400 font-semibold border border-teal-400/40 text-hud mr-1">
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
                  <span className="px-1 py-px bg-gold-300/15 text-gold-300 font-semibold border border-gold-300/40 text-hud mr-1">
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
                  <span className="px-1 py-px bg-crimson-500/15 text-crimson-400 font-semibold border border-crimson-500/40 text-hud mr-1">
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
                  <span className="px-1 py-px bg-success/15 text-success font-semibold border border-success/40 text-hud mr-1">
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
      className="fixed z-50 pointer-events-none select-none w-80 max-w-[90vw] border border-teal-400/70 bg-ink-950/95 backdrop-blur-md shadow-overlay p-3.5 text-caption animate-in fade-in duration-fast flex flex-col gap-2.5"
      style={tooltipStyle}
    >
      <HudBrackets size="sm" color="teal" />

      {/* 头部：卡名、卡号、费用、属性 */}
      <div className="flex items-start justify-between gap-2 border-b border-line pb-2">
        <div className="flex-1 min-w-0">
          <div className="text-hud font-num text-teal-400 flex items-center gap-1.5 flex-wrap">
            <span>{card.cardNumber || cardDef?.cardNumber}</span>
            <span className="text-fg-disabled">/</span>
            <span className="text-fg-muted font-sans">
              {formatCardType(cardDef?.cardType || CardType.ROLE)}
            </span>
            {isCardApproximatelyImplemented(card.cardNumber || cardDef?.cardNumber, cardDef?.rulesText) && (
              <span className="px-1 py-px bg-gold-300/15 border border-gold-300/50 text-gold-300 font-sans font-semibold">
                近似效果
              </span>
            )}
          </div>
          <h4 className="text-body-sm font-semibold text-fg truncate mt-0.5">
            {cardDef?.name || card.cardNumber}
          </h4>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {cardDef?.attribute && getElementBadge(cardDef.attribute)}
          <span className="px-2 py-0.5 bg-gold-300/15 border border-gold-300/50 text-gold-300 font-num tabular-nums font-bold text-hud">
            {cardDef?.cost ?? 0}费
          </span>
        </div>
      </div>

      {/* 中部：微型卡图预览与战斗力数据 */}
      <div className="flex items-center gap-3">
        <div className="w-16 h-22 rounded-card overflow-hidden border border-line-strong bg-ink-900 flex-shrink-0 relative">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cardImgSrc}
            alt={cardDef?.name || card.cardNumber}
            className="w-full h-full object-cover"
            onError={(e) => handleThumbnailError(e, fullImgSrc)}
          />
        </div>

        <div className="flex-1 flex flex-col justify-center gap-1.5">
          {cardDef?.cardType === CardType.ROLE && (
            <div className="grid grid-cols-2 gap-1.5 bg-ink-900 p-1.5 border border-line">
              <div className="flex flex-col">
                <span className="text-hud text-fg-muted">攻击力 PP</span>
                <span className={`text-caption font-num tabular-nums font-bold ${ppBonus ? 'text-teal-400' : 'text-fg'}`}>
                  {totalPP}
                  {formatBonus(ppBonus)}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-hud text-fg-muted">破坏力 DP</span>
                <span className={`text-caption font-num tabular-nums font-bold ${dpBonus ? 'text-gold-300' : 'text-fg'}`}>
                  {totalDP}
                  {formatBonus(dpBonus)}
                </span>
              </div>
            </div>
          )}

          {displayTraits.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {displayTraits.map((trait, i) => (
                <span
                  key={i}
                  className="px-1.5 py-px bg-ink-850 text-fg-secondary text-hud border border-line"
                >
                  &lt;{trait}&gt;
                </span>
              ))}
            </div>
          )}

          {card.effectiveKeywords && card.effectiveKeywords.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {card.effectiveKeywords.map((kw, i) => (
                <span
                  key={i}
                  className="px-1.5 py-px bg-teal-400/15 text-teal-400 text-hud border border-teal-400/40 font-semibold"
                >
                  【{kw}】
                </span>
              ))}
            </div>
          )}

          {activeProhibitions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {activeProhibitions.map((label, i) => (
                <span
                  key={i}
                  className="px-1.5 py-px bg-crimson-500/15 text-crimson-400 text-hud border border-crimson-500/40 font-semibold"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 生效中的持续效果修改器 (8.9) */}
      {activeModifiers.length > 0 && (
        <div className="bg-ink-900/90 px-2 py-1.5 border border-teal-400/35 flex flex-wrap gap-1">
          {activeModifiers.map((tag, i) => (
            <span
              key={i}
              className="px-1.5 py-px bg-teal-400/10 text-teal-400 text-hud font-num border border-teal-400/30"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* 下部：效果规则文本 */}
      <div className="bg-ink-900 p-2.5 border border-line text-hud leading-relaxed text-fg-secondary max-h-40 overflow-y-auto">
        {formatRulesText(cardDef?.rulesText || '')}
      </div>

      {/* 底部：状态 */}
      <div className="flex items-center justify-between text-hud text-fg-muted pt-0.5 border-t border-line">
        <span className="truncate max-w-[180px]">{cardDef?.flavorText || '战双帕弥什 TCG'}</span>
        {card.isReady !== undefined && (
          <span className={`font-medium shrink-0 ${card.isReady ? 'text-success' : 'text-gold-300'}`}>
            {card.isReady ? '竖直 · READY' : '横置 · REST'}
          </span>
        )}
      </div>
    </div>
  );
};
