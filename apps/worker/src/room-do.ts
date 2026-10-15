import { DurableObject } from 'cloudflare:workers';
import {
  ErrorCode,
  GameAction,
  GameEvent,
  PublicGameState,
  PublicRoomState,
  RoomPlayerDto,
  RoomStatus,
} from '@zhanshuang/shared';
import { GameEngine, GameEngineSnapshot } from '@zhanshuang/game-engine';
import { Env, WsClientAttachment } from './types.js';
import { getJwtSecret, verifyJwt } from './lib/crypto-auth.js';
import { initializeDatabase } from './lib/db-client.js';
import { OFFICIAL_CARD_DB, ResolvedDeck, resolveDeck } from './lib/cards.js';

/**
 * 单个房间的权威状态 (房间成员、密码摘要、对局引擎)。
 *
 * 协议与 Node 版 Socket.IO 网关 (apps/server/src/socket/gateway.ts) 保持一致：
 * 事件名与负载沿用 packages/shared/src/types/socket.ts，传输层为原生 WebSocket，
 * 消息格式统一为 { event, payload }。为节省额度，对局状态以单条 game:bundle
 * ({ events, state }) 下发，由前端 NativeWebSocketClient 拆分为 game:events / game:sync_state / game:choice_required。
 *
 * 安全约定 (见 AGENTS.md)：身份在 WebSocket 握手时确定并随连接持久化，事件负载中的 userId / playerId 一律忽略。
 */

const RATE_LIMIT_WINDOW_MS = 1000;
const MAX_ACTIONS_PER_WINDOW = 15;
/** 等待阶段掉线后保留席位的时间 (刷新页面不丢座位) */
const WAITING_DISCONNECT_GRACE_MS = 15_000;
/** 对战中单方掉线超过该时长判负，避免房间永久卡死 */
const PLAYING_DISCONNECT_FORFEIT_MS = 3 * 60_000;
/** 对战中双方均掉线超过该时长，关闭房间并结束对局 (不计战绩) */
const PLAYING_ALL_OFFLINE_CLOSE_MS = 60_000;
const GUEST_ID_PATTERN = /^[A-Za-z0-9_\-.:]{1,64}$/;

interface PlayerRow {
  userId: string;
  username: string;
  nickname: string;
  seatIndex: number;
  isReady: number;
  isOnline: number;
  offlineSince: number | null;
  deckId: string | null;
  deckName: string | null;
  deckJson: string | null;
}

