'use client';

import React, { useState, useMemo } from 'react';
import { PendingChoice } from '@zhanshuang/shared';
import {
  Zap,
  Check,
  AlertCircle,
  X,
  CheckCircle2,
  ChevronRight,
  Sparkles,
  Shield,
  Layers,
  Info,
} from 'lucide-react';
import { findCardByNumberOrId, formatCardType } from '@/lib/cards-data';
import { getCardThumbnailUrl, getCardFullImageUrl } from '@/lib/card-image';
import { Button } from '@/components/ui';

interface PendingChoiceModalProps {
  choice: PendingChoice;
  onConfirm: (selectedIds: string[]) => void;
  onCancel?: () => void;
}

interface CardPayload {
  cardNumber?: string;
  name?: string;
  cardType?: string;
  cost?: number;
  basePP?: number;
  baseDP?: number;
  attribute?: string;
  traits?: string[];
  imageUrl?: string;
  rulesText?: string;
  slotIndex?: number;
  eligible?: boolean;
  ineligibleReason?: string;
}

function getAttributeBadge(attr?: string) {
  if (!attr || attr === 'NONE') return null;
  switch (attr) {
    case 'FIRE':
      return <span className="text-hud px-1 bg-crimson-500/15 border border-crimson-500/50 text-crimson-400">火</span>;
    case 'LIGHTNING':
      return <span className="text-hud px-1 bg-gold-300/15 border border-gold-300/50 text-gold-300">雷</span>;
    case 'DARK':
      return <span className="text-hud px-1 bg-steel-700/25 border border-steel-500/50 text-steel-300">暗</span>;
    case 'ICE':
      return <span className="text-hud px-1 bg-teal-400/15 border border-teal-400/50 text-teal-400">冰</span>;
    case 'PHYSICAL':
      return <span className="text-hud px-1 bg-ink-850 border border-line-strong text-fg-secondary">物</span>;
    case 'VOID':
      return <span className="text-hud px-1 bg-teal-400/15 border border-teal-400/50 text-teal-400">空</span>;
    default:
      return null;
  }
}

