'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useRouteId } from '@/lib/route-id';
import { useAuth } from '@/lib/auth-context';
import { apiUrl } from '@/lib/api';
import Link from 'next/link';
import {
  ALL_OFFICIAL_CARDS,
  ALL_CARD_VARIANT_ENTRIES,
  CardData,
  CardVariantEntry,
  formatCardType,
  getAttributeDisplay,
} from '@/lib/cards-data';
import { findOfficialStarterDeck } from '@/lib/starter-decks';
import { CardType, ElementAttribute } from '@zhanshuang/shared';
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
  Sparkles,
  Check,
  ZoomIn,
  LayoutGrid,
  List,
  X,
} from 'lucide-react';
import { CardDetailPanel } from '@/components/game/CardDetailPanel';
import { CardDetailModal } from '@/components/game/CardDetailModal';
import { useLongPress } from '@/hooks/useLongPress';
import { getCardThumbnailUrl, getCardFullImageUrl, handleThumbnailError } from '@/lib/card-image';
import { Button, Badge, HudBrackets } from '@/components/ui';

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

function CardFallback({ card }: { card: CardData }) {
  const attr = getAttributeDisplay(card.attribute, card.attributeName);
  return (
    <div className="w-full h-full p-2.5 flex flex-col justify-between border border-line bg-ink-900 select-none">
      <div className="flex justify-between items-center pb-1.5 border-b border-line">
        <div className="flex items-center gap-1.5">
          <span className="h-5 min-w-5 px-1 bg-ink-950 border border-line-strong text-gold-300 font-num text-caption font-bold inline-flex items-center justify-center">
            {card.cost}
          </span>
          <span className="font-num text-hud text-fg-secondary">{card.cardNumber}</span>
        </div>
        <span className={`px-1 border text-hud ${attr.tagColor}`}>
          {card.attributeName || (card.attribute === ElementAttribute.VOID ? '空' : card.attribute)}
        </span>
      </div>

      <div className="flex-1 my-2 bg-ink-950 border border-line flex flex-col items-center justify-center p-2 text-center">
        <span className="text-body-sm font-semibold text-fg leading-tight">{card.name}</span>
        <span className="text-hud text-fg-muted mt-1">
          {formatCardType(card.cardType, card.isInstant)}
        </span>
      </div>

      <div className="text-hud text-fg-secondary line-clamp-3 bg-ink-950/80 p-1.5 border border-line leading-snug">
        {card.rulesText || '无特殊效果'}
      </div>

      {card.basePP !== undefined && (
        <div className="flex justify-between items-center font-num text-caption pt-1.5 border-t border-line font-semibold">
          <span className="text-fg">{card.basePP} PP</span>
          <span className="text-crimson-400">{card.baseDP ?? 0} DP</span>
        </div>
      )}
    </div>
  );
}

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
      className={`group relative aspect-[63/88] w-full rounded-card overflow-hidden border transition-all duration-fast ease-enter cursor-pointer select-none bg-ink-950 ${
        isSelected
          ? 'border-fg'
          : isMax
            ? 'border-gold-300/60'
            : inDeckCountForThisVariant > 0
              ? 'border-teal-400'
              : 'border-line hover:border-line-strong hover:-translate-y-0.5'
      }`}
      title={`${card.name} (${card.cardNumber} · ${card.variantBadge || card.variantName}) - 点击查看详情，长按查看大图`}
    >
      {isSelected && <HudBrackets color="white" size="md" className="z-30" />}

      {card.imageUrl ? (
        <img
          src={getCardThumbnailUrl(card.imageUrl, card.cardNumber)}
          alt={card.name}
          className={`w-full h-full object-fill block transition-transform duration-base ease-enter group-hover:scale-[1.03] ${
            isMax ? 'brightness-[0.65]' : ''
          }`}
          loading="lazy"
          onError={(e) => {
            handleThumbnailError(e, card.imageUrl || `/cards/${card.cardNumber}.png`);
          }}
        />
      ) : (
        <CardFallback card={card} />
      )}

      {/* 已投入底部 2px teal 指示条 (design-spec 6) */}
      {inDeckCountForThisVariant > 0 && (
        <span aria-hidden="true" className="absolute bottom-0 inset-x-0 h-0.5 bg-teal-400 z-20" />
      )}

      {/* 左上角形态徽章 */}
      <div
        className={`absolute top-2 left-2 z-20 px-1.5 h-5 border backdrop-blur-md font-num text-hud inline-flex items-center gap-1 ${
          isFoil
            ? 'bg-ink-950/90 border-gold-300/70 text-gold-300 font-semibold'
            : 'bg-ink-950/85 border-line text-fg-secondary'
        }`}
      >
        {isFoil && <Sparkles className="w-2.5 h-2.5" />}
        <span>{card.variantBadge || card.variantRarity || card.rarity || '原画'}</span>
      </div>

      {/* 右上角投入张数角标 */}
      {totalCountForCardNumber > 0 && (
        <div
          className={`absolute top-2 right-2 px-1.5 h-5 backdrop-blur-md border font-num tabular-nums text-hud font-semibold inline-flex items-center gap-1 z-20 ${
            isMax
              ? 'bg-ink-950/95 border-gold-300 text-gold-300'
              : 'bg-ink-950/90 border-teal-400 text-teal-400'
          }`}
        >
          {inDeckCountForThisVariant > 0 && (
            <>
              <span className="text-fg">{inDeckCountForThisVariant}</span>
              <span className="text-fg-disabled">/</span>
            </>
          )}
          <span>同号 {totalCountForCardNumber}/4</span>
        </div>
      )}

      {/* 达 4 张上限标识 */}
      {isMax && (
        <div className="absolute inset-0 bg-ink-950/45 flex items-center justify-center pointer-events-none z-20">
          <span className="px-3 py-1 bg-ink-950/95 border border-gold-300 text-gold-300 font-num text-caption font-bold tracking-wider">
            MAX 4/4
          </span>
        </div>
      )}

      {/* 悬浮快捷加减与放大 */}
      <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-ink-950 via-ink-950/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-fast flex items-center justify-between gap-2 z-30">
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {inDeckCountForThisVariant > 0 && (
            <button
              type="button"
              onClick={onRemove}
              aria-label="移除一张"
              className="h-7 w-7 bg-ink-900 border border-line-strong hover:border-crimson-500 hover:text-crimson-400 text-fg inline-flex items-center justify-center transition-colors cursor-pointer"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onAdd}
            disabled={isMax}
            className={`h-7 px-2.5 font-medium text-caption inline-flex items-center gap-1 transition-colors cursor-pointer ${
              isMax
                ? 'bg-ink-600 text-fg-disabled cursor-not-allowed'
                : 'bg-crimson-500 text-fg hover:bg-crimson-hover clip-corner-sm'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>投入</span>
          </button>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onLongPress();
          }}
          aria-label="查看大图"
          className="h-7 w-7 bg-ink-900 border border-line-strong hover:border-teal-400 hover:text-teal-400 text-fg-secondary inline-flex items-center justify-center transition-colors cursor-pointer"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

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
      className={`p-3 border transition-colors duration-fast flex items-center gap-4 cursor-pointer select-none ${
        isSelected
          ? 'border-fg bg-ink-800 border-l-2 border-l-crimson-500'
          : inDeckCountForThisVariant > 0
            ? 'border-teal-400/60 bg-ink-850'
            : 'border-line bg-ink-850 hover:border-line-strong hover:bg-ink-800'
      }`}
    >
      <div className="w-20 aspect-[63/88] rounded-card overflow-hidden border border-line shrink-0 bg-ink-950 relative">
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
          <CardFallback card={card} />
        )}
        <button
          type="button"
          aria-label="放大查看"
          onClick={(e) => {
            e.stopPropagation();
            onLongPress();
          }}
          className="absolute inset-0 bg-ink-950/60 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center text-fg cursor-pointer"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-1.5 flex-wrap text-caption">
          <Badge variant="crimson" className="font-num">{card.cardNumber}</Badge>
          <Badge variant={isFoil ? 'gold' : 'neutral'} className="font-num">
            {card.variantBadge || card.variantRarity || card.rarity || '原画'}
          </Badge>
          <span className="text-fg-muted">
            {formatCardType(card.cardType, card.isInstant)} · {card.attributeName || card.attribute}
          </span>
          <span className="font-num text-gold-300 font-semibold">{card.cost}费</span>
          {card.basePP !== undefined && (
            <span className="font-num text-fg font-semibold">{card.basePP} PP</span>
          )}
          {card.baseDP !== undefined && (
            <span className="font-num text-crimson-400 font-semibold">{card.baseDP} DP</span>
          )}
        </div>

        <h3 className="text-body font-semibold text-fg truncate">
          {card.name}
          {card.variantName && card.variantName !== '基础标准' && (
            <span className="ml-2 text-caption text-gold-300 font-normal">
              ({card.variantName})
            </span>
          )}
        </h3>

        <p className="text-caption text-fg-secondary line-clamp-2 bg-ink-900 px-2.5 py-1.5 border border-line">
          {card.rulesText || '无特殊规则效果。'}
        </p>
      </div>

      <div
        className="flex flex-col items-end gap-2 shrink-0 pl-3 border-l border-line"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-caption font-num tabular-nums text-right">
          <div className="text-fg-muted">
            本版 <strong className="text-fg">{inDeckCountForThisVariant}</strong>
          </div>
          <div className={isMax ? 'text-gold-300' : 'text-teal-400'}>
            同号 {totalCountForCardNumber}/4
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {inDeckCountForThisVariant > 0 && (
            <Button variant="icon" size="sm" aria-label="减少一张" onClick={onRemove}>
              <Minus className="w-3.5 h-3.5" />
            </Button>
          )}
          <Button variant="primary" size="sm" disabled={isMax} onClick={onAdd}>
            +1
          </Button>
        </div>
      </div>
    </div>
  );
}

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
      className={`flex items-center justify-between px-2.5 py-2 border transition-colors duration-fast cursor-pointer ${
        isSelected
          ? 'border-line-strong border-l-2 border-l-crimson-500 bg-ink-700'
          : 'border-line bg-ink-850 hover:bg-ink-800'
      }`}
    >
      <div className="flex items-center gap-2.5 overflow-hidden flex-1 mr-2">
        <div className="w-8 aspect-[63/88] rounded-card border border-line overflow-hidden shrink-0 bg-ink-950 flex items-center justify-center">
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
            <span className="font-num text-hud text-gold-300 font-bold">{card.cost}</span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-caption font-semibold text-fg truncate">
            {entry.name || card.name}
          </div>
          <div className="flex items-center gap-1.5 text-hud text-fg-muted mt-0.5 font-num">
            <span>{entry.cardNumber || card.cardNumber}</span>
            <span className={isFoil ? 'text-gold-300' : 'text-fg-disabled'}>{badge}</span>
            <span className="text-gold-300">{card.cost}费</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center bg-ink-950 border border-line">
          <button
            type="button"
            onClick={onRemove}
            aria-label="减少一张"
            className="h-6 w-6 inline-flex items-center justify-center text-fg-muted hover:text-fg cursor-pointer"
          >
            <Minus className="w-3 h-3" />
          </button>
          <span className="px-2 font-num tabular-nums text-caption font-bold text-teal-400">
            {count}
          </span>
          <button
            type="button"
            onClick={onAdd}
            disabled={isCardNumberMax}
            aria-label="增加一张"
            className="h-6 w-6 inline-flex items-center justify-center text-fg-muted hover:text-fg disabled:text-fg-disabled disabled:cursor-not-allowed cursor-pointer"
          >
            <Plus className="w-3 h-3" />
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
  const { isLoggedIn, authFetch } = useAuth();

  const [deckName, setDeckName] = useState('新编制战术卡组');
  const [deckDesc, setDeckDesc] = useState('灰鸦/升格者战术联调构筑');
  const [deckEntries, setDeckEntries] = useState<DeckEntry[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPackage, setSelectedPackage] = useState<string>('ALL');
  const [selectedRarity, setSelectedRarity] = useState<string>('ALL');
  const [selectedVariant, setSelectedVariant] = useState<string>('ALL');
  const [selectedKind, setSelectedKind] = useState<string>('ALL');
  const [selectedAttr, setSelectedAttr] = useState<string>('ALL');
  const [selectedCost, setSelectedCost] = useState<string>('ALL');

  const [viewMode, setViewMode] = useState<'GRID' | 'LIST'>('GRID');
  const [mobileTab, setMobileTab] = useState<'POOL' | 'DECK'>('POOL');
  const [inspectedCard, setInspectedCard] = useState<CardVariantEntry | CardData | null>(null);
  const [selectedCardForDetail, setSelectedCardForDetail] = useState<
    CardVariantEntry | CardData | null
  >(null);
  const [saveToast, setSaveToast] = useState(false);

  const isOfficialPreset = Boolean(findOfficialStarterDeck(deckId));

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
        })),
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
          if (found.cards) setDeckEntries(found.cards);
        }
      } catch (e) {
        console.error(e);
      }
    }
  }, [deckId]);

  const cardMap = useMemo(() => {
    const map = new Map<string, CardVariantEntry | CardData>();
    for (const c of ALL_OFFICIAL_CARDS) {
      map.set(c.id, c);
      map.set(c.cardNumber, c);
    }
    for (const v of ALL_CARD_VARIANT_ENTRIES) {
      map.set(v.id, v);
      map.set(v.variantKey, v);
      if (v.imageUrl) map.set(v.imageUrl, v);
    }
    return map;
  }, []);

  const cardNumberTotalCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of deckEntries) {
      const card =
        cardMap.get(entry.variantKey || '') ||
        cardMap.get(entry.cardId) ||
        (entry.imageUrl ? cardMap.get(entry.imageUrl) : undefined) ||
        (entry.cardNumber ? cardMap.get(entry.cardNumber) : undefined);
      const rawNum =
        entry.cardNumber || card?.cardNumber || entry.cardId.replace(/^c-/, '').toUpperCase();
      const coreNum = extractCoreCardNumber(rawNum);
      counts.set(coreNum, (counts.get(coreNum) || 0) + entry.count);
    }
    return counts;
  }, [deckEntries, cardMap]);

  const variantSpecificCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of deckEntries) {
      if (entry.variantKey) counts.set(entry.variantKey, (counts.get(entry.variantKey) || 0) + entry.count);
      if (entry.cardId) counts.set(entry.cardId, (counts.get(entry.cardId) || 0) + entry.count);
      if (entry.imageUrl) counts.set(entry.imageUrl, (counts.get(entry.imageUrl) || 0) + entry.count);
    }
    return counts;
  }, [deckEntries]);

  const filteredCards = useMemo(() => {
    return ALL_CARD_VARIANT_ENTRIES.filter((card) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const match =
          card.cardNumber.toLowerCase().includes(q) ||
          card.variantKey.toLowerCase().includes(q) ||
          card.name.toLowerCase().includes(q) ||
          card.traits.some((t) => t.toLowerCase().includes(q)) ||
          card.rulesText.toLowerCase().includes(q);
        if (!match) return false;
      }

      if (selectedPackage !== 'ALL') {
        const p = selectedPackage;
        const code = p.split('-')[0] || '';
        const pkg = card.packageName || card.flavorText || '';
        if (pkg) {
          if (!pkg.includes(p) && !pkg.includes(code)) return false;
        } else if (!card.cardNumber.startsWith(code)) {
          return false;
        }
      }

      if (selectedRarity !== 'ALL' && (card.variantRarity || card.rarity) !== selectedRarity) {
        return false;
      }

      if (selectedVariant !== 'ALL') {
        const starCount = (selectedVariant.match(/★+/)?.[0] || '').length;
        const targetR = selectedVariant.replace(/★+/g, '').trim();
        if (starCount > 0 && card.variantStar !== starCount) return false;
        if (targetR && (card.variantRarity || card.rarity) !== targetR) return false;
      }

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

      if (selectedAttr !== 'ALL' && (card.attributeName || card.attribute) !== selectedAttr) {
        return false;
      }

      if (selectedCost !== 'ALL' && card.cost !== Number(selectedCost)) {
        return false;
      }

      return true;
    });
  }, [
    searchQuery,
    selectedPackage,
    selectedRarity,
    selectedVariant,
    selectedKind,
    selectedAttr,
    selectedCost,
  ]);

  const validationResult: DeckValidationResult = useMemo(() => {
    const inputs: DeckCardInput[] = [];
    for (const entry of deckEntries) {
      const card =
        cardMap.get(entry.variantKey || '') ||
        cardMap.get(entry.cardId) ||
        (entry.imageUrl ? cardMap.get(entry.imageUrl) : undefined) ||
        (entry.cardNumber ? cardMap.get(entry.cardNumber) : undefined);
      const rawNum =
        entry.cardNumber || card?.cardNumber || entry.cardId.replace(/^c-/, '').toUpperCase();
      inputs.push({
        cardId: entry.cardId,
        cardNumber: rawNum,
        name: entry.name || card?.name || rawNum,
        signalOrb: card?.signalOrb,
        count: entry.count,
      });
    }
    return validateDeck(inputs);
  }, [deckEntries, cardMap]);

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

  function handleAddCard(card: CardVariantEntry) {
    const coreNum = extractCoreCardNumber(card.cardNumber);
    const totalCount = cardNumberTotalCounts.get(coreNum) || 0;
    if (totalCount >= 4) return;

    const targetKey = card.variantKey || card.id;
    const existingIdx = deckEntries.findIndex(
      (e) =>
        (e.variantKey || e.cardId) === targetKey ||
        (e.imageUrl && e.imageUrl === card.imageUrl),
    );
    if (existingIdx >= 0) {
      const next = [...deckEntries];
      next[existingIdx] = { ...next[existingIdx]!, count: next[existingIdx]!.count + 1 };
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

  function handleRemoveCard(entryKeyOrId: string) {
    const existingIdx = deckEntries.findIndex(
      (e) =>
        (e.variantKey || e.cardId) === entryKeyOrId ||
        e.cardId === entryKeyOrId ||
        e.imageUrl === entryKeyOrId,
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

  function handleDeleteEntry(entryKeyOrId: string) {
    setDeckEntries(
      deckEntries.filter(
        (e) =>
          (e.variantKey || e.cardId) !== entryKeyOrId &&
          e.cardId !== entryKeyOrId &&
          e.imageUrl !== entryKeyOrId,
      ),
    );
  }

  function handleSaveDeck() {
    const saved = localStorage.getItem('zhanshuang_user_decks');
    let list: any[] = [];
    if (saved) {
      try {
        list = JSON.parse(saved);
      } catch {
        list = [];
      }
    }

    const currentId = deckId === 'new' || isOfficialPreset ? `deck-${Date.now()}` : deckId;
    const firstRole = deckEntries.find((e) => {
      const c =
        cardMap.get(e.variantKey || '') ||
        cardMap.get(e.cardId) ||
        (e.imageUrl ? cardMap.get(e.imageUrl) : undefined);
      return c?.cardType === CardType.ROLE;
    });
    const coverImage = firstRole
      ? firstRole.imageUrl || cardMap.get(firstRole.cardId)?.imageUrl
      : undefined;

    const updatedDeck = {
      id: currentId,
      name: isOfficialPreset ? `${deckName} (自定义)` : deckName,
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

    if (isLoggedIn) {
      try {
        authFetch(apiUrl('/api/decks'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: currentId,
            name: updatedDeck.name,
            description: deckDesc,
            cards: deckEntries.map((e) => ({
              cardId: e.cardId,
              cardNumber:
                e.cardNumber ||
                cardMap.get(e.cardId)?.cardNumber ||
                e.cardId.replace(/^c-/, '').toUpperCase(),
              count: e.count,
              imageUrl: e.imageUrl,
              variantKey: e.variantKey,
              variantBadge: e.variantBadge,
              variantStar: e.variantStar,
            })),
          }),
        }).catch(() => {});
      } catch {}
    }

    if (deckId === 'new' || isOfficialPreset) {
      router.replace(`/decks/${currentId}`);
    }
  }

  const hasFilters =
    Boolean(searchQuery) ||
    selectedPackage !== 'ALL' ||
    selectedRarity !== 'ALL' ||
    selectedVariant !== 'ALL' ||
    selectedKind !== 'ALL' ||
    selectedAttr !== 'ALL' ||
    selectedCost !== 'ALL';

  const miniChip = (active: boolean) =>
    `h-6 px-2 text-hud transition-colors cursor-pointer ${
      active
        ? 'bg-crimson-500 text-fg font-semibold'
        : 'text-fg-muted hover:text-fg'
    }`;

  return (
    <div className="min-h-screen h-screen bg-ink-950 text-fg flex flex-col overflow-hidden">
      {/* 顶部 56px 构筑工作台栏 */}
      <header className="h-14 px-4 md:px-6 border-b border-line bg-ink-900 flex items-center justify-between gap-3 shrink-0 z-sticky">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/decks" className="shrink-0">
            <Button variant="secondary" size="sm">
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">返回卡组库</span>
            </Button>
          </Link>

          <div className="min-w-0">
            <input
              type="text"
              value={deckName}
              aria-label="卡组名称"
              onChange={(e) => setDeckName(e.target.value)}
              className="text-body font-bold bg-transparent border-b border-transparent hover:border-line focus:border-teal-400 focus:outline-none text-fg px-1 max-w-44 sm:max-w-72 truncate"
            />
            <div className="flex items-center gap-2 px-1 text-hud">
              <span
                className={`font-num tabular-nums ${
                  validationResult.isValid ? 'text-teal-400' : 'text-crimson-400'
                }`}
              >
                {validationResult.isValid
                  ? '● 5.1 规则合规 (50/50)'
                  : `● 未达构筑标准 (${validationResult.totalCards}/50)`}
              </span>
              {isOfficialPreset && <Badge variant="gold">官方预组（保存将存为新副本）</Badge>}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          {/* 窄屏视图切换 */}
          <div className="flex lg:hidden border border-line bg-ink-950">
            <button
              type="button"
              onClick={() => setMobileTab('POOL')}
              className={`h-8 px-2.5 text-caption cursor-pointer ${
                mobileTab === 'POOL' ? 'bg-crimson-500 text-fg' : 'text-fg-muted'
              }`}
            >
              卡池
            </button>
            <button
              type="button"
              onClick={() => setMobileTab('DECK')}
              className={`h-8 px-2.5 text-caption font-num cursor-pointer ${
                mobileTab === 'DECK' ? 'bg-crimson-500 text-fg' : 'text-fg-muted'
              }`}
            >
              卡单 ({validationResult.totalCards})
            </button>
          </div>

          {saveToast && (
            <span className="hidden sm:inline-flex items-center gap-1 text-caption text-success animate-in fade-in duration-fast">
              <Check className="w-3.5 h-3.5" />
              <span>已保存</span>
            </span>
          )}

          <Button variant="primary" size="md" onClick={handleSaveDeck}>
            <Save className="w-4 h-4" />
            <span>{isOfficialPreset ? '另存为副本' : '保存牌组'}</span>
          </Button>
        </div>
      </header>

      {/* 主体左右工作区 */}
      <div className="flex-1 flex overflow-hidden">
        {/* ================= 左侧卡池浏览区 (钢蓝微网格) ================= */}
        <div
          className={`flex-1 flex-col border-r border-line bg-steel-grid overflow-hidden ${
            mobileTab === 'POOL' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {/* 筛选工具条 */}
          <div className="p-3 border-b border-line bg-ink-900/95 space-y-2.5 shrink-0">
            <div className="flex gap-2 items-center flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-fg-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  aria-label="搜索卡池"
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索卡号、异画编号、角色名、特征词条..."
                  className="w-full h-8 pl-9 pr-8 bg-ink-800 border border-line text-fg text-caption focus:border-teal-400 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label="清空搜索"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <select
                value={selectedPackage}
                aria-label="筛选卡包"
                onChange={(e) => setSelectedPackage(e.target.value)}
                className="h-8 bg-ink-800 border border-line text-fg text-caption px-2.5 focus:border-teal-400 focus:outline-none"
              >
                {PACKAGE_OPTIONS.map((pkg) => (
                  <option key={pkg.id} value={pkg.id} className="bg-ink-900">
                    {pkg.label}
                  </option>
                ))}
              </select>

              <div className="inline-flex border border-line bg-ink-950">
                <button
                  type="button"
                  onClick={() => setViewMode('GRID')}
                  className={`h-8 px-2.5 inline-flex items-center gap-1 text-caption transition-colors cursor-pointer ${
                    viewMode === 'GRID' ? 'bg-crimson-500 text-fg' : 'text-fg-muted hover:text-fg'
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span>卡图</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('LIST')}
                  className={`h-8 px-2.5 inline-flex items-center gap-1 text-caption transition-colors cursor-pointer ${
                    viewMode === 'LIST' ? 'bg-crimson-500 text-fg' : 'text-fg-muted hover:text-fg'
                  }`}
                >
                  <List className="w-3.5 h-3.5" />
                  <span>清单</span>
                </button>
              </div>

              <span className="font-num tabular-nums text-caption text-fg-muted">
                <strong className="text-fg">{filteredCards.length}</strong> 张
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5 items-center">
              <div className="inline-flex items-center bg-ink-950 border border-line">
                <span className="px-2 text-hud text-fg-muted">稀有度</span>
                {RARITY_OPTIONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setSelectedRarity(r)}
                    className={`${miniChip(selectedRarity === r)} font-num`}
                  >
                    {r === 'ALL' ? '全' : r}
                  </button>
                ))}
              </div>

              <div className="inline-flex items-center bg-ink-950 border border-line">
                <span className="px-2 text-hud text-gold-300">异画</span>
                {VARIANT_OPTIONS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setSelectedVariant(v)}
                    className={`${miniChip(selectedVariant === v)} font-num`}
                  >
                    {v === 'ALL' ? '全' : v}
                  </button>
                ))}
              </div>

              <select
                value={selectedKind}
                aria-label="筛选种类"
                onChange={(e) => setSelectedKind(e.target.value)}
                className="h-6 bg-ink-950 border border-line text-fg text-hud px-2 focus:border-teal-400 focus:outline-none"
              >
                {KIND_OPTIONS.map((k) => (
                  <option key={k.id} value={k.id} className="bg-ink-900">
                    {k.label}
                  </option>
                ))}
              </select>

              <div className="inline-flex items-center bg-ink-950 border border-line">
                {ATTR_OPTIONS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelectedAttr(a.id)}
                    className={miniChip(selectedAttr === a.id)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>

              <div className="inline-flex items-center bg-ink-950 border border-line">
                <span className="px-2 text-hud text-fg-muted">费</span>
                {COST_OPTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setSelectedCost(c)}
                    className={`${miniChip(selectedCost === c)} font-num`}
                  >
                    {c === 'ALL' ? '全' : c}
                  </button>
                ))}
              </div>

              {hasFilters && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedPackage('ALL');
                    setSelectedRarity('ALL');
                    setSelectedVariant('ALL');
                    setSelectedKind('ALL');
                    setSelectedAttr('ALL');
                    setSelectedCost('ALL');
                  }}
                  className="h-6 px-2 border border-crimson-500/60 text-hud text-crimson-400 hover:bg-crimson-700/20 cursor-pointer"
                >
                  重置
                </button>
              )}
            </div>
          </div>

          {/* 卡池内容滚动区 */}
          <div className="flex-1 overflow-y-auto p-4 md:p-5 bg-ink-950/65">
            {viewMode === 'GRID' ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
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
              <div className="space-y-3">
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

        {/* ================= 右侧当前卡组编排与统计面板 ================= */}
        <aside
          className={`w-full lg:w-[380px] xl:w-[430px] flex-col bg-ink-900 shrink-0 overflow-hidden ${
            mobileTab === 'DECK' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {/* 5.1 规则状态与曲线 */}
          <div className="p-4 border-b border-line bg-ink-950/70 space-y-3 shrink-0">
            <div className="flex justify-between items-center">
              <span className="font-display text-hud uppercase text-fg-muted">
                RULE 5.1 // VALIDATOR
              </span>
              <Badge variant={validationResult.isValid ? 'teal' : 'crimson'}>
                {validationResult.isValid ? '完全合规 LEGAL' : '构筑未完成'}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2 text-caption">
              <div className="px-3 py-2 bg-ink-850 border border-line flex justify-between items-center">
                <span className="text-fg-muted">总张数</span>
                <span
                  className={`font-num tabular-nums font-bold ${
                    validationResult.totalCards === 50 ? 'text-teal-400' : 'text-crimson-400'
                  }`}
                >
                  {validationResult.totalCards} / 50
                </span>
              </div>

              <div className="px-3 py-2 bg-ink-850 border border-line flex justify-between items-center">
                <span className="text-fg-muted">信号球</span>
                <span className="font-num tabular-nums font-bold inline-flex items-center gap-1.5">
                  <span className="text-orb-red">R{validationResult.redOrbCount}</span>
                  <span className="text-orb-blue">B{validationResult.blueOrbCount}</span>
                  <span className="text-orb-yellow">Y{validationResult.yellowOrbCount}</span>
                </span>
              </div>
            </div>

            {/* 费用分布柱状图 */}
            <div className="space-y-1">
              <div className="font-display text-hud uppercase text-fg-muted flex justify-between">
                <span>COST CURVE (0..7+)</span>
              </div>
              <div className="h-14 flex items-end gap-1 px-2 pt-2 pb-1 bg-ink-850 border border-line">
                {costCurve.map((count, cost) => {
                  const heightPercent = Math.min((count / 15) * 100, 100);
                  return (
                    <div
                      key={cost}
                      className="flex-1 flex flex-col items-center h-full justify-end"
                      title={`${cost}费: ${count}张`}
                    >
                      <div
                        style={{ height: `${heightPercent}%` }}
                        className="w-full bg-teal-400/80 min-h-[2px] transition-all duration-base ease-enter"
                      />
                      <span className="font-num text-hud text-fg-muted mt-0.5">{cost}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {!validationResult.isValid && validationResult.errors.length > 0 && (
              <div className="p-2.5 bg-crimson-700/20 border border-crimson-500/50 text-crimson-400 text-caption space-y-0.5 max-h-20 overflow-y-auto">
                {validationResult.errors.map((err, i) => (
                  <div key={i}>· {err}</div>
                ))}
              </div>
            )}
          </div>

          {/* 已投入卡单列表 */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            <div className="flex justify-between items-center text-caption text-fg-muted pb-1.5 border-b border-line">
              <span className="font-num">已投入卡单 ({deckEntries.length} 种)</span>
              <button
                type="button"
                onClick={() => setDeckEntries([])}
                className="text-fg-muted hover:text-crimson-400 transition-colors cursor-pointer"
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
                        const variantEntry = (card as any).variantKey
                          ? (card as CardVariantEntry)
                          : ALL_CARD_VARIANT_ENTRIES.find(
                              (v) => v.imageUrl === entry.imageUrl || v.cardNumber === card.cardNumber,
                            );
                        if (variantEntry) {
                          handleAddCard(variantEntry);
                        } else if (totalCount < 4) {
                          const next = [...deckEntries];
                          next[idx] = { ...next[idx]!, count: next[idx]!.count + 1 };
                          setDeckEntries(next);
                        }
                      }}
                      onRemove={() => handleRemoveCard(entry.variantKey || entry.cardId)}
                    />
                  </div>
                  <button
                    type="button"
                    aria-label="删除该卡全部投入"
                    onClick={() => handleDeleteEntry(entry.variantKey || entry.cardId)}
                    className="h-7 w-7 inline-flex items-center justify-center text-fg-muted hover:text-crimson-400 hover:bg-ink-800 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* 底部卡牌战术详情面板 */}
          <div className="p-3 border-t border-line bg-ink-950 shrink-0">
            <div className="flex items-center justify-between text-caption text-fg-secondary mb-1.5">
              <span className="font-display text-hud uppercase text-fg-muted">
                CARD INSPECTOR
              </span>
              {activeCardForPanel && (
                <button
                  type="button"
                  onClick={() => setInspectedCard(activeCardForPanel)}
                  className="text-caption text-teal-400 hover:underline cursor-pointer"
                >
                  放大大图
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
                activeCardForPanel
                  ? (() => {
                      const coreNum = extractCoreCardNumber(activeCardForPanel.cardNumber);
                      const totalCount = cardNumberTotalCounts.get(coreNum) || 0;
                      const variantKey =
                        (activeCardForPanel as any).variantKey || activeCardForPanel.id;
                      const inDeckVariant =
                        variantSpecificCounts.get(variantKey) ||
                        (activeCardForPanel.imageUrl
                          ? variantSpecificCounts.get(activeCardForPanel.imageUrl)
                          : 0) ||
                        0;
                      const isMax = totalCount >= 4;

                      return (
                        <div className="flex items-center gap-1.5 font-num text-caption">
                          {inDeckVariant > 0 && (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveCard(variantKey);
                              }}
                            >
                              -1
                            </Button>
                          )}
                          <span className="text-fg-secondary px-1">
                            本版 {inDeckVariant} · 同号 {totalCount}/4
                          </span>
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={isMax}
                            onClick={(e) => {
                              e.stopPropagation();
                              const targetVariant = (activeCardForPanel as any).variantKey
                                ? (activeCardForPanel as CardVariantEntry)
                                : ALL_CARD_VARIANT_ENTRIES.find(
                                    (v) => v.cardNumber === activeCardForPanel.cardNumber,
                                  );
                              if (targetVariant) handleAddCard(targetVariant);
                            }}
                          >
                            +1 投入
                          </Button>
                        </div>
                      );
                    })()
                  : undefined
              }
            />
          </div>
        </aside>
      </div>

      {/* 高清检视弹窗 */}
      <CardDetailModal
        card={inspectedCard}
        isOpen={Boolean(inspectedCard)}
        selectedImageUrl={inspectedCard?.imageUrl}
        onClose={() => setInspectedCard(null)}
        actionButton={
          inspectedCard
            ? (() => {
                const coreNum = extractCoreCardNumber(inspectedCard.cardNumber);
                const totalCount = cardNumberTotalCounts.get(coreNum) || 0;
                const variantKey = (inspectedCard as any).variantKey || inspectedCard.id;
                const inDeckVariant =
                  variantSpecificCounts.get(variantKey) ||
                  (inspectedCard.imageUrl
                    ? variantSpecificCounts.get(inspectedCard.imageUrl)
                    : 0) ||
                  0;
                const isMax = totalCount >= 4;

                return (
                  <div className="flex items-center gap-2">
                    {inDeckVariant > 0 && (
                      <Button
                        variant="danger"
                        size="md"
                        onClick={() => handleRemoveCard(variantKey)}
                      >
                        移除 1 张 (本版 {inDeckVariant})
                      </Button>
                    )}
                    <Button
                      variant="primary"
                      size="md"
                      disabled={isMax}
                      onClick={() => {
                        const targetVariant = (inspectedCard as any).variantKey
                          ? (inspectedCard as CardVariantEntry)
                          : ALL_CARD_VARIANT_ENTRIES.find(
                              (v) => v.cardNumber === inspectedCard.cardNumber,
                            );
                        if (targetVariant) handleAddCard(targetVariant);
                      }}
                    >
                      {isMax ? '同编号已达 4 张上限' : `投入卡组 (+1 · 同号 ${totalCount}/4)`}
                    </Button>
                  </div>
                );
              })()
            : undefined
        }
      />
    </div>
  );
}
