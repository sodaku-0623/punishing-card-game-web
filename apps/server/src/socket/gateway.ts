import { Server, Socket } from 'socket.io';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  ErrorCode,
  GameAction,
  RoomStatus,
} from '@zhanshuang/shared';
import { RoomManager } from '../services/room-manager.js';
import { GameSessionManager } from '../services/game-session-manager.js';
import { MetricsService } from '../services/metrics-service.js';

/**
 * Socket 连接身份 (在握手阶段一次性确定，后续所有事件均以此为准，绝不信任事件负载中自报的 userId)
 */
export interface SocketIdentity {
  userId: string;
  username: string;
  /** 是否通过 JWT 登录凭据认证 (false 表示游客身份) */
  isAuthenticated: boolean;
}

export interface GatewayOptions {
  /** 校验握手携带的 JWT，返回登录用户身份；无效时返回 null */
  resolveToken?: (token: string) => Promise<{ userId: string; username: string } | null>;
  /** 判断某个 userId 是否属于已注册账号 (游客不得冒用注册账号的 ID) */
  isRegisteredUserId?: (userId: string) => Promise<boolean>;
}

const GUEST_ID_PATTERN = /^[A-Za-z0-9_\-.:]{1,64}$/;
const MAX_USERNAME_LENGTH = 32;

function sanitizeUsername(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim().slice(0, MAX_USERNAME_LENGTH);
  return trimmed || fallback;
}

function getSocketsInChannel(io: Server<any, any>, channel: string): Socket[] {
  const roomSet = io.sockets.adapter.rooms.get(channel);
  if (!roomSet) return [];
  const sockets: Socket[] = [];
  for (const sId of roomSet) {
    const s = io.sockets.sockets.get(sId);
    if (s) sockets.push(s as Socket);
  }
  return sockets;
}

