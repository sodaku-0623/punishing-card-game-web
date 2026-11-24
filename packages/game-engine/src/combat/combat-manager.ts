import { GameState, GameEvent, CardInstance, ProhibitionFlag } from '@zhanshuang/shared';
import { RULE_CONSTANTS } from '@zhanshuang/game-rules';
import { ZoneManager } from '../zone/zone-manager.js';
import { BattlefieldManager } from '../zone/battlefield-manager.js';
import { ICardDatabase } from '../database/card-registry.js';
import { CheckTimingManager } from '../priority/check-timing.js';
import { ReplacementEngine } from '../effects/replacement-engine.js';
import type { ContinuousEffectEngine } from '../effects/continuous-effects.js';
import { enqueuePendingChoice } from '../state/pending-choice.js';
import type { TriggerEvent } from '../priority/trigger-system.js';

/**
 * 角色攻击流程 (第 7 章)。
 *
 * 攻击流程以步骤机推进：每个步骤执行完毕后进入下一步；需要玩家行动 (轮流使用瞬时、选择阻挡)
 * 或处理玩家决策 (如攻击时触发、充能时自动能力、触发顺序选择) 时暂停，待玩家行动后由引擎调用 advance() 从原位置继续。
 * 当前步骤与进度保存在 state.currentCombat 中，可随快照恢复。
 */
export class CombatManager {
  private onTriggerEventCallback?: (event: TriggerEvent) => void;
  private snapshotProvider?: (cardInstanceId: string) => TriggerEvent['subjectSnapshot'];
  private replacementEngine?: ReplacementEngine;
  private continuousEffects?: ContinuousEffectEngine;

  constructor(
    private state: GameState,
    private zoneMgr: ZoneManager,
    private fieldMgr: BattlefieldManager,
    private cardDb: ICardDatabase,
    private checkTimingMgr: CheckTimingManager,
    private events: GameEvent[]
  ) {}

  setReplacementEngine(engine: ReplacementEngine): void {
    this.replacementEngine = engine;
  }

  setContinuousEffectEngine(engine: ContinuousEffectEngine): void {
    this.continuousEffects = engine;
  }

  setTriggerEventHandler(
    handler: (event: TriggerEvent) => void,
    snapshotProvider?: (cardInstanceId: string) => TriggerEvent['subjectSnapshot']
  ): void {
    this.onTriggerEventCallback = handler;
    this.snapshotProvider = snapshotProvider;
  }

  private getDef(card: CardInstance) {
    return this.cardDb.getCard(card.cardNumber) || (card.cardId ? this.cardDb.getCard(card.cardId) : undefined);
  }

  private hasProhibition(cardInstanceId: string, flag: ProhibitionFlag): boolean {
    return this.fieldMgr.evaluateRoleStats(cardInstanceId).prohibitions.includes(flag);
  }

  /**
   * 7.5.1.b 计算并锁定本次攻击的伤害量 (含 1.3.3 禁止伤害、Q&A·7 PR-034 与 8.10 伤害置换；需选序挂起时返回 undefined)
   */
  private computeLockedCombatDamage(attackerCardId: string): number | undefined {
    if (!this.fieldMgr.isSlotRole(this.state.activePlayerId, attackerCardId)) return 0;
    if (this.state.currentCombat?.cannotDealDamage || this.hasProhibition(attackerCardId, 'CANNOT_DEAL_DAMAGE')) {
      return 0;
    }
    const baseDp = Math.max(0, this.fieldMgr.calculateRoleEffectiveDP(attackerCardId));
    if (baseDp <= 0) return 0;
    let dmg = baseDp;
    if (this.replacementEngine) {
      const res = this.replacementEngine.interceptDealDamageDetailed(
        this.state.nonActivePlayerId,
        baseDp,
        attackerCardId,
        undefined,
        { applyMode: 'COMBAT_DAMAGE' }
      );
      if (res.pendingChoice) {
        return undefined;
      }
      dmg = res.amount;
    }
    const cap = this.state.currentCombat?.maxDamageInDamageStep;
    if (cap !== undefined) {
      dmg = Math.min(dmg, Math.max(0, cap));
    }
    return dmg;
  }

