'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Swords,
  Plus,
  Shield,
  Users,
  ArrowRight,
  Lock,
  ChevronRight,
  User,
  LogIn,
  RefreshCw,
  Search,
  Hash,
  Sparkles,
  Zap,
  AlertCircle,
} from 'lucide-react';
import { PublicRoomState, RoomStatus } from '@zhanshuang/shared';
import { useAuth } from '@/lib/auth-context';
import { apiUrl } from '@/lib/api';
import { getSocket, getSocketUserId } from '@/lib/socket';
import { stashPendingRoomPassword } from '@/lib/room-password';
import { useGameStore } from '@/stores/game-store';

export default function RoomsLobbyPage() {
  const router = useRouter();
  const { user, isLoggedIn } = useAuth();

  const [rooms, setRooms] = useState<PublicRoomState[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [targetRoomId, setTargetRoomId] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);

  // 预生成的 6 位随机 Room ID
  const [previewRoomId, setPreviewRoomId] = useState('');

  const generateRandomRoomId = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
  };

  const fetchRooms = async () => {
    try {
      const res = await fetch(apiUrl('/api/rooms'));
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setRooms(
            json.data.filter(
              (r: PublicRoomState) =>
                r.status !== RoomStatus.CLOSED &&
                r.status !== RoomStatus.FINISHED &&
                (r.players?.length ?? 0) > 0
            )
          );
        }
      }
    } catch {
      // 保持当前状态
    }
  };

  useEffect(() => {
    useGameStore.getState().reset();
  }, []);

  // 当前浏览器的真实身份 (登录用户 ID 或本机唯一游客 ID)
  const [currentUserId, setCurrentUserId] = useState<string>('');
  useEffect(() => {
    setCurrentUserId(user?.id || getSocketUserId());
  }, [user]);

  useEffect(() => {
    fetchRooms();
    // 页面不可见时暂停轮询，回到前台立即刷新
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchRooms();
    }, 3000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') fetchRooms();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    const socket = getSocket(user?.id || getSocketUserId(), user?.nickname || undefined);
    const handleRoomDeleted = ({ roomId }: { roomId: string }) => {
      setRooms((prev) => prev.filter((r) => r.roomId !== roomId));
    };
    const handleRoomStateUpdated = (updatedRoom: PublicRoomState) => {
      if (updatedRoom.status === RoomStatus.CLOSED || (updatedRoom.players?.length ?? 0) === 0) {
        setRooms((prev) => prev.filter((r) => r.roomId !== updatedRoom.roomId));
      } else {
        setRooms((prev) => {
          const index = prev.findIndex((r) => r.roomId === updatedRoom.roomId);
          if (index >= 0) {
            const next = [...prev];
            next[index] = updatedRoom;
            return next;
          } else {
            return [updatedRoom, ...prev];
          }
        });
      }
    };

    socket.on('room:deleted', handleRoomDeleted);
    socket.on('room:closed', handleRoomDeleted);
    socket.on('room:state_updated', handleRoomStateUpdated);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
      socket.off('room:deleted', handleRoomDeleted);
      socket.off('room:closed', handleRoomDeleted);
      socket.off('room:state_updated', handleRoomStateUpdated);
    };
  }, [user]);

  const handleOpenCreateModal = () => {
    const defaultName = user?.nickname ? `${user.nickname}的作战推演` : '空中花园特遣战术室';
    setNewTitle(defaultName);
    setNewPassword('');
    setPreviewRoomId(generateRandomRoomId());
    setIsCreateOpen(true);
  };

  function handleCreateRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const roomId = previewRoomId || generateRandomRoomId();
    // 房间由房主通过已认证的 Socket 连接首次加入时创建 (确保房主身份与连接身份一致)。
    // 密码仅暂存于本标签页 sessionStorage，不会出现在 URL 中。
    stashPendingRoomPassword(roomId, newPassword.trim());
    router.push(`/rooms/${roomId}?title=${encodeURIComponent(newTitle.trim())}`);
  }

  function handleJoinByRoomId(e: React.FormEvent) {
    e.preventDefault();
    setJoinError(null);
    const cleaned = targetRoomId.trim();
    if (!cleaned) {
      setJoinError('请输入有效的 Room ID 或房间代码');
      return;
    }
    router.push(`/rooms/${encodeURIComponent(cleaned)}`);
  }

  return (
    <div className="min-h-screen bg-background text-foreground p-6 md:p-12 relative overflow-hidden flex flex-col items-center">
      {/* 顶部导航 */}
      <header className="w-full max-w-6xl flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-terminalBorder/60 pb-6 mb-8 gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-neutral-400 mb-1">
            <Link href="/" className="hover:text-terminalCyan transition-colors">
              终端首页
            </Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-terminalCyan">作战终端大厅</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-terminalCyan/10 border border-terminalCyan/30 flex items-center justify-center text-terminalCyan">
              <Swords className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-wider text-white">作战终端大厅</h1>
              <p className="text-xs text-neutral-400 font-mono">BATTLE LOBBY • MULTIPLAYER ONLINE</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* 指挥官登录状态 */}
          {isLoggedIn && user ? (
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-terminalCyan/40 bg-terminalCyan/10 text-terminalCyan text-xs font-mono">
              <User className="w-3.5 h-3.5" />
              <span>指挥官: {user.nickname}</span>
            </div>
          ) : (
            <Link
              href="/login"
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-terminalBorder bg-surface hover:border-terminalCyan/50 text-neutral-300 text-xs font-mono transition-colors"
            >
              <LogIn className="w-3.5 h-3.5 text-terminalCyan" />
              <span>登录档案</span>
            </Link>
          )}

          <button
            onClick={() => {
              setLoading(true);
              fetchRooms().finally(() => setLoading(false));
            }}
            className="p-2 rounded-lg border border-terminalBorder bg-surface hover:border-terminalCyan text-neutral-400 hover:text-white transition-colors"
            title="刷新房间列表"
            aria-label="刷新房间列表"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-terminalCyan' : ''}`} />
          </button>

          <button
            onClick={handleOpenCreateModal}
            className="px-4 py-2 rounded-lg bg-terminalCyan hover:bg-terminalCyan/90 text-neutral-950 font-bold text-sm font-mono flex items-center gap-2 shadow-[0_0_15px_rgba(0,240,255,0.25)] transition-transform hover:scale-105"
          >
            <Plus className="w-4 h-4" /> 创建房间
          </button>
        </div>
      </header>

      <div className="w-full max-w-6xl flex flex-col gap-8">
        {/* 输入 Room ID 快速加入指定房间功能条 */}
        <div className="p-5 rounded-2xl border border-terminalBorder bg-surface/80 backdrop-blur-md shadow-xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-terminalGold/10 border border-terminalGold/30 flex items-center justify-center text-terminalGold flex-shrink-0">
              <Hash className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <span>加入指定作战房间</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-terminalGold/10 text-terminalGold border border-terminalGold/30">
                  定向联机
                </span>
              </h2>
              <p className="text-xs text-neutral-400 font-mono mt-0.5">
                输入对手提供的 6 位 Room ID 或房间代码直接接入战局
              </p>
            </div>
          </div>

          <form onSubmit={handleJoinByRoomId} className="flex items-center gap-2 flex-1 max-w-md">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input
                type="text"
                value={targetRoomId}
                onChange={(e) => {
                  setTargetRoomId(e.target.value);
                  setJoinError(null);
                }}
                placeholder="输入 6 位 Room ID (如 739102)..."
                className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-neutral-950 border border-terminalBorder text-white text-xs font-mono focus:border-terminalCyan focus:outline-none transition-colors"
              />
            </div>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl bg-neutral-800 hover:bg-terminalCyan hover:text-neutral-950 text-white font-mono text-xs font-bold transition-all border border-terminalBorder hover:border-terminalCyan flex items-center gap-1.5 shadow-sm whitespace-nowrap"
            >
              <span>加入指定房间</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>

        {joinError && (
          <div className="p-3 rounded-lg border border-red-500/40 bg-red-500/10 text-xs text-red-300 font-mono">
            {joinError}
          </div>
        )}

        {/* 正在进行中的对局一键重连通报栏 */}
        {(() => {
          const myActiveRoom = rooms.find(
            (r) => r.status === RoomStatus.PLAYING && r.players?.some((p) => p.userId === currentUserId)
          );
          if (!myActiveRoom) return null;

          return (
            <div className="w-full p-5 rounded-2xl border-2 border-terminalCyan bg-terminalCyan/10 shadow-[0_0_30px_rgba(0,240,255,0.25)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-pulse">
              <div className="flex items-center gap-3.5">
                <div className="w-12 h-12 rounded-xl bg-terminalCyan/20 border border-terminalCyan/40 flex items-center justify-center text-terminalCyan flex-shrink-0">
                  <Swords className="w-6 h-6" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white flex items-center gap-2">
                    <span>检测到您有正在进行中的推演对决！</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-terminalCyan/20 text-terminalCyan border border-terminalCyan/40">
                      ROOM ID: {myActiveRoom.roomId}
                    </span>
                  </div>
                  <p className="text-xs text-neutral-300 font-mono mt-0.5">
                    对战房间已为您保留，另一名指挥官正在战局中等待您继续对战
                  </p>
                </div>
              </div>

              <button
                onClick={() =>
                  router.push(
                    myActiveRoom.currentGameId
                      ? `/game/${myActiveRoom.currentGameId}`
                      : `/rooms/${myActiveRoom.roomId}`
                  )
                }
                className="px-5 py-2.5 rounded-xl bg-terminalCyan hover:bg-terminalCyan/90 text-neutral-950 font-bold font-mono text-xs shadow-lg flex items-center gap-1.5 transition-transform hover:scale-105 whitespace-nowrap"
              >
                <Zap className="w-4 h-4 fill-current" />
                <span>一键重连继续推演</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          );
        })()}

        {/* 房间列表网格 */}
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-center text-sm font-mono text-neutral-400">
            <span>当前全服活跃推演 ({rooms.length})</span>
            <span className="text-xs text-terminalCyan">服务器权威裁判内核在线</span>
          </div>

          {rooms.length === 0 ? (
            <div className="w-full py-16 px-6 rounded-2xl border border-dashed border-terminalBorder/80 bg-surface/40 flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-neutral-900/80 border border-terminalBorder flex items-center justify-center text-neutral-500 mb-4">
                <Swords className="w-7 h-7 text-neutral-600" />
              </div>
              <h3 className="text-base font-bold text-white mb-1">当前暂无活跃的作战房间</h3>
              <p className="text-xs text-neutral-400 max-w-sm mb-6 leading-relaxed">
                空中花园各战区暂无公开等待的对决。您可以点击上方【创建房间】发起新推演，或直接在上方输入对手给出的 Room ID 进入指定战局！
              </p>
              <button
                onClick={handleOpenCreateModal}
                className="px-5 py-2.5 rounded-xl bg-terminalCyan hover:bg-terminalCyan/90 text-neutral-950 font-bold text-xs font-mono flex items-center gap-2 shadow-[0_0_15px_rgba(0,240,255,0.25)] transition-all"
              >
                <Plus className="w-4 h-4" /> 立即创建对决房间
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {rooms.map((room) => {
                const isPlaying = room.status === RoomStatus.PLAYING;
                const isMyRoom = room.players?.some((p) => p.userId === currentUserId);

                return (
                  <div
                    key={room.roomId}
                    className="p-5 rounded-xl border border-terminalBorder bg-surface hover:border-terminalCyan/60 transition-all flex flex-col justify-between shadow-md"
                  >
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-terminalCyan/10 text-terminalCyan border border-terminalCyan/30">
                          ROOM ID: {room.roomId}
                        </span>
                        <div className="flex items-center gap-2">
                          {room.hasPassword && <Lock className="w-3.5 h-3.5 text-neutral-400" />}
                          <span
                            className={`text-xs px-2 py-0.5 rounded font-mono ${
                              room.status === RoomStatus.WAITING
                                ? 'bg-neutral-800 text-neutral-300'
                                : isPlaying
                                ? isMyRoom
                                  ? 'bg-terminalCyan/20 text-terminalCyan border border-terminalCyan/40 animate-pulse font-bold'
                                  : 'bg-red-900/30 text-erosionRed border border-erosionRed/40'
                                : 'bg-terminalGold/20 text-terminalGold'
                            }`}
                          >
                            {room.status === RoomStatus.WAITING
                              ? '等待中'
                              : isPlaying
                              ? isMyRoom
                                ? '对决中 (可重连)'
                                : '推演对决中'
                              : '准备就绪'}
                          </span>
                        </div>
                      </div>

                      <h3 className="text-base font-bold text-white mb-1 tracking-wide">{room.title}</h3>
                      <p className="text-xs text-neutral-500 font-mono">
                        创建者: {room.players[0]?.nickname || room.players[0]?.username || '指挥官'}
                      </p>
                    </div>

                    <div className="flex justify-between items-center mt-6 pt-3 border-t border-terminalBorder/60">
                      <div className="flex items-center gap-1.5 text-xs font-mono text-neutral-400">
                        <Users className="w-3.5 h-3.5" />
                        <span>{room.players.length} / 2 玩家</span>
                      </div>

                      {isPlaying ? (
                        isMyRoom ? (
                          <button
                            onClick={() =>
                              router.push(
                                room.currentGameId
                                  ? `/game/${room.currentGameId}`
                                  : `/rooms/${room.roomId}`
                              )
                            }
                            className="px-3.5 py-1.5 rounded-lg bg-terminalCyan hover:bg-terminalCyan/90 text-neutral-950 font-bold text-xs font-mono flex items-center gap-1 shadow animate-pulse"
                          >
                            <Zap className="w-3.5 h-3.5 fill-current" />
                            <span>重连对战</span>
                          </button>
                        ) : (
                          <span className="px-3 py-1 rounded bg-neutral-900 text-neutral-500 text-xs font-mono border border-neutral-800">
                            推演进行中
                          </span>
                        )
                      ) : (
                        <button
                          onClick={() => router.push(`/rooms/${room.roomId}`)}
                          className="px-3.5 py-1.5 rounded-lg bg-surface hover:bg-neutral-800 border border-terminalBorder hover:border-terminalCyan/50 text-white text-xs font-mono flex items-center gap-1 transition-all"
                        >
                          <span>进入房间</span>
                          <ArrowRight className="w-3.5 h-3.5 text-terminalCyan" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 创建房间弹窗 */}
      {isCreateOpen && (
        <div
          className="fixed inset-0 bg-neutral-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="创建战术作战房间"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setIsCreateOpen(false);
          }}
        >
          <form
            onSubmit={handleCreateRoom}
            className="max-w-md w-full p-6 rounded-2xl border border-terminalBorder bg-surface flex flex-col gap-4 shadow-2xl relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-terminalCyan" />

            <div className="flex justify-between items-center border-b border-terminalBorder pb-3">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Shield className="w-5 h-5 text-terminalCyan" /> 创建战术作战房间
              </h2>
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="text-neutral-500 hover:text-white"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>

            {/* 随机分配的 Room ID 提示 */}
            <div className="p-3 rounded-xl border border-terminalCyan/30 bg-terminalCyan/5 flex items-center justify-between text-xs font-mono">
              <span className="text-neutral-400">随机生成的 Room ID:</span>
              <span className="font-bold text-terminalCyan text-sm tracking-wider">
                {previewRoomId}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-mono text-neutral-300">房间名称 *</label>
              <input
                type="text"
                required
                value={newTitle}
                autoFocus
                maxLength={40}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="例如：灰鸦小队·战术演练房"
                className="w-full px-3.5 py-2.5 rounded-lg bg-neutral-950 border border-terminalBorder text-white text-sm focus:border-terminalCyan outline-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-mono text-neutral-300">房间密码 (可选)</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="留空即为公开对决房"
                className="w-full px-3.5 py-2.5 rounded-lg bg-neutral-950 border border-terminalBorder text-white text-sm focus:border-terminalCyan outline-none"
              />
            </div>

            <div className="flex justify-end gap-3 mt-3 pt-3 border-t border-terminalBorder/60">
              <button
                type="button"
                onClick={() => setIsCreateOpen(false)}
                className="px-4 py-2 rounded-lg border border-terminalBorder text-neutral-400 hover:text-white text-xs font-mono"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg bg-terminalCyan hover:bg-terminalCyan/90 text-neutral-950 font-bold text-xs font-mono shadow-[0_0_15px_rgba(0,240,255,0.25)] flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>确认建立战局</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
