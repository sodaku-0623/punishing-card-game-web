import { Hono, Context } from 'hono';
import { cors } from 'hono/cors';
import { CardVersionData, PublicRoomState, RoomStatus } from '@zhanshuang/shared';
import { OFFICIAL_CARDS_DATA } from '@zhanshuang/game-engine';
import { OFFICIAL_STARTER_DECKS, findOfficialStarterDeck } from '@zhanshuang/game-rules';
import { Env } from '../types.js';
import { hashPassword, verifyPassword, signJwt, verifyJwt, getJwtSecret, JwtPayload } from '../lib/crypto-auth.js';
import { DbUser, DbDeck, DbRoom, DbMatch, initializeDatabase } from '../lib/db-client.js';
import { findOfficialCard, resolveDeck } from '../lib/cards.js';

type AppContext = Context<{ Bindings: Env }>;

/** 大厅只展示最近 6 小时内有活动的房间，避免异常残留的房间长期占位 */
const LOBBY_STALE_MS = 6 * 60 * 60 * 1000;
const RULES_ENGINE_VERSION = 'A0 First Edition (2025-11-14)';

function fail(c: AppContext, status: 400 | 401 | 403 | 404 | 409 | 501 | 503, error: string) {
  return c.json({ success: false, error }, status);
}

function clampTake(raw: string | undefined, fallback: number, max = 1000): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

function userSummary(user: Pick<DbUser, 'id' | 'username' | 'nickname' | 'role'>) {
  return { id: user.id, username: user.username, nickname: user.nickname, role: user.role };
}

/** 解析 Authorization 头中的 JWT，未登录或无效时返回 null */
async function readAuth(c: AppContext): Promise<JwtPayload | null> {
  const secret = getJwtSecret(c.env);
  const header = c.req.header('Authorization');
  if (!secret || !header?.startsWith('Bearer ')) return null;
  return verifyJwt(header.substring(7), secret);
}

async function issueToken(c: AppContext, user: Pick<DbUser, 'id' | 'username' | 'nickname' | 'role'>) {
  const secret = getJwtSecret(c.env);
  if (!secret) return null;
  return signJwt({ sub: user.id, username: user.username, nickname: user.nickname, role: user.role }, secret);
}

function authResponse(c: AppContext, token: string, user: ReturnType<typeof userSummary>, status: 200 | 201 = 200) {
  // 与 Node 服务端返回格式一致：顶层与 data 内均提供 token / user
  return c.json({ success: true, token, user, data: { token, user } }, status);
}

function toPublicRoom(r: DbRoom): PublicRoomState {
  return {
    roomId: r.room_id,
    roomCode: r.room_code,
    title: r.title,
    hasPassword: Boolean(r.has_password),
    creatorId: r.creator_id,
    status: r.status as RoomStatus,
    players: JSON.parse(r.players_json || '[]'),
    currentGameId: r.current_game_id ?? undefined,
    createdAt: r.created_at,
  };
}

function officialDeckDto(deckId: string) {
  const deck = findOfficialStarterDeck(deckId);
  if (!deck) return null;
  return {
    id: deck.id,
    userId: 'system',
    name: deck.name,
    description: deck.description,
    isValid: true,
    cards: deck.cards,
  };
}

