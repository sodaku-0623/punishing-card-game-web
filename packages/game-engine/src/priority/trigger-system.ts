import {
  DelayedTrigger,
  GameEvent,
  GameState,
  PendingChoice,
  PendingTrigger,
  TriggerEventType,
  ZoneId,
} from '@zhanshuang/shared';
import { ICardDatabase } from '../database/card-registry.js';
import { ZoneManager } from '../zone/zone-manager.js';
import { BattlefieldManager, getAttachedEquipmentIds } from '../zone/battlefield-manager.js';
import {
  ContinuousEffectEngine,
  addCardModifier,
  expandBaseTraits,
  nextEffectTimestamp,
} from '../effects/continuous-effects.js';

/**
 * 8.7.4 触发瞬间卡牌快照 (可 JSON 序列化，供区域移动触发及离场后结算参照)
 */
export interface CardTriggerSnapshot {
  cardInstanceId: string;
  cardNumber: string;
  name: string;
  cost: number;
  traits: string[];
  controllerPlayerId: string;
  zone: ZoneId;
  isReady: boolean;
  effectivePP?: number;
  effectiveDP?: number;
  abilitiesLost?: boolean;
  hasAttachedEquipment?: boolean;
  attachedEquipmentTraits?: string[];
  grantedTriggerEntries?: Array<{ triggerId: string; grantKey: string }>;
}

export interface TriggerEvent {
  type: TriggerEventType;
  playerId?: string;
  cardInstanceId?: string;
  targetCardId?: string;
  battledCardId?: string;
  blockerCardId?: string;
  targetType?: 'PLAYER' | 'CHARACTER';
  fromZone?: ZoneId;
  toZone?: ZoneId;
  isAscension?: boolean;
  destroyReason?: 'BATTLE' | 'EFFECT' | 'PP_ZERO' | 'RULE';
  orbCardIds?: string[];
  orbColors?: string[];
  chargeKind?: 'ATTACK' | 'DAMAGE';
  damageAmount?: number;
  attackChargedHasChargeAuto?: boolean;
  deployedFromHostCardId?: string;
  subjectSnapshot?: CardTriggerSnapshot;
}

export interface TriggerMatch {
  sourceCardInstanceId: string;
  sourceCardNumber: string;
  controllerPlayerId: string;
  label: string;
  oncePerTurn?: boolean;
  maxPerTurn?: number;
  oncePerTurnKey?: string;
  deferOncePerTurnUntilCostPaid?: boolean;
  oncePerTurnByPlayer?: boolean;
  maxPerTurnByPlayer?: number;
  sharedTurnKey?: string;
  triggerContext: Record<string, unknown>;
}

export interface TriggerCollectContext {
  state: GameState;
  event: TriggerEvent;
  cardDb: ICardDatabase;
  zoneMgr: ZoneManager;
  fieldMgr: BattlefieldManager;
  continuousEffects: ContinuousEffectEngine;
  snapshotCard: (cardInstanceId: string) => CardTriggerSnapshot | undefined;
}

export interface TriggerExecuteContext {
  state: GameState;
  cardDb: ICardDatabase;
  zoneMgr: ZoneManager;
  fieldMgr: BattlefieldManager;
  continuousEffects: ContinuousEffectEngine;
  events: GameEvent[];
  enqueueChoice: (choice: PendingChoice) => void;
  emitTriggerEvent: (event: TriggerEvent) => void;
}

export interface TriggerDefinition {
  abilityId: string;
  eventTypes: TriggerEventType[];
  oncePerTurn?: boolean;
  maxPerTurn?: number;
  deferOncePerTurnUntilCostPaid?: boolean;
  oncePerTurnByPlayer?: boolean;
  maxPerTurnByPlayer?: number;
  sharedTurnKey?: string;
  collect: (ctx: TriggerCollectContext) => TriggerMatch[];
  execute: (trigger: PendingTrigger, ctx: TriggerExecuteContext) => void;
}

