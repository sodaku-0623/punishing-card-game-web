'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

/**
 * 动态路由的真实 ID。
 *
 * 前端以静态导出方式部署到 Cloudflare 时，每个动态路由只生成一个占位页面
 * (如 /rooms/lobby)，其余 ID 由 Worker 改写到该页面。此时 useParams() 拿到的是
 * 占位 ID，真实 ID 只能从地址栏读取。RouteIdProvider 在客户端读取地址栏后才渲染页面内容，
 * 保证页面里的任何副作用 (加入房间、重连对局等) 都只会用真实 ID 执行。
 * 自建部署 (next start / next dev) 下地址栏与路由参数一致，行为不变。
 */
const RouteIdContext = createContext<string | null>(null);

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function RouteIdProvider({ segment, children }: { segment: string; children: React.ReactNode }) {
  const [routeId, setRouteId] = useState<string | null>(null);

  useEffect(() => {
    const match = window.location.pathname.match(new RegExp(`^/${segment}/([^/?#]+)`));
    setRouteId(match ? safeDecode(match[1]!) : '');
  }, [segment]);

  if (routeId === null) return null;
  return <RouteIdContext.Provider value={routeId}>{children}</RouteIdContext.Provider>;
}

/** 读取当前动态路由的真实 ID (已解码) */
export function useRouteId(): string {
  const fromLocation = useContext(RouteIdContext);
  const params = useParams();
  if (fromLocation !== null) return fromLocation;
  const raw = params?.id;
  return safeDecode(Array.isArray(raw) ? raw[0] ?? '' : (raw as string) ?? '');
}
