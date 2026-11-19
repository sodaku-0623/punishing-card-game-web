'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Swords,
  Trophy,
  Play,
  Clock,
  Search,
  RefreshCw,
} from 'lucide-react';
import { apiUrl } from '@/lib/api';
import {
  AppShell,
  Button,
  Badge,
  Input,
  SectionHeader,
  HudRule,
} from '@/components/ui';

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
    <AppShell className="space-y-6">
      <SectionHeader
        code="SECTOR 04"
        pageLabel={`${String(historyList.length).padStart(2, '0')} LOGS`}
        title="对局历史与回放归档"
        subtitle="BATTLE ARCHIVE & REPLAYS"
        action={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={fetchHistory}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span>刷新记录</span>
            </Button>
            <Link href="/rooms">
              <Button variant="primary" size="md">
                <Swords className="w-4 h-4" />
                <span>进入对战大厅</span>
              </Button>
            </Link>
          </>
        }
      />

      {/* 搜索与归档计数 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pgr-enter">
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索对局 ID、房间编号、胜利者或结语..."
          aria-label="搜索战局记录"
          leftSlot={<Search className="w-4 h-4" />}
          containerClassName="sm:max-w-md"
        />

        <div className="flex items-center gap-3 text-caption text-fg-muted shrink-0">
          <span>
            匹配战局{' '}
            <strong className="font-num tabular-nums text-fg">
              {filteredList.length}
            </strong>{' '}
            / <span className="font-num tabular-nums">{historyList.length}</span>
          </span>
        </div>
      </div>

      <HudRule code="ARCHIVED BATTLE LOGS" />

      {/* 战局列表（官网风格 44px+ 斑马纹战术行） */}
      {filteredList.length === 0 ? (
        <div className="border border-dashed border-line-strong bg-ink-900/60 py-16 px-6 flex flex-col items-center text-center">
          <div className="h-12 w-12 border border-line bg-ink-850 flex items-center justify-center text-fg-muted mb-4">
            <Swords className="w-6 h-6" />
          </div>
          <h2 className="text-title-sm font-semibold text-fg mb-1.5">
            暂无符合条件的战局归档记录
          </h2>
          <p className="text-body-sm text-fg-secondary max-w-md mb-6">
            尚未检索到已结算或进行中的对战数据。前往大厅开启一场实战对决即可自动归档。
          </p>
          <Link href="/rooms">
            <Button variant="secondary" size="md">
              前往大厅作战
            </Button>
          </Link>
        </div>
      ) : (
        <div className="border border-line divide-y divide-line pgr-enter pgr-delay-1">
          {filteredList.map((game, idx) => (
            <div
              key={game.id}
              className={`group relative px-5 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors duration-fast ease-enter hover:bg-ink-700 ${
                idx % 2 === 1 ? 'bg-ink-800/70' : 'bg-ink-850'
              }`}
            >
              {/* 左侧语义状态条 */}
              <span
                aria-hidden="true"
                className={`absolute left-0 top-0 bottom-0 w-0.5 ${
                  game.isDraw
                    ? 'bg-line-strong'
                    : game.winnerUserId
                      ? 'bg-gold-300'
                      : 'bg-teal-400'
                }`}
              />

              <div className="space-y-2 min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-caption">
                  <span className="font-num tabular-nums px-2 py-0.5 border border-line bg-ink-900 text-fg font-semibold">
                    {game.id}
                  </span>
                  <span className="text-fg-muted">
                    房间 <strong className="font-num text-fg-secondary">{game.roomId}</strong>
                  </span>
                  <span className="text-fg-disabled">·</span>
                  <span className="text-fg-muted">
                    SEED <span className="font-num text-fg-secondary">{game.rngSeed}</span>
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  {game.isDraw ? (
                    <Badge variant="neutral">平局 DRAW</Badge>
                  ) : game.winnerUserId ? (
                    <Badge variant="gold">
                      <Trophy className="w-3 h-3" />
                      <span>胜者：{game.winnerUserId}</span>
                    </Badge>
                  ) : (
                    <Badge variant="teal">推演进行中</Badge>
                  )}

                  {game.finishReason && (
                    <span className="text-body-sm text-fg-secondary truncate">
                      {game.finishReason}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4 text-caption text-fg-muted font-num tabular-nums">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {new Date(game.startedAt).toLocaleString()}
                  </span>
                  <span>时长 {formatDuration(game.startedAt, game.finishedAt)}</span>
                </div>
              </div>

              <div className="shrink-0 self-end md:self-center">
                <Link href={`/replay/${game.id}`}>
                  <Button variant="secondary" size="md">
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>观战全景回放</span>
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
