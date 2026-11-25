'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import {
  ALL_CARD_VARIANT_ENTRIES,
  formatCardType,
  getAttributeDisplay,
} from '@/lib/cards-data';
import { CardType, ElementAttribute } from '@zhanshuang/shared';
import { isCardApproximatelyImplemented } from '@zhanshuang/game-rules';
import { getCardThumbnailUrl, handleThumbnailError } from '@/lib/card-image';
import {
  Search,
  SlidersHorizontal,
  Layers,
  Sparkles,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  LayoutGrid,
  List,
  Swords,
  X,
  ArrowUpDown,
  ArrowUp,
} from 'lucide-react';
import {
  AppShell,
  Button,
  Badge,
  Input,
  SectionHeader,
  HudBrackets,
  HudCounter,
} from '@/components/ui';

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
  { id: '升变角色牌', label: '升变角色牌' },
  { id: '战术牌', label: '战术牌' },
  { id: '普通战术牌', label: '普通战术牌' },
  { id: '瞬时战术牌', label: '瞬时战术牌' },
  { id: '道具牌', label: '道具牌' },
  { id: '装备牌', label: '装备牌' },
  { id: '辅助机牌', label: '辅助机牌' },
  { id: '普通', label: '普通' },
  { id: '装备', label: '装备' },
  { id: '辅助机', label: '辅助机' },
  { id: '协战', label: '协战' },
];

const ATTR_OPTIONS = [
  { id: 'ALL', label: '全部' },
  { id: '火', label: '火' },
  { id: '冰', label: '冰' },
  { id: '雷', label: '雷' },
  { id: '暗', label: '暗' },
  { id: '物理', label: '物理' },
  { id: '空', label: '空' },
  { id: '无', label: '无' },
];

