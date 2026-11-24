import { DurableObject } from 'cloudflare:workers';
import { Env, PingMessage, PongMessage, WelcomeMessage } from './types.js';

/**
 * 连通性探测 Durable Object (EchoDO)：
 * 1. 仅使用内存计数器统计连接与 Ping 次数，避免每次心跳写入 SQLite 消耗免费行写额度；
 * 2. 采用 WebSocket Hibernation API，在空闲无消息阶段自动休眠省去 CPU 时长计算；
 * 3. 接收客户端高频 Ping 测速请求，精确返回时间戳与序号，支持往返延迟与抖动测算。
 */
export class EchoDO extends DurableObject {
  private totalPings = 0;
  private totalConnections = 0;
  private lastPingTime = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
      // 普通 HTTP 查询当前 Durable Object 实例内内存统计
      return Response.json({
        status: 'ok',
        ok: true,
        type: 'EchoDO',
        stats: {
          total_pings: this.totalPings,
          total_connections: this.totalConnections,
          last_ping_time: this.lastPingTime,
        },
        activeWebSockets: this.ctx.getWebSockets().length,
      });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // 使用 WebSocket Hibernation API 接入连接，休眠保持连接无需长期消耗 CPU 算力
    this.ctx.acceptWebSocket(server, ['echo-client']);

    // 更新内存连接统计
    this.totalConnections += 1;

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

          // 更新内存 ping 统计
          this.totalPings += 1;
          this.lastPingTime = now;
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
