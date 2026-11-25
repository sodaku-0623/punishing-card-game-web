'use client';

import React from 'react';
import { GamePhase, PublicPendingTrigger } from '@zhanshuang/shared';
import { Clock, Swords, ChevronRight, RefreshCw, Zap } from 'lucide-react';
import { Button, Badge } from '@/components/ui';

interface TurnFlowViewProps {
  currentPhase: GamePhase;
  isMyTurn: boolean;
  onPassTiming?: () => void;
  canPassTiming?: boolean;
  passLabel?: string;
  waitingHint?: string;
  pendingTriggers?: PublicPendingTrigger[];
}

export const TurnFlowView: React.FC<TurnFlowViewProps> = React.memo(({
  currentPhase,
  isMyTurn,
  onPassTiming,
  canPassTiming,
  passLabel,
  waitingHint,
  pendingTriggers,
}) => {
  const PHASES = [
    { id: 'STAND_PHASE', title: '竖直阶段', subtitle: '竖直战场与费用区卡牌', code: '6.2' },
    { id: 'DRAW_CHARGE_PHASE', title: '抽牌填充', subtitle: '抽牌并填充 1 张明费', code: '6.3' },
    { id: 'MAIN_PHASE', title: '主要阶段', subtitle: '出场、起动、战术、攻击', code: '6.4' },
    { id: 'END_PHASE', title: '结束阶段', subtitle: '手牌上限与暗费结算', code: '6.5' },
  ];

  const COMBAT_STEPS = [
    { id: 'COMBAT_ATTACK_DECLARATION', label: '攻击宣言 7.2' },
    { id: 'COMBAT_FREE_TIMING', label: '自由时点 7.3' },
    { id: 'COMBAT_CHARGE', label: '充能步骤 7.4' },
    { id: 'COMBAT_DAMAGE', label: '伤害步骤 7.5' },
    { id: 'COMBAT_BATTLE', label: '战斗步骤 7.6' },
  ];

  const isCombat = currentPhase.startsWith('COMBAT_');

  return (
    <div className="flex flex-col p-3 border border-line bg-ink-900/90 select-none w-full">
      <div className="flex items-center justify-between pb-2 border-b border-line mb-2.5">
        <div className="flex items-center gap-1.5 text-caption font-semibold text-fg">
          <Clock className="w-3.5 h-3.5 text-fg-muted" />
          <span>回合流程</span>
        </div>
        <Badge variant={isMyTurn ? 'teal' : 'neutral'}>
          {isMyTurn ? '我方行动' : '对手行动'}
        </Badge>
      </div>

      {currentPhase === 'MULLIGAN_PHASE' && (
        <div className="mb-2.5 px-2.5 py-2 border border-teal-400/50 bg-teal-400/10 text-teal-400 text-caption flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-semibold">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            开局手牌调度
          </span>
          <span className="font-num text-hud">5.2.1.e</span>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {PHASES.map((p) => {
          const isActive = currentPhase === p.id || (p.id === 'MAIN_PHASE' && isCombat);
          return (
            <div
              key={p.id}
              className={`px-2.5 py-1.5 border border-l-2 transition-colors duration-fast ${
                isActive
                  ? isMyTurn
                    ? 'border-line-strong border-l-teal-400 bg-ink-800 text-fg'
                    : 'border-line-strong border-l-crimson-500 bg-ink-800 text-fg'
                  : 'border-line border-l-transparent bg-ink-950/50 text-fg-muted'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-caption font-semibold ${isActive ? 'text-fg' : 'text-fg-secondary'}`}>
                  {p.title}
                </span>
                <span className="font-num text-hud text-fg-disabled">{p.code}</span>
              </div>
              <p className="text-hud text-fg-muted mt-0.5 leading-tight">{p.subtitle}</p>
            </div>
          );
        })}
      </div>

      {isCombat && (
        <div className="mt-2.5 pt-2 border-t border-line">
          <div className="text-hud font-display uppercase text-crimson-400 font-semibold mb-1.5 flex items-center gap-1">
            <Swords className="w-3 h-3" />
            <span>COMBAT STEPS</span>
          </div>
          <div className="grid grid-cols-2 gap-1 text-hud font-num">
            {COMBAT_STEPS.map((s) => {
              const isStepActive = currentPhase === s.id;
              return (
                <div
                  key={s.id}
                  className={`py-1 px-1.5 border text-center transition-colors ${
                    isStepActive
                      ? 'border-crimson-500 bg-crimson-500/20 text-fg font-semibold'
                      : 'border-line bg-ink-950 text-fg-disabled'
                  }`}
                >
                  {s.label}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {pendingTriggers && pendingTriggers.length > 0 && (
        <div className="mt-2.5 pt-2 border-t border-line">
          <div className="text-hud font-display uppercase text-teal-400 font-semibold mb-1.5 flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3 fill-current" />
              <span>待机自动能力</span>
            </span>
            <span className="font-num">{pendingTriggers.length}</span>
          </div>
          <div className="flex flex-col gap-1">
            {pendingTriggers.slice(0, 4).map((t) => (
              <div
                key={t.id}
                className="px-2 py-1 border border-teal-400/35 bg-teal-400/10 text-hud text-fg-secondary truncate"
                title={t.label}
              >
                {t.label}
              </div>
            ))}
          </div>
        </div>
      )}

      {waitingHint && (
        <div className="mt-2.5 py-2 px-2.5 border border-gold-300/50 bg-gold-300/10 text-gold-300 text-caption flex items-center justify-center gap-2">
          <Clock className="w-3.5 h-3.5 animate-spin shrink-0" />
          <span className="truncate">{waitingHint}</span>
        </div>
      )}

      {canPassTiming && (
        <Button
          variant="primary"
          size="md"
          onClick={onPassTiming}
          className="mt-3 w-full"
          title="按下空格键 (Space) 或回车键 (Enter) 亦可快速触发"
        >
          <span className="truncate">{passLabel ?? '时点让渡 / 推进阶段'} [Space]</span>
          <ChevronRight className="w-3.5 h-3.5 shrink-0" />
        </Button>
      )}
    </div>
  );
});

TurnFlowView.displayName = 'TurnFlowView';
