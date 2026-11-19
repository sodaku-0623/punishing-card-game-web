'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useRouteId } from '@/lib/route-id';
import {
  ALL_OFFICIAL_CARDS,
  findCardByNumberOrId,
  getCardVariants,
  getCardSeries,
  getRelatedCards,
  formatCardType,
  getAttributeDisplay,
} from '@/lib/cards-data';
import {
  getCardThumbnailUrl,
  getCardFullImageUrl,
  handleThumbnailError,
} from '@/lib/card-image';
import { copyText } from '@/lib/clipboard';
import {
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Layers,
  BookOpen,
  ZoomIn,
  Copy,
  Check,
  Info,
  ArrowLeft,
} from 'lucide-react';
import {
  AppShell,
  Button,
  Badge,
  Panel,
  Dialog,
  HudBrackets,
  HudRule,
} from '@/components/ui';

export default function CardDetailPage() {
  const searchParams = useSearchParams();
  const variantParam = searchParams.get('variant');
  const cardId = useRouteId();

  const card = useMemo(() => findCardByNumberOrId(cardId), [cardId]);
  const variants = useMemo(() => (card ? getCardVariants(card.cardNumber) : []), [card]);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);

  useEffect(() => {
    if (variantParam && variants.length > 0) {
      const idx = variants.findIndex(
        (v) => v.key === variantParam || v.imageUrl.includes(variantParam),
      );
      if (idx >= 0) {
        setSelectedVariantIndex(idx);
      }
    }
  }, [variantParam, variants]);

  const [isZoomOpen, setIsZoomOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { prevCard, nextCard } = useMemo(() => {
    if (!card) return { prevCard: null, nextCard: null };
    const currentIndex = ALL_OFFICIAL_CARDS.findIndex(
      (c) => c.cardNumber === card.cardNumber,
    );
    return {
      prevCard: currentIndex > 0 ? ALL_OFFICIAL_CARDS[currentIndex - 1] : null,
      nextCard:
        currentIndex < ALL_OFFICIAL_CARDS.length - 1
          ? ALL_OFFICIAL_CARDS[currentIndex + 1]
          : null,
    };
  }, [card]);

  const relatedCards = useMemo(() => (card ? getRelatedCards(card) : []), [card]);

  if (!card) {
    return (
      <AppShell className="flex flex-col items-center justify-center py-24 text-center">
        <Info className="w-12 h-12 text-crimson-400 mb-4" />
        <h1 className="text-title font-bold text-fg mb-2">卡牌档案未检出</h1>
        <p className="text-body-sm text-fg-secondary max-w-md mb-6">
          无法在空中花园数据库中找到编号或标识为{' '}
          <code className="font-num text-teal-400">{cardId}</code> 的卡牌资料。
        </p>
        <Link href="/cards">
          <Button variant="secondary" size="md">
            <ArrowLeft className="w-4 h-4" />
            <span>返回卡牌图鉴总览</span>
          </Button>
        </Link>
      </AppShell>
    );
  }

  const activeImage = getCardFullImageUrl(
    variants[selectedVariantIndex]?.imageUrl || card.imageUrl,
    card.cardNumber,
  );
  const packageName = card.packageName || card.flavorText || getCardSeries(card.cardNumber);
  const attrBadge = getAttributeDisplay(card.attribute, card.attributeName);

  const copyCardCode = async () => {
    if (!(await copyText(`${card.cardNumber} ${card.name}`))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const renderRulesText = (text: string) => {
    const lines = text.split('\n');
    return (
      <div className="space-y-2.5 text-body leading-relaxed text-fg-secondary">
        {lines.map((line, idx) => {
          const parts = line.split(/(【[^】]+】|《[^》]+》|\[费用\d+\]|<[^>]+>)/g);
          return (
            <p key={idx}>
              {parts.map((part, pIdx) => {
                if (part.startsWith('【升变')) {
                  return (
                    <span
                      key={pIdx}
                      className="inline-block px-1.5 py-0.5 mx-0.5 bg-crimson-700/30 text-crimson-400 font-semibold border border-crimson-500/50 text-caption"
                    >
                      {part}
                    </span>
                  );
                }
                if (part.startsWith('【出】') || part.startsWith('【永】')) {
                  return (
                    <span
                      key={pIdx}
                      className="inline-block px-1.5 py-0.5 mx-0.5 bg-teal-400/15 text-teal-400 font-semibold border border-teal-400/50 text-caption"
                    >
                      {part}
                    </span>
                  );
                }
                if (part.startsWith('【起】') || part.startsWith('【瞬时】')) {
                  return (
                    <span
                      key={pIdx}
                      className="inline-block px-1.5 py-0.5 mx-0.5 bg-gold-300/15 text-gold-300 font-semibold border border-gold-300/50 text-caption"
                    >
                      {part}
                    </span>
                  );
                }
                if (part.startsWith('【自】') || part.startsWith('【充能自】')) {
                  return (
                    <span
                      key={pIdx}
                      className="inline-block px-1.5 py-0.5 mx-0.5 bg-success/15 text-success font-semibold border border-success/50 text-caption"
                    >
                      {part}
                    </span>
                  );
                }
                if (part.startsWith('《') && part.endsWith('》')) {
                  return (
                    <span key={pIdx} className="text-fg font-semibold">
                      {part}
                    </span>
                  );
                }
                if (part.startsWith('[费用')) {
                  return (
                    <span
                      key={pIdx}
                      className="inline-block px-1.5 py-0.5 mx-0.5 bg-ink-700 text-gold-300 font-num text-caption font-semibold"
                    >
                      {part}
                    </span>
                  );
                }
                if (part.startsWith('<') && part.endsWith('>')) {
                  return (
                    <span key={pIdx} className="text-teal-400 underline underline-offset-2">
                      {part}
                    </span>
                  );
                }
                return part;
              })}
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <AppShell className="space-y-6">
      {/* 顶部面包屑与前后切换 */}
      <header className="border-b border-line pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 pgr-enter">
        <div className="flex flex-wrap items-center gap-2 text-caption text-fg-muted">
          <Link
            href="/cards"
            className="inline-flex items-center gap-1 hover:text-fg transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>返回卡牌图鉴</span>
          </Link>
          <span>/</span>
          <span className="font-num text-crimson-400 font-semibold">{card.cardNumber}</span>
          <span className="text-fg-secondary">{card.name}</span>
        </div>

        <div className="flex items-center gap-2">
          {prevCard && (
            <Link href={`/cards/${prevCard.cardNumber}`}>
              <Button variant="secondary" size="sm" className="font-num">
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>{prevCard.cardNumber}</span>
              </Button>
            </Link>
          )}
          {nextCard && (
            <Link href={`/cards/${nextCard.cardNumber}`}>
              <Button variant="secondary" size="sm" className="font-num">
                <span>{nextCard.cardNumber}</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          )}
        </div>
      </header>

      {/* 主检视区 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* 左侧卡面展台 */}
        <section className="lg:col-span-5 flex flex-col items-center pgr-enter">
          <div className="group relative w-full max-w-[380px] p-3 border border-line bg-steel-grid">
            <HudBrackets color="steel" interactive />

            <div className="relative aspect-[7/10] w-full overflow-hidden rounded-card border border-line-strong bg-ink-950">
              <img
                src={activeImage}
                alt={card.name}
                className="w-full h-full object-cover transition-transform duration-slow ease-enter group-hover:scale-[1.02]"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = `/cards/${card.cardNumber}.png`;
                }}
              />

              <button
                type="button"
                onClick={() => setIsZoomOpen(true)}
                aria-label="全屏检视卡牌原图"
                title="全屏检视卡牌原图"
                className="absolute top-2.5 right-2.5 h-9 w-9 bg-ink-950/85 backdrop-blur-md border border-line-strong text-fg inline-flex items-center justify-center opacity-80 group-hover:opacity-100 hover:border-fg transition-all cursor-pointer"
              >
                <ZoomIn className="w-4 h-4" />
              </button>

              {variants.length > 1 && (
                <div className="absolute top-2.5 left-2.5">
                  <Badge variant="gold">
                    <Sparkles className="w-3 h-3" />
                    <span>{variants[selectedVariantIndex]?.badge || '异画版本'}</span>
                  </Badge>
                </div>
              )}
            </div>
          </div>

          {/* 异画形态切换 */}
          {variants.length > 1 && (
            <div className="mt-4 w-full max-w-[380px] space-y-2">
              <div className="font-display text-hud uppercase text-fg-muted flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-gold-300" />
                <span>卡面形态切换 · VARIANTS</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {variants.map((v, i) => (
                  <button
                    key={v.name}
                    type="button"
                    onClick={() => setSelectedVariantIndex(i)}
                    className={`h-8 px-2 border text-caption font-medium truncate transition-colors cursor-pointer ${
                      selectedVariantIndex === i
                        ? 'border-crimson-500 bg-ink-800 text-fg'
                        : 'border-line bg-ink-900 text-fg-muted hover:text-fg hover:border-line-strong'
                    }`}
                  >
                    {v.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 快捷操作 */}
          <div className="mt-4 w-full max-w-[380px] grid grid-cols-2 gap-2">
            <Button variant="secondary" size="md" onClick={copyCardCode}>
              {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? '已复制卡号' : '复制卡号'}</span>
            </Button>
            <Link href="/decks" className="w-full">
              <Button variant="primary" size="md" className="w-full">
                <Layers className="w-4 h-4" />
                <span>前往构筑</span>
              </Button>
            </Link>
          </div>
        </section>

        {/* 右侧档案数据与规则文本 */}
        <section className="lg:col-span-7 space-y-6 pgr-enter pgr-delay-1">
          <div className="border-b border-line pb-5 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="crimson" className="font-num">
                {card.cardNumber}
              </Badge>
              <span
                className={`inline-flex items-center h-5 px-2 text-caption font-medium border ${attrBadge.color}`}
              >
                {attrBadge.badgeText}
              </span>
              <Badge variant="neutral">
                {formatCardType(card.cardType, card.isInstant)}
              </Badge>
              {card.isInstant && <Badge variant="gold">瞬时 INSTANT</Badge>}
              {card.signalOrb && (
                <Badge variant="neutral">{card.signalOrb} 信号球</Badge>
              )}
            </div>

            <h1 className="text-display font-bold text-fg tracking-tight">{card.name}</h1>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-caption text-fg-muted">特征词条：</span>
              {card.traits.map((trait) => (
                <span
                  key={trait}
                  className="px-2 py-0.5 border border-line bg-ink-900 text-caption text-fg-secondary"
                >
                  #{trait}
                </span>
              ))}
            </div>
          </div>

          {/* 战斗核心数值 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="border border-line bg-ink-850 p-3.5">
              <div className="font-display text-hud uppercase text-fg-muted">COST 费用</div>
              <div className="font-num tabular-nums text-display font-bold text-gold-300 mt-1">
                {card.cost}
              </div>
            </div>

            <div className="border border-line bg-ink-850 p-3.5">
              <div className="font-display text-hud uppercase text-fg-muted">BASE PP</div>
              <div className="font-num tabular-nums text-display font-bold text-fg mt-1">
                {card.basePP !== undefined ? card.basePP : '—'}
              </div>
            </div>

            <div className="border border-line bg-ink-850 p-3.5">
              <div className="font-display text-hud uppercase text-fg-muted">BASE DP</div>
              <div className="font-num tabular-nums text-display font-bold text-crimson-400 mt-1">
                {card.baseDP !== undefined ? card.baseDP : '—'}
              </div>
            </div>

            <div className="border border-line bg-ink-850 p-3.5">
              <div className="font-display text-hud uppercase text-fg-muted">SERIES 卡包</div>
              <div
                className="text-body-sm font-medium text-fg-secondary mt-2 truncate"
                title={packageName}
              >
                {packageName}
              </div>
            </div>
          </div>

          {/* 规则效果文本 */}
          <Panel
            title="官方规则效果文本"
            subtitle="RULES SPECIFICATIONS"
            headerRight={<BookOpen className="w-4 h-4 text-fg-muted" />}
          >
            {renderRulesText(card.rulesText)}
          </Panel>

          {/* 风味文本 */}
          {card.flavorText && (
            <blockquote className="border-l-2 border-steel-500 bg-ink-900 px-4 py-3 text-body-sm italic text-fg-muted">
              “{card.flavorText}”
            </blockquote>
          )}

          {/* 5.1 构筑上限提示 */}
          <div className="border border-line bg-ink-900/70 p-4 flex items-start gap-3 text-caption text-fg-secondary">
            <Info className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-semibold text-fg">《综合规则》5.1 同名卡牌投入限制</div>
              <p>
                本卡牌在 50 张标准卡组中最多投入 <strong className="font-num text-fg">4</strong> 张；
                与其他不同卡号但完全同名（《{card.name}》）的卡牌合计亦不得超过 4 张。
              </p>
            </div>
          </div>

          {/* 关联形态 */}
          {relatedCards.length > 0 && (
            <div className="space-y-3 pt-2">
              <HudRule code={`RELATED FORMS // ${String(relatedCards.length).padStart(2, '0')}`} />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {relatedCards.map((rc) => (
                  <Link
                    key={rc.id}
                    href={`/cards/${rc.cardNumber}`}
                    className="group p-2 border border-line bg-ink-850 hover:border-line-strong hover:bg-ink-800 transition-colors flex items-center gap-2.5"
                  >
                    <div className="w-10 h-14 rounded-card overflow-hidden bg-ink-950 shrink-0 border border-line">
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
                    <div className="min-w-0">
                      <div className="font-num text-hud text-crimson-400 font-semibold">
                        {rc.cardNumber}
                      </div>
                      <div className="text-caption font-semibold text-fg truncate">
                        {rc.name}
                      </div>
                      <div className="font-num text-hud text-fg-muted mt-0.5">
                        {rc.cost}费 · {rc.basePP ? `${rc.basePP}PP` : formatCardType(rc.cardType, rc.isInstant)}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* 全屏放大检视弹窗 */}
      <Dialog
        open={isZoomOpen}
        onClose={() => setIsZoomOpen(false)}
        title={`${card.cardNumber} · ${card.name}`}
        subtitle={variants.length > 1 ? variants[selectedVariantIndex]?.name : 'FULL ARTWORK VIEW'}
        size="lg"
        blurBackdrop
      >
        <div className="flex flex-col items-center">
          <img
            src={activeImage}
            alt={card.name}
            className="max-h-[75vh] w-auto object-contain rounded-card border border-line-strong"
          />
        </div>
      </Dialog>
    </AppShell>
  );
}