interface SessionRow {
  gameId: string;
  status: string;
  snapshotJson: string;
  seed: number;
  stateVersion: number;
  startedAt: number;
}

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export class RoomDO extends DurableObject<Env> {
  private engine: GameEngine | null = null;
  private engineGameId: string | null = null;
  private readonly actionTimestamps = new Map<string, number[]>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // 表名带版本后缀，与早期实现的表结构互不干扰
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS room_meta_v2 (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS room_players_v2 (
        userId TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        nickname TEXT NOT NULL,
        seatIndex INTEGER NOT NULL,
        isReady INTEGER NOT NULL DEFAULT 0,
        isOnline INTEGER NOT NULL DEFAULT 1,
        offlineSince INTEGER,
        deckId TEXT,
        deckName TEXT,
        deckJson TEXT
      );
      CREATE TABLE IF NOT EXISTS game_sessions_v2 (
        gameId TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        snapshotJson TEXT NOT NULL,
        seed INTEGER NOT NULL,
        stateVersion INTEGER NOT NULL,
        startedAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_log_v2 (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        gameId TEXT NOT NULL,
        playerId TEXT,
        actionJson TEXT,
        eventsJson TEXT NOT NULL,
        ts INTEGER NOT NULL
      );
    `);
  }

  // ============================================================
  // 连接建立与身份确定
  // ============================================================

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const roomIdHint = request.headers.get('x-room-id') || '';

    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return Response.json({ success: true, data: this.hasRoom() ? this.getPublicRoomState() : null });
    }

    const identity = await this.resolveIdentity(url);
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [identity.userId]);
    server.serializeAttachment({ ...identity, roomIdHint, connectedAt: Date.now() } satisfies WsClientAttachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async resolveIdentity(url: URL): Promise<Omit<WsClientAttachment, 'roomIdHint' | 'connectedAt'>> {
    const token = url.searchParams.get('token');
    const secret = getJwtSecret(this.env);
    if (token && secret) {
      const payload = await verifyJwt(token, secret);
      if (payload?.sub) {
        return {
          userId: payload.sub,
          username: payload.username,
          nickname: clip(payload.nickname, 32) || payload.username,
          isGuest: false,
        };
      }
    }

    const fallbackId = `guest_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const rawGuestId = url.searchParams.get('guestId') || '';
    let guestId = GUEST_ID_PATTERN.test(rawGuestId) ? rawGuestId : fallbackId;
    // 游客不得冒用已注册账号的 userId (否则可读取其手牌等隐藏信息)
    if (guestId !== fallbackId && this.env.DB) {
      try {
        await initializeDatabase(this.env.DB, this.env.ADMIN_PASSWORD);
        const found = await this.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(guestId).first();
        if (found) guestId = fallbackId;
      } catch {
        guestId = fallbackId;
      }
    }
    const nickname = clip(url.searchParams.get('nickname'), 32) || `指挥官_${guestId.slice(0, 8)}`;
    return { userId: guestId, username: guestId, nickname, isGuest: true };
  }

  // ============================================================
  // 消息分发
  // ============================================================

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const me = ws.deserializeAttachment() as WsClientAttachment | null;
    if (!me?.userId || typeof message !== 'string') return;

    let parsed: { event?: string; payload?: any };
    try {
      parsed = JSON.parse(message);
    } catch {
      return this.sendError(ws, ErrorCode.INVALID_ACTION, '非法的数据格式');
    }
    const payload = parsed.payload ?? {};

    try {
      switch (parsed.event) {
        case 'room:join':
          return await this.onRoomJoin(ws, me, payload);
        case 'room:leave':
          return await this.onRoomLeave(me);
        case 'room:select_deck':
          return await this.onSelectDeck(ws, me, payload);
        case 'room:ready':
          return await this.onReady(ws, me, payload);
        case 'room:start':
          return await this.onStart(ws, me);
        case 'game:action':
          return await this.onGameAction(ws, me, payload);
        case 'game:choice':
          return await this.onGameAction(ws, me, {
            gameId: payload.gameId,
            action: {
              type: 'SELECT_CHOICE_OPTION',
              playerId: me.userId,
              pendingChoiceId: payload.pendingChoiceId,
              selectedIds: Array.isArray(payload.selectedIds) ? payload.selectedIds : [],
            },
          });
        case 'game:reconnect':
          return await this.onGameReconnect(ws, me, payload);
        case 'game:leave':
          return await this.onGameLeave(me, payload);
        default:
          return;
      }
    } catch (err: any) {
      console.error('RoomDO error:', err);
      this.sendError(ws, ErrorCode.INVALID_ACTION, err?.message || '服务端处理异常');
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const me = ws.deserializeAttachment() as WsClientAttachment | null;
    if (!me?.userId) return;
    // 同一账号仍有其他连接 (如多标签页) 时不视为掉线
    const others = this.ctx.getWebSockets(me.userId).filter((s) => s !== ws);
    if (others.length > 0) return;
    await this.markOffline(me.userId);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // ============================================================
  // 房间事件
  // ============================================================

  private async onRoomJoin(ws: WebSocket, me: WsClientAttachment, payload: any): Promise<void> {
    if (!this.hasRoom()) {
      await this.createRoom(me, payload);
    } else {
      const status = this.getMeta('status') as RoomStatus;
      const player = this.getPlayer(me.userId);
      if (player) {
        // 已在房间中：恢复在线态，游客可同步展示昵称
        const nickname = me.isGuest ? clip(payload.username, 32) || player.nickname : me.nickname;
        this.ctx.storage.sql.exec(
          'UPDATE room_players_v2 SET isOnline = 1, offlineSince = NULL, nickname = ? WHERE userId = ?',
          nickname,
          me.userId
        );
        const title = clip(payload.title, 40);
        if (title && this.getMeta('creatorId') === me.userId && status !== RoomStatus.PLAYING) {
          this.setMeta('title', title);
        }
      } else {
        if (status === RoomStatus.PLAYING) {
          return this.sendError(ws, ErrorCode.ACTION_NOT_ALLOWED, '作战推演进行中，非本局玩家无法加入');
        }
        const players = this.getPlayers();
        if (players.length >= 2) {
          return this.sendError(ws, ErrorCode.ROOM_FULL, '房间人数已满');
        }
        const expected = this.getMeta('passwordHash');
        if (expected) {
          const password = clip(payload.password, 128);
          if (!password) {
            return this.sendError(ws, ErrorCode.ROOM_PASSWORD_REQUIRED, '该房间已设置密码，请输入房间密码');
          }
          if (!timingSafeEqualStr(await sha256Hex(password), expected)) {
            return this.sendError(ws, ErrorCode.ROOM_PASSWORD_INVALID, '房间密码错误，请重新输入');
          }
        }
        const seatIndex = players.some((p) => p.seatIndex === 0) ? 1 : 0;
        const nickname = me.isGuest ? clip(payload.username, 32) || me.nickname : me.nickname;
        this.ctx.storage.sql.exec(
          'INSERT INTO room_players_v2 (userId, username, nickname, seatIndex) VALUES (?, ?, ?, ?)',
          me.userId,
          me.username,
          nickname,
          seatIndex
        );
      }
    }
    await this.rescheduleAlarm();
    await this.broadcastRoomState();
  }

  private async createRoom(me: WsClientAttachment, payload: any): Promise<void> {
    // 清理上一轮残留数据，确保新房间不沿用旧成员、旧密码与旧对局
    this.ctx.storage.sql.exec(
      'DELETE FROM room_meta_v2; DELETE FROM room_players_v2; DELETE FROM game_sessions_v2; DELETE FROM game_log_v2;'
    );
    this.engine = null;
    this.engineGameId = null;

    // 房间 ID 以 Worker 路由确定的值为准 (它决定了请求被分配到哪个 Durable Object)
    const roomId = me.roomIdHint || clip(payload.roomId, 64) || 'room';
    const password = clip(payload.password, 128);
    const nickname = me.isGuest ? clip(payload.username, 32) || me.nickname : me.nickname;
    this.setMeta('roomId', roomId);
    this.setMeta('roomCode', crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase());
    this.setMeta('title', clip(payload.title, 40) || `作战推演室 #${roomId}`);
    this.setMeta('passwordHash', password ? await sha256Hex(password) : '');
    this.setMeta('creatorId', me.userId);
    this.setMeta('status', RoomStatus.WAITING);
    this.setMeta('createdAt', String(Date.now()));
    this.ctx.storage.sql.exec(
      'INSERT INTO room_players_v2 (userId, username, nickname, seatIndex) VALUES (?, ?, ?, 0)',
      me.userId,
      me.username,
      nickname
    );
  }

  private async onRoomLeave(me: WsClientAttachment): Promise<void> {
    if (!this.hasRoom() || !this.getPlayer(me.userId)) return;
    await this.leaveRoom(me.userId);
  }

  /** 玩家离开房间：对战中仅标记离线并保留席位，其余状态下移除席位 */
  private async leaveRoom(userId: string): Promise<void> {
    const status = this.getMeta('status') as RoomStatus;
    if (status === RoomStatus.PLAYING) {
      await this.markOffline(userId);
      return;
    }

    this.ctx.storage.sql.exec('DELETE FROM room_players_v2 WHERE userId = ?', userId);
    const remaining = this.getPlayers();
    if (remaining.length === 0) {
      await this.closeRoom('房间内所有玩家均已离开，房间已自动关闭');
      return;
    }
    if (this.getMeta('creatorId') === userId) {
      this.setMeta('creatorId', remaining[0]!.userId);
    }
    this.ctx.storage.sql.exec('UPDATE room_players_v2 SET isReady = 0');
    this.setMeta('status', RoomStatus.WAITING);
    await this.broadcastRoomState();
  }

  private async onSelectDeck(ws: WebSocket, me: WsClientAttachment, payload: any): Promise<void> {
    if (!this.getPlayer(me.userId)) return;
    const { deck, error } = resolveDeck(payload.deckId, payload.customDeck);
    if (!deck) return this.sendError(ws, ErrorCode.INVALID_DECK, error ?? '找不到可用的出战卡组');
    this.saveDeck(me.userId, deck);
    await this.broadcastRoomState();
  }

  private async onReady(ws: WebSocket, me: WsClientAttachment, payload: any): Promise<void> {
    if (!this.getPlayer(me.userId)) {
      return this.sendError(ws, ErrorCode.UNAUTHORIZED, '非房间内玩家');
    }
    if (this.getMeta('status') === RoomStatus.PLAYING) return;

    if (payload.isReady) {
      const { deck, error } = resolveDeck(payload.deckId, payload.customDeck);
      if (!deck) return this.sendError(ws, ErrorCode.INVALID_DECK, error ?? '找不到可用的出战卡组');
      this.saveDeck(me.userId, deck);
      this.ctx.storage.sql.exec('UPDATE room_players_v2 SET isReady = 1 WHERE userId = ?', me.userId);
    } else {
      this.ctx.storage.sql.exec('UPDATE room_players_v2 SET isReady = 0 WHERE userId = ?', me.userId);
    }

    const players = this.getPlayers();
    const allReady = players.length === 2 && players.every((p) => p.isReady);
    this.setMeta('status', allReady ? RoomStatus.READY : RoomStatus.WAITING);
    await this.broadcastRoomState();
  }

  private async onStart(ws: WebSocket, me: WsClientAttachment): Promise<void> {
    if (!this.getPlayer(me.userId)) {
      return this.sendError(ws, ErrorCode.UNAUTHORIZED, '非房间内玩家，无法开局');
    }
    if (this.getMeta('status') === RoomStatus.PLAYING) return; // 防止重复点击导致重复开局
    const players = this.getPlayers();
    if (players.length !== 2 || !players.every((p) => p.isReady && p.deckJson)) {
      return this.sendError(ws, ErrorCode.ROOM_NOT_READY, '双方玩家均需准备就绪后方可开局');
    }

    const [p1, p2] = [players.find((p) => p.seatIndex === 0)!, players.find((p) => p.seatIndex === 1)!];
    const deck1 = JSON.parse(p1.deckJson!) as ResolvedDeck;
    const deck2 = JSON.parse(p2.deckJson!) as ResolvedDeck;
    const roomId = this.getMeta('roomId');
    // 对局 ID 只用 URL 安全字符，且可反推出房间 ID：game~<roomId>~<timestamp>
    const gameId = `game~${roomId}~${Date.now()}`;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;

    const engine = new GameEngine(
      gameId,
      { playerId: p1.userId, deckCardNumbers: deck1.cardNumbers, deckCardImageUrls: deck1.imageUrls },
      { playerId: p2.userId, deckCardNumbers: deck2.cardNumbers, deckCardImageUrls: deck2.imageUrls },
      seed,
      OFFICIAL_CARD_DB,
      { skipMulligan: false }
    );

    this.ctx.storage.sql.exec('DELETE FROM game_sessions_v2; DELETE FROM game_log_v2;');
    this.ctx.storage.sql.exec(
      'INSERT INTO game_sessions_v2 (gameId, status, snapshotJson, seed, stateVersion, startedAt) VALUES (?, ?, ?, ?, 1, ?)',
      gameId,
      engine.getState().status,
      this.serializeEngine(engine),
      seed,
      Date.now()
    );
    this.appendLog(gameId, null, null, engine.getEvents());
    this.engine = engine;
    this.engineGameId = gameId;

    this.setMeta('status', RoomStatus.PLAYING);
    this.setMeta('currentGameId', gameId);
    await this.broadcastRoomState();
    this.pushGameBundle([]);
  }

  // ============================================================
  // 对局事件
  // ============================================================

  private async onGameAction(ws: WebSocket, me: WsClientAttachment, payload: any): Promise<void> {
    if (this.isRateLimited(me.userId)) {
      return this.sendError(ws, ErrorCode.RATE_LIMIT_EXCEEDED, '操作提交过于频繁，防作弊系统已限流拦截');
    }
    const action = payload.action as GameAction | undefined;
    if (!action || typeof action.type !== 'string') {
      return this.sendError(ws, ErrorCode.INVALID_ACTION, '非法的行动数据');
    }
    if (action.playerId && action.playerId !== me.userId) {
      return this.sendError(ws, ErrorCode.UNAUTHORIZED, '检测到冒名伪造攻击：操作发起者与认证身份不符');
    }

    const session = this.getSession();
    const engine = this.loadEngine();
    if (!session || !engine || (payload.gameId && payload.gameId !== session.gameId)) {
      return this.sendError(ws, ErrorCode.GAME_NOT_FOUND, '对局会话已结束或不存在');
    }
    if (!engine.getState().players[me.userId]) {
      return this.sendError(ws, ErrorCode.UNAUTHORIZED, '非当前对局玩家，无法提交操作');
    }

    const secureAction = { ...action, playerId: me.userId } as GameAction;
    const result = engine.dispatchAction(secureAction);
    if (!result.success) {
      return this.sendError(ws, ErrorCode.ACTION_NOT_ALLOWED, result.error ?? '行动被规则引擎拒绝');
    }

    this.saveSession(engine, session.gameId);
    this.appendLog(session.gameId, me.userId, secureAction, result.events);
    this.pushGameBundle(result.events);

    if (engine.getState().status === 'FINISHED') {
      await this.finishGame(engine, session);
    }
  }

  private async onGameReconnect(ws: WebSocket, me: WsClientAttachment, payload: any): Promise<void> {
    const session = this.getSession();
    const engine = this.loadEngine();
    if (!session || !engine || (payload.gameId && payload.gameId !== session.gameId)) {
      return this.sendError(ws, ErrorCode.GAME_NOT_FOUND, '对局会话已结束或不存在');
    }
    if (!engine.getState().players[me.userId]) {
      return this.sendError(ws, ErrorCode.UNAUTHORIZED, '非当前对局玩家，无法重连接入');
    }

    if (this.getPlayer(me.userId)) {
      this.ctx.storage.sql.exec(
        'UPDATE room_players_v2 SET isOnline = 1, offlineSince = NULL WHERE userId = ?',
        me.userId
      );
      await this.rescheduleAlarm();
      await this.broadcastRoomState();
    }
    this.broadcast({
      event: 'game:player_reconnected',
      payload: { userId: me.userId, message: '对手已重新连入对局，对决继续！' },
    });
    this.sendBundle(ws, me.userId, engine, []);
  }

  private async onGameLeave(me: WsClientAttachment, payload: any): Promise<void> {
    const session = this.getSession();
    const engine = this.loadEngine();
    if (!session || !engine || !engine.getState().players[me.userId]) return;
    if (payload.gameId && payload.gameId !== session.gameId) return;

    if (payload.isSurrender && engine.getState().status === 'PLAYING') {
      const result = engine.dispatchAction({ type: 'SURRENDER', playerId: me.userId });
      if (result.success) {
        this.saveSession(engine, session.gameId);
        this.appendLog(session.gameId, me.userId, { type: 'SURRENDER', playerId: me.userId }, result.events);
        this.pushGameBundle(result.events);
        await this.finishGame(engine, session);
      }
    }
    if (this.getPlayer(me.userId)) {
      await this.leaveRoom(me.userId);
    }
  }

  private async finishGame(engine: GameEngine, session: SessionRow): Promise<void> {
    const state = engine.getState();
    this.broadcast({
      event: 'game:ended',
      payload: { winnerId: state.winnerId, isDraw: state.isDraw, reason: state.finishReason ?? '游戏结束' },
    });
    this.setMeta('status', RoomStatus.FINISHED);
    this.ctx.storage.sql.exec('UPDATE room_players_v2 SET isReady = 0');
    await this.recordMatch(engine, session);
    await this.broadcastRoomState();
  }

  /** 将对局结果与回放写入 D1 (失败不影响对局流程) */
  private async recordMatch(engine: GameEngine, session: SessionRow): Promise<void> {
    if (!this.env.DB) return;
    try {
      const state = engine.getState();
      const players = this.getPlayers();
      const seat = (i: number) => players.find((p) => p.seatIndex === i);
      const playerIds = Object.keys(state.players);
      const logRows = [
        ...this.ctx.storage.sql.exec(
          'SELECT seq, playerId, actionJson, eventsJson, ts FROM game_log_v2 WHERE gameId = ? ORDER BY seq',
          session.gameId
        ),
      ] as { seq: number; playerId: string | null; actionJson: string | null; eventsJson: string; ts: number }[];

      const actions: unknown[] = [];
      const events: unknown[] = [];
      for (const row of logRows) {
        const timestamp = new Date(row.ts).toISOString();
        if (row.actionJson) {
          const action = JSON.parse(row.actionJson) as GameAction;
          actions.push({ seq: actions.length + 1, playerId: row.playerId, actionType: action.type, payload: action, timestamp });
        }
        for (const evt of JSON.parse(row.eventsJson) as GameEvent[]) {
          events.push({ seq: events.length + 1, eventType: evt.type, payload: evt, timestamp });
        }
      }

      await initializeDatabase(this.env.DB, this.env.ADMIN_PASSWORD);
      await this.env.DB.prepare(
        `INSERT OR REPLACE INTO matches (id, room_id, rng_seed, player1_id, player2_id, player1_deck_id, player2_deck_id,
           winner_id, is_draw, finish_reason, turns, started_at, finished_at, replay_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          session.gameId,
          this.getMeta('roomId'),
          String(session.seed),
          seat(0)?.userId ?? playerIds[0],
          seat(1)?.userId ?? playerIds[1],
          seat(0)?.deckId ?? '',
          seat(1)?.deckId ?? '',
          state.winnerId ?? null,
          state.isDraw ? 1 : 0,
          state.finishReason ?? null,
          state.turnNumber,
          session.startedAt,
          Date.now(),
          JSON.stringify({ actions, events })
        )
        .run();
    } catch (err) {
      console.error('写入对局记录失败:', err);
    }
  }

  // ============================================================
  // 掉线处理 (Alarm)
  // ============================================================

  private async markOffline(userId: string): Promise<void> {
    if (!this.hasRoom()) return;
    const player = this.getPlayer(userId);
    if (!player || !player.isOnline) return;
    this.ctx.storage.sql.exec(
      'UPDATE room_players_v2 SET isOnline = 0, offlineSince = ? WHERE userId = ?',
      Date.now(),
      userId
    );
    if (this.getMeta('status') === RoomStatus.PLAYING) {
      this.broadcast({
        event: 'game:player_disconnected',
        payload: { userId, message: '对手暂时掉线或失去连接，对战房间已保留，等待对手重新接入...' },
      });
    }
    await this.rescheduleAlarm();
    await this.broadcastRoomState();
  }

  /** 计算下一个需要处理的掉线截止时间并设置 Alarm */
  private async rescheduleAlarm(): Promise<void> {
    const deadline = this.nextDisconnectDeadline();
    if (deadline === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(Math.max(deadline, Date.now() + 100));
    }
  }

  private nextDisconnectDeadline(): number | null {
    if (!this.hasRoom()) return null;
    const players = this.getPlayers();
    const offline = players.filter((p) => !p.isOnline && p.offlineSince);
    if (offline.length === 0) return null;
    if (this.getMeta('status') === RoomStatus.PLAYING) {
      if (offline.length === players.length) {
        return Math.max(...offline.map((p) => p.offlineSince!)) + PLAYING_ALL_OFFLINE_CLOSE_MS;
      }
      return Math.min(...offline.map((p) => p.offlineSince!)) + PLAYING_DISCONNECT_FORFEIT_MS;
    }
    return Math.min(...offline.map((p) => p.offlineSince!)) + WAITING_DISCONNECT_GRACE_MS;
  }

  async alarm(): Promise<void> {
    if (!this.hasRoom()) return;
    const now = Date.now();
    const players = this.getPlayers();
    const offline = players.filter((p) => !p.isOnline && p.offlineSince);
    const status = this.getMeta('status') as RoomStatus;

    if (status === RoomStatus.PLAYING) {
      if (offline.length === players.length) {
        if (Math.max(...offline.map((p) => p.offlineSince!)) + PLAYING_ALL_OFFLINE_CLOSE_MS <= now) {
          await this.closeRoom('双方玩家均已断开离开，房间已自动关闭');
          return;
        }
      } else {
        const expired = offline.find((p) => p.offlineSince! + PLAYING_DISCONNECT_FORFEIT_MS <= now);
        const session = this.getSession();
        const engine = this.loadEngine();
        if (expired && session && engine && engine.getState().status === 'PLAYING') {
          const result = engine.dispatchAction({ type: 'SURRENDER', playerId: expired.userId });
          if (result.success) {
            this.saveSession(engine, session.gameId);
            this.appendLog(session.gameId, expired.userId, { type: 'SURRENDER', playerId: expired.userId }, result.events);
            this.pushGameBundle(result.events);
            await this.finishGame(engine, session);
          }
        }
      }
    } else {
      for (const p of offline) {
        if (p.offlineSince! + WAITING_DISCONNECT_GRACE_MS <= now) {
          await this.leaveRoom(p.userId);
          if (!this.hasRoom()) return;
        }
      }
    }
    await this.rescheduleAlarm();
  }

  private async closeRoom(reason: string): Promise<void> {
    const roomId = this.getMeta('roomId');
    this.broadcast({ event: 'room:closed', payload: { roomId, reason } });
    this.ctx.storage.sql.exec(
      'DELETE FROM room_meta_v2; DELETE FROM room_players_v2; DELETE FROM game_sessions_v2; DELETE FROM game_log_v2;'
    );
    this.engine = null;
    this.engineGameId = null;
    await this.ctx.storage.deleteAlarm();
    await this.syncLobby(roomId, null);
  }

  // ============================================================
  // 状态读写
  // ============================================================

  private hasRoom(): boolean {
    return this.getMeta('roomId') !== '';
  }

  private getMeta(key: string): string {
    const rows = [...this.ctx.storage.sql.exec('SELECT value FROM room_meta_v2 WHERE key = ?', key)] as { value: string }[];
    return rows[0]?.value ?? '';
  }

  private setMeta(key: string, value: string): void {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO room_meta_v2 (key, value) VALUES (?, ?)', key, value);
  }

  private getPlayers(): PlayerRow[] {
    return [...this.ctx.storage.sql.exec('SELECT * FROM room_players_v2 ORDER BY seatIndex')] as unknown as PlayerRow[];
  }

  private getPlayer(userId: string): PlayerRow | undefined {
    return this.getPlayers().find((p) => p.userId === userId);
  }

  private saveDeck(userId: string, deck: ResolvedDeck): void {
    this.ctx.storage.sql.exec(
      'UPDATE room_players_v2 SET deckId = ?, deckName = ?, deckJson = ? WHERE userId = ?',
      deck.id,
      deck.name,
      JSON.stringify(deck),
      userId
    );
  }

  private getSession(): SessionRow | null {
    const rows = [...this.ctx.storage.sql.exec('SELECT * FROM game_sessions_v2 LIMIT 1')] as unknown as SessionRow[];
    return rows[0] ?? null;
  }

  /** 从内存或持久化快照取回引擎 (Durable Object 休眠/驱逐后自动恢复) */
  private loadEngine(): GameEngine | null {
    const session = this.getSession();
    if (!session) return null;
    if (this.engine && this.engineGameId === session.gameId) return this.engine;
    const snapshot = JSON.parse(session.snapshotJson) as GameEngineSnapshot;
    this.engine = GameEngine.fromSnapshot(snapshot, OFFICIAL_CARD_DB);
    this.engineGameId = session.gameId;
    return this.engine;
  }

  /** 快照不包含事件历史 (历史事件单独记入 game_log_v2)，避免快照随对局进行无限增长 */
  private serializeEngine(engine: GameEngine): string {
    return JSON.stringify({ ...engine.toSnapshot(), events: [] });
  }

  private saveSession(engine: GameEngine, gameId: string): void {
    this.ctx.storage.sql.exec(
      'UPDATE game_sessions_v2 SET status = ?, snapshotJson = ?, stateVersion = stateVersion + 1 WHERE gameId = ?',
      engine.getState().status,
      this.serializeEngine(engine),
      gameId
    );
  }

  private appendLog(gameId: string, playerId: string | null, action: GameAction | null, events: GameEvent[]): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO game_log_v2 (gameId, playerId, actionJson, eventsJson, ts) VALUES (?, ?, ?, ?, ?)',
      gameId,
      playerId,
      action ? JSON.stringify(action) : null,
      JSON.stringify(events),
      Date.now()
    );
  }

  private isRateLimited(userId: string): boolean {
    const now = Date.now();
    const recent = (this.actionTimestamps.get(userId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    const limited = recent.length >= MAX_ACTIONS_PER_WINDOW;
    if (!limited) recent.push(now);
    this.actionTimestamps.set(userId, recent);
    return limited;
  }

  private getPublicRoomState(): PublicRoomState {
    const players: RoomPlayerDto[] = this.getPlayers().map((p) => ({
      userId: p.userId,
      username: p.username,
      nickname: p.nickname,
      seatIndex: p.seatIndex,
      isReady: Boolean(p.isReady),
      isOnline: Boolean(p.isOnline),
      deckId: p.deckId ?? undefined,
      deckName: p.deckName ?? undefined,
    }));
    const status = (this.getMeta('status') as RoomStatus) || RoomStatus.WAITING;
    const currentGameId = this.getMeta('currentGameId');
    return {
      roomId: this.getMeta('roomId'),
      roomCode: this.getMeta('roomCode'),
      title: this.getMeta('title'),
      hasPassword: this.getMeta('passwordHash') !== '',
      creatorId: this.getMeta('creatorId'),
      status,
      players,
      currentGameId: currentGameId || undefined,
      createdAt: Number(this.getMeta('createdAt')) || Date.now(),
    };
  }

  // ============================================================
  // 推送
  // ============================================================

  private async broadcastRoomState(): Promise<void> {
    if (!this.hasRoom()) return;
    const room = this.getPublicRoomState();
    this.broadcast({ event: 'room:state_updated', payload: room });
    await this.syncLobby(room.roomId, room);
  }

  /** 同步大厅展示用的 D1 投影 (房间关闭时删除) */
  private async syncLobby(roomId: string, room: PublicRoomState | null): Promise<void> {
    if (!this.env.DB || !roomId) return;
    try {
      await initializeDatabase(this.env.DB, this.env.ADMIN_PASSWORD);
      if (!room || room.players.length === 0) {
        await this.env.DB.prepare('DELETE FROM lobby_rooms WHERE room_id = ?').bind(roomId).run();
        return;
      }
      await this.env.DB.prepare(
        `INSERT OR REPLACE INTO lobby_rooms (room_id, room_code, title, has_password, creator_id, status,
           player_count, players_json, current_game_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          room.roomId,
          room.roomCode,
          room.title,
          room.hasPassword ? 1 : 0,
          room.creatorId,
          room.status,
          room.players.length,
          JSON.stringify(room.players),
          room.currentGameId ?? null,
          room.createdAt,
          Date.now()
        )
        .run();
    } catch (err) {
      console.error('同步大厅房间列表失败:', err);
    }
  }

  private pushGameBundle(events: GameEvent[]): void {
    const engine = this.loadEngine();
    if (!engine) return;
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as WsClientAttachment | null;
      if (att?.userId) this.sendBundle(ws, att.userId, engine, events);
    }
  }

  /** 单条合并消息：事件 + 针对该玩家脱敏后的状态 */
  private sendBundle(ws: WebSocket, userId: string, engine: GameEngine, events: GameEvent[]): void {
    const session = this.getSession();
    const state: PublicGameState = {
      ...engine.getPublicState(userId),
      roomId: this.getMeta('roomId'),
      stateVersion: session?.stateVersion ?? 1,
    };
    this.send(ws, { event: 'game:bundle', payload: { events, state } });
  }

  private broadcast(msg: { event: string; payload: unknown }): void {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {}
    }
  }

  private send(ws: WebSocket, msg: { event: string; payload: unknown }): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  }

  private sendError(ws: WebSocket, code: ErrorCode, message: string): void {
    this.send(ws, { event: 'game:error', payload: { code, message } });
  }
}
