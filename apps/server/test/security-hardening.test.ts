import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { io as ClientSocket, Socket } from 'socket.io-client';
import { createServerApp, AppComponents, hashPassword, verifyPassword } from '../src/app.js';
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

  it('密码使用 scrypt 加盐存储，并兼容旧版 HMAC 摘要', () => {
    const stored = hashPassword('secret-123');
    expect(stored.startsWith('scrypt:')).toBe(true);
    expect(hashPassword('secret-123')).not.toBe(stored); // 每次随机盐
    expect(verifyPassword('secret-123', stored)).toEqual({ ok: true, needsRehash: false });
    expect(verifyPassword('wrong', stored).ok).toBe(false);

    const legacy = crypto.createHmac('sha256', 'zhanshuang_tcg_salt_2026').update('old-pass').digest('hex');
    expect(verifyPassword('old-pass', legacy)).toEqual({ ok: true, needsRehash: true });
    expect(verifyPassword('nope', legacy).ok).toBe(false);
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

    const guest = await connect({ query: { userId: 'pw-guest' } });

    let err = nextError(guest);
    guest.emit('room:join', { roomId: 'sec-pw-room' });
    expect((await err).code).toBe(ErrorCode.ROOM_PASSWORD_REQUIRED);

    err = nextError(guest);
    guest.emit('room:join', { roomId: 'sec-pw-room', password: 'wrong' });
    expect((await err).code).toBe(ErrorCode.ROOM_PASSWORD_INVALID);

    const statePromise = nextRoomState(guest);
    guest.emit('room:join', { roomId: 'sec-pw-room', password: 'open-sesame' });
    const room = await statePromise;
    expect(room.players.map((p) => p.userId)).toContain('pw-guest');
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
    const del = await app.fastify.inject({ method: 'DELETE', url: '/api/decks/deck-st01' });
    expect(del.statusCode).toBe(403);
    const put = await app.fastify.inject({ method: 'PUT', url: '/api/decks/deck-st01', payload: { name: 'hacked' } });
    expect(put.statusCode).toBe(403);
    const post = await app.fastify.inject({ method: 'POST', url: '/api/decks', payload: { id: 'deck-st01', name: 'hacked' } });
    expect(post.statusCode).toBe(403);
  });

  it('运维监控接口需要管理员身份', async () => {
    const res = await app.fastify.inject({ method: 'GET', url: '/api/admin/monitor' });
    expect(res.statusCode).toBe(401);
  });
});
