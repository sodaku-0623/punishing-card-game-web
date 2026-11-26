import {
  CardInstance,
  CardVersionData,
  PendingChoice,
  PendingDslContinuation,
  ZoneId,
} from '@zhanshuang/shared';
import type { CardEffectContext, CardEffectEngine } from '../card-effects.js';
import {
  ContinuousEffectEngine,
  expandBaseTraits,
  normalizeCardName,
} from '../continuous-effects.js';
import type { TriggerManager } from '../../priority/trigger-system.js';
import type { ReplacementEngine } from '../replacement-engine.js';
import { nextChoiceId } from '../../state/pending-choice.js';
import { getAttachedEquipmentIds } from '../../zone/battlefield-manager.js';
import { DslCostHandler, isCostPendingAction } from './cost-handler.js';
import type { CustomHandlerRuntime } from './custom-handlers.js';
import { DslEvaluator, findOrbGroupsFromInfos } from './evaluator.js';
import type {
  DslChoiceAction,
  DslChoiceMetadata,
  DslExecutionFrame,
  DslInterpreterHost,
  DslResult,
} from './runtime-types.js';
import { DslStepRunner } from './step-runner.js';
import {
  registerDeclarativeReplacements,
  registerDeclarativeStaticEffects,
  registerDeclarativeTriggers,
} from './trigger-adapter.js';
import type {
  CardEffectSpec,
  CardFilter,
  EffectStep,
  OrbColorFilter,
  PlayerSide,
  UsableActivationZone,
} from './types.js';

type Result = DslResult;
type ChoiceAction = DslChoiceAction;

/**
 * 声明式卡牌效果解释器 (docs/future-work.md §3)。
 *
 * 负责解释执行经 validateCardEffectRegistry 校验后的 CardEffectSpec：
 * 战术牌、登场能力【出】、起动能力【起】、自动能力【自】、静态持续能力【永】与手牌静态减费。
 * 内部已按职责拆分为求值器 (evaluator)、代价处理器 (cost-handler)、步骤执行器 (step-runner) 与触发适配器 (trigger-adapter)。
 */
export class DeclarativeEffectInterpreter {
  private readonly fieldIgnoreAttributeSpecs: CardEffectSpec[];
  private readonly host: DslInterpreterHost;
  private readonly evaluator: DslEvaluator;
  private readonly costHandler: DslCostHandler;
  private readonly stepRunner: DslStepRunner;

