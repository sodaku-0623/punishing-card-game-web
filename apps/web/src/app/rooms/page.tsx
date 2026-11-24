'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Swords,
  Plus,
  Users,
  ArrowRight,
  Lock,
  RefreshCw,
  Search,
  Hash,
  Zap,
  AlertCircle,
} from 'lucide-react';
import { PublicRoomState, RoomStatus } from '@zhanshuang/shared';
import { useAuth } from '@/lib/auth-context';
import { apiUrl } from '@/lib/api';
import { getSocket, getSocketUserId } from '@/lib/socket';
import { stashPendingRoomPassword } from '@/lib/room-password';
import { useGameStore } from '@/stores/game-store';
import {
  AppShell,
  Button,
  Badge,
  Input,
  Panel,
  SectionHeader,
  Dialog,
  HudBrackets,
  HudRule,
} from '@/components/ui';

export default function RoomsLobbyPage() {
  const router = useRouter();
  const { user, isLoading: authLoading = false } = useAuth();

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
                (r.players?.length ?? 0) > 0,
            ),
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

  // 当前浏览器的真实身份 (登录用户 ID 或服务端签发的本机唯一游客 ID)
  const [currentUserId, setCurrentUserId] = useState<string>('');
  useEffect(() => {
    if (authLoading) return;
    setCurrentUserId(user?.id || getSocketUserId());
  }, [user, authLoading]);

  useEffect(() => {
    fetchRooms();
    if (authLoading) return;
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
          }
          return [updatedRoom, ...prev];
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
  }, [user, authLoading]);

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

  const waitingCount = rooms.filter((r) => r.status === RoomStatus.WAITING).length;
  const playingCount = rooms.filter((r) => r.status === RoomStatus.PLAYING).length;
  const myActiveRoom = rooms.find(
    (r) => r.status === RoomStatus.PLAYING && r.players?.some((p) => p.userId === currentUserId),
  );

  return (
    <AppShell className="space-y-8">
      {/* 页头 */}
      <SectionHeader
        code="SECTOR 01"
        pageLabel={`${String(rooms.length).padStart(2, '0')} ACTIVE`}
        title="作战终端大厅"
        subtitle="MULTIPLAYER BATTLE LOBBY"
        action={
          <>
            <Button
              variant="icon"
              size="lg"
              aria-label="刷新房间列表"
              title="刷新房间列表"
              onClick={() => {
                setLoading(true);
                fetchRooms().finally(() => setLoading(false));
              }}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-teal-400' : ''}`} />
            </Button>
            <Button variant="primary" size="lg" onClick={handleOpenCreateModal}>
              <Plus className="w-4 h-4" />
              <span>创建作战房间</span>
            </Button>
          </>
        }
      />

      {/* 正在进行中的对局一键重连通报栏 */}
      {myActiveRoom && (
        <div className="relative border border-teal-400 bg-ink-850 p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pgr-enter">
          <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-1 bg-teal-400" />
          <div className="flex items-start gap-3.5 pl-2">
            <div className="h-10 w-10 border border-teal-400/50 bg-teal-400/10 flex items-center justify-center text-teal-400 shrink-0">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-title-sm font-semibold text-fg">
                  检测到进行中的推演对决
                </span>
                <Badge variant="teal" className="font-num">
                  ROOM #{myActiveRoom.roomId}
                </Badge>
              </div>
              <p className="text-body-sm text-fg-secondary mt-1">
                对战会话已为您保留，另一名指挥官正在战局中等待您重新接入。
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="md"
            className="border-teal-400 text-teal-400 hover:bg-teal-400/10 shrink-0"
            onClick={() =>
              router.push(
                myActiveRoom.currentGameId
                  ? `/game/${myActiveRoom.currentGameId}`
                  : `/rooms/${myActiveRoom.roomId}`,
              )
            }
          >
            <Zap className="w-4 h-4" />
            <span>立即重连战局</span>
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* 定向联机条 + 实时大厅统计 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pgr-enter">
        <Panel className="lg:col-span-8" brackets>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 border border-line bg-ink-900 flex items-center justify-center text-gold-300 shrink-0">
                <Hash className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-title-sm font-semibold text-fg">定向接入作战房间</h2>
                  <Badge variant="gold">直连代码</Badge>
                </div>
                <p className="text-caption text-fg-muted mt-0.5">
                  输入对手提供的 6 位 Room ID 或房间代码直接进入
                </p>
              </div>
            </div>

            <form
              onSubmit={handleJoinByRoomId}
              className="flex items-start gap-2 flex-1 max-w-md"
            >
              <Input
                value={targetRoomId}
                onChange={(e) => {
                  setTargetRoomId(e.target.value);
                  setJoinError(null);
                }}
                placeholder="输入 6 位 Room ID（如 739102）"
                aria-label="房间 ID 或房间代码"
                leftSlot={<Search className="w-4 h-4" />}
                className="font-num"
              />
              <Button type="submit" variant="secondary" size="md" className="shrink-0">
                <span>接入</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </form>
          </div>
          {joinError && (
            <div
              role="alert"
              className="mt-3 flex items-center gap-2 text-caption text-crimson-400"
            >
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{joinError}</span>
            </div>
          )}
        </Panel>

        <div className="lg:col-span-4 grid grid-cols-3 gap-2 border border-line bg-ink-850 p-4">
          <div className="border-r border-line pr-2 flex flex-col justify-center">
            <span className="font-num tabular-nums text-title font-bold text-fg">
              {rooms.length}
            </span>
            <span className="text-caption text-fg-muted mt-0.5">活跃房间</span>
          </div>
          <div className="border-r border-line px-2 flex flex-col justify-center">
            <span className="font-num tabular-nums text-title font-bold text-teal-400">
              {waitingCount}
            </span>
            <span className="text-caption text-fg-muted mt-0.5">等待加入</span>
          </div>
          <div className="pl-2 flex flex-col justify-center">
            <span className="font-num tabular-nums text-title font-bold text-crimson-400">
              {playingCount}
            </span>
            <span className="text-caption text-fg-muted mt-0.5">激战中</span>
          </div>
        </div>
      </div>

      {/* 活跃房间列表 */}
      <section className="space-y-4 pgr-enter pgr-delay-1">
        <HudRule code={`ACTIVE CHANNELS // ${String(rooms.length).padStart(2, '0')}`} />

        {rooms.length === 0 ? (
          <div className="border border-dashed border-line-strong bg-ink-900/60 py-16 px-6 flex flex-col items-center text-center">
            <div className="h-12 w-12 border border-line bg-ink-850 flex items-center justify-center text-fg-muted mb-4">
              <Swords className="w-6 h-6" />
            </div>
            <h3 className="text-title-sm font-semibold text-fg mb-1.5">
              当前暂无活跃的作战房间
            </h3>
            <p className="text-body-sm text-fg-secondary max-w-md mb-6 leading-relaxed">
              空中花园各战区暂无公开等待的对决。您可以点击下方按钮发起新推演，或在上方输入对手给出的 Room ID 定向接入。
            </p>
            <Button variant="secondary" size="md" onClick={handleOpenCreateModal}>
              <Plus className="w-4 h-4" />
              <span>立即创建对决房间</span>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rooms.map((room) => {
              const isPlaying = room.status === RoomStatus.PLAYING;
              const isMyRoom = room.players?.some((p) => p.userId === currentUserId);
              const isWaiting = room.status === RoomStatus.WAITING;

              return (
                <div
                  key={room.roomId}
                  className="group relative border border-line bg-ink-850 p-5 flex flex-col justify-between transition-colors duration-fast ease-enter hover:bg-ink-800 hover:border-line-strong"
                >
                  <HudBrackets color="steel" interactive />
                  <span
                    aria-hidden="true"
                    className={`absolute left-0 top-0 bottom-0 w-0.5 ${
                      isPlaying
                        ? isMyRoom
                          ? 'bg-teal-400'
                          : 'bg-crimson-500'
                        : isWaiting
                          ? 'bg-teal-400'
                          : 'bg-gold-300'
                    }`}
                  />

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-num tabular-nums text-caption text-fg-muted border border-line bg-ink-900 px-2 py-0.5">
                        ID #{room.roomId}
                      </span>
                      <div className="flex items-center gap-2">
                        {room.hasPassword && (
                          <Lock
                            className="w-3.5 h-3.5 text-gold-300"
                            aria-label="已加密房间"
                          />
                        )}
                        <Badge
                          variant={
                            isPlaying
                              ? isMyRoom
                                ? 'teal'
                                : 'crimson'
                              : isWaiting
                                ? 'neutral'
                                : 'gold'
                          }
                        >
                          {isWaiting
                            ? '等待中'
                            : isPlaying
                              ? isMyRoom
                                ? '对决中 · 可重连'
                                : '推演中'
                              : '已就绪'}
                        </Badge>
                      </div>
                    </div>

                    <div>
                      <h3 className="text-title-sm font-semibold text-fg truncate">
                        {room.title}
                      </h3>
                      <p className="text-caption text-fg-muted mt-1">
                        房主：{room.players[0]?.nickname || room.players[0]?.username || '指挥官'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 pt-3 border-t border-line flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-caption text-fg-secondary font-num tabular-nums">
                      <Users className="w-3.5 h-3.5 text-fg-muted" />
                      <span>{room.players.length} / 2</span>
                    </div>

                    {isPlaying ? (
                      isMyRoom ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="border-teal-400 text-teal-400 hover:bg-teal-400/10"
                          onClick={() =>
                            router.push(
                              room.currentGameId
                                ? `/game/${room.currentGameId}`
                                : `/rooms/${room.roomId}`,
                            )
                          }
                        >
                          <Zap className="w-3.5 h-3.5" />
                          <span>重连对战</span>
                        </Button>
                      ) : (
                        <span className="text-caption text-fg-disabled">推演进行中</span>
                      )
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => router.push(`/rooms/${room.roomId}`)}
                      >
                        <span>进入房间</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 创建房间模态框 */}
      <Dialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="创建战术作战房间"
        subtitle="CREATE BATTLE CHANNEL"
        size="md"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setIsCreateOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              form="create-room-form"
            >
              <span>确认建立战局</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </>
        }
      >
        <form id="create-room-form" onSubmit={handleCreateRoom} className="space-y-4">
          <div className="border border-line bg-ink-950 px-3.5 py-2.5 flex items-center justify-between">
            <span className="text-caption text-fg-muted">预分配房间编号</span>
            <span className="font-num tabular-nums text-title-sm font-bold text-teal-400 tracking-wider">
              #{previewRoomId}
            </span>
          </div>

          <Input
            label="房间名称 *"
            required
            autoFocus
            maxLength={40}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="例如：灰鸦小队·战术演练房"
          />

          <Input
            label="房间密码（选填）"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="留空即为公开对决房"
            hint="密码仅以摘要形式保存在服务端，不会出现在链接中。"
          />
        </form>
      </Dialog>
    </AppShell>
  );
}
