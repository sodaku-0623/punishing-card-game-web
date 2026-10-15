/**
 * 端到端测试：在本地真实 Workers 运行时 (workerd，含 Durable Objects 与本地 D1) 中启动 Worker，
 * 通过 HTTP 与原生 WebSocket 按前端实际协议完成建房、密码、准备、开局、对战与结算全流程。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { unstable_dev, type Unstable_DevWorker } from 'wrangler';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_PASSWORD = 'e2e-admin-password';

type Msg = { event: string; payload: any };

class TestClient {
  readonly messages: Msg[] = [];
  private ws!: WebSocket;

  constructor(private base: string, private path: string) {}

  async open(): Promise<this> {
    this.ws = new WebSocket(`${this.base}${this.path}`);
    this.ws.addEventListener('message', (e) => this.messages.push(JSON.parse(String(e.data))));
    await new Promise<void>((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', () => reject(new Error(`WebSocket 连接失败: ${this.path}`)));
    });
    return this;
  }

  send(event: string, payload: unknown): void {
    this.ws.send(JSON.stringify({ event, payload }));
  }

  /** 当前已收到的消息数，可作为 next() 的起点 */
  mark(): number {
    return this.messages.length;
  }

  /** 等待满足条件的消息 (默认只匹配调用之后收到的消息，可通过 from 指定起点) */
  async next(event: string, predicate: (p: any) => boolean = () => true, timeoutMs = 5000, from?: number): Promise<any> {
    const start = from ?? this.messages.length;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.messages.slice(start).find((m) => m.event === event && predicate(m.payload));
      if (found) return found.payload;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`等待 ${event} 超时；已收到: ${this.messages.slice(start).map((m) => m.event).join(', ')}`);
  }

  latestState(): any {
    return [...this.messages].reverse().find((m) => m.event === 'game:bundle')?.payload.state;
  }

  close(): void {
    this.ws.close();
  }
}