/**
 * 8.5 / 8.7 统一自动能力触发管理器：
 * - 统一接收游戏事件，扫描匹配的【自】能力与 8.7.5 时限触发，写入 state.pendingTriggers 待机池
 * - 在检查时机 (CheckTimingManager) 按 8.5.1.c/d 顺序依次取出执行
 * - 处理 8.3.4 能力无效跳过、8.7.4 区域移动快照、8.7.7 来源离场仍须执行、10.1 【回合1】次数限制
 */
export class TriggerManager {
  private definitions = new Map<string, TriggerDefinition>();
  private onDelayedDeployCallback?: (playerId: string, cardInstanceId: string) => void;

  setOnDelayedDeployCallback(cb: (playerId: string, cardInstanceId: string) => void): void {
    this.onDelayedDeployCallback = cb;
  }

  constructor(
    private state: GameState,
    private cardDb: ICardDatabase,
    private zoneMgr: ZoneManager,
    private fieldMgr: BattlefieldManager,
    private continuousEffects: ContinuousEffectEngine,
    private events: GameEvent[],
    private enqueueChoice: (choice: PendingChoice) => void
  ) {
    this.registerBuiltinDelayedHandlers();
  }

  /** 注册一个自动能力触发定义 */
  registerTrigger(def: TriggerDefinition): void {
    this.definitions.set(def.abilityId, def);
  }

  /** 注册 8.7.5 时限触发 (可随 GameState 快照持久化恢复) */
  registerDelayedTrigger(trigger: Omit<DelayedTrigger, 'id'> & { id?: string }): DelayedTrigger {
    const seq = nextEffectTimestamp(this.state);
    const full: DelayedTrigger = {
      ...trigger,
      id: trigger.id ?? `delayed-${trigger.abilityId}-${seq}`,
    };
    // 1.3.3 / Q&A·4 (BP02-058)：赋予给角色的新能力在角色处于 CANNOT_GAIN_ABILITIES 时不会获得
    const isCardGrantedDelayed =
      trigger.abilityId === 'DELAYED_END_OF_TURN_TO_GRAVEYARD' ||
      Boolean(trigger.payload?.grantedToSourceCard);
    if (isCardGrantedDelayed) {
      const sourceCard = this.state.cards[trigger.sourceCardInstanceId];
      if (
        sourceCard &&
        sourceCard.zone === 'BATTLEFIELD' &&
        this.continuousEffects.hasProhibition(sourceCard.instanceId, 'CANNOT_GAIN_ABILITIES')
      ) {
        return full;
      }
    }
    this.state.delayedTriggers = [...(this.state.delayedTriggers ?? []), full];
    return full;
  }

  /** 8.7.4 采集指定卡牌当前瞬间的可序列化情报快照 */
  snapshotCard(cardInstanceId: string): CardTriggerSnapshot | undefined {
    const card = this.state.cards[cardInstanceId];
    if (!card) return undefined;
    const def = this.cardDb.getCard(card.cardNumber) || (card.cardId ? this.cardDb.getCard(card.cardId) : undefined);
    const evalStats = this.continuousEffects.evaluateCard(cardInstanceId);
    const attachedEqIds = getAttachedEquipmentIds(card);
    const eqTraitsSet = new Set<string>();
    for (const eqId of attachedEqIds) {
      const eqCard = this.state.cards[eqId];
      if (!eqCard) continue;
      const eqDef = this.cardDb.getCard(eqCard.cardNumber) || (eqCard.cardId ? this.cardDb.getCard(eqCard.cardId) : undefined);
      for (const t of expandBaseTraits(eqDef?.traits)) eqTraitsSet.add(t);
      for (const t of this.continuousEffects.evaluateCard(eqId).traits) eqTraitsSet.add(t);
    }
    return {
      cardInstanceId: card.instanceId,
      cardNumber: card.cardNumber,
      name: def?.name ?? card.cardNumber,
      cost: def?.cost ?? 0,
      traits: evalStats.traits,
      controllerPlayerId: card.controllerPlayerId,
      zone: card.zone,
      isReady: card.isReady,
      effectivePP: card.zone === 'BATTLEFIELD' ? evalStats.pp : def?.basePP,
      effectiveDP: card.zone === 'BATTLEFIELD' ? evalStats.dp : def?.baseDP,
      abilitiesLost: evalStats.abilitiesLost,
      ...(attachedEqIds.length > 0 ? { hasAttachedEquipment: true } : {}),
      ...(eqTraitsSet.size > 0 ? { attachedEquipmentTraits: Array.from(eqTraitsSet) } : {}),
      ...(evalStats.grantedTriggerEntries && evalStats.grantedTriggerEntries.length > 0
        ? { grantedTriggerEntries: evalStats.grantedTriggerEntries.map((e) => ({ ...e })) }
        : {}),
    };
  }

