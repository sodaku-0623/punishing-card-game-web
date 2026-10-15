'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useRouteId } from '@/lib/route-id';
import Link from 'next/link';
import {
  ALL_OFFICIAL_CARDS,
  ALL_CARD_VARIANT_ENTRIES,
  CardData,
  CardVariant,
  CardVariantEntry,
  getCardVariants,
  formatCardType,
} from '@/lib/cards-data';
import { findOfficialStarterDeck } from '@/lib/starter-decks';
import {
  CardType,
  ElementAttribute,
  SignalOrbType,
} from '@zhanshuang/shared';
import {
  validateDeck,
  extractCoreCardNumber,
  DeckCardInput,
  DeckValidationResult,
} from '@zhanshuang/game-rules';
import {
  ArrowLeft,
  Save,
  Plus,
  Minus,
  Trash2,
  Search,
  CheckCircle2,
  AlertCircle,
  Shield,
  Layers,
  Sparkles,
  Info,
  Check,
  Flame,
  Moon,
  Zap,
  Snowflake,
  ZoomIn,
  X,
  LayoutGrid,
  List,
} from 'lucide-react';
import { CardDetailPanel } from '@/components/game/CardDetailPanel';
import { CardDetailModal } from '@/components/game/CardDetailModal';
import { useLongPress } from '@/hooks/useLongPress';
import { getCardThumbnailUrl, getCardFullImageUrl, handleThumbnailError } from '@/lib/card-image';

interface DeckEntry {
  cardId: string;
  cardNumber?: string;
  name?: string;
  count: number;
  imageUrl?: string;
  variantKey?: string;
  variantBadge?: string;
  variantStar?: number;
}

