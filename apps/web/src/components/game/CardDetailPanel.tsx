'use client';

import React from 'react';
import { CardInstance, ElementAttribute, SignalOrbColor } from '@zhanshuang/shared';
import { isCardApproximatelyImplemented } from '@zhanshuang/game-rules';
import { CardData, findCardByNumberOrId, getCardVariants, CardVariant, formatCardType } from '@/lib/cards-data';
import { Shield, Flame, Zap, Moon, Snowflake, ZoomIn, Info, Star } from 'lucide-react';
import { getCardThumbnailUrl, getCardFullImageUrl, handleThumbnailError } from '@/lib/card-image';
import {
  formatBonus,
  formatCardModifiers,
  formatCardProhibitions,
  getDisplayStats,
} from '@/lib/card-stats';
import { getEffectiveCardType } from '@/lib/battle-actions';
import { HudBrackets } from '@/components/ui';

interface CardDetailPanelProps {
  card: CardData | CardInstance | any | null;
  publicCards?: Record<string, CardInstance>;
  effectiveCost?: number;
  onOpenModal?: () => void;
  className?: string;
  customAction?: React.ReactNode;
  selectedImageUrl?: string;
  onSelectVariant?: (variant: CardVariant) => void;
}

const ORB_COLOR_ZH: Record<SignalOrbColor, string> = {
  RED: '红',
  BLUE: '蓝',
  YELLOW: '黄',
};

