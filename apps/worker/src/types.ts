/**
 * Cloudflare Worker 环境变量与绑定契约
 */
export interface Env {
  ECHO_DO: DurableObjectNamespace;
  NODE_ENV?: string;
}

/**
 * 客户端与服务端的连通性探测消息协议
 */
export interface PingMessage {
  type: 'ping';
  seq: number;
  clientTime: number;
}

export interface PongMessage {
  type: 'pong';
  seq: number;
  clientTime: number;
  serverTime: number;
}

export interface WelcomeMessage {
  type: 'connected';
  message: string;
  serverTime: number;
}

export interface EchoStatsRow {
  id: number;
  total_pings: number;
  total_connections: number;
  last_ping_time: number;
}
