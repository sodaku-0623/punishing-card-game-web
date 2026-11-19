'use client';

import React, { useEffect, useState } from 'react';
import { CardType, ElementAttribute } from '@zhanshuang/shared';
import { CardData, findCardByNumberOrId, getCardVariants, getCardSeries, CardVariant } from '@/lib/cards-data';
import { getCardFullImageUrl } from '@/lib/card-image';
import { X, Sparkles, Shield, Flame, Zap, Moon, Snowflake, Star } from 'lucide-react';
import { Button, HudBrackets } from '@/components/ui';

interface CardDetailModalProps {
  card: CardData | any | null;
  isOpen: boolean;
  onClose: () => void;
  actionButton?: React.ReactNode;
  selectedImageUrl?: string;
  onSelectVariant?: (variant: CardVariant) => void;
}

function getElementInfo(attr: ElementAttribute | string, attrName?: string) {
  if (attrName === '空' || attr === ElementAttribute.VOID || attr === 'VOID') {
    return {
      label: '空属性',
      icon: <Sparkles className="w-3.5 h-3.5 text-teal-400" />,
      badge: 'text-teal-400 border-teal-400/40 bg-teal-400/10',
    };
  }
  switch (attr) {
    case ElementAttribute.FIRE:
    case 'FIRE':
      return {
        label: '火属性',
        icon: <Flame className="w-3.5 h-3.5 text-crimson-400" />,
        badge: 'text-crimson-400 border-crimson-500/40 bg-crimson-500/10',
      };
    case ElementAttribute.LIGHTNING:
    case 'LIGHTNING':
      return {
        label: '雷属性',
        icon: <Zap className="w-3.5 h-3.5 text-gold-300" />,
        badge: 'text-gold-300 border-gold-300/40 bg-gold-300/10',
      };
    case ElementAttribute.DARK:
    case 'DARK':
      return {
        label: '暗属性',
        icon: <Moon className="w-3.5 h-3.5 text-steel-300" />,
        badge: 'text-steel-300 border-steel-500/50 bg-steel-700/20',
      };
    case ElementAttribute.ICE:
    case 'ICE':
      return {
        label: '冰属性',
        icon: <Snowflake className="w-3.5 h-3.5 text-teal-400" />,
        badge: 'text-teal-400 border-teal-400/40 bg-teal-400/10',
      };
    case ElementAttribute.PHYSICAL:
    case 'PHYSICAL':
      return {
        label: '物理属性',
        icon: <Shield className="w-3.5 h-3.5 text-fg-secondary" />,
        badge: 'text-fg-secondary border-line-strong bg-ink-800',
      };
    default:
      return {
        label: '无属性',
        icon: null,
        badge: 'text-fg-muted border-line bg-ink-850',
      };
  }
}

function getCardTypeLabel(type: CardType | string, isInstant?: boolean) {
  switch (type) {
    case CardType.ROLE:
    case 'ROLE':
      return '角色牌';
    case CardType.TACTICS:
    case 'TACTICS':
      return isInstant ? '瞬时战术牌' : '战术牌';
    case CardType.EQUIPMENT:
    case 'EQUIPMENT':
      return '装备牌';
    case CardType.ASSIST:
    case 'ASSIST':
      return '辅助机牌';
    default:
      return type || '卡牌';
  }
}

