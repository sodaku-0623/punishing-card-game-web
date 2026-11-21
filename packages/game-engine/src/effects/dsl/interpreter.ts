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
import { getAttachedEquipmentIds } from '../../zone/battlefield-manager.js';
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
  | { kind: 'COST_DISCARD'; onPaid: EffectStep[]; optional: boolean; markUsed?: boolean; markUsedKey?: string; savePaidToVar?: string }
  | { kind: 'COST_ORB'; onPaid: EffectStep[]; optional: boolean; markUsed?: boolean; markUsedKey?: string; savePaidToVar?: string }
  | { kind: 'COST_ORB_OR_DISCARD'; onPaid: EffectStep[]; optional: boolean; markUsed?: boolean; markUsedKey?: string }
  | { kind: 'COST_TAP_FIELD'; onPaid: EffectStep[]; optional: boolean }
  | { kind: 'CONFIRM_YES_NO'; onYes: EffectStep[]; onNo?: EffectStep[] }
  | { kind: 'CHOOSE_MODE'; modes: { id: string; steps: EffectStep[] }[] }
  | {
      kind: 'SAVE_CHOICE';
      saveToVar: string;
      distinctTraits?: string[];
      distinctTraitsError?: string;
      maxTotalCost?: number;
      requireEmptySlotCount?: boolean;
    }
  | { kind: 'REORDER_ZONE'; zone: 'SIGNAL_ORB' }
  | { kind: 'PLACE_ORB_AT_POSITION'; cardInstanceId: string }
  | { kind: 'WANSHIMING_REVEAL_TO_COST'; revealVar: string }
  | {
      kind: 'CHOOSE_ACTIVATED_ABILITY';
      entries: Array<{
        id: string;
        cardNumber: string;
        usageKey: string;
        oncePerTurn: boolean;
        cost?: AbilityCost;
        steps: EffectStep[];
      }>;
    };

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

  /** 检查该战场卡牌自身或其附着装备是否拥有任何声明式【起】动能力 (支持 BP01-022 装备赋予【起】) */
  handlesActivationForCard(playerId: string, cardId: string, def: CardVersionData): boolean {
    if (this.registry.get(def.cardNumber)?.activate) return true;
    return this.getEquipmentGrantedActivates(playerId, cardId).length > 0;
  }

  private getEquipmentGrantedActivates(
    playerId: string,
    hostCardId: string
  ): Array<{
    equipCardId: string;
    equipCardNumber: string;
    usageKey: string;
    label: string;
    activate: NonNullable<CardEffectSpec['activate']>;
  }> {
    const host = this.ctx.state.cards[hostCardId];
    if (!host || host.zone !== 'BATTLEFIELD' || host.controllerPlayerId !== playerId) return [];
    const hostDef = this.def(host);
    const results: Array<{
      equipCardId: string;
      equipCardNumber: string;
      usageKey: string;
      label: string;
      activate: NonNullable<CardEffectSpec['activate']>;
    }> = [];
    for (const eqId of getAttachedEquipmentIds(host)) {
      const eq = this.ctx.state.cards[eqId];
      if (!eq) continue;
      if (this.ctx.continuousEffects?.hasLostInherentAbilities(eq.instanceId)) continue;
      const eqSpec = this.registry.get(eq.cardNumber);
      const granted = eqSpec?.equipmentGrantedActivate;
      if (!granted) continue;
      if (granted.requiredHostName) {
        const nameOk = this.ctx.continuousEffects
          ? this.ctx.continuousEffects.hasCardName(host.instanceId, granted.requiredHostName)
          : hostDef?.name === granted.requiredHostName;
        if (!nameOk) continue;
      }
      if (granted.requiredHostTrait && !this.hasTrait(host, granted.requiredHostTrait)) continue;
      // Q&A·2：不同装备卡给予的同文本能力各自计次，且升变后宿主实例变化可再次发动
      results.push({
        equipCardId: eq.instanceId,
        equipCardNumber: eq.cardNumber,
        usageKey: `${hostCardId}:equipAct:${eq.instanceId}`,
        label: granted.label,
        activate: granted.activate,
      });
    }
    return results;
  }

  isVanillaEntry(cardNumber: string): boolean {
    return Boolean(this.registry.get(cardNumber)?.vanillaEntry);
  }

  /** 是否为由声明式解释器挂起的决策 */
  handlesChoice(choice: PendingChoice): boolean {
    return Boolean((choice.metadata as { __dsl?: unknown } | undefined)?.__dsl);
  }

  /**
   * 8.6.2.c 计算声明式手牌静态费用减免 (如 ST03-011、ST05-009、ST06-004)
   */
  calculateHandCostDiscount(playerId: string, cardNumber: string): number {
    const spec = this.registry.get(cardNumber);
    if (!spec?.handCostDiscount) return 0;
    if ('condition' in spec.handCostDiscount) {
      return this.evalCondition(spec.handCostDiscount.condition, playerId, '', {})
        ? spec.handCostDiscount.flatDiscount
        : 0;
    }
    if ('zone' in spec.handCostDiscount) {
      const rule = spec.handCostDiscount;
      const matched = this.zone(playerId, rule.zone).filter((c) => this.matchesFilter(c, rule.filter));
      return matched.length * rule.discountPerCard;
    }
    const rule = spec.handCostDiscount;
    const matched = this.roles(playerId).filter((r) => this.matchesFilter(r, rule.filter));
    return matched.length * rule.discountPerRole;
  }

  /**
   * 【永】：检查手牌中的该牌当前是否可以无视属性条件使用 (如 ST04-008 卡穆·狂犬)
   */
  canIgnoreAttributeCondition(playerId: string, cardNumber: string): boolean {
    const spec = this.registry.get(cardNumber);
    if (!spec?.ignoreAttributeCondition) return false;
    return this.evalCondition(spec.ignoreAttributeCondition, playerId, '', {});
  }

  /**
   * 【永】：计算我方战场角色的持续能力对手牌卡牌费用的覆写与减免 (如 BP01-077 首张《荣光护盾》变1费、BP01-015 首张装备-1费)
   */
  calculateFieldHandCostAdjustment(
    playerId: string,
    cardDef: CardVersionData,
    isAscension: boolean
  ): { setCost?: number; discount: number } {
    if (isAscension) return { discount: 0 };
    const player = this.ctx.state.players[playerId];
    if (!player) return { discount: 0 };
    let setCost: number | undefined;
    let discount = 0;

    for (const role of this.roles(playerId)) {
      if (this.ctx.continuousEffects?.hasLostInherentAbilities(role.instanceId)) continue;
      const spec = this.registry.get(role.cardNumber);
      const rule = spec?.fieldCardCostRule;
      if (!rule) continue;
      if (rule.cardType && cardDef.cardType !== rule.cardType) continue;
      if (rule.targetName && cardDef.name !== rule.targetName) continue;
      if (rule.firstPerTurnOnly) {
        if (rule.targetName) {
          if ((player.turnCardPlayedCountByName?.[rule.targetName] ?? 0) > 0) continue;
        } else if (rule.cardType === 'EQUIPMENT') {
          if ((player.turnEquipmentPlayedCount ?? 0) > 0) continue;
        }
      }
      if (rule.setCost !== undefined) {
        setCost = setCost === undefined ? rule.setCost : Math.min(setCost, rule.setCost);
      }
      if (rule.discount !== undefined) {
        discount += rule.discount;
      }
    }
    return { setCost, discount };
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
   * 执行声明式【起】起动能力 (支持角色自身【起】与装备赋予的【起】，如 BP01-022 夜煌—小太刀)
   */
  activate(playerId: string, cardId: string, def: CardVersionData, abilityIndex?: number): Result {
    const spec = this.registry.get(def.cardNumber);
    const grantedList = this.getEquipmentGrantedActivates(playerId, cardId);
    const allEntries: Array<{
      id: string;
      label: string;
      cardNumber: string;
      usageKey: string;
      activate: NonNullable<CardEffectSpec['activate']>;
    }> = [];

    if (spec?.activate) {
      allEntries.push({
        id: 'self',
        label: `【${def.name}】自身【起】动能力`,
        cardNumber: def.cardNumber,
        usageKey: cardId,
        activate: spec.activate,
      });
    }
    grantedList.forEach((g, idx) => {
      allEntries.push({
        id: `equip-${idx}-${g.equipCardId}`,
        label: g.label,
        cardNumber: g.equipCardNumber,
        usageKey: g.usageKey,
        activate: g.activate,
      });
    });

    if (allEntries.length === 0) {
      return { success: false, error: '未注册该起动能力的声明式效果' };
    }

    const player = this.ctx.state.players[playerId]!;
    const runEntry = (entry: (typeof allEntries)[number]): Result => {
      if (entry.activate.oncePerTurn && (player.turnAbilityUsage[entry.usageKey] ?? 0) > 0) {
        return { success: false, error: '该能力本回合已发动过 (【回合1】)' };
      }
      if (entry.activate.condition && !this.evalCondition(entry.activate.condition, playerId, cardId, {})) {
        return { success: false, error: entry.activate.conditionError ?? '不满足该起动能力的发动条件' };
      }
      return this.executeWithCost(
        entry.cardNumber,
        cardId,
        playerId,
        entry.activate.cost,
        entry.activate.steps,
        Boolean(entry.activate.oncePerTurn),
        {},
        entry.usageKey
      );
    };

    if (allEntries.length === 1) {
      return runEntry(allEntries[0]!);
    }

    // 若调用方显式指定了非 0 的 abilityIndex，则直接执行对应条目 (方便测试与精确操作)
    if (abilityIndex !== undefined && abilityIndex > 0 && abilityIndex < allEntries.length) {
      return runEntry(allEntries[abilityIndex]!);
    }

    // 筛出当前尚未用尽回合1且满足前置条件的条目
    const usable = allEntries.filter((e) => {
      if (e.activate.oncePerTurn && (player.turnAbilityUsage[e.usageKey] ?? 0) > 0) return false;
      if (e.activate.condition && !this.evalCondition(e.activate.condition, playerId, cardId, {})) return false;
      return true;
    });
    if (usable.length === 0) {
      return runEntry(allEntries[0]!);
    }
    if (usable.length === 1) {
      return runEntry(usable[0]!);
    }

    // 多个可用【起】动能力共存 (如 BP01-014 自身【起】 + 夜煌—小太刀【起】)：交由玩家选择
    this.enqueueDslChoice(
      {
        id: this.choiceId('choose-act'),
        playerId,
        choiceType: 'SELECT_OPTION',
        prompt: `【${def.name}】请选择要发动的【起】动能力：`,
        options: usable.map((e) => ({ id: e.id, label: e.label })),
        effectType: 'DSL_CHOOSE_ACTIVATED_ABILITY',
        sourceCardInstanceId: cardId,
        minSelections: 1,
        maxSelections: 1,
      },
      {
        cardNumber: def.cardNumber,
        sourceCardInstanceId: cardId,
        playerId,
        vars: {},
        remainingSteps: [],
        pendingAction: {
          kind: 'CHOOSE_ACTIVATED_ABILITY',
          entries: usable.map((e) => ({
            id: e.id,
            cardNumber: e.cardNumber,
            usageKey: e.usageKey,
            oncePerTurn: Boolean(e.activate.oncePerTurn),
            cost: e.activate.cost,
            steps: e.activate.steps,
          })),
        },
      }
    );
    return { success: true };
  }

  /**
   * 8.5 / 8.7 向 TriggerManager 注册所有声明式【自】自动能力
   */
  registerTriggers(triggerMgr: TriggerManager): void {
    for (const spec of this.registry.values()) {
      for (const trig of spec.triggers ?? []) {
        triggerMgr.registerTrigger({
          abilityId: trig.abilityId,
          eventTypes: trig.eventTypes && trig.eventTypes.length > 0 ? trig.eventTypes : [trig.eventType],
          oncePerTurn: trig.oncePerTurn,
          deferOncePerTurnUntilCostPaid: trig.deferOncePerTurnUntilCostPaid,
          oncePerTurnByPlayer: trig.oncePerTurnByPlayer,
          maxPerTurnByPlayer: trig.maxPerTurnByPlayer,
          sharedTurnKey: trig.sharedTurnKey,
          collect: ({ state, event, cardDb, fieldMgr, continuousEffects, zoneMgr }) => {
            const condOk = (pid: string, srcId: string) =>
              !trig.condition || this.evalCondition(trig.condition, pid, srcId, {});

            switch (trig.matcher.kind) {
              case 'EQUIPPED_ROLE_ATTACKING': {
                const attackerId = event.cardInstanceId;
                if (!attackerId) return [];
                const attacker = state.cards[attackerId];
                if (!attacker) return [];
                const eqIds = getAttachedEquipmentIds(attacker);
                if (eqIds.length === 0) return [];
                const attackerDef = cardDb.getCard(attacker.cardNumber);
                if (
                  trig.matcher.requiredHostName &&
                  !continuousEffects.hasCardName(attacker.instanceId, trig.matcher.requiredHostName) &&
                  attackerDef?.name !== trig.matcher.requiredHostName
                ) {
                  return [];
                }
                if (
                  trig.matcher.requiredHostTrait &&
                  !this.hasTrait(attacker, trig.matcher.requiredHostTrait)
                ) {
                  return [];
                }
                if (!condOk(attacker.controllerPlayerId, attacker.instanceId)) return [];
                const matches = [];
                for (const eqId of eqIds) {
                  const equip = state.cards[eqId];
                  if (!equip || equip.cardNumber !== spec.cardNumber) continue;
                  if (continuousEffects.hasLostInherentAbilities(equip.instanceId)) continue;
                  // Q&A·2：不同装备卡给予同一角色的同文本能力各自计次，且升变后宿主实例变化可再次发动
                  const onceKey = `${attacker.instanceId}:${trig.abilityId}:${equip.instanceId}`;
                  matches.push({
                    sourceCardInstanceId: attacker.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: attacker.controllerPlayerId,
                    label: trig.label,
                    oncePerTurnKey: onceKey,
                    triggerContext: {
                      equipmentCardId: equip.instanceId,
                      attackerCardId: attacker.instanceId,
                      oncePerTurnKey: onceKey,
                    },
                  });
                }
                return matches;
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
                  if (!condOk(playerId, host.instanceId)) continue;
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
                if (!condOk(attacker.controllerPlayerId, attacker.instanceId)) return [];
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
              case 'SELF_ATTACKING_OR_BLOCKING': {
                const targetId = event.type === 'BLOCK_DECLARED' ? event.cardInstanceId : event.cardInstanceId;
                if (!targetId) return [];
                const role = state.cards[targetId];
                if (!role || role.cardNumber !== spec.cardNumber) return [];
                if (!fieldMgr.isSlotRole(role.controllerPlayerId, role.instanceId)) return [];
                if (!condOk(role.controllerPlayerId, role.instanceId)) return [];
                return [
                  {
                    sourceCardInstanceId: role.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: role.controllerPlayerId,
                    label: trig.label,
                    triggerContext:
                      event.type === 'BLOCK_DECLARED'
                        ? { blockerCardId: role.instanceId, attackerCardId: event.targetCardId }
                        : { attackerCardId: role.instanceId },
                  },
                ];
              }
              case 'SELF_ATTACK_END': {
                const attackerId = event.cardInstanceId;
                if (!attackerId) return [];
                const attacker = state.cards[attackerId];
                if (!attacker || attacker.cardNumber !== spec.cardNumber) return [];
                if (!fieldMgr.isSlotRole(attacker.controllerPlayerId, attackerId)) return [];
                if (!condOk(attacker.controllerPlayerId, attackerId)) return [];
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
              case 'GRANTED_ATTACK_CHARGE_CARD': {
                if (event.chargeKind !== 'ATTACK') return [];
                const attackerId = event.targetCardId;
                const chargedId = event.cardInstanceId;
                if (!attackerId || !chargedId) return [];
                const attacker = state.cards[attackerId];
                const charged = state.cards[chargedId];
                if (!attacker || !charged || !fieldMgr.isSlotRole(attacker.controllerPlayerId, attackerId)) return [];
                if (!continuousEffects.hasGrantedTrigger(attackerId, trig.abilityId)) return [];
                if (trig.matcher.chargedCardFilter && !this.matchesFilter(charged, trig.matcher.chargedCardFilter, attackerId)) {
                  return [];
                }
                if (!condOk(attacker.controllerPlayerId, attackerId)) return [];
                return [
                  {
                    sourceCardInstanceId: attacker.instanceId,
                    sourceCardNumber: attacker.cardNumber,
                    controllerPlayerId: attacker.controllerPlayerId,
                    label: trig.label,
                    triggerContext: { attackerCardId: attacker.instanceId, chargedCardId: charged.instanceId },
                  },
                ];
              }
              case 'SELF_IN_GRAVEYARD_ON_SELF_ORBS_ELIMINATED': {
                const playerId = event.playerId;
                if (!playerId) return [];
                const gyCards = zoneMgr.getCardsInZone(playerId, 'GRAVEYARD');
                const matches = [];
                for (const c of gyCards) {
                  if (c.cardNumber !== spec.cardNumber) continue;
                  if (!condOk(playerId, c.instanceId)) continue;
                  matches.push({
                    sourceCardInstanceId: c.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: playerId,
                    label: trig.label,
                    triggerContext: {},
                  });
                }
                return matches;
              }
              case 'SELF_BLOCKED_ATTACK_END': {
                const blockerId = event.blockerCardId;
                if (!blockerId) return [];
                const blocker = state.cards[blockerId];
                if (!blocker || blocker.cardNumber !== spec.cardNumber) return [];
                if (!fieldMgr.isSlotRole(blocker.controllerPlayerId, blockerId)) return [];
                if (!condOk(blocker.controllerPlayerId, blockerId)) return [];
                return [
                  {
                    sourceCardInstanceId: blocker.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: blocker.controllerPlayerId,
                    label: trig.label,
                    triggerContext: {
                      blockerCardId: blocker.instanceId,
                      attackerCardId: event.cardInstanceId,
                    },
                  },
                ];
              }
              case 'GRANTED_BLOCKED_ATTACK_END': {
                const blockerId = event.blockerCardId;
                if (!blockerId) return [];
                const blocker = state.cards[blockerId];
                if (!blocker || !fieldMgr.isSlotRole(blocker.controllerPlayerId, blockerId)) return [];
                if (!continuousEffects.hasGrantedTrigger(blockerId, trig.abilityId)) return [];
                if (!condOk(blocker.controllerPlayerId, blockerId)) return [];
                return [
                  {
                    sourceCardInstanceId: blocker.instanceId,
                    sourceCardNumber: blocker.cardNumber,
                    controllerPlayerId: blocker.controllerPlayerId,
                    label: trig.label,
                    triggerContext: {
                      blockerCardId: blocker.instanceId,
                      attackerCardId: event.cardInstanceId,
                    },
                  },
                ];
              }
              case 'FRIENDLY_ROLE_BLOCKING': {
                const blockerId = event.cardInstanceId;
                const playerId = event.playerId;
                if (!blockerId || !playerId) return [];
                const blocker = state.cards[blockerId];
                if (!blocker) return [];
                if (trig.matcher.blockerTrait && !this.hasTrait(blocker, trig.matcher.blockerTrait)) {
                  return [];
                }
                const matches = [];
                for (const slot of fieldMgr.getSlots(playerId)) {
                  if (trig.matcher.sourceKind === 'EQUIPMENT') {
                    const role = slot.roleCardId ? state.cards[slot.roleCardId] : undefined;
                    const equipIds = [
                      ...getAttachedEquipmentIds(role),
                      slot.standaloneEquipmentId,
                    ].filter((id): id is string => Boolean(id));
                    for (const eid of equipIds) {
                      const eq = state.cards[eid];
                      if (!eq || eq.cardNumber !== spec.cardNumber) continue;
                      if (!condOk(playerId, eq.instanceId)) continue;
                      matches.push({
                        sourceCardInstanceId: eq.instanceId,
                        sourceCardNumber: spec.cardNumber,
                        controllerPlayerId: playerId,
                        label: trig.label,
                        triggerContext: { blockerCardId: blockerId, attackerCardId: event.targetCardId },
                      });
                    }
                  } else {
                    const role = slot.roleCardId ? state.cards[slot.roleCardId] : undefined;
                    if (!role || role.cardNumber !== spec.cardNumber) continue;
                    if (!condOk(playerId, role.instanceId)) continue;
                    matches.push({
                      sourceCardInstanceId: role.instanceId,
                      sourceCardNumber: spec.cardNumber,
                      controllerPlayerId: playerId,
                      label: trig.label,
                      triggerContext: { blockerCardId: blockerId, attackerCardId: event.targetCardId },
                    });
                  }
                }
                return matches;
              }
              case 'SELF_TURN_END': {
                const activePid = event.playerId ?? state.activePlayerId;
                const targetPid = trig.matcher.isSelfTurn
                  ? activePid
                  : activePid === state.activePlayerId
                    ? state.nonActivePlayerId
                    : state.activePlayerId;
                const matches = [];
                for (const slot of fieldMgr.getSlots(targetPid)) {
                  if (!slot.roleCardId) continue;
                  const role = state.cards[slot.roleCardId];
                  if (!role || role.cardNumber !== spec.cardNumber) continue;
                  if (!condOk(targetPid, role.instanceId)) continue;
                  matches.push({
                    sourceCardInstanceId: role.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: targetPid,
                    label: trig.label.replace('{slot}', String((role.slotIndex ?? 0) + 1)),
                    triggerContext: {},
                  });
                }
                return matches;
              }
              case 'SELF_BECAME_PARTNER': {
                const hostId = event.cardInstanceId;
                const partnerId = event.targetCardId;
                if (!hostId || !partnerId) return [];
                const host = state.cards[hostId];
                const partner = state.cards[partnerId];
                if (!host || !partner || partner.cardNumber !== spec.cardNumber) return [];
                if (trig.matcher.onlyOpponentTurn && state.activePlayerId === partner.controllerPlayerId) {
                  return [];
                }
                if (trig.matcher.requiredHostTrait && !this.hasTrait(host, trig.matcher.requiredHostTrait)) {
                  return [];
                }
                if (
                  trig.matcher.requiredHostName &&
                  !continuousEffects.hasCardName(host.instanceId, trig.matcher.requiredHostName)
                ) {
                  return [];
                }
                if (!condOk(partner.controllerPlayerId, partner.instanceId)) return [];
                return [
                  {
                    sourceCardInstanceId: partner.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: partner.controllerPlayerId,
                    label: trig.label,
                    triggerContext: { hostCardId: host.instanceId, partnerCardId: partner.instanceId },
                  },
                ];
              }
            }
          },
          execute: (pending) => {
            if (trig.condition && !this.evalCondition(trig.condition, pending.controllerPlayerId, pending.sourceCardInstanceId, {})) {
              return;
            }
            const initialVars: Record<string, string[]> = {};
            const attackerId = pending.triggerContext.attackerCardId as string | undefined;
            const blockerId = pending.triggerContext.blockerCardId as string | undefined;
            const hostId = pending.triggerContext.hostCardId as string | undefined;
            const onceKey =
              (pending.triggerContext.oncePerTurnKey as string | undefined) ??
              pending.oncePerTurnKey ??
              `${pending.sourceCardInstanceId}:${pending.abilityId}`;
            if (attackerId) initialVars.__triggerAttacker = [attackerId];
            if (blockerId) initialVars.__triggerBlocker = [blockerId];
            if (hostId) initialVars.__triggerHost = [hostId];
            initialVars.__oncePerTurnKey = [onceKey];
            this.executeWithCost(
              spec.cardNumber,
              pending.sourceCardInstanceId,
              pending.controllerPlayerId,
              trig.cost,
              trig.steps,
              false,
              initialVars
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
        const hasNonStat = Boolean(
          eff.keywords?.length ||
            eff.addTraits?.length ||
            eff.prohibitions?.length ||
            eff.treatedAsOrbColors?.length ||
            eff.orbValue !== undefined ||
            eff.treatedAsNames?.length ||
            eff.unblockableMaxPP !== undefined ||
            eff.canDualEquipFengren === true
        );
        const hasStat =
          eff.pp !== undefined ||
          eff.setPP !== undefined ||
          eff.dp !== undefined ||
          eff.setDP !== undefined ||
          eff.charge !== undefined ||
          eff.setCharge !== undefined;

        const matchesTargetAndCond = (
          source: CardInstance,
          target: CardInstance,
          ctx: Parameters<Parameters<ContinuousEffectEngine['registerStaticRule']>[0]['evaluate']>[2]
        ): boolean => {
          if (eff.scope === 'SELF') {
            if (source.instanceId !== target.instanceId) return false;
            if (eff.selfFilter && !this.matchesFilterSafe(target, eff.selfFilter, ctx.hasCardTrait)) return false;
          } else if (eff.scope === 'PARTNER_HOST') {
            if (source.partnerOfCardId !== target.instanceId) return false;
            if (eff.targetFilter && !this.matchesFilterSafe(target, eff.targetFilter, ctx.hasCardTrait)) return false;
          } else if (eff.scope === 'UNDERNEATH_HOST') {
            if (!(target.underneathCardIds ?? []).includes(source.instanceId)) return false;
            if (eff.targetFilter && !this.matchesFilterSafe(target, eff.targetFilter, ctx.hasCardTrait)) return false;
          } else {
            if (source.controllerPlayerId !== target.controllerPlayerId) return false;
            if (eff.targetFilter && !this.matchesFilterSafe(target, eff.targetFilter, ctx.hasCardTrait)) return false;
          }
          if (
            eff.condition &&
            !this.evalStaticCondition(
              eff.condition,
              source.controllerPlayerId,
              source.instanceId,
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

        const sourceKind =
          eff.scope === 'PARTNER_HOST'
            ? ('PARTNER' as const)
            : eff.scope === 'UNDERNEATH_HOST'
              ? ('UNDERNEATH' as const)
              : ('FIELD_ROLE' as const);

        if (hasNonStat) {
          continuousEffects.registerStaticRule({
            id: `dsl:${eff.id}:nonstat`,
            layer: 'NON_STAT',
            sourceKind,
            providesTraits: Boolean(eff.addTraits?.length),
            dependsOnTraits: eff.dependsOnTraits,
            matchSource: (src) => src.cardNumber === spec.cardNumber,
            evaluate: (source, target, ctx) => {
              if (!matchesTargetAndCond(source, target, ctx)) return undefined;
              return {
                ...(eff.keywords ? { keywords: eff.keywords } : {}),
                ...(eff.addTraits ? { addTraits: eff.addTraits } : {}),
                ...(eff.prohibitions ? { prohibitions: eff.prohibitions } : {}),
                ...(eff.treatedAsOrbColors ? { treatedAsOrbColors: eff.treatedAsOrbColors } : {}),
                ...(eff.orbValue !== undefined ? { orbValue: eff.orbValue } : {}),
                ...(eff.treatedAsNames ? { treatedAsNames: eff.treatedAsNames } : {}),
                ...(eff.unblockableMaxPP !== undefined ? { unblockableMaxPP: eff.unblockableMaxPP } : {}),
                ...(eff.canDualEquipFengren ? { canDualEquipFengren: true } : {}),
              };
            },
          });
        }

        if (hasStat) {
          continuousEffects.registerStaticRule({
            id: `dsl:${eff.id}:stat`,
            layer: 'STAT',
            sourceKind,
            dependsOnTraits: eff.dependsOnTraits,
            matchSource: (src) => src.cardNumber === spec.cardNumber,
            evaluate: (source, target, ctx) => {
              if (!matchesTargetAndCond(source, target, ctx)) return undefined;
              const pp =
                eff.pp !== undefined ? this.evalNumberExpr(eff.pp, source.controllerPlayerId, source.instanceId) : undefined;
              const setPP =
                eff.setPP !== undefined ? this.evalNumberExpr(eff.setPP, source.controllerPlayerId, source.instanceId) : undefined;
              const dp =
                eff.dp !== undefined ? this.evalNumberExpr(eff.dp, source.controllerPlayerId, source.instanceId) : undefined;
              const setDP =
                eff.setDP !== undefined ? this.evalNumberExpr(eff.setDP, source.controllerPlayerId, source.instanceId) : undefined;
              const charge =
                eff.charge !== undefined
                  ? this.evalNumberExpr(eff.charge, source.controllerPlayerId, source.instanceId)
                  : undefined;
              const setCharge =
                eff.setCharge !== undefined
                  ? this.evalNumberExpr(eff.setCharge, source.controllerPlayerId, source.instanceId)
                  : undefined;
              return {
                ...(pp !== undefined ? { pp } : {}),
                ...(setPP !== undefined ? { setPP } : {}),
                ...(dp !== undefined ? { dp } : {}),
                ...(setDP !== undefined ? { setDP } : {}),
                ...(charge !== undefined ? { charge } : {}),
                ...(setCharge !== undefined ? { setCharge } : {}),
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
          if (pending.optional) {
            if (remaining.length > 0) {
              this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
            }
            return { success: true };
          }
          return { success: false, error: '必须支付丢弃手牌代价' };
        }
        for (const id of selected) {
          this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
        }
        if (pending.savePaidToVar) vars[pending.savePaidToVar] = [...selected];
        if (pending.markUsed) this.markUsed(playerId, pending.markUsedKey ?? sourceCardInstanceId);
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, [...pending.onPaid, ...remaining]);
        return { success: true };
      }

      case 'COST_ORB': {
        const group = selected[0];
        if (!group || group === 'skip') {
          if (pending.optional) {
            if (remaining.length > 0) {
              this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
            }
            return { success: true };
          }
          return { success: false, error: '必须支付消除信号球代价' };
        }
        const paidIds = group.split(',');
        this.eliminate(playerId, paidIds);
        if (pending.savePaidToVar) vars[pending.savePaidToVar] = [...paidIds];
        if (pending.markUsed) this.markUsed(playerId, pending.markUsedKey ?? sourceCardInstanceId);
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
        if (pending.markUsed) this.markUsed(playerId, pending.markUsedKey ?? sourceCardInstanceId);
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, [...pending.onPaid, ...remaining]);
        return { success: true };
      }

      case 'COST_TAP_FIELD': {
        if (selected.length === 0) {
          if (pending.optional) {
            if (remaining.length > 0) {
              this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
            }
            return { success: true };
          }
          return { success: false, error: '必须横置我方战场1张牌作为代价' };
        }
        const tapId = selected[0]!;
        const tapCard = this.ctx.state.cards[tapId];
        if (!tapCard || !tapCard.isReady) {
          return { success: false, error: '所选战场卡牌不可横置' };
        }
        tapCard.isReady = false;
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, [...pending.onPaid, ...remaining]);
        return { success: true };
      }

      case 'CONFIRM_YES_NO': {
        const branch = selected[0] === 'opt_yes' ? pending.onYes : (pending.onNo ?? []);
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, [...branch, ...remaining]);
        return { success: true };
      }

      case 'CHOOSE_MODE': {
        const modeMap = new Map(pending.modes.map((m) => [m.id, m.steps]));
        const chosenSteps: EffectStep[] = [];
        for (const modeId of selected) {
          const steps = modeMap.get(modeId);
          if (steps) chosenSteps.push(...steps);
        }
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, [...chosenSteps, ...remaining]);
        return { success: true };
      }

      case 'SAVE_CHOICE': {
        if (pending.requireEmptySlotCount && selected.length > this.emptySlotCount(playerId)) {
          return {
            success: false,
            error: `战场空余卡位不足，最多只能出场 ${this.emptySlotCount(playerId)} 张角色`,
          };
        }
        if (pending.maxTotalCost !== undefined && selected.length > 0) {
          let totalCost = 0;
          for (const id of selected) {
            const card = this.ctx.state.cards[id];
            const def = card ? this.def(card) : undefined;
            if (!def) continue;
            // 支持牌组中费用减免 (如 BP01-002 露西亚·鸦羽：若场上有<里>和<丽芙>手牌和牌组费用-3)
            const discount =
              def.cardNumber === 'BP01-002' ? this.calculateHandCostDiscount(playerId, def.cardNumber) : 0;
            totalCost += Math.max(0, def.cost - discount);
          }
          if (totalCost > pending.maxTotalCost) {
            return {
              success: false,
              error: `所选卡牌费用合计 (${totalCost}) 超过了上限 ${pending.maxTotalCost}`,
            };
          }
        }
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

      case 'PLACE_ORB_AT_POSITION': {
        const idx = Number(selected[0] ?? '0');
        const safeIdx = Number.isFinite(idx) ? idx : 0;
        this.ctx.zoneMgr.insertCardIntoZoneAtIndex(pending.cardInstanceId, 'SIGNAL_ORB', safeIdx, {
          isFaceUp: true,
          isReady: true,
        });
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
        return { success: true };
      }

      case 'WANSHIMING_REVEAL_TO_COST': {
        const movedSet = new Set<string>();
        for (const id of selected) {
          const card = this.ctx.state.cards[id];
          if (!card || card.zone !== 'PROCESSING') continue;
          // 3.6.4 / Q&A·5：以横置状态放置到费用区，费用区满 10 张时 ZoneManager 自动改放墓地
          this.ctx.zoneMgr.moveCard(id, 'COST', { isFaceUp: true, isReady: false });
          this.ctx.zoneMgr.syncCostStats(card.controllerPlayerId);
          movedSet.add(id);
        }
        if (movedSet.size > 0 && vars[pending.revealVar]) {
          vars[pending.revealVar] = vars[pending.revealVar]!.filter((id) => !movedSet.has(id));
        }
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
        return { success: true };
      }

      case 'CHOOSE_ACTIVATED_ABILITY': {
        const picked = pending.entries.find((e) => e.id === selected[0]);
        if (!picked) {
          return { success: false, error: '未找到所选的起动能力' };
        }
        return this.executeWithCost(
          picked.cardNumber,
          sourceCardInstanceId,
          playerId,
          picked.cost,
          picked.steps,
          picked.oncePerTurn,
          vars,
          picked.usageKey
        );
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
    markUsed: boolean,
    initialVars: Record<string, string[]> = {},
    markUsedKey?: string
  ): Result {
    const vars = { ...initialVars };
    const effectiveUsageKey = markUsedKey ?? sourceId;
    if (!cost) {
      if (markUsed) this.markUsed(playerId, effectiveUsageKey);
      this.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
      return { success: true };
    }

    switch (cost.kind) {
      case 'TAP_SELF': {
        const card = this.ctx.state.cards[sourceId];
        if (!card || !card.isReady) {
          return { success: false, error: '该牌已横置，无法支付「横置该牌」的代价' };
        }
        card.isReady = false;
        if (markUsed) this.markUsed(playerId, effectiveUsageKey);
        this.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
        return { success: true };
      }

      case 'TAP_SELF_AND_DISCARD_HAND': {
        const card = this.ctx.state.cards[sourceId];
        if (!card || !card.isReady) {
          return { success: false, error: '该牌已横置，无法支付「横置该牌」的代价' };
        }
        const hand = this.zone(playerId, 'HAND').filter(
          (c) => !cost.filter || this.matchesFilter(c, cost.filter, sourceId)
        );
        if (hand.length < cost.count) {
          return { success: false, error: `符合条件的手牌不足 ${cost.count} 张，无法支付丢弃代价 (8.4.2.b)` };
        }
        card.isReady = false;
        const effectType = cost.choiceEffectType ?? 'PRESET_DISCARD_COST';
        const promptBase = cost.prompt ?? `请选择 ${cost.count} 张手牌丢弃作为代价`;
        this.enqueueDslChoice(
          {
            id: this.choiceId('tap-discard-cost'),
            playerId,
            choiceType: 'SELECT_CARDS',
            prompt: promptBase,
            options: hand.map((c) => this.effects.createGeneralCardChoiceOption(c)),
            effectType,
            sourceCardInstanceId: sourceId,
            minSelections: cost.count,
            maxSelections: cost.count,
          },
          {
            cardNumber,
            sourceCardInstanceId: sourceId,
            playerId,
            vars,
            remainingSteps: [],
            pendingAction: {
              kind: 'COST_DISCARD',
              onPaid: [...steps],
              optional: false,
              markUsed,
              markUsedKey: effectiveUsageKey,
            },
          }
        );
        return { success: true };
      }

      case 'TAP_SELF_AND_ELIMINATE_ORBS': {
        const card = this.ctx.state.cards[sourceId];
        if (!card || !card.isReady) {
          return { success: false, error: '该牌已横置，无法支付「横置该牌」的代价' };
        }
        const groups = this.orbGroups(playerId, cost.count, cost.filter);
        if (groups.length === 0) {
          return { success: false, error: '信号球区没有满足代价的相邻信号球，无法发动 (8.4.2.b)' };
        }
        card.isReady = false;
        if (groups.length === 1) {
          this.eliminate(playerId, groups[0]!);
          if (markUsed) this.markUsed(playerId, effectiveUsageKey);
          this.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
          return { success: true };
        }
        const effectType = cost.choiceEffectType ?? 'PRESET_ORB_COST';
        this.enqueueDslChoice(
          {
            id: this.choiceId('tap-orb-cost'),
            playerId,
            choiceType: 'SELECT_OPTION',
            prompt: cost.prompt ?? '选择要消除的信号球 (起动能力的代价)',
            options: groups.map((g) => ({
              id: g.join(','),
              label: `消除 ${g.map((id) => this.def(this.ctx.state.cards[id]!)?.name ?? id).join('、')}`,
            })),
            effectType,
            sourceCardInstanceId: sourceId,
            minSelections: 1,
            maxSelections: 1,
          },
          {
            cardNumber,
            sourceCardInstanceId: sourceId,
            playerId,
            vars,
            remainingSteps: [],
            pendingAction: {
              kind: 'COST_ORB',
              onPaid: [...steps],
              optional: false,
              markUsed,
              markUsedKey: effectiveUsageKey,
            },
          }
        );
        return { success: true };
      }

      case 'SELF_TO_DECK_BOTTOM': {
        const card = this.ctx.state.cards[sourceId];
        if (!card || card.zone !== 'BATTLEFIELD') {
          return { success: false, error: '该牌不在战场，无法支付「放置到牌组底」的代价' };
        }
        this.ctx.zoneMgr.moveCardToBottomOfDeck(sourceId);
        if (markUsed) this.markUsed(playerId, effectiveUsageKey);
        this.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
        return { success: true };
      }

      case 'PAY_COST': {
        if (!this.ctx.payCost(playerId, cost.amount)) {
          return { success: false, error: `费用不足，需要支付 ${cost.amount} 费` };
        }
        if (markUsed) this.markUsed(playerId, effectiveUsageKey);
        this.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
        return { success: true };
      }

      case 'DISCARD_HAND': {
        const hand = this.zone(playerId, 'HAND').filter(
          (c) => !cost.filter || this.matchesFilter(c, cost.filter, sourceId)
        );
        const optional = Boolean(cost.optional);
        if (hand.length < cost.count) {
          return optional
            ? { success: true }
            : { success: false, error: `符合条件的手牌不足 ${cost.count} 张，无法支付丢弃代价 (8.4.2.b)` };
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
            vars,
            remainingSteps: [],
            pendingAction: {
              kind: 'COST_DISCARD',
              onPaid: [...steps],
              optional,
              markUsed,
              markUsedKey: effectiveUsageKey,
            },
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
          if (cost.savePaidToVar) vars[cost.savePaidToVar] = [...groups[0]!];
          if (markUsed) this.markUsed(playerId, effectiveUsageKey);
          this.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
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
            vars,
            remainingSteps: [],
            pendingAction: {
              kind: 'COST_ORB',
              onPaid: [...steps],
              optional,
              markUsed,
              markUsedKey: effectiveUsageKey,
              savePaidToVar: cost.savePaidToVar,
            },
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
            vars,
            remainingSteps: [],
            pendingAction: {
              kind: 'COST_ORB_OR_DISCARD',
              onPaid: [...steps],
              optional,
              markUsed,
              markUsedKey: effectiveUsageKey,
            },
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
          const revealedIds = this.revealTop(targetPlayer, step.count);
          vars[step.saveToVar] = revealedIds;
          // BP01-037 万世铭 / BP01-038 万世铭·重铸：因<曲>角色公开进入处理区时，可选改为横置放置到费用区 (Q&A·5)
          const srcCard = sourceId ? this.ctx.state.cards[sourceId] : undefined;
          const srcDef = srcCard ? this.def(srcCard) : undefined;
          const isQuRole =
            Boolean(srcCard && srcDef?.cardType === 'ROLE') &&
            (Boolean(srcCard && this.hasTrait(srcCard, '曲')) || Boolean(srcDef?.name.includes('曲')));
          if (isQuRole) {
            const wanshimingCards = revealedIds
              .map((id) => this.ctx.state.cards[id])
              .filter(
                (c): c is CardInstance =>
                  Boolean(
                    c &&
                      c.zone === 'PROCESSING' &&
                      (c.cardNumber === 'BP01-037' || c.cardNumber === 'BP01-038')
                  )
              );
            if (wanshimingCards.length > 0) {
              this.enqueueDslChoice(
                {
                  id: this.choiceId('wanshiming-reveal-cost'),
                  playerId: targetPlayer,
                  choiceType: 'SELECT_CARDS',
                  prompt: '公开的《万世铭》/《万世铭·重铸》因<曲>角色进入处理区，可选择任意张改为以横置状态放置到费用区（满10张时改放墓地）：',
                  options: wanshimingCards.map((c) => this.effects.createGeneralCardChoiceOption(c)),
                  effectType: 'BP01_WANSHIMING_REVEAL_TO_COST',
                  sourceCardInstanceId: sourceId,
                  minSelections: 0,
                  maxSelections: wanshimingCards.length,
                },
                {
                  cardNumber,
                  sourceCardInstanceId: sourceId,
                  playerId,
                  vars,
                  remainingSteps: queue,
                  pendingAction: { kind: 'WANSHIMING_REVEAL_TO_COST', revealVar: step.saveToVar },
                }
              );
              return;
            }
          }
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
          const allRoles =
            step.side === 'ANY'
              ? [...this.roles(playerId), ...this.roles(this.resolveSide(playerId, 'OPPONENT'))]
              : this.roles(this.resolveSide(playerId, step.side));
          const candidates = allRoles.filter((r) => !step.filter || this.matchesFilter(r, step.filter, sourceId));
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
          const zonesToScan = step.zones && step.zones.length > 0 ? step.zones : [step.zone];
          const rawPool: CardInstance[] = [];
          const seenIds = new Set<string>();
          for (const z of zonesToScan) {
            if (z === 'BATTLEFIELD') {
              for (const slot of this.ctx.fieldMgr.getSlots(targetPlayer)) {
                const topIds = [slot.roleCardId, slot.assistCardId, slot.standaloneEquipmentId].filter(
                  (id): id is string => Boolean(id)
                );
                for (const id of topIds) {
                  if (!seenIds.has(id) && this.ctx.state.cards[id]) {
                    seenIds.add(id);
                    rawPool.push(this.ctx.state.cards[id]!);
                  }
                }
                if (!step.topLevelOnly && slot.roleCardId) {
                  const role = this.ctx.state.cards[slot.roleCardId];
                  for (const eqId of getAttachedEquipmentIds(role)) {
                    if (!seenIds.has(eqId) && this.ctx.state.cards[eqId]) {
                      seenIds.add(eqId);
                      rawPool.push(this.ctx.state.cards[eqId]!);
                    }
                  }
                }
              }
            } else {
              for (const c of this.zone(targetPlayer, z)) {
                if (!seenIds.has(c.instanceId)) {
                  seenIds.add(c.instanceId);
                  rawPool.push(c);
                }
              }
            }
          }
          const candidates = rawPool.filter((c) => !step.filter || this.matchesFilter(c, step.filter, sourceId));
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
          const slotCap = step.requireEmptySlot ? this.emptySlotCount(playerId) : eligibleCount;
          const max = Math.min(step.max ?? 1, eligibleCount, slotCap);
          const min = Math.min(step.min ?? 1, max);
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
                maxTotalCost: step.maxTotalCost,
                requireEmptySlotCount: Boolean(step.requireEmptySlot && (step.max ?? 1) > 1),
              },
            },
            { revealed: ids }
          );
          return;
        }

        case 'CHOOSE_MODE': {
          let min = step.min ?? 1;
          let max = step.max ?? 1;
          if (step.pickCountExpr !== undefined) {
            const count = Math.min(
              step.modes.length,
              Math.max(0, Math.floor(this.evalNumberExpr(step.pickCountExpr, playerId, sourceId, vars)))
            );
            if (count <= 0) break;
            if (count === step.modes.length) {
              // 须全选且不可重复时直接按顺序执行全部模式
              const allSteps: EffectStep[] = [];
              for (const m of step.modes) allSteps.push(...m.steps);
              queue.unshift(...allSteps);
              break;
            }
            min = count;
            max = count;
          }
          const effectType = step.choiceEffectType ?? `DSL_CHOOSE_MODE_${cardNumber}`;
          this.enqueueDslChoice(
            {
              id: this.choiceId(effectType),
              playerId,
              choiceType: 'SELECT_OPTION',
              prompt: this.formatPrompt(step.prompt, playerId, { pickCount: max }),
              options: step.modes.map((m) => ({ id: m.id, label: m.label })),
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
                kind: 'CHOOSE_MODE',
                modes: step.modes.map((m) => ({ id: m.id, steps: m.steps })),
              },
            }
          );
          return;
        }

        case 'ELIMINATE_ORB_COST': {
          const groups = this.orbGroups(playerId, step.count, step.filter);
          const optional = Boolean(step.optional);
          if (groups.length === 0) {
            break;
          }
          if (!optional && groups.length === 1) {
            this.eliminate(playerId, groups[0]!);
            if (step.savePaidToVar) vars[step.savePaidToVar] = [...groups[0]!];
            queue.unshift(...step.onPaid);
            break;
          }
          const effectType = step.choiceEffectType ?? `DSL_ORB_COST_${cardNumber}`;
          const options = [
            ...(optional ? [{ id: 'skip', label: '不消除信号球' }] : []),
            ...groups.map((g) => ({
              id: g.join(','),
              label: `消除 ${g.map((id) => this.def(this.ctx.state.cards[id]!)?.name ?? id).join('、')}`,
            })),
          ];
          this.enqueueDslChoice(
            {
              id: this.choiceId('step-orb-cost'),
              playerId,
              choiceType: 'SELECT_OPTION',
              prompt: this.formatPrompt(step.prompt ?? '选择要消除的信号球', playerId),
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
              vars,
              remainingSteps: queue,
              pendingAction: {
                kind: 'COST_ORB',
                onPaid: [...step.onPaid],
                optional,
                savePaidToVar: step.savePaidToVar,
              },
            }
          );
          return;
        }

        case 'DISCARD_COST_STEP': {
          const hand = this.zone(playerId, 'HAND').filter(
            (c) => !step.filter || this.matchesFilter(c, step.filter, sourceId)
          );
          const optional = Boolean(step.optional);
          const requiredMin = step.minCount ?? step.count;
          if (hand.length < requiredMin || hand.length === 0) {
            break;
          }
          const maxDiscard = Math.min(step.count, hand.length);
          const minDiscard = optional ? 0 : Math.min(requiredMin, maxDiscard);
          const effectType = step.choiceEffectType ?? `DSL_DISCARD_COST_${cardNumber}`;
          const promptBase = step.prompt ?? `请选择 ${step.count} 张手牌丢弃作为代价`;
          this.enqueueDslChoice(
            {
              id: this.choiceId('step-discard-cost'),
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: optional ? `${promptBase} (不选择则不发动)` : promptBase,
              options: hand.map((c) => this.effects.createGeneralCardChoiceOption(c)),
              effectType,
              sourceCardInstanceId: sourceId,
              minSelections: minDiscard,
              maxSelections: maxDiscard,
            },
            {
              cardNumber,
              sourceCardInstanceId: sourceId,
              playerId,
              vars,
              remainingSteps: queue,
              pendingAction: {
                kind: 'COST_DISCARD',
                onPaid: [...step.onPaid],
                optional,
                savePaidToVar: step.savePaidToVar,
              },
            }
          );
          return;
        }

        case 'TAP_FIELD_CARD_COST_STEP': {
          // Q&A·2/7 (BP01-023)：只能横置我方战场卡位上的竖直顶层卡牌 (角色/辅助机/单独装备)，不可横置装备中或下方的牌
          const readyTopCards: CardInstance[] = [];
          for (const slot of this.ctx.fieldMgr.getSlots(playerId)) {
            for (const id of [slot.roleCardId, slot.assistCardId, slot.standaloneEquipmentId]) {
              if (!id) continue;
              const c = this.ctx.state.cards[id];
              if (c && c.isReady) readyTopCards.push(c);
            }
          }
          if (readyTopCards.length === 0) break;
          const optional = step.optional !== false;
          const effectType = step.choiceEffectType ?? `DSL_TAP_FIELD_COST_${cardNumber}`;
          const promptBase = step.prompt ?? '请选择我方战场 1 张竖直状态的卡牌横置作为代价';
          this.enqueueDslChoice(
            {
              id: this.choiceId('tap-field-cost'),
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: optional ? `${promptBase} (不选择则不发动)` : promptBase,
              options: readyTopCards.map((c) => this.effects.createGeneralCardChoiceOption(c)),
              effectType,
              sourceCardInstanceId: sourceId,
              minSelections: optional ? 0 : 1,
              maxSelections: 1,
            },
            {
              cardNumber,
              sourceCardInstanceId: sourceId,
              playerId,
              vars,
              remainingSteps: queue,
              pendingAction: {
                kind: 'COST_TAP_FIELD',
                onPaid: [...step.onPaid],
                optional,
              },
            }
          );
          return;
        }

        case 'EQUIP_FROM_VAR': {
          const eqIds = vars[step.varName] ?? [];
          const hostId = this.resolveTargetIds(step.host, playerId, sourceId, vars)[0];
          if (hostId) {
            for (const eqId of eqIds) {
              if (this.ctx.fieldMgr.equipToRole(playerId, eqId, hostId)) {
                const eqCard = this.ctx.state.cards[eqId];
                const eqDef = eqCard ? this.def(eqCard) : undefined;
                if (eqDef) {
                  this.effects.handleEquipmentBuff(hostId, eqDef);
                  if (this.handlesEntry(eqDef.cardNumber)) {
                    this.enter(playerId, eqId, eqDef);
                  }
                }
              }
            }
          }
          break;
        }

        case 'PLACE_ORB_AT_POSITION': {
          const orbId = (vars[step.varName] ?? [])[0];
          if (!orbId) break;
          const orbZone = this.zone(playerId, 'SIGNAL_ORB');
          if (orbZone.length === 0) {
            this.ctx.zoneMgr.moveCard(orbId, 'SIGNAL_ORB', { isFaceUp: true, isReady: true });
            break;
          }
          const options: { id: string; label: string }[] = [];
          for (let pos = 0; pos <= orbZone.length; pos++) {
            const label =
              pos === 0
                ? '放置到信号球区最下方 (位置 1)'
                : pos === orbZone.length
                  ? `放置到信号球区最上方 (位置 ${pos + 1})`
                  : `放置到第 ${pos + 1} 位 (在【${this.def(orbZone[pos - 1]!)?.name ?? pos}】上方)`;
            options.push({ id: String(pos), label });
          }
          const effectType = step.choiceEffectType ?? `DSL_PLACE_ORB_POS_${cardNumber}`;
          this.enqueueDslChoice(
            {
              id: this.choiceId('place-orb-pos'),
              playerId,
              choiceType: 'SELECT_OPTION',
              prompt: step.prompt ?? '请选择将该信号球放置到我方信号球区的哪个位置：',
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
              vars,
              remainingSteps: queue,
              pendingAction: { kind: 'PLACE_ORB_AT_POSITION', cardInstanceId: orbId },
            }
          );
          return;
        }

        case 'SHUFFLE_DECK': {
          const targetPlayer = this.resolveSide(playerId, step.side ?? 'SELF');
          this.ctx.zoneMgr.shuffleDeck(targetPlayer);
          break;
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
          const ownersToShuffle = new Set<string>();
          for (const id of targets) {
            const card = this.ctx.state.cards[id];
            if (!card) continue;
            if (step.toZone === 'BATTLEFIELD') {
              if (this.bringToField(playerId, id, step.triggerEntry !== false, Boolean(step.enterTapped))) {
                moved.push(id);
              }
            } else if (step.toZone === 'DECK_BOTTOM') {
              // 公开剩余卡牌只移动仍在处理区的牌
              if (step.target.kind === 'REST_OF_VAR' && card.zone !== 'PROCESSING') continue;
              this.ctx.zoneMgr.moveCardToBottomOfDeck(id);
              moved.push(id);
            } else if (step.toZone === 'DECK_TOP') {
              if (step.target.kind === 'REST_OF_VAR' && card.zone !== 'PROCESSING') continue;
              this.ctx.zoneMgr.moveCardToTopOfDeck(id);
              moved.push(id);
            } else if (step.toZone === 'DECK_SHUFFLE') {
              if (step.target.kind === 'REST_OF_VAR' && card.zone !== 'PROCESSING') continue;
              this.ctx.zoneMgr.moveCard(id, 'DECK', { isFaceUp: false });
              ownersToShuffle.add(card.ownerPlayerId);
              moved.push(id);
            } else if (step.toZone === 'SIGNAL_ORB_BOTTOM') {
              if (step.target.kind === 'REST_OF_VAR' && card.zone !== 'PROCESSING') continue;
              this.ctx.zoneMgr.moveCard(id, 'SIGNAL_ORB', { isFaceUp: step.isFaceUp ?? true, toBottom: true });
              moved.push(id);
            } else if (step.toZone === 'COST') {
              if (step.target.kind === 'REST_OF_VAR' && card.zone !== 'PROCESSING' && card.zone !== 'GRAVEYARD') continue;
              this.ctx.zoneMgr.moveCard(id, 'COST', {
                isFaceUp: step.isFaceUp ?? false,
                isReady: step.isReady ?? true,
              });
              this.ctx.zoneMgr.syncCostStats(card.controllerPlayerId);
              moved.push(id);
            } else if (step.toZone === 'UNDERNEATH') {
              if (!step.underneathHost) continue;
              const hostId = this.resolveTargetIds(step.underneathHost, playerId, sourceId, vars)[0];
              const host = hostId ? this.ctx.state.cards[hostId] : undefined;
              if (!host || host.zone !== 'BATTLEFIELD' || host.instanceId === id) continue;
              // 若目标牌原本在战场占位，先清空其原卡位占位 (不视为离场破坏)
              if (card.zone === 'BATTLEFIELD') {
                for (const s of this.ctx.fieldMgr.getSlots(card.controllerPlayerId)) {
                  if (s.roleCardId === id) s.roleCardId = undefined;
                }
                card.slotIndex = undefined;
              } else {
                this.ctx.zoneMgr.moveCard(id, 'BATTLEFIELD', { isFaceUp: true, isReady: true });
              }
              card.isFaceUp = true;
              card.slotIndex = undefined;
              if (!host.underneathCardIds.includes(id)) {
                host.underneathCardIds.push(id);
              }
              moved.push(id);
            } else {
              if (step.target.kind === 'REST_OF_VAR' && card.zone !== 'PROCESSING') continue;
              this.ctx.zoneMgr.moveCard(id, step.toZone, { isFaceUp: step.isFaceUp ?? true });
              moved.push(id);
            }
          }
          for (const ownerId of ownersToShuffle) {
            this.ctx.zoneMgr.shuffleDeck(ownerId);
          }
          if (step.saveMovedToVar) vars[step.saveMovedToVar] = moved;
          break;
        }

        case 'ASCEND_FROM_VAR': {
          const cardId = (vars[step.cardVar] ?? [])[0];
          const targetId = (vars[step.targetVar] ?? [])[0];
          const extraId = step.extraStackVar ? (vars[step.extraStackVar] ?? [])[0] : undefined;
          if (cardId && targetId) {
            const ok = this.ctx.fieldMgr.playAscensionCard(playerId, cardId, targetId, {
              extraStackRoleCardId: extraId,
            });
            if (ok) {
              const ascDef = this.def(this.ctx.state.cards[cardId]!);
              if (ascDef) this.effects.handleRoleEntryEffect(playerId, cardId, ascDef);
            }
          }
          if (step.shuffleDeckAfter) {
            this.ctx.zoneMgr.shuffleDeck(playerId);
          }
          break;
        }

        case 'DEAL_DAMAGE': {
          const targetPlayer = this.resolveSide(playerId, step.side);
          this.ctx.zoneMgr.applyDamageToPlayer(targetPlayer, step.amount);
          break;
        }

        case 'MARK_GAME_ABILITY_USED': {
          const player = this.ctx.state.players[playerId];
          if (player) {
            player.gameAbilityUsage[step.abilityKey] = (player.gameAbilityUsage[step.abilityKey] ?? 0) + 1;
          }
          break;
        }

        case 'MARK_TURN_ABILITY_USED': {
          const player = this.ctx.state.players[playerId];
          if (player) {
            const key =
              step.abilityKey === '__TRIGGER_ONCE_KEY__' && vars.__oncePerTurnKey?.[0]
                ? vars.__oncePerTurnKey[0]
                : `${sourceId}:${step.abilityKey}`;
            player.turnAbilityUsage[key] = (player.turnAbilityUsage[key] ?? 0) + 1;
          }
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
          const syncCostPlayers = new Set<string>();
          for (const id of targets) {
            const card = this.ctx.state.cards[id];
            if (!card) continue;
            if (step.target.kind === 'SELF' && !this.ctx.fieldMgr.isSlotRole(playerId, id)) continue;
            card.isReady = step.isReady;
            if (card.zone === 'COST') syncCostPlayers.add(card.controllerPlayerId);
          }
          for (const pid of syncCostPlayers) {
            this.ctx.zoneMgr.syncCostStats(pid);
          }
          break;
        }

        case 'SET_FROZEN': {
          // 10.15 冰冻：被冰冻卡牌在下个操控玩家竖直阶段无法因规则竖直 (10.15.3.1 已冰冻则维持现状)
          const targets = this.resolveTargetIds(step.target, playerId, sourceId, vars);
          for (const id of targets) {
            const card = this.ctx.state.cards[id];
            if (!card || card.zone !== 'BATTLEFIELD') continue;
            card.isFrozen = step.isFrozen ? true : undefined;
          }
          break;
        }

        case 'PREVENT_COMBAT_DAMAGE': {
          // 1.3.3 / Q&A·7 (PR-034)：本次攻击不会给予玩家伤害 (含【贯通】伤害)
          if (this.ctx.state.currentCombat) {
            this.ctx.state.currentCombat.cannotDealDamage = true;
          }
          break;
        }

        case 'AIRBORNE': {
          // 10.18 将目标角色【浮空】到处理区成为【浮空模式】
          const targets = this.resolveTargetIds(step.target, playerId, sourceId, vars);
          const airborned: string[] = [];
          for (const id of targets) {
            if (this.ctx.fieldMgr.airborneRole(id)) airborned.push(id);
          }
          if (step.saveAirborneToVar) vars[step.saveAirborneToVar] = airborned;
          break;
        }

        case 'ATTACH_PARTNER': {
          // 8.13.3.d.1 通过卡牌能力使指定卡牌成为协战搭档 (可不满足协战搭档条件，不计入回合协战次数)
          const hosts = this.resolveTargetIds(step.host, playerId, sourceId, vars);
          const partners = this.resolveTargetIds(step.partner, playerId, sourceId, vars);
          const hostId = hosts[0];
          const partnerId = partners[0];
          if (hostId && partnerId && this.ctx.fieldMgr.attachPartner(playerId, hostId, partnerId)) {
            this.ctx.triggerMgr?.emit({
              type: 'PARTNER_GAINED',
              playerId,
              cardInstanceId: hostId,
              targetCardId: partnerId,
            });
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
              ...(step.duration === 'END_OF_COMBAT'
                ? { id: `combat-${card.instanceId}-${this.ctx.events.length}-${this.choiceSeq++}` }
                : {}),
              ...(step.pp !== undefined ? { pp: this.evalNumberExpr(step.pp, playerId, sourceId, vars) } : {}),
              ...(step.dp !== undefined ? { dp: this.evalNumberExpr(step.dp, playerId, sourceId, vars) } : {}),
              ...(step.setBasePP !== undefined
                ? { setBasePP: this.evalNumberExpr(step.setBasePP, playerId, sourceId, vars) }
                : {}),
              ...(step.setPP !== undefined ? { setPP: this.evalNumberExpr(step.setPP, playerId, sourceId, vars) } : {}),
              ...(step.setDP !== undefined ? { setDP: this.evalNumberExpr(step.setDP, playerId, sourceId, vars) } : {}),
              ...(step.charge !== undefined ? { charge: this.evalNumberExpr(step.charge, playerId, sourceId, vars) } : {}),
              ...(step.setCharge !== undefined ? { setCharge: this.evalNumberExpr(step.setCharge, playerId, sourceId, vars) } : {}),
              ...(step.keywords ? { keywords: step.keywords } : {}),
              ...(step.removeKeywords ? { removeKeywords: step.removeKeywords } : {}),
              ...(step.addTraits ? { addTraits: step.addTraits } : {}),
              ...(step.loseAbilities ? { loseAbilities: true } : {}),
              ...(step.prohibitions ? { prohibitions: step.prohibitions } : {}),
              ...(step.treatedAsOrbColors ? { treatedAsOrbColors: step.treatedAsOrbColors } : {}),
              ...(step.orbValue !== undefined ? { orbValue: step.orbValue } : {}),
              ...(step.treatedAsNames ? { treatedAsNames: step.treatedAsNames } : {}),
              ...(step.grantedTriggerIds ? { grantedTriggerIds: step.grantedTriggerIds } : {}),
              ...(step.canAttackPlayerOnEnterTurn ? { canAttackPlayerOnEnterTurn: true } : {}),
              ...(step.unblockableMaxPP !== undefined ? { unblockableMaxPP: step.unblockableMaxPP } : {}),
              untilTurn,
              source,
              sourceCardInstanceId: sourceId,
              appliedByPlayerId: playerId,
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
          if (player.erosionCount !== previous) {
            player.erosionChangedThisTurn = true;
          }
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
          const expectedZone = step.expectedZone ?? 'BATTLEFIELD';
          for (const id of targets) {
            const card = this.ctx.state.cards[id];
            if (!card) continue;
            if (step.markLegacyEndOfTurnToGraveyard && expectedZone === 'BATTLEFIELD') {
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
              payload: {
                expectedZone,
                expectedEnteredTimestamp: card.enteredZoneTimestamp,
              },
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
      case 'TRIGGER_ATTACKER':
        return vars.__triggerAttacker ?? [];
      case 'TRIGGER_BLOCKER':
        return vars.__triggerBlocker ?? [];
      case 'TRIGGER_HOST':
        return vars.__triggerHost ?? [];
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
      case 'ZONE_CARDS': {
        const sidePlayer = this.resolveSide(playerId, target.side);
        return this.zone(sidePlayer, target.zone)
          .filter((c) => !target.filter || this.matchesFilter(c, target.filter, sourceId))
          .map((c) => c.instanceId);
      }
    }
  }

  private evalNumberExpr(
    expr: NumberExpr,
    playerId: string,
    sourceId: string,
    vars: Record<string, string[]> = {}
  ): number {
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
      case 'VAR_COUNT_MULT':
        return (vars[expr.varName]?.length ?? 0) * expr.multiplier;
      case 'FLOOR_DIV':
        return Math.floor(this.evalNumberExpr(expr.expr, playerId, sourceId, vars) / expr.divisor);
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
      case 'EROSION_CHANGED_THIS_TURN': {
        const pid = this.resolveSide(playerId, cond.side);
        return Boolean(this.ctx.state.players[pid]?.erosionChangedThisTurn);
      }
      case 'OPEN_COST_COMPARE_OPPONENT': {
        const oppId = this.resolveSide(playerId, 'OPPONENT');
        const selfOpen = this.ctx.state.players[playerId]?.openCostCount ?? 0;
        const oppOpen = this.ctx.state.players[oppId]?.openCostCount ?? 0;
        return this.compare(selfOpen, cond.op, oppOpen);
      }
      case 'SIGNAL_ORB_BOTTOM_COST_PARITY': {
        const bottom = this.zone(playerId, 'SIGNAL_ORB')[0];
        if (!bottom || !bottom.isFaceUp) return false;
        const cost = this.def(bottom)?.cost;
        if (cost === undefined) return false;
        return cond.parity === 'ODD' ? cost % 2 === 1 : cost % 2 === 0;
      }
      case 'SELF_UNDERNEATH_COUNT': {
        const src = this.ctx.state.cards[sourceId];
        const underCards = (src?.underneathCardIds ?? [])
          .map((id) => this.ctx.state.cards[id])
          .filter((c): c is CardInstance => Boolean(c));
        const count = underCards.filter((c) => !cond.filter || this.matchesFilter(c, cond.filter, sourceId)).length;
        return this.compare(count, cond.op, cond.value);
      }
      case 'SELF_MATCHES_FILTER': {
        const src = this.ctx.state.cards[sourceId];
        return Boolean(src && this.matchesFilter(src, cond.filter, sourceId));
      }
      case 'GAME_ABILITY_UNUSED':
        return (this.ctx.state.players[playerId]?.gameAbilityUsage?.[cond.abilityKey] ?? 0) === 0;
      case 'TURN_ABILITY_UNUSED':
        return (this.ctx.state.players[playerId]?.turnAbilityUsage?.[`${sourceId}:${cond.abilityKey}`] ?? 0) === 0;
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
    sourceId: string,
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
      case 'EROSION_CHANGED_THIS_TURN': {
        const pid = resolveSide(cond.side);
        return Boolean(state.players[pid]?.erosionChangedThisTurn);
      }
      case 'OPEN_COST_COMPARE_OPPONENT': {
        const oppId = resolveSide('OPPONENT');
        const selfOpen = state.players[playerId]?.openCostCount ?? 0;
        const oppOpen = state.players[oppId]?.openCostCount ?? 0;
        return this.compare(selfOpen, cond.op, oppOpen);
      }
      case 'SIGNAL_ORB_BOTTOM_COST_PARITY': {
        const bottom = getCardsInZone(playerId, 'SIGNAL_ORB')[0];
        if (!bottom || !bottom.isFaceUp) return false;
        const cost = this.def(bottom)?.cost;
        if (cost === undefined) return false;
        return cond.parity === 'ODD' ? cost % 2 === 1 : cost % 2 === 0;
      }
      case 'SELF_UNDERNEATH_COUNT': {
        const src = state.cards[sourceId];
        const underCards = (src?.underneathCardIds ?? [])
          .map((id) => state.cards[id])
          .filter((c): c is CardInstance => Boolean(c));
        const count = underCards.filter(
          (c) => !cond.filter || this.matchesFilterSafe(c, cond.filter, hasTrait, sourceId)
        ).length;
        return this.compare(count, cond.op, cond.value);
      }
      case 'SELF_MATCHES_FILTER': {
        const src = state.cards[sourceId];
        return Boolean(src && this.matchesFilterSafe(src, cond.filter, hasTrait, sourceId));
      }
      case 'GAME_ABILITY_UNUSED':
        return (state.players[playerId]?.gameAbilityUsage?.[cond.abilityKey] ?? 0) === 0;
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
          this.evalStaticCondition(c, playerId, sourceId, state, getCardsInZone, getFieldRoles, hasTrait)
        );
      case 'ANY':
        return cond.conditions.some((c) =>
          this.evalStaticCondition(c, playerId, sourceId, state, getCardsInZone, getFieldRoles, hasTrait)
        );
      case 'NOT':
        return !this.evalStaticCondition(cond.condition, playerId, sourceId, state, getCardsInZone, getFieldRoles, hasTrait);
      default:
        return false;
    }
  }

  private matchesFilter(card: CardInstance, filter: CardFilter, sourceId?: string): boolean {
    return this.matchesFilterSafe(
      card,
      filter,
      (id, trait) => this.hasTrait(this.ctx.state.cards[id]!, trait),
      sourceId,
      (id, name) =>
        this.ctx.continuousEffects
          ? this.ctx.continuousEffects.hasCardName(id, name)
          : this.def(this.ctx.state.cards[id]!)?.name === name
    );
  }

  private matchesFilterSafe(
    card: CardInstance,
    filter: CardFilter,
    hasTraitFn: (cardInstanceId: string, trait: string) => boolean,
    sourceId?: string,
    hasNameFn?: (cardInstanceId: string, name: string) => boolean
  ): boolean {
    const def = this.def(card);
    if (filter.excludeSelf && sourceId && card.instanceId === sourceId) return false;
    if (filter.anyFilters !== undefined) {
      if (!filter.anyFilters.some((sub) => this.matchesFilterSafe(card, sub, hasTraitFn, sourceId, hasNameFn))) {
        return false;
      }
    }
    if (filter.cardType !== undefined && def?.cardType !== filter.cardType) return false;
    if (filter.attribute !== undefined && def?.attribute !== filter.attribute) return false;
    if (filter.exactName !== undefined) {
      const matchedName = hasNameFn
        ? hasNameFn(card.instanceId, filter.exactName)
        : def?.name === filter.exactName ||
          Boolean(card.modifiers?.some((m) => m.treatedAsNames?.includes(filter.exactName!))) ||
          (card.cardNumber === 'BP02-040' && filter.exactName === '飞叶点翠');
      if (!matchedName) return false;
    }
    if (filter.trait !== undefined && !hasTraitFn(card.instanceId, filter.trait)) return false;
    if (filter.anyTraits !== undefined && !filter.anyTraits.some((t) => hasTraitFn(card.instanceId, t))) {
      return false;
    }
    const cost =
      card.zone === 'BATTLEFIELD' && card.partnerCardId && this.ctx.continuousEffects
        ? this.ctx.continuousEffects.getEffectiveCardCost(card.instanceId)
        : (def?.cost ?? 99);
    if (filter.maxCost !== undefined && cost > filter.maxCost) return false;
    if (filter.minCost !== undefined && cost < filter.minCost) return false;
    if (filter.exactCost !== undefined && cost !== filter.exactCost) return false;
    if (filter.maxCostOpenCostLimit) {
      const openLimit = this.ctx.state.players[card.controllerPlayerId]?.openCostCount ?? 0;
      if (cost > openLimit) return false;
    }
    if (filter.maxBaseDP !== undefined && (def?.baseDP ?? 0) > filter.maxBaseDP) return false;
    if (filter.isAscended !== undefined) {
      const isAsc = Boolean(def?.ascensionConfig);
      if (isAsc !== filter.isAscended) return false;
    }
    if (filter.isSignalOrb !== undefined && this.isOrb(card) !== filter.isSignalOrb) return false;
    if (filter.signalOrbColor !== undefined) {
      const orbColorMatch =
        def?.signalOrb === filter.signalOrbColor ||
        (card.zone === 'SIGNAL_ORB' &&
          Boolean(this.ctx.continuousEffects?.getEffectiveOrbInfo(card.instanceId).colors.includes(filter.signalOrbColor)));
      if (!orbColorMatch) return false;
    }
    if (filter.isFaceUp !== undefined && card.isFaceUp !== filter.isFaceUp) return false;
    if (filter.isReady !== undefined && card.isReady !== filter.isReady) return false;
    if (filter.hasPartner !== undefined && Boolean(card.partnerCardId) !== filter.hasPartner) return false;
    if (filter.inZone !== undefined && card.zone !== filter.inZone) return false;
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
      case 'END_OF_COMBAT':
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

  /**
   * 4.16.2 / Q&A·1 计算信号球区中所有可消除的相邻组合：
   * - 支持「视为信号球」(BP04-032 炽能球) 与多色「视为」(BP01-014/BP01-022)
   * - 支持禁止消除 (1.3.3，BP02-066 万事·明晰梦)
   * - 支持等效多球精确匹配 (Q&A·1 BP01-037 万世铭 1 张视为 3 球，不可拆成 2 球使用)
   */
  private orbGroups(playerId: string, size: number, filter: OrbColorFilter): string[][] {
    const zone = this.zone(playerId, 'SIGNAL_ORB');
    const infos = zone.map((c) => {
      if (this.ctx.continuousEffects) {
        return this.ctx.continuousEffects.getEffectiveOrbInfo(c.instanceId);
      }
      const color = c.isFaceUp ? this.def(c)?.signalOrb : undefined;
      return {
        isOrb: Boolean(color),
        colors: color ? [color] : [],
        orbValue: color ? 1 : 0,
        cannotEliminate: false,
      };
    });

    const groups: string[][] = [];
    for (let start = 0; start < zone.length; start++) {
      let sum = 0;
      let commonColors: string[] | undefined;
      const sliceIds: string[] = [];

      for (let end = start; end < zone.length; end++) {
        const info = infos[end]!;
        if (!info.isOrb || info.cannotEliminate || info.orbValue <= 0) break;

        if (filter !== 'ANY' && filter !== 'SAME' && !info.colors.includes(filter)) {
          break;
        }
        if (filter === 'SAME') {
          commonColors =
            commonColors === undefined
              ? [...info.colors]
              : commonColors.filter((col) => info.colors.includes(col as 'RED' | 'BLUE' | 'YELLOW'));
          if (commonColors.length === 0) break;
        }

        sum += info.orbValue;
        sliceIds.push(zone[end]!.instanceId);
        if (sum === size) {
          groups.push([...sliceIds]);
          break;
        }
        if (sum > size) break;
      }
    }
    return groups;
  }

  private eliminate(playerId: string, ids: string[]): void {
    const orbColors = ids.map((id) => {
      if (this.ctx.continuousEffects) {
        return this.ctx.continuousEffects.getEffectiveOrbInfo(id).colors[0] ?? 'UNKNOWN';
      }
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

  private bringToField(playerId: string, cardId: string, triggerEntry: boolean, enterTapped = false): boolean {
    const slot = this.ctx.fieldMgr.findFirstEmptySlot(playerId);
    if (slot === undefined) return false;
    if (!this.ctx.fieldMgr.playRoleCard(playerId, cardId, slot)) return false;
    if (enterTapped) {
      const card = this.ctx.state.cards[cardId];
      if (card) card.isReady = false;
    }
    if (triggerEntry) {
      const def = this.def(this.ctx.state.cards[cardId]!);
      if (def) this.effects.handleRoleEntryEffect(playerId, cardId, def);
    }
    return true;
  }

  private destroy(cardId: string): boolean {
    const card = this.ctx.state.cards[cardId];
    if (!card || !this.ctx.fieldMgr.isSlotRole(card.controllerPlayerId, cardId)) return false;

    // 8.10 效果破坏前经由置换引擎拦截；被置换时视为未破坏 (8.10.1.a)，返回 false 以阻止后续「若如此做」(8.6.4)
    const intercept = this.ctx.replacementEngine?.interceptDestroyRole(cardId, 'EFFECT');
    if (intercept?.replaced) {
      if (intercept.redirect) {
        this.ctx.zoneMgr.moveCard(cardId, intercept.redirect.zone, {
          isFaceUp: intercept.redirect.isFaceUp,
          isReady: intercept.redirect.isReady,
          toBottom: intercept.redirect.toBottom,
          appliedReplacementIds: intercept.appliedIds,
        });
      }
      return false;
    }

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
    if (card.zone === 'SIGNAL_ORB' && this.ctx.continuousEffects) {
      return this.ctx.continuousEffects.getEffectiveOrbInfo(card.instanceId).isOrb;
    }
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

  private emptySlotCount(playerId: string): number {
    return this.ctx.fieldMgr
      .getSlots(playerId)
      .filter((s) => !s.roleCardId && !s.standaloneEquipmentId && !s.assistCardId).length;
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
