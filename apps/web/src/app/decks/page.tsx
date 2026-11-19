'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Layers,
  Plus,
  Copy,
  Trash2,
  Edit3,
  CheckCircle2,
  AlertCircle,
  FileCode,
  Upload,
  ArrowRight,
  Shield,
  Check,
} from 'lucide-react';
import { OFFICIAL_STARTER_DECKS, StarterDeck } from '@/lib/starter-decks';
import { copyText } from '@/lib/clipboard';
import { getCardThumbnailUrl, handleThumbnailError } from '@/lib/card-image';
import {
  AppShell,
  Button,
  Badge,
  SectionHeader,
  Dialog,
  HudBrackets,
  HudRule,
} from '@/components/ui';

export type SavedDeck = StarterDeck;

const PRESET_DECKS: SavedDeck[] = OFFICIAL_STARTER_DECKS;

export default function DecksPage() {
  const router = useRouter();
  const [userDecks, setUserDecks] = useState<SavedDeck[]>([]);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importCode, setImportCode] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [exportModalDeck, setExportModalDeck] = useState<SavedDeck | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('zhanshuang_user_decks');
    if (saved) {
      try {
        setUserDecks(JSON.parse(saved));
      } catch {
        setUserDecks([]);
      }
    }
  }, []);

  function saveUserDecks(decks: SavedDeck[]) {
    setUserDecks(decks);
    localStorage.setItem('zhanshuang_user_decks', JSON.stringify(decks));
  }

  function handleCreateDeck() {
    router.push('/decks/new');
  }

  function handleCloneDeck(deck: SavedDeck) {
    const newDeck: SavedDeck = {
      ...deck,
      id: `deck-${Date.now()}`,
      name: `${deck.name} (副本)`,
      isOfficial: false,
      createdAt: Date.now(),
    };
    saveUserDecks([newDeck, ...userDecks]);
  }

  function handleDeleteDeck(id: string) {
    if (confirm('确认删除该牌组？')) {
      saveUserDecks(userDecks.filter((d) => d.id !== id));
    }
  }

  function handleImportDeck() {
    setImportError(null);
    try {
      const parsed = JSON.parse(importCode);
      if (!parsed.name || !Array.isArray(parsed.cards)) {
        setImportError('卡组数据格式不正确：缺少 name 或 cards 数组');
        return;
      }
      const newDeck: SavedDeck = {
        id: `deck-${Date.now()}`,
        name: parsed.name,
        description: parsed.description || '导入的自定义牌组',
        cards: parsed.cards,
        coverImage: parsed.coverImage,
        isOfficial: false,
        createdAt: Date.now(),
      };
      saveUserDecks([newDeck, ...userDecks]);
      setImportModalOpen(false);
      setImportCode('');
    } catch {
      setImportError('JSON 解析失败，请检查粘贴的卡组导出代码是否完整');
    }
  }

  async function handleCopyExport() {
    if (!exportModalDeck) return;
    if (!(await copyText(JSON.stringify(exportModalDeck, null, 2)))) return;
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  }

  function calculateTotalCards(cards: { count: number }[]) {
    return cards.reduce((acc, c) => acc + c.count, 0);
  }

  return (
    <AppShell className="space-y-10">
      {/* 子品牌钢蓝网格标题头 (design-spec 5.3) */}
      <SectionHeader
        variant="card"
        code="SECTOR 02 // RULE 5.1 STANDARD"
        title="作战构筑中心"
        subtitle="DECK ARCHITECT · 50-CARD OFFICIAL REGULATION"
        watermark="DECKS"
        action={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                setImportError(null);
                setImportModalOpen(true);
              }}
            >
              <Upload className="w-4 h-4" />
              <span>导入代码</span>
            </Button>
            <Button variant="primary" size="md" onClick={handleCreateDeck}>
              <Plus className="w-4 h-4" />
              <span>新建卡组</span>
            </Button>
          </>
        }
      />

      {/* 官方标准入门预组 */}
      <section className="space-y-4 pgr-enter">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="h-4 w-0.5 bg-crimson-500" />
            <Shield className="w-4 h-4 text-gold-300" />
            <h2 className="text-title-sm font-semibold text-fg">官方标准入门预组</h2>
            <Badge variant="gold">只读权威卡表</Badge>
          </div>
          <span className="text-caption text-fg-muted">
            严格符合 5.1 规则书 50 张构筑标准
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {PRESET_DECKS.map((deck) => {
            const total = calculateTotalCards(deck.cards);
            return (
              <div
                key={deck.id}
                className="group relative border border-line bg-ink-850 flex flex-col justify-between transition-colors duration-fast ease-enter hover:border-line-strong"
              >
                <HudBrackets color="steel" interactive />

                {/* 封面图 */}
                <div className="relative h-44 bg-ink-950 overflow-hidden border-b border-line">
                  {deck.coverImage && (
                    <img
                      src={getCardThumbnailUrl(deck.coverImage)}
                      onError={(e) => handleThumbnailError(e, deck.coverImage)}
                      loading="lazy"
                      alt={deck.name}
                      className="w-full h-full object-cover opacity-80 transition-transform duration-base ease-enter group-hover:scale-105"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-ink-850 via-ink-950/20 to-transparent" />
                  <div className="absolute top-3 left-3">
                    <Badge variant="gold">OFFICIAL STARTER</Badge>
                  </div>
                  <div className="absolute bottom-3 right-3 px-2 py-0.5 bg-ink-950/90 border border-line font-num tabular-nums text-caption font-semibold text-fg">
                    {total} / 50
                  </div>
                </div>

                <div className="p-5 flex-1 flex flex-col justify-between gap-4">
                  <div>
                    <h3 className="text-title-sm font-semibold text-fg mb-1.5">
                      {deck.name}
                    </h3>
                    <p className="text-body-sm text-fg-secondary line-clamp-2 leading-relaxed">
                      {deck.description}
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-3 border-t border-line">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCloneDeck(deck)}
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>复制为我的</span>
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => router.push(`/decks/${deck.id}`)}
                    >
                      <span>检视卡表</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <HudRule code={`CUSTOM DECKS // ${String(userDecks.length).padStart(2, '0')}`} />

      {/* 指挥官自定义卡组 */}
      <section className="space-y-4 pgr-enter pgr-delay-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className="h-4 w-0.5 bg-crimson-500" />
            <Layers className="w-4 h-4 text-teal-400" />
            <h2 className="text-title-sm font-semibold text-fg">
              指挥官自定牌组
            </h2>
            <span className="font-num tabular-nums text-caption text-fg-muted">
              ({userDecks.length})
            </span>
          </div>
        </div>

        {userDecks.length === 0 ? (
          <div className="border border-dashed border-line-strong bg-ink-900/60 py-14 px-6 flex flex-col items-center text-center gap-3">
            <div className="h-12 w-12 border border-line bg-ink-850 flex items-center justify-center text-fg-muted">
              <Layers className="w-6 h-6" />
            </div>
            <p className="text-body-sm text-fg-secondary max-w-md">
              暂无自定义牌组。可点击上方官方预组「复制为我的」快速改组，或立即开启一套全新构筑。
            </p>
            <Button variant="secondary" size="md" onClick={handleCreateDeck} className="mt-1">
              <Plus className="w-4 h-4" />
              <span>开启全新构筑</span>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {userDecks.map((deck) => {
              const total = calculateTotalCards(deck.cards);
              const isValid = total === 50;
              const pct = Math.min(100, Math.round((total / 50) * 100));

              return (
                <div
                  key={deck.id}
                  className="group relative border border-line bg-ink-850 p-5 flex flex-col justify-between transition-colors duration-fast ease-enter hover:bg-ink-800 hover:border-line-strong"
                >
                  <HudBrackets color="steel" interactive />
                  <span
                    aria-hidden="true"
                    className={`absolute left-0 top-0 bottom-0 w-0.5 ${
                      isValid ? 'bg-teal-400' : 'bg-crimson-500'
                    }`}
                  />

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={isValid ? 'teal' : 'crimson'}>
                        {isValid ? (
                          <CheckCircle2 className="w-3 h-3" />
                        ) : (
                          <AlertCircle className="w-3 h-3" />
                        )}
                        <span className="font-num tabular-nums">
                          {isValid ? '合规 50/50' : `未满 ${total}/50`}
                        </span>
                      </Badge>

                      <span className="font-num tabular-nums text-caption text-fg-muted">
                        {new Date(deck.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-title-sm font-semibold text-fg mb-1 truncate">
                        {deck.name}
                      </h3>
                      <p className="text-body-sm text-fg-secondary line-clamp-2">
                        {deck.description || '暂无战术说明'}
                      </p>
                    </div>

                    {/* 构筑进度条 */}
                    <div className="h-1 w-full bg-ink-700 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-base ease-enter ${
                          isValid ? 'bg-teal-400' : 'bg-crimson-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-5 pt-3 border-t border-line">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="icon"
                        size="sm"
                        aria-label="导出卡组代码"
                        title="导出代码"
                        onClick={() => setExportModalDeck(deck)}
                      >
                        <FileCode className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="icon"
                        size="sm"
                        aria-label="复制卡组"
                        title="复制卡组"
                        onClick={() => handleCloneDeck(deck)}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="icon"
                        size="sm"
                        aria-label="删除卡组"
                        title="删除卡组"
                        onClick={() => handleDeleteDeck(deck.id)}
                        className="hover:border-crimson-500/60 hover:text-crimson-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>

                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => router.push(`/decks/${deck.id}`)}
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>编辑卡组</span>
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 导入卡组弹窗 */}
      <Dialog
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="导入卡组代码 (JSON)"
        subtitle="IMPORT DECK DATA"
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setImportModalOpen(false)}>
              取消
            </Button>
            <Button variant="primary" size="sm" onClick={handleImportDeck}>
              <span>确认导入</span>
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <textarea
            rows={9}
            value={importCode}
            onChange={(e) => {
              setImportCode(e.target.value);
              setImportError(null);
            }}
            placeholder="在此粘贴导出的卡组 JSON 代码..."
            aria-label="卡组 JSON 代码"
            className="w-full p-3 bg-ink-800 border border-line text-body-sm font-num text-fg placeholder:text-fg-disabled focus:border-teal-400 focus:outline-none rounded-none"
          />
          {importError && (
            <p role="alert" className="text-caption text-crimson-400">
              {importError}
            </p>
          )}
        </div>
      </Dialog>

      {/* 导出卡组弹窗 */}
      <Dialog
        open={Boolean(exportModalDeck)}
        onClose={() => setExportModalDeck(null)}
        title="导出卡组代码"
        subtitle="EXPORT DECK JSON"
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setExportModalDeck(null)}>
              关闭
            </Button>
            <Button variant="primary" size="sm" onClick={handleCopyExport}>
              {copySuccess ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copySuccess ? '已复制至剪贴板' : '复制卡组代码'}</span>
            </Button>
          </>
        }
      >
        {exportModalDeck && (
          <textarea
            readOnly
            rows={10}
            aria-label="导出的卡组 JSON"
            value={JSON.stringify(exportModalDeck, null, 2)}
            className="w-full p-3 bg-ink-800 border border-line text-caption font-num text-teal-400 focus:border-teal-400 focus:outline-none rounded-none select-all"
          />
        )}
      </Dialog>
    </AppShell>
  );
}
