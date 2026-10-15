import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index.js';
import { RoomDO } from '../src/room-do.js';
import { createMockDOContext, createTestEnv, MockWebSocket } from './mock-do-env.js';
import { hashPassword, verifyPassword, signJwt } from '../src/lib/crypto-auth.js';
import { initializeDatabase } from '../src/lib/db-client.js';
import { Env } from '../src/types.js';

describe('Cloudflare Worker 安全加固全量回归测试', () => {
  let env: Env;
  const JWT_SECRET = 'sec_hardening_jwt_secret_999';

  beforeEach(async () => {
    env = createTestEnv();
    env.JWT_SECRET = JWT_SECRET;
    await initializeDatabase(env.DB);

    if (typeof (globalThis as any).WebSocketPair === 'undefined') {
      (globalThis as any).WebSocketPair = class MockWebSocketPair {
        0: MockWebSocket;
        1: MockWebSocket;
        constructor() {
          this[0] = new MockWebSocket();
          this[1] = new MockWebSocket();
        }
      };
    }
  });

  describe('1. 密码学与认证安全 (Web Crypto PBKDF2 + JWT)', () => {
    it('密码使用 PBKDF2 10,000次加盐存储，且每次随机盐不同', async () => {
      const hash1 = await hashPassword('my-secret-pass');
      const hash2 = await hashPassword('my-secret-pass');
      expect(hash1.startsWith('pbkdf2:10000:')).toBe(true);
      expect(hash2.startsWith('pbkdf2:10000:')).toBe(true);
      expect(hash1).not.toBe(hash2); // 随机盐不同

      const verifySuccess = await verifyPassword('my-secret-pass', hash1);
      expect(verifySuccess.ok).toBe(true);
      expect(verifySuccess.needsRehash).toBe(false);

      const verifyWrong = await verifyPassword('wrong-pass', hash1);
      expect(verifyWrong.ok).toBe(false);
    });

    it('兼容旧版 HMAC 摘要并在校验成功时提示 needsRehash 进行平滑升级', async () => {
      // 模拟旧版 HMAC-SHA256
      const encoder = new TextEncoder();
      const legacyKey = await crypto.subtle.importKey(
        'raw',
        encoder.encode('zhanshuang_tcg_salt_2026'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const sig = await crypto.subtle.sign('HMAC', legacyKey, encoder.encode('legacy-pwd'));
      const legacyHex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');

      const res = await verifyPassword('legacy-pwd', legacyHex);
      expect(res.ok).toBe(true);
      expect(res.needsRehash).toBe(true); // 提示需要重新哈希升级
    });
  });

  describe('2. WebSocket 身份防伪造与防冒用', () => {
    it('握手携带 JWT 时以令牌身份为准，忽略客户端自报的 guestId 与伪造用户名', async () => {
      const { ctx } = createMockDOContext();
      const roomDo = new RoomDO(ctx, env);

      const realToken = await signJwt({
        sub: 'alice-real-id',
        username: 'alice',
        nickname: '真正的爱丽丝',
        role: 'USER',
      }, JWT_SECRET);

      const req = new Request(`https://worker.local/ws/rooms/sec-room?token=${realToken}&guestId=mallory_fake&nickname=假装管理员`, {
        headers: { Upgrade: 'websocket' },
      });

      const res = await roomDo.fetch(req);
      expect([101, 200]).toContain(res.status);
      const [serverWs] = (ctx as any).getWebSockets();
      const attachment = serverWs.deserializeAttachment();

      expect(attachment.userId).toBe('alice-real-id');
      expect(attachment.nickname).toBe('真正的爱丽丝');
      expect(attachment.isGuest).toBe(false);
    });

    it('游客不得冒用已注册账号的 userId (冒用将被强制重置为唯一 guest_xxx)', async () => {
      // 在 D1 中注册一个名为 "registered_commander" 的用户
      await env.DB.prepare('INSERT INTO users (id, username, password_hash, nickname, role, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('registered_commander', 'registered_commander', 'hash', '已注册指挥官', 'USER', Date.now())
        .run();

      const { ctx } = createMockDOContext();
      const roomDo = new RoomDO(ctx, env);

      // 恶意游客试图冒用已注册账号的 ID
      const req = new Request('https://worker.local/ws/rooms/sec-room?guestId=registered_commander&nickname=冒牌指挥官', {
        headers: { Upgrade: 'websocket' },
      });

      const res = await roomDo.fetch(req);
      expect([101, 200]).toContain(res.status);
      const [serverWs] = (ctx as any).getWebSockets();
      const attachment = serverWs.deserializeAttachment();

      // 必须被改写为随机游客 ID，不得冒充已注册用户
      expect(attachment.userId).not.toBe('registered_commander');
      expect(attachment.userId.startsWith('guest_')).toBe(true);
      expect(attachment.isGuest).toBe(true);
    });
  });

  describe('3. 加密房间密码防暴力与越权进入', () => {
    it('设置了密码的房间需校验密码方可进入，空密码或错误密码均被拦截', async () => {
      const { ctx } = createMockDOContext();
      const roomDo = new RoomDO(ctx, env);

      // 房主以密码 "super_secret_888" 创建加密房间
      const reqHost = new Request('https://worker.local/ws/rooms/pw-room?guestId=host1', {
        headers: { Upgrade: 'websocket' },
      });
      await roomDo.fetch(reqHost);
      const [hostWs] = (ctx as any).getWebSockets();

      await roomDo.webSocketMessage(hostWs, JSON.stringify({
        event: 'room:join',
        payload: { title: '机密房间', password: 'super_secret_888' },
      }));

      // 来宾 1：未提供密码尝试进入
      const reqGuest1 = new Request('https://worker.local/ws/rooms/pw-room?guestId=guest1', {
        headers: { Upgrade: 'websocket' },
      });
      await roomDo.fetch(reqGuest1);
      const guest1Ws = (ctx as any).getWebSockets()[1];

      await roomDo.webSocketMessage(guest1Ws, JSON.stringify({
        event: 'room:join',
        payload: {},
      }));

      const err1 = guest1Ws.getLastMessage();
      expect(err1?.event).toBe('game:error');
      expect(err1?.payload.code).toBe('PASSWORD_REQUIRED');

      // 来宾 1：提供错误密码
      await roomDo.webSocketMessage(guest1Ws, JSON.stringify({
        event: 'room:join',
        payload: { password: 'wrong_password' },
      }));
      const err2 = guest1Ws.getLastMessage();
      expect(err2?.event).toBe('game:error');
      expect(err2?.payload.code).toBe('INVALID_PASSWORD');

      // 来宾 1：提供正确密码 -> 成功加入
      await roomDo.webSocketMessage(guest1Ws, JSON.stringify({
        event: 'room:join',
        payload: { password: 'super_secret_888' },
      }));
      const okMsg = guest1Ws.getLastMessage();
      expect(okMsg?.event).toBe('room:update');
      expect(okMsg?.payload.players).toHaveLength(2);
    });
  });

  describe('4. 构筑合规与系统预组只读不可篡改', () => {
    it('准备对局时，违规卡组 (同名卡 >4 张或总数不足 40) 拒绝准备', async () => {
      const { ctx } = createMockDOContext();
      const roomDo = new RoomDO(ctx, env);

      await roomDo.fetch(new Request('https://worker.local/ws/rooms/deck-room?guestId=player_cheat', {
        headers: { Upgrade: 'websocket' },
      }));
      const [ws] = (ctx as any).getWebSockets();
      await roomDo.webSocketMessage(ws, JSON.stringify({ event: 'room:join', payload: {} }));

      // 准备单卡 50 张的严重违规卡组
      await roomDo.webSocketMessage(ws, JSON.stringify({
        event: 'room:ready',
        payload: {
          isReady: true,
          customDeck: {
            id: 'broken-deck-50',
            cards: [{ cardNumber: 'ST01-001', count: 50 }],
          },
        },
      }));

      const errMsg = ws.getLastMessage();
      expect(errMsg?.event).toBe('game:error');
      expect(errMsg?.payload.code).toBe('INVALID_DECK');
      expect(errMsg?.payload.message).toContain('不合规');
    });

    it('REST API 严禁修改、删除或以 POST 覆盖系统预置官方卡组', async () => {
      // 预置系统卡组 deck-st01
      await env.DB.prepare('INSERT INTO decks (id, user_id, name, cards_json, is_valid, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind('deck-st01', 'system', '官方预组', '[]', 1, Date.now(), Date.now())
        .run();

      const putRes = await worker.fetch(new Request('https://worker.local/api/decks/deck-st01', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '篡改预组' }),
      }), env);
      expect(putRes.status).toBe(403);

      const delRes = await worker.fetch(new Request('https://worker.local/api/decks/deck-st01', {
        method: 'DELETE',
      }), env);
      expect(delRes.status).toBe(403);

      const postRes = await worker.fetch(new Request('https://worker.local/api/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'deck-st01', name: '覆盖预组', cards: [] }),
      }), env);
      expect(postRes.status).toBe(403);
    });
  });

  describe('5. 对战操作权限与频次限流保护', () => {
    it('非本局参战人员无法对他人对局提交行动或投降', async () => {
      const { ctx } = createMockDOContext();
      const roomDo = new RoomDO(ctx, env);

      // p1 与 p2 进房并开局
      await roomDo.fetch(new Request('https://worker.local/ws/rooms/game-room?guestId=p1', { headers: { Upgrade: 'websocket' } }));
      await roomDo.fetch(new Request('https://worker.local/ws/rooms/game-room?guestId=p2', { headers: { Upgrade: 'websocket' } }));
      const [p1Ws, p2Ws] = (ctx as any).getWebSockets();

      await roomDo.webSocketMessage(p1Ws, JSON.stringify({ event: 'room:join', payload: {} }));
      await roomDo.webSocketMessage(p2Ws, JSON.stringify({ event: 'room:join', payload: {} }));
      await roomDo.webSocketMessage(p1Ws, JSON.stringify({ event: 'room:ready', payload: { isReady: true } }));
      await roomDo.webSocketMessage(p2Ws, JSON.stringify({ event: 'room:ready', payload: { isReady: true } }));

      // 局外人员 p3 进入
      await roomDo.fetch(new Request('https://worker.local/ws/rooms/game-room?guestId=outsider_p3', { headers: { Upgrade: 'websocket' } }));
      const p3Ws = (ctx as any).getWebSockets()[2];

      // p3 试图发起投降或其他对战操作
      await roomDo.webSocketMessage(p3Ws, JSON.stringify({
        event: 'game:action',
        payload: { action: { type: 'SURRENDER' } },
      }));

      const p3Err = p3Ws.getLastMessage();
      expect(p3Err?.event).toBe('game:error');
      expect(p3Err?.payload.code).toBe('FORBIDDEN_ACTION');
    });

    it('单用户每秒超过 15 次请求时触发频次限流 (RATE_LIMIT_EXCEEDED)', async () => {
      const { ctx } = createMockDOContext();
      const roomDo = new RoomDO(ctx, env);

      await roomDo.fetch(new Request('https://worker.local/ws/rooms/rate-room?guestId=spammer', { headers: { Upgrade: 'websocket' } }));
      const [ws] = (ctx as any).getWebSockets();
      await roomDo.webSocketMessage(ws, JSON.stringify({ event: 'room:join', payload: {} }));

      // 快速连续发送 16 次消息
      let rateLimitHit = false;
      for (let i = 0; i < 17; i++) {
        await roomDo.webSocketMessage(ws, JSON.stringify({
          event: 'room:ready',
          payload: { isReady: false },
        }));
        const last = ws.getLastMessage();
        if (last?.payload?.code === 'RATE_LIMIT_EXCEEDED') {
          rateLimitHit = true;
          break;
        }
      }

      expect(rateLimitHit).toBe(true);
    });
  });
});
