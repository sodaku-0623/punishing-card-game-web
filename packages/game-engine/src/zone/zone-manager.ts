import {
  GameState,
  CardInstance,
  ZoneId,
  GameEvent,
} from '@zhanshuang/shared';
import { RULE_CONSTANTS } from '@zhanshuang/game-rules';
import { SeedRng } from '../rng/seed-rng.js';
import { ICardDatabase } from '../database/card-registry.js';
import { ContinuousEffectEngine, nextEffectTimestamp } from '../effects/continuous-effects.js';
import { ReplacementEngine } from '../effects/replacement-engine.js';
import { canMatchOrbCount } from '../effects/dsl/evaluator.js';
import type { TriggerEvent } from '../priority/trigger-system.js';

export class ZoneManager {
  private onChargeAutoEffectCallback?: (
    playerId: string,
    cardInstanceId: string,
    cardDef: any,
    chargeKind: 'ATTACK' | 'DAMAGE',
    attackerCardId?: string
  ) => void;
  private onWanshimingChargeCallback?: (
    playerId: string,
    cardInstanceId: string,
    attackerCardId: string,
    chargeKind: 'ATTACK' | 'DAMAGE'
  ) => boolean;
  private onTriggerEventCallback?: (event: TriggerEvent) => void;
  private snapshotProvider?: (cardInstanceId: string) => TriggerEvent['subjectSnapshot'];
  private continuousEffects?: ContinuousEffectEngine;
  private replacementEngine?: ReplacementEngine;
  private checkTimingResolver?: () => boolean;
  private defeatConditionChecker?: () => boolean;

  /** 受控作用域读缓存：仅在 dispatchAction (zoneCacheDepth > 0) 内部生效 */
  private zoneCacheDepth = 0;
  private zoneCache: Map<string, CardInstance[]> | null = null;
  private cachedCardsRef: Record<string, CardInstance> | null = null;

  constructor(
    private state: GameState,
    private rng: SeedRng,
    private cardDb: ICardDatabase,
    private events: GameEvent[]
  ) {}

  beginZoneCacheScope(): void {
    this.zoneCacheDepth += 1;
  }

  endZoneCacheScope(): void {
    if (this.zoneCacheDepth > 0) {
      this.zoneCacheDepth -= 1;
      if (this.zoneCacheDepth === 0) {
        this.invalidateZoneCache();
      }
    }
  }

  invalidateZoneCache(): void {
    this.zoneCache = null;
    this.cachedCardsRef = null;
  }

  setContinuousEffectEngine(engine: ContinuousEffectEngine): void {
    this.continuousEffects = engine;
  }

  setReplacementEngine(engine: ReplacementEngine): void {
    this.replacementEngine = engine;
  }

  setCheckTimingResolver(resolver: () => boolean, defeatChecker?: () => boolean): void {
    this.checkTimingResolver = resolver;
    this.defeatConditionChecker = defeatChecker;
  }

  /**
   * 3.6.4 / Q&A·6 动态费用区上限：默认 10；若我方费用区已存在正面《艾拉·万华》(BP03-052) 且正面《艾拉·万华》>= 5 张，上限变为 11
   */
  getMaxCostZoneCapacity(playerId: string): number {
    const costCards = this.getCardsInZone(playerId, 'COST').filter((c) => c.isFaceUp);
    const hasBP03052 = costCards.some((c) => c.cardNumber === 'BP03-052');
    if (!hasBP03052) return RULE_CONSTANTS.MAX_COST_ZONE_CAPACITY;
    const aylaCount = costCards.filter((c) => {
      if (this.continuousEffects?.hasCardName(c.instanceId, '艾拉·万华')) return true;
      const def = this.cardDb.getCard(c.cardNumber) || (c.cardId ? this.cardDb.getCard(c.cardId) : undefined);
      return def?.name === '艾拉·万华';
    }).length;
    return aylaCount >= 5 ? 11 : RULE_CONSTANTS.MAX_COST_ZONE_CAPACITY;
  }

  /**
   * 统一改变卡牌竖直/横置状态；在战场由竖直转为横置时发射 CARD_TAPPED 触发事件 (BP02-063)
   */
  setCardReady(cardInstanceId: string, isReady: boolean): boolean {
    const card = this.state.cards[cardInstanceId];
    if (!card) return false;
    const wasReady = card.isReady;
    card.isReady = isReady;
    if (wasReady && !isReady && card.zone === 'BATTLEFIELD') {
      this.onTriggerEventCallback?.({
        type: 'CARD_TAPPED',
        playerId: card.controllerPlayerId,
        cardInstanceId,
        subjectSnapshot: this.snapshotProvider?.(cardInstanceId),
      });
    }
    return true;
  }

  setWanshimingChargeHandler(
    handler: (
      playerId: string,
      cardInstanceId: string,
      attackerCardId: string,
      chargeKind: 'ATTACK' | 'DAMAGE'
    ) => boolean
  ): void {
    this.onWanshimingChargeCallback = handler;
  }

  setChargeAutoHandler(
    handler: (
      playerId: string,
      cardInstanceId: string,
      cardDef: any,
      chargeKind: 'ATTACK' | 'DAMAGE',
      attackerCardId?: string
    ) => void
  ): void {
    this.onChargeAutoEffectCallback = handler;
  }

  setTriggerEventHandler(
    handler: (event: TriggerEvent) => void,
    snapshotProvider?: (cardInstanceId: string) => TriggerEvent['subjectSnapshot']
  ): void {
    this.onTriggerEventCallback = handler;
    this.snapshotProvider = snapshotProvider;
  }

