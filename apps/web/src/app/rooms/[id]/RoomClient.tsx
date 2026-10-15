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
  RoomPlayerDto,
  ErrorCode,
} from '@zhanshuang/shared';
import { apiUrl } from '@/lib/api';
import { takePendingRoomPassword } from '@/lib/room-password';
import {
  Swords,
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
  User as UserIcon,
} from 'lucide-react';
import { OFFICIAL_STARTER_DECKS, findOfficialStarterDeck } from '@/lib/starter-decks';
import { copyText } from '@/lib/clipboard';

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
  // 房间密码输入弹窗 (加入设有密码的房间时)
  const [passwordPrompt, setPasswordPrompt] = useState<{ open: boolean; error?: string }>({ open: false });
  const [passwordInput, setPasswordInput] = useState('');
  const roomPasswordRef = React.useRef<string | undefined>(undefined);
  const passwordLoadedRef = React.useRef(false);
  const errorTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigatingToGameRef = React.useRef(false);
  const roomRef = React.useRef<PublicRoomState | null>(null);
  roomRef.current = room;

  // 获取真实的用户 ID 与昵称
  const myUserId = user?.id || getSocketUserId();
  const myNickname = user?.nickname || getSocketUsername();

  // 进入房间等待区时重置旧游戏状态
  useEffect(() => {
    useGameStore.getState().reset();
  }, []);

  // 读取本地已保存的卡组供出战选择
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

    // 房主新建房间时由大厅暂存的密码，仅读取一次 (ref 可跨越 StrictMode 的二次挂载)
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
      // 若房间已开局并存在对局 ID，立即进入对局桌面
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
      if (err.code === ErrorCode.ROOM_PASSWORD_REQUIRED || err.code === ErrorCode.ROOM_PASSWORD_INVALID) {
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

    // 主动同步一次服务端最新房间数据
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

  // 准确定位当前操作玩家
  const me =
    room?.players.find((p) => p.userId === myUserId) ||
    (room && room.players.length === 1 && (room.creatorId === myUserId || room.players[0].userId === myUserId)
      ? room.players[0]
      : undefined);

  const isReady = me?.isReady ?? false;
  const isHost =
    room?.creatorId === myUserId ||
    (room && room.players.length > 0 && room.players[0]?.userId === myUserId);

  const canStart =
    isHost &&
    room?.players.length === 2 &&
    room.players.every((p) => p.isReady);

  function getCustomDeckPayload(deckId: string) {
    const official = findOfficialStarterDeck(deckId);
    if (official) {
      return official;
    }
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
    <div className="min-h-screen bg-background text-foreground p-6 md:p-12 relative flex flex-col items-center">
      {/* 错误提示浮条 */}
      {errorMessage && (
        <div
          role="alert"
          className="w-full max-w-5xl mb-6 p-4 rounded-xl border border-erosionRed/50 bg-erosionRed/10 text-erosionRed text-xs font-mono flex items-center gap-3 shadow-lg"
        >
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* 房间密码输入弹窗 */}
      {passwordPrompt.open && (
        <div
          className="fixed inset-0 bg-neutral-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="room-password-title"
        >
          <form
            onSubmit={handleSubmitPassword}
            className="max-w-sm w-full p-6 rounded-2xl border border-terminalBorder bg-surface flex flex-col gap-4 shadow-2xl"
          >
            <h2 id="room-password-title" className="text-base font-bold text-white flex items-center gap-2">
              <Lock className="w-5 h-5 text-terminalGold" /> 该房间已设置密码
            </h2>
            <input
              type="password"
              autoFocus
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="请输入房主提供的房间密码"
              aria-label="房间密码"
              className="w-full px-3.5 py-2.5 rounded-lg bg-neutral-950 border border-terminalBorder text-white text-sm focus:border-terminalCyan outline-none"
            />
            {passwordPrompt.error && (
              <p role="alert" className="text-xs text-erosionRed font-mono">
                {passwordPrompt.error}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => router.push('/rooms')}
                className="px-4 py-2 rounded-lg border border-terminalBorder text-neutral-400 hover:text-white text-xs font-mono"
              >
                返回大厅
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-terminalCyan hover:bg-terminalCyan/90 text-neutral-950 font-bold text-xs font-mono"
              >
                进入房间
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 顶部导航 */}
      <header className="w-full max-w-5xl flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-terminalBorder/60 pb-6 mb-8 gap-4">
        <div className="flex items-center gap-4">
          <button
            onClick={handleLeaveRoom}
            className="p-2 rounded-lg border border-terminalBorder bg-surface hover:border-terminalCyan/50 text-neutral-400 hover:text-white transition-all flex items-center gap-2 text-xs font-mono"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回大厅</span>
          </button>

          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl md:text-2xl font-bold tracking-wider text-white">
                {displayRoomTitle}
              </h1>

              {/* 复制 Room ID 按钮 */}
              <button
                onClick={handleCopyRoomId}
                className="px-2.5 py-1 rounded-lg bg-terminalCyan/10 border border-terminalCyan/40 text-terminalCyan text-xs font-mono flex items-center gap-1.5 hover:bg-terminalCyan/20 transition-all"
                title="点击复制 Room ID 分享给对手"
              >
                <span>ID: {roomId}</span>
                {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>

              {/* 房间代号 */}
              {room?.roomCode && room.roomCode !== roomId && (
                <button
                  onClick={handleCopyCode}
                  className="px-2.5 py-1 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-400 text-xs font-mono flex items-center gap-1 hover:text-white transition-all"
                  title="点击复制房间代号"
                >
                  <span>CODE: {room.roomCode}</span>
                  {copiedCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                </button>
              )}
            </div>
            <p className="text-xs text-neutral-400 font-mono mt-1">
              战术前置编队室 • 权威裁判内核实时仲裁
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span
            className={`px-3.5 py-1 rounded-full text-xs font-mono font-bold border ${
              room?.status === RoomStatus.READY
                ? 'bg-terminalGold/15 text-terminalGold border-terminalGold/50 animate-pulse'
                : 'bg-neutral-900 text-neutral-400 border-terminalBorder'
            }`}
          >
            {room?.status === RoomStatus.READY ? '双方就绪 • 待开战' : '等待就绪中'}
          </span>
        </div>
      </header>

      {/* 双方席位展示 (Seat 0 & Seat 1) */}
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        {/* 席位 1: 房主 (指挥官 1) */}
        <div className="p-6 rounded-2xl border border-terminalBorder bg-surface relative flex flex-col justify-between shadow-xl min-h-[320px]">
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-terminalCyan shadow-sm" />
              <span className="text-xs font-mono text-neutral-400 uppercase tracking-widest">
                SEAT 01 • 先手发起方
              </span>
            </div>
            {seat0?.isReady && (
              <span className="px-2.5 py-1 rounded bg-terminalCyan/20 text-terminalCyan border border-terminalCyan/40 text-xs font-mono font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> 已准备
              </span>
            )}
          </div>

          {seat0 ? (
            <div className="flex flex-col items-center my-auto py-4">
              <div className="w-20 h-20 rounded-2xl bg-neutral-900 border-2 border-terminalCyan/60 flex items-center justify-center text-terminalCyan text-2xl font-bold shadow-lg mb-3">
                {seat0.nickname.substring(0, 1) || '01'}
              </div>
              <h3 className="text-lg font-bold text-white tracking-wide flex items-center gap-2">
                <span>{seat0.nickname}</span>
                {seat0.userId === myUserId && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-terminalCyan/10 text-terminalCyan border border-terminalCyan/30">
                    您自己
                  </span>
                )}
              </h3>
              <p className="text-xs text-neutral-500 font-mono mb-2">UID: {seat0.userId.slice(-8)}</p>
              <div className="px-3 py-1 rounded-lg bg-neutral-950 border border-terminalBorder text-xs font-mono text-neutral-300 flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-terminalGold" />
                <span>卡组: {seat0.deckName || '灰鸦特遣初始牌组 (ST01)'}</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center my-auto py-8 text-neutral-600">
              <Clock className="w-10 h-10 animate-spin mb-3 text-neutral-600" />
              <span className="text-sm font-mono">等待先手席位连接...</span>
            </div>
          )}

          <div className="text-[11px] font-mono text-neutral-500 border-t border-terminalBorder/50 pt-3 flex justify-between items-center">
            <span>ROLE: 战术指挥官 (房主)</span>
            <span className="text-terminalCyan">● ONLINE</span>
          </div>
        </div>

        {/* 席位 2: 挑战者 (指挥官 2) */}
        <div className="p-6 rounded-2xl border border-terminalBorder bg-surface relative flex flex-col justify-between shadow-xl min-h-[320px]">
          <div className="flex justify-between items-start">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-erosionRed shadow-sm" />
              <span className="text-xs font-mono text-neutral-400 uppercase tracking-widest">
                SEAT 02 • 迎战挑战方
              </span>
            </div>
            {seat1?.isReady && (
              <span className="px-2.5 py-1 rounded bg-terminalCyan/20 text-terminalCyan border border-terminalCyan/40 text-xs font-mono font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> 已准备
              </span>
            )}
          </div>

          {seat1 ? (
            <div className="flex flex-col items-center my-auto py-4">
              <div className="w-20 h-20 rounded-2xl bg-neutral-900 border-2 border-erosionRed/60 flex items-center justify-center text-erosionRed text-2xl font-bold shadow-lg mb-3">
                {seat1.nickname.substring(0, 1) || '02'}
              </div>
              <h3 className="text-lg font-bold text-white tracking-wide flex items-center gap-2">
                <span>{seat1.nickname}</span>
                {seat1.userId === myUserId && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-terminalCyan/10 text-terminalCyan border border-terminalCyan/30">
                    您自己
                  </span>
                )}
              </h3>
              <p className="text-xs text-neutral-500 font-mono mb-2">UID: {seat1.userId.slice(-8)}</p>
              <div className="px-3 py-1 rounded-lg bg-neutral-950 border border-terminalBorder text-xs font-mono text-neutral-300 flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-terminalGold" />
                <span>卡组: {seat1.deckName || '灰鸦特遣初始牌组 (ST01)'}</span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center my-auto py-8 text-neutral-500">
              <div className="w-16 h-16 rounded-full border border-dashed border-terminalBorder flex items-center justify-center mb-3">
                <Users className="w-6 h-6 text-neutral-600" />
              </div>
              <span className="text-sm font-mono text-neutral-300">等待二号位指挥官加入...</span>
              <button
                onClick={handleCopyRoomId}
                className="text-xs text-terminalCyan hover:underline font-mono mt-2 flex items-center gap-1"
              >
                <span>分享 Room ID: {roomId}</span>
                <Copy className="w-3 h-3" />
              </button>
            </div>
          )}

          <div className="text-[11px] font-mono text-neutral-500 border-t border-terminalBorder/50 pt-3 flex justify-between items-center">
            <span>ROLE: 战术参演方</span>
            <span>{seat1 ? <span className="text-terminalCyan">● ONLINE</span> : '○ WAITING'}</span>
          </div>
        </div>
      </div>

      {/* 底部操作与卡组选择面板 */}
      <div className="w-full max-w-5xl bg-surface/80 border border-terminalBorder rounded-2xl p-6 flex flex-col md:flex-row justify-between items-center gap-6 shadow-2xl backdrop-blur-md">
        {/* 卡组选择区 */}
        <div className="flex flex-col gap-2 w-full md:w-auto">
          <label className="text-xs font-mono text-neutral-400 flex items-center gap-2">
            <Shield className="w-4 h-4 text-terminalCyan" />
            <span>选择出战牌组 (符合 5.1 规则书 50 张构筑标准)</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedDeckId}
              onChange={(e) => handleSelectDeck(e.target.value)}
              disabled={isReady}
              className="px-4 py-2.5 rounded-lg bg-neutral-950 border border-terminalBorder text-white text-sm font-mono focus:border-terminalCyan outline-none disabled:opacity-50 min-w-[260px]"
            >
              {availableDecks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <Link
              href="/decks"
              className="px-3 py-2 rounded-lg border border-terminalBorder hover:border-terminalCyan text-xs font-mono text-neutral-400 hover:text-white transition-colors"
            >
              构筑新卡组
            </Link>
          </div>
        </div>

        {/* 行动按钮群 */}
        <div className="flex items-center gap-4 w-full md:w-auto justify-end">
          <button
            onClick={handleToggleReady}
            className={`px-6 py-3 rounded-xl font-bold font-mono text-sm transition-all flex items-center gap-2 shadow-lg cursor-pointer ${
              isReady
                ? 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700 border border-neutral-600'
                : 'bg-terminalCyan hover:bg-terminalCyan/90 text-neutral-950 shadow-[0_0_15px_rgba(0,240,255,0.3)]'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>{isReady ? '取消准备' : '准备出战 (READY)'}</span>
          </button>

          {isHost && (
            <button
              onClick={handleStartGame}
              disabled={!canStart}
              className={`px-8 py-3 rounded-xl font-bold font-mono text-sm flex items-center gap-2 shadow-xl transition-all ${
                canStart
                  ? 'bg-terminalGold hover:bg-terminalGold/90 text-neutral-950 cursor-pointer scale-105 animate-pulse shadow-[0_0_20px_rgba(255,184,0,0.3)]'
                  : 'bg-neutral-800 text-neutral-500 cursor-not-allowed border border-terminalBorder'
              }`}
            >
              <Play className="w-4 h-4 fill-current" />
              <span>开始作战 (START)</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RoomWaitingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-terminalCyan font-mono">
          <Clock className="w-8 h-8 animate-spin mb-4" />
          <p>正在同步作战房间状态...</p>
        </div>
      }
    >
      <RoomWaitingContent />
    </Suspense>
  );
}
