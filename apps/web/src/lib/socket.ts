import { io, Socket } from 'socket.io-client';
import { ClientToServerEvents, ServerToClientEvents } from '@zhanshuang/shared';

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

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
/** 旧版本写入的共享占位 ID：所有游客都会拿到相同的值，必须重新生成 */
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

/**
 * 获取本浏览器持久化的游客 ID (每个浏览器唯一，首次访问时生成)
 */
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
    // 本地 Next.js 开发环境 (未经过便携版网关，next dev 本身不转发 ws)，直接连接 4000
    if (
      process.env.NODE_ENV !== 'production' &&
      window.location.port === '3000' &&
      (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ) {
      return `http://${window.location.hostname}:4000`;
    }
    // 生产环境、便携免安装版网关、外网穿透 (cpolar/frp) 及局域网访问：统一连接当前页面 origin
    return window.location.origin;
  }
  return 'http://127.0.0.1:4000';
}

/**
 * 获取全局唯一 Socket 连接。
 * 身份以握手为准：登录用户携带 JWT (服务端校验后确定 userId)，游客使用本浏览器唯一的游客 ID。
 * 参数 userId 仅为兼容旧调用保留，登录态下会被忽略。
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
    const finalUsername = username || authUser?.nickname || authUser?.username || `指挥官_${finalUserId.substring(0, 5)}`;

    if (typeof window !== 'undefined' && !authUser?.id) {
      try {
        localStorage.setItem('zs_username', finalUsername);
      } catch {}
    }

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
    });
  }

  return socketInstance;
}