  /**
   * 8.7.2 发出触发事件：收集所有满足条件的【自】能力与 8.7.5 时限触发进入 state.pendingTriggers 待机状态。
   * 8.5.3 不中断当前正在处理的效果，等待下一次检查时机再按 8.5.1 依次执行。
   */
  emit(event: TriggerEvent): void {
    if (this.state.status === 'FINISHED') return;

    // 统计本回合被破坏的我方角色总张数与火属性角色数 (BP04-028 渡边·尘铭、BP04-023/024/025 墓地协战)
    if (event.type === 'CARD_DESTROYED' && event.cardInstanceId && event.playerId) {
      const destroyedCard = this.state.cards[event.cardInstanceId];
      const destroyedDef = destroyedCard
        ? this.cardDb.getCard(destroyedCard.cardNumber) ||
          (destroyedCard.cardId ? this.cardDb.getCard(destroyedCard.cardId) : undefined)
        : undefined;
      const effectiveType = destroyedCard?.modifiers?.some((m) => m.setCardType === 'ROLE')
        ? 'ROLE'
        : destroyedDef?.cardType;
      if (effectiveType === 'ROLE' && this.state.players[event.playerId]) {
        this.state.players[event.playerId]!.destroyedFriendlyRoleCountThisTurn =
          (this.state.players[event.playerId]!.destroyedFriendlyRoleCountThisTurn ?? 0) + 1;
        if (destroyedDef?.attribute === 'FIRE') {
          this.state.players[event.playerId]!.destroyedFireRoleCountThisTurn =
            (this.state.players[event.playerId]!.destroyedFireRoleCountThisTurn ?? 0) + 1;
        }
      }
    }

    const collectCtx: TriggerCollectContext = {
      state: this.state,
      event,
      cardDb: this.cardDb,
      zoneMgr: this.zoneMgr,
      fieldMgr: this.fieldMgr,
      continuousEffects: this.continuousEffects,
      snapshotCard: (id) => this.snapshotCard(id),
    };

    // 1. 扫描所有注册的【自】能力定义
    for (const def of this.definitions.values()) {
      if (!def.eventTypes.includes(event.type)) continue;
      const matches = def.collect(collectCtx);
      for (const m of matches) {
        const seq = nextEffectTimestamp(this.state);
        const pending: PendingTrigger = {
          id: `trig-${this.state.turnNumber}-${seq}`,
          abilityId: def.abilityId,
          eventType: event.type,
          sourceCardInstanceId: m.sourceCardInstanceId,
          sourceCardNumber: m.sourceCardNumber,
          controllerPlayerId: m.controllerPlayerId,
          label: m.label,
          oncePerTurn: m.oncePerTurn ?? def.oncePerTurn,
          maxPerTurn: m.maxPerTurn ?? def.maxPerTurn,
          oncePerTurnKey: m.oncePerTurnKey,
          deferOncePerTurnUntilCostPaid: m.deferOncePerTurnUntilCostPaid ?? def.deferOncePerTurnUntilCostPaid,
          oncePerTurnByPlayer: m.oncePerTurnByPlayer ?? def.oncePerTurnByPlayer,
          maxPerTurnByPlayer: m.maxPerTurnByPlayer ?? def.maxPerTurnByPlayer,
          sharedTurnKey: m.sharedTurnKey ?? def.sharedTurnKey,
          triggerContext: {
            ...m.triggerContext,
            sourceAbilitiesLostAtTrigger:
              (m.triggerContext.sourceAbilitiesLostAtTrigger as boolean | undefined) ??
              this.continuousEffects.hasLostInherentAbilities(m.sourceCardInstanceId),
          },
        };
        this.state.pendingTriggers.push(pending);
      }
    }

    // 2. 8.7.5 扫描匹配的时限触发
    if (this.state.delayedTriggers && this.state.delayedTriggers.length > 0) {
      const remaining: DelayedTrigger[] = [];
      for (const dt of this.state.delayedTriggers) {
        const matchesEvent =
          dt.eventType === event.type &&
          (dt.triggerTurn === undefined || dt.triggerTurn === this.state.turnNumber);
        if (matchesEvent) {
          const seq = nextEffectTimestamp(this.state);
          this.state.pendingTriggers.push({
            id: `trig-delayed-${this.state.turnNumber}-${seq}`,
            abilityId: dt.abilityId,
            eventType: dt.eventType,
            sourceCardInstanceId: dt.sourceCardInstanceId,
            sourceCardNumber: dt.sourceCardNumber,
            controllerPlayerId: dt.controllerPlayerId,
            label: dt.label,
            triggerContext: {
              ...(dt.payload ?? {}),
              isDelayedTrigger: true,
              delayedTriggerId: dt.id,
            },
          });
          // 8.7.5.a 除特殊说明外，时限触发只在满足触发条件时生效一次
          if (!dt.once) remaining.push(dt);
        } else {
          remaining.push(dt);
        }
      }
      this.state.delayedTriggers = remaining.length > 0 ? remaining : undefined;
    }

    // 3. 兼容旧字段 card.endOfTurnToGraveyard (确保直接设置该字段的旧快照或测试在 6.5.1.b 也走检查时机)
    if (event.type === 'END_PHASE_TRIGGERS') {
      const alreadyQueued = new Set(
        this.state.pendingTriggers
          .filter((t) => t.abilityId === 'DELAYED_END_OF_TURN_TO_GRAVEYARD')
          .map((t) => t.sourceCardInstanceId)
      );
      for (const card of Object.values(this.state.cards)) {
        if (
          card.endOfTurnToGraveyard === this.state.turnNumber &&
          card.zone === 'BATTLEFIELD' &&
          !alreadyQueued.has(card.instanceId)
        ) {
          const def = this.cardDb.getCard(card.cardNumber);
          const seq = nextEffectTimestamp(this.state);
          this.state.pendingTriggers.push({
            id: `trig-eot-gy-${this.state.turnNumber}-${seq}`,
            abilityId: 'DELAYED_END_OF_TURN_TO_GRAVEYARD',
            eventType: 'END_PHASE_TRIGGERS',
            sourceCardInstanceId: card.instanceId,
            sourceCardNumber: card.cardNumber,
            controllerPlayerId: card.controllerPlayerId,
            label: `【${def?.name ?? card.cardNumber}】回合结束时放置到墓地`,
            triggerContext: { isDelayedTrigger: true },
          });
        }
      }
    }
  }

