import { CardVersionData, GameAction, PendingChoice } from '@zhanshuang/shared';
import type { CardEffectContext, CardEffectEngine } from './card-effects.js';
import type { ContinuousEffectEngine } from './continuous-effects.js';
import type { ReplacementEngine } from './replacement-engine.js';
import type { TriggerManager } from '../priority/trigger-system.js';
import { DeclarativeEffectInterpreter, STARTER_DECK_SPEC_MAP } from './dsl/index.js';
import { nextChoiceId } from '../state/pending-choice.js';

type Result = { success: boolean; error?: string };
type ChoiceAction = Extract<GameAction, { type: 'SELECT_CHOICE_OPTION' }>;

/**
 * 官方预组 ST01~ST06 全部 83 张卡牌的效果入口。
 *
 * 现已全部迁移为经类型与运行时结构校验的声明式描述 (effects/dsl/specs/starter-decks.ts)，
 * 由 DeclarativeEffectInterpreter 统一解释执行，所有暂停状态均以纯 JSON 帧存于 PendingChoice.metadata 中，
 * 支持 Durable Object 快照持久化与完整恢复。
 *
 * 信号球牌的【充能自】与其他卡包通用，由 CardEffectEngine.handleChargeAutoEffect 处理。
 */
export class PresetCardEffects {
  readonly interpreter: DeclarativeEffectInterpreter;

  constructor(
    private ctx: CardEffectContext,
    effects: CardEffectEngine
  ) {
    this.interpreter = new DeclarativeEffectInterpreter(ctx, effects, STARTER_DECK_SPEC_MAP);
  }

  handlesTactics(cardNumber: string): boolean {
    return this.interpreter.handlesTactics(cardNumber);
  }

  handlesEntry(cardNumber: string): boolean {
    return this.interpreter.handlesEntry(cardNumber);
  }

  handlesActivation(cardNumber: string): boolean {
    return this.interpreter.handlesActivation(cardNumber);
  }

  handlesActivationForCard(playerId: string, cardId: string, def: CardVersionData): boolean {
    return this.interpreter.handlesActivationForCard(playerId, cardId, def);
  }

  isCardInUsableZoneForActivation(playerId: string, cardId: string, def: CardVersionData): boolean {
    return this.interpreter.isCardInUsableZoneForActivation(playerId, cardId, def);
  }

  getSpec(cardNumber: string) {
    return this.interpreter.getSpec(cardNumber);
  }

  isVanillaEntry(cardNumber: string): boolean {
    return this.interpreter.isVanillaEntry(cardNumber);
  }

  handlesChoice(choice: PendingChoice): boolean {
    return this.interpreter.handlesChoice(choice);
  }

  calculateHandCostDiscount(playerId: string, cardNumber: string): number {
    return this.interpreter.calculateHandCostDiscount(playerId, cardNumber);
  }

  canIgnoreAttributeCondition(playerId: string, cardNumber: string): boolean {
    return this.interpreter.canIgnoreAttributeCondition(playerId, cardNumber);
  }

  canPlayerIgnoreAttributeForPlay(
    playerId: string,
    cardInstanceId: string,
    cardDef: CardVersionData,
    isAscension: boolean
  ): boolean {
    return this.interpreter.canPlayerIgnoreAttributeForPlay(playerId, cardInstanceId, cardDef, isAscension);
  }

  calculateFieldHandCostAdjustment(
    playerId: string,
    cardDef: CardVersionData,
    isAscension: boolean
  ): { setCost?: number; discount: number } {
    return this.interpreter.calculateFieldHandCostAdjustment(playerId, cardDef, isAscension);
  }

  playTactics(playerId: string, cardId: string, def: CardVersionData): Result {
    return this.interpreter.playTactics(playerId, cardId, def);
  }

  enter(playerId: string, roleId: string, def: CardVersionData): void {
    this.interpreter.enter(playerId, roleId, def);
  }

  activate(
    playerId: string,
    cardId: string,
    def: CardVersionData,
    abilityIndex?: number,
    costCardInstanceIds?: string[]
  ): Result {
    return this.interpreter.activate(playerId, cardId, def, abilityIndex, costCardInstanceIds);
  }

  resolveChoice(action: ChoiceAction, choice: PendingChoice): Result {
    return this.interpreter.resolveChoice(action, choice);
  }

  /**
   * 8.9 向持续效果引擎注册所有声明式【永】静态规则
   */
  registerStaticEffects(continuousEffects: ContinuousEffectEngine): void {
    this.interpreter.registerStaticEffects(continuousEffects);
  }