  /**
   * 10.14 暮形态 / 晖形态是否有效：操控玩家信号球区最下方卡牌的实时费用为偶数 / 奇数 (BP02-024 +1 后生效)；
   * 信号球区为空或最下方为背面表示的卡牌时均无效 (10.14.4、Q&A 第6期)
   */
  isFormActive(playerId: string, form: '暮' | '晖'): boolean {
    if (this.continuousEffects) {
      return this.continuousEffects.isFormActive(playerId, form);
    }
    const bottom = this.zoneMgr.getCardsInZone(playerId, 'SIGNAL_ORB')[0];
    if (!bottom || !bottom.isFaceUp) return false;
    const cost = this.getDef(bottom)?.cost;
    if (cost === undefined) return false;
    return form === '暮' ? cost % 2 === 0 : cost % 2 === 1;
  }

  /**
   * 角色是否持有某个关键字能力：通过 8.9 持续效果层统一判定
   */
  hasKeyword(cardInstanceId: string, keyword: string): boolean {
    return this.fieldMgr.evaluateRoleStats(cardInstanceId).keywords.includes(keyword);
  }

  /**
   * 7.2 攻击宣言步骤 (Attack Declaration Step)
   */
  declareAttack(
    playerId: string,
    attackerCardId: string,
    targetType: 'PLAYER' | 'CHARACTER',
    targetCardId?: string
  ): { success: boolean; error?: string } {
    if (this.state.phase !== 'MAIN_PHASE') {
      return { success: false, error: '只能在主要阶段宣告攻击 (7.1.1)' };
    }
    if (this.state.activePlayerId !== playerId) {
      return { success: false, error: '只有回合玩家可以宣告攻击 (7.1.1)' };
    }
    if (this.state.currentCombat) {
      return { success: false, error: '当前已有正在进行的攻击' };
    }

    const attacker = this.state.cards[attackerCardId];
    // 7.2.1.a 只能选择自身战场卡位上的角色 (辅助机、装备、角色下方的牌都不能攻击)
    if (!attacker || !this.fieldMgr.isSlotRole(playerId, attackerCardId)) {
      return { success: false, error: '攻击角色不存在或不属于己方战场' };
    }

    // 7.2.1.a.1 竖直状态的角色可以进行攻击
    if (!attacker.isReady) {
      return { success: false, error: '只有竖直状态的角色可以进行攻击' };
    }

    // 1.3.3 禁止攻击检查 (含固有【永】：该牌不能攻击，以及效果赋予的 CANNOT_ATTACK；失去能力 8.3.4 已在持续效果层解除固有不能攻击)
    const attackerEval = this.fieldMgr.evaluateRoleStats(attackerCardId);
    if (attackerEval.prohibitions.includes('CANNOT_ATTACK')) {
      return { success: false, error: '该角色不能攻击 (1.3.3)' };
    }

    // 7.2.1.b.1 出场回合不可攻击 (10.5 速攻可以；10.6 突进可以攻击角色；ST05-001 暮【出】允许攻击对方玩家)
    const isEnterTurn = attacker.turnEnteredZone === this.state.turnNumber;
    const hasRush = attackerEval.keywords.includes('速攻');
    const hasAssault = attackerEval.keywords.includes('突进');
    const canAttackPlayerOnEnter = attackerEval.canAttackPlayerOnEnterTurn;

    if (isEnterTurn && !hasRush && !hasAssault && !(targetType === 'PLAYER' && canAttackPlayerOnEnter)) {
      return { success: false, error: '角色在其出场的回合不可以进行攻击 (7.2.1.b.1)' };
    }
    if (isEnterTurn && !hasRush && hasAssault && targetType === 'PLAYER' && !canAttackPlayerOnEnter) {
      return { success: false, error: '【突进】在出场回合只能选择对方角色作为攻击对象 (10.6.1.a)' };
    }

    // 7.2.1.b.1 攻击对象：对方玩家或对方战场横置状态的角色 (BP03-012 / BP03-022 可选竖直角色)
    const opponentPlayerId = this.state.nonActivePlayerId;
    if (targetType === 'CHARACTER') {
      if (!targetCardId) {
        return { success: false, error: '未指定目标角色' };
      }
      const targetCard = this.state.cards[targetCardId];
      if (!targetCard || !this.fieldMgr.isSlotRole(opponentPlayerId, targetCardId)) {
        return { success: false, error: '目标角色不存在或不属于对手战场' };
      }
      const targetCost = this.continuousEffects
        ? this.continuousEffects.getEffectiveCardCost(targetCardId)
        : (this.getDef(targetCard)?.cost ?? 0);
      if (targetCard.isReady) {
        const maxReadyCost = attackerEval.canAttackReadyRolesMaxCost;
        if (maxReadyCost === undefined || targetCost > maxReadyCost) {
          return { success: false, error: '只能选择对方战场的横置状态的角色作为攻击对象 (7.2.1.b.1)' };
        }
      }
      // BP02-010 丽芙·极昼【永】：对方选择角色作为攻击对象时，若可以选择该角色，则必须选择该角色
      const targetEval = this.fieldMgr.evaluateRoleStats(targetCardId);
      if (!targetEval.mustBeAttackTarget) {
        const forcedExists = this.fieldMgr.getSlots(opponentPlayerId).some((s) => {
          const rid = s.roleCardId ?? (s.assistCardId && this.fieldMgr.isSlotRole(opponentPlayerId, s.assistCardId) ? s.assistCardId : undefined);
          if (!rid) return false;
          const rc = this.state.cards[rid];
          if (!rc) return false;
          if (rc.isReady) {
            const maxReadyCost = attackerEval.canAttackReadyRolesMaxCost;
            const rcCost = this.continuousEffects
              ? this.continuousEffects.getEffectiveCardCost(rid)
              : (this.getDef(rc)?.cost ?? 0);
            if (maxReadyCost === undefined || rcCost > maxReadyCost) return false;
          }
          return this.fieldMgr.evaluateRoleStats(rid).mustBeAttackTarget === true;
        });
        if (forcedExists) {
          return { success: false, error: '必须选择对方战场上带有强制被攻击效果的《丽芙·极昼》作为攻击对象' };
        }
      }
    } else if (targetType !== 'PLAYER') {
      return { success: false, error: '攻击对象类型不正确' };
    }

    // PR-031 七实·芒星之迹【永】：若我方信号球区的牌为7张以下，攻击须先将手牌1张雷属性牌背面放信号球区最下方
    if (
      attacker.cardNumber === 'PR-031' &&
      !attackerEval.abilitiesLost &&
      this.zoneMgr.getCardsInZone(playerId, 'SIGNAL_ORB').length <= 7
    ) {
      const handLightning = this.zoneMgr.getCardsInZone(playerId, 'HAND').filter((c) => {
        const def = this.getDef(c);
        return def?.attribute === 'LIGHTNING';
      });
      if (handLightning.length === 0) {
        return {
          success: false,
          error: '信号球区为7张以下时，手牌需要有雷属性卡牌以背面表示放置到信号球区最下方才能攻击 (PR-031)',
        };
      }
      enqueuePendingChoice(this.state, {
        id: `choice-pr031-attack-${attackerCardId}-${this.events.length}`,
        playerId,
        choiceType: 'SELECT_CARDS',
        prompt: '【PR-031 七实·芒星之迹】信号球区为7张以下，请选择手牌 1 张雷属性卡牌以背面表示放置到信号球区最下方：',
        options: handLightning.map((c) => {
          const def = this.getDef(c);
          return {
            id: c.instanceId,
            label: `${def?.name ?? c.cardNumber} (${c.cardNumber})`,
            payload: { cardInstanceId: c.instanceId, cardNumber: c.cardNumber },
          };
        }),
        effectType: 'PR031_ATTACK_PAY_ORB',
        sourceCardInstanceId: attackerCardId,
        metadata: { attackerCardId, targetType, targetCardId },
        minSelections: 1,
        maxSelections: 1,
      });
      return { success: true };
    }

    return this.finalizeDeclaredAttack(playerId, attackerCardId, targetType, targetCardId);
  }

