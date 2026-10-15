'use client';

import React, { useEffect, useState } from 'react';
import { CardType, ElementAttribute, SignalOrbType } from '@zhanshuang/shared';
import { CardData, findCardByNumberOrId, getCardVariants, getCardSeries, CardVariant } from '@/lib/cards-data';
import { getCardFullImageUrl } from '@/lib/card-image';
import { X, Sparkles, Shield, Flame, Zap, Moon, Snowflake, ZoomIn, Star } from 'lucide-react';

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
      icon: <Sparkles className="w-4 h-4 text-cyan-300" />,
      badge: 'text-cyan-300 border-cyan-400/40 bg-cyan-950/40',
    };
  }
  switch (attr) {
    case ElementAttribute.FIRE:
    case 'FIRE':
      return {
        label: '火属性',
        icon: <Flame className="w-4 h-4 text-red-500" />,
        badge: 'text-red-400 border-red-500/40 bg-red-950/40',
      };
    case ElementAttribute.LIGHTNING:
    case 'LIGHTNING':
      return {
        label: '雷属性',
        icon: <Zap className="w-4 h-4 text-yellow-400" />,
        badge: 'text-yellow-400 border-yellow-500/40 bg-yellow-950/40',
      };
    case ElementAttribute.DARK:
    case 'DARK':
      return {
        label: '暗属性',
        icon: <Moon className="w-4 h-4 text-purple-400" />,
        badge: 'text-purple-400 border-purple-500/40 bg-purple-950/40',
      };
    case ElementAttribute.ICE:
    case 'ICE':
      return {
        label: '冰属性',
        icon: <Snowflake className="w-4 h-4 text-cyan-300" />,
        badge: 'text-cyan-300 border-cyan-500/40 bg-cyan-950/40',
      };
    case ElementAttribute.PHYSICAL:
    case 'PHYSICAL':
      return {
        label: '物理属性',
        icon: <Shield className="w-4 h-4 text-amber-300" />,
        badge: 'text-amber-300 border-amber-500/40 bg-amber-950/40',
      };
    default:
      return {
        label: '无属性',
        icon: null,
        badge: 'text-neutral-400 border-neutral-700 bg-neutral-900',
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

  // 如果传入的是 CardInstance，尝试查表获得完整的规则详情
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
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 select-none animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative max-w-4xl w-full max-h-[90vh] bg-surface/95 border-2 border-terminalBorder rounded-2xl shadow-2xl flex flex-col md:flex-row overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 p-2 rounded-xl bg-neutral-900/90 border border-neutral-700 text-neutral-400 hover:text-white hover:border-terminalCyan transition-all shadow-md"
          title="关闭"
        >
          <X className="w-5 h-5" />
        </button>

        {/* 左侧：超清卡图展示区 (严格 63:88 实体卡比例) */}
        <div className="w-full md:w-[380px] shrink-0 p-6 flex flex-col items-center justify-center bg-black/60 border-b md:border-b-0 md:border-r border-terminalBorder">
          <div className="relative aspect-[63/88] w-full max-w-[320px] rounded-2xl overflow-hidden border-2 border-terminalCyan/70 shadow-[0_0_30px_rgba(0,240,255,0.25)] bg-neutral-950">
            {cardImgSrc ? (
              <img
                src={cardImgSrc}
                alt={resolvedCard.name}
                className="w-full h-full object-fill block"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = `/cards/${resolvedCard.cardNumber}.png`;
                }}
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-terminalCyan font-mono">
                <span className="text-xl font-bold">{resolvedCard.cardNumber}</span>
                <span className="text-sm mt-2">{resolvedCard.name}</span>
              </div>
            )}

            {/* 叠层标记 (如果在战场且有升变叠层) */}
            {card.underneathCardIds && card.underneathCardIds.length > 0 && (
              <div className="absolute top-3 right-3 px-2 py-1 rounded-lg bg-black/90 text-terminalCyan text-xs font-mono font-bold flex items-center gap-1 border border-terminalCyan/60 shadow-lg">
                <Sparkles className="w-3.5 h-3.5" /> 叠层: {card.underneathCardIds.length} 张
              </div>
            )}
          </div>

          {/* 异画卡图版本快速切换器 (0星 / 1星 / 2星) */}
          {variants.length > 1 && (
            <div className="w-full max-w-[320px] mt-3.5 p-2 rounded-xl bg-neutral-900/90 border border-terminalBorder/80 flex flex-col gap-1.5 font-mono shadow-md">
              <div className="text-[11px] text-neutral-400 font-bold flex items-center justify-between">
                <span className="flex items-center gap-1 text-white">
                  <Star className="w-3.5 h-3.5 text-terminalGold fill-current" />
                  <span>切换卡图版本:</span>
                </span>
                <span className="text-[10px] text-neutral-400">共 {variants.length} 款立绘</span>
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
                      className={`py-1.5 px-2 rounded-lg text-xs font-mono font-bold border transition-all cursor-pointer flex flex-col items-center justify-center ${
                        isCurrent
                          ? 'bg-terminalGold text-neutral-950 border-terminalGold shadow-[0_0_12px_rgba(255,200,0,0.5)] font-black scale-105'
                          : 'bg-black/60 border-neutral-700 text-neutral-300 hover:border-terminalCyan/70'
                      }`}
                      title={v.name}
                    >
                      <span className="text-xs font-extrabold">{v.shortLabel}</span>
                      <span className="text-[9px] opacity-80 scale-90">{v.name.split(' ')[0]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <span className="mt-2.5 text-[11px] font-mono text-neutral-500">
            标准卡牌规格 (63 × 88 mm) • 超清立绘检视
          </span>
        </div>

        {/* 右侧：卡牌完整规则数据面板 */}
        <div className="flex-1 p-6 md:p-8 flex flex-col justify-between overflow-y-auto">
          <div className="flex flex-col gap-4">
            {/* 头部：卡号与基础类型属性 */}
            <div className="flex flex-wrap items-center gap-2 font-mono">
              <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-terminalCyan/20 text-terminalCyan border border-terminalCyan/40">
                {resolvedCard.cardNumber}
              </span>
              <span className="px-2.5 py-1 rounded-lg text-xs font-bold border bg-neutral-900 border-neutral-700 text-neutral-300">
                {getCardTypeLabel(resolvedCard.cardType, resolvedCard.isInstant)}
              </span>
              <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border flex items-center gap-1 ${elementInfo.badge}`}>
                {elementInfo.icon}
                {elementInfo.label}
              </span>
              {(resolvedCard.packageName || resolvedCard.series || (resolvedCard.cardNumber ? getCardSeries(resolvedCard.cardNumber) : '')) && (
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold border border-neutral-700 bg-neutral-900 text-terminalCyan">
                  {resolvedCard.packageName || resolvedCard.series || getCardSeries(resolvedCard.cardNumber)}
                </span>
              )}
              {resolvedCard.isInstant && (
                <span className="px-2.5 py-1 rounded-lg text-xs font-bold border border-yellow-500/50 bg-yellow-950/40 text-yellow-400">
                  【瞬时】(10.8)
                </span>
              )}
            </div>

            {/* 卡牌名称 */}
            <div>
              <h2 className="text-2xl font-bold text-white tracking-wide">
                {resolvedCard.name}
              </h2>
              {resolvedCard.traits && resolvedCard.traits.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {resolvedCard.traits.map((trait: string, idx: number) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 rounded text-xs font-mono bg-neutral-900 border border-neutral-800 text-neutral-400"
                    >
                      &lt;{trait}&gt;
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 战术数值矩阵 (费用 / PP / DP) */}
            <div className="grid grid-cols-3 gap-3 p-3.5 rounded-xl bg-neutral-950/80 border border-terminalBorder font-mono">
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-neutral-500 font-bold uppercase">使用费用 (COST)</span>
                <span className="text-xl font-bold text-terminalCyan mt-0.5">
                  {resolvedCard.cost ?? 0}
                </span>
              </div>
              <div className="flex flex-col items-center border-x border-neutral-800">
                <span className="text-[10px] text-neutral-500 font-bold uppercase">战斗力量 (PP)</span>
                <span className="text-xl font-bold text-white mt-0.5">
                  {resolvedCard.basePP !== undefined ? `${resolvedCard.basePP}` : '--'}
                </span>
              </div>
              <div className="flex flex-col items-center">
                <span className="text-[10px] text-neutral-500 font-bold uppercase">破坏力量 (DP)</span>
                <span className="text-xl font-bold text-terminalGold mt-0.5">
                  {resolvedCard.baseDP !== undefined ? `${resolvedCard.baseDP}` : '--'}
                </span>
              </div>
            </div>

            {/* 卡牌效果规则说明 */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-bold font-mono text-neutral-400">卡牌效果规则 (RULES TEXT)</span>
              <div className="p-4 rounded-xl bg-neutral-950 border border-terminalBorder text-sm leading-relaxed text-neutral-200 whitespace-pre-wrap font-sans">
                {resolvedCard.rulesText || '此卡牌无特殊规则文本。'}
              </div>
            </div>

            {/* 战术背景与风味文本 */}
            {resolvedCard.flavorText && (
              <div className="p-3 rounded-lg bg-neutral-900/40 border border-white/5 text-xs text-neutral-400 italic">
                “{resolvedCard.flavorText}”
              </div>
            )}
          </div>

          {/* 底部行动控制区 */}
          <div className="mt-6 pt-4 border-t border-terminalBorder flex items-center justify-end gap-3 font-mono">
            {actionButton}
            <button
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-neutral-700 bg-neutral-900 hover:border-terminalCyan text-white text-xs font-bold transition-all shadow"
            >
              返回战场
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
