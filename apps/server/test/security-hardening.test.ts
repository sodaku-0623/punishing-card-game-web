import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { io as ClientSocket, Socket } from 'socket.io-client';
import { createServerApp, AppComponents, hashPassword, verifyPassword } from '../src/app.js';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import { MemoryGameRepository } from '@zhanshuang/database';
import {
  ClientToServerEvents,
  ServerToClientEvents,
  PublicRoomState,
  ErrorCode,
} from '@zhanshuang/shared';

type TypedClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('安全加固回归测试 (Socket 身份 / 房间密码 / 卡组归属 / 密码存储)', () => {
  let app: AppComponents;
  let serverUrl: string;
  const sockets: TypedClientSocket[] = [];

  async function connect(opts: { query?: Record<string, string>; token?: string }): Promise<TypedClientSocket> {
    const s: TypedClientSocket = ClientSocket(serverUrl, {
      query: opts.query,
      auth: opts.token ? { token: opts.token } : undefined,
      transports: ['websocket'],
      forceNew: true,
    });
    sockets.push(s);
    await new Promise<void>((resolve) => s.on('connect', resolve));
    return s;
  }

  function nextError(s: TypedClientSocket): Promise<{ code: string; message: string }> {
    return new Promise((resolve) => s.once('game:error', resolve));
  }

  function nextRoomState(s: TypedClientSocket): Promise<PublicRoomState> {
    return new Promise((resolve) => s.once('room:state_updated', resolve));
  }

  beforeAll(async () => {
    app = await createServerApp();
    await app.fastify.listen({ port: 0, host: '127.0.0.1' });
    const address = app.fastify.server.address();
    const port = typeof address === 'object' && address ? address.port : 4000;
    serverUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(() => {
    while (sockets.length) {
      const s = sockets.pop()!;
      if (s.connected) s.disconnect();
    }
  });

  afterAll(async () => {
    app.io.close();
    await app.fastify.close();
  });

  it('密码使用异步 scrypt 加盐存储，兼容旧版 HMAC 摘要并防御畸形存储串', async () => {
    const stored = await hashPassword('secret-123');
    expect(stored.startsWith('scrypt:')).toBe(true);
    expect(await hashPassword('secret-123')).not.toBe(stored); // 每次随机盐
    expect(await verifyPassword('secret-123', stored)).toEqual({ ok: true, needsRehash: false });
    expect((await verifyPassword('wrong', stored)).ok).toBe(false);

    const legacy = crypto.createHmac('sha256', 'zhanshuang_tcg_salt_2026').update('old-pass').digest('hex');
    expect(await verifyPassword('old-pass', legacy)).toEqual({ ok: true, needsRehash: true });
    expect((await verifyPassword('nope', legacy)).ok).toBe(false);

    // 畸形存储串防御（奇数长度/非 hex/keylen 越界/缺段）不应抛异常
    const malformedHashes = [
      'scrypt:abc:def0',
      'scrypt:zzzz:1234',
      'scrypt:00112233:abcd', // keylen = 2 (< 16)
      `scrypt:00112233:${'aa'.repeat(200)}`, // keylen = 200 (> 128)
      'scrypt:onlyonepart',
      'scrypt:aa:bb:cc',
      'not-even-hex',
      '',
    ];
    for (const bad of malformedHashes) {
      expect(await verifyPassword('secret-123', bad)).toEqual({ ok: false, needsRehash: false });
    }
  });

  it('握手携带 JWT 时以令牌身份为准，忽略客户端自报的 userId', async () => {
    const loginRes = await app.fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'player1', password: '123456' },
    });
    const { token, user } = JSON.parse(loginRes.body);

    const s = await connect({ query: { userId: 'mallory', username: '冒名者' }, token });
    const statePromise = nextRoomState(s);
    s.emit('room:join', { roomId: 'sec-jwt-room', userId: 'mallory' });
    const room = await statePromise;
    expect(room.players.map((p) => p.userId)).toEqual([user.id]);
  });

  it('游客不得冒用已注册账号的 userId', async () => {
    const admin = await app.userRepo.findByUsername('admin');
    const s = await connect({ query: { userId: admin!.id, username: '伪装管理员' } });
    const statePromise = nextRoomState(s);
    s.emit('room:join', { roomId: 'sec-guest-room' });
    const room = await statePromise;
    expect(room.players).toHaveLength(1);
    expect(room.players[0]!.userId).not.toBe(admin!.id);
    expect(room.players[0]!.userId.startsWith('guest_')).toBe(true);
  });

  it('设置了密码的房间需校验密码后方可加入', async () => {
    const created = await app.roomMgr.createRoom('pw-host', '房主', '密码房', 'open-sesame', 'sec-pw-room');
    expect(created.data!.hasPassword).toBe(true);
    expect(JSON.stringify(created.data)).not.toContain('open-sesame');

    const guestRes = await app.fastify.inject({ method: 'POST', url: '/api/auth/guest', payload: { nickname: '密码房来宾' } });
    expect(guestRes.statusCode).toBe(200);
    const { token: guestToken, user: guestUser } = JSON.parse(guestRes.body);
    const guestId = guestUser.id as string;
    const guest = await connect({ token: guestToken });

    let err = nextError(guest);
    guest.emit('room:join', { roomId: 'sec-pw-room' });
    expect((await err).code).toBe(ErrorCode.ROOM_PASSWORD_REQUIRED);

    err = nextError(guest);
    guest.emit('room:join', { roomId: 'sec-pw-room', password: 'wrong' });
    expect((await err).code).toBe(ErrorCode.ROOM_PASSWORD_INVALID);

    const statePromise = nextRoomState(guest);
    guest.emit('room:join', { roomId: 'sec-pw-room', password: 'open-sesame' });
    const room = await statePromise;
    expect(room.players.map((p) => p.userId)).toContain(guestId);
  });

  it('房间关闭后重新开启仍保留密码校验，且仓储中不保存明文密码', async () => {
    await app.roomMgr.createRoom('reopen-host', '房主', '密码房2', 'secret-2', 'sec-reopen-room');
    // 房主离开 -> 房间关闭；房主随即以同一密码重新开启 (前端 StrictMode 二次挂载的真实时序)
    await app.roomMgr.leaveRoom('sec-reopen-room', 'reopen-host');
    const reopened = await app.roomMgr.joinRoom('sec-reopen-room', 'reopen-host', '房主', undefined, 'secret-2');
    expect(reopened.success).toBe(true);
    expect(reopened.data!.hasPassword).toBe(true);

    const intruder = await app.roomMgr.joinRoom('sec-reopen-room', 'intruder', '路人');
    expect(intruder.success).toBe(false);
    expect(intruder.errorCode).toBe(ErrorCode.ROOM_PASSWORD_REQUIRED);

    const stored = await (app.roomMgr as any).roomRepo.findById('sec-reopen-room');
    expect(stored.passwordHash).not.toBe('secret-2');
  });

  it('非房间成员的离开请求不影响他人准备状态', async () => {
    await app.roomMgr.createRoom('ready-host', '房主', '准备房', undefined, 'sec-ready-room');
    await app.roomMgr.joinRoom('sec-ready-room', 'ready-guest', '来宾');
    await app.roomMgr.setReady('sec-ready-room', 'ready-host', true, 'deck-st01');
    const res = await app.roomMgr.leaveRoom('sec-ready-room', 'passer-by');
    expect(res.closed).toBe(false);
    expect(res.data!.players.find((p) => p.userId === 'ready-host')!.isReady).toBe(true);
    expect(res.data!.players).toHaveLength(2);
  });

  it('自定义卡组不得覆盖系统预组，且不合规卡组无法准备', async () => {
    const before = await (app as any).roomMgr['deckRepo'].findById('deck-st02');
    const beforeCards = JSON.stringify(before.cards);

    const s = await connect({ query: { userId: 'deck-attacker' } });
    const joined = nextRoomState(s);
    s.emit('room:join', { roomId: 'sec-deck-room' });
    await joined;

    // 1. 试图以系统预组 ID 上传伪造卡表：服务端应直接使用权威系统卡组，不做任何改写
    const readyState = nextRoomState(s);
    s.emit('room:ready', {
      roomId: 'sec-deck-room',
      isReady: true,
      deckId: 'deck-st02',
      customDeck: { id: 'deck-st02', name: '篡改', cards: [{ cardNumber: 'ST01-001', count: 50 }] },
    });
    const room = await readyState;
    expect(room.players[0]!.deckId).toBe('deck-st02');
    const after = await (app as any).roomMgr['deckRepo'].findById('deck-st02');
    expect(JSON.stringify(after.cards)).toBe(beforeCards);
    expect(after.name).toBe(before.name);

    // 2. 不合规自定义卡组 (同名 50 张) 准备失败
    const err = nextError(s);
    s.emit('room:ready', {
      roomId: 'sec-deck-room',
      isReady: true,
      deckId: 'my-broken-deck',
      customDeck: { id: 'my-broken-deck', name: '违规卡组', cards: [{ cardNumber: 'ST01-001', count: 50 }] },
    });
    const e = await err;
    expect(e.code).toBe(ErrorCode.INVALID_DECK);
    expect(e.message).toContain('构筑规则');
  });

  it('非本局玩家无法对他人对局提交投降等操作', async () => {
    const session = await app.gameSessionMgr.startGameSession('sec-game-room', 'p-alice', 'deck-st01', 'p-bob', 'deck-st02', 4242);
    const outsider = await connect({ query: { userId: 'p-carol' } });

    const err = nextError(outsider);
    outsider.emit('game:action', { gameId: session.gameId, action: { type: 'SURRENDER', playerId: 'p-carol' } as any });
    expect((await err).code).toBe(ErrorCode.UNAUTHORIZED);

    const leaveErrAbsent = wait(100);
    outsider.emit('game:leave', { gameId: session.gameId, isSurrender: true });
    await leaveErrAbsent;
    expect(session.engine.getState().status).toBe('PLAYING');

    // 引擎层同样拒绝非本局玩家的行动
    const res = session.engine.dispatchAction({ type: 'SURRENDER', playerId: 'p-carol' });
    expect(res.success).toBe(false);
    expect(session.engine.getState().status).toBe('PLAYING');
  });

  it('系统预组不可通过 REST 接口删除或修改', async () => {
    const unauthDel = await app.fastify.inject({ method: 'DELETE', url: '/api/decks/deck-st01' });
    expect(unauthDel.statusCode).toBe(401);
    const unauthPut = await app.fastify.inject({ method: 'PUT', url: '/api/decks/deck-st01', payload: { name: 'hacked' } });
    expect(unauthPut.statusCode).toBe(401);
    const unauthPost = await app.fastify.inject({ method: 'POST', url: '/api/decks', payload: { id: 'deck-st01', name: 'hacked' } });
    expect(unauthPost.statusCode).toBe(401);

    const reg = await app.fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'sys-deck-tester', password: 'password123' },
    });
    const { token } = JSON.parse(reg.body);
    const headers = { authorization: `Bearer ${token}` };

    const del = await app.fastify.inject({ method: 'DELETE', url: '/api/decks/deck-st01', headers });
    expect(del.statusCode).toBe(403);
    const put = await app.fastify.inject({ method: 'PUT', url: '/api/decks/deck-st01', headers, payload: { name: 'hacked' } });
    expect(put.statusCode).toBe(403);
    const post = await app.fastify.inject({
      method: 'POST',
      url: '/api/decks',
      headers,
      payload: { id: 'deck-st01', userId: 'system', name: 'hacked', cards: [{ cardNumber: 'ST01-012', count: 4 }] },
    });
    expect(post.statusCode).toBe(403);
  });

  it('运维监控接口需要管理员身份', async () => {
    const res = await app.fastify.inject({ method: 'GET', url: '/api/admin/monitor' });
    expect(res.statusCode).toBe(401);
  });

  it('游客不得冒充其他游客 ID 重连、代投降或提交操作', async () => {
    const victimRes = await app.fastify.inject({ method: 'POST', url: '/api/auth/guest', payload: { nickname: '真实游客' } });
    expect(victimRes.statusCode).toBe(200);
    const victimId = JSON.parse(victimRes.body).user.id as string;

    const session = await app.gameSessionMgr.startGameSession('sec-spoof-room', victimId, 'deck-st01', 'p-bob', 'deck-st02', 5252);
    const spoofer = await connect({ query: { userId: victimId, username: '冒充者' } });

    const joinState = nextRoomState(spoofer);
    spoofer.emit('room:join', { roomId: 'sec-spoof-join-check' });
    const room = await joinState;
    expect(room.players[0]!.userId).not.toBe(victimId);
    expect(room.players[0]!.userId.startsWith('guest_')).toBe(true);

    const reconnErr = nextError(spoofer);
    spoofer.emit('game:reconnect', { gameId: session.gameId });
    expect((await reconnErr).code).toBe(ErrorCode.UNAUTHORIZED);

    const actionErr = nextError(spoofer);
    spoofer.emit('game:action', { gameId: session.gameId, action: { type: 'SURRENDER', playerId: victimId } as any });
    expect((await actionErr).code).toBe(ErrorCode.UNAUTHORIZED);
    expect(session.engine.getState().status).toBe('PLAYING');
  });

  it('游客 JWT 不可用于登录用户及管理员 REST 接口', async () => {
    const guestRes = await app.fastify.inject({ method: 'POST', url: '/api/auth/guest', payload: { nickname: '普通游客' } });
    expect(guestRes.statusCode).toBe(200);
    const { token: guestToken } = JSON.parse(guestRes.body);
    const headers = { authorization: `Bearer ${guestToken}` };

    expect((await app.fastify.inject({ method: 'GET', url: '/api/auth/me', headers })).statusCode).toBe(401);
    expect((await app.fastify.inject({ method: 'POST', url: '/api/decks', headers, payload: { name: 'g', cards: [] } })).statusCode).toBe(401);
    expect((await app.fastify.inject({ method: 'GET', url: '/api/admin/monitor', headers })).statusCode).toBe(403);
  });

  it('普通登录用户不得篡改或删除他人卡组，且小数量卡表被拒绝', async () => {
    const ownerReg = await app.fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'deck-owner', password: 'password123' },
    });
    const attackerReg = await app.fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'deck-attacker-2', password: 'password123' },
    });
    const { token: ownerToken } = JSON.parse(ownerReg.body);
    const { token: attackerToken } = JSON.parse(attackerReg.body);

    const createRes = await app.fastify.inject({
      method: 'POST',
      url: '/api/decks',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        name: '合法自建卡组',
        cards: [
          { cardNumber: 'ST01-012', count: 4 },
          { cardNumber: 'ST01-013', count: 4 },
          { cardNumber: 'ST01-014', count: 4 },
          { cardNumber: 'BP01-001', count: 4 },
          { cardNumber: 'BP01-002', count: 4 },
          { cardNumber: 'BP01-003', count: 4 },
          { cardNumber: 'BP01-004', count: 4 },
          { cardNumber: 'BP01-005', count: 4 },
          { cardNumber: 'BP01-006', count: 4 },
          { cardNumber: 'BP01-007', count: 4 },
          { cardNumber: 'BP01-008', count: 4 },
          { cardNumber: 'BP01-010', count: 4 },
          { cardNumber: 'BP01-012', count: 2 },
        ],
      },
    });
    expect(createRes.statusCode).toBe(200);
    const deckId = JSON.parse(createRes.body).data.id;

    const putRes = await app.fastify.inject({
      method: 'PUT',
      url: `/api/decks/${deckId}`,
      headers: { authorization: `Bearer ${attackerToken}` },
      payload: { name: '恶意改名' },
    });
    expect(putRes.statusCode).toBe(403);

    const delRes = await app.fastify.inject({
      method: 'DELETE',
      url: `/api/decks/${deckId}`,
      headers: { authorization: `Bearer ${attackerToken}` },
    });
    expect(delRes.statusCode).toBe(403);

    const floatRes = await app.fastify.inject({
      method: 'POST',
      url: '/api/decks',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: '小数漏洞卡组', cards: [{ cardNumber: 'ST01-012', count: 2.5 }] },
    });
    expect(floatRes.statusCode).toBe(400);
  });

  it('REST 房间创建与删除接口仅限管理员调用', async () => {
    expect((await app.fastify.inject({ method: 'POST', url: '/api/rooms', payload: { name: 'r' } })).statusCode).toBe(401);
    expect((await app.fastify.inject({ method: 'DELETE', url: '/api/rooms/r1' })).statusCode).toBe(401);

    const reg = await app.fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'room-rest-user', password: 'password123' },
    });
    const { token } = JSON.parse(reg.body);
    const headers = { authorization: `Bearer ${token}` };

    expect((await app.fastify.inject({ method: 'POST', url: '/api/rooms', headers, payload: { name: 'r' } })).statusCode).toBe(403);
    expect((await app.fastify.inject({ method: 'DELETE', url: '/api/rooms/r1', headers })).statusCode).toBe(403);
  });

  it('Socket 入口收到 null 或畸形负载时不崩溃并安全拦截', async () => {
    const s = await connect({});
    s.emit('room:join', null as any);
    s.emit('room:ready', undefined as any);
    s.emit('room:select_deck', 'bad-payload' as any);
    s.emit('game:action', null as any);
    s.emit('game:choice', null as any);
    await wait(120);

    expect(s.connected).toBe(true);
    const statePromise = nextRoomState(s);
    s.emit('room:join', { roomId: 'sec-malformed-recovery' });
    const room = await statePromise;
    expect(room.roomId).toBe('sec-malformed-recovery');
  });

  it('Node 版 GameSessionManager 为 ST06 角色装配协战配置 (8.13)', async () => {
    const reg = await app.fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'assist-deck-owner', password: 'password123' },
    });
    const { token } = JSON.parse(reg.body);
    const createRes = await app.fastify.inject({
      method: 'POST',
      url: '/api/decks',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'ST06协战测试',
        cards: [
          { cardNumber: 'ST06-001', count: 4 },
          { cardNumber: 'ST06-002', count: 4 },
          { cardNumber: 'ST06-003', count: 4 },
          { cardNumber: 'ST06-004', count: 4 },
          { cardNumber: 'ST06-005', count: 4 },
          { cardNumber: 'ST06-006', count: 4 },
          { cardNumber: 'ST06-007', count: 4 },
          { cardNumber: 'ST06-008', count: 4 },
          { cardNumber: 'ST06-009', count: 4 },
          { cardNumber: 'ST06-010', count: 4 },
          { cardNumber: 'ST06-011', count: 4 },
          { cardNumber: 'ST06-012', count: 4 },
          { cardNumber: 'ST06-013', count: 2 },
        ],
      },
    });
    expect(createRes.statusCode).toBe(200);
    const deckId = JSON.parse(createRes.body).data.id;

    const session = await app.gameSessionMgr.startGameSession('sec-assist-room', 'assist-p1', deckId, 'assist-p2', 'deck-st01', 9001);
    const state = session.engine.getState();
    const p1Cards = Object.values(state.cards).filter((inst) => inst.ownerPlayerId === 'assist-p1');
    const st06001 = p1Cards.find((inst) => inst.cardNumber === 'ST06-001');
    expect(st06001).toBeDefined();
    const def = (app.gameSessionMgr as any).cardDb.getCard(st06001!.cardId);
    expect(def?.assistConfig).toBeDefined();
    expect(def?.assistConfig?.partnerFilter?.traits).toContain('塞西莉');
    expect(def?.imageUrl).toBe('/cards/ST06-001.png');
  });

  it('Socket 联机 game:events 按玩家视角脱敏，不泄露对手 drawnCardIds 与私有 CHOICE_REQUIRED', async () => {
    const regA = await app.fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'ev-san-alice', password: 'password123' },
    });
    const regB = await app.fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'ev-san-bob', password: 'password123' },
    });
    const alice = JSON.parse(regA.body);
    const bob = JSON.parse(regB.body);

    const decksRes = await app.fastify.inject({
      method: 'GET',
      url: '/api/decks',
      headers: { authorization: `Bearer ${alice.token}` },
    });
    const sysDeckId = JSON.parse(decksRes.body).data[0].id as string;

    const s1 = await connect({ token: alice.token });
    const s2 = await connect({ token: bob.token });

    const s1Events: any[] = [];
    const s2Events: any[] = [];
    let s1State: any;
    let s2State: any;
    s1.on('game:events', (evts) => s1Events.push(...evts));
    s2.on('game:events', (evts) => s2Events.push(...evts));
    s1.on('game:sync_state', (st) => { s1State = st; });
    s2.on('game:sync_state', (st) => { s2State = st; });

    const roomId = 'sec-event-sanitization-room';
    s1.emit('room:join', { roomId });
    await wait(80);
    s2.emit('room:join', { roomId });
    await wait(80);

    s1.emit('room:ready', { roomId, isReady: true, deckId: sysDeckId });
    s2.emit('room:ready', { roomId, isReady: true, deckId: sysDeckId });
    await wait(80);

    s1.emit('room:start', { roomId });
    await wait(250);

    const gameId = s1State.gameId as string;
    expect(gameId).toBeDefined();
    expect(s2State?.gameId).toBe(gameId);

    // 双方提交调度 (分别放回 1 张手牌触发 MULLIGAN 抽牌 + 进入回合 1 抽牌)
    s1.emit('game:action', {
      gameId,
      action: { type: 'RESOLVE_MULLIGAN', playerId: alice.user.id, cardInstanceIdsToBottom: [s1State.myHandCards[0].instanceId] },
    });
    await wait(60);
    s2.emit('game:action', {
      gameId,
      action: { type: 'RESOLVE_MULLIGAN', playerId: bob.user.id, cardInstanceIdsToBottom: [s2State.myHandCards[0].instanceId] },
    });
    await wait(250);

    const aliceDrawsOnS1 = s1Events.filter((e) => e.type === 'CARDS_DRAWN' && e.playerId === alice.user.id);
    const bobDrawsOnS1 = s1Events.filter((e) => e.type === 'CARDS_DRAWN' && e.playerId === bob.user.id);
    const bobDrawsOnS2 = s2Events.filter((e) => e.type === 'CARDS_DRAWN' && e.playerId === bob.user.id);
    const aliceDrawsOnS2 = s2Events.filter((e) => e.type === 'CARDS_DRAWN' && e.playerId === alice.user.id);

    expect(aliceDrawsOnS1.length).toBeGreaterThanOrEqual(1);
    expect(bobDrawsOnS1.length).toBeGreaterThanOrEqual(1);
    expect(bobDrawsOnS2.length).toBeGreaterThanOrEqual(1);
    expect(aliceDrawsOnS2.length).toBeGreaterThanOrEqual(1);

    for (const e of aliceDrawsOnS1) expect(Array.isArray(e.drawnCardIds) && e.drawnCardIds.length > 0).toBe(true);
    for (const e of bobDrawsOnS1) expect('drawnCardIds' in e).toBe(false);
    for (const e of bobDrawsOnS2) expect(Array.isArray(e.drawnCardIds) && e.drawnCardIds.length > 0).toBe(true);
    for (const e of aliceDrawsOnS2) expect('drawnCardIds' in e).toBe(false);

    for (const e of s1Events) {
      if (e.type === 'CHOICE_REQUIRED') expect(e.pendingChoice.playerId).toBe(alice.user.id);
    }
    for (const e of s2Events) {
      if (e.type === 'CHOICE_REQUIRED') expect(e.pendingChoice.playerId).toBe(bob.user.id);
    }
  });

  it('POST /api/auth/login 限流返回 429、超 128 位密码返回 400、REST 写入端点传 null/错类型返回 400', async () => {
    const isolatedApp = await createServerApp();
    try {
      // 超 128 位密码直接返回 400
      const longPwdRes = await isolatedApp.fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'player1', password: 'a'.repeat(129) },
      });
      expect(longPwdRes.statusCode).toBe(400);

      // 连续超过 20 次/分钟后返回 429
      for (let i = 0; i < 19; i++) {
        const res = await isolatedApp.fastify.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: 'player1', password: 'wrong-password' },
        });
        expect(res.statusCode).toBe(401);
      }
      const rateLimitedRes = await isolatedApp.fastify.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'player1', password: 'wrong-password' },
      });
      expect(rateLimitedRes.statusCode).toBe(429);
    } finally {
      isolatedApp.io.close();
      await isolatedApp.fastify.close();
    }

    // 获取管理员与普通用户令牌用于检验写入端点强类型校验
    const adminLogin = await app.fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'admin888' },
    });
    const adminToken = JSON.parse(adminLogin.body).token as string;
    const adminHeaders = { authorization: `Bearer ${adminToken}` };

    const regRes = await app.fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'type-check-user', password: 'password123' },
    });
    expect(regRes.statusCode).toBe(200);
    const userToken = JSON.parse(regRes.body).token as string;
    const userHeaders = { authorization: `Bearer ${userToken}` };

    // 1. 认证与资料接口传 null / 非对象 / 错类型 -> 400 (不 500)
    expect((await app.fastify.inject({ method: 'POST', url: '/api/auth/register', headers: { 'content-type': 'application/json' }, payload: 'null' })).statusCode).toBe(400);
    expect((await app.fastify.inject({ method: 'POST', url: '/api/auth/register', payload: [] as any })).statusCode).toBe(400);
    expect((await app.fastify.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 123, password: 'password123' } as any })).statusCode).toBe(400);
    expect((await app.fastify.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'valid_u2', password: 'password123', nickname: 999 } as any })).statusCode).toBe(400);
    expect((await app.fastify.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: 'null' })).statusCode).toBe(400);
    expect((await app.fastify.inject({ method: 'POST', url: '/api/auth/login', payload: ['bad'] as any })).statusCode).toBe(400);
    expect((await app.fastify.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'player1', password: 123456 } as any })).statusCode).toBe(400);
    expect((await app.fastify.inject({ method: 'PUT', url: '/api/auth/profile', headers: { ...userHeaders, 'content-type': 'application/json' }, payload: 'null' })).statusCode).toBe(400);
    expect((await app.fastify.inject({ method: 'PUT', url: '/api/auth/profile', headers: userHeaders, payload: { nickname: 123 } as any })).statusCode).toBe(400);
    expect((await app.fastify.inject({ method: 'PUT', url: '/api/auth/profile', headers: userHeaders, payload: [] as any })).statusCode).toBe(400);

    // 2. 房间创建密码字段错类型 -> 400
    expect((await app.fastify.inject({ method: 'POST', url: '/api/rooms', headers: adminHeaders, payload: { title: 't', password: 1234 } as any })).statusCode).toBe(400);

    // 3. 卡组写入端点错类型 / 嵌套数组 / null 元素 -> 400
    expect((await app.fastify.inject({ method: 'POST', url: '/api/decks', headers: userHeaders, payload: [] as any })).statusCode).toBe(400);
    expect((await app.fastify.inject({ method: 'POST', url: '/api/decks', headers: userHeaders, payload: { name: 123 } as any })).statusCode).toBe(400);
    expect((await app.fastify.inject({ method: 'POST', url: '/api/decks', headers: userHeaders, payload: { name: 'bad', cards: [null] } as any })).statusCode).toBe(400);
    expect((await app.fastify.inject({ method: 'POST', url: '/api/decks', headers: userHeaders, payload: { name: 'bad', cards: [['nested']] } as any })).statusCode).toBe(400);
    expect((await app.fastify.inject({ method: 'POST', url: '/api/decks', headers: userHeaders, payload: { name: 'bad', cards: [{ cardId: 123, count: 1 }] } as any })).statusCode).toBe(400);

    const createdDeckRes = await app.fastify.inject({
      method: 'POST',
      url: '/api/decks',
      headers: userHeaders,
      payload: { name: '正常临时卡组' },
    });
    expect(createdDeckRes.statusCode).toBe(200);
    const createdDeckId = JSON.parse(createdDeckRes.body).data.id as string;
    expect((await app.fastify.inject({ method: 'PUT', url: `/api/decks/${createdDeckId}`, headers: userHeaders, payload: { name: 42 } as any })).statusCode).toBe(400);
    expect((await app.fastify.inject({ method: 'PUT', url: `/api/decks/${createdDeckId}`, headers: userHeaders, payload: { description: {} } as any })).statusCode).toBe(400);
    expect((await app.fastify.inject({ method: 'PUT', url: `/api/decks/${createdDeckId}`, headers: userHeaders, payload: { cards: [{ cardNumber: {}, count: 1 }] } as any })).statusCode).toBe(400);

    // 4. 管理员卡牌端点强校验与 PUT 字段白名单
    expect((await app.fastify.inject({ method: 'POST', url: '/api/admin/cards', headers: adminHeaders, payload: ['bad'] as any })).statusCode).toBe(400);
    expect((await app.fastify.inject({ method: 'POST', url: '/api/admin/cards', headers: adminHeaders, payload: { cardNumber: 'BAD-1', name: '错费', cardType: 'ROLE', cost: 'free' } as any })).statusCode).toBe(400);
    expect((await app.fastify.inject({ method: 'POST', url: '/api/admin/cards', headers: adminHeaders, payload: { cardNumber: 'BAD-2', name: '错特征', cardType: 'ROLE', traits: [123] } as any })).statusCode).toBe(400);
    expect((await app.fastify.inject({ method: 'POST', url: '/api/admin/cards/batch', headers: adminHeaders, payload: { cards: 'not-array' } as any })).statusCode).toBe(400);

    // PUT 不得覆写 id / currentVersion，且忽略 rulesText 缺省创建的卡牌在搜索时不会因 .toLowerCase() 崩溃
    const noRulesRes = await app.fastify.inject({
      method: 'POST',
      url: '/api/admin/cards',
      headers: adminHeaders,
      payload: { cardNumber: 'TEST-NO-RULES', name: '无文本卡', cardType: 'TACTICS', attribute: 'FIRE', cost: 1 },
    });
    expect(noRulesRes.statusCode).toBe(200);
    const createdCard = JSON.parse(noRulesRes.body).data;
    expect(createdCard.rulesText).toBe('');

    const searchWithEmptyCost = await app.fastify.inject({
      method: 'GET',
      url: '/api/cards?query=TEST-NO-RULES&query=DUPLICATE&cost=',
    });
    expect(searchWithEmptyCost.statusCode).toBe(200);

    const putWhitelistRes = await app.fastify.inject({
      method: 'PUT',
      url: `/api/admin/cards/${createdCard.id}`,
      headers: adminHeaders,
      payload: { id: 'forged-id', currentVersion: 999, name: '更新后无文本卡' } as any,
    });
    expect(putWhitelistRes.statusCode).toBe(200);
    const updatedCard = JSON.parse(putWhitelistRes.body).data;
    expect(updatedCard.id).toBe(createdCard.id);
    expect(updatedCard.currentVersion).toBe(2);
    expect(updatedCard.name).toBe('更新后无文本卡');
  });

  it('PLAYING 状态下 room:ready 与 room:select_deck 被拦截返回 ACTION_NOT_ALLOWED，非房主开局被拒且并发开局仅创建 1 局', async () => {
    const regHost = await app.fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'room-lock-host', password: 'password123' },
    });
    const regGuest = await app.fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'room-lock-guest', password: 'password123' },
    });
    const host = JSON.parse(regHost.body);
    const guest = JSON.parse(regGuest.body);

    const sHost = await connect({ token: host.token });
    const sGuest = await connect({ token: guest.token });
    const roomId = 'sec-playing-lock-room';

    const hostJoined = nextRoomState(sHost);
    sHost.emit('room:join', { roomId });
    await hostJoined;

    const guestJoined = nextRoomState(sGuest);
    sGuest.emit('room:join', { roomId });
    await guestJoined;

    sHost.emit('room:ready', { roomId, isReady: true, deckId: 'deck-st01' });
    sGuest.emit('room:ready', { roomId, isReady: true, deckId: 'deck-st02' });
    await wait(120);

    // 非房主尝试开局 -> ACTION_NOT_ALLOWED
    const nonCreatorErr = nextError(sGuest);
    sGuest.emit('room:start', { roomId });
    expect((await nonCreatorErr).code).toBe(ErrorCode.ACTION_NOT_ALLOWED);
    expect(app.roomMgr.getRoom(roomId)!.status).toBe('READY');

    // 房主并发连击两次 room:start -> 仅创建 1 个对局会话
    const createdGameIds = new Set<string>();
    sHost.on('game:sync_state', (st) => {
      if (st?.gameId) createdGameIds.add(st.gameId);
    });
    sHost.emit('room:start', { roomId });
    sHost.emit('room:start', { roomId });
    await wait(250);

    expect(createdGameIds.size).toBe(1);
    const room = app.roomMgr.getRoom(roomId)!;
    expect(room.status).toBe('PLAYING');
    expect(room.currentGameId).toBeDefined();

    // PLAYING 状态下 room:ready 与 room:select_deck 均被拦截返回 ACTION_NOT_ALLOWED
    const readyErr = nextError(sHost);
    sHost.emit('room:ready', { roomId, isReady: false, deckId: 'deck-st01' });
    expect((await readyErr).code).toBe(ErrorCode.ACTION_NOT_ALLOWED);

    const selectErr = nextError(sGuest);
    sGuest.emit('room:select_deck', { roomId, deckId: 'deck-st03' });
    expect((await selectErr).code).toBe(ErrorCode.ACTION_NOT_ALLOWED);
  });

  it('对局中提交失败行动后不递增 actionSequence，回放记录中不包含失败行动', async () => {
    const gameRepo = new MemoryGameRepository();
    const isolatedApp = await createServerApp({ gameRepo });
    try {
      const session = await isolatedApp.gameSessionMgr.startGameSession(
        'sec-failed-action-room',
        'fa-p1',
        'deck-st01',
        'fa-p2',
        'deck-st02',
        7777
      );
      expect(session.actionSequence).toBe(0);
      expect(session.stateVersion).toBe(1);

      // 提交当前阶段非法的 DECLARE_BLOCK 行动
      const failRes = await isolatedApp.gameSessionMgr.processAction(session.gameId, {
        type: 'DECLARE_BLOCK',
        playerId: 'fa-p1',
      } as any);
      expect(failRes.success).toBe(false);
      expect(session.actionSequence).toBe(0);
      expect(session.stateVersion).toBe(1);

      // 再执行一次合法投降结束对局以查看回放记录
      const okRes = await isolatedApp.gameSessionMgr.processAction(session.gameId, {
        type: 'SURRENDER',
        playerId: 'fa-p1',
      });
      expect(okRes.success).toBe(true);
      expect(session.actionSequence).toBe(1);

      const replay = await gameRepo.getReplayData(session.gameId);
      expect(replay).not.toBeNull();
      expect(replay!.actions).toHaveLength(1);
      expect(replay!.actions[0]!.actionType).toBe('SURRENDER');
      expect(replay!.actions.some((a) => a.actionType === 'DECLARE_BLOCK')).toBe(false);
    } finally {
      isolatedApp.io.close();
      await isolatedApp.fastify.close();
    }
  });

  it('官方预组统一来自 OFFICIAL_STARTER_DECKS，GET /api/decks?userId=system 无重复且 deck-st01 别名可解析', async () => {
    const res = await app.fastify.inject({
      method: 'GET',
      url: '/api/decks?userId=system',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    const returnedIds = body.data.map((d: any) => d.id);
    expect(new Set(returnedIds).size).toBe(returnedIds.length);
    expect(returnedIds).toEqual(OFFICIAL_STARTER_DECKS.map((d) => d.id));

    // 通过别名获取 ST01 预组
    const aliasRes = await app.fastify.inject({
      method: 'GET',
      url: '/api/decks/deck-st01',
    });
    expect(aliasRes.statusCode).toBe(200);
    const aliasDeck = JSON.parse(aliasRes.body).data;
    expect(aliasDeck.id).toBe(OFFICIAL_STARTER_DECKS[0]!.id);
    expect(aliasDeck.isValid).toBe(true);
  });
});
