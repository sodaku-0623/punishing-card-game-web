import { GameState, GameEvent } from '@zhanshuang/shared';
import { RULE_CONSTANTS } from '@zhanshuang/game-rules';
import { ZoneManager } from '../zone/zone-manager.js';
import { BattlefieldManager } from '../zone/battlefield-manager.js';
import { ICardDatabase } from '../database/card-registry.js';
import { CheckTimingManager } from '../priority/check-timing.js';

function hasInherentKeyword(rulesText: string | undefined, keyword: string): boolean {
  if (!rulesText) return false;
  const cleaned = rulesText.replace(new RegExp(`获得【${keyword}】`, 'g'), '').replace(/升变代价[^\n]+/g, '');
  return cleaned.includes(`【${keyword}】`) || cleaned.includes(`【永】：【${keyword}】`) || cleaned.includes(`持有【${keyword}】`);
}

export class CombatManager {
  constructor(
    private state: GameState,
    private zoneMgr: ZoneManager,
    private fieldMgr: BattlefieldManager,
    private cardDb: ICardDatabase,
    private checkTimingMgr: CheckTimingManager,
    private events: GameEvent[]
  ) {}

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

    const attacker = this.state.cards[attackerCardId];
    if (!attacker || attacker.controllerPlayerId !== playerId || attacker.zone !== 'BATTLEFIELD') {
      return { success: false, error: '攻击角色不存在或不属于己方战场' };
    }

    // 7.2.1.a.1 竖直状态的角色可以进行攻击
    if (!attacker.isReady) {
      return { success: false, error: '只有竖直状态的角色可以进行攻击' };
    }

    // 7.2.1.b.1 出场回合不可攻击 (除非速攻/突进)
    const isEnterTurn = attacker.turnEnteredZone === this.state.turnNumber;
    const cardDef = (attacker.cardId ? this.cardDb.getCard(attacker.cardId) : undefined) || this.cardDb.getCard(attacker.cardNumber);
    const hasRush = attacker.grantedKeywords?.includes('速攻') || hasInherentKeyword(cardDef?.rulesText, '速攻');
    const hasAssault = attacker.grantedKeywords?.includes('突进') || hasInherentKeyword(cardDef?.rulesText, '突进');

    if (isEnterTurn && !hasRush && !hasAssault) {
      return { success: false, error: '角色在其出场的回合不可以进行攻击 (7.2.1.b.1)' };
    }

    // 10.6 突进在出场的合只能攻击角色
    if (isEnterTurn && !hasRush && hasAssault && targetType === 'PLAYER') {
      return { success: false, error: '【突进】在出场回合只能选择对方角色作为攻击对象 (10.6.1.a)' };
    }

    // 7.2.1.b.1 攻击对象检验
    const opponentPlayerId = this.state.nonActivePlayerId;
    if (targetType === 'CHARACTER') {
      if (!targetCardId) {
        return { success: false, error: '未指定目标角色' };
      }
      const targetCard = this.state.cards[targetCardId];
      if (!targetCard || targetCard.controllerPlayerId !== opponentPlayerId || targetCard.zone !== 'BATTLEFIELD') {
        return { success: false, error: '目标角色不存在或不属于对手战场' };
      }
      // 7.2.1.b.1 对方战场的横置状态的角色
      if (targetCard.isReady) {
        return { success: false, error: '只能选择对方战场的横置状态的角色作为攻击对象 (7.2.1.b.1)' };
      }
    }

    // 7.2.1.b 将自身选择的攻击角色横置
    attacker.isReady = false;

