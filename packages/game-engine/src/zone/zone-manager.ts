import {
  GameState,
  CardInstance,
  ZoneId,
  GameEvent,
  SignalOrbType,
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
    card.zone = toZone;
    if (options?.slotIndex !== undefined) card.slotIndex = options.slotIndex;
    if (options?.isFaceUp !== undefined) card.isFaceUp = options.isFaceUp;
    if (options?.isReady !== undefined) card.isReady = options.isReady;
    card.turnEnteredZone = this.state.turnNumber;

    this.events.push({
      type: 'CARD_MOVED',
      cardInstanceId,
      fromZone,
      toZone,
      fromSlot: card.slotIndex,
      toSlot: options?.slotIndex,
      isFaceUp: card.isFaceUp,
      isReady: card.isReady,
    });
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

    player.openCostCount = (player.openCostCount || 0) + placedCards.length;
    player.availableOpenCostCount = (player.availableOpenCostCount || 0) + placedCards.length;
    player.totalCostCount = (player.totalCostCount || 0) + placedCards.length;

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
   * 抽牌 (4.7 抽牌 & 3.3.3 & 9.2 牌组更新处理)
   */
  drawCards(playerId: string, count: number): string[] {
    const drawnIds: string[] = [];
    const player = this.state.players[playerId];
    if (!player) return drawnIds;

    for (let i = 0; i < count; i++) {
      let deckCards = this.getCardsInZone(playerId, 'DECK');

      // 9.2.1 牌组更新处理 (中断型规则处理)
      if (deckCards.length === 0) {
        const graveyardCards = this.getCardsInZone(playerId, 'GRAVEYARD');
        if (graveyardCards.length === 0) {
          // 9.2.2.a 牌组与墓地均没有卡牌，立即败北
          player.erosionCount = RULE_CONSTANTS.EROSION_LOSS_THRESHOLD;
          this.state.winnerId =
            this.state.activePlayerId === playerId
              ? this.state.nonActivePlayerId
              : this.state.activePlayerId;
          this.state.status = 'FINISHED';
          this.state.finishReason = 'DECK_AND_GRAVEYARD_EMPTY';
          this.events.push({
            type: 'GAME_OVER',
            winnerPlayerId: this.state.winnerId,
            isDraw: false,
            reason: '牌组与墓地均耗尽败北 (1.2.2.b & 9.3.1.b)',
          });
          break;
        }

        // 9.2.2 将墓地所有卡牌移动到牌组并洗切
        const gyCardIds = graveyardCards.map((c) => c.instanceId);
        for (const cid of gyCardIds) {
          this.moveCard(cid, 'DECK', { isFaceUp: false, isReady: true });
        }
        this.rng.shuffle(gyCardIds);

        // 侵蚀计数+1
        const oldErosion = player.erosionCount;
        player.erosionCount += 1;
        this.events.push({
          type: 'DECK_REFRESHED',
          playerId,
          cardsShuffledCount: gyCardIds.length,
          newErosionCount: player.erosionCount,
        });
        this.events.push({
          type: 'EROSION_INCREASED',
          playerId,
          previousValue: oldErosion,
          newValue: player.erosionCount,
          reason: 'DECK_REFRESH',
        });

        // 刷新当前牌组
        deckCards = this.getCardsInZone(playerId, 'DECK');
      }

      if (deckCards.length > 0) {
        const topCard = deckCards[0]!;
        this.moveCard(topCard.instanceId, 'HAND', { isFaceUp: true });
        drawnIds.push(topCard.instanceId);
      }
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
   * 将牌组顶卡牌翻开至处理区：
   * - 若为信号球牌，处理完毕后放置到信号球区最上方 (4.12.2.a)
   * - 若不为信号球牌，处理完毕后将该卡牌加入手牌 (4.12.2.b)
   */
  performAttackCharge(attackerCardId: string, chargeCount: number = 1): void {
    const attacker = this.state.cards[attackerCardId];
    if (!attacker) return;
    const playerId = attacker.controllerPlayerId;

    for (let i = 0; i < chargeCount; i++) {
      const deckCards = this.getCardsInZone(playerId, 'DECK');
      if (deckCards.length === 0) {
        this.drawCards(playerId, 0); // 触发潜在的牌组更新
      }
      const currentDeck = this.getCardsInZone(playerId, 'DECK');
      if (currentDeck.length === 0) break;

      const topCard = currentDeck[0]!;
      // 临时翻开到处理区 (3.8)
      this.moveCard(topCard.instanceId, 'PROCESSING', { isFaceUp: true });

      const cardDef = this.cardDb.getCard(topCard.cardNumber) || (topCard.cardId ? this.cardDb.getCard(topCard.cardId) : undefined);
      const isSignalOrb = !!cardDef?.signalOrb;

      if (isSignalOrb) {
        // 4.12.2.a 放置到信号球区最上方 (3.7)
        this.moveCard(topCard.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
        this.events.push({
          type: 'ATTACK_CHARGE_PERFORMED',
          attackerCardId,
          chargeIndex: i + 1,
          revealedCardId: topCard.instanceId,
          resultDestination: 'SIGNAL_ORB',
        });
        // 信号球牌执行其 <充能自> 效果
        if (cardDef && (cardDef.rulesText.includes('【充能自】') || cardDef.rulesText.includes('充能自'))) {
          this.onChargeAutoEffectCallback?.(playerId, topCard.instanceId, cardDef);
        }
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
      const deckCards = this.getCardsInZone(defenderPlayerId, 'DECK');
      if (deckCards.length === 0) {
        this.drawCards(defenderPlayerId, 0); // 触发潜在牌组更新
      }
      const currentDeck = this.getCardsInZone(defenderPlayerId, 'DECK');
      if (currentDeck.length > 0) {
        const topCard = currentDeck[0]!;
        // 翻开至处理区
        this.moveCard(topCard.instanceId, 'PROCESSING', { isFaceUp: true });

        const cardDef = this.cardDb.getCard(topCard.cardNumber) || (topCard.cardId ? this.cardDb.getCard(topCard.cardId) : undefined);
        // 执行其<充能自>效果
        if (cardDef && (cardDef.rulesText.includes('【充能自】') || cardDef.rulesText.includes('充能自'))) {
          this.onChargeAutoEffectCallback?.(defenderPlayerId, topCard.instanceId, cardDef);
        }

        // 3.6.4 费用区达到上限10张时，原本放置到费用区的卡牌改为放置到墓地
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
          player.hiddenCostCount += 1;
          player.totalCostCount += 1;
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
   * 6.4.1.b.5 消除自身信号球区中任意3张相邻的信号球牌，抽1张牌
   */
  eliminateThreeOrbs(
    playerId: string,
    orbCardInstanceIds: [string, string, string]
  ): boolean {
    const orbCards = this.getCardsInZone(playerId, 'SIGNAL_ORB');
    const orbIds = orbCards.map((c) => c.instanceId);

    // 容错排序：无论前端传递顺序为何，按信号球在区域中的物理索引排序
    const sortedIds = [...orbCardInstanceIds].sort(
      (a, b) => orbIds.indexOf(a) - orbIds.indexOf(b)
    );
    const idx0 = orbIds.indexOf(sortedIds[0]!);
    const idx1 = orbIds.indexOf(sortedIds[1]!);
    const idx2 = orbIds.indexOf(sortedIds[2]!);

    if (idx0 === -1 || idx1 === -1 || idx2 === -1) {
      return false;
    }

    const isAdjacent = idx1 === idx0 + 1 && idx2 === idx1 + 1;

    // 容错检测同色三消 (如三颗红球，即使由于间隔亦可三消抽卡)
    const getOrbColor = (id: string) => {
      const card = this.state.cards[id];
      if (!card) return null;
      const def =
        (card.cardId ? this.cardDb.getCard(card.cardId) : undefined) ||
        this.cardDb.getCard(card.cardNumber);
      const num = (card.cardNumber || '').toUpperCase();
      const traits = def?.traits || [];
      const name = def?.name || '';
      const orbType = def?.signalOrb;

      // 1. 优先使用权威卡牌定义中的 signalOrb
      if (orbType === SignalOrbType.RED) return 'RED';
      if (orbType === SignalOrbType.BLUE) return 'BLUE';
      if (orbType === SignalOrbType.YELLOW) return 'YELLOW';

      // 2. 依据精准特征/编号/卡名回退判断
      if (
        traits.some((t) => t === '信号球·红' || t.includes('球·红')) ||
        num.includes('ORB-RED') ||
        num.endsWith('-RED') ||
        name.includes('信号球·红') ||
        name.includes('红球')
      )
        return 'RED';

      if (
        traits.some((t) => t === '信号球·蓝' || t.includes('球·蓝')) ||
        num.includes('ORB-BLUE') ||
        num.endsWith('-BLUE') ||
        name.includes('信号球·蓝') ||
        name.includes('蓝球')
      )
        return 'BLUE';

      if (
        traits.some((t) => t === '信号球·黄' || t.includes('球·黄')) ||
        num.includes('ORB-YELLOW') ||
        num.endsWith('-YELLOW') ||
        name.includes('信号球·黄') ||
        name.includes('黄球')
      )
        return 'YELLOW';

      return null;
    };

    const c0 = getOrbColor(sortedIds[0]!);
    const c1 = getOrbColor(sortedIds[1]!);
    const c2 = getOrbColor(sortedIds[2]!);
    const isSameColor = !!(c0 && c0 === c1 && c1 === c2);

    // 检查是否满足：物理连续相邻 (4.16.2.a) 或 相同颜色三消
    if (!isAdjacent && !isSameColor) {
      return false; // 非相邻且非同色信号球
    }

    // 将3张球放置到墓地 (4.16.2)
    for (const orbId of sortedIds) {
      this.moveCard(orbId, 'GRAVEYARD', { isFaceUp: true });
    }

    // 抽1张牌 (6.4.1.b.5 若如此做，抽1张牌)
    this.drawCards(playerId, RULE_CONSTANTS.ORB_ELIMINATION_DRAW_COUNT);

    this.events.push({
      type: 'ORBS_ELIMINATED',
      playerId,
      orbCardIds: [sortedIds[0]!, sortedIds[1]!, sortedIds[2]!],
      cardDrawnCount: RULE_CONSTANTS.ORB_ELIMINATION_DRAW_COUNT,
    });

    return true;
  }
}
