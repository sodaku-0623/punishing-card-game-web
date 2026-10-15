'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
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
  Download,
  Upload,
  ArrowRight,
  Shield,
  Sparkles,
} from 'lucide-react';
import { ALL_OFFICIAL_CARDS } from '@/lib/cards-data';
import { OFFICIAL_STARTER_DECKS, StarterDeck } from '@/lib/starter-decks';
import { copyText } from '@/lib/clipboard';
import { getCardThumbnailUrl, handleThumbnailError } from '@/lib/card-image';

export type SavedDeck = StarterDeck;

const PRESET_DECKS: SavedDeck[] = OFFICIAL_STARTER_DECKS;

export default function DecksPage() {
  const router = useRouter();
  const [userDecks, setUserDecks] = useState<SavedDeck[]>([]);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importCode, setImportCode] = useState('');
  const [exportModalDeck, setExportModalDeck] = useState<SavedDeck | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  useEffect(() => {
    // 从 localStorage 加载用户自定牌组
    const saved = localStorage.getItem('zhanshuang_user_decks');
    if (saved) {
      try {
        setUserDecks(JSON.parse(saved));
      } catch (e) {
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
    const next = [newDeck, ...userDecks];
    saveUserDecks(next);
  }

  function handleDeleteDeck(id: string) {
    if (confirm('确认删除该牌组？')) {
      const next = userDecks.filter((d) => d.id !== id);
      saveUserDecks(next);
    }
  }

  function handleImportDeck() {
    try {
      const parsed = JSON.parse(importCode);
      if (!parsed.name || !Array.isArray(parsed.cards)) {
        alert('卡组数据格式不正确');
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
    } catch (e) {
      alert('解析失败，请输入合法的卡组 JSON 导出代码');
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
    <div className="w-full min-h-screen bg-background text-foreground p-6 md:p-12 relative flex flex-col items-center overflow-x-hidden overflow-y-auto">
      {/* 顶部导航 */}
      <header className="w-full max-w-6xl flex justify-between items-center border-b border-terminalBorder/60 pb-6 mb-8">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="w-10 h-10 rounded-lg bg-terminalCyan/10 border border-terminalCyan/30 flex items-center justify-center text-terminalCyan hover:scale-105 transition-transform"
          >
            <Layers className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold tracking-wider text-white">作战构筑中心</h1>
            <p className="text-xs text-neutral-400 font-mono">
              DECK BUILDER • 50-CARD OFFICIAL RULEBOOK STANDARD
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setImportModalOpen(true)}
            className="px-4 py-2 rounded-lg border border-terminalBorder bg-surface hover:border-terminalCyan text-xs font-mono text-neutral-300 flex items-center gap-1.5 transition-all"
          >
            <Upload className="w-3.5 h-3.5 text-terminalCyan" />
            <span>导入卡组</span>
          </button>

          <button
            onClick={handleCreateDeck}
            className="px-4 py-2 rounded-lg bg-terminalCyan hover:bg-terminalCyan/90 text-neutral-950 font-bold text-xs font-mono flex items-center gap-1.5 shadow-lg transition-transform hover:scale-105"
          >
            <Plus className="w-4 h-4" />
            <span>新建卡组</span>
          </button>
        </div>
      </header>

      {/* 主体卡组列表展示 */}
      <div className="w-full max-w-6xl flex flex-col gap-10">
        {/* 官方新手预组 */}
        <section className="flex flex-col gap-4">
          <div className="flex justify-between items-center text-sm font-mono text-neutral-400 border-b border-terminalBorder/40 pb-2">
            <span className="flex items-center gap-2 text-white font-bold">
              <Shield className="w-4 h-4 text-terminalGold" />
              官方标准入门预组 (Starter Decks)
            </span>
            <span className="text-xs text-neutral-500 font-mono">严格符合 5.1 规则书 50 张构筑</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {PRESET_DECKS.map((deck) => {
              const total = calculateTotalCards(deck.cards);
              return (
                <div
                  key={deck.id}
                  className="rounded-2xl border border-terminalBorder bg-surface overflow-hidden flex flex-col justify-between shadow-xl hover:border-terminalGold/60 transition-all group"
                >
                  <div className="relative h-44 bg-neutral-950 overflow-hidden flex items-center justify-center">
                    {deck.coverImage && (
                      <img
                        src={getCardThumbnailUrl(deck.coverImage)}
                        onError={(e) => handleThumbnailError(e, deck.coverImage)}
                        loading="lazy"
                        alt={deck.name}
                        className="w-full h-full object-cover opacity-75 group-hover:scale-105 transition-transform duration-300"
                      />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-surface via-transparent to-black/30" />
                    <span className="absolute top-3 left-3 px-2 py-0.5 rounded text-[10px] font-mono bg-terminalGold/20 text-terminalGold border border-terminalGold/40 font-bold">
                      OFFICIAL STARTER
                    </span>
                    <span className="absolute bottom-3 right-3 text-xs font-mono font-bold text-terminalCyan px-2 py-0.5 rounded bg-neutral-900/80 border border-terminalBorder">
                      {total} / 50 张
                    </span>
                  </div>

                  <div className="p-5 flex flex-col flex-1 justify-between gap-4">
                    <div>
                      <h3 className="text-base font-bold text-white mb-1.5">{deck.name}</h3>
                      <p className="text-xs text-neutral-400 leading-relaxed font-sans line-clamp-2">
                        {deck.description}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-terminalBorder/50">
                      <button
                        onClick={() => handleCloneDeck(deck)}
                        className="px-3 py-1.5 rounded-lg border border-terminalBorder hover:border-terminalCyan text-neutral-300 text-xs font-mono flex items-center gap-1.5 transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5 text-terminalCyan" />
                        <span>复制为我的</span>
                      </button>

                      <button
                        onClick={() => router.push(`/decks/${deck.id}`)}
                        className="px-3 py-1.5 rounded-lg bg-surface hover:bg-neutral-800 border border-terminalBorder text-white text-xs font-mono flex items-center gap-1 transition-all"
                      >
                        <span>查看卡表</span>
                        <ArrowRight className="w-3.5 h-3.5 text-terminalCyan" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 用户自定义卡组 */}
        <section className="flex flex-col gap-4">
          <div className="flex justify-between items-center text-sm font-mono text-neutral-400 border-b border-terminalBorder/40 pb-2">
            <span className="flex items-center gap-2 text-white font-bold">
              <Sparkles className="w-4 h-4 text-terminalCyan" />
              指挥官自定牌组 ({userDecks.length})
            </span>
          </div>

          {userDecks.length === 0 ? (
            <div className="p-12 rounded-2xl border border-dashed border-terminalBorder text-center flex flex-col items-center justify-center gap-3">
              <Layers className="w-10 h-10 text-neutral-600" />
              <p className="text-sm font-mono text-neutral-400">
                暂无自定义牌组，可以从官方预组复制修改或点击右上角“新建卡组”
              </p>
              <button
                onClick={handleCreateDeck}
                className="mt-2 px-4 py-2 rounded-lg bg-terminalCyan/10 border border-terminalCyan/40 text-terminalCyan text-xs font-mono font-bold hover:bg-terminalCyan/20 transition-all"
              >
                + 立即开启全新构筑
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {userDecks.map((deck) => {
                const total = calculateTotalCards(deck.cards);
                const isValid = total === 50;
                return (
                  <div
                    key={deck.id}
                    className="p-5 rounded-2xl border border-terminalBorder bg-surface hover:border-terminalCyan/60 transition-all flex flex-col justify-between shadow-xl"
                  >
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-mono border font-bold flex items-center gap-1 ${
                            isValid
                              ? 'bg-terminalCyan/10 text-terminalCyan border-terminalCyan/30'
                              : 'bg-erosionRed/10 text-erosionRed border-erosionRed/30'
                          }`}
                        >
                          {isValid ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                          {isValid ? '合规 (50张)' : `未满 (${total}/50)`}
                        </span>

                        <span className="text-[10px] font-mono text-neutral-500">
                          {new Date(deck.createdAt).toLocaleDateString()}
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-white mb-1.5">{deck.name}</h3>
                      <p className="text-xs text-neutral-400 line-clamp-2 leading-relaxed">
                        {deck.description || '暂无描述'}
                      </p>
                    </div>

                    <div className="flex items-center justify-between mt-6 pt-3 border-t border-terminalBorder/60">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setExportModalDeck(deck)}
                          className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white"
                          title="导出代码"
                        >
                          <FileCode className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleCloneDeck(deck)}
                          className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400 hover:text-white"
                          title="复制卡组"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteDeck(deck.id)}
                          className="p-1.5 rounded hover:bg-neutral-800 text-neutral-400 hover:text-erosionRed"
                          title="删除卡组"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <button
                        onClick={() => router.push(`/decks/${deck.id}`)}
                        className="px-3 py-1.5 rounded-lg bg-surface hover:bg-neutral-800 border border-terminalBorder hover:border-terminalCyan/50 text-white text-xs font-mono flex items-center gap-1.5 transition-all"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-terminalCyan" />
                        <span>编辑卡组</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* 导入弹窗 */}
      {importModalOpen && (
        <div className="fixed inset-0 bg-neutral-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="max-w-lg w-full p-6 rounded-2xl border border-terminalBorder bg-surface flex flex-col gap-4 shadow-2xl">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Upload className="w-5 h-5 text-terminalCyan" /> 导入卡组代码 (JSON)
            </h2>
            <textarea
              rows={8}
              value={importCode}
              onChange={(e) => setImportCode(e.target.value)}
              placeholder="在此粘贴导出的卡组 JSON 代码..."
              className="w-full p-3 rounded-lg bg-neutral-950 border border-terminalBorder text-white text-xs font-mono focus:border-terminalCyan outline-none"
            />
            <div className="flex justify-end gap-3 mt-2">
              <button
                onClick={() => setImportModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-terminalBorder text-neutral-400 hover:text-white text-xs font-mono"
              >
                取消
              </button>
              <button
                onClick={handleImportDeck}
                className="px-4 py-2 rounded-lg bg-terminalCyan hover:bg-terminalCyan/90 text-neutral-950 font-bold text-xs font-mono shadow"
              >
                确认导入
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导出弹窗 */}
      {exportModalDeck && (
        <div className="fixed inset-0 bg-neutral-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="max-w-lg w-full p-6 rounded-2xl border border-terminalBorder bg-surface flex flex-col gap-4 shadow-2xl">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Download className="w-5 h-5 text-terminalCyan" /> 导出卡组代码
            </h2>
            <textarea
              readOnly
              rows={8}
              value={JSON.stringify(exportModalDeck, null, 2)}
              className="w-full p-3 rounded-lg bg-neutral-950 border border-terminalBorder text-terminalCyan text-xs font-mono focus:border-terminalCyan outline-none select-all"
            />
            <div className="flex justify-end gap-3 mt-2">
              <button
                onClick={() => setExportModalDeck(null)}
                className="px-4 py-2 rounded-lg border border-terminalBorder text-neutral-400 hover:text-white text-xs font-mono"
              >
                关闭
              </button>
              <button
                onClick={handleCopyExport}
                className="px-4 py-2 rounded-lg bg-terminalCyan hover:bg-terminalCyan/90 text-neutral-950 font-bold text-xs font-mono shadow flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copySuccess ? '已复制至剪贴板' : '复制卡组代码'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