  /**
   * 7.2.1.b~d 攻击条件及前置代价满足后正式横置并进入攻击流程 (供 declareAttack 与 PR-031 回调复用)
   */
  finalizeDeclaredAttack(
    playerId: string,
    attackerCardId: string,
    targetType: 'PLAYER' | 'CHARACTER',
    targetCardId?: string
  ): { success: boolean; error?: string } {
    // 7.2.1.b 将攻击角色横置 (经统一入口以触发 CARD_TAPPED)
    this.zoneMgr.setCardReady(attackerCardId, false);

    this.state.phase = 'COMBAT_ATTACK_DECLARATION';
    this.state.currentCombat = {
      step: 'ATTACK_DECLARATION',
      attackerCardId,
      targetType,
      targetCardId: targetType === 'CHARACTER' ? targetCardId : undefined,
      freeTimingPassCount: 0,
    };

    this.events.push({
      type: 'ATTACK_DECLARED',
      attackerCardId,
      targetType,
      targetCardId: targetType === 'CHARACTER' ? targetCardId : undefined,
    });

    // 7.2.1.d「攻击时」触发条件生效后进入检查时机；全部处理完毕后再进入自由时点步骤
    this.onTriggerEventCallback?.({
      type: 'ATTACK_DECLARED',
      playerId,
      cardInstanceId: attackerCardId,
      targetType,
      targetCardId: targetType === 'CHARACTER' ? targetCardId : undefined,
      subjectSnapshot: this.snapshotProvider?.(attackerCardId),
    });

    if (this.checkTimingMgr.resolveCheckTiming() && this.state.status !== 'FINISHED') {
      this.enterFreeTimingStep();
    }

    return { success: true };
  }

