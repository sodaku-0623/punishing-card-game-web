'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  FastForward,
  Clock,
  ChevronRight,
  Shield,
  Swords,
  Trophy,
  History,
  Activity,
  Terminal,
  Info,
  Layers,
  Sparkles,
} from 'lucide-react';
import { ALL_OFFICIAL_CARDS, findCardByNumberOrId } from '@/lib/cards-data';
import { apiUrl } from '@/lib/api';

interface ReplayEvent {
  seq: number;
  eventType: string;
  payload: any;
  timestamp: string;
}

interface ReplayAction {
  seq: number;
  playerId: string;
  actionType: string;
  payload: any;
  timestamp: string;
}

interface ReplayData {
  game: {
    id: string;
    roomId: string;
    rngSeed: string;
    winnerUserId?: string | null;
    isDraw: boolean;
    finishReason?: string | null;
    startedAt: string;
    finishedAt?: string | null;
  };
  players: { userId: string; deckId: string; seatOrder: number }[];
  actions: ReplayAction[];
  events: ReplayEvent[];
}

export default function GameReplayPage() {
  const params = useParams();
  const router = useRouter();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const gameId = rawId ? decodeURIComponent(rawId) : '';

  const [replayData, setReplayData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(true);

  // 回放播放器控制状态
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState<number>(1); // 0.5, 1, 2, 4
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const fetchReplay = async () => {
      setLoading(true);
      try {
        const res = await fetch(apiUrl(`/api/replay/${gameId}`));
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data) {
            setReplayData(json.data);
          }
        }
      } catch {
        // 离线开发模拟真实战局回放流
        const simulatedEvents: ReplayEvent[] = [
          { seq: 1, eventType: 'GAME_STARTED', payload: { turnPlayerId: 'alice', roundNumber: 1 }, timestamp: new Date().toISOString() },
          { seq: 2, eventType: 'PHASE_CHANGED', payload: { phase: 'DRAW_PHASE', round: 1 }, timestamp: new Date().toISOString() },
          { seq: 3, eventType: 'CARD_DRAWN', payload: { playerId: 'alice', count: 1 }, timestamp: new Date().toISOString() },
          { seq: 4, eventType: 'PHASE_CHANGED', payload: { phase: 'MAIN_PHASE', round: 1 }, timestamp: new Date().toISOString() },
          { seq: 5, eventType: 'CARD_PLAYED', payload: { playerId: 'alice', cardNumber: 'ST01-004', slotIndex: 2 }, timestamp: new Date().toISOString() },
          { seq: 6, eventType: 'COST_CONSUMED', payload: { playerId: 'alice', openCost: 2 }, timestamp: new Date().toISOString() },
          { seq: 7, eventType: 'PHASE_CHANGED', payload: { phase: 'BATTLE_PHASE', round: 1 }, timestamp: new Date().toISOString() },
          { seq: 8, eventType: 'ATTACK_DECLARED', payload: { attackerCardId: 'c-lucia', target: 'bob' }, timestamp: new Date().toISOString() },
          { seq: 9, eventType: 'DAMAGE_DEALT', payload: { targetPlayerId: 'bob', amount: 1 }, timestamp: new Date().toISOString() },
          { seq: 10, eventType: 'EROSION_UPDATED', payload: { playerId: 'bob', count: 1 }, timestamp: new Date().toISOString() },
          { seq: 11, eventType: 'TURN_PASSED', payload: { nextTurnPlayerId: 'bob', round: 2 }, timestamp: new Date().toISOString() },
          { seq: 12, eventType: 'CARD_PLAYED', payload: { playerId: 'bob', cardNumber: 'ST02-004', slotIndex: 2 }, timestamp: new Date().toISOString() },
          { seq: 13, eventType: 'GAME_FINISHED', payload: { winnerId: 'alice', reason: '达到斩杀侵蚀上限' }, timestamp: new Date().toISOString() },
        ];

        setReplayData({
          game: {
            id: gameId,
            roomId: 'room-gray-raven',
            rngSeed: '8892109',
            winnerUserId: 'alice',
            isDraw: false,
            finishReason: '达到斩杀侵蚀上限',
            startedAt: new Date(Date.now() - 600000).toISOString(),
            finishedAt: new Date().toISOString(),
          },
          players: [
            { userId: 'alice', deckId: 'deck-st01', seatOrder: 0 },
            { userId: 'bob', deckId: 'deck-st02', seatOrder: 1 },
          ],
          actions: [
            { seq: 1, playerId: 'alice', actionType: 'PLAY_CARD', payload: { cardNumber: 'ST01-004' }, timestamp: new Date().toISOString() },
            { seq: 2, playerId: 'alice', actionType: 'DECLARE_ATTACK', payload: { target: 'PLAYER' }, timestamp: new Date().toISOString() },
          ],
          events: simulatedEvents,
        });
      } finally {
        setLoading(false);
      }
    };

    fetchReplay();
  }, [gameId]);

  const totalSteps = replayData?.events?.length || 0;

  // 自动播放时钟
  useEffect(() => {
    if (isPlaying) {
      const intervalMs = Math.max(250, 1000 / playSpeed);
      timerRef.current = setInterval(() => {
        setCurrentStep((prev) => {
          if (prev >= totalSteps - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, intervalMs);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, playSpeed, totalSteps]);

  const handleStepForward = () => {
    setIsPlaying(false);
    setCurrentStep((prev) => Math.min(totalSteps - 1, prev + 1));
  };

  const handleStepBack = () => {
    setIsPlaying(false);
    setCurrentStep((prev) => Math.max(0, prev - 1));
  };

  const handleReset = () => {
    setIsPlaying(false);
    setCurrentStep(0);
  };

  // 提取当前步骤之前的战况快照
  const currentEvent = replayData?.events?.[currentStep];
  const historyEvents = useMemo(() => {
    return (replayData?.events || []).slice(0, currentStep + 1);
  }, [replayData, currentStep]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-neutral-200 flex flex-col items-center justify-center p-6 text-center">
        <Activity className="w-12 h-12 text-terminalCyan animate-spin mb-4" />
        <h3 className="text-lg font-bold text-white">正在加载确定性回放流...</h3>
        <p className="text-xs text-neutral-500 font-mono mt-1">
          读取 RNG Seed 与原子事件审计日志
        </p>
      </div>
    );
  }

  if (!replayData) {
    return (
      <div className="min-h-screen bg-background text-neutral-200 flex flex-col items-center justify-center p-6 text-center">
        <Info className="w-16 h-16 text-erosionRed mb-4" />
        <h2 className="text-2xl font-bold text-white mb-2">未找到回放档案</h2>
        <p className="text-sm text-neutral-400 max-w-md mb-6">
          无法检视对局 ID 为 <code className="text-terminalCyan font-mono">{gameId}</code> 的录像。
        </p>
        <Link
          href="/history"
          className="px-5 py-2.5 rounded-lg border border-terminalCyan bg-terminalCyan/10 text-terminalCyan font-medium hover:bg-terminalCyan/20 transition-all text-xs font-mono"
        >
          返回战局记录列表
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-neutral-200 p-4 md:p-8 flex flex-col items-center">
      {/* 顶部状态与导航 */}
      <header className="w-full max-w-7xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-terminalBorder/60 pb-4 mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-neutral-400 mb-1">
            <Link href="/" className="hover:text-terminalCyan transition-colors">
              终端首页
            </Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <Link href="/history" className="hover:text-terminalCyan transition-colors">
              战局归档
            </Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-terminalCyan font-bold">{replayData.game.id}</span>
          </div>
          <h1 className="text-2xl font-black tracking-wide text-white flex items-center gap-3">
            <History className="w-7 h-7 text-terminalCyan" />
            确定性战局全景回放器
            <span className="text-xs px-2.5 py-0.5 rounded-full border border-terminalCyan/40 bg-terminalCyan/10 text-terminalCyan font-mono">
              RNG Seed: {replayData.game.rngSeed}
            </span>
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href={`/game/${replayData.game.id}`}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-terminalBorder bg-surface hover:border-terminalCyan text-xs font-mono text-neutral-300 transition-colors"
          >
            断线恢复实时对局 &rarr;
          </Link>
        </div>
      </header>

      {/* 主回放控制台 */}
      <main className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-12 gap-6 items-start mb-12">
        {/* 左侧：推演战局动态模拟画板 (Tabletop HUD) */}
        <section className="lg:col-span-8 flex flex-col gap-4">
          {/* 对战双方 HUD 标头 */}
          <div className="p-4 rounded-xl border border-terminalBorder bg-surface/80 backdrop-blur flex justify-between items-center text-xs font-mono">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-terminalCyan/20 border border-terminalCyan flex items-center justify-center font-bold text-terminalCyan">
                P1
              </div>
              <div>
                <span className="font-bold text-white">指挥官 {replayData.players[0]?.userId || 'Alice'}</span>
                <p className="text-[10px] text-neutral-500">ST01 灰鸦小队</p>
              </div>
            </div>

            <div className="flex flex-col items-center">
              <span className="px-3 py-1 rounded bg-black/60 border border-terminalBorder text-terminalCyan font-bold text-xs tracking-widest">
                VS
              </span>
              <span className="text-[10px] text-neutral-500 mt-1">
                步骤 {currentStep + 1} / {totalSteps}
              </span>
            </div>

            <div className="flex items-center gap-3 text-right">
              <div>
                <span className="font-bold text-white">指挥官 {replayData.players[1]?.userId || 'Bob'}</span>
                <p className="text-[10px] text-neutral-500">ST02 升格者</p>
              </div>
              <div className="w-8 h-8 rounded-full bg-erosionRed/20 border border-erosionRed flex items-center justify-center font-bold text-erosionRed">
                P2
              </div>
            </div>
          </div>

          {/* 战场动态沙盘展示 */}
          <div className="relative aspect-[16/9] w-full rounded-2xl border-2 border-terminalBorder bg-neutral-950 p-6 flex flex-col justify-between overflow-hidden shadow-2xl">
            {/* 对手战场区 (Top) */}
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center text-xs font-mono text-neutral-400">
                <span className="text-erosionRed font-bold">对手席位 (P2)</span>
                <span>侵蚀度: 1 / 10</span>
              </div>
              <div className="grid grid-cols-5 gap-3">
                {[0, 1, 2, 3, 4].map((slot) => (
                  <div
                    key={slot}
                    className="aspect-[3/4] rounded-lg border border-neutral-800 bg-neutral-900/60 flex items-center justify-center text-[10px] font-mono text-neutral-600"
                  >
                    {slot === 2 && currentStep >= 11 ? (
                      <div className="w-full h-full p-1 flex flex-col items-center justify-center bg-purple-950/40 border border-purple-500/60 rounded-lg">
                        <span className="text-[10px] font-bold text-purple-300">露娜·银冕</span>
                        <span className="text-[9px] text-neutral-400">2000 PP</span>
                      </div>
                    ) : (
                      `槽位 ${slot + 1}`
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 中场：对局焦点事件全息浮窗 */}
            <div className="my-auto self-center p-3 rounded-xl bg-black/80 backdrop-blur border border-terminalCyan/40 text-center max-w-md shadow-[0_0_20px_rgba(0,240,255,0.2)]">
              <span className="text-[10px] font-mono text-terminalCyan font-bold block mb-1">
                EVENT #{currentEvent?.seq ?? 0}: {currentEvent?.eventType ?? 'READY'}
              </span>
              <p className="text-xs text-neutral-200 font-mono">
                {currentEvent ? JSON.stringify(currentEvent.payload) : '等待回放播放'}
              </p>
            </div>

            {/* 我方战场区 (Bottom) */}
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-5 gap-3">
                {[0, 1, 2, 3, 4].map((slot) => (
                  <div
                    key={slot}
                    className="aspect-[3/4] rounded-lg border border-neutral-800 bg-neutral-900/60 flex items-center justify-center text-[10px] font-mono text-neutral-600"
                  >
                    {slot === 2 && currentStep >= 4 ? (
                      <div className="w-full h-full p-1 flex flex-col items-center justify-center bg-cyan-950/40 border border-terminalCyan/60 rounded-lg">
                        <span className="text-[10px] font-bold text-terminalCyan">露西亚·红莲</span>
                        <span className="text-[9px] text-neutral-400">3000 PP</span>
                      </div>
                    ) : (
                      `槽位 ${slot + 1}`
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center text-xs font-mono text-neutral-400">
                <span className="text-terminalCyan font-bold">我方席位 (P1)</span>
                <span>侵蚀度: 0 / 10</span>
              </div>
            </div>
          </div>

          {/* 回放控制器操作条 (Player Controls) */}
          <div className="p-4 rounded-xl border border-terminalBorder bg-surface/90 backdrop-blur flex flex-col gap-3">
            {/* 时间轴进度条 */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-neutral-400">0</span>
              <input
                type="range"
                min="0"
                max={Math.max(0, totalSteps - 1)}
                value={currentStep}
                onChange={(e) => {
                  setIsPlaying(false);
                  setCurrentStep(Number(e.target.value));
                }}
                className="flex-1 accent-terminalCyan cursor-pointer"
              />
              <span className="text-xs font-mono text-terminalCyan">{totalSteps}</span>
            </div>

            {/* 控制按钮组 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleReset}
                  className="p-2 rounded-lg border border-terminalBorder hover:border-terminalCyan text-neutral-300 hover:text-white"
                  title="回到开局"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
                <button
                  onClick={handleStepBack}
                  disabled={currentStep <= 0}
                  className="p-2 rounded-lg border border-terminalBorder hover:border-terminalCyan text-neutral-300 hover:text-white disabled:opacity-40"
                  title="上一步"
                >
                  <SkipBack className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="px-4 py-2 rounded-lg border border-terminalCyan bg-terminalCyan/20 hover:bg-terminalCyan/30 text-terminalCyan font-mono font-bold flex items-center gap-2"
                >
                  {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                  <span>{isPlaying ? '暂停' : '播放'}</span>
                </button>
                <button
                  onClick={handleStepForward}
                  disabled={currentStep >= totalSteps - 1}
                  className="p-2 rounded-lg border border-terminalBorder hover:border-terminalCyan text-neutral-300 hover:text-white disabled:opacity-40"
                  title="下一步"
                >
                  <SkipForward className="w-4 h-4" />
                </button>
              </div>

              {/* 倍速控制 */}
              <div className="flex items-center gap-1 font-mono text-xs">
                {[0.5, 1, 2, 4].map((spd) => (
                  <button
                    key={spd}
                    onClick={() => setPlaySpeed(spd)}
                    className={`px-2 py-1 rounded border text-[11px] ${
                      playSpeed === spd
                        ? 'border-terminalCyan bg-terminalCyan/20 text-terminalCyan font-bold'
                        : 'border-terminalBorder text-neutral-400 hover:text-white'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* 右侧：按时序流事件日志 (Audit Event Log Inspector) */}
        <section className="lg:col-span-4 rounded-xl border border-terminalBorder bg-surface/80 backdrop-blur p-4 flex flex-col h-[650px]">
          <div className="flex justify-between items-center border-b border-terminalBorder/50 pb-3 mb-3">
            <h3 className="text-xs font-mono font-bold text-white flex items-center gap-2">
              <Terminal className="w-4 h-4 text-terminalCyan" />
              确定性事件审计流水 ({historyEvents.length} / {totalSteps})
            </h3>
            <span className="text-[10px] font-mono text-neutral-500">EVENT LOGS</span>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1 text-xs font-mono">
            {historyEvents.map((evt, idx) => {
              const isCurrent = idx === currentStep;
              return (
                <div
                  key={evt.seq}
                  onClick={() => {
                    setIsPlaying(false);
                    setCurrentStep(idx);
                  }}
                  className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
                    isCurrent
                      ? 'border-terminalCyan bg-terminalCyan/15 text-white shadow-[0_0_10px_rgba(0,240,255,0.2)]'
                      : 'border-terminalBorder/40 bg-black/40 text-neutral-400 hover:border-terminalBorder hover:text-neutral-200'
                  }`}
                >
                  <div className="flex justify-between items-center text-[10px] mb-1">
                    <span className="text-terminalCyan font-bold">#{evt.seq}</span>
                    <span className="text-neutral-500">{evt.eventType}</span>
                  </div>
                  <div className="text-[11px] text-neutral-300 truncate">
                    {JSON.stringify(evt.payload)}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
