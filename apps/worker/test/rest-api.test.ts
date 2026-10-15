import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index.js';
import { Env } from '../src/types.js';
import { createMockD1Database } from './mock-d1.js';
import { signJwt } from '../src/lib/crypto-auth.js';

describe('Cloudflare Worker REST API 全量路由测试', () => {
  let env: Env;
  const JWT_SECRET = 'test_secret_key_12345';

  beforeEach(() => {
    const mockDb = createMockD1Database();
    env = {
      DB: mockDb,
      JWT_SECRET,
      ADMIN_PASSWORD: 'test_admin_pwd',
      ECHO_DO: {} as any,
      ROOM_DO: {} as any,
    };
  });

  describe('1. 鉴权认证 (/api/auth)', () => {
    it('注册新用户成功并返回用户身份与 JWT Token', async () => {
      const req = new Request('https://worker.local/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'alice',
          password: 'password123',
          nickname: '灰鸦指挥官',
        }),
      });

      const res = await worker.fetch(req, env);
      expect(res.status).toBe(201);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(data.user.username).toBe('alice');
      expect(data.user.role).toBe('USER');
      expect(typeof data.token).toBe('string');
    });

    it('重复用户名注册应被拒绝 (409 Conflict)', async () => {
      const req1 = new Request('https://worker.local/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'bob', password: '123', nickname: '鲍勃' }),
      });
      await worker.fetch(req1, env);

      const req2 = new Request('https://worker.local/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'bob', password: '456', nickname: '鲍勃2' }),
      });
      const res2 = await worker.fetch(req2, env);
      expect(res2.status).toBe(409);
    });

    it('正确用户名与密码登录成功，错误密码返回 401', async () => {
      // 注册
      await worker.fetch(new Request('https://worker.local/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'carol', password: 'mypassword', nickname: '卡罗尔' }),
      }), env);

      // 错误密码
      const failRes = await worker.fetch(new Request('https://worker.local/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'carol', password: 'wrong' }),
      }), env);
      expect(failRes.status).toBe(401);

      // 正确密码
      const successRes = await worker.fetch(new Request('https://worker.local/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'carol', password: 'mypassword' }),
      }), env);
      expect(successRes.status).toBe(200);
      const data = await successRes.json() as any;
      expect(data.ok).toBe(true);
      expect(data.user.username).toBe('carol');
      expect(typeof data.token).toBe('string');
    });

    it('GET /api/auth/me 验证 Bearer Token 返回对应用户', async () => {
      const token = await signJwt({
        sub: 'user-id-999',
        username: 'david',
        nickname: '大卫',
        role: 'USER',
      }, JWT_SECRET);

      const res = await worker.fetch(new Request('https://worker.local/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      }), env);

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.user.id).toBe('user-id-999');
      expect(data.user.username).toBe('david');
    });
  });

  describe('2. 房间管理 (/api/rooms)', () => {
    it('创建房间并以安全脱敏方式在房间列表中返回', async () => {
      const createRes = await worker.fetch(new Request('https://worker.local/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '加密房间',
          password: 'room_secret_pwd',
          creatorId: 'host-1',
          creatorName: '房主小王',
        }),
      }), env);

      expect(createRes.status).toBe(201);
      const createData = await createRes.json() as any;
      expect(createData.room.hasPassword).toBe(true);
      expect(JSON.stringify(createData)).not.toContain('room_secret_pwd');

      // 查询房间列表
      const listRes = await worker.fetch(new Request('https://worker.local/api/rooms'), env);
      expect(listRes.status).toBe(200);
      const listData = await listRes.json() as any;
      expect(listData.rooms.length).toBeGreaterThanOrEqual(1);
      const found = listData.rooms.find((r: any) => r.roomId === createData.room.roomId);
      expect(found).toBeDefined();
      expect(found.hasPassword).toBe(true);
      expect(JSON.stringify(found)).not.toContain('room_secret_pwd');
    });
  });

  describe('3. 卡组管理与系统预组只读安全保护 (/api/decks)', () => {
    it('系统官方预组只读，客户端尝试修改或删除应被拒绝 (403 Forbidden)', async () => {
      // 预置官方卡组 deck-1791110685763
      const putRes = await worker.fetch(new Request('https://worker.local/api/decks/deck-1791110685763', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '篡改官方预组' }),
      }), env);
      expect(putRes.status).toBe(403);

      const delRes = await worker.fetch(new Request('https://worker.local/api/decks/deck-1791110685763', {
        method: 'DELETE',
      }), env);
      expect(delRes.status).toBe(403);
    });
  });

  describe('4. 管理后台权限保护 (/api/admin/*)', () => {
    it('未携带 Token 访问管理接口应返回 401', async () => {
      const res = await worker.fetch(new Request('https://worker.local/api/admin/stats'), env);
      expect(res.status).toBe(401);
    });

    it('普通玩家 Token 访问管理接口应被拒绝 (403 Forbidden)', async () => {
      const userToken = await signJwt({
        sub: 'player-u1',
        username: 'normal_user',
        nickname: '普通玩家',
        role: 'USER',
      }, JWT_SECRET);

      const res = await worker.fetch(new Request('https://worker.local/api/admin/stats', {
        headers: { Authorization: `Bearer ${userToken}` },
      }), env);
      expect(res.status).toBe(403);
    });

    it('管理员 Token 可正常访问 stats 与 monitor 接口', async () => {
      const adminToken = await signJwt({
        sub: 'admin-01',
        username: 'admin',
        nickname: '最高指挥官',
        role: 'ADMIN',
      }, JWT_SECRET);

      const resStats = await worker.fetch(new Request('https://worker.local/api/admin/stats', {
        headers: { Authorization: `Bearer ${adminToken}` },
      }), env);
      expect(resStats.status).toBe(200);
      const statsData = await resStats.json() as any;
      expect(statsData.stats.users).toBeGreaterThanOrEqual(1);

      const resMonitor = await worker.fetch(new Request('https://worker.local/api/admin/monitor', {
        headers: { Authorization: `Bearer ${adminToken}` },
      }), env);
      expect(resMonitor.status).toBe(200);
    });
  });
});