  /**
   * 移动卡牌到指定区域 (3.1.4 新卡牌原则 + 8.10 置换效果拦截)
   * 返回 true 表示完成了移动，false 表示移动被置换效果阻止、因多置换选序挂起或卡牌不存在。
   */
  moveCard(
    cardInstanceId: string,
    toZone: ZoneId,
    options?: {
      slotIndex?: number;
      isFaceUp?: boolean;
      isReady?: boolean;
      toBottom?: boolean;
      toFront?: boolean;
      isOrphanCleanup?: boolean;
      orphanHostCardId?: string;
      isPlacingUnderneath?: boolean;
      underneathHostId?: string;
      includeUnderneath?: boolean;
      appliedReplacementIds?: Set<string>;
      preferredReplacementId?: string;
      preserveAttachments?: boolean;
      resetStateOnSameZone?: boolean;
      skipLeftFieldTrigger?: boolean;
      sentByEffectOrCost?: boolean;
      countAsDeckToGy?: boolean;
    }
  ): boolean {
    const card = this.state.cards[cardInstanceId];
    if (!card) return false;

    const fromZone = card.zone;
    const fromSlot = card.slotIndex;

    let effectiveToZone = toZone;
    let effectiveFaceUp = options?.isFaceUp;
    let effectiveReady = options?.isReady;
    let effectiveToBottom = options?.toBottom;

    // 8.2.1.c / 8.10 在跨区域移动或从顶层战场置入其他角色下方即将发生前拦截置换效果
    if ((fromZone !== toZone || options?.isPlacingUnderneath) && this.replacementEngine) {
      const intercept = this.replacementEngine.interceptMoveCard(
        cardInstanceId,
        fromZone,
        toZone,
        {
          isFaceUp: effectiveFaceUp,
          isReady: effectiveReady,
          toBottom: effectiveToBottom,
          isOrphanCleanup: options?.isOrphanCleanup,
          orphanHostCardId: options?.orphanHostCardId,
          isPlacingUnderneath: options?.isPlacingUnderneath,
          underneathHostId: options?.underneathHostId,
          includeUnderneath: options?.includeUnderneath,
          skipLeftFieldTrigger: options?.skipLeftFieldTrigger,
          sentByEffectOrCost: options?.sentByEffectOrCost,
          countAsDeckToGy: options?.countAsDeckToGy,
          preferredReplacementId: options?.preferredReplacementId,
        },
        options?.appliedReplacementIds
      );
      if (intercept.prevented) {
        return false;
      }
      effectiveToZone = intercept.toZone;
      effectiveFaceUp = intercept.isFaceUp;
      effectiveReady = intercept.isReady;
      effectiveToBottom = intercept.toBottom;
    }

    // 3.6.4 兜底：无置换引擎介入或末段仍需放置到已满费用区时，改为正面放置到墓地
    if (
      effectiveToZone === 'COST' &&
      fromZone !== 'COST' &&
      this.getCardsInZone(card.controllerPlayerId, 'COST').length >= this.getMaxCostZoneCapacity(card.controllerPlayerId)
    ) {
      effectiveToZone = 'GRAVEYARD';
      effectiveFaceUp = true;
      effectiveReady = true;
      effectiveToBottom = false;
    }

    const leavingBattlefieldOrTopLevel =
      (fromZone === 'BATTLEFIELD' && effectiveToZone !== 'BATTLEFIELD') ||
      (fromZone === 'BATTLEFIELD' &&
        effectiveToZone === 'BATTLEFIELD' &&
        (Boolean(options?.isPlacingUnderneath) || Boolean(options?.resetStateOnSameZone)));

    // 8.13.4.a.2 解除战场关系前记录原协战搭档或下方牌身份（仅针对从战场/下方移出判定，不视为战场角色）
    const wasPartner = fromZone === 'BATTLEFIELD' && Boolean(card.partnerOfCardId);
    const wasUnderneath =
      fromZone === 'BATTLEFIELD' &&
      Object.values(this.state.battlefields).some((slots) =>
        slots.some(
          (s) =>
            Boolean(s.roleCardId) &&
            Boolean(this.state.cards[s.roleCardId!]?.underneathCardIds?.includes(card.instanceId))
        )
      );

    const leftBattlefieldSnapshot =
      leavingBattlefieldOrTopLevel && !options?.skipLeftFieldTrigger && !wasPartner && !wasUnderneath
        ? this.snapshotProvider?.(cardInstanceId)
        : undefined;

    const skipUnderneathOrphanCleanup = Boolean(
      options?.isPlacingUnderneath && options?.includeUnderneath && effectiveToZone === 'BATTLEFIELD'
    );

    // 9.6 战场卡位上的卡牌离开战场：先解除卡位与上下方关系并收集无所属卡牌，
    // 宿主自身完成移动后再将无所属卡牌送墓/置换 (Q&A·9 BP04-065 顺序固定：先宿主，再装备)
    // (10.18.2.b / 10.18.2.d.3 浮空保留下方牌与装备时跳过解绑，只释放协战搭档 8.13.4.a.3)
    const orphanInfo = leavingBattlefieldOrTopLevel
      ? this.detachFromBattlefieldAndCollectOrphans(
          card,
          options?.preserveAttachments,
          skipUnderneathOrphanCleanup
        )
      : { orphanIds: [], partnerId: undefined };

    card.zone = effectiveToZone;

    // 区域内顺序以 state.cards 的键顺序表示：
    // 默认放在末尾 (墓地 3.5.2、信号球区 3.7.2、处理区 3.8.2 的「最上方」；牌组的「最下方」)；
    // 当 toBottom=true 且目标非牌组 (信号球区等区域的「最下方」，Q&A·9 BP04-065)，或 toFront=true 且目标为牌组 (牌组顶) 时，放在对象最前
    if ((options?.toFront && effectiveToZone === 'DECK') || (effectiveToBottom && effectiveToZone !== 'DECK')) {
      this.placeCardKeyAtFront(cardInstanceId, card);
    } else {
      delete this.state.cards[cardInstanceId];
      this.state.cards[cardInstanceId] = card;
    }
    this.invalidateZoneCache();

    // 3.1.4 移动到其他区域的卡牌 (或离开战场顶层沦为下方牌/搭档) 视为新卡牌，原区域适用的效果与状态不延续
    const shouldResetState =
      fromZone !== effectiveToZone ||
      Boolean(options?.isPlacingUnderneath) ||
      Boolean(options?.resetStateOnSameZone);
    if (shouldResetState) {
      if (fromZone !== effectiveToZone) {
        card.enteredFromZone = fromZone;
      }
      card.tempPPBonus = undefined;
      card.tempDPBonus = undefined;
      card.grantedKeywords = undefined;
      card.modifiers = undefined;
      card.endOfTurnToGraveyard = undefined;
      card.releasePartnerToDeckBottom = undefined;
      card.isFrozen = undefined;
      if (effectiveToZone !== 'BATTLEFIELD' || options?.isPlacingUnderneath || options?.resetStateOnSameZone) {
        card.wasAscendedPlay = undefined;
        card.ascendedFromAirborne = undefined;
        card.paidHiddenCostOnPlay = undefined;
      }
      const airborneOrphanIds =
        fromZone === 'PROCESSING' && card.isAirborne && effectiveToZone !== 'BATTLEFIELD' && !options?.preserveAttachments
          ? [
              ...(card.underneathCardIds ?? []),
              ...(card.attachedEquipmentId ? [card.attachedEquipmentId] : []),
              ...(card.extraAttachedEquipmentIds ?? []),
            ]
          : [];
      if (!(card.isAirborne && effectiveToZone === 'PROCESSING')) {
        card.isAirborne = undefined;
      }
      card.effectivePP = undefined;
      card.effectiveDP = undefined;
      card.effectiveKeywords = undefined;
      card.effectiveTraits = undefined;
      card.effectiveProhibitions = undefined;
      card.effectiveOrbColors = undefined;
      card.effectiveOrbValue = undefined;
      if (!options?.preserveAttachments && !skipUnderneathOrphanCleanup) {
        card.underneathCardIds = [];
        card.attachedEquipmentId = undefined;
        card.extraAttachedEquipmentIds = undefined;
      } else if (skipUnderneathOrphanCleanup) {
        card.attachedEquipmentId = undefined;
        card.extraAttachedEquipmentIds = undefined;
      }
      // 10.18.2.d.3 浮空模式卡牌离开处理区前往非战场区域时，原附着的下方牌与装备进入墓地
      for (const orphanId of airborneOrphanIds) {
        if (this.state.cards[orphanId] && orphanId !== cardInstanceId) {
          this.moveCard(orphanId, 'GRAVEYARD', { isFaceUp: true, isOrphanCleanup: true, orphanHostCardId: cardInstanceId });
        }
      }
      card.enteredZoneTimestamp = nextEffectTimestamp(this.state);
      this.replacementEngine?.cleanupForCard(cardInstanceId);
      if (effectiveToZone !== 'BATTLEFIELD' || options?.isPlacingUnderneath || options?.resetStateOnSameZone) {
        card.slotIndex = undefined;
      }
      // 10.1.2.a 回合次数限制只对同一区域中的同一张卡牌计数 (清理 cardInstanceId 及 cardInstanceId:abilityId)
      const usage = this.state.players[card.controllerPlayerId]?.turnAbilityUsage;
      if (usage) {
        delete usage[cardInstanceId];
        const prefix = `${cardInstanceId}:`;
        for (const key of Object.keys(usage)) {
          if (key.startsWith(prefix)) delete usage[key];
        }
      }
    }

    if (options?.slotIndex !== undefined && effectiveToZone === 'BATTLEFIELD' && !options?.isPlacingUnderneath) {
      card.slotIndex = options.slotIndex;
    }
    if (effectiveFaceUp !== undefined) card.isFaceUp = effectiveFaceUp;
    if (effectiveReady !== undefined) card.isReady = effectiveReady;
    card.turnEnteredZone = this.state.turnNumber;

    if (fromZone === 'COST' || effectiveToZone === 'COST') {
      this.syncCostStats(card.controllerPlayerId);
    }

    this.events.push({
      type: 'CARD_MOVED',
      cardInstanceId,
      fromZone,
      toZone: effectiveToZone,
      fromSlot,
      toSlot: effectiveToZone === 'BATTLEFIELD' && !options?.isPlacingUnderneath ? options?.slotIndex : undefined,
      isFaceUp: card.isFaceUp,
      isReady: card.isReady,
    });

    // 9.6 宿主完成离场移动后，依次处理原本下方的无所属卡牌与协战搭档 (允许置换效果介入，如 BP04-065)
    for (const orphanId of orphanInfo.orphanIds) {
      const orphan = this.state.cards[orphanId];
      if (orphan && orphan.zone === 'BATTLEFIELD') {
        this.moveCard(orphanId, 'GRAVEYARD', {
          isFaceUp: true,
          isOrphanCleanup: true,
          orphanHostCardId: cardInstanceId,
        });
      }
    }
    if (orphanInfo.partnerId) {
      const partner = this.state.cards[orphanInfo.partnerId];
      if (partner && partner.zone === 'BATTLEFIELD') {
        const toBottom = Boolean(partner.releasePartnerToDeckBottom);
        partner.releasePartnerToDeckBottom = undefined;
        // 8.13.4.a.1 / 8.13.4.c.4：搭档解除协战状态放置到墓地，不视为离场 (BP04-023/024/025 改为放置到牌组底)
        if (toBottom) {
          this.moveCardToBottomOfDeck(orphanInfo.partnerId);
        } else {
          this.moveCard(orphanInfo.partnerId, 'GRAVEYARD', {
            isFaceUp: true,
            isOrphanCleanup: true,
            orphanHostCardId: cardInstanceId,
            skipLeftFieldTrigger: true,
          });
        }
        this.onTriggerEventCallback?.({
          type: 'PARTNER_RELEASED',
          playerId: card.controllerPlayerId,
          cardInstanceId,
          targetCardId: orphanInfo.partnerId,
          subjectSnapshot: this.snapshotProvider?.(orphanInfo.partnerId),
        });
      }
    }

    // 8.7.4.a.2 离开战场触发事件 (携带离场前在战场时的快照情报；8.13.4.a.2 搭档与下方牌不视为战场角色，不发射离场事件)
    if (leavingBattlefieldOrTopLevel && !options?.skipLeftFieldTrigger && !wasPartner && !wasUnderneath) {
      this.onTriggerEventCallback?.({
        type: 'CARD_LEFT_FIELD',
        playerId: card.controllerPlayerId,
        cardInstanceId,
        fromZone,
        toZone: effectiveToZone,
        subjectSnapshot: leftBattlefieldSnapshot,
      });
      if (effectiveToZone === 'GRAVEYARD' && options?.sentByEffectOrCost) {
        this.onTriggerEventCallback?.({
          type: 'CARD_SENT_FIELD_TO_GY_BY_EFFECT',
          playerId: card.controllerPlayerId,
          cardInstanceId,
          fromZone,
          toZone: effectiveToZone,
          subjectSnapshot: leftBattlefieldSnapshot,
        });
      }
    }

    // Q&A·4 BP02-030：从牌组 (含从牌组公开进处理区后直接进墓地) 放置到墓地时触发
    if (
      effectiveToZone === 'GRAVEYARD' &&
      (fromZone === 'DECK' || (fromZone === 'PROCESSING' && options?.countAsDeckToGy))
    ) {
      this.onTriggerEventCallback?.({
        type: 'CARD_MOVED_DECK_TO_GY',
        playerId: card.controllerPlayerId,
        cardInstanceId,
        fromZone: 'DECK',
        toZone: 'GRAVEYARD',
        subjectSnapshot: this.snapshotProvider?.(cardInstanceId),
      });
    }

    // BP04-059：从墓地放置到牌组底时触发
    if (fromZone === 'GRAVEYARD' && effectiveToZone === 'DECK' && effectiveToBottom) {
      this.onTriggerEventCallback?.({
        type: 'CARD_MOVED_GY_TO_DECK_BOTTOM',
        playerId: card.controllerPlayerId,
        cardInstanceId,
        fromZone: 'GRAVEYARD',
        toZone: 'DECK',
        subjectSnapshot: this.snapshotProvider?.(cardInstanceId),
      });
    }

    return true;
  }

