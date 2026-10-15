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
  gameSessionMgr: GameSessionManager
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

  io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    // 简易身份绑定 (可通过 handshake query 或 token 注入)
    const userId = (socket.handshake.query.userId as string) || `guest_${socket.id.substring(0, 5)}`;
    const username = (socket.handshake.query.username as string) || `指挥官_${userId}`;
    socketAuthMap.set(socket.id, { userId, username });

    // ---------------------------------------------
    // 房间通信 (Room Events)
    // ---------------------------------------------
    socket.on('room:join', async ({ roomId, title, password, userId: pUserId, username: pUsername }) => {
      try {
        const effectiveUserId = pUserId || userId;
        const effectiveUsername = pUsername || username;

        const existing = roomMgr.findRoomByIdOrCode(roomId);
        const targetRoomId = existing ? existing.roomId : roomId;

        const res = await roomMgr.joinRoom(targetRoomId, effectiveUserId, effectiveUsername, title, password);
        if (!res.success || !res.data) {
          socket.emit('game:error', {
            code: res.errorCode ?? ErrorCode.ROOM_NOT_FOUND,
            message: res.errorMessage ?? '加入房间失败',
          });
          return;
        }

        socketAuthMap.set(socket.id, {
          userId: effectiveUserId,
          username: effectiveUsername,
          roomId: res.data.roomId,
        });

        await socket.join(`room:${res.data.roomId}`);
        io.to(`room:${res.data.roomId}`).emit('room:state_updated', res.data);
        socket.emit('room:state_updated', res.data);
      } catch (err: any) {
        socket.emit('game:error', {
          code: ErrorCode.ROOM_NOT_FOUND,
          message: err.message || '加入房间异常',
        });
      }
    });

    socket.on('room:leave', async (payload) => {
      try {
        const auth = socketAuthMap.get(socket.id);
        const opUserId = auth?.userId || userId;
        const targetRooms = payload?.roomId
          ? [`room:${payload.roomId}`]
          : Array.from(socket.rooms).filter((r) => r.startsWith('room:'));

        for (const roomName of targetRooms) {
          const rId = roomName.replace('room:', '');
          const res = await roomMgr.leaveRoom(rId, opUserId);
          socket.leave(roomName);

          const curAuth = socketAuthMap.get(socket.id);
          if (curAuth && curAuth.roomId === rId) {
            socketAuthMap.set(socket.id, {
              userId: curAuth.userId,
              username: curAuth.username,
            });
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
        const effectiveRoomId =
          roomId || Array.from(socket.rooms).find((r) => r.startsWith('room:'))?.replace('room:', '');

        if (!effectiveRoomId) {
          socket.emit('game:error', {
            code: ErrorCode.ROOM_NOT_FOUND,
            message: '未加入任何作战房间',
          });
          return;
        }

        await socket.join(`room:${effectiveRoomId}`);
        const auth = socketAuthMap.get(socket.id);
        const opUserId = auth?.userId || userId;

        const res = await roomMgr.setReady(effectiveRoomId, opUserId, isReady, deckId, customDeck);
        if (!res.success || !res.data) {
          socket.emit('game:error', {
            code: res.errorCode ?? ErrorCode.INVALID_DECK,
            message: res.errorMessage ?? '准备失败',
          });
          return;
        }

        io.to(`room:${effectiveRoomId}`).emit('room:state_updated', res.data);
        socket.emit('room:state_updated', res.data);
      } catch (err: any) {
        socket.emit('game:error', {
          code: ErrorCode.INVALID_ACTION,
          message: err.message || '准备操作异常',
        });
      }
    });

    socket.on('room:select_deck', async ({ roomId, deckId, customDeck }: any) => {
      try {
        const effectiveRoomId =
          roomId || Array.from(socket.rooms).find((r) => r.startsWith('room:'))?.replace('room:', '');

        if (!effectiveRoomId) return;
        await socket.join(`room:${effectiveRoomId}`);
        const auth = socketAuthMap.get(socket.id);
        const opUserId = auth?.userId || userId;

        const res = await roomMgr.setPlayerDeck(effectiveRoomId, opUserId, deckId, customDeck);
        if (res.success && res.data) {
          io.to(`room:${effectiveRoomId}`).emit('room:state_updated', res.data);
          socket.emit('room:state_updated', res.data);
        }
      } catch {}
    });

    socket.on('room:start', async (payload) => {
      try {
        const effectiveRoomId =
          payload?.roomId || Array.from(socket.rooms).find((r) => r.startsWith('room:'))?.replace('room:', '');

        if (!effectiveRoomId) return;
        const room = roomMgr.getRoom(effectiveRoomId);
        if (!room || room.players.length !== 2 || !room.players.every((p) => p.isReady)) {
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
        const socketsInRoom = getSocketsInChannel(io, roomChannel);
        for (const s of socketsInRoom) {
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
            const safeState = gameSessionMgr.getPublicGameState(session.gameId, sAuth.userId);
            if (safeState) {
              s.emit('game:sync_state', safeState);
            }
          }
        }
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
      const actionStart = Date.now();
      // 1. 防刷与 DoS 速率限制 (Rate Limiting: 1秒内最多15次操作)
      const now = Date.now();
      let timestamps = userActionTimestamps.get(userId) || [];
      timestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (timestamps.length >= MAX_ACTIONS_PER_WINDOW) {
        socket.emit('game:error', {
          code: ErrorCode.RATE_LIMIT_EXCEEDED,
          message: '操作提交过于频繁，防作弊系统已限流拦截',
        });
        return;
      }
      timestamps.push(now);
      userActionTimestamps.set(userId, timestamps);

      // 2. 身份防冒充安全检测 (Anti-Impersonation Protection)
      // 若请求显式伪造了 playerId 且与认证 userId 不一致，直接拦截并返回 UNAUTHORIZED
      if (action.playerId && action.playerId !== userId) {
        socket.emit('game:error', {
          code: ErrorCode.UNAUTHORIZED,
          message: '检测到冒名伪造攻击：操作发起者与认证身份不符',
        });
        return;
      }

      // 强制以当前 Socket 认证的 userId 作为行动执行者 (Security Guard)
      const secureAction: GameAction = {
        ...action,
        playerId: userId,
      } as GameAction;

      const result = await gameSessionMgr.processAction(gameId, secureAction);
      const actionDuration = Date.now() - actionStart;
      MetricsService.getInstance().recordActionLatency(actionDuration);

      if (!result.success) {
        socket.emit('game:error', {
          code: result.error?.code ?? ErrorCode.ACTION_NOT_ALLOWED,
          message: result.error?.message ?? '行动非法',
        });
        return;
      }

      // 1. 向对局频道广播增量事件 (驱动前端动画 28. 游戏动画)
      if (result.events.length > 0) {
        io.to(`game:${gameId}`).emit('game:events', result.events);
      }

      // 2. 分别为双方推送脱敏后的公开状态 (12. 隐藏信息)
      const socketsInGame = getSocketsInChannel(io, `game:${gameId}`);
      for (const s of socketsInGame) {
        const sAuth = socketAuthMap.get(s.id);
        if (sAuth) {
          const safeState = gameSessionMgr.getPublicGameState(gameId, sAuth.userId);
          if (safeState) {
            s.emit('game:sync_state', safeState);
            MetricsService.getInstance().recordWebSocketMessage(JSON.stringify(safeState).length);
            if (safeState.currentPendingChoice) {
              s.emit('game:choice_required', safeState.currentPendingChoice);
            }
          }
        }
      }

      // 3. 检查是否有胜负结果
      const session = gameSessionMgr.getSession(gameId);
      if (session) {
        const state = session.engine.getState();
        if (state.status === 'FINISHED') {
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
      }
    });

    // ---------------------------------------------
    // 玩家提交决策 (Choice Selection)
    // ---------------------------------------------
    socket.on('game:choice', async ({ gameId, pendingChoiceId, selectedIds }) => {
      try {
        const auth = socketAuthMap.get(socket.id);
        const opUserId = auth?.userId || userId;
        const action: GameAction = {
          type: 'SELECT_CHOICE_OPTION',
          playerId: opUserId,
          pendingChoiceId,
          selectedIds,
        };
        const result = await gameSessionMgr.processAction(gameId, action);
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

        const socketsInGame = getSocketsInChannel(io, `game:${gameId}`);
        for (const s of socketsInGame) {
          const sAuth = socketAuthMap.get(s.id);
          if (sAuth) {
            const safeState = gameSessionMgr.getPublicGameState(gameId, sAuth.userId);
            if (safeState) {
              s.emit('game:sync_state', safeState);
              MetricsService.getInstance().recordWebSocketMessage(JSON.stringify(safeState).length);
              if (safeState.currentPendingChoice) {
                s.emit('game:choice_required', safeState.currentPendingChoice);
              }
            }
          }
        }

        // 检查决策结算后是否触发对局结束
        const session = gameSessionMgr.getSession(gameId);
        if (session) {
          const state = session.engine.getState();
          if (state.status === 'FINISHED') {
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
        }
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
    socket.on('game:reconnect', async (payload: { gameId: string; userId?: string }) => {
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

      const existingAuth = socketAuthMap.get(socket.id);
      const effectiveUserId = payload?.userId || existingAuth?.userId || userId;
      if (!session.playerIds.includes(effectiveUserId)) {
        socket.emit('game:error', {
          code: ErrorCode.UNAUTHORIZED,
          message: '非当前对局玩家，无法重连接入',
        });
        return;
      }

      // 重新绑定对局频道
      await socket.join(`game:${targetGameId}`);
      socketAuthMap.set(socket.id, {
        userId: effectiveUserId,
        username: existingAuth?.username || username,
        roomId: session.roomId,
        gameId: targetGameId,
      });

      // 恢复关联房间中的玩家在线态
      if (session.roomId) {
        roomMgr.markPlayerOnline(session.roomId, effectiveUserId, true);
        const room = roomMgr.getRoom(session.roomId);
        if (room) {
          io.to(`room:${session.roomId}`).emit('room:state_updated', room);
        }
      }

      // 广播给对手与对局频道：玩家已重连
      io.to(`game:${targetGameId}`).emit('game:events', [
        {
          type: 'PLAYER_RECONNECTED',
          playerId: effectiveUserId,
          message: '指挥官已重新接入作战终端，对局继续！',
        },
      ]);
      io.to(`game:${targetGameId}`).emit('game:player_reconnected', {
        userId: effectiveUserId,
        message: '对手已重新连入对局，对决继续！',
      });

      MetricsService.getInstance().recordReconnect();
      // 同步最新状态给所有对战玩家 (消除等待遮罩)
      const socketsInGame = getSocketsInChannel(io, `game:${targetGameId}`);
      for (const s of socketsInGame) {
        const sAuth = socketAuthMap.get(s.id);
        const targetUserId = sAuth?.userId || effectiveUserId;
        const safeState = gameSessionMgr.getPublicGameState(targetGameId, targetUserId);
        if (safeState) {
          s.emit('game:sync_state', safeState);
          MetricsService.getInstance().recordWebSocketMessage(JSON.stringify(safeState).length);
          if (safeState.currentPendingChoice) {
            s.emit('game:choice_required', safeState.currentPendingChoice);
          }
        }
      }
    });

    // ---------------------------------------------
    // 玩家主动退出对局或返回大厅 (Game Leave)
    // ---------------------------------------------
    socket.on('game:leave', async (payload) => {
      try {
        const auth = socketAuthMap.get(socket.id);
        const opUserId = auth?.userId || userId;
        const targetGameId = payload?.gameId;
        if (!targetGameId) return;

        const session = gameSessionMgr.getSession(targetGameId);
        if (session) {
          socket.leave(`game:${targetGameId}`);

          const engineState = session.engine.getState();
          // 仅在明确传入 isSurrender 时，才判定为投降认输
          if (payload?.isSurrender && engineState.status === 'PLAYING') {
            await gameSessionMgr.processAction(targetGameId, {
              type: 'SURRENDER',
              playerId: opUserId,
            });
            const updated = session.engine.getState();
            io.to(`game:${targetGameId}`).emit('game:ended', {
              winnerId: updated.winnerId,
              isDraw: false,
              reason: '对手已投降弃权，判定获胜',
            });
            if (session.roomId) {
              const r = roomMgr.getRoom(session.roomId);
              if (r) {
                r.status = RoomStatus.FINISHED;
                io.to(`room:${session.roomId}`).emit('room:state_updated', r);
              }
            }
          }

          // 同步从关联房间中更新玩家在线态/离开
          const rId = session.roomId;
          const res = await roomMgr.leaveRoom(rId, opUserId);
          socket.leave(`room:${rId}`);

          const curAuth = socketAuthMap.get(socket.id);
          if (curAuth) {
            socketAuthMap.set(socket.id, {
              userId: curAuth.userId,
              username: curAuth.username,
            });
          }

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
            if (res.data.status === RoomStatus.PLAYING && engineState.status === 'PLAYING') {
              io.to(`game:${targetGameId}`).emit('game:player_disconnected', {
                userId: opUserId,
                message: '对手暂时离开对局（房间已保留），等待对手重新进入...',
              });
              io.to(`game:${targetGameId}`).emit('game:events', [
                {
                  type: 'PLAYER_DISCONNECTED',
                  playerId: opUserId,
                  message: '对手暂时离开对局，对战未关闭，等待其重连',
                },
              ]);
            }
          }
        }
      } catch {}
    });

    socket.on('disconnect', async () => {
      const auth = socketAuthMap.get(socket.id);
      const dcUserId = auth?.userId || userId;
      const targetRoomId = auth?.roomId;
      socketAuthMap.delete(socket.id);
      userActionTimestamps.delete(dcUserId);

      // 1. 优先检查是否处于对战进行中 (PLAYING)
      const room = targetRoomId ? roomMgr.getRoom(targetRoomId) : roomMgr.getRoomByUserId(dcUserId);
      if (room && room.status === RoomStatus.PLAYING) {
        // 核心规则：对战进行中，掉线或失去连接绝不关闭房间，立即标为离线并通知在场玩家等待重连！
        roomMgr.markPlayerOnline(room.roomId, dcUserId, false);
        const onlinePlayers = room.players.filter((p) => p.isOnline);
        if (onlinePlayers.length === 0) {
          // 双方均已断开离开，给予 2.5 秒重连缓冲，避免页面路由切换或刷新瞬断导致直接关房杀局
          setTimeout(async () => {
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

      // 2. 若处于等待阶段 (WAITING / READY)，预留 1.5 秒重连与页面刷新缓冲窗口
      setTimeout(async () => {
        try {
          const isStillConnected = Array.from(socketAuthMap.values()).some((a) => a.userId === dcUserId);
          if (isStillConnected) return;

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
