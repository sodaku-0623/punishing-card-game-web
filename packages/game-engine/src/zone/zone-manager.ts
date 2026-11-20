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
import type { TriggerEvent } from '../priority/trigger-system.js';

export class ZoneManager {
  private onChargeAutoEffectCallback?: (
    playerId: string,
    cardInstanceId: string,
    cardDef: any,
    chargeKind: 'ATTACK' | 'DAMAGE',
    attackerCardId?: string
  ) => void;
  private onTriggerEventCallback?: (event: TriggerEvent) => void;
  private snapshotProvider?: (cardInstanceId: string) => TriggerEvent['subjectSnapshot'];
  private continuousEffects?: ContinuousEffectEngine;
  private replacementEngine?: ReplacementEngine;

  constructor(
    private state: GameState,
    private rng: SeedRng,
    private cardDb: ICardDatabase,
    private events: GameEvent[]
  ) {}

  setContinuousEffectEngine(engine: ContinuousEffectEngine): void {
    this.continuousEffects = engine;
  }

  setReplacementEngine(engine: ReplacementEngine): void {
    this.replacementEngine = engine;
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
   * 返回 true 表示完成了移动，false 表示移动被置换效果阻止或卡牌不存在。
   */
  moveCard(
    cardInstanceId: string,
    toZone: ZoneId,
    options?: {
      slotIndex?: number;
      isFaceUp?: boolean;
      isReady?: boolean;
      toBottom?: boolean;
      isOrphanCleanup?: boolean;
      orphanHostCardId?: string;
      appliedReplacementIds?: Set<string>;
      preserveAttachments?: boolean;
      skipLeftFieldTrigger?: boolean;
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

    // 8.2.1.c / 8.10 在跨区域移动即将发生前拦截置换效果
    if (fromZone !== toZone && this.replacementEngine) {
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

    const leftBattlefieldSnapshot =
      fromZone === 'BATTLEFIELD' && effectiveToZone !== 'BATTLEFIELD' && !options?.skipLeftFieldTrigger
        ? this.snapshotProvider?.(cardInstanceId)
        : undefined;

    // 9.6 战场卡位上的卡牌离开战场：先解除卡位与上下方关系并收集无所属卡牌，
    // 宿主自身完成移动后再将无所属卡牌送墓/置换 (Q&A·9 BP04-065 顺序固定：先宿主，再装备)
    // (10.18.2.b / 10.18.2.d.3 浮空保留下方牌与装备时跳过解绑，只释放协战搭档 8.13.4.a.3)
    const orphanInfo =
      fromZone === 'BATTLEFIELD' && effectiveToZone !== 'BATTLEFIELD'
        ? this.detachFromBattlefieldAndCollectOrphans(card, options?.preserveAttachments)
        : { orphanIds: [], partnerId: undefined };

    card.zone = effectiveToZone;

    // 区域内顺序以 state.cards 的键顺序表示：
    // 默认放在末尾 (墓地 3.5.2、信号球区 3.7.2、处理区 3.8.2 的「最上方」；牌组的「最下方」)；
    // 当 toBottom=true 且目标非牌组时，放在对象最前 (信号球区等区域的「最下方」，Q&A·9 BP04-065)
    if (effectiveToBottom && effectiveToZone !== 'DECK') {
      this.placeCardKeyAtFront(cardInstanceId, card);
    } else {
      delete this.state.cards[cardInstanceId];
      this.state.cards[cardInstanceId] = card;
    }

    // 3.1.4 移动到其他区域的卡牌视为新卡牌，原区域适用的效果与状态不延续
    if (fromZone !== effectiveToZone) {
      card.tempPPBonus = undefined;
      card.tempDPBonus = undefined;
      card.grantedKeywords = undefined;
      card.modifiers = undefined;
      card.endOfTurnToGraveyard = undefined;
      card.isFrozen = undefined;
      if (!(card.isAirborne && effectiveToZone === 'PROCESSING')) {
        card.isAirborne = undefined;
      }
      card.effectiveProhibitions = undefined;
      card.effectiveOrbColors = undefined;
      if (!options?.preserveAttachments) {
        card.underneathCardIds = [];
        card.attachedEquipmentId = undefined;
      }
      card.enteredZoneTimestamp = nextEffectTimestamp(this.state);
      this.replacementEngine?.cleanupForCard(cardInstanceId);
      if (effectiveToZone !== 'BATTLEFIELD') card.slotIndex = undefined;
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

    if (options?.slotIndex !== undefined && effectiveToZone === 'BATTLEFIELD') {
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
      toSlot: effectiveToZone === 'BATTLEFIELD' ? options?.slotIndex : undefined,
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
        // 8.13.4.a.1 / 8.13.4.c.4：搭档解除协战状态放置到墓地，不视为离场
        this.moveCard(orphanInfo.partnerId, 'GRAVEYARD', {
          isFaceUp: true,
          isOrphanCleanup: true,
          orphanHostCardId: cardInstanceId,
          skipLeftFieldTrigger: true,
        });
      }
    }

    // 8.7.4.a.2 离开战场触发事件 (携带离场前在战场时的快照情报)
    if (fromZone === 'BATTLEFIELD' && effectiveToZone !== 'BATTLEFIELD' && !options?.skipLeftFieldTrigger) {
      this.onTriggerEventCallback?.({
        type: 'CARD_LEFT_FIELD',
        playerId: card.controllerPlayerId,
        cardInstanceId,
        fromZone,
        toZone: effectiveToZone,
        subjectSnapshot: leftBattlefieldSnapshot,
      });
    }

    return true;
  }

  /** 将卡牌键放到 state.cards 最前 (供牌组顶、信号球区最下方等使用) */
  private placeCardKeyAtFront(cardInstanceId: string, card: CardInstance): void {
    const newCards: Record<string, CardInstance> = {
      [cardInstanceId]: card,
    };
    for (const [k, v] of Object.entries(this.state.cards)) {
      if (k !== cardInstanceId) {
        newCards[k] = v;
      }
    }
    for (const k of Object.keys(this.state.cards)) {
      delete this.state.cards[k];
    }
    Object.assign(this.state.cards, newCards);
  }

  /**
   * 卡牌离开战场时解除其与卡位、上下方卡牌、协战状态的关系，并返回需作为无所属卡牌处理的卡牌 ID (9.6 / 8.13.4.a.3)
   */
  private detachFromBattlefieldAndCollectOrphans(
    card: CardInstance,
    preserveAttachments?: boolean
  ): { orphanIds: string[]; partnerId?: string } {
    const playerId = card.controllerPlayerId;
    for (const slot of this.state.battlefields[playerId] ?? []) {
      if (slot.roleCardId === card.instanceId) slot.roleCardId = undefined;
      if (slot.assistCardId === card.instanceId) slot.assistCardId = undefined;
      if (slot.standaloneEquipmentId === card.instanceId) slot.standaloneEquipmentId = undefined;
    }

    // 若该卡牌本身是其他卡牌的装备、下方牌或协战搭档，解除关系
    for (const other of Object.values(this.state.cards)) {
      if (other.attachedEquipmentId === card.instanceId) other.attachedEquipmentId = undefined;
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

    const orphanIds = [...(card.underneathCardIds ?? [])];
    if (card.attachedEquipmentId) orphanIds.push(card.attachedEquipmentId);
    card.underneathCardIds = [];
    card.attachedEquipmentId = undefined;
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
   * 将卡牌移动到牌组底 (保持物理顺序，放在牌组最末位)
   */
  moveCardToBottomOfDeck(cardInstanceId: string): void {
    const card = this.state.cards[cardInstanceId];
    if (!card) return;

    this.moveCard(cardInstanceId, 'DECK', { isFaceUp: false });
    // 将键移至对象末尾以保证在牌组底（Object.values 遍历顺序最末）
    delete this.state.cards[cardInstanceId];
    this.state.cards[cardInstanceId] = card;
  }

  /**
   * 将卡牌移动到牌组顶 (放置在牌组最前位，遍历顺序第一位)
   */
  moveCardToTopOfDeck(cardInstanceId: string): void {
    const card = this.state.cards[cardInstanceId];
    if (!card) return;

    this.moveCard(cardInstanceId, 'DECK', { isFaceUp: false });
    const newCards: Record<string, CardInstance> = {
      [cardInstanceId]: card,
    };
    for (const [k, v] of Object.entries(this.state.cards)) {
      if (k !== cardInstanceId) {
        newCards[k] = v;
      }
    }
    for (const k of Object.keys(this.state.cards)) {
      delete this.state.cards[k];
    }
    Object.assign(this.state.cards, newCards);
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

    this.events.push({
      type: 'CARDS_SHUFFLED',
      playerId,
      zone: 'DECK',
    });
  }

  /**
   * 获取指定玩家某区域的卡牌列表 (保持物理顺序，零多余对象分配)
   */
  getCardsInZone(playerId: string, zone: ZoneId): CardInstance[] {
    const res: CardInstance[] = [];
    const cards = this.state.cards;
    for (const id in cards) {
      const c = cards[id];
      if (c && c.controllerPlayerId === playerId && c.zone === zone) {
        res.push(c);
      }
    }
    return res;
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
      const toCost = player.totalCostCount < RULE_CONSTANTS.MAX_COST_ZONE_CAPACITY;
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

    const oldErosion = player.erosionCount;
    player.erosionCount += 1;
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

  /**
   * 4.12.2 依次执行攻击充能 (不等待玩家选择的同步版本，供卡牌效果等直接调用)
   */
  performAttackCharge(attackerCardId: string, chargeCount: number = 1): void {
    const attacker = this.state.cards[attackerCardId];
    if (!attacker) return;
    for (let i = 0; i < chargeCount; i++) {
      const cardId = this.revealTopForCharge(attacker.controllerPlayerId, 'ATTACK', attackerCardId);
      if (!cardId) break;
      this.completeAttackCharge(attackerCardId, cardId, i + 1);
    }
  }

  /**
   * 4.10 伤害处理：依次执行与伤害量相同次数的伤害充能，每次完毕侵蚀计数 +1
   * (不等待玩家选择的同步版本，供卡牌效果、贯通等直接调用；经 8.10 置换引擎拦截伤害量)
   */
  applyDamageToPlayer(defenderPlayerId: string, damageAmount: number, sourceCardId?: string): void {
    if (!this.state.players[defenderPlayerId] || damageAmount <= 0) return;
    const effectiveDamage = this.replacementEngine
      ? this.replacementEngine.interceptDealDamage(defenderPlayerId, damageAmount, sourceCardId)
      : damageAmount;
    if (effectiveDamage <= 0) return;
    for (let i = 0; i < effectiveDamage; i++) {
      if (this.isFinished()) return;
      const cardId = this.revealTopForCharge(defenderPlayerId, 'DAMAGE');
      // 牌组与墓地都为空时已立即败北 (9.2.2.a)
      if (this.isFinished()) return;
      this.completeDamageCharge(defenderPlayerId, cardId);
    }
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

    let totalOrbValue = 0;
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
        totalOrbValue += info.orbValue;
        resolvedColors.set(id, info.colors[0] ?? 'UNKNOWN');
      } else {
        const def = this.cardDb.getCard(card.cardNumber) || (card.cardId ? this.cardDb.getCard(card.cardId) : undefined);
        if (!card.isFaceUp || !def?.signalOrb) {
          return { success: false, error: '只能消除持有信号球标记的卡牌 (4.16.2)' };
        }
        totalOrbValue += 1;
        resolvedColors.set(id, def.signalOrb);
      }
    }

    // Q&A·1 (BP01-037)：等效数量必须精确等于 3，不可将 1 张视为 3 球的卡拆成 2 球使用或超额凑数
    if (totalOrbValue !== requiredCount) {
      return { success: false, error: `所选信号球等效数量必须为 ${requiredCount} (当前为 ${totalOrbValue})` };
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