    // 检查攻击宣言触发能力 (如 BP01-006 卡列尼娜·爆裂: 信号球区>=2红球时本回合DP+1)
    const attackerDef =
      this.cardDb.getCard(attacker.cardNumber) ||
      (attacker.cardId ? this.cardDb.getCard(attacker.cardId) : undefined);
    if (
      attackerDef &&
      attackerDef.rulesText.includes('攻击宣言时') &&
      attackerDef.rulesText.includes('<信号球·红>')
    ) {
      const redOrbs = this.zoneMgr
        .getCardsInZone(attacker.controllerPlayerId, 'SIGNAL_ORB')
        .filter((c) => {
          const def =
            (c.cardId ? this.cardDb.getCard(c.cardId) : undefined) ||
            this.cardDb.getCard(c.cardNumber);
          return (
            def?.signalOrb === 'RED' ||
            c.cardNumber.includes('ORB-RED') ||
            c.cardNumber.endsWith('-RED') ||
            def?.traits?.some((t) => t === '信号球·红' || t.includes('球·红')) ||
            def?.name?.includes('信号球·红') ||
            def?.name?.includes('红球')
          );
        });
      if (redOrbs.length >= 2) {
        attacker.tempDPBonus = (attacker.tempDPBonus || 0) + 1;
        this.events.push({
          type: 'ABILITY_ACTIVATED',
          playerId: attacker.controllerPlayerId,
          cardInstanceId: attackerCardId,
          abilityName: `${attackerDef.name}【自】动能力`,
          rulesText: '攻击宣言时信号球区存在2张以上<信号球·红>，本回合DP+1。',
        });
      }
    }

    this.state.currentCombat = {
      attackerCardId,
      targetType,
      targetCardId,
      freeTimingPassCount: 0,
    };

    this.events.push({
      type: 'ATTACK_DECLARED',
      attackerCardId,
      targetType,
      targetCardId,
    });

    // 7.2.1.d 进入检查时机，随后进入自由时点步骤 (7.3)
    this.checkTimingMgr.resolveCheckTiming();
    this.state.phase = 'COMBAT_FREE_TIMING';
    this.state.priorityPlayerId = opponentPlayerId; // 7.3.1.b 由回合外玩家开始优先使用瞬时

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
      if (!blocker || blocker.controllerPlayerId !== defenderPlayerId || blocker.zone !== 'BATTLEFIELD') {
        return { success: false, error: '阻挡角色不存在或不在己方战场' };
      }
      // 7.3.1.c.1 竖直状态的角色可以进行阻挡
      if (!blocker.isReady) {
        return { success: false, error: '只有竖直状态的角色可以进行阻挡' };
      }

      // 横置阻挡角色
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
   * 计算角色攻击充能次数
   * - 所有角色卡牌默认充能次数为 1 (7.4)
   * - 记述有【充能0】或<充能0>的卡牌充能次数为 0
   * - 有效果记述为其他数值的为记述数值 (如【充能2】)
   */
  calculateRoleChargeCount(attackerCardId: string): number {
    const card = this.state.cards[attackerCardId];
    if (!card) return 0;
    const cardDef = (card.cardId ? this.cardDb.getCard(card.cardId) : undefined) || this.cardDb.getCard(card.cardNumber);
    const rulesText = cardDef?.rulesText || '';

    const match = rulesText.match(/[【<]充能(\d+)[】>]/);
    if (match && match[1] !== undefined) {
      return parseInt(match[1], 10);
    }
    return 1;
  }

