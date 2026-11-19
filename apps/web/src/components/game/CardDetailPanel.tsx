'use client';

import React from 'react';
import { ElementAttribute } from '@zhanshuang/shared';
import { CardData, findCardByNumberOrId, getCardVariants, CardVariant, formatCardType } from '@/lib/cards-data';
import { Shield, Flame, Zap, Moon, Snowflake, ZoomIn, Info, Star } from 'lucide-react';
import { getCardThumbnailUrl, getCardFullImageUrl, handleThumbnailError } from '@/lib/card-image';
import { HudBrackets } from '@/components/ui';

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
      badge: 'text-teal-400 border-teal-400/40 bg-teal-400/10',
    };
  }
  switch (attr) {
    case ElementAttribute.FIRE:
    case 'FIRE':
      return {
        label: '火',
        icon: <Flame className="w-3 h-3 text-crimson-400" />,
        badge: 'text-crimson-400 border-crimson-500/40 bg-crimson-500/10',
      };
    case ElementAttribute.LIGHTNING:
    case 'LIGHTNING':
      return {
        label: '雷',
        icon: <Zap className="w-3 h-3 text-gold-300" />,
        badge: 'text-gold-300 border-gold-300/40 bg-gold-300/10',
      };
    case ElementAttribute.DARK:
    case 'DARK':
      return {
        label: '暗',
        icon: <Moon className="w-3 h-3 text-steel-300" />,
        badge: 'text-steel-300 border-steel-500/50 bg-steel-700/20',
      };
    case ElementAttribute.ICE:
    case 'ICE':
      return {
        label: '冰',
        icon: <Snowflake className="w-3 h-3 text-teal-400" />,
        badge: 'text-teal-400 border-teal-400/40 bg-teal-400/10',
      };
    case ElementAttribute.PHYSICAL:
    case 'PHYSICAL':
      return {
        label: '物理',
        icon: <Shield className="w-3 h-3 text-fg-secondary" />,
        badge: 'text-fg-secondary border-line-strong bg-ink-800',
      };
    default:
      return {
        label: '无',
        icon: null,
        badge: 'text-fg-muted border-line bg-ink-900',
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
        className={`relative flex flex-col items-center justify-center p-4 border border-line bg-ink-900/80 text-center select-none ${className}`}
      >
        <HudBrackets size="sm" color="steel" />
        <div className="w-10 h-10 border border-dashed border-line-strong flex items-center justify-center text-fg-muted mb-2">
          <Info className="w-4 h-4 text-teal-400/60" />
        </div>
        <span className="text-caption text-fg-secondary font-semibold">未选中卡牌</span>
        <span className="text-hud text-fg-muted mt-1 max-w-[220px]">
          点击手牌或战场卡牌查看战术详情，长按卡牌可查看高清大图
        </span>
      </div>
    );
  }

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
      className={`relative flex flex-col gap-2.5 p-3 border border-line-strong bg-ink-900/95 backdrop-blur-md select-none ${className}`}
    >
      <HudBrackets size="sm" color="steel" />

      {/* 顶部简明信息栏 */}
      <div className="flex items-start justify-between gap-3 border-b border-line pb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            onClick={onOpenModal}
            className="w-11 h-16 rounded-card overflow-hidden border border-teal-400/60 shrink-0 bg-ink-950 relative cursor-pointer group"
            title="点击放大查看大图"
          >
            {cardImgSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={getCardThumbnailUrl(cardImgSrc, resolvedCard.cardNumber)}
                alt={resolvedCard.name}
                className="w-full h-full object-fill block group-hover:scale-105 transition-transform duration-fast"
                loading="lazy"
                onError={(e) => {
                  handleThumbnailError(e, cardImgSrc || `/cards/${resolvedCard.cardNumber}.png`);
                }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-hud font-display text-fg-muted">
                PGR
              </div>
            )}
            <div className="absolute inset-0 bg-ink-950/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity duration-fast">
              <ZoomIn className="w-3.5 h-3.5 text-teal-400" />
            </div>
          </div>

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="px-1.5 py-0.5 text-hud font-num font-semibold bg-teal-400/15 text-teal-400 border border-teal-400/40">
                {resolvedCard.cardNumber}
              </span>
              <span className="px-1.5 py-0.5 text-hud font-sans font-medium bg-ink-850 border border-line text-fg-secondary">
                {formatCardType(resolvedCard.cardType, resolvedCard.isInstant)}
              </span>
              <span className={`px-1.5 py-0.5 text-hud font-sans font-medium border flex items-center gap-0.5 ${elem.badge}`}>
                {elem.icon}
                {elem.label}
              </span>
              <span className="px-1.5 py-0.5 text-hud font-num font-semibold bg-ink-850 border border-line text-gold-300">
                {resolvedCard.cost ?? 0}费
              </span>
            </div>
            <h4 className="text-body-sm font-semibold text-fg truncate mt-1">
              {resolvedCard.name}
            </h4>
          </div>
        </div>

        {onOpenModal && (
          <button
            type="button"
            onClick={onOpenModal}
            aria-label="放大查看卡图"
            className="p-1.5 border border-line text-fg-muted hover:text-teal-400 hover:border-teal-400/60 transition-colors cursor-pointer"
            title="长按或点击查看大图"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 卡图版本切换器 */}
      {variants.length > 1 && (
        <div className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 bg-ink-950 border border-line text-caption">
          <span className="text-hud text-fg-secondary font-medium flex items-center gap-1">
            <Star className="w-3 h-3 text-gold-300" />
            <span>卡图版本</span>
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
                  className={`px-2 py-0.5 text-hud font-num font-semibold transition-colors cursor-pointer border ${
                    isActive
                      ? 'bg-gold-300 text-ink-950 border-gold-300'
                      : 'bg-ink-850 border-line text-fg-muted hover:text-fg hover:border-line-strong'
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
        <div className="grid grid-cols-2 gap-2 text-caption">
          <div className="px-2.5 py-1 bg-ink-950 border border-line flex justify-between items-center">
            <span className="text-fg-muted text-hud">PP 力量</span>
            <span className="text-fg font-num tabular-nums font-bold">{resolvedCard.basePP ?? '--'}</span>
          </div>
          <div className="px-2.5 py-1 bg-ink-950 border border-line flex justify-between items-center">
            <span className="text-fg-muted text-hud">DP 破坏</span>
            <span className="text-gold-300 font-num tabular-nums font-bold">{resolvedCard.baseDP ?? '--'}</span>
          </div>
        </div>
      )}

      {/* 卡牌特征标签 */}
      {resolvedCard.traits && resolvedCard.traits.length > 0 && (
        <div className="flex flex-wrap gap-1 text-hud">
          {resolvedCard.traits.map((t: string, i: number) => (
            <span
              key={i}
              className="px-1.5 py-0.5 bg-ink-850 border border-line text-fg-secondary"
            >
              &lt;{t}&gt;
            </span>
          ))}
        </div>
      )}

      {/* 卡牌规则效果 */}
      <div className="max-h-28 overflow-y-auto p-2.5 bg-ink-950 border border-line text-caption leading-relaxed text-fg-secondary whitespace-pre-wrap">
        {resolvedCard.rulesText || '此卡牌无特殊规则文本。'}
      </div>

      {/* 快捷操作区 */}
      <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-line">
        <button
          type="button"
          onClick={onOpenModal}
          className="text-hud text-teal-400 hover:underline flex items-center gap-1 font-medium cursor-pointer"
        >
          <ZoomIn className="w-3 h-3" /> 放大立绘与详情 (长按)
        </button>
        {customAction}
      </div>
    </div>
  );
};