// 单张卡牌卡面展示组件 (水平自适应单行缩放)
function RevealedCardItem({
  option,
  isSelected,
  selectionOrder,
  cardWidth,
  cardHeight,
  onSelect,
}: {
  option: { id: string; label: string; payload?: unknown };
  isSelected: boolean;
  selectionOrder?: number;
  cardWidth: number;
  cardHeight: number;
  onSelect: () => void;
}) {
  const [imageError, setImageError] = useState(false);
  const payload = (option.payload as CardPayload) || {};

  const fallbackDef = findCardByNumberOrId(payload.cardNumber || option.id);

  const isEligible = payload.eligible !== false;
  const ineligibleReason = payload.ineligibleReason || '不可选';
  const cardNumber = payload.cardNumber || fallbackDef?.cardNumber || '';
  const name = payload.name || fallbackDef?.name || option.label;
  const cost = payload.cost ?? fallbackDef?.cost;
  const basePP = payload.basePP ?? fallbackDef?.basePP;
  const cardType = payload.cardType || fallbackDef?.cardType;
  const attribute = payload.attribute || fallbackDef?.attribute;
  const traits = payload.traits || fallbackDef?.traits || [];
  const slotIndex = payload.slotIndex;
  const imgSrc = getCardFullImageUrl(payload.imageUrl || (fallbackDef as any)?.imageUrl, cardNumber);

  const isCompact = cardWidth < 135;

  const handleClick = () => {
    if (isEligible) {
      onSelect();
    }
  };

  return (
    <div
      onClick={handleClick}
      style={{ width: `${cardWidth}px`, height: `${cardHeight}px` }}
      className={`relative flex-shrink-0 flex flex-col rounded-card border-2 transition-all duration-fast select-none overflow-hidden group ${
        isEligible
          ? isSelected
            ? 'border-teal-400 bg-teal-400/15 ring-2 ring-teal-400/60 shadow-glow-teal -translate-y-2 cursor-pointer z-10'
            : 'border-line-strong bg-ink-900 hover:border-teal-400 hover:-translate-y-1 cursor-pointer'
          : 'border-line bg-ink-950 opacity-40 grayscale-[60%] cursor-not-allowed'
      }`}
    >
      {/* 顶部状态徽章 */}
      <div
        className={`px-1.5 py-0.5 text-hud font-sans font-semibold flex items-center justify-between border-b flex-shrink-0 ${
          isEligible
            ? isSelected
              ? 'bg-teal-400 text-ink-950 border-teal-400'
              : 'bg-teal-400/15 text-teal-400 border-teal-400/30'
            : 'bg-ink-900 text-fg-muted border-line'
        }`}
      >
        <span className="flex items-center gap-0.5 truncate max-w-[80%]">
          {slotIndex !== undefined && (
            <span className="px-1 py-px bg-ink-950 text-fg-secondary border border-line font-num mr-0.5">
              位{slotIndex + 1}
            </span>
          )}
          {isEligible ? (
            <>
              <Sparkles className="w-2.5 h-2.5 fill-current flex-shrink-0" />
              <span className="truncate">{isSelected ? '已选' : '可选'}</span>
            </>
          ) : (
            <>
              <X className="w-2.5 h-2.5 flex-shrink-0" />
              <span className="truncate">{ineligibleReason}</span>
            </>
          )}
        </span>

        {isSelected && (
          <span className="flex items-center gap-0.5 bg-ink-950 text-teal-400 px-1 font-num font-bold">
            {selectionOrder !== undefined ? (
              <span>#{selectionOrder}</span>
            ) : (
              <Check className="w-2.5 h-2.5 stroke-[3]" />
            )}
          </span>
        )}
      </div>

      {/* 卡面画廊区域 */}
      <div className="relative flex-1 w-full bg-ink-950 overflow-hidden flex flex-col justify-between p-1 min-h-0">
        {imgSrc && !imageError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={getCardThumbnailUrl(imgSrc)}
            alt={name}
            onError={(e) => {
              if (!e.currentTarget.dataset.fallbackTried) {
                e.currentTarget.dataset.fallbackTried = 'true';
                e.currentTarget.src = imgSrc;
              } else {
                setImageError(true);
              }
            }}
            className="absolute inset-0 w-full h-full object-contain group-hover:scale-105 transition-transform duration-base"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 bg-ink-900 flex flex-col items-center justify-center p-2 text-center">
            <Shield className="w-6 h-6 text-fg-disabled mb-1" />
            <span className="text-hud font-semibold text-fg-secondary line-clamp-2">{name}</span>
            <span className="text-hud text-fg-muted font-num mt-0.5">{cardNumber}</span>
          </div>
        )}

        {/* 顶部标签层：费用、卡种与属性 */}
        <div className="relative z-10 flex items-center justify-between pointer-events-none">
          {cost !== undefined ? (
            <div className="w-5 h-5 bg-ink-950/90 border border-teal-400/80 flex items-center justify-center text-teal-400 font-num font-bold text-hud">
              {cost}
            </div>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-0.5">
            {!isCompact && getAttributeBadge(attribute)}
            {cardType && !isCompact && (
              <div className="px-1 py-px bg-ink-950/90 border border-line text-fg-secondary font-sans text-hud">
                {formatCardType(cardType)}
              </div>
            )}
          </div>
        </div>

        {/* 选中高亮蒙层 */}
        {isSelected && (
          <div className="absolute inset-0 bg-teal-400/15 pointer-events-none z-10 border border-teal-400" />
        )}

        {/* 不可选遮罩 */}
        {!isEligible && (
          <div className="absolute inset-0 bg-ink-950/65 pointer-events-none z-10 flex items-center justify-center">
            <span className="px-1.5 py-0.5 bg-ink-950/95 border border-line text-hud text-fg-muted">
              不可选
            </span>
          </div>
        )}

        {/* 底部卡牌简讯小条 */}
        <div className="relative z-10 px-1.5 py-0.5 bg-ink-950/90 border border-line flex flex-col pointer-events-none">
          <div className="text-hud font-semibold text-fg truncate">{name}</div>
          <div className="flex items-center justify-between text-hud font-num text-fg-muted">
            <span className="truncate font-sans">{traits.length > 0 ? `<${traits[0]}>` : cardNumber}</span>
            {basePP !== undefined && (
              <span className="text-teal-400 font-bold shrink-0 ml-1">PP {basePP}</span>
            )}
          </div>
        </div>
      </div>

      {/* 底部交互条 */}
      <div
        className={`py-1 text-center text-hud font-sans font-semibold transition-colors flex-shrink-0 ${
          isEligible
            ? isSelected
              ? 'bg-teal-400 text-ink-950'
              : 'bg-ink-900 text-fg-secondary group-hover:text-teal-400 group-hover:bg-ink-850'
            : 'bg-ink-950 text-fg-disabled'
        }`}
      >
        {isEligible
          ? isSelected
            ? selectionOrder !== undefined
              ? `第 ${selectionOrder} 顺位`
              : '已选中'
            : '点击选择'
          : '不可选'}
      </div>
    </div>
  );
}

export function PendingChoiceModal({ choice, onConfirm, onCancel }: PendingChoiceModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const isMulti = choice.maxSelections > 1;

  const isCardGalleryMode =
    choice.effectType !== 'CHOOSE_TRIGGER_ORDER' &&
    (choice.choiceType === 'SELECT_CARDS' ||
      choice.effectType === 'SEARCH_TOP_CARDS' ||
      choice.options.some((o) => {
        const p = o.payload as CardPayload | undefined;
        return (
          p?.eligible !== undefined ||
          p?.cardNumber !== undefined ||
          p?.cardType !== undefined ||
          !!findCardByNumberOrId(o.id)
        );
      }));

  const eligibleOptions = choice.options.filter((opt) => {
    const p = opt.payload as CardPayload | undefined;
    return p?.eligible !== false;
  });
  const hasEligibleCards = eligibleOptions.length > 0;

  const handleToggle = (id: string) => {
    if (isMulti) {
      if (selectedIds.includes(id)) {
        setSelectedIds(selectedIds.filter((item) => item !== id));
      } else if (selectedIds.length < choice.maxSelections) {
        setSelectedIds([...selectedIds, id]);
      }
    } else {
      if (selectedIds.includes(id)) {
        setSelectedIds([]);
      } else {
        setSelectedIds([id]);
      }
    }
  };

  const isValid =
    (selectedIds.length >= choice.minSelections &&
      selectedIds.length <= choice.maxSelections) ||
    (!hasEligibleCards && selectedIds.length === 0);

  const selectedCardsNames = selectedIds
    .map((id, idx) => {
      const opt = choice.options.find((o) => o.id === id);
      const p = opt?.payload as CardPayload | undefined;
      const def = findCardByNumberOrId(p?.cardNumber || id);
      const displayName = p?.name || def?.name || opt?.label || id;
      return isMulti ? `#${idx + 1} ${displayName}` : displayName;
    })
    .join(isMulti ? ' → ' : ', ');

  const modalTitle =
    choice.effectType === 'CHOOSE_TRIGGER_ORDER'
      ? '待机自动能力顺序选择 (8.5.1)'
      : choice.effectType === 'OPPONENT_CONFIRM_REVEAL'
      ? '对手公开卡牌查阅'
      : choice.effectType === 'ST01_002_INSPECT_ORB' || choice.effectType === 'INSPECT_REVEALED_CARDS'
      ? '翻开卡牌检视'
      : choice.effectType === 'SEARCH_TOP_CARDS' || choice.effectType === 'RESOLVE_REVEALED_SELECTION'
      ? '战术效果处理 · 卡牌检索与检视'
      : choice.choiceType === 'SELECT_CARDS'
      ? '目标卡牌选择'
      : '效果处理窗口';

  const { cardWidth, cardHeight } = useMemo(() => {
    const count = Math.max(1, choice.options.length);
    const availableWidth = 880;
    const gap = 12;
    const totalGaps = (count - 1) * gap;
    const computedWidth = Math.floor((availableWidth - totalGaps) / count);

    const maxHeight = 280;
    const maxWidthFromHeight = Math.floor(maxHeight * 0.716);

    const finalWidth = Math.max(90, Math.min(maxWidthFromHeight, computedWidth, 185));
    const finalHeight = Math.round(finalWidth / 0.716);

    return { cardWidth: finalWidth, cardHeight: finalHeight };
  }, [choice.options.length]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={modalTitle}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-ink-950/85 backdrop-blur-md animate-in fade-in duration-fast select-none"
    >
      <div
        className={`w-full ${
          isCardGalleryMode ? 'w-[960px] max-w-[96vw] h-[530px] max-h-[92vh]' : 'max-w-lg h-auto max-h-[90vh]'
        } bg-ink-900 border border-teal-400/70 clip-corner-md shadow-overlay overflow-hidden flex flex-col animate-in zoom-in-95 duration-fast`}
      >
        <div className="h-[2px] w-full bg-crimson-500 shrink-0" />

        {/* 顶部标题栏 */}
        <div className="px-5 py-3 bg-ink-950 border-b border-line flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 text-teal-400">
            <Zap className="w-4 h-4 fill-current" />
            <span className="font-semibold text-body-sm tracking-wide text-fg">
              {modalTitle}
            </span>
            <span className="text-hud font-display uppercase tracking-widest text-fg-muted hidden sm:inline">
              EFFECT RESOLUTION
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-hud font-num px-2 py-0.5 bg-teal-400/15 text-teal-400 border border-teal-400/40">
              {isCardGalleryMode
                ? `可选卡牌 (${choice.options.length}张)`
                : choice.choiceType}
            </div>
            {choice.minSelections === 0 && onCancel && (
              <button
                type="button"
                onClick={onCancel}
                aria-label="放弃并关闭"
                className="p-1 text-fg-muted hover:text-fg hover:bg-ink-800 transition-colors cursor-pointer"
                title="放弃 / 关闭"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* 效果描述与卡牌展示主体 */}
        <div className="p-3 sm:p-4 flex flex-col flex-1 min-h-0 gap-3 overflow-hidden">
          {/* 效果描述条 */}
          <div className="p-2.5 border border-line bg-ink-950 flex items-start gap-2.5 flex-shrink-0">
            <AlertCircle className="w-4 h-4 text-gold-300 flex-shrink-0 mt-0.5" />
            <div className="text-caption text-fg whitespace-pre-wrap leading-relaxed">
              {choice.prompt}
            </div>
          </div>

          {isCardGalleryMode ? (
            <div className="flex flex-col flex-1 min-h-0 justify-between gap-1.5">
              <div className="flex items-center justify-between text-caption text-fg-muted px-1 flex-shrink-0">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-teal-400" />
                  <span>{isMulti ? '按顺序点击卡牌完成选取（点击顺序即排列顺序）' : '点击卡牌完成选取'}</span>
                </span>
                <span className="font-num tabular-nums">
                  {hasEligibleCards ? (
                    <span className="text-teal-400 font-bold">
                      {selectedIds.length} / {choice.maxSelections} 已选
                    </span>
                  ) : (
                    <span className="text-gold-300 font-semibold font-sans">未检出符合条件的目标</span>
                  )}
                </span>
              </div>

              <div className="flex flex-row items-center justify-center gap-3 w-full flex-1 min-h-0 overflow-x-auto overflow-y-hidden px-2 py-1">
                {choice.options.map((opt) => {
                  const selectedIdx = selectedIds.indexOf(opt.id);
                  const isSelected = selectedIdx >= 0;
                  return (
                    <RevealedCardItem
                      key={opt.id}
                      option={opt}
                      isSelected={isSelected}
                      selectionOrder={isMulti && isSelected ? selectedIdx + 1 : undefined}
                      cardWidth={cardWidth}
                      cardHeight={cardHeight}
                      onSelect={() => handleToggle(opt.id)}
                    />
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
              <div className="text-hud text-fg-muted flex justify-between font-num">
                <span>请选择选项 ({selectedIds.length} / 最多 {choice.maxSelections})</span>
                {choice.minSelections === 0 && <span className="font-sans">可跳过</span>}
              </div>

              {choice.options.map((opt) => {
                const selectedIdx = selectedIds.indexOf(opt.id);
                const isSelected = selectedIdx >= 0;
                const payload = opt.payload as CardPayload | undefined;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleToggle(opt.id)}
                    className={`w-full p-2.5 border text-left transition-colors duration-fast flex items-center justify-between gap-3 text-caption cursor-pointer ${
                      isSelected
                        ? 'border-teal-400 bg-teal-400/15 text-fg'
                        : 'border-line bg-ink-950 text-fg-secondary hover:border-teal-400/50 hover:bg-ink-850'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-5 h-5 shrink-0 ${
                          isMulti ? '' : 'rounded-full'
                        } border flex items-center justify-center font-num text-hud font-bold transition-colors ${
                          isSelected
                            ? 'border-teal-400 bg-teal-400 text-ink-950'
                            : 'border-line-strong bg-ink-900'
                        }`}
                      >
                        {isSelected ? (
                          isMulti ? (
                            selectedIdx + 1
                          ) : (
                            <Check className="w-3 h-3 stroke-[3]" />
                          )
                        ) : null}
                      </div>
                      {choice.effectType === 'CHOOSE_TRIGGER_ORDER' && payload?.cardNumber && (
                        <span className="px-1.5 py-px bg-ink-900 border border-line text-hud font-num text-teal-400 shrink-0">
                          {payload.cardNumber}
                        </span>
                      )}
                      <span className="font-medium truncate">{opt.label}</span>
                    </div>
                    <ChevronRight
                      className={`w-4 h-4 shrink-0 transition-transform duration-fast ${
                        isSelected ? 'text-teal-400 rotate-90' : 'text-fg-disabled'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          )}

          {/* 底部操作与确认栏 */}
          <div className="flex items-center justify-between gap-3 pt-2.5 border-t border-line flex-shrink-0">
            <div className="text-caption text-fg-secondary flex items-center gap-1.5 truncate">
              {isCardGalleryMode && (
                <>
                  <Info className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" />
                  {selectedIds.length > 0 ? (
                    <span className="truncate">
                      已选择：<strong className="text-fg">{selectedCardsNames}</strong>
                    </span>
                  ) : hasEligibleCards ? (
                    <span className="text-fg-muted">请点击高亮卡牌选取</span>
                  ) : (
                    <span className="text-gold-300">无符合条件的目标卡牌，点击确认继续</span>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {choice.minSelections === 0 && onCancel && (
                <Button variant="secondary" size="sm" onClick={() => onConfirm([])}>
                  放弃 / 跳过
                </Button>
              )}

              <Button
                variant="primary"
                size="sm"
                disabled={!isValid && hasEligibleCards}
                onClick={() => onConfirm(selectedIds)}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {choice.effectType === 'CHOOSE_TRIGGER_ORDER'
                    ? '优先发动所选能力'
                    : choice.effectType === 'OPPONENT_CONFIRM_REVEAL'
                    ? '已阅确认'
                    : choice.effectType === 'ST01_002_INSPECT_ORB'
                    ? (choice.metadata as any)?.hasOrb
                      ? '确认 · 选择角色'
                      : '确认 · 送入墓地'
                    : choice.effectType === 'INSPECT_REVEALED_CARDS'
                    ? '已阅确认'
                    : isCardGalleryMode
                    ? hasEligibleCards
                      ? `确认选择 (${selectedIds.length}/${choice.maxSelections})`
                      : '确认继续'
                    : '确认执行'}
                </span>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