  /**
   * 7.3 自由时点步骤开始：7.3.1.a 触发检查时机，随后 7.3.1.b 由回合外玩家开始轮流使用【瞬时】
   */
  private enterFreeTimingStep(): void {
    const combat = this.state.currentCombat;
    if (!combat || this.state.status === 'FINISHED') return;
    const opponentPlayerId = this.state.nonActivePlayerId;

    this.state.phase = 'COMBAT_FREE_TIMING';
    combat.step = 'FREE_TIMING';

    this.onTriggerEventCallback?.({
      type: 'FREE_TIMING_STARTED',
      playerId: this.state.activePlayerId,
      cardInstanceId: combat.attackerCardId,
      targetType: combat.targetType,
      targetCardId: combat.targetCardId,
    });

    this.state.timingWindow = { kind: 'FREE_TIMING', priorityPlayerId: opponentPlayerId, consecutivePasses: 0 };
    this.state.priorityPlayerId = opponentPlayerId;
    this.checkTimingMgr.resolveCheckTiming();
  }

  /**
   * 7.3.1.c 阻挡宣言：所有玩家都不再使用瞬时之后，由被攻击的玩家选择是否阻挡
   */
  declareBlock(defenderPlayerId: string, blockerCardId?: string): { success: boolean; error?: string } {
    const combat = this.state.currentCombat;
    if (this.state.phase !== 'COMBAT_FREE_TIMING' || !combat) {
      return { success: false, error: '当前不在自由时点步骤' };
    }
    if (this.state.nonActivePlayerId !== defenderPlayerId) {
      return { success: false, error: '只有被攻击的玩家可以宣告阻挡' };
    }
    if (combat.step !== 'BLOCK' || this.state.timingWindow) {
      return { success: false, error: '双方都选择不再使用【瞬时】后才能宣告阻挡 (7.3.1.b)' };
    }

    if (blockerCardId) {
      const blocker = this.state.cards[blockerCardId];
      // 7.3.1.c 只能用自身战场卡位上的角色阻挡
      if (!blocker || !this.fieldMgr.isSlotRole(defenderPlayerId, blockerCardId)) {
        return { success: false, error: '阻挡角色不存在或不在己方战场' };
      }
      // 7.3.1.c.1 竖直状态的角色可以进行阻挡
      if (!blocker.isReady) {
        return { success: false, error: '只有竖直状态的角色可以进行阻挡' };
      }
      // 1.3.3 禁止阻挡检查
      if (this.hasProhibition(blockerCardId, 'CANNOT_BLOCK')) {
        return { success: false, error: '该角色不能阻挡 (1.3.3)' };
      }
      // 不可被 PP<=X 角色阻挡检查 (如 BP01-040 下方>=4张 / BP01-023)
      const attackerEval = this.fieldMgr.evaluateRoleStats(combat.attackerCardId);
      if (attackerEval.unblockableMaxPP !== undefined) {
        const blockerPP = this.fieldMgr.calculateRoleEffectivePP(blockerCardId);
        if (blockerPP <= attackerEval.unblockableMaxPP) {
          return {
            success: false,
            error: `攻击角色的本次攻击不会被 PP 为 ${attackerEval.unblockableMaxPP} 及以下的角色阻挡`,
          };
        }
      }

      this.zoneMgr.setCardReady(blockerCardId, false);
      combat.blockerCardId = blockerCardId;
      this.events.push({ type: 'BLOCK_DECLARED', blockerCardId, isBlocked: true });
      this.onTriggerEventCallback?.({
        type: 'BLOCK_DECLARED',
        playerId: defenderPlayerId,
        cardInstanceId: blockerCardId,
        targetCardId: combat.attackerCardId,
        subjectSnapshot: this.snapshotProvider?.(blockerCardId),
      });
    } else {
      this.events.push({ type: 'BLOCK_DECLARED', isBlocked: false });
    }

    // 7.3.1.d 检查时机，随后进入充能步骤
    if (this.checkTimingMgr.resolveCheckTiming() && this.state.status !== 'FINISHED') {
      this.enterChargeStep();
    } else if (this.state.status !== 'FINISHED') {
      // 阻挡触发产生了玩家决策，暂挂于 CHARGE 前置状态 (chargeIndex === undefined)，决策结束后由 advanceChargeStep 调用 enterChargeStep 补发 7.4.1.a
      this.state.phase = 'COMBAT_CHARGE';
      combat.step = 'CHARGE';
      combat.chargeIndex = undefined;
      combat.chargesRemaining = undefined;
    }
    return { success: true };
  }

