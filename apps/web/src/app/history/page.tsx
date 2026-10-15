'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  History,
  Swords,
  Trophy,
  Play,
  Clock,
  ChevronRight,
  ShieldAlert,
  Search,
  RefreshCw,
  ExternalLink,
  Layers,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { apiUrl } from '@/lib/api';

interface GameHistoryItem {
  id: string;
  roomId: string;
  rngSeed: string;
  winnerUserId?: string | null;
  isDraw: boolean;
  finishReason?: string | null;
  startedAt: string;
  finishedAt?: string | null;
}

export default function HistoryPage() {
  const [historyList, setHistoryList] = useState<GameHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl('/api/history?limit=50'));
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setHistoryList(json.data);
        }
      }
    } catch {
      // 离线开发模拟数据
      setHistoryList([
        {
          id: 'game-demo-1790579001',
          roomId: 'room-gray-raven',
          rngSeed: '8892109',
          winnerUserId: 'alice',
          isDraw: false,
          finishReason: '对方角色全部被破坏且侵蚀度达到10上限',
          startedAt: new Date(Date.now() - 3600000).toISOString(),
          finishedAt: new Date(Date.now() - 3000000).toISOString(),
        },
        {
          id: 'game-demo-1790579002',
          roomId: 'room-ascendant-clash',
          rngSeed: '4729104',
          winnerUserId: 'bob',
          isDraw: false,
          finishReason: '露娜·银冕高阶升变完成绝杀攻击',
          startedAt: new Date(Date.now() - 7200000).toISOString(),
          finishedAt: new Date(Date.now() - 6500000).toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const filteredList = historyList.filter((g) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      g.id.toLowerCase().includes(q) ||
      g.roomId.toLowerCase().includes(q) ||
      (g.winnerUserId && g.winnerUserId.toLowerCase().includes(q)) ||
      (g.finishReason && g.finishReason.toLowerCase().includes(q))
    );
  });

  const formatDuration = (start: string, end?: string | null) => {
    if (!end) return '进行中';
    const s = new Date(start).getTime();
    const e = new Date(end).getTime();
    const sec = Math.max(0, Math.floor((e - s) / 1000));
    const m = Math.floor(sec / 60);
    const remainSec = sec % 60;
    return `${m}分 ${remainSec}秒`;
  };

  return (
    <div className="w-full min-h-screen bg-background text-neutral-200 p-4 md:p-8 flex flex-col items-center overflow-x-hidden overflow-y-auto">
      {/* 顶部导航 */}
      <header className="w-full max-w-6xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-terminalBorder/60 pb-6 mb-8">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-neutral-400 mb-1">
            <Link href="/" className="hover:text-terminalCyan transition-colors">
              终端首页
            </Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-terminalCyan">历史战局与对决归档 (History Logs)</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-black tracking-wide text-white flex items-center gap-3">
            <History className="w-8 h-8 text-terminalCyan" />
            对局历史与回放归档
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchHistory}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-terminalBorder bg-surface hover:border-terminalCyan/70 text-xs font-mono transition-all text-neutral-300"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-terminalCyan' : ''}`} />
            刷新记录
          </button>
          <Link
            href="/rooms"
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-erosionRed/50 bg-erosionRed/10 hover:bg-erosionRed/20 text-xs font-mono font-bold text-erosionRed transition-all"
          >
            <Swords className="w-4 h-4" />
            新建对战房间
          </Link>
        </div>
      </header>

      {/* 搜索控制条 */}
      <div className="w-full max-w-6xl flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="搜索对局 ID、房间名、胜利者..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-surface/70 border border-terminalBorder rounded-lg text-xs font-mono text-white placeholder-neutral-500 focus:outline-none focus:border-terminalCyan"
          />
        </div>

        <div className="text-xs font-mono text-neutral-400">
          已归档总战局: <strong className="text-terminalCyan">{historyList.length}</strong> 局
        </div>
      </div>

      {/* 对局历史清单 */}
      <main className="w-full max-w-6xl space-y-4 mb-12">
        {filteredList.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center rounded-2xl border border-terminalBorder/50 bg-surface/30 text-center">
            <Swords className="w-12 h-12 text-neutral-600 mb-3" />
            <h3 className="text-base font-bold text-neutral-300">暂无符合条件的战局归档记录</h3>
            <p className="text-xs text-neutral-500 mt-1 max-w-md">
              尚未检索到已结算或进行中的对战数据。指挥官可以在大厅创建或加入房间开启对决！
            </p>
            <Link
              href="/rooms"
              className="mt-4 px-4 py-2 rounded-lg border border-terminalCyan/40 text-terminalCyan text-xs hover:bg-terminalCyan/10 transition-colors font-mono"
            >
              前往大厅作战
            </Link>
          </div>
        ) : (
          filteredList.map((game) => (
            <div
              key={game.id}
              className="p-5 rounded-xl border border-terminalBorder bg-surface/80 backdrop-blur hover:border-terminalCyan/60 transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
            >
              {/* 左侧：战局信息 */}
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
                  <span className="px-2 py-0.5 rounded bg-black/60 border border-terminalBorder text-terminalCyan font-bold">
                    {game.id}
                  </span>
                  <span className="text-neutral-400">
                    推演房间: <strong className="text-neutral-200">{game.roomId}</strong>
                  </span>
                  <span className="text-neutral-500">•</span>
                  <span className="text-neutral-400">
                    Seed: <span className="font-mono text-neutral-300">{game.rngSeed}</span>
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  {game.isDraw ? (
                    <span className="px-2.5 py-0.5 rounded bg-neutral-800 text-neutral-300 font-bold text-xs border border-neutral-700">
                      平局 DRAW
                    </span>
                  ) : game.winnerUserId ? (
                    <span className="px-2.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-xs border border-amber-500/40 flex items-center gap-1">
                      <Trophy className="w-3.5 h-3.5 text-amber-400" />
                      胜利者: 指挥官 {game.winnerUserId}
                    </span>
                  ) : (
                    <span className="px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold text-xs border border-emerald-500/40">
                      推演进行中
                    </span>
                  )}

                  {game.finishReason && (
                    <span className="text-xs text-neutral-400 italic">
                      “{game.finishReason}”
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4 text-[11px] font-mono text-neutral-500">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    开战时间: {new Date(game.startedAt).toLocaleString()}
                  </span>
                  <span>对战时长: {formatDuration(game.startedAt, game.finishedAt)}</span>
                </div>
              </div>

              {/* 右侧：回放按钮 */}
              <div className="flex items-center gap-3 self-end md:self-center">
                <Link
                  href={`/replay/${game.id}`}
                  className="px-4 py-2 rounded-lg border border-terminalCyan bg-terminalCyan/15 hover:bg-terminalCyan/25 text-xs font-mono font-bold text-terminalCyan transition-all flex items-center gap-2 shadow-[0_0_12px_rgba(0,240,255,0.2)]"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  观战全景回放
                </Link>
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  );
}