  /**
   * 8.7.3 / 8.7.7 执行一个已从待机池取出的自动能力
   */
  executeTrigger(trigger: PendingTrigger): void {
    const def = this.definitions.get(trigger.abilityId);
    if (!def) return;

    const isDelayed = Boolean(trigger.triggerContext?.isDelayedTrigger);

    // 8.3.4 / Q&A·4：非时限触发的来源卡在触发时或执行时处于「失去能力」状态，改为不处理；
    // 被赋予在角色身上的时限触发 (如 ST02-011 回合结束送墓)，若在 6.5.1.b 结算时角色已「失去能力」或「不能获得新能力」，亦不执行 (Q&A·4 BP02-058)
    const sourceCard = this.state.cards[trigger.sourceCardInstanceId];
    if (!isDelayed) {
      const lostAtTrigger = Boolean(trigger.triggerContext?.sourceAbilitiesLostAtTrigger);
      const lostNow =
        sourceCard && sourceCard.zone === 'BATTLEFIELD'
          ? this.continuousEffects.hasLostInherentAbilities(sourceCard.instanceId)
          : false;
      if (lostAtTrigger || lostNow) {
        return;
      }
    } else if (
      (trigger.abilityId === 'DELAYED_END_OF_TURN_TO_GRAVEYARD' ||
        Boolean(trigger.triggerContext?.grantedToSourceCard)) &&
      sourceCard &&
      sourceCard.zone === 'BATTLEFIELD' &&
      (this.continuousEffects.hasLostInherentAbilities(sourceCard.instanceId) ||
        this.continuousEffects.hasProhibition(sourceCard.instanceId, 'CANNOT_GAIN_ABILITIES'))
    ) {
      return;
    }

    // 10.1 【回合1】/【回合N】限制：检查并消耗次数 (10.1.2.a 按 sourceCardInstanceId:abilityId 或自定义 oncePerTurnKey 计数，移区自动清空)
    const maxPerCard = trigger.maxPerTurn ?? (trigger.oncePerTurn ? 1 : undefined);
    if (maxPerCard !== undefined) {
      const player = this.state.players[trigger.controllerPlayerId];
      if (!player) return;
      const usageKey = trigger.oncePerTurnKey ?? `${trigger.sourceCardInstanceId}:${trigger.abilityId}`;
      if ((player.turnAbilityUsage[usageKey] ?? 0) >= maxPerCard) {
        return;
      }
      if (!trigger.deferOncePerTurnUntilCostPaid) {
        player.turnAbilityUsage[usageKey] = (player.turnAbilityUsage[usageKey] ?? 0) + 1;
      }
    }

    // 「《XXX》的该能力每回合最多发动 N 次」(默认 N=1；Q&A·7 BP01-056 梦赴光寥之乡 N=2 同编号共享且触发即消耗)
    const maxByPlayer = trigger.maxPerTurnByPlayer ?? (trigger.oncePerTurnByPlayer ? 1 : undefined);
    if (maxByPlayer !== undefined) {
      const player = this.state.players[trigger.controllerPlayerId];
      if (!player) return;
      const usageKey = `player:${trigger.sharedTurnKey ?? trigger.abilityId}`;
      if ((player.turnAbilityUsage[usageKey] ?? 0) >= maxByPlayer) {
        return;
      }
      player.turnAbilityUsage[usageKey] = (player.turnAbilityUsage[usageKey] ?? 0) + 1;
    }

    const execCtx: TriggerExecuteContext = {
      state: this.state,
      cardDb: this.cardDb,
      zoneMgr: this.zoneMgr,
      fieldMgr: this.fieldMgr,
      continuousEffects: this.continuousEffects,
      events: this.events,
      enqueueChoice: this.enqueueChoice,
      emitTriggerEvent: (ev) => this.emit(ev),
    };

    def.execute(trigger, execCtx);
  }