export function setupSocketGateway(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  roomMgr: RoomManager,
  gameSessionMgr: GameSessionManager,
  options: GatewayOptions = {}
): void {
  // socketId -> { userId, username, roomId, gameId }
  const socketAuthMap = new Map<
    string,
    { userId: string; username: string; roomId?: string; gameId?: string }
  >();

  // 速率限制配置 (防刷与 DoS 攻击拦截)
  const userActionTimestamps = new Map<string, number[]>();
  const RATE_LIMIT_WINDOW_MS = 1000;
  const MAX_ACTIONS_PER_WINDOW = 15;

  function isRateLimited(userId: string): boolean {
    const now = Date.now();
    const timestamps = (userActionTimestamps.get(userId) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (timestamps.length >= MAX_ACTIONS_PER_WINDOW) {
      userActionTimestamps.set(userId, timestamps);
      return true;
    }
    timestamps.push(now);
    userActionTimestamps.set(userId, timestamps);
    return false;
  }

  /** 为对局频道内每名玩家分别推送脱敏后的公开状态 (12. 隐藏信息) */
  function broadcastGameState(gameId: string, fallbackUserId?: string): void {
    for (const s of getSocketsInChannel(io, `game:${gameId}`)) {
      const targetUserId = socketAuthMap.get(s.id)?.userId || fallbackUserId;
      if (!targetUserId) continue;
      const safeState = gameSessionMgr.getPublicGameState(gameId, targetUserId);
      if (!safeState) continue;
      s.emit('game:sync_state', safeState);
      MetricsService.getInstance().recordWebSocketMessage(JSON.stringify(safeState).length);
      if (safeState.currentPendingChoice) {
        s.emit('game:choice_required', safeState.currentPendingChoice);
      }
    }
  }

  /** 若对局已结束，广播结果并同步房间状态 */
  function emitGameEndedIfFinished(gameId: string): void {
    const session = gameSessionMgr.getSession(gameId);
    if (!session) return;
    const state = session.engine.getState();
    if (state.status !== 'FINISHED') return;
    io.to(`game:${gameId}`).emit('game:ended', {
      winnerId: state.winnerId,
      isDraw: state.isDraw,
      reason: state.finishReason ?? '游戏结束',
    });
    if (session.roomId) {
      const r = roomMgr.getRoom(session.roomId);
      if (r) {
        r.status = RoomStatus.FINISHED;
        io.to(`room:${session.roomId}`).emit('room:state_updated', r);
      }
    }
  }

  // 握手阶段确定连接身份：优先使用 JWT 登录凭据，否则作为游客接入
  io.use(async (socket, next) => {
    const fallbackGuestId = `guest_${socket.id.substring(0, 8)}`;
    try {
      const token = (socket.handshake.auth as any)?.token;
      if (typeof token === 'string' && token && options.resolveToken) {
        const resolved = await options.resolveToken(token);
        if (resolved) {
          socket.data.identity = {
            userId: resolved.userId,
            username: sanitizeUsername(resolved.username, resolved.userId),
            isAuthenticated: true,
          } satisfies SocketIdentity;
          return next();
        }
      }

      const rawUserId = socket.handshake.query.userId;
      let guestId = typeof rawUserId === 'string' && GUEST_ID_PATTERN.test(rawUserId) ? rawUserId : fallbackGuestId;
      // 游客不得冒用已注册账号的 userId (否则可读取其手牌等隐藏信息)
      if (guestId !== fallbackGuestId && options.isRegisteredUserId && (await options.isRegisteredUserId(guestId))) {
        guestId = fallbackGuestId;
      }
      socket.data.identity = {
        userId: guestId,
        username: sanitizeUsername(socket.handshake.query.username, `指挥官_${guestId.substring(0, 8)}`),
        isAuthenticated: false,
      } satisfies SocketIdentity;
      next();
    } catch {
      socket.data.identity = {
        userId: fallbackGuestId,
        username: `指挥官_${fallbackGuestId.substring(0, 8)}`,
        isAuthenticated: false,
      } satisfies SocketIdentity;
      next();
    }
  });

  io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    const identity = socket.data.identity as SocketIdentity;
    const userId = identity.userId;
    let username = identity.username;
    socketAuthMap.set(socket.id, { userId, username });

    function findJoinedRoomId(explicitRoomId?: string): string | undefined {
      return (
        explicitRoomId ||
        Array.from(socket.rooms).find((r) => r.startsWith('room:'))?.replace('room:', '')
      );
    }

    // ---------------------------------------------
    // 房间通信 (Room Events)
    // ---------------------------------------------
    socket.on('room:join', async ({ roomId, title, password, username: pUsername }) => {
      try {
        // 游客允许在加入时更新展示昵称；登录用户以账号昵称为准
        if (!identity.isAuthenticated) {
          username = sanitizeUsername(pUsername, username);
        }

        const existing = roomMgr.findRoomByIdOrCode(roomId);
        const targetRoomId = existing ? existing.roomId : roomId;

        const res = await roomMgr.joinRoom(targetRoomId, userId, username, title, password);
        if (!res.success || !res.data) {
          socket.emit('game:error', {
            code: res.errorCode ?? ErrorCode.ROOM_NOT_FOUND,
            message: res.errorMessage ?? '加入房间失败',
          });
          return;
        }

        socketAuthMap.set(socket.id, {
          userId,
          username,
          roomId: res.data.roomId,
        });

        await socket.join(`room:${res.data.roomId}`);
        io.to(`room:${res.data.roomId}`).emit('room:state_updated', res.data);
      } catch (err: any) {
        socket.emit('game:error', {
          code: ErrorCode.ROOM_NOT_FOUND,
          message: err.message || '加入房间异常',
        });
      }
    });

    socket.on('room:leave', async (payload) => {
      try {
        const targetRooms = payload?.roomId
          ? [`room:${payload.roomId}`]
          : Array.from(socket.rooms).filter((r) => r.startsWith('room:'));

        for (const roomName of targetRooms) {
          const rId = roomName.replace('room:', '');
          const res = await roomMgr.leaveRoom(rId, userId);
          socket.leave(roomName);

          const curAuth = socketAuthMap.get(socket.id);
          if (curAuth && curAuth.roomId === rId) {
            socketAuthMap.set(socket.id, { userId, username });
          }

          if (res.closed || !res.data || res.data.status === RoomStatus.CLOSED) {
            // 核心规则：房间内所有玩家均已退出，自动关闭房间
            io.to(roomName).emit('room:closed', {
              roomId: rId,
              reason: '房间内所有玩家均已离开，房间已自动关闭',
            });
            io.emit('room:deleted', { roomId: rId });
            const session = gameSessionMgr.getSessionByRoomId(rId);
            if (session) {
              gameSessionMgr.closeSession(session.gameId);
            }
          } else if (res.data) {
            io.to(roomName).emit('room:state_updated', res.data);
          }
        }
      } catch {}
    });

    socket.on('room:ready', async ({ roomId, isReady, deckId, customDeck }: any) => {
      try {
        const effectiveRoomId = findJoinedRoomId(roomId);
        if (!effectiveRoomId) {
          socket.emit('game:error', {
            code: ErrorCode.ROOM_NOT_FOUND,
            message: '未加入任何作战房间',
          });
          return;
        }

        const res = await roomMgr.setReady(effectiveRoomId, userId, isReady, deckId, customDeck);
        if (!res.success || !res.data) {
          socket.emit('game:error', {
            code: res.errorCode ?? ErrorCode.INVALID_DECK,
            message: res.errorMessage ?? '准备失败',
          });
          return;
        }

        await socket.join(`room:${effectiveRoomId}`);
        io.to(`room:${effectiveRoomId}`).emit('room:state_updated', res.data);
      } catch (err: any) {
        socket.emit('game:error', {
          code: ErrorCode.INVALID_ACTION,
          message: err.message || '准备操作异常',
        });
      }
    });

    socket.on('room:select_deck', async ({ roomId, deckId, customDeck }: any) => {
      try {
        const effectiveRoomId = findJoinedRoomId(roomId);
        if (!effectiveRoomId) return;

        const res = await roomMgr.setPlayerDeck(effectiveRoomId, userId, deckId, customDeck);
        if (res.success && res.data) {
          await socket.join(`room:${effectiveRoomId}`);
          io.to(`room:${effectiveRoomId}`).emit('room:state_updated', res.data);
        } else if (res.errorMessage) {
          socket.emit('game:error', {
            code: res.errorCode ?? ErrorCode.INVALID_DECK,
            message: res.errorMessage,
          });
        }
      } catch {}
    });

    socket.on('room:start', async (payload) => {
      try {
        const effectiveRoomId = findJoinedRoomId(payload?.roomId);
        if (!effectiveRoomId) return;
        const room = roomMgr.getRoom(effectiveRoomId);
        if (!room || !room.players.some((p) => p.userId === userId)) {
          socket.emit('game:error', {
            code: ErrorCode.UNAUTHORIZED,
            message: '非房间内玩家，无法开局',
          });
          return;
        }
        if (room.status === RoomStatus.PLAYING) return; // 防止重复点击导致重复开局
        if (room.players.length !== 2 || !room.players.every((p) => p.isReady)) {
          socket.emit('game:error', {
            code: ErrorCode.ROOM_NOT_READY,
            message: '双方玩家均需准备就绪后方可开局',
          });
          return;
        }

        const p1 = room.players[0]!;
        const p2 = room.players[1]!;

        const session = await gameSessionMgr.startGameSession(
          effectiveRoomId,
          p1.userId,
          p1.deckId!,
          p2.userId,
          p2.deckId!
        );

        room.status = RoomStatus.PLAYING;
        room.currentGameId = session.gameId;
        const roomChannel = `room:${effectiveRoomId}`;
        io.to(roomChannel).emit('room:state_updated', room);

        // 将双方 socket 加入专属 game 频道
        for (const s of getSocketsInChannel(io, roomChannel)) {
          // 清理之前残留的旧 game 频道订阅，彻底杜绝多局频道串流
          for (const r of s.rooms) {
            if (r.startsWith('game:') && r !== `game:${session.gameId}`) {
              s.leave(r);
            }
          }
          s.join(`game:${session.gameId}`);
          const sAuth = socketAuthMap.get(s.id);
          if (sAuth) {
            socketAuthMap.set(s.id, {
              ...sAuth,
              roomId: effectiveRoomId,
              gameId: session.gameId,
            });
          }
        }
        broadcastGameState(session.gameId);
      } catch (err: any) {
        socket.emit('game:error', {
          code: ErrorCode.INVALID_ACTION,
          message: err.message || '开局失败',
        });
      }
    });

    // ---------------------------------------------
    // 对局核心交互 (Authoritative Game Actions)
    // ---------------------------------------------
    socket.on('game:action', async ({ gameId, action }) => {
      try {
        const actionStart = Date.now();
        // 1. 防刷与 DoS 速率限制 (Rate Limiting: 1秒内最多15次操作)
        if (isRateLimited(userId)) {
          socket.emit('game:error', {
            code: ErrorCode.RATE_LIMIT_EXCEEDED,
            message: '操作提交过于频繁，防作弊系统已限流拦截',
          });
          return;
        }

        // 2. 身份防冒充安全检测 (Anti-Impersonation Protection)
        // 若请求显式伪造了 playerId 且与认证 userId 不一致，直接拦截并返回 UNAUTHORIZED
        if (action?.playerId && action.playerId !== userId) {
          socket.emit('game:error', {
            code: ErrorCode.UNAUTHORIZED,
            message: '检测到冒名伪造攻击：操作发起者与认证身份不符',
          });
          return;
        }

        // 3. 仅允许本局玩家提交操作 (旁观者或无关连接不得投降、出牌)
        const session = gameSessionMgr.getSession(gameId);
        if (!session) {
          socket.emit('game:error', { code: ErrorCode.GAME_NOT_FOUND, message: '对局会话已结束或不存在' });
          return;
        }
        if (!session.playerIds.includes(userId)) {
          socket.emit('game:error', { code: ErrorCode.UNAUTHORIZED, message: '非当前对局玩家，无法提交操作' });
          return;
        }

        // 强制以当前 Socket 认证的 userId 作为行动执行者 (Security Guard)
        const secureAction: GameAction = {
          ...action,
          playerId: userId,
        } as GameAction;

        const result = await gameSessionMgr.processAction(gameId, secureAction);
        MetricsService.getInstance().recordActionLatency(Date.now() - actionStart);

        if (!result.success) {
          socket.emit('game:error', {
            code: result.error?.code ?? ErrorCode.ACTION_NOT_ALLOWED,
            message: result.error?.message ?? '行动非法',
          });
          return;
        }

        // 向对局频道广播增量事件 (驱动前端动画 28. 游戏动画)
        if (result.events.length > 0) {
          io.to(`game:${gameId}`).emit('game:events', result.events);
        }
        broadcastGameState(gameId);
        emitGameEndedIfFinished(gameId);
      } catch (err: any) {
        socket.emit('game:error', {
          code: ErrorCode.INVALID_ACTION,
          message: err?.message || '行动处理异常',
        });
      }
    });

    // ---------------------------------------------
    // 玩家提交决策 (Choice Selection)
    // ---------------------------------------------
    socket.on('game:choice', async ({ gameId, pendingChoiceId, selectedIds }) => {
      try {
        if (isRateLimited(userId)) {
          socket.emit('game:error', {
            code: ErrorCode.RATE_LIMIT_EXCEEDED,
            message: '操作提交过于频繁，防作弊系统已限流拦截',
          });
          return;
        }
        const session = gameSessionMgr.getSession(gameId);
        if (!session || !session.playerIds.includes(userId)) {
          socket.emit('game:error', {
            code: session ? ErrorCode.UNAUTHORIZED : ErrorCode.GAME_NOT_FOUND,
            message: session ? '非当前对局玩家，无法提交决策' : '对局会话已结束或不存在',
          });
          return;
        }

        const result = await gameSessionMgr.processAction(gameId, {
          type: 'SELECT_CHOICE_OPTION',
          playerId: userId,
          pendingChoiceId,
          selectedIds: Array.isArray(selectedIds) ? selectedIds : [],
        });
        if (!result.success) {
          socket.emit('game:error', {
            code: result.error?.code ?? ErrorCode.ACTION_NOT_ALLOWED,
            message: result.error?.message ?? '决策提交失败',
          });
          return;
        }

        if (result.events.length > 0) {
          io.to(`game:${gameId}`).emit('game:events', result.events);
        }
        broadcastGameState(gameId);
        // 检查决策结算后是否触发对局结束
        emitGameEndedIfFinished(gameId);
      } catch (err: any) {
        socket.emit('game:error', {
          code: ErrorCode.INVALID_ACTION,
          message: err.message || '决策异常',
        });
      }
    });

    // ---------------------------------------------
    // 22. 断线重连 (Reconnection Flow)
    // ---------------------------------------------
    socket.on('game:reconnect', async (payload: { gameId: string }) => {
      try {
        const targetGameId = payload?.gameId;
        if (!targetGameId) return;

        const session = gameSessionMgr.getSession(targetGameId);
        if (!session) {
          socket.emit('game:error', {
            code: ErrorCode.GAME_NOT_FOUND,
            message: '对局会话已结束或不存在',
          });
          return;
        }

        if (!session.playerIds.includes(userId)) {
          socket.emit('game:error', {
            code: ErrorCode.UNAUTHORIZED,
            message: '非当前对局玩家，无法重连接入',
          });
          return;
        }

        // 重新绑定对局频道
        await socket.join(`game:${targetGameId}`);
        socketAuthMap.set(socket.id, {
          userId,
          username,
          roomId: session.roomId,
          gameId: targetGameId,
        });

        // 恢复关联房间中的玩家在线态
        if (session.roomId) {
          roomMgr.markPlayerOnline(session.roomId, userId, true);
          const room = roomMgr.getRoom(session.roomId);
          if (room) {
            io.to(`room:${session.roomId}`).emit('room:state_updated', room);
          }
        }

        // 广播给对手与对局频道：玩家已重连
        io.to(`game:${targetGameId}`).emit('game:events', [
          {
            type: 'PLAYER_RECONNECTED',
            playerId: userId,
            message: '指挥官已重新接入作战终端，对局继续！',
          },
        ]);
        io.to(`game:${targetGameId}`).emit('game:player_reconnected', {
          userId,
          message: '对手已重新连入对局，对决继续！',
        });

        MetricsService.getInstance().recordReconnect();
        // 同步最新状态给所有对战玩家 (消除等待遮罩)
        broadcastGameState(targetGameId, userId);
      } catch (err: any) {
        socket.emit('game:error', {
          code: ErrorCode.INVALID_ACTION,
          message: err?.message || '重连异常',
        });
      }
    });

    // ---------------------------------------------
    // 玩家主动退出对局或返回大厅 (Game Leave)
    // ---------------------------------------------
    socket.on('game:leave', async (payload) => {
      try {
        const targetGameId = payload?.gameId;
        if (!targetGameId) return;

        const session = gameSessionMgr.getSession(targetGameId);
        if (!session) return;
        socket.leave(`game:${targetGameId}`);
        if (!session.playerIds.includes(userId)) return;

        const engineState = session.engine.getState();
        // 仅在明确传入 isSurrender 时，才判定为投降认输
        if (payload?.isSurrender && engineState.status === 'PLAYING') {
          await gameSessionMgr.processAction(targetGameId, {
            type: 'SURRENDER',
            playerId: userId,
          });
          emitGameEndedIfFinished(targetGameId);
        }

        // 同步从关联房间中更新玩家在线态/离开
        const rId = session.roomId;
        const res = await roomMgr.leaveRoom(rId, userId);
        socket.leave(`room:${rId}`);
        socketAuthMap.set(socket.id, { userId, username });

        if (res.closed || !res.data || res.data.status === RoomStatus.CLOSED) {
          // 双方均已离场，自动彻底关闭房间与对局
          io.to(`room:${rId}`).emit('room:closed', {
            roomId: rId,
            reason: '双方玩家均已离开对局，房间已自动关闭',
          });
          io.emit('room:deleted', { roomId: rId });
          gameSessionMgr.closeSession(targetGameId);
        } else if (res.data) {
          io.to(`room:${rId}`).emit('room:state_updated', res.data);
          // 仅在对局仍在进行中 (PLAYING) 且未结束时，才通知对手该玩家暂时离开，房间保留等待其重连
          if (res.data.status === RoomStatus.PLAYING && session.engine.getState().status === 'PLAYING') {
            io.to(`game:${targetGameId}`).emit('game:player_disconnected', {
              userId,
              message: '对手暂时离开对局（房间已保留），等待对手重新进入...',
            });
            io.to(`game:${targetGameId}`).emit('game:events', [
              {
                type: 'PLAYER_DISCONNECTED',
                playerId: userId,
                message: '对手暂时离开对局，对战未关闭，等待其重连',
              },
            ]);
          }
        }
      } catch {}
    });

    socket.on('disconnect', async () => {
      const auth = socketAuthMap.get(socket.id);
      const dcUserId = userId;
      const targetRoomId = auth?.roomId;
      socketAuthMap.delete(socket.id);
      const hasOtherConnection = () =>
        Array.from(socketAuthMap.values()).some((a) => a.userId === dcUserId);
      if (!hasOtherConnection()) {
        userActionTimestamps.delete(dcUserId);
      }

      try {
        // 1. 优先检查是否处于对战进行中 (PLAYING)
        const room = targetRoomId ? roomMgr.getRoom(targetRoomId) : roomMgr.getRoomByUserId(dcUserId);
        if (room && room.status === RoomStatus.PLAYING) {
          // 同一账号仍有其它在线连接 (如多标签页)，不视为掉线
          if (hasOtherConnection()) return;
          // 核心规则：对战进行中，掉线或失去连接绝不关闭房间，立即标为离线并通知在场玩家等待重连！
          roomMgr.markPlayerOnline(room.roomId, dcUserId, false);
          const onlinePlayers = room.players.filter((p) => p.isOnline);
          if (onlinePlayers.length === 0) {
            // 双方均已断开离开，给予 2.5 秒重连缓冲，避免页面路由切换或刷新瞬断导致直接关房杀局
            setTimeout(async () => {
              try {
                const currentRoom = roomMgr.getRoom(room.roomId);
                if (!currentRoom || currentRoom.status !== RoomStatus.PLAYING) return;
                const currentOnline = currentRoom.players.filter((p) => p.isOnline);
                if (currentOnline.length === 0) {
                  await roomMgr.closeRoom(room.roomId);
                  if (room.currentGameId) {
                    gameSessionMgr.closeSession(room.currentGameId);
                  }
                  io.to(`room:${room.roomId}`).emit('room:closed', {
                    roomId: room.roomId,
                    reason: '双方玩家均已断开离开，房间已自动关闭',
                  });
                  io.emit('room:deleted', { roomId: room.roomId });
                }
              } catch {}
            }, 2500);
          } else {
            // 仍有玩家在线守候：通知对手掉线，对战房间保留
            if (room.currentGameId) {
              io.to(`game:${room.currentGameId}`).emit('game:player_disconnected', {
                userId: dcUserId,
                message: '对手暂时掉线或失去连接，对战房间已保留，等待对手重新接入...',
              });
              io.to(`game:${room.currentGameId}`).emit('game:events', [
                {
                  type: 'PLAYER_DISCONNECTED',
                  playerId: dcUserId,
                  message: '对手暂时失去连接，对战未关闭，正在等待其重连',
                },
              ]);
            }
            io.to(`room:${room.roomId}`).emit('room:state_updated', room);
          }
          return;
        }

        // 1.5 若处于已完赛状态 (FINISHED)，正常执行离房清理
        if (room && room.status === RoomStatus.FINISHED) {
          if (hasOtherConnection()) return;
          const res = await roomMgr.leaveRoom(room.roomId, dcUserId);
          if (res.closed || !res.data || res.data.status === RoomStatus.CLOSED) {
            io.to(`room:${room.roomId}`).emit('room:closed', {
              roomId: room.roomId,
              reason: '双方玩家均已离开对局，房间已自动关闭',
            });
            io.emit('room:deleted', { roomId: room.roomId });
            if (room.currentGameId) {
              gameSessionMgr.closeSession(room.currentGameId);
            }
          }
          return;
        }
      } catch {}

      // 2. 若处于等待阶段 (WAITING / READY)，预留 1.5 秒重连与页面刷新缓冲窗口
      setTimeout(async () => {
        try {
          if (hasOtherConnection()) return;

          const waitingRoom = roomMgr.getRoomByUserId(dcUserId);
          if (
            waitingRoom &&
            (waitingRoom.status === RoomStatus.WAITING || waitingRoom.status === RoomStatus.READY)
          ) {
            const res = await roomMgr.leaveRoom(waitingRoom.roomId, dcUserId);
            if (res.closed || !res.data || res.data.status === RoomStatus.CLOSED) {
              io.to(`room:${waitingRoom.roomId}`).emit('room:closed', {
                roomId: waitingRoom.roomId,
                reason: '所有玩家已离开，房间已自动关闭',
              });
              io.emit('room:deleted', { roomId: waitingRoom.roomId });
            } else if (res.data) {
              io.to(`room:${waitingRoom.roomId}`).emit('room:state_updated', res.data);
            }
          }
        } catch {}
      }, 1500);
    });
  });
}
