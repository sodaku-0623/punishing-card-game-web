import { GameState, GameEvent, CardInstance } from '@zhanshuang/shared';
import { RULE_CONSTANTS } from '@zhanshuang/game-rules';
import { ZoneManager } from '../zone/zone-manager.js';
import { BattlefieldManager } from '../zone/battlefield-manager.js';
import { ICardDatabase } from '../database/card-registry.js';
import { CheckTimingManager } from '../priority/check-timing.js';
import { parseInherentChargeCount, parseInherentKeywords } from '../rules/keywords.js';
import { enqueuePendingChoice } from '../state/pending-choice.js';

/**
 * 角色攻击流程 (第 7 章)。
 *
 * 攻击流程以步骤机推进：每个步骤执行完毕后进入下一步；需要玩家行动 (轮流使用瞬时、选择阻挡)
 * 或处理玩家决策 (如充能时自动能力的选择) 时暂停，待玩家行动后由引擎调用 advance() 从原位置继续。
 * 当前步骤与进度保存在 state.currentCombat 中，可随快照恢复。
 */
export class CombatManager {
  constructor(
    private state: GameState,
    private zoneMgr: ZoneManager,
    private fieldMgr: BattlefieldManager,
    private cardDb: ICardDatabase,
    private checkTimingMgr: CheckTimingManager,
    private events: GameEvent[]
  ) {}

  private getDef(card: CardInstance) {
    return this.cardDb.getCard(card.cardNumber) || (card.cardId ? this.cardDb.getCard(card.cardId) : undefined);
  }

  /**
   * 10.14 暮形态 / 晖形态是否有效：操控玩家信号球区最下方卡牌的费用为偶数 / 奇数；
   * 信号球区为空或最下方为背面表示的卡牌时均无效 (10.14.4、Q&A 第6期)
   */
  isFormActive(playerId: string, form: '暮' | '晖'): boolean {
    const bottom = this.zoneMgr.getCardsInZone(playerId, 'SIGNAL_ORB')[0];
    if (!bottom || !bottom.isFaceUp) return false;
    const cost = this.getDef(bottom)?.cost;
    if (cost === undefined) return false;
    return form === '暮' ? cost % 2 === 0 : cost % 2 === 1;
  }

  /**
   * 角色是否持有某个关键字能力：效果赋予的，或卡牌自身的「【永】：【关键字】」
   */
  hasKeyword(cardInstanceId: string, keyword: string): boolean {
    const card = this.state.cards[cardInstanceId];
    if (!card) return false;
    if (card.grantedKeywords?.includes(keyword)) return true;
    if (card.modifiers?.some((m) => m.keywords?.includes(keyword))) return true;
    return parseInherentKeywords(this.getDef(card)?.rulesText).some(
      (k) => k.keyword === keyword && (!k.form || this.isFormActive(card.controllerPlayerId, k.form))
    );
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

    // 永久能力「该牌不能攻击」(如《帕瓦》《库洛洛》)
    if (this.getDef(attacker)?.rulesText.includes('【永】：该牌不能攻击')) {
      return { success: false, error: '该角色不能攻击' };
    }

    // 7.2.1.b.1 出场回合不可攻击 (10.5 速攻可以；10.6 突进可以攻击角色)
    const isEnterTurn = attacker.turnEnteredZone === this.state.turnNumber;
    const hasRush = this.hasKeyword(attackerCardId, '速攻');
    const hasAssault = this.hasKeyword(attackerCardId, '突进');

    if (isEnterTurn && !hasRush && !hasAssault) {
      return { success: false, error: '角色在其出场的回合不可以进行攻击 (7.2.1.b.1)' };
    }
    if (isEnterTurn && !hasRush && hasAssault && targetType === 'PLAYER') {
      return { success: false, error: '【突进】在出场回合只能选择对方角色作为攻击对象 (10.6.1.a)' };
    }

    // 7.2.1.b.1 攻击对象：对方玩家或对方战场横置状态的角色
    const opponentPlayerId = this.state.nonActivePlayerId;
    if (targetType === 'CHARACTER') {
      if (!targetCardId) {
        return { success: false, error: '未指定目标角色' };
      }
      const targetCard = this.state.cards[targetCardId];
      if (!targetCard || !this.fieldMgr.isSlotRole(opponentPlayerId, targetCardId)) {
        return { success: false, error: '目标角色不存在或不属于对手战场' };
      }
      if (targetCard.isReady) {
        return { success: false, error: '只能选择对方战场的横置状态的角色作为攻击对象 (7.2.1.b.1)' };
      }
    } else if (targetType !== 'PLAYER') {
      return { success: false, error: '攻击对象类型不正确' };
    }

    // 7.2.1.b 将攻击角色横置
    attacker.isReady = false;

    this.state.currentCombat = {
      step: 'FREE_TIMING',
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

    // 7.2.1.d 进入检查时机，随后进入自由时点步骤：7.3.1.b 由回合外玩家开始轮流使用瞬时
    this.checkTimingMgr.resolveCheckTiming();
    this.state.phase = 'COMBAT_FREE_TIMING';
    this.state.timingWindow = { kind: 'FREE_TIMING', priorityPlayerId: opponentPlayerId, consecutivePasses: 0 };
    this.state.priorityPlayerId = opponentPlayerId;

    return { success: true };
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

      blocker.isReady = false;
      combat.blockerCardId = blockerCardId;
      this.events.push({ type: 'BLOCK_DECLARED', blockerCardId, isBlocked: true });
    } else {
      this.events.push({ type: 'BLOCK_DECLARED', isBlocked: false });
    }

    // 7.3.1.d 检查时机，随后进入充能步骤 (由 advance() 推进)
    this.checkTimingMgr.resolveCheckTiming();
    this.enterChargeStep();
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
    const canBlock = this.fieldMgr
      .getSlots(this.state.nonActivePlayerId)
      .some((s) => s.roleCardId && this.state.cards[s.roleCardId]?.isReady);
    if (!canBlock) {
      this.declareBlock(this.state.nonActivePlayerId, undefined);
    }
  }

