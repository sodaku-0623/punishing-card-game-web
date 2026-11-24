import { GameState, GameEvent, GamePhase } from '@zhanshuang/shared';
import { RULE_CONSTANTS } from '@zhanshuang/game-rules';
import { ZoneManager } from '../zone/zone-manager.js';
import { CheckTimingManager } from '../priority/check-timing.js';
import { ContinuousEffectEngine } from '../effects/continuous-effects.js';
import { ReplacementEngine } from '../effects/replacement-engine.js';
import type { TriggerEvent } from '../priority/trigger-system.js';

export class PhaseMachine {
  private onTriggerEventCallback?: (event: TriggerEvent) => void;
  private onTurnStartAirborneReturnCallback?: (playerId: string) => void;
  private onEndPhaseReleasePartnersCallback?: () => void;
  private continuousEffects?: ContinuousEffectEngine;
  private replacementEngine?: ReplacementEngine;

  constructor(
    private state: GameState,
    private zoneMgr: ZoneManager,
    private checkTimingMgr: CheckTimingManager,
    private events: GameEvent[]
  ) {}

  setContinuousEffectEngine(engine: ContinuousEffectEngine): void {
    this.continuousEffects = engine;
  }

  setReplacementEngine(engine: ReplacementEngine): void {
    this.replacementEngine = engine;
  }

  setTriggerEventHandler(handler: (event: TriggerEvent) => void): void {
    this.onTriggerEventCallback = handler;
  }

  setTurnStartAirborneReturnHandler(handler: (playerId: string) => void): void {
    this.onTurnStartAirborneReturnCallback = handler;
  }

  setEndPhaseReleasePartnersHandler(handler: () => void): void {
    this.onEndPhaseReleasePartnersCallback = handler;
  }

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
    if (this.state.status === 'FINISHED') return;
    this.transitionTo('STAND_PHASE');
    const activePlayerId = this.state.activePlayerId;

    // 10.1 重置回合【回合1】能力发动次数统计
    for (const p of Object.values(this.state.players)) {
      p.turnAbilityUsage = {};
    }

    this.state.standPhaseStep = 'START_TRIGGERS';

    // 6.2.1.a 10.18.2.c 回合开始时检查处理区中的【浮空模式】卡牌并作为规则处理回到战场，
    // 以及「回合开始时」触发条件生效后进入检查时机 (均发生在 6.2.1.b 竖直之前)
    this.onTurnStartAirborneReturnCallback?.(activePlayerId);
    this.onTriggerEventCallback?.({
      type: 'TURN_STARTED',
      playerId: activePlayerId,
    });

