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

// 属性图标辅助
function getAttributeBadge(attr?: string) {
  if (!attr || attr === 'NONE') return null;
  switch (attr) {
    case 'FIRE':
      return <span className="text-[9px] px-1 rounded bg-red-950/80 border border-red-500/50 text-red-400 font-mono">火</span>;
    case 'LIGHTNING':
      return <span className="text-[9px] px-1 rounded bg-yellow-950/80 border border-yellow-500/50 text-yellow-400 font-mono">雷</span>;
    case 'DARK':
      return <span className="text-[9px] px-1 rounded bg-purple-950/80 border border-purple-500/50 text-purple-400 font-mono">暗</span>;
    case 'ICE':
      return <span className="text-[9px] px-1 rounded bg-cyan-950/80 border border-cyan-500/50 text-cyan-400 font-mono">冰</span>;
    case 'PHYSICAL':
      return <span className="text-[9px] px-1 rounded bg-neutral-900 border border-neutral-600 text-neutral-300 font-mono">物</span>;
    case 'VOID':
      return <span className="text-[9px] px-1 rounded bg-cyan-950/80 border border-cyan-400/50 text-cyan-300 font-mono">空</span>;
    default:
      return null;
  }
}

// 单张卡牌卡面展示组件 (水平自适应单行缩放)
function RevealedCardItem({
  option,
  isSelected,
  cardWidth,
  cardHeight,
  onSelect,
}: {
  option: { id: string; label: string; payload?: unknown };
  isSelected: boolean;
  cardWidth: number;
  cardHeight: number;
  onSelect: () => void;
}) {
  const [imageError, setImageError] = useState(false);
  const payload = (option.payload as CardPayload) || {};

  // 尝试从静态卡库补全元数据
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
      className={`relative flex-shrink-0 flex flex-col rounded-xl border-2 transition-all duration-200 select-none overflow-hidden group ${
        isEligible
          ? isSelected
            ? 'border-terminalCyan bg-terminalCyan/15 ring-2 ring-terminalCyan shadow-[0_0_25px_rgba(0,240,255,0.5)] -translate-y-2 cursor-pointer z-10'
            : 'border-terminalCyan/70 bg-neutral-900/90 hover:border-terminalCyan hover:shadow-[0_0_20px_rgba(0,240,255,0.3)] hover:-translate-y-1.5 cursor-pointer'
          : 'border-neutral-800 bg-neutral-950/80 opacity-40 grayscale-[60%] cursor-not-allowed'
      }`}
    >
      {/* 顶部状态徽章 */}
      <div
        className={`px-1.5 py-0.5 text-[9px] font-mono font-bold flex items-center justify-between border-b flex-shrink-0 ${
          isEligible
            ? isSelected
              ? 'bg-terminalCyan text-neutral-950 border-terminalCyan font-black'
              : 'bg-terminalCyan/20 text-terminalCyan border-terminalCyan/40'
            : 'bg-neutral-900 text-neutral-500 border-neutral-800'
        }`}
      >
        <span className="flex items-center gap-0.5 truncate max-w-[80%]">
          {slotIndex !== undefined && (
            <span className="px-1 py-px rounded bg-neutral-950 text-neutral-300 border border-neutral-700 text-[8px] mr-0.5">
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
              <span className="truncate text-[8px]">{ineligibleReason}</span>
            </>
          )}
        </span>

        {isSelected && (
          <span className="flex items-center gap-0.5 text-[8px] bg-neutral-950 text-terminalCyan px-1 rounded font-mono shadow">
            <Check className="w-2.5 h-2.5 stroke-[3]" />
          </span>
        )}
      </div>

      {/* 卡面画廊区域 (使用 object-contain 确保全卡面完整显示不被裁剪) */}
      <div className="relative flex-1 w-full bg-neutral-950 overflow-hidden flex flex-col justify-between p-1 min-h-0">
        {imgSrc && !imageError ? (
          <img
            src={getCardThumbnailUrl(imgSrc)}
            alt={name}
            onError={(e) => {
              // 先回退到原图，原图也失败时再显示文字占位
              if (!e.currentTarget.dataset.fallbackTried) {
                e.currentTarget.dataset.fallbackTried = 'true';
                e.currentTarget.src = imgSrc;
              } else {
                setImageError(true);
              }
            }}
            className="absolute inset-0 w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-neutral-900 via-neutral-950 to-neutral-900 flex flex-col items-center justify-center p-2 text-center">
            <Shield className="w-6 h-6 text-neutral-700 mb-1" />
            <span className="text-[10px] font-bold text-neutral-300 line-clamp-2">{name}</span>
            <span className="text-[8px] text-neutral-500 font-mono mt-0.5">{cardNumber}</span>
          </div>
        )}

        {/* 顶部标签层：费用、卡种与属性 */}
        <div className="relative z-10 flex items-center justify-between pointer-events-none">
          {cost !== undefined ? (
            <div className="w-5 h-5 rounded-full bg-neutral-950/85 border border-terminalCyan/80 flex items-center justify-center text-terminalCyan font-mono font-bold text-[10px] shadow">
              {cost}
            </div>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-0.5">
            {!isCompact && getAttributeBadge(attribute)}
            {cardType && !isCompact && (
              <div className="px-1 py-px rounded bg-neutral-950/85 border border-neutral-700 text-neutral-300 font-mono text-[8px] shadow backdrop-blur-sm">
                {formatCardType(cardType)}
              </div>
            )}
          </div>
        </div>

        {/* 选中高亮半透明辉光蒙层 */}
        {isSelected && (
          <div className="absolute inset-0 bg-terminalCyan/20 pointer-events-none z-10 border border-terminalCyan" />
        )}

        {/* 不可选遮罩 */}
        {!isEligible && (
          <div className="absolute inset-0 bg-black/60 pointer-events-none z-10 flex items-center justify-center">
            <span className="px-1.5 py-0.5 rounded bg-neutral-950/90 border border-neutral-700 text-[9px] text-neutral-400 font-mono">
              不可选
            </span>
          </div>
        )}

        {/* 底部卡牌简讯小条 */}
        <div className="relative z-10 px-1 py-0.5 rounded bg-neutral-950/90 border border-neutral-800 backdrop-blur-md flex flex-col gap-0.2 pointer-events-none">
          <div className="text-[9px] font-bold text-white truncate font-sans">{name}</div>
          <div className="flex items-center justify-between text-[8px] font-mono text-neutral-400">
            <span className="truncate">{traits.length > 0 ? `<${traits[0]}>` : cardNumber}</span>
            {basePP !== undefined && (
              <span className="text-terminalCyan font-bold">PP {basePP}</span>
            )}
          </div>
        </div>
      </div>

      {/* 底部卡牌点击交互条 */}
      <div
        className={`py-1 text-center text-[9px] font-mono font-semibold transition-colors flex-shrink-0 ${
          isEligible
            ? isSelected
              ? 'bg-terminalCyan text-neutral-950 font-bold'
              : 'bg-neutral-900/90 text-neutral-300 group-hover:text-terminalCyan group-hover:bg-neutral-800'
            : 'bg-neutral-950 text-neutral-600'
        }`}
      >
        {isEligible ? (isSelected ? '✓ 已选中' : '点击选择') : '不可选'}
      </div>
    </div>
  );
}

export function PendingChoiceModal({ choice, onConfirm, onCancel }: PendingChoiceModalProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const isMulti = choice.maxSelections > 1;

  // 只要是 SELECT_CARDS 或者包含卡牌选项，全部激活卡牌卡面画廊模式
  const isCardGalleryMode =
    choice.choiceType === 'SELECT_CARDS' ||
    choice.effectType === 'SEARCH_TOP_CARDS' ||
    choice.options.some((o) => {
      const p = o.payload as CardPayload | undefined;
      return (
        p?.eligible !== undefined ||
        p?.cardNumber !== undefined ||
        p?.cardType !== undefined ||
        !!findCardByNumberOrId(o.id)
      );
    });

  const eligibleOptions = choice.options.filter((opt) => {
    const p = opt.payload as CardPayload | undefined;
    return p?.eligible !== false;
  });
  const hasEligibleCards = eligibleOptions.length > 0;

  const handleToggle = (id: string) => {
    if (isMulti) {
      if (selectedIds.includes(id)) {
        setSelectedIds(selectedIds.filter((item) => item !== id));
      } else {
        if (selectedIds.length < choice.maxSelections) {
          setSelectedIds([...selectedIds, id]);
        }
      }
    } else {
      // 单选模式：再次点击已选中的可取消，点击其他则选中该卡
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

  // 获得已选卡牌名称提示
  const selectedCardsNames = selectedIds
    .map((id) => {
      const opt = choice.options.find((o) => o.id === id);
      const p = opt?.payload as CardPayload | undefined;
      const def = findCardByNumberOrId(p?.cardNumber || id);
      return p?.name || def?.name || opt?.label || id;
    })
    .join(', ');

  // 标题文字适配
  const modalTitle = choice.effectType === 'OPPONENT_CONFIRM_REVEAL'
    ? '对手公开卡牌查阅 • REVEALED CARDS INSPECTION'
    : choice.effectType === 'ST01_002_INSPECT_ORB' || choice.effectType === 'INSPECT_REVEALED_CARDS'
    ? '翻开卡牌检视 • REVEALED CARDS INSPECTION'
    : choice.effectType === 'SEARCH_TOP_CARDS' || choice.effectType === 'RESOLVE_REVEALED_SELECTION'
    ? '战术效果处理 • 卡牌检索与检视'
    : choice.choiceType === 'SELECT_CARDS'
    ? '目标卡牌选择 • TARGET SELECTION'
    : '效果处理窗口 • EFFECT RESOLUTION';

  // 动态横向等比缩放几何计算:
  // 固定窗口大小下，单行横向排列所有卡片，根据卡牌总数自动缩放卡面尺寸适应窗口
  const { cardWidth, cardHeight } = useMemo(() => {
    const count = Math.max(1, choice.options.length);
    // 可用最大容器宽度 (约 900px)
    const availableWidth = 880;
    const gap = 12;
    const totalGaps = (count - 1) * gap;
    const computedWidth = Math.floor((availableWidth - totalGaps) / count);

    // 标准卡牌比例 1 : 1.395 (0.716)
    // 可用最大卡牌高度约 280px (总窗口 530px - 标题 50px - 描述 65px - 底部 65px - 状态栏 30px)
    const maxHeight = 280;
    const maxWidthFromHeight = Math.floor(maxHeight * 0.716); // 约 200px

    const finalWidth = Math.max(90, Math.min(maxWidthFromHeight, computedWidth, 185));
    const finalHeight = Math.round(finalWidth / 0.716);

    return { cardWidth: finalWidth, cardHeight: finalHeight };
  }, [choice.options.length]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200 select-none">
      {/* 固定尺寸窗口容器 (w-[960px] max-w-[96vw] h-[530px] max-h-[92vh]) */}
      <div
        className={`w-full ${
          isCardGalleryMode ? 'w-[960px] max-w-[96vw] h-[530px] max-h-[92vh]' : 'max-w-lg h-auto max-h-[90vh]'
        } bg-surface border-2 border-terminalCyan/70 rounded-2xl shadow-[0_0_50px_rgba(0,240,255,0.3)] overflow-hidden flex flex-col`}
      >
        {/* 顶部标题栏 */}
        <div className="px-5 py-3 bg-neutral-900 border-b border-terminalCyan/30 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 text-terminalCyan">
            <Zap className="w-5 h-5 animate-pulse" />
            <span className="font-bold text-sm tracking-wider font-mono">
              {modalTitle}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-[11px] font-mono px-2 py-0.5 rounded bg-terminalCyan/20 text-terminalCyan border border-terminalCyan/40">
              {isCardGalleryMode
                ? `可选卡牌 (${choice.options.length}张)`
                : choice.choiceType}
            </div>
            {choice.minSelections === 0 && onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="p-1 rounded text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
                title="放弃 / 关闭"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* 效果描述与卡牌展示主体 */}
        <div className="p-3 sm:p-4 flex flex-col flex-1 min-h-0 gap-2.5 overflow-hidden">
          {/* 效果描述条 */}
          <div className="p-2.5 rounded-xl border border-neutral-700/80 bg-neutral-900/80 flex items-start gap-2.5 flex-shrink-0">
            <AlertCircle className="w-4 h-4 text-terminalGold flex-shrink-0 mt-0.5" />
            <div className="text-xs font-mono text-neutral-200 whitespace-pre-wrap leading-relaxed">
              {choice.prompt}
            </div>
          </div>

          {/* 模式 A：单行横向等比缩放排列 (窗口固定，根据卡牌数自动缩放卡图) */}
          {isCardGalleryMode ? (
            <div className="flex flex-col flex-1 min-h-0 justify-between gap-1.5">
              <div className="flex items-center justify-between text-xs font-mono text-neutral-400 px-1 flex-shrink-0">
                <span className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-terminalCyan" />
                  <span>点击卡牌完成选取 (单行自适应展示):</span>
                </span>
                <span>
                  {hasEligibleCards ? (
                    <span className="text-terminalCyan font-bold">
                      {selectedIds.length} / {choice.maxSelections} 已选
                    </span>
                  ) : (
                    <span className="text-terminalGold font-bold">未检出符合条件的目标</span>
                  )}
                </span>
              </div>

              {/* 单行横向排列容器 */}
              <div className="flex flex-row items-center justify-center gap-3 w-full flex-1 min-h-0 overflow-x-auto overflow-y-hidden px-2 py-1">
                {choice.options.map((opt) => (
                  <RevealedCardItem
                    key={opt.id}
                    option={opt}
                    isSelected={selectedIds.includes(opt.id)}
                    cardWidth={cardWidth}
                    cardHeight={cardHeight}
                    onSelect={() => handleToggle(opt.id)}
                  />
                ))}
              </div>
            </div>
          ) : (
            /* 模式 B：纯选项/文本分支模式 (如选择分支或Yes/No) */
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
              <div className="text-[11px] font-mono text-neutral-400 flex justify-between">
                <span>请选择选项 ({selectedIds.length} / 最多 {choice.maxSelections}):</span>
                {choice.minSelections === 0 && <span className="text-neutral-500">可跳过</span>}
              </div>

              {choice.options.map((opt) => {
                const isSelected = selectedIds.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleToggle(opt.id)}
                    className={`w-full p-2.5 rounded-xl border text-left transition-all flex items-center justify-between gap-3 text-xs font-mono ${
                      isSelected
                        ? 'border-terminalCyan bg-terminalCyan/15 text-white shadow-[0_0_12px_rgba(0,240,255,0.2)]'
                        : 'border-terminalBorder bg-neutral-900/80 text-neutral-300 hover:border-terminalCyan/50 hover:bg-neutral-800'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`w-4 h-4 rounded ${
                          isMulti ? 'rounded-sm' : 'rounded-full'
                        } border flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'border-terminalCyan bg-terminalCyan text-neutral-950 font-bold'
                            : 'border-neutral-600 bg-neutral-950'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                      <span className="font-semibold">{opt.label}</span>
                    </div>
                    <ChevronRight
                      className={`w-4 h-4 transition-transform ${
                        isSelected ? 'text-terminalCyan rotate-90' : 'text-neutral-600'
                      }`}
                    />
                  </button>
                );
              })}
            </div>
          )}

          {/* 底部操作与确认栏 */}
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-terminalBorder/60 flex-shrink-0">
            {/* 状态与已选反馈 */}
            <div className="text-xs font-mono text-neutral-300 flex items-center gap-1.5 truncate">
              {isCardGalleryMode && (
                <>
                  <Info className="w-3.5 h-3.5 text-terminalCyan flex-shrink-0" />
                  {selectedIds.length > 0 ? (
                    <span className="truncate">
                      已选择: <strong className="text-white font-bold">{selectedCardsNames}</strong>
                    </span>
                  ) : hasEligibleCards ? (
                    <span className="text-neutral-400">
                      请点击高亮卡牌选取
                    </span>
                  ) : (
                    <span className="text-terminalGold">
                      无符合条件的目标卡牌，点击确认继续
                    </span>
                  )}
                </>
              )}
            </div>

            {/* 按钮群 */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {choice.minSelections === 0 && onCancel && (
                <button
                  type="button"
                  onClick={() => onConfirm([])}
                  className="px-3.5 py-1.5 rounded-xl border border-neutral-700 text-neutral-400 hover:text-white hover:border-neutral-500 text-xs font-mono transition-colors"
                >
                  放弃 / 跳过
                </button>
              )}

              <button
                type="button"
                disabled={!isValid && hasEligibleCards}
                onClick={() => onConfirm(selectedIds)}
                className={`px-5 py-2 rounded-xl font-bold font-mono text-xs shadow-lg transition-all flex items-center gap-1.5 ${
                  isValid || !hasEligibleCards
                    ? 'bg-terminalCyan text-neutral-950 hover:scale-105 hover:bg-terminalCyan/90 shadow-[0_0_20px_rgba(0,240,255,0.4)] cursor-pointer'
                    : 'bg-neutral-800 text-neutral-500 cursor-not-allowed border border-neutral-700'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {choice.effectType === 'OPPONENT_CONFIRM_REVEAL'
                    ? '已阅确认 • PROCEED'
                    : choice.effectType === 'ST01_002_INSPECT_ORB'
                    ? ((choice.metadata as any)?.hasOrb ? '确认 • 下一步选择角色' : '确认 • 送入墓地')
                    : choice.effectType === 'INSPECT_REVEALED_CARDS'
                    ? '已阅确认 • PROCEED'
                    : isCardGalleryMode
                    ? hasEligibleCards
                      ? `确认选择 (${selectedIds.length}/${choice.maxSelections})`
                      : '确认继续'
                    : '确认执行处理'}
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
