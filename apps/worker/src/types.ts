export interface Env {
  ECHO_DO: DurableObjectNamespace;
  ROOM_DO: DurableObjectNamespace;
  DB: D1Database;
  JWT_SECRET?: string;
  ADMIN_PASSWORD?: string;
  NEXT_PUBLIC_CARD_CDN?: string;
  NODE_ENV?: string;
}

/**
 * 原生 WebSocket 消息包裹契约 (兼容 shared/types/socket.ts)
 */
export interface WsMessage<T = unknown> {
  event: string;
  payload: T;
}

/**
 * 依附于 WebSocket 连接的玩家身份附件 (经 serializeAttachment 持久化)
 */
export interface WsClientAttachment {
  userId: string;
  username: string;
  nickname: string;
  isGuest: boolean;
  connectedAt: number;
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
