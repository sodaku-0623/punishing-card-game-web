import { io, Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents } from '@zhanshuang/shared';

type EventHandler = (...args: any[]) => void;

/**
 * 原生 WebSocket 兼容客户端 (全面契合 Cloudflare Workers & Durable Objects 边缘架构)
 * 提供与 Socket.IO 完全相同的调用契约：
 * - on(event, callback)
 * - off(event, callback)
 * - emit(event, payload)
 * - connected / connect() / disconnect()
 * - 自动指数退避重连与断线恢复
 * - 额度优化报文 (game:bundle) 自动解包多路复用广播
 */
export class NativeWebSocketClient {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<EventHandler>>();
  private sendQueue: string[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private isManuallyClosed = false;
  private url: string;
  public id: string;

  constructor(url: string, id: string) {
    this.url = url;
    this.id = id;
    this.connect();
  }

  get connected(): boolean {
    return this.ws !== null && this.ws.readyState === 1;
  }

  on(event: string, handler: EventHandler): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return this;
  }

  off(event: string, handler?: EventHandler): this {
    if (!handler) {
      this.listeners.delete(event);
    } else {
      const set = this.listeners.get(event);
      if (set) {
        set.delete(handler);
        if (set.size === 0) this.listeners.delete(event);
      }
    }
    return this;
  }

  private emitLocal(event: string, ...args: any[]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const fn of handlers) {
        try {
          fn(...args);
        } catch (err) {
          console.error(`Error in event handler for "${event}":`, err);
        }
      }
    }
  }

  emit(event: string, ...args: any[]): this {
    const payload = args.length === 1 ? args[0] : args;
    const msg = JSON.stringify({ event, payload });

    if (this.connected && this.ws) {
      try {
        this.ws.send(msg);
      } catch {
        this.sendQueue.push(msg);
      }
    } else {
      this.sendQueue.push(msg);
      if (!this.ws || this.ws.readyState === (typeof WebSocket !== 'undefined' ? WebSocket.CLOSED : 3)) {
        this.connect();
      }
    }
    return this;
  }

  connect(): this {
    if (typeof window === 'undefined' && typeof WebSocket === 'undefined') return this;
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return this;
    }

    this.isManuallyClosed = false;
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.emitLocal('connect');

        // 发送积攒的待发消息
        while (this.sendQueue.length > 0 && this.connected) {
          const next = this.sendQueue.shift();
          if (next) {
            try {
              this.ws?.send(next);
            } catch {
              this.sendQueue.unshift(next);
              break;
            }
          }
        }
      };

      this.ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          const { event, payload } = data;
          if (!event) return;

          // 1. 原生触发对应报文事件
          this.emitLocal(event, payload);

          // 2. 免费额度 game:bundle 解包多路复用广播
          if (event === 'game:bundle' && payload) {
            if (payload.state) {
              this.emitLocal('game:sync_state', payload.state);
              if (payload.state.currentPendingChoice) {
                this.emitLocal('game:choice_required', payload.state.currentPendingChoice);
              }
            }
            if (Array.isArray(payload.events) && payload.events.length > 0) {
              this.emitLocal('game:events', payload.events);
            }
          }

          // 3. room:update 与 room:state_updated 互通兼容
          if (event === 'room:update') {
            this.emitLocal('room:state_updated', payload);
          }

          // 4. game:over 与 game:ended 互通兼容
          if (event === 'game:over') {
            this.emitLocal('game:ended', payload);
          }
        } catch {
          this.emitLocal('message', e.data);
        }
      };

      this.ws.onclose = () => {
        const wasConnected = this.connected;
        this.ws = null;
        if (wasConnected) {
          this.emitLocal('disconnect', 'io server disconnect');
        }
        if (!this.isManuallyClosed) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (err) => {
        this.emitLocal('connect_error', err);
      };
    } catch (err) {
      this.scheduleReconnect();
    }

    return this;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.isManuallyClosed) return;
    this.reconnectAttempts++;
    const delay = Math.min(10000, 1000 * Math.pow(1.5, this.reconnectAttempts));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  disconnect(): this {
    this.isManuallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.emitLocal('disconnect', 'io client disconnect');
    return this;
  }
}

export type TypedSocket =
  | Socket<ServerToClientEvents, ClientToServerEvents>
  | NativeWebSocketClient;

let socketInstance: TypedSocket | null = null;

