'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, AlertTriangle, CheckCircle2, Layers, Sparkles, Zap } from 'lucide-react';
import { Button, Dialog } from '@/components/ui';
import type { PublicGameState } from '@zhanshuang/shared';
import { findCardByNumberOrId } from '@/lib/cards-data';
import { getCardThumbnailUrl, handleThumbnailError } from '@/lib/card-image';
import {
  getCardEffectiveCostInfo,
  type AscensionPlan,
  type AscensionTargetCandidate,
  type AscensionTargetZone,
} from '@/lib/battle-actions';

export interface AscensionConfirmPayload {
  targetAscensionCardId?: string;
  targetAscensionCardIds?: string[];
  extraAscensionCostCardId?: string;
  targetSlotIndex?: number;
}

interface AscensionModalProps {
  isOpen: boolean;
  plan: AscensionPlan | null;
  gameState?: PublicGameState | null;
  myUserId?: string;
  myAvailableCost?: number;
  initialTargetCardId?: string | null;
  initialSlotIndex?: number | null;
  onConfirm: (payload: AscensionConfirmPayload) => void;
  onClose: () => void;
}

const ZONE_SECTION_META: Record<AscensionTargetZone, { title: string; badge: string }> = {
  BATTLEFIELD: { title: '我方战场角色', badge: '战场' },
  SIGNAL_ORB: { title: '信号球区正面卡牌', badge: '信号球区正面' },
  AIRBORNE: { title: '处理区浮空模式角色', badge: '浮空模式' },
};

const ZONE_ORDER: AscensionTargetZone[] = ['BATTLEFIELD', 'SIGNAL_ORB', 'AIRBORNE'];

function computeInitialTargetIds(
  isOpen: boolean,
  plan: AscensionPlan | null,
  initialTargetCardId?: string | null
): string[] {
  if (!isOpen || !plan) return [];
  if (
    initialTargetCardId &&
    plan.targets.some((t) => t.card.instanceId === initialTargetCardId)
  ) {
    return [initialTargetCardId];
  }
  if (plan.targets.length === 1 && !plan.allowMultiple) {
    return [plan.targets[0]!.card.instanceId];
  }
  return [];
}

function computeInitialExtraCostId(
  isOpen: boolean,
  plan: AscensionPlan | null,
  initialTargets: string[]
): string | null {
  if (!isOpen || !plan) return null;
  const validExtras = plan.extraCostCandidates.filter(
    (c) => !initialTargets.includes(c.card.instanceId)
  );
  return validExtras.length === 1 ? validExtras[0]!.card.instanceId : null;
}

function computeInitialSlotIndex(
  isOpen: boolean,
  plan: AscensionPlan | null,
  initialSlotIndex?: number | null
): number | null {
  if (!isOpen || !plan) return null;
  if (
    initialSlotIndex !== null &&
    initialSlotIndex !== undefined &&
    plan.emptySlotIndices.includes(initialSlotIndex)
  ) {
    return initialSlotIndex;
  }
  return plan.emptySlotIndices.length > 0 ? plan.emptySlotIndices[0]! : null;
}