  /**
   * 7.3.1.b 自由时点的瞬时轮流结束：进入阻挡宣言。被攻击玩家没有可以阻挡的角色时直接视为不阻挡。
   */
  onFreeTimingWindowClosed(): void {
    const combat = this.state.currentCombat;
    if (!combat) return;
    combat.step = 'BLOCK';
    this.state.priorityPlayerId = this.state.nonActivePlayerId;
    const attackerUnblockableMaxPP = this.fieldMgr.evaluateRoleStats(combat.attackerCardId).unblockableMaxPP;
    const canBlock = this.fieldMgr
      .getSlots(this.state.nonActivePlayerId)
      .some((s) => {
        if (!s.roleCardId || !this.state.cards[s.roleCardId]?.isReady) return false;
        if (this.hasProhibition(s.roleCardId, 'CANNOT_BLOCK')) return false;
        if (
          attackerUnblockableMaxPP !== undefined &&
          this.fieldMgr.calculateRoleEffectivePP(s.roleCardId) <= attackerUnblockableMaxPP
        ) {
          return false;
        }
        return true;
      });
    if (!canBlock) {
      this.declareBlock(this.state.nonActivePlayerId, undefined);
    }
  }

  /**
   * 4.12.2.c 攻击角色的充能数：通过 8.9 持续效果层统一计算 (含【充能X】与【充能+X】)
   */
  calculateRoleChargeCount(attackerCardId: string): number {
    return this.fieldMgr.evaluateRoleStats(attackerCardId).charge;
  }

  private enterChargeStep(): void {
    const combat = this.state.currentCombat;
    if (!combat || this.state.status === 'FINISHED') return;
    this.state.phase = 'COMBAT_CHARGE';
    combat.step = 'CHARGE';
    combat.chargeIndex = 0;
    combat.chargesRemaining = undefined;

    // 7.4.1.a「攻击充能开始时」触发条件生效后进入检查时机
    this.onTriggerEventCallback?.({
      type: 'ATTACK_CHARGE_STARTED',
      playerId: this.state.activePlayerId,
      cardInstanceId: combat.attackerCardId,
    });
    if (!this.checkTimingMgr.resolveCheckTiming() || (this.state.status as string) === 'FINISHED') {
      return;
    }

    // 7.4.1.b 充能次数在此时决定，之后攻击角色离场也照常执行 (Q&A 第6期)
    combat.chargesRemaining = this.fieldMgr.isSlotRole(this.state.activePlayerId, combat.attackerCardId)
      ? this.calculateRoleChargeCount(combat.attackerCardId)
      : 0;
  }

