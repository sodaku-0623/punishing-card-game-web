import {
  CardInstance,
  CardModifier,
  CardVersionData,
  ElementAttribute,
  GameAction,
  PendingChoice,
  ZoneId,
} from '@zhanshuang/shared';
import type { CardEffectContext, CardEffectEngine } from '../card-effects.js';
import { addCardModifier, ContinuousEffectEngine, expandBaseTraits, normalizeCardName } from '../continuous-effects.js';
import type { CardTriggerSnapshot, TriggerManager } from '../../priority/trigger-system.js';
import { getAttachedEquipmentIds } from '../../zone/battlefield-manager.js';
import {
  CustomHandlerFrameState,
  CustomHandlerRuntime,
  resolveCustomChoice,
  startCustomHandler,
} from './custom-handlers.js';
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
  UsableActivationZone,
} from './types.js';

type Result = { success: boolean; error?: string };
type ChoiceAction = Extract<GameAction, { type: 'SELECT_CHOICE_OPTION' }>;

type PendingDslAction =
  | { kind: 'COST_DISCARD'; onPaid: EffectStep[]; optional: boolean; requiredMin?: number; markUsed?: boolean; markUsedKey?: string; savePaidToVar?: string }
  | { kind: 'COST_ORB'; onPaid: EffectStep[]; optional: boolean; markUsed?: boolean; markUsedKey?: string; savePaidToVar?: string; excludeFromAbilityOrbCount?: boolean }
  | { kind: 'COST_ORB_OR_DISCARD'; onPaid: EffectStep[]; optional: boolean; markUsed?: boolean; markUsedKey?: string }
  | { kind: 'COST_PAY_COST'; amount: number; onPaid: EffectStep[]; optional: boolean; markUsed?: boolean; markUsedKey?: string }
  | { kind: 'COST_TAP_FIELD'; onPaid: EffectStep[]; optional: boolean }
  | { kind: 'CONFIRM_YES_NO'; onYes: EffectStep[]; onNo?: EffectStep[] }
  | { kind: 'CHOOSE_MODE'; modes: { id: string; steps: EffectStep[] }[] }
  | {
      kind: 'SAVE_CHOICE';
      saveToVar: string;
      distinctTraits?: string[];
      distinctTraitsError?: string;
      uniqueNames?: boolean;
      uniqueCardNumbers?: boolean;
      distinctAttributes?: boolean;
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
        oncePerTurnByPlayer?: boolean;
        cost?: AbilityCost;
        steps: EffectStep[];
      }>;
    }
  | { kind: 'CUSTOM_CHOICE'; customFrame: CustomHandlerFrameState };

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
    const spec = this.registry.get(cardNumber);
    return Boolean(spec?.entry || spec?.entries?.length);
  }

  handlesActivation(cardNumber: string): boolean {
    const spec = this.registry.get(cardNumber);
    return Boolean(spec?.activate || spec?.activates?.length);
  }

  /** 检查该战场或非战场卡牌自身或其附着装备是否拥有任何声明式【起】动能力 */
  handlesActivationForCard(playerId: string, cardId: string, def: CardVersionData): boolean {
    const spec = this.registry.get(def.cardNumber);
    if (spec?.activate || spec?.activates?.length) return true;
    return this.getEquipmentGrantedActivates(playerId, cardId).length > 0;
  }

  private getCurrentActivationZoneSet(playerId: string, cardId: string): Set<UsableActivationZone> {
    const result = new Set<UsableActivationZone>();
    const card = this.ctx.state.cards[cardId];
    if (!card || card.controllerPlayerId !== playerId) return result;
    if (this.ctx.fieldMgr.isTopLevelFieldCard(playerId, cardId)) {
      result.add('BATTLEFIELD');
    } else if (card.zone === 'HAND' || card.zone === 'GRAVEYARD') {
      result.add(card.zone);
    } else if ((card.zone === 'COST' || card.zone === 'SIGNAL_ORB') && card.isFaceUp) {
      result.add(card.zone);
    }
    const isUnderHost = this.ctx.fieldMgr.getSlots(playerId).some((s) => {
      const host = (s.roleCardId && this.ctx.state.cards[s.roleCardId]) || (s.assistCardId && this.ctx.state.cards[s.assistCardId]);
      return Boolean(host && host.underneathCardIds.includes(cardId));
    });
    if (isUnderHost) {
      result.add('UNDERNEATH');
    }
    return result;
  }

  /** 检查卡牌当前所在区域是否允许通过声明式 usableZones 发动其【起】动能力 */
  isCardInUsableZoneForActivation(playerId: string, cardId: string, def: CardVersionData): boolean {
    const spec = this.registry.get(def.cardNumber);
    if (!spec) return false;
    const activeZones = this.getCurrentActivationZoneSet(playerId, cardId);
    if (activeZones.size === 0) return false;
    const candidateLists: (UsableActivationZone[] | undefined)[] = [
      spec.usableZones,
      spec.activate?.usableZones,
      ...(spec.activates?.map((a) => a.usableZones) ?? []),
    ];
    for (const zList of candidateLists) {
      if (!zList) continue;
      if (zList.some((z) => activeZones.has(z))) return true;
    }
    return false;
  }

  /** 【永】：检查是否因我方战场/费用区的声明式 fieldIgnoreAttributeRule 使该牌使用可无视属性条件 */
  canPlayerIgnoreAttributeForPlay(
    playerId: string,
    cardInstanceId: string,
    cardDef: CardVersionData,
    isAscension: boolean
  ): boolean {
    const targetCard = this.ctx.state.cards[cardInstanceId];
    for (const spec of this.registry.values()) {
      const rule = spec.fieldIgnoreAttributeRule;
      if (!rule) continue;
      if (rule.onlyAscensionRoles && (isAscension || cardDef.cardType !== 'ROLE' || !cardDef.ascensionConfig)) {
        continue;
      }
      if (rule.targetTrait) {
        const hasT = targetCard
          ? this.hasTrait(targetCard, rule.targetTrait)
          : expandBaseTraits(cardDef.traits).has(rule.targetTrait);
        if (!hasT) continue;
      }
      const sourceExists = rule.zones.some((z) => {
        if (z === 'BATTLEFIELD') {
          return this.ctx.fieldMgr.getSlots(playerId).some((s) => {
            const topId = s.roleCardId ?? s.assistCardId ?? s.standaloneEquipmentId;
            const c = topId ? this.ctx.state.cards[topId] : undefined;
            return Boolean(
              c &&
                c.cardNumber === spec.cardNumber &&
                !this.ctx.continuousEffects?.hasLostInherentAbilities(c.instanceId)
            );
          });
        }
        return this.zone(playerId, 'COST').some((c) => c.isFaceUp && c.cardNumber === spec.cardNumber);
      });
      if (sourceExists) return true;
    }
    return false;
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
      if (rule.targetName && normalizeCardName(cardDef.name) !== normalizeCardName(rule.targetName)) continue;
      if (rule.targetTrait && !expandBaseTraits(cardDef.traits).has(rule.targetTrait)) continue;
      if (rule.firstPerTurnOnly) {
        if (rule.targetName) {
          if ((player.turnCardPlayedCountByName?.[rule.targetName] ?? 0) > 0) continue;
        } else if (rule.targetTrait === '艺术协会' && rule.cardType === 'TACTICS') {
          if ((player.turnArtAssocTacticsPlayedCount ?? 0) > 0) continue;
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
   * 执行声明式【出】登场能力 (支持单入口 entry 与多入口 entries 按顺序执行)
   */
  enter(playerId: string, roleId: string, def: CardVersionData): void {
    const spec = this.registry.get(def.cardNumber);
    if (spec?.entries && spec.entries.length > 0) {
      const mergedSteps: EffectStep[] = [];
      for (const e of spec.entries) {
        if (e.cost?.kind === 'DISCARD_HAND' && e.cost.optional) {
          mergedSteps.push({
            op: 'DISCARD_COST_STEP',
            count: e.cost.count,
            filter: e.cost.filter,
            optional: true,
            prompt: e.cost.prompt,
            choiceEffectType: e.cost.choiceEffectType,
            onPaid: e.steps,
          });
        } else if (e.cost?.kind === 'ELIMINATE_ORBS' && e.cost.optional) {
          mergedSteps.push({
            op: 'ELIMINATE_ORB_COST',
            filter: e.cost.filter,
            count: e.cost.count,
            optional: true,
            prompt: e.cost.prompt,
            choiceEffectType: e.cost.choiceEffectType,
            savePaidToVar: e.cost.savePaidToVar,
            onPaid: e.steps,
          });
        } else if (!e.cost) {
          mergedSteps.push(...e.steps);
        } else {
          // 非可选入口代价，优先执行该条目
          this.executeWithCost(def.cardNumber, roleId, playerId, e.cost, e.steps, false);
          continue;
        }
      }
      if (mergedSteps.length > 0) {
        this.runSteps(def.cardNumber, roleId, playerId, {}, mergedSteps);
      }
      return;
    }
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
   * 执行声明式【起】起动能力 (支持角色自身单/多【起】、非战场区域限制、以及装备赋予的【起】)
   */
  activate(playerId: string, cardId: string, def: CardVersionData, abilityIndex?: number): Result {
    const spec = this.registry.get(def.cardNumber);
    const grantedList = this.getEquipmentGrantedActivates(playerId, cardId);
    const activeZones = this.getCurrentActivationZoneSet(playerId, cardId);
    const allEntries: Array<{
      id: string;
      label: string;
      cardNumber: string;
      usageKey: string;
      activate: NonNullable<CardEffectSpec['activate']>;
    }> = [];

    const makeUsageKey = (
      entryId: string,
      act: NonNullable<CardEffectSpec['activate']>
    ) => {
      if (act.sharedTurnKey) return act.sharedTurnKey;
      if (act.oncePerTurnByPlayer) return `${def.name}:act:${entryId}`;
      return entryId === 'self' ? cardId : `${cardId}:${entryId}`;
    };

    if (spec?.activate) {
      const allowed = spec.activate.usableZones ?? spec.usableZones ?? ['BATTLEFIELD'];
      if (allowed.some((z) => activeZones.has(z))) {
        allEntries.push({
          id: spec.activate.id ?? 'self',
          label: spec.activate.label ?? `【${def.name}】自身【起】动能力`,
          cardNumber: def.cardNumber,
          usageKey: makeUsageKey(spec.activate.id ?? 'self', spec.activate),
          activate: spec.activate,
        });
      }
    }
    if (spec?.activates?.length) {
      spec.activates.forEach((act, idx) => {
        const allowed = act.usableZones ?? spec.usableZones ?? ['BATTLEFIELD'];
        if (!allowed.some((z) => activeZones.has(z))) return;
        const eid = act.id ?? `act_${idx}`;
        allEntries.push({
          id: eid,
          label: act.label ?? `【${def.name}】起动能力 #${idx + 1}`,
          cardNumber: def.cardNumber,
          usageKey: makeUsageKey(eid, act),
          activate: act,
        });
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
      return { success: false, error: '当前区域下没有可发动的声明式【起】动能力' };
    }

    const player = this.ctx.state.players[playerId]!;
    const runEntry = (entry: (typeof allEntries)[number]): Result => {
      const isOnce = Boolean(entry.activate.oncePerTurn || entry.activate.oncePerTurnByPlayer);
      if (isOnce && (player.turnAbilityUsage[entry.usageKey] ?? 0) > 0) {
        return { success: false, error: '该能力本回合已发动过 (【回合1】/ 每回合最多1次)' };
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
        isOnce,
        {},
        entry.usageKey
      );
    };

    if (allEntries.length === 1) {
      return runEntry(allEntries[0]!);
    }

    if (abilityIndex !== undefined && abilityIndex >= 0 && abilityIndex < allEntries.length) {
      return runEntry(allEntries[abilityIndex]!);
    }

    const usable = allEntries.filter((e) => {
      const isOnce = Boolean(e.activate.oncePerTurn || e.activate.oncePerTurnByPlayer);
      if (isOnce && (player.turnAbilityUsage[e.usageKey] ?? 0) > 0) return false;
      if (e.activate.condition && !this.evalCondition(e.activate.condition, playerId, cardId, {})) return false;
      return true;
    });
    if (usable.length === 0) {
      return runEntry(allEntries[0]!);
    }
    if (usable.length === 1) {
      return runEntry(usable[0]!);
    }

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
            oncePerTurn: Boolean(e.activate.oncePerTurn || e.activate.oncePerTurnByPlayer),
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
          maxPerTurn: trig.maxPerTurn,
          deferOncePerTurnUntilCostPaid: trig.deferOncePerTurnUntilCostPaid,
          oncePerTurnByPlayer: trig.oncePerTurnByPlayer,
          maxPerTurnByPlayer: trig.maxPerTurnByPlayer,
          sharedTurnKey: trig.sharedTurnKey,
          collect: ({ state, event, cardDb, fieldMgr, continuousEffects, zoneMgr }) => {
            const condOk = (pid: string, srcId: string, extraVars: Record<string, string[]> = {}) =>
              !trig.condition || this.evalCondition(trig.condition, pid, srcId, extraVars);

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
                const enteredCard = state.cards[enteredId];
                const enteredName =
                  event.subjectSnapshot?.name ??
                  (enteredCard ? cardDb.getCard(enteredCard.cardNumber)?.name : undefined);
                if (trig.matcher.enteredName && enteredName !== trig.matcher.enteredName) return [];
                if (trig.matcher.enteredTrait) {
                  const enteredTraits =
                    event.subjectSnapshot?.traits ??
                    (enteredCard ? Array.from(expandBaseTraits(cardDb.getCard(enteredCard.cardNumber)?.traits)) : []);
                  if (!enteredTraits.includes(trig.matcher.enteredTrait)) return [];
                }
                if (trig.matcher.enteredFilter && enteredCard && !this.matchesFilter(enteredCard, trig.matcher.enteredFilter)) {
                  return [];
                }

                const matches = [];
                for (const slot of fieldMgr.getSlots(playerId)) {
                  const slotIds = [slot.roleCardId, slot.assistCardId].filter((x): x is string => Boolean(x));
                  for (const sid of slotIds) {
                    if (!trig.matcher.includeSelf && sid === enteredId) continue;
                    const host = state.cards[sid];
                    if (!host || host.cardNumber !== spec.cardNumber) continue;
                    if (!condOk(playerId, host.instanceId)) continue;
                    matches.push({
                      sourceCardInstanceId: host.instanceId,
                      sourceCardNumber: spec.cardNumber,
                      controllerPlayerId: playerId,
                      label: trig.label.replace('{slot}', String((host.slotIndex ?? 0) + 1)),
                      triggerContext: { enteredCardId: enteredId, targetCardId: enteredId },
                    });
                  }
                }
                return matches;
              }
              case 'SELF_IN_SIGNAL_ORB_ON_FRIENDLY_ROLE_ENTERED': {
                const enteredId = event.cardInstanceId;
                const playerId = event.playerId;
                if (!enteredId || !playerId) return [];
                const enteredCard = state.cards[enteredId];
                if (!enteredCard) return [];
                if (trig.matcher.enteredFilter && !this.matchesFilter(enteredCard, trig.matcher.enteredFilter)) {
                  return [];
                }
                const matches = [];
                for (const c of zoneMgr.getCardsInZone(playerId, 'SIGNAL_ORB')) {
                  if (c.cardNumber !== spec.cardNumber || !c.isFaceUp) continue;
                  if (!condOk(playerId, c.instanceId)) continue;
                  matches.push({
                    sourceCardInstanceId: c.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: playerId,
                    label: trig.label,
                    triggerContext: { enteredCardId: enteredId, targetCardId: enteredId },
                  });
                }
                return matches;
              }
              case 'SELF_IN_UNDERNEATH_ON_FRIENDLY_DEPLOY_FROM_UNDERNEATH': {
                const enteredId = event.cardInstanceId;
                const playerId = event.playerId;
                const fromHostId = event.deployedFromHostCardId;
                if (!enteredId || !playerId || !fromHostId) return [];
                const fromHost = state.cards[fromHostId];
                if (!fromHost) return [];
                if (
                  trig.matcher.hostName &&
                  !continuousEffects.hasCardName(fromHost.instanceId, trig.matcher.hostName) &&
                  cardDb.getCard(fromHost.cardNumber)?.name !== trig.matcher.hostName
                ) {
                  return [];
                }
                const matches = [];
                for (const slot of fieldMgr.getSlots(playerId)) {
                  const host = slot.roleCardId ? state.cards[slot.roleCardId] : undefined;
                  if (!host) continue;
                  for (const uid of host.underneathCardIds ?? []) {
                    const uc = state.cards[uid];
                    if (!uc || uc.cardNumber !== spec.cardNumber) continue;
                    if (!condOk(playerId, uc.instanceId)) continue;
                    matches.push({
                      sourceCardInstanceId: uc.instanceId,
                      sourceCardNumber: spec.cardNumber,
                      controllerPlayerId: playerId,
                      label: trig.label,
                      triggerContext: { enteredCardId: enteredId, targetCardId: enteredId },
                    });
                  }
                }
                return matches;
              }
              case 'ANY_CARD_SENT_FIELD_TO_GY_BY_EFFECT': {
                const sentId = event.cardInstanceId;
                const ownerPid = event.playerId;
                if (!sentId || !ownerPid) return [];
                const sentCard = state.cards[sentId];
                const snap = event.subjectSnapshot;
                const matchSentSnapshot = (filter: CardFilter): boolean => {
                  if (sentCard && this.matchesFilterWithSnapshot(sentCard, snap, filter)) return true;
                  return false;
                };
                if (trig.matcher.filter && !matchSentSnapshot(trig.matcher.filter)) return [];

                const watchersPid = trig.matcher.side === 'SELF' ? ownerPid : this.resolveSide(ownerPid, 'OPPONENT');
                if (ownerPid !== watchersPid && trig.matcher.side === 'SELF') return [];
                const matches: Array<{
                  sourceCardInstanceId: string;
                  sourceCardNumber: string;
                  controllerPlayerId: string;
                  label: string;
                  triggerContext: Record<string, unknown>;
                }> = [];
                // 场上存活的己方来源卡 (角色 / 辅助机 / 独立装备)
                for (const slot of fieldMgr.getSlots(watchersPid)) {
                  const slotIds = [slot.roleCardId, slot.assistCardId, slot.standaloneEquipmentId].filter(
                    (x): x is string => Boolean(x)
                  );
                  for (const sid of slotIds) {
                    const card = state.cards[sid];
                    if (!card || card.cardNumber !== spec.cardNumber || card.instanceId === sentId) continue;
                    if (!condOk(watchersPid, card.instanceId)) continue;
                    matches.push({
                      sourceCardInstanceId: card.instanceId,
                      sourceCardNumber: spec.cardNumber,
                      controllerPlayerId: watchersPid,
                      label: trig.label,
                      triggerContext: { targetCardId: sentId },
                    });
                  }
                }
                // Q&A·4/8：「该牌因效果或代价从战场放置到墓地时也会发动」(含离场瞬间是否失能快照)
                if (
                  trig.matcher.includeSelf &&
                  sentCard &&
                  sentCard.cardNumber === spec.cardNumber &&
                  watchersPid === ownerPid &&
                  !snap?.abilitiesLost
                ) {
                  if (condOk(watchersPid, sentCard.instanceId)) {
                    matches.push({
                      sourceCardInstanceId: sentCard.instanceId,
                      sourceCardNumber: spec.cardNumber,
                      controllerPlayerId: watchersPid,
                      label: trig.label,
                      triggerContext: {
                        targetCardId: sentId,
                        sourceAbilitiesLostAtTrigger: Boolean(snap?.abilitiesLost),
                      },
                    });
                  }
                }
                return matches;
              }
              case 'SELF_MOVED_DECK_TO_GY': {
                const movedId = event.cardInstanceId;
                const playerId = event.playerId;
                if (!movedId || !playerId) return [];
                const movedCard = state.cards[movedId];
                if (!movedCard || movedCard.cardNumber !== spec.cardNumber) return [];
                if (!condOk(playerId, movedCard.instanceId)) return [];
                return [
                  {
                    sourceCardInstanceId: movedCard.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: playerId,
                    label: trig.label,
                    triggerContext: { targetCardId: movedId },
                  },
                ];
              }
              case 'FRIENDLY_CARD_MOVED_DECK_TO_GY': {
                const movedId = event.cardInstanceId;
                const playerId = event.playerId;
                if (!movedId || !playerId) return [];
                const movedCard = state.cards[movedId];
                if (!movedCard) return [];
                if (trig.matcher.filter && !this.matchesFilterWithSnapshot(movedCard, event.subjectSnapshot, trig.matcher.filter)) {
                  return [];
                }
                const matches = [];
                for (const slot of fieldMgr.getSlots(playerId)) {
                  const slotIds = [slot.roleCardId, slot.assistCardId, slot.standaloneEquipmentId].filter(
                    (x): x is string => Boolean(x)
                  );
                  for (const sid of slotIds) {
                    const card = state.cards[sid];
                    if (!card || card.cardNumber !== spec.cardNumber) continue;
                    if (!condOk(playerId, card.instanceId)) continue;
                    matches.push({
                      sourceCardInstanceId: card.instanceId,
                      sourceCardNumber: spec.cardNumber,
                      controllerPlayerId: playerId,
                      label: trig.label,
                      triggerContext: { targetCardId: movedId },
                    });
                  }
                }
                return matches;
              }
              case 'FRIENDLY_CARD_MOVED_GY_TO_DECK_BOTTOM': {
                const movedId = event.cardInstanceId;
                const playerId = event.playerId;
                if (!movedId || !playerId) return [];
                const movedCard = state.cards[movedId];
                if (!movedCard) return [];
                if (trig.matcher.filter && !this.matchesFilterWithSnapshot(movedCard, event.subjectSnapshot, trig.matcher.filter)) {
                  return [];
                }
                const matches = [];
                for (const slot of fieldMgr.getSlots(playerId)) {
                  const slotIds = [slot.roleCardId, slot.assistCardId, slot.standaloneEquipmentId].filter(
                    (x): x is string => Boolean(x)
                  );
                  for (const sid of slotIds) {
                    const c = state.cards[sid];
                    if (!c || c.cardNumber !== spec.cardNumber) continue;
                    if (!condOk(playerId, c.instanceId)) continue;
                    matches.push({
                      sourceCardInstanceId: c.instanceId,
                      sourceCardNumber: spec.cardNumber,
                      controllerPlayerId: playerId,
                      label: trig.label,
                      triggerContext: { targetCardId: movedId },
                    });
                  }
                }
                return matches;
              }
              case 'SELF_TAPPED': {
                const tappedId = event.cardInstanceId;
                const playerId = event.playerId;
                if (!tappedId || !playerId) return [];
                const card = state.cards[tappedId];
                if (!card || card.cardNumber !== spec.cardNumber) return [];
                if (!condOk(playerId, card.instanceId)) return [];
                return [
                  {
                    sourceCardInstanceId: card.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: playerId,
                    label: trig.label,
                    triggerContext: { targetCardId: tappedId },
                  },
                ];
              }
              case 'SELF_DESTROYED': {
                const destroyedId = event.cardInstanceId;
                const playerId = event.playerId;
                if (!destroyedId || !playerId) return [];
                if (trig.matcher.destroyReason && trig.matcher.destroyReason !== 'ANY') {
                  if (event.destroyReason !== trig.matcher.destroyReason) return [];
                }
                const card = state.cards[destroyedId];
                if (!card || card.cardNumber !== spec.cardNumber) return [];
                if (event.subjectSnapshot?.abilitiesLost) return [];
                if (!condOk(playerId, card.instanceId)) return [];
                return [
                  {
                    sourceCardInstanceId: card.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: playerId,
                    label: trig.label,
                    triggerContext: {
                      targetCardId: destroyedId,
                      sourceAbilitiesLostAtTrigger: Boolean(event.subjectSnapshot?.abilitiesLost),
                    },
                  },
                ];
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
                    triggerContext: {
                      attackerCardId: attacker.instanceId,
                    },
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
                if (
                  !condOk(
                    attacker.controllerPlayerId,
                    attackerId,
                    event.attackChargedHasChargeAuto ? { __combatChargedAuto: ['1'] } : {}
                  )
                ) return [];
                return [
                  {
                    sourceCardInstanceId: attacker.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: attacker.controllerPlayerId,
                    label: trig.label,
                    triggerContext: {
                      attackerCardId: attacker.instanceId,
                      combatChargedAuto: Boolean(event.attackChargedHasChargeAuto),
                    },
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
              case 'SELF_DEALT_PLAYER_DAMAGE': {
                const attackerId = event.cardInstanceId;
                const playerId = event.playerId;
                if (!attackerId || !playerId) return [];
                const attacker = state.cards[attackerId];
                if (!attacker || attacker.cardNumber !== spec.cardNumber) return [];
                if (!condOk(playerId, attacker.instanceId)) return [];
                return [
                  {
                    sourceCardInstanceId: attacker.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: playerId,
                    label: trig.label,
                    triggerContext: { attackerCardId: attacker.instanceId },
                  },
                ];
              }
              case 'SELF_EQUIPPED': {
                const eqId = event.cardInstanceId;
                const roleId = event.targetCardId;
                const playerId = event.playerId;
                if (!eqId || !playerId) return [];
                const eq = state.cards[eqId];
                if (!eq || eq.cardNumber !== spec.cardNumber) return [];
                if (!condOk(playerId, eq.instanceId)) return [];
                return [
                  {
                    sourceCardInstanceId: eq.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: playerId,
                    label: trig.label,
                    triggerContext: { hostCardId: roleId, targetCardId: roleId },
                  },
                ];
              }
              case 'PARTNER_HOST_ATTACKING': {
                const attackerId = event.cardInstanceId;
                if (!attackerId) return [];
                const attacker = state.cards[attackerId];
                const partnerId = attacker?.partnerCardId;
                const partner = partnerId ? state.cards[partnerId] : undefined;
                if (!attacker || !partner || partner.cardNumber !== spec.cardNumber) return [];
                if (
                  trig.matcher.requiredHostName &&
                  !continuousEffects.hasCardName(attacker.instanceId, trig.matcher.requiredHostName)
                ) {
                  return [];
                }
                if (
                  trig.matcher.requiredHostTrait &&
                  !this.hasTrait(attacker, trig.matcher.requiredHostTrait)
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
                    triggerContext: { hostCardId: attacker.instanceId, attackerCardId: attacker.instanceId },
                  },
                ];
              }
              case 'SELF_ORBS_ELIMINATED': {
                const playerId = event.playerId;
                if (!playerId) return [];
                const matches = [];
                for (const slot of fieldMgr.getSlots(playerId)) {
                  const slotIds = [slot.roleCardId, slot.assistCardId].filter((x): x is string => Boolean(x));
                  for (const sid of slotIds) {
                    const card = state.cards[sid];
                    if (!card || card.cardNumber !== spec.cardNumber) continue;
                    if (!condOk(playerId, card.instanceId)) continue;
                    matches.push({
                      sourceCardInstanceId: card.instanceId,
                      sourceCardNumber: spec.cardNumber,
                      controllerPlayerId: playerId,
                      label: trig.label,
                      triggerContext: {},
                    });
                  }
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
                const grantKeys = continuousEffects.getGrantedTriggerKeys(blockerId, trig.abilityId);
                if (grantKeys.length === 0) return [];
                if (!condOk(blocker.controllerPlayerId, blockerId)) return [];
                // Q&A·7 (ST04-001 荣光护盾)：多张《荣光护盾》对同一角色赋予的能力各自独立，分别拥有独立的【回合1】计次
                return grantKeys.map((grantKey, idx) => {
                  const onceKey = `${blocker.instanceId}:${trig.abilityId}:${grantKey}`;
                  return {
                    sourceCardInstanceId: blocker.instanceId,
                    sourceCardNumber: blocker.cardNumber,
                    controllerPlayerId: blocker.controllerPlayerId,
                    label: grantKeys.length > 1 ? `${trig.label} (#${idx + 1})` : trig.label,
                    oncePerTurnKey: onceKey,
                    triggerContext: {
                      blockerCardId: blocker.instanceId,
                      attackerCardId: event.cardInstanceId,
                      oncePerTurnKey: onceKey,
                      // 仅当赋予位于 loseAbilities 之后才会保留于 grantKeys 中 (Q&A·3)
                      sourceAbilitiesLostAtTrigger: false,
                    },
                  };
                });
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
                  const slotIds = [slot.roleCardId, slot.assistCardId].filter((x): x is string => Boolean(x));
                  for (const sid of slotIds) {
                    const role = state.cards[sid];
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
              case 'SELF_GAINED_PARTNER': {
                const hostId = event.cardInstanceId;
                const partnerId = event.targetCardId;
                if (!hostId || !partnerId) return [];
                const host = state.cards[hostId];
                const partner = state.cards[partnerId];
                if (!host || !partner || host.cardNumber !== spec.cardNumber) return [];
                if (trig.matcher.requiredPartnerTrait && !this.hasTrait(partner, trig.matcher.requiredPartnerTrait)) {
                  return [];
                }
                if (
                  trig.matcher.requiredPartnerName &&
                  !continuousEffects.hasCardName(partner.instanceId, trig.matcher.requiredPartnerName)
                ) {
                  return [];
                }
                if (!condOk(host.controllerPlayerId, host.instanceId)) return [];
                return [
                  {
                    sourceCardInstanceId: host.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: host.controllerPlayerId,
                    label: trig.label,
                    triggerContext: {
                      hostCardId: host.instanceId,
                      partnerCardId: partner.instanceId,
                      targetCardId: partner.instanceId,
                      ...(event.fromZone ? { partnerFromZone: event.fromZone } : {}),
                    },
                  },
                ];
              }
              case 'SELF_LEFT_FIELD': {
                const leftId = event.cardInstanceId;
                const playerId = event.playerId;
                if (!leftId || !playerId) return [];
                const card = state.cards[leftId];
                if (!card || card.cardNumber !== spec.cardNumber) return [];
                if (event.subjectSnapshot?.abilitiesLost) return [];
                if (trig.matcher.requiredEquipTrait) {
                  const eqTraits = event.subjectSnapshot?.attachedEquipmentTraits ?? [];
                  if (!eqTraits.includes(trig.matcher.requiredEquipTrait)) return [];
                }
                if (!condOk(playerId, card.instanceId)) return [];
                return [
                  {
                    sourceCardInstanceId: card.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: playerId,
                    label: trig.label,
                    triggerContext: {
                      targetCardId: leftId,
                      sourceAbilitiesLostAtTrigger: Boolean(event.subjectSnapshot?.abilitiesLost),
                    },
                  },
                ];
              }
              case 'GRANTED_SELF_LEFT_FIELD': {
                const leftId = event.cardInstanceId;
                const playerId = event.playerId;
                if (!leftId || !playerId) return [];
                if (event.subjectSnapshot?.abilitiesLost) return [];
                const card = state.cards[leftId];
                if (!card) return [];
                const grantKeys = (event.subjectSnapshot?.grantedTriggerEntries ?? [])
                  .filter((e) => e.triggerId === trig.abilityId)
                  .map((e) => e.grantKey);
                if (grantKeys.length === 0) return [];
                if (!condOk(playerId, card.instanceId)) return [];
                return grantKeys.map((grantKey, idx) => {
                  const onceKey = `${card.instanceId}:${trig.abilityId}:${grantKey}`;
                  return {
                    sourceCardInstanceId: card.instanceId,
                    sourceCardNumber: card.cardNumber,
                    controllerPlayerId: playerId,
                    label: grantKeys.length > 1 ? `${trig.label} (#${idx + 1})` : trig.label,
                    oncePerTurnKey: onceKey,
                    triggerContext: {
                      targetCardId: leftId,
                      oncePerTurnKey: onceKey,
                      sourceAbilitiesLostAtTrigger: false,
                    },
                  };
                });
              }
              case 'SELF_PLAYER_DAMAGED': {
                const damagedPlayerId = event.playerId;
                if (!damagedPlayerId) return [];
                if (trig.matcher.onlySelfTurn && state.activePlayerId !== damagedPlayerId) return [];
                const matches = [];
                for (const slot of fieldMgr.getSlots(damagedPlayerId)) {
                  const slotIds = [slot.roleCardId, slot.assistCardId].filter((x): x is string => Boolean(x));
                  for (const sid of slotIds) {
                    const card = state.cards[sid];
                    if (!card || card.cardNumber !== spec.cardNumber) continue;
                    if (!condOk(damagedPlayerId, card.instanceId)) continue;
                    matches.push({
                      sourceCardInstanceId: card.instanceId,
                      sourceCardNumber: spec.cardNumber,
                      controllerPlayerId: damagedPlayerId,
                      label: trig.label,
                      triggerContext: {},
                    });
                  }
                }
                return matches;
              }
              case 'SELF_IN_GRAVEYARD_ON_FRIENDLY_ROLE_ATTACKED': {
                if (event.targetType !== 'CHARACTER' || !event.targetCardId) return [];
                const defenderRole = state.cards[event.targetCardId];
                if (!defenderRole || !fieldMgr.isSlotRole(defenderRole.controllerPlayerId, defenderRole.instanceId)) {
                  return [];
                }
                const defenderPlayerId = defenderRole.controllerPlayerId;
                if (
                  trig.matcher.targetFilter &&
                  !this.matchesFilter(defenderRole, trig.matcher.targetFilter, defenderRole.instanceId)
                ) {
                  return [];
                }
                const matches = [];
                for (const gyCard of zoneMgr.getCardsInZone(defenderPlayerId, 'GRAVEYARD')) {
                  if (gyCard.cardNumber !== spec.cardNumber) continue;
                  if (!condOk(defenderPlayerId, gyCard.instanceId)) continue;
                  matches.push({
                    sourceCardInstanceId: gyCard.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: defenderPlayerId,
                    label: trig.label,
                    triggerContext: {
                      attackerCardId: event.cardInstanceId,
                      targetCardId: defenderRole.instanceId,
                    },
                  });
                }
                return matches;
              }
            }
          },
          execute: (pending) => {
            const initialVars: Record<string, string[]> = {};
            const attackerId = pending.triggerContext.attackerCardId as string | undefined;
            const blockerId = pending.triggerContext.blockerCardId as string | undefined;
            const hostId = pending.triggerContext.hostCardId as string | undefined;
            const targetId = pending.triggerContext.targetCardId as string | undefined;
            const partnerFromZone = pending.triggerContext.partnerFromZone as string | undefined;
            const onceKey =
              (pending.triggerContext.oncePerTurnKey as string | undefined) ??
              pending.oncePerTurnKey ??
              `${pending.sourceCardInstanceId}:${pending.abilityId}`;
            if (attackerId) initialVars.__triggerAttacker = [attackerId];
            if (blockerId) initialVars.__triggerBlocker = [blockerId];
            if (hostId) initialVars.__triggerHost = [hostId];
            if (targetId) initialVars.__triggerTarget = [targetId];
            if (partnerFromZone) initialVars.__partnerFromZone = [partnerFromZone];
            if (pending.triggerContext.combatChargedAuto) initialVars.__combatChargedAuto = ['1'];
            initialVars.__oncePerTurnKey = [onceKey];
            if (trig.condition && !this.evalCondition(trig.condition, pending.controllerPlayerId, pending.sourceCardInstanceId, initialVars)) {
              return;
            }
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
            eff.clearBaseTraits ||
            eff.setCardType !== undefined ||
            eff.costDelta !== undefined ||
            eff.setCost !== undefined ||
            eff.canAttackReadyRolesMaxCost !== undefined ||
            eff.mustBeAttackTarget ||
            eff.prohibitions?.length ||
            eff.treatedAsOrbColors?.length ||
            eff.orbValue !== undefined ||
            eff.treatedAsNames?.length ||
            eff.unblockableMaxPP !== undefined ||
            eff.grantedTriggerIds?.length ||
            eff.canDualEquipFengren === true
        );
        const hasStat =
          eff.pp !== undefined ||
          eff.setPP !== undefined ||
          eff.dp !== undefined ||
          eff.setDP !== undefined ||
          eff.setBaseDP !== undefined ||
          eff.charge !== undefined ||
          eff.setCharge !== undefined;

        const matchesTargetAndCond = (
          source: CardInstance,
          target: CardInstance,
          ctx: Parameters<Parameters<ContinuousEffectEngine['registerStaticRule']>[0]['evaluate']>[2]
        ): boolean => {
          if (eff.scope === 'SELF') {
            if (source.instanceId !== target.instanceId) return false;
            if (eff.selfFilter && !this.matchesFilterSafe(target, eff.selfFilter, ctx.hasCardTrait, source.instanceId, undefined, true)) {
              return false;
            }
          } else if (eff.scope === 'PARTNER_HOST') {
            if (source.partnerOfCardId !== target.instanceId) return false;
            if (eff.targetFilter && !this.matchesFilterSafe(target, eff.targetFilter, ctx.hasCardTrait, source.instanceId, undefined, true)) {
              return false;
            }
          } else if (eff.scope === 'UNDERNEATH_HOST') {
            if (!(target.underneathCardIds ?? []).includes(source.instanceId)) return false;
            if (eff.targetFilter && !this.matchesFilterSafe(target, eff.targetFilter, ctx.hasCardTrait, source.instanceId, undefined, true)) {
              return false;
            }
          } else if (eff.scope === 'EQUIPPED_HOST') {
            if (!getAttachedEquipmentIds(target).includes(source.instanceId)) return false;
            if (eff.targetFilter && !this.matchesFilterSafe(target, eff.targetFilter, ctx.hasCardTrait, source.instanceId, undefined, true)) {
              return false;
            }
          } else {
            if (source.controllerPlayerId !== target.controllerPlayerId) return false;
            if (eff.targetFilter && !this.matchesFilterSafe(target, eff.targetFilter, ctx.hasCardTrait, source.instanceId, undefined, true)) {
              return false;
            }
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
              : eff.scope === 'EQUIPPED_HOST'
                ? ('EQUIPPED' as const)
                : ('FIELD_ROLE' as const);

        if (hasNonStat) {
          continuousEffects.registerStaticRule({
            id: `dsl:${eff.id}:nonstat`,
            layer: 'NON_STAT',
            sourceKind,
            ...(eff.sourceZones ? { sourceZones: eff.sourceZones } : {}),
            providesTraits: Boolean(eff.addTraits?.length || eff.clearBaseTraits),
            dependsOnTraits: eff.dependsOnTraits,
            matchSource: (src) => src.cardNumber === spec.cardNumber,
            evaluate: (source, target, ctx) => {
              if (!matchesTargetAndCond(source, target, ctx)) return undefined;
              const staticEval = {
                getCardsInZone: ctx.getCardsInZone,
                getFieldRoles: ctx.getFieldRoles,
                hasTraitFn: ctx.hasCardTrait,
              };
              const costDelta =
                eff.costDelta !== undefined
                  ? this.evalNumberExpr(eff.costDelta, source.controllerPlayerId, source.instanceId, {}, staticEval)
                  : undefined;
              const setCost =
                eff.setCost !== undefined
                  ? this.evalNumberExpr(eff.setCost, source.controllerPlayerId, source.instanceId, {}, staticEval)
                  : undefined;
              return {
                ...(eff.keywords ? { keywords: eff.keywords } : {}),
                ...(eff.addTraits ? { addTraits: eff.addTraits } : {}),
                ...(eff.clearBaseTraits ? { clearBaseTraits: true } : {}),
                ...(eff.setCardType !== undefined ? { setCardType: eff.setCardType } : {}),
                ...(costDelta !== undefined ? { costDelta } : {}),
                ...(setCost !== undefined ? { setCost } : {}),
                ...(eff.canAttackReadyRolesMaxCost !== undefined
                  ? { canAttackReadyRolesMaxCost: eff.canAttackReadyRolesMaxCost }
                  : {}),
                ...(eff.mustBeAttackTarget ? { mustBeAttackTarget: true } : {}),
                ...(eff.prohibitions ? { prohibitions: eff.prohibitions } : {}),
                ...(eff.treatedAsOrbColors ? { treatedAsOrbColors: eff.treatedAsOrbColors } : {}),
                ...(eff.orbValue !== undefined ? { orbValue: eff.orbValue } : {}),
                ...(eff.treatedAsNames ? { treatedAsNames: eff.treatedAsNames } : {}),
                ...(eff.unblockableMaxPP !== undefined ? { unblockableMaxPP: eff.unblockableMaxPP } : {}),
                ...(eff.grantedTriggerIds?.length ? { grantedTriggerIds: eff.grantedTriggerIds } : {}),
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
            ...(eff.sourceZones ? { sourceZones: eff.sourceZones } : {}),
            dependsOnTraits: eff.dependsOnTraits,
            matchSource: (src) => src.cardNumber === spec.cardNumber,
            evaluate: (source, target, ctx) => {
              if (!matchesTargetAndCond(source, target, ctx)) return undefined;
              const staticEval = {
                getCardsInZone: ctx.getCardsInZone,
                getFieldRoles: ctx.getFieldRoles,
                hasTraitFn: ctx.hasCardTrait,
              };
              const pp =
                eff.pp !== undefined
                  ? this.evalNumberExpr(eff.pp, source.controllerPlayerId, source.instanceId, {}, staticEval)
                  : undefined;
              const setPP =
                eff.setPP !== undefined
                  ? this.evalNumberExpr(eff.setPP, source.controllerPlayerId, source.instanceId, {}, staticEval)
                  : undefined;
              const dp =
                eff.dp !== undefined
                  ? this.evalNumberExpr(eff.dp, source.controllerPlayerId, source.instanceId, {}, staticEval)
                  : undefined;
              const setDP =
                eff.setDP !== undefined
                  ? this.evalNumberExpr(eff.setDP, source.controllerPlayerId, source.instanceId, {}, staticEval)
                  : undefined;
              const setBaseDP =
                eff.setBaseDP !== undefined
                  ? this.evalNumberExpr(eff.setBaseDP, source.controllerPlayerId, source.instanceId, {}, staticEval)
                  : undefined;
              const charge =
                eff.charge !== undefined
                  ? this.evalNumberExpr(eff.charge, source.controllerPlayerId, source.instanceId, {}, staticEval)
                  : undefined;
              const setCharge =
                eff.setCharge !== undefined
                  ? this.evalNumberExpr(eff.setCharge, source.controllerPlayerId, source.instanceId, {}, staticEval)
                  : undefined;
              return {
                ...(pp !== undefined ? { pp } : {}),
                ...(setPP !== undefined ? { setPP } : {}),
                ...(dp !== undefined ? { dp } : {}),
                ...(setDP !== undefined ? { setDP } : {}),
                ...(setBaseDP !== undefined ? { setBaseDP } : {}),
                ...(charge !== undefined ? { charge } : {}),
                ...(eff.chargeIsAbility ? { chargeIsAbility: true } : {}),
                ...(setCharge !== undefined ? { setCharge } : {}),
                appliedByPlayerId: source.controllerPlayerId,
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
        if (pending.requiredMin !== undefined && selected.length < pending.requiredMin) {
          return { success: false, error: `支付丢弃代价至少需要选择 ${pending.requiredMin} 张手牌 (8.4.2.b)` };
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
        this.eliminate(playerId, paidIds, sourceCardInstanceId, pending.excludeFromAbilityOrbCount);
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
        if (kind === 'orb') this.eliminate(playerId, [id], sourceCardInstanceId);
        else this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
        if (pending.markUsed) this.markUsed(playerId, pending.markUsedKey ?? sourceCardInstanceId);
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, [...pending.onPaid, ...remaining]);
        return { success: true };
      }

      case 'COST_PAY_COST': {
        if (selected[0] !== 'pay_cost') {
          if (pending.optional) {
            if (remaining.length > 0) {
              this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
            }
            return { success: true };
          }
          return { success: false, error: `必须支付 ${pending.amount} 费` };
        }
        if (!this.ctx.payCost(playerId, pending.amount)) {
          return { success: false, error: `费用不足，需要 ${pending.amount} 费` };
        }
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
        this.ctx.zoneMgr.setCardReady(tapId, false);
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
        if (pending.uniqueNames && selected.length > 1) {
          const names = selected.map((id) => {
            const c = this.ctx.state.cards[id];
            return (c && this.def(c)?.name) ?? id;
          });
          if (new Set(names).size !== names.length) {
            return { success: false, error: '所选卡牌的名称必须各不相同' };
          }
        }
        if (pending.uniqueCardNumbers && selected.length > 1) {
          const nums = selected.map((id) => this.ctx.state.cards[id]?.cardNumber ?? id);
          if (new Set(nums).size !== nums.length) {
            return { success: false, error: '所选卡牌的卡牌编号必须各不相同' };
          }
        }
        if (pending.distinctAttributes && selected.length > 1) {
          const attrs = selected.map((id) => {
            const c = this.ctx.state.cards[id];
            return (c && this.def(c)?.attribute) ?? id;
          });
          if (new Set(attrs).size !== attrs.length) {
            return { success: false, error: '所选卡牌的属性必须各不相同' };
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

      case 'CUSTOM_CHOICE': {
        return resolveCustomChoice(this.makeCustomRuntime(), action, pending.customFrame);
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
        this.ctx.zoneMgr.setCardReady(sourceId, false);
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
        this.ctx.zoneMgr.setCardReady(sourceId, false);
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
              requiredMin: cost.count,
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
        this.ctx.zoneMgr.setCardReady(sourceId, false);
        if (groups.length === 1) {
          this.eliminate(playerId, groups[0]!, sourceId);
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

      case 'SELF_TO_GRAVEYARD': {
        const card = this.ctx.state.cards[sourceId];
        if (!card || (card.zone !== 'BATTLEFIELD' && card.zone !== 'HAND')) {
          return { success: false, error: '该牌不在战场或手牌，无法作为代价放置到墓地' };
        }
        const fromField = card.zone === 'BATTLEFIELD';
        this.ctx.zoneMgr.moveCard(sourceId, 'GRAVEYARD', {
          isFaceUp: true,
          sentByEffectOrCost: cost.sentByEffectOrCost ?? fromField,
        });
        if (markUsed) this.markUsed(playerId, effectiveUsageKey);
        this.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
        return { success: true };
      }

      case 'SELF_AIRBORNE': {
        if (!this.ctx.fieldMgr.airborneRole(sourceId)) {
          return { success: false, error: '无法将该牌【浮空】(请确认已在战场且处理区尚无浮空模式卡牌)' };
        }
        if (markUsed) this.markUsed(playerId, effectiveUsageKey);
        this.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
        return { success: true };
      }

      case 'DISCARD_SELF_FROM_HAND': {
        const card = this.ctx.state.cards[sourceId];
        if (!card || card.zone !== 'HAND') {
          return { success: false, error: '该牌不在手牌中，无法丢弃手牌中的该牌' };
        }
        this.ctx.zoneMgr.moveCard(sourceId, 'GRAVEYARD', { isFaceUp: true });
        if (markUsed) this.markUsed(playerId, effectiveUsageKey);
        this.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
        return { success: true };
      }

      case 'DEAL_SELF_DAMAGE': {
        this.ctx.zoneMgr.applyDamageToPlayer(playerId, cost.amount, sourceId);
        if (markUsed) this.markUsed(playerId, effectiveUsageKey);
        if (this.ctx.state.status !== 'FINISHED') {
          this.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
        }
        return { success: true };
      }

      case 'COMPOSITE': {
        // 先行校验组合代价中的全部子项均可支付，再按顺序执行同步项与交互项
        const player = this.ctx.state.players[playerId];
        const totalPayCost = cost.costs.reduce((sum, c) => sum + (c.kind === 'PAY_COST' ? c.amount : 0), 0);
        if (totalPayCost > 0) {
          const avail = (player?.availableOpenCostCount ?? 0) + (player?.hiddenCostCount ?? 0);
          if (avail < totalPayCost) {
            return { success: false, error: `费用不足，共需要支付 ${totalPayCost} 费` };
          }
        }
        for (const sub of cost.costs) {
          const card = this.ctx.state.cards[sourceId];
          if (sub.kind === 'TAP_SELF' && (!card || !card.isReady)) {
            return { success: false, error: '该牌已横置，无法支付「横置该牌」的代价' };
          }
          if (sub.kind === 'DISCARD_SELF_FROM_HAND' && (!card || card.zone !== 'HAND')) {
            return { success: false, error: '该牌不在手牌中' };
          }
          if (sub.kind === 'SELF_TO_GRAVEYARD' && (!card || (card.zone !== 'BATTLEFIELD' && card.zone !== 'HAND'))) {
            return { success: false, error: '该牌无法从当前区域放置到墓地' };
          }
          if (sub.kind === 'SELF_AIRBORNE') {
            const hasAirborne = this.zone(playerId, 'PROCESSING').some((c) => c.isAirborne === true);
            const srcCard = this.ctx.state.cards[sourceId];
            const canAirborneFromZone =
              this.ctx.fieldMgr.isSlotRole(playerId, sourceId) || srcCard?.zone === 'HAND';
            if (hasAirborne || !canAirborneFromZone) {
              return { success: false, error: '处理区已存在浮空模式卡牌或该牌无法从当前区域【浮空】' };
            }
          }
          if (sub.kind === 'DISCARD_HAND' && !sub.optional) {
            const hand = this.zone(playerId, 'HAND').filter((c) => !sub.filter || this.matchesFilter(c, sub.filter, sourceId));
            if (hand.length < sub.count) {
              return { success: false, error: `符合条件的手牌不足 ${sub.count} 张` };
            }
          }
          if (sub.kind === 'ELIMINATE_ORBS' && !sub.optional) {
            if (this.orbGroups(playerId, sub.count, sub.filter).length === 0) {
              return { success: false, error: '信号球区没有满足条件的信号球' };
            }
          }
        }
        const interactive: AbilityCost[] = [];
        for (const sub of cost.costs) {
          if (
            sub.kind === 'DISCARD_HAND' ||
            sub.kind === 'ELIMINATE_ORBS' ||
            sub.kind === 'ELIMINATE_ORB_OR_DISCARD_HAND'
          ) {
            interactive.push(sub);
          } else {
            const res = this.executeWithCost(cardNumber, sourceId, playerId, sub, [], false, vars);
            if (!res.success) return res;
          }
        }
        if (interactive.length === 0) {
          if (markUsed) this.markUsed(playerId, effectiveUsageKey);
          this.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
          return { success: true };
        }
        if (interactive.length === 1) {
          return this.executeWithCost(cardNumber, sourceId, playerId, interactive[0]!, steps, markUsed, vars, effectiveUsageKey);
        }
        const extraSteps: EffectStep[] = [];
        for (let i = 1; i < interactive.length; i++) {
          const ic = interactive[i]!;
          if (ic.kind === 'ELIMINATE_ORBS') {
            extraSteps.push({
              op: 'ELIMINATE_ORB_COST',
              filter: ic.filter,
              count: ic.count,
              optional: ic.optional,
              prompt: ic.prompt,
              savePaidToVar: ic.savePaidToVar,
              onPaid: i === interactive.length - 1 ? steps : [],
            });
          } else if (ic.kind === 'DISCARD_HAND') {
            extraSteps.push({
              op: 'DISCARD_COST_STEP',
              count: ic.count,
              filter: ic.filter,
              optional: ic.optional,
              prompt: ic.prompt,
              onPaid: i === interactive.length - 1 ? steps : [],
            });
          }
        }
        return this.executeWithCost(
          cardNumber,
          sourceId,
          playerId,
          interactive[0]!,
          extraSteps.length > 0 ? extraSteps : steps,
          markUsed,
          vars,
          effectiveUsageKey
        );
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
              requiredMin: cost.count,
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
          this.eliminate(playerId, groups[0]!, sourceId);
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

        case 'DISCARD_OPPONENT_RANDOM_HAND': {
          const oppId = this.resolveSide(playerId, 'OPPONENT');
          for (let i = 0; i < step.count; i++) {
            const hand = this.zone(oppId, 'HAND');
            if (hand.length === 0) break;
            const pickIdx = this.ctx.zoneMgr.nextRandomInt(hand.length);
            const victim = hand[pickIdx]!;
            this.ctx.zoneMgr.moveCard(victim.instanceId, 'GRAVEYARD', { isFaceUp: true });
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
              pendingAction: {
                kind: 'SAVE_CHOICE',
                saveToVar: step.saveToVar,
                uniqueNames: step.uniqueNames,
                maxTotalCost: step.maxTotalCost,
              },
            }
          );
          return;
        }

        case 'CHOOSE_ZONE_CARDS': {
          const targetPlayer = this.resolveSide(playerId, step.side);
          const isBlindOpponentHand = step.zone === 'OPPONENT_HAND_BLIND';
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
            } else if (z === 'SELF_UNDERNEATH') {
              const selfCard = this.ctx.state.cards[sourceId];
              for (const uid of selfCard?.underneathCardIds ?? []) {
                if (!seenIds.has(uid) && this.ctx.state.cards[uid]) {
                  seenIds.add(uid);
                  rawPool.push(this.ctx.state.cards[uid]!);
                }
              }
            } else if (z === 'HOST_UNDERNEATH') {
              for (const host of this.fieldTopHosts(targetPlayer)) {
                if (step.hostFilter && !this.matchesFilter(host, step.hostFilter, sourceId)) continue;
                for (const uid of host.underneathCardIds ?? []) {
                  if (!seenIds.has(uid) && this.ctx.state.cards[uid]) {
                    seenIds.add(uid);
                    rawPool.push(this.ctx.state.cards[uid]!);
                  }
                }
              }
            } else if (z === 'OPPONENT_HAND_BLIND') {
              for (const c of this.zone(targetPlayer, 'HAND')) {
                if (!seenIds.has(c.instanceId)) {
                  seenIds.add(c.instanceId);
                  rawPool.push(c);
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
          const rawMax =
            step.dynamicMax !== undefined
              ? Math.max(0, Math.floor(this.evalNumberExpr(step.dynamicMax, playerId, sourceId, vars)))
              : (step.max ?? 1);
          const rawMin =
            step.dynamicMin !== undefined
              ? Math.max(0, Math.floor(this.evalNumberExpr(step.dynamicMin, playerId, sourceId, vars)))
              : (step.min ?? 1);
          const slotCap = step.requireEmptySlot ? this.emptySlotCount(playerId) : candidates.length;
          const maxSelections = Math.min(rawMax, candidates.length, slotCap);
          const minSelections = Math.min(rawMin, maxSelections);
          if (candidates.length === 0 || (step.requireEmptySlot && !this.hasEmptySlot(playerId)) || maxSelections <= 0) {
            vars[step.saveToVar] = [];
            break;
          }
          const effectType = step.choiceEffectType ?? `DSL_CHOOSE_ZONE_${cardNumber}`;
          this.enqueueDslChoice(
            {
              id: this.choiceId(effectType),
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: this.formatPrompt(step.prompt, playerId),
              options: isBlindOpponentHand
                ? candidates.map((c, idx) => ({
                    id: c.instanceId,
                    label: `对方手牌 #${idx + 1}`,
                  }))
                : candidates.map((c, idx) =>
                    !c.isFaceUp && (c.zone === 'SIGNAL_ORB' || c.zone === 'COST')
                      ? {
                          id: c.instanceId,
                          label: c.zone === 'SIGNAL_ORB' ? `背面信号球 #${idx + 1}` : `背面暗费 #${idx + 1}`,
                        }
                      : this.effects.createGeneralCardChoiceOption(c, { ineligibleReason: step.ineligibleReason })
                  ),
              effectType,
              sourceCardInstanceId: sourceId,
              minSelections,
              maxSelections,
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
                uniqueNames: step.uniqueNames,
                uniqueCardNumbers: step.uniqueCardNumbers,
                distinctAttributes: step.distinctAttributes,
                maxTotalCost: step.maxTotalCost,
                requireEmptySlotCount: Boolean(step.requireEmptySlot && rawMax > 1),
              },
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
                uniqueNames: step.uniqueNames,
                uniqueCardNumbers: step.uniqueCardNumbers,
                distinctAttributes: step.distinctAttributes,
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
            this.eliminate(playerId, groups[0]!, sourceId, step.excludeFromAbilityOrbCount);
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
                excludeFromAbilityOrbCount: step.excludeFromAbilityOrbCount,
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
                requiredMin,
                savePaidToVar: step.savePaidToVar,
              },
            }
          );
          return;
        }

        case 'PAY_COST_STEP': {
          const amount = Math.max(0, Math.floor(this.evalNumberExpr(step.amount, playerId, sourceId, vars)));
          const player = this.ctx.state.players[playerId];
          const avail = (player?.availableOpenCostCount ?? 0) + (player?.hiddenCostCount ?? 0);
          const optional = Boolean(step.optional);
          if (amount <= 0) {
            queue.unshift(...step.onPaid);
            break;
          }
          if (avail < amount) {
            break;
          }
          if (!optional) {
            if (this.ctx.payCost(playerId, amount)) {
              queue.unshift(...step.onPaid);
            }
            break;
          }
          const effectType = step.choiceEffectType ?? `DSL_PAY_COST_${cardNumber}`;
          this.enqueueDslChoice(
            {
              id: this.choiceId('step-pay-cost'),
              playerId,
              choiceType: 'SELECT_OPTION',
              prompt: this.formatPrompt(step.prompt ?? `是否支付 ${amount} 费？`, playerId),
              options: [
                { id: 'pay_cost', label: `支付 ${amount} 费` },
                { id: 'skip', label: '不支付' },
              ],
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
                kind: 'COST_PAY_COST',
                amount,
                onPaid: [...step.onPaid],
                optional: true,
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
            const belowCard = pos > 0 ? orbZone[pos - 1] : undefined;
            const belowLabel = belowCard
              ? belowCard.isFaceUp
                ? `【${this.def(belowCard)?.name ?? pos}】`
                : `背面信号球 #${pos}`
              : String(pos);
            const label =
              pos === 0
                ? '放置到信号球区最下方 (位置 1)'
                : pos === orbZone.length
                  ? `放置到信号球区最上方 (位置 ${pos + 1})`
                  : `放置到第 ${pos + 1} 位 (在${belowLabel}上方)`;
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
              options: cards.map((c, idx) =>
                !c.isFaceUp && (c.zone === 'SIGNAL_ORB' || c.zone === 'COST')
                  ? {
                      id: c.instanceId,
                      label: c.zone === 'SIGNAL_ORB' ? `背面信号球 #${idx + 1}` : `背面暗费 #${idx + 1}`,
                    }
                  : this.effects.createGeneralCardChoiceOption(c)
              ),
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
              if (
                this.bringToField(
                  playerId,
                  id,
                  step.triggerEntry !== false,
                  Boolean(step.enterTapped),
                  Boolean(step.loseAbilities),
                  cardNumber
                )
              ) {
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
              // 1.3.3 / Q&A·10：禁止因效果或我方效果置入角色下方 (BP04-002/003/005/008)
              const prohibitions = this.ctx.fieldMgr.evaluateRoleStats(id).prohibitions;
              if (prohibitions.includes('CANNOT_BE_PLACED_UNDERNEATH')) continue;
              if (
                card.controllerPlayerId === playerId &&
                prohibitions.includes('CANNOT_BE_PLACED_UNDERNEATH_BY_SELF')
              ) {
                continue;
              }
              if (card.partnerOfCardId) {
                const oldHost = this.ctx.state.cards[card.partnerOfCardId];
                if (oldHost) oldHost.partnerCardId = undefined;
                card.partnerOfCardId = undefined;
                card.cannotReleasePartnerUntilTurn = undefined;
                card.releasePartnerToDeckBottom = undefined;
              }
              const wasTopLevelField =
                card.zone === 'BATTLEFIELD' && this.ctx.fieldMgr.isTopLevelFieldCard(card.controllerPlayerId, id);
              // PR-041：includeUnderneath=true 时连同原下方卡牌一并转移至新宿主下方，不因 handleCardLeaveField 送墓
              const carriedUnderIds = step.includeUnderneath ? [...(card.underneathCardIds ?? [])] : [];
              if (step.includeUnderneath && carriedUnderIds.length > 0) {
                card.underneathCardIds = [];
              }
              if (wasTopLevelField) {
                const prevController = card.controllerPlayerId;
                const snapshot = this.ctx.triggerMgr?.snapshotCard(id);
                this.ctx.fieldMgr.handleCardLeaveField(id);
                card.modifiers = undefined;
                card.tempPPBonus = undefined;
                card.tempDPBonus = undefined;
                card.grantedKeywords = undefined;
                card.isFrozen = undefined;
                card.endOfTurnToGraveyard = undefined;
                card.slotIndex = undefined;
                card.wasAscendedPlay = undefined;
                card.ascendedFromAirborne = undefined;
                card.paidHiddenCostOnPlay = undefined;
                card.controllerPlayerId = host.controllerPlayerId;
                this.ctx.triggerMgr?.emit({
                  type: 'CARD_LEFT_FIELD',
                  playerId: prevController,
                  cardInstanceId: id,
                  fromZone: 'BATTLEFIELD',
                  toZone: 'BATTLEFIELD',
                  subjectSnapshot: snapshot,
                });
              } else if (card.zone === 'BATTLEFIELD') {
                for (const other of Object.values(this.ctx.state.cards)) {
                  if (other.underneathCardIds?.includes(id)) {
                    other.underneathCardIds = other.underneathCardIds.filter((x) => x !== id);
                  }
                }
                card.modifiers = undefined;
                card.tempPPBonus = undefined;
                card.tempDPBonus = undefined;
                card.grantedKeywords = undefined;
                card.isFrozen = undefined;
                card.endOfTurnToGraveyard = undefined;
                card.slotIndex = undefined;
                card.controllerPlayerId = host.controllerPlayerId;
              } else {
                this.ctx.zoneMgr.moveCard(id, 'BATTLEFIELD', { isFaceUp: true, isReady: true });
                card.controllerPlayerId = host.controllerPlayerId;
              }
              card.isFaceUp = true;
              card.isReady = true;
              card.slotIndex = undefined;
              if (!host.underneathCardIds.includes(id)) {
                host.underneathCardIds.push(id);
              }
              for (const carriedId of carriedUnderIds) {
                const cc = this.ctx.state.cards[carriedId];
                if (!cc || carriedId === host.instanceId) continue;
                cc.zone = 'BATTLEFIELD';
                cc.controllerPlayerId = host.controllerPlayerId;
                cc.isFaceUp = true;
                cc.isReady = true;
                cc.slotIndex = undefined;
                cc.modifiers = undefined;
                if (!host.underneathCardIds.includes(carriedId)) {
                  host.underneathCardIds.push(carriedId);
                }
              }
              moved.push(id);
            } else {
              if (step.target.kind === 'REST_OF_VAR' && card.zone !== 'PROCESSING') continue;
              if (step.toZone === 'GRAVEYARD') {
                this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', {
                  isFaceUp: step.isFaceUp ?? true,
                  sentByEffectOrCost: step.sentByEffectOrCost ?? (card.zone === 'BATTLEFIELD'),
                  countAsDeckToGy: card.zone === 'PROCESSING' && card.enteredFromZone === 'DECK',
                });
              } else {
                this.ctx.zoneMgr.moveCard(id, step.toZone, {
                  isFaceUp: step.isFaceUp ?? true,
                  ...(step.isReady !== undefined ? { isReady: step.isReady } : {}),
                });
              }
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
          this.ctx.zoneMgr.applyDamageToPlayer(targetPlayer, step.amount, sourceId || undefined);
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
            this.ctx.zoneMgr.setCardReady(id, step.isReady);
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

        case 'SET_COMBAT_MAX_DAMAGE': {
          const combat = this.ctx.state.currentCombat;
          if (combat) {
            combat.maxDamageInDamageStep =
              combat.maxDamageInDamageStep === undefined
                ? step.maxDamage
                : Math.min(combat.maxDamageInDamageStep, step.maxDamage);
          }
          break;
        }

        case 'REDIRECT_ATTACK': {
          const combat = this.ctx.state.currentCombat;
          if (!combat) break;
          if (step.targetType === 'PLAYER') {
            combat.targetType = 'PLAYER';
            combat.targetCardId = undefined;
            combat.blockerCardId = undefined;
          } else {
            const targetId = this.resolveTargetIds(step.target, playerId, sourceId, vars)[0];
            if (targetId && this.ctx.state.cards[targetId]) {
              combat.targetType = 'CHARACTER';
              combat.targetCardId = targetId;
              combat.blockerCardId = undefined;
            }
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
          const prevPartnerZone = partnerId ? this.ctx.state.cards[partnerId]?.zone : undefined;
          if (
            hostId &&
            partnerId &&
            this.ctx.fieldMgr.attachPartner(playerId, hostId, partnerId, {
              releaseToDeckBottom: step.releaseToDeckBottom,
            })
          ) {
            this.ctx.triggerMgr?.emit({
              type: 'PARTNER_GAINED',
              playerId,
              cardInstanceId: hostId,
              targetCardId: partnerId,
              fromZone: prevPartnerZone,
            });
          }
          break;
        }

        case 'DETACH_AND_MOVE_PARTNER': {
          const hosts = this.resolveTargetIds(step.host, playerId, sourceId, vars);
          for (const hostId of hosts) {
            const host = this.ctx.state.cards[hostId];
            const partnerId = host?.partnerCardId;
            const partner = partnerId ? this.ctx.state.cards[partnerId] : undefined;
            if (!host || !partnerId || !partner) continue;
            host.partnerCardId = undefined;
            partner.partnerOfCardId = undefined;
            partner.cannotReleasePartnerUntilTurn = undefined;
            partner.releasePartnerToDeckBottom = undefined;
            if (step.toZone === 'BATTLEFIELD') {
              if (!this.bringToField(host.controllerPlayerId, partnerId, step.triggerEntry !== false)) {
                this.ctx.zoneMgr.moveCard(partnerId, 'GRAVEYARD', { isFaceUp: true });
              }
            } else if (step.toZone === 'DECK_BOTTOM') {
              this.ctx.zoneMgr.moveCardToBottomOfDeck(partnerId);
            } else {
              this.ctx.zoneMgr.moveCard(partnerId, step.toZone, { isFaceUp: true });
            }
            this.ctx.triggerMgr?.emit({
              type: 'PARTNER_RELEASED',
              playerId: host.controllerPlayerId,
              cardInstanceId: hostId,
              targetCardId: partnerId,
              subjectSnapshot: this.ctx.triggerMgr.snapshotCard(partnerId),
            });
          }
          break;
        }

        case 'COPY_STATS_FROM_VAR': {
          const refId = (vars[step.fromVar] ?? [])[0];
          const refCard = refId ? this.ctx.state.cards[refId] : undefined;
          const refDef = refCard ? this.def(refCard) : undefined;
          if (!refCard || !refDef) break;
          const targets = this.resolveTargetIds(step.target, playerId, sourceId, vars);
          const untilTurn = this.resolveUntilTurn(step.duration, turn);
          for (const id of targets) {
            const card = this.ctx.state.cards[id];
            if (!card) continue;
            const mod: CardModifier = {
              ...(step.duration === 'END_OF_COMBAT'
                ? { id: `combat-${card.instanceId}-${this.ctx.events.length}-${this.choiceSeq++}` }
                : {}),
              ...(step.copyBasePP ? { setBasePP: refDef.basePP ?? 0 } : {}),
              ...(step.copyBaseDP ? { setBaseDP: refDef.baseDP ?? 0 } : {}),
              untilTurn,
              source: cardNumber,
              sourceCardInstanceId: sourceId,
              appliedByPlayerId: playerId,
            };
            addCardModifier(this.ctx.state, card, mod);
          }
          break;
        }

        case 'INCREMENT_CARDS_PLAYED_THIS_TURN': {
          const player = this.ctx.state.players[playerId];
          if (player) {
            player.cardsPlayedThisTurn = (player.cardsPlayedThisTurn ?? 0) + (step.amount ?? 1);
          }
          break;
        }

        case 'REGISTER_REPLACEMENT': {
          const targets = this.resolveTargetIds(step.target, playerId, sourceId, vars);
          const untilTurn = this.resolveUntilTurn(step.duration, turn);
          for (const id of targets) {
            const card = this.ctx.state.cards[id];
            if (!card) continue;
            this.ctx.replacementEngine?.addActiveReplacement({
              eventType: step.eventType,
              targetCardInstanceId: id,
              controllerPlayerId: card.controllerPlayerId,
              action: step.action,
              once: step.once,
              untilTurn,
              source: cardNumber,
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
              ...(step.setBaseDP !== undefined
                ? { setBaseDP: this.evalNumberExpr(step.setBaseDP, playerId, sourceId, vars) }
                : {}),
              ...(step.setPP !== undefined ? { setPP: this.evalNumberExpr(step.setPP, playerId, sourceId, vars) } : {}),
              ...(step.setDP !== undefined ? { setDP: this.evalNumberExpr(step.setDP, playerId, sourceId, vars) } : {}),
              ...(step.charge !== undefined ? { charge: this.evalNumberExpr(step.charge, playerId, sourceId, vars) } : {}),
              ...(step.setCharge !== undefined ? { setCharge: this.evalNumberExpr(step.setCharge, playerId, sourceId, vars) } : {}),
              ...(step.keywords ? { keywords: step.keywords } : {}),
              ...(step.removeKeywords ? { removeKeywords: step.removeKeywords } : {}),
              ...(step.addTraits ? { addTraits: step.addTraits } : {}),
              ...(step.clearBaseTraits ? { clearBaseTraits: true } : {}),
              ...(step.setCardType !== undefined ? { setCardType: step.setCardType } : {}),
              ...(step.costDelta !== undefined
                ? { costDelta: this.evalNumberExpr(step.costDelta, playerId, sourceId, vars) }
                : {}),
              ...(step.setCost !== undefined ? { setCost: this.evalNumberExpr(step.setCost, playerId, sourceId, vars) } : {}),
              ...(step.canAttackReadyRolesMaxCost !== undefined
                ? { canAttackReadyRolesMaxCost: step.canAttackReadyRolesMaxCost }
                : {}),
              ...(step.mustBeAttackTarget ? { mustBeAttackTarget: true } : {}),
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
          const amount = this.evalNumberExpr(step.amount, playerId, sourceId, vars);
          player.costModifiers = [
            ...(player.costModifiers ?? []),
            {
              id: `cost-mod-${sourceId}-${this.ctx.events.length}`,
              amount,
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
          const triggerTurn = turn + (step.turnOffset ?? 0);
          if (step.abilityId === 'DELAYED_END_OF_TURN_DRAW') {
            const drawController = this.resolveSide(playerId, step.targetSide ?? 'SELF');
            const drawCount = step.drawCount ?? 1;
            this.ctx.triggerMgr?.registerDelayedTrigger({
              eventType: step.eventType,
              triggerTurn,
              sourceCardInstanceId: sourceId,
              sourceCardNumber: cardNumber,
              controllerPlayerId: drawController,
              abilityId: step.abilityId,
              label: step.labelSuffix ?? `回合结束时抽 ${drawCount} 张牌`,
              once: true,
              payload: { count: drawCount },
            });
            break;
          }
          if (step.abilityId === 'DELAYED_ATTACK_END_DEPLOY_PARTNER') {
            const hostCard = this.ctx.state.cards[sourceId];
            const partnerId = this.resolveTargetIds(step.target, playerId, sourceId, vars)[0] ?? hostCard?.partnerCardId;
            const partnerCard = partnerId ? this.ctx.state.cards[partnerId] : undefined;
            if (hostCard && partnerCard) {
              const partnerFromZone = vars.__partnerFromZone?.[0];
              const grantRush = Boolean(
                step.grantRushIfPartnerFromZone && partnerFromZone === step.grantRushIfPartnerFromZone
              );
              this.ctx.triggerMgr?.registerDelayedTrigger({
                eventType: step.eventType,
                triggerTurn,
                sourceCardInstanceId: hostCard.instanceId,
                sourceCardNumber: cardNumber,
                controllerPlayerId: hostCard.controllerPlayerId,
                abilityId: 'DELAYED_ATTACK_END_DEPLOY_PARTNER',
                label:
                  step.labelSuffix ??
                  `【${this.def(partnerCard)?.name ?? partnerCard.cardNumber}】攻击结束时从协战搭档出场${grantRush ? '并获得【速攻】' : ''}`,
                once: true,
                payload: {
                  hostCardId: hostCard.instanceId,
                  partnerCardId: partnerCard.instanceId,
                  grantRush,
                },
              });
            }
            break;
          }
          const targets = this.resolveTargetIds(step.target, playerId, sourceId, vars);
          const expectedZone = step.expectedZone ?? 'BATTLEFIELD';
          const defaultLabel =
            step.abilityId === 'DELAYED_END_OF_TURN_UNTAP'
              ? '该回合结束时将其竖直'
              : step.abilityId === 'DELAYED_END_OF_TURN_TO_DECK_BOTTOM'
                ? '该回合结束时放置到牌组底'
                : step.abilityId === 'DELAYED_ATTACK_END_TO_SIGNAL_ORB_BOTTOM'
                  ? '那次攻击结束时放置到我方信号球区最下方'
                  : '该回合结束时放置到墓地';
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
              label: `【${this.def(card)?.name ?? card.cardNumber}】${step.labelSuffix ?? defaultLabel}`,
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

        case 'CUSTOM_HANDLER': {
          const paused = startCustomHandler(
            step.handlerId,
            this.makeCustomRuntime(),
            cardNumber,
            sourceId,
            playerId,
            vars,
            queue
          );
          if (paused) return;
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
      case 'SELF_UNDERNEATH': {
        const selfCard = sourceId ? this.ctx.state.cards[sourceId] : undefined;
        return (selfCard?.underneathCardIds ?? []).filter((uid) => {
          const uc = this.ctx.state.cards[uid];
          return Boolean(uc && (!target.filter || this.matchesFilter(uc, target.filter, sourceId)));
        });
      }
      case 'SELF_PARTNER': {
        const pid = sourceId ? this.ctx.state.cards[sourceId]?.partnerCardId : undefined;
        return pid ? [pid] : [];
      }
      case 'ZONE_BOTTOM_CARD': {
        const sidePlayer = this.resolveSide(playerId, target.side);
        const list = this.zone(sidePlayer, target.zone);
        const last = list.length > 0 ? list[list.length - 1] : undefined;
        return last ? [last.instanceId] : [];
      }
      case 'TRIGGER_ATTACKER':
        return vars.__triggerAttacker ?? [];
      case 'TRIGGER_BLOCKER':
        return vars.__triggerBlocker ?? [];
      case 'TRIGGER_HOST':
        return vars.__triggerHost ?? [];
      case 'TRIGGER_TARGET':
        return vars.__triggerTarget ?? [];
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
      case 'HOST_UNDERNEATH_MATCHING': {
        const sidePlayer = this.resolveSide(playerId, target.side);
        const result: string[] = [];
        for (const host of this.fieldTopHosts(sidePlayer)) {
          if (target.roleFilter && !this.matchesFilter(host, target.roleFilter, sourceId)) continue;
          for (const uid of host.underneathCardIds ?? []) {
            const uc = this.ctx.state.cards[uid];
            if (!uc) continue;
            if (target.cardFilter && !this.matchesFilter(uc, target.cardFilter, sourceId)) continue;
            result.push(uid);
          }
        }
        return result;
      }
    }
  }

  private evalNumberExpr(
    expr: NumberExpr,
    playerId: string,
    sourceId: string,
    vars: Record<string, string[]> = {},
    staticCtx?: {
      getCardsInZone: (pid: string, z: ZoneId) => CardInstance[];
      getFieldRoles: (pid: string) => CardInstance[];
      hasTraitFn: (id: string, trait: string) => boolean;
    }
  ): number {
    if (typeof expr === 'number') return expr;
    const resolveRoles = (pid: string) => (staticCtx ? staticCtx.getFieldRoles(pid) : this.roles(pid));
    const resolveTopHosts = (pid: string) =>
      (this.ctx.state.battlefields[pid] ?? [])
        .flatMap((s) => [s.roleCardId, s.assistCardId, s.standaloneEquipmentId])
        .map((id) => (id ? this.ctx.state.cards[id] : undefined))
        .filter((c): c is CardInstance => Boolean(c));
    const resolveZone = (pid: string, z: ZoneId) => (staticCtx ? staticCtx.getCardsInZone(pid, z) : this.zone(pid, z));
    const checkFilter = (c: CardInstance, f: CardFilter) =>
      staticCtx
        ? this.matchesFilterSafe(c, f, staticCtx.hasTraitFn, sourceId, undefined, true)
        : this.matchesFilter(c, f, sourceId);

    switch (expr.kind) {
      case 'EROSION_MULT': {
        const pid = this.resolveSide(playerId, expr.side);
        return (this.ctx.state.players[pid]?.erosionCount ?? 0) * expr.multiplier;
      }
      case 'ROLE_COUNT_MULT': {
        const pid = this.resolveSide(playerId, expr.side);
        const count = resolveRoles(pid).filter((r) => !expr.filter || checkFilter(r, expr.filter)).length;
        return count * expr.multiplier;
      }
      case 'UNDERNEATH_COUNT_MULT': {
        const ids = (this.ctx.state.cards[sourceId]?.underneathCardIds ?? []).filter((id) => {
          const c = this.ctx.state.cards[id];
          return Boolean(c && (!expr.filter || checkFilter(c, expr.filter)));
        });
        if (!expr.uniqueNames) return ids.length * expr.multiplier;
        const names = new Set<string>();
        for (const id of ids) {
          const c = this.ctx.state.cards[id];
          const name = c ? this.def(c)?.name : undefined;
          if (name) names.add(normalizeCardName(name));
        }
        return names.size * expr.multiplier;
      }
      case 'SUM_UNDERNEATH_COUNT': {
        const pid = this.resolveSide(playerId, expr.side);
        const hosts = resolveTopHosts(pid).filter((r) => !expr.roleFilter || checkFilter(r, expr.roleFilter));
        const seenNames = new Set<string>();
        let total = 0;
        for (const h of hosts) {
          for (const uid of h.underneathCardIds ?? []) {
            const c = this.ctx.state.cards[uid];
            if (!c) continue;
            if (expr.filter && !checkFilter(c, expr.filter)) continue;
            if (expr.uniqueNames) {
              const name = this.def(c)?.name;
              if (name) seenNames.add(normalizeCardName(name));
            } else {
              total += 1;
            }
          }
        }
        const count = expr.uniqueNames ? seenNames.size : total;
        return count * (expr.multiplier ?? 1);
      }
      case 'ORB_ZONE_COUNT_MULT': {
        const pid = this.resolveSide(playerId, expr.side);
        const count = resolveZone(pid, 'SIGNAL_ORB').filter((c) => !expr.filter || checkFilter(c, expr.filter)).length;
        return count * expr.multiplier;
      }
      case 'ZONE_COUNT_MULT': {
        const pid = this.resolveSide(playerId, expr.side);
        const matched = resolveZone(pid, expr.zone).filter((c) => !expr.filter || checkFilter(c, expr.filter));
        if (!expr.uniqueNames) return matched.length * expr.multiplier;
        const names = new Set<string>();
        for (const c of matched) {
          const name = this.def(c)?.name;
          if (name) names.add(name);
        }
        return names.size * expr.multiplier;
      }
      case 'VAR_COUNT_MULT':
        return (vars[expr.varName]?.length ?? 0) * expr.multiplier;
      case 'VAR_DISTINCT_COST_MULT': {
        const distinctCosts = new Set<number>();
        for (const id of vars[expr.varName] ?? []) {
          const c = this.ctx.state.cards[id];
          const d = c ? this.def(c) : undefined;
          if (d !== undefined) distinctCosts.add(d.cost);
        }
        return distinctCosts.size * expr.multiplier;
      }
      case 'FLOOR_DIV':
        return Math.floor(this.evalNumberExpr(expr.expr, playerId, sourceId, vars, staticCtx) / expr.divisor);
      case 'ADD':
        return (
          this.evalNumberExpr(expr.left, playerId, sourceId, vars, staticCtx) +
          this.evalNumberExpr(expr.right, playerId, sourceId, vars, staticCtx)
        );
    }
  }

  private evalConditionWithResolvers(
    cond: ConditionExpr,
    playerId: string,
    sourceId: string,
    vars: Record<string, string[]>,
    state: CardEffectContext['state'],
    getCardsInZone: (pid: string, z: ZoneId) => CardInstance[],
    getFieldRoles: (pid: string) => CardInstance[],
    hasTraitFn: (cardInstanceId: string, trait: string) => boolean,
    inStaticEval: boolean
  ): boolean {
    const resolveSide = (side: PlayerSide) =>
      side === 'SELF'
        ? playerId
        : playerId === state.activePlayerId
          ? state.nonActivePlayerId
          : state.activePlayerId;

    const matchCard = (c: CardInstance, filter: CardFilter): boolean =>
      inStaticEval
        ? this.matchesFilterSafe(c, filter, hasTraitFn, sourceId, undefined, true)
        : this.matchesFilter(c, filter, sourceId);

    switch (cond.kind) {
      case 'HAS_ROLE': {
        const pid = resolveSide(cond.side);
        const count = getFieldRoles(pid).filter((r) => !cond.filter || matchCard(r, cond.filter)).length;
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
      case 'FRIENDLY_ROLE_COUNT_COMPARE_OPPONENT': {
        const oppId = resolveSide('OPPONENT');
        return this.compare(getFieldRoles(playerId).length, cond.op, getFieldRoles(oppId).length);
      }
      case 'SIGNAL_ORB_BOTTOM_COST_PARITY': {
        const bottom = getCardsInZone(playerId, 'SIGNAL_ORB')[0];
        if (!bottom || !bottom.isFaceUp) return false;
        const cost =
          this.ctx.continuousEffects && (!inStaticEval || bottom.instanceId !== sourceId)
            ? this.ctx.continuousEffects.getEffectiveCardCost(bottom.instanceId)
            : this.def(bottom)?.cost;
        if (cost === undefined) return false;
        return cond.parity === 'ODD' ? cost % 2 === 1 : cost % 2 === 0;
      }
      case 'SELF_UNDERNEATH_COUNT': {
        const src = state.cards[sourceId];
        const underCards = (src?.underneathCardIds ?? [])
          .map((id) => state.cards[id])
          .filter((c): c is CardInstance => Boolean(c));
        const count = underCards.filter((c) => !cond.filter || matchCard(c, cond.filter)).length;
        return this.compare(count, cond.op, cond.value);
      }
      case 'TOTAL_UNDERNEATH_COUNT': {
        const pid = resolveSide(cond.side);
        const topHosts = (state.battlefields[pid] ?? [])
          .flatMap((s) => [s.roleCardId, s.assistCardId, s.standaloneEquipmentId])
          .map((id) => (id ? state.cards[id] : undefined))
          .filter((c): c is CardInstance => Boolean(c));
        const hosts = topHosts.filter((r) => !cond.roleFilter || matchCard(r, cond.roleFilter));
        let count = 0;
        for (const h of hosts) {
          for (const uid of h.underneathCardIds ?? []) {
            const c = state.cards[uid];
            if (c && (!cond.filter || matchCard(c, cond.filter))) count += 1;
          }
        }
        return this.compare(count, cond.op, cond.value);
      }
      case 'ANY_HOST_UNDERNEATH_CONTAINS': {
        const pid = resolveSide(cond.side);
        const topHosts = (state.battlefields[pid] ?? [])
          .flatMap((s) => [s.roleCardId, s.assistCardId, s.standaloneEquipmentId])
          .map((id) => (id ? state.cards[id] : undefined))
          .filter((c): c is CardInstance => Boolean(c));
        return topHosts
          .filter((r) => !cond.roleFilter || matchCard(r, cond.roleFilter))
          .some((r) =>
            (r.underneathCardIds ?? []).some((uid) => {
              const c = state.cards[uid];
              return Boolean(c && matchCard(c, cond.cardFilter));
            })
          );
      }
      case 'SELF_MATCHES_FILTER': {
        const src = state.cards[sourceId];
        return Boolean(src && matchCard(src, cond.filter));
      }
      case 'GAME_ABILITY_UNUSED':
        return (state.players[playerId]?.gameAbilityUsage?.[cond.abilityKey] ?? 0) === 0;
      case 'TURN_ABILITY_UNUSED':
        return (state.players[playerId]?.turnAbilityUsage?.[`${sourceId}:${cond.abilityKey}`] ?? 0) === 0;
      case 'ZONE_COUNT': {
        const pid = resolveSide(cond.side);
        const count = getCardsInZone(pid, cond.zone).filter((c) => !cond.filter || matchCard(c, cond.filter)).length;
        return this.compare(count, cond.op, cond.value);
      }
      case 'ALL_ZONE_CARDS_MATCH': {
        const pid = resolveSide(cond.side);
        const pre = getCardsInZone(pid, cond.zone).filter((c) => !cond.preFilter || matchCard(c, cond.preFilter));
        return pre.every((c) => matchCard(c, cond.matchFilter));
      }
      case 'ALL_ROLES_MATCH': {
        const pid = resolveSide(cond.side);
        const roles = getFieldRoles(pid);
        if (cond.requireAtLeastOne && roles.length === 0) return false;
        return roles.every((r) => matchCard(r, cond.filter));
      }
      case 'ROLE_ATTRIBUTE_DIVERSITY': {
        const pid = resolveSide(cond.side);
        const attrs = new Set<ElementAttribute>();
        for (const r of getFieldRoles(pid)) {
          if (cond.filter && !matchCard(r, cond.filter)) continue;
          const attr = this.def(r)?.attribute;
          if (attr) attrs.add(attr);
        }
        return attrs.size >= cond.minDistinct;
      }
      case 'HAS_EMPTY_SLOT': {
        const pid = resolveSide(cond.side);
        return (state.battlefields[pid] ?? []).some((s) => !s.roleCardId && !s.standaloneEquipmentId && !s.assistCardId);
      }
      case 'TURN_OWNER':
        return cond.isSelfTurn ? state.activePlayerId === playerId : state.activePlayerId !== playerId;
      case 'CURRENT_COMBAT_EXISTS':
        return Boolean(state.currentCombat);
      case 'IS_ENTER_TURN': {
        const src = state.cards[sourceId];
        return Boolean(src && src.zone === 'BATTLEFIELD' && src.turnEnteredZone === state.turnNumber);
      }
      case 'IS_DEPLOYED_FROM_PROCESSING_TURN': {
        const src = state.cards[sourceId];
        return Boolean(
          src &&
            src.zone === 'BATTLEFIELD' &&
            src.turnEnteredZone === state.turnNumber &&
            src.enteredFromZone === 'PROCESSING'
        );
      }
      case 'CARD_WAS_ASCENDED_PLAY':
        return Boolean(state.cards[sourceId]?.wasAscendedPlay);
      case 'CARD_WAS_ASCENDED_FROM_AIRBORNE':
        return Boolean(state.cards[sourceId]?.ascendedFromAirborne);
      case 'CARD_ENTERED_FROM_ZONE': {
        const src = state.cards[sourceId];
        return Boolean(src?.enteredFromZone && cond.zones.includes(src.enteredFromZone));
      }
      case 'CARD_PAID_HIDDEN_COST_ON_PLAY':
        return Boolean(state.cards[sourceId]?.paidHiddenCostOnPlay);
      case 'COMBAT_CHARGED_AUTO':
        return Boolean(state.currentCombat?.attackChargedHasChargeAuto || vars.__combatChargedAuto?.[0] === '1');
      case 'CHARGED_AUTO_BY_LEE_THIS_TURN':
        return Boolean(state.players[playerId]?.chargedAutoByLeeThisTurn);
      case 'DESTROYED_FRIENDLY_ROLES_THIS_TURN':
        return this.compare(state.players[playerId]?.destroyedFriendlyRoleCountThisTurn ?? 0, cond.op, cond.value);
      case 'ELIMINATED_THREE_ORBS_THIS_TURN': {
        const pid = resolveSide(cond.side);
        return Boolean(state.players[pid]?.eliminatedThreeOrbsThisTurn);
      }
      case 'ELIMINATED_ORBS_BY_KARENINA_THIS_TURN':
        return this.compare(state.players[playerId]?.eliminatedOrbsByKareninaCountThisTurn ?? 0, cond.op, cond.value);
      case 'DAMAGE_TAKEN_THIS_TURN': {
        const pid = resolveSide(cond.side);
        return this.compare(state.players[pid]?.damageTakenThisTurn ?? 0, cond.op, cond.value);
      }
      case 'CARDS_PLAYED_THIS_TURN': {
        const pid = resolveSide(cond.side);
        return this.compare(state.players[pid]?.cardsPlayedThisTurn ?? 0, cond.op, cond.value);
      }
      case 'ART_ASSOC_TACTICS_PLAYED_THIS_TURN': {
        const pid = resolveSide(cond.side);
        return this.compare(state.players[pid]?.turnArtAssocTacticsPlayedCount ?? 0, cond.op, cond.value);
      }
      case 'VAR_NON_EMPTY':
        return (vars[cond.varName]?.length ?? 0) > 0;
      case 'VAR_COUNT_COMPARE':
        return this.compare(vars[cond.varName]?.length ?? 0, cond.op, cond.value);
      case 'VAR_HAS_CARD_MATCHING':
        return (vars[cond.varName] ?? []).some((id) => {
          const card = state.cards[id];
          return Boolean(card && matchCard(card, cond.filter));
        });
      case 'VAR_HAS_DUPLICATE_COST': {
        const seen = new Set<number>();
        for (const id of vars[cond.varName] ?? []) {
          const c = state.cards[id];
          const d = c ? this.def(c) : undefined;
          if (d === undefined) continue;
          if (seen.has(d.cost)) return true;
          seen.add(d.cost);
        }
        return false;
      }
      case 'HAS_ELIMINABLE_ORBS':
        return this.orbGroups(playerId, cond.count, cond.filter).length > 0;
      case 'IS_STANDALONE_EQUIPMENT':
        return Boolean(sourceId && this.ctx.fieldMgr.isStandaloneEquipment(playerId, sourceId));
      case 'ALL':
        return cond.conditions.every((c) =>
          this.evalConditionWithResolvers(c, playerId, sourceId, vars, state, getCardsInZone, getFieldRoles, hasTraitFn, inStaticEval)
        );
      case 'ANY':
        return cond.conditions.some((c) =>
          this.evalConditionWithResolvers(c, playerId, sourceId, vars, state, getCardsInZone, getFieldRoles, hasTraitFn, inStaticEval)
        );
      case 'NOT':
        return !this.evalConditionWithResolvers(
          cond.condition,
          playerId,
          sourceId,
          vars,
          state,
          getCardsInZone,
          getFieldRoles,
          hasTraitFn,
          inStaticEval
        );
    }
  }

  private evalCondition(
    cond: ConditionExpr,
    playerId: string,
    sourceId: string,
    vars: Record<string, string[]>
  ): boolean {
    return this.evalConditionWithResolvers(
      cond,
      playerId,
      sourceId,
      vars,
      this.ctx.state,
      (pid, z) => this.zone(pid, z),
      (pid) => this.roles(pid),
      (id, trait) => {
        const card = this.ctx.state.cards[id];
        return Boolean(card && this.hasTrait(card, trait));
      },
      false
    );
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
    return this.evalConditionWithResolvers(
      cond,
      playerId,
      sourceId,
      {},
      state,
      getCardsInZone,
      getFieldRoles,
      hasTrait,
      true
    );
  }

  private matchesFilter(card: CardInstance, filter: CardFilter, sourceId?: string): boolean {
    return this.matchesFilterSafe(
      card,
      filter,
      (id, trait) => {
        const target = this.ctx.state.cards[id];
        return Boolean(target && this.hasTrait(target, trait));
      },
      sourceId,
      (id, name) => {
        const target = this.ctx.state.cards[id];
        if (!target) return false;
        return this.ctx.continuousEffects
          ? this.ctx.continuousEffects.hasCardName(id, name)
          : this.def(target)?.name === name;
      },
      false
    );
  }

  private matchesFilterSafe(
    card: CardInstance,
    filter: CardFilter,
    hasTraitFn: (cardInstanceId: string, trait: string) => boolean,
    sourceId?: string,
    hasNameFn?: (cardInstanceId: string, name: string) => boolean,
    inStaticEval = false
  ): boolean {
    const def = this.def(card);
    if (filter.excludeSelf && sourceId && card.instanceId === sourceId) return false;
    if (filter.anyFilters !== undefined) {
      if (
        !filter.anyFilters.some((sub) =>
          this.matchesFilterSafe(card, sub, hasTraitFn, sourceId, hasNameFn, inStaticEval)
        )
      ) {
        return false;
      }
    }
    const effectiveCardType =
      !inStaticEval && this.ctx.continuousEffects
        ? this.ctx.continuousEffects.getEffectiveCardType(card.instanceId)
        : (card.modifiers?.find((m) => m.setCardType !== undefined)?.setCardType ?? def?.cardType);
    if (filter.cardType !== undefined && effectiveCardType !== filter.cardType) return false;
    if (filter.attribute !== undefined && def?.attribute !== filter.attribute) return false;
    if (filter.excludeAttribute !== undefined && def?.attribute === filter.excludeAttribute) return false;
    if (filter.cardNumbers !== undefined && !filter.cardNumbers.includes(card.cardNumber)) return false;

    const matchesName = (expectedName: string): boolean => {
      const normExpected = normalizeCardName(expectedName);
      return hasNameFn
        ? hasNameFn(card.instanceId, expectedName)
        : Boolean(def && normalizeCardName(def.name) === normExpected) ||
            Boolean(card.modifiers?.some((m) => m.treatedAsNames?.some((n) => normalizeCardName(n) === normExpected))) ||
            (card.cardNumber === 'BP02-040' && normExpected === '飞叶点翠');
    };

    if (filter.exactName !== undefined && !matchesName(filter.exactName)) return false;
    if (filter.excludeName !== undefined && matchesName(filter.excludeName)) return false;
    if (filter.trait !== undefined && !hasTraitFn(card.instanceId, filter.trait)) return false;
    if (filter.excludeTrait !== undefined && hasTraitFn(card.instanceId, filter.excludeTrait)) return false;
    if (filter.anyTraits !== undefined && !filter.anyTraits.some((t) => hasTraitFn(card.instanceId, t))) {
      return false;
    }

    let cost: number;
    if (!inStaticEval && this.ctx.continuousEffects) {
      cost = this.ctx.continuousEffects.getEffectiveCardCost(card.instanceId);
    } else {
      cost = def?.cost ?? 99;
      if (card.zone === 'BATTLEFIELD' && card.partnerCardId) {
        const partner = this.ctx.state.cards[card.partnerCardId];
        if (partner) cost += this.def(partner)?.cost ?? 0;
      }
      for (const m of card.modifiers ?? []) {
        if (m.setCost !== undefined) cost = m.setCost;
        else if (m.costDelta !== undefined) cost += m.costDelta;
      }
      cost = Math.max(0, cost);
    }
    if (
      !inStaticEval &&
      (card.zone === 'HAND' || (card.cardNumber === 'BP01-002' && card.zone === 'DECK'))
    ) {
      cost = Math.max(0, cost - this.calculateHandCostDiscount(card.controllerPlayerId, card.cardNumber));
    }

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
      // 背面信号球属于非公开信息，不得按印刷颜色匹配 (3.5.3 / 12)
      if (card.zone === 'SIGNAL_ORB' && !card.isFaceUp) return false;
      const orbColorMatch =
        card.zone === 'SIGNAL_ORB'
          ? Boolean(this.ctx.continuousEffects?.getEffectiveOrbInfo(card.instanceId).colors.includes(filter.signalOrbColor)) ||
            (!this.ctx.continuousEffects && def?.signalOrb === filter.signalOrbColor)
          : def?.signalOrb === filter.signalOrbColor;
      if (!orbColorMatch) return false;
    }
    if (filter.isFaceUp !== undefined && card.isFaceUp !== filter.isFaceUp) return false;
    if (filter.isReady !== undefined && card.isReady !== filter.isReady) return false;
    if (filter.isFrozen !== undefined && Boolean(card.isFrozen) !== filter.isFrozen) return false;
    if (filter.isAirborne !== undefined && Boolean(card.isAirborne) !== filter.isAirborne) return false;
    if (filter.hasAssistConfig !== undefined && Boolean(def?.assistConfig) !== filter.hasAssistConfig) return false;
    if (filter.hasEquipment !== undefined && (getAttachedEquipmentIds(card).length > 0) !== filter.hasEquipment) {
      return false;
    }
    if (filter.hasPartner !== undefined && Boolean(card.partnerCardId) !== filter.hasPartner) return false;
    if (filter.minUnderneathCount !== undefined && (card.underneathCardIds?.length ?? 0) < filter.minUnderneathCount) {
      return false;
    }
    if (filter.hasUnderneathOrEquipMatching !== undefined) {
      const subIds = [...(card.underneathCardIds ?? []), ...getAttachedEquipmentIds(card)];
      const hasMatch = subIds.some((sid) => {
        const sc = this.ctx.state.cards[sid];
        return Boolean(
          sc &&
            this.matchesFilterSafe(
              sc,
              filter.hasUnderneathOrEquipMatching!,
              hasTraitFn,
              sourceId,
              hasNameFn,
              inStaticEval
            )
        );
      });
      if (!hasMatch) return false;
    }
    if (filter.inZone !== undefined && card.zone !== filter.inZone) return false;
    if (filter.maxEffectivePP !== undefined) {
      if (this.ctx.fieldMgr.calculateRoleEffectivePP(card.instanceId) > filter.maxEffectivePP) return false;
    }
    if (filter.minEffectivePP !== undefined) {
      if (this.ctx.fieldMgr.calculateRoleEffectivePP(card.instanceId) < filter.minEffectivePP) return false;
    }
    if (filter.maxEffectivePPSourceSelf) {
      if (!sourceId) return false;
      const selfPP = this.ctx.fieldMgr.calculateRoleEffectivePP(sourceId);
      if (this.ctx.fieldMgr.calculateRoleEffectivePP(card.instanceId) > selfPP) return false;
    }
    return true;
  }

  /**
   * 8.7.4 利用离开瞬间快照判定过滤条件 (用于离场/从牌组送墓/从墓地放牌组底等触发匹配)
   */
  private matchesFilterWithSnapshot(
    card: CardInstance,
    snapshot: CardTriggerSnapshot | undefined,
    filter: CardFilter,
    sourceId?: string
  ): boolean {
    if (!snapshot) {
      return this.matchesFilter(card, filter, sourceId);
    }
    const def = this.def(card);
    if (filter.excludeSelf && sourceId && card.instanceId === sourceId) return false;
    if (filter.anyFilters !== undefined) {
      if (!filter.anyFilters.some((sub) => this.matchesFilterWithSnapshot(card, snapshot, sub, sourceId))) {
        return false;
      }
    }
    if (filter.cardType !== undefined && def?.cardType !== filter.cardType) return false;
    if (filter.attribute !== undefined && def?.attribute !== filter.attribute) return false;
    if (filter.excludeAttribute !== undefined && def?.attribute === filter.excludeAttribute) return false;
    if (filter.cardNumbers !== undefined && !filter.cardNumbers.includes(card.cardNumber)) return false;

    const matchesSnapName = (expectedName: string): boolean => {
      const normExpected = normalizeCardName(expectedName);
      return (
        normalizeCardName(snapshot.name) === normExpected ||
        Boolean(def && normalizeCardName(def.name) === normExpected) ||
        Boolean(this.ctx.continuousEffects?.hasCardName(card.instanceId, expectedName))
      );
    };

    if (filter.exactName !== undefined && !matchesSnapName(filter.exactName)) return false;
    if (filter.excludeName !== undefined && matchesSnapName(filter.excludeName)) return false;

    const traitSet = expandBaseTraits(snapshot.traits);
    if (filter.trait !== undefined && !traitSet.has(filter.trait)) return false;
    if (filter.excludeTrait !== undefined && traitSet.has(filter.excludeTrait)) return false;
    if (filter.anyTraits !== undefined && !filter.anyTraits.some((t) => traitSet.has(t))) return false;

    const cost = snapshot.cost ?? def?.cost ?? 99;
    if (filter.maxCost !== undefined && cost > filter.maxCost) return false;
    if (filter.minCost !== undefined && cost < filter.minCost) return false;
    if (filter.exactCost !== undefined && cost !== filter.exactCost) return false;
    if (filter.maxCostOpenCostLimit) {
      const openLimit = this.ctx.state.players[snapshot.controllerPlayerId]?.openCostCount ?? 0;
      if (cost > openLimit) return false;
    }
    if (filter.maxBaseDP !== undefined && (def?.baseDP ?? 0) > filter.maxBaseDP) return false;
    if (filter.isAscended !== undefined && Boolean(def?.ascensionConfig) !== filter.isAscended) return false;
    if (filter.isSignalOrb !== undefined && this.isOrb(card) !== filter.isSignalOrb) return false;
    if (filter.signalOrbColor !== undefined && def?.signalOrb !== filter.signalOrbColor) return false;
    if (filter.isFaceUp !== undefined && card.isFaceUp !== filter.isFaceUp) return false;
    if (filter.isReady !== undefined && snapshot.isReady !== filter.isReady) return false;
    if (filter.hasAssistConfig !== undefined && Boolean(def?.assistConfig) !== filter.hasAssistConfig) return false;
    if (filter.hasEquipment !== undefined) {
      const hasEq =
        snapshot.hasAttachedEquipment !== undefined
          ? snapshot.hasAttachedEquipment
          : getAttachedEquipmentIds(card).length > 0;
      if (hasEq !== filter.hasEquipment) return false;
    }
    if (filter.inZone !== undefined && snapshot.zone !== filter.inZone) return false;
    const effectivePP = snapshot.effectivePP ?? this.ctx.fieldMgr.calculateRoleEffectivePP(card.instanceId);
    if (filter.maxEffectivePP !== undefined && effectivePP > filter.maxEffectivePP) return false;
    if (filter.minEffectivePP !== undefined && effectivePP < filter.minEffectivePP) return false;
    if (filter.maxEffectivePPSourceSelf) {
      if (!sourceId) return false;
      const selfPP = this.ctx.fieldMgr.calculateRoleEffectivePP(sourceId);
      if (effectivePP > selfPP) return false;
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

  private eliminate(playerId: string, ids: string[], sourceId?: string, excludeFromAbilityOrbCount = false): void {
    let eliminatedOrbValue = 0;
    const orbColors = ids.map((id) => {
      if (this.ctx.continuousEffects) {
        const info = this.ctx.continuousEffects.getEffectiveOrbInfo(id);
        eliminatedOrbValue += Math.max(1, info.orbValue);
        return info.colors[0] ?? 'UNKNOWN';
      }
      eliminatedOrbValue += 1;
      const card = this.ctx.state.cards[id];
      return (card ? this.def(card)?.signalOrb : undefined) ?? 'UNKNOWN';
    });
    const player = this.ctx.state.players[playerId];
    if (player) {
      if (eliminatedOrbValue >= 3) {
        player.eliminatedThreeOrbsThisTurn = true;
      }
      if (sourceId && !excludeFromAbilityOrbCount) {
        const src = this.ctx.state.cards[sourceId];
        const isKarenina =
          src &&
          (this.ctx.continuousEffects
            ? this.ctx.continuousEffects.hasCardName(sourceId, '卡列尼娜·辉晓')
            : (() => {
                const d = this.def(src);
                return Boolean(d && normalizeCardName(d.name) === '卡列尼娜·辉晓');
              })());
        if (isKarenina) {
          player.eliminatedOrbsByKareninaCountThisTurn =
            (player.eliminatedOrbsByKareninaCountThisTurn ?? 0) + 1;
        }
      }
    }
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
    const revealed: string[] = [];
    for (let i = 0; i < count; i++) {
      if (!this.ctx.zoneMgr.refreshDeckIfEmpty(playerId)) break;
      const top = this.zone(playerId, 'DECK')[0];
      if (!top) break;
      this.ctx.zoneMgr.moveCard(top.instanceId, 'PROCESSING', { isFaceUp: true });
      revealed.push(top.instanceId);
    }
    return revealed;
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

  private bringToField(
    playerId: string,
    cardId: string,
    triggerEntry: boolean,
    enterTapped = false,
    enterAbilitiesLost = false,
    sourceCardNumber?: string
  ): boolean {
    const targetCard = this.ctx.state.cards[cardId];
    const targetDef = targetCard ? this.def(targetCard) : undefined;
    if (!targetCard || !targetDef) return false;
    const slot =
      this.ctx.fieldMgr.findFirstEmptySlot(playerId) ??
      (targetDef.cardType === 'ASSIST'
        ? this.ctx.fieldMgr
            .getSlots(playerId)
            .find(
              (s) =>
                Boolean(s.assistCardId) &&
                (!this.ctx.continuousEffects ||
                  this.ctx.continuousEffects.getEffectiveCardType(s.assistCardId!) === 'ASSIST')
            )?.slotIndex
        : undefined);
    if (slot === undefined) return false;
    let deployedFromHostCardId: string | undefined;
    if (targetCard.zone === 'BATTLEFIELD') {
      for (const candidateHost of Object.values(this.ctx.state.cards)) {
        if (candidateHost.underneathCardIds?.includes(cardId)) {
          candidateHost.underneathCardIds = candidateHost.underneathCardIds.filter((id) => id !== cardId);
          deployedFromHostCardId = candidateHost.instanceId;
        }
      }
      targetCard.slotIndex = undefined;
    }

    if (targetDef.cardType === 'EQUIPMENT') {
      if (!this.ctx.fieldMgr.playStandaloneEquipment(playerId, cardId, slot)) return false;
      if (enterTapped) targetCard.isReady = false;
      if (enterAbilitiesLost) {
        addCardModifier(this.ctx.state, targetCard, {
          loseAbilities: true,
          untilTurn: undefined,
          source: sourceCardNumber ?? targetCard.cardNumber,
        });
      }
      if (triggerEntry && !enterAbilitiesLost) {
        this.effects.handleRoleEntryEffect(playerId, cardId, targetDef);
      }
      return true;
    }

    if (targetDef.cardType === 'ASSIST') {
      if (!this.ctx.fieldMgr.playAssistCard(playerId, cardId, slot)) return false;
      if (enterTapped) targetCard.isReady = false;
      if (enterAbilitiesLost) {
        addCardModifier(this.ctx.state, targetCard, {
          loseAbilities: true,
          untilTurn: undefined,
          source: sourceCardNumber ?? targetCard.cardNumber,
        });
      }
      if (triggerEntry && !enterAbilitiesLost) {
        this.effects.handleRoleEntryEffect(playerId, cardId, targetDef);
      }
      return true;
    }

    if (
      !this.ctx.fieldMgr.playRoleCard(playerId, cardId, slot, {
        enterTapped,
        enterAbilitiesLost,
        deployedFromHostCardId,
        sourceCardNumber,
      })
    ) {
      return false;
    }
    if (triggerEntry && !enterAbilitiesLost) {
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
    return expandBaseTraits(this.def(card)?.traits).has(trait);
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
    const result: CardInstance[] = [];
    for (const s of this.ctx.fieldMgr.getSlots(playerId)) {
      for (const cid of [s.roleCardId, s.assistCardId]) {
        if (!cid) continue;
        const c = this.ctx.state.cards[cid];
        if (c && this.ctx.fieldMgr.isSlotRole(playerId, cid)) {
          result.push(c);
        }
      }
    }
    return result;
  }

  private fieldTopHosts(playerId: string): CardInstance[] {
    const result: CardInstance[] = [];
    for (const s of this.ctx.fieldMgr.getSlots(playerId)) {
      for (const cid of [s.roleCardId, s.assistCardId, s.standaloneEquipmentId]) {
        if (!cid) continue;
        const c = this.ctx.state.cards[cid];
        if (c) result.push(c);
      }
    }
    return result;
  }

  private makeCustomRuntime(): CustomHandlerRuntime {
    return {
      ctx: this.ctx,
      effects: this.effects,
      registry: this.registry,
      def: (card) => this.def(card),
      zone: (playerId, zone) => this.zone(playerId, zone),
      roles: (playerId) => this.roles(playerId),
      hasTrait: (card, trait) => this.hasTrait(card, trait),
      matchesFilter: (card, filter, sourceId) => this.matchesFilter(card, filter, sourceId),
      resolveSide: (playerId, side) => this.resolveSide(playerId, side),
      hasEmptySlot: (playerId) => this.hasEmptySlot(playerId),
      choiceId: (tag) => this.choiceId(tag),
      enqueueCustomChoice: (choice, customFrame) => {
        this.enqueueDslChoice(choice, {
          cardNumber: customFrame.cardNumber,
          sourceCardInstanceId: customFrame.sourceCardInstanceId,
          playerId: customFrame.playerId,
          vars: customFrame.vars,
          remainingSteps: customFrame.remainingSteps,
          pendingAction: { kind: 'CUSTOM_CHOICE', customFrame },
        });
      },
      resumeSteps: (cardNumber, sourceId, playerId, vars, queue) => {
        this.runSteps(cardNumber, sourceId, playerId, vars, queue);
      },
      executeEntryOnSource: (entryCardNumber, sourceId, playerId, cost, steps, vars) => {
        this.executeWithCost(entryCardNumber, sourceId, playerId, cost, steps, false, vars);
      },
      bringToField: (playerId, cardId, triggerEntry, enterTapped, enterAbilitiesLost) =>
        this.bringToField(playerId, cardId, triggerEntry, enterTapped, enterAbilitiesLost),
    };
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
