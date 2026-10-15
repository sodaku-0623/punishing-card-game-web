import { EchoDO } from './echo-do.js';
import { RoomDO } from './room-do.js';
import { getTestPageHtml } from './test-page.js';
import { createApiApp } from './routes/api.js';
import { Env } from './types.js';

export { EchoDO, RoomDO };

const apiApp = createApiApp();

/**
 * 前端静态导出时，每个动态路由只生成一个占位页面 (见 apps/web/src/app/<segment>/[id]/page.tsx 的
 * generateStaticParams)。其余 ID 在这里改写到占位页面，页面再从地址栏读取真实 ID。
 * 修改占位 ID 时两边必须同步。
 */
const DYNAMIC_ROUTE_PLACEHOLDERS: Record<string, string> = {
  cards: 'BP01-001',
  decks: 'default',
  game: 'room',
  replay: 'demo',
  rooms: 'lobby',
};
// 匹配页面 (/rooms/123) 与客户端跳转时请求的 RSC 数据 (/rooms/123.txt)
const DYNAMIC_ROUTE_PATTERN = /^\/(cards|decks|game|replay|rooms)\/([^/]+?)(\.txt)?\/?$/;

/** 返回前端页面：动态路由改写到占位页面，其余请求交给静态资源 (不存在时返回 404 页面) */
function serveFrontend(request: Request, env: Env, url: URL): Promise<Response> | Response {
  if (!env.ASSETS) {
    return new Response('Not Found', { status: 404 });
  }
  const match = url.pathname.match(DYNAMIC_ROUTE_PATTERN);
  if (match && (request.method === 'GET' || request.method === 'HEAD')) {
    const target = new URL(`/${match[1]}/${DYNAMIC_ROUTE_PLACEHOLDERS[match[1]!]}${match[3] ?? ''}`, url);
    target.search = url.search;
    return env.ASSETS.fetch(new Request(target, request));
  }
  return env.ASSETS.fetch(request);
}
const ROOM_ID_PATTERN = /^[A-Za-z0-9_\-]{1,64}$/;

/**
 * 解析 WebSocket 路径对应的房间 ID：
 * - /ws/game/game~<roomId>~<timestamp> → <roomId>
 * - /ws/rooms/<6 位房间代码> → 通过大厅投影查回真实房间 ID (与 Node 版一致，支持用房间代码加入)
 */
async function resolveRoomId(pathname: string, env: Env): Promise<string | null> {
  const isGame = pathname.startsWith('/ws/game/');
  const raw = decodeURIComponent(pathname.slice(isGame ? '/ws/game/'.length : '/ws/rooms/'.length).split('/')[0] ?? '');
  let roomId = raw;
  if (isGame) {
    const parts = raw.split('~');
    roomId = parts.length >= 3 ? parts.slice(1, -1).join('~') : '';
  }
  if (!ROOM_ID_PATTERN.test(roomId)) return null;

  if (!isGame && env.DB) {
    try {
      const byCode = await env.DB.prepare(
        'SELECT room_id FROM lobby_rooms WHERE room_code = ? AND room_id != ? AND player_count > 0'
      )
        .bind(roomId.toUpperCase(), roomId)
        .first<{ room_id: string }>();
      if (byCode?.room_id) return byCode.room_id;
    } catch {
      // 大厅表尚未初始化时按房间 ID 处理
    }
  }
  return roomId;
}

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

    // 2. 实时对战与房间 WebSocket 路由：/ws/rooms/:roomIdOrCode 与 /ws/game/:gameId
    if (url.pathname.startsWith('/ws/rooms/') || url.pathname.startsWith('/ws/game/')) {
      if (!env.ROOM_DO) {
        return new Response('Durable Object ROOM_DO is not bound', { status: 500 });
      }
      const roomId = await resolveRoomId(url.pathname, env);
      if (!roomId) {
        return new Response('Room ID is required', { status: 400 });
      }
      // 通过请求头把路由确定的房间 ID 传给 Durable Object，房间不以消息负载中的 roomId 为准
      const headers = new Headers(request.headers);
      headers.set('x-room-id', roomId);
      const stub = env.ROOM_DO.get(env.ROOM_DO.idFromName(roomId));
      return stub.fetch(new Request(request, { headers }));
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

    // 6. 连通性测速页面 (根路径已由前端首页占用)
    if (url.pathname === '/__connectivity') {
      return new Response(getTestPageHtml(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // 7. 前端页面与静态资源
    return serveFrontend(request, env, url);
  },
};