// 针对暂无扫描图卡牌的高精度赛博卡牌渲染框架（严格贴合 63:88 实体卡比例）
function CyberCardFallback({ card }: { card: CardData }) {
  const getTheme = () => {
    switch (card.attribute) {
      case ElementAttribute.DARK:
        return {
          border: 'border-purple-500/80',
          bg: 'from-purple-950/60 via-neutral-950 to-black',
          badge: 'text-purple-400 border-purple-500/40',
        };
      case ElementAttribute.FIRE:
        return {
          border: 'border-red-500/80',
          bg: 'from-red-950/60 via-neutral-950 to-black',
          badge: 'text-red-400 border-red-500/40',
        };
      case ElementAttribute.PHYSICAL:
        return {
          border: 'border-amber-500/80',
          bg: 'from-amber-950/60 via-neutral-950 to-black',
          badge: 'text-amber-400 border-amber-500/40',
        };
      default:
        return {
          border: 'border-terminalCyan/80',
          bg: 'from-cyan-950/60 via-neutral-950 to-black',
          badge: 'text-terminalCyan border-terminalCyan/40',
        };
    }
  };

  const theme = getTheme();

  return (
    <div
      className={`w-full h-full p-3 flex flex-col justify-between border-2 rounded-2xl bg-gradient-to-b ${theme.bg} ${theme.border} font-mono select-none shadow-inner`}
    >
      {/* 顶部：费用球与编号 */}
      <div className="flex justify-between items-center pb-1.5 border-b border-white/10">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full bg-terminalCyan text-neutral-950 font-bold text-xs flex items-center justify-center shadow">
            {card.cost}
          </div>
          <span className="text-[11px] text-neutral-300 font-bold">{card.cardNumber}</span>
        </div>
        <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${theme.badge}`}>
          {card.attributeName || (card.attribute === ElementAttribute.VOID ? '空' : card.attribute)}
        </span>
      </div>

      {/* 中部角色名称立绘框 */}
      <div className="flex-1 my-2.5 rounded-xl bg-black/75 border border-white/10 flex flex-col items-center justify-center p-3 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,240,255,0.08)_0,transparent_75%)]" />
        <span className="text-sm font-bold text-white mb-1 relative z-10 leading-tight">
          {card.name}
        </span>
        <span className="text-[10px] text-neutral-400 relative z-10 font-sans">
          {formatCardType(card.cardType, card.isInstant)}
        </span>
      </div>

      {/* 效果描述 */}
      <div className="text-[10px] text-neutral-200 line-clamp-4 bg-black/60 p-2 rounded-lg border border-white/10 mb-1.5 leading-snug font-sans">
        {card.rulesText || '无特殊效果'}
      </div>

      {/* 底部战斗数值 */}
      {card.basePP !== undefined && (
        <div className="flex justify-between items-center text-xs pt-1.5 border-t border-white/10 font-bold">
          <span className="text-terminalCyan">{card.basePP} PP</span>
          <span className="text-erosionRed">{card.baseDP ?? 0} DP</span>
        </div>
      )}
    </div>
  );
}

// 支持点击检视与长按放大的网格卡牌组件 (独立展示各异画版本，共用卡号投入上限)
function DeckCardGridItem({
  card,
  inDeckCountForThisVariant,
  totalCountForCardNumber,
  isMax,
  isSelected,
  onSelect,
  onLongPress,
  onAdd,
  onRemove,
}: {
  card: CardVariantEntry;
  inDeckCountForThisVariant: number;
  totalCountForCardNumber: number;
  isMax: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onLongPress: () => void;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const handlers = useLongPress({
    onLongPress,
    onClick: onSelect,
  });

  const isFoil = card.variantStar > 0;

  return (
    <div
      {...handlers}
      className={`group relative aspect-[63/88] w-full rounded-2xl overflow-hidden border-2 transition-all duration-200 cursor-pointer select-none bg-black shadow-lg ${
        isSelected
          ? 'border-terminalCyan ring-2 ring-terminalCyan shadow-[0_0_24px_rgba(0,240,255,0.45)] scale-[1.02]'
          : isMax
          ? 'border-amber-500/60 opacity-80'
          : inDeckCountForThisVariant > 0
          ? 'border-terminalCyan shadow-[0_0_18px_rgba(0,240,255,0.35)] hover:scale-[1.02]'
          : totalCountForCardNumber > 0
          ? 'border-terminalCyan/50 hover:border-terminalCyan hover:scale-[1.02]'
          : 'border-terminalBorder/80 hover:border-terminalCyan hover:shadow-[0_0_22px_rgba(0,240,255,0.3)] hover:scale-[1.02]'
      }`}
      title={`${card.name} (${card.cardNumber} • ${card.variantBadge || card.variantName}) - 点击查看详情，长按查看大图`}
    >
      {/* 完整卡图 (优先加载轻量缩略图) */}
      {card.imageUrl ? (
        <img
          src={getCardThumbnailUrl(card.imageUrl, card.cardNumber)}
          alt={card.name}
          className="w-full h-full object-fill block"
          loading="lazy"
          onError={(e) => {
            handleThumbnailError(e, card.imageUrl || `/cards/${card.cardNumber}.png`);
          }}
        />
      ) : (
        <CyberCardFallback card={card} />
      )}

      {/* 左上角：本异画版本专属徽章 (不再显示多形态切换，直接展示此特定异画) */}
      <div
        className={`absolute top-2.5 left-2.5 z-20 px-2 py-0.5 rounded-lg border backdrop-blur-md text-[10px] font-mono font-bold flex items-center gap-1 shadow-lg ${
          isFoil
            ? 'bg-black/85 border-amber-400/80 text-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.35)]'
            : 'bg-black/80 border-neutral-700 text-neutral-300'
        }`}
      >
        {isFoil && <Sparkles className="w-2.5 h-2.5 text-amber-300" />}
        <span>{card.variantBadge || (card.variantRarity || card.rarity) || '原画'}</span>
      </div>

      {/* 右上角：投入卡组数量角标 (展示本异画张数与同卡号累计张数) */}
      {totalCountForCardNumber > 0 && (
        <div
          className={`absolute top-2.5 right-2.5 px-2 py-0.5 rounded-full backdrop-blur-md border-2 text-xs font-mono font-bold flex items-center gap-1 shadow-2xl z-20 ${
            isMax
              ? 'bg-black/95 border-amber-400 text-amber-300'
              : 'bg-black/90 border-terminalCyan text-terminalCyan'
          }`}
        >
          {inDeckCountForThisVariant > 0 ? (
            <>
              <span className="text-[10px] text-neutral-400">本版</span>
              <span className="text-white font-extrabold">{inDeckCountForThisVariant}</span>
              <span className="text-[10px] text-neutral-500">|</span>
              <span className="text-[10px] text-neutral-400">同号</span>
              <span className={isMax ? 'text-amber-300 font-extrabold' : 'text-terminalCyan font-extrabold'}>
                {totalCountForCardNumber}/4
              </span>
            </>
          ) : (
            <>
              <span className="text-[10px] text-neutral-400">同号</span>
              <span className={isMax ? 'text-amber-300 font-extrabold' : 'text-terminalCyan font-extrabold'}>
                {totalCountForCardNumber}/4
              </span>
            </>
          )}
        </div>
      )}

      {/* 达到同编号上限4张时的遮罩 */}
      {isMax && (
        <div className="absolute inset-0 bg-black/55 backdrop-blur-[1px] flex items-center justify-center pointer-events-none z-20">
          <span className="px-3.5 py-1.5 rounded-xl bg-black/95 border-2 border-amber-400 text-amber-300 font-mono font-black text-xs tracking-wider shadow-2xl flex flex-col items-center">
            <span>同号 MAX (4/4)</span>
            <span className="text-[9px] text-neutral-400 font-normal mt-0.5">该编号投入已达上限</span>
          </span>
        </div>
      )}

      {/* 悬浮操作浮层 */}
      <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/95 via-black/85 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-between gap-2 z-30">
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {inDeckCountForThisVariant > 0 && (
            <button
              onClick={onRemove}
              className="w-8 h-8 rounded-lg bg-black/90 border border-neutral-600 hover:border-erosionRed hover:text-erosionRed text-white flex items-center justify-center transition-all shadow-md active:scale-95"
              title="从卡组移除1张本异画"
            >
              <Minus className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onAdd}
            disabled={isMax}
            className={`h-8 px-3 rounded-lg font-mono text-xs font-bold flex items-center gap-1 transition-all shadow-md active:scale-95 ${
              isMax
                ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed border border-neutral-700'
                : 'bg-terminalCyan text-neutral-950 hover:bg-terminalCyan/90 font-extrabold'
            }`}
            title={isMax ? '该卡牌编号所有异画合计已达4张上限' : '投入卡组+1'}
          >
            <Plus className="w-4 h-4" />
            <span>投入</span>
          </button>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onLongPress();
          }}
          className="w-8 h-8 rounded-lg bg-black/90 border border-neutral-600 hover:border-terminalCyan hover:text-terminalCyan text-neutral-300 flex items-center justify-center transition-all shadow-md active:scale-95"
          title="查看高清大图与效果细节 (长按也可查看)"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// 支持点击检视与长按放大的清单卡牌组件 (独立展示各异画版本，共用卡号投入上限)
function DeckCardListItem({
  card,
  inDeckCountForThisVariant,
  totalCountForCardNumber,
  isMax,
  isSelected,
  onSelect,
  onLongPress,
  onAdd,
  onRemove,
}: {
  card: CardVariantEntry;
  inDeckCountForThisVariant: number;
  totalCountForCardNumber: number;
  isMax: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onLongPress: () => void;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const handlers = useLongPress({
    onLongPress,
    onClick: onSelect,
  });

  const isFoil = card.variantStar > 0;

  return (
    <div
      {...handlers}
      className={`p-3.5 rounded-2xl border-2 transition-all flex items-center gap-5 bg-surface/75 hover:border-terminalCyan cursor-pointer select-none shadow-md ${
        isSelected
          ? 'border-terminalCyan ring-2 ring-terminalCyan bg-terminalCyan/10 shadow-[0_0_20px_rgba(0,240,255,0.3)]'
          : isMax
          ? 'border-amber-500/50 opacity-80'
          : inDeckCountForThisVariant > 0
          ? 'border-terminalCyan/70 bg-terminalCyan/5'
          : 'border-terminalBorder'
      }`}
    >
      {/* 左侧：严格 63:88 比例完整卡图 (优先加载轻量缩略图) */}
      <div className="w-24 sm:w-28 aspect-[63/88] rounded-xl overflow-hidden border-2 border-terminalBorder/80 shrink-0 bg-black relative shadow group">
        {card.imageUrl ? (
          <img
            src={getCardThumbnailUrl(card.imageUrl, card.cardNumber)}
            alt={card.name}
            className="w-full h-full object-fill block"
            loading="lazy"
            onError={(e) => {
              handleThumbnailError(e, card.imageUrl || `/cards/${card.cardNumber}.png`);
            }}
          />
        ) : (
          <CyberCardFallback card={card} />
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onLongPress();
          }}
          className="absolute inset-0 bg-black/60 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center text-white"
          title="点击或长按放大检视"
        >
          <ZoomIn className="w-5 h-5 text-terminalCyan" />
        </button>
      </div>

      {/* 中部：结构化卡牌信息与效果 */}
      <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
        <div>
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-terminalCyan/20 text-terminalCyan border border-terminalCyan/40 font-bold">
              {card.cardNumber}
            </span>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                isFoil
                  ? 'border-amber-400 bg-amber-400/20 text-amber-300'
                  : 'border-neutral-700 bg-neutral-900 text-neutral-300'
              }`}
            >
              {isFoil && '★ '}
              {card.variantBadge || (card.variantRarity || card.rarity) || '原画'}
            </span>
            <span className="text-xs text-neutral-400 font-mono">
              {formatCardType(card.cardType, card.isInstant)} • {card.attributeName || (card.attribute === ElementAttribute.VOID ? '空' : card.attribute)}
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-neutral-900 border border-neutral-700 text-neutral-300">
              {card.cost} 费
            </span>
            {card.basePP !== undefined && (
              <span className="text-xs font-mono font-bold text-terminalCyan">
                {card.basePP} PP
              </span>
            )}
            {card.baseDP !== undefined && (
              <span className="text-xs font-mono font-bold text-erosionRed">
                {card.baseDP} DP
              </span>
            )}
          </div>

          <h3 className="text-base font-bold text-white mb-1.5 flex items-center gap-2">
            <span>{card.name}</span>
            {card.variantName && card.variantName !== '基础标准' && (
              <span className="text-xs text-amber-300/80 font-normal font-mono">
                ({card.variantName})
              </span>
            )}
          </h3>

          <p className="text-xs text-neutral-300 line-clamp-2 font-sans leading-relaxed bg-black/40 p-2 rounded-lg border border-white/5">
            {card.rulesText || '无特殊规则效果。'}
          </p>
        </div>

        {card.traits.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {card.traits.map((t, i) => (
              <span
                key={i}
                className="px-2 py-0.5 rounded text-[10px] font-mono bg-neutral-900 text-neutral-400 border border-neutral-800"
              >
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 右侧：投入数量快捷调节 */}
      <div
        className="flex flex-col items-end gap-2.5 shrink-0 pl-3 border-l border-terminalBorder/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs font-mono flex flex-col items-end">
          <span className="text-neutral-400 text-[11px]">
            本版已投: <strong className="text-white text-xs font-bold">{inDeckCountForThisVariant}</strong> 张
          </span>
          <span className="text-[11px] mt-0.5">
            同号总计:{' '}
            <strong className={isMax ? 'text-amber-300 text-xs font-bold' : 'text-terminalCyan text-xs font-bold'}>
              {totalCountForCardNumber}
            </strong>{' '}
            / 4
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {inDeckCountForThisVariant > 0 && (
            <button
              onClick={onRemove}
              className="p-1.5 rounded-lg border border-terminalBorder hover:border-erosionRed hover:text-erosionRed text-white transition-colors"
              title="减少1张"
            >
              <Minus className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={onAdd}
            disabled={isMax}
            className={`px-3 py-1.5 rounded-lg font-mono text-xs font-bold transition-all ${
              isMax
                ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed border border-neutral-700'
                : 'bg-terminalCyan text-neutral-950 hover:bg-terminalCyan/90'
            }`}
            title={isMax ? '该卡牌编号所有异画合计已达4张上限' : '增加1张'}
          >
            +1 投入
          </button>
        </div>
      </div>
    </div>
  );
}

// 支持点击检视、显示具体异画星级与长按放大的已投入卡组清单项
function DeckEntryListItem({
  card,
  entry,
  count,
  isCardNumberMax,
  isSelected,
  onSelect,
  onLongPress,
  onAdd,
  onRemove,
}: {
  card: CardData | CardVariantEntry;
  entry: DeckEntry;
  count: number;
  isCardNumberMax: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onLongPress: () => void;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const handlers = useLongPress({
    onLongPress,
    onClick: onSelect,
  });

  const currentImg = getCardFullImageUrl(entry.imageUrl || card.imageUrl, card.cardNumber);
  const badge = entry.variantBadge || (card as any).variantBadge || `${card.rarity || ''} 原画`;
  const isFoil = (entry.variantStar ?? (card as any).variantStar ?? 0) > 0;

  return (
    <div
      {...handlers}
      className={`flex items-center justify-between p-2 rounded-lg border transition-all cursor-pointer group ${
        isSelected
          ? 'border-terminalCyan bg-terminalCyan/15 ring-1 ring-terminalCyan'
          : 'border-terminalBorder bg-surface/60 hover:border-terminalCyan/50'
      }`}
      title="点击查看卡牌效果详情，长按查看大图"
    >
      <div className="flex items-center gap-2.5 overflow-hidden flex-1 mr-2">
        <div className="w-9 aspect-[63/88] rounded-md border border-terminalBorder overflow-hidden shrink-0 bg-black flex items-center justify-center p-0 group-hover:border-terminalCyan transition-colors">
          {currentImg ? (
            <img
              src={getCardThumbnailUrl(currentImg, entry.cardNumber)}
              alt=""
              className="w-full h-full object-fill block"
              loading="lazy"
              onError={(e) => {
                handleThumbnailError(e, currentImg);
              }}
            />
          ) : (
            <span className="text-[9px] text-terminalCyan font-bold">{card.cost}</span>
          )}
        </div>

        <div className="overflow-hidden flex-1 min-w-0">
          <div className="text-xs font-bold text-white group-hover:text-terminalCyan transition-colors truncate max-w-[150px] xl:max-w-[190px]">
            {entry.name || card.name}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 mt-0.5">
            <span className="font-bold text-neutral-300">{entry.cardNumber || card.cardNumber}</span>
            <span>•</span>
            <span
              className={`px-1 py-px rounded border text-[9px] font-mono ${
                isFoil
                  ? 'border-amber-400/60 bg-amber-400/10 text-amber-300'
                  : 'border-neutral-700 bg-neutral-900 text-neutral-300'
              }`}
            >
              {badge}
            </span>
            <span>•</span>
            <span>{card.cost}费</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center bg-neutral-950 rounded border border-terminalBorder">
          <button
            onClick={onRemove}
            className="p-1 hover:text-white text-neutral-400"
            title="减少1张"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span className="px-2 text-xs font-bold text-terminalCyan">{count}</span>
          <button
            onClick={onAdd}
            disabled={isCardNumberMax}
            className="p-1 hover:text-white text-neutral-400 disabled:opacity-30 disabled:cursor-not-allowed"
            title={isCardNumberMax ? '该卡牌编号所有异画合计已达4张上限' : '增加1张'}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

const PACKAGE_OPTIONS = [
  { id: 'ALL', label: '全部卡包' },
  { id: 'BP01-命运交锋', label: 'BP01-命运交锋' },
  { id: 'BP02-星海时溯', label: 'BP02-星海时溯' },
  { id: 'BP03-誓焰破晓', label: 'BP03-誓焰破晓' },
  { id: 'BP04-终焉月冕', label: 'BP04-终焉月冕' },
  { id: 'PR-推广卡', label: 'PR-推广卡' },
  { id: 'ST01-灰鸦小队预组', label: 'ST01-灰鸦小队预组' },
  { id: 'ST02-升格者小队预组', label: 'ST02-升格者小队预组' },
  { id: 'ST03-三头犬小队预组', label: 'ST03-三头犬小队预组' },
  { id: 'ST04-突击鹰小队预组', label: 'ST04-突击鹰小队预组' },
  { id: 'ST05-比安卡·晖暮预组', label: 'ST05-比安卡·晖暮预组' },
  { id: 'ST06-亚里沙·回音预组', label: 'ST06-亚里沙·回音预组' },
];

const RARITY_OPTIONS = ['ALL', 'C', 'R', 'SR', 'PR', 'ST', 'U'];
const VARIANT_OPTIONS = ['ALL', 'C★', 'R★', 'R★★', 'SR★', 'SR★★', 'SR★★★'];
const KIND_OPTIONS = [
  { id: 'ALL', label: '全部种类' },
  { id: '角色牌', label: '角色牌' },
  { id: '升变角色牌', label: '升变角色' },
  { id: '战术牌', label: '战术牌' },
  { id: '普通战术牌', label: '普通战术' },
  { id: '瞬时战术牌', label: '瞬时战术' },
  { id: '装备牌', label: '装备牌' },
  { id: '辅助机牌', label: '辅助机' },
  { id: '道具牌', label: '道具牌' },
  { id: '普通', label: '普通' },
  { id: '装备', label: '装备' },
  { id: '辅助机', label: '辅助机' },
  { id: '协战', label: '协战' },
];

const ATTR_OPTIONS = [
  { id: 'ALL', label: '全属性' },
  { id: '物理', label: '物理' },
  { id: '暗', label: '暗' },
  { id: '火', label: '火' },
  { id: '冰', label: '冰' },
  { id: '雷', label: '雷' },
  { id: '空', label: '空' },
  { id: '无', label: '无' },
];

const COST_OPTIONS = ['ALL', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

export default function DeckBuilderEditorPage() {
  const router = useRouter();
  const deckId = useRouteId();

  const [deckName, setDeckName] = useState('新编制战术卡组');
  const [deckDesc, setDeckDesc] = useState('灰鸦/升格者战术联调构筑');
  const [deckEntries, setDeckEntries] = useState<DeckEntry[]>([]);

  // 多维筛选器状态
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPackage, setSelectedPackage] = useState<string>('ALL');
  const [selectedRarity, setSelectedRarity] = useState<string>('ALL');
  const [selectedVariant, setSelectedVariant] = useState<string>('ALL');
  const [selectedKind, setSelectedKind] = useState<string>('ALL');
  const [selectedAttr, setSelectedAttr] = useState<string>('ALL');
  const [selectedCost, setSelectedCost] = useState<string>('ALL');

  // 浏览展示模式：卡图大网格 (GRID) 或 图文清单列表 (LIST)
  const [viewMode, setViewMode] = useState<'GRID' | 'LIST'>('GRID');

  const [inspectedCard, setInspectedCard] = useState<CardVariantEntry | CardData | null>(null);
  const [selectedCardForDetail, setSelectedCardForDetail] = useState<CardVariantEntry | CardData | null>(null);
  const [saveToast, setSaveToast] = useState(false);

  // 初始化加载已保存卡组
  useEffect(() => {
    if (deckId === 'new') return;

    const official = findOfficialStarterDeck(deckId);
    if (official) {
      setDeckName(official.name);
      setDeckDesc(official.description);
      setDeckEntries(
        official.cards.map((c) => ({
          cardId: c.cardId,
          cardNumber: c.cardNumber,
          name: c.name,
          count: c.count,
          imageUrl: c.imageUrl,
          variantKey: c.variantKey,
          variantBadge: c.variantBadge,
          variantStar: c.variantStar,
        }))
      );
      return;
    }

    const saved = localStorage.getItem('zhanshuang_user_decks');
    if (saved) {
      try {
        const list = JSON.parse(saved);
        const found = list.find((d: any) => d.id === deckId);
        if (found) {
          setDeckName(found.name);
          setDeckDesc(found.description || '');
          if (found.cards) {
            setDeckEntries(found.cards);
          }
        }
      } catch (e) {
        console.error(e);
      }
    }
  }, [deckId]);

  // 卡牌快速映射表 (支持基础卡与 808 张独立异画)
  const cardMap = useMemo(() => {
    const map = new Map<string, CardVariantEntry | CardData>();
    for (const c of ALL_OFFICIAL_CARDS) {
      map.set(c.id, c);
      map.set(c.cardNumber, c);
    }
    for (const v of ALL_CARD_VARIANT_ENTRIES) {
      map.set(v.id, v);
      map.set(v.variantKey, v);
      if (v.imageUrl) {
        map.set(v.imageUrl, v);
      }
    }
    return map;
  }, []);

  // 核心卡牌编号总投入数量 (按 extractCoreCardNumber 聚合计算，用于严格限制每种编号 <= 4 张)
  const cardNumberTotalCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of deckEntries) {
      const card =
        cardMap.get(entry.variantKey || '') ||
        cardMap.get(entry.cardId) ||
        (entry.imageUrl ? cardMap.get(entry.imageUrl) : undefined) ||
        (entry.cardNumber ? cardMap.get(entry.cardNumber) : undefined);
      const rawNum = entry.cardNumber || card?.cardNumber || entry.cardId.replace(/^c-/, '').toUpperCase();
      const coreNum = extractCoreCardNumber(rawNum);
      counts.set(coreNum, (counts.get(coreNum) || 0) + entry.count);
    }
    return counts;
  }, [deckEntries, cardMap]);

  // 各独立异画版本的具体投入张数 (按 variantKey, cardId, imageUrl 索引)
  const variantSpecificCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of deckEntries) {
      if (entry.variantKey) counts.set(entry.variantKey, (counts.get(entry.variantKey) || 0) + entry.count);
      if (entry.cardId) counts.set(entry.cardId, (counts.get(entry.cardId) || 0) + entry.count);
      if (entry.imageUrl) counts.set(entry.imageUrl, (counts.get(entry.imageUrl) || 0) + entry.count);
    }
    return counts;
  }, [deckEntries]);

  // 过滤后的卡池 (直接基于全量 808 张独立异画卡牌清单进行检索与过滤)
  const filteredCards = useMemo(() => {
    return ALL_CARD_VARIANT_ENTRIES.filter((card) => {
      // 1. 关键字搜索 (编号、异画编号、角色名、效果文本、特征)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchNumber = card.cardNumber.toLowerCase().includes(q);
        const matchVariantKey = card.variantKey.toLowerCase().includes(q);
        const matchName = card.name.toLowerCase().includes(q);
        const matchTrait = card.traits.some((t) => t.toLowerCase().includes(q));
        const matchRules = card.rulesText.toLowerCase().includes(q);
        if (!matchNumber && !matchVariantKey && !matchName && !matchTrait && !matchRules) return false;
      }

      // 2. 卡包筛选
      if (selectedPackage !== 'ALL') {
        const p = selectedPackage;
        const code = p.split('-')[0] || '';
        const pkg = card.packageName || card.flavorText || '';
        if (pkg) {
          const matchPkg = pkg.includes(p) || pkg.includes(code);
          if (!matchPkg) return false;
        } else {
          if (!card.cardNumber.startsWith(code)) return false;
        }
      }

      // 3. 稀有度筛选 (C、R、SR、PR、ST、U)
      if (selectedRarity !== 'ALL') {
        const r = card.variantRarity || card.rarity;
        if (r !== selectedRarity) return false;
      }

      // 4. 异画形态筛选 (C★、R★、R★★、SR★、SR★★、SR★★★)
      if (selectedVariant !== 'ALL') {
        const starCount = (selectedVariant.match(/★+/)?.[0] || '').length;
        const targetR = selectedVariant.replace(/★+/g, '').trim();
        if (starCount > 0 && card.variantStar !== starCount) return false;
        if (targetR) {
          const r = card.variantRarity || card.rarity;
          if (r !== targetR) return false;
        }
      }

      // 5. 卡牌种类筛选
      if (selectedKind !== 'ALL') {
        const raw = (card.rawCardType || '').split(',').map((s) => s.trim());
        const rules = card.rulesText || '';
        switch (selectedKind) {
          case '道具牌':
            if (!raw.includes('3') && card.cardType !== CardType.EQUIPMENT && card.cardType !== CardType.ASSIST) return false;
            break;
          case '辅助机牌':
          case '辅助机':
            if (!raw.includes('4') && card.cardType !== CardType.ASSIST) return false;
            break;
          case '装备牌':
          case '装备':
            if (!raw.includes('5') && card.cardType !== CardType.EQUIPMENT) return false;
            break;
          case '角色牌':
            if (!raw.includes('6') && card.cardType !== CardType.ROLE) return false;
            break;
          case '升变角色牌':
            if (!raw.includes('7') && !(card.cardType === CardType.ROLE && rules.includes('升变'))) return false;
            break;
          case '战术牌':
            if (!raw.includes('8') && card.cardType !== CardType.TACTICS) return false;
            break;
          case '普通战术牌':
            if (!raw.includes('9') && !(card.cardType === CardType.TACTICS && !card.isInstant)) return false;
            break;
          case '瞬时战术牌':
            if (!raw.includes('10') && !card.isInstant) return false;
            break;
          case '普通':
            if (!raw.includes('11') && (rules.includes('升变') || rules.includes('【协战') || card.isInstant)) return false;
            break;
          case '协战':
            if (!raw.includes('14') && !rules.includes('【协战')) return false;
            break;
        }
      }

      // 6. 属性筛选
      if (selectedAttr !== 'ALL') {
        const currentAttr = card.attributeName || card.attribute;
        if (currentAttr !== selectedAttr) return false;
      }

      // 7. 费用筛选
      if (selectedCost !== 'ALL') {
        if (card.cost !== Number(selectedCost)) return false;
      }

      return true;
    });
  }, [searchQuery, selectedPackage, selectedRarity, selectedVariant, selectedKind, selectedAttr, selectedCost]);

  // 5.1 规则书合法性实时验证 (所有异画共用同一个卡牌编号，上限4张)
  const validationResult: DeckValidationResult = useMemo(() => {
    const inputs: DeckCardInput[] = [];
    for (const entry of deckEntries) {
      const card =
        cardMap.get(entry.variantKey || '') ||
        cardMap.get(entry.cardId) ||
        (entry.imageUrl ? cardMap.get(entry.imageUrl) : undefined) ||
        (entry.cardNumber ? cardMap.get(entry.cardNumber) : undefined);
      const rawNum = entry.cardNumber || card?.cardNumber || entry.cardId.replace(/^c-/, '').toUpperCase();
      const name = entry.name || card?.name || rawNum;
      const orb = card?.signalOrb;
      inputs.push({
        cardId: entry.cardId,
        cardNumber: rawNum,
        name,
        signalOrb: orb,
        count: entry.count,
      });
    }
    return validateDeck(inputs);
  }, [deckEntries, cardMap]);

  // 费用曲线统计 (0..7+)
  const costCurve = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const entry of deckEntries) {
      const card =
        cardMap.get(entry.variantKey || '') ||
        cardMap.get(entry.cardId) ||
        (entry.imageUrl ? cardMap.get(entry.imageUrl) : undefined);
      if (card && !card.signalOrb) {
        const idx = Math.min(card.cost ?? 0, 7);
        counts[idx] = (counts[idx] || 0) + entry.count;
      }
    }
    return counts;
  }, [deckEntries, cardMap]);

  const activeCardForPanel: CardData | CardVariantEntry | null =
    selectedCardForDetail ||
    inspectedCard ||
    (deckEntries[0]
      ? cardMap.get(deckEntries[0].variantKey || '') ||
        cardMap.get(deckEntries[0].cardId) ||
        (deckEntries[0].imageUrl ? cardMap.get(deckEntries[0].imageUrl) : null)
      : null) ||
    filteredCards[0] ||
    null;

  // 添加特定异画版本到卡组 (严格限制同一核心卡号所有异画合计 <= 4 张)
  function handleAddCard(card: CardVariantEntry) {
    const coreNum = extractCoreCardNumber(card.cardNumber);
    const totalCount = cardNumberTotalCounts.get(coreNum) || 0;
    if (totalCount >= 4) return;

    const targetKey = card.variantKey || card.id;
    const existingIdx = deckEntries.findIndex(
      (e) => (e.variantKey || e.cardId) === targetKey || (e.imageUrl && e.imageUrl === card.imageUrl)
    );
    if (existingIdx >= 0) {
      const next = [...deckEntries];
      next[existingIdx] = {
        ...next[existingIdx]!,
        count: next[existingIdx]!.count + 1,
      };
      setDeckEntries(next);
    } else {
      setDeckEntries([
        ...deckEntries,
        {
          cardId: card.id,
          cardNumber: card.cardNumber,
          name: card.name,
          count: 1,
          imageUrl: card.imageUrl,
          variantKey: card.variantKey,
          variantBadge: card.variantBadge,
          variantStar: card.variantStar,
        },
      ]);
    }
  }

  // 减少特定异画版本投入数量
  function handleRemoveCard(entryKeyOrId: string) {
    const existingIdx = deckEntries.findIndex(
      (e) => (e.variantKey || e.cardId) === entryKeyOrId || e.cardId === entryKeyOrId || e.imageUrl === entryKeyOrId
    );
    if (existingIdx < 0) return;

    const current = deckEntries[existingIdx]!.count;
    if (current > 1) {
      const next = [...deckEntries];
      next[existingIdx] = { ...next[existingIdx]!, count: current - 1 };
      setDeckEntries(next);
    } else {
      setDeckEntries(deckEntries.filter((_, idx) => idx !== existingIdx));
    }
  }

  // 删除该卡牌异画条目
  function handleDeleteEntry(entryKeyOrId: string) {
    setDeckEntries(
      deckEntries.filter(
        (e) => (e.variantKey || e.cardId) !== entryKeyOrId && e.cardId !== entryKeyOrId && e.imageUrl !== entryKeyOrId
      )
    );
  }

  function handleSaveDeck() {
    const saved = localStorage.getItem('zhanshuang_user_decks');
    let list: any[] = [];
    if (saved) {
      try {
        list = JSON.parse(saved);
      } catch (e) {
        list = [];
      }
    }

    const currentId = deckId === 'new' ? `deck-${Date.now()}` : deckId;
    const firstRole = deckEntries.find((e) => {
      const c =
        cardMap.get(e.variantKey || '') ||
        cardMap.get(e.cardId) ||
        (e.imageUrl ? cardMap.get(e.imageUrl) : undefined);
      return c?.cardType === CardType.ROLE;
    });
    const coverImage = firstRole
      ? (firstRole.imageUrl || cardMap.get(firstRole.cardId)?.imageUrl)
      : undefined;

    const updatedDeck = {
      id: currentId,
      name: deckName,
      description: deckDesc,
      cards: deckEntries,
      coverImage,
      createdAt: Date.now(),
    };

    const existingIdx = list.findIndex((d) => d.id === currentId);
    if (existingIdx >= 0) {
      list[existingIdx] = updatedDeck;
    } else {
      list.unshift(updatedDeck);
    }

    localStorage.setItem('zhanshuang_user_decks', JSON.stringify(list));
    setSaveToast(true);
    setTimeout(() => setSaveToast(false), 2500);

    // 同步持久化至服务端数据库，确保联机房间与实战加载一致
    try {
      fetch('/api/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: currentId,
          name: deckName,
          description: deckDesc,
          cards: deckEntries.map((e) => ({
            cardId: e.cardId,
            cardNumber: e.cardNumber || cardMap.get(e.cardId)?.cardNumber || e.cardId.replace(/^c-/, '').toUpperCase(),
            count: e.count,
            imageUrl: e.imageUrl,
            variantKey: e.variantKey,
            variantBadge: e.variantBadge,
            variantStar: e.variantStar,
          })),
        }),
      }).catch(() => {});
    } catch {}

    if (deckId === 'new') {
      router.replace(`/decks/${currentId}`);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col h-screen overflow-hidden">
      {/* 顶部状态与保存条 */}
      <header className="h-16 px-6 border-b border-terminalBorder bg-surface flex items-center justify-between shrink-0 z-30 shadow-md">
        <div className="flex items-center gap-4">
          <Link
            href="/decks"
            className="p-2 rounded-lg border border-terminalBorder hover:border-terminalCyan text-neutral-400 hover:text-white transition-all flex items-center gap-1.5 text-xs font-mono"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回库</span>
          </Link>

          <div>
            <input
              type="text"
              value={deckName}
              onChange={(e) => setDeckName(e.target.value)}
              className="text-base font-bold bg-transparent border-b border-transparent hover:border-terminalBorder focus:border-terminalCyan outline-none text-white px-1 py-0.5"
            />
            <div className="text-[11px] text-neutral-400 font-mono px-1">
              构筑校验:{' '}
              {validationResult.isValid ? (
                <span className="text-terminalCyan font-bold">● 符合5.1规则 (50张)</span>
              ) : (
                <span className="text-erosionRed font-bold">
                  ● 规则不满足 ({validationResult.totalCards}/50张)
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {saveToast && (
            <span className="text-xs font-mono text-terminalCyan flex items-center gap-1 animate-pulse">
              <Check className="w-4 h-4" /> 保存成功
            </span>
          )}

          <button
            onClick={handleSaveDeck}
            className="px-5 py-2 rounded-lg bg-terminalCyan hover:bg-terminalCyan/90 text-neutral-950 font-bold text-xs font-mono flex items-center gap-2 shadow-lg transition-transform hover:scale-105"
          >
            <Save className="w-4 h-4" />
            <span>保存牌组</span>
          </button>
        </div>
      </header>

      {/* 主体工作区: 左侧卡池 65% + 右侧当前构筑 35% */}
      <div className="flex-1 flex overflow-hidden">
        {/* ================= 左侧卡池检索与上下滚动浏览区 (65%) ================= */}
        <div className="flex-1 flex flex-col border-r border-terminalBorder bg-background/50 overflow-hidden">
          {/* 筛选过滤工具条 */}
          <div className="p-3.5 border-b border-terminalBorder bg-surface/80 flex flex-col gap-2.5 shrink-0 shadow-sm">
            {/* 第一行：搜索框 + 卡包下拉 + 视图切换 + 结果计数 */}
            <div className="flex gap-2.5 items-center flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索卡牌编号、异画编号、名称、特征词条 (如 露西亚、BP01-001SR★)..."
                  className="w-full pl-9 pr-4 py-1.5 rounded-lg bg-neutral-950 border border-terminalBorder text-white text-xs font-mono focus:border-terminalCyan outline-none"
                />
              </div>

              {/* 卡包筛选下拉 */}
              <select
                value={selectedPackage}
                onChange={(e) => setSelectedPackage(e.target.value)}
                className="bg-neutral-950 border border-terminalBorder text-white text-xs font-mono rounded-lg px-2.5 py-1.5 focus:border-terminalCyan outline-none"
              >
                {PACKAGE_OPTIONS.map((pkg) => (
                  <option key={pkg.id} value={pkg.id} className="bg-neutral-900 text-white">
                    {pkg.label}
                  </option>
                ))}
              </select>

              {/* 卡牌浏览展示模式切换 */}
              <div className="flex items-center bg-neutral-950 rounded-lg p-0.5 border border-terminalBorder text-xs font-mono shrink-0">
                <button
                  onClick={() => setViewMode('GRID')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded transition-colors ${
                    viewMode === 'GRID'
                      ? 'bg-terminalCyan text-neutral-950 font-bold'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                  title="完整卡图网格列表"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>卡图瀑布流</span>
                </button>
                <button
                  onClick={() => setViewMode('LIST')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded transition-colors ${
                    viewMode === 'LIST'
                      ? 'bg-terminalCyan text-neutral-950 font-bold'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                  title="详细图文上下滚动清单"
                >
                  <List className="w-3.5 h-3.5" />
                  <span>图文清单</span>
                </button>
              </div>

              <div className="text-xs font-mono text-neutral-400 shrink-0">
                检索结果: <span className="text-terminalCyan font-bold">{filteredCards.length}</span> 张
              </div>
            </div>

            {/* 第二行：稀有度、异画、种类、属性、费用多维快捷标签 */}
            <div className="flex flex-wrap gap-2 text-xs font-mono items-center">
              {/* 稀有度 */}
              <div className="flex items-center bg-neutral-950 rounded-lg p-0.5 border border-terminalBorder">
                <span className="px-1.5 text-[10px] text-neutral-500 font-bold">稀有度</span>
                {RARITY_OPTIONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => setSelectedRarity(r)}
                    className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                      selectedRarity === r
                        ? 'bg-terminalCyan text-neutral-950 font-bold'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    {r === 'ALL' ? '全部' : r}
                  </button>
                ))}
              </div>

              {/* 异画 */}
              <div className="flex items-center bg-neutral-950 rounded-lg p-0.5 border border-terminalBorder">
                <span className="px-1.5 text-[10px] text-amber-500/80 font-bold">★异画</span>
                {VARIANT_OPTIONS.map((v) => (
                  <button
                    key={v}
                    onClick={() => setSelectedVariant(v)}
                    className={`px-1.5 py-0.5 rounded text-[11px] transition-colors ${
                      selectedVariant === v
                        ? 'bg-amber-400 text-neutral-950 font-bold'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    {v === 'ALL' ? '全部' : v}
                  </button>
                ))}
              </div>

              {/* 卡牌种类 */}
              <select
                value={selectedKind}
                onChange={(e) => setSelectedKind(e.target.value)}
                className="bg-neutral-950 border border-terminalBorder text-white text-[11px] font-mono rounded-lg px-2 py-1 focus:border-terminalCyan outline-none"
              >
                {KIND_OPTIONS.map((k) => (
                  <option key={k.id} value={k.id} className="bg-neutral-900 text-white">
                    {k.label}
                  </option>
                ))}
              </select>

              {/* 属性 */}
              <div className="flex items-center bg-neutral-950 rounded-lg p-0.5 border border-terminalBorder">
                {ATTR_OPTIONS.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedAttr(a.id)}
                    className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                      selectedAttr === a.id
                        ? 'bg-terminalCyan text-neutral-950 font-bold'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    {a.label}
                  </button>
                ))}
              </div>

              {/* 费用 */}
              <div className="flex items-center bg-neutral-950 rounded-lg p-0.5 border border-terminalBorder">
                <span className="px-1.5 text-[10px] text-neutral-500 font-bold">费用</span>
                {COST_OPTIONS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setSelectedCost(c)}
                    className={`px-1.5 py-0.5 rounded text-[11px] transition-colors ${
                      selectedCost === c
                        ? 'bg-terminalCyan text-neutral-950 font-bold'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    {c === 'ALL' ? '全' : c}
                  </button>
                ))}
              </div>

              {/* 重置筛选 */}
              {(searchQuery || selectedPackage !== 'ALL' || selectedRarity !== 'ALL' || selectedVariant !== 'ALL' || selectedKind !== 'ALL' || selectedAttr !== 'ALL' || selectedCost !== 'ALL') && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedPackage('ALL');
                    setSelectedRarity('ALL');
                    setSelectedVariant('ALL');
                    setSelectedKind('ALL');
                    setSelectedAttr('ALL');
                    setSelectedCost('ALL');
                  }}
                  className="px-2 py-1 rounded text-[11px] text-erosionRed hover:bg-erosionRed/10 border border-erosionRed/30 transition-colors"
                >
                  重置筛选
                </button>
              )}
            </div>
          </div>

          {/* ================= 上下垂直滚动卡牌列表 ================= */}
          <div className="flex-1 overflow-y-auto p-6">
            {viewMode === 'GRID' ? (
              /* 1. 卡图画廊模式：严格按照 63:88 比例，独立展示各个异画版本，同卡号共用4张上限 */
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-6">
                {filteredCards.map((card) => {
                  const coreNum = extractCoreCardNumber(card.cardNumber);
                  const totalCount = cardNumberTotalCounts.get(coreNum) || 0;
                  const inDeckCount =
                    variantSpecificCounts.get(card.variantKey) ||
                    variantSpecificCounts.get(card.id) ||
                    (card.imageUrl ? variantSpecificCounts.get(card.imageUrl) : 0) ||
                    0;
                  const isMax = totalCount >= 4;
                  const isSelected =
                    activeCardForPanel?.id === card.id ||
                    (activeCardForPanel?.cardNumber === card.cardNumber &&
                      (activeCardForPanel as any)?.variantKey === card.variantKey);

                  return (
                    <DeckCardGridItem
                      key={`${card.id}_${card.variantKey}`}
                      card={card}
                      inDeckCountForThisVariant={inDeckCount}
                      totalCountForCardNumber={totalCount}
                      isMax={isMax}
                      isSelected={isSelected}
                      onSelect={() => setSelectedCardForDetail(card)}
                      onLongPress={() => setInspectedCard(card)}
                      onAdd={() => handleAddCard(card)}
                      onRemove={() => handleRemoveCard(card.variantKey || card.id)}
                    />
                  );
                })}
              </div>
            ) : (
              /* 2. 图文清单列表模式：上下垂直滚动列表，独立展示各个异画版本，同卡号共用4张上限 */
              <div className="flex flex-col gap-4">
                {filteredCards.map((card) => {
                  const coreNum = extractCoreCardNumber(card.cardNumber);
                  const totalCount = cardNumberTotalCounts.get(coreNum) || 0;
                  const inDeckCount =
                    variantSpecificCounts.get(card.variantKey) ||
                    variantSpecificCounts.get(card.id) ||
                    (card.imageUrl ? variantSpecificCounts.get(card.imageUrl) : 0) ||
                    0;
                  const isMax = totalCount >= 4;
                  const isSelected =
                    activeCardForPanel?.id === card.id ||
                    (activeCardForPanel?.cardNumber === card.cardNumber &&
                      (activeCardForPanel as any)?.variantKey === card.variantKey);

                  return (
                    <DeckCardListItem
                      key={`${card.id}_${card.variantKey}`}
                      card={card}
                      inDeckCountForThisVariant={inDeckCount}
                      totalCountForCardNumber={totalCount}
                      isMax={isMax}
                      isSelected={isSelected}
                      onSelect={() => setSelectedCardForDetail(card)}
                      onLongPress={() => setInspectedCard(card)}
                      onAdd={() => handleAddCard(card)}
                      onRemove={() => handleRemoveCard(card.variantKey || card.id)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ================= 右侧当前卡组编排与统计面板 (35%) ================= */}
        <div className="w-[380px] xl:w-[440px] flex flex-col border-l border-terminalBorder bg-surface shrink-0 overflow-hidden font-mono shadow-xl">
          {/* 卡组规则统计指示 */}
          <div className="p-4 border-b border-terminalBorder bg-neutral-950/60 flex flex-col gap-3 shrink-0">
            <div className="flex justify-between items-center text-xs">
              <span className="text-neutral-400 font-bold">5.1 牌组规则状态</span>
              <span
                className={`px-2 py-0.5 rounded font-bold ${
                  validationResult.isValid
                    ? 'bg-terminalCyan/20 text-terminalCyan border border-terminalCyan/40'
                    : 'bg-erosionRed/20 text-erosionRed border border-erosionRed/40'
                }`}
              >
                {validationResult.isValid ? '完全合规 (LEGAL)' : '构筑未完成'}
              </span>
            </div>

            {/* 张数进度 */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2 rounded bg-surface border border-terminalBorder flex justify-between items-center">
                <span className="text-neutral-400">总卡牌数</span>
                <span
                  className={`font-bold ${
                    validationResult.totalCards === 50
                      ? 'text-terminalCyan'
                      : 'text-erosionRed'
                  }`}
                >
                  {validationResult.totalCards} / 50 张
                </span>
              </div>

              <div className="p-2 rounded bg-surface border border-terminalBorder flex justify-between items-center">
                <span className="text-neutral-400">信号球 (各4张)</span>
                <span className="font-bold flex items-center gap-1">
                  <span className="text-red-400">红{validationResult.redOrbCount}</span>
                  <span className="text-blue-400">蓝{validationResult.blueOrbCount}</span>
                  <span className="text-amber-400">黄{validationResult.yellowOrbCount}</span>
                </span>
              </div>
            </div>

            {/* 费用曲线柱状图 */}
            <div className="flex flex-col gap-1">
              <div className="text-[10px] text-neutral-500 flex justify-between">
                <span>费用分布曲线 (0..7+)</span>
              </div>
              <div className="h-14 flex items-end gap-1 px-1 bg-surface rounded border border-terminalBorder pt-1">
                {costCurve.map((count, cost) => {
                  const heightPercent = Math.min((count / 15) * 100, 100);
                  return (
                    <div key={cost} className="flex-1 flex flex-col items-center h-full justify-end">
                      <div
                        style={{ height: `${heightPercent}%` }}
                        className="w-full bg-terminalCyan/80 rounded-t min-h-[2px] transition-all duration-300"
                        title={`${cost}费: ${count}张`}
                      />
                      <span className="text-[9px] text-neutral-400 mt-0.5">{cost}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 校验错误提示 */}
            {!validationResult.isValid && validationResult.errors.length > 0 && (
              <div className="p-2.5 rounded bg-erosionRed/10 border border-erosionRed/30 text-erosionRed text-[11px] flex flex-col gap-1 max-h-20 overflow-y-auto">
                {validationResult.errors.map((err, i) => (
                  <div key={i} className="flex items-start gap-1">
                    <span>•</span>
                    <span>{err}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 当前卡组投入列表 */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
            <div className="flex justify-between items-center text-xs text-neutral-400 pb-1 border-b border-terminalBorder/40">
              <span>已投入卡单 ({deckEntries.length} 种)</span>
              <button
                onClick={() => setDeckEntries([])}
                className="text-neutral-500 hover:text-erosionRed text-[11px] transition-colors"
              >
                清空卡单
              </button>
            </div>

            {deckEntries.map((entry, idx) => {
              const card =
                cardMap.get(entry.variantKey || '') ||
                cardMap.get(entry.cardId) ||
                (entry.imageUrl ? cardMap.get(entry.imageUrl) : undefined) ||
                (entry.cardNumber ? cardMap.get(entry.cardNumber) : undefined);
              if (!card) return null;

              const coreNum = extractCoreCardNumber(entry.cardNumber || card.cardNumber);
              const totalCount = cardNumberTotalCounts.get(coreNum) || 0;
              const isCardNumberMax = totalCount >= 4;
              const entryKey = entry.variantKey || entry.cardId || `${idx}`;
              const isSelected = activeCardForPanel?.id === card.id;

              return (
                <div key={`${entryKey}_${idx}`} className="flex items-center gap-1">
                  <div className="flex-1 min-w-0">
                    <DeckEntryListItem
                      card={card}
                      entry={entry}
                      count={entry.count}
                      isCardNumberMax={isCardNumberMax}
                      isSelected={isSelected}
                      onSelect={() => setSelectedCardForDetail(card as any)}
                      onLongPress={() => setInspectedCard(card as any)}
                      onAdd={() => {
                        const variantEntry =
                          (card as any).variantKey
                            ? (card as CardVariantEntry)
                            : ALL_CARD_VARIANT_ENTRIES.find(
                                (v) => v.imageUrl === entry.imageUrl || v.cardNumber === card.cardNumber
                              );
                        if (variantEntry) {
                          handleAddCard(variantEntry);
                        } else {
                          if (totalCount < 4) {
                            const next = [...deckEntries];
                            next[idx] = { ...next[idx]!, count: next[idx]!.count + 1 };
                            setDeckEntries(next);
                          }
                        }
                      }}
                      onRemove={() => handleRemoveCard(entry.variantKey || entry.cardId)}
                    />
                  </div>
                  <button
                    onClick={() => handleDeleteEntry(entry.variantKey || entry.cardId)}
                    className="text-neutral-500 hover:text-erosionRed p-1.5 transition-colors rounded-lg border border-transparent hover:border-erosionRed/40 hover:bg-erosionRed/10"
                    title="删除此卡全部投入"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* 重点新特性：卡牌效果详情面板 */}
          <div className="p-3 border-t border-terminalBorder bg-neutral-950/80 shrink-0">
            <div className="flex items-center justify-between text-xs text-neutral-300 font-bold mb-1.5 font-mono">
              <span>卡牌战术详情 (点击卡牌查看)</span>
              {activeCardForPanel && (
                <button
                  onClick={() => setInspectedCard(activeCardForPanel)}
                  className="text-[10px] text-terminalCyan hover:underline font-bold"
                >
                  放大大图 (长按)
                </button>
              )}
            </div>
            <CardDetailPanel
              card={activeCardForPanel}
              selectedImageUrl={activeCardForPanel?.imageUrl}
              onOpenModal={() => {
                if (activeCardForPanel) setInspectedCard(activeCardForPanel);
              }}
              customAction={
                activeCardForPanel ? (() => {
                  const coreNum = extractCoreCardNumber(activeCardForPanel.cardNumber);
                  const totalCount = cardNumberTotalCounts.get(coreNum) || 0;
                  const variantKey = (activeCardForPanel as any).variantKey || activeCardForPanel.id;
                  const inDeckVariant =
                    variantSpecificCounts.get(variantKey) ||
                    (activeCardForPanel.imageUrl ? variantSpecificCounts.get(activeCardForPanel.imageUrl) : 0) ||
                    0;
                  const isMax = totalCount >= 4;

                  return (
                    <div className="flex items-center gap-1.5 font-mono">
                      {inDeckVariant > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveCard(variantKey);
                          }}
                          className="px-2 py-0.5 rounded border border-neutral-700 hover:border-erosionRed hover:text-erosionRed text-xs"
                          title="从卡组移除1张本异画"
                        >
                          -1
                        </button>
                      )}
                      <span className="text-xs text-neutral-300 font-bold px-1">
                        已入 {inDeckVariant} (同号 {totalCount}/4)
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          const targetVariant = (activeCardForPanel as any).variantKey
                            ? (activeCardForPanel as CardVariantEntry)
                            : ALL_CARD_VARIANT_ENTRIES.find((v) => v.cardNumber === activeCardForPanel.cardNumber);
                          if (targetVariant) handleAddCard(targetVariant);
                        }}
                        disabled={isMax}
                        className="px-2.5 py-0.5 rounded bg-terminalCyan text-neutral-950 font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                        title={isMax ? '该卡牌编号所有异画合计已达4张上限' : '投入卡组+1'}
                      >
                        +1 投入
                      </button>
                    </div>
                  );
                })() : undefined
              }
            />
          </div>
        </div>
      </div>

      {/* 超清卡牌大图与完整效果检视弹窗 (长按卡牌触发) */}
      <CardDetailModal
        card={inspectedCard}
        isOpen={!!inspectedCard}
        selectedImageUrl={inspectedCard?.imageUrl}
        onClose={() => setInspectedCard(null)}
        actionButton={
          inspectedCard ? (() => {
            const coreNum = extractCoreCardNumber(inspectedCard.cardNumber);
            const totalCount = cardNumberTotalCounts.get(coreNum) || 0;
            const variantKey = (inspectedCard as any).variantKey || inspectedCard.id;
            const inDeckVariant =
              variantSpecificCounts.get(variantKey) ||
              (inspectedCard.imageUrl ? variantSpecificCounts.get(inspectedCard.imageUrl) : 0) ||
              0;
            const isMax = totalCount >= 4;

            return (
              <div className="flex items-center gap-2">
                {inDeckVariant > 0 && (
                  <button
                    onClick={() => handleRemoveCard(variantKey)}
                    className="px-4 py-2 rounded-xl border border-neutral-700 hover:border-erosionRed hover:text-erosionRed text-xs font-mono font-bold transition-colors"
                  >
                    移除 1 张 (本版已入 {inDeckVariant})
                  </button>
                )}
                <button
                  onClick={() => {
                    const targetVariant = (inspectedCard as any).variantKey
                      ? (inspectedCard as CardVariantEntry)
                      : ALL_CARD_VARIANT_ENTRIES.find((v) => v.cardNumber === inspectedCard.cardNumber);
                    if (targetVariant) handleAddCard(targetVariant);
                  }}
                  disabled={isMax}
                  className="px-5 py-2 rounded-xl bg-terminalCyan hover:bg-terminalCyan/90 text-neutral-950 font-bold text-xs font-mono disabled:opacity-40 disabled:cursor-not-allowed transition-transform hover:scale-105"
                  title={isMax ? '该卡牌编号所有异画合计已达4张上限' : '投入卡组+1'}
                >
                  {isMax ? '同编号已达4张上限' : `投入卡组 (+1, 同号 ${totalCount}/4)`}
                </button>
              </div>
            );
          })() : undefined
        }
      />
    </div>
  );
}
