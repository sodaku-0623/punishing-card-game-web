'use client';

import React, { useState } from 'react';
import { CardInstance, ElementAttribute } from '@zhanshuang/shared';
import { useLongPress } from '@/hooks/useLongPress';
import { Flame, Zap, Moon, Snowflake, Shield, Sparkles } from 'lucide-react';
import { findCardByNumberOrId } from '@/lib/cards-data';
import { sfx } from '@/lib/audio';
import { getCardThumbnailUrl, getCardFullImageUrl } from '@/lib/card-image';
import { HudBrackets } from '@/components/ui';

interface CardViewProps {
  card?: CardInstance;
  isFaceDown?: boolean;
  isSelected?: boolean;
  isTargetable?: boolean;
  isLegalPlay?: boolean;
  isDraggable?: boolean;
  isRested?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onLongPress?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  size?: 'sm' | 'md' | 'lg' | 'full';
}

function getElementIcon(attr: ElementAttribute) {
  switch (attr) {
    case ElementAttribute.FIRE:
      return <span title="火属性"><Flame className="w-3.5 h-3.5 text-orb-red" /></span>;
    case ElementAttribute.LIGHTNING:
      return <span title="雷属性"><Zap className="w-3.5 h-3.5 text-orb-yellow" /></span>;
    case ElementAttribute.DARK:
      return <span title="暗属性"><Moon className="w-3.5 h-3.5 text-crimson-400" /></span>;
    case ElementAttribute.ICE:
      return <span title="冰属性"><Snowflake className="w-3.5 h-3.5 text-teal-400" /></span>;
    case ElementAttribute.PHYSICAL:
      return <span title="物理属性"><Shield className="w-3.5 h-3.5 text-gold-300" /></span>;
    case ElementAttribute.VOID:
      return <span title="空属性"><Sparkles className="w-3.5 h-3.5 text-steel-300" /></span>;
    default:
      return null;
  }
}

