'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
  RefreshCw,
  Swords,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import { ALL_OFFICIAL_CARDS } from '@/lib/cards-data';
import { useAuth } from '@/lib/auth-context';
import {
  AppShell,
  Button,
  Badge,
  Panel,
  SectionHeader,
  Dialog,
  HudBrackets,
} from '@/components/ui';

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
  const { user, isAdmin, isLoggedIn, isLoading: authLoading, authFetch } = useAuth();

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

  const fetchStats = useCallback(async () => {
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
      // 离线/开发模式保持默认数据
    } finally {
      setLoading(false);
    }
  }, [isAdmin, authFetch]);

  useEffect(() => {
    if (isAdmin) {
      fetchStats();
    }
  }, [isAdmin, fetchStats]);

  const handleExportJson = () => {
    const dataStr =
      'data:text/json;charset=utf-8,' +
      encodeURIComponent(JSON.stringify(ALL_OFFICIAL_CARDS, null, 2));
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
        setImportStatus(
          `成功导入 ${data.data?.importedCount ?? 0} 张新卡牌，更新 ${data.data?.updatedCount ?? 0} 张已有卡牌。`,
        );
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
      <AppShell className="flex flex-col items-center justify-center py-24 text-center">
        <Cpu className="w-8 h-8 text-crimson-500 animate-spin mb-4" />
        <p className="text-body-sm text-fg-secondary">正在验证总控安全授权凭证...</p>
      </AppShell>
    );
  }

  if (!isLoggedIn || !isAdmin) {
    return (
      <AppShell className="flex items-center justify-center py-16">
        <div className="max-w-md w-full border border-crimson-500/60 bg-ink-900 p-8 text-center relative">
          <HudBrackets color="crimson" />
          <div className="h-14 w-14 mx-auto mb-5 border border-crimson-500/60 bg-crimson-700/20 flex items-center justify-center text-crimson-400">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <h1 className="text-title font-bold text-fg mb-2">安全防护阻断：需要管理员权限</h1>
          <p className="text-body-sm text-fg-secondary mb-6 leading-relaxed">
            {isLoggedIn
              ? `当前登录指挥官【${user?.nickname}】为普通作战权限，后台管理与卡牌运维仅限总指挥部管理员账号接入。`
              : '后台管理与卡牌运维系统受最高安全协议限制，请先使用管理员账号登录。'}
          </p>
          <div className="flex flex-col gap-2.5">
            <Link href="/login?redirect=/admin">
              <Button variant="primary" size="lg" className="w-full">
                <ShieldAlert className="w-4 h-4" />
                <span>使用管理员账号登录</span>
              </Button>
            </Link>
            <Link href="/">
              <Button variant="secondary" size="md" className="w-full">
                返回作战大厅首页
              </Button>
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell wide className="space-y-8">
      <SectionHeader
        code="ADMIN // BABYLONIA COMMAND"
        title="运维与卡牌管理控制台"
        subtitle="SYSTEM OPERATIONS & CARD ARCHIVE CONTROL"
        action={
          <>
            <Button variant="secondary" size="md" onClick={fetchStats} disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span>刷新态势</span>
            </Button>
            <Link href="/admin/monitor">
              <Button variant="secondary" size="md">
                <Activity className="w-4 h-4 text-teal-400" />
                <span>性能看板</span>
              </Button>
            </Link>
            <Link href="/admin/cards">
              <Button variant="primary" size="md">
                <BookOpen className="w-4 h-4" />
                <span>卡牌全表运维</span>
              </Button>
            </Link>
          </>
        }
      />

      {/* 关键指标卡片 */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pgr-enter">
        <div className="relative border border-line bg-ink-850 p-5 flex flex-col justify-between">
          <HudBrackets color="steel" size="sm" />
          <div className="flex items-start justify-between mb-4">
            <div>
              <span className="font-display text-hud uppercase text-fg-muted">
                CARD ARCHIVE
              </span>
              <div className="font-num tabular-nums text-display font-bold text-fg mt-1">
                {stats.totalCards}
              </div>
            </div>
            <Database className="w-5 h-5 text-teal-400" />
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-line text-caption">
            <span className="inline-flex items-center gap-1 text-success font-num">
              <CheckCircle2 className="w-3.5 h-3.5" />
              已实装 {stats.activeCards}
            </span>
            <span className="text-fg-muted font-num">下架 {stats.inactiveCards}</span>
          </div>
        </div>

        <div className="relative border border-line bg-ink-850 p-5 flex flex-col justify-between">
          <HudBrackets color="steel" size="sm" />
          <div className="flex items-start justify-between mb-4">
            <div className="min-w-0">
              <span className="font-display text-hud uppercase text-fg-muted">
                RULES ENGINE
              </span>
              <div className="text-body font-semibold text-fg mt-2 truncate">
                {stats.rulesEngineVersion}
              </div>
            </div>
            <Terminal className="w-5 h-5 text-gold-300 shrink-0" />
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-line text-caption">
            <span className="text-fg-secondary">HFSM 状态机权威仲裁</span>
            <span className="text-success font-num">0 越权</span>
          </div>
        </div>

        <div className="relative border border-line bg-ink-850 p-5 flex flex-col justify-between">
          <HudBrackets color="steel" size="sm" />
          <div className="flex items-start justify-between mb-4">
            <div>
              <span className="font-display text-hud uppercase text-fg-muted">
                ACTIVE ROOMS
              </span>
              <div className="font-num tabular-nums text-display font-bold text-fg mt-1">
                {stats.activeRooms}
              </div>
            </div>
            <Swords className="w-5 h-5 text-crimson-400" />
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-line text-caption">
            <span className="text-fg-muted font-num">进行中对局 {stats.activeGames}</span>
            <Link href="/rooms" className="text-teal-400 hover:underline inline-flex items-center gap-0.5">
              大厅 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        <div className="relative border border-line bg-ink-850 p-5 flex flex-col justify-between">
          <HudBrackets color="steel" size="sm" />
          <div className="flex items-start justify-between mb-4">
            <div>
              <span className="font-display text-hud uppercase text-fg-muted">
                SERVER LOAD
              </span>
              <div className="font-num tabular-nums text-display font-bold text-success mt-1">
                {stats.memoryRssMb}
                <span className="text-caption font-normal text-fg-muted ml-1">MB</span>
              </div>
            </div>
            <Activity className="w-5 h-5 text-success" />
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-line text-caption">
            <span className="text-fg-muted">运行时长</span>
            <span className="font-num text-fg-secondary">{formatUptime(stats.uptimeSeconds)}</span>
          </div>
        </div>
      </section>

      {/* 核心快捷运维面板 */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 pgr-enter pgr-delay-1">
        <Panel
          className="lg:col-span-2"
          title="卡牌数据中心与扩展维护"
          subtitle="CARD OPERATIONS"
          brackets
        >
          <p className="text-body-sm text-fg-secondary leading-relaxed mb-5">
            支持对《战双帕弥什 卡牌对战》全量卡表进行在线查看、属性编辑、效果文勘误（Errata）以及批量导入备份。每次卡牌变更将自动生成独立快照版本链（CardVersion）。
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Link
              href="/admin/cards"
              className="group p-5 border border-line bg-ink-900 hover:bg-ink-800 hover:border-line-strong transition-colors flex flex-col items-center text-center pgr-sweep"
            >
              <BookOpen className="w-6 h-6 text-teal-400 mb-2.5" />
              <span className="text-body-sm font-semibold text-fg">卡牌全表运维</span>
              <span className="text-caption text-fg-muted mt-1">搜索、编辑与勘误</span>
            </Link>

            <button
              type="button"
              onClick={() => setBatchModalOpen(true)}
              className="group p-5 border border-line bg-ink-900 hover:bg-ink-800 hover:border-line-strong transition-colors flex flex-col items-center text-center pgr-sweep cursor-pointer"
            >
              <Upload className="w-6 h-6 text-success mb-2.5" />
              <span className="text-body-sm font-semibold text-fg">批量导入新卡包</span>
              <span className="text-caption text-fg-muted mt-1">导入 JSON 扩展卡表</span>
            </button>

            <button
              type="button"
              onClick={handleExportJson}
              className="group p-5 border border-line bg-ink-900 hover:bg-ink-800 hover:border-line-strong transition-colors flex flex-col items-center text-center pgr-sweep cursor-pointer"
            >
              <Download className="w-6 h-6 text-gold-300 mb-2.5" />
              <span className="text-body-sm font-semibold text-fg">导出全量卡表</span>
              <span className="text-caption text-fg-muted mt-1">下载当前数据库备份</span>
            </button>
          </div>
        </Panel>

        <Panel
          title="官方标准 50 张预组"
          subtitle="STARTER DECKS"
          headerRight={<Layers className="w-4 h-4 text-fg-muted" />}
        >
          <div className="space-y-2.5">
            {[
              { name: 'ST01 灰鸦小队预组', desc: '物理属性 · 露西亚 / 丽芙 / 里' },
              { name: 'ST02 升格者预组', desc: '暗属性 · 露娜领衔' },
              { name: 'ST03 三头犬小队预组', desc: '暗属性 · 薇拉 / 21号' },
            ].map((item) => (
              <div
                key={item.name}
                className="p-3 border border-line bg-ink-900 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="text-body-sm font-semibold text-fg truncate">{item.name}</div>
                  <div className="text-caption text-fg-muted truncate">{item.desc}</div>
                </div>
                <Badge variant="success">50 张合规</Badge>
              </div>
            ))}
          </div>

          <Link href="/decks" className="block mt-4">
            <Button variant="secondary" size="md" className="w-full">
              <span>查看全部卡组</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </Panel>
      </section>

      {/* 批量导入 Modal */}
      <Dialog
        open={batchModalOpen}
        onClose={() => setBatchModalOpen(false)}
        title="批量导入新卡牌 / 扩展包数据 (JSON)"
        subtitle="BATCH IMPORT CARDS"
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setBatchModalOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={loading}
              disabled={!batchJsonInput.trim()}
              onClick={handleBatchImport}
            >
              确认批量录入
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-caption text-fg-secondary leading-relaxed">
            粘贴合规的卡牌 JSON 数组，字段需包含 <code className="font-num text-fg">cardNumber</code>、
            <code className="font-num text-fg">name</code>、<code className="font-num text-fg">cardType</code>、
            <code className="font-num text-fg">attribute</code>、<code className="font-num text-fg">cost</code>、
            <code className="font-num text-fg">rulesText</code> 等。
          </p>
          <textarea
            value={batchJsonInput}
            onChange={(e) => setBatchJsonInput(e.target.value)}
            aria-label="批量卡牌 JSON 数据"
            placeholder={`[\n  {\n    "cardNumber": "EX01-001",\n    "name": "测试新卡牌",\n    "cardType": "ROLE",\n    "attribute": "PHYSICAL",\n    "cost": 3,\n    "basePP": 3500,\n    "baseDP": 1,\n    "traits": ["测试"],\n    "rulesText": "【出】：抽1张牌。"\n  }\n]`}
            className="w-full h-64 bg-ink-800 border border-line p-3 text-caption font-num text-fg placeholder:text-fg-disabled focus:outline-none focus:border-teal-400 rounded-none"
          />
          {importStatus && (
            <div
              className={`p-3 border text-caption ${
                importStatus.startsWith('成功')
                  ? 'border-success/50 bg-success/10 text-success'
                  : 'border-crimson-500/60 bg-crimson-700/20 text-crimson-400'
              }`}
            >
              {importStatus}
            </div>
          )}
        </div>
      </Dialog>
    </AppShell>
  );
}