  /**
   * 推进攻击流程，直到攻击结束或需要玩家行动/决策。返回是否有进展。
   */
  advance(): boolean {
    const combat = this.state.currentCombat;
    if (!combat || this.state.status === 'FINISHED') return false;
    if (this.state.currentPendingChoice || this.state.timingWindow) return false;

    switch (combat.step) {
      case 'ATTACK_DECLARATION':
        // 7.2.1.d 攻击时触发的检查时机已完成，进入 7.3 自由时点步骤
        this.enterFreeTimingStep();
        return true;
      case 'FREE_TIMING':
        // 瞬时轮流窗口已关闭
        this.onFreeTimingWindowClosed();
        return true;
      case 'BLOCK':
        return false; // 等待被攻击玩家宣告阻挡
      case 'CHARGE':
        return this.advanceChargeStep();
      case 'DAMAGE':
        return this.advanceDamageStep();
      case 'BATTLE':
        this.resolveCharacterBattleStep();
        return true;
      case 'END':
      default:
        return this.endCombat();
    }
  }

  /**
   * 7.4.1.b 依次执行攻击充能；每张翻开的牌在其能力处理完毕 (含玩家选择) 后才放置
   */
  private advanceChargeStep(): boolean {
    const combat = this.state.currentCombat!;
    if (combat.chargeIndex === undefined) {
      // 7.3.1.d 阻挡触发暂停后恢复：此时才正式进入 7.4 充能步骤并触发 7.4.1.a
      this.enterChargeStep();
      return true;
    }
    if (combat.chargesRemaining === undefined && !combat.pendingChargeCardId) {
      // 7.4.1.a 充能开始触发暂停后恢复：补算 7.4.1.b 充能次数
      combat.chargesRemaining = this.fieldMgr.isSlotRole(this.state.activePlayerId, combat.attackerCardId)
        ? this.calculateRoleChargeCount(combat.attackerCardId)
        : 0;
    }
    if (combat.pendingChargeCardId) {
      this.zoneMgr.completeAttackCharge(combat.attackerCardId, combat.pendingChargeCardId, combat.chargeIndex ?? 1);
      combat.pendingChargeCardId = undefined;
      return true;
    }

    if ((combat.chargesRemaining ?? 0) > 0) {
      combat.chargesRemaining = (combat.chargesRemaining ?? 0) - 1;
      combat.chargeIndex = (combat.chargeIndex ?? 0) + 1;
      const cardId = this.zoneMgr.revealTopForCharge(
        this.state.activePlayerId,
        'ATTACK',
        combat.attackerCardId
      );
      if (cardId) {
        combat.pendingChargeCardId = cardId;
      } else {
        combat.chargesRemaining = 0;
      }
      return true;
    }

    // 7.4.1.c 检查时机后：对象为对方玩家且未被阻挡 → 伤害步骤；否则 → 角色战斗步骤
    if (!this.checkTimingMgr.resolveCheckTiming() || this.state.status === 'FINISHED') {
      return false;
    }
    if (combat.targetType === 'PLAYER' && !combat.blockerCardId) {
      this.state.phase = 'COMBAT_DAMAGE';
      combat.step = 'DAMAGE';
      combat.damageRemaining = undefined;
      // 7.5.1.a「伤害步骤开始时」触发检查时机，待处理完毕后再锁定 7.5.1.b 伤害量
      this.onTriggerEventCallback?.({
        type: 'DAMAGE_STEP_STARTED',
        playerId: this.state.activePlayerId,
        cardInstanceId: combat.attackerCardId,
      });
      if (this.checkTimingMgr.resolveCheckTiming() && (this.state.status as string) !== 'FINISHED') {
        combat.damageRemaining = this.computeLockedCombatDamage(combat.attackerCardId);
      }
    } else {
      this.state.phase = 'COMBAT_BATTLE';
      combat.step = 'BATTLE';
      // 7.6.1.a「角色战斗步骤开始时」触发检查时机
      this.onTriggerEventCallback?.({
        type: 'CHARACTER_BATTLE_STARTED',
        playerId: this.state.activePlayerId,
        cardInstanceId: combat.attackerCardId,
        targetCardId: combat.blockerCardId ?? combat.targetCardId,
      });
      this.checkTimingMgr.resolveCheckTiming();
    }
    return true;
  }

