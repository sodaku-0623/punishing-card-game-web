'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { CardInstance } from '@zhanshuang/shared';
import { Users, CheckCircle2, Zap } from 'lucide-react';
import { Button, Dialog } from '@/components/ui';
import { findCardByNumberOrId } from '@/lib/cards-data';
import {
  AssistPartnerOption,
  doesAssistSupportOrbCost,
} from '@/lib/battle-actions';
import { resolveOrbDisplayInfo } from '@/lib/signal-orbs';

interface AssistModalProps {
  isOpen: boolean;
  hostRole: CardInstance | null;
  candidates: AssistPartnerOption[];
  myOrbs: CardInstance[];
  onConfirm: (hostRoleCardId: string, partnerCardId: string, orbCardInstanceIds?: string[]) => void;
  onClose: () => void;
}

export const AssistModal: React.FC<AssistModalProps> = ({
  isOpen,
  hostRole,
  candidates,
  myOrbs,
  onConfirm,
  onClose,
}) => {
  const [selectedPartnerId, setSelectedPartnerId] = useState<string | null>(null);
  const [selectedOrbIds, setSelectedOrbIds] = useState<string[]>([]);

  useEffect(() => {
    setSelectedPartnerId(null);
    setSelectedOrbIds([]);
  }, [hostRole?.instanceId, isOpen]);

  const hostDef = hostRole ? findCardByNumberOrId(hostRole.cardNumber || hostRole.cardId) : null;
  const showOrbSelector = useMemo(
    () => (hostRole ? doesAssistSupportOrbCost(hostRole) : false),
    [hostRole]
  );

  const orbInfos = useMemo(
    () => myOrbs.map((orb, idx) => resolveOrbDisplayInfo(orb, idx)),
    [myOrbs]
  );

  const toggleOrb = (id: string) => {
    setSelectedOrbIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  if (!hostRole) return null;

  const costLine =
    hostDef?.rulesText?.match(/【(?:协战代价|协战费用)】[：:\s]*([^\n]+)/)?.[1] || '详见卡牌文本';
  const partnerLine =
    hostDef?.rulesText?.match(/【协战搭档】[：:\s]*([^\n]+)/)?.[1] || '指定角色';

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      title={`发动【协战】· ${hostDef?.name || hostRole.cardNumber}`}
      subtitle="8.13 FREE TIMING ASSIST"
      size="md"
      blurBackdrop
      footer={
        <div className="w-full flex items-center justify-between gap-3">
          <span className="text-hud text-fg-muted truncate">
            搭档：{partnerLine}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="secondary" size="sm" onClick={onClose}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!selectedPartnerId}
              onClick={() => {
                if (!selectedPartnerId) return;
                onConfirm(
                  hostRole.instanceId,
                  selectedPartnerId,
                  selectedOrbIds.length > 0 ? selectedOrbIds : undefined
                );
                onClose();
              }}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>确认协战</span>
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3 select-none">
        <div className="px-3 py-2 border border-line bg-ink-950 text-caption text-fg-secondary flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-teal-400 font-semibold">
            <Users className="w-3.5 h-3.5" />
            <span>协战搭档要求：{partnerLine}</span>
          </div>
          <div className="text-hud text-fg-muted">协战代价：{costLine}</div>
        </div>

        <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto pr-1">
          {candidates.length === 0 ? (
            <div className="py-8 text-center text-caption text-fg-muted border border-line bg-ink-950/60">
              当前手牌/战场/墓地暂无可作为协战搭档的角色卡
            </div>
          ) : (
            candidates.map((opt) => {
              const isSelected = selectedPartnerId === opt.card.instanceId;
              return (
                <button
                  key={opt.card.instanceId}
                  type="button"
                  onClick={() => setSelectedPartnerId(opt.card.instanceId)}
                  className={`w-full px-3 py-2 border text-left flex items-center justify-between gap-2 text-caption transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-teal-400 bg-teal-400/15 text-fg'
                      : opt.matchesFilter
                      ? 'border-line bg-ink-950 text-fg-secondary hover:border-teal-400/60 hover:bg-ink-850'
                      : 'border-line bg-ink-950/50 text-fg-muted opacity-65 hover:opacity-90'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="px-1.5 py-px bg-ink-900 border border-line text-hud font-num text-teal-400 shrink-0">
                      {opt.zoneLabel}
                    </span>
                    <span className="font-semibold truncate">{opt.name}</span>
                    <span className="text-hud font-num text-fg-muted shrink-0">
                      {opt.cardNumber}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {opt.matchesFilter ? (
                      <span className="text-hud text-teal-400 border border-teal-400/40 bg-teal-400/10 px-1.5 py-px">
                        符合条件
                      </span>
                    ) : (
                      <span className="text-hud text-fg-muted border border-line px-1.5 py-px">
                        待校验
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {showOrbSelector && orbInfos.length > 0 && (
          <div className="px-3 py-2 border border-line bg-ink-950 flex flex-col gap-2">
            <div className="flex items-center justify-between text-hud text-fg-secondary">
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-gold-300" />
                <span>可选：指定用于支付协战代价的相邻信号球（不选则自动支付费用/默认球）</span>
              </span>
              {selectedOrbIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedOrbIds([])}
                  className="text-teal-400 hover:underline cursor-pointer"
                >
                  清空
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {orbInfos.map((orb) => {
                const picked = selectedOrbIds.includes(orb.instanceId);
                return (
                  <button
                    key={orb.instanceId}
                    type="button"
                    disabled={!orb.isEliminatable}
                    onClick={() => toggleOrb(orb.instanceId)}
                    className={`px-2 py-1 text-hud font-sans font-semibold border transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                      picked
                        ? 'border-gold-300 bg-gold-300 text-ink-950'
                        : 'border-line bg-ink-900 text-fg-secondary hover:border-teal-400/60'
                    }`}
                  >
                    #{orb.index + 1} {orb.label}
                    {orb.orbValue > 1 ? `×${orb.orbValue}` : ''}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
};
