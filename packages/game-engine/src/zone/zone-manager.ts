import {
  GameState,
  CardInstance,
  ZoneId,
  GameEvent,
} from '@zhanshuang/shared';
import { RULE_CONSTANTS } from '@zhanshuang/game-rules';
import { SeedRng } from '../rng/seed-rng.js';
import { ICardDatabase } from '../database/card-registry.js';

export class ZoneManager {
  private onChargeAutoEffectCallback?: (playerId: string, cardInstanceId: string, cardDef: any) => void;

  constructor(
    private state: GameState,
    private rng: SeedRng,
    private cardDb: ICardDatabase,
    private events: GameEvent[]
  ) {}

  setChargeAutoHandler(handler: (playerId: string, cardInstanceId: string, cardDef: any) => void): void {
    this.onChargeAutoEffectCallback = handler;
  }

  /**
   * 移动卡牌到指定区域 (3.1.4 新卡牌原则)
   */
  moveCard(
    cardInstanceId: string,
    toZone: ZoneId,
    options?: {
      slotIndex?: number;
      isFaceUp?: boolean;
      isReady?: boolean;
    }
  ): void {
    const card = this.state.cards[cardInstanceId];
    if (!card) return;

    const fromZone = card.zone;
    const fromSlot = card.slotIndex;

    // 9.6 战场卡位上的卡牌离开战场：清空卡位，其下方的卡牌 (升变对象、装备等) 因规则放置到墓地
    if (fromZone === 'BATTLEFIELD' && toZone !== 'BATTLEFIELD') {
      this.detachFromBattlefield(card);
    }

    card.zone = toZone;

    // 区域内顺序以 state.cards 的键顺序表示：新放置的卡牌排在最后，即该区域的「最上方」
    // (墓地 3.5.2、信号球区 3.7.2、处理区 3.8.2；牌组中最后一张为牌组底)
    delete this.state.cards[cardInstanceId];
    this.state.cards[cardInstanceId] = card;

    // 3.1.4 移动到其他区域的卡牌视为新卡牌，原区域适用的效果与状态不延续
    if (fromZone !== toZone) {
      card.tempPPBonus = undefined;
      card.tempDPBonus = undefined;
      card.grantedKeywords = undefined;
      card.underneathCardIds = [];
      card.attachedEquipmentId = undefined;
      if (toZone !== 'BATTLEFIELD') card.slotIndex = undefined;
      // 10.1.2.a 回合次数限制只对同一区域中的同一张卡牌计数
      delete this.state.players[card.controllerPlayerId]?.turnAbilityUsage[cardInstanceId];
    }

    if (options?.slotIndex !== undefined) card.slotIndex = options.slotIndex;
    if (options?.isFaceUp !== undefined) card.isFaceUp = options.isFaceUp;
    if (options?.isReady !== undefined) card.isReady = options.isReady;
    card.turnEnteredZone = this.state.turnNumber;

    if (fromZone === 'COST' || toZone === 'COST') {
      this.syncCostStats(card.controllerPlayerId);
    }

    this.events.push({
      type: 'CARD_MOVED',
      cardInstanceId,
      fromZone,
      toZone,
      fromSlot,
      toSlot: options?.slotIndex,
      isFaceUp: card.isFaceUp,
      isReady: card.isReady,
    });
  }

