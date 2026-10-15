'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowLeft,
  Cpu,
  HardDrive,
  Clock,
  Radio,
  RefreshCw,
  Server,
  Zap,
  Users,
  Swords,
  AlertTriangle,
  Layers,
  Network,
  CheckCircle2,
  Sliders,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

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
  const [historyCpu, setHistoryCpu] = useState<number[]>([]);
  const [historyMemory, setHistoryMemory] = useState<number[]>([]);

  const fetchMetrics = async () => {
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
          const d = json.data as SystemMetrics;
          setMetrics(d);
          setHistoryCpu((prev) => [...prev, d.cpuPercent].slice(-20));
          setHistoryMemory((prev) => [...prev, d.memoryRssMb].slice(-20));
        }
      }
    } catch {
      // offline/demo
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (authLoading) return;
    fetchMetrics();
    if (!autoRefresh) return;
    // 页面不可见时跳过轮询，避免后台标签页持续请求
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchMetrics();
    }, 1500);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, authLoading, authFetch]);

  if (!authLoading && (!isAdmin || accessDenied)) {
    return (
      <div className="min-h-screen bg-neutral-950 text-foreground font-mono p-6 flex flex-col items-center justify-center gap-4 text-center">
        <AlertTriangle className="w-8 h-8 text-terminalGold" />
        <p className="text-sm text-white font-bold">运维监控仅对系统管理员开放</p>
        <p className="text-xs text-neutral-400">请使用管理员账号登录后再访问此页面。</p>
        <div className="flex gap-3">
          <Link href="/login" className="px-4 py-2 rounded-lg bg-terminalCyan text-neutral-950 text-xs font-bold">
            前往登录
          </Link>
          <Link href="/admin" className="px-4 py-2 rounded-lg border border-terminalBorder text-neutral-300 text-xs">
            返回控制台
          </Link>
        </div>
      </div>
    );
  }

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}时 ${m}分 ${s}秒`;
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-foreground font-mono p-4 sm:p-6 select-none">
      {/* 头部导航与状态 */}
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-terminalBorder/60">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="p-2 rounded-lg bg-surface border border-terminalBorder text-neutral-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-terminalCyan animate-pulse" />
              <h1 className="text-xl font-bold text-white tracking-wider">
                作战终端实时运维看板 • METRICS MONITOR
              </h1>
            </div>
            <p className="text-xs text-neutral-500 mt-0.5">
              高精毫秒级并发指标监控、Event Loop 状态、WebSocket 吞吐量与系统健康度
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 rounded-lg border text-xs flex items-center gap-2 transition-all ${
              autoRefresh
                ? 'bg-terminalCyan/15 border-terminalCyan text-terminalCyan'
                : 'bg-surface border-terminalBorder text-neutral-400 hover:text-white'
            }`}
          >
            <Radio className={`w-3.5 h-3.5 ${autoRefresh ? 'animate-pulse' : ''}`} />
            <span>实时自刷新 (1.5s) {autoRefresh ? '已开启' : '已暂停'}</span>
          </button>

          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="px-3 py-1.5 rounded-lg bg-surface hover:bg-neutral-900 border border-terminalBorder text-xs text-neutral-300 flex items-center gap-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-terminalCyan' : ''}`} />
            <span>刷新</span>
          </button>
        </div>
      </div>

      {/* 主面板内容 */}
      <div className="max-w-7xl mx-auto mt-6 flex flex-col gap-6">
        {/* 顶部核心数字指标卡片 (4 列) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 在线人数与长连接 */}
          <div className="p-4 rounded-xl border border-terminalBorder bg-surface/80 flex flex-col justify-between shadow-lg">
            <div className="flex justify-between items-center text-neutral-400 text-xs">
              <span>在线连接客户端</span>
              <Users className="w-4 h-4 text-terminalCyan" />
            </div>
            <div className="text-3xl font-black text-white mt-2">
              {metrics ? metrics.connectedPlayers : 0}
              <span className="text-xs font-normal text-neutral-500 ml-1.5">Sockets</span>
            </div>
            <div className="text-[11px] text-neutral-500 mt-2 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>全双工握手链路就绪</span>
            </div>
          </div>

          {/* 进行中房间与对局 */}
          <div className="p-4 rounded-xl border border-terminalBorder bg-surface/80 flex flex-col justify-between shadow-lg">
            <div className="flex justify-between items-center text-neutral-400 text-xs">
              <span>活跃作战房间 / 对局</span>
              <Swords className="w-4 h-4 text-terminalGold" />
            </div>
            <div className="text-3xl font-black text-white mt-2">
              {metrics ? metrics.activeRooms : 0}{' '}
              <span className="text-base text-neutral-500 font-normal">/</span>{' '}
              <span className="text-terminalCyan">{metrics ? metrics.activeGames : 0}</span>
            </div>
            <div className="text-[11px] text-neutral-500 mt-2">
              活跃对局会话隔离运行中
            </div>
          </div>

          {/* 实时消息吞吐量 */}
          <div className="p-4 rounded-xl border border-terminalBorder bg-surface/80 flex flex-col justify-between shadow-lg">
            <div className="flex justify-between items-center text-neutral-400 text-xs">
              <span>WebSocket 吞吐率</span>
              <Network className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-3xl font-black text-white mt-2">
              {metrics ? metrics.messagesPerSec : 0}
              <span className="text-xs font-normal text-neutral-500 ml-1.5">msgs / sec</span>
            </div>
            <div className="text-[11px] text-neutral-500 mt-2 flex items-center justify-between">
              <span>均包体: {metrics ? metrics.avgWebSocketMessageSizeBytes : 0} B</span>
              <span>累计: {metrics ? metrics.totalMessagesSent : 0}</span>
            </div>
          </div>

          {/* 系统运行时间与健康态 */}
          <div className="p-4 rounded-xl border border-terminalBorder bg-surface/80 flex flex-col justify-between shadow-lg">
            <div className="flex justify-between items-center text-neutral-400 text-xs">
              <span>终端运行时长</span>
              <Clock className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-xl font-bold text-white mt-2">
              {metrics ? formatUptime(metrics.uptimeSeconds) : '0秒'}
            </div>
            <div className="text-[11px] text-neutral-500 mt-2 flex items-center justify-between">
              <span>重连: {metrics?.reconnectRate ?? 0}</span>
              <span className={metrics?.errorRate ? 'text-erosionRed' : 'text-emerald-400'}>
                异常: {metrics?.errorRate ?? 0}
              </span>
            </div>
          </div>
        </div>

        {/* 第二排：延迟与性能剖析 (Action Latency & Engine Resolution) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Action 往返端到端延迟 */}
          <div className="p-5 rounded-xl border border-terminalBorder bg-surface/80 flex flex-col gap-4 shadow-lg">
            <div className="flex justify-between items-center border-b border-terminalBorder/60 pb-3">
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-terminalGold" />
                <span className="font-bold text-white text-sm">行动调度总延迟 (Action Latency)</span>
              </div>
              <span className="text-[11px] text-neutral-500">网络接收 ➔ 结算 ➔ 广播</span>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 rounded-lg bg-neutral-900/80 border border-neutral-800">
                <div className="text-xs text-neutral-400">平均耗时 (AVG)</div>
                <div className="text-2xl font-bold text-terminalCyan mt-1">
                  {metrics?.avgActionLatencyMs ?? 0} <span className="text-xs">ms</span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-neutral-900/80 border border-neutral-800">
                <div className="text-xs text-neutral-400">95分位 (P95)</div>
                <div className="text-2xl font-bold text-emerald-400 mt-1">
                  {metrics?.p95ActionLatencyMs ?? 0} <span className="text-xs">ms</span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-neutral-900/80 border border-neutral-800">
                <div className="text-xs text-neutral-400">99分位 (P99)</div>
                <div className="text-2xl font-bold text-yellow-400 mt-1">
                  {metrics?.p99ActionLatencyMs ?? 0} <span className="text-xs">ms</span>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-neutral-500 leading-relaxed">
              包含身份令牌校验、速率防刷判定、权威引擎计算、数据库流水归档以及脱敏组播下发的全链路闭环耗时。
            </p>
          </div>

          {/* Game Engine 核心纯算法解析耗时 */}
          <div className="p-5 rounded-xl border border-terminalBorder bg-surface/80 flex flex-col gap-4 shadow-lg">
            <div className="flex justify-between items-center border-b border-terminalBorder/60 pb-3">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-terminalCyan" />
                <span className="font-bold text-white text-sm">规则引擎纯解算耗时 (Engine Resolution)</span>
              </div>
              <span className="text-[11px] text-neutral-500">Zone / SBA / Combat / AST</span>
            </div>

            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-3 rounded-lg bg-neutral-900/80 border border-neutral-800">
                <div className="text-xs text-neutral-400">平均耗时 (AVG)</div>
                <div className="text-2xl font-bold text-terminalCyan mt-1">
                  {metrics?.avgEngineResolutionMs ?? 0} <span className="text-xs">ms</span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-neutral-900/80 border border-neutral-800">
                <div className="text-xs text-neutral-400">95分位 (P95)</div>
                <div className="text-2xl font-bold text-emerald-400 mt-1">
                  {metrics?.p95EngineResolutionMs ?? 0} <span className="text-xs">ms</span>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-neutral-900/80 border border-neutral-800">
                <div className="text-xs text-neutral-400">99分位 (P99)</div>
                <div className="text-2xl font-bold text-yellow-400 mt-1">
                  {metrics?.p99EngineResolutionMs ?? 0} <span className="text-xs">ms</span>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-neutral-500 leading-relaxed">
              基于 O(1) 零内存分配卡区物理索引与确定性事件流生成，引擎单步判定速度已进入微秒/亚毫秒级。
            </p>
          </div>
        </div>

        {/* 第三排：CPU、内存与 Event Loop Lag 负载仪表 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* CPU 占用率 */}
          <div className="p-4 rounded-xl border border-terminalBorder bg-surface/80 flex flex-col gap-3 shadow-lg">
            <div className="flex justify-between items-center text-xs text-neutral-400">
              <span>CPU 占用率</span>
              <Cpu className="w-4 h-4 text-terminalCyan" />
            </div>
            <div className="text-3xl font-black text-white">
              {metrics ? metrics.cpuPercent : 0}%
            </div>
            <div className="w-full bg-neutral-900 h-2 rounded-full overflow-hidden border border-neutral-800">
              <div
                className="bg-terminalCyan h-full transition-all duration-300"
                style={{ width: `${Math.min(100, metrics?.cpuPercent ?? 0)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              <span>单核 Node.js 负载</span>
              <span>50 房间指标目标: &lt; 35%</span>
            </div>
          </div>

          {/* 内存消耗 (RSS & Heap) */}
          <div className="p-4 rounded-xl border border-terminalBorder bg-surface/80 flex flex-col gap-3 shadow-lg">
            <div className="flex justify-between items-center text-xs text-neutral-400">
              <span>内存占用 (RSS / Heap)</span>
              <HardDrive className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-3xl font-black text-white">
              {metrics ? metrics.memoryRssMb : 0}{' '}
              <span className="text-xs font-normal text-neutral-500">MB RSS</span>
            </div>
            <div className="w-full bg-neutral-900 h-2 rounded-full overflow-hidden border border-neutral-800">
              <div
                className="bg-emerald-400 h-full transition-all duration-300"
                style={{
                  width: `${Math.min(
                    100,
                    ((metrics?.memoryHeapUsedMb ?? 1) / (metrics?.memoryHeapTotalMb ?? 100)) * 100
                  )}%`,
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              <span>Heap Used: {metrics?.memoryHeapUsedMb ?? 0} MB</span>
              <span>Total: {metrics?.memoryHeapTotalMb ?? 0} MB</span>
            </div>
          </div>

          {/* 事件循环阻塞时延 (Event Loop Lag) */}
          <div className="p-4 rounded-xl border border-terminalBorder bg-surface/80 flex flex-col gap-3 shadow-lg">
            <div className="flex justify-between items-center text-xs text-neutral-400">
              <span>Event Loop Lag (事件循环延迟)</span>
              <Activity className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-3xl font-black text-white">
              {metrics ? metrics.eventLoopLagMs : 0}{' '}
              <span className="text-xs font-normal text-neutral-500">ms</span>
            </div>
            <div className="w-full bg-neutral-900 h-2 rounded-full overflow-hidden border border-neutral-800">
              <div
                className={`h-full transition-all duration-300 ${
                  (metrics?.eventLoopLagMs ?? 0) > 50
                    ? 'bg-erosionRed'
                    : (metrics?.eventLoopLagMs ?? 0) > 20
                    ? 'bg-yellow-400'
                    : 'bg-terminalCyan'
                }`}
                style={{ width: `${Math.min(100, (metrics?.eventLoopLagMs ?? 0) * 2)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-neutral-500">
              <span>主线程健康度: 优秀</span>
              <span>容限阈值: &lt; 50ms</span>
            </div>
          </div>
        </div>

        {/* 最近异常日志 */}
        <div className="p-5 rounded-xl border border-terminalBorder bg-surface/80 flex flex-col gap-3 shadow-lg">
          <div className="flex justify-between items-center border-b border-terminalBorder/60 pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-erosionRed" />
              <span className="font-bold text-white text-sm">最近系统异常与告警记录 (Recent Exceptions)</span>
            </div>
            <span className="text-xs text-neutral-500">
              共捕获 {metrics?.errorRate ?? 0} 起异常
            </span>
          </div>

          <div className="h-44 overflow-y-auto bg-neutral-950 p-3 rounded-lg border border-terminalBorder text-xs text-neutral-300 flex flex-col gap-1.5 font-mono">
            {metrics?.recentErrors && metrics.recentErrors.length > 0 ? (
              metrics.recentErrors.map((err, i) => (
                <div key={i} className="flex items-center justify-between border-b border-neutral-900 pb-1">
                  <span className="text-erosionRed font-bold">[{err.code}] {err.message}</span>
                  <span className="text-neutral-600 text-[10px]">
                    {new Date(err.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))
            ) : (
              <span className="text-neutral-600 italic py-2 text-center">
                ✨ 终端健康无异常，所有动作流转顺畅
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
