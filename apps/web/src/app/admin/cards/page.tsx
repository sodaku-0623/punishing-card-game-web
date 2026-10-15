'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  ALL_OFFICIAL_CARDS,
  CardData,
  getCardSeries,
  formatCardType,
  getAttributeDisplay,
} from '@/lib/cards-data';
import { CardType, ElementAttribute, SignalOrbType } from '@zhanshuang/shared';
import {
  Search,
  BookOpen,
  PlusCircle,
  Edit,
  History,
  Power,
  PowerOff,
  ChevronRight,
  ChevronLeft,
  X,
  Check,
  AlertTriangle,
  Upload,
  Download,
  Filter,
  Save,
  RotateCcw,
  Sparkles,
  ShieldAlert,
  Cpu,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

interface CardVersionItem {
  id: string;
  versionNumber: number;
  snapshotData: any;
  createdAt: string;
}

export default function AdminCardsPage() {
  const { user, isAdmin, isLoggedIn, isLoading: authLoading, authFetch, logout } = useAuth();

  const [cards, setCards] = useState<CardData[]>(ALL_OFFICIAL_CARDS);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterAttr, setFilterAttr] = useState<string>('ALL');
  const [filterActive, setFilterActive] = useState<string>('ALL'); // ALL / ACTIVE / INACTIVE

  // 模态框状态
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

  // 当前选中操作卡牌
  const [selectedCard, setSelectedCard] = useState<CardData | null>(null);
  const [versionsHistory, setVersionsHistory] = useState<CardVersionItem[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  // 编辑表单字段
  const [formData, setFormData] = useState({
    cardNumber: '',
    name: '',
    cardType: CardType.ROLE,
    attribute: ElementAttribute.PHYSICAL,
    cost: 3,
    basePP: 3000,
    baseDP: 1,
    signalOrb: '' as string,
    isInstant: false,
    traits: '',
    rulesText: '',
    flavorText: '',
    imageUrl: '',
    errataReason: '',
  });

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  // 从服务端同步全量卡牌数据
  const fetchServerCards = async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const res = await authFetch('/api/admin/cards?take=500');
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          // 合并服务端卡牌与本地
          setCards(json.data);
        }
      }
    } catch {
      // 离线使用本地默认
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchServerCards();
    }
  }, [isAdmin]);

  // 过滤结果
  const filteredCards = useMemo(() => {
    return cards.filter((card) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const m1 = card.name.toLowerCase().includes(q);
        const m2 = card.cardNumber.toLowerCase().includes(q);
        const m3 = card.rulesText.toLowerCase().includes(q);
        if (!m1 && !m2 && !m3) return false;
      }
      if (filterType !== 'ALL' && card.cardType !== filterType) return false;
      if (filterAttr !== 'ALL' && card.attribute !== filterAttr) return false;
      return true;
    });
  }, [cards, searchQuery, filterType, filterAttr]);

  // 打开编辑窗口
  const handleOpenEdit = (card: CardData) => {
    setSelectedCard(card);
    setFormData({
      cardNumber: card.cardNumber,
      name: card.name,
      cardType: card.cardType,
      attribute: card.attribute,
      cost: card.cost,
      basePP: card.basePP ?? 0,
      baseDP: card.baseDP ?? 0,
      signalOrb: card.signalOrb || '',
      isInstant: !!card.isInstant,
      traits: card.traits.join(', '),
      rulesText: card.rulesText,
      flavorText: card.flavorText || '',
      imageUrl: card.imageUrl || `/cards/${card.cardNumber}.png`,
      errataReason: '管理员勘误调整',
    });
    setIsEditModalOpen(true);
  };

  // 打开新建窗口
  const handleOpenCreate = () => {
    setSelectedCard(null);
    setFormData({
      cardNumber: `EX01-${String(cards.length + 1).padStart(3, '0')}`,
      name: '',
      cardType: CardType.ROLE,
      attribute: ElementAttribute.PHYSICAL,
      cost: 3,
      basePP: 3000,
      baseDP: 1,
      signalOrb: '',
      isInstant: false,
      traits: '结构体',
      rulesText: '',
      flavorText: '',
      imageUrl: '',
      errataReason: '',
    });
    setIsCreateModalOpen(true);
  };

  // 提交新建卡牌
  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const newCardPayload = {
      cardNumber: formData.cardNumber.trim(),
      name: formData.name.trim(),
      cardType: formData.cardType,
      attribute: formData.attribute,
      cost: Number(formData.cost) || 0,
      basePP: formData.cardType === CardType.ROLE ? Number(formData.basePP) || 0 : undefined,
      baseDP: formData.cardType === CardType.ROLE ? Number(formData.baseDP) || 0 : undefined,
      signalOrb: formData.signalOrb ? (formData.signalOrb as SignalOrbType) : undefined,
      isInstant: formData.isInstant,
      traits: formData.traits.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      rulesText: formData.rulesText.trim(),
      flavorText: formData.flavorText.trim() || undefined,
      imageUrl: formData.imageUrl.trim() || undefined,
    };

    try {
      const res = await authFetch('/api/admin/cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCardPayload),
      });

      if (res.ok) {
        showNotification('success', `卡牌 [${newCardPayload.cardNumber}] 成功创建入库！`);
        setIsCreateModalOpen(false);
        fetchServerCards();
      } else {
        const err = await res.json();
        showNotification('error', `创建失败: ${err.error || '未知错误'}`);
      }
    } catch {
      // 纯前端模拟写入
      setCards((prev) => [
        {
          id: `card-${Date.now()}`,
          ...newCardPayload,
        },
        ...prev,
      ]);
      showNotification('success', `卡牌 [${newCardPayload.cardNumber}] 本地录入成功！`);
      setIsCreateModalOpen(false);
    }
  };

  // 提交编辑更新并生成版本快照
  const handleSubmitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCard) return;

    const updatePayload = {
      name: formData.name.trim(),
      cardType: formData.cardType,
      attribute: formData.attribute,
      cost: Number(formData.cost) || 0,
      basePP: formData.cardType === CardType.ROLE ? Number(formData.basePP) || 0 : undefined,
      baseDP: formData.cardType === CardType.ROLE ? Number(formData.baseDP) || 0 : undefined,
      signalOrb: formData.signalOrb ? (formData.signalOrb as SignalOrbType) : undefined,
      isInstant: formData.isInstant,
      traits: formData.traits.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      rulesText: formData.rulesText.trim(),
      flavorText: formData.flavorText.trim() || undefined,
      imageUrl: formData.imageUrl.trim() || undefined,
      errataReason: formData.errataReason.trim() || '平衡性调整与效果文勘误',
    };

    try {
      const res = await authFetch(`/api/admin/cards/${encodeURIComponent(selectedCard.cardNumber)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });

      if (res.ok) {
        showNotification('success', `卡牌 [${selectedCard.cardNumber}] 已更新并生成新版本快照！`);
        setIsEditModalOpen(false);
        fetchServerCards();
      } else {
        const err = await res.json();
        showNotification('error', `更新失败: ${err.error}`);
      }
    } catch {
      // 纯前端模拟更新
      setCards((prev) =>
        prev.map((c) =>
          c.cardNumber === selectedCard.cardNumber ? { ...c, ...updatePayload } : c
        )
      );
      showNotification('success', `卡牌 [${selectedCard.cardNumber}] 本地更新完成！`);
      setIsEditModalOpen(false);
    }
  };

  // 查看历史版本快照
  const handleOpenHistory = async (card: CardData) => {
    setSelectedCard(card);
    setIsHistoryModalOpen(true);
    setVersionsLoading(true);

    try {
      const res = await authFetch(`/api/admin/cards/${encodeURIComponent(card.cardNumber)}/versions`);
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setVersionsHistory(json.data);
        }
      }
    } catch {
      // 本地模拟初始版本
      setVersionsHistory([
        {
          id: `v-1-${card.cardNumber}`,
          versionNumber: 1,
          snapshotData: card,
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setVersionsLoading(false);
    }
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
              ? `当前登录指挥官【${user?.nickname}】为普通作战权限，卡牌运维系统仅限总指挥部管理员账号接入。`
              : '卡牌全表运维与勘误版本系统受最高安全协议限制，已禁止未授权直接访问。请先登录管理员账号。'}
          </p>
          <div className="flex flex-col gap-3 font-mono text-xs">
            <Link
              href="/login?redirect=/admin/cards"
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
    <div className="w-full min-h-screen bg-background text-neutral-200 p-4 md:p-8 flex flex-col items-center overflow-x-hidden overflow-y-auto">
      {/* 顶部导航 */}
      <header className="w-full max-w-7xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-terminalBorder/70 pb-6 mb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-neutral-400 mb-1">
            <Link href="/" className="hover:text-terminalCyan transition-colors">
              终端首页
            </Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <Link href="/admin" className="hover:text-terminalCyan transition-colors">
              管理中心
            </Link>
            <ChevronRight className="w-3.5 h-3.5" />
            <span className="text-terminalCyan">卡牌全表运维与版本追踪</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-black tracking-wide text-white flex items-center gap-3">
            <BookOpen className="w-8 h-8 text-terminalCyan" />
            卡牌全表运维与勘误版本库
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-terminalGold/40 bg-terminalGold/10 text-terminalGold text-xs font-mono">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>管理员: {user?.nickname}</span>
          </div>
          <button
            onClick={handleOpenCreate}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-terminalCyan bg-terminalCyan/15 hover:bg-terminalCyan/25 text-xs font-mono font-bold text-terminalCyan transition-all shadow-[0_0_15px_rgba(0,240,255,0.2)]"
          >
            <PlusCircle className="w-4 h-4" />
            新建卡牌入库
          </button>
          <Link
            href="/admin"
            className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-terminalBorder bg-surface hover:border-terminalBorder/90 text-xs font-mono text-neutral-300"
          >
            返回态势大盘
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

      {/* 消息通知浮条 */}
      {notification && (
        <div
          className={`w-full max-w-7xl p-3 mb-4 rounded-xl text-xs font-mono flex items-center gap-2 ${
            notification.type === 'success'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
              : 'bg-erosionRed/20 text-erosionRed border border-erosionRed/40'
          }`}
        >
          {notification.type === 'success' ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* 搜索与过滤控制条 */}
      <div className="w-full max-w-7xl bg-surface/70 border border-terminalBorder rounded-xl p-4 mb-6 backdrop-blur flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between text-xs">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            placeholder="按卡号、名称、效果关键词实时检索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-black/50 border border-terminalBorder rounded-lg text-white font-mono placeholder-neutral-500 focus:outline-none focus:border-terminalCyan"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* 类型筛选 */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-black/60 border border-terminalBorder rounded px-2.5 py-2 text-neutral-300 focus:outline-none focus:border-terminalCyan font-mono"
          >
            <option value="ALL">全部类型 (TYPE)</option>
            <option value={CardType.ROLE}>角色牌</option>
            <option value={CardType.TACTICS}>战术牌</option>
            <option value={CardType.EQUIPMENT}>装备牌</option>
            <option value={CardType.ASSIST}>辅助机牌</option>
          </select>

          {/* 属性筛选 */}
          <select
            value={filterAttr}
            onChange={(e) => setFilterAttr(e.target.value)}
            className="bg-black/60 border border-terminalBorder rounded px-2.5 py-2 text-neutral-300 focus:outline-none focus:border-terminalCyan font-mono"
          >
            <option value="ALL">全部属性 (ATTR)</option>
            <option value={ElementAttribute.PHYSICAL}>物理</option>
            <option value={ElementAttribute.DARK}>暗</option>
            <option value={ElementAttribute.FIRE}>火</option>
            <option value={ElementAttribute.ICE}>冰</option>
            <option value={ElementAttribute.LIGHTNING}>雷</option>
            <option value={ElementAttribute.VOID}>空</option>
            <option value={ElementAttribute.NONE}>无属性</option>
          </select>

          <span className="text-neutral-500 font-mono ml-2">
            检出: <strong className="text-terminalCyan">{filteredCards.length}</strong> / {cards.length}
          </span>
        </div>
      </div>

      {/* 卡牌管理清单表格 */}
      <main className="w-full max-w-7xl rounded-xl border border-terminalBorder bg-surface/80 backdrop-blur overflow-hidden mb-12">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-terminalBorder bg-black/60 text-neutral-400 font-mono text-[11px]">
                <th className="py-3 px-4">卡图</th>
                <th className="py-3 px-3">卡号</th>
                <th className="py-3 px-3">卡牌名称</th>
                <th className="py-3 px-3">类型</th>
                <th className="py-3 px-3">属性</th>
                <th className="py-3 px-2 text-center">费用</th>
                <th className="py-3 px-3 text-right">PP / DP</th>
                <th className="py-3 px-4">词条</th>
                <th className="py-3 px-4">规则效果摘要</th>
                <th className="py-3 px-4 text-center">运维操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-terminalBorder/40">
              {filteredCards.map((card) => (
                <tr key={card.id || card.cardNumber} className="hover:bg-terminalCyan/5 transition-colors">
                  <td className="py-2.5 px-4">
                    <div className="w-10 h-14 rounded overflow-hidden border border-terminalBorder bg-black">
                      <img
                        src={card.imageUrl || `/cards/${card.cardNumber}.png`}
                        alt={card.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  </td>
                  <td className="py-2.5 px-3 font-mono font-bold text-terminalCyan whitespace-nowrap">
                    {card.cardNumber}
                  </td>
                  <td className="py-2.5 px-3 font-bold text-white whitespace-nowrap">
                    <Link href={`/cards/${card.cardNumber}`} target="_blank" className="hover:underline flex items-center gap-1">
                      {card.name}
                    </Link>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-neutral-300 whitespace-nowrap">
                    {formatCardType(card.cardType, card.isInstant)}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    <span className="px-1.5 py-0.5 rounded border border-neutral-700 bg-neutral-900 text-neutral-300 font-mono text-[10px]">
                      {card.attributeName || (card.attribute === ElementAttribute.VOID ? '空' : card.attribute)}
                    </span>
                  </td>
                  <td className="py-2.5 px-2 text-center font-mono font-bold text-terminalCyan">
                    {card.cost}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono whitespace-nowrap">
                    {card.cardType === CardType.ROLE ? (
                      <span>
                        <strong className="text-terminalCyan">{card.basePP ?? 0}</strong>
                        <span className="text-neutral-500 mx-1">/</span>
                        <strong className="text-erosionRed">{card.baseDP ?? 0}</strong>
                      </span>
                    ) : (
                      <span className="text-neutral-600">-</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex flex-wrap gap-1 max-w-[140px]">
                      {card.traits.map((t) => (
                        <span key={t} className="px-1 py-0.2 rounded bg-neutral-900 text-[10px] text-neutral-400">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2.5 px-4 text-neutral-300 max-w-xs truncate text-[11px]" title={card.rulesText}>
                    {card.rulesText}
                  </td>
                  <td className="py-2.5 px-4 text-center whitespace-nowrap">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => handleOpenEdit(card)}
                        className="px-2.5 py-1 rounded border border-terminalBorder bg-surface hover:border-terminalCyan hover:text-terminalCyan transition-colors font-mono flex items-center gap-1 text-[11px]"
                        title="编辑数值与效果勘误"
                      >
                        <Edit className="w-3 h-3" />
                        编辑
                      </button>
                      <button
                        onClick={() => handleOpenHistory(card)}
                        className="px-2.5 py-1 rounded border border-terminalBorder bg-surface hover:border-purple-400 hover:text-purple-300 transition-colors font-mono flex items-center gap-1 text-[11px]"
                        title="查看版本快照"
                      >
                        <History className="w-3 h-3" />
                        版本
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {/* 新建卡牌 Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-surface border border-terminalBorder rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-terminalBorder/60 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-terminalCyan" />
                新建卡牌入库 (New Card Entry)
              </h3>
              <button onClick={() => setIsCreateModalOpen(false)} className="text-neutral-400 hover:text-white">
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="text-neutral-400 font-mono block mb-1">卡牌编号 *</label>
                <input
                  type="text"
                  required
                  value={formData.cardNumber}
                  onChange={(e) => setFormData({ ...formData, cardNumber: e.target.value })}
                  className="w-full px-3 py-2 bg-black/60 border border-terminalBorder rounded text-white font-mono focus:border-terminalCyan"
                />
              </div>

              <div>
                <label className="text-neutral-400 font-mono block mb-1">卡牌名称 *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-black/60 border border-terminalBorder rounded text-white focus:border-terminalCyan"
                />
              </div>

              <div>
                <label className="text-neutral-400 font-mono block mb-1">卡牌类型 *</label>
                <select
                  value={formData.cardType}
                  onChange={(e) => setFormData({ ...formData, cardType: e.target.value as any })}
                  className="w-full px-3 py-2 bg-black/60 border border-terminalBorder rounded text-white font-mono focus:border-terminalCyan"
                >
                  <option value={CardType.ROLE}>角色牌</option>
                  <option value={CardType.TACTICS}>战术牌</option>
                  <option value={CardType.EQUIPMENT}>装备牌</option>
                  <option value={CardType.ASSIST}>辅助机牌</option>
                </select>
              </div>

              <div>
                <label className="text-neutral-400 font-mono block mb-1">元素属性 *</label>
                <select
                  value={formData.attribute}
                  onChange={(e) => setFormData({ ...formData, attribute: e.target.value as any })}
                  className="w-full px-3 py-2 bg-black/60 border border-terminalBorder rounded text-white font-mono focus:border-terminalCyan"
                >
                  <option value={ElementAttribute.PHYSICAL}>物理</option>
                  <option value={ElementAttribute.DARK}>暗</option>
                  <option value={ElementAttribute.FIRE}>火</option>
                  <option value={ElementAttribute.ICE}>冰</option>
                  <option value={ElementAttribute.LIGHTNING}>雷</option>
                  <option value={ElementAttribute.VOID}>空</option>
                  <option value={ElementAttribute.NONE}>无属性</option>
                </select>
              </div>

              <div>
                <label className="text-neutral-400 font-mono block mb-1">出场费用 (COST) *</label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  required
                  value={formData.cost}
                  onChange={(e) => setFormData({ ...formData, cost: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-black/60 border border-terminalBorder rounded text-white font-mono focus:border-terminalCyan"
                />
              </div>

              {formData.cardType === CardType.ROLE && (
                <>
                  <div>
                    <label className="text-neutral-400 font-mono block mb-1">攻击力 (PP)</label>
                    <input
                      type="number"
                      step="500"
                      value={formData.basePP}
                      onChange={(e) => setFormData({ ...formData, basePP: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-black/60 border border-terminalBorder rounded text-white font-mono focus:border-terminalCyan"
                    />
                  </div>

                  <div>
                    <label className="text-neutral-400 font-mono block mb-1">伤害点数 (DP)</label>
                    <input
                      type="number"
                      min="0"
                      max="5"
                      value={formData.baseDP}
                      onChange={(e) => setFormData({ ...formData, baseDP: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-black/60 border border-terminalBorder rounded text-white font-mono focus:border-terminalCyan"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="text-neutral-400 font-mono block mb-1">词条特征 (逗号分隔)</label>
                <input
                  type="text"
                  value={formData.traits}
                  onChange={(e) => setFormData({ ...formData, traits: e.target.value })}
                  placeholder="结构体, 灰鸦小队, 太刀"
                  className="w-full px-3 py-2 bg-black/60 border border-terminalBorder rounded text-white focus:border-terminalCyan"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-neutral-400 font-mono block mb-1">规则效果文本 *</label>
                <textarea
                  rows={3}
                  required
                  value={formData.rulesText}
                  onChange={(e) => setFormData({ ...formData, rulesText: e.target.value })}
                  placeholder="【出】：选择对方战场1张角色造成伤害..."
                  className="w-full px-3 py-2 bg-black/60 border border-terminalBorder rounded text-white focus:border-terminalCyan font-mono"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-neutral-400 font-mono block mb-1">背景风味描述 (Flavor Text)</label>
                <textarea
                  rows={2}
                  value={formData.flavorText}
                  onChange={(e) => setFormData({ ...formData, flavorText: e.target.value })}
                  placeholder="世界观背景故事或台词..."
                  className="w-full px-3 py-2 bg-black/60 border border-terminalBorder rounded text-neutral-300 focus:border-terminalCyan italic"
                />
              </div>

              <div className="sm:col-span-2 flex justify-end gap-3 pt-3 border-t border-terminalBorder/50">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-terminalBorder text-neutral-400 hover:text-white"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg border border-terminalCyan bg-terminalCyan/20 hover:bg-terminalCyan/30 text-terminalCyan font-mono font-bold"
                >
                  确认保存新卡
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 编辑卡牌与版本快照 Modal */}
      {isEditModalOpen && selectedCard && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-surface border border-terminalBorder rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-terminalBorder/60 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Edit className="w-5 h-5 text-terminalCyan" />
                编辑卡牌与版本勘误调整: {selectedCard.cardNumber}
              </h3>
              <button onClick={() => setIsEditModalOpen(false)} className="text-neutral-400 hover:text-white">
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitEdit} className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="text-neutral-400 font-mono block mb-1">卡牌名称</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 bg-black/60 border border-terminalBorder rounded text-white focus:border-terminalCyan"
                />
              </div>

              <div>
                <label className="text-neutral-400 font-mono block mb-1">出场费用 (COST)</label>
                <input
                  type="number"
                  min="0"
                  max="10"
                  required
                  value={formData.cost}
                  onChange={(e) => setFormData({ ...formData, cost: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-black/60 border border-terminalBorder rounded text-white font-mono focus:border-terminalCyan"
                />
              </div>

              {formData.cardType === CardType.ROLE && (
                <>
                  <div>
                    <label className="text-neutral-400 font-mono block mb-1">攻击力 (PP)</label>
                    <input
                      type="number"
                      step="500"
                      value={formData.basePP}
                      onChange={(e) => setFormData({ ...formData, basePP: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-black/60 border border-terminalBorder rounded text-white font-mono focus:border-terminalCyan"
                    />
                  </div>

                  <div>
                    <label className="text-neutral-400 font-mono block mb-1">伤害点数 (DP)</label>
                    <input
                      type="number"
                      min="0"
                      max="5"
                      value={formData.baseDP}
                      onChange={(e) => setFormData({ ...formData, baseDP: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-black/60 border border-terminalBorder rounded text-white font-mono focus:border-terminalCyan"
                    />
                  </div>
                </>
              )}

              <div className="sm:col-span-2">
                <label className="text-neutral-400 font-mono block mb-1">规则效果文本</label>
                <textarea
                  rows={4}
                  required
                  value={formData.rulesText}
                  onChange={(e) => setFormData({ ...formData, rulesText: e.target.value })}
                  className="w-full px-3 py-2 bg-black/60 border border-terminalBorder rounded text-white focus:border-terminalCyan font-mono"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-amber-400 font-mono block mb-1">
                  本次勘误 / 调整原因 (将作为 CardVersion 追溯记录) *
                </label>
                <input
                  type="text"
                  required
                  value={formData.errataReason}
                  onChange={(e) => setFormData({ ...formData, errataReason: e.target.value })}
                  placeholder="如：官方2026年第二赛季环境平衡性调整，PP+500"
                  className="w-full px-3 py-2 bg-black/60 border border-amber-500/40 rounded text-amber-200 focus:border-amber-400 font-mono"
                />
              </div>

              <div className="sm:col-span-2 flex justify-end gap-3 pt-3 border-t border-terminalBorder/50">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-terminalBorder text-neutral-400 hover:text-white"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-lg border border-terminalCyan bg-terminalCyan/20 hover:bg-terminalCyan/30 text-terminalCyan font-mono font-bold flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  保存并生成新版本快照
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 版本历史快照 Modal */}
      {isHistoryModalOpen && selectedCard && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-surface border border-terminalBorder rounded-2xl p-6 shadow-2xl max-h-[85vh] overflow-y-auto flex flex-col gap-4">
            <div className="flex justify-between items-center border-b border-terminalBorder/60 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <History className="w-5 h-5 text-purple-400" />
                卡牌版本快照履历: {selectedCard.cardNumber} ({selectedCard.name})
              </h3>
              <button onClick={() => setIsHistoryModalOpen(false)} className="text-neutral-400 hover:text-white">
                ✕
              </button>
            </div>

            {versionsLoading ? (
              <div className="py-8 text-center text-xs font-mono text-neutral-400">
                正在检索空中花园版本快照链...
              </div>
            ) : versionsHistory.length === 0 ? (
              <div className="py-8 text-center text-xs text-neutral-500">
                暂无历史版本快照记录（当前为初始版本）
              </div>
            ) : (
              <div className="space-y-4">
                {versionsHistory.map((ver) => (
                  <div
                    key={ver.id || ver.versionNumber}
                    className="p-4 rounded-xl border border-terminalBorder/70 bg-black/40 flex flex-col gap-2 text-xs"
                  >
                    <div className="flex justify-between items-center font-mono">
                      <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30">
                        Version {ver.versionNumber}
                      </span>
                      <span className="text-[11px] text-neutral-500">
                        {new Date(ver.createdAt).toLocaleString()}
                      </span>
                    </div>

                    {ver.snapshotData?.errataReason && (
                      <div className="text-amber-300 font-mono text-[11px]">
                        调整理由: {ver.snapshotData.errataReason}
                      </div>
                    )}

                    <div className="text-neutral-300 font-mono text-[11px] bg-neutral-900/60 p-2 rounded border border-neutral-800">
                      费用: {ver.snapshotData?.cost ?? selectedCard.cost} | PP:{' '}
                      {ver.snapshotData?.basePP ?? '-'} | DP:{' '}
                      {ver.snapshotData?.baseDP ?? '-'}
                    </div>

                    <div className="text-neutral-400 text-[11px] italic">
                      效果: {ver.snapshotData?.rulesText || selectedCard.rulesText}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-terminalBorder/50">
              <button
                onClick={() => setIsHistoryModalOpen(false)}
                className="px-4 py-1.5 rounded-lg border border-terminalBorder text-xs text-neutral-300 hover:text-white"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
