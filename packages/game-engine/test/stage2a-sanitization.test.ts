import { describe, it, expect } from 'vitest';
import { CardInstance, GameEvent } from '@zhanshuang/shared';
import {
  GameEngine,
  MemoryCardDatabase,
  OFFICIAL_CARDS_DATA,
  sanitizeGameEventsForPlayer,
  sanitizeGameStateForPlayer,
} from '../src/index.js';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import { endTurn, fillCostZone } from './helpers.js';

const db = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);

function expandDeck(code: 'ST01' | 'ST02' | 'ST03', extras: string[] = []): string[] {
  const deckDef = OFFICIAL_STARTER_DECKS.find((d) => d.name.includes(`(${code})`))!;
  const cards: string[] = [];
  for (const item of deckDef.cards) {
    for (let i = 0; i < item.count; i++) cards.push(item.cardNumber);
  }
  for (let i = 0; i < extras.length && i < cards.length; i++) {
    cards[cards.length - 1 - i] = extras[i]!;
  }
  return cards;
}

function createEngine(p1Deck: string[], p2Deck: string[], seed = 20261124): GameEngine {
  const engine = new GameEngine(
    'test-stage2a',
    { playerId: 'p1', deckCardNumbers: p1Deck },
    { playerId: 'p2', deckCardNumbers: p2Deck },
    seed,
    db,
    { skipMulligan: true }
  );
  const chargeIfNeeded = () => {
    const st = engine.getState();
    if (st.phase === 'DRAW_CHARGE_PHASE') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: st.activePlayerId });
    }
  };
  chargeIfNeeded();
  if (engine.getState().activePlayerId !== 'p1') {
    endTurn(engine);
    chargeIfNeeded();
  }
  return engine;
}

function findCards(engine: GameEngine, playerId: string, cardNumber: string): CardInstance[] {
  return Object.values(engine.getState().cards).filter(
    (c) => c.ownerPlayerId === playerId && c.cardNumber === cardNumber
  );
}

