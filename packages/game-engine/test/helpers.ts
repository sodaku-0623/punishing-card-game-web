import type { PlayerState } from '@zhanshuang/shared';
import type { GameEngine } from '../src/engine.js';

/**
 * 测试辅助：从玩家牌组中取卡牌，以正面竖直状态补充到费用区，使费用区共有 total 张竖直明费。
 * 费用统计由费用区实际卡牌派生 (3.6)，测试不能再直接改写 openCostCount 等字段。
 */
export function fillCostZone(engine: GameEngine, player: PlayerState | string, total: number): void {
  const playerId = typeof player === 'string' ? player : player.playerId;
  for (const c of engine.zoneMgr.getCardsInZone(playerId, 'COST')) {
    if (c.isFaceUp) c.isReady = true;
  }
  let costCount = engine.zoneMgr.getCardsInZone(playerId, 'COST').filter((c) => c.isFaceUp).length;
  for (const deckCard of engine.zoneMgr.getCardsInZone(playerId, 'DECK')) {
    if (costCount >= total) break;
    engine.zoneMgr.moveCard(deckCard.instanceId, 'COST', { isFaceUp: true, isReady: true });
    costCount++;
  }
  engine.zoneMgr.syncCostStats(playerId);
}

/**
 * 测试辅助：轮流使用【瞬时】的时机中，由持有优先权的玩家依次选择不使用，直到该时机结束
 */
export function passInstantWindows(engine: GameEngine): void {
  for (let guard = 0; guard < 10 && engine.getState().timingWindow; guard++) {
    const window = engine.getState().timingWindow!;
    const res = engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: window.priorityPlayerId });
    if (!res.success) throw new Error(`放弃使用瞬时失败: ${res.error}`);
  }
}

/**
 * 测试辅助：回合玩家结束主要阶段，处理结束阶段的瞬时时机与手牌弃置，直到进入下一回合
 */
export function endTurn(engine: GameEngine): void {
  const state = engine.getState();
  const turn = state.turnNumber;
  const res = engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: state.activePlayerId });
  if (!res.success) throw new Error(`结束主要阶段失败: ${res.error}`);
  for (let guard = 0; guard < 20 && state.turnNumber === turn && state.status !== 'FINISHED'; guard++) {
    if (state.timingWindow) {
      passInstantWindows(engine);
      continue;
    }
    const choice = state.currentPendingChoice;
    if (choice?.effectType === 'END_PHASE_DISCARD') {
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: choice.playerId,
        pendingChoiceId: choice.id,
        selectedIds: choice.options.slice(0, choice.minSelections).map((o) => o.id),
      });
      continue;
    }
    break;
  }
}

/**
 * 测试辅助：依次处理所有待处理的决策 (选择最少数量的可选选项)
 */
export function resolvePendingChoices(engine: GameEngine): void {
  const state = engine.getState();
  for (let guard = 0; guard < 20 && state.currentPendingChoice; guard++) {
    const choice = state.currentPendingChoice;
    const eligible = choice.options.filter((o) => (o.payload as { eligible?: boolean } | undefined)?.eligible !== false);
    const res = engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: choice.playerId,
      pendingChoiceId: choice.id,
      selectedIds: eligible.slice(0, choice.minSelections).map((o) => o.id),
    });
    if (!res.success) throw new Error(`处理决策 ${choice.effectType} 失败: ${res.error}`);
  }
}
