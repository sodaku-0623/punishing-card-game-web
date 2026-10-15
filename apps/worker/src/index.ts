import { EchoDO } from './echo-do.js';
import { RoomDO } from './room-do.js';
import { getTestPageHtml } from './test-page.js';
import { createApiApp } from './routes/api.js';
import { Env } from './types.js';

export { EchoDO, RoomDO };

const apiApp = createApiApp();

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // 2. 实时对战与房间 WebSocket 升级路由 (/ws/rooms/:roomId 与 /ws/game/:gameId)
    if (url.pathname.startsWith('/ws/rooms/') || url.pathname.startsWith('/ws/game/')) {
      if (!env.ROOM_DO) {
        return new Response('Durable Object ROOM_DO is not bound', { status: 500 });
      }

      let roomId = '';
      if (url.pathname.startsWith('/ws/rooms/')) {
        roomId = url.pathname.replace('/ws/rooms/', '').split('/')[0]!;
      } else {
        // 从 game:<roomId>:<timestamp> 中反向解析 roomId
        const gameId = url.pathname.replace('/ws/game/', '').split('/')[0]!;
        const parts = gameId.split(':');
        roomId = parts.length >= 2 ? parts[1]! : gameId;
      }

      if (!roomId) {
        return new Response('Room ID is required', { status: 400 });
      }

      const id = env.ROOM_DO.idFromName(roomId);
      const stub = env.ROOM_DO.get(id);
      return stub.fetch(request);
    }

    // 3. 基础连通性探测 WebSocket 路由 (/ws 或 /ws/echo)
    if (url.pathname === '/ws' || url.pathname === '/ws/echo') {
      if (!env.ECHO_DO) {
        return new Response('Durable Object ECHO_DO binding is not configured', { status: 500 });
      }
      const id = env.ECHO_DO.idFromName('global-connectivity-echo');
      const stub = env.ECHO_DO.get(id);
      return stub.fetch(request);
    }

    // 4. REST API 路由 (/api/*) -> Hono 处理
    if (url.pathname.startsWith('/api/')) {
      return apiApp.fetch(request, env, ctx);
    }

    // 5. 健康检查
    if (url.pathname === '/health') {
      return Response.json(
        {
          status: 'ok',
          service: 'zhanshuang-cf-worker',
          runtime: 'Cloudflare Workers (Edge)',
          timestamp: Date.now(),
        },
        {
          headers: {
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // 6. 静态连通性测速终端页面 (默认根路径)
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(getTestPageHtml(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};