export function resetSocket(): void {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

const AUTH_USER_KEY = 'zhanshuang_auth_user';
const AUTH_TOKEN_KEY = 'zhanshuang_auth_token';
const GUEST_ID_KEY = 'zs_user_id';
const LEGACY_SHARED_GUEST_IDS = new Set(['guest', 'guest_lobby', 'host']);

function readAuthUser(): { id?: string; username?: string; nickname?: string } | null {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function generateGuestId(): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `guest_${rand}`;
}

export function getGuestUserId(): string {
  if (typeof window === 'undefined') return 'guest';
  try {
    const stored = localStorage.getItem(GUEST_ID_KEY);
    if (stored && !LEGACY_SHARED_GUEST_IDS.has(stored)) return stored;
    const fresh = generateGuestId();
    localStorage.setItem(GUEST_ID_KEY, fresh);
    return fresh;
  } catch {
    return generateGuestId();
  }
}

export function getSocketUserId(): string {
  if (typeof window === 'undefined') return 'guest';
  const authUser = readAuthUser();
  if (authUser?.id) return authUser.id;
  return getGuestUserId();
}

export function getSocketUsername(): string {
  if (typeof window === 'undefined') return '指挥官';
  const authUser = readAuthUser();
  if (authUser?.nickname) return authUser.nickname;
  if (authUser?.username) return authUser.username;
  return localStorage.getItem('zs_username') || '指挥官';
}

export function getSocketUrl(): string {
  if (process.env.NEXT_PUBLIC_SERVER_URL) {
    return process.env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    if (
      process.env.NODE_ENV !== 'production' &&
      window.location.port === '3000' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ) {
      return `http://${window.location.hostname}:4000`;
    }
    return window.location.origin;
  }
  return 'http://127.0.0.1:4000';
}

function resolveWsUrl(finalUserId: string, finalUsername: string, token: string | null): string {
  const baseHttp = getSocketUrl();
  const baseWs = baseHttp.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');

  let path = '/ws/rooms/default';
  if (typeof window !== 'undefined') {
    const pathname = window.location.pathname;
    if (pathname.includes('/rooms/')) {
      const rId = pathname.split('/rooms/')[1]?.split('/')[0]?.split('?')[0];
      if (rId) path = `/ws/rooms/${rId}`;
    } else if (pathname.includes('/game/')) {
      const gId = pathname.split('/game/')[1]?.split('/')[0]?.split('?')[0];
      if (gId) path = `/ws/game/${gId}`;
    }
  }

  const queryParams = new URLSearchParams({
    guestId: finalUserId,
    nickname: finalUsername,
  });
  if (token) {
    queryParams.set('token', token);
  }

  return `${baseWs}${path}?${queryParams.toString()}`;
}

/**
 * 获取全局唯一 Socket 连接。
 * - 默认使用原生 WebSocket (NativeWebSocketClient)，直连 Cloudflare Workers + Durable Objects；
 * - 环境变量 NEXT_PUBLIC_WS_TRANSPORT='socketio' 时回退到传统 Socket.IO (用于本地双机调试)。
 */
export function getSocket(userId?: string, username?: string): TypedSocket {
  if (!socketInstance) {
    const serverUrl = getSocketUrl();
    const authUser = typeof window !== 'undefined' ? readAuthUser() : null;
    let token: string | null = null;
    if (typeof window !== 'undefined') {
      try {
        token = localStorage.getItem(AUTH_TOKEN_KEY);
      } catch {}
    }

    const requestedId = userId && !LEGACY_SHARED_GUEST_IDS.has(userId) ? userId : undefined;
    const finalUserId = authUser?.id || requestedId || getGuestUserId();
    const finalUsername =
      username || authUser?.nickname || authUser?.username || `指挥官_${finalUserId.substring(0, 5)}`;

    if (typeof window !== 'undefined' && !authUser?.id) {
      try {
        localStorage.setItem('zs_username', finalUsername);
      } catch {}
    }

    // 传输层切换判定：环境变量 NEXT_PUBLIC_WS_TRANSPORT === 'socketio' 使用 Socket.IO，否则使用原生 WebSocket
    const useSocketIo = process.env.NEXT_PUBLIC_WS_TRANSPORT === 'socketio';

    if (useSocketIo) {
      socketInstance = io(serverUrl, {
        query: {
          userId: finalUserId,
          username: finalUsername,
        },
        auth: token ? { token } : {},
        transports: ['websocket', 'polling'],
        autoConnect: true,
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000,
      }) as TypedSocket;
    } else {
      const wsUrl = resolveWsUrl(finalUserId, finalUsername, token);
      socketInstance = new NativeWebSocketClient(wsUrl, finalUserId);
    }
  }

  return socketInstance;
}
