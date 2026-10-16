'use client';

import React from 'react';
import { GamePhase } from '@zhanshuang/shared';
import { Clock, Swords, Shield, ChevronRight, Zap, RefreshCw } from 'lucide-react';

interface TurnFlowViewProps {
  currentPhase: GamePhase;
  isMyTurn: boolean;
  onPassTiming?: () => void;
  canPassTiming?: boolean;
  passLabel?: string;
  waitingHint?: string;
}

export const TurnFlowView: React.FC<TurnFlowViewProps> = React.memo(({
  currentPhase,
  isMyTurn,
  onPassTiming,
  canPassTiming,
  passLabel,
  waitingHint,
}) => {
  const PHASES = [
    {
      id: 'STAND_PHASE',
      title: '竖直阶段',
      subtitle: '竖直战场与费用区所有的卡牌',
      code: '6.2',
    },
    {
      id: 'DRAW_CHARGE_PHASE',
      title: '抽牌填充阶段',
      subtitle: '抽牌并将1张牌充能至费用区',
      code: '6.3',
    },
    {
      id: 'MAIN_PHASE',
      title: '主要阶段',
      subtitle: '出场角色、发动能力、使用战术与装备',
      code: '6.4',
    },
    {
      id: 'END_PHASE',
      title: '结束阶段',
      subtitle: '检查手牌上限与回合结算',
      code: '6.5',
    },
  ];

  const COMBAT_STEPS = [
    { id: 'COMBAT_ATTACK_DECLARATION', label: '攻击宣言 (7.2)' },
    { id: 'COMBAT_FREE_TIMING', label: '自由时点 (7.3)' },
    { id: 'COMBAT_CHARGE', label: '充能步骤 (7.4)' },
    { id: 'COMBAT_DAMAGE', label: '伤害步骤 (7.5)' },
    { id: 'COMBAT_BATTLE', label: '战斗步骤 (7.6)' },
  ];

  const isCombat = currentPhase.startsWith('COMBAT_');

  return (
    <div className="flex flex-col p-3 rounded-2xl border border-terminalBorder/60 bg-surface/40 backdrop-blur-sm select-none w-full">
      {/* 顶部标题 */}
      <div className="flex items-center justify-between pb-2 border-b border-terminalBorder/40 mb-2.5">
        <div className="flex items-center gap-1.5 text-xs font-bold font-mono tracking-wider text-white">
          <Clock className="w-3.5 h-3.5 text-terminalCyan" />
          <span>回合流程 • TURN FLOW</span>
        </div>
        <span
          className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
            isMyTurn
              ? 'bg-terminalCyan/20 text-terminalCyan border border-terminalCyan/40 animate-pulse'
              : 'bg-neutral-800 text-neutral-400'
          }`}
        >
          {isMyTurn ? '我方行动' : '对手行动'}
        </span>
      </div>

      {/* 开局调度提示 */}
      {currentPhase === 'MULLIGAN_PHASE' && (
        <div className="mb-2.5 p-2 rounded-xl bg-terminalCyan/15 border border-terminalCyan/40 text-terminalCyan text-xs flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-1.5 font-bold">
            <RefreshCw className="w-3.5 h-3.5 animate-spin-slow text-terminalCyan" />
            <span>开局手牌调度 (5.2.1.e)</span>
          </div>
          <span className="text-[10px] text-terminalCyan/80 font-mono">准备中</span>
        </div>
      )}

      {/* 四大常规阶段 */}
      <div className="flex flex-col gap-1.5">
        {PHASES.map((p) => {
          const isActive =
            currentPhase === p.id || (p.id === 'MAIN_PHASE' && isCombat);
          return (
            <div
              key={p.id}
              className={`p-2 rounded-xl border text-left transition-all ${
                isActive
                  ? 'border-terminalCyan bg-terminalCyan/15 text-white shadow-[0_0_12px_rgba(0,240,255,0.2)]'
                  : 'border-terminalBorder/30 bg-neutral-900/40 text-neutral-400 hover:border-neutral-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-[11px] font-bold font-mono ${isActive ? 'text-terminalCyan' : 'text-neutral-300'}`}>
                  {p.title}
                </span>
                <span className="text-[9px] font-mono text-neutral-500">{p.code}</span>
              </div>
              <p className="text-[9px] text-neutral-400 font-mono mt-0.5 leading-tight">
                {p.subtitle}
              </p>
            </div>
          );
        })}
      </div>

      {/* 战斗步骤高亮 */}
      {isCombat && (
        <div className="mt-2.5 pt-2 border-t border-terminalBorder/40">
          <div className="text-[10px] font-bold text-erosionRed font-mono mb-1.5 flex items-center gap-1">
            <Swords className="w-3 h-3" />
            <span>战斗步骤 • COMBAT</span>
          </div>
          <div className="grid grid-cols-2 gap-1 text-[9px] font-mono">
            {COMBAT_STEPS.map((s) => {
              const isStepActive = currentPhase === s.id;
              return (
                <div
                  key={s.id}
                  className={`p-1 rounded border text-center transition-all ${
                    isStepActive
                      ? 'border-erosionRed bg-erosionRed/20 text-erosionRed font-bold shadow-sm animate-pulse'
                      : 'border-neutral-800 bg-neutral-900/50 text-neutral-500'
                  }`}
                >
                  {s.label}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 等待对方使用【瞬时】或选择是否阻挡的提示 */}
      {waitingHint && (
        <div className="mt-3 w-full py-2 px-3 rounded-xl border border-yellow-500/40 bg-yellow-500/10 text-yellow-300 font-mono text-xs flex items-center justify-center gap-2 select-none shadow-[0_0_10px_rgba(255,200,0,0.15)]">
          <Clock className="w-3.5 h-3.5 text-yellow-400 animate-spin shrink-0" />
          <span className="truncate">{waitingHint}</span>
        </div>
      )}

      {/* 行动推进按钮 (主要阶段攻方 Pass / 自由时点守方放弃阻挡) */}
      {canPassTiming && (
        <button
          onClick={onPassTiming}
          className={`mt-3 w-full py-1.5 rounded-xl font-bold font-mono text-xs flex items-center justify-center gap-1.5 shadow-md hover:scale-[1.02] transition-all cursor-pointer ${
            currentPhase === 'COMBAT_FREE_TIMING'
              ? 'bg-terminalGold text-neutral-950 hover:bg-yellow-400 shadow-[0_0_14px_rgba(255,200,0,0.5)] animate-pulse'
              : 'bg-terminalCyan text-neutral-950 hover:bg-terminalCyan/90'
          }`}
          title="按下空格键 (Space) 或回车键 (Enter) 亦可快速触发"
        >
          <span>
            {passLabel ?? '时点让渡 / 推进阶段'} [Space]
          </span>
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
});

TurnFlowView.displayName = 'TurnFlowView';
