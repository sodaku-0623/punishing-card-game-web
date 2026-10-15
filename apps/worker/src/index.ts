import { EchoDO } from './echo-do.js';
import { getTestPageHtml } from './test-page.js';
import { Env } from './types.js';

export { EchoDO };

export default {
  async fetch(request: Request, env: Env, _ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // 1. CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // 2. HTTP 时间与边缘节点信息接口
    if (url.pathname === '/api/time' || url.pathname === '/time') {
      const now = Date.now();
      const cfData = (request as unknown as { cf?: Record<string, unknown> }).cf;
      const colo = (cfData?.colo as string) || 'UNKNOWN';
      const country = (cfData?.country as string) || 'UNKNOWN';
      const city = (cfData?.city as string) || 'UNKNOWN';
      const timezone = (cfData?.timezone as string) || 'UNKNOWN';
      const asOrganization = (cfData?.asOrganization as string) || 'UNKNOWN';

      return Response.json(
        {
          ok: true,
          timestamp: now,
          iso: new Date(now).toISOString(),
          serverTime: new Date(now).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
          edgeInfo: {
            colo,
            country,
            city,
            timezone,
            asOrganization,
          },
        },
        {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Content-Type': 'application/json; charset=utf-8',
          },
        }
      );
    }

    // 3. WebSocket 路由 -> 代理至 EchoDO 单例
    if (url.pathname === '/ws' || url.pathname === '/ws/echo') {
      if (!env.ECHO_DO) {
        return new Response('Durable Object ECHO_DO binding is not configured', { status: 500 });
      }
      const id = env.ECHO_DO.idFromName('global-connectivity-echo');
      const stub = env.ECHO_DO.get(id);
      return stub.fetch(request);
    }

    // 4. 健康检查
    if (url.pathname === '/health') {
      return Response.json(
        {
          status: 'ok',
          service: 'zhanshuang-cf-worker',
          timestamp: Date.now(),
        },
        {
          headers: {
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // 5. 静态测试页面 (默认根路径)
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
