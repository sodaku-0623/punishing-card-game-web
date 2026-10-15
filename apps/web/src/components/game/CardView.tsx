'use client';

import React, { useState } from 'react';
import { CardInstance, ElementAttribute } from '@zhanshuang/shared';
import { useLongPress } from '@/hooks/useLongPress';
import { Flame, Zap, Moon, Snowflake, Shield, Sparkles } from 'lucide-react';
import { findCardByNumberOrId } from '@/lib/cards-data';
import { sfx } from '@/lib/audio';
import { getCardThumbnailUrl } from '@/lib/card-image';

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
      return <span title="火属性"><Flame className="w-3.5 h-3.5 text-red-500" /></span>;
    case ElementAttribute.LIGHTNING:
      return <span title="雷属性"><Zap className="w-3.5 h-3.5 text-yellow-400" /></span>;
    case ElementAttribute.DARK:
      return <span title="暗属性"><Moon className="w-3.5 h-3.5 text-purple-400" /></span>;
    case ElementAttribute.ICE:
      return <span title="冰属性"><Snowflake className="w-3.5 h-3.5 text-cyan-300" /></span>;
    case ElementAttribute.PHYSICAL:
      return <span title="物理属性"><Shield className="w-3.5 h-3.5 text-neutral-300" /></span>;
    case ElementAttribute.VOID:
      return <span title="空属性"><Sparkles className="w-3.5 h-3.5 text-cyan-300" /></span>;
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

  const isCardRested = isRested ?? (card?.isReady === false);

  const longPressHandlers = useLongPress({
    onLongPress: () => {
      if (onLongPress) onLongPress();
    },
    onClick: onClick,
  });

  // 尺寸预设
  const sizeClasses = {
    sm: 'w-20 h-28 text-[10px]',
    md: 'w-26 sm:w-28 h-36 sm:h-40 text-xs',
    lg: 'w-36 h-52 text-sm',
    full: 'w-full h-full text-xs',
  }[size];

  // 背面卡牌 (对手手牌、暗费、牌组)
  if (isFaceDown || !card || !card.isFaceUp) {
    return (
      <div
        onClick={onClick}
        onContextMenu={onContextMenu}
        style={{
          ...(isCardRested
            ? {
                transform: 'rotate(90deg) scale(0.72)',
                transformOrigin: 'center center',
              }
            : {}),
        }}
        className={`${sizeClasses} rounded-lg border border-terminalBorder bg-neutral-900 flex flex-col items-center justify-center relative overflow-hidden shadow-md cursor-pointer transition-all duration-300 ease-out card-interactive ${
          isCardRested ? 'card-rested' : ''
        }`}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-neutral-800 to-neutral-950 opacity-90" />
        <div className="w-10 h-10 rounded-full border border-terminalCyan/30 flex items-center justify-center text-terminalCyan/40 font-mono text-[9px] z-10">
          PGR
        </div>
      </div>
    );
  }

  const fullImgSrc = card.imageUrl || `/cards/${card.cardNumber}.png`;
  const cardImgSrc = getCardThumbnailUrl(card.imageUrl, card.cardNumber);

  const handleDragStart = (e: React.DragEvent) => {
    if (!isDraggable) return;
    e.dataTransfer.setData('text/card-instance-id', card.instanceId);
    e.dataTransfer.effectAllowed = 'move';
    sfx.playClick();
  };

  // 1. 如果有官方卡图，优先渲染轻量缩略图并叠加状态徽章
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
        style={{
          ...(isCardRested
            ? {
                transform: 'rotate(90deg) scale(0.72)',
                transformOrigin: 'center center',
              }
            : {}),
        }}
        className={`${sizeClasses} rounded-lg border select-none relative overflow-hidden flex flex-col justify-between cursor-pointer shadow-lg group card-interactive transition-all duration-200 ease-out ${
          isCardRested ? 'card-rested' : ''
        } ${
          isSelected
            ? 'border-cyan-400 ring-2 ring-cyan-400 ring-offset-2 ring-offset-neutral-950 shadow-[0_0_18px_rgba(0,240,255,0.75)]'
            : isTargetable
            ? 'border-erosionRed/80 terminal-glow-red animate-pulse'
            : isLegalPlay
            ? 'border-terminalCyan/70 shadow-[0_0_12px_rgba(0,240,255,0.35)] hover:-translate-y-1'
            : 'border-terminalBorder/80 hover:border-terminalCyan/60'
        }`}
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
          className="absolute inset-0 w-full h-full object-cover rounded-lg pointer-events-none"
          loading="lazy"
        />

        {/* 横置状态文字标记: 反向旋转-90度以确保在卡面横置时文字依然绝对水平正向展示 */}
        {isCardRested && (
          <div
            className="absolute top-1 left-1 z-30 px-1 py-0.5 rounded bg-black/90 text-terminalGold text-[9px] font-mono font-bold border border-terminalGold/70 shadow tracking-wider select-none pointer-events-none"
            style={{
              transform: 'rotate(-90deg)',
              transformOrigin: 'center center',
            }}
          >
            横置
          </div>
        )}

        {/* 叠层标记 (升变堆叠) */}
        {card.underneathCardIds.length > 0 && (
          <div className="absolute top-1 right-1 z-20 px-1.5 py-0.5 rounded bg-black/85 text-terminalCyan text-[9px] font-mono flex items-center gap-0.5 border border-terminalCyan/40 backdrop-blur-sm">
            <Sparkles className="w-2.5 h-2.5" /> {card.underneathCardIds.length}
          </div>
        )}

        {/* 选中高亮罩层 */}
        {isSelected && (
          <div className="absolute inset-0 bg-terminalCyan/15 pointer-events-none z-10" />
        )}
      </div>
    );
  }

  // 2. 备用示意图 HUD 渲染
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
      style={{
        ...(isCardRested
          ? {
              transform: 'rotate(90deg) scale(0.72)',
              transformOrigin: 'center center',
            }
          : {}),
      }}
      className={`${sizeClasses} rounded-lg border select-none relative overflow-hidden flex flex-col justify-between p-2 cursor-pointer shadow-lg card-interactive transition-all duration-300 ease-out ${
        isCardRested ? 'card-rested' : ''
      } ${
        isSelected
          ? 'border-terminalCyan terminal-glow-cyan -translate-y-2 ring-2 ring-terminalCyan'
          : isTargetable
          ? 'border-erosionRed/80 terminal-glow-red animate-pulse'
          : isLegalPlay
          ? 'border-terminalCyan/70 shadow-[0_0_12px_rgba(0,240,255,0.35)] hover:-translate-y-1.5'
          : 'border-terminalBorder/80 hover:border-terminalCyan/60 hover:-translate-y-1'
      }`}
    >
      <div className="flex justify-between items-center z-10">
        <span className="font-mono text-[10px] text-neutral-400 truncate max-w-[70px]">
          {card.cardNumber}
        </span>
        {cardDef?.attribute && getElementIcon(cardDef.attribute)}
      </div>

      <div className="text-center font-bold text-white text-xs truncate z-10">
        {cardDef?.name || card.cardNumber}
      </div>

      <div className="flex justify-between items-center text-[10px] text-neutral-400 font-mono z-10">
        <span>费:{cardDef?.cost ?? 0}</span>
        {cardDef?.basePP !== undefined && (
          <span className="text-terminalCyan font-bold">PP:{cardDef.basePP}</span>
        )}
      </div>
    </div>
  );
});

CardView.displayName = 'CardView';
