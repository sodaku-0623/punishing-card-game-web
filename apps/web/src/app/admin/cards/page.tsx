'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  ALL_OFFICIAL_CARDS,
  CardData,
  formatCardType,
  getAttributeDisplay,
} from '@/lib/cards-data';
import { CardType, ElementAttribute, SignalOrbType } from '@zhanshuang/shared';
import {
  Search,
  PlusCircle,
  Edit,
  History,
  Check,
  AlertTriangle,
  Save,
  ShieldAlert,
  Cpu,
  ArrowLeft,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { getCardThumbnailUrl, handleThumbnailError } from '@/lib/card-image';
import {
  AppShell,
  Button,
  Badge,
  Input,
  SectionHeader,
  Dialog,
  HudBrackets,
} from '@/components/ui';

interface CardVersionItem {
  id: string;
  versionNumber: number;
  snapshotData: any;
  createdAt: string;
}

export default function AdminCardsPage() {
  const { user, isAdmin, isLoggedIn, isLoading: authLoading, authFetch } = useAuth();

  const [cards, setCards] = useState<CardData[]>(ALL_OFFICIAL_CARDS);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterAttr, setFilterAttr] = useState<string>('ALL');

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

  const [selectedCard, setSelectedCard] = useState<CardData | null>(null);
  const [versionsHistory, setVersionsHistory] = useState<CardVersionItem[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

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

  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 3000);
  };

  const fetchServerCards = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await authFetch('/api/admin/cards?take=500');
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setCards(json.data);
        }
      }
    } catch {
      // 离线保留本地数据
    }
  }, [isAdmin, authFetch]);

  useEffect(() => {
    if (isAdmin) {
      fetchServerCards();
    }
  }, [isAdmin, fetchServerCards]);

  const filteredCards = useMemo(() => {
    return cards.filter((card) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const match =
          card.name.toLowerCase().includes(q) ||
          card.cardNumber.toLowerCase().includes(q) ||
          card.rulesText.toLowerCase().includes(q);
        if (!match) return false;
      }
      if (filterType !== 'ALL' && card.cardType !== filterType) return false;
      if (filterAttr !== 'ALL' && card.attribute !== filterAttr) return false;
      return true;
    });
  }, [cards, searchQuery, filterType, filterAttr]);

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
      traits: formData.traits
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean),
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
        showNotification('success', `卡牌 [${newCardPayload.cardNumber}] 成功创建入库。`);
        setIsCreateModalOpen(false);
        fetchServerCards();
      } else {
        const err = await res.json();
        showNotification('error', `创建失败: ${err.error || '未知错误'}`);
      }
    } catch {
      setCards((prev) => [{ id: `card-${Date.now()}`, ...newCardPayload }, ...prev]);
      showNotification('success', `卡牌 [${newCardPayload.cardNumber}] 本地录入成功。`);
      setIsCreateModalOpen(false);
    }
  };

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
      traits: formData.traits
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean),
      rulesText: formData.rulesText.trim(),
      flavorText: formData.flavorText.trim() || undefined,
      imageUrl: formData.imageUrl.trim() || undefined,
      errataReason: formData.errataReason.trim() || '平衡性调整与效果文勘误',
    };

    try {
      const res = await authFetch(
        `/api/admin/cards/${encodeURIComponent(selectedCard.cardNumber)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload),
        },
      );

      if (res.ok) {
        showNotification('success', `卡牌 [${selectedCard.cardNumber}] 已更新并生成新版本快照。`);
        setIsEditModalOpen(false);
        fetchServerCards();
      } else {
        const err = await res.json();
        showNotification('error', `更新失败: ${err.error}`);
      }
    } catch {
      setCards((prev) =>
        prev.map((c) =>
          c.cardNumber === selectedCard.cardNumber ? { ...c, ...updatePayload } : c,
        ),
      );
      showNotification('success', `卡牌 [${selectedCard.cardNumber}] 本地更新完成。`);
      setIsEditModalOpen(false);
    }
  };

  const handleOpenHistory = async (card: CardData) => {
    setSelectedCard(card);
    setIsHistoryModalOpen(true);
    setVersionsLoading(true);

    try {
      const res = await authFetch(
        `/api/admin/cards/${encodeURIComponent(card.cardNumber)}/versions`,
      );
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) {
          setVersionsHistory(json.data);
        }
      }
    } catch {
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
          <p className="text-body-sm text-fg-secondary mb-6">
            {isLoggedIn
              ? `当前登录指挥官【${user?.nickname}】为普通作战权限，卡牌运维系统仅限管理员接入。`
              : '卡牌全表运维与勘误系统受安全协议保护，请先使用管理员账号登录。'}
          </p>
          <div className="flex flex-col gap-2.5">
            <Link href="/login?redirect=/admin/cards">
              <Button variant="primary" size="lg" className="w-full">
                使用管理员账号登录
              </Button>
            </Link>
            <Link href="/">
              <Button variant="secondary" size="md" className="w-full">
                返回首页
              </Button>
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell wide className="space-y-6">
      <SectionHeader
        code="ADMIN // CARD OPS"
        pageLabel={`${filteredCards.length} / ${cards.length}`}
        title="卡牌全表运维与勘误版本库"
        subtitle="CARD DATABASE ADMINISTRATION & ERRATA"
        action={
          <>
            <Link href="/admin">
              <Button variant="secondary" size="md">
                <ArrowLeft className="w-4 h-4" />
                <span>返回总控</span>
              </Button>
            </Link>
            <Button variant="primary" size="md" onClick={handleOpenCreate}>
              <PlusCircle className="w-4 h-4" />
              <span>新建卡牌入库</span>
            </Button>
          </>
        }
      />

      {notification && (
        <div
          role="status"
          className={`px-4 py-3 border text-body-sm flex items-center gap-2 animate-in fade-in duration-fast ${
            notification.type === 'success'
              ? 'border-success/50 bg-success/10 text-success'
              : 'border-crimson-500/60 bg-crimson-700/20 text-crimson-400'
          }`}
        >
          {notification.type === 'success' ? (
            <Check className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span>{notification.message}</span>
        </div>
      )}

      {/* 搜索与过滤控制条 */}
      <div className="border border-line bg-ink-850 p-4 flex flex-col md:flex-row gap-3 md:items-center justify-between">
        <Input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="按卡号、名称、效果关键词实时检索..."
          aria-label="检索卡牌"
          leftSlot={<Search className="w-4 h-4" />}
          containerClassName="flex-1"
        />

        <div className="flex flex-wrap items-center gap-2 text-caption">
          <select
            value={filterType}
            aria-label="筛选卡牌类型"
            onChange={(e) => setFilterType(e.target.value)}
            className="h-9 px-3 bg-ink-800 border border-line text-body-sm text-fg focus:outline-none focus:border-teal-400"
          >
            <option value="ALL">全部类型</option>
            <option value={CardType.ROLE}>角色牌</option>
            <option value={CardType.TACTICS}>战术牌</option>
            <option value={CardType.EQUIPMENT}>装备牌</option>
            <option value={CardType.ASSIST}>辅助机牌</option>
          </select>

          <select
            value={filterAttr}
            aria-label="筛选卡牌属性"
            onChange={(e) => setFilterAttr(e.target.value)}
            className="h-9 px-3 bg-ink-800 border border-line text-body-sm text-fg focus:outline-none focus:border-teal-400"
          >
            <option value="ALL">全部属性</option>
            <option value={ElementAttribute.PHYSICAL}>物理</option>
            <option value={ElementAttribute.DARK}>暗</option>
            <option value={ElementAttribute.FIRE}>火</option>
            <option value={ElementAttribute.ICE}>冰</option>
            <option value={ElementAttribute.LIGHTNING}>雷</option>
            <option value={ElementAttribute.VOID}>空</option>
            <option value={ElementAttribute.NONE}>无属性</option>
          </select>
        </div>
      </div>

      {/* 卡牌管理表格 */}
      <div className="border border-line bg-ink-850 overflow-x-auto">
        <table className="w-full text-left text-body-sm border-collapse">
          <thead>
            <tr className="border-b border-line bg-ink-900 text-caption text-fg-muted">
              <th className="py-3 px-3">卡图</th>
              <th className="py-3 px-3">卡号</th>
              <th className="py-3 px-3">名称</th>
              <th className="py-3 px-3">类型</th>
              <th className="py-3 px-3">属性</th>
              <th className="py-3 px-2 text-center">费用</th>
              <th className="py-3 px-3 text-right">PP / DP</th>
              <th className="py-3 px-3">规则效果摘要</th>
              <th className="py-3 px-3 text-center">运维操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filteredCards.map((card, idx) => {
              const attrInfo = getAttributeDisplay(card.attribute, card.attributeName);
              return (
                <tr
                  key={card.id || card.cardNumber}
                  className={`transition-colors duration-fast hover:bg-ink-700 ${
                    idx % 2 === 1 ? 'bg-ink-800/60' : 'bg-ink-850'
                  }`}
                >
                  <td className="py-2 px-3">
                    <div className="w-9 h-12 rounded-card overflow-hidden border border-line bg-ink-950">
                      <img
                        src={getCardThumbnailUrl(card.imageUrl, card.cardNumber)}
                        onError={(e) =>
                          handleThumbnailError(
                            e,
                            card.imageUrl || `/cards/${card.cardNumber}.png`,
                          )
                        }
                        alt={card.name}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  </td>
                  <td className="py-2 px-3 font-num text-caption text-crimson-400 font-semibold whitespace-nowrap">
                    {card.cardNumber}
                  </td>
                  <td className="py-2 px-3 font-medium text-fg whitespace-nowrap">
                    <Link
                      href={`/cards/${card.cardNumber}`}
                      target="_blank"
                      className="hover:text-teal-400 transition-colors"
                    >
                      {card.name}
                    </Link>
                  </td>
                  <td className="py-2 px-3 text-caption text-fg-secondary whitespace-nowrap">
                    {formatCardType(card.cardType, card.isInstant)}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className={`px-1.5 py-0.5 border text-caption ${attrInfo.tagColor}`}>
                      {card.attributeName || (card.attribute === ElementAttribute.VOID ? '空' : card.attribute)}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-center font-num tabular-nums text-gold-300 font-semibold">
                    {card.cost}
                  </td>
                  <td className="py-2 px-3 text-right font-num tabular-nums whitespace-nowrap text-caption">
                    {card.cardType === CardType.ROLE ? (
                      <span>
                        <strong className="text-fg">{card.basePP ?? 0}</strong>
                        <span className="text-fg-disabled mx-1">/</span>
                        <strong className="text-crimson-400">{card.baseDP ?? 0}</strong>
                      </span>
                    ) : (
                      <span className="text-fg-disabled">—</span>
                    )}
                  </td>
                  <td
                    className="py-2 px-3 text-caption text-fg-secondary max-w-xs truncate"
                    title={card.rulesText}
                  >
                    {card.rulesText}
                  </td>
                  <td className="py-2 px-3 text-center whitespace-nowrap">
                    <div className="inline-flex items-center gap-1.5">
                      <Button variant="secondary" size="sm" onClick={() => handleOpenEdit(card)}>
                        <Edit className="w-3 h-3" />
                        <span>编辑</span>
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleOpenHistory(card)}>
                        <History className="w-3 h-3" />
                        <span>版本</span>
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 新建卡牌 Dialog */}
      <Dialog
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="新建卡牌入库"
        subtitle="NEW CARD ENTRY"
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setIsCreateModalOpen(false)}>
              取消
            </Button>
            <Button variant="primary" size="sm" type="submit" form="admin-create-card-form">
              确认保存新卡
            </Button>
          </>
        }
      >
        <form
          id="admin-create-card-form"
          onSubmit={handleSubmitCreate}
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          <Input
            label="卡牌编号 *"
            required
            value={formData.cardNumber}
            onChange={(e) => setFormData({ ...formData, cardNumber: e.target.value })}
            className="font-num"
          />
          <Input
            label="卡牌名称 *"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          <div>
            <label className="block text-caption text-fg-muted mb-1.5">卡牌类型 *</label>
            <select
              value={formData.cardType}
              onChange={(e) => setFormData({ ...formData, cardType: e.target.value as CardType })}
              className="w-full h-9 px-3 bg-ink-800 border border-line text-body text-fg focus:border-teal-400 focus:outline-none"
            >
              <option value={CardType.ROLE}>角色牌</option>
              <option value={CardType.TACTICS}>战术牌</option>
              <option value={CardType.EQUIPMENT}>装备牌</option>
              <option value={CardType.ASSIST}>辅助机牌</option>
            </select>
          </div>
          <div>
            <label className="block text-caption text-fg-muted mb-1.5">元素属性 *</label>
            <select
              value={formData.attribute}
              onChange={(e) =>
                setFormData({ ...formData, attribute: e.target.value as ElementAttribute })
              }
              className="w-full h-9 px-3 bg-ink-800 border border-line text-body text-fg focus:border-teal-400 focus:outline-none"
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
          <Input
            label="出场费用 *"
            type="number"
            min="0"
            max="10"
            required
            value={formData.cost}
            onChange={(e) => setFormData({ ...formData, cost: Number(e.target.value) })}
            className="font-num"
          />
          {formData.cardType === CardType.ROLE && (
            <>
              <Input
                label="攻击力 (PP)"
                type="number"
                step="500"
                value={formData.basePP}
                onChange={(e) => setFormData({ ...formData, basePP: Number(e.target.value) })}
                className="font-num"
              />
              <Input
                label="伤害点数 (DP)"
                type="number"
                min="0"
                max="5"
                value={formData.baseDP}
                onChange={(e) => setFormData({ ...formData, baseDP: Number(e.target.value) })}
                className="font-num"
              />
            </>
          )}
          <Input
            label="词条特征（逗号分隔）"
            value={formData.traits}
            onChange={(e) => setFormData({ ...formData, traits: e.target.value })}
            placeholder="结构体, 灰鸦小队, 太刀"
          />
          <div className="sm:col-span-2">
            <label className="block text-caption text-fg-muted mb-1.5">规则效果文本 *</label>
            <textarea
              rows={3}
              required
              value={formData.rulesText}
              onChange={(e) => setFormData({ ...formData, rulesText: e.target.value })}
              className="w-full p-3 bg-ink-800 border border-line text-body-sm text-fg focus:border-teal-400 focus:outline-none rounded-none"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-caption text-fg-muted mb-1.5">背景风味描述</label>
            <textarea
              rows={2}
              value={formData.flavorText}
              onChange={(e) => setFormData({ ...formData, flavorText: e.target.value })}
              className="w-full p-3 bg-ink-800 border border-line text-body-sm text-fg-secondary focus:border-teal-400 focus:outline-none rounded-none italic"
            />
          </div>
        </form>
      </Dialog>

      {/* 编辑卡牌 Dialog */}
      <Dialog
        open={isEditModalOpen && Boolean(selectedCard)}
        onClose={() => setIsEditModalOpen(false)}
        title={selectedCard ? `编辑卡牌与勘误：${selectedCard.cardNumber}` : '编辑卡牌'}
        subtitle="CARD ERRATA & VERSIONING"
        size="lg"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setIsEditModalOpen(false)}>
              取消
            </Button>
            <Button variant="primary" size="sm" type="submit" form="admin-edit-card-form">
              <Save className="w-3.5 h-3.5" />
              <span>保存并生成版本快照</span>
            </Button>
          </>
        }
      >
        <form
          id="admin-edit-card-form"
          onSubmit={handleSubmitEdit}
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          <Input
            label="卡牌名称"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
          <Input
            label="出场费用"
            type="number"
            min="0"
            max="10"
            required
            value={formData.cost}
            onChange={(e) => setFormData({ ...formData, cost: Number(e.target.value) })}
            className="font-num"
          />
          {formData.cardType === CardType.ROLE && (
            <>
              <Input
                label="攻击力 (PP)"
                type="number"
                step="500"
                value={formData.basePP}
                onChange={(e) => setFormData({ ...formData, basePP: Number(e.target.value) })}
                className="font-num"
              />
              <Input
                label="伤害点数 (DP)"
                type="number"
                min="0"
                max="5"
                value={formData.baseDP}
                onChange={(e) => setFormData({ ...formData, baseDP: Number(e.target.value) })}
                className="font-num"
              />
            </>
          )}
          <div className="sm:col-span-2">
            <label className="block text-caption text-fg-muted mb-1.5">规则效果文本</label>
            <textarea
              rows={4}
              required
              value={formData.rulesText}
              onChange={(e) => setFormData({ ...formData, rulesText: e.target.value })}
              className="w-full p-3 bg-ink-800 border border-line text-body-sm text-fg focus:border-teal-400 focus:outline-none rounded-none"
            />
          </div>
          <div className="sm:col-span-2">
            <Input
              label="本次勘误 / 调整原因（将记录到版本快照） *"
              required
              value={formData.errataReason}
              onChange={(e) => setFormData({ ...formData, errataReason: e.target.value })}
            />
          </div>
        </form>
      </Dialog>

      {/* 版本快照历史 Dialog */}
      <Dialog
        open={isHistoryModalOpen && Boolean(selectedCard)}
        onClose={() => setIsHistoryModalOpen(false)}
        title={
          selectedCard
            ? `版本快照履历：${selectedCard.cardNumber} (${selectedCard.name})`
            : '版本快照履历'
        }
        subtitle="CARD VERSION HISTORY"
        size="lg"
        footer={
          <Button variant="secondary" size="sm" onClick={() => setIsHistoryModalOpen(false)}>
            关闭
          </Button>
        }
      >
        {versionsLoading ? (
          <div className="py-10 text-center text-body-sm text-fg-muted">
            正在检索版本快照链...
          </div>
        ) : versionsHistory.length === 0 ? (
          <div className="py-10 text-center text-body-sm text-fg-muted">
            暂无历史版本快照记录（当前为初始版本）
          </div>
        ) : (
          <div className="space-y-3">
            {versionsHistory.map((ver) => (
              <div
                key={ver.id || ver.versionNumber}
                className="p-4 border border-line bg-ink-950 space-y-2 text-caption"
              >
                <div className="flex justify-between items-center">
                  <Badge variant="gold" className="font-num">
                    VERSION {ver.versionNumber}
                  </Badge>
                  <span className="font-num text-fg-muted">
                    {new Date(ver.createdAt).toLocaleString()}
                  </span>
                </div>
                {ver.snapshotData?.errataReason && (
                  <div className="text-gold-300">
                    调整理由：{ver.snapshotData.errataReason}
                  </div>
                )}
                <div className="font-num text-fg-secondary bg-ink-900 p-2 border border-line">
                  费用 {ver.snapshotData?.cost ?? selectedCard?.cost} · PP{' '}
                  {ver.snapshotData?.basePP ?? '—'} · DP {ver.snapshotData?.baseDP ?? '—'}
                </div>
                <div className="text-fg-muted">
                  效果：{ver.snapshotData?.rulesText || selectedCard?.rulesText}
                </div>
              </div>
            ))}
          </div>
        )}
      </Dialog>
    </AppShell>
  );
}
