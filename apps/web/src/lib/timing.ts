import type { PublicGameState } from '@zhanshuang/shared';

/**
 * 当前时机下己方可以执行的操作 (与引擎的规则一致)：
 * - 轮流使用【瞬时】的时机 (自由时点步骤 7.3.1.b / 结束阶段 6.5.1.a) 由持有优先权的玩家使用或放弃
 * - 双方都不再使用瞬时后，被攻击的玩家选择是否阻挡 (7.3.1.c)
 * - 其余时候只有回合玩家在主要阶段可以行动
 */
export interface TimingStatus {
  isMyTurn: boolean;
  /** 现在轮到我方选择是否使用【瞬时】 */
  hasInstantPriority: boolean;
  /** 我方可以宣告阻挡或放弃阻挡 */
  canDeclareBlock: boolean;
  /** 我方可以在主要阶段行动 (出牌、攻击、发动起动能力等) */
  canActMainPhase: boolean;
  /** 「时点让渡」按钮是否可用 */
  canPass: boolean;
  passLabel: string;
  /** 等待对方行动时的提示 */
  waitingHint?: string;
}

export function getTimingStatus(state: PublicGameState, myUserId: string): TimingStatus {
  const isMyTurn = state.activePlayerId === myUserId;
  const window = state.timingWindow;
  const choicePending = !!state.currentPendingChoice || !!state.opponentPendingChoice;
  const hasInstantPriority = !!window && window.priorityPlayerId === myUserId && !choicePending;
  const isBlockStep =
    state.phase === 'COMBAT_FREE_TIMING' && !window && (state.currentCombat?.step ?? 'BLOCK') === 'BLOCK';
  const canDeclareBlock = isBlockStep && !isMyTurn && !choicePending;
  const canActMainPhase =
    isMyTurn && state.phase === 'MAIN_PHASE' && !state.currentCombat && !window && !choicePending;

  let passLabel = '时点让渡 / 推进阶段';
  if (hasInstantPriority) passLabel = '不使用【瞬时】';
  else if (canDeclareBlock) passLabel = '放弃阻挡 / 推进结算';

  let waitingHint: string | undefined;
  if (window && window.priorityPlayerId !== myUserId) waitingHint = '等待对方选择是否使用【瞬时】...';
  else if (isBlockStep && isMyTurn) waitingHint = '等待对方选择是否阻挡...';

  return {
    isMyTurn,
    hasInstantPriority,
    canDeclareBlock,
    canActMainPhase,
    canPass: hasInstantPriority || canDeclareBlock || canActMainPhase,
    passLabel,
    waitingHint,
  };
}