const COST_OPTIONS = ['ALL', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

function PaginationBar({
  currentPage,
  totalPages,
  totalCards,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  currentPage: number;
  totalPages: number;
  totalCards: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  if (totalCards === 0) return null;

  const getPageNumbers = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages: (number | string)[] = [1];
    let start = Math.max(2, currentPage - 1);
    let end = Math.min(totalPages - 1, currentPage + 1);
    if (currentPage <= 3) {
      start = 2;
      end = 4;
    } else if (currentPage >= totalPages - 2) {
      start = totalPages - 3;
      end = totalPages - 1;
    }
    if (start > 2) pages.push('...');
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < totalPages - 1) pages.push('...');
    pages.push(totalPages);
    return pages;
  };

  const startItem = pageSize === 0 ? 1 : (currentPage - 1) * pageSize + 1;
  const endItem = pageSize === 0 ? totalCards : Math.min(currentPage * pageSize, totalCards);

  return (
    <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-4 py-3 px-4 border border-line bg-ink-850 text-caption">
      <div className="flex flex-wrap items-center gap-3 text-fg-muted">
        <span className="font-num tabular-nums">
          显示 <strong className="text-fg">{startItem}-{endItem}</strong> / 共{' '}
          <strong className="text-fg">{totalCards}</strong> 张
        </span>
        <div className="flex items-center gap-1 pl-3 border-l border-line">
          <span>每页</span>
          {[24, 48, 96, 0].map((size) => (
            <button
              key={size}
              type="button"
              onClick={() => onPageSizeChange(size)}
              className={`h-6 px-2 border font-num transition-colors cursor-pointer ${
                pageSize === size
                  ? 'border-crimson-500 bg-crimson-500/20 text-fg font-semibold'
                  : 'border-line bg-ink-900 text-fg-muted hover:text-fg'
              }`}
            >
              {size === 0 ? '全部' : size}
            </button>
          ))}
        </div>
      </div>

      {pageSize > 0 && totalPages > 1 && (
        <div className="flex items-center gap-1.5">
          <HudCounter current={currentPage} total={totalPages} prefix="PAGE" className="hidden md:inline-flex mr-2" />
          <Button
            variant="icon"
            size="sm"
            onClick={() => onPageChange(1)}
            disabled={currentPage === 1}
            aria-label="第一页"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="icon"
            size="sm"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
            aria-label="上一页"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>

          <div className="flex items-center gap-1">
            {getPageNumbers().map((p, idx) => {
              if (p === '...') {
                return (
                  <span key={`dots-${idx}`} className="px-1.5 text-fg-muted font-num">
                    …
                  </span>
                );
              }
              const num = p as number;
              const isCurrent = num === currentPage;
              return (
                <button
                  key={num}
                  type="button"
                  onClick={() => onPageChange(num)}
                  className={`h-7 min-w-7 px-1.5 border font-num tabular-nums text-caption transition-colors cursor-pointer ${
                    isCurrent
                      ? 'border-crimson-500 bg-crimson-500 text-fg font-semibold'
                      : 'border-line bg-ink-900 text-fg-secondary hover:border-line-strong hover:text-fg'
                  }`}
                >
                  {num}
                </button>
              );
            })}
          </div>

          <Button
            variant="icon"
            size="sm"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            aria-label="下一页"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="icon"
            size="sm"
            onClick={() => onPageChange(totalPages)}
            disabled={currentPage === totalPages}
            aria-label="最后一页"
          >
            <ChevronsRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default function CardsBrowserPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPackage, setSelectedPackage] = useState<string>('ALL');
  const [selectedRarity, setSelectedRarity] = useState<string>('ALL');
  const [selectedVariant, setSelectedVariant] = useState<string>('ALL');
  const [selectedKind, setSelectedKind] = useState<string>('ALL');
  const [selectedAttr, setSelectedAttr] = useState<string>('ALL');
  const [selectedCost, setSelectedCost] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<
    'NUMBER_ASC' | 'NUMBER_DESC' | 'COST_ASC' | 'COST_DESC' | 'PP_DESC' | 'DP_DESC'
  >('NUMBER_ASC');
  const [viewMode, setViewMode] = useState<'GRID' | 'TABLE'>('GRID');
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(48);

  const filteredCards = useMemo(() => {
    return ALL_CARD_VARIANT_ENTRIES.filter((card) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const match =
          card.name.toLowerCase().includes(q) ||
          card.cardNumber.toLowerCase().includes(q) ||
          card.variantKey.toLowerCase().includes(q) ||
          card.variantName.toLowerCase().includes(q) ||
          card.rulesText.toLowerCase().includes(q) ||
          card.traits.some((t) => t.toLowerCase().includes(q));
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

      if (selectedRarity !== 'ALL') {
        const r = card.variantRarity || card.rarity;
        if (r !== selectedRarity) return false;
      }

      if (selectedVariant !== 'ALL') {
        const starCount = (selectedVariant.match(/★+/)?.[0] || '').length;
        const targetR = selectedVariant.replace(/★+/g, '');
        if (card.variantStar !== starCount) return false;
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

      if (selectedAttr !== 'ALL') {
        const currentAttr = card.attributeName || card.attribute;
        if (currentAttr !== selectedAttr) return false;
      }

      if (selectedCost !== 'ALL') {
        if (card.cost !== Number(selectedCost)) return false;
      }

      return true;
    }).sort((a, b) => {
      if (sortBy === 'NUMBER_ASC') {
        const cmp = a.cardNumber.localeCompare(b.cardNumber);
        if (cmp !== 0) return cmp;
        return a.variantStar - b.variantStar || a.variantKey.localeCompare(b.variantKey);
      }
      if (sortBy === 'NUMBER_DESC') {
        const cmp = b.cardNumber.localeCompare(a.cardNumber);
        if (cmp !== 0) return cmp;
        return b.variantStar - a.variantStar || b.variantKey.localeCompare(a.variantKey);
      }
      if (sortBy === 'COST_ASC') return a.cost - b.cost;
      if (sortBy === 'COST_DESC') return b.cost - a.cost;
      if (sortBy === 'PP_DESC') return (b.basePP ?? 0) - (a.basePP ?? 0);
      if (sortBy === 'DP_DESC') return (b.baseDP ?? 0) - (a.baseDP ?? 0);
      return 0;
    });
  }, [
    searchQuery,
    selectedPackage,
    selectedRarity,
    selectedVariant,
    selectedKind,
    selectedAttr,
    selectedCost,
    sortBy,
  ]);

  const activeFilterCount =
    (selectedPackage !== 'ALL' ? 1 : 0) +
    (selectedRarity !== 'ALL' ? 1 : 0) +
    (selectedVariant !== 'ALL' ? 1 : 0) +
    (selectedKind !== 'ALL' ? 1 : 0) +
    (selectedAttr !== 'ALL' ? 1 : 0) +
    (selectedCost !== 'ALL' ? 1 : 0) +
    (searchQuery.trim() ? 1 : 0);

  const resetFilters = () => {
    setSearchQuery('');
    setSelectedPackage('ALL');
    setSelectedRarity('ALL');
    setSelectedVariant('ALL');
    setSelectedKind('ALL');
    setSelectedAttr('ALL');
    setSelectedCost('ALL');
    setSortBy('NUMBER_ASC');
    setCurrentPage(1);
  };

  const totalCards = filteredCards.length;
  const totalPages = pageSize === 0 ? 1 : Math.max(1, Math.ceil(totalCards / pageSize));

  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchQuery,
    selectedPackage,
    selectedRarity,
    selectedVariant,
    selectedKind,
    selectedAttr,
    selectedCost,
    sortBy,
  ]);

  const displayedCards = useMemo(() => {
    if (pageSize === 0) return filteredCards;
    const start = (currentPage - 1) * pageSize;
    return filteredCards.slice(start, start + pageSize);
  }, [filteredCards, currentPage, pageSize]);

  const handlePageChange = (targetPage: number) => {
    const page = Math.max(1, Math.min(targetPage, totalPages));
    setCurrentPage(page);
    window.scrollTo({ top: 280, behavior: 'smooth' });
  };

  const chipClass = (active: boolean) =>
    `h-7 px-2.5 border text-caption transition-colors duration-fast whitespace-nowrap cursor-pointer ${
      active
        ? 'border-crimson-500 bg-crimson-500/20 text-fg font-semibold'
        : 'border-line bg-ink-900 text-fg-muted hover:border-line-strong hover:text-fg'
    }`;

  return (
    <AppShell wide className="space-y-6">
      <SectionHeader
        variant="card"
        code="SECTOR 03 // OFFICIAL ARCHIVE"
        title="全维卡牌图鉴"
        subtitle={`CARD DATABASE · ${ALL_CARD_VARIANT_ENTRIES.length} ARTWORK VARIANTS`}
        watermark="ARCHIVE"
        action={
          <>
            <Link href="/decks">
              <Button variant="secondary" size="md">
                <Layers className="w-4 h-4" />
                <span>卡组构筑</span>
              </Button>
            </Link>
            <Link href="/rooms">
              <Button variant="primary" size="md">
                <Swords className="w-4 h-4" />
                <span>进入对战</span>
              </Button>
            </Link>
          </>
        }
      />

      {/* 多维筛选面板 */}
      <div className="border border-line bg-ink-850 p-4 md:p-5 space-y-4 pgr-enter">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between">
          <div className="flex-1">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索卡号 (ST01-001)、角色名 (露西亚/露娜)、规则关键词 (升变/速攻)..."
              aria-label="搜索卡牌"
              leftSlot={<Search className="w-4 h-4" />}
              rightSlot={
                searchQuery ? (
                  <button
                    type="button"
                    aria-label="清空搜索"
                    onClick={() => setSearchQuery('')}
                    className="text-fg-muted hover:text-fg cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                ) : null
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-caption">
            <span className="font-num tabular-nums text-fg-muted">
              命中 <strong className="text-fg">{filteredCards.length}</strong> /{' '}
              {ALL_CARD_VARIANT_ENTRIES.length}
            </span>

            {activeFilterCount > 0 && (
              <Button variant="danger" size="sm" onClick={resetFilters}>
                重置筛选 ({activeFilterCount})
              </Button>
            )}

            <Button
              variant="secondary"
              size="sm"
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{filtersOpen ? '收起筛选' : '展开筛选'}</span>
            </Button>

            <div className="inline-flex items-center gap-1.5 border border-line bg-ink-900 px-2 h-8">
              <ArrowUpDown className="w-3.5 h-3.5 text-fg-muted" />
              <select
                value={sortBy}
                aria-label="排序方式"
                onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="bg-transparent text-caption text-fg focus:outline-none cursor-pointer"
              >
                <option value="NUMBER_ASC" className="bg-ink-900">卡号升序</option>
                <option value="NUMBER_DESC" className="bg-ink-900">卡号降序</option>
                <option value="COST_ASC" className="bg-ink-900">费用从低到高</option>
                <option value="COST_DESC" className="bg-ink-900">费用从高到低</option>
                <option value="PP_DESC" className="bg-ink-900">基础 PP 最高</option>
                <option value="DP_DESC" className="bg-ink-900">基础 DP 最高</option>
              </select>
            </div>

            <div className="inline-flex border border-line bg-ink-900">
              <button
                type="button"
                onClick={() => setViewMode('GRID')}
                aria-label="网格图鉴视图"
                title="网格图鉴"
                className={`h-8 w-8 inline-flex items-center justify-center transition-colors cursor-pointer ${
                  viewMode === 'GRID'
                    ? 'bg-crimson-500 text-fg'
                    : 'text-fg-muted hover:text-fg'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('TABLE')}
                aria-label="紧凑表格视图"
                title="紧凑表格"
                className={`h-8 w-8 inline-flex items-center justify-center transition-colors cursor-pointer ${
                  viewMode === 'TABLE'
                    ? 'bg-crimson-500 text-fg'
                    : 'text-fg-muted hover:text-fg'
                }`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {filtersOpen && (
          <div className="space-y-3.5 pt-3 border-t border-line animate-in fade-in duration-fast">
            <div className="space-y-1.5">
              <div className="font-display text-hud uppercase text-fg-muted">
                PACKAGE // 卡包与预组
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PACKAGE_OPTIONS.map((pkg) => (
                  <button
                    key={pkg.id}
                    type="button"
                    onClick={() => setSelectedPackage(pkg.id)}
                    className={chipClass(selectedPackage === pkg.id)}
                  >
                    {pkg.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 pt-2 border-t border-line">
              <div className="font-display text-hud uppercase text-fg-muted">
                CARD KIND // 卡牌种类
              </div>
              <div className="flex flex-wrap gap-1.5">
                {KIND_OPTIONS.map((k) => (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => setSelectedKind(k.id)}
                    className={chipClass(selectedKind === k.id)}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 pt-2 border-t border-line">
              <div className="space-y-1.5">
                <div className="font-display text-hud uppercase text-fg-muted">
                  RARITY // 稀有度
                </div>
                <div className="flex flex-wrap gap-1">
                  {RARITY_OPTIONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setSelectedRarity(r)}
                      className={`${chipClass(selectedRarity === r)} font-num`}
                    >
                      {r === 'ALL' ? '全部' : r}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="font-display text-hud uppercase text-fg-muted flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-gold-300" />
                  <span>VARIANT // 异画形态</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {VARIANT_OPTIONS.map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setSelectedVariant(v)}
                      className={`${chipClass(selectedVariant === v)} font-num`}
                    >
                      {v === 'ALL' ? '全部' : v}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="font-display text-hud uppercase text-fg-muted">
                  ATTRIBUTE // 属性
                </div>
                <div className="flex flex-wrap gap-1">
                  {ATTR_OPTIONS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setSelectedAttr(a.id)}
                      className={chipClass(selectedAttr === a.id)}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="font-display text-hud uppercase text-fg-muted">
                  COST // 出场费用
                </div>
                <div className="flex flex-wrap gap-1">
                  {COST_OPTIONS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setSelectedCost(c)}
                      className={`${chipClass(selectedCost === c)} font-num min-w-7 text-center`}
                    >
                      {c === 'ALL' ? '全部' : c}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <PaginationBar
        currentPage={currentPage}
        totalPages={totalPages}
        totalCards={totalCards}
        pageSize={pageSize}
        onPageChange={handlePageChange}
        onPageSizeChange={setPageSize}
      />

      {filteredCards.length === 0 ? (
        <div className="border border-dashed border-line-strong bg-ink-900/60 py-16 px-6 flex flex-col items-center text-center">
          <SlidersHorizontal className="w-10 h-10 text-fg-muted mb-3" />
          <h2 className="text-title-sm font-semibold text-fg">未检索到匹配的卡牌档案</h2>
          <p className="text-body-sm text-fg-secondary mt-1 max-w-md mb-5">
            请尝试放宽筛选条件，或在搜索栏中尝试其他关键词（如角色名、卡号、能力词条）。
          </p>
          <Button variant="secondary" size="sm" onClick={resetFilters}>
            清除所有筛选条件
          </Button>
        </div>
      ) : viewMode === 'GRID' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {displayedCards.map((card) => {
            const isFoil = card.variantStar > 0;
            const attrInfo = getAttributeDisplay(card.attribute, card.attributeName);
            return (
              <Link
                key={card.id}
                href={`/cards/${card.cardNumber}?variant=${encodeURIComponent(card.variantKey)}`}
                className="group relative flex flex-col border border-line bg-ink-850 transition-all duration-fast ease-enter hover:-translate-y-1 hover:border-line-strong"
              >
                <HudBrackets color="steel" size="sm" interactive />

                <div className="relative aspect-[7/10] w-full bg-ink-950 overflow-hidden rounded-t-card">
                  <img
                    src={getCardThumbnailUrl(card.imageUrl, card.cardNumber)}
                    alt={card.name}
                    className="w-full h-full object-cover transition-transform duration-base ease-enter group-hover:scale-105"
                    loading="lazy"
                    onError={(e) => {
                      handleThumbnailError(
                        e,
                        card.imageUrl || `/cards/${card.cardNumber}.png`,
                      );
                    }}
                  />

                  <span className="absolute top-2 left-2 h-6 min-w-6 px-1 bg-ink-950/90 border border-line-strong inline-flex items-center justify-center font-num tabular-nums text-caption font-bold text-gold-300">
                    {card.cost}
                  </span>

                  <span
                    className={`absolute top-2 right-2 px-1.5 h-5 inline-flex items-center gap-1 bg-ink-950/90 border font-num text-hud ${
                      isFoil
                        ? 'border-gold-300/70 text-gold-300 font-semibold'
                        : 'border-line text-fg-secondary'
                    }`}
                  >
                    {isFoil && <Sparkles className="w-2.5 h-2.5" />}
                    <span>{card.variantBadge || card.variantRarity || card.rarity || '原画'}</span>
                  </span>

                  <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-ink-950 via-ink-950/80 to-transparent space-y-1">
                    <div className="flex items-center justify-between gap-1 text-hud">
                      <span className="font-num text-fg-muted">{card.cardNumber}</span>
                      <div className="flex items-center gap-1">
                        {isCardApproximatelyImplemented(card.cardNumber, card.rulesText) && (
                          <span
                            className="px-1 bg-gold-300/15 border border-gold-300/50 text-gold-300 font-semibold"
                            title="该卡效果当前为关键字近似实现（未迁移卡牌将逐步补齐精确实现）"
                          >
                            近似
                          </span>
                        )}
                        <span className={`px-1 border ${attrInfo.tagColor}`}>
                          {card.attributeName || (card.attribute === ElementAttribute.VOID ? '空' : card.attribute)}
                        </span>
                      </div>
                    </div>
                    <div className="text-caption font-semibold text-fg truncate">
                      {card.name}
                    </div>
                    {card.cardType === CardType.ROLE && (
                      <div className="flex items-center justify-between pt-0.5 border-t border-line font-num tabular-nums text-hud">
                        <span className="text-fg">{card.basePP ?? 0} PP</span>
                        <span className="text-crimson-400">{card.baseDP ?? 0} DP</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="px-2.5 py-2 flex items-center justify-between border-t border-line bg-ink-900 text-hud">
                  <span className="text-fg-muted truncate">
                    {formatCardType(card.cardType, card.isInstant)}
                  </span>
                  <span className="text-fg-secondary group-hover:text-fg inline-flex items-center gap-0.5 shrink-0">
                    详情 <ChevronRight className="w-3 h-3" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="w-full overflow-x-auto border border-line bg-ink-850">
          <table className="w-full text-left text-body-sm border-collapse">
            <thead>
              <tr className="border-b border-line bg-ink-900 text-fg-muted text-caption">
                <th className="py-3 px-3">卡图</th>
                <th className="py-3 px-3">卡号</th>
                <th className="py-3 px-3">形态</th>
                <th className="py-3 px-3">名称</th>
                <th className="py-3 px-3">类型</th>
                <th className="py-3 px-3">属性</th>
                <th className="py-3 px-3 text-center">费用</th>
                <th className="py-3 px-3 text-right">PP / DP</th>
                <th className="py-3 px-3">效果简述</th>
                <th className="py-3 px-3 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {displayedCards.map((card, idx) => {
                const attrInfo = getAttributeDisplay(card.attribute, card.attributeName);
                return (
                  <tr
                    key={card.id}
                    className={`transition-colors duration-fast hover:bg-ink-700 ${
                      idx % 2 === 1 ? 'bg-ink-800/60' : 'bg-ink-850'
                    }`}
                  >
                    <td className="py-2 px-3">
                      <div className="w-9 h-12 rounded-card overflow-hidden border border-line bg-ink-950">
                        <img
                          src={getCardThumbnailUrl(card.imageUrl, card.cardNumber)}
                          alt={card.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onError={(e) => {
                            handleThumbnailError(
                              e,
                              card.imageUrl || `/cards/${card.cardNumber}.png`,
                            );
                          }}
                        />
                      </div>
                    </td>
                    <td className="py-2 px-3 font-num text-caption text-crimson-400 font-semibold whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span>{card.cardNumber}</span>
                        {isCardApproximatelyImplemented(card.cardNumber, card.rulesText) && (
                          <span
                            className="px-1 py-px text-hud font-sans bg-gold-300/15 border border-gold-300/50 text-gold-300"
                            title="该卡效果当前为关键字近似实现"
                          >
                            近似
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <Badge variant={card.variantStar > 0 ? 'gold' : 'neutral'} className="font-num">
                        {card.variantBadge || card.variantName}
                      </Badge>
                    </td>
                    <td className="py-2 px-3 font-medium text-fg whitespace-nowrap">
                      <Link
                        href={`/cards/${card.cardNumber}?variant=${encodeURIComponent(card.variantKey)}`}
                        className="hover:text-teal-400 transition-colors"
                      >
                        {card.name}
                      </Link>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-caption text-fg-secondary">
                      {formatCardType(card.cardType, card.isInstant)}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 border text-caption ${attrInfo.tagColor}`}>
                        {card.attributeName || (card.attribute === ElementAttribute.VOID ? '空' : card.attribute)}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center font-num tabular-nums text-gold-300 font-semibold">
                      {card.cost}
                    </td>
                    <td className="py-2 px-3 text-right font-num tabular-nums whitespace-nowrap text-caption">
                      {card.cardType === CardType.ROLE ? (
                        <span>
                          <strong className="text-fg">{card.basePP ?? 0}</strong>
                          <span className="text-fg-disabled mx-1">/</span>
                          <strong className="text-crimson-400">{card.baseDP ?? 0}</strong>
                        </span>
                      ) : (
                        <span className="text-fg-disabled">—</span>
                      )}
                    </td>
                    <td
                      className="py-2 px-3 text-caption text-fg-secondary max-w-xs truncate"
                      title={card.rulesText}
                    >
                      {card.rulesText}
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap">
                      <Link
                        href={`/cards/${card.cardNumber}?variant=${encodeURIComponent(card.variantKey)}`}
                      >
                        <Button variant="ghost" size="sm">
                          <span>详情</span>
                          <ExternalLink className="w-3 h-3" />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <PaginationBar
        currentPage={currentPage}
        totalPages={totalPages}
        totalCards={totalCards}
        pageSize={pageSize}
        onPageChange={handlePageChange}
        onPageSizeChange={setPageSize}
      />

      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        aria-label="回到页面顶部"
        title="回到顶部"
        className="fixed bottom-6 right-6 z-overlay h-10 w-10 bg-ink-900 border border-line-strong clip-corner-sm text-fg-secondary hover:text-fg hover:border-crimson-500 transition-colors inline-flex items-center justify-center shadow-overlay cursor-pointer"
      >
        <ArrowUp className="w-4 h-4" />
      </button>
    </AppShell>
  );
}
