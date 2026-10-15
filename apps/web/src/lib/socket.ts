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

export function getSocketUserId(): string {
  if (typeof window === 'undefined') return 'guest';
  try {
    const raw = localStorage.getItem('zhanshuang_auth_user');
    if (raw) {
      const u = JSON.parse(raw);
      if (u?.id) return u.id;
    }
  } catch {}
  return localStorage.getItem('zs_user_id') || 'guest';
}

export function getSocketUsername(): string {
  if (typeof window === 'undefined') return '指挥官';
  try {
    const raw = localStorage.getItem('zhanshuang_auth_user');
    if (raw) {
      const u = JSON.parse(raw);
      if (u?.nickname) return u.nickname;
      if (u?.username) return u.username;
    }
  } catch {}
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

export function getSocket(userId?: string, username?: string): TypedSocket {
  if (!socketInstance) {
    const serverUrl = getSocketUrl();
    let authUser: { id: string; username: string; nickname: string } | null = null;
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('zhanshuang_auth_user');
        if (raw) authUser = JSON.parse(raw);
      } catch {}
    }

    const storedUserId = typeof window !== 'undefined' ? localStorage.getItem('zs_user_id') : null;
    const finalUserId = userId || authUser?.id || storedUserId || `commander_${Math.random().toString(36).substring(2, 7)}`;
    const finalUsername = username || authUser?.nickname || authUser?.username || `指挥官_${finalUserId.substring(0, 5)}`;

    if (typeof window !== 'undefined') {
      localStorage.setItem('zs_user_id', finalUserId);
      localStorage.setItem('zs_username', finalUsername);
    }

    socketInstance = io(serverUrl, {
      query: {
        userId: finalUserId,
        username: finalUsername,
      },
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
  }

  return socketInstance;
}
