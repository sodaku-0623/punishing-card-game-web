'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useRouteId } from '@/lib/route-id';
import Link from 'next/link';
import { getSocket, getSocketUserId, getSocketUsername } from '@/lib/socket';
import { useAuth } from '@/lib/auth-context';
import { useGameStore } from '@/stores/game-store';
import {
  PublicRoomState,
  RoomStatus,
  ErrorCode,
} from '@zhanshuang/shared';
import { apiUrl } from '@/lib/api';
import { takePendingRoomPassword } from '@/lib/room-password';
import {
  Shield,
  Users,
  CheckCircle2,
  Clock,
  ArrowLeft,
  Play,
  Layers,
  AlertCircle,
  Copy,
  Check,
  Lock,
} from 'lucide-react';
import { OFFICIAL_STARTER_DECKS, findOfficialStarterDeck } from '@/lib/starter-decks';
import { copyText } from '@/lib/clipboard';
import {
  AppShell,
  Button,
  Badge,
  Input,
  Dialog,
  HudBrackets,
  HudRule,
} from '@/components/ui';

interface DeckOption {
  id: string;
  name: string;
  cardCount: number;
}

const DEFAULT_DECKS: DeckOption[] = OFFICIAL_STARTER_DECKS.map((d) => ({
  id: d.id,
  name: `${d.name} (50张)`,
  cardCount: 50,
}));

function RoomWaitingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roomId = useRouteId();
  const titleParam = searchParams.get('title') || '';

  const { user } = useAuth();

  const [room, setRoom] = useState<PublicRoomState | null>(null);
  const [availableDecks, setAvailableDecks] = useState<DeckOption[]>(DEFAULT_DECKS);
  const [selectedDeckId, setSelectedDeckId] = useState<string>(OFFICIAL_STARTER_DECKS[0].id);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [passwordPrompt, setPasswordPrompt] = useState<{ open: boolean; error?: string }>({
    open: false,
  });
  const [passwordInput, setPasswordInput] = useState('');
  const roomPasswordRef = React.useRef<string | undefined>(undefined);
  const passwordLoadedRef = React.useRef(false);
  const errorTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigatingToGameRef = React.useRef(false);
  const roomRef = React.useRef<PublicRoomState | null>(null);
  roomRef.current = room;

  const myUserId = user?.id || getSocketUserId();
  const myNickname = user?.nickname || getSocketUsername();

  useEffect(() => {
    useGameStore.getState().reset();
  }, []);

  useEffect(() => {
    try {
      const rawUserDecks = localStorage.getItem('zhanshuang_user_decks');
      if (rawUserDecks) {
        const parsed = JSON.parse(rawUserDecks);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const userDeckOptions: DeckOption[] = parsed.map((d: any) => ({
            id: d.id,
            name: `${d.name} (${d.cards?.reduce((sum: number, c: any) => sum + (c.count || 1), 0) || 50}张)`,
            cardCount: 50,
          }));
          setAvailableDecks([...DEFAULT_DECKS, ...userDeckOptions]);
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    const currentUserId = user?.id || getSocketUserId();
    const currentUsername = user?.nickname || user?.username || getSocketUsername();
    const socket = getSocket(currentUserId, currentUsername);

    if (!passwordLoadedRef.current) {
      passwordLoadedRef.current = true;
      roomPasswordRef.current = takePendingRoomPassword(roomId);
    }

    const doJoin = () => {
      socket.emit('room:join', {
        roomId,
        title: titleParam || undefined,
        password: roomPasswordRef.current,
        username: user?.nickname || user?.username || getSocketUsername(),
      });
    };

    if (socket.connected) {
      doJoin();
    } else {
      socket.connect();
    }

    const handleRoomState = (updatedRoom: PublicRoomState) => {
      setRoom(updatedRoom);
      roomRef.current = updatedRoom;
      setPasswordPrompt({ open: false });
      if (updatedRoom.status === RoomStatus.PLAYING && updatedRoom.currentGameId) {
        navigatingToGameRef.current = true;
        router.push(`/game/${updatedRoom.currentGameId}`);
      }
    };

    const handleRoomClosed = (payload: any) => {
      if (!payload || payload.roomId === roomId) {
        setErrorMessage(payload?.reason || '房间已自动关闭（玩家已全部离开）');
        setTimeout(() => {
          router.push('/rooms');
        }, 1200);
      }
    };

    const handleSyncState = (gameState: any) => {
      if (gameState?.gameId) {
        navigatingToGameRef.current = true;
        router.push(`/game/${gameState.gameId}`);
      }
    };

    const handleError = (err: { code: string; message: string }) => {
      if (
        err.code === ErrorCode.ROOM_PASSWORD_REQUIRED ||
        err.code === ErrorCode.ROOM_PASSWORD_INVALID
      ) {
        setPasswordPrompt({
          open: true,
          error: err.code === ErrorCode.ROOM_PASSWORD_INVALID ? err.message : undefined,
        });
        return;
      }
      setErrorMessage(err.message);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      errorTimerRef.current = setTimeout(() => setErrorMessage(null), 5000);
    };

    socket.on('connect', doJoin);
    socket.on('room:state_updated', handleRoomState);
    socket.on('room:closed', handleRoomClosed);
    socket.on('game:sync_state', handleSyncState);
    socket.on('game:error', handleError);

    const handleBeforeUnload = () => {
      if (!navigatingToGameRef.current && roomRef.current?.status !== RoomStatus.PLAYING) {
        socket.emit('room:leave', { roomId });
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    fetch(apiUrl(`/api/rooms/${encodeURIComponent(roomId)}`))
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (json?.success && json?.data) {
          setRoom(json.data);
          roomRef.current = json.data;
        }
      })
      .catch(() => {});

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (!navigatingToGameRef.current && roomRef.current?.status !== RoomStatus.PLAYING) {
        socket.emit('room:leave', { roomId });
      }
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      socket.off('connect', doJoin);
      socket.off('room:state_updated', handleRoomState);
      socket.off('room:closed', handleRoomClosed);
      socket.off('game:sync_state', handleSyncState);
      socket.off('game:error', handleError);
    };
  }, [roomId, titleParam, router]);

  function handleSubmitPassword(e: React.FormEvent) {
    e.preventDefault();
    const pw = passwordInput.trim();
    if (!pw) {
      setPasswordPrompt({ open: true, error: '请输入房间密码' });
      return;
    }
    roomPasswordRef.current = pw;
    getSocket(myUserId, myNickname).emit('room:join', {
      roomId,
      title: titleParam || undefined,
      password: pw,
      username: myNickname,
    });
  }

  async function handleCopyRoomId() {
    if (!(await copyText(roomId))) return;
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  }

  async function handleCopyCode() {
    if (!room?.roomCode) return;
    if (!(await copyText(room.roomCode))) return;
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  }

  const me =
    room?.players.find((p) => p.userId === myUserId) ||
    (room &&
    room.players.length === 1 &&
    (room.creatorId === myUserId || room.players[0].userId === myUserId)
      ? room.players[0]
      : undefined);

  const isReady = me?.isReady ?? false;
  const isHost =
    room?.creatorId === myUserId ||
    (room && room.players.length > 0 && room.players[0]?.userId === myUserId);

  const canStart =
    Boolean(isHost) &&
    room?.players.length === 2 &&
    room.players.every((p) => p.isReady);

  function getCustomDeckPayload(deckId: string) {
    const official = findOfficialStarterDeck(deckId);
    if (official) return official;
    try {
      const rawUserDecks = localStorage.getItem('zhanshuang_user_decks');
      if (rawUserDecks) {
        const list = JSON.parse(rawUserDecks);
        if (Array.isArray(list)) {
          return list.find((d: any) => d.id === deckId);
        }
      }
    } catch {}
    return undefined;
  }

  function handleSelectDeck(newDeckId: string) {
    setSelectedDeckId(newDeckId);
    const socket = getSocket(myUserId, myNickname);
    const customDeck = getCustomDeckPayload(newDeckId);
    socket.emit('room:select_deck', {
      roomId,
      deckId: newDeckId,
      customDeck,
    });
  }

  function handleToggleReady() {
    const nextReady = !isReady;
    const socket = getSocket(myUserId, myNickname);
    const customDeck = getCustomDeckPayload(selectedDeckId);
    socket.emit('room:ready', {
      roomId,
      isReady: nextReady,
      deckId: selectedDeckId,
      customDeck,
    });
  }

  function handleStartGame() {
    navigatingToGameRef.current = true;
    const socket = getSocket(myUserId, myNickname);
    socket.emit('room:start', { roomId });
  }

  function handleLeaveRoom() {
    const socket = getSocket(myUserId, myNickname);
    socket.emit('room:leave', { roomId });
    router.push('/rooms');
  }

  const seat0 = room?.players.find((p) => p.seatIndex === 0);
  const seat1 = room?.players.find((p) => p.seatIndex === 1);
  const displayRoomTitle = room?.title || titleParam || `作战推演室 #${roomId}`;

  return (
    <AppShell className="space-y-6">
      {/* 错误警示 */}
      {errorMessage && (
        <div
          role="alert"
          className="border border-crimson-500/60 bg-crimson-700/20 px-4 py-3 text-body-sm text-crimson-400 flex items-center gap-2.5 animate-in fade-in duration-fast"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 顶部房间信息栏 */}
      <header className="border-b border-line pb-5 flex flex-col md:flex-row md:items-center justify-between gap-4 pgr-enter">
        <div className="flex items-start gap-4">
          <Button variant="secondary" size="md" onClick={handleLeaveRoom} className="shrink-0">
            <ArrowLeft className="w-4 h-4" />
            <span>返回大厅</span>
          </Button>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-title font-bold text-fg tracking-wide">
                {displayRoomTitle}
              </h1>

              <button
                type="button"
                onClick={handleCopyRoomId}
                title="点击复制 Room ID 分享给对手"
                className="inline-flex items-center gap-1.5 h-7 px-2.5 border border-teal-400/50 bg-teal-400/10 text-teal-400 text-caption font-num hover:bg-teal-400/20 transition-colors cursor-pointer"
              >
                <span>ID: {roomId}</span>
                {copiedId ? (
                  <Check className="w-3.5 h-3.5 text-success" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>

              {room?.roomCode && room.roomCode !== roomId && (
                <button
                  type="button"
                  onClick={handleCopyCode}
                  title="点击复制房间代号"
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 border border-line bg-ink-850 text-fg-secondary text-caption font-num hover:border-line-strong hover:text-fg transition-colors cursor-pointer"
                >
                  <span>CODE: {room.roomCode}</span>
                  {copiedCode ? (
                    <Check className="w-3.5 h-3.5 text-success" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
            </div>

            <p className="font-display text-hud uppercase text-fg-muted">
              PRE-BATTLE STAGING ROOM // AUTHORITATIVE ENGINE READY
            </p>
          </div>
        </div>

        <Badge variant={room?.status === RoomStatus.READY ? 'success' : 'neutral'} className="h-7 px-3 self-start md:self-center">
          {room?.status === RoomStatus.READY ? '双方就绪 · 等待房主开战' : '整备等待中'}
        </Badge>
      </header>

      {/* 双方对峙整备席位 */}
      <div className="relative grid grid-cols-1 md:grid-cols-2 gap-6 pgr-enter pgr-delay-1">
        {/* 中央 VS 切角徽标 (桌面端居中叠层) */}
        <div
          aria-hidden="true"
          className="hidden md:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 h-11 w-11 bg-ink-950 border border-line-strong clip-corner-sm items-center justify-center"
        >
          <span className="font-display text-body-sm font-bold italic text-crimson-500">
            VS
          </span>
        </div>

        {/* SEAT 01 己方/房主席 */}
        <div className="relative border border-line bg-ink-850 p-6 flex flex-col justify-between min-h-[300px]">
          <HudBrackets color={seat0?.isReady ? 'teal' : 'steel'} />
          <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-1 bg-teal-400" />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="h-2 w-2 bg-teal-400" />
              <span className="font-display text-hud uppercase text-fg-muted">
                SEAT 01 // HOST COMMANDER
              </span>
            </div>
            {seat0?.isReady && (
              <Badge variant="success">
                <CheckCircle2 className="w-3 h-3" />
                <span>已准备</span>
              </Badge>
            )}
          </div>

          {seat0 ? (
            <div className="my-auto py-6 flex flex-col items-center text-center">
              <div className="h-20 w-20 rounded-full border border-teal-400/70 bg-ink-900 flex items-center justify-center text-display font-bold text-teal-400 mb-3">
                {seat0.nickname.substring(0, 1) || '01'}
              </div>
              <div className="flex items-center gap-2">
                <h2 className="text-title font-semibold text-fg">{seat0.nickname}</h2>
                {seat0.userId === myUserId && <Badge variant="teal">我方</Badge>}
              </div>
              <p className="font-num tabular-nums text-caption text-fg-muted mt-1">
                UID: {seat0.userId.slice(-8)}
              </p>
              <div className="mt-4 inline-flex items-center gap-2 border border-line bg-ink-900 px-3 py-1.5 text-caption text-fg-secondary">
                <Layers className="w-3.5 h-3.5 text-gold-300" />
                <span>出战卡组：{seat0.deckName || '灰鸦特遣初始牌组 (ST01)'}</span>
              </div>
            </div>
          ) : (
            <div className="my-auto py-10 flex flex-col items-center text-fg-muted">
              <Clock className="w-8 h-8 animate-spin mb-3" />
              <span className="text-body-sm">等待先手席位连接...</span>
            </div>
          )}

          <div className="pt-3 border-t border-line flex items-center justify-between text-caption text-fg-muted">
            <span>身份：作战房主</span>
            <span className="font-num text-teal-400">● ONLINE</span>
          </div>
        </div>

        {/* SEAT 02 挑战者席 */}
        <div className="relative border border-line bg-ink-850 p-6 flex flex-col justify-between min-h-[300px]">
          <HudBrackets color={seat1?.isReady ? 'crimson' : 'steel'} />
          <span aria-hidden="true" className="absolute right-0 top-0 bottom-0 w-1 bg-crimson-500" />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="h-2 w-2 bg-crimson-500" />
              <span className="font-display text-hud uppercase text-fg-muted">
                SEAT 02 // CHALLENGER
              </span>
            </div>
            {seat1?.isReady && (
              <Badge variant="success">
                <CheckCircle2 className="w-3 h-3" />
                <span>已准备</span>
              </Badge>
            )}
          </div>

          {seat1 ? (
            <div className="my-auto py-6 flex flex-col items-center text-center">
              <div className="h-20 w-20 rounded-full border border-crimson-500/70 bg-ink-900 flex items-center justify-center text-display font-bold text-crimson-400 mb-3">
                {seat1.nickname.substring(0, 1) || '02'}
              </div>
              <div className="flex items-center gap-2">
                <h2 className="text-title font-semibold text-fg">{seat1.nickname}</h2>
                {seat1.userId === myUserId && <Badge variant="teal">我方</Badge>}
              </div>
              <p className="font-num tabular-nums text-caption text-fg-muted mt-1">
                UID: {seat1.userId.slice(-8)}
              </p>
              <div className="mt-4 inline-flex items-center gap-2 border border-line bg-ink-900 px-3 py-1.5 text-caption text-fg-secondary">
                <Layers className="w-3.5 h-3.5 text-gold-300" />
                <span>出战卡组：{seat1.deckName || '灰鸦特遣初始牌组 (ST01)'}</span>
              </div>
            </div>
          ) : (
            <div className="my-auto py-10 flex flex-col items-center text-center text-fg-muted">
              <div className="h-14 w-14 border border-dashed border-line-strong flex items-center justify-center mb-3">
                <Users className="w-6 h-6 text-fg-muted" />
              </div>
              <span className="text-body-sm text-fg-secondary">等待二号位指挥官加入...</span>
              <button
                type="button"
                onClick={handleCopyRoomId}
                className="mt-2 inline-flex items-center gap-1.5 text-caption text-teal-400 hover:underline cursor-pointer font-num"
              >
                <span>复制并分享房间 ID: {roomId}</span>
                <Copy className="w-3 h-3" />
              </button>
            </div>
          )}

          <div className="pt-3 border-t border-line flex items-center justify-between text-caption text-fg-muted">
            <span>身份：参演挑战方</span>
            <span className="font-num">
              {seat1 ? <span className="text-teal-400">● ONLINE</span> : '○ WAITING'}
            </span>
          </div>
        </div>
      </div>

      <HudRule code="DEPLOYMENT CONFIGURATION" />

      {/* 底部出战卡组与准备控制栏 */}
      <div className="border border-line bg-ink-850 p-5 flex flex-col md:flex-row md:items-end justify-between gap-6 pgr-enter pgr-delay-2">
        <div className="space-y-2 flex-1">
          <label
            htmlFor="room-deck-select"
            className="flex items-center gap-2 text-caption text-fg-muted font-medium"
          >
            <Shield className="w-4 h-4 text-teal-400" />
            <span>选择出战卡组（符合 5.1 规则书 50 张构筑标准）</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <select
              id="room-deck-select"
              value={selectedDeckId}
              onChange={(e) => handleSelectDeck(e.target.value)}
              disabled={isReady}
              className="h-9 px-3 bg-ink-800 border border-line text-body-sm text-fg focus:border-teal-400 focus:outline-none disabled:bg-ink-600 disabled:text-fg-disabled min-w-[260px]"
            >
              {availableDecks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <Link href="/decks">
              <Button variant="secondary" size="md">
                构筑新卡组
              </Button>
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 justify-end">
          <Button
            variant={isReady ? 'secondary' : isHost ? 'secondary' : 'primary'}
            size="lg"
            onClick={handleToggleReady}
            className={
              !isReady && isHost
                ? 'border-teal-400 text-teal-400 hover:bg-teal-400/10'
                : undefined
            }
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{isReady ? '取消准备' : '准备出战'}</span>
          </Button>

          {isHost && (
            <Button
              variant="primary"
              size="lg"
              disabled={!canStart}
              onClick={handleStartGame}
            >
              <Play className="w-4 h-4 fill-current" />
              <span>开始作战</span>
            </Button>
          )}
        </div>
      </div>

      {/* 密码校验弹窗 */}
      <Dialog
        open={passwordPrompt.open}
        onClose={() => router.push('/rooms')}
        closeOnBackdrop={false}
        title="该房间已设置密码"
        subtitle="ENCRYPTED ROOM ACCESS"
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => router.push('/rooms')}>
              返回大厅
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              form="room-password-form"
            >
              <span>进入房间</span>
            </Button>
          </>
        }
      >
        <form id="room-password-form" onSubmit={handleSubmitPassword} className="space-y-3">
          <div className="flex items-center gap-2 text-caption text-gold-300">
            <Lock className="w-4 h-4 shrink-0" />
            <span>此房间为私密演习通道，需要输入房主设定的口令。</span>
          </div>
          <Input
            type="password"
            autoFocus
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            placeholder="请输入房间密码"
            aria-label="房间密码"
            error={passwordPrompt.error}
          />
        </form>
      </Dialog>
    </AppShell>
  );
}

export default function RoomWaitingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-ink-950 flex flex-col items-center justify-center p-6 text-fg-secondary">
          <Clock className="w-7 h-7 animate-spin mb-3 text-crimson-500" />
          <p className="text-body-sm">正在同步作战房间状态...</p>
        </div>
      }
    >
      <RoomWaitingContent />
    </Suspense>
  );
}