  /**
   * 卡牌离开战场时解除其与卡位、上下方卡牌的关系 (9.6 无所属卡牌的卡牌处理，中断型规则处理)
   */
  private detachFromBattlefield(card: CardInstance): void {
    const playerId = card.controllerPlayerId;
    for (const slot of this.state.battlefields[playerId] ?? []) {
      if (slot.roleCardId === card.instanceId) slot.roleCardId = undefined;
      if (slot.assistCardId === card.instanceId) slot.assistCardId = undefined;
      if (slot.standaloneEquipmentId === card.instanceId) slot.standaloneEquipmentId = undefined;
    }

    // 若该卡牌本身是其他卡牌的装备或下方的牌，解除关系
    for (const other of Object.values(this.state.cards)) {
      if (other.attachedEquipmentId === card.instanceId) other.attachedEquipmentId = undefined;
      if (other.underneathCardIds?.includes(card.instanceId)) {
        other.underneathCardIds = other.underneathCardIds.filter((id) => id !== card.instanceId);
      }
    }

    const orphanIds = [...(card.underneathCardIds ?? [])];
    if (card.attachedEquipmentId) orphanIds.push(card.attachedEquipmentId);
    card.underneathCardIds = [];
    card.attachedEquipmentId = undefined;
    for (const orphanId of orphanIds) {
      const orphan = this.state.cards[orphanId];
      if (orphan && orphan.zone === 'BATTLEFIELD') {
        this.moveCard(orphanId, 'GRAVEYARD', { isFaceUp: true });
      }
    }
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
   * 4.12.2 攻击充能处理
   * 将牌组顶卡牌翻开至处理区，相关能力处理完毕后：
   * - 若为信号球牌，放置到信号球区最上方 (4.12.2.a)
   * - 若不为信号球牌，加入手牌 (4.12.2.b)
   */
  performAttackCharge(attackerCardId: string, chargeCount: number = 1): void {
    const attacker = this.state.cards[attackerCardId];
    if (!attacker) return;
    const playerId = attacker.controllerPlayerId;

    for (let i = 0; i < chargeCount; i++) {
      if (!this.refreshDeckIfEmpty(playerId)) break;
      const topCard = this.getCardsInZone(playerId, 'DECK')[0]!;
      // 临时翻开到处理区 (3.8.1.b)
      this.moveCard(topCard.instanceId, 'PROCESSING', { isFaceUp: true });

      const cardDef = this.cardDb.getCard(topCard.cardNumber) || (topCard.cardId ? this.cardDb.getCard(topCard.cardId) : undefined);
      const isSignalOrb = !!cardDef?.signalOrb;

      if (isSignalOrb) {
        // 10.2.1.b 充能时自动能力在充能过程中处理
        if (cardDef && cardDef.rulesText.includes('充能自')) {
          this.onChargeAutoEffectCallback?.(playerId, topCard.instanceId, cardDef);
        }
        // 4.12.2.a 放置到信号球区最上方 (3.7)
        this.moveCard(topCard.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
        this.events.push({
          type: 'ATTACK_CHARGE_PERFORMED',
          attackerCardId,
          chargeIndex: i + 1,
          revealedCardId: topCard.instanceId,
          resultDestination: 'SIGNAL_ORB',
        });
      } else {
        // 4.12.2.b 加入手牌
        this.moveCard(topCard.instanceId, 'HAND', { isFaceUp: true });
        this.events.push({
          type: 'ATTACK_CHARGE_PERFORMED',
          attackerCardId,
          chargeIndex: i + 1,
          revealedCardId: topCard.instanceId,
          resultDestination: 'HAND',
        });
      }
    }
  }

  /**
   * 4.10 伤害处理 & 4.12.3 伤害充能
   * 承受伤害的玩家根据伤害量依次执行等量伤害充能：
   * - 翻开至处理区并执行其<充能自>效果，之后以背面竖直状态放置到费用区成为暗费 (4.12.3.a)
   * - 每次伤害充能完毕后，承受伤害玩家侵蚀计数+1 (4.10.1.b)
   */
  applyDamageToPlayer(defenderPlayerId: string, damageAmount: number): void {
    const player = this.state.players[defenderPlayerId];
    if (!player || damageAmount <= 0) return;

    for (let i = 0; i < damageAmount; i++) {
      if (this.state.status === 'FINISHED') return;
      if (this.refreshDeckIfEmpty(defenderPlayerId)) {
        const topCard = this.getCardsInZone(defenderPlayerId, 'DECK')[0]!;
        // 翻开至处理区
        this.moveCard(topCard.instanceId, 'PROCESSING', { isFaceUp: true });

        const cardDef = this.cardDb.getCard(topCard.cardNumber) || (topCard.cardId ? this.cardDb.getCard(topCard.cardId) : undefined);
        // 执行其<充能自>效果
        if (cardDef && cardDef.signalOrb && cardDef.rulesText.includes('充能自')) {
          this.onChargeAutoEffectCallback?.(defenderPlayerId, topCard.instanceId, cardDef);
        }

        // 3.6.4 费用区达到上限时，原本放置到费用区的卡牌改为放置到墓地
        if (player.totalCostCount >= RULE_CONSTANTS.MAX_COST_ZONE_CAPACITY) {
          this.moveCard(topCard.instanceId, 'GRAVEYARD', { isFaceUp: true });
          this.events.push({
            type: 'DAMAGE_CHARGE_PERFORMED',
            defenderPlayerId,
            revealedCardId: topCard.instanceId,
            placedToCostFaceDown: false,
          });
        } else {
          // 4.12.3.a 以背面竖直状态放置到费用区成为暗费
          this.moveCard(topCard.instanceId, 'COST', { isFaceUp: false, isReady: true });
          this.events.push({
            type: 'DAMAGE_CHARGE_PERFORMED',
            defenderPlayerId,
            revealedCardId: topCard.instanceId,
            placedToCostFaceDown: true,
          });
        }
      }

      // 4.10.1.b 每次伤害充能执行完毕后，将承受伤害的玩家的侵蚀计数+1
      const oldErosion = player.erosionCount;
      player.erosionCount += 1;
      this.events.push({
        type: 'EROSION_INCREASED',
        playerId: defenderPlayerId,
        previousValue: oldErosion,
        newValue: player.erosionCount,
        reason: 'DAMAGE',
      });
    }
  }

  /**
   * 6.4.1.b.5 / 4.16.2 消除自身信号球区中任意3张相邻的信号球牌，若如此做，抽1张牌。
   * 只要求在信号球区中相邻 (不要求同色)；不持有信号球标记的牌不能被消除 (Q&A 第4期)。
   */
  eliminateThreeOrbs(
    playerId: string,
    orbCardInstanceIds: string[]
  ): { success: boolean; error?: string } {
    const requiredCount = RULE_CONSTANTS.ORB_ELIMINATION_REQUIRED_COUNT;
    if (
      !Array.isArray(orbCardInstanceIds) ||
      orbCardInstanceIds.length !== requiredCount ||
      new Set(orbCardInstanceIds).size !== requiredCount
    ) {
      return { success: false, error: `需要选择 ${requiredCount} 张不同的信号球` };
    }

    const orbIds = this.getCardsInZone(playerId, 'SIGNAL_ORB').map((c) => c.instanceId);
    const positions = orbCardInstanceIds.map((id) => orbIds.indexOf(id)).sort((a, b) => a - b);
    if (positions.some((p) => p === -1)) {
      return { success: false, error: '所选卡牌不在自身信号球区' };
    }

    for (const id of orbCardInstanceIds) {
      const card = this.state.cards[id]!;
      const def = this.cardDb.getCard(card.cardNumber) || (card.cardId ? this.cardDb.getCard(card.cardId) : undefined);
      if (!card.isFaceUp || !def?.signalOrb) {
        return { success: false, error: '只能消除持有信号球标记的卡牌 (4.16.2)' };
      }
    }

    const isAdjacent = positions.every((p, i) => i === 0 || p === positions[i - 1]! + 1);
    if (!isAdjacent) {
      return { success: false, error: '所选信号球在信号球区中并不相邻 (4.16.2)' };
    }

    // 按信号球区中的顺序放置到墓地 (4.16.2.b 剩余信号球顺序不变)
    const sortedIds = positions.map((p) => orbIds[p]!);
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

    return { success: true };
  }
}
