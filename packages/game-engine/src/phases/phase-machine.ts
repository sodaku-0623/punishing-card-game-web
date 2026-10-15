import { GameState, GameEvent, GamePhase } from '@zhanshuang/shared';
import { RULE_CONSTANTS } from '@zhanshuang/game-rules';
import { ZoneManager } from '../zone/zone-manager.js';
import { CheckTimingManager } from '../priority/check-timing.js';

export class PhaseMachine {
  constructor(
    private state: GameState,
    private zoneMgr: ZoneManager,
    private checkTimingMgr: CheckTimingManager,
    private events: GameEvent[]
  ) {}

  /**
   * 状态迁移与事件广播
   */
  transitionTo(toPhase: GamePhase): void {
    const fromPhase = this.state.phase;
    this.state.phase = toPhase;
    this.events.push({
      type: 'PHASE_CHANGED',
      fromPhase,
      toPhase,
    });
  }

  /**
   * 6.2 竖直阶段 (Stand Phase)
   */
  startStandPhase(): void {
    this.transitionTo('STAND_PHASE');
    const activePlayerId = this.state.activePlayerId;

    // 6.2.1.b 回合玩家将自身战场和费用区的所有卡牌竖直
    for (const card of Object.values(this.state.cards)) {
      if (
        card.controllerPlayerId === activePlayerId &&
        (card.zone === 'BATTLEFIELD' || card.zone === 'COST')
      ) {
        card.isReady = true;
      }
    }

    // 更新费用统计
    const player = this.state.players[activePlayerId]!;
    player.availableOpenCostCount = player.openCostCount;
    player.exhaustedOpenCostCount = 0;

    // 10.1 重置回合【回合1】能力发动次数统计
    for (const p of Object.values(this.state.players)) {
      p.turnAbilityUsage = {};
    }

    // 6.2.1.c 检查时机
    this.checkTimingMgr.resolveCheckTiming();

    // 自动进入 6.3 抽牌填充阶段
    this.startDrawChargePhase();
  }

  /**
   * 6.3 抽牌填充阶段 (Draw & Charge Phase)
   */
  startDrawChargePhase(): void {
    this.transitionTo('DRAW_CHARGE_PHASE');
    const activePlayerId = this.state.activePlayerId;

    // 6.3.1.b 除先攻玩家在其第一回合仅抽1张以外，从牌组抽2张牌
    const isFirstTurnOfGame = this.state.turnNumber === 1;
    const isFirstPlayer = this.state.players[activePlayerId]!.isFirstPlayer;
    const drawCount = isFirstTurnOfGame && isFirstPlayer ? 1 : 2;

    this.zoneMgr.drawCards(activePlayerId, drawCount);

    this.checkTimingMgr.resolveCheckTiming();

    // 给予回合玩家放置明费的选择时机 (6.3.1.c)
    // 默认进入主要阶段，或等待玩家明确执行充费动作
    this.state.priorityPlayerId = activePlayerId;
  }

  /**
   * 6.3.1.c 执行从手牌放置明费
   */
  chargeCostFromHand(playerId: string, cardInstanceId?: string): boolean {
    if (this.state.phase !== 'DRAW_CHARGE_PHASE') return false;
    if (this.state.activePlayerId !== playerId) return false;

    const player = this.state.players[playerId]!;

    if (cardInstanceId) {
      const card = this.state.cards[cardInstanceId];
      if (!card || card.controllerPlayerId !== playerId || card.zone !== 'HAND') {
        return false;
      }

      // 费用区中明费和暗费的数量合计上限为10张。若费用区已存在10张卡牌，需要放置到费用区的卡牌改为放置到墓地。
      if (player.totalCostCount >= RULE_CONSTANTS.MAX_COST_ZONE_CAPACITY) {
        this.zoneMgr.moveCard(cardInstanceId, 'GRAVEYARD', { isFaceUp: true });
      } else {
        // 放置到费用区成为明费 (正面竖直)
        this.zoneMgr.moveCard(cardInstanceId, 'COST', { isFaceUp: true, isReady: true });
        player.openCostCount++;
        player.availableOpenCostCount++;
        player.totalCostCount++;
      }
    }

    // 6.3.1.d 检查时机处理完毕后，进入主要阶段
    this.checkTimingMgr.resolveCheckTiming();
    this.startMainPhase();
    return true;
  }

  /**
   * 6.4 主要阶段 (Main Phase)
   */
  startMainPhase(): void {
    this.transitionTo('MAIN_PHASE');
    this.state.priorityPlayerId = this.state.activePlayerId;
    this.checkTimingMgr.resolveCheckTiming();
  }

  /**
   * 6.5 结束阶段 (End Phase)
   */
  startEndPhase(): void {
    this.transitionTo('END_PHASE');
    const activePlayerId = this.state.activePlayerId;
    const player = this.state.players[activePlayerId]!;

    // 6.5.1.a 瞬时时点轮转已结束 (由玩家Pass触发进入本阶段)
    // 6.5.1.b 回合结束触发检查时机
    this.checkTimingMgr.resolveCheckTiming();

    // 6.5.1.c 回合玩家手牌超过上限7张时，弃至7张
    const handCards = this.zoneMgr.getCardsInZone(activePlayerId, 'HAND');
    if (handCards.length > RULE_CONSTANTS.MAX_HAND_SIZE_END_PHASE) {
      const excess = handCards.length - RULE_CONSTANTS.MAX_HAND_SIZE_END_PHASE;
      for (let i = 0; i < excess; i++) {
        const toDiscard = handCards[handCards.length - 1 - i]!;
        this.zoneMgr.moveCard(toDiscard.instanceId, 'GRAVEYARD', { isFaceUp: true });
      }
    }

    // 3.6.3.b.1 将回合玩家的暗费以正面表示放置到墓地
    const costCards = this.zoneMgr.getCardsInZone(activePlayerId, 'COST');
    for (const c of costCards) {
      if (!c.isFaceUp) {
        this.zoneMgr.moveCard(c.instanceId, 'GRAVEYARD', { isFaceUp: true });
        player.hiddenCostCount--;
        player.totalCostCount--;
      }
    }
    player.hiddenCostCount = Math.max(0, player.hiddenCostCount);

    // 6.5.1.d 清理“该回合中”的临时加成与词条
    for (const card of Object.values(this.state.cards)) {
      card.tempPPBonus = undefined;
      card.tempDPBonus = undefined;
    }

    // 重置所有玩家的【回合1】能力计数与费用减免修改器 (直到回合结束为止)
    for (const p of Object.values(this.state.players)) {
      p.turnAbilityUsage = {};
      p.costModifiers = [];
    }

    this.checkTimingMgr.resolveCheckTiming();

    // 6.5.1.e 切换攻守玩家，开始下一个回合
    const nextActivePlayerId = this.state.nonActivePlayerId;
    const nextNonActivePlayerId = this.state.activePlayerId;
    this.state.activePlayerId = nextActivePlayerId;
    this.state.nonActivePlayerId = nextNonActivePlayerId;
    this.state.turnNumber += 1;
    this.state.priorityPlayerId = nextActivePlayerId;

    this.events.push({
      type: 'TURN_STARTED',
      turnNumber: this.state.turnNumber,
      activePlayerId: nextActivePlayerId,
    });

    // 进入下一回合竖直阶段
    this.startStandPhase();
  }
}