    this.advanceStandPhase();
  }

  /**
   * 可挂起地推进 6.2 竖直阶段；遇待处理决策或对局结束时立即挂起并返回 false。
   */
  advanceStandPhase(): boolean {
    if (
      this.state.phase !== 'STAND_PHASE' ||
      this.state.status === 'FINISHED' ||
      this.state.currentPendingChoice
    ) {
      return false;
    }

    const activePlayerId = this.state.activePlayerId;

    if (!this.state.standPhaseStep || this.state.standPhaseStep === 'START_TRIGGERS') {
      if (
        !this.checkTimingMgr.resolveCheckTiming() ||
        (this.state.status as string) === 'FINISHED' ||
        this.state.currentPendingChoice
      ) {
        return false;
      }

      // 6.2.1.b 回合玩家将自身战场和费用区的所有卡牌竖直 (10.15 冰冻状态的卡牌无法因规则竖直)
      for (const card of Object.values(this.state.cards)) {
        if (
          card.controllerPlayerId === activePlayerId &&
          (card.zone === 'BATTLEFIELD' || card.zone === 'COST') &&
          !card.partnerOfCardId
        ) {
          if (!card.isFrozen) {
            card.isReady = true;
          }
        }
      }

      // 更新费用统计
      this.zoneMgr.syncCostStats(activePlayerId);
      this.state.standPhaseStep = 'POST_UNTAP';
    }

    if (this.state.standPhaseStep === 'POST_UNTAP') {
      // 6.2.1.c 相关触发条件生效后，该检查时机的所有处理完毕后进入抽牌填充阶段
      if (
        !this.checkTimingMgr.resolveCheckTiming() ||
        (this.state.status as string) === 'FINISHED' ||
        this.state.currentPendingChoice
      ) {
        return false;
      }

      // 10.15.3 竖直阶段结束时解除回合玩家卡牌的冰冻状态
      for (const card of Object.values(this.state.cards)) {
        if (card.controllerPlayerId === activePlayerId && card.isFrozen) {
          card.isFrozen = undefined;
        }
      }

      this.state.standPhaseStep = undefined;
      // 自动进入 6.3 抽牌填充阶段
      this.startDrawChargePhase();
      return true;
    }

    return false;
  }

  /**
   * 6.3 抽牌填充阶段 (Draw & Charge Phase)
   */
  startDrawChargePhase(): void {
    if (this.state.status === 'FINISHED' || this.state.currentPendingChoice) return;
    this.transitionTo('DRAW_CHARGE_PHASE');
    const activePlayerId = this.state.activePlayerId;
    this.state.drawChargePhaseStep = 'DRAW';

    // 6.3.1.b 除先攻玩家在其第一回合仅抽1张以外，从牌组抽2张牌
    const isFirstTurnOfGame = this.state.turnNumber === 1;
    const isFirstPlayer = this.state.players[activePlayerId]!.isFirstPlayer;
    const drawCount = isFirstTurnOfGame && isFirstPlayer ? 1 : 2;

    this.zoneMgr.drawCards(activePlayerId, drawCount);
    this.state.drawChargePhaseStep = 'AWAIT_CHARGE';
    // 给予回合玩家放置明费的选择时机 (6.3.1.c)
    this.state.priorityPlayerId = activePlayerId;

    if (
      !this.checkTimingMgr.resolveCheckTiming() ||
      (this.state.status as string) === 'FINISHED' ||
      this.state.currentPendingChoice
    ) {
      return;
    }
  }

  /**
   * 6.3.1.c 执行从手牌放置明费
   */
  chargeCostFromHand(playerId: string, cardInstanceId?: string): boolean {
    if (this.state.phase !== 'DRAW_CHARGE_PHASE') return false;
    if (this.state.activePlayerId !== playerId) return false;
    if (this.state.status === 'FINISHED' || this.state.currentPendingChoice) return false;
    if (this.state.drawChargePhaseStep && this.state.drawChargePhaseStep !== 'AWAIT_CHARGE') {
      return false;
    }

    if (cardInstanceId) {
      const card = this.state.cards[cardInstanceId];
      if (!card || card.controllerPlayerId !== playerId || card.zone !== 'HAND') {
        return false;
      }

      // 放置到费用区成为明费 (正面竖直)；若费用区已达上限，由 3.6.4 与置换引擎统一改放墓地或交由置换处理
      const moved = this.zoneMgr.moveCard(cardInstanceId, 'COST', { isFaceUp: true, isReady: true });
      if (!moved && !this.state.currentPendingChoice) {
        return false;
      }
    }

    this.state.drawChargePhaseStep = 'AFTER_CHARGE';
    this.advanceDrawChargePhase();
    return true;
  }

  /**
   * 可挂起地推进 6.3.1.d 抽牌填充阶段末尾检查时机并进入主要阶段
   */
  advanceDrawChargePhase(): boolean {
    if (
      this.state.phase !== 'DRAW_CHARGE_PHASE' ||
      this.state.status === 'FINISHED' ||
      this.state.currentPendingChoice
    ) {
      return false;
    }
    if (this.state.drawChargePhaseStep !== 'AFTER_CHARGE') {
      return false;
    }

    // 6.3.1.d 检查时机处理完毕后，进入主要阶段
    if (
      !this.checkTimingMgr.resolveCheckTiming() ||
      (this.state.status as string) === 'FINISHED' ||
      this.state.currentPendingChoice
    ) {
      return false;
    }
    this.state.drawChargePhaseStep = undefined;
    this.startMainPhase();
    return true;
  }

  /**
   * 6.4 主要阶段 (Main Phase)
   */
  startMainPhase(): void {
    if (this.state.status === 'FINISHED' || this.state.currentPendingChoice) return;
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
   * 6.5.1.d 执行结束阶段清理步骤；若检查时机产生待决决策或对局结束则立即挂起返回 false。
   */
  runEndPhaseCleanup(): boolean {
    if (this.state.status === 'FINISHED' || this.state.currentPendingChoice) return false;
    const activePlayerId = this.state.activePlayerId;

    // 6.5.1.d 进入检查时机，记录禁止回合结束送墓的暗费 (如 BP03-079)，之后「回合结束前」「该回合中」为期限的效果同时消失
    // untilTurn 为 undefined 的区域内持续效果 (如升变赋予的【速攻】) 不随回合结束消失，离场时才消失 (3.1.4)
    if (
      !this.checkTimingMgr.resolveCheckTiming() ||
      (this.state.status as string) === 'FINISHED' ||
      this.state.currentPendingChoice
    ) {
      return false;
    }

    const protectedHiddenCostIds = new Set<string>();
    for (const c of this.zoneMgr.getCardsInZone(activePlayerId, 'COST')) {
      if (
        !c.isFaceUp &&
        this.continuousEffects?.hasProhibition(c.instanceId, 'CANNOT_DISCARD_HIDDEN_COST_AT_END')
      ) {
        protectedHiddenCostIds.add(c.instanceId);
      }
    }

    for (const card of Object.values(this.state.cards)) {
      card.tempPPBonus = undefined;
      card.tempDPBonus = undefined;
      if (card.modifiers) {
        const remaining = card.modifiers.filter(
          (m) => m.untilTurn === undefined || m.untilTurn > this.state.turnNumber
        );
        card.modifiers = remaining.length > 0 ? remaining : undefined;
      }
    }
    this.replacementEngine?.cleanupExpired(this.state.turnNumber);
    // 8.13.4.c.1 6.5.1.d 结束阶段清理时解除双方所有协战角色的搭档状态并置入墓地，并清理本回合计数器
    this.onEndPhaseReleasePartnersCallback?.();
    for (const p of Object.values(this.state.players)) {
      p.turnAbilityUsage = {};
      p.costModifiers = [];
      p.destroyedFireRoleCountThisTurn = 0;
      p.erosionChangedThisTurn = false;
      p.turnCardPlayedCountByName = undefined;
      p.turnEquipmentPlayedCount = 0;
      p.turnArtAssocTacticsPlayedCount = 0;
      p.cardsPlayedThisTurn = 0;
      p.damageTakenThisTurn = 0;
      p.chargedAutoByLeeThisTurn = false;
      p.eliminatedOrbsByKareninaCountThisTurn = 0;
      p.eliminatedThreeOrbsThisTurn = false;
      p.destroyedFriendlyRoleCountThisTurn = 0;
    }

    // 3.6.3.b.1 将回合玩家的暗费以正面表示放置到墓地 (时点约定见规则整理 12.5；1.3.3 禁止送墓的暗费保留)
    for (const c of this.zoneMgr.getCardsInZone(activePlayerId, 'COST')) {
      if (!c.isFaceUp && !protectedHiddenCostIds.has(c.instanceId)) {
        this.zoneMgr.moveCard(c.instanceId, 'GRAVEYARD', { isFaceUp: true });
      }
    }

    this.state.endPhaseStep = 'CLEANUP_POST';
    return true;
  }

  /**
   * 6.5.1.d 清理后的检查时机与 6.5.1.e 回合交接；遇待决决策或对局结束立即挂起返回 false。
   */
  handoffToNextTurn(): boolean {
    if (this.state.status === 'FINISHED' || this.state.currentPendingChoice) return false;
    if (
      !this.checkTimingMgr.resolveCheckTiming() ||
      (this.state.status as string) === 'FINISHED' ||
      this.state.currentPendingChoice
    ) {
      return false;
    }

    this.state.endPhaseStep = undefined;

    // 6.5.1.e 回合外玩家成为回合玩家，进入下一回合的竖直阶段
    const activePlayerId = this.state.activePlayerId;
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
    return true;
  }

  /**
   * 6.5.1.d 之后的清理与 6.5.1.e 回合交接
   */
  finishEndPhase(): void {
    if (!this.runEndPhaseCleanup()) return;
    this.handoffToNextTurn();
  }
}
