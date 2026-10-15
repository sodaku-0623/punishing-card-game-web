'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import {
  ALL_OFFICIAL_CARDS,
  ALL_CARD_VARIANT_ENTRIES,
  CardData,
  CardVariantEntry,
  getCardSeries,
  CARD_VARIANTS_MAP,
  formatCardType,
  getAttributeDisplay,
} from '@/lib/cards-data';
import { CardType, ElementAttribute, SignalOrbType } from '@zhanshuang/shared';
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
  Flame,
  Moon,
  Zap,
  Shield,
  Swords,
  X,
  ArrowUpDown,
  BookOpen,
  ArrowUp,
} from 'lucide-react';

// 6 大官方筛选维度选项定义
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

const RARITY_OPTIONS = [
  { id: 'ALL', label: '全部' },
  { id: 'C', label: 'C' },
  { id: 'R', label: 'R' },
  { id: 'SR', label: 'SR' },
  { id: 'PR', label: 'PR' },
  { id: 'ST', label: 'ST' },
  { id: 'U', label: 'U' },
];

const VARIANT_OPTIONS = [
  { id: 'ALL', label: '全部' },
  { id: 'C★', label: 'C★' },
  { id: 'R★', label: 'R★' },
  { id: 'R★★', label: 'R★★' },
  { id: 'SR★', label: 'SR★' },
  { id: 'SR★★', label: 'SR★★' },
  { id: 'SR★★★', label: 'SR★★★' },
];

const KIND_OPTIONS = [
  { id: 'ALL', label: '全部种类' },
  { id: '道具牌', label: '道具牌' },
  { id: '辅助机牌', label: '辅助机牌' },
  { id: '装备牌', label: '装备牌' },
  { id: '角色牌', label: '角色牌' },
  { id: '升变角色牌', label: '升变角色牌' },
  { id: '战术牌', label: '战术牌' },
  { id: '普通战术牌', label: '普通战术牌' },
  { id: '瞬时战术牌', label: '瞬时战术牌' },
  { id: '普通', label: '普通' },
  { id: '装备', label: '装备' },
  { id: '辅助机', label: '辅助机' },
  { id: '协战', label: '协战' },
];

