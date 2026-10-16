import { GameState, GameEvent } from '@zhanshuang/shared';
import { RULE_CONSTANTS } from '@zhanshuang/game-rules';
import { ZoneManager } from '../zone/zone-manager.js';
import { BattlefieldManager } from '../zone/battlefield-manager.js';

export class SbaEngine {
  constructor(
    private state: GameState,
    private zoneMgr: ZoneManager,
    private fieldMgr: BattlefieldManager,
    private events: GameEvent[]
  ) {}

  /**
   * 执行检查型规则处理 (9.1.2.b 检查型规则处理)
   * 返回是否有规则处理被执行
   */
  runCheckTimingSba(): boolean {
    if (this.state.status === 'FINISHED') return false;

    let executedAny = false;

    // 1. 9.3 败北判定处理 (9.3.1)
    const p1 = this.state.players[this.state.activePlayerId]!;
    const p2 = this.state.players[this.state.nonActivePlayerId]!;

    const p1Loss =
      p1.erosionCount >= RULE_CONSTANTS.EROSION_LOSS_THRESHOLD ||
      (this.zoneMgr.getCardsInZone(p1.playerId, 'DECK').length === 0 &&
        this.zoneMgr.getCardsInZone(p1.playerId, 'GRAVEYARD').length === 0);

    const p2Loss =
      p2.erosionCount >= RULE_CONSTANTS.EROSION_LOSS_THRESHOLD ||
      (this.zoneMgr.getCardsInZone(p2.playerId, 'DECK').length === 0 &&
        this.zoneMgr.getCardsInZone(p2.playerId, 'GRAVEYARD').length === 0);

    if (p1Loss && p2Loss) {
      // 1.2.3 双方同时处于败北状态时，该局游戏判定为平局
      this.state.status = 'FINISHED';
      this.state.isDraw = true;
      this.state.finishReason = '双方同时满足败北条件，判定为平局 (1.2.3)';
      this.events.push({
        type: 'GAME_OVER',
        isDraw: true,
        reason: this.state.finishReason,
      });
      return true;
    } else if (p1Loss) {
      this.state.status = 'FINISHED';
      this.state.winnerId = p2.playerId;
      this.state.finishReason = `${p1.playerId} 满足败北条件 (侵蚀达标或牌组墓地耗尽)`;
      this.events.push({
        type: 'GAME_OVER',
        winnerPlayerId: p2.playerId,
        isDraw: false,
        reason: this.state.finishReason,
      });
      return true;
    } else if (p2Loss) {
      this.state.status = 'FINISHED';
      this.state.winnerId = p1.playerId;
      this.state.finishReason = `${p2.playerId} 满足败北条件 (侵蚀达标或牌组墓地耗尽)`;
      this.events.push({
        type: 'GAME_OVER',
        winnerPlayerId: p1.playerId,
        isDraw: false,
        reason: this.state.finishReason,
      });
      return true;
    }

    // 2. 9.4 角色PP不足处理 (当任意角色的PP变为0及以下时，该角色会因规则而破坏)
    for (const card of Object.values(this.state.cards)) {
      if (card.zone === 'BATTLEFIELD') {
        const slots = this.fieldMgr.getSlots(card.controllerPlayerId);
        const isTopRole = slots.some((s) => s.roleCardId === card.instanceId);
        if (isTopRole) {
          const pp = this.fieldMgr.calculateRoleEffectivePP(card.instanceId);
          if (pp <= 0) {
            this.fieldMgr.handleCardLeaveField(card.instanceId);
            this.zoneMgr.moveCard(card.instanceId, 'GRAVEYARD', { isFaceUp: true });
            this.events.push({
              type: 'CARD_DESTROYED',
              cardInstanceId: card.instanceId,
              reason: 'PP_ZERO',
            });
            executedAny = true;
          }
        }
      }
    }

    // 3. 9.5 违规卡牌处理 (9.5.5 费用区超过上限10张)
    for (const p of [p1, p2]) {
      const costCards = this.zoneMgr.getCardsInZone(p.playerId, 'COST');
      if (costCards.length > RULE_CONSTANTS.MAX_COST_ZONE_CAPACITY) {
        const excess = costCards.length - RULE_CONSTANTS.MAX_COST_ZONE_CAPACITY;
        // 自动选择末尾多出的费用置入墓地
        for (let i = 0; i < excess; i++) {
          const cardToDiscard = costCards[costCards.length - 1 - i]!;
          this.zoneMgr.moveCard(cardToDiscard.instanceId, 'GRAVEYARD', { isFaceUp: true });
        }
        executedAny = true;
      }
    }

    return executedAny;
  }
}
