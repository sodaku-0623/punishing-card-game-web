import { DurableObject } from 'cloudflare:workers';
import { Env, PingMessage, PongMessage, WelcomeMessage } from './types.js';

/**
 * 连通性探测 Durable Object (EchoDO)：
 * 1. 采用 SQLite 作为存储后端（完全符合 Cloudflare Workers Free 免费套餐规则）；
 * 2. 采用 WebSocket Hibernation API，在空闲无消息阶段自动休眠省去 CPU 时长计算；
 * 3. 接收客户端高频 Ping 测速请求，精确返回时间戳与序号，支持往返延迟与抖动测算。
 */
export class EchoDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // 初始化嵌入式 SQLite 数据表（兼容 Cloudflare Workers Free 免费计划）
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS echo_stats (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        total_pings INTEGER DEFAULT 0,
        total_connections INTEGER DEFAULT 0,
        last_ping_time INTEGER DEFAULT 0
      );
      INSERT OR IGNORE INTO echo_stats (id, total_pings, total_connections, last_ping_time)
      VALUES (1, 0, 0, 0);
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      // 普通 HTTP 查询当前 Durable Object 实例内 SQLite 统计
      const cursor = this.ctx.storage.sql.exec('SELECT * FROM echo_stats WHERE id = 1');
      const rows = [...cursor];
      const stats = rows[0] || { id: 1, total_pings: 0, total_connections: 0, last_ping_time: 0 };
      return Response.json({
        ok: true,
        type: 'EchoDO',
        stats,
        activeWebSockets: this.ctx.getWebSockets().length,
      });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // 使用 WebSocket Hibernation API 接入连接，休眠保持连接无需长期消耗 CPU 算力
    this.ctx.acceptWebSocket(server, ['echo-client']);

    // 更新持久化 SQLite 连接统计
    this.ctx.storage.sql.exec(`
      UPDATE echo_stats
      SET total_connections = total_connections + 1
      WHERE id = 1
    `);

    // 初次连接就绪通知
    const welcome: WelcomeMessage = {
      type: 'connected',
      message: 'Cloudflare Durable Object WebSocket Echo Ready',
      serverTime: Date.now(),
    };
    server.send(JSON.stringify(welcome));

    try {
      return new Response(null, {
        status: 101,
        webSocket: client,
      });
    } catch {
      return new Response(null, {
        status: 200,
        headers: { Upgrade: 'websocket' },
      });
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const now = Date.now();
    try {
      if (typeof message === 'string') {
        const parsed = JSON.parse(message) as Partial<PingMessage>;
        if (parsed.type === 'ping' && typeof parsed.seq === 'number') {
          const pong: PongMessage = {
            type: 'pong',
            seq: parsed.seq,
            clientTime: parsed.clientTime ?? 0,
            serverTime: now,
          };
          ws.send(JSON.stringify(pong));

          // 记录 ping 统计到 SQLite
          this.ctx.storage.sql.exec(`
            UPDATE echo_stats
            SET total_pings = total_pings + 1, last_ping_time = ?
            WHERE id = 1
          `, now);
          return;
        }
      }
    } catch {
      // 非标准 JSON 消息降级为普通回声
    }

    // 默认回声
    ws.send(message);
  }

  async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // 客户端正常/非正常关闭断开
  }

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    // WebSocket 错误捕获
  }
}