describe('Cloudflare Worker 端到端 (真实 workerd 运行时)', () => {
  let worker: Unstable_DevWorker;
  let http: string;
  let wsBase: string;
  let persistDir: string;
  const clients: TestClient[] = [];

  const api = async (p: string, init?: RequestInit & { token?: string }) => {
    const headers = new Headers(init?.headers);
    headers.set('Content-Type', 'application/json');
    if (init?.token) headers.set('Authorization', `Bearer ${init.token}`);
    const res = await fetch(`${http}${p}`, { ...init, headers });
    return { status: res.status, body: (await res.json()) as any };
  };

  const connect = async (p: string) => {
    const c = await new TestClient(wsBase, p).open();
    clients.push(c);
    return c;
  };

  /** 两名游客进入同一房间并以指定卡组准备，房主开局 */
  async function startGame(roomId: string, deckIndex = 0) {
    const a = await connect(`/ws/rooms/${roomId}?guestId=guest_a_${roomId}&nickname=A`);
    const b = await connect(`/ws/rooms/${roomId}?guestId=guest_b_${roomId}&nickname=B`);
    a.send('room:join', { roomId, title: `测试房 ${roomId}` });
    await a.next('room:state_updated');
    b.send('room:join', { roomId });
    await b.next('room:state_updated', (r) => r.players.length === 2);
    const deck = OFFICIAL_STARTER_DECKS[deckIndex]!;
    for (const c of [a, b]) {
      c.send('room:ready', { roomId, isReady: true, deckId: deck.id, customDeck: deck });
    }
    await a.next('room:state_updated', (r) => r.status === 'READY');
    const [ma, mb] = [a.mark(), b.mark()];
    a.send('room:start', { roomId });
    const room = await a.next('room:state_updated', (r) => r.status === 'PLAYING', 5000, ma);
    await a.next('game:bundle', () => true, 5000, ma);
    await b.next('game:bundle', () => true, 5000, mb);
    return { a, b, gameId: room.currentGameId as string };
  }

  beforeAll(async () => {
    persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zs-worker-e2e-'));
    // 模拟前端静态导出产物 (真实产物由 scripts/build-cf-static.mjs 生成)
    const assetsDir = path.join(persistDir, 'assets');
    fs.mkdirSync(path.join(assetsDir, 'rooms'), { recursive: true });
    fs.mkdirSync(path.join(assetsDir, 'game'), { recursive: true });
    fs.writeFileSync(path.join(assetsDir, 'index.html'), '<html>HOME_PAGE</html>');
    fs.writeFileSync(path.join(assetsDir, 'rooms.html'), '<html>LOBBY_PAGE</html>');
    fs.writeFileSync(path.join(assetsDir, 'rooms', 'lobby.html'), '<html>ROOM_PLACEHOLDER</html>');
    fs.writeFileSync(path.join(assetsDir, 'game', 'room.html'), '<html>GAME_PLACEHOLDER</html>');
    fs.writeFileSync(path.join(assetsDir, 'game', 'room.txt'), 'GAME_RSC_PAYLOAD');
    fs.writeFileSync(path.join(assetsDir, '404.html'), '<html>NOT_FOUND_PAGE</html>');
    worker = await unstable_dev(path.join(__dirname, '../src/index.ts'), {
      config: path.join(__dirname, '../wrangler.toml'),
      assets: assetsDir,
      vars: { JWT_SECRET: 'e2e-jwt-secret-0123456789', ADMIN_PASSWORD },
      ip: '127.0.0.1',
      persistTo: persistDir,
      logLevel: 'warn',
      experimental: { disableExperimentalWarning: true },
    });
    http = `http://${worker.address}:${worker.port}`;
    wsBase = `ws://${worker.address}:${worker.port}`;
  }, 120_000);

  afterAll(async () => {
    clients.forEach((c) => c.close());
    await worker?.stop();
    fs.rmSync(persistDir, { recursive: true, force: true });
  });

  it('同一个 Worker 托管前端：静态页面直出，动态路由改写到占位页面，API 与 404 正常', async () => {
    const text = async (p: string) => {
      const res = await fetch(`${http}${p}`, { redirect: 'manual' });
      return { status: res.status, body: await res.text() };
    };
    expect((await text('/')).body).toContain('HOME_PAGE');
    expect((await text('/rooms')).body).toContain('LOBBY_PAGE');
    const room = await text('/rooms/123456');
    expect(room.status).toBe(200);
    expect(room.body).toContain('ROOM_PLACEHOLDER');
    expect((await text(`/game/${encodeURIComponent('game~123456~1700000000000')}`)).body).toContain('GAME_PLACEHOLDER');
    // 客户端跳转时 Next.js 请求的 RSC 数据也要改写到占位页面对应的 .txt
    expect((await text('/game/game~123456~1700000000000.txt?_rsc=abc')).body).toBe('GAME_RSC_PAYLOAD');
    expect((await api('/api/rooms')).body.success).toBe(true);
    const missing = await text('/definitely-not-a-page');
    expect(missing.status).toBe(404);
    expect(missing.body).toContain('NOT_FOUND_PAGE');
    expect((await text('/__connectivity')).body).toContain('连通性测试终端');
  });

  it('认证接口返回与 Node 版一致的 {success, data} 格式，且只用 ADMIN_PASSWORD 创建管理员', async () => {
    const reg = await api('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'alice', password: 'alice-pass' }),
    });
    expect(reg.status).toBe(201);
    expect(reg.body.success).toBe(true);
    expect(reg.body.data.user.nickname).toBe('alice');
    expect(typeof reg.body.token).toBe('string');

    const me = await api('/api/auth/me', { token: reg.body.token });
    expect(me.body.success).toBe(true);
    expect(me.body.user.username).toBe('alice');

    const profile = await api('/api/auth/profile', {
      method: 'PUT',
      token: reg.body.token,
      body: JSON.stringify({ nickname: '爱丽丝' }),
    });
    expect(profile.body.data.user.nickname).toBe('爱丽丝');

    expect((await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin888' }) })).status).toBe(401);
    expect((await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'player1', password: '123456' }) })).status).toBe(401);
    const admin = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: ADMIN_PASSWORD }),
    });
    expect(admin.body.user.role).toBe('ADMIN');

    expect((await api('/api/admin/stats')).status).toBe(401);
    expect((await api('/api/admin/stats', { token: reg.body.token })).status).toBe(403);
    const stats = await api('/api/admin/stats', { token: admin.body.token });
    expect(stats.body.data.totalCards).toBe(490);
    expect((await api('/api/admin/monitor', { token: admin.body.token })).body.data.recentErrors).toEqual([]);
  });

  it('系统预组只读，卡组写入需要登录且只能写本人名下', async () => {
    const del = await api('/api/decks/deck-st02', { method: 'DELETE' });
    expect(del.status).toBe(403);
    const anon = await api('/api/decks', { method: 'POST', body: JSON.stringify({ name: 'x', cards: [] }) });
    expect(anon.status).toBe(401);

    const bob = (await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'bob', password: 'bob-pass' }) })).body.token;
    const eve = (await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'eve', password: 'eve-pass' }) })).body.token;
    const deck = OFFICIAL_STARTER_DECKS[1]!;
    const saved = await api('/api/decks', {
      method: 'POST',
      token: bob,
      body: JSON.stringify({ id: 'bob-deck', name: '鲍勃的卡组', cards: deck.cards }),
    });
    expect(saved.body.validation.isValid).toBe(true);
    const hijack = await api('/api/decks', {
      method: 'POST',
      token: eve,
      body: JSON.stringify({ id: 'bob-deck', name: '篡改', cards: [] }),
    });
    expect(hijack.status).toBe(403);
    expect((await api('/api/decks', { method: 'POST', token: bob, body: JSON.stringify({ id: 'deck-st02', cards: [] }) })).status).toBe(403);
  });

  it('密码房：未带密码与错误密码被拒，正确密码可加入；大厅列表与房间代码可查到该房间', async () => {
    const host = await connect('/ws/rooms/700001?guestId=guest_host_1&nickname=房主');
    host.send('room:join', { roomId: '700001', title: '密码房', password: 'open-sesame' });
    const room = await host.next('room:state_updated');
    expect(room.hasPassword).toBe(true);
    expect(JSON.stringify(room)).not.toContain('open-sesame');

    const lobby = await api('/api/rooms');
    const listed = lobby.body.data.find((r: any) => r.roomId === '700001');
    expect(listed.hasPassword).toBe(true);
    expect(JSON.stringify(lobby.body)).not.toContain('open-sesame');
    expect((await api(`/api/rooms/${room.roomCode}`)).body.data.roomId).toBe('700001');

    // 通过房间代码连接也会被路由到同一个房间
    const guest = await connect(`/ws/rooms/${room.roomCode}?guestId=guest_pw_1&nickname=来宾`);
    guest.send('room:join', { roomId: room.roomCode });
    expect((await guest.next('game:error')).code).toBe('ROOM_PASSWORD_REQUIRED');
    guest.send('room:join', { roomId: room.roomCode, password: 'wrong' });
    expect((await guest.next('game:error')).code).toBe('ROOM_PASSWORD_INVALID');
    guest.send('room:join', { roomId: room.roomCode, password: 'open-sesame' });
    const joined = await guest.next('room:state_updated', (r) => r.players.length === 2);
    expect(joined.roomId).toBe('700001');
  });

  it('游客不能冒用注册账号 ID；握手携带 JWT 时以令牌身份为准', async () => {
    const login = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'alice-pass' }) });
    const aliceId = login.body.user.id;

    const spoof = await connect(`/ws/rooms/700002?guestId=${aliceId}&nickname=冒名者`);
    spoof.send('room:join', { roomId: '700002' });
    const r1 = await spoof.next('room:state_updated');
    expect(r1.players[0].userId).not.toBe(aliceId);
    expect(r1.players[0].userId.startsWith('guest_')).toBe(true);

    const real = await connect(`/ws/rooms/700003?guestId=mallory&token=${login.body.token}`);
    real.send('room:join', { roomId: '700003' });
    const r2 = await real.next('room:state_updated');
    expect(r2.players[0].userId).toBe(aliceId);
  });

  it('官方预组使用权威卡表开局：50 张牌、进入调度阶段、各自只看到自己的手牌', async () => {
    for (const [i, deck] of OFFICIAL_STARTER_DECKS.entries()) {
      const { a, b } = await startGame(`71000${i}`, i);
      const sa = a.latestState();
      const sb = b.latestState();
      expect(sa.phase).toBe('MULLIGAN_PHASE');
      expect(sa.myHandCards.length + sa.myDeckCount).toBe(50); // 调度阶段尚未放置初始明费
      const deckNumbers = new Set(deck.cards.map((c) => c.cardNumber));
      expect(sa.myHandCards.every((c: any) => deckNumbers.has(c.cardNumber))).toBe(true);
      expect(sa.opponentHandCount).toBe(sb.myHandCards.length);
      expect(JSON.stringify(sa.myHandCards)).not.toEqual(JSON.stringify(sb.myHandCards));
    }
  });

  it('不合规的自定义卡组无法准备', async () => {
    const c = await connect('/ws/rooms/700004?guestId=guest_deck_1');
    c.send('room:join', { roomId: '700004' });
    await c.next('room:state_updated');
    c.send('room:ready', {
      roomId: '700004',
      isReady: true,
      deckId: 'my-broken-deck',
      customDeck: { id: 'my-broken-deck', cards: [{ cardNumber: 'ST01-001', count: 50 }] },
    });
    const err = await c.next('game:error');
    expect(err.code).toBe('INVALID_DECK');
    expect(err.message).toContain('构筑规则');
  });

  it('对战：冒名与非本局玩家的操作被拒；调度后投降结算，战绩与回放写入 D1', async () => {
    const { a, b, gameId } = await startGame('720001', 1);
    const aId = a.latestState().myHandCards[0].controllerPlayerId;

    a.send('game:action', { gameId, action: { type: 'PASS_ACTION_TIMING', playerId: 'someone-else' } });
    expect((await a.next('game:error')).code).toBe('UNAUTHORIZED');

    const outsider = await connect('/ws/game/' + encodeURIComponent(gameId) + '?guestId=guest_outsider');
    outsider.send('game:action', { gameId, action: { type: 'SURRENDER' } });
    expect((await outsider.next('game:error')).code).toBe('UNAUTHORIZED');

    const m = a.mark();
    for (const c of [a, b]) {
      c.send('game:action', { gameId, action: { type: 'RESOLVE_MULLIGAN', cardInstanceIdsToBottom: [] } });
    }
    await a.next('game:bundle', (p) => p.state.phase !== 'MULLIGAN_PHASE', 5000, m);

    const mb = b.mark();
    a.send('game:leave', { gameId, isSurrender: true });
    const ended = await b.next('game:ended', () => true, 5000, mb);
    expect(ended.winnerId).not.toBe(aId);
    expect(ended.isDraw).toBe(false);

    const history = await api('/api/history');
    const record = history.body.data.find((h: any) => h.id === gameId);
    expect(record).toBeDefined();
    expect(record.winnerUserId).toBe(ended.winnerId);

    const replay = await api(`/api/replay/${encodeURIComponent(gameId)}`);
    expect(replay.body.success).toBe(true);
    expect(replay.body.data.actions.map((x: any) => x.actionType)).toEqual(['RESOLVE_MULLIGAN', 'RESOLVE_MULLIGAN', 'SURRENDER']);
    expect(replay.body.data.events.length).toBeGreaterThan(0);
  });

  it('对局中刷新页面：通过 /ws/game/:gameId 新连接重连并取回自己的状态', async () => {
    const { a, gameId } = await startGame('730001', 2);
    const hand = a.latestState().myHandCards.map((c: any) => c.instanceId);
    a.close();
    const userId = a.latestState().myHandCards[0].controllerPlayerId;
    const again = await connect(`/ws/game/${encodeURIComponent(gameId)}?guestId=${userId}`);
    again.send('game:reconnect', { gameId });
    const bundle = await again.next('game:bundle');
    expect(bundle.state.gameId).toBe(gameId);
    expect(bundle.state.roomId).toBe('730001');
    expect(bundle.state.myHandCards.map((c: any) => c.instanceId)).toEqual(hand);
  });

  it('频率限制：1 秒内超过 15 次操作被拦截', async () => {
    const { a, gameId } = await startGame('740001', 0);
    for (let i = 0; i < 20; i++) {
      a.send('game:action', { gameId, action: { type: 'PASS_ACTION_TIMING' } });
    }
    expect((await a.next('game:error', (e) => e.code === 'RATE_LIMIT_EXCEEDED')).code).toBe('RATE_LIMIT_EXCEEDED');
  });
});