  /**
   * 同步附属卡牌 (升变对象、下方牌、附着装备) 随宿主一并迁区时的区域与瞬态字段，不触发独立离场事件。
   */
  syncAttachedCardZone(
    cardInstanceId: string,
    toZone: ZoneId,
    options?: {
      slotIndex?: number;
      controllerPlayerId?: string;
      isFaceUp?: boolean;
      isReady?: boolean;
      clearTransientState?: boolean;
    }
  ): boolean {
    const card = this.state.cards[cardInstanceId];
    if (!card) return false;
    const prevZone = card.zone;
    card.zone = toZone;
    card.slotIndex = options?.slotIndex;
    if (options?.controllerPlayerId !== undefined) {
      card.controllerPlayerId = options.controllerPlayerId;
    }
    if (options?.isFaceUp !== undefined) card.isFaceUp = options.isFaceUp;
    if (options?.isReady !== undefined) card.isReady = options.isReady;
    if (options?.clearTransientState) {
      card.modifiers = undefined;
      card.tempPPBonus = undefined;
      card.tempDPBonus = undefined;
      card.grantedKeywords = undefined;
      card.isFrozen = undefined;
      card.endOfTurnToGraveyard = undefined;
      card.isAirborne = undefined;
      card.wasAscendedPlay = undefined;
      card.ascendedFromAirborne = undefined;
      card.paidHiddenCostOnPlay = undefined;
      card.effectivePP = undefined;
      card.effectiveDP = undefined;
      card.effectiveKeywords = undefined;
      card.effectiveTraits = undefined;
      card.effectiveProhibitions = undefined;
      card.effectiveOrbColors = undefined;
      card.effectiveOrbValue = undefined;
    }
    if (prevZone !== toZone) {
      card.enteredFromZone = prevZone;
      card.enteredZoneTimestamp = nextEffectTimestamp(this.state);
      card.turnEnteredZone = this.state.turnNumber;
      delete this.state.cards[cardInstanceId];
      this.state.cards[cardInstanceId] = card;
    }
    if (prevZone !== toZone || options?.controllerPlayerId !== undefined || options?.clearTransientState) {
      this.invalidateZoneCache();
    }
    if (prevZone === 'COST' || toZone === 'COST') {
      this.syncCostStats(card.controllerPlayerId);
    }
    return true;
  }