  constructor(
    private ctx: CardEffectContext,
    private effects: CardEffectEngine,
    private registry: ReadonlyMap<string, CardEffectSpec>
  ) {
    // 预索引含 fieldIgnoreAttributeRule 的卡牌（全表仅 BP02-009 与 BP04-059），避免每次出牌扫描全表 490 条声明式规格
    this.fieldIgnoreAttributeSpecs = [];
    for (const spec of this.registry.values()) {
      if (spec.fieldIgnoreAttributeRule) {
        this.fieldIgnoreAttributeSpecs.push(spec);
      }
    }

    const self = this;
    this.host = {
      ctx: this.ctx,
      effects: this.effects,
      registry: this.registry,
      get evaluator() {
        return self.evaluator;
      },
      enqueueDslChoice: (choice, frame, extraMetadata) =>
        this.enqueueDslChoice(choice, frame, extraMetadata),
      resolveSide: (playerId, side) => this.resolveSide(playerId, side),
      zone: (playerId, zone) => this.zone(playerId, zone),
      roles: (playerId) => this.roles(playerId),
      fieldTopHosts: (playerId) => this.fieldTopHosts(playerId),
      def: (card) => this.def(card),
      hasTrait: (card, trait) => this.hasTrait(card, trait),
      isOrb: (card) => this.isOrb(card),
      hasEmptySlot: (playerId) => this.hasEmptySlot(playerId),
      emptySlotCount: (playerId) => this.emptySlotCount(playerId),
      choiceId: (tag) => this.choiceId(tag),
      orbGroups: (playerId, size, filter) => this.orbGroups(playerId, size, filter),
      eliminate: (playerId, ids, sourceId, excludeFromAbilityOrbCount) =>
        this.eliminate(playerId, ids, sourceId, excludeFromAbilityOrbCount),
      peekTop: (playerId, count) => this.peekTop(playerId, count),
      revealTop: (playerId, count) => this.revealTop(playerId, count),
      mill: (playerId, count) => this.mill(playerId, count),
      bringToField: (
        playerId,
        cardId,
        triggerEntry,
        enterTapped,
        enterAbilitiesLost,
        sourceCardNumber
      ) =>
        this.bringToField(
          playerId,
          cardId,
          triggerEntry,
          enterTapped,
          enterAbilitiesLost,
          sourceCardNumber
        ),
      destroy: (cardId) => this.destroy(cardId),
      markUsed: (playerId, cardId) => this.markUsed(playerId, cardId),
      makeCustomRuntime: () => this.makeCustomRuntime(),
      calculateHandCostDiscount: (playerId, cardNumber) =>
        this.calculateHandCostDiscount(playerId, cardNumber),
      executeWithCost: (
        cardNumber,
        sourceId,
        playerId,
        cost,
        steps,
        markUsed,
        initialVars,
        markUsedKey,
        costCardInstanceIds
      ) =>
        this.costHandler.executeWithCost(
          cardNumber,
          sourceId,
          playerId,
          cost,
          steps,
          markUsed,
          initialVars,
          markUsedKey,
          costCardInstanceIds
        ),
      runSteps: (cardNumber, sourceId, playerId, vars, queue) =>
        this.stepRunner.runSteps(cardNumber, sourceId, playerId, vars, queue),
    };

    this.evaluator = new DslEvaluator(this.host);
    this.costHandler = new DslCostHandler(this.host);
    this.stepRunner = new DslStepRunner(this.host);
  }

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
    const isAttachedEquip =
      card.zone === 'BATTLEFIELD' &&
      this.ctx.fieldMgr.getSlots(playerId).some((s) => {
        const host = s.roleCardId ? this.ctx.state.cards[s.roleCardId] : undefined;
        return Boolean(host && getAttachedEquipmentIds(host).includes(cardId));
      });
    if (this.ctx.fieldMgr.isTopLevelFieldCard(playerId, cardId) || isAttachedEquip) {
      result.add('BATTLEFIELD');
    } else if (card.zone === 'HAND' || card.zone === 'GRAVEYARD') {
      result.add(card.zone);
    } else if ((card.zone === 'COST' || card.zone === 'SIGNAL_ORB') && card.isFaceUp) {
      result.add(card.zone);
    }
    const isUnderHost = this.ctx.fieldMgr.getSlots(playerId).some((s) => {
      const host =
        (s.roleCardId && this.ctx.state.cards[s.roleCardId]) ||
        (s.assistCardId && this.ctx.state.cards[s.assistCardId]);
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
    for (const spec of this.fieldIgnoreAttributeSpecs) {
      const rule = spec.fieldIgnoreAttributeRule!;
      if (
        rule.onlyAscensionRoles &&
        (isAscension || cardDef.cardType !== 'ROLE' || !cardDef.ascensionConfig)
      ) {
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
    if (this.ctx.continuousEffects?.hasProhibition(hostCardId, 'CANNOT_GAIN_ABILITIES')) return [];
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
    return Boolean((choice.metadata as DslChoiceMetadata | undefined)?.__dsl);
  }

  /**
   * 8.6.2.c 计算声明式手牌静态费用减免 (如 ST03-011、ST05-009、ST06-004)
   */
  calculateHandCostDiscount(playerId: string, cardNumber: string): number {
    const spec = this.registry.get(cardNumber);
    if (!spec?.handCostDiscount) return 0;
    if ('condition' in spec.handCostDiscount) {
      return this.evaluator.evalCondition(spec.handCostDiscount.condition, playerId, '', {})
        ? spec.handCostDiscount.flatDiscount
        : 0;
    }
    if ('zone' in spec.handCostDiscount) {
      const rule = spec.handCostDiscount;
      const matched = this.zone(playerId, rule.zone).filter((c) =>
        this.evaluator.matchesFilter(c, rule.filter)
      );
      return matched.length * rule.discountPerCard;
    }
    const rule = spec.handCostDiscount;
    const matched = this.roles(playerId).filter((r) => this.evaluator.matchesFilter(r, rule.filter));
    return matched.length * rule.discountPerRole;
  }

  /**
   * 【永】：检查手牌中的该牌当前是否可以无视属性条件使用 (如 ST04-008 卡穆·狂犬)
   */
  canIgnoreAttributeCondition(playerId: string, cardNumber: string): boolean {
    const spec = this.registry.get(cardNumber);
    if (!spec?.ignoreAttributeCondition) return false;
    return this.evaluator.evalCondition(spec.ignoreAttributeCondition, playerId, '', {});
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
      const spec = this.registry.get(role.cardNumber);
      const rule = spec?.fieldCardCostRule;
      if (!rule) continue;
      if (this.ctx.continuousEffects?.hasLostInherentAbilities(role.instanceId)) continue;
      if (rule.cardType && cardDef.cardType !== rule.cardType) continue;
      if (
        rule.targetName &&
        normalizeCardName(cardDef.name) !== normalizeCardName(rule.targetName)
      ) {
        continue;
      }
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
      if (!this.evaluator.evalCondition(spec.playPrecondition.condition, playerId, cardId, {})) {
        return { success: false, error: spec.playPrecondition.errorMessage };
      }
    }

    this.stepRunner.runSteps(def.cardNumber, cardId, playerId, {}, [...spec.tactics]);
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
          this.costHandler.executeWithCost(def.cardNumber, roleId, playerId, e.cost, e.steps, false);
          continue;
        }
      }
      if (mergedSteps.length > 0) {
        this.stepRunner.runSteps(def.cardNumber, roleId, playerId, {}, mergedSteps);
      }
      return;
    }
    if (!spec?.entry) return;

