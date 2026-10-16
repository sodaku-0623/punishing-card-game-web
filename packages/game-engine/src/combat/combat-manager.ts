import { GameState, GameEvent, CardInstance } from '@zhanshuang/shared';
import { RULE_CONSTANTS } from '@zhanshuang/game-rules';
import { ZoneManager } from '../zone/zone-manager.js';
import { BattlefieldManager } from '../zone/battlefield-manager.js';
import { ICardDatabase } from '../database/card-registry.js';
import { CheckTimingManager } from '../priority/check-timing.js';
import { parseInherentChargeCount, parseInherentKeywords } from '../rules/keywords.js';
import { enqueuePendingChoice } from '../state/pending-choice.js';

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

    // 7.2.1.d 进入检查时机，随后进入自由时点步骤 (7.3)
    this.checkTimingMgr.resolveCheckTiming();
    this.state.phase = 'COMBAT_FREE_TIMING';
    this.state.priorityPlayerId = opponentPlayerId; // 7.3.1.b 由回合外玩家开始

    return { success: true };
  }

  /**
   * 7.3.1.c 阻挡宣言 (Block Declaration)
   */
  declareBlock(defenderPlayerId: string, blockerCardId?: string): { success: boolean; error?: string } {
    if (this.state.phase !== 'COMBAT_FREE_TIMING') {
      return { success: false, error: '当前不在自由时点步骤' };
    }
    if (this.state.nonActivePlayerId !== defenderPlayerId) {
      return { success: false, error: '只有被攻击的玩家可以宣告阻挡' };
    }
    if (!this.state.currentCombat) {
      return { success: false, error: '当前没有进行中的战斗' };
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
      this.state.currentCombat.blockerCardId = blockerCardId;

      this.events.push({
        type: 'BLOCK_DECLARED',
        blockerCardId,
        isBlocked: true,
      });
    } else {
      this.events.push({
        type: 'BLOCK_DECLARED',
        isBlocked: false,
      });
    }

    // 7.3.1.d 检查时机，进入充能步骤 (7.4)
    this.checkTimingMgr.resolveCheckTiming();
    this.advanceToChargeStep();

    return { success: true };
  }

  /**
   * 4.12.2.c 攻击角色的充能数：基本充能数为 1，【充能X】改变基本充能数 (10.3)
   */
  calculateRoleChargeCount(attackerCardId: string): number {
    const card = this.state.cards[attackerCardId];
    if (!card) return 0;
    const inherent = parseInherentChargeCount(parseInherentKeywords(this.getDef(card)?.rulesText));
    return inherent ?? 1;
  }

  /**
   * 推进至 7.4 充能步骤并自动执行结算
   */
  private advanceToChargeStep(): void {
    const combat = this.state.currentCombat;
    if (!combat) return;

    this.state.phase = 'COMBAT_CHARGE';
    // 7.4.1.b 充能次数在此时决定，之后攻击角色离场也照常执行 (Q&A 第6期)
    const chargeCount = this.calculateRoleChargeCount(combat.attackerCardId);
    if (chargeCount > 0) {
      this.zoneMgr.performAttackCharge(combat.attackerCardId, chargeCount);
    }

    this.checkTimingMgr.resolveCheckTiming();

    // 7.4.1.c 对象为对方玩家且未被阻挡 → 伤害步骤；否则 → 角色战斗步骤
    if (combat.targetType === 'PLAYER' && !combat.blockerCardId) {
      this.resolveDamageStep();
    } else {
      this.resolveCharacterBattleStep();
    }
  }

  /**
   * 7.5 伤害步骤 (Damage Step)
   */
  private resolveDamageStep(): void {
    const combat = this.state.currentCombat;
    if (!combat) return;

    this.state.phase = 'COMBAT_DAMAGE';

    // 7.5.1.b 攻击角色仍在战场时，按其此时的 DP 造成伤害 (7.5.1.b.3 伤害量在此锁定)
    if (this.fieldMgr.isSlotRole(this.state.activePlayerId, combat.attackerCardId)) {
      const dp = this.fieldMgr.calculateRoleEffectiveDP(combat.attackerCardId);
      if (dp > 0) {
        this.zoneMgr.applyDamageToPlayer(this.state.nonActivePlayerId, dp);
      }
    }

    this.checkTimingMgr.resolveCheckTiming();
    this.endCombat();
  }

  /**
   * 7.6 角色战斗步骤 (Character Battle Step)
   */
  private resolveCharacterBattleStep(): void {
    const combat = this.state.currentCombat;
    if (!combat) return;

    this.state.phase = 'COMBAT_BATTLE';
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
        this.events.push({
          type: 'CARD_DESTROYED',
          cardInstanceId: defenderCardId,
          reason: 'BATTLE',
        });

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

    this.checkTimingMgr.resolveCheckTiming();
    this.endCombat();
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
  }
}