  private registerBuiltinDelayedHandlers(): void {
    // 8.7.5 时限触发：ST02-011 / ST05-004~008 等「该回合结束时，将该牌放置到墓地」
    this.registerTrigger({
      abilityId: 'DELAYED_END_OF_TURN_TO_GRAVEYARD',
      eventTypes: [], // 仅通过 delayedTriggers 或 endOfTurnToGraveyard 兼容逻辑入池
      collect: () => [],
      execute: (trigger, ctx) => {
        const card = ctx.state.cards[trigger.sourceCardInstanceId];
        const expectedZone = (trigger.triggerContext?.expectedZone as ZoneId | undefined) ?? 'BATTLEFIELD';
        if (!card || card.zone !== expectedZone) return;
        // BP04-044 开端：成为协战搭档后不会因该效果放置到墓地
        if (card.partnerOfCardId) return;
        const expectedTs = trigger.triggerContext?.expectedEnteredTimestamp as number | undefined;
        if (expectedTs !== undefined && card.enteredZoneTimestamp !== expectedTs) return;
        ctx.zoneMgr.moveCard(card.instanceId, 'GRAVEYARD', { isFaceUp: true });
      },
    });

    // 8.7.5 时限触发：BP03-024 / PR-033「该回合 / 下个对方回合结束时，将该牌从战场放置到牌组底」
    this.registerTrigger({
      abilityId: 'DELAYED_END_OF_TURN_TO_DECK_BOTTOM',
      eventTypes: [],
      collect: () => [],
      execute: (trigger, ctx) => {
        const card = ctx.state.cards[trigger.sourceCardInstanceId];
        if (!card || card.zone !== 'BATTLEFIELD') return;
        const expectedTs = trigger.triggerContext?.expectedEnteredTimestamp as number | undefined;
        if (expectedTs !== undefined && card.enteredZoneTimestamp !== expectedTs) return;
        ctx.zoneMgr.moveCardToBottomOfDeck(card.instanceId);
      },
    });

    // 8.7.5 时限触发：BP03-061「该回合结束时，将其竖直」
    this.registerTrigger({
      abilityId: 'DELAYED_END_OF_TURN_UNTAP',
      eventTypes: [],
      collect: () => [],
      execute: (trigger, ctx) => {
        const card = ctx.state.cards[trigger.sourceCardInstanceId];
        if (!card || card.zone !== 'BATTLEFIELD') return;
        const expectedTs = trigger.triggerContext?.expectedEnteredTimestamp as number | undefined;
        if (expectedTs !== undefined && card.enteredZoneTimestamp !== expectedTs) return;
        ctx.zoneMgr.setCardReady(card.instanceId, true);
      },
    });

    // 8.7.5 时限触发：PR-036「该回合结束时，抽 N 张牌」
    this.registerTrigger({
      abilityId: 'DELAYED_END_OF_TURN_DRAW',
      eventTypes: [],
      collect: () => [],
      execute: (trigger, ctx) => {
        const count = Number(trigger.triggerContext?.count ?? 1);
        if (count > 0) {
          ctx.zoneMgr.drawCards(trigger.controllerPlayerId, count);
        }
      },
    });

    // 8.7.5 时限触发：BP04-062「那次攻击结束时，将该牌从战场放置到我方信号球区最下方」
    this.registerTrigger({
      abilityId: 'DELAYED_ATTACK_END_TO_SIGNAL_ORB_BOTTOM',
      eventTypes: [],
      collect: () => [],
      execute: (trigger, ctx) => {
        const card = ctx.state.cards[trigger.sourceCardInstanceId];
        if (!card || card.zone !== 'BATTLEFIELD') return;
        const expectedTs = trigger.triggerContext?.expectedEnteredTimestamp as number | undefined;
        if (expectedTs !== undefined && card.enteredZoneTimestamp !== expectedTs) return;
        ctx.zoneMgr.insertCardIntoZoneAtIndex(card.instanceId, 'SIGNAL_ORB', 0, {
          isFaceUp: true,
          isReady: true,
        });
      },
    });

    // 8.7.5 时限触发：BP04-035「那次攻击结束时，将该牌的协战搭档出场；若从墓地选择协战搭档，直到回合结束获得【速攻】」
    this.registerTrigger({
      abilityId: 'DELAYED_ATTACK_END_DEPLOY_PARTNER',
      eventTypes: [],
      collect: () => [],
      execute: (trigger, ctx) => {
        const hostId = (trigger.triggerContext?.hostCardId as string | undefined) ?? trigger.sourceCardInstanceId;
        const host = ctx.state.cards[hostId];
        const partnerId = (trigger.triggerContext?.partnerCardId as string | undefined) ?? host?.partnerCardId;
        const partner = partnerId ? ctx.state.cards[partnerId] : undefined;
        if (!host || !partner || host.partnerCardId !== partner.instanceId) return;
        const controllerId = trigger.controllerPlayerId;
        const slot = ctx.fieldMgr.findFirstEmptySlot(controllerId);
        if (slot === undefined) return;
        host.partnerCardId = undefined;
        partner.partnerOfCardId = undefined;
        partner.cannotReleasePartnerUntilTurn = undefined;
        partner.releasePartnerToDeckBottom = undefined;
        if (ctx.fieldMgr.playRoleCard(controllerId, partner.instanceId, slot)) {
          if (trigger.triggerContext?.grantRush) {
            addCardModifier(ctx.state, partner, {
              keywords: ['速攻'],
              untilTurn: ctx.state.turnNumber,
              source: trigger.sourceCardNumber ?? 'BP04-035',
              sourceCardInstanceId: host.instanceId,
              appliedByPlayerId: controllerId,
            });
          }
          this.onDelayedDeployCallback?.(controllerId, partner.instanceId);
        }
      },
    });
  }
}
