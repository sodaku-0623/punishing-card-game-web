'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ShieldAlert,
  Cpu,
  Layers,
  BookOpen,
  Database,
  Terminal,
  Activity,
  Upload,
  Download,
  PlusCircle,
  Clock,
  HardDrive,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  Sparkles,
  Swords,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { ALL_OFFICIAL_CARDS } from '@/lib/cards-data';
import { useAuth } from '@/lib/auth-context';

interface AdminStats {
  totalCards: number;
  activeCards: number;
  inactiveCards: number;
  activeRooms: number;
  activeGames: number;
  uptimeSeconds: number;
  memoryRssMb: number;
  rulesEngineVersion: string;
  serverTimestamp: number;
}

export default function AdminDashboardPage() {
  const { user, isAdmin, isLoggedIn, isLoading: authLoading, authFetch, logout } = useAuth();

  const [stats, setStats] = useState<AdminStats>({
    totalCards: ALL_OFFICIAL_CARDS.length,
    activeCards: ALL_OFFICIAL_CARDS.length,
    inactiveCards: 0,
    activeRooms: 0,
    activeGames: 0,
    uptimeSeconds: 120,
    memoryRssMb: 142,
    rulesEngineVersion: 'A0 第一版综合规则 (2025-11-14)',
    serverTimestamp: Date.now(),
  });
  const [loading, setLoading] = useState(false);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchJsonInput, setBatchJsonInput] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);

  const fetchStats = async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const res = await authFetch('/api/admin/stats');
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setStats(json.data);
        }
      }
    } catch {
      // 离线/开发模式使用默认全量静态卡牌数量
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchStats();
    }
  }, [isAdmin]);

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(ALL_OFFICIAL_CARDS, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `zhanshuang-cards-backup-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleBatchImport = async () => {
    try {
      const parsed = JSON.parse(batchJsonInput);
      const cards = Array.isArray(parsed) ? parsed : parsed.cards;
      if (!cards || !Array.isArray(cards)) {
        setImportStatus('错误: JSON 格式有误，必须为卡牌对象数组或包含 cards 属性的对象');
        return;
      }

      setLoading(true);
      const res = await authFetch('/api/admin/cards/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cards }),
      });

      if (res.ok) {
        const data = await res.json();
        setImportStatus(`成功导入 ${data.data?.importedCount ?? 0} 张新卡牌，更新 ${data.data?.updatedCount ?? 0} 张已有卡牌！`);
        fetchStats();
        setTimeout(() => {
          setBatchModalOpen(false);
          setImportStatus(null);
          setBatchJsonInput('');
        }, 2000);
      } else {
        setImportStatus('服务端导入失败，请检查卡牌属性格式');
      }
    } catch (e: any) {
      setImportStatus(`JSON 解析失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-terminalCyan font-mono">
        <Cpu className="w-8 h-8 animate-spin mb-4" />
        <p>正在验证总控安全授权凭证...</p>
      </div>
    );
  }

  if (!isLoggedIn || !isAdmin) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-neutral-200">
        <div className="max-w-md w-full p-8 rounded-2xl border border-erosionRed/50 bg-surface/90 backdrop-blur-xl text-center shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-erosionRed" />
          <div className="w-16 h-16 rounded-2xl bg-erosionRed/10 border border-erosionRed/40 flex items-center justify-center text-erosionRed mx-auto mb-6">
            <ShieldAlert className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">安全防护阻断：需要管理员权限</h2>
          <p className="text-xs text-neutral-400 mb-6 leading-relaxed">
            {isLoggedIn
              ? `当前登录指挥官【${user?.nickname}】为普通作战权限，后台管理与卡牌运维仅限总指挥部管理员账号接入。`
              : '后台管理与卡牌运维系统受最高安全协议限制，已禁止未授权直接访问。请先登录管理员账号。'}
          </p>
          <div className="flex flex-col gap-3 font-mono text-xs">
            <Link
              href="/login?redirect=/admin"
              className="w-full py-3 rounded-xl bg-erosionRed text-white font-bold hover:bg-erosionRed/90 transition-all flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(255,42,85,0.3)]"
            >
              <ShieldAlert className="w-4 h-4" />
              使用管理员账号登录
            </Link>
            <Link
              href="/"
              className="w-full py-2.5 rounded-xl border border-terminalBorder bg-neutral-900/60 text-neutral-400 hover:text-white hover:border-terminalCyan/40 transition-colors"
            >
              返回作战大厅首页
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-neutral-200 p-4 md:p-8 flex flex-col items-center">
      {/* 顶部导航 */}
      <header className="w-full max-w-7xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-terminalBorder/70 pb-6 mb-8">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-neutral-400 mb-1">
            <Link href="/" className="hover:text-terminalCyan transition-colors">
              终端首页
            </Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-terminalCyan">空中花园作战总控系统 (Admin Control)</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-black tracking-wide text-white flex items-center gap-3">
            <Cpu className="w-8 h-8 text-terminalCyan animate-pulse" />
            运维与卡牌管理控制台
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-terminalGold/40 bg-terminalGold/10 text-terminalGold text-xs font-mono">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>管理员: {user?.nickname}</span>
          </div>
          <button
            onClick={fetchStats}
            disabled={loading}
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-terminalBorder bg-surface hover:border-terminalCyan/70 text-xs font-mono transition-all text-neutral-300"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-terminalCyan' : ''}`} />
            刷新态势
          </button>
          <Link
            href="/admin/monitor"
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-purple-500/70 bg-purple-500/10 hover:bg-purple-500/20 text-xs font-mono font-bold text-purple-300 transition-all shadow-[0_0_15px_rgba(168,85,247,0.2)]"
          >
            <Activity className="w-4 h-4 text-purple-400" />
            实时并发与性能看板
          </Link>
          <Link
            href="/admin/cards"
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-terminalCyan bg-terminalCyan/10 hover:bg-terminalCyan/20 text-xs font-mono font-bold text-terminalCyan transition-all shadow-[0_0_15px_rgba(0,240,255,0.2)]"
          >
            <BookOpen className="w-4 h-4" />
            卡牌全量运维编辑
          </Link>
          <button
            onClick={logout}
            className="px-3 py-2 rounded-lg border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-xs font-mono text-red-400 transition-colors"
            title="退出登录"
          >
            退出
          </button>
        </div>
      </header>

      {/* 运维关键指标卡片网格 */}
      <section className="w-full max-w-7xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* 卡牌档案库 */}
        <div className="p-5 rounded-xl border border-terminalBorder bg-surface/80 backdrop-blur flex flex-col justify-between relative overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div>
              <span className="text-xs font-mono text-neutral-400 uppercase tracking-wider">
                官方与扩展卡牌库
              </span>
              <h3 className="text-3xl font-black font-mono text-white mt-1">
                {stats.totalCards} <span className="text-xs font-normal text-neutral-500">张</span>
              </h3>
            </div>
            <div className="p-2.5 rounded-lg bg-terminalCyan/10 text-terminalCyan border border-terminalCyan/30">
              <Database className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-center justify-between text-xs font-mono text-neutral-400 pt-3 border-t border-terminalBorder/50">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              已实装 {stats.activeCards}
            </span>
            <span className="text-neutral-500">下架 {stats.inactiveCards}</span>
          </div>
        </div>

        {/* 规则引擎裁判内核 */}
        <div className="p-5 rounded-xl border border-terminalBorder bg-surface/80 backdrop-blur flex flex-col justify-between relative overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div>
              <span className="text-xs font-mono text-neutral-400 uppercase tracking-wider">
                规则引擎仲裁内核
              </span>
              <h3 className="text-base font-bold text-white mt-1 truncate max-w-[190px]">
                {stats.rulesEngineVersion}
              </h3>
            </div>
            <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/30">
              <Terminal className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-center justify-between text-xs font-mono text-neutral-400 pt-3 border-t border-terminalBorder/50">
            <span className="text-terminalCyan">HFSM 状态机权威仲裁</span>
            <span className="text-emerald-400">0 越权事件</span>
          </div>
        </div>

        {/* 联机对局态势 */}
        <div className="p-5 rounded-xl border border-terminalBorder bg-surface/80 backdrop-blur flex flex-col justify-between relative overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div>
              <span className="text-xs font-mono text-neutral-400 uppercase tracking-wider">
                当前活跃对战推演
              </span>
              <h3 className="text-3xl font-black font-mono text-white mt-1">
                {stats.activeRooms} <span className="text-xs font-normal text-neutral-500">房间</span>
              </h3>
            </div>
            <div className="p-2.5 rounded-lg bg-erosionRed/10 text-erosionRed border border-erosionRed/30">
              <Swords className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-center justify-between text-xs font-mono text-neutral-400 pt-3 border-t border-terminalBorder/50">
            <span className="text-neutral-400">进行中会话: {stats.activeGames}</span>
            <Link href="/rooms" className="text-terminalCyan hover:underline">
              进入大厅 &rarr;
            </Link>
          </div>
        </div>

        {/* 服务器运行状态 */}
        <div className="p-5 rounded-xl border border-terminalBorder bg-surface/80 backdrop-blur flex flex-col justify-between relative overflow-hidden">
          <div className="flex justify-between items-start mb-4">
            <div>
              <span className="text-xs font-mono text-neutral-400 uppercase tracking-wider">
                服务器运行负载
              </span>
              <h3 className="text-xl font-bold font-mono text-emerald-400 mt-1">
                {stats.memoryRssMb} MB <span className="text-xs font-normal text-neutral-500">RSS</span>
              </h3>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              <Activity className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-center justify-between text-xs font-mono text-neutral-400 pt-3 border-t border-terminalBorder/50">
            <span>运行时间:</span>
            <span className="text-neutral-300">{formatUptime(stats.uptimeSeconds)}</span>
          </div>
        </div>
      </section>

      {/* 核心快捷运维面板 */}
      <section className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* 卡牌运维快捷入口 */}
        <div className="lg:col-span-2 p-6 rounded-xl border border-terminalBorder bg-surface/60 backdrop-blur flex flex-col gap-5">
          <div className="flex justify-between items-center border-b border-terminalBorder/60 pb-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-terminalCyan" />
              卡牌数据中心与扩展维护
            </h3>
            <span className="text-xs font-mono text-neutral-500">CARD OPERATIONS</span>
          </div>

          <p className="text-xs text-neutral-400 leading-relaxed">
            支持对《战双帕弥什 卡牌对战》全量卡表（ST01、ST02、ST03 预组、BP01 及后续扩展包）进行在线查看、属性编辑、效果文勘误（Errata）以及退环境上下架操作。每一次卡牌变更将自动生成独立的不可篡改快照版本链（CardVersion）。
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <Link
              href="/admin/cards"
              className="p-4 rounded-xl border border-terminalBorder bg-black/40 hover:border-terminalCyan transition-all flex flex-col items-center text-center group"
            >
              <BookOpen className="w-6 h-6 text-terminalCyan mb-2 group-hover:scale-110 transition-transform" />
              <span className="text-sm font-bold text-white">卡牌全表运维</span>
              <span className="text-[11px] text-neutral-500 mt-1">搜索、编辑、调平数值</span>
            </Link>

            <button
              onClick={() => setBatchModalOpen(true)}
              className="p-4 rounded-xl border border-terminalBorder bg-black/40 hover:border-terminalCyan transition-all flex flex-col items-center text-center group"
            >
              <Upload className="w-6 h-6 text-emerald-400 mb-2 group-hover:scale-110 transition-transform" />
              <span className="text-sm font-bold text-white">批量导入新卡包</span>
              <span className="text-[11px] text-neutral-500 mt-1">导入 JSON 扩展卡表</span>
            </button>

            <button
              onClick={handleExportJson}
              className="p-4 rounded-xl border border-terminalBorder bg-black/40 hover:border-terminalCyan transition-all flex flex-col items-center text-center group"
            >
              <Download className="w-6 h-6 text-amber-400 mb-2 group-hover:scale-110 transition-transform" />
              <span className="text-sm font-bold text-white">导出全量卡表</span>
              <span className="text-[11px] text-neutral-500 mt-1">下载当前数据库备份</span>
            </button>
          </div>
        </div>

        {/* 预组卡组与环境态势 */}
        <div className="p-6 rounded-xl border border-terminalBorder bg-surface/60 backdrop-blur flex flex-col gap-4">
          <div className="flex justify-between items-center border-b border-terminalBorder/60 pb-3">
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-purple-400" />
              官方标准 50 张预组
            </h3>
            <span className="text-xs font-mono text-neutral-500">STARTER DECKS</span>
          </div>

          <div className="flex flex-col gap-2.5 text-xs">
            <div className="p-3 rounded-lg border border-terminalBorder/60 bg-black/40 flex justify-between items-center">
              <div>
                <span className="font-bold text-white">ST01 灰鸦小队预组</span>
                <p className="text-[11px] text-neutral-500 font-mono">物理属性 • 露西亚/丽芙/里</p>
              </div>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px]">
                50张合规
              </span>
            </div>

            <div className="p-3 rounded-lg border border-terminalBorder/60 bg-black/40 flex justify-between items-center">
              <div>
                <span className="font-bold text-white">ST02 升格者预组</span>
                <p className="text-[11px] text-neutral-500 font-mono">暗属性 • 露娜领衔</p>
              </div>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px]">
                50张合规
              </span>
            </div>

            <div className="p-3 rounded-lg border border-terminalBorder/60 bg-black/40 flex justify-between items-center">
              <div>
                <span className="font-bold text-white">ST03 三头犬小队预组</span>
                <p className="text-[11px] text-neutral-500 font-mono">暗属性 • 薇拉/21号</p>
              </div>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[10px]">
                50张合规
              </span>
            </div>
          </div>

          <Link
            href="/decks"
            className="w-full mt-auto py-2.5 rounded-lg border border-terminalBorder bg-surface hover:border-terminalCyan/70 text-xs font-mono text-center text-neutral-300 hover:text-white transition-colors"
          >
            查看所有玩家与预组卡组 &rarr;
          </Link>
        </div>
      </section>

      {/* 批量导入卡包 Modal */}
      {batchModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-surface border border-terminalBorder rounded-2xl p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-terminalBorder/60 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Upload className="w-5 h-5 text-terminalCyan" />
                批量导入新卡牌 / 扩展包数据 (JSON)
              </h3>
              <button
                onClick={() => setBatchModalOpen(false)}
                className="text-neutral-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-neutral-400 leading-relaxed">
              请在下方粘贴合规的卡牌 JSON 数据。支持单个卡牌数组，字段需包含 <code>cardNumber</code>, <code>name</code>, <code>cardType</code>, <code>attribute</code>, <code>cost</code>, <code>rulesText</code> 等。
            </p>

            <textarea
              value={batchJsonInput}
              onChange={(e) => setBatchJsonInput(e.target.value)}
              placeholder={`[\n  {\n    "cardNumber": "EX01-001",\n    "name": "测试新卡牌",\n    "cardType": "ROLE",\n    "attribute": "PHYSICAL",\n    "cost": 3,\n    "basePP": 3500,\n    "baseDP": 1,\n    "traits": ["测试"],\n    "rulesText": "【出】：抽1张牌。"\n  }\n]`}
              className="w-full h-64 bg-black/60 border border-terminalBorder rounded-lg p-3 text-xs font-mono text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-terminalCyan transition-colors"
            />

            {importStatus && (
              <div
                className={`p-3 rounded-lg text-xs font-mono ${
                  importStatus.startsWith('成功')
                    ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30'
                    : 'bg-erosionRed/10 text-erosionRed border border-erosionRed/30'
                }`}
              >
                {importStatus}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setBatchModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-terminalBorder text-xs text-neutral-400 hover:text-white"
              >
                取消
              </button>
              <button
                onClick={handleBatchImport}
                disabled={loading || !batchJsonInput.trim()}
                className="px-5 py-2 rounded-lg border border-terminalCyan bg-terminalCyan/20 hover:bg-terminalCyan/30 text-terminalCyan font-mono text-xs font-bold transition-all disabled:opacity-50"
              >
                {loading ? '导入中...' : '确认批量录入'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