    this.costHandler.executeWithCost(
      def.cardNumber,
      roleId,
      playerId,
      spec.entry.cost,
      spec.entry.steps,
      false
    );
  }

  /**
   * 8.5.3 从挂起的充能/伤害或可选置换队列恢复尚未执行完的 DSL 后续步骤帧
   */
  resumeContinuation(frame: PendingDslContinuation): void {
    const vars: Record<string, string[]> = { ...frame.vars };
    const verify = vars.__pendingReplaceVerify;
    if (verify && verify.length >= 4) {
      delete vars.__pendingReplaceVerify;
      const partial = [...(vars.__pendingReplacePartial ?? [])];
      delete vars.__pendingReplacePartial;
      const [kind, targetId, saveVar, extraA, extraB, extraC] = verify;
      let succeeded = false;
      if (kind === 'DESTROY' && targetId) {
        const prevEventIdx = Number(extraA ?? '0');
        succeeded = this.ctx.events
          .slice(Number.isFinite(prevEventIdx) ? prevEventIdx : 0)
          .some((e) => e.type === 'CARD_DESTROYED' && e.cardInstanceId === targetId);
      } else if (kind === 'MOVE' && targetId) {
        const expectedZone = extraA ?? '';
        const fromZone = extraB ?? '';
        const card = this.ctx.state.cards[targetId];
        if (card) {
          succeeded =
            card.zone === expectedZone ||
            (expectedZone === 'COST' && fromZone !== 'COST' && card.zone !== fromZone);
          if (succeeded && expectedZone === 'DECK' && extraC === 'SHUFFLE') {
            this.ctx.zoneMgr.shuffleDeck(card.ownerPlayerId);
          }
        }
      }
      const updated = succeeded && targetId ? [...partial, targetId] : partial;
      if (saveVar) {
        vars[saveVar] = updated;
      }
      if (vars.__pendingReplaceRest?.length) {
        vars.__pendingReplaceAccum = updated;
      }
    }
    this.stepRunner.runSteps(
      frame.cardNumber,
      frame.sourceCardInstanceId,
      frame.playerId,
      vars,
      [...(frame.remainingSteps as EffectStep[])]
    );
  }

  /**
   * 执行声明式【起】起动能力 (支持角色自身单/多【起】、非战场区域限制、装备赋予的【起】及玩家自选费用)
   */
  activate(
    playerId: string,
    cardId: string,
    def: CardVersionData,
    abilityIndex?: number,
    costCardInstanceIds?: string[]
  ): Result {
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

    const makeUsageKey = (entryId: string, act: NonNullable<CardEffectSpec['activate']>) => {
      if (act.sharedTurnKey) return `player:${act.sharedTurnKey}`;
      if (act.oncePerTurnByPlayer) return `player:${def.name}:act:${entryId}`;
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
      if (
        entry.activate.condition &&
        !this.evaluator.evalCondition(entry.activate.condition, playerId, cardId, {})
      ) {
        return {
          success: false,
          error: entry.activate.conditionError ?? '不满足该起动能力的发动条件',
        };
      }
      return this.costHandler.executeWithCost(
        entry.cardNumber,
        cardId,
        playerId,
        entry.activate.cost,
        entry.activate.steps,
        isOnce,
        {},
        entry.usageKey,
        costCardInstanceIds
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
      if (
        e.activate.condition &&
        !this.evaluator.evalCondition(e.activate.condition, playerId, cardId, {})
      ) {
        return false;
      }
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
          ...(costCardInstanceIds?.length ? { costCardInstanceIds } : {}),
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
   * 8.5 / 8.7 向 TriggerManager 注册统一【出】登场能力 (`CARD_ENTERED_FIELD`) 与所有声明式【自】自动能力
   */
  registerTriggers(triggerMgr: TriggerManager): void {
    registerDeclarativeTriggers(this.host, triggerMgr);
  }

  /**
   * 8.9 向 ContinuousEffectEngine 注册所有声明式【永】持续效果 (自动分派至 Layer 1 NON_STAT / Layer 2 STAT)
   */
  registerStaticEffects(continuousEffects: ContinuousEffectEngine): void {
    registerDeclarativeStaticEffects(this.host, continuousEffects);
  }

  /**
   * 8.10 向 ReplacementEngine 注册所有声明式卡牌置换规则 (`CardEffectSpec.replacements`)
   */
  registerReplacements(replacementEngine: ReplacementEngine): void {
    registerDeclarativeReplacements(replacementEngine, this.host.ctx, this.registry, this.evaluator);
  }

  /**
   * 恢复被 PendingChoice 挂起的声明式效果执行帧
   */
  resolveChoice(action: ChoiceAction, choice: PendingChoice): Result {
    const frame = (choice.metadata as DslChoiceMetadata | undefined)?.__dsl;
    if (!frame) {
      return { success: false, error: `未知的声明式决策类型 ${choice.effectType}` };
    }

    const vars: Record<string, string[]> = { ...frame.vars };
    const remaining: EffectStep[] = [...frame.remainingSteps];
    const pending = frame.pendingAction;

    if (isCostPendingAction(pending)) {
      return this.costHandler.resolveCostChoice(pending, action.selectedIds, frame, vars, remaining);
    }

    return this.stepRunner.resolveStepChoice(pending, action, frame, vars, remaining);
  }

  // ===================================================================
  // 薄转发方法与底层区域/动作原语
  // ===================================================================

  /** 兼容测试反射调用的过滤转发入口 (stage1b-critical-fixes.test.ts) */
  private matchesFilter(card: CardInstance, filter: CardFilter, sourceId?: string): boolean {
    return this.evaluator.matchesFilter(card, filter, sourceId);
  }

  private enqueueDslChoice(
    choice: Omit<PendingChoice, 'metadata'>,
    frame: DslExecutionFrame,
    extraMetadata?: Record<string, unknown>
  ): void {
    const metadata: DslChoiceMetadata = {
      ...(extraMetadata ?? {}),
      __dsl: frame,
    };
    this.ctx.setPendingChoice({
      ...choice,
      metadata,
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
    return findOrbGroupsFromInfos(zone, infos, size, filter);
  }

  private eliminate(
    playerId: string,
    ids: string[],
    sourceId?: string,
    excludeFromAbilityOrbCount = false
  ): void {
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

  private peekTop(playerId: string, count: number): string[] {
    if (this.zone(playerId, 'DECK').length === 0) {
      if (!this.ctx.zoneMgr.refreshDeckIfEmpty(playerId)) return [];
    }
    return this.zone(playerId, 'DECK')
      .slice(0, count)
      .map((c) => c.instanceId);
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
          candidateHost.underneathCardIds = candidateHost.underneathCardIds.filter(
            (id) => id !== cardId
          );
          deployedFromHostCardId = candidateHost.instanceId;
        }
      }
      targetCard.slotIndex = undefined;
    }

    if (targetDef.cardType === 'EQUIPMENT') {
      return this.ctx.fieldMgr.playStandaloneEquipment(playerId, cardId, slot, {
        enterTapped,
        enterAbilitiesLost,
        sourceCardNumber,
        suppressEntryTrigger: !triggerEntry || enterAbilitiesLost,
      });
    }

    if (targetDef.cardType === 'ASSIST') {
      return this.ctx.fieldMgr.playAssistCard(playerId, cardId, slot, {
        enterTapped,
        enterAbilitiesLost,
        sourceCardNumber,
        suppressEntryTrigger: !triggerEntry || enterAbilitiesLost,
      });
    }

    return this.ctx.fieldMgr.playRoleCard(playerId, cardId, slot, {
      enterTapped,
      enterAbilitiesLost,
      deployedFromHostCardId,
      sourceCardNumber,
      suppressEntryTrigger: !triggerEntry || enterAbilitiesLost,
    });
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
    const moved = this.ctx.zoneMgr.moveCard(cardId, 'GRAVEYARD', { isFaceUp: true });
    if (!moved) return false;
    this.ctx.events.push({ type: 'CARD_DESTROYED', cardInstanceId: cardId, reason: 'EFFECT' });
    this.ctx.triggerMgr?.emit({
      type: 'CARD_DESTROYED',
      playerId: card.controllerPlayerId,
      cardInstanceId: cardId,
      fromZone: 'BATTLEFIELD',
      toZone: this.ctx.state.cards[cardId]?.zone ?? 'GRAVEYARD',
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
    return (
      this.ctx.cardDb.getCard(card.cardNumber) ||
      (card.cardId ? this.ctx.cardDb.getCard(card.cardId) : undefined)
    );
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
      matchesFilter: (card, filter, sourceId) =>
        this.matchesFilter(card, filter, sourceId),
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
        this.stepRunner.runSteps(cardNumber, sourceId, playerId, vars, queue);
      },
      executeEntryOnSource: (entryCardNumber, sourceId, playerId, cost, steps, vars) => {
        this.costHandler.executeWithCost(
          entryCardNumber,
          sourceId,
          playerId,
          cost,
          steps,
          false,
          vars
        );
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
    return nextChoiceId(this.ctx.state, tag);
  }
}
