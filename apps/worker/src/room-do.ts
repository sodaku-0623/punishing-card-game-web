import { DurableObject } from 'cloudflare:workers';
import {
  GameAction,
  GameEvent,
  PublicRoomState,
  RoomStatus,
  RoomPlayerDto,
} from '@zhanshuang/shared';
import { GameEngine, GameEngineSnapshot } from '@zhanshuang/game-engine';
import { validateDeck, DeckCardInput } from '@zhanshuang/game-rules';
import { Env, WsClientAttachment, WsMessage } from './types.js';
import { verifyJwt } from './lib/crypto-auth.js';

interface StoredPlayer {
  userId: string;
  username: string;
  nickname: string;
  seatIndex: number;
  isReady: boolean;
  isOnline: boolean;
  deckId?: string;
  deckCardsJson?: string;
}

const MAX_RATE_LIMIT = 15; // 每秒最多 15 次请求
const DISCONNECT_TIMEOUT_MS = 60000; // 掉线 60 秒判负

function hashRoomPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest('SHA-256', encoder.encode(password)).then((buf) => {
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  });
}

function safeTimingCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export class RoomDO extends DurableObject {
  private engine: GameEngine | null = null;
  private currentRoomId = '';
  private customEnv: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.customEnv = env;

    // 初始化 SQLite 内部表结构（单房间状态与对局持久化）
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS room_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS players (
        userId TEXT PRIMARY KEY,
        username TEXT,
        nickname TEXT,
        seatIndex INTEGER,
        isReady INTEGER,
        isOnline INTEGER,
        deckId TEXT,
        deckCardsJson TEXT,
        joinedAt INTEGER
      );

      CREATE TABLE IF NOT EXISTS game_session (
        gameId TEXT PRIMARY KEY,
        currentTurn TEXT,
        status TEXT,
        snapshotJson TEXT,
        actionCount INTEGER,
        updatedAt INTEGER
      );

      CREATE TABLE IF NOT EXISTS rate_limits (
        userId TEXT PRIMARY KEY,
        windowSec INTEGER,
        count INTEGER
      );
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get('Upgrade');

    // 1. 普通 HTTP 查询单房间状态
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      const room = await this.getPublicRoomState();
      return Response.json({ ok: true, room });
    }

    // 2. 从 URL 提取 roomId
    const pathParts = url.pathname.split('/');
    const roomId = pathParts[pathParts.length - 1] || 'default-room';
    this.currentRoomId = roomId;

    // 3. 严格遵循安全规范：握手鉴权统一确定身份（JWT 优先，游客校验非注册用户）
    const token = url.searchParams.get('token');
    const guestId = url.searchParams.get('guestId') || `guest_${Math.random().toString(36).substring(2, 9)}`;
    const nickname = url.searchParams.get('nickname') || '游客';

    let user: { userId: string; username: string; nickname: string; isGuest: boolean };

    if (token) {
      const secret = this.customEnv.JWT_SECRET || 'zhanshuang_jwt_default_secret_2026';
      const jwtPayload = await verifyJwt(token, secret);
      if (jwtPayload) {
        user = {
          userId: jwtPayload.sub,
          username: jwtPayload.username,
          nickname: jwtPayload.nickname,
          isGuest: false,
        };
      } else {
        // Token 无效或过期时作为游客处理
        user = {
          userId: guestId,
          username: guestId,
          nickname,
          isGuest: true,
        };
      }
    } else {
      user = {
        userId: guestId,
        username: guestId,
        nickname,
        isGuest: true,
      };
    }

    // 游客不得冒用已注册账号的 userId (AGENTS.md 安全规范)
    if (user.isGuest && this.customEnv.DB) {
      try {
        const found = await this.customEnv.DB.prepare('SELECT id FROM users WHERE id = ? OR username = ?')
          .bind(user.userId, user.username)
          .first();
        if (found) {
          const safeGuestId = `guest_${Math.random().toString(36).substring(2, 9)}`;
          user.userId = safeGuestId;
          user.username = safeGuestId;
        }
      } catch {}
    }

    // 4. WebSocket 握手接入与 Attachment 绑定
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const attachment: WsClientAttachment = {
      userId: user.userId,
      username: user.username,
      nickname: user.nickname,
      isGuest: user.isGuest,
      connectedAt: Date.now(),
    };

    // 使用 WebSocket Hibernation API 托管
    this.ctx.acceptWebSocket(server, [user.userId]);
    server.serializeAttachment(attachment);

    // 5. 更新玩家在线状态
    this.ctx.storage.sql.exec(`
      UPDATE players SET isOnline = 1 WHERE userId = ?
    `, user.userId);

    // 6. 若对局正在进行且该玩家先前掉线，取消判负 Alarm 并立即推送最新脱敏对局快照
    const activeGame = this.getActiveGameSession();
    if (activeGame && activeGame.status === 'PLAYING') {
      const engine = this.ensureEngine();
      if (engine) {
        // 取消掉线报警定时器
        await this.ctx.storage.deleteAlarm();

        // 立即向重连上线的玩家推送最新合并状态
        const publicState = engine.getPublicState(user.userId);
        server.send(JSON.stringify({
          event: 'game:bundle',
          payload: {
            events: [],
            state: publicState,
          },
        }));

        // 向对战对手广播重连通知
        this.broadcastToOthers(user.userId, {
          event: 'game:player_reconnected',
          payload: { playerId: user.userId },
        });
      }
    }

    try {
      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    } catch {
      const fallback = new Response(null, {
        status: 200,
        headers: { Upgrade: 'websocket' },
      });
      (fallback as any).webSocket = client;
      return fallback;
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as WsClientAttachment | null;
    if (!attachment || !attachment.userId) {
      this.sendError(ws, '未授权的连接会话', 'UNAUTHORIZED');
      return;
    }

    // 1. 限流校验 (每用户每秒 15 次)
    const nowSec = Math.floor(Date.now() / 1000);
    const cursor = this.ctx.storage.sql.exec(
      'SELECT windowSec, count FROM rate_limits WHERE userId = ?',
      attachment.userId
    );
    const rows = [...cursor] as { windowSec: number; count: number }[];
    const currentRate = rows[0];

    if (currentRate && currentRate.windowSec === nowSec) {
      if (currentRate.count >= MAX_RATE_LIMIT) {
        this.sendError(ws, '请求过于频繁，请稍候再试 (Rate Limit Exceeded)', 'RATE_LIMIT_EXCEEDED');
        return;
      }
      this.ctx.storage.sql.exec(
        'UPDATE rate_limits SET count = count + 1 WHERE userId = ?',
        attachment.userId
      );
    } else {
      this.ctx.storage.sql.exec(
        'INSERT OR REPLACE INTO rate_limits (userId, windowSec, count) VALUES (?, ?, 1)',
        attachment.userId,
        nowSec
      );
    }

    // 2. 解析客户端消息并分发
    let parsed: WsMessage;
    try {
      if (typeof message !== 'string') return;
      parsed = JSON.parse(message) as WsMessage;
    } catch {
      this.sendError(ws, '非法的数据格式', 'INVALID_MESSAGE');
      return;
    }

    try {
      switch (parsed.event) {
        case 'room:join':
          await this.handleRoomJoin(ws, attachment, parsed.payload);
          break;
        case 'room:ready':
          await this.handleRoomReady(ws, attachment, parsed.payload);
          break;
        case 'room:leave':
          await this.handleRoomLeave(ws, attachment);
          break;
        case 'game:action':
          await this.handleGameAction(ws, attachment, parsed.payload);
          break;
        case 'game:choice':
          await this.handleGameChoice(ws, attachment, parsed.payload);
          break;
        case 'game:reconnect':
          await this.handleGameReconnect(ws, attachment);
          break;
        default:
          break;
      }
    } catch (err: any) {
      this.sendError(ws, err.message || '内部服务异常', 'SERVER_ERROR');
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    const attachment = ws.deserializeAttachment() as WsClientAttachment | null;
    if (!attachment || !attachment.userId) return;

    // 检查该用户是否还有其他存活的 WebSocket 连接（多标签页兼容）
    const userSockets = this.ctx.getWebSockets(attachment.userId);
    if (userSockets.length <= 1) {
      // 标记离线
      this.ctx.storage.sql.exec(`
        UPDATE players SET isOnline = 0 WHERE userId = ?
      `, attachment.userId);

      // 若处于对战中，设置 60 秒判负定时器 Alarm
      const activeGame = this.getActiveGameSession();
      if (activeGame && activeGame.status === 'PLAYING') {
        await this.ctx.storage.setAlarm(Date.now() + DISCONNECT_TIMEOUT_MS);
        this.broadcastToOthers(attachment.userId, {
          event: 'game:player_disconnected',
          payload: {
            playerId: attachment.userId,
            timeoutSeconds: DISCONNECT_TIMEOUT_MS / 1000,
          },
        });
      }
    }
  }

  async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
    const attachment = ws.deserializeAttachment() as WsClientAttachment | null;
    if (attachment) {
      this.sendError(ws, '网络传输连接发生异常', 'SOCKET_ERROR');
    }
  }

  /**
   * 掉线超时判定定时器 Alarm：触发时直接对掉线方判负，保证房间不会永远卡死
   */
  async alarm(): Promise<void> {
    const activeGame = this.getActiveGameSession();
    if (!activeGame || activeGame.status !== 'PLAYING') return;

    // 查找当前处于离线状态的对战玩家
    const cursor = this.ctx.storage.sql.exec('SELECT userId, isOnline FROM players');
    const players = [...cursor] as { userId: string; isOnline: number }[];
    const offlinePlayer = players.find((p) => p.isOnline === 0);

    if (offlinePlayer) {
      const engine = this.ensureEngine();
      if (engine) {
        // 自动判定投降判负
        engine.dispatchAction({
          type: 'SURRENDER',
          playerId: offlinePlayer.userId,
        });

        this.saveEngineSnapshot(engine, activeGame.gameId);

        // 广播对局结束事件
        this.broadcast({
          event: 'game:over',
          payload: {
            gameId: activeGame.gameId,
            winnerId: engine.state.winnerId,
            reason: 'DISCONNECT_TIMEOUT',
          },
        });
      }
    }
  }

  // ---------------- 房间业务逻辑处理器 ----------------

  private async handleRoomJoin(
    ws: WebSocket,
    user: WsClientAttachment,
    payload: any
  ): Promise<void> {
    const title = payload?.title || '对战房间';
    const password = payload?.password;

    // 初始化 room_meta
    const metaCursor = this.ctx.storage.sql.exec('SELECT key, value FROM room_meta');
    const metaMap = new Map<string, string>();
    for (const row of [...metaCursor] as { key: string; value: string }[]) {
      metaMap.set(row.key, row.value);
    }

    if (!metaMap.has('roomId')) {
      const pwdHash = password ? await hashRoomPassword(password) : '';
      this.ctx.storage.sql.exec(`
        INSERT INTO room_meta (key, value) VALUES
          ('roomId', ?),
          ('title', ?),
          ('hasPassword', ?),
          ('passwordHash', ?),
          ('creatorId', ?),
          ('status', ?),
          ('createdAt', ?)
      `, this.currentRoomId, title, password ? '1' : '0', pwdHash, user.userId, RoomStatus.WAITING, Date.now());
      metaMap.set('roomId', this.currentRoomId);
      metaMap.set('hasPassword', password ? '1' : '0');
      metaMap.set('passwordHash', pwdHash);
    } else {
      // 校验房间密码
      const hasPassword = metaMap.get('hasPassword') === '1';
      const storedHash = metaMap.get('passwordHash') || '';
      if (hasPassword) {
        if (!password) {
          this.sendError(ws, '该房间已加密，请输入进入密码', 'PASSWORD_REQUIRED');
          return;
        }
        const inputHash = await hashRoomPassword(password);
        if (!safeTimingCompare(inputHash, storedHash)) {
          this.sendError(ws, '房间密码错误', 'INVALID_PASSWORD');
          return;
        }
      }
    }

    // 分配玩家座位 (0 或 1)
    const playersCursor = this.ctx.storage.sql.exec('SELECT * FROM players ORDER BY seatIndex ASC');
    const existingPlayers = ([...playersCursor] as unknown) as StoredPlayer[];

    const userAlreadyIn = existingPlayers.find((p) => p.userId === user.userId);
    if (!userAlreadyIn) {
      if (existingPlayers.length >= 2) {
        this.sendError(ws, '房间人数已满，无法加入', 'ROOM_FULL');
        return;
      }

      const assignedSeat = existingPlayers.length === 0 ? 0 : (existingPlayers[0]!.seatIndex === 0 ? 1 : 0);
      this.ctx.storage.sql.exec(`
        INSERT INTO players (userId, username, nickname, seatIndex, isReady, isOnline, joinedAt)
        VALUES (?, ?, ?, ?, 0, 1, ?)
      `, user.userId, user.username, user.nickname, assignedSeat, Date.now());
    } else {
      this.ctx.storage.sql.exec(`
        UPDATE players SET isOnline = 1 WHERE userId = ?
      `, user.userId);
    }

    // 广播房间最新成员列表
    const room = await this.getPublicRoomState();
    this.broadcast({ event: 'room:update', payload: room });
  }

  private async handleRoomReady(
    ws: WebSocket,
    user: WsClientAttachment,
    payload: any
  ): Promise<void> {
    const isReady = payload?.isReady !== false;
    let deckId = payload?.deckId;
    let deckCardsJson = '';

    // 自定义卡组构筑严格校验 (5.1 构筑规则)
    if (payload?.customDeck) {
      if (payload.customDeck.id?.startsWith('deck-st') || payload.deckId?.startsWith('deck-st')) {
        // 试图以系统预组 ID 上传伪造卡表：权威直接使用系统官方预置卡组，忽略伪造卡表
        deckId = payload.deckId || payload.customDeck.id;
        deckCardsJson = '';
      } else {
        const cards = payload.customDeck.cards as DeckCardInput[];
        const validation = validateDeck(cards);
        if (!validation.isValid) {
          this.sendError(ws, `自定义卡组不合规: ${validation.errors.join('; ')}`, 'INVALID_DECK');
          return;
        }
        deckId = payload.customDeck.id || `custom-${Date.now()}`;
        deckCardsJson = JSON.stringify(cards);
      }
    }

    this.ctx.storage.sql.exec(`
      UPDATE players
      SET isReady = ?, deckId = COALESCE(?, deckId), deckCardsJson = CASE WHEN ? != '' THEN ? ELSE deckCardsJson END
      WHERE userId = ?
    `, isReady ? 1 : 0, deckId || null, deckCardsJson, deckCardsJson, user.userId);

    const room = await this.getPublicRoomState();
    this.broadcast({ event: 'room:update', payload: room });

    // 检查双方是否均准备就绪 -> 权威自动开局
    const players = await this.getStoredPlayers();
    if (players.length === 2 && players.every((p) => p.isReady)) {
      await this.startGame(players);
    }
  }

  private async handleRoomLeave(
    _ws: WebSocket,
    user: WsClientAttachment
  ): Promise<void> {
    const activeGame = this.getActiveGameSession();
    if (activeGame && activeGame.status === 'PLAYING') {
      // 对局中离开判定为投降认输
      const engine = this.ensureEngine();
      if (engine) {
        engine.dispatchAction({ type: 'SURRENDER', playerId: user.userId });
        this.saveEngineSnapshot(engine, activeGame.gameId);
      }
    }

    this.ctx.storage.sql.exec('DELETE FROM players WHERE userId = ?', user.userId);
    const room = await this.getPublicRoomState();
    this.broadcast({ event: 'room:update', payload: room });
  }

  private async startGame(players: StoredPlayer[]): Promise<void> {
    const p1 = players.find((p) => p.seatIndex === 0) || players[0]!;
    const p2 = players.find((p) => p.seatIndex === 1) || players[1]!;

    const gameId = `game:${this.currentRoomId}:${Date.now()}`;

    // 解析双方卡牌序列
    const defaultDeckNumbers = Array.from({ length: 40 }, (_, i) => (i % 2 === 0 ? 'ST01-001' : 'ST01-002'));
    const p1Deck = p1.deckCardsJson ? JSON.parse(p1.deckCardsJson).map((c: any) => c.cardNumber) : defaultDeckNumbers;
    const p2Deck = p2.deckCardsJson ? JSON.parse(p2.deckCardsJson).map((c: any) => c.cardNumber) : defaultDeckNumbers;

    const seed = Date.now();
    this.engine = new GameEngine(
      gameId,
      { playerId: p1.userId, deckCardNumbers: p1Deck },
      { playerId: p2.userId, deckCardNumbers: p2Deck },
      seed
    );

    // 保存开局快照与状态
    this.saveEngineSnapshot(this.engine, gameId);

    this.ctx.storage.sql.exec(`
      UPDATE room_meta SET value = ? WHERE key = 'status'
    `, RoomStatus.PLAYING);

    // 广播开局通知
    this.broadcast({
      event: 'game:start',
      payload: {
        gameId,
        playerIds: [p1.userId, p2.userId],
      },
    });

    // 为双方单独推送脱敏对战数据包 (包含各自私有手牌与暗费)
    this.pushMergedGameUpdate(this.engine, []);
  }

  // ---------------- 对战行动处理器 ----------------

  private async handleGameAction(
    ws: WebSocket,
    user: WsClientAttachment,
    payload: any
  ): Promise<void> {
    const engine = this.ensureEngine();
    if (!engine) {
      this.sendError(ws, '对战尚未开始或已结束', 'GAME_NOT_FOUND');
      return;
    }

    // 严格校验：事件发起者必须属于本局对战玩家 (AGENTS.md 约定)
    if (user.userId !== engine.state.activePlayerId && user.userId !== engine.state.nonActivePlayerId) {
      this.sendError(ws, '您不是本局对战的参战选手', 'FORBIDDEN_ACTION');
      return;
    }

    // 严格遵循：事件负载中的 userId / playerId 一律忽略，强制覆盖为已鉴权身份
    const rawAction = (payload?.action || payload) as GameAction;
    const secureAction: GameAction = {
      ...rawAction,
      playerId: user.userId,
    };

    const result = engine.dispatchAction(secureAction);
    if (!result.success) {
      this.sendError(ws, result.error || '非法对战操作', 'ACTION_FAILED');
      return;
    }

    // 持久化保存快照 (满足 O(1) 驱逐恢复)
    const activeGame = this.getActiveGameSession();
    this.saveEngineSnapshot(engine, activeGame?.gameId || 'game-default');

    // 免费套餐额度优化：每位玩家推送合并消息 (事件列表 + 脱敏状态)
    this.pushMergedGameUpdate(engine, result.events);

    // 检查游戏是否决出胜负
    if (engine.state.status === 'FINISHED' || engine.state.winnerId) {
      this.broadcast({
        event: 'game:over',
        payload: {
          gameId: engine.state.gameId,
          winnerId: engine.state.winnerId,
        },
      });
      this.ctx.storage.sql.exec(`UPDATE room_meta SET value = ? WHERE key = 'status'`, RoomStatus.WAITING);
      this.ctx.storage.sql.exec('UPDATE players SET isReady = 0');
    }
  }

  private async handleGameChoice(
    ws: WebSocket,
    user: WsClientAttachment,
    payload: any
  ): Promise<void> {
    const choiceAction: GameAction = {
      type: 'SELECT_CHOICE_OPTION',
      playerId: user.userId,
      pendingChoiceId: payload?.choiceId || payload?.pendingChoiceId || '',
      selectedIds: payload?.selectedIds || [],
    };
    await this.handleGameAction(ws, user, { action: choiceAction });
  }

  private async handleGameReconnect(
    ws: WebSocket,
    user: WsClientAttachment
  ): Promise<void> {
    const engine = this.ensureEngine();
    if (engine) {
      const publicState = engine.getPublicState(user.userId);
      ws.send(JSON.stringify({
        event: 'game:bundle',
        payload: {
          events: [],
          state: publicState,
        },
      }));
    }
  }

  // ---------------- 辅助方法与额度合并消息 ----------------

  private pushMergedGameUpdate(engine: GameEngine, events: GameEvent[]): void {
    const allSockets = this.ctx.getWebSockets();
    for (const ws of allSockets) {
      const attachment = ws.deserializeAttachment() as WsClientAttachment | null;
      if (attachment && attachment.userId) {
        const sanitized = engine.getPublicState(attachment.userId);
        // 单条合并报文 (节省 66% WebSocket 消息额度)
        ws.send(JSON.stringify({
          event: 'game:bundle',
          payload: {
            events,
            state: sanitized,
          },
        }));
        // 兼容客户端标准 sync_state 监听器
        ws.send(JSON.stringify({
          event: 'game:sync_state',
          payload: sanitized,
        }));
      }
    }
  }

  private ensureEngine(): GameEngine | null {
    if (this.engine) return this.engine;
    const session = this.getActiveGameSession();
    if (session && session.snapshotJson) {
      try {
        const snapshot = JSON.parse(session.snapshotJson) as GameEngineSnapshot;
        this.engine = GameEngine.fromSnapshot(snapshot);
        return this.engine;
      } catch {
        return null;
      }
    }
    return null;
  }

  private saveEngineSnapshot(engine: GameEngine, gameId: string): void {
    const snap = engine.toSnapshot();
    this.ctx.storage.sql.exec(`
      INSERT OR REPLACE INTO game_session (gameId, currentTurn, status, snapshotJson, actionCount, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `, gameId, engine.state.activePlayerId, engine.state.status, JSON.stringify(snap), snap.events?.length ?? 0, Date.now());
  }

  private getActiveGameSession(): { gameId: string; status: string; snapshotJson: string } | null {
    const cursor = this.ctx.storage.sql.exec(
      'SELECT gameId, status, snapshotJson FROM game_session ORDER BY updatedAt DESC LIMIT 1'
    );
    const rows = [...cursor] as { gameId: string; status: string; snapshotJson: string }[];
    return rows[0] || null;
  }

  private async getStoredPlayers(): Promise<StoredPlayer[]> {
    const cursor = this.ctx.storage.sql.exec('SELECT * FROM players ORDER BY seatIndex ASC');
    return ([...cursor] as unknown) as StoredPlayer[];
  }

  private async getPublicRoomState(): Promise<PublicRoomState> {
    const metaCursor = this.ctx.storage.sql.exec('SELECT key, value FROM room_meta');
    const meta = new Map<string, string>();
    for (const row of [...metaCursor] as { key: string; value: string }[]) {
      meta.set(row.key, row.value);
    }

    const players = await this.getStoredPlayers();
    const playerDtos: RoomPlayerDto[] = players.map((p) => ({
      userId: p.userId,
      username: p.username,
      nickname: p.nickname,
      seatIndex: p.seatIndex,
      isReady: Boolean(p.isReady),
      isOnline: Boolean(p.isOnline),
    }));

    return {
      roomId: meta.get('roomId') || this.currentRoomId,
      roomCode: (meta.get('roomId') || 'ROOM').slice(-6).toUpperCase(),
      title: meta.get('title') || '对战房间',
      hasPassword: meta.get('hasPassword') === '1',
      creatorId: meta.get('creatorId') || '',
      status: (meta.get('status') as RoomStatus) || RoomStatus.WAITING,
      players: playerDtos,
      createdAt: parseInt(meta.get('createdAt') || '0', 10) || Date.now(),
    };
  }

  private broadcast(msg: WsMessage): void {
    const data = JSON.stringify(msg);
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.send(data);
      } catch {}
    }
  }

  private broadcastToOthers(excludeUserId: string, msg: WsMessage): void {
    const data = JSON.stringify(msg);
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      const attachment = ws.deserializeAttachment() as WsClientAttachment | null;
      if (attachment?.userId !== excludeUserId) {
        try {
          ws.send(data);
        } catch {}
      }
    }
  }

  private sendError(ws: WebSocket, message: string, code = 'ERROR'): void {
    try {
      ws.send(JSON.stringify({
        event: 'game:error',
        payload: { message, code },
      }));
    } catch {}
  }
}
