import {
  GameState,
  PlayerState,
  CardInstance,
  BattlefieldSlot,
  ZoneId,
  GameEvent,
} from '@zhanshuang/shared';
import { RULE_CONSTANTS } from '@zhanshuang/game-rules';
import { SeedRng } from '../rng/seed-rng.js';
import { ICardDatabase } from '../database/card-registry.js';

export interface PlayerInitConfig {
  playerId: string;
  deckCardNumbers: string[]; // 必须恰好50张
  deckCardImageUrls?: string[]; // 对应每张牌自选的卡图URL / 异画立绘
}

export interface CreateGameOptions {
  skipMulligan?: boolean;
}

export interface InitGameResult {
  state: GameState;
  events: GameEvent[];
  /** 初始化消耗随机数后的随机数生成器状态，引擎需从此状态继续，避免与开局洗牌复用同一段随机序列 */
  rngState: number;
}

/**
 * 依据 5.2 游戏前准备步骤 初始化对局
 */
export function createInitialGameState(
  gameId: string,
  player1: PlayerInitConfig,
  player2: PlayerInitConfig,
  seed: number,
  cardDb: ICardDatabase,
  options?: CreateGameOptions
): InitGameResult {
  const skipMulligan = options?.skipMulligan ?? false;
  const rng = new SeedRng(seed);
  const events: GameEvent[] = [];

  // 1. 5.2.1.c 随机决定先攻玩家
  const firstPlayerIndex = rng.nextInt(0, 1);
  const firstPlayerId = firstPlayerIndex === 0 ? player1.playerId : player2.playerId;
  const secondPlayerId = firstPlayerIndex === 0 ? player2.playerId : player1.playerId;

  const playerConfigs = [
    { config: player1, seat: 0 as const, isFirst: player1.playerId === firstPlayerId },
    { config: player2, seat: 1 as const, isFirst: player2.playerId === firstPlayerId },
  ];

  const players: Record<string, PlayerState> = {};
  const battlefields: Record<string, BattlefieldSlot[]> = {};
  const cards: Record<string, CardInstance> = {};

  // 卡牌实例 ID 随机编号：若按卡组列表顺序编号，对手可依据公开的卡表与事件中的 ID 推算出抽到的是哪张牌
  const totalCards = player1.deckCardNumbers.length + player2.deckCardNumbers.length;
  const instanceIdPool = rng.shuffle(Array.from({ length: totalCards }, (_, i) => i + 1));
  let cardInstanceCounter = 0;

  for (const p of playerConfigs) {
    // 5.2.1.d 侵蚀计数设置到 0
    players[p.config.playerId] = {
      playerId: p.config.playerId,
      seatOrder: p.seat,
      isFirstPlayer: p.isFirst,
      erosionCount: 0,
      hasMulliganed: skipMulligan,
      surrendered: false,
      totalCostCount: 0,
      openCostCount: 0,
      availableOpenCostCount: 0,
      exhaustedOpenCostCount: 0,
      hiddenCostCount: 0,
      turnAbilityUsage: {},
      gameAbilityUsage: {},
      costModifiers: [],
    };

    // 3.2.3 设有五个战场卡位
    battlefields[p.config.playerId] = Array.from(
      { length: RULE_CONSTANTS.BATTLEFIELD_SLOTS_PER_PLAYER },
      (_, i) => ({ slotIndex: i })
    );

    // 构建初始牌组卡牌实例
    const initialDeckCardIds: string[] = [];
    let cardIdx = 0;
    for (const cardNumber of p.config.deckCardNumbers) {
      const instanceId = `card-${instanceIdPool[cardInstanceCounter]}`;
      cardInstanceCounter++;
      const cardDef = cardDb.getCard(cardNumber);
      const cardId = cardDef?.id ?? cardNumber;
      const customImg = p.config.deckCardImageUrls?.[cardIdx];
      cardIdx++;

      cards[instanceId] = {
        instanceId,
        cardId,
        cardNumber,
        ownerPlayerId: p.config.playerId,
        controllerPlayerId: p.config.playerId,
        zone: 'DECK' as ZoneId,
        underneathCardIds: [],
        isFaceUp: false,
        isReady: true,
        turnEnteredZone: 0,
        imageUrl: customImg || cardDef?.imageUrl || `/cards/${cardNumber}.png`,
      };
      initialDeckCardIds.push(instanceId);
    }

    // 5.2.1.b 充分洗切牌组
    const shuffledDeck = rng.shuffle(initialDeckCardIds);

    // 5.2.1.e 抽取4张卡牌作为起始手牌
    const startingHand = shuffledDeck.splice(0, RULE_CONSTANTS.INITIAL_HAND_SIZE);
    for (const cardId of startingHand) {
      const card = cards[cardId]!;
      card.zone = 'HAND';
      card.isFaceUp = true;
    }

    const pState = players[p.config.playerId]!;
    if (skipMulligan) {
      // 5.2.1.f 牌组顶2张牌以正面竖直状态放置到费用区作为起始明费 (跳过调度阶段时直接填充)
      const initialCosts = shuffledDeck.splice(0, RULE_CONSTANTS.INITIAL_OPEN_COSTS);
      for (const cardId of initialCosts) {
        const card = cards[cardId]!;
        card.zone = 'COST';
        card.isFaceUp = true; // 正面
        card.isReady = true; // 竖直
      }

      // 更新费用统计
      pState.openCostCount = initialCosts.length;
      pState.availableOpenCostCount = initialCosts.length;
      pState.totalCostCount = initialCosts.length;
    } else {
      // 依规则 5.2.1.e & 5.2.1.f：开局调度阶段费用区为0，牌组包含全部46张卡牌供调度与洗切，双方调度完毕后再行填充
      pState.openCostCount = 0;
      pState.availableOpenCostCount = 0;
      pState.totalCostCount = 0;
    }

    // 关键修复：将剩余在 DECK 中的卡牌严格按照 shuffledDeck 的顺序重新插入 cards 字典
    // 确保 getCardsInZone('DECK') 遍历时 100% 遵循洗牌后的随机物理顺序
    for (const cardId of shuffledDeck) {
      const card = cards[cardId]!;
      delete cards[cardId];
      cards[cardId] = card;
    }

    events.push({
      type: 'DECK_REFRESHED',
      playerId: p.config.playerId,
      cardsShuffledCount: shuffledDeck.length,
      newErosionCount: 0,
    });
  }

  events.push({
    type: 'GAME_STARTED',
    firstPlayerId,
    seed,
  });

  const state: GameState = {
    gameId,
    rngSeed: seed,
    createdAt: Date.now(),
    status: 'PLAYING',
    turnNumber: 1,
    activePlayerId: firstPlayerId,
    nonActivePlayerId: secondPlayerId,
    phase: skipMulligan ? 'STAND_PHASE' : 'MULLIGAN_PHASE', // 5.2.1.e 开局手牌调度阶段或直接进入竖直阶段
    priorityPlayerId: firstPlayerId,
    players,
    cards,
    battlefields,
    pendingTriggers: [],
    isDraw: false,
  };

  return { state, events, rngState: rng.getSeed() };
}