export const CardView: React.FC<CardViewProps> = React.memo(({
  card,
  isFaceDown = false,
  isSelected = false,
  isTargetable = false,
  isLegalPlay = false,
  isDraggable = false,
  isRested,
  onClick,
  onDoubleClick,
  onContextMenu,
  onLongPress,
  onMouseEnter,
  onMouseLeave,
  size = 'md',
}) => {
  const [imageError, setImageError] = useState(false);

  const isCardRested = isRested ?? card?.isReady === false;

  const longPressHandlers = useLongPress({
    onLongPress: () => {
      if (onLongPress) onLongPress();
    },
    onClick,
  });

  const sizeClasses = {
    sm: 'w-20 h-28 text-hud',
    md: 'w-26 sm:w-28 h-36 sm:h-40 text-caption',
    lg: 'w-36 h-52 text-body-sm',
    full: 'w-full h-full text-caption',
  }[size];

  // 卡背渲染 (对手手牌、暗费、牌库)
  if (isFaceDown || !card || !card.isFaceUp) {
    return (
      <div
        onClick={onClick}
        onContextMenu={onContextMenu}
        style={
          isCardRested
            ? { transform: 'rotate(90deg) scale(0.74)', transformOrigin: 'center center' }
            : undefined
        }
        className={`${sizeClasses} rounded-card border border-line bg-ink-900 flex flex-col items-center justify-center relative overflow-hidden cursor-pointer card-interactive ${
          isCardRested ? 'card-rested' : ''
        }`}
      >
        <div className="absolute inset-1 border border-crimson-500/25 pointer-events-none" />
        <div className="h-7 w-7 border border-crimson-500/40 bg-ink-950 flex items-center justify-center font-display text-hud text-crimson-400 z-10">
          PR
        </div>
      </div>
    );
  }

  const fullImgSrc = getCardFullImageUrl(card.imageUrl, card.cardNumber);
  const cardImgSrc = getCardThumbnailUrl(card.imageUrl, card.cardNumber);

  const handleDragStart = (e: React.DragEvent) => {
    if (!isDraggable) return;
    e.dataTransfer.setData('text/card-instance-id', card.instanceId);
    e.dataTransfer.effectAllowed = 'move';
    sfx.playClick();
  };

  // 状态样式严格遵循 design-spec 第 6 节
  const stateClasses = isSelected
    ? 'border-fg'
    : isTargetable
      ? 'border-crimson-500 shadow-glow-crimson'
      : isLegalPlay
        ? 'border-line-strong hover:-translate-y-1 hover:border-teal-400'
        : 'border-line hover:border-line-strong';

  if (!imageError) {
    return (
      <div
        draggable={isDraggable}
        onDragStart={handleDragStart}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onMouseEnter={() => {
          sfx.playHover();
          onMouseEnter?.();
        }}
        onMouseLeave={onMouseLeave}
        {...(onLongPress ? longPressHandlers : { onClick })}
        style={
          isCardRested
            ? { transform: 'rotate(90deg) scale(0.74)', transformOrigin: 'center center' }
            : undefined
        }
        className={`${sizeClasses} rounded-card border select-none relative overflow-hidden flex flex-col justify-between cursor-pointer group card-interactive bg-ink-950 ${
          isCardRested ? 'card-rested' : ''
        } ${stateClasses}`}
      >
        <img
          src={cardImgSrc}
          alt={card.cardNumber}
          onError={(e) => {
            const img = e.currentTarget;
            if (!img.dataset.fallbackTried) {
              img.dataset.fallbackTried = 'true';
              img.src = fullImgSrc;
            } else {
              setImageError(true);
            }
          }}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          loading="lazy"
        />

        {/* 可操作：底部 2px teal-400 指示条 (design-spec 6) */}
        {isLegalPlay && !isTargetable && (
          <span aria-hidden="true" className="absolute bottom-0 inset-x-0 h-0.5 bg-teal-400 z-20" />
        )}

        {/* 选中：白色四角 HudBrackets (design-spec 6) */}
        {isSelected && <HudBrackets color="white" size="sm" className="z-30" />}

        {/* 攻击目标：绯红四角锁定框 */}
        {isTargetable && <HudBrackets color="crimson" size="sm" className="z-30" />}

        {/* 横置状态标记 */}
        {isCardRested && (
          <div
            className="absolute top-1 left-1 z-30 px-1 py-0.5 bg-ink-950/95 text-gold-300 text-hud font-num font-bold border border-gold-300/60 select-none pointer-events-none"
            style={{ transform: 'rotate(-90deg)', transformOrigin: 'center center' }}
          >
            横置
          </div>
        )}

        {/* 升变叠层计数 */}
        {card.underneathCardIds.length > 0 && (
          <div className="absolute top-1 right-1 z-20 px-1.5 py-0.5 bg-ink-950/90 text-teal-400 text-hud font-num inline-flex items-center gap-0.5 border border-line-strong">
            <Sparkles className="w-2.5 h-2.5" />
            <span>{card.underneathCardIds.length}</span>
          </div>
        )}
      </div>
    );
  }

  // 无卡图回退方案
  const cardDef = findCardByNumberOrId(card.cardNumber || card.cardId);

  return (
    <div
      draggable={isDraggable}
      onDragStart={handleDragStart}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => {
        sfx.playHover();
        onMouseEnter?.();
      }}
      onMouseLeave={onMouseLeave}
      {...(onLongPress ? longPressHandlers : { onClick })}
      style={
        isCardRested
          ? { transform: 'rotate(90deg) scale(0.74)', transformOrigin: 'center center' }
          : undefined
      }
      className={`${sizeClasses} rounded-card border select-none relative overflow-hidden flex flex-col justify-between p-2 cursor-pointer card-interactive bg-ink-900 ${
        isCardRested ? 'card-rested' : ''
      } ${stateClasses}`}
    >
      {isSelected && <HudBrackets color="white" size="sm" className="z-30" />}
      {isLegalPlay && !isTargetable && (
        <span aria-hidden="true" className="absolute bottom-0 inset-x-0 h-0.5 bg-teal-400 z-20" />
      )}

      <div className="flex justify-between items-center z-10">
        <span className="font-num text-hud text-fg-muted truncate max-w-[70px]">
          {card.cardNumber}
        </span>
        {cardDef?.attribute && getElementIcon(cardDef.attribute)}
      </div>

      <div className="text-center font-semibold text-fg text-caption truncate z-10">
        {cardDef?.name || card.cardNumber}
      </div>

      <div className="flex justify-between items-center text-hud font-num z-10">
        <span className="text-gold-300">{cardDef?.cost ?? 0}费</span>
        {cardDef?.basePP !== undefined && (
          <span className="text-fg font-bold">{card.effectivePP ?? cardDef.basePP}</span>
        )}
      </div>
    </div>
  );
});

CardView.displayName = 'CardView';
