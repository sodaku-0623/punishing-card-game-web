import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { validateDeck, DeckCardInput } from '@zhanshuang/game-rules';
import { Env } from '../types.js';
import { hashPassword, verifyPassword, signJwt, verifyJwt } from '../lib/crypto-auth.js';
import { DbUser, DbDeck, DbRoom, DbGameRecord, initializeDatabase } from '../lib/db-client.js';
import { OFFICIAL_SEED_CARDS } from '@zhanshuang/database';

export function createApiApp() {
  const app = new Hono<{ Bindings: Env }>();

  // 跨域支持
  app.use('*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }));

  // 全局异常捕获处理 (避免返回未经处理的 500 空白响应)
  app.onError((err, c) => {
    console.error('API Error:', err);
    return c.json({
      ok: false,
      error: err.message || '内部服务异常',
    }, 500);
  });

  // 连通性测试时间戳与节点 API (独立运行，不依赖数据库连接)
  app.get('/api/time', (c) => {
    const cf = (c.req.raw as any).cf;
    return c.json({
      ok: true,
      timestamp: Date.now(),
      iso: new Date().toISOString(),
      edgeInfo: {
        colo: cf?.colo || 'LOCAL',
        country: cf?.country || 'CN',
        city: cf?.city || 'Localhost',
      },
    });
  });

  // 数据库自动预置守卫中间件
  app.use('*', async (c, next) => {
    if (c.env?.DB && typeof c.env.DB.prepare === 'function') {
      try {
        await initializeDatabase(c.env.DB, c.env.ADMIN_PASSWORD);
      } catch (err: any) {
        console.error('D1 initialization error:', err);
      }
    }
    await next();
  });

  // ---------------- 1. 鉴权认证 API (/api/auth) ----------------

  app.post('/api/auth/register', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { username, password, nickname } = body;

    if (!username || !password || !nickname) {
      return c.json({ ok: false, error: '用户名、密码与昵称不能为空' }, 400);
    }

    const existing = await c.env.DB
      .prepare('SELECT id FROM users WHERE username = ?')
      .bind(username.trim())
      .first<DbUser>();

    if (existing) {
      return c.json({ ok: false, error: '该用户名已被注册' }, 409);
    }

    const userId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const pwdHash = await hashPassword(password);
    const now = Date.now();

    await c.env.DB
      .prepare('INSERT INTO users (id, username, password_hash, nickname, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(userId, username.trim(), pwdHash, nickname.trim(), 'USER', now)
      .run();

    const secret = c.env.JWT_SECRET || 'zhanshuang_jwt_default_secret_2026';
    const token = await signJwt({
      sub: userId,
      username: username.trim(),
      nickname: nickname.trim(),
      role: 'USER',
    }, secret);

    return c.json({
      ok: true,
      user: { id: userId, username: username.trim(), nickname: nickname.trim(), role: 'USER' },
      token,
    }, 201);
  });

  app.post('/api/auth/login', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { username, password } = body;

    if (!username || !password) {
      return c.json({ ok: false, error: '请输入用户名与密码' }, 400);
    }

    const user = await c.env.DB
      .prepare('SELECT * FROM users WHERE username = ?')
      .bind(username.trim())
      .first<DbUser>();

    if (!user) {
      return c.json({ ok: false, error: '用户名或密码错误' }, 401);
    }

    const verification = await verifyPassword(password, user.password_hash);
    if (!verification.ok) {
      return c.json({ ok: false, error: '用户名或密码错误' }, 401);
    }

    // 若使用的是旧哈希格式，自动升级为高安全性随机盐 PBKDF2 哈希
    if (verification.needsRehash) {
      const newHash = await hashPassword(password);
      await c.env.DB
        .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        .bind(newHash, user.id)
        .run();
    }

    const secret = c.env.JWT_SECRET || 'zhanshuang_jwt_default_secret_2026';
    const token = await signJwt({
      sub: user.id,
      username: user.username,
      nickname: user.nickname,
      role: user.role,
    }, secret);

    return c.json({
      ok: true,
      user: { id: user.id, username: user.username, nickname: user.nickname, role: user.role },
      token,
    });
  });

  app.get('/api/auth/me', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ ok: false, error: '未提供身份验证凭证' }, 401);
    }

    const token = authHeader.substring(7);
    const secret = c.env.JWT_SECRET || 'zhanshuang_jwt_default_secret_2026';
    const payload = await verifyJwt(token, secret);

    if (!payload) {
      return c.json({ ok: false, error: '登录凭据已过期或无效' }, 401);
    }

    return c.json({
      ok: true,
      user: {
        id: payload.sub,
        username: payload.username,
        nickname: payload.nickname,
        role: payload.role,
      },
    });
  });

  // ---------------- 2. 大厅房间 API (/api/rooms) ----------------

  app.get('/api/rooms', async (c) => {
    const cursor = await c.env.DB
      .prepare('SELECT room_id, room_code, title, has_password, creator_id, status, player_count, players_json, created_at FROM rooms ORDER BY created_at DESC LIMIT 100')
      .all<DbRoom>();

    const rooms = (cursor.results || []).map((r) => ({
      roomId: r.room_id,
      roomCode: r.room_code,
      title: r.title,
      hasPassword: Boolean(r.has_password),
      creatorId: r.creator_id,
      status: r.status,
      playerCount: r.player_count,
      players: JSON.parse(r.players_json || '[]'),
      createdAt: r.created_at,
    }));

    return c.json({ ok: true, rooms });
  });

  app.get('/api/rooms/:id', async (c) => {
    const id = c.req.param('id');
    const room = await c.env.DB
      .prepare('SELECT room_id, room_code, title, has_password, creator_id, status, player_count, players_json, created_at FROM rooms WHERE room_id = ?')
      .bind(id)
      .first<DbRoom>();

    if (!room) {
      return c.json({ ok: false, error: '房间不存在' }, 404);
    }

    return c.json({
      ok: true,
      room: {
        roomId: room.room_id,
        roomCode: room.room_code,
        title: room.title,
        hasPassword: Boolean(room.has_password),
        creatorId: room.creator_id,
        status: room.status,
        playerCount: room.player_count,
        players: JSON.parse(room.players_json || '[]'),
        createdAt: room.created_at,
      },
    });
  });

  app.post('/api/rooms', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { title, password, creatorId, creatorName } = body;

    const roomId = `room-${Date.now()}`;
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const hasPassword = Boolean(password && password.trim());
    let passwordHash = '';
    if (hasPassword) {
      const encoder = new TextEncoder();
      const buf = await crypto.subtle.digest('SHA-256', encoder.encode(password.trim()));
      passwordHash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }

    const hostUser = creatorId || 'guest_host';
    const hostName = creatorName || '房主';
    const now = Date.now();

    const players = [{
      userId: hostUser,
      username: hostUser,
      nickname: hostName,
      seatIndex: 0,
      isReady: false,
      isOnline: true,
    }];

    await c.env.DB
      .prepare(`
        INSERT INTO rooms (
          room_id, room_code, title, has_password, password_hash,
          creator_id, status, player_count, players_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'WAITING', 1, ?, ?, ?)
      `)
      .bind(
        roomId,
        roomCode,
        title || '战双对战房间',
        hasPassword ? 1 : 0,
        passwordHash,
        hostUser,
        JSON.stringify(players),
        now,
        now
      )
      .run();

    return c.json({
      ok: true,
      room: {
        roomId,
        roomCode,
        title: title || '战双对战房间',
        hasPassword,
        creatorId: hostUser,
        status: 'WAITING',
        playerCount: 1,
        players,
        createdAt: now,
      },
    }, 201);
  });

  // ---------------- 3. 卡组管理 API (/api/decks) ----------------

  app.get('/api/decks', async (c) => {
    // 提取当前用户身份
    let currentUserId = 'system';
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const secret = c.env.JWT_SECRET || 'zhanshuang_jwt_default_secret_2026';
      const payload = await verifyJwt(authHeader.substring(7), secret);
      if (payload) currentUserId = payload.sub;
    }

    // 默认展示系统预组 + 当前用户的个人卡组
    const cursor = await c.env.DB
      .prepare('SELECT * FROM decks WHERE user_id = ? OR user_id = "system" ORDER BY created_at DESC')
      .bind(currentUserId)
      .all<DbDeck>();

    const decks = (cursor.results || []).map((d) => ({
      id: d.id,
      userId: d.user_id,
      name: d.name,
      cards: JSON.parse(d.cards_json || '[]'),
      isValid: Boolean(d.is_valid),
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    }));

    return c.json({ ok: true, decks });
  });

  app.get('/api/decks/:id', async (c) => {
    const id = c.req.param('id');
    const deck = await c.env.DB
      .prepare('SELECT * FROM decks WHERE id = ?')
      .bind(id)
      .first<DbDeck>();

    if (!deck) {
      return c.json({ ok: false, error: '卡组不存在' }, 404);
    }

    return c.json({
      ok: true,
      deck: {
        id: deck.id,
        userId: deck.user_id,
        name: deck.name,
        cards: JSON.parse(deck.cards_json || '[]'),
        isValid: Boolean(deck.is_valid),
        createdAt: deck.created_at,
        updatedAt: deck.updated_at,
      },
    });
  });

  app.post('/api/decks', async (c) => {
    let currentUserId = 'anonymous_user';
    const authHeader = c.req.header('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      const secret = c.env.JWT_SECRET || 'zhanshuang_jwt_default_secret_2026';
      const payload = await verifyJwt(authHeader.substring(7), secret);
      if (payload) currentUserId = payload.sub;
    }

    const body = await c.req.json().catch(() => ({}));
    const { name, cards } = body;

    if (body.id) {
      const existing = await c.env.DB.prepare('SELECT user_id FROM decks WHERE id = ?').bind(body.id).first<{ user_id: string }>();
      if (existing?.user_id === 'system' || body.id.startsWith('deck-st')) {
        return c.json({ ok: false, error: '系统预置卡组只读，不可覆盖' }, 403);
      }
    }

    if (!cards || !Array.isArray(cards)) {
      return c.json({ ok: false, error: '卡牌列表格式不正确' }, 400);
    }

    // 5.1 构筑校验
    const validation = validateDeck(cards as DeckCardInput[]);
    const deckId = body.id || `deck-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const now = Date.now();

    await c.env.DB
      .prepare('INSERT INTO decks (id, user_id, name, cards_json, is_valid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(deckId, currentUserId, name || '我的自定义卡组', JSON.stringify(cards), validation.isValid ? 1 : 0, now, now)
      .run();

    return c.json({
      ok: true,
      deck: {
        id: deckId,
        userId: currentUserId,
        name: name || '我的自定义卡组',
        cards,
        isValid: validation.isValid,
        errors: validation.errors,
        createdAt: now,
      },
    }, 201);
  });

  app.put('/api/decks/:id', async (c) => {
    const id = c.req.param('id');
    const deck = await c.env.DB.prepare('SELECT * FROM decks WHERE id = ?').bind(id).first<DbDeck>();
    if (!deck) return c.json({ ok: false, error: '卡组不存在' }, 404);

    // 系统预组只读不可篡改 (AGENTS.md 安全规范)
    if (deck.user_id === 'system') {
      return c.json({ ok: false, error: '系统预置卡组只读，不可修改' }, 403);
    }

    const body = await c.req.json().catch(() => ({}));
    const { name, cards } = body;
    const cardsToSave = cards || JSON.parse(deck.cards_json);
    const validation = validateDeck(cardsToSave as DeckCardInput[]);
    const now = Date.now();

    await c.env.DB
      .prepare('UPDATE decks SET name = COALESCE(?, name), cards_json = ?, is_valid = ?, updated_at = ? WHERE id = ?')
      .bind(name || null, JSON.stringify(cardsToSave), validation.isValid ? 1 : 0, now, id)
      .run();

    return c.json({ ok: true, message: '卡组更新成功' });
  });

  app.delete('/api/decks/:id', async (c) => {
    const id = c.req.param('id');
    const deck = await c.env.DB.prepare('SELECT * FROM decks WHERE id = ?').bind(id).first<DbDeck>();
    if (!deck) return c.json({ ok: false, error: '卡组不存在' }, 404);

    // 系统预组只读不可删除 (AGENTS.md 安全规范)
    if (deck.user_id === 'system') {
      return c.json({ ok: false, error: '系统预置卡组只读，不可删除' }, 403);
    }

    await c.env.DB.prepare('DELETE FROM decks WHERE id = ?').bind(id).run();
    return c.json({ ok: true, message: '卡组已删除' });
  });

  // ---------------- 4. 卡牌库 API (/api/cards) ----------------
  // 采用内存官方卡表直接响应：0ms 延迟，零 D1 数据库额度消耗
  app.get('/api/cards', (c) => {
    const search = c.req.query('search')?.trim().toLowerCase();
    const type = c.req.query('type')?.trim();
    const limit = Math.min(1000, Math.max(1, parseInt(c.req.query('limit') || '100', 10)));

    let filtered = OFFICIAL_SEED_CARDS as any[];
    if (search) {
      filtered = filtered.filter((card) =>
        (card.name && card.name.toLowerCase().includes(search)) ||
        (card.cardNumber && card.cardNumber.toLowerCase().includes(search))
      );
    }
    if (type) {
      filtered = filtered.filter((card) => card.cardType === type);
    }

    return c.json({
      ok: true,
      cards: filtered.slice(0, limit),
      total: filtered.length,
    });
  });

  app.get('/api/cards/:id', (c) => {
    const id = c.req.param('id').toLowerCase();
    const card = (OFFICIAL_SEED_CARDS as any[]).find((cItem) =>
      cItem.id?.toLowerCase() === id || cItem.cardNumber?.toLowerCase() === id
    );

    if (!card) {
      return c.json({ ok: false, error: '未找到指定卡牌' }, 404);
    }

    return c.json({ ok: true, card });
  });

  // ---------------- 5. 历史战绩与回放 API (/api/history, /api/replays) ----------------

  app.get('/api/history', async (c) => {
    const cursor = await c.env.DB
      .prepare('SELECT id, room_id, player1_id, player2_id, winner_id, turns, created_at FROM game_records ORDER BY created_at DESC LIMIT 50')
      .all<DbGameRecord>();

    return c.json({ ok: true, history: cursor.results || [] });
  });

  app.get('/api/replays/:id', async (c) => {
    const id = c.req.param('id');
    const record = await c.env.DB
      .prepare('SELECT * FROM game_records WHERE id = ? OR room_id = ?')
      .bind(id, id)
      .first<DbGameRecord>();

    if (!record || !record.replay_json) {
      return c.json({ ok: false, error: '未找到对局回放数据' }, 404);
    }

    return c.json({
      ok: true,
      replay: {
        gameId: record.id,
        roomId: record.room_id,
        player1Id: record.player1_id,
        player2_id: record.player2_id,
        winnerId: record.winner_id,
        turns: record.turns,
        data: JSON.parse(record.replay_json),
      },
    });
  });

  // ---------------- 6. 管理后台 API (/api/admin/*) ----------------

  // 管理员鉴权中间件 (AGENTS.md 约定：/api/admin/* 一律挂 verifyAdmin)
  app.use('/api/admin/*', async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ ok: false, error: '未提供管理员认证令牌' }, 401);
    }

    const token = authHeader.substring(7);
    const secret = c.env.JWT_SECRET || 'zhanshuang_jwt_default_secret_2026';
    const payload = await verifyJwt(token, secret);

    if (!payload || payload.role !== 'ADMIN') {
      return c.json({ ok: false, error: '拒绝访问：需要管理员最高权限' }, 403);
    }

    return await next();
  });

  app.get('/api/admin/stats', async (c) => {
    const [userRow, deckRow, matchRow] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as c FROM users').first<{ c: number }>(),
      c.env.DB.prepare('SELECT COUNT(*) as c FROM decks').first<{ c: number }>(),
      c.env.DB.prepare('SELECT COUNT(*) as c FROM game_records').first<{ c: number }>(),
    ]);

    return c.json({
      ok: true,
      stats: {
        users: userRow?.c ?? 0,
        decks: deckRow?.c ?? 0,
        cards: OFFICIAL_SEED_CARDS.length,
        matches: matchRow?.c ?? 0,
      },
    });
  });

  app.get('/api/admin/cards', async (_c) => {
    return _c.json({ ok: true, cards: OFFICIAL_SEED_CARDS });
  });

  app.get('/api/admin/monitor', async (_c) => {
    return _c.json({
      ok: true,
      monitor: {
        runtime: 'Cloudflare Workers (Edge)',
        memoryUsage: 'Serverless Auto-scaled',
        activeRooms: 'Managed by Durable Objects',
        timestamp: Date.now(),
      },
    });
  });

  return app;
}