  /**
   * 8.10 向置换引擎注册所有声明式置换规则
   */
  registerReplacements(replacementEngine: ReplacementEngine): void {
    (this.interpreter as { registerReplacements?: (engine: ReplacementEngine) => void }).registerReplacements?.(
      replacementEngine
    );
  }

  /**
   * 8.5 / 8.7 向统一自动能力触发管理器注册所有声明式【自】触发，以及通用关键字 10.16【同命】
   */
  registerTriggers(triggerMgr: TriggerManager): void {
    this.interpreter.registerTriggers(triggerMgr);

    // 10.16 同命：持有者的攻击结束时，可以将该角色破坏；若如此做，破坏与其发生战斗的角色
    triggerMgr.registerTrigger({
      abilityId: 'KEYWORD_MUTUAL_DESTINY_ON_ATTACK_END',
      eventTypes: ['ATTACK_ENDED'],
      collect: ({ state, event, fieldMgr, continuousEffects, cardDb }) => {
        const attackerId = event.cardInstanceId;
        const playerId = event.playerId;
        if (!attackerId || !playerId) return [];
        if (!fieldMgr.isSlotRole(playerId, attackerId)) return [];
        if (!continuousEffects.hasKeyword(attackerId, '同命')) return [];
        const attacker = state.cards[attackerId]!;
        const attackerDef = cardDb.getCard(attacker.cardNumber);
        return [
          {
            sourceCardInstanceId: attackerId,
            sourceCardNumber: attacker.cardNumber,
            controllerPlayerId: playerId,
            label: `【${attackerDef?.name ?? attacker.cardNumber}】【同命】攻击结束时可破坏自身与交战角色`,
            triggerContext: {
              attackerCardId: attackerId,
              battledCardId: event.battledCardId,
            },
          },
        ];
      },
      execute: (trigger, ctx) => {
        const attackerId = trigger.sourceCardInstanceId;
        const playerId = trigger.controllerPlayerId;
        if (!ctx.fieldMgr.isSlotRole(playerId, attackerId)) return;
        const battledId = trigger.triggerContext.battledCardId as string | undefined;
        const battled = battledId ? ctx.state.cards[battledId] : undefined;
        const battledName = battled ? ctx.cardDb.getCard(battled.cardNumber)?.name ?? battled.cardNumber : undefined;
        ctx.enqueueChoice({
          id: nextChoiceId(ctx.state, 'mutual-destiny'),
          playerId,
          choiceType: 'SELECT_OPTION',
          prompt: battledName
            ? `【同命】攻击结束：是否将该角色破坏，并破坏与其发生战斗的【${battledName}】？`
            : '【同命】攻击结束：是否将该角色破坏？(本次攻击没有与其发生战斗的角色)',
          options: [
            { id: 'opt_yes', label: '发动【同命】' },
            { id: 'opt_no', label: '不发动' },
          ],
          effectType: 'MUTUAL_DESTINY',
          sourceCardInstanceId: attackerId,
          metadata: { attackerCardId: attackerId, battledCardId: battledId },
          minSelections: 1,
          maxSelections: 1,
        });
      },
    });
  }

  /**
   * 8.9 永久能力带来的 PP 增减 (由 ContinuousEffectEngine 统一分层计算，保留此方法兼容直接查询)
   */
  staticPP(cardId: string): number {
    if (this.ctx.continuousEffects) {
      const card = this.ctx.state.cards[cardId];
      if (!card) return 0;
      const base = this.ctx.cardDb.getCard(card.cardNumber)?.basePP ?? 0;
      return this.ctx.continuousEffects.evaluateCard(cardId).pp - base;
    }
    return 0;
  }

  /** 兼容旧调用入口：转发至统一触发管理器 */
  onAttackDeclared(attackerId: string): void {
    const attacker = this.ctx.state.cards[attackerId];
    if (!attacker) return;
    this.ctx.triggerMgr?.emit({
      type: 'ATTACK_DECLARED',
      playerId: attacker.controllerPlayerId,
      cardInstanceId: attackerId,
      subjectSnapshot: this.ctx.triggerMgr.snapshotCard(attackerId),
    });
  }

  /** 兼容旧调用入口：转发至统一触发管理器 */
  onRoleEntered(playerId: string, enteredId: string): void {
    this.ctx.triggerMgr?.emit({
      type: 'CARD_ENTERED_FIELD',
      playerId,
      cardInstanceId: enteredId,
      toZone: 'BATTLEFIELD',
      subjectSnapshot: this.ctx.triggerMgr.snapshotCard(enteredId),
    });
  }
}
