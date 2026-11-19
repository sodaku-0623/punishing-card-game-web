import {
  CardInstance,
  CardModifier,
  CardVersionData,
  GameAction,
  PendingChoice,
  ZoneId,
} from '@zhanshuang/shared';
import type { CardEffectContext, CardEffectEngine } from '../card-effects.js';
import { addCardModifier, ContinuousEffectEngine } from '../continuous-effects.js';
import type { TriggerManager } from '../../priority/trigger-system.js';
import type {
  AbilityCost,
  CardEffectSpec,
  CardFilter,
  CardTargetRef,
  CompareOp,
  ConditionExpr,
  EffectStep,
  ModifierDuration,
  NumberExpr,
  OrbColorFilter,
  PlayerSide,
} from './types.js';

type Result = { success: boolean; error?: string };
type ChoiceAction = Extract<GameAction, { type: 'SELECT_CHOICE_OPTION' }>;

type PendingDslAction =
  | { kind: 'COST_DISCARD'; onPaid: EffectStep[]; optional: boolean; markUsed?: boolean }
  | { kind: 'COST_ORB'; onPaid: EffectStep[]; optional: boolean; markUsed?: boolean }
  | { kind: 'COST_ORB_OR_DISCARD'; onPaid: EffectStep[]; optional: boolean; markUsed?: boolean }
  | { kind: 'CONFIRM_YES_NO'; onYes: EffectStep[]; onNo?: EffectStep[] }
  | { kind: 'SAVE_CHOICE'; saveToVar: string; distinctTraits?: string[]; distinctTraitsError?: string }
  | { kind: 'REORDER_ZONE'; zone: 'SIGNAL_ORB' };

/**
 * 声明式效果执行帧：纯 JSON 可序列化，存放于 PendingChoice.metadata.__dsl，
 * 以便 Durable Object 快照持久化后从任意暂停点精确恢复。
 */
interface DslExecutionFrame {
  cardNumber: string;
  sourceCardInstanceId: string;
  playerId: string;
  vars: Record<string, string[]>;
  remainingSteps: EffectStep[];
  pendingAction: PendingDslAction;
}

/**
 * 声明式卡牌效果解释器 (docs/future-work.md §3)。
 *
 * 负责解释执行经 validateCardEffectRegistry 校验后的 CardEffectSpec：
 * 战术牌、登场能力【出】、起动能力【起】、自动能力【自】、静态持续能力【永】与手牌静态减费。
 */
export class DeclarativeEffectInterpreter {
  private choiceSeq = 0;

  constructor(
    private ctx: CardEffectContext,
    private effects: CardEffectEngine,
    private registry: ReadonlyMap<string, CardEffectSpec>
  ) {}

  getSpec(cardNumber: string): CardEffectSpec | undefined {
    return this.registry.get(cardNumber);
  }

  handlesTactics(cardNumber: string): boolean {
    return Boolean(this.registry.get(cardNumber)?.tactics);
  }

  handlesEntry(cardNumber: string): boolean {
    return Boolean(this.registry.get(cardNumber)?.entry);
  }

  handlesActivation(cardNumber: string): boolean {
    return Boolean(this.registry.get(cardNumber)?.activate);
  }

  isVanillaEntry(cardNumber: string): boolean {
    return Boolean(this.registry.get(cardNumber)?.vanillaEntry);
  }

  /** 是否为由声明式解释器挂起的决策 */
  handlesChoice(choice: PendingChoice): boolean {
    return Boolean((choice.metadata as { __dsl?: unknown } | undefined)?.__dsl);
  }

  /**
   * 8.6.2.c 计算声明式手牌静态费用减免 (如 ST03-011 三头犬出击)
   */
  calculateHandCostDiscount(playerId: string, cardNumber: string): number {
    const spec = this.registry.get(cardNumber);
    if (!spec?.handCostDiscount) return 0;
    const matched = this.roles(playerId).filter((r) => this.matchesFilter(r, spec.handCostDiscount!.filter));
    return matched.length * spec.handCostDiscount.discountPerRole;
  }

  /**
   * 执行声明式战术牌效果
   */
  playTactics(playerId: string, cardId: string, def: CardVersionData): Result {
    const spec = this.registry.get(def.cardNumber);
    if (!spec?.tactics) return { success: false, error: '未注册该战术牌的声明式效果' };

    if (spec.playPrecondition) {
      if (!this.evalCondition(spec.playPrecondition.condition, playerId, cardId, {})) {
        return { success: false, error: spec.playPrecondition.errorMessage };
      }
    }

    this.runSteps(def.cardNumber, cardId, playerId, {}, [...spec.tactics]);
    return { success: true };
  }

  /**
   * 执行声明式【出】登场能力
   */
  enter(playerId: string, roleId: string, def: CardVersionData): void {
    const spec = this.registry.get(def.cardNumber);
    if (!spec?.entry) return;

    this.executeWithCost(
      def.cardNumber,
      roleId,
      playerId,
      spec.entry.cost,
      spec.entry.steps,
      false
    );
  }

  /**
   * 执行声明式【起】起动能力
   */
  activate(playerId: string, cardId: string, def: CardVersionData): Result {
    const spec = this.registry.get(def.cardNumber);
    if (!spec?.activate) return { success: false, error: '未注册该起动能力的声明式效果' };

    const player = this.ctx.state.players[playerId]!;
    if (spec.activate.oncePerTurn && (player.turnAbilityUsage[cardId] ?? 0) > 0) {
      return { success: false, error: '该能力本回合已发动过 (【回合1】)' };
    }

    return this.executeWithCost(
      def.cardNumber,
      cardId,
      playerId,
      spec.activate.cost,
      spec.activate.steps,
      true
    );
  }

