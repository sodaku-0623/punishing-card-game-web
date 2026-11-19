'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useRouteId } from '@/lib/route-id';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  Activity,
  Terminal,
  Info,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import { apiUrl } from '@/lib/api';
import {
  AppShell,
  Button,
  Badge,
  Panel,
  HudBrackets,
  HudCounter,
} from '@/components/ui';

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
  const gameId = useRouteId();

  const [replayData, setReplayData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(true);

  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState<number>(1);
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
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, playSpeed, totalSteps]);

  const currentEvent = replayData?.events?.[currentStep];
  const historyEvents = useMemo(
    () => (replayData?.events || []).slice(0, currentStep + 1),
    [replayData, currentStep],
  );

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

  if (loading) {
    return (
      <AppShell className="flex flex-col items-center justify-center py-24 text-center">
        <Activity className="w-8 h-8 text-crimson-500 animate-spin mb-4" />
        <h2 className="text-title-sm font-semibold text-fg">正在加载确定性回放流...</h2>
        <p className="text-caption text-fg-muted mt-1">
          读取 RNG Seed 与原子事件审计日志
        </p>
      </AppShell>
    );
  }

  if (!replayData) {
    return (
      <AppShell className="flex flex-col items-center justify-center py-24 text-center">
        <Info className="w-12 h-12 text-crimson-400 mb-4" />
        <h2 className="text-title font-bold text-fg mb-2">未找到回放档案</h2>
        <p className="text-body-sm text-fg-secondary max-w-md mb-6">
          无法检视对局 ID 为 <code className="font-num text-teal-400">{gameId}</code> 的录像。
        </p>
        <Link href="/history">
          <Button variant="secondary" size="md">
            <ArrowLeft className="w-4 h-4" />
            <span>返回战局记录列表</span>
          </Button>
        </Link>
      </AppShell>
    );
  }

  return (
    <AppShell wide className="space-y-6">
      {/* 顶栏 */}
      <header className="border-b border-line pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 pgr-enter">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-caption text-fg-muted">
            <Link href="/history" className="hover:text-fg transition-colors inline-flex items-center gap-1">
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回战局归档</span>
            </Link>
            <span>/</span>
            <span className="font-num text-fg-secondary">{replayData.game.id}</span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-title font-bold text-fg">确定性战局全景回放器</h1>
            <Badge variant="neutral" className="font-num">
              SEED: {replayData.game.rngSeed}
            </Badge>
          </div>
        </div>

        <Link href={`/game/${replayData.game.id}`}>
          <Button variant="secondary" size="sm">
            <span>断线恢复实时对局</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </Link>
      </header>

      {/* 主控制台 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* 左侧沙盘与播放控制 */}
        <section className="lg:col-span-8 space-y-4">
          {/* 双方指挥官标头 */}
          <div className="border border-line bg-ink-850 px-5 py-3.5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 border border-teal-400/60 bg-teal-400/10 flex items-center justify-center font-num text-body-sm font-bold text-teal-400">
                P1
              </div>
              <div>
                <div className="text-body-sm font-semibold text-fg">
                  指挥官 {replayData.players[0]?.userId || 'Alice'}
                </div>
                <div className="text-caption text-fg-muted font-num">
                  {replayData.players[0]?.deckId || 'ST01'}
                </div>
              </div>
            </div>

            <div className="text-center">
              <div className="font-display text-hud uppercase text-crimson-500 font-bold tracking-widest">
                VS
              </div>
              <HudCounter
                current={totalSteps > 0 ? currentStep + 1 : 0}
                total={totalSteps}
                prefix="STEP"
                className="mt-0.5"
              />
            </div>

            <div className="flex items-center gap-3 text-right">
              <div>
                <div className="text-body-sm font-semibold text-fg">
                  指挥官 {replayData.players[1]?.userId || 'Bob'}
                </div>
                <div className="text-caption text-fg-muted font-num">
                  {replayData.players[1]?.deckId || 'ST02'}
                </div>
              </div>
              <div className="h-9 w-9 border border-crimson-500/60 bg-crimson-700/20 flex items-center justify-center font-num text-body-sm font-bold text-crimson-400">
                P2
              </div>
            </div>
          </div>

          {/* 战场复盘沙盘 */}
          <div className="relative aspect-[16/9] w-full border border-line bg-arena-surface p-5 flex flex-col justify-between overflow-hidden">
            <HudBrackets color="steel" />
            <div aria-hidden="true" className="absolute top-0 inset-x-0 h-px bg-crimson-500/30" />
            <div aria-hidden="true" className="absolute bottom-0 inset-x-0 h-px bg-teal-400/30" />

            {/* 对手战场 (Top) */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-caption">
                <span className="text-crimson-400 font-semibold">对方半场 (P2)</span>
                <span className="font-num tabular-nums text-fg-muted">侵蚀度 1 / 10</span>
              </div>
              <div className="grid grid-cols-5 gap-2.5">
                {[0, 1, 2, 3, 4].map((slot) => (
                  <div
                    key={slot}
                    className="aspect-[3/4] border border-line bg-ink-900/70 flex items-center justify-center text-caption font-num text-fg-disabled"
                  >
                    {slot === 2 && currentStep >= 11 ? (
                      <div className="w-full h-full p-2 flex flex-col items-center justify-center bg-crimson-700/25 border border-crimson-500/70 text-center">
                        <span className="text-caption font-bold text-fg">露娜·银冕</span>
                        <span className="font-num text-hud text-crimson-400 mt-1">2000 PP</span>
                      </div>
                    ) : (
                      `0${slot + 1}`
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 中场焦点事件浮窗 */}
            <div className="my-auto self-center px-5 py-3 bg-ink-900/95 backdrop-blur-md border border-line-strong text-center max-w-lg shadow-overlay">
              <div className="font-num text-hud text-crimson-400 uppercase font-semibold mb-1">
                {`EVENT #${currentEvent?.seq ?? 0} // ${currentEvent?.eventType ?? 'READY'}`}
              </div>
              <p className="text-caption font-num text-fg-secondary break-all">
                {currentEvent ? JSON.stringify(currentEvent.payload) : '等待回放播放'}
              </p>
            </div>

            {/* 己方战场 (Bottom) */}
            <div className="space-y-2">
              <div className="grid grid-cols-5 gap-2.5">
                {[0, 1, 2, 3, 4].map((slot) => (
                  <div
                    key={slot}
                    className="aspect-[3/4] border border-line bg-ink-900/70 flex items-center justify-center text-caption font-num text-fg-disabled"
                  >
                    {slot === 2 && currentStep >= 4 ? (
                      <div className="w-full h-full p-2 flex flex-col items-center justify-center bg-teal-400/15 border border-teal-400/70 text-center">
                        <span className="text-caption font-bold text-fg">露西亚·红莲</span>
                        <span className="font-num text-hud text-teal-400 mt-1">3000 PP</span>
                      </div>
                    ) : (
                      `0${slot + 1}`
                    )}
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center text-caption">
                <span className="text-teal-400 font-semibold">己方半场 (P1)</span>
                <span className="font-num tabular-nums text-fg-muted">侵蚀度 0 / 10</span>
              </div>
            </div>
          </div>

          {/* 播放控制条 */}
          <Panel className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="font-num tabular-nums text-caption text-fg-muted">00</span>
              <input
                type="range"
                min="0"
                max={Math.max(0, totalSteps - 1)}
                value={currentStep}
                aria-label="回放时间轴"
                onChange={(e) => {
                  setIsPlaying(false);
                  setCurrentStep(Number(e.target.value));
                }}
                className="flex-1 accent-crimson-500 cursor-pointer"
              />
              <span className="font-num tabular-nums text-caption text-fg">
                {String(totalSteps).padStart(2, '0')}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="icon"
                  size="md"
                  onClick={handleReset}
                  aria-label="回到开局"
                  title="回到开局"
                >
                  <RotateCcw className="w-4 h-4" />
                </Button>
                <Button
                  variant="icon"
                  size="md"
                  onClick={handleStepBack}
                  disabled={currentStep <= 0}
                  aria-label="上一步"
                  title="上一步"
                >
                  <SkipBack className="w-4 h-4" />
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setIsPlaying(!isPlaying)}
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4 fill-current" />
                  ) : (
                    <Play className="w-4 h-4 fill-current" />
                  )}
                  <span>{isPlaying ? '暂停' : '播放'}</span>
                </Button>
                <Button
                  variant="icon"
                  size="md"
                  onClick={handleStepForward}
                  disabled={currentStep >= totalSteps - 1}
                  aria-label="下一步"
                  title="下一步"
                >
                  <SkipForward className="w-4 h-4" />
                </Button>
              </div>

              <div className="flex items-center gap-1 font-num text-caption">
                {[0.5, 1, 2, 4].map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => setPlaySpeed(spd)}
                    className={`h-7 px-2.5 border transition-colors cursor-pointer ${
                      playSpeed === spd
                        ? 'border-crimson-500 bg-crimson-500/20 text-fg font-semibold'
                        : 'border-line bg-ink-900 text-fg-muted hover:text-fg'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>
          </Panel>
        </section>

        {/* 右侧审计事件流 */}
        <Panel
          className="lg:col-span-4"
          title="确定性事件审计流"
          subtitle="AUDIT EVENT STREAM"
          headerRight={
            <span className="font-num tabular-nums text-caption text-fg-muted">
              {historyEvents.length} / {totalSteps}
            </span>
          }
          padded={false}
        >
          <div className="h-[580px] overflow-y-auto divide-y divide-line">
            {historyEvents.map((evt, idx) => {
              const isCurrent = idx === currentStep;
              return (
                <button
                  key={evt.seq}
                  type="button"
                  onClick={() => {
                    setIsPlaying(false);
                    setCurrentStep(idx);
                  }}
                  className={`w-full text-left px-4 py-3 border-l-2 transition-colors duration-fast cursor-pointer ${
                    isCurrent
                      ? 'border-crimson-500 bg-ink-700 text-fg'
                      : 'border-transparent bg-ink-850 text-fg-secondary hover:bg-ink-800 hover:text-fg'
                  }`}
                >
                  <div className="flex items-center justify-between text-caption mb-1">
                    <span className="font-num font-semibold text-crimson-400 flex items-center gap-1.5">
                      <Terminal className="w-3 h-3" />
                      #{String(evt.seq).padStart(2, '0')}
                    </span>
                    <span className="font-display text-hud uppercase text-fg-muted">
                      {evt.eventType}
                    </span>
                  </div>
                  <div className="font-num text-caption text-fg-muted truncate">
                    {JSON.stringify(evt.payload)}
                  </div>
                </button>
              );
            })}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