  /**
   * 4.12.2.c 攻击角色的充能数：基本充能数为 1，【充能X】改变基本充能数 (10.3)
   */
  calculateRoleChargeCount(attackerCardId: string): number {
    const card = this.state.cards[attackerCardId];
    if (!card) return 0;
    const inherent = parseInherentChargeCount(parseInherentKeywords(this.getDef(card)?.rulesText));
    // 10.4【充能+X】在当前充能数的基础上增加
    const bonus = (card.modifiers ?? []).reduce((sum, m) => sum + (m.charge ?? 0), 0);
    return Math.max(0, (inherent ?? 1) + bonus);
  }

  private enterChargeStep(): void {
    const combat = this.state.currentCombat;
    if (!combat) return;
    this.state.phase = 'COMBAT_CHARGE';
    combat.step = 'CHARGE';
    combat.chargeIndex = 0;
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
        this.endCombat();
        return true;
    }
  }

  /**
   * 7.4.1.b 依次执行攻击充能；每张翻开的牌在其能力处理完毕 (含玩家选择) 后才放置
   */
  private advanceChargeStep(): boolean {
    const combat = this.state.currentCombat!;
    if (combat.pendingChargeCardId) {
      this.zoneMgr.completeAttackCharge(combat.attackerCardId, combat.pendingChargeCardId, combat.chargeIndex ?? 1);
      combat.pendingChargeCardId = undefined;
      return true;
    }

    if ((combat.chargesRemaining ?? 0) > 0) {
      combat.chargesRemaining = (combat.chargesRemaining ?? 0) - 1;
      combat.chargeIndex = (combat.chargeIndex ?? 0) + 1;
      const cardId = this.zoneMgr.revealTopForCharge(this.state.activePlayerId);
      if (cardId) {
        combat.pendingChargeCardId = cardId;
      } else {
        combat.chargesRemaining = 0;
      }
      return true;
    }

    // 7.4.1.c 检查时机后：对象为对方玩家且未被阻挡 → 伤害步骤；否则 → 角色战斗步骤
    this.checkTimingMgr.resolveCheckTiming();
    if (combat.targetType === 'PLAYER' && !combat.blockerCardId) {
      this.state.phase = 'COMBAT_DAMAGE';
      combat.step = 'DAMAGE';
      // 7.5.1.b 攻击角色仍在战场时，以此时的 DP 决定伤害量 (7.5.1.b.3 之后不再变化)
      const attackerOnField = this.fieldMgr.isSlotRole(this.state.activePlayerId, combat.attackerCardId);
      combat.damageRemaining = attackerOnField
        ? Math.max(0, this.fieldMgr.calculateRoleEffectiveDP(combat.attackerCardId))
        : 0;
    } else {
      this.state.phase = 'COMBAT_BATTLE';
      combat.step = 'BATTLE';
    }
    return true;
  }

  /**
   * 7.5 伤害步骤：依次执行伤害充能，每次完毕侵蚀计数 +1 并进入检查时机 (4.12.3.b)
   */
  private advanceDamageStep(): boolean {
    const combat = this.state.currentCombat!;
    const defenderId = this.state.nonActivePlayerId;

    if (combat.pendingDamageCardId !== undefined) {
      const cardId = combat.pendingDamageCardId || undefined;
      combat.pendingDamageCardId = undefined;
      this.zoneMgr.completeDamageCharge(defenderId, cardId);
      this.checkTimingMgr.resolveCheckTiming();
      return true;
    }

    if ((combat.damageRemaining ?? 0) > 0) {
      combat.damageRemaining = (combat.damageRemaining ?? 0) - 1;
      // 翻不出牌 (牌组与墓地都为空，已败北) 时也记录空字符串，以便执行侵蚀 +1
      combat.pendingDamageCardId = this.zoneMgr.revealTopForCharge(defenderId) ?? '';
      return true;
    }

    // 7.5.1.c 检查时机后进入「攻击结束时」
    this.checkTimingMgr.resolveCheckTiming();
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
        destroyedDefenderCardId = defenderCardId;
        this.zoneMgr.moveCard(defenderCardId, 'GRAVEYARD', { isFaceUp: true });
        this.events.push({ type: 'CARD_DESTROYED', cardInstanceId: defenderCardId, reason: 'BATTLE' });

        // 10.7 贯通：战斗破坏被攻击的角色时，给予对方玩家 1 点伤害 (多个贯通也只触发 1 次)
        if (this.hasKeyword(combat.attackerCardId, '贯通')) {
          this.zoneMgr.applyDamageToPlayer(this.state.nonActivePlayerId, RULE_CONSTANTS.PIERCING_DAMAGE_VALUE);
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

    // 7.6.1.d 检查时机
    this.checkTimingMgr.resolveCheckTiming();
    combat.step = 'END';
  }

  /**
   * 结束当前攻击流程，返回主要阶段 (7.5.1.d / 7.6.1.f「攻击结束时」)
   */
  private endCombat(): void {
    const combat = this.state.currentCombat;
    this.state.currentCombat = undefined;
    this.state.phase = 'MAIN_PHASE';
    this.state.priorityPlayerId = this.state.activePlayerId;

    // 10.16 同命：持有者的攻击结束时，可以将该角色破坏；若如此做，破坏与其发生战斗的角色
    if (
      combat &&
      this.fieldMgr.isSlotRole(this.state.activePlayerId, combat.attackerCardId) &&
      this.hasKeyword(combat.attackerCardId, '同命')
    ) {
      const battled = combat.battledCardId ? this.state.cards[combat.battledCardId] : undefined;
      const battledName = battled ? this.getDef(battled)?.name ?? battled.cardNumber : undefined;
      enqueuePendingChoice(this.state, {
        id: `choice-mutual-destiny-${combat.attackerCardId}-${this.events.length}`,
        playerId: this.state.activePlayerId,
        choiceType: 'SELECT_OPTION',
        prompt: battledName
          ? `【同命】攻击结束：是否将该角色破坏，并破坏与其发生战斗的【${battledName}】？`
          : '【同命】攻击结束：是否将该角色破坏？(本次攻击没有与其发生战斗的角色)',
        options: [
          { id: 'opt_yes', label: '发动【同命】' },
          { id: 'opt_no', label: '不发动' },
        ],
        effectType: 'MUTUAL_DESTINY',
        sourceCardInstanceId: combat.attackerCardId,
        metadata: { attackerCardId: combat.attackerCardId, battledCardId: combat.battledCardId },
        minSelections: 1,
        maxSelections: 1,
      });
    }

    // 7.5.1.d / 7.6.1.f「攻击结束时」的检查时机
    this.checkTimingMgr.resolveCheckTiming();
  }
}