  /**
   * 8.5 / 8.7 向 TriggerManager 注册所有声明式【自】自动能力
   */
  registerTriggers(triggerMgr: TriggerManager): void {
    for (const spec of this.registry.values()) {
      for (const trig of spec.triggers ?? []) {
        triggerMgr.registerTrigger({
          abilityId: trig.abilityId,
          eventTypes: [trig.eventType],
          oncePerTurn: trig.oncePerTurn,
          collect: ({ state, event, cardDb, fieldMgr }) => {
            switch (trig.matcher.kind) {
              case 'EQUIPPED_ROLE_ATTACKING': {
                const attackerId = event.cardInstanceId;
                if (!attackerId) return [];
                const attacker = state.cards[attackerId];
                if (!attacker?.attachedEquipmentId) return [];
                const equip = state.cards[attacker.attachedEquipmentId];
                if (equip?.cardNumber !== spec.cardNumber) return [];
                const attackerDef = cardDb.getCard(attacker.cardNumber);
                if (trig.matcher.requiredHostName && attackerDef?.name !== trig.matcher.requiredHostName) {
                  return [];
                }
                if (
                  trig.matcher.requiredHostTrait &&
                  !this.hasTrait(attacker, trig.matcher.requiredHostTrait)
                ) {
                  return [];
                }
                return [
                  {
                    sourceCardInstanceId: attacker.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: attacker.controllerPlayerId,
                    label: trig.label,
                    triggerContext: { equipmentCardId: equip.instanceId, attackerCardId: attacker.instanceId },
                  },
                ];
              }
              case 'OTHER_FRIENDLY_ROLE_ENTERED': {
                const enteredId = event.cardInstanceId;
                const playerId = event.playerId;
                if (!enteredId || !playerId) return [];
                const enteredName =
                  event.subjectSnapshot?.name ??
                  (state.cards[enteredId] ? cardDb.getCard(state.cards[enteredId]!.cardNumber)?.name : undefined);
                if (trig.matcher.enteredName && enteredName !== trig.matcher.enteredName) return [];
                if (trig.matcher.enteredTrait) {
                  const enteredTraits =
                    event.subjectSnapshot?.traits ??
                    (state.cards[enteredId] ? cardDb.getCard(state.cards[enteredId]!.cardNumber)?.traits ?? [] : []);
                  if (!enteredTraits.includes(trig.matcher.enteredTrait)) return [];
                }

                const matches = [];
                for (const slot of fieldMgr.getSlots(playerId)) {
                  if (!slot.roleCardId || slot.roleCardId === enteredId) continue;
                  const host = state.cards[slot.roleCardId];
                  if (!host || host.cardNumber !== spec.cardNumber) continue;
                  matches.push({
                    sourceCardInstanceId: host.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: playerId,
                    label: trig.label.replace('{slot}', String((host.slotIndex ?? 0) + 1)),
                    triggerContext: { enteredCardId: enteredId },
                  });
                }
                return matches;
              }
              case 'SELF_ATTACKING': {
                const attackerId = event.cardInstanceId;
                if (!attackerId) return [];
                const attacker = state.cards[attackerId];
                if (!attacker || attacker.cardNumber !== spec.cardNumber) return [];
                return [
                  {
                    sourceCardInstanceId: attacker.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: attacker.controllerPlayerId,
                    label: trig.label,
                    triggerContext: { attackerCardId: attacker.instanceId },
                  },
                ];
              }
            }
          },
          execute: (pending) => {
            this.executeWithCost(
              spec.cardNumber,
              pending.sourceCardInstanceId,
              pending.controllerPlayerId,
              trig.cost,
              trig.steps,
              false
            );
          },
        });
      }
    }
  }

  /**
   * 8.9 向 ContinuousEffectEngine 注册所有声明式【永】持续效果 (自动分派至 Layer 1 NON_STAT / Layer 2 STAT)
   */
  registerStaticEffects(continuousEffects: ContinuousEffectEngine): void {
    for (const spec of this.registry.values()) {
      for (const eff of spec.staticEffects ?? []) {
        const hasNonStat = Boolean(eff.keywords?.length || eff.addTraits?.length);
        const hasStat = eff.pp !== undefined || eff.dp !== undefined || eff.charge !== undefined;

        const matchesTargetAndCond = (
          source: CardInstance,
          target: CardInstance,
          ctx: Parameters<Parameters<ContinuousEffectEngine['registerStaticRule']>[0]['evaluate']>[2]
        ): boolean => {
          if (eff.scope === 'SELF') {
            if (source.instanceId !== target.instanceId) return false;
            if (eff.selfFilter && !this.matchesFilterSafe(target, eff.selfFilter, ctx.hasCardTrait)) return false;
          } else {
            if (source.controllerPlayerId !== target.controllerPlayerId) return false;
            if (eff.targetFilter && !this.matchesFilterSafe(target, eff.targetFilter, ctx.hasCardTrait)) return false;
          }
          if (
            eff.condition &&
            !this.evalStaticCondition(
              eff.condition,
              source.controllerPlayerId,
              ctx.state,
              ctx.getCardsInZone,
              ctx.getFieldRoles,
              ctx.hasCardTrait
            )
          ) {
            return false;
          }
          return true;
        };

        if (hasNonStat) {
          continuousEffects.registerStaticRule({
            id: `dsl:${eff.id}:nonstat`,
            layer: 'NON_STAT',
            providesTraits: Boolean(eff.addTraits?.length),
            dependsOnTraits: eff.dependsOnTraits,
            matchSource: (src) => src.cardNumber === spec.cardNumber,
            evaluate: (source, target, ctx) => {
              if (!matchesTargetAndCond(source, target, ctx)) return undefined;
              return {
                ...(eff.keywords ? { keywords: eff.keywords } : {}),
                ...(eff.addTraits ? { addTraits: eff.addTraits } : {}),
              };
            },
          });
        }

        if (hasStat) {
          continuousEffects.registerStaticRule({
            id: `dsl:${eff.id}:stat`,
            layer: 'STAT',
            dependsOnTraits: eff.dependsOnTraits,
            matchSource: (src) => src.cardNumber === spec.cardNumber,
            evaluate: (source, target, ctx) => {
              if (!matchesTargetAndCond(source, target, ctx)) return undefined;
              const pp =
                eff.pp !== undefined ? this.evalNumberExpr(eff.pp, source.controllerPlayerId, source.instanceId) : undefined;
              const dp =
                eff.dp !== undefined ? this.evalNumberExpr(eff.dp, source.controllerPlayerId, source.instanceId) : undefined;
              const charge =
                eff.charge !== undefined
                  ? this.evalNumberExpr(eff.charge, source.controllerPlayerId, source.instanceId)
                  : undefined;
              return {
                ...(pp !== undefined ? { pp } : {}),
                ...(dp !== undefined ? { dp } : {}),
                ...(charge !== undefined ? { charge } : {}),
              };
            },
          });
        }
      }
    }
  }