export const CardDetailModal: React.FC<CardDetailModalProps> = ({
  card,
  isOpen,
  onClose,
  actionButton,
  selectedImageUrl,
  onSelectVariant,
}) => {
  const [activeVariantImg, setActiveVariantImg] = useState<string | null>(null);

  useEffect(() => {
    setActiveVariantImg(null);
  }, [card?.cardNumber, card?.id, isOpen]);

  // ESC 键关闭
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !card) return null;

  const resolvedCard: CardData =
    card.cost !== undefined && card.rulesText !== undefined
      ? card
      : findCardByNumberOrId(card.cardNumber || card.cardId) || card;

  const elementInfo = getElementInfo(resolvedCard.attribute, resolvedCard.attributeName);
  const variants = resolvedCard?.cardNumber ? getCardVariants(resolvedCard.cardNumber) : [];
  const cardImgSrc = getCardFullImageUrl(
    activeVariantImg ||
    selectedImageUrl ||
    card.imageUrl ||
    resolvedCard.imageUrl,
    resolvedCard.cardNumber
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${resolvedCard.name} 卡牌详情`}
      className="fixed inset-0 z-50 bg-ink-950/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 select-none animate-in fade-in duration-fast"
      onClick={onClose}
    >
      <div
        className="relative max-w-4xl w-full max-h-[90vh] bg-ink-900 border border-line-strong clip-corner-md shadow-overlay flex flex-col md:flex-row overflow-hidden animate-in zoom-in-95 duration-fast"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute inset-x-0 top-0 h-[2px] bg-crimson-500 z-20" />

        {/* 关闭按钮 */}
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭卡牌详情"
          className="absolute top-4 right-4 z-20 p-2 bg-ink-950/90 border border-line text-fg-muted hover:text-fg hover:border-teal-400 transition-colors cursor-pointer"
          title="关闭 (Esc)"
        >
          <X className="w-4 h-4" />
        </button>

        {/* 左侧：高清卡图展示区 (63:88 实体卡比例) */}
        <div className="w-full md:w-[380px] shrink-0 p-6 flex flex-col items-center justify-center bg-ink-950/80 border-b md:border-b-0 md:border-r border-line">
          <div className="relative aspect-[63/88] w-full max-w-[300px] rounded-card overflow-hidden border border-line-strong bg-ink-950">
            <HudBrackets size="sm" color="teal" />
            {cardImgSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cardImgSrc}
                alt={resolvedCard.name}
                className="w-full h-full object-fill block"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = `/cards/${resolvedCard.cardNumber}.png`;
                }}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-teal-400 font-num">
                <span className="text-title-sm font-bold">{resolvedCard.cardNumber}</span>
                <span className="text-body-sm mt-2 font-sans">{resolvedCard.name}</span>
              </div>
            )}

            {/* 升变叠层标记 */}
            {card.underneathCardIds && card.underneathCardIds.length > 0 && (
              <div className="absolute top-3 right-3 px-2 py-1 bg-ink-950/90 text-teal-400 text-caption font-num font-bold flex items-center gap-1 border border-teal-400/60">
                <Sparkles className="w-3.5 h-3.5" /> 叠层: {card.underneathCardIds.length} 张
              </div>
            )}
          </div>

          {/* 异画卡图版本切换器 */}
          {variants.length > 1 && (
            <div className="w-full max-w-[300px] mt-3.5 p-2.5 bg-ink-900 border border-line flex flex-col gap-2">
              <div className="text-hud text-fg-secondary font-medium flex items-center justify-between">
                <span className="flex items-center gap-1 text-fg">
                  <Star className="w-3.5 h-3.5 text-gold-300 fill-current" />
                  <span>卡图版本</span>
                </span>
                <span className="font-num text-fg-muted">共 {variants.length} 款</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 w-full">
                {variants.map((v) => {
                  const isCurrent = cardImgSrc === v.imageUrl;
                  return (
                    <button
                      key={v.key}
                      type="button"
                      onClick={() => {
                        setActiveVariantImg(v.imageUrl);
                        if (onSelectVariant) onSelectVariant(v);
                      }}
                      className={`py-1.5 px-2 text-hud font-num font-semibold border transition-colors cursor-pointer flex flex-col items-center justify-center ${
                        isCurrent
                          ? 'bg-gold-300 text-ink-950 border-gold-300'
                          : 'bg-ink-950 border-line text-fg-secondary hover:border-teal-400/60 hover:text-fg'
                      }`}
                      title={v.name}
                    >
                      <span>{v.shortLabel}</span>
                      <span className="font-sans opacity-80 truncate max-w-full">{v.name.split(' ')[0]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <span className="mt-2.5 text-hud font-num text-fg-muted">
            63 × 88 mm · 高清立绘检视
          </span>
        </div>

        {/* 右侧：卡牌完整规则数据面板 */}
        <div className="flex-1 p-6 md:p-8 flex flex-col justify-between overflow-y-auto">
          <div className="flex flex-col gap-4">
            {/* 头部标签 */}
            <div className="flex flex-wrap items-center gap-2 pr-8">
              <span className="px-2.5 py-0.5 text-caption font-num font-semibold bg-teal-400/15 text-teal-400 border border-teal-400/40">
                {resolvedCard.cardNumber}
              </span>
              <span className="px-2.5 py-0.5 text-caption font-sans border bg-ink-850 border-line text-fg-secondary">
                {getCardTypeLabel(resolvedCard.cardType, resolvedCard.isInstant)}
              </span>
              <span className={`px-2.5 py-0.5 text-caption font-sans border flex items-center gap-1 ${elementInfo.badge}`}>
                {elementInfo.icon}
                {elementInfo.label}
              </span>
              {(resolvedCard.packageName || resolvedCard.series || (resolvedCard.cardNumber ? getCardSeries(resolvedCard.cardNumber) : '')) && (
                <span className="px-2.5 py-0.5 text-caption font-num border border-line bg-ink-850 text-steel-300">
                  {resolvedCard.packageName || resolvedCard.series || getCardSeries(resolvedCard.cardNumber)}
                </span>
              )}
              {resolvedCard.isInstant && (
                <span className="px-2.5 py-0.5 text-caption font-sans font-semibold border border-gold-300/50 bg-gold-300/10 text-gold-300">
                  【瞬时】
                </span>
              )}
            </div>

            {/* 卡牌名称 */}
            <div>
              <h2 className="text-title font-bold text-fg tracking-tight">
                {resolvedCard.name}
              </h2>
              {resolvedCard.traits && resolvedCard.traits.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {resolvedCard.traits.map((trait: string, idx: number) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 text-caption bg-ink-850 border border-line text-fg-secondary"
                    >
                      &lt;{trait}&gt;
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 战术数值矩阵 */}
            <div className="grid grid-cols-3 gap-3 p-3.5 bg-ink-950 border border-line">
              <div className="flex flex-col items-center">
                <span className="text-hud text-fg-muted font-display uppercase tracking-wider">COST</span>
                <span className="text-title-sm font-num tabular-nums font-bold text-teal-400 mt-0.5">
                  {resolvedCard.cost ?? 0}
                </span>
              </div>
              <div className="flex flex-col items-center border-x border-line">
                <span className="text-hud text-fg-muted font-display uppercase tracking-wider">PP</span>
                <span className="text-title-sm font-num tabular-nums font-bold text-fg mt-0.5">
                  {resolvedCard.basePP !== undefined ? `${resolvedCard.basePP}` : '--'}
                </span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-hud text-fg-muted font-display uppercase tracking-wider">DP</span>
                <span className="text-title-sm font-num tabular-nums font-bold text-gold-300 mt-0.5">
                  {resolvedCard.baseDP !== undefined ? `${resolvedCard.baseDP}` : '--'}
                </span>
              </div>
            </div>

            {/* 卡牌效果规则说明 */}
            <div className="flex flex-col gap-1.5">
              <span className="text-hud font-display uppercase tracking-widest text-fg-muted">
                RULES TEXT · 卡牌效果
              </span>
              <div className="p-4 bg-ink-950 border border-line text-body-sm leading-relaxed text-fg whitespace-pre-wrap">
                {resolvedCard.rulesText || '此卡牌无特殊规则文本。'}
              </div>
            </div>

            {/* 背景风味文本 */}
            {resolvedCard.flavorText && (
              <div className="p-3 bg-ink-850/60 border-l-2 border-line-strong text-caption text-fg-muted">
                “{resolvedCard.flavorText}”
              </div>
            )}
          </div>

          {/* 底部操作区 */}
          <div className="mt-6 pt-4 border-t border-line flex items-center justify-end gap-3">
            {actionButton}
            <Button variant="secondary" size="md" onClick={onClose}>
              返回战场
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