function userDeckDto(d: DbDeck) {
  return {
    id: d.id,
    userId: d.user_id,
    name: d.name,
    isValid: Boolean(d.is_valid),
    cards: JSON.parse(d.cards_json || '[]'),
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}

function cardDto(card: CardVersionData) {
  return { ...card, isActive: true };
}

export function createApiApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.use(
    '*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
    })
  );

  app.onError((err, c) => {
    console.error('API Error:', err);
    return c.json({ success: false, error: '服务端内部错误' }, 500);
  });

  // 连通性测试页使用的时间与节点信息接口 (不依赖数据库)
  app.get('/api/time', (c) => {
    const cf = (c.req.raw as any).cf;
    return c.json({
      success: true,
      ok: true,
      timestamp: Date.now(),
      iso: new Date().toISOString(),
      edgeInfo: { colo: cf?.colo || 'LOCAL', country: cf?.country || 'UNKNOWN', city: cf?.city || 'UNKNOWN' },
    });
  });

  // 首次访问时初始化 D1 表结构 (每个 isolate 只执行一次)
  app.use('/api/*', async (c, next) => {
    if (c.env?.DB) {
      await initializeDatabase(c.env.DB, c.env.ADMIN_PASSWORD);
    }
    await next();
  });

  // ---------------- 1. 鉴权 (/api/auth) ----------------

  app.post('/api/auth/register', async (c) => {
    if (!getJwtSecret(c.env)) return fail(c, 503, '服务端未配置 JWT_SECRET，暂无法注册');
    const body = await c.req.json().catch(() => ({}));
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) return fail(c, 400, '用户名和密码不能为空');
    if (username.length < 3 || username.length > 32) return fail(c, 400, '用户名长度需为 3~32 个字符');
    if (password.length < 6 || password.length > 128) return fail(c, 400, '密码长度需为 6~128 个字符');
    const nickname = (typeof body.nickname === 'string' && body.nickname.trim()) || username;

    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
    if (existing) return fail(c, 409, '用户名已被注册，请尝试其他名称');

    const user = {
      id: `user-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      username,
      nickname: nickname.slice(0, 32),
      role: 'USER' as const,
    };
    await c.env.DB.prepare(
      'INSERT INTO users (id, username, password_hash, nickname, role, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(user.id, user.username, await hashPassword(password), user.nickname, user.role, Date.now())
      .run();

    const token = await issueToken(c, user);
    return authResponse(c, token!, userSummary(user), 201);
  });

  app.post('/api/auth/login', async (c) => {
    if (!getJwtSecret(c.env)) return fail(c, 503, '服务端未配置 JWT_SECRET，暂无法登录');
    const body = await c.req.json().catch(() => ({}));
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!username || !password) return fail(c, 400, '请输入用户名和密码');

    const user = await c.env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<DbUser>();
    const verification = user ? await verifyPassword(password, user.password_hash) : { ok: false, needsRehash: false };
    if (!user || !verification.ok) return fail(c, 401, '用户名或密码错误');

    if (verification.needsRehash) {
      await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .bind(await hashPassword(password), user.id)
        .run();
    }

    const token = await issueToken(c, user);
    return authResponse(c, token!, userSummary(user));
  });

  app.get('/api/auth/me', async (c) => {
    const auth = await readAuth(c);
    if (!auth) return fail(c, 401, '未登录或登录凭据已过期，请重新登录');
    const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(auth.sub).first<DbUser>();
    if (!user) return fail(c, 401, '用户不存在或已被删除');
    const summary = userSummary(user);
    return c.json({ success: true, user: summary, data: { user: summary } });
  });

  app.put('/api/auth/profile', async (c) => {
    const auth = await readAuth(c);
    if (!auth) return fail(c, 401, '未登录或登录凭据已过期，请重新登录');
    const body = await c.req.json().catch(() => ({}));
    const nickname = typeof body.nickname === 'string' ? body.nickname.trim().slice(0, 32) : '';
    if (!nickname) return fail(c, 400, '昵称/指挥官名称不能为空');

    await c.env.DB.prepare('UPDATE users SET nickname = ? WHERE id = ?').bind(nickname, auth.sub).run();
    const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(auth.sub).first<DbUser>();
    if (!user) return fail(c, 404, '用户不存在');
    const token = await issueToken(c, user);
    return authResponse(c, token!, userSummary(user));
  });

  // ---------------- 2. 大厅房间 (/api/rooms) ----------------
  // 房间的创建、加入与密码校验只通过 WebSocket 在房间 Durable Object 内完成；
  // D1 中的 lobby_rooms 仅为大厅展示用的投影。

  app.get('/api/rooms', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM lobby_rooms
       WHERE player_count > 0 AND status != 'CLOSED' AND updated_at > ?
       ORDER BY updated_at DESC LIMIT 100`
    )
      .bind(Date.now() - LOBBY_STALE_MS)
      .all<DbRoom>();
    return c.json({ success: true, data: (results || []).map(toPublicRoom) });
  });

  app.get('/api/rooms/:idOrCode', async (c) => {
    const key = c.req.param('idOrCode').trim();
    const room = await c.env.DB.prepare('SELECT * FROM lobby_rooms WHERE room_id = ? OR room_code = ?')
      .bind(key, key.toUpperCase())
      .first<DbRoom>();
    if (!room || room.player_count === 0) return fail(c, 404, '指定 Room ID 或房间代码不存在');
    return c.json({ success: true, data: toPublicRoom(room) });
  });

  // ---------------- 3. 卡组 (/api/decks) ----------------

  app.get('/api/decks', async (c) => {
    const auth = await readAuth(c);
    const official = OFFICIAL_STARTER_DECKS.map((d) => officialDeckDto(d.id)!);
    if (!auth) return c.json({ success: true, data: official });
    const { results } = await c.env.DB.prepare('SELECT * FROM decks WHERE user_id = ? ORDER BY updated_at DESC')
      .bind(auth.sub)
      .all<DbDeck>();
    return c.json({ success: true, data: [...official, ...(results || []).map(userDeckDto)] });
  });

  app.get('/api/decks/:id', async (c) => {
    const id = c.req.param('id');
    const official = officialDeckDto(id);
    if (official) return c.json({ success: true, data: official });
    const deck = await c.env.DB.prepare('SELECT * FROM decks WHERE id = ?').bind(id).first<DbDeck>();
    if (!deck) return fail(c, 404, '卡组不存在');
    return c.json({ success: true, data: userDeckDto(deck) });
  });

  /** 保存卡组 (需登录；只能写入本人名下，系统预组只读) */
  async function saveDeck(c: AppContext, deckId: string | undefined, body: any) {
    const auth = await readAuth(c);
    if (!auth) return fail(c, 401, '请登录后再将卡组同步到服务器');
    if (deckId && findOfficialStarterDeck(deckId)) return fail(c, 403, '系统预组只读，不可修改');
    if (!Array.isArray(body.cards)) return fail(c, 400, '卡牌列表格式不正确');

    const existing = deckId
      ? await c.env.DB.prepare('SELECT * FROM decks WHERE id = ?').bind(deckId).first<DbDeck>()
      : null;
    if (existing && existing.user_id !== auth.sub) return fail(c, 403, '无权修改其他玩家的卡组');

    const { deck, error } = resolveDeck(undefined, { id: deckId, name: body.name, cards: body.cards });
    const isValid = Boolean(deck);
    const id = deckId || `deck-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const name = String(body.name || existing?.name || '我的自定义卡组').slice(0, 64);
    const now = Date.now();
    await c.env.DB.prepare(
      `INSERT INTO decks (id, user_id, name, cards_json, is_valid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, cards_json = excluded.cards_json,
         is_valid = excluded.is_valid, updated_at = excluded.updated_at`
    )
      .bind(id, auth.sub, name, JSON.stringify(body.cards.slice(0, 200)), isValid ? 1 : 0, existing?.created_at ?? now, now)
      .run();

    const saved = await c.env.DB.prepare('SELECT * FROM decks WHERE id = ?').bind(id).first<DbDeck>();
    return c.json({
      success: true,
      data: userDeckDto(saved!),
      validation: { isValid, errors: error ? [error] : [] },
    });
  }

  app.post('/api/decks', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return saveDeck(c, typeof body.id === 'string' ? body.id : undefined, body);
  });

  app.put('/api/decks/:id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return saveDeck(c, c.req.param('id'), body);
  });

  app.delete('/api/decks/:id', async (c) => {
    const id = c.req.param('id');
    if (findOfficialStarterDeck(id)) return fail(c, 403, '系统预组不可删除');
    const auth = await readAuth(c);
    if (!auth) return fail(c, 401, '请先登录');
    const deck = await c.env.DB.prepare('SELECT user_id FROM decks WHERE id = ?').bind(id).first<DbDeck>();
    if (!deck) return fail(c, 404, '卡组不存在');
    if (deck.user_id !== auth.sub) return fail(c, 403, '无权删除其他玩家的卡组');
    await c.env.DB.prepare('DELETE FROM decks WHERE id = ?').bind(id).run();
    return c.json({ success: true });
  });

  // ---------------- 4. 卡牌库 (/api/cards，直接读取引擎内置卡表，不消耗 D1 额度) ----------------

  app.get('/api/cards', (c) => {
    const query = c.req.query('query')?.trim().toLowerCase();
    const cardType = c.req.query('cardType');
    const attribute = c.req.query('attribute');
    const costRaw = c.req.query('cost');
    let cards = OFFICIAL_CARDS_DATA;
    if (query) {
      cards = cards.filter(
        (card) => card.name.toLowerCase().includes(query) || card.cardNumber.toLowerCase().includes(query)
      );
    }
    if (cardType) cards = cards.filter((card) => card.cardType === cardType);
    if (attribute) cards = cards.filter((card) => card.attribute === attribute);
    if (costRaw !== undefined && costRaw !== '') cards = cards.filter((card) => card.cost === Number(costRaw));
    const take = clampTake(c.req.query('take'), 200);
    return c.json({ success: true, data: cards.slice(0, take).map(cardDto), total: cards.length });
  });

  app.get('/api/cards/:id', (c) => {
    const card = findOfficialCard(c.req.param('id'));
    if (!card) return fail(c, 404, 'Card not found');
    return c.json({ success: true, data: cardDto(card) });
  });

  // ---------------- 5. 对局历史与回放 ----------------

  app.get('/api/history', async (c) => {
    const limit = clampTake(c.req.query('limit'), 50, 200);
    const { results } = await c.env.DB.prepare(
      `SELECT id, room_id, rng_seed, winner_id, is_draw, finish_reason, started_at, finished_at
       FROM matches ORDER BY finished_at DESC LIMIT ?`
    )
      .bind(limit)
      .all<DbMatch>();
    return c.json({
      success: true,
      data: (results || []).map((m) => ({
        id: m.id,
        roomId: m.room_id,
        rngSeed: m.rng_seed,
        winnerUserId: m.winner_id,
        isDraw: Boolean(m.is_draw),
        finishReason: m.finish_reason,
        startedAt: new Date(m.started_at).toISOString(),
        finishedAt: new Date(m.finished_at).toISOString(),
      })),
    });
  });

  app.get('/api/replay/:gameId', async (c) => {
    const m = await c.env.DB.prepare('SELECT * FROM matches WHERE id = ?').bind(c.req.param('gameId')).first<DbMatch>();
    if (!m) return fail(c, 404, 'Replay not found');
    const replay = m.replay_json ? JSON.parse(m.replay_json) : { actions: [], events: [] };
    return c.json({
      success: true,
      data: {
        game: {
          id: m.id,
          roomId: m.room_id,
          rngSeed: m.rng_seed,
          winnerUserId: m.winner_id,
          isDraw: Boolean(m.is_draw),
          finishReason: m.finish_reason,
          startedAt: new Date(m.started_at).toISOString(),
          finishedAt: new Date(m.finished_at).toISOString(),
        },
        players: [
          { userId: m.player1_id, deckId: m.player1_deck_id, seatOrder: 0 },
          { userId: m.player2_id, deckId: m.player2_deck_id, seatOrder: 1 },
        ],
        actions: replay.actions ?? [],
        events: replay.events ?? [],
      },
    });
  });

  // ---------------- 6. 管理后台 (/api/admin/*，需管理员身份) ----------------

  app.use('/api/admin/*', async (c, next) => {
    const auth = await readAuth(c);
    if (!auth) return fail(c, 401, '未登录或登录凭据已过期，请以管理员身份登录');
    if (auth.role !== 'ADMIN') return fail(c, 403, '权限不足：仅系统管理员账号可执行此操作');
    return await next();
  });

  async function countActiveRooms(c: AppContext) {
    const row = await c.env.DB.prepare(
      `SELECT COUNT(*) AS rooms, SUM(CASE WHEN status = 'PLAYING' THEN 1 ELSE 0 END) AS games
       FROM lobby_rooms WHERE player_count > 0 AND status != 'CLOSED' AND updated_at > ?`
    )
      .bind(Date.now() - LOBBY_STALE_MS)
      .first<{ rooms: number; games: number | null }>();
    return { activeRooms: row?.rooms ?? 0, activeGames: row?.games ?? 0 };
  }

  app.get('/api/admin/stats', async (c) => {
    const { activeRooms, activeGames } = await countActiveRooms(c);
    return c.json({
      success: true,
      data: {
        totalCards: OFFICIAL_CARDS_DATA.length,
        activeCards: OFFICIAL_CARDS_DATA.length,
        inactiveCards: 0,
        activeRooms,
        activeGames,
        // Workers 为无状态边缘运行时，没有进程级运行时长与内存占用指标
        uptimeSeconds: 0,
        memoryRssMb: 0,
        rulesEngineVersion: RULES_ENGINE_VERSION,
        serverTimestamp: Date.now(),
      },
    });
  });

  app.get('/api/admin/monitor', async (c) => {
    const { activeRooms, activeGames } = await countActiveRooms(c);
    return c.json({
      success: true,
      data: {
        timestamp: Date.now(),
        uptimeSeconds: 0,
        activeRooms,
        activeGames,
        connectedPlayers: 0,
        messagesPerSec: 0,
        reconnectRate: 0,
        errorRate: 0,
        avgActionLatencyMs: 0,
        p95ActionLatencyMs: 0,
        p99ActionLatencyMs: 0,
        avgEngineResolutionMs: 0,
        p95EngineResolutionMs: 0,
        p99EngineResolutionMs: 0,
        cpuPercent: 0,
        memoryRssMb: 0,
        memoryHeapUsedMb: 0,
        memoryHeapTotalMb: 0,
        eventLoopLagMs: 0,
        avgWebSocketMessageSizeBytes: 0,
        totalMessagesSent: 0,
        recentErrors: [],
      },
    });
  });

  app.get('/api/admin/cards', (c) => {
    return c.json({ success: true, data: OFFICIAL_CARDS_DATA.map(cardDto), total: OFFICIAL_CARDS_DATA.length });
  });

  app.get('/api/admin/cards/:id/versions', (c) => c.json({ success: true, data: [] }));

  // 卡表随代码部署，Cloudflare 版不支持在线编辑
  const readOnlyCards = (c: AppContext) =>
    fail(c, 501, 'Cloudflare 版卡表随代码部署，暂不支持在线新增或修改卡牌；请修改卡表数据后重新部署');
  app.post('/api/admin/cards', readOnlyCards);
  app.post('/api/admin/cards/batch', readOnlyCards);
  app.put('/api/admin/cards/:id', readOnlyCards);

  app.all('/api/*', (c) => fail(c, 404, '接口不存在'));

  return app;
}