  /**
   * 恢复被 PendingChoice 挂起的声明式效果执行帧
   */
  resolveChoice(action: ChoiceAction, choice: PendingChoice): Result {
    const frame = (choice.metadata as { __dsl?: DslExecutionFrame } | undefined)?.__dsl;
    if (!frame) {
      return { success: false, error: `未知的声明式决策类型 ${choice.effectType}` };
    }

    const { playerId, cardNumber, sourceCardInstanceId } = frame;
    const selected = action.selectedIds;
    const vars: Record<string, string[]> = { ...frame.vars };
    const remaining: EffectStep[] = [...frame.remainingSteps];
    const pending = frame.pendingAction;

    switch (pending.kind) {
      case 'COST_DISCARD': {
        if (selected.length === 0) {
          if (pending.optional) return { success: true };
          return { success: false, error: '必须支付丢弃手牌代价' };
        }
        for (const id of selected) {
          this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
        }
        if (pending.markUsed) this.markUsed(playerId, sourceCardInstanceId);
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, [...pending.onPaid, ...remaining]);
        return { success: true };
      }

      case 'COST_ORB': {
        const group = selected[0];
        if (!group || group === 'skip') {
          if (pending.optional) return { success: true };
          return { success: false, error: '必须支付消除信号球代价' };
        }
        this.eliminate(playerId, group.split(','));
        if (pending.markUsed) this.markUsed(playerId, sourceCardInstanceId);
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, [...pending.onPaid, ...remaining]);
        return { success: true };
      }