function resolveLinkedCardDisplay(id: string, publicCards?: Record<string, CardInstance>) {
  const inst = publicCards?.[id];
  const def = inst ? findCardByNumberOrId(inst.cardNumber || inst.cardId) : undefined;
  return {
    id,
    name: def?.name || inst?.cardNumber || id,
    cardNumber: inst?.cardNumber || def?.cardNumber || '',
  };
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
  publicCards,
  effectiveCost,
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

  const runtimeCard: CardInstance | null =
    card && typeof card === 'object' && 'instanceId' in card && Boolean(card.instanceId)
      ? (card as CardInstance)
      : null;

  const effectiveCardType = runtimeCard
    ? getEffectiveCardType(runtimeCard, resolvedCard)
    : resolvedCard.cardType;
  const isTypeTransformed = Boolean(runtimeCard && effectiveCardType !== resolvedCard.cardType);

  const baseCost = resolvedCard.cost ?? 0;
  const displayCost = effectiveCost !== undefined ? effectiveCost : baseCost;
  const costDiff = displayCost - baseCost;

  const displayStats = runtimeCard ? getDisplayStats(runtimeCard, resolvedCard) : null;
  const displayPP = displayStats ? displayStats.pp : resolvedCard.basePP;
  const displayDP = displayStats ? displayStats.dp : resolvedCard.baseDP;
  const ppBonus = displayStats?.ppBonus ?? 0;
  const dpBonus = displayStats?.dpBonus ?? 0;

  const displayTraits: string[] =
    runtimeCard && runtimeCard.effectiveTraits !== undefined
      ? runtimeCard.effectiveTraits
      : resolvedCard.traits ?? [];
  const displayKeywords: string[] = runtimeCard?.effectiveKeywords ?? [];
  const activeModifiers = runtimeCard ? formatCardModifiers(runtimeCard) : [];
  const activeProhibitions = runtimeCard ? formatCardProhibitions(runtimeCard) : [];

  const equipmentIds = runtimeCard
    ? Array.from(
        new Set(
          [runtimeCard.attachedEquipmentId, ...(runtimeCard.extraAttachedEquipmentIds ?? [])].filter(
            (id): id is string => Boolean(id)
          )
        )
      )
    : [];
  const underneathIds = runtimeCard?.underneathCardIds ?? [];
  const partnerInfo = runtimeCard?.partnerCardId
    ? resolveLinkedCardDisplay(runtimeCard.partnerCardId, publicCards)
    : null;
  const hostInfo = runtimeCard?.partnerOfCardId
    ? resolveLinkedCardDisplay(runtimeCard.partnerOfCardId, publicCards)
    : null;
  const showOrbRuntimeInfo = Boolean(
    runtimeCard &&
      runtimeCard.isFaceUp !== false &&
      (runtimeCard.zone === 'SIGNAL_ORB' ||
        (runtimeCard.effectiveOrbColors && runtimeCard.effectiveOrbColors.length > 0) ||
        runtimeCard.effectiveOrbValue !== undefined)
  );

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
              <span
                className={`px-1.5 py-0.5 text-hud font-sans font-medium border ${
                  isTypeTransformed
                    ? 'bg-teal-400/15 border-teal-400/50 text-teal-400'
                    : 'bg-ink-850 border-line text-fg-secondary'
                }`}
              >
                {isTypeTransformed
                  ? `变身·${formatCardType(effectiveCardType, resolvedCard.isInstant)}`
                  : formatCardType(effectiveCardType, resolvedCard.isInstant)}
              </span>
              <span className={`px-1.5 py-0.5 text-hud font-sans font-medium border flex items-center gap-0.5 ${elem.badge}`}>
                {elem.icon}
                {elem.label}
              </span>
              <span className="px-1.5 py-0.5 text-hud font-num font-semibold bg-ink-850 border border-line text-gold-300">
                {displayCost}费
                {costDiff !== 0 ? ` (原${baseCost}${formatBonus(costDiff)})` : ''}
              </span>
              {runtimeCard && (
                <span
                  className={`px-1.5 py-0.5 text-hud font-sans font-semibold border ${
                    runtimeCard.isReady
                      ? 'bg-success/15 border-success/50 text-success'
                      : 'bg-gold-300/15 border-gold-300/50 text-gold-300'
                  }`}
                >
                  {runtimeCard.isReady ? '竖直' : '横置'}
                </span>
              )}
              {runtimeCard?.isFrozen && (
                <span className="px-1.5 py-0.5 text-hud font-sans font-semibold bg-teal-400/15 border border-teal-400/60 text-teal-400">
                  冰冻
                </span>
              )}
              {runtimeCard?.isAirborne && (
                <span className="px-1.5 py-0.5 text-hud font-sans font-semibold bg-steel-700/30 border border-steel-300/50 text-steel-300">
                  浮空
                </span>
              )}
              {isCardApproximatelyImplemented(resolvedCard.cardNumber, resolvedCard.rulesText) && (
                <span
                  className="px-1.5 py-0.5 text-hud font-sans font-semibold bg-gold-300/15 border border-gold-300/50 text-gold-300"
                  title="该卡尚在按官方文本逐卡转换中，当前对局按关键字近似结算（已迁移卡包与官方预组均已精确实现）"
                >
                  近似效果
                </span>
              )}
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
      {(resolvedCard.basePP !== undefined ||
        resolvedCard.baseDP !== undefined ||
        runtimeCard?.effectivePP !== undefined ||
        runtimeCard?.effectiveDP !== undefined) && (
        <div className="grid grid-cols-2 gap-2 text-caption">
          <div className="px-2.5 py-1 bg-ink-950 border border-line flex justify-between items-center">
            <span className="text-fg-muted text-hud">PP 力量</span>
            <span
              className={`font-num tabular-nums font-bold ${
                ppBonus > 0 ? 'text-teal-400' : ppBonus < 0 ? 'text-crimson-400' : 'text-fg'
              }`}
            >
              {displayPP ?? '--'}
              {ppBonus !== 0 ? formatBonus(ppBonus) : ''}
            </span>
          </div>
          <div className="px-2.5 py-1 bg-ink-950 border border-line flex justify-between items-center">
            <span className="text-fg-muted text-hud">DP 破坏</span>
            <span
              className={`font-num tabular-nums font-bold ${
                dpBonus < 0 ? 'text-crimson-400' : 'text-gold-300'
              }`}
            >
              {displayDP ?? '--'}
              {dpBonus !== 0 ? formatBonus(dpBonus) : ''}
            </span>
          </div>
        </div>
      )}

      {/* 信号球正面运行时属性 */}
      {showOrbRuntimeInfo && runtimeCard && (
        <div className="px-2.5 py-1.5 bg-ink-950 border border-line flex flex-wrap items-center gap-2 text-hud">
          <span className="text-fg-muted">信号球属性</span>
          {runtimeCard.effectiveOrbColors && runtimeCard.effectiveOrbColors.length > 0 && (
            <span className="px-1.5 py-px bg-teal-400/15 border border-teal-400/40 text-teal-400 font-semibold">
              视为 {runtimeCard.effectiveOrbColors.map((c) => ORB_COLOR_ZH[c] ?? c).join('/')} 球
            </span>
          )}
          {runtimeCard.effectiveOrbValue !== undefined && (
            <span className="px-1.5 py-px bg-gold-300/15 border border-gold-300/40 text-gold-300 font-num font-semibold">
              等效 {runtimeCard.effectiveOrbValue} 球
            </span>
          )}
        </div>
      )}

      {/* 卡牌特征与实时词条 */}
      {(displayTraits.length > 0 || displayKeywords.length > 0) && (
        <div className="flex flex-wrap gap-1 text-hud">
          {displayTraits.map((t: string, i: number) => (
            <span
              key={`trait-${i}`}
              className="px-1.5 py-0.5 bg-ink-850 border border-line text-fg-secondary"
            >
              &lt;{t}&gt;
            </span>
          ))}
          {displayKeywords.map((kw: string, i: number) => (
            <span
              key={`kw-${i}`}
              className="px-1.5 py-0.5 bg-teal-400/15 border border-teal-400/40 text-teal-400 font-semibold"
            >
              【{kw}】
            </span>
          ))}
        </div>
      )}

      {/* 禁止效果与持续修改器 (1.3.3 / 8.9) */}
      {(activeProhibitions.length > 0 || activeModifiers.length > 0) && (
        <div className="flex flex-col gap-1 p-2 bg-ink-950 border border-line text-hud">
          {activeProhibitions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {activeProhibitions.map((label, i) => (
                <span
                  key={`proh-${i}`}
                  className="px-1.5 py-px bg-crimson-500/15 border border-crimson-500/50 text-crimson-400 font-semibold"
                >
                  {label}
                </span>
              ))}
            </div>
          )}
          {activeModifiers.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {activeModifiers.map((tag, i) => (
                <span
                  key={`mod-${i}`}
                  className="px-1.5 py-px bg-teal-400/10 border border-teal-400/35 text-teal-400 font-num"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 关联卡牌明细：双持装备 / 下方叠置牌 / 协战搭档或宿主 */}
      {(equipmentIds.length > 0 || underneathIds.length > 0 || partnerInfo || hostInfo) && (
        <div className="flex flex-col gap-1.5 p-2 bg-ink-950 border border-line text-hud">
          {equipmentIds.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <span className="text-gold-300 font-semibold">
                {equipmentIds.length > 1 ? `双持装备 (${equipmentIds.length})` : '附着装备'}
              </span>
              {equipmentIds.map((eqId) => {
                const info = resolveLinkedCardDisplay(eqId, publicCards);
                return (
                  <div key={eqId} className="text-fg-secondary flex items-center justify-between gap-2">
                    <span className="truncate">{info.name}</span>
                    {info.cardNumber && (
                      <span className="font-num text-fg-muted shrink-0">{info.cardNumber}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {underneathIds.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <span className="text-steel-300 font-semibold">下方牌 ({underneathIds.length})</span>
              {underneathIds.map((uid) => {
                const info = resolveLinkedCardDisplay(uid, publicCards);
                return (
                  <div key={uid} className="text-fg-secondary flex items-center justify-between gap-2">
                    <span className="truncate">{info.name}</span>
                    {info.cardNumber && (
                      <span className="font-num text-fg-muted shrink-0">{info.cardNumber}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {(partnerInfo || hostInfo) && (
            <div className="flex flex-col gap-0.5">
              {partnerInfo && (
                <div className="text-teal-400 flex items-center justify-between gap-2">
                  <span className="truncate">协战搭档：{partnerInfo.name}</span>
                  {partnerInfo.cardNumber && (
                    <span className="font-num text-fg-muted shrink-0">{partnerInfo.cardNumber}</span>
                  )}
                </div>
              )}
              {hostInfo && (
                <div className="text-teal-400 flex items-center justify-between gap-2">
                  <span className="truncate">协战宿主：{hostInfo.name}</span>
                  {hostInfo.cardNumber && (
                    <span className="font-num text-fg-muted shrink-0">{hostInfo.cardNumber}</span>
                  )}
                </div>
              )}
              {runtimeCard?.cannotReleasePartnerUntilTurn !== undefined && (
                <span className="text-gold-300">
                  至第 {runtimeCard.cannotReleasePartnerUntilTurn} 回合末前不可解除协战
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* 卡牌规则效果 */}
      <div className="max-h-28 overflow-y-auto p-2.5 bg-ink-950 border border-line text-caption leading-relaxed text-fg-secondary whitespace-pre-wrap">
        {resolvedCard.rulesText || '此卡牌无特殊规则文本。'}
      </div>

      {/* 快捷操作区 */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-line">
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
