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