const ATTR_OPTIONS = [
  { id: 'ALL', label: '全部' },
  { id: '无', label: '无', color: 'text-neutral-400' },
  { id: '暗', label: '暗', color: 'text-purple-400' },
  { id: '冰', label: '冰', color: 'text-blue-400' },
  { id: '火', label: '火', color: 'text-red-400' },
  { id: '雷', label: '雷', color: 'text-yellow-400' },
  { id: '物理', label: '物理', color: 'text-amber-400' },
  { id: '空', label: '空', color: 'text-cyan-300' },
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
    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    if (end < totalPages - 1) pages.push('...');
    pages.push(totalPages);
    return pages;
  };

  const startItem = pageSize === 0 ? 1 : (currentPage - 1) * pageSize + 1;
  const endItem = pageSize === 0 ? totalCards : Math.min(currentPage * pageSize, totalCards);

  return (
    <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-4 py-3.5 px-5 rounded-xl border border-terminalBorder bg-surface/80 backdrop-blur shadow-lg text-xs font-mono">
      <div className="flex items-center gap-3 text-neutral-400">
        <span>
          显示 <strong className="text-terminalCyan font-bold">{startItem} - {endItem}</strong> / 共 <strong className="text-white font-bold">{totalCards}</strong> 张
        </span>
        <div className="flex items-center gap-1.5 pl-3 border-l border-terminalBorder/60">
          <span className="text-[11px] text-neutral-500">每页:</span>
          {[24, 48, 96, 0].map((size) => (
            <button
              key={size}
              onClick={() => onPageSizeChange(size)}
              className={`px-2 py-0.5 rounded border text-[11px] transition-colors ${
                pageSize === size
                  ? 'border-terminalCyan bg-terminalCyan/20 text-terminalCyan font-bold'
                  : 'border-terminalBorder/60 bg-black/40 text-neutral-400 hover:text-white'
              }`}
            >
              {size === 0 ? '全部' : size}
            </button>
          ))}
        </div>
      </div>

      {pageSize > 0 && totalPages > 1 && (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onPageChange(1)}
            disabled={currentPage === 1}
            className="p-1.5 rounded-lg border border-terminalBorder bg-black/40 text-neutral-400 hover:border-terminalCyan hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
            title="第一页"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
            className="p-1.5 rounded-lg border border-terminalBorder bg-black/40 text-neutral-400 hover:border-terminalCyan hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
            title="上一页"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center gap-1">
            {getPageNumbers().map((p, idx) => {
              if (p === '...') {
                return (
                  <span key={`dots-${idx}`} className="px-1 text-neutral-500">
                    ...
                  </span>
                );
              }
              const num = p as number;
              const isCurrent = num === currentPage;
              return (
                <button
                  key={num}
                  onClick={() => onPageChange(num)}
                  className={`w-7 h-7 rounded-lg border text-xs font-bold transition-all ${
                    isCurrent
                      ? 'border-terminalCyan bg-terminalCyan text-neutral-950 shadow-[0_0_10px_rgba(0,240,255,0.4)]'
                      : 'border-terminalBorder/70 bg-black/40 text-neutral-300 hover:border-terminalCyan/70 hover:text-white'
                  }`}
                >
                  {num}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages}
            className="p-1.5 rounded-lg border border-terminalBorder bg-black/40 text-neutral-400 hover:border-terminalCyan hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
            title="下一页"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onPageChange(totalPages)}
            disabled={currentPage === totalPages}
            className="p-1.5 rounded-lg border border-terminalBorder bg-black/40 text-neutral-400 hover:border-terminalCyan hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors"
            title="最后一页"
          >
            <ChevronsRight className="w-3.5 h-3.5" />
          </button>
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
  const [sortBy, setSortBy] = useState<'NUMBER_ASC' | 'NUMBER_DESC' | 'COST_ASC' | 'COST_DESC' | 'PP_DESC' | 'DP_DESC'>('NUMBER_ASC');
  const [viewMode, setViewMode] = useState<'GRID' | 'TABLE'>('GRID');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(48);

  // 过滤逻辑 (对全量 808 种独立异画/原画版本卡牌进行多维检索)
  const filteredCards = useMemo(() => {
    return ALL_CARD_VARIANT_ENTRIES.filter((card) => {
      // 1. 关键字检索 (编号、角色名、异画编号、规则文本、特征词条)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = card.name.toLowerCase().includes(q);
        const matchNumber = card.cardNumber.toLowerCase().includes(q);
        const matchVariantKey = card.variantKey.toLowerCase().includes(q);
        const matchVariantName = card.variantName.toLowerCase().includes(q);
        const matchRules = card.rulesText.toLowerCase().includes(q);
        const matchTraits = card.traits.some((t) => t.toLowerCase().includes(q));
        if (!matchName && !matchNumber && !matchVariantKey && !matchVariantName && !matchRules && !matchTraits) return false;
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
        const targetR = selectedVariant.replace(/★+/g, '');
        if (card.variantStar !== starCount) return false;
        if (targetR) {
          const r = card.variantRarity || card.rarity;
          if (r !== targetR) return false;
        }
      }

      // 5. 卡牌种类筛选 (道具牌、辅助机牌、装备牌、角色牌、升变角色牌、战术牌、普通战术牌、瞬时战术牌、普通、装备、辅助机、协战)
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

      // 6. 属性筛选 (无、暗、冰、火、雷、物理、空)
      if (selectedAttr !== 'ALL') {
        const currentAttr = card.attributeName || card.attribute;
        if (currentAttr !== selectedAttr) return false;
      }

      // 7. 费用筛选 (0、1、2、3、4、5、6、7、8、9、10)
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
  }, [searchQuery, selectedPackage, selectedRarity, selectedVariant, selectedKind, selectedAttr, selectedCost, sortBy]);

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

  // 保证 currentPage 不会超出合法范围
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  // 当筛选条件或排序改变时重置当前页码至第1页
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedPackage, selectedRarity, selectedVariant, selectedKind, selectedAttr, selectedCost, sortBy]);

  // 当前分页切片卡牌列表
  const displayedCards = useMemo(() => {
    if (pageSize === 0) return filteredCards;
    const start = (currentPage - 1) * pageSize;
    return filteredCards.slice(start, start + pageSize);
  }, [filteredCards, currentPage, pageSize]);

  const handlePageChange = (targetPage: number) => {
    const page = Math.max(1, Math.min(targetPage, totalPages));
    setCurrentPage(page);
    window.scrollTo({ top: 320, behavior: 'smooth' });
  };

  const getAttrColor = (attr: ElementAttribute, attrName?: string) => {
    if (attrName === '空' || attr === ElementAttribute.VOID) {
      return 'text-cyan-300 border-cyan-400/40 bg-cyan-400/10';
    }
    switch (attr) {
      case ElementAttribute.PHYSICAL:
        return 'text-amber-400 border-amber-500/40 bg-amber-500/10';
      case ElementAttribute.DARK:
        return 'text-purple-400 border-purple-500/40 bg-purple-500/10';
      case ElementAttribute.FIRE:
        return 'text-red-400 border-red-500/40 bg-red-500/10';
      case ElementAttribute.ICE:
        return 'text-blue-400 border-blue-500/40 bg-blue-500/10';
      case ElementAttribute.LIGHTNING:
        return 'text-yellow-400 border-yellow-500/40 bg-yellow-500/10';
      default:
        return 'text-neutral-400 border-neutral-600 bg-neutral-800/40';
    }
  };

  return (
    <div className="w-full min-h-screen bg-background text-neutral-200 p-4 md:p-8 flex flex-col items-center overflow-x-hidden overflow-y-auto">
      {/* 顶部状态与导航 */}
      <header className="w-full max-w-7xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-terminalBorder/70 pb-6 mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-neutral-400 mb-1">
            <Link href="/" className="hover:text-terminalCyan transition-colors">
              终端首页
            </Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-terminalCyan">全域卡牌图鉴与检视资料库</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-black tracking-wide text-white flex items-center gap-3">
            <BookOpen className="w-7 h-7 text-terminalCyan" />
            官方卡牌档案图鉴
            <span className="text-xs px-2.5 py-0.5 rounded-full border border-terminalCyan/40 bg-terminalCyan/10 text-terminalCyan font-mono font-normal">
              A0 第一版官方卡表
            </span>
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/decks"
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-terminalBorder bg-surface hover:border-terminalCyan/70 text-sm font-medium transition-all"
          >
            <Layers className="w-4 h-4 text-terminalCyan" />
            进入卡组构筑台
          </Link>
          <Link
            href="/rooms"
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-terminalBorder bg-surface hover:border-erosionRed/70 text-sm font-medium transition-all"
          >
            <Swords className="w-4 h-4 text-erosionRed" />
            大厅对战
          </Link>
        </div>
      </header>

      {/* 筛选面板 */}
      <div className="w-full max-w-7xl bg-surface/70 border border-terminalBorder rounded-xl p-4 md:p-6 mb-6 shadow-xl backdrop-blur flex flex-col gap-4">
        {/* 第一行：搜索框与全局操作 (重置、结果、排序、视图模式) */}
        <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center justify-between">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              placeholder="搜索卡牌编号 (如 ST01-001)、角色名 (露西亚/露娜)、效果词条 (升变/速攻)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-2.5 bg-black/50 border border-terminalBorder rounded-lg text-sm text-white placeholder-neutral-500 focus:outline-none focus:border-terminalCyan transition-colors font-mono"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-mono text-neutral-400">
                检视结果: <strong className="text-terminalCyan font-bold">{filteredCards.length}</strong> / {ALL_CARD_VARIANT_ENTRIES.length} 张独立卡面
              </span>
              {activeFilterCount > 0 && (
                <button
                  onClick={resetFilters}
                  className="px-2.5 py-1 rounded text-xs text-erosionRed hover:bg-erosionRed/10 border border-erosionRed/40 transition-colors font-mono font-medium"
                >
                  重置筛选 ({activeFilterCount})
                </button>
              )}
            </div>

            {/* 排序 */}
            <div className="flex items-center gap-1.5">
              <ArrowUpDown className="w-3.5 h-3.5 text-neutral-400" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-black/60 border border-terminalBorder rounded px-2 py-1 text-xs text-neutral-300 focus:outline-none focus:border-terminalCyan font-mono"
              >
                <option value="NUMBER_ASC">卡号升序 (ST01-001...)</option>
                <option value="NUMBER_DESC">卡号降序</option>
                <option value="COST_ASC">费用从低到高</option>
                <option value="COST_DESC">费用从高到低</option>
                <option value="PP_DESC">基础攻击力 (PP) 最高</option>
                <option value="DP_DESC">伤害点数 (DP) 最高</option>
              </select>
            </div>

            {/* 视图切换 */}
            <div className="flex items-center border border-terminalBorder rounded p-0.5 bg-black/40">
              <button
                onClick={() => setViewMode('GRID')}
                className={`p-1.5 rounded transition-colors ${viewMode === 'GRID' ? 'bg-terminalCyan/20 text-terminalCyan' : 'text-neutral-500 hover:text-white'}`}
                title="网格图鉴"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('TABLE')}
                className={`p-1.5 rounded transition-colors ${viewMode === 'TABLE' ? 'bg-terminalCyan/20 text-terminalCyan' : 'text-neutral-500 hover:text-white'}`}
                title="紧凑表格"
              >
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* 维度 1: 所属卡包 / 预组 */}
        <div className="flex flex-col gap-1.5 pt-2 border-t border-terminalBorder/40">
          <div className="flex items-center justify-between text-xs">
            <span className="text-neutral-400 font-mono flex items-center gap-1.5 font-bold">
              <Layers className="w-3.5 h-3.5 text-terminalCyan" />
              卡包与预组 PACKAGE
            </span>
            {selectedPackage !== 'ALL' && (
              <span className="text-[11px] font-mono text-terminalCyan">
                已选: {selectedPackage}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs font-mono">
            {PACKAGE_OPTIONS.map((pkg) => {
              const active = selectedPackage === pkg.id;
              return (
                <button
                  key={pkg.id}
                  onClick={() => setSelectedPackage(pkg.id)}
                  className={`px-2.5 py-1 rounded-md border text-xs transition-all whitespace-nowrap ${
                    active
                      ? 'border-terminalCyan bg-terminalCyan/20 text-terminalCyan font-bold shadow-[0_0_8px_rgba(0,240,255,0.25)]'
                      : 'border-terminalBorder/60 bg-black/30 text-neutral-400 hover:border-terminalBorder hover:text-neutral-200'
                  }`}
                >
                  {pkg.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 维度 2: 卡牌种类 */}
        <div className="flex flex-col gap-1.5 pt-2 border-t border-terminalBorder/40">
          <div className="flex items-center justify-between text-xs">
            <span className="text-neutral-400 font-mono flex items-center gap-1.5 font-bold">
              <SlidersHorizontal className="w-3.5 h-3.5 text-terminalCyan" />
              卡牌种类 CARD KIND
            </span>
            {selectedKind !== 'ALL' && (
              <span className="text-[11px] font-mono text-terminalCyan">
                已选: {selectedKind}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs">
            {KIND_OPTIONS.map((k) => {
              const active = selectedKind === k.id;
              return (
                <button
                  key={k.id}
                  onClick={() => setSelectedKind(k.id)}
                  className={`px-2.5 py-1 rounded-md border text-xs transition-all whitespace-nowrap ${
                    active
                      ? 'border-terminalCyan bg-terminalCyan/20 text-terminalCyan font-bold shadow-[0_0_8px_rgba(0,240,255,0.25)]'
                      : 'border-terminalBorder/60 bg-black/30 text-neutral-400 hover:border-terminalBorder hover:text-neutral-200'
                  }`}
                >
                  {k.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 维度 3-6: 稀有度、异画形态、元素属性、出场费用 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-terminalBorder/40 text-xs">
          {/* 维度 3: 稀有度 */}
          <div className="flex flex-col gap-1.5">
            <span className="text-neutral-400 font-mono font-bold flex items-center gap-1">
              稀有度 RARITY
            </span>
            <div className="flex flex-wrap gap-1">
              {RARITY_OPTIONS.map((r) => {
                const active = selectedRarity === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelectedRarity(r.id)}
                    className={`px-2.5 py-1 rounded border text-xs font-mono font-bold transition-all ${
                      active
                        ? 'border-amber-400 bg-amber-400/20 text-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.3)]'
                        : 'border-terminalBorder/60 bg-black/30 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
                    }`}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 维度 4: 异画形态 */}
          <div className="flex flex-col gap-1.5">
            <span className="text-neutral-400 font-mono font-bold flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-400" />
              异画形态 VARIANT
            </span>
            <div className="flex flex-wrap gap-1">
              {VARIANT_OPTIONS.map((v) => {
                const active = selectedVariant === v.id;
                return (
                  <button
                    key={v.id}
                    onClick={() => setSelectedVariant(v.id)}
                    className={`px-2 py-1 rounded border text-xs font-mono font-bold transition-all ${
                      active
                        ? 'border-amber-400 bg-amber-400/25 text-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.3)]'
                        : 'border-terminalBorder/60 bg-black/30 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
                    }`}
                  >
                    {v.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 维度 5: 元素属性 */}
          <div className="flex flex-col gap-1.5">
            <span className="text-neutral-400 font-mono font-bold flex items-center gap-1">
              属性 ATTRIBUTE
            </span>
            <div className="flex flex-wrap gap-1">
              {ATTR_OPTIONS.map((a) => {
                const active = selectedAttr === a.id;
                return (
                  <button
                    key={a.id}
                    onClick={() => setSelectedAttr(a.id)}
                    className={`px-2 py-1 rounded border text-xs font-medium transition-all ${
                      active
                        ? 'border-terminalCyan bg-terminalCyan/20 text-terminalCyan font-bold shadow-[0_0_8px_rgba(0,240,255,0.25)]'
                        : 'border-terminalBorder/60 bg-black/30 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
                    }`}
                  >
                    <span className={a.color || ''}>{a.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 维度 6: 出场费用 */}
          <div className="flex flex-col gap-1.5">
            <span className="text-neutral-400 font-mono font-bold flex items-center gap-1">
              费用 COST
            </span>
            <div className="flex flex-wrap gap-1">
              {COST_OPTIONS.map((c) => {
                const active = selectedCost === c;
                return (
                  <button
                    key={c}
                    onClick={() => setSelectedCost(c)}
                    className={`px-2 py-1 rounded border text-xs font-mono font-bold transition-all min-w-[28px] text-center ${
                      active
                        ? 'border-terminalCyan bg-terminalCyan/20 text-terminalCyan shadow-[0_0_8px_rgba(0,240,255,0.25)]'
                        : 'border-terminalBorder/60 bg-black/30 text-neutral-400 hover:border-neutral-500 hover:text-neutral-200'
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 卡牌主呈现区 */}
      <main className="w-full max-w-7xl flex flex-col gap-6">
        <PaginationBar
          currentPage={currentPage}
          totalPages={totalPages}
          totalCards={totalCards}
          pageSize={pageSize}
          onPageChange={handlePageChange}
          onPageSizeChange={setPageSize}
        />

        {filteredCards.length === 0 ? (
          <div className="w-full py-20 flex flex-col items-center justify-center border border-terminalBorder/40 rounded-xl bg-surface/30 text-center">
            <SlidersHorizontal className="w-12 h-12 text-neutral-600 mb-3" />
            <h3 className="text-lg font-bold text-neutral-300">未检索到匹配的卡牌档案</h3>
            <p className="text-xs text-neutral-500 mt-1 max-w-md">
              请尝试放宽筛选条件，或在搜索栏中尝试其他关键词（例如角色名、卡号、词条等）。
            </p>
            <button
              onClick={resetFilters}
              className="mt-4 px-4 py-2 rounded-lg border border-terminalCyan/40 text-terminalCyan text-xs hover:bg-terminalCyan/10 transition-colors"
            >
              清除所有筛选条件
            </button>
          </div>
        ) : viewMode === 'GRID' ? (
          /* 网格大图图鉴视图 (每种异画版本独立展示) */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {displayedCards.map((card) => {
              const isFoil = card.variantStar > 0;
              return (
                <Link
                  key={card.id}
                  href={`/cards/${card.cardNumber}?variant=${encodeURIComponent(card.variantKey)}`}
                  className="group relative flex flex-col rounded-xl overflow-hidden border border-terminalBorder bg-surface hover:border-terminalCyan transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_0_20px_rgba(0,240,255,0.25)]"
                >
                  {/* 卡牌图像容器 */}
                  <div className="relative aspect-[7/10] w-full bg-neutral-900 overflow-hidden flex items-center justify-center">
                    {/* 卡牌立绘图 (优先加载高性能缩略图，降级回原图) */}
                    <img
                      src={getCardThumbnailUrl(card.imageUrl, card.cardNumber)}
                      alt={card.name}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                      onError={(e) => {
                        handleThumbnailError(e, card.imageUrl || `/cards/${card.cardNumber}.png`);
                      }}
                    />

                    {/* 异画/星级/原画独立标签 (不显示多形态，直接展示本卡特定版本) */}
                    <div
                      className={`absolute top-2 right-2 px-1.5 py-0.5 rounded backdrop-blur text-[10px] font-mono flex items-center gap-1 shadow-md border ${
                        isFoil
                          ? 'bg-black/85 border-amber-400/80 text-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.35)]'
                          : 'bg-black/75 border-neutral-700 text-neutral-300'
                      }`}
                    >
                      {isFoil && <Sparkles className="w-2.5 h-2.5 text-amber-300" />}
                      <span>{card.variantBadge || (card.variantRarity || card.rarity) || '原画'}</span>
                    </div>

                    {/* 费用徽章 */}
                    <div className="absolute top-2 left-2 w-6 h-6 rounded-full bg-black/80 backdrop-blur border border-terminalCyan/70 flex items-center justify-center font-mono font-bold text-xs text-terminalCyan shadow">
                      {card.cost}
                    </div>

                    {/* 底部悬浮快捷信息条 */}
                    <div className="absolute bottom-0 inset-x-0 p-2 bg-gradient-to-t from-black/95 via-black/70 to-transparent flex flex-col gap-1 opacity-90 group-hover:opacity-100 transition-opacity">
                      <div className="flex justify-between items-center text-[10px] font-mono">
                        <span className="text-neutral-400 font-bold">{card.cardNumber}</span>
                        <span className={`px-1 rounded border text-[9px] ${getAttrColor(card.attribute, card.attributeName)}`}>
                          {card.attributeName || (card.attribute === ElementAttribute.VOID ? '空' : card.attribute)}
                        </span>
                      </div>
                      <div className="font-bold text-xs text-white truncate drop-shadow-sm">
                        {card.name}
                      </div>

                      {/* 战斗数值 */}
                      {card.cardType === CardType.ROLE && (
                        <div className="flex justify-between items-center text-[10px] font-mono pt-0.5 border-t border-white/10">
                          <span className="text-terminalCyan font-bold">{card.basePP ?? 0} PP</span>
                          <span className="text-erosionRed font-bold">{card.baseDP ?? 0} DP</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 悬停光效边框指示 */}
                  <div className="p-2.5 flex items-center justify-between border-t border-terminalBorder/60 bg-black/40 text-[11px]">
                    <div className="flex items-center gap-1.5 font-mono text-[10px]">
                      <span className="text-neutral-400">{formatCardType(card.cardType, card.isInstant)}</span>
                      <span className="px-1 rounded bg-black/60 border border-neutral-700 text-amber-300 font-bold">
                        {card.variantRarity || card.rarity}
                      </span>
                    </div>
                    <span className="text-terminalCyan flex items-center gap-0.5 font-mono text-[10px] group-hover:underline">
                      检视详情 <ChevronRight className="w-3 h-3" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          /* 紧凑表格清单视图 */
          <div className="w-full overflow-x-auto rounded-xl border border-terminalBorder bg-surface/80 backdrop-blur">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-terminalBorder bg-black/50 text-neutral-400 font-mono text-[11px]">
                  <th className="py-3 px-4">卡图</th>
                  <th className="py-3 px-3">卡号</th>
                  <th className="py-3 px-3">版本形态</th>
                  <th className="py-3 px-3">名称</th>
                  <th className="py-3 px-3">类型</th>
                  <th className="py-3 px-3">属性</th>
                  <th className="py-3 px-3 text-center">费用</th>
                  <th className="py-3 px-3 text-right">PP / DP</th>
                  <th className="py-3 px-4">词条特征</th>
                  <th className="py-3 px-4">效果简述</th>
                  <th className="py-3 px-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-terminalBorder/40">
                {displayedCards.map((card) => (
                  <tr
                    key={card.id}
                    className="hover:bg-terminalCyan/5 transition-colors group"
                  >
                    <td className="py-2 px-4">
                      <div className="w-10 h-14 rounded overflow-hidden border border-terminalBorder bg-black">
                        <img
                          src={getCardThumbnailUrl(card.imageUrl, card.cardNumber)}
                          alt={card.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onError={(e) => {
                            handleThumbnailError(e, card.imageUrl || `/cards/${card.cardNumber}.png`);
                          }}
                        />
                      </div>
                    </td>
                    <td className="py-2 px-3 font-mono font-bold text-terminalCyan whitespace-nowrap">
                      {card.cardNumber}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span
                        className={`px-1.5 py-0.5 rounded border text-[10px] font-mono ${
                          card.variantStar > 0
                            ? 'border-amber-400/60 bg-amber-400/10 text-amber-300 font-bold'
                            : 'border-neutral-700 bg-neutral-900 text-neutral-300'
                        }`}
                      >
                        {card.variantBadge || card.variantName}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-bold text-white whitespace-nowrap">
                      <Link href={`/cards/${card.cardNumber}?variant=${encodeURIComponent(card.variantKey)}`} className="hover:underline">
                        {card.name}
                      </Link>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-neutral-300">
                      {formatCardType(card.cardType, card.isInstant)}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] ${getAttrColor(card.attribute, card.attributeName)}`}>
                        {card.attributeName || (card.attribute === ElementAttribute.VOID ? '空' : card.attribute)}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-center font-mono font-bold text-terminalCyan">
                      {card.cost}
                    </td>
                    <td className="py-2 px-3 text-right font-mono whitespace-nowrap">
                      {card.cardType === CardType.ROLE ? (
                        <span>
                          <strong className="text-terminalCyan">{card.basePP ?? 0}</strong>
                          <span className="text-neutral-500 mx-1">/</span>
                          <strong className="text-erosionRed">{card.baseDP ?? 0}</strong>
                        </span>
                      ) : (
                        <span className="text-neutral-600">-</span>
                      )}
                    </td>
                    <td className="py-2 px-4">
                      <div className="flex flex-wrap gap-1 max-w-[150px]">
                        {card.traits.map((t) => (
                          <span key={t} className="px-1 py-0.2 rounded bg-neutral-800 text-[10px] text-neutral-400">
                            {t}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-2 px-4 text-neutral-300 max-w-xs truncate text-[11px]" title={card.rulesText}>
                      {card.rulesText}
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap">
                      <Link
                        href={`/cards/${card.cardNumber}?variant=${encodeURIComponent(card.variantKey)}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-terminalBorder bg-surface hover:border-terminalCyan hover:text-terminalCyan transition-colors font-mono text-[11px]"
                      >
                        详情 <ExternalLink className="w-3 h-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
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
      </main>

      {/* 悬浮返回顶部按钮 */}
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className="fixed bottom-6 right-6 z-40 p-3 rounded-full bg-surface/90 border border-terminalBorder hover:border-terminalCyan text-neutral-400 hover:text-terminalCyan shadow-xl backdrop-blur transition-all hover:scale-110 flex items-center justify-center cursor-pointer group"
        title="回到顶部"
      >
        <ArrowUp className="w-5 h-5 group-hover:-translate-y-0.5 transition-transform" />
      </button>
    </div>
  );
}