  /**
   * 7.5 伤害步骤：依次执行伤害充能，每次完毕侵蚀计数 +1 并进入检查时机 (4.12.3.b)
   */
  private advanceDamageStep(): boolean {
    const combat = this.state.currentCombat!;
    const defenderId = this.state.nonActivePlayerId;

    if (combat.damageRemaining === undefined && combat.pendingDamageCardId === undefined) {
      // 7.5.1.a 触发选择完毕后，在 7.5.1.b 此时锁定伤害量 (7.5.1.b.3 之后不再变化)
      combat.damageRemaining = this.computeLockedCombatDamage(combat.attackerCardId);
      if (combat.damageRemaining === undefined) {
        return false;
      }
    }

    if (combat.pendingDamageCardId !== undefined) {
      const cardId = combat.pendingDamageCardId || undefined;
      combat.pendingDamageCardId = undefined;
      combat.dealtPlayerDamage = true;
      this.zoneMgr.completeDamageCharge(defenderId, cardId);
      this.checkTimingMgr.resolveCheckTiming();
      return true;
    }

    if ((combat.damageRemaining ?? 0) > 0) {
      combat.damageRemaining = (combat.damageRemaining ?? 0) - 1;
      // 翻不出牌 (牌组与墓地都为空，已败北) 时也记录空字符串，以便执行侵蚀 +1
      combat.pendingDamageCardId =
        this.zoneMgr.revealTopForCharge(defenderId, 'DAMAGE', combat.attackerCardId) ?? '';
      return true;
    }

    // 7.5.1.c 检查时机后发射「对玩家造成伤害时」事件并进入「攻击结束时」
    if (!this.checkTimingMgr.resolveCheckTiming() || this.state.status === 'FINISHED') {
      return false;
    }
    if (combat.dealtPlayerDamage) {
      combat.dealtPlayerDamage = false;
      this.onTriggerEventCallback?.({
        type: 'ATTACK_DEALT_PLAYER_DAMAGE',
        playerId: this.state.activePlayerId,
        cardInstanceId: combat.attackerCardId,
        subjectSnapshot: this.snapshotProvider?.(combat.attackerCardId),
      });
      if (!this.checkTimingMgr.resolveCheckTiming() || (this.state.status as string) === 'FINISHED') {
        return false;
      }
    }
    combat.step = 'END';
    return true;
  }