describe('Stage 2A (§3.1.1) 隐藏信息全链路脱敏与 PEEK_TOP 私密查看', () => {
  it('1. sanitizeGameEventsForPlayer 脱敏 PRNG 种子、对手抽牌明细、双隐端点移动、私有决策与选项', () => {
    const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();

    const p1DeckCard = engine.zoneMgr.getCardsInZone('p1', 'DECK')[0]!;
    const p2DeckCard = engine.zoneMgr.getCardsInZone('p2', 'DECK')[0]!;
    const p2HandCard = engine.zoneMgr.getCardsInZone('p2', 'HAND')[0]!;
    const p1FieldCard = findCards(engine, 'p1', 'ST01-001')[0]!;
    engine.fieldMgr.playRoleCard('p1', p1FieldCard.instanceId, 0);

    const events: GameEvent[] = [
      { type: 'GAME_STARTED', firstPlayerId: 'p1', seed: 987654321 },
      { type: 'CARDS_DRAWN', playerId: 'p1', count: 1, drawnCardIds: [p1DeckCard.instanceId] },
      { type: 'CARDS_DRAWN', playerId: 'p2', count: 1, drawnCardIds: [p2DeckCard.instanceId] },
      {
        type: 'CARD_MOVED',
        cardInstanceId: p2DeckCard.instanceId,
        fromZone: 'DECK',
        toZone: 'HAND',
        isFaceUp: false,
        isReady: true,
      },
      {
        type: 'CHOICE_REQUIRED',
        pendingChoice: {
          id: 'c-p2',
          playerId: 'p2',
          choiceType: 'SELECT_CARDS',
          prompt: 'p2 secret choice',
          options: [{ id: p2HandCard.instanceId, label: 'secret' }],
          effectType: 'TEST',
          minSelections: 1,
          maxSelections: 1,
        },
      },
      {
        type: 'CHOICE_RESOLVED',
        playerId: 'p2',
        pendingChoiceId: 'c-p2',
        selectedIds: [p2HandCard.instanceId, p1FieldCard.instanceId],
      },
    ];

    const p1Events = sanitizeGameEventsForPlayer(events, state, 'p1');
    // GAME_STARTED.seed 置 0
    expect((p1Events.find((e) => e.type === 'GAME_STARTED') as any).seed).toBe(0);
    // 己方 CARDS_DRAWN 保留 drawnCardIds，对手 CARDS_DRAWN 剥离
    const p1Draws = p1Events.filter((e) => e.type === 'CARDS_DRAWN');
    expect((p1Draws.find((e) => e.playerId === 'p1') as any).drawnCardIds).toEqual([p1DeckCard.instanceId]);
    expect('drawnCardIds' in p1Draws.find((e) => e.playerId === 'p2')!).toBe(false);
    // 双隐端点 CARD_MOVED 脱敏 cardInstanceId
    const moved = p1Events.find((e) => e.type === 'CARD_MOVED') as any;
    expect(moved.cardInstanceId).toBe('HIDDEN_CARD');
    // 对手 CHOICE_REQUIRED 被完全过滤
    expect(p1Events.some((e) => e.type === 'CHOICE_REQUIRED')).toBe(false);
    // 对手 CHOICE_RESOLVED 对不可见卡牌 ID 改为 REDACTED，公开区保留
    const resolved = p1Events.find((e) => e.type === 'CHOICE_RESOLVED') as any;
    expect(resolved.selectedIds).toEqual(['REDACTED', p1FieldCard.instanceId]);
  });

  it('2. sanitizeGameStateForPlayer 对对手暗费与双方背面信号球剥离持久 instanceId 且快照恢复后一致', () => {
    const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();

    const p1HiddenCost = engine.zoneMgr.getCardsInZone('p1', 'DECK')[0]!;
    const p2HiddenCost = engine.zoneMgr.getCardsInZone('p2', 'DECK')[0]!;
    const p1HiddenOrb = engine.zoneMgr.getCardsInZone('p1', 'DECK')[1]!;
    const p2HiddenOrb = engine.zoneMgr.getCardsInZone('p2', 'DECK')[1]!;

    engine.zoneMgr.moveCard(p1HiddenCost.instanceId, 'COST', { isFaceUp: false, isReady: true });
    engine.zoneMgr.moveCard(p2HiddenCost.instanceId, 'COST', { isFaceUp: false, isReady: true });
    engine.zoneMgr.moveCard(p1HiddenOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: false });
    engine.zoneMgr.moveCard(p2HiddenOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: false });

    const p1Pub = sanitizeGameStateForPlayer(state, 'p1');
    // 己方暗费保留原 instanceId (3.6.3.b.2 可自选支付)
    expect(p1Pub.publicCards[p1HiddenCost.instanceId]).toBeDefined();
    expect(p1Pub.publicCards[p1HiddenCost.instanceId]!.cardNumber).toBe(p1HiddenCost.cardNumber);
    // 对手暗费与双方背面信号球绝不暴露真实 instanceId 与元数据
    expect(p1Pub.publicCards[p2HiddenCost.instanceId]).toBeUndefined();
    expect(p1Pub.publicCards[p1HiddenOrb.instanceId]).toBeUndefined();
    expect(p1Pub.publicCards[p2HiddenOrb.instanceId]).toBeUndefined();

    const p2MaskedCost = Object.values(p1Pub.publicCards).find(
      (c) => c.controllerPlayerId === 'p2' && c.zone === 'COST' && !c.isFaceUp
    )!;
    expect(p2MaskedCost.instanceId.startsWith('hidden-cost:p2:')).toBe(true);
    expect(p2MaskedCost.cardNumber).toBe('HIDDEN_COST');
    expect(p2MaskedCost.enteredFromZone).toBeUndefined();

    const restored = GameEngine.fromSnapshot(engine.toSnapshot(), db);
    expect(JSON.stringify(restored.getPublicState('p1'))).toBe(JSON.stringify(engine.getPublicState('p1')));
    expect(JSON.stringify(restored.getPublicState('p2'))).toBe(JSON.stringify(engine.getPublicState('p2')));
  });

  it('3. publicPendingTriggers 与 opponentPendingChoice 隐藏非公开区触发源，保留公开区触发源', () => {
    const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();

    const p2Hand = engine.zoneMgr.getCardsInZone('p2', 'HAND')[0]!;
    const p2Public = findCards(engine, 'p2', 'ST02-001')[0]!;
    engine.fieldMgr.playRoleCard('p2', p2Public.instanceId, 0);

    state.pendingTriggers = [
      {
        id: 't-hidden',
        abilityId: 'SECRET_HAND_TRIG',
        sourceCardInstanceId: p2Hand.instanceId,
        sourceCardNumber: p2Hand.cardNumber,
        controllerPlayerId: 'p2',
        label: `秘密手牌触发 ${p2Hand.cardNumber}`,
        triggerContext: {},
      },
      {
        id: 't-public',
        abilityId: 'FIELD_TRIG',
        sourceCardInstanceId: p2Public.instanceId,
        sourceCardNumber: p2Public.cardNumber,
        controllerPlayerId: 'p2',
        label: '公开战场自动能力',
        triggerContext: {},
      },
    ];
    state.currentPendingChoice = {
      id: 'ch-hidden',
      playerId: 'p2',
      choiceType: 'SELECT_OPTION',
      prompt: `含敏感来源卡名【${p2Hand.cardNumber}】的提示`,
      options: [{ id: 'a', label: 'A' }],
      effectType: 'TEST_HIDDEN',
      sourceCardInstanceId: p2Hand.instanceId,
      minSelections: 1,
      maxSelections: 1,
    };

    const p1Pub = sanitizeGameStateForPlayer(state, 'p1');
    expect(p1Pub.pendingTriggers![0]!.sourceCardInstanceId).toMatch(/^hidden-trigger:/);
    expect(p1Pub.pendingTriggers![0]!.sourceCardNumber).toBe('HIDDEN_CARD');
    expect(p1Pub.pendingTriggers![0]!.label).toBe('隐藏区域的自动能力');
    expect(p1Pub.pendingTriggers![1]!.sourceCardNumber).toBe(p2Public.cardNumber);
    expect(p1Pub.opponentPendingChoice?.prompt).toBe('对方正在处理决策...');
  });

  it('4. CHOOSE_ZONE_CARDS 扫描 DECK 下发选项与牌库物理顶底顺序无关', () => {
    const deckA = expandDeck('ST01', ['BP01-060', 'BP01-056', 'BP01-056', 'BP01-056']);
    const engineA = createEngine(deckA, expandDeck('ST02'));
    const engineB = createEngine(deckA, expandDeck('ST02'));

    const runDeckSearch = (eng: GameEngine, reverseOrder: boolean): string[] => {
      const selena = findCards(eng, 'p1', 'BP01-060')[0]!;
      const dreams = findCards(eng, 'p1', 'BP01-056');
      eng.zoneMgr.moveCard(selena.instanceId, 'HAND');
      fillCostZone(eng, 'p1', 4);
      const orderedDreams = reverseOrder ? [...dreams].reverse() : dreams;
      for (const d of orderedDreams) {
        eng.zoneMgr.moveCardToTopOfDeck(d.instanceId);
      }
      const res = eng.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: selena.instanceId,
        targetSlotIndex: 0,
      });
      expect(res.success, res.error).toBe(true);
      return eng.getState().currentPendingChoice!.options.map((o) => o.id);
    };

    const optOrder1 = runDeckSearch(engineA, false);
    const optOrder2 = runDeckSearch(engineB, true);
    expect(optOrder1.length).toBeGreaterThanOrEqual(2);
    expect(optOrder1).toEqual(optOrder2);
  });

  it('5. PEEK_TOP 私密查看 (BP01-061 / BP03-014 / BP03-025 / BP03-061)：全程不进 PROCESSING 且送墓触发 DECK_TO_GY', () => {
    // 5A. BP01-061 查看顶 2 张选 1 置顶、其余置底
    const engA = createEngine(
      expandDeck('ST01', ['BP01-061', 'BP01-056', 'BP01-057', 'BP01-058']),
      expandDeck('ST01', ['BP01-007'])
    );
    const stA = engA.getState();
    const selena61 = findCards(engA, 'p1', 'BP01-061')[0]!;
    const dreamGy = findCards(engA, 'p1', 'BP01-056')[0]!;
    const topA = findCards(engA, 'p1', 'BP01-057')[0]!;
    const topB = findCards(engA, 'p1', 'BP01-058')[0]!;
    const p2Instant = findCards(engA, 'p2', 'BP01-007')[0]!;
    const p2GrayRaven = findCards(engA, 'p2', 'ST01-001')[0]!;
    const p2IceCost = findCards(engA, 'p2', 'ST01-006')[0] ?? findCards(engA, 'p2', 'ST01-007')[0]!;

    engA.fieldMgr.playRoleCard('p2', p2GrayRaven.instanceId, 0);
    engA.zoneMgr.moveCard(p2Instant.instanceId, 'HAND');
    engA.zoneMgr.moveCard(p2IceCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engA.zoneMgr.syncCostStats('p2');
    engA.fieldMgr.playRoleCard('p1', selena61.instanceId, 0);
    stA.cards[selena61.instanceId]!.turnEnteredZone = 0;
    engA.zoneMgr.moveCard(dreamGy.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engA.zoneMgr.moveCardToTopOfDeck(topB.instanceId);
    engA.zoneMgr.moveCardToTopOfDeck(topA.instanceId);

    engA.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p1',
      attackerCardId: selena61.instanceId,
      targetType: 'PLAYER',
    });
    expect(stA.currentPendingChoice).toBeDefined();
    engA.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: stA.currentPendingChoice!.id,
      selectedIds: ['opt_yes'],
    });
    // 查看瞬间，两张牌仍在 DECK 且未进入 PROCESSING，对手不可见
    expect(stA.cards[topA.instanceId]!.zone).toBe('DECK');
    expect(stA.cards[topB.instanceId]!.zone).toBe('DECK');
    expect(engA.zoneMgr.getCardsInZone('p1', 'PROCESSING')).toHaveLength(0);
    expect(sanitizeGameStateForPlayer(stA, 'p2').publicCards[topA.instanceId]).toBeUndefined();

    // 选择 topB 置顶，其余 (topA) 置底
    engA.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: stA.currentPendingChoice!.id,
      selectedIds: [topB.instanceId],
    });
    const deckAfter = engA.zoneMgr.getCardsInZone('p1', 'DECK');
    expect(deckAfter[0]!.instanceId).toBe(topB.instanceId);
    expect(deckAfter[deckAfter.length - 1]!.instanceId).toBe(topA.instanceId);

    // 5B. BP03-015 攻击时牌组顶 2 张以背面放置信号球区最下方，全程不进 PROCESSING
    const engB = createEngine(
      expandDeck('ST01', ['BP03-015']),
      expandDeck('ST02')
    );
    const stB = engB.getState();
    const nanami15 = findCards(engB, 'p1', 'BP03-015')[0]!;
    engB.fieldMgr.playRoleCard('p1', nanami15.instanceId, 0);
    stB.cards[nanami15.instanceId]!.turnEnteredZone = 0;
    const deckTopTwo = engB.zoneMgr.getCardsInZone('p1', 'DECK').slice(0, 2).map((c) => c.instanceId);

    engB.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p1',
      attackerCardId: nanami15.instanceId,
      targetType: 'PLAYER',
    });
    engB.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: stB.currentPendingChoice!.id,
      selectedIds: ['opt_yes'],
    });
    for (const id of deckTopTwo) {
      expect(stB.cards[id]!.zone).toBe('SIGNAL_ORB');
      expect(stB.cards[id]!.isFaceUp).toBe(false);
    }
    expect(stB.events?.length ?? 0).toBe(0);
    expect(engB.zoneMgr.getCardsInZone('p1', 'PROCESSING')).toHaveLength(0);

    // 5C. BP03-061 私密查看顶 1 张送墓：不进 PROCESSING 且正常发射 CARD_MOVED_DECK_TO_GY
    const engC = createEngine(
      expandDeck('ST02', ['BP03-061', 'BP03-062']),
      expandDeck('ST01')
    );
    const stC = engC.getState();
    const lilith61 = findCards(engC, 'p1', 'BP03-061')[0]!;
    const millWatcher = findCards(engC, 'p1', 'BP03-062')[0]!; // cost=3
    // ST02+BP03 牌库顶送墓检验：BP03-061 查看顶牌后送墓时触发 countAsDeckToGy
    engC.zoneMgr.moveCard(lilith61.instanceId, 'HAND');
    fillCostZone(engC, 'p1', 6);
    engC.zoneMgr.moveCardToTopOfDeck(millWatcher.instanceId);

    let deckToGySeen = false;
    const origEmit = engC.triggerMgr.emit.bind(engC.triggerMgr);
    engC.triggerMgr.emit = (ev) => {
      if (ev.type === 'CARD_MOVED_DECK_TO_GY' && ev.cardInstanceId === millWatcher.instanceId) {
        deckToGySeen = true;
      }
      return origEmit(ev);
    };

    engC.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: lilith61.instanceId,
      targetSlotIndex: 0,
    });
    expect(stC.currentPendingChoice?.effectType).toBe('DSL_BP03-061_PEEK_MILL');
    expect(stC.cards[millWatcher.instanceId]!.zone).toBe('DECK');
    engC.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: stC.currentPendingChoice!.id,
      selectedIds: [millWatcher.instanceId],
    });
    expect(stC.cards[millWatcher.instanceId]!.zone).toBe('GRAVEYARD');
    expect(deckToGySeen).toBe(true);
  });
});