  /** 返回 [0, maxExclusive) 范围内的确定性伪随机整数 (遵循状态 rngState，供盲弃对方手牌等效果复用) */
  nextRandomInt(maxExclusive: number): number {
    if (maxExclusive <= 1) return 0;
    return this.rng.nextInt(0, maxExclusive - 1);
  }

  /** 将卡牌键放到 state.cards 最前 (供牌组顶、信号球区最下方等使用) */
  private placeCardKeyAtFront(cardInstanceId: string, card: CardInstance): void {
    const prevCards = { ...this.state.cards };
    const keys = Object.keys(prevCards);
    for (let i = 0; i < keys.length; i++) {
      delete this.state.cards[keys[i]!];
    }
    this.state.cards[cardInstanceId] = card;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!;
      if (k !== cardInstanceId) {
        this.state.cards[k] = prevCards[k]!;
      }
    }
    this.invalidateZoneCache();
  }

  /**
   * 卡牌离开战场时解除其与卡位、上下方卡牌、协战状态的关系，并返回需作为无所属卡牌处理的卡牌 ID (9.6 / 8.13.4.a.3)
   */
  private detachFromBattlefieldAndCollectOrphans(
    card: CardInstance,
    preserveAttachments?: boolean,
    skipUnderneathCleanup?: boolean
  ): { orphanIds: string[]; partnerId?: string } {
    const playerId = card.controllerPlayerId;
    for (const slot of this.state.battlefields[playerId] ?? []) {
      if (slot.roleCardId === card.instanceId) slot.roleCardId = undefined;
      if (slot.assistCardId === card.instanceId) slot.assistCardId = undefined;
      if (slot.standaloneEquipmentId === card.instanceId) slot.standaloneEquipmentId = undefined;
    }

    // 仅扫描双方战场顶层卡位与 PROCESSING 浮空卡，解除其装备/下方牌/搭档引用 (避免扫全量 100 张牌)
    const candidateHosts: CardInstance[] = [];
    const seenHostIds = new Set<string>();
    for (const pid of Object.keys(this.state.players)) {
      for (const slot of this.state.battlefields[pid] ?? []) {
        for (const hid of [slot.roleCardId, slot.assistCardId, slot.standaloneEquipmentId]) {
          if (!hid || seenHostIds.has(hid)) continue;
          const hc = this.state.cards[hid];
          if (hc) {
            seenHostIds.add(hid);
            candidateHosts.push(hc);
          }
        }
      }
      for (const pc of this.getCardsInZone(pid, 'PROCESSING')) {
        if (pc.isAirborne && !seenHostIds.has(pc.instanceId)) {
          seenHostIds.add(pc.instanceId);
          candidateHosts.push(pc);
        }
      }
    }

    for (const other of candidateHosts) {
      if (other.attachedEquipmentId === card.instanceId) {
        if (other.extraAttachedEquipmentIds && other.extraAttachedEquipmentIds.length > 0) {
          other.attachedEquipmentId = other.extraAttachedEquipmentIds.shift();
          if (other.extraAttachedEquipmentIds.length === 0) other.extraAttachedEquipmentIds = undefined;
        } else {
          other.attachedEquipmentId = undefined;
        }
      } else if (other.extraAttachedEquipmentIds?.includes(card.instanceId)) {
        const rest = other.extraAttachedEquipmentIds.filter((id) => id !== card.instanceId);
        other.extraAttachedEquipmentIds = rest.length > 0 ? rest : undefined;
      }
      if (other.underneathCardIds?.includes(card.instanceId)) {
        other.underneathCardIds = other.underneathCardIds.filter((id) => id !== card.instanceId);
      }
      if (other.partnerCardId === card.instanceId) {
        other.partnerCardId = undefined;
      }
    }
    card.partnerOfCardId = undefined;
    card.cannotReleasePartnerUntilTurn = undefined;

    let partnerId: string | undefined;
    if (card.partnerCardId) {
      partnerId = card.partnerCardId;
      const partner = this.state.cards[partnerId];
      if (partner) {
        partner.partnerOfCardId = undefined;
        partner.cannotReleasePartnerUntilTurn = undefined;
      }
      card.partnerCardId = undefined;
    }

    if (preserveAttachments) {
      return { orphanIds: [], partnerId };
    }

    const orphanIds = skipUnderneathCleanup ? [] : [...(card.underneathCardIds ?? [])];
    if (card.attachedEquipmentId) orphanIds.push(card.attachedEquipmentId);
    if (card.extraAttachedEquipmentIds?.length) orphanIds.push(...card.extraAttachedEquipmentIds);
    if (!skipUnderneathCleanup) {
      card.underneathCardIds = [];
    }
    card.attachedEquipmentId = undefined;
    card.extraAttachedEquipmentIds = undefined;
    return { orphanIds, partnerId };
  }

  /**
   * 3.6 费用统计由费用区中的实际卡牌派生 (明费 = 正面，暗费 = 背面竖直)
   */
  syncCostStats(playerId: string): void {
    const player = this.state.players[playerId];
    if (!player) return;
    const costCards = this.getCardsInZone(playerId, 'COST');
    const openCards = costCards.filter((c) => c.isFaceUp);
    player.totalCostCount = costCards.length;
    player.openCostCount = openCards.length;
    player.availableOpenCostCount = openCards.filter((c) => c.isReady).length;
    player.exhaustedOpenCostCount = openCards.length - player.availableOpenCostCount;
    player.hiddenCostCount = costCards.length - openCards.length;
  }

  /**
   * 将卡牌插入到指定区域的第 index 个位置 (0 = 最下方 / 队首，N = 最上方 / 队尾，供 BP01-038 任意位置放信号球)
   */
  insertCardIntoZoneAtIndex(
    cardInstanceId: string,
    zone: ZoneId,
    index: number,
    options?: { isFaceUp?: boolean; isReady?: boolean }
  ): boolean {
    const card = this.state.cards[cardInstanceId];
    if (!card) return false;
    const playerId = card.controllerPlayerId;
    const moved = this.moveCard(cardInstanceId, zone, {
      isFaceUp: options?.isFaceUp ?? true,
      isReady: options?.isReady ?? true,
    });
    if (!moved || card.zone !== zone) return false;

    const zoneCards = this.getCardsInZone(playerId, zone).filter((c) => c.instanceId !== cardInstanceId);
    const clampedIndex = Math.max(0, Math.min(index, zoneCards.length));
    const orderedIds = [
      ...zoneCards.slice(0, clampedIndex).map((c) => c.instanceId),
      cardInstanceId,
      ...zoneCards.slice(clampedIndex).map((c) => c.instanceId),
    ];
    const zoneIdSet = new Set(orderedIds);
    const newCards: Record<string, CardInstance> = {};
    let inserted = false;
    for (const [k, v] of Object.entries(this.state.cards)) {
      if (zoneIdSet.has(k)) {
        if (!inserted) {
          for (const oid of orderedIds) {
            const c = this.state.cards[oid];
            if (c) newCards[oid] = c;
          }
          inserted = true;
        }
      } else {
        newCards[k] = v;
      }
    }
    if (!inserted) {
      for (const oid of orderedIds) {
        const c = this.state.cards[oid];
        if (c) newCards[oid] = c;
      }
    }
    for (const k of Object.keys(this.state.cards)) {
      delete this.state.cards[k];
    }
    Object.assign(this.state.cards, newCards);
    this.invalidateZoneCache();
    return true;
  }

  /**
   * 将卡牌移动到牌组底 (保持物理顺序，放在牌组最末位；从墓地放回牌组底时发射 CARD_MOVED_GY_TO_DECK_BOTTOM)
   */
  moveCardToBottomOfDeck(cardInstanceId: string): boolean {
    const card = this.state.cards[cardInstanceId];
    if (!card) return false;

    const moved = this.moveCard(cardInstanceId, 'DECK', { isFaceUp: false, toBottom: true });
    if (!moved) return false;
    if (card.zone !== 'DECK') return false;
    return true;
  }

  /**
   * 将卡牌移动到牌组顶 (放置在牌组最前位，遍历顺序第一位)
   */
  moveCardToTopOfDeck(cardInstanceId: string): boolean {
    const card = this.state.cards[cardInstanceId];
    if (!card) return false;

    const moved = this.moveCard(cardInstanceId, 'DECK', { isFaceUp: false, toFront: true });
    if (!moved) return false;
    if (card.zone !== 'DECK') return false;
    return true;
  }

  /**
   * 5.2.1.f 放置起始明费：将牌组顶 2 张卡牌以正面竖直状态放置到费用区
   */
  placeInitialOpenCosts(playerId: string, count: number = RULE_CONSTANTS.INITIAL_OPEN_COSTS): CardInstance[] {
    const placedCards: CardInstance[] = [];
    const player = this.state.players[playerId];
    if (!player) return placedCards;

    const deckCards = this.getCardsInZone(playerId, 'DECK');
    const toPlace = deckCards.slice(0, count);

    for (const card of toPlace) {
      this.moveCard(card.instanceId, 'COST', { isFaceUp: true, isReady: true });
      placedCards.push(card);
    }

    return placedCards;
  }

  /**
   * 充分洗切指定玩家的牌组 (5.2.1.b / 5.2.1.e)
   */
  shuffleDeck(playerId: string): void {
    const deckCards = this.getCardsInZone(playerId, 'DECK');
    if (deckCards.length <= 1) return;

    const deckCardIds = deckCards.map((c) => c.instanceId);
    const shuffledIds = this.rng.shuffle(deckCardIds);

    const allCards = { ...this.state.cards };
    const newCards: Record<string, CardInstance> = {};
    for (const [id, card] of Object.entries(this.state.cards)) {
      if (card.controllerPlayerId !== playerId || card.zone !== 'DECK') {
        newCards[id] = card;
      }
    }
    for (const id of shuffledIds) {
      newCards[id] = allCards[id]!;
    }
    for (const k of Object.keys(this.state.cards)) {
      delete this.state.cards[k];
    }
    Object.assign(this.state.cards, newCards);
    this.invalidateZoneCache();

    this.events.push({
      type: 'CARDS_SHUFFLED',
      playerId,
      zone: 'DECK',
    });
  }

  /**
   * 获取指定玩家某区域的卡牌列表 (保持物理顺序；在 dispatchAction 作用域内使用单遍扫描读缓存)
   * 10.18.3.b 浮空模式卡牌下方的卡牌与附着装备不视为处理区中的卡牌
   */
  getCardsInZone(playerId: string, zone: ZoneId): CardInstance[] {
    if (this.zoneCacheDepth > 0) {
      if (this.cachedCardsRef !== this.state.cards || !this.zoneCache) {
        this.rebuildZoneCache();
      }
      const cached = this.zoneCache!.get(`${playerId}:${zone}`);
      return cached ? cached.slice() : [];
    }
    return this.computeCardsInZone(playerId, zone);
  }

  private computeCardsInZone(playerId: string, zone: ZoneId): CardInstance[] {
    const res: CardInstance[] = [];
    const cards = this.state.cards;
    let excludedFromProcessing: Set<string> | undefined;
    if (zone === 'PROCESSING') {
      for (const id in cards) {
        const c = cards[id];
        if (!c || c.controllerPlayerId !== playerId || c.zone !== 'PROCESSING' || !c.isAirborne) {
          continue;
        }
        if (
          (c.underneathCardIds && c.underneathCardIds.length > 0) ||
          c.attachedEquipmentId ||
          (c.extraAttachedEquipmentIds && c.extraAttachedEquipmentIds.length > 0)
        ) {
          excludedFromProcessing ??= new Set();
          for (const uid of c.underneathCardIds ?? []) excludedFromProcessing.add(uid);
          if (c.attachedEquipmentId) excludedFromProcessing.add(c.attachedEquipmentId);
          for (const eqId of c.extraAttachedEquipmentIds ?? []) excludedFromProcessing.add(eqId);
        }
      }
    }
    for (const id in cards) {
      const c = cards[id];
      if (c && c.controllerPlayerId === playerId && c.zone === zone) {
        if (excludedFromProcessing?.has(id)) continue;
        res.push(c);
      }
    }
    return res;
  }

  private rebuildZoneCache(): void {
    const cards = this.state.cards;
    const cache = new Map<string, CardInstance[]>();
    let excludedByPlayer: Map<string, Set<string>> | undefined;

    for (const id in cards) {
      const c = cards[id];
      if (!c) continue;
      const key = `${c.controllerPlayerId}:${c.zone}`;
      let list = cache.get(key);
      if (!list) {
        list = [c];
        cache.set(key, list);
      } else {
        list.push(c);
      }
      if (c.zone === 'PROCESSING' && c.isAirborne) {
        const hasAttach =
          (c.underneathCardIds && c.underneathCardIds.length > 0) ||
          Boolean(c.attachedEquipmentId) ||
          (c.extraAttachedEquipmentIds && c.extraAttachedEquipmentIds.length > 0);
        if (hasAttach) {
          excludedByPlayer ??= new Map();
          let set = excludedByPlayer.get(c.controllerPlayerId);
          if (!set) {
            set = new Set();
            excludedByPlayer.set(c.controllerPlayerId, set);
          }
          for (const uid of c.underneathCardIds ?? []) set.add(uid);
          if (c.attachedEquipmentId) set.add(c.attachedEquipmentId);
          for (const eqId of c.extraAttachedEquipmentIds ?? []) set.add(eqId);
        }
      }
    }

    if (excludedByPlayer) {
      for (const [pid, excluded] of excludedByPlayer) {
        const key = `${pid}:PROCESSING`;
        const list = cache.get(key);
        if (list) {
          cache.set(
            key,
            list.filter((c) => !excluded.has(c.instanceId))
          );
        }
      }
    }

    this.zoneCache = cache;
    this.cachedCardsRef = cards;
  }

  private isFinished(): boolean {
    return this.state.status === 'FINISHED';
  }

  /**
   * 9.2 牌组更新处理 (中断型规则处理)：牌组没有卡牌时，将墓地所有卡牌移动到牌组并洗切，侵蚀计数+1。
   * 墓地也没有卡牌时该玩家立即败北 (9.2.2.a)。返回牌组中是否有卡牌可供继续处理。
   */
  refreshDeckIfEmpty(playerId: string): boolean {
    const player = this.state.players[playerId];
    if (!player || this.state.status === 'FINISHED') return false;
    if (this.getCardsInZone(playerId, 'DECK').length > 0) return true;

    const graveyardCards = this.getCardsInZone(playerId, 'GRAVEYARD');
    if (graveyardCards.length === 0) {
      this.state.winnerId =
        this.state.activePlayerId === playerId ? this.state.nonActivePlayerId : this.state.activePlayerId;
      this.state.status = 'FINISHED';
      this.state.isDraw = false;
      this.state.finishReason = `${playerId} 的牌组与墓地均没有卡牌，立即败北 (9.2.2.a)`;
      this.events.push({
        type: 'GAME_OVER',
        winnerPlayerId: this.state.winnerId,
        isDraw: false,
        reason: this.state.finishReason,
      });
      return false;
    }

    for (const card of graveyardCards) {
      this.moveCard(card.instanceId, 'DECK', { isFaceUp: false, isReady: true });
    }
    this.shuffleDeck(playerId);

    const oldErosion = player.erosionCount;
    player.erosionCount += 1;
    player.erosionChangedThisTurn = true;
    this.events.push({
      type: 'DECK_REFRESHED',
      playerId,
      cardsShuffledCount: graveyardCards.length,
      newErosionCount: player.erosionCount,
    });
    this.events.push({
      type: 'EROSION_INCREASED',
      playerId,
      previousValue: oldErosion,
      newValue: player.erosionCount,
      reason: 'DECK_REFRESH',
    });
    return true;
  }

  /**
   * 抽牌 (4.7 抽牌；3.3.3.b 中途牌组耗尽时先执行牌组更新再继续)
   */
  drawCards(playerId: string, count: number): string[] {
    const drawnIds: string[] = [];
    if (!this.state.players[playerId]) return drawnIds;

    for (let i = 0; i < count; i++) {
      if (!this.refreshDeckIfEmpty(playerId)) break;
      const topCard = this.getCardsInZone(playerId, 'DECK')[0]!;
      this.moveCard(topCard.instanceId, 'HAND', { isFaceUp: true });
      drawnIds.push(topCard.instanceId);
    }

    if (drawnIds.length > 0) {
      this.events.push({
        type: 'CARDS_DRAWN',
        playerId,
        count: drawnIds.length,
        drawnCardIds: drawnIds,
      });
    }

    return drawnIds;
  }

  /**
   * 4.12.1 充能的第一步：将牌组顶的牌翻开放置到处理区 (牌组为空时先执行牌组更新)，
   * 并处理其充能时自动能力 (10.2.1.b)。返回翻开的卡牌；无法翻开时返回 undefined。
   * 能力可能产生需要玩家决定的选择，调用方须在选择处理完毕后再调用 completeAttackCharge / completeDamageCharge。
   */
  revealTopForCharge(
    playerId: string,
    chargeKind: 'ATTACK' | 'DAMAGE' = 'ATTACK',
    attackerCardId?: string
  ): string | undefined {
    if (!this.refreshDeckIfEmpty(playerId)) return undefined;
    const topCard = this.getCardsInZone(playerId, 'DECK')[0]!;
    this.moveCard(topCard.instanceId, 'PROCESSING', { isFaceUp: true });

    // 8.10.1.a 若进入处理区被置换到其他区域 (如 BP01-037 改放费用区)，不触发进入处理区后的充能事件
    if (topCard.zone !== 'PROCESSING') {
      return topCard.instanceId;
    }

    // BP01-037 万世铭 / BP01-038 万世铭·重铸：因<曲>角色攻击充能或伤害充能进入处理区时，可选改为以横置状态放置到费用区 (Q&A·5)
    if (
      (chargeKind === 'ATTACK' || chargeKind === 'DAMAGE') &&
      attackerCardId &&
      (topCard.cardNumber === 'BP01-037' || topCard.cardNumber === 'BP01-038')
    ) {
      const attacker = this.state.cards[attackerCardId];
      const attackerDef = attacker
        ? this.cardDb.getCard(attacker.cardNumber) || (attacker.cardId ? this.cardDb.getCard(attacker.cardId) : undefined)
        : undefined;
      const isRole = attacker
        ? this.continuousEffects
          ? this.continuousEffects.getEffectiveCardType(attackerCardId) === 'ROLE'
          : attackerDef?.cardType === 'ROLE'
        : false;
      const isQuRole =
        isRole &&
        (Boolean(attacker && this.continuousEffects?.hasTrait(attackerCardId, '曲')) ||
          Boolean(attackerDef?.traits?.includes('曲') || attackerDef?.name.includes('曲')));
      if (
        isQuRole &&
        this.onWanshimingChargeCallback?.(playerId, topCard.instanceId, attackerCardId, chargeKind)
      ) {
        return topCard.instanceId;
      }
    }

    this.onTriggerEventCallback?.({
      type: 'CARD_CHARGED',
      playerId,
      cardInstanceId: topCard.instanceId,
      targetCardId: attackerCardId,
      chargeKind,
      subjectSnapshot: this.snapshotProvider?.(topCard.instanceId),
    });

    const cardDef = this.cardDb.getCard(topCard.cardNumber) || (topCard.cardId ? this.cardDb.getCard(topCard.cardId) : undefined);
    // 10.2.1.b 处理充能时自动能力【充能自】(覆盖信号球牌及非信号球牌带条件/代价的【充能自】)
    if (cardDef && cardDef.rulesText.includes('充能自')) {
      if (chargeKind === 'ATTACK') {
        if (this.state.currentCombat) {
          this.state.currentCombat.attackChargedHasChargeAuto = true;
        }
        if (attackerCardId) {
          const attacker = this.state.cards[attackerCardId];
          const attackerDef = attacker
            ? this.cardDb.getCard(attacker.cardNumber) ||
              (attacker.cardId ? this.cardDb.getCard(attacker.cardId) : undefined)
            : undefined;
          const isLee =
            this.continuousEffects?.hasCardName(attackerCardId, '里·超刻') ||
            attackerDef?.name === '里·超刻';
          if (isLee && this.state.players[playerId]) {
            this.state.players[playerId]!.chargedAutoByLeeThisTurn = true;
          }
        }
      }
      this.onChargeAutoEffectCallback?.(playerId, topCard.instanceId, cardDef, chargeKind, attackerCardId);
    }
    return topCard.instanceId;
  }

  /**
   * 4.12.2.a/b 攻击充能的第二步：信号球牌放置到信号球区最上方，其他卡牌加入手牌。
   * 若能力处理中该牌已离开处理区，则不再移动。
   */
  completeAttackCharge(attackerCardId: string, cardInstanceId: string, chargeIndex: number): void {
    const card = this.state.cards[cardInstanceId];
    if (!card || card.zone !== 'PROCESSING') return;
    const cardDef = this.cardDb.getCard(card.cardNumber) || (card.cardId ? this.cardDb.getCard(card.cardId) : undefined);
    const destination = cardDef?.signalOrb ? 'SIGNAL_ORB' : 'HAND';
    this.moveCard(cardInstanceId, destination, { isFaceUp: true });
    this.events.push({
      type: 'ATTACK_CHARGE_PERFORMED',
      attackerCardId,
      chargeIndex,
      revealedCardId: cardInstanceId,
      resultDestination: destination,
    });
  }

  /**
   * 4.12.3.a / 4.10.1.b 伤害充能的第二步：以背面竖直状态放置到费用区成为暗费
   * (费用区已满时改为放置到墓地，3.6.4)，然后侵蚀计数 +1。
   */
  completeDamageCharge(defenderPlayerId: string, cardInstanceId: string | undefined): void {
    const player = this.state.players[defenderPlayerId];
    if (!player) return;
    const card = cardInstanceId ? this.state.cards[cardInstanceId] : undefined;
    if (card && card.zone === 'PROCESSING') {
      const toCost = player.totalCostCount < this.getMaxCostZoneCapacity(defenderPlayerId);
      if (toCost) {
        this.moveCard(card.instanceId, 'COST', { isFaceUp: false, isReady: true });
      } else {
        this.moveCard(card.instanceId, 'GRAVEYARD', { isFaceUp: true });
      }
      this.events.push({
        type: 'DAMAGE_CHARGE_PERFORMED',
        defenderPlayerId,
        revealedCardId: card.instanceId,
        placedToCostFaceDown: toCost,
      });
    }

    player.damageTakenThisTurn = (player.damageTakenThisTurn ?? 0) + 1;
    const oldErosion = player.erosionCount;
    player.erosionCount += 1;
    player.erosionChangedThisTurn = true;
    this.events.push({
      type: 'EROSION_INCREASED',
      playerId: defenderPlayerId,
      previousValue: oldErosion,
      newValue: player.erosionCount,
      reason: 'DAMAGE',
    });
    this.onTriggerEventCallback?.({
      type: 'DAMAGE_DEALT',
      playerId: defenderPlayerId,
      cardInstanceId,
      damageAmount: 1,
    });
  }

  hasPendingCharges(): boolean {
    return Boolean(this.state.pendingChargeQueue && this.state.pendingChargeQueue.length > 0);
  }

  /**
   * 10.2.1.b 逐张推进可挂起的直伤/攻击充能队列，遇到需要玩家决策的【充能自】或胜负结束立即挂起
   */
  drainPendingCharges(): boolean {
    let progressed = false;
    for (let guard = 0; guard < 100; guard++) {
      if (this.state.status === 'FINISHED' || this.state.currentPendingChoice) break;
      const queue = this.state.pendingChargeQueue;
      if (!queue || queue.length === 0) break;
      const task = queue[0]!;

      if (task.pendingCardId !== undefined) {
        progressed = true;
        if (task.kind === 'DIRECT_DAMAGE') {
          const cid = task.pendingCardId || undefined;
          task.pendingCardId = undefined;
          this.completeDamageCharge(task.playerId, cid);
          if (task.deferCheckTiming) {
            this.defeatConditionChecker?.();
          } else {
            this.checkTimingResolver?.();
          }
          if (this.isFinished()) {
            this.state.pendingChargeQueue = undefined;
            break;
          }
        } else {
          const cid = task.pendingCardId;
          task.pendingCardId = undefined;
          this.completeAttackCharge(task.sourceCardId ?? '', cid, task.chargeIndex);
        }
        if (task.remaining <= 0) {
          queue.shift();
          if (queue.length === 0) this.state.pendingChargeQueue = undefined;
        }
        continue;
      }

      if (task.remaining > 0) {
        progressed = true;
        task.remaining -= 1;
        task.chargeIndex += 1;
        if (task.kind === 'DIRECT_DAMAGE') {
          const cardId = this.revealTopForCharge(task.playerId, 'DAMAGE', task.sourceCardId);
          if (this.isFinished()) {
            this.state.pendingChargeQueue = undefined;
            break;
          }
          task.pendingCardId = cardId ?? '';
          if ((this.state.currentPendingChoice as unknown)) {
            break;
          }
          continue;
        } else {
          const cardId = this.revealTopForCharge(task.playerId, 'ATTACK', task.sourceCardId);
          if (!cardId) {
            task.remaining = 0;
            queue.shift();
            if (queue.length === 0) this.state.pendingChargeQueue = undefined;
            continue;
          }
          task.pendingCardId = cardId;
          if ((this.state.currentPendingChoice as unknown)) {
            break;
          }
          continue;
        }
      }

      queue.shift();
      if (queue.length === 0) this.state.pendingChargeQueue = undefined;
    }
    return progressed;
  }

  /**
   * 4.12.2 依次执行攻击充能 (支持翻出交互【充能自】时挂起保留在 PROCESSING，待选择完再归位)
   */
  performAttackCharge(attackerCardId: string, chargeCount: number = 1): void {
    const attacker = this.state.cards[attackerCardId];
    if (!attacker || chargeCount <= 0) return;
    this.state.pendingChargeQueue ??= [];
    this.state.pendingChargeQueue.push({
      kind: 'ATTACK_CHARGE',
      playerId: attacker.controllerPlayerId,
      sourceCardId: attackerCardId,
      remaining: chargeCount,
      chargeIndex: 0,
    });
    this.drainPendingCharges();
  }

  /**
   * 4.10 伤害处理：依次执行与伤害量相同次数的伤害充能，每次完毕侵蚀计数 +1
   * (支持翻出交互【充能自】10.2.1.b 与多置换选序挂起；8.5.3 效果途中可传 deferCheckTiming 延后检查时机)
   */
  applyDamageToPlayer(
    defenderPlayerId: string,
    damageAmount: number,
    sourceCardId?: string,
    options?: { appliedReplacementIds?: Set<string>; preferredReplacementId?: string; deferCheckTiming?: boolean }
  ): void {
    if (!this.state.players[defenderPlayerId] || damageAmount <= 0 || this.isFinished()) return;
    let effectiveDamage = damageAmount;
    if (this.replacementEngine) {
      const res = this.replacementEngine.interceptDealDamageDetailed(
        defenderPlayerId,
        damageAmount,
        sourceCardId,
        options?.appliedReplacementIds,
        { preferredReplacementId: options?.preferredReplacementId, applyMode: 'DIRECT_DAMAGE' }
      );
      if (res.pendingChoice) return;
      effectiveDamage = res.amount;
    }
    if (effectiveDamage <= 0) return;
    this.state.pendingChargeQueue ??= [];
    this.state.pendingChargeQueue.push({
      kind: 'DIRECT_DAMAGE',
      playerId: defenderPlayerId,
      sourceCardId,
      remaining: effectiveDamage,
      chargeIndex: 0,
      deferCheckTiming: options?.deferCheckTiming,
    });
    this.drainPendingCharges();
  }

  /**
   * 6.4.1.b.5 / 4.16.2 消除自身信号球区中相邻、等效总数为 3 的信号球，若如此做，抽1张牌。
   * - 支持「视为信号球」(如 BP04-032 炽能球) 与等效多球 (如 Q&A·1 BP01-037 万世铭 1 张视为 3 球)
   * - 支持禁止消除 (1.3.3，如 BP02-066 万事·明晰梦)
   * - 不持有且未视为信号球标记的牌、背面信号球不能被消除 (4.16.2 / Q&A·4 / Q&A·6)
   */
  eliminateThreeOrbs(
    playerId: string,
    orbCardInstanceIds: string[]
  ): { success: boolean; error?: string } {
    const requiredCount = RULE_CONSTANTS.ORB_ELIMINATION_REQUIRED_COUNT;
    if (
      !Array.isArray(orbCardInstanceIds) ||
      orbCardInstanceIds.length === 0 ||
      new Set(orbCardInstanceIds).size !== orbCardInstanceIds.length
    ) {
      return { success: false, error: `需要选择等效数量为 ${requiredCount} 的不同信号球` };
    }

    const orbIds = this.getCardsInZone(playerId, 'SIGNAL_ORB').map((c) => c.instanceId);
    const positions = orbCardInstanceIds.map((id) => orbIds.indexOf(id)).sort((a, b) => a - b);
    if (positions.some((p) => p === -1)) {
      return { success: false, error: '所选卡牌不在自身信号球区' };
    }

    const orbValues: number[] = [];
    const resolvedColors = new Map<string, string>();
    for (const id of orbCardInstanceIds) {
      const card = this.state.cards[id]!;
      if (this.continuousEffects) {
        const info = this.continuousEffects.getEffectiveOrbInfo(id);
        if (!info.isOrb) {
          return { success: false, error: '只能消除持有或视为信号球标记的正面卡牌 (4.16.2)' };
        }
        if (info.cannotEliminate) {
          return { success: false, error: '所选信号球因效果当前不能被消除 (1.3.3)' };
        }
        orbValues.push(info.orbValue);
        resolvedColors.set(id, info.colors[0] ?? 'UNKNOWN');
      } else {
        const def = this.cardDb.getCard(card.cardNumber) || (card.cardId ? this.cardDb.getCard(card.cardId) : undefined);
        if (!card.isFaceUp || !def?.signalOrb) {
          return { success: false, error: '只能消除持有信号球标记的卡牌 (4.16.2)' };
        }
        orbValues.push(1);
        resolvedColors.set(id, def.signalOrb);
      }
    }

    // Q&A·1 (BP01-037)：等效数量必须精确等于 3，不可将 1 张视为 3 球的卡拆成 2 球使用或超额凑数
    if (!canMatchOrbCount(orbValues, requiredCount)) {
      return { success: false, error: `所选信号球等效数量必须为 ${requiredCount}` };
    }

    const isAdjacent = positions.every((p, i) => i === 0 || p === positions[i - 1]! + 1);
    if (!isAdjacent) {
      return { success: false, error: '所选信号球在信号球区中并不相邻 (4.16.2)' };
    }

    // 按信号球区中的顺序放置到墓地 (4.16.2.b 剩余信号球顺序不变)
    const sortedIds = positions.map((p) => orbIds[p]!);
    const orbColors = sortedIds.map((id) => resolvedColors.get(id) ?? 'UNKNOWN');
    for (const orbId of sortedIds) {
      this.moveCard(orbId, 'GRAVEYARD', { isFaceUp: true });
    }

    this.drawCards(playerId, RULE_CONSTANTS.ORB_ELIMINATION_DRAW_COUNT);

    if (this.state.players[playerId]) {
      this.state.players[playerId]!.eliminatedThreeOrbsThisTurn = true;
    }

    this.events.push({
      type: 'ORBS_ELIMINATED',
      playerId,
      orbCardIds: sortedIds,
      cardDrawnCount: RULE_CONSTANTS.ORB_ELIMINATION_DRAW_COUNT,
    });
    this.onTriggerEventCallback?.({
      type: 'ORBS_ELIMINATED',
      playerId,
      orbCardIds: sortedIds,
      orbColors,
    });

    return { success: true };
  }
}