  /**
   * 推进至 7.4 充能步骤并自动执行结算
   */
  private advanceToChargeStep(): void {
    const combat = this.state.currentCombat;
    if (!combat) return;

    this.state.phase = 'COMBAT_CHARGE';
    const attackerCard = this.state.cards[combat.attackerCardId];
    if (attackerCard) {
      // 7.4.1.b 执行攻击充能
      const chargeCount = this.calculateRoleChargeCount(combat.attackerCardId);
      if (chargeCount > 0) {
        this.zoneMgr.performAttackCharge(combat.attackerCardId, chargeCount);
      }
    }

    this.checkTimingMgr.resolveCheckTiming();

    // 7.4.1.c 判断后续步骤分支
    if (combat.targetType === 'PLAYER' && !combat.blockerCardId) {
      // 7.5 进入伤害步骤
      this.resolveDamageStep();
    } else {
      // 7.6 进入角色战斗步骤
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
    const attacker = this.state.cards[combat.attackerCardId];

    // 7.5.1.b 若存在攻击角色，根据 DP 对对方玩家造成等量伤害
    if (attacker && attacker.zone === 'BATTLEFIELD') {
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
    const attacker = this.state.cards[combat.attackerCardId];
    const defenderCardId = combat.blockerCardId ?? combat.targetCardId;

    if (!defenderCardId) {
      this.endCombat();
      return;
    }

    const defender = this.state.cards[defenderCardId];

    // 7.6.1.b 比较双方角色的 PP 数值
    if (attacker && defender && attacker.zone === 'BATTLEFIELD' && defender.zone === 'BATTLEFIELD') {
      const attackerPP = this.fieldMgr.calculateRoleEffectivePP(combat.attackerCardId);
      const defenderPP = this.fieldMgr.calculateRoleEffectivePP(defenderCardId);

      let destroyedDefenderCardId: string | undefined = undefined;

      const attackerDef = (attacker.cardId ? this.cardDb.getCard(attacker.cardId) : undefined) || this.cardDb.getCard(attacker.cardNumber);
      const defenderDef = (defender.cardId ? this.cardDb.getCard(defender.cardId) : undefined) || this.cardDb.getCard(defender.cardNumber);

      const attackerHasMutualDestiny = attacker.grantedKeywords?.includes('同命') || attackerDef?.rulesText.includes('同命');
      const defenderHasMutualDestiny = defender.grantedKeywords?.includes('同命') || defenderDef?.rulesText.includes('同命');

      // 7.6.1.b 核心规则：若攻击角色的PP >= 被攻击角色PP，被攻击角色被破坏，否则无事发生！
      if (attackerPP >= defenderPP) {
        destroyedDefenderCardId = defenderCardId;
        this.fieldMgr.handleCardLeaveField(defenderCardId);
        this.zoneMgr.moveCard(defenderCardId, 'GRAVEYARD', { isFaceUp: true });
        this.events.push({
          type: 'CARD_DESTROYED',
          cardInstanceId: defenderCardId,
          reason: 'BATTLE',
        });

        // 10.7 贯通：若战斗破坏被攻击角色，给予对方玩家1点伤害
        const hasPiercing =
          attackerDef?.rulesText.includes('贯通') || attacker.grantedKeywords?.includes('贯通');
        if (hasPiercing) {
          this.zoneMgr.applyDamageToPlayer(
            this.state.nonActivePlayerId,
            RULE_CONSTANTS.PIERCING_DAMAGE_VALUE
          );
        }

        // 被攻击角色持有【同命】：带走攻击角色
        if (defenderHasMutualDestiny && attacker.zone === 'BATTLEFIELD') {
          this.fieldMgr.handleCardLeaveField(combat.attackerCardId);
          this.zoneMgr.moveCard(combat.attackerCardId, 'GRAVEYARD', { isFaceUp: true });
          this.events.push({
            type: 'CARD_DESTROYED',
            cardInstanceId: combat.attackerCardId,
            reason: 'EFFECT',
          });
        }
      } else {
        // 攻击角色持有【同命】：攻击结束时将双方角色破坏
        if (attackerHasMutualDestiny) {
          if (defender.zone === 'BATTLEFIELD') {
            destroyedDefenderCardId = defenderCardId;
            this.fieldMgr.handleCardLeaveField(defenderCardId);
            this.zoneMgr.moveCard(defenderCardId, 'GRAVEYARD', { isFaceUp: true });
            this.events.push({
              type: 'CARD_DESTROYED',
              cardInstanceId: defenderCardId,
              reason: 'EFFECT',
            });
          }
          if (attacker.zone === 'BATTLEFIELD') {
            this.fieldMgr.handleCardLeaveField(combat.attackerCardId);
            this.zoneMgr.moveCard(combat.attackerCardId, 'GRAVEYARD', { isFaceUp: true });
            this.events.push({
              type: 'CARD_DESTROYED',
              cardInstanceId: combat.attackerCardId,
              reason: 'EFFECT',
            });
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

    this.checkTimingMgr.resolveCheckTiming();
    this.endCombat();
  }

  /**
   * 结束当前攻击流程，返回主要阶段 (7.5.1.d / 7.6.1.f)
   */
  private endCombat(): void {
    this.state.currentCombat = undefined;
    this.state.phase = 'MAIN_PHASE';
    this.state.priorityPlayerId = this.state.activePlayerId;
  }
}
