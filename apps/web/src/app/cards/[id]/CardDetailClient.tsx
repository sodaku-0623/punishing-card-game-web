'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRouteId } from '@/lib/route-id';
import {
  ALL_OFFICIAL_CARDS,
  CardData,
  CardVariant,
  findCardByNumberOrId,
  getCardVariants,
  getCardSeries,
  getRelatedCards,
  formatCardType,
  getAttributeDisplay,
} from '@/lib/cards-data';
import { CardType, ElementAttribute, SignalOrbType } from '@zhanshuang/shared';
import { getCardThumbnailUrl, getCardFullImageUrl, handleThumbnailError } from '@/lib/card-image';
import { copyText } from '@/lib/clipboard';
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Zap,
  Shield,
  Layers,
  Swords,
  ExternalLink,
  BookOpen,
  ZoomIn,
  X,
  Share2,
  Copy,
  Check,
  Flame,
  Moon,
  Info,
} from 'lucide-react';

export default function CardDetailPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const variantParam = searchParams.get('variant');
  const cardId = useRouteId();

  const card = useMemo(() => findCardByNumberOrId(cardId), [cardId]);
  const variants = useMemo(() => (card ? getCardVariants(card.cardNumber) : []), [card]);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);

  useEffect(() => {
    if (variantParam && variants.length > 0) {
      const idx = variants.findIndex((v) => v.key === variantParam || v.imageUrl.includes(variantParam));
      if (idx >= 0) {
        setSelectedVariantIndex(idx);
      }
    }
  }, [variantParam, variants]);

  const [isZoomOpen, setIsZoomOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // 上一张 / 下一张
  const { prevCard, nextCard } = useMemo(() => {
    if (!card) return { prevCard: null, nextCard: null };
    const currentIndex = ALL_OFFICIAL_CARDS.findIndex((c) => c.cardNumber === card.cardNumber);
    const prev = currentIndex > 0 ? ALL_OFFICIAL_CARDS[currentIndex - 1] : null;
    const next = currentIndex < ALL_OFFICIAL_CARDS.length - 1 ? ALL_OFFICIAL_CARDS[currentIndex + 1] : null;
    return { prevCard: prev, nextCard: next };
  }, [card]);

  // 关联卡牌 (同名或同阵营)
  const relatedCards = useMemo(() => (card ? getRelatedCards(card) : []), [card]);

  if (!card) {
    return (
      <div className="min-h-screen bg-background text-neutral-200 flex flex-col items-center justify-center p-6 text-center">
        <Info className="w-16 h-16 text-erosionRed mb-4" />
        <h2 className="text-2xl font-bold text-white mb-2">卡牌档案未检出</h2>
        <p className="text-sm text-neutral-400 max-w-md mb-6">
          无法在空中花园数据库中找到编号或标识为 <code className="text-terminalCyan font-mono">{cardId}</code> 的卡牌资料。
        </p>
        <Link
          href="/cards"
          className="px-5 py-2.5 rounded-lg border border-terminalCyan bg-terminalCyan/10 text-terminalCyan font-medium hover:bg-terminalCyan/20 transition-all"
        >
          返回卡牌图鉴总览
        </Link>
      </div>
    );
  }

  const activeImage = getCardFullImageUrl(
    variants[selectedVariantIndex]?.imageUrl || card.imageUrl,
    card.cardNumber
  );
  const packageName = card.packageName || card.flavorText || getCardSeries(card.cardNumber);

  const copyCardCode = async () => {
    if (!(await copyText(`${card.cardNumber} ${card.name}`))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // 规则文本语法高亮渲染
  const renderRulesText = (text: string) => {
    const lines = text.split('\n');
    return (
      <div className="space-y-2 text-sm leading-relaxed text-neutral-200">
        {lines.map((line, idx) => {
          let formatted: React.ReactNode = line;

          // 包装标签关键字
          const parts = line.split(/(【[^】]+】|《[^》]+》|\[费用\d+\]|<[^>]+>)/g);
          formatted = parts.map((part, pIdx) => {
            if (part.startsWith('【升变】')) {
              return (
                <span key={pIdx} className="px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold border border-purple-500/40">
                  {part}
                </span>
              );
            }
            if (part.startsWith('【出】')) {
              return (
                <span key={pIdx} className="px-1.5 py-0.5 rounded bg-terminalCyan/20 text-terminalCyan font-bold border border-terminalCyan/40">
                  {part}
                </span>
              );
            }
            if (part.startsWith('【起】')) {
              return (
                <span key={pIdx} className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40">
                  {part}
                </span>
              );
            }
            if (part.startsWith('【自】') || part.startsWith('【充能自】')) {
              return (
                <span key={pIdx} className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/40">
                  {part}
                </span>
              );
            }
            if (part.startsWith('【永】')) {
              return (
                <span key={pIdx} className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-bold border border-blue-500/40">
                  {part}
                </span>
              );
            }
            if (part.startsWith('《') && part.endsWith('》')) {
              return (
                <span key={pIdx} className="px-1.5 py-0.5 rounded bg-erosionRed/20 text-erosionRed font-bold border border-erosionRed/40">
                  {part}
                </span>
              );
            }
            if (part.startsWith('[费用')) {
              return (
                <span key={pIdx} className="px-1 py-0.5 rounded bg-neutral-800 text-terminalCyan font-mono font-bold">
                  {part}
                </span>
              );
            }
            if (part.startsWith('<') && part.endsWith('>')) {
              return (
                <span key={pIdx} className="text-terminalCyan underline font-semibold">
                  {part}
                </span>
              );
            }
            return part;
          });

          return <p key={idx}>{formatted}</p>;
        })}
      </div>
    );
  };

  const attrBadge = getAttributeDisplay(card.attribute, card.attributeName);

  return (
    <div className="w-full min-h-screen bg-background text-neutral-200 p-4 md:p-8 flex flex-col items-center overflow-x-hidden overflow-y-auto">
      {/* 顶部面包屑与上一张/下一张快速导航 */}
      <header className="w-full max-w-6xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-terminalBorder/60 pb-4 mb-8">
        <div className="flex items-center gap-2 text-xs font-mono text-neutral-400">
          <Link href="/" className="hover:text-terminalCyan transition-colors">
            终端首页
          </Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <Link href="/cards" className="hover:text-terminalCyan transition-colors">
            卡牌图鉴
          </Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-terminalCyan font-bold">{card.cardNumber}</span>
          <span className="text-neutral-500 font-sans">({card.name})</span>
        </div>

        <div className="flex items-center gap-3">
          {prevCard && (
            <Link
              href={`/cards/${prevCard.cardNumber}`}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-terminalBorder bg-surface hover:border-terminalCyan/70 text-xs font-mono transition-all"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>{prevCard.cardNumber}</span>
            </Link>
          )}
          {nextCard && (
            <Link
              href={`/cards/${nextCard.cardNumber}`}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-terminalBorder bg-surface hover:border-terminalCyan/70 text-xs font-mono transition-all"
            >
              <span>{nextCard.cardNumber}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          )}
        </div>
      </header>

      {/* 主检视工作台 */}
      <main className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-start mb-12">
        {/* 左侧：3D全息立绘与异画卡面切换 */}
        <section className="lg:col-span-5 flex flex-col items-center">
          <div className="relative group w-full max-w-[380px] aspect-[7/10] rounded-2xl overflow-hidden border-2 border-terminalBorder bg-neutral-950 shadow-[0_0_30px_rgba(0,0,0,0.8)] hover:border-terminalCyan transition-all duration-300">
            {/* 卡牌立绘大图 */}
            <img
              src={activeImage}
              alt={card.name}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
              onError={(e) => {
                // 如果特定异画加载失败，降级回标准图
                (e.target as HTMLImageElement).src = `/cards/${card.cardNumber}.png`;
              }}
            />

            {/* 全屏放大按钮 */}
            <button
              onClick={() => setIsZoomOpen(true)}
              className="absolute top-3 right-3 p-2 rounded-xl bg-black/70 backdrop-blur border border-terminalBorder text-white opacity-0 group-hover:opacity-100 transition-opacity hover:border-terminalCyan hover:text-terminalCyan shadow-lg"
              title="全屏检视卡牌立绘"
            >
              <ZoomIn className="w-5 h-5" />
            </button>

            {/* 卡面版本浮标 */}
            {variants.length > 1 && (
              <div className="absolute top-3 left-3 px-2 py-1 rounded bg-black/80 backdrop-blur border border-amber-400/60 text-xs font-mono text-amber-300 flex items-center gap-1.5 shadow-md">
                <Sparkles className="w-3 h-3 text-amber-300" />
                <span>{variants[selectedVariantIndex]?.badge || '异画版本'}</span>
              </div>
            )}
          </div>

          {/* 异画/箔面切换选项 */}
          {variants.length > 1 && (
            <div className="mt-4 w-full max-w-[380px] flex flex-col gap-2">
              <span className="text-xs font-mono text-neutral-400 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                可切换卡面形态 (Rarity & Variants)
              </span>
              <div className="grid grid-cols-3 gap-2">
                {variants.map((v, i) => (
                  <button
                    key={v.name}
                    onClick={() => setSelectedVariantIndex(i)}
                    className={`py-2 px-2.5 rounded-lg border text-xs font-medium transition-all text-center truncate ${
                      selectedVariantIndex === i
                        ? 'border-amber-400 bg-amber-400/15 text-amber-300 shadow-[0_0_12px_rgba(251,191,36,0.3)]'
                        : 'border-terminalBorder/60 bg-surface/50 text-neutral-400 hover:text-white hover:border-terminalBorder'
                    }`}
                  >
                    {v.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 快捷操作条 */}
          <div className="mt-4 w-full max-w-[380px] flex gap-2">
            <button
              onClick={copyCardCode}
              className="flex-1 py-2 px-3 rounded-lg border border-terminalBorder bg-surface hover:border-terminalCyan/70 text-xs font-mono text-neutral-300 hover:text-white flex items-center justify-center gap-1.5 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? '已复制卡号' : '复制卡牌信息'}
            </button>
            <Link
              href="/decks"
              className="flex-1 py-2 px-3 rounded-lg border border-terminalCyan/50 bg-terminalCyan/10 hover:bg-terminalCyan/20 text-xs font-mono text-terminalCyan flex items-center justify-center gap-1.5 transition-colors"
            >
              <Layers className="w-3.5 h-3.5" />
              前往构筑卡组
            </Link>
          </div>
        </section>

        {/* 右侧：战术参数、详细效果解析与背景设定 */}
        <section className="lg:col-span-7 flex flex-col gap-6">
          {/* 卡牌主标题与标签 */}
          <div className="border-b border-terminalBorder/60 pb-5">
            <div className="flex flex-wrap items-center gap-2 mb-2 font-mono text-xs">
              <span className="px-2.5 py-0.5 rounded bg-terminalCyan/20 text-terminalCyan font-bold border border-terminalCyan/40">
                {card.cardNumber}
              </span>
              <span className={`px-2.5 py-0.5 rounded border font-semibold ${attrBadge.color}`}>
                {attrBadge.badgeText}
              </span>
              <span className="px-2.5 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
                {formatCardType(card.cardType, card.isInstant)}
              </span>
              {card.isInstant && (
                <span className="px-2.5 py-0.5 rounded bg-erosionRed/20 text-erosionRed font-bold border border-erosionRed/40">
                  瞬时战术 INSTANT
                </span>
              )}
              {card.signalOrb && (
                <span className="px-2.5 py-0.5 rounded bg-neutral-800 text-amber-300 font-bold border border-amber-500/40">
                  {card.signalOrb} 信号球
                </span>
              )}
            </div>

            <h2 className="text-3xl md:text-4xl font-black tracking-tight text-white mb-3">
              {card.name}
            </h2>

            {/* 特征词条 */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono text-neutral-400">词条特征:</span>
              {card.traits.map((trait) => (
                <span
                  key={trait}
                  className="px-2 py-0.5 rounded-full bg-neutral-900 border border-terminalBorder text-xs text-neutral-300 font-medium"
                >
                  #{trait}
                </span>
              ))}
            </div>
          </div>

          {/* 战斗核心数值规格 HUD */}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {/* 费用 */}
            <div className="p-3.5 rounded-xl border border-terminalBorder bg-surface/70 flex flex-col gap-1">
              <span className="text-[11px] font-mono text-neutral-400">出场费用 COST</span>
              <div className="text-2xl font-black font-mono text-terminalCyan flex items-center gap-1">
                {card.cost}
                <span className="text-xs font-normal text-neutral-500">费</span>
              </div>
            </div>

            {/* 攻击力 PP */}
            <div className="p-3.5 rounded-xl border border-terminalBorder bg-surface/70 flex flex-col gap-1">
              <span className="text-[11px] font-mono text-neutral-400">攻击力 PP</span>
              <div className="text-2xl font-black font-mono text-white flex items-center gap-1">
                {card.basePP !== undefined ? (
                  <>
                    <span className="text-terminalCyan">{card.basePP}</span>
                  </>
                ) : (
                  <span className="text-neutral-600">-</span>
                )}
              </div>
            </div>

            {/* 伤害点数 DP */}
            <div className="p-3.5 rounded-xl border border-terminalBorder bg-surface/70 flex flex-col gap-1">
              <span className="text-[11px] font-mono text-neutral-400">伤害点数 DP</span>
              <div className="text-2xl font-black font-mono text-erosionRed flex items-center gap-1">
                {card.baseDP !== undefined ? (
                  <>
                    <span>{card.baseDP}</span>
                    <span className="text-xs font-normal text-neutral-500">点</span>
                  </>
                ) : (
                  <span className="text-neutral-600">-</span>
                )}
              </div>
            </div>

            {/* 所属卡包 */}
            <div className="p-3.5 rounded-xl border border-terminalBorder bg-surface/70 flex flex-col gap-1 col-span-3 sm:col-span-1">
              <span className="text-[11px] font-mono text-neutral-400">所属卡包</span>
              <div className="text-xs font-bold text-terminalCyan truncate mt-1" title={packageName}>
                {packageName}
              </div>
            </div>
          </div>

          {/* 官方规则效果文本解析 */}
          <div className="p-5 rounded-xl border border-terminalBorder bg-surface/90 shadow-md flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs font-mono text-terminalCyan font-bold tracking-wider uppercase border-b border-terminalBorder/50 pb-2">
              <BookOpen className="w-4 h-4 text-terminalCyan" />
              官方规则效果文本 (RULES SPECIFICATIONS)
            </div>
            {renderRulesText(card.rulesText)}
          </div>

          {/* 世界观背景与风味文本 */}
          {card.flavorText && (
            <div className="p-4 rounded-xl border border-neutral-800 bg-neutral-950/60 text-xs italic text-neutral-400 flex items-start gap-3">
              <span className="text-2xl text-terminalCyan/40 select-none">“</span>
              <p className="flex-1 leading-relaxed mt-1">{card.flavorText}</p>
              <span className="text-2xl text-terminalCyan/40 select-none">”</span>
            </div>
          )}

          {/* 构筑规则指引 (5.1 规则书条款说明) */}
          <div className="p-4 rounded-xl border border-terminalCyan/20 bg-terminalCyan/5 flex items-start gap-3 text-xs">
            <Info className="w-4 h-4 text-terminalCyan shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1 leading-relaxed text-neutral-300">
              <span className="font-bold text-terminalCyan font-mono">《综合规则》5.1 牌组构筑约束提醒：</span>
              <span>
                本卡牌同名在标准 50 张对战卡组中投入上限为 <strong>4 张</strong>。
                若与其他不同卡号的卡牌完全同名（例如同为“{card.name}”），则同名卡牌总合计数量亦不能超过 4 张。
              </span>
            </div>
          </div>

          {/* 关联形态卡牌 / 升变进化链 */}
          {relatedCards.length > 0 && (
            <div className="flex flex-col gap-3 pt-2">
              <div className="flex justify-between items-center text-xs font-mono text-neutral-400 border-b border-terminalBorder/40 pb-2">
                <span>关联角色形态与升变线 ({relatedCards.length} 张)</span>
                <span className="text-neutral-500">点击切换检视</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {relatedCards.map((rc) => (
                  <Link
                    key={rc.id}
                    href={`/cards/${rc.cardNumber}`}
                    className="p-2 rounded-lg border border-terminalBorder bg-surface hover:border-terminalCyan transition-all flex items-center gap-2 group"
                  >
                    <div className="w-10 h-14 rounded overflow-hidden bg-black shrink-0 border border-terminalBorder/60">
                      <img
                        src={getCardThumbnailUrl(rc.imageUrl, rc.cardNumber)}
                        alt={rc.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          handleThumbnailError(e, rc.imageUrl || `/cards/${rc.cardNumber}.png`);
                        }}
                      />
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="text-[10px] font-mono text-terminalCyan font-bold">
                        {rc.cardNumber}
                      </span>
                      <span className="text-xs font-bold text-white truncate group-hover:text-terminalCyan transition-colors">
                        {rc.name}
                      </span>
                      <span className="text-[10px] text-neutral-400 font-mono">
                        {rc.cost}费 / {rc.basePP ? `${rc.basePP}PP` : formatCardType(rc.cardType, rc.isInstant)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>

      {/* 全屏放大检视弹窗 */}
      {isZoomOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setIsZoomOpen(false)}
        >
          <div
            className="relative max-w-2xl max-h-[90vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setIsZoomOpen(false)}
              className="absolute -top-12 right-0 p-2 text-neutral-400 hover:text-white"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={activeImage}
              alt={card.name}
              className="max-h-[85vh] w-auto object-contain rounded-2xl shadow-2xl border border-terminalBorder"
            />
            <div className="mt-3 text-center text-xs font-mono text-neutral-400">
              {card.cardNumber} • {card.name} {variants.length > 1 && `(${variants[selectedVariantIndex]?.name})`}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
