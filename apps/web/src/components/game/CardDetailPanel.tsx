'use client';

import React from 'react';
import { CardType, ElementAttribute, SignalOrbType } from '@zhanshuang/shared';
import { CardData, findCardByNumberOrId, getCardVariants, CardVariant, formatCardType } from '@/lib/cards-data';
import { Sparkles, Shield, Flame, Zap, Moon, Snowflake, ZoomIn, Info, Layers, Star } from 'lucide-react';
import { getCardThumbnailUrl, getCardFullImageUrl, handleThumbnailError } from '@/lib/card-image';

interface CardDetailPanelProps {
  card: CardData | any | null;
  onOpenModal?: () => void;
  className?: string;
  customAction?: React.ReactNode;
  selectedImageUrl?: string;
  onSelectVariant?: (variant: CardVariant) => void;
}

function getElementBadge(attr: ElementAttribute | string, attrName?: string) {
  if (attrName === '空' || attr === ElementAttribute.VOID || attr === 'VOID') {
    return {
      label: '空',
      icon: null,
      badge: 'text-cyan-300 border-cyan-400/40 bg-cyan-950/40',
    };
  }
  switch (attr) {
    case ElementAttribute.FIRE:
    case 'FIRE':
      return {
        label: '火',
        icon: <Flame className="w-3 h-3 text-red-500" />,
        badge: 'text-red-400 border-red-500/40 bg-red-950/40',
      };
    case ElementAttribute.LIGHTNING:
    case 'LIGHTNING':
      return {
        label: '雷',
        icon: <Zap className="w-3 h-3 text-yellow-400" />,
        badge: 'text-yellow-400 border-yellow-500/40 bg-yellow-950/40',
      };
    case ElementAttribute.DARK:
    case 'DARK':
      return {
        label: '暗',
        icon: <Moon className="w-3 h-3 text-purple-400" />,
        badge: 'text-purple-400 border-purple-500/40 bg-purple-950/40',
      };
    case ElementAttribute.ICE:
    case 'ICE':
      return {
        label: '冰',
        icon: <Snowflake className="w-3 h-3 text-cyan-300" />,
        badge: 'text-cyan-300 border-cyan-500/40 bg-cyan-950/40',
      };
    case ElementAttribute.PHYSICAL:
    case 'PHYSICAL':
      return {
        label: '物理',
        icon: <Shield className="w-3 h-3 text-amber-300" />,
        badge: 'text-amber-300 border-amber-500/40 bg-amber-950/40',
      };
    default:
      return {
        label: '无',
        icon: null,
        badge: 'text-neutral-400 border-neutral-700 bg-neutral-900',
      };
  }
}

