'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowLeft,
  Cpu,
  HardDrive,
  Clock,
  Radio,
  RefreshCw,
  Zap,
  Users,
  Swords,
  AlertTriangle,
  Network,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  AppShell,
  Button,
  Badge,
  Panel,
  SectionHeader,
  HudBrackets,
} from '@/components/ui';

export interface SystemMetrics {
  timestamp: number;
  uptimeSeconds: number;
  activeRooms: number;
  activeGames: number;
  connectedPlayers: number;
  messagesPerSec: number;
  reconnectRate: number;
  errorRate: number;
  avgActionLatencyMs: number;
  p95ActionLatencyMs: number;
  p99ActionLatencyMs: number;
  avgEngineResolutionMs: number;
  p95EngineResolutionMs: number;
  p99EngineResolutionMs: number;
  cpuPercent: number;
  memoryRssMb: number;
  memoryHeapUsedMb: number;
  memoryHeapTotalMb: number;
  eventLoopLagMs: number;
  avgWebSocketMessageSizeBytes: number;
  totalMessagesSent: number;
  recentErrors: { timestamp: number; code: string; message: string; context?: string }[];
}

export default function AdminMonitorPage() {
  const { isAdmin, isLoading: authLoading, authFetch } = useAuth();
  const [accessDenied, setAccessDenied] = useState(false);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading(true);
      const res = await authFetch('/api/admin/monitor');
      if (res.status === 401 || res.status === 403) {
        setAccessDenied(true);
        setAutoRefresh(false);
        return;
      }
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setMetrics(json.data as SystemMetrics);
        }
      }
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (authLoading) return;
    fetchMetrics();
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchMetrics();
    }, 1500);
    return () => clearInterval(interval);
  }, [autoRefresh, authLoading, fetchMetrics]);

  if (!authLoading && (!isAdmin || accessDenied)) {
    return (
      <AppShell className="flex flex-col items-center justify-center py-24 text-center gap-4">
        <AlertTriangle className="w-10 h-10 text-gold-300" />
        <h1 className="text-title font-bold text-fg">运维监控仅对系统管理员开放</h1>
        <p className="text-body-sm text-fg-secondary">请使用管理员账号登录后再访问此页面。</p>
        <div className="flex gap-3">
          <Link href="/login?redirect=/admin/monitor">
            <Button variant="primary" size="md">前往登录</Button>
          </Link>
          <Link href="/admin">
            <Button variant="secondary" size="md">返回控制台</Button>
          </Link>
        </div>
      </AppShell>
    );
  }

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  };

  return (
    <AppShell wide className="space-y-6">
      <SectionHeader
        code="ADMIN // TELEMETRY"
        title="实时并发与性能监控看板"
        subtitle="REALTIME LATENCY · EVENT LOOP · WEBSOCKET THROUGHPUT"
        action={
          <>
            <Link href="/admin">
              <Button variant="secondary" size="md">
                <ArrowLeft className="w-4 h-4" />
                <span>返回总控</span>
              </Button>
            </Link>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setAutoRefresh((v) => !v)}
              className={autoRefresh ? 'border-teal-400 text-teal-400' : undefined}
            >
              <Radio className="w-4 h-4" />
              <span>自动刷新 (1.5s) {autoRefresh ? '开' : '关'}</span>
            </Button>
            <Button variant="secondary" size="md" onClick={fetchMetrics} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span>刷新</span>
            </Button>
          </>
        }
      />

      {/* 顶排核心数字指标 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 pgr-enter">
        <div className="relative border border-line bg-ink-850 p-4 flex flex-col justify-between">
          <HudBrackets color="steel" size="sm" />
          <div className="flex justify-between items-center text-caption text-fg-muted">
            <span>在线连接客户端</span>
            <Users className="w-4 h-4 text-teal-400" />
          </div>
          <div className="font-num tabular-nums text-display font-bold text-fg mt-2">
            {metrics?.connectedPlayers ?? 0}
            <span className="text-caption font-normal text-fg-muted ml-1.5">Sockets</span>
          </div>
          <div className="text-caption text-fg-muted mt-2 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-success" />
            <span>全双工链路就绪</span>
          </div>
        </div>

        <div className="relative border border-line bg-ink-850 p-4 flex flex-col justify-between">
          <HudBrackets color="steel" size="sm" />
          <div className="flex justify-between items-center text-caption text-fg-muted">
            <span>活跃房间 / 对局</span>
            <Swords className="w-4 h-4 text-gold-300" />
          </div>
          <div className="font-num tabular-nums text-display font-bold text-fg mt-2">
            {metrics?.activeRooms ?? 0}
            <span className="text-fg-disabled mx-1.5">/</span>
            <span className="text-teal-400">{metrics?.activeGames ?? 0}</span>
          </div>
          <div className="text-caption text-fg-muted mt-2">对局会话独立隔离</div>
        </div>

        <div className="relative border border-line bg-ink-850 p-4 flex flex-col justify-between">
          <HudBrackets color="steel" size="sm" />
          <div className="flex justify-between items-center text-caption text-fg-muted">
            <span>WebSocket 吞吐率</span>
            <Network className="w-4 h-4 text-steel-300" />
          </div>
          <div className="font-num tabular-nums text-display font-bold text-fg mt-2">
            {metrics?.messagesPerSec ?? 0}
            <span className="text-caption font-normal text-fg-muted ml-1.5">msg/s</span>
          </div>
          <div className="text-caption text-fg-muted mt-2 flex justify-between font-num">
            <span>均包体 {metrics?.avgWebSocketMessageSizeBytes ?? 0}B</span>
            <span>累计 {metrics?.totalMessagesSent ?? 0}</span>
          </div>
        </div>

        <div className="relative border border-line bg-ink-850 p-4 flex flex-col justify-between">
          <HudBrackets color="steel" size="sm" />
          <div className="flex justify-between items-center text-caption text-fg-muted">
            <span>终端运行时长</span>
            <Clock className="w-4 h-4 text-success" />
          </div>
          <div className="font-num tabular-nums text-title font-bold text-fg mt-3">
            {metrics ? formatUptime(metrics.uptimeSeconds) : '0h 0m 0s'}
          </div>
          <div className="text-caption text-fg-muted mt-2 flex justify-between font-num">
            <span>重连 {metrics?.reconnectRate ?? 0}</span>
            <span className={metrics?.errorRate ? 'text-crimson-400' : 'text-success'}>
              异常 {metrics?.errorRate ?? 0}
            </span>
          </div>
        </div>
      </div>

      {/* 延迟剖析 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pgr-enter pgr-delay-1">
        <Panel
          title="行动调度总延迟"
          subtitle="ACTION END-TO-END LATENCY"
          headerRight={<Zap className="w-4 h-4 text-gold-300" />}
        >
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 bg-ink-900 border border-line">
              <div className="text-caption text-fg-muted">AVG</div>
              <div className="font-num tabular-nums text-title font-bold text-teal-400 mt-1">
                {metrics?.avgActionLatencyMs ?? 0} ms
              </div>
            </div>
            <div className="p-3 bg-ink-900 border border-line">
              <div className="text-caption text-fg-muted">P95</div>
              <div className="font-num tabular-nums text-title font-bold text-success mt-1">
                {metrics?.p95ActionLatencyMs ?? 0} ms
              </div>
            </div>
            <div className="p-3 bg-ink-900 border border-line">
              <div className="text-caption text-fg-muted">P99</div>
              <div className="font-num tabular-nums text-title font-bold text-gold-300 mt-1">
                {metrics?.p99ActionLatencyMs ?? 0} ms
              </div>
            </div>
          </div>
          <p className="text-caption text-fg-muted mt-3">
            包含身份校验、限流判定、引擎解算、流水归档与脱敏组播的完整闭环耗时。
          </p>
        </Panel>

        <Panel
          title="规则引擎纯解算耗时"
          subtitle="GAME ENGINE RESOLUTION"
          headerRight={<Cpu className="w-4 h-4 text-teal-400" />}
        >
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 bg-ink-900 border border-line">
              <div className="text-caption text-fg-muted">AVG</div>
              <div className="font-num tabular-nums text-title font-bold text-teal-400 mt-1">
                {metrics?.avgEngineResolutionMs ?? 0} ms
              </div>
            </div>
            <div className="p-3 bg-ink-900 border border-line">
              <div className="text-caption text-fg-muted">P95</div>
              <div className="font-num tabular-nums text-title font-bold text-success mt-1">
                {metrics?.p95EngineResolutionMs ?? 0} ms
              </div>
            </div>
            <div className="p-3 bg-ink-900 border border-line">
              <div className="text-caption text-fg-muted">P99</div>
              <div className="font-num tabular-nums text-title font-bold text-gold-300 mt-1">
                {metrics?.p99EngineResolutionMs ?? 0} ms
              </div>
            </div>
          </div>
          <p className="text-caption text-fg-muted mt-3">
            基于确定性事务状态机与 O(1) 区域索引，单步规则裁定保持亚毫秒级响应。
          </p>
        </Panel>
      </div>

      {/* CPU / 内存 / Event Loop */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pgr-enter pgr-delay-2">
        <Panel title="CPU 占用率" headerRight={<Cpu className="w-4 h-4 text-teal-400" />}>
          <div className="font-num tabular-nums text-display font-bold text-fg">
            {metrics?.cpuPercent ?? 0}%
          </div>
          <div className="w-full h-1.5 bg-ink-700 mt-3 overflow-hidden">
            <div
              className="h-full bg-teal-400 transition-all duration-base"
              style={{ width: `${Math.min(100, metrics?.cpuPercent ?? 0)}%` }}
            />
          </div>
          <div className="flex justify-between text-caption text-fg-muted mt-2">
            <span>Node.js 主进程</span>
            <span className="font-num">目标 &lt; 35%</span>
          </div>
        </Panel>

        <Panel title="内存占用 (RSS / Heap)" headerRight={<HardDrive className="w-4 h-4 text-success" />}>
          <div className="font-num tabular-nums text-display font-bold text-fg">
            {metrics?.memoryRssMb ?? 0}
            <span className="text-caption font-normal text-fg-muted ml-1">MB</span>
          </div>
          <div className="w-full h-1.5 bg-ink-700 mt-3 overflow-hidden">
            <div
              className="h-full bg-success transition-all duration-base"
              style={{
                width: `${Math.min(
                  100,
                  ((metrics?.memoryHeapUsedMb ?? 1) / (metrics?.memoryHeapTotalMb ?? 100)) * 100,
                )}%`,
              }}
            />
          </div>
          <div className="flex justify-between text-caption text-fg-muted mt-2 font-num">
            <span>Heap {metrics?.memoryHeapUsedMb ?? 0} MB</span>
            <span>Total {metrics?.memoryHeapTotalMb ?? 0} MB</span>
          </div>
        </Panel>

        <Panel title="Event Loop Lag" headerRight={<Activity className="w-4 h-4 text-crimson-400" />}>
          <div className="font-num tabular-nums text-display font-bold text-fg">
            {metrics?.eventLoopLagMs ?? 0}
            <span className="text-caption font-normal text-fg-muted ml-1">ms</span>
          </div>
          <div className="w-full h-1.5 bg-ink-700 mt-3 overflow-hidden">
            <div
              className={`h-full transition-all duration-base ${
                (metrics?.eventLoopLagMs ?? 0) > 50
                  ? 'bg-crimson-500'
                  : (metrics?.eventLoopLagMs ?? 0) > 20
                    ? 'bg-gold-300'
                    : 'bg-teal-400'
              }`}
              style={{ width: `${Math.min(100, (metrics?.eventLoopLagMs ?? 0) * 2)}%` }}
            />
          </div>
          <div className="flex justify-between text-caption text-fg-muted mt-2">
            <span>主线程健康度</span>
            <span className="font-num">阈值 &lt; 50ms</span>
          </div>
        </Panel>
      </div>

      {/* 最近异常日志 */}
      <Panel
        title="最近系统异常与告警记录"
        subtitle="RECENT EXCEPTIONS"
        headerRight={
          <Badge variant={metrics?.errorRate ? 'crimson' : 'success'} className="font-num">
            异常 {metrics?.errorRate ?? 0}
          </Badge>
        }
      >
        <div className="h-44 overflow-y-auto bg-ink-950 border border-line p-3 space-y-1.5 font-num text-caption">
          {metrics?.recentErrors && metrics.recentErrors.length > 0 ? (
            metrics.recentErrors.map((err, i) => (
              <div key={i} className="flex items-center justify-between gap-3 border-b border-line/60 pb-1.5">
                <span className="text-crimson-400">
                  [{err.code}] {err.message}
                </span>
                <span className="text-fg-muted shrink-0">
                  {new Date(err.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))
          ) : (
            <div className="text-fg-muted text-center py-6">
              终端运行平稳，暂无异常告警。
            </div>
          )}
        </div>
      </Panel>
    </AppShell>
  );
}
