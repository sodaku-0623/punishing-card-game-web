import { describe, it, expect, beforeEach } from 'vitest';
import worker, { EchoDO } from '../src/index.js';
import { Env } from '../src/types.js';
import { createMockD1Database } from './mock-d1.js';

function createMockWebSocket() {
  const sent: (string | ArrayBuffer)[] = [];
  const ws = {
    send: (data: string | ArrayBuffer) => {
      sent.push(data);
    },
    close: () => {},
  } as unknown as WebSocket;
  return { ws, sent };
}

function createMockDOState() {
  const sqlLog: string[] = [];
  const accepted: WebSocket[] = [];
  const ctx = {
    id: { toString: () => 'mock-do-id' },
    storage: {
      sql: {
        exec: (sql: string, ..._params: unknown[]) => {
          sqlLog.push(sql);
          if (sql.includes('SELECT * FROM echo_stats')) {
            return [{ id: 1, total_pings: 10, total_connections: 3, last_ping_time: 1700000000000 }];
          }
          return [];
        },
      },
    },
    acceptWebSocket: (serverSocket: WebSocket, _tags?: string[]) => {
      accepted.push(serverSocket);
    },
    getWebSockets: () => accepted,
    setWebSocketAutoResponse: () => {},
  } as unknown as DurableObjectState;

  return { ctx, sqlLog, accepted };
}

describe('Cloudflare Worker & EchoDO 连通性测试服务', () => {
  beforeEach(() => {
    if (typeof (globalThis as unknown as { WebSocketPair?: unknown }).WebSocketPair === 'undefined') {
      (globalThis as unknown as { WebSocketPair: unknown }).WebSocketPair = class MockWebSocketPair {
        0: WebSocket;
        1: WebSocket;
        constructor() {
          this[0] = createMockWebSocket().ws;
          this[1] = createMockWebSocket().ws;
        }
      };
    }
  });

  describe('Worker 根路由与 HTTP API', () => {
    const mockEnv: Env = {
      ECHO_DO: {
        idFromName: (_name: string) => ({ toString: () => 'id-name' }) as DurableObjectId,
        get: (_id: DurableObjectId) => ({
          fetch: async (_req: Request) => Response.json({ ok: true, source: 'EchoDO_Stub' }),
        }) as unknown as DurableObjectStub,
      } as unknown as DurableObjectNamespace,
      ROOM_DO: {
        idFromName: (_name: string) => ({ toString: () => 'room-id' }) as DurableObjectId,
        get: (_id: DurableObjectId) => ({
          fetch: async (_req: Request) => Response.json({ ok: true, source: 'RoomDO_Stub' }),
        }) as unknown as DurableObjectStub,
      } as unknown as DurableObjectNamespace,
      DB: createMockD1Database(),
    };

    it('OPTIONS 预检请求应返回跨域允许响应头', async () => {
      const req = new Request('https://test.example.com/api/time', { method: 'OPTIONS' });
      const res = await worker.fetch(req, mockEnv);
      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('GET /api/time 应返回带时间戳与边缘节点信息的 JSON 数据', async () => {
      const req = new Request('https://test.example.com/api/time');
      const res = await worker.fetch(req, mockEnv);
      expect(res.status).toBe(200);
      const data = await res.json() as { ok: boolean; timestamp: number; edgeInfo: { colo: string } };
      expect(data.ok).toBe(true);
      expect(typeof data.timestamp).toBe('number');
      expect(data.edgeInfo).toBeDefined();
    });

    it('GET /health 应返回服务运行正常状态', async () => {
      const req = new Request('https://test.example.com/health');
      const res = await worker.fetch(req, mockEnv);
      expect(res.status).toBe(200);
      const data = await res.json() as { status: string };
      expect(data.status).toBe('ok');
    });

    it('GET / 应返回静态测速 HTML 页面', async () => {
      const req = new Request('https://test.example.com/');
      const res = await worker.fetch(req, mockEnv);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/html');
      const text = await res.text();
      expect(text).toContain('《战双帕弥什》Cloudflare 连通性测试终端');
    });

    it('GET /ws 应路由代理至 EchoDO 单例实例', async () => {
      const req = new Request('https://test.example.com/ws');
      const res = await worker.fetch(req, mockEnv);
      expect(res.status).toBe(200);
      const data = await res.json() as { ok: boolean; source: string };
      expect(data.source).toBe('EchoDO_Stub');
    });

    it('未知路由应返回 404', async () => {
      const req = new Request('https://test.example.com/unknown-path-xyz');
      const res = await worker.fetch(req, mockEnv);
      expect(res.status).toBe(404);
    });
  });

  describe('EchoDO 状态管理与 WebSocket 协议交互', () => {
    it('非 WebSocket 请求访问 EchoDO 应返回 SQLite 统计数据', async () => {
      const { ctx } = createMockDOState();
      const echoDo = new EchoDO(ctx, {} as Env);

      const req = new Request('https://do.example.com/');
      const res = await echoDo.fetch(req);
      expect(res.status).toBe(200);
      const data = await res.json() as { ok: boolean; type: string; stats: { total_pings: number } };
      expect(data.ok).toBe(true);
      expect(data.type).toBe('EchoDO');
      expect(data.stats.total_pings).toBe(10);
    });

    it('WebSocket 升级请求应通过 acceptWebSocket 接入并发送欢迎事件', async () => {
      const { ctx, accepted } = createMockDOState();
      const echoDo = new EchoDO(ctx, {} as Env);

      const req = new Request('https://do.example.com/ws', {
        headers: { Upgrade: 'websocket' },
      });
      const res = await echoDo.fetch(req);
      expect([101, 200]).toContain(res.status);
      expect(accepted.length).toBe(1);
    });

    it('接收 ping 报文时应准确返回对应 seq 与服务时间戳的 pong 报文', async () => {
      const { ctx } = createMockDOState();
      const echoDo = new EchoDO(ctx, {} as Env);
      const { ws, sent } = createMockWebSocket();

      const pingMsg = JSON.stringify({
        type: 'ping',
        seq: 42,
        clientTime: 1700000000000,
      });

      await echoDo.webSocketMessage(ws, pingMsg);

      expect(sent.length).toBe(1);
      const reply = JSON.parse(sent[0] as string) as { type: string; seq: number; clientTime: number; serverTime: number };
      expect(reply.type).toBe('pong');
      expect(reply.seq).toBe(42);
      expect(reply.clientTime).toBe(1700000000000);
      expect(typeof reply.serverTime).toBe('number');
    });

    it('接收普通文本或非标准消息时应提供原样回声支持', async () => {
      const { ctx } = createMockDOState();
      const echoDo = new EchoDO(ctx, {} as Env);
      const { ws, sent } = createMockWebSocket();

      await echoDo.webSocketMessage(ws, 'hello cloudflare');

      expect(sent.length).toBe(1);
      expect(sent[0]).toBe('hello cloudflare');
    });
  });
});