export const CardDetailPanel: React.FC<CardDetailPanelProps> = ({
  card,
  onOpenModal,
  className = '',
  customAction,
  selectedImageUrl,
  onSelectVariant,
}) => {
  const [internalVariantImg, setInternalVariantImg] = React.useState<string | null>(null);

  React.useEffect(() => {
    setInternalVariantImg(null);
  }, [card?.cardNumber, card?.id]);

  if (!card) {
    return (
      <div
        className={`flex flex-col items-center justify-center p-4 rounded-xl border border-terminalBorder/60 bg-neutral-950/60 text-center font-mono select-none ${className}`}
      >
        <div className="w-10 h-10 rounded-full border border-dashed border-terminalBorder flex items-center justify-center text-neutral-600 mb-2">
          <Info className="w-5 h-5 text-terminalCyan/40" />
        </div>
        <span className="text-xs text-neutral-400 font-bold">未选中卡牌</span>
        <span className="text-[11px] text-neutral-600 mt-1 max-w-[220px]">
          点击手牌或战场卡牌查看战术详情，长按卡牌可查看超清大图
        </span>
      </div>
    );
  }

  // 尝试匹配完整静态卡牌信息
  const resolvedCard: CardData =
    card.cost !== undefined && card.rulesText !== undefined
      ? card
      : findCardByNumberOrId(card.cardNumber || card.cardId) || card;

  const elem = getElementBadge(resolvedCard.attribute, resolvedCard.attributeName);
  const variants = resolvedCard?.cardNumber ? getCardVariants(resolvedCard.cardNumber) : [];
  const cardImgSrc = getCardFullImageUrl(
    internalVariantImg ||
    selectedImageUrl ||
    card.imageUrl ||
    resolvedCard.imageUrl,
    resolvedCard.cardNumber
  );

  return (
    <div
      className={`flex flex-col gap-2.5 p-3 rounded-xl border border-terminalBorder bg-neutral-950/80 backdrop-blur-md font-mono select-none shadow-lg ${className}`}
    >
      {/* 顶部简明信息栏 */}
      <div className="flex items-start justify-between gap-3 border-b border-terminalBorder/60 pb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          {/* 微型卡图略缩图 (点击可放大) */}
          <div
            onClick={onOpenModal}
            className="w-11 h-16 rounded-lg overflow-hidden border border-terminalCyan/60 shrink-0 bg-neutral-900 relative cursor-pointer group shadow"
            title="点击放大查看大图"
          >
            {cardImgSrc ? (
              <img
                src={getCardThumbnailUrl(cardImgSrc, resolvedCard.cardNumber)}
                alt={resolvedCard.name}
                className="w-full h-full object-fill block group-hover:scale-110 transition-transform"
                loading="lazy"
                onError={(e) => {
                  handleThumbnailError(e, cardImgSrc || `/cards/${resolvedCard.cardNumber}.png`);
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[9px] text-neutral-400">
                PGR
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
              <ZoomIn className="w-3.5 h-3.5 text-terminalCyan" />
            </div>
          </div>

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-terminalCyan/20 text-terminalCyan border border-terminalCyan/40">
                {resolvedCard.cardNumber}
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-neutral-900 border border-neutral-700 text-neutral-300">
                {formatCardType(resolvedCard.cardType, resolvedCard.isInstant)}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border flex items-center gap-0.5 ${elem.badge}`}>
                {elem.icon}
                {elem.label}
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-neutral-900 border border-neutral-700 text-terminalCyan">
                {resolvedCard.cost ?? 0}费
              </span>
            </div>
            <h4 className="text-sm font-bold text-white truncate mt-1">
              {resolvedCard.name}
            </h4>
          </div>
        </div>

        {onOpenModal && (
          <button
            onClick={onOpenModal}
            className="p-1.5 rounded-lg border border-neutral-700 text-neutral-400 hover:text-terminalCyan hover:border-terminalCyan/60 transition-colors"
            title="长按或点击查看大图"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 卡图版本切换器 (0星 / 1星 / 2星) */}
      {variants.length > 1 && (
        <div className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/60 border border-terminalBorder/60 text-xs">
          <span className="text-[11px] text-neutral-400 font-bold flex items-center gap-1">
            <Star className="w-3 h-3 text-terminalGold" />
            <span>卡图版本:</span>
          </span>
          <div className="flex items-center gap-1">
            {variants.map((v) => {
              const isActive = (internalVariantImg || selectedImageUrl || cardImgSrc) === v.imageUrl;
              return (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => {
                    setInternalVariantImg(v.imageUrl);
                    if (onSelectVariant) onSelectVariant(v);
                  }}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-terminalGold text-neutral-950 font-black shadow-[0_0_10px_rgba(255,200,0,0.5)] scale-105'
                      : 'bg-neutral-900 border border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500'
                  }`}
                  title={`${v.name} (${v.imageUrl})`}
                >
                  {v.shortLabel}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 数值指标 (PP / DP) */}
      {(resolvedCard.basePP !== undefined || resolvedCard.baseDP !== undefined) && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="px-2 py-1 rounded bg-neutral-900 border border-neutral-800 flex justify-between items-center">
            <span className="text-neutral-500 font-bold text-[10px]">PP力量</span>
            <span className="text-white font-bold">{resolvedCard.basePP ?? '--'}</span>
          </div>
          <div className="px-2 py-1 rounded bg-neutral-900 border border-neutral-800 flex justify-between items-center">
            <span className="text-neutral-500 font-bold text-[10px]">DP破坏</span>
            <span className="text-terminalGold font-bold">{resolvedCard.baseDP ?? '--'}</span>
          </div>
        </div>
      )}

      {/* 卡牌特征标签 */}
      {resolvedCard.traits && resolvedCard.traits.length > 0 && (
        <div className="flex flex-wrap gap-1 text-[10px]">
          {resolvedCard.traits.map((t: string, i: number) => (
            <span
              key={i}
              className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-neutral-400"
            >
              &lt;{t}&gt;
            </span>
          ))}
        </div>
      )}

      {/* 卡牌规则效果 */}
      <div className="max-h-28 overflow-y-auto p-2 rounded-lg bg-neutral-950 border border-terminalBorder/60 text-[11px] leading-relaxed text-neutral-300 font-sans whitespace-pre-wrap">
        {resolvedCard.rulesText || '此卡牌无特殊规则文本。'}
      </div>

      {/* 快捷操作区 (例如投入卡组、放大检视) */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-terminalBorder/40">
        <button
          onClick={onOpenModal}
          className="text-[11px] text-terminalCyan hover:underline flex items-center gap-1 font-bold"
        >
          <ZoomIn className="w-3 h-3" /> 放大立绘与详情 (长按)
        </button>
        {customAction}
      </div>
    </div>
  );
};