      case 'COST_ORB_OR_DISCARD': {
        const pick = selected[0];
        if (!pick || pick === 'skip') {
          if (pending.optional) return { success: true };
          return { success: false, error: '必须支付代价' };
        }
        const [kind, id] = pick.split(':') as [string, string];
        if (kind === 'orb') this.eliminate(playerId, [id]);
        else this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
        if (pending.markUsed) this.markUsed(playerId, sourceCardInstanceId);
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, [...pending.onPaid, ...remaining]);
        return { success: true };
      }

      case 'CONFIRM_YES_NO': {
        const branch = selected[0] === 'opt_yes' ? pending.onYes : (pending.onNo ?? []);
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, [...branch, ...remaining]);
        return { success: true };
      }

      case 'SAVE_CHOICE': {
        if (pending.distinctTraits && selected.length > 1) {
          const cards = selected.map((id) => this.ctx.state.cards[id]!).filter(Boolean);
          if (!this.canAssignDistinctTraits(cards, pending.distinctTraits)) {
            return {
              success: false,
              error:
                pending.distinctTraitsError ??
                `所选卡牌须分别对应不同特征：${pending.distinctTraits.map((t) => `<${t}>`).join('、')}`,
            };
          }
        }
        vars[pending.saveToVar] = [...selected];
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
        return { success: true };
      }

      case 'REORDER_ZONE': {
        for (const id of selected) {
          const card = this.ctx.state.cards[id];
          if (!card || card.zone !== pending.zone) continue;
          delete this.ctx.state.cards[id];
          this.ctx.state.cards[id] = card;
        }
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
        return { success: true };
      }
    }
  }

  // ===================================================================
  // 代价支付与指令主循环
  // ===================================================================

  private executeWithCost(
    cardNumber: string,
    sourceId: string,
    playerId: string,
    cost: AbilityCost | undefined,
    steps: EffectStep[],
    markUsed: boolean
  ): Result {
    if (!cost) {
      if (markUsed) this.markUsed(playerId, sourceId);
      this.runSteps(cardNumber, sourceId, playerId, {}, [...steps]);
      return { success: true };
    }

    switch (cost.kind) {
      case 'TAP_SELF': {
        const card = this.ctx.state.cards[sourceId];
        if (!card || !card.isReady) {
          return { success: false, error: '该牌已横置，无法支付「横置该牌」的代价' };
        }
        card.isReady = false;
        if (markUsed) this.markUsed(playerId, sourceId);
        this.runSteps(cardNumber, sourceId, playerId, {}, [...steps]);
        return { success: true };
      }

      case 'PAY_COST': {
        if (!this.ctx.payCost(playerId, cost.amount)) {
          return { success: false, error: `费用不足，需要支付 ${cost.amount} 费` };
        }
        if (markUsed) this.markUsed(playerId, sourceId);
        this.runSteps(cardNumber, sourceId, playerId, {}, [...steps]);
        return { success: true };
      }

      case 'DISCARD_HAND': {
        const hand = this.zone(playerId, 'HAND');
        const optional = Boolean(cost.optional);
        if (hand.length < cost.count) {
          return optional
            ? { success: true }
            : { success: false, error: `手牌不足 ${cost.count} 张，无法支付丢弃代价 (8.4.2.b)` };
        }
        const effectType = cost.choiceEffectType ?? 'PRESET_DISCARD_COST';
        const promptBase = cost.prompt ?? `请选择 ${cost.count} 张手牌丢弃作为代价`;
        this.enqueueDslChoice(
          {
            id: this.choiceId('discard-cost'),
            playerId,
            choiceType: 'SELECT_CARDS',
            prompt: optional ? `${promptBase} (不选择则不支付代价)` : promptBase,
            options: hand.map((c) => this.effects.createGeneralCardChoiceOption(c)),
            effectType,
            sourceCardInstanceId: sourceId,
            minSelections: optional ? 0 : cost.count,
            maxSelections: cost.count,
          },
          {
            cardNumber,
            sourceCardInstanceId: sourceId,
            playerId,
            vars: {},
            remainingSteps: [],
            pendingAction: { kind: 'COST_DISCARD', onPaid: [...steps], optional, markUsed },
          }
        );
        return { success: true };
      }

      case 'ELIMINATE_ORBS': {
        const groups = this.orbGroups(playerId, cost.count, cost.filter);
        const optional = Boolean(cost.optional);
        if (groups.length === 0) {
          return optional
            ? { success: true }
            : { success: false, error: '信号球区没有满足代价的相邻信号球，无法发动 (8.4.2.b)' };
        }
        if (!optional && groups.length === 1) {
          this.eliminate(playerId, groups[0]!);
          if (markUsed) this.markUsed(playerId, sourceId);
          this.runSteps(cardNumber, sourceId, playerId, {}, [...steps]);
          return { success: true };
        }
        const effectType = cost.choiceEffectType ?? 'PRESET_ORB_COST';
        const options = [
          ...(optional ? [{ id: 'skip', label: '不支付代价 (不发动)' }] : []),
          ...groups.map((g) => ({
            id: g.join(','),
            label: `消除 ${g.map((id) => this.def(this.ctx.state.cards[id]!)?.name ?? id).join('、')}`,
          })),
        ];
        this.enqueueDslChoice(
          {
            id: this.choiceId('orb-cost'),
            playerId,
            choiceType: 'SELECT_OPTION',
            prompt: cost.prompt ?? '选择要消除的信号球 (起动能力的代价)',
            options,
            effectType,
            sourceCardInstanceId: sourceId,
            minSelections: 1,
            maxSelections: 1,
          },
          {
            cardNumber,
            sourceCardInstanceId: sourceId,
            playerId,
            vars: {},
            remainingSteps: [],
            pendingAction: { kind: 'COST_ORB', onPaid: [...steps], optional, markUsed },
          }
        );
        return { success: true };
      }

      case 'ELIMINATE_ORB_OR_DISCARD_HAND': {
        const optional = cost.optional !== false;
        const orbs = this.zone(playerId, 'SIGNAL_ORB').filter((c) => this.isOrb(c));
        const hand = this.zone(playerId, 'HAND');
        const options = [
          ...(optional ? [{ id: 'skip', label: '不支付代价 (不发动)' }] : []),
          ...orbs.map((c) => ({ id: `orb:${c.instanceId}`, label: `消除信号球【${this.def(c)?.name ?? c.cardNumber}】` })),
          ...hand.map((c) => ({ id: `hand:${c.instanceId}`, label: `丢弃手牌【${this.def(c)?.name ?? c.cardNumber}】` })),
        ];
        if (options.length === (optional ? 1 : 0)) {
          return optional ? { success: true } : { success: false, error: '没有可支付的信号球或手牌代价' };
        }
        this.enqueueDslChoice(
          {
            id: this.choiceId('orb-or-hand-cost'),
            playerId,
            choiceType: 'SELECT_OPTION',
            prompt: cost.prompt ?? '请选择要支付的信号球或手牌代价',
            options,
            effectType: cost.choiceEffectType ?? 'PRESET_ORB_OR_HAND_COST',
            sourceCardInstanceId: sourceId,
            minSelections: 1,
            maxSelections: 1,
          },
          {
            cardNumber,
            sourceCardInstanceId: sourceId,
            playerId,
            vars: {},
            remainingSteps: [],
            pendingAction: { kind: 'COST_ORB_OR_DISCARD', onPaid: [...steps], optional, markUsed },
          }
        );
        return { success: true };
      }
    }
  }

  private runSteps(
    cardNumber: string,
    sourceId: string,
    playerId: string,
    vars: Record<string, string[]>,
    queue: EffectStep[]
  ): void {
    const turn = this.ctx.state.turnNumber;

    while (queue.length > 0) {
      const step = queue.shift()!;

      switch (step.op) {
        case 'DRAW': {
          const targetPlayer = this.resolveSide(playerId, step.side ?? 'SELF');
          this.ctx.zoneMgr.drawCards(targetPlayer, step.count);
          break;
        }

        case 'MILL': {
          const targetPlayer = this.resolveSide(playerId, step.side ?? 'SELF');
          const milled = this.mill(targetPlayer, step.count);
          if (step.saveToVar) vars[step.saveToVar] = milled;
          break;
        }

        case 'REVEAL_TOP': {
          const targetPlayer = this.resolveSide(playerId, step.side ?? 'SELF');
          vars[step.saveToVar] = this.revealTop(targetPlayer, step.count);
          break;
        }

        case 'CONFIRM_YES_NO': {
          this.enqueueDslChoice(
            {
              id: this.choiceId(step.choiceEffectType ?? 'confirm'),
              playerId,
              choiceType: 'SELECT_OPTION',
              prompt: this.formatPrompt(step.prompt, playerId),
              options: [
                { id: 'opt_yes', label: step.yesLabel },
                { id: 'opt_no', label: step.noLabel },
              ],
              effectType: step.choiceEffectType ?? `DSL_CONFIRM_${cardNumber}`,
              sourceCardInstanceId: sourceId,
              minSelections: 1,
              maxSelections: 1,
            },
            {
              cardNumber,
              sourceCardInstanceId: sourceId,
              playerId,
              vars,
              remainingSteps: queue,
              pendingAction: { kind: 'CONFIRM_YES_NO', onYes: step.onYes, onNo: step.onNo },
            }
          );
          return;
        }

        case 'CHOOSE_ROLES': {
          const targetPlayer = this.resolveSide(playerId, step.side);
          const candidates = this.roles(targetPlayer).filter((r) =>
            !step.filter || this.matchesFilter(r, step.filter, sourceId)
          );
          const isEligible = (c: CardInstance) =>
            !step.eligibilityFilter || this.matchesFilter(c, step.eligibilityFilter, sourceId);
          const eligibleCount = candidates.filter(isEligible).length;
          if (candidates.length === 0 || eligibleCount === 0) {
            vars[step.saveToVar] = [];
            break;
          }
          const max = step.max ?? 1;
          const min = Math.min(step.min ?? 1, eligibleCount);
          const effectType = step.choiceEffectType ?? `DSL_CHOOSE_ROLES_${cardNumber}`;
          this.enqueueDslChoice(
            {
              id: this.choiceId(effectType),
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: this.formatPrompt(step.prompt, playerId),
              options: candidates.map((c) =>
                this.effects.createRoleChoiceOption(c, {
                  eligible: isEligible(c),
                  ineligibleReason: step.ineligibleReason,
                })
              ),
              effectType,
              sourceCardInstanceId: sourceId,
              minSelections: min,
              maxSelections: Math.min(max, eligibleCount),
            },
            {
              cardNumber,
              sourceCardInstanceId: sourceId,
              playerId,
              vars,
              remainingSteps: queue,
              pendingAction: { kind: 'SAVE_CHOICE', saveToVar: step.saveToVar },
            }
          );
          return;
        }

        case 'CHOOSE_ZONE_CARDS': {
          const targetPlayer = this.resolveSide(playerId, step.side);
          const candidates = this.zone(targetPlayer, step.zone).filter((c) =>
            !step.filter || this.matchesFilter(c, step.filter, sourceId)
          );
          if (candidates.length === 0 || (step.requireEmptySlot && !this.hasEmptySlot(playerId))) {
            vars[step.saveToVar] = [];
            break;
          }
          const max = step.max ?? 1;
          const min = Math.min(step.min ?? 1, candidates.length);
          const effectType = step.choiceEffectType ?? `DSL_CHOOSE_ZONE_${cardNumber}`;
          this.enqueueDslChoice(
            {
              id: this.choiceId(effectType),
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: this.formatPrompt(step.prompt, playerId),
              options: candidates.map((c) =>
                this.effects.createGeneralCardChoiceOption(c, { ineligibleReason: step.ineligibleReason })
              ),
              effectType,
              sourceCardInstanceId: sourceId,
              minSelections: min,
              maxSelections: Math.min(max, candidates.length),
            },
            {
              cardNumber,
              sourceCardInstanceId: sourceId,
              playerId,
              vars,
              remainingSteps: queue,
              pendingAction: { kind: 'SAVE_CHOICE', saveToVar: step.saveToVar },
            }
          );
          return;
        }

        case 'CHOOSE_FROM_VAR': {
          const ids = vars[step.varName] ?? [];
          const cards = ids.map((id) => this.ctx.state.cards[id]).filter((c): c is CardInstance => !!c);
          const isEligible = (c: CardInstance) => {
            if (step.requireEmptySlot && !this.hasEmptySlot(playerId)) return false;
            return !step.filter || this.matchesFilter(c, step.filter, sourceId);
          };
          const eligibleCount = cards.filter(isEligible).length;
          if (!step.alwaysShow && (cards.length === 0 || eligibleCount === 0)) {
            vars[step.saveToVar] = [];
            break;
          }
          const max = Math.min(step.max ?? 1, eligibleCount);
          const min = Math.min(step.min ?? 1, eligibleCount);
          const effectType = step.choiceEffectType ?? `DSL_CHOOSE_VAR_${cardNumber}`;
          const prompt = this.formatPrompt(step.prompt, playerId);
          this.enqueueDslChoice(
            {
              id: this.choiceId(effectType),
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: eligibleCount > 0 ? prompt : `${prompt}：公开的牌中没有符合条件的卡牌，请确认`,
              options: cards.map((c) =>
                this.effects.createGeneralCardChoiceOption(c, {
                  eligible: isEligible(c),
                  ineligibleReason: '不符合条件',
                })
              ),
              effectType,
              sourceCardInstanceId: sourceId,
              minSelections: min,
              maxSelections: max,
            },
            {
              cardNumber,
              sourceCardInstanceId: sourceId,
              playerId,
              vars,
              remainingSteps: queue,
              pendingAction: {
                kind: 'SAVE_CHOICE',
                saveToVar: step.saveToVar,
                distinctTraits: step.distinctTraits,
                distinctTraitsError: step.distinctTraitsError,
              },
            },
            { revealed: ids }
          );
          return;
        }

        case 'REORDER_ZONE': {
          const cards = this.zone(playerId, step.zone);
          if (cards.length <= 1) break;
          const effectType = step.choiceEffectType ?? `DSL_REORDER_${cardNumber}`;
          this.enqueueDslChoice(
            {
              id: this.choiceId(effectType),
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: this.formatPrompt(step.prompt, playerId, { orbCount: cards.length }),
              options: cards.map((c) => this.effects.createGeneralCardChoiceOption(c)),
              effectType,
              sourceCardInstanceId: sourceId,
              minSelections: cards.length,
              maxSelections: cards.length,
            },
            {
              cardNumber,
              sourceCardInstanceId: sourceId,
              playerId,
              vars,
              remainingSteps: queue,
              pendingAction: { kind: 'REORDER_ZONE', zone: step.zone },
            }
          );
          return;
        }

        case 'MOVE_CARDS': {
          const targets = this.resolveTargetIds(step.target, playerId, sourceId, vars);
          const moved: string[] = [];
          for (const id of targets) {
            const card = this.ctx.state.cards[id];
            if (!card) continue;
            if (step.toZone === 'BATTLEFIELD') {
              if (this.bringToField(playerId, id, step.triggerEntry !== false)) {
                moved.push(id);
              }
            } else if (step.toZone === 'DECK_BOTTOM') {
              // 公开剩余卡牌只移动仍在处理区的牌
              if (step.target.kind === 'REST_OF_VAR' && card.zone !== 'PROCESSING') continue;
              this.ctx.zoneMgr.moveCardToBottomOfDeck(id);
              moved.push(id);
            } else {
              if (step.target.kind === 'REST_OF_VAR' && card.zone !== 'PROCESSING') continue;
              this.ctx.zoneMgr.moveCard(id, step.toZone, { isFaceUp: step.isFaceUp ?? true });
              moved.push(id);
            }
          }
          if (step.saveMovedToVar) vars[step.saveMovedToVar] = moved;
          break;
        }

        case 'DESTROY_ROLES': {
          const targets = this.resolveTargetIds(step.target, playerId, sourceId, vars);
          const destroyed: string[] = [];
          for (const id of targets) {
            if (this.destroy(id)) destroyed.push(id);
          }
          if (step.saveDestroyedToVar) vars[step.saveDestroyedToVar] = destroyed;
          break;
        }

        case 'SET_READY': {
          const targets = this.resolveTargetIds(step.target, playerId, sourceId, vars);
          for (const id of targets) {
            const card = this.ctx.state.cards[id];
            if (!card) continue;
            if (step.target.kind === 'SELF' && !this.ctx.fieldMgr.isSlotRole(playerId, id)) continue;
            card.isReady = step.isReady;
          }
          break;
        }

        case 'MODIFY_STATS': {
          const targets = this.resolveTargetIds(step.target, playerId, sourceId, vars);
          const untilTurn = this.resolveUntilTurn(step.duration, turn);
          const source = step.source ?? cardNumber;
          for (const id of targets) {
            const card = this.ctx.state.cards[id];
            if (!card) continue;
            if (step.target.kind === 'SELF' && !this.ctx.fieldMgr.isSlotRole(playerId, id)) continue;
            const mod: CardModifier = {
              ...(step.pp !== undefined ? { pp: this.evalNumberExpr(step.pp, playerId, sourceId) } : {}),
              ...(step.dp !== undefined ? { dp: this.evalNumberExpr(step.dp, playerId, sourceId) } : {}),
              ...(step.setPP !== undefined ? { setPP: this.evalNumberExpr(step.setPP, playerId, sourceId) } : {}),
              ...(step.setDP !== undefined ? { setDP: this.evalNumberExpr(step.setDP, playerId, sourceId) } : {}),
              ...(step.charge !== undefined ? { charge: this.evalNumberExpr(step.charge, playerId, sourceId) } : {}),
              ...(step.setCharge !== undefined ? { setCharge: this.evalNumberExpr(step.setCharge, playerId, sourceId) } : {}),
              ...(step.keywords ? { keywords: step.keywords } : {}),
              ...(step.removeKeywords ? { removeKeywords: step.removeKeywords } : {}),
              ...(step.addTraits ? { addTraits: step.addTraits } : {}),
              ...(step.loseAbilities ? { loseAbilities: true } : {}),
              untilTurn,
              source,
              sourceCardInstanceId: sourceId,
            };
            addCardModifier(this.ctx.state, card, mod);
          }
          break;
        }

        case 'ADD_COST_MODIFIER': {
          const player = this.ctx.state.players[playerId]!;
          player.costModifiers = [
            ...(player.costModifiers ?? []),
            {
              id: `cost-mod-${sourceId}-${this.ctx.events.length}`,
              amount: step.amount,
              targetTrait: step.targetTrait,
              targetName: step.targetName,
              cardType: step.cardType,
              excludeAscension: step.excludeAscension,
              remainingCount: step.remainingCount,
            },
          ];
          const sourceCard = this.ctx.state.cards[sourceId];
          const sourceDef = sourceCard ? this.def(sourceCard) : undefined;
          if (sourceDef && step.logText) {
            this.ctx.events.push({
              type: 'ABILITY_ACTIVATED',
              playerId,
              cardInstanceId: sourceId,
              abilityName: `${sourceDef.name}【起】`,
              rulesText: step.logText,
            });
          }
          break;
        }

        case 'CHANGE_EROSION': {
          const targetPlayer = this.resolveSide(playerId, step.side ?? 'SELF');
          const player = this.ctx.state.players[targetPlayer];
          if (!player) break;
          const previous = player.erosionCount;
          player.erosionCount = Math.max(0, player.erosionCount + step.delta);
          if (step.delta > 0) {
            this.ctx.events.push({
              type: 'EROSION_INCREASED',
              playerId: targetPlayer,
              previousValue: previous,
              newValue: player.erosionCount,
              reason: 'EFFECT',
            });
          }
          break;
        }

        case 'REGISTER_DELAYED_TRIGGER': {
          const targets = this.resolveTargetIds(step.target, playerId, sourceId, vars);
          const triggerTurn = turn + (step.turnOffset ?? 0);
          for (const id of targets) {
            const card = this.ctx.state.cards[id];
            if (!card) continue;
            if (step.markLegacyEndOfTurnToGraveyard) {
              card.endOfTurnToGraveyard = triggerTurn;
            }
            this.ctx.triggerMgr?.registerDelayedTrigger({
              eventType: step.eventType,
              triggerTurn,
              sourceCardInstanceId: id,
              sourceCardNumber: card.cardNumber,
              controllerPlayerId: card.controllerPlayerId,
              abilityId: step.abilityId,
              label: `【${this.def(card)?.name ?? card.cardNumber}】${step.labelSuffix ?? '该回合结束时放置到墓地'}`,
              once: true,
            });
          }
          break;
        }

        case 'IF': {
          const branch = this.evalCondition(step.condition, playerId, sourceId, vars)
            ? step.then
            : (step.else ?? []);
          if (branch.length > 0) {
            queue.unshift(...branch);
          }
          break;
        }
      }
    }
  }

  // ===================================================================
  // 求值与查询辅助
  // ===================================================================

  private resolveTargetIds(
    target: CardTargetRef,
    playerId: string,
    sourceId: string,
    vars: Record<string, string[]>
  ): string[] {
    switch (target.kind) {
      case 'SELF':
        return sourceId ? [sourceId] : [];
      case 'VAR':
        return vars[target.varName] ?? [];
      case 'REST_OF_VAR': {
        const all = vars[target.allVar] ?? [];
        const excluded = new Set(vars[target.excludeVar] ?? []);
        return all.filter((id) => !excluded.has(id));
      }
      case 'ALL_MATCHING_ROLES': {
        const sidePlayer = this.resolveSide(playerId, target.side);
        return this.roles(sidePlayer)
          .filter((r) => !target.filter || this.matchesFilter(r, target.filter, sourceId))
          .map((r) => r.instanceId);
      }
    }
  }

  private evalNumberExpr(expr: NumberExpr, playerId: string, sourceId: string): number {
    if (typeof expr === 'number') return expr;
    switch (expr.kind) {
      case 'EROSION_MULT': {
        const pid = this.resolveSide(playerId, expr.side);
        return (this.ctx.state.players[pid]?.erosionCount ?? 0) * expr.multiplier;
      }
      case 'ROLE_COUNT_MULT': {
        const pid = this.resolveSide(playerId, expr.side);
        const count = this.roles(pid).filter((r) => !expr.filter || this.matchesFilter(r, expr.filter, sourceId)).length;
        return count * expr.multiplier;
      }
      case 'UNDERNEATH_COUNT_MULT': {
        const card = this.ctx.state.cards[sourceId];
        return (card?.underneathCardIds?.length ?? 0) * expr.multiplier;
      }
    }
  }

  private evalCondition(
    cond: ConditionExpr,
    playerId: string,
    sourceId: string,
    vars: Record<string, string[]>
  ): boolean {
    switch (cond.kind) {
      case 'HAS_ROLE': {
        const pid = this.resolveSide(playerId, cond.side);
        const count = this.roles(pid).filter((r) => !cond.filter || this.matchesFilter(r, cond.filter, sourceId)).length;
        return count >= (cond.minCount ?? 1);
      }
      case 'EROSION_COMPARE': {
        const pid = this.resolveSide(playerId, cond.side);
        return this.compare(this.ctx.state.players[pid]?.erosionCount ?? 0, cond.op, cond.value);
      }
      case 'ZONE_COUNT': {
        const pid = this.resolveSide(playerId, cond.side);
        const count = this.zone(pid, cond.zone).filter(
          (c) => !cond.filter || this.matchesFilter(c, cond.filter, sourceId)
        ).length;
        return this.compare(count, cond.op, cond.value);
      }
      case 'HAS_EMPTY_SLOT': {
        const pid = this.resolveSide(playerId, cond.side);
        return this.hasEmptySlot(pid);
      }
      case 'TURN_OWNER':
        return cond.isSelfTurn
          ? this.ctx.state.activePlayerId === playerId
          : this.ctx.state.activePlayerId !== playerId;
      case 'VAR_NON_EMPTY':
        return (vars[cond.varName]?.length ?? 0) > 0;
      case 'VAR_HAS_CARD_MATCHING':
        return (vars[cond.varName] ?? []).some((id) => {
          const card = this.ctx.state.cards[id];
          return Boolean(card && this.matchesFilter(card, cond.filter, sourceId));
        });
      case 'ALL':
        return cond.conditions.every((c) => this.evalCondition(c, playerId, sourceId, vars));
      case 'ANY':
        return cond.conditions.some((c) => this.evalCondition(c, playerId, sourceId, vars));
      case 'NOT':
        return !this.evalCondition(cond.condition, playerId, sourceId, vars);
    }
  }

  /**
   * 8.9.1.d 持续效果静态条件求值 (使用 ContinuousEffectEngine 提供的无递归 hasTrait)
   */
  private evalStaticCondition(
    cond: ConditionExpr,
    playerId: string,
    state: CardEffectContext['state'],
    getCardsInZone: (pid: string, z: ZoneId) => CardInstance[],
    getFieldRoles: (pid: string) => CardInstance[],
    hasTrait: (cardInstanceId: string, trait: string) => boolean
  ): boolean {
    const resolveSide = (side: PlayerSide) =>
      side === 'SELF'
        ? playerId
        : playerId === state.activePlayerId
          ? state.nonActivePlayerId
          : state.activePlayerId;

    switch (cond.kind) {
      case 'HAS_ROLE': {
        const pid = resolveSide(cond.side);
        const count = getFieldRoles(pid).filter(
          (r) => !cond.filter || this.matchesFilterSafe(r, cond.filter, hasTrait)
        ).length;
        return count >= (cond.minCount ?? 1);
      }
      case 'EROSION_COMPARE': {
        const pid = resolveSide(cond.side);
        return this.compare(state.players[pid]?.erosionCount ?? 0, cond.op, cond.value);
      }
      case 'ZONE_COUNT': {
        const pid = resolveSide(cond.side);
        const count = getCardsInZone(pid, cond.zone).filter(
          (c) => !cond.filter || this.matchesFilterSafe(c, cond.filter, hasTrait)
        ).length;
        return this.compare(count, cond.op, cond.value);
      }
      case 'HAS_EMPTY_SLOT': {
        const pid = resolveSide(cond.side);
        return (state.battlefields[pid] ?? []).some((s) => !s.roleCardId && !s.standaloneEquipmentId && !s.assistCardId);
      }
      case 'TURN_OWNER':
        return cond.isSelfTurn ? state.activePlayerId === playerId : state.activePlayerId !== playerId;
      case 'ALL':
        return cond.conditions.every((c) =>
          this.evalStaticCondition(c, playerId, state, getCardsInZone, getFieldRoles, hasTrait)
        );
      case 'ANY':
        return cond.conditions.some((c) =>
          this.evalStaticCondition(c, playerId, state, getCardsInZone, getFieldRoles, hasTrait)
        );
      case 'NOT':
        return !this.evalStaticCondition(cond.condition, playerId, state, getCardsInZone, getFieldRoles, hasTrait);
      default:
        return false;
    }
  }

  private matchesFilter(card: CardInstance, filter: CardFilter, sourceId?: string): boolean {
    return this.matchesFilterSafe(
      card,
      filter,
      (id, trait) => this.hasTrait(this.ctx.state.cards[id]!, trait),
      sourceId
    );
  }

  private matchesFilterSafe(
    card: CardInstance,
    filter: CardFilter,
    hasTraitFn: (cardInstanceId: string, trait: string) => boolean,
    sourceId?: string
  ): boolean {
    const def = this.def(card);
    if (filter.excludeSelf && sourceId && card.instanceId === sourceId) return false;
    if (filter.cardType !== undefined && def?.cardType !== filter.cardType) return false;
    if (filter.exactName !== undefined && def?.name !== filter.exactName) return false;
    if (filter.trait !== undefined && !hasTraitFn(card.instanceId, filter.trait)) return false;
    if (filter.anyTraits !== undefined && !filter.anyTraits.some((t) => hasTraitFn(card.instanceId, t))) {
      return false;
    }
    const cost = def?.cost ?? 99;
    if (filter.maxCost !== undefined && cost > filter.maxCost) return false;
    if (filter.minCost !== undefined && cost < filter.minCost) return false;
    if (filter.exactCost !== undefined && cost !== filter.exactCost) return false;
    if (filter.isSignalOrb !== undefined && Boolean(def?.signalOrb) !== filter.isSignalOrb) return false;
    if (filter.isReady !== undefined && card.isReady !== filter.isReady) return false;
    if (filter.maxEffectivePP !== undefined) {
      if (this.ctx.fieldMgr.calculateRoleEffectivePP(card.instanceId) > filter.maxEffectivePP) return false;
    }
    if (filter.minEffectivePP !== undefined) {
      if (this.ctx.fieldMgr.calculateRoleEffectivePP(card.instanceId) < filter.minEffectivePP) return false;
    }
    return true;
  }

  /**
   * 校验所选卡牌能否分别一一对应到 distinctTraits 中的不同特征 (回溯二分匹配，覆盖 ST03-003 及未来多特征检索)
   */
  private canAssignDistinctTraits(cards: CardInstance[], traits: string[]): boolean {
    if (cards.length > traits.length) return false;
    const used = new Array<boolean>(traits.length).fill(false);
    const dfs = (idx: number): boolean => {
      if (idx === cards.length) return true;
      const card = cards[idx]!;
      for (let t = 0; t < traits.length; t++) {
        if (used[t]) continue;
        if (this.hasTrait(card, traits[t]!)) {
          used[t] = true;
          if (dfs(idx + 1)) return true;
          used[t] = false;
        }
      }
      return false;
    };
    return dfs(0);
  }

  private resolveUntilTurn(duration: ModifierDuration, turn: number): number | undefined {
    switch (duration) {
      case 'END_OF_TURN':
        return turn;
      case 'END_OF_NEXT_TURN':
        return turn + 1;
      case 'UNTIL_LEAVE_ZONE':
        return undefined;
    }
  }

  private compare(actual: number, op: CompareOp, target: number): boolean {
    switch (op) {
      case '>=':
        return actual >= target;
      case '<=':
        return actual <= target;
      case '==':
        return actual === target;
      case '>':
        return actual > target;
      case '<':
        return actual < target;
    }
  }

  private formatPrompt(prompt: string, playerId: string, extra?: Record<string, string | number>): string {
    const erosion = this.ctx.state.players[playerId]?.erosionCount ?? 0;
    let text = prompt
      .replace(/\{erosion\*(\d+)\}/g, (_m, mult) => String(erosion * Number(mult)))
      .replace(/\{erosion\}/g, String(erosion));
    for (const [k, v] of Object.entries(extra ?? {})) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return text;
  }

  private enqueueDslChoice(
    choice: Omit<PendingChoice, 'metadata'>,
    frame: DslExecutionFrame,
    extraMetadata?: Record<string, unknown>
  ): void {
    this.ctx.setPendingChoice({
      ...choice,
      metadata: {
        ...(extraMetadata ?? {}),
        __dsl: frame,
      },
    });
  }

  private orbGroups(playerId: string, size: number, filter: OrbColorFilter): string[][] {
    const zone = this.zone(playerId, 'SIGNAL_ORB');
    const groups: string[][] = [];
    for (let i = 0; i + size <= zone.length; i++) {
      const slice = zone.slice(i, i + size);
      const colors = slice.map((c) => (c.isFaceUp ? this.def(c)?.signalOrb : undefined));
      if (colors.some((c) => !c)) continue;
      if (filter === 'SAME' && new Set(colors).size !== 1) continue;
      if (filter !== 'ANY' && filter !== 'SAME' && colors.some((c) => c !== filter)) continue;
      groups.push(slice.map((c) => c.instanceId));
    }
    return groups;
  }

  private eliminate(playerId: string, ids: string[]): void {
    const orbColors = ids.map((id) => {
      const card = this.ctx.state.cards[id];
      return (card ? this.def(card)?.signalOrb : undefined) ?? 'UNKNOWN';
    });
    for (const id of ids) this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
    this.ctx.events.push({ type: 'ORBS_ELIMINATED', playerId, orbCardIds: ids, cardDrawnCount: 0 });
    this.ctx.triggerMgr?.emit({
      type: 'ORBS_ELIMINATED',
      playerId,
      orbCardIds: ids,
      orbColors,
    });
  }

  private revealTop(playerId: string, count: number): string[] {
    const top = this.zone(playerId, 'DECK').slice(0, count);
    for (const c of top) this.ctx.zoneMgr.moveCard(c.instanceId, 'PROCESSING', { isFaceUp: true });
    return top.map((c) => c.instanceId);
  }

  private mill(playerId: string, count: number): string[] {
    const milled: string[] = [];
    for (let i = 0; i < count; i++) {
      if (!this.ctx.zoneMgr.refreshDeckIfEmpty(playerId)) break;
      const top = this.zone(playerId, 'DECK')[0]!;
      this.ctx.zoneMgr.moveCard(top.instanceId, 'GRAVEYARD', { isFaceUp: true });
      milled.push(top.instanceId);
    }
    return milled;
  }

  private bringToField(playerId: string, cardId: string, triggerEntry: boolean): boolean {
    const slot = this.ctx.fieldMgr.findFirstEmptySlot(playerId);
    if (slot === undefined) return false;
    if (!this.ctx.fieldMgr.playRoleCard(playerId, cardId, slot)) return false;
    if (triggerEntry) {
      const def = this.def(this.ctx.state.cards[cardId]!);
      if (def) this.effects.handleRoleEntryEffect(playerId, cardId, def);
    }
    return true;
  }

  private destroy(cardId: string): boolean {
    const card = this.ctx.state.cards[cardId];
    if (!card || !this.ctx.fieldMgr.isSlotRole(card.controllerPlayerId, cardId)) return false;
    const snapshot = this.ctx.triggerMgr?.snapshotCard(cardId);
    this.ctx.zoneMgr.moveCard(cardId, 'GRAVEYARD', { isFaceUp: true });
    this.ctx.events.push({ type: 'CARD_DESTROYED', cardInstanceId: cardId, reason: 'EFFECT' });
    this.ctx.triggerMgr?.emit({
      type: 'CARD_DESTROYED',
      playerId: card.controllerPlayerId,
      cardInstanceId: cardId,
      fromZone: 'BATTLEFIELD',
      toZone: 'GRAVEYARD',
      destroyReason: 'EFFECT',
      subjectSnapshot: snapshot,
    });
    return true;
  }

  private markUsed(playerId: string, cardId: string): void {
    const usage = this.ctx.state.players[playerId]!.turnAbilityUsage;
    usage[cardId] = (usage[cardId] ?? 0) + 1;
  }

  private def(card: CardInstance): CardVersionData | undefined {
    return this.ctx.cardDb.getCard(card.cardNumber) || (card.cardId ? this.ctx.cardDb.getCard(card.cardId) : undefined);
  }

  private hasTrait(card: CardInstance, trait: string): boolean {
    if (this.ctx.continuousEffects) {
      return this.ctx.continuousEffects.hasTrait(card.instanceId, trait);
    }
    return Boolean(this.def(card)?.traits.includes(trait));
  }

  private isOrb(card: CardInstance): boolean {
    return Boolean(this.def(card)?.signalOrb);
  }

  private zone(playerId: string, zone: ZoneId): CardInstance[] {
    return this.ctx.zoneMgr.getCardsInZone(playerId, zone);
  }

  private roles(playerId: string): CardInstance[] {
    return this.ctx.fieldMgr
      .getSlots(playerId)
      .map((s) => (s.roleCardId ? this.ctx.state.cards[s.roleCardId] : undefined))
      .filter((c): c is CardInstance => !!c);
  }

  private hasEmptySlot(playerId: string): boolean {
    return this.ctx.fieldMgr.findFirstEmptySlot(playerId) !== undefined;
  }

  private resolveSide(playerId: string, side: PlayerSide): string {
    if (side === 'SELF') return playerId;
    const s = this.ctx.state;
    return playerId === s.activePlayerId ? s.nonActivePlayerId : s.activePlayerId;
  }

  private choiceId(tag: string): string {
    this.choiceSeq += 1;
    return `choice-${tag}-${this.ctx.state.turnNumber}-${this.ctx.events.length}-${this.choiceSeq}`;
  }
}