  /**
   * 7.6 角色战斗步骤 (Character Battle Step)
   */
  private resolveCharacterBattleStep(): void {
    const combat = this.state.currentCombat!;
    const defenderCardId = combat.blockerCardId ?? combat.targetCardId;
    const attackerOnField = this.fieldMgr.isSlotRole(this.state.activePlayerId, combat.attackerCardId);
    const defenderOnField = !!defenderCardId && this.fieldMgr.isSlotRole(this.state.nonActivePlayerId, defenderCardId);

    // 7.6.1.b 攻击角色与被攻击角色均存在时比较 PP；7.6.1.c 任一不存在则不比较
    if (defenderCardId && attackerOnField && defenderOnField) {
      combat.battledCardId = defenderCardId;
      const attackerPP = this.fieldMgr.calculateRoleEffectivePP(combat.attackerCardId);
      const defenderPP = this.fieldMgr.calculateRoleEffectivePP(defenderCardId);
      let destroyedDefenderCardId: string | undefined;

      if (attackerPP >= defenderPP) {
        const intercept = this.replacementEngine?.interceptDestroyRole(
          defenderCardId,
          'BATTLE',
          combat.attackerCardId
        );
        if (intercept?.replaced) {
          // 8.10.1.a 战斗破坏被置换：视为未破坏，不发射 CARD_DESTROYED 也不触发【贯通】(Q&A·2 BP01-017/BP02-013)
          if (intercept.redirect) {
            this.zoneMgr.moveCard(defenderCardId, intercept.redirect.zone, {
              isFaceUp: intercept.redirect.isFaceUp,
              isReady: intercept.redirect.isReady,
              toBottom: intercept.redirect.toBottom,
              appliedReplacementIds: intercept.appliedIds,
            });
          }
        } else {
          const defenderSnapshot = this.snapshotProvider?.(defenderCardId);
          const movedToGy = this.zoneMgr.moveCard(defenderCardId, 'GRAVEYARD', { isFaceUp: true });
          if (movedToGy) {
            destroyedDefenderCardId = defenderCardId;
            this.events.push({ type: 'CARD_DESTROYED', cardInstanceId: defenderCardId, reason: 'BATTLE' });
            this.onTriggerEventCallback?.({
              type: 'CARD_DESTROYED',
              playerId: this.state.nonActivePlayerId,
              cardInstanceId: defenderCardId,
              targetCardId: combat.attackerCardId,
              fromZone: 'BATTLEFIELD',
              toZone: this.state.cards[defenderCardId]?.zone ?? 'GRAVEYARD',
              destroyReason: 'BATTLE',
              subjectSnapshot: defenderSnapshot,
            });

            // 10.7 贯通：战斗破坏被攻击的角色时，给予对方玩家 1 点伤害 (多个贯通也只触发 1 次)
            // Q&A·7 PR-034：若本次攻击不会给予伤害或攻击角色禁止造成伤害，贯通伤害亦不造成
            const cannotDealDamage =
              combat.cannotDealDamage || this.hasProhibition(combat.attackerCardId, 'CANNOT_DEAL_DAMAGE');
            if (!cannotDealDamage && this.hasKeyword(combat.attackerCardId, '贯通')) {
              this.zoneMgr.applyDamageToPlayer(
                this.state.nonActivePlayerId,
                RULE_CONSTANTS.PIERCING_DAMAGE_VALUE,
                combat.attackerCardId
              );
            }
          }
        }
      }

      this.events.push({
        type: 'BATTLE_COMPARED',
        attackerCardId: combat.attackerCardId,
        attackerPP,
        defenderCardId,
        defenderPP,
        destroyedDefenderCardId,
      });
    }

    // 7.6.1.d 先将步骤置为 END，在进入 endCombat (7.6.1.f) 之前由本轮与 continueFlow 彻底处理 7.6.1.d 的检查时机 (Q&A·10)
    combat.step = 'END';
    this.checkTimingMgr.resolveCheckTiming();
  }

  /**
   * 结束当前攻击流程，返回主要阶段 (7.5.1.d / 7.6.1.f「攻击结束时」)
   * 先完整发射并结算 ATTACK_ENDED 检查时机，再清空 currentCombat 与 combat-* 修饰器。
   */
  private endCombat(): boolean {
    const combat = this.state.currentCombat;
    if (!combat) {
      this.state.phase = 'MAIN_PHASE';
      this.state.priorityPlayerId = this.state.activePlayerId;
      return false;
    }

    if (!combat.attackEndTriggersEmitted) {
      combat.attackEndTriggersEmitted = true;
      this.onTriggerEventCallback?.({
        type: 'ATTACK_ENDED',
        playerId: this.state.activePlayerId,
        cardInstanceId: combat.attackerCardId,
        battledCardId: combat.battledCardId,
        blockerCardId: combat.blockerCardId,
        targetType: combat.targetType,
        targetCardId: combat.targetCardId,
        attackChargedHasChargeAuto: combat.attackChargedHasChargeAuto,
        subjectSnapshot: this.snapshotProvider?.(combat.attackerCardId),
      });
    }

    if (
      !this.checkTimingMgr.resolveCheckTiming() ||
      this.state.status === 'FINISHED' ||
      this.state.currentPendingChoice
    ) {
      return false;
    }

    // 清理持续至「那次攻击结束为止」的持续效果 (如 BP03-054 艾拉·万华【瞬时】)
    for (const card of Object.values(this.state.cards)) {
      if (card.modifiers?.some((m) => m.id?.startsWith('combat-'))) {
        const remaining = card.modifiers.filter((m) => !m.id?.startsWith('combat-'));
        card.modifiers = remaining.length > 0 ? remaining : undefined;
      }
    }

    this.state.currentCombat = undefined;
    this.state.phase = 'MAIN_PHASE';
    this.state.priorityPlayerId = this.state.activePlayerId;
    this.checkTimingMgr.resolveCheckTiming();
    return true;
  }
}