export const AscensionModal: React.FC<AscensionModalProps> = ({
  isOpen,
  plan,
  gameState,
  myUserId,
  myAvailableCost,
  initialTargetCardId,
  initialSlotIndex,
  onConfirm,
  onClose,
}) => {
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>(() =>
    computeInitialTargetIds(isOpen, plan, initialTargetCardId)
  );
  const [selectedExtraCostId, setSelectedExtraCostId] = useState<string | null>(() =>
    computeInitialExtraCostId(
      isOpen,
      plan,
      computeInitialTargetIds(isOpen, plan, initialTargetCardId)
    )
  );
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(() =>
    computeInitialSlotIndex(isOpen, plan, initialSlotIndex)
  );

  useEffect(() => {
    const initTargets = computeInitialTargetIds(isOpen, plan, initialTargetCardId);
    setSelectedTargetIds(initTargets);
    setSelectedExtraCostId(computeInitialExtraCostId(isOpen, plan, initTargets));
    setSelectedSlotIndex(computeInitialSlotIndex(isOpen, plan, initialSlotIndex));
  }, [isOpen, plan, initialTargetCardId, initialSlotIndex]);

  const targetById = useMemo(() => {
    const map = new Map<string, AscensionTargetCandidate>();
    for (const t of plan?.targets ?? []) {
      map.set(t.card.instanceId, t);
    }
    return map;
  }, [plan]);

  const selectedTargets = useMemo(
    () =>
      selectedTargetIds
        .map((id) => targetById.get(id))
        .filter((t): t is AscensionTargetCandidate => Boolean(t)),
    [selectedTargetIds, targetById]
  );

  // 额外代价候选（自动排除当前选中的升变主对象，避免同一张《帕瓦》同时充当主对象与底牌）
  const availableExtraCandidates = useMemo(
    () =>
      (plan?.extraCostCandidates ?? []).filter(
        (c) => !selectedTargetIds.includes(c.card.instanceId)
      ),
    [plan, selectedTargetIds]
  );

  // 若先前选择的额外代价被纳入升变主对象，及时清空或切换
  const effectiveExtraCostId = useMemo(() => {
    if (selectedExtraCostId && availableExtraCandidates.some((c) => c.card.instanceId === selectedExtraCostId)) {
      return selectedExtraCostId;
    }
    return availableExtraCandidates.length === 1 ? availableExtraCandidates[0]!.card.instanceId : null;
  }, [selectedExtraCostId, availableExtraCandidates]);

  const targetsByZone = useMemo(() => {
    const groups: Record<AscensionTargetZone, AscensionTargetCandidate[]> = {
      BATTLEFIELD: [],
      SIGNAL_ORB: [],
      AIRBORNE: [],
    };
    for (const t of plan?.targets ?? []) {
      groups[t.zone].push(t);
    }
    return groups;
  }, [plan]);

  const ascDef = plan ? findCardByNumberOrId(plan.card.cardNumber || plan.card.cardId) : null;
  const hasTappedSelected = selectedTargets.some((t) => !t.card.isReady);
  const appliedTax =
    hasTappedSelected && (plan?.tappedOpponentTaxCount ?? 0) > 0
      ? plan!.tappedOpponentTaxCount
      : 0;

  const ascCostInfo = useMemo(() => {
    if (!plan) return null;
    if (gameState && myUserId) {
      return getCardEffectiveCostInfo(gameState, myUserId, plan.card, {
        isAscension: true,
        targetAscensionCards: selectedTargets.map((t) => t.card),
      });
    }
    const base = plan.config.ascensionCost + appliedTax;
    const discountFromPlan = Math.max(0, (plan.config.ascensionCost + (plan.tappedOpponentTaxCount || 0)) - plan.ascensionCost);
    const effective = Math.max(0, base - (plan.ascensionCost < plan.config.ascensionCost ? plan.config.ascensionCost - plan.ascensionCost : discountFromPlan));
    return {
      baseCost: base,
      effectiveCost: selectedTargets.length > 0 ? effective : plan.ascensionCost,
      minPayableCost: selectedTargets.length > 0 ? Math.min(effective, plan.minPayableCost) : plan.minPayableCost,
      hasOptionalDiscount: false,
    };
  }, [plan, gameState, myUserId, selectedTargets, appliedTax]);

  const baseAscCost = plan?.config.ascensionCost ?? 0;
  const totalDisplayCost = ascCostInfo?.effectiveCost ?? baseAscCost;
  const costDelta = totalDisplayCost - (baseAscCost + appliedTax);

  const needsExtraCost = Boolean(
    plan && (plan.extraCostCandidates.length > 0 || plan.config.extraCost)
  );
  const firstSelectedTarget = selectedTargets[0];
  const requiresEmptySlot = Boolean(firstSelectedTarget?.requiresEmptySlot);
  const hasEmptySlotForSelection =
    !requiresEmptySlot ||
    ((plan?.emptySlotIndices.length ?? 0) > 0 && selectedSlotIndex !== null);

  const canSubmit = Boolean(
    plan &&
      plan.sourceZoneValid &&
      !plan.config.unsupportedReason &&
      !plan.restrictionError &&
      selectedTargets.length >= plan.minCount &&
      (!needsExtraCost || Boolean(effectiveExtraCostId)) &&
      hasEmptySlotForSelection &&
      (myAvailableCost === undefined || (ascCostInfo?.minPayableCost ?? totalDisplayCost) <= myAvailableCost)
  );

  const handleToggleTarget = (candidate: AscensionTargetCandidate) => {
    if (!plan) return;
    const id = candidate.card.instanceId;
    if (plan.allowMultiple) {
      setSelectedTargetIds((prev) =>
        prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
      );
    } else {
      setSelectedTargetIds([id]);
    }
  };

  const handleConfirm = () => {
    if (!plan || !canSubmit) return;
    const payload: AscensionConfirmPayload = {};
    if (plan.allowMultiple) {
      payload.targetAscensionCardIds = selectedTargetIds;
      payload.targetAscensionCardId = selectedTargetIds[0];
    } else {
      payload.targetAscensionCardId = selectedTargetIds[0];
    }
    if (needsExtraCost && effectiveExtraCostId) {
      payload.extraAscensionCostCardId = effectiveExtraCostId;
    }
    if (requiresEmptySlot && selectedSlotIndex !== null) {
      payload.targetSlotIndex = selectedSlotIndex;
    }
    onConfirm(payload);
  };

  const sourceLabel = plan?.card.zone === 'GRAVEYARD' ? '墓地' : '手牌';

  return (
    <Dialog
      open={isOpen && Boolean(plan)}
      onClose={onClose}
      title={ascDef ? `升变登场 · ${ascDef.name}` : '升变登场'}
      subtitle="8.11 ASCENSION DEPLOYMENT"
      size="lg"
      blurBackdrop
      footer={
        <div className="w-full flex items-center justify-between gap-3 flex-wrap">
          <div className="text-hud text-fg-muted flex items-center gap-2">
            <span>
              已选对象 {selectedTargets.length}
              {plan && plan.minCount > 1 ? ` / 至少 ${plan.minCount}` : ''} 张
            </span>
            {myAvailableCost !== undefined && (
              <span className="font-num tabular-nums text-fg-secondary">
                · 可用费用 {myAvailableCost}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="secondary" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button variant="primary" size="sm" disabled={!canSubmit} onClick={handleConfirm}>
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>确认升变 ({totalDisplayCost}费)</span>
            </Button>
          </div>
        </div>
      }
    >
      {plan && (
        <div className="flex flex-col gap-3 select-none">
          {/* 顶部待升变卡摘要与费用 */}
          <div className="flex items-start gap-3 p-3 border border-line bg-ink-950">
            <div className="relative w-14 aspect-[63/88] rounded-card overflow-hidden border border-teal-400/60 bg-ink-900 shrink-0">
              {ascDef?.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={getCardThumbnailUrl(ascDef.imageUrl, ascDef.cardNumber)}
                  onError={(e) => handleThumbnailError(e, ascDef.imageUrl)}
                  alt={ascDef.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-hud font-num text-fg-muted">
                  {plan.card.cardNumber}
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-body-sm font-semibold text-fg">
                  {ascDef?.name || plan.card.cardNumber}
                </span>
                <span className="px-1.5 py-0.5 text-hud font-num bg-ink-850 border border-line text-fg-secondary">
                  {plan.card.cardNumber}
                </span>
                <span className="px-1.5 py-0.5 text-hud bg-teal-400/15 border border-teal-400/40 text-teal-400">
                  来源：{sourceLabel}
                </span>
              </div>

              <div className="flex items-center gap-2 flex-wrap text-caption">
                <span className="px-2 py-0.5 bg-ink-850 border border-gold-300/50 text-gold-300 font-num tabular-nums font-semibold">
                  基础升变费用：{baseAscCost} 费
                </span>
                {appliedTax > 0 && (
                  <span className="px-2 py-0.5 bg-crimson-500/15 border border-crimson-500/60 text-crimson-400 font-medium">
                    对手横置《万事·明晰梦》增费 +{appliedTax}
                  </span>
                )}
                {costDelta < 0 && (
                  <span className="px-2 py-0.5 bg-teal-400/15 border border-teal-400/60 text-teal-400 font-num font-semibold">
                    效果减费 {costDelta} (实付 {totalDisplayCost} 费)
                  </span>
                )}
                {costDelta > 0 && (
                  <span className="px-2 py-0.5 bg-crimson-500/15 border border-crimson-500/60 text-crimson-400 font-num font-semibold">
                    费用修正 +{costDelta} (实付 {totalDisplayCost} 费)
                  </span>
                )}
                {plan.config.grantKeywords.map((kw) => (
                  <span
                    key={kw}
                    className="px-1.5 py-0.5 bg-teal-400/10 border border-teal-400/40 text-teal-400 text-hud"
                  >
                    获得【{kw}】
                  </span>
                ))}
              </div>

              {plan.allowMultiple && (
                <div className="text-hud text-teal-400 flex items-center gap-1">
                  <Layers className="w-3 h-3 shrink-0" />
                  <span>
                    可选择多个升变对象（至少 {plan.minCount} 张）：第 1 张决定落位与继承装备
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 限制条件与规则阻断提示 */}
          {(plan.restrictionError || plan.config.unsupportedReason || !plan.sourceZoneValid) && (
            <div className="px-3 py-2 border border-crimson-500/70 bg-crimson-500/10 text-crimson-400 text-caption flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>
                {plan.config.unsupportedReason ||
                  plan.restrictionError ||
                  '当前区域不能发动该牌的升变'}
              </span>
            </div>
          )}

          {/* 分区可选升变对象 */}
          {plan.targets.length === 0 ? (
            <div className="py-8 text-center text-caption text-fg-muted border border-line bg-ink-950/60">
              当前没有满足升变条件的候选对象
            </div>
          ) : (
            <div className="flex flex-col gap-3 max-h-[42vh] overflow-y-auto pr-1">
              {ZONE_ORDER.map((zoneKey) => {
                const list = targetsByZone[zoneKey];
                if (list.length === 0) return null;
                const meta = ZONE_SECTION_META[zoneKey];

                return (
                  <div key={zoneKey} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-hud text-fg-muted px-0.5">
                      <span className="font-semibold text-fg-secondary flex items-center gap-1">
                        <ArrowUpRight className="w-3 h-3 text-teal-400" />
                        <span>{meta.title}</span>
                      </span>
                      <span className="font-num tabular-nums">{list.length} 个候选</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {list.map((candidate) => {
                        const cDef = findCardByNumberOrId(
                          candidate.card.cardNumber || candidate.card.cardId
                        );
                        const orderIdx = selectedTargetIds.indexOf(candidate.card.instanceId);
                        const isSelected = orderIdx !== -1;

                        return (
                          <button
                            key={candidate.card.instanceId}
                            type="button"
                            onClick={() => handleToggleTarget(candidate)}
                            className={`flex items-center gap-2.5 p-2 border text-left transition-colors cursor-pointer ${
                              isSelected
                                ? 'border-teal-400 bg-teal-400/15 text-fg'
                                : 'border-line bg-ink-950 text-fg-secondary hover:border-teal-400/60 hover:bg-ink-850'
                            }`}
                          >
                            <div className="relative w-10 aspect-[63/88] rounded-card overflow-hidden border border-line bg-ink-900 shrink-0">
                              {cDef?.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={getCardThumbnailUrl(cDef.imageUrl, cDef.cardNumber)}
                                  onError={(e) => handleThumbnailError(e, cDef.imageUrl)}
                                  alt={candidate.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-hud font-num text-fg-muted">
                                  {candidate.card.cardNumber}
                                </div>
                              )}
                            </div>

                            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                              <div className="flex items-center justify-between gap-1.5">
                                <span className="text-caption font-semibold text-fg truncate">
                                  {candidate.name}
                                </span>
                                {isSelected && (
                                  <span className="px-1.5 py-px bg-teal-400 text-ink-950 text-hud font-num font-bold shrink-0">
                                    {plan.allowMultiple ? `#${orderIdx + 1}` : '已选'}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5 flex-wrap text-hud">
                                <span className="px-1 py-px bg-ink-850 border border-line text-teal-400">
                                  {candidate.zone === 'BATTLEFIELD' && candidate.slotIndex !== undefined
                                    ? `卡位 ${candidate.slotIndex + 1}`
                                    : meta.badge}
                                </span>
                                {candidate.zone === 'BATTLEFIELD' && (
                                  <span
                                    className={`px-1 py-px border ${
                                      candidate.card.isReady
                                        ? 'border-teal-400/40 text-teal-400 bg-teal-400/10'
                                        : 'border-gold-300/50 text-gold-300 bg-gold-300/10'
                                    }`}
                                  >
                                    {candidate.card.isReady ? '竖直' : '横置'}
                                  </span>
                                )}
                                <span className="text-fg-muted font-num">
                                  {candidate.card.cardNumber} · {candidate.cost}费
                                </span>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* 额外升变代价：如 BP01-040 置入我方战场 1 张《帕瓦》到下方 */}
          {needsExtraCost && (
            <div className="p-2.5 border border-gold-300/50 bg-ink-950 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2 text-hud">
                <span className="text-gold-300 font-semibold flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    额外升变代价：选择我方战场 1 张《{plan.config.extraCost?.exactName ?? '帕瓦'}》置入下方
                  </span>
                </span>
                <span className="text-fg-muted">自动排除当前升变主对象</span>
              </div>

              {availableExtraCandidates.length === 0 ? (
                <div className="px-2.5 py-2 border border-crimson-500/60 bg-crimson-500/10 text-crimson-400 text-caption">
                  缺少可放置到下方的《{plan.config.extraCost?.exactName ?? '帕瓦'}》候选，无法完成升变
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {availableExtraCandidates.map((extra) => {
                    const picked = effectiveExtraCostId === extra.card.instanceId;
                    return (
                      <button
                        key={extra.card.instanceId}
                        type="button"
                        onClick={() => setSelectedExtraCostId(extra.card.instanceId)}
                        className={`px-2.5 py-1.5 border text-caption flex items-center gap-1.5 cursor-pointer transition-colors ${
                          picked
                            ? 'border-gold-300 bg-gold-300 text-ink-950 font-semibold'
                            : 'border-line bg-ink-900 text-fg-secondary hover:border-gold-300/60'
                        }`}
                      >
                        <span className="font-num text-hud">卡位 {extra.slotIndex + 1}</span>
                        <span>{extra.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 非战场升变对象落位空卡位选择器（信号球区正面 / 浮空模式） */}
          {requiresEmptySlot && (
            <div className="p-2.5 border border-teal-400/50 bg-ink-950 flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-hud text-teal-400 font-semibold">
                <Zap className="w-3.5 h-3.5" />
                <span>所选升变对象来自非战场区域，请选择升变后的落位空卡位：</span>
              </div>

              {plan.emptySlotIndices.length === 0 ? (
                <div className="px-2.5 py-2 border border-crimson-500/60 bg-crimson-500/10 text-crimson-400 text-caption">
                  我方战场当前没有空余卡位，无法从该区域进行升变
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {[0, 1, 2, 3, 4].map((slotIdx) => {
                    const isEmpty = plan.emptySlotIndices.includes(slotIdx);
                    const picked = selectedSlotIndex === slotIdx;
                    return (
                      <button
                        key={slotIdx}
                        type="button"
                        disabled={!isEmpty}
                        onClick={() => setSelectedSlotIndex(slotIdx)}
                        className={`px-3 py-1.5 border text-caption font-num transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                          picked
                            ? 'border-teal-400 bg-teal-400 text-ink-950 font-bold'
                            : isEmpty
                            ? 'border-line bg-ink-900 text-fg-secondary hover:border-teal-400/60'
                            : 'border-line bg-ink-850 text-fg-disabled'
                        }`}
                      >
                        卡位 {slotIdx + 1}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
};
