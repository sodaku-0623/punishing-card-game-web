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
    this.zoneMgr.syncCostStats(activePlayerId);

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
   * 6.5 结束阶段开始：6.5.1.a 由回合玩家开始轮流使用【瞬时】。之后的步骤由引擎按 endPhaseStep 推进。
   */
  startEndPhase(): void {
    this.transitionTo('END_PHASE');
    this.state.endPhaseStep = 'INSTANTS';
    this.state.timingWindow = {
      kind: 'END_PHASE',
      priorityPlayerId: this.state.activePlayerId,
      consecutivePasses: 0,
    };
    this.state.priorityPlayerId = this.state.activePlayerId;
  }

  /**
   * 6.5.1.c 回合玩家手牌超出上限的张数
   */
  getHandOverflow(): number {
    const handCount = this.zoneMgr.getCardsInZone(this.state.activePlayerId, 'HAND').length;
    return Math.max(0, handCount - RULE_CONSTANTS.MAX_HAND_SIZE_END_PHASE);
  }

  /**
   * 6.5.1.d 之后的清理与 6.5.1.e 回合交接
   */
  finishEndPhase(): void {
    const activePlayerId = this.state.activePlayerId;

    // 6.5.1.d 进入检查时机，之后「回合结束前」「该回合中」为期限的效果同时消失
    this.checkTimingMgr.resolveCheckTiming();
    for (const card of Object.values(this.state.cards)) {
      card.tempPPBonus = undefined;
      card.tempDPBonus = undefined;
    }
    for (const p of Object.values(this.state.players)) {
      p.turnAbilityUsage = {};
      p.costModifiers = [];
    }

    // 3.6.3.b.1 将回合玩家的暗费以正面表示放置到墓地 (时点约定见规则整理 12.5)
    for (const c of this.zoneMgr.getCardsInZone(activePlayerId, 'COST')) {
      if (!c.isFaceUp) {
        this.zoneMgr.moveCard(c.instanceId, 'GRAVEYARD', { isFaceUp: true });
      }
    }

    this.checkTimingMgr.resolveCheckTiming();
    if (this.state.status === 'FINISHED') return;
    this.state.endPhaseStep = undefined;

    // 6.5.1.e 回合外玩家成为回合玩家，进入下一回合的竖直阶段
    const nextActivePlayerId = this.state.nonActivePlayerId;
    this.state.nonActivePlayerId = activePlayerId;
    this.state.activePlayerId = nextActivePlayerId;
    this.state.turnNumber += 1;
    this.state.priorityPlayerId = nextActivePlayerId;

    this.events.push({
      type: 'TURN_STARTED',
      turnNumber: this.state.turnNumber,
      activePlayerId: nextActivePlayerId,
    });

    this.startStandPhase();
  }
}
