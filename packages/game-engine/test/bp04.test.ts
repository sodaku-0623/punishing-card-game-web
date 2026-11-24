import { describe, expect, it } from 'vitest';
import { CardType, GameAction } from '@zhanshuang/shared';
import {
  BP04_EFFECT_SPECS,
  GameEngine,
  MemoryCardDatabase,
  OFFICIAL_CARDS_DATA,
  STARTER_DECK_EFFECT_SPECS,
  STARTER_DECK_SPEC_MAP,
  validateCardEffectRegistry,
} from '../src/index.js';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import { endTurn, passInstantWindows, resolvePendingChoices } from './helpers.js';

const db = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);

function expandDeck(code: 'ST01' | 'ST02' | 'ST03', extras: string[] = []): string[] {
  const deck = OFFICIAL_STARTER_DECKS.find((d) => d.name.includes(code));
  if (!deck) {
    throw new Error(`未找到预组 ${code}`);
  }
  const base = deck.cards.flatMap((entry) => Array.from({ length: entry.count }, () => entry.cardNumber));
  return [...extras, ...base.slice(0, Math.max(0, 50 - extras.length))];
}

function createEngine(p1Deck: string[], p2Deck: string[], seed = 20261128): GameEngine {
  const engine = new GameEngine(
    'bp04-test',
    { playerId: 'p1', deckCardNumbers: p1Deck },
    { playerId: 'p2', deckCardNumbers: p2Deck },
    seed,
    db
  );
  if (engine.getState().phase === 'DRAW_CHARGE_PHASE') {
    engine.dispatchAction({ type: 'CHARGE_COST_FROM_HAND', playerId: engine.getState().activePlayerId });
  }
  if (engine.getState().activePlayerId !== 'p1') {
    endTurn(engine);
    if (engine.getState().phase === 'DRAW_CHARGE_PHASE') {
      engine.dispatchAction({ type: 'CHARGE_COST_FROM_HAND', playerId: 'p1' });
    }
  }
  return engine;
}

function findCards(engine: GameEngine, cardNumber: string, ownerId?: string) {
  return Object.values(engine.getState().cards)
    .filter((c) => c.cardNumber === cardNumber && (!ownerId || c.ownerPlayerId === ownerId))
    .sort((a, b) => Number(a.instanceId.split('-').pop()) - Number(b.instanceId.split('-').pop()));
}

function findCard(engine: GameEngine, cardNumber: string, ownerId?: string) {
  const card = findCards(engine, cardNumber, ownerId)[0];
  if (!card) {
    throw new Error(`未找到卡牌 ${cardNumber}`);
  }
  return card;
}

function recalculate(engine: GameEngine) {
  engine.zoneMgr.syncCostStats('p1');
  engine.zoneMgr.syncCostStats('p2');
}

function setupOpenCosts(engine: GameEngine, playerId: 'p1' | 'p2', cardNumbers: string[]) {
  // 先清空现有费用区到牌组以免超过 10 张上限或缺少指定属性
  for (const existing of engine.zoneMgr.getCardsInZone(playerId, 'COST')) {
    engine.zoneMgr.moveCard(existing.instanceId, 'DECK', { isFaceUp: false, isReady: true });
  }
  for (const cardNumber of cardNumbers) {
    const candidate = Object.values(engine.getState().cards).find(
      (c) => c.ownerPlayerId === playerId && c.cardNumber === cardNumber && c.zone === 'DECK'
    ) ?? Object.values(engine.getState().cards).find(
      (c) => c.ownerPlayerId === playerId && c.cardNumber === cardNumber && c.zone !== 'COST'
    );
    if (!candidate) {
      throw new Error(`setupOpenCosts 未找到可用卡牌 ${cardNumber}`);
    }
    engine.zoneMgr.moveCard(candidate.instanceId, 'COST', { isFaceUp: true, isReady: true });
  }
  recalculate(engine);
}

function untapCosts(engine: GameEngine, playerId: 'p1' | 'p2') {
  for (const c of engine.zoneMgr.getCardsInZone(playerId, 'COST')) {
    c.isReady = true;
  }
  recalculate(engine);
}

function placeRole(
  engine: GameEngine,
  playerId: 'p1' | 'p2',
  cardNumber: string,
  slotIndex: number,
  options?: { isReady?: boolean; enteredThisTurn?: boolean; underneathCardIds?: string[] }
) {
  const state = engine.getState();
  const card = findCards(engine, cardNumber, playerId).find((c) => c.zone !== 'BATTLEFIELD');
  if (!card) {
    throw new Error(`未找到可放置的卡牌 ${cardNumber}`);
  }
  engine.zoneMgr.moveCard(card.instanceId, 'BATTLEFIELD', {
    slotIndex,
    isFaceUp: true,
    isReady: options?.isReady ?? true,
  });
  state.battlefields[playerId]![slotIndex]!.roleCardId = card.instanceId;
  card.turnEnteredZone = options?.enteredThisTurn ? state.turnNumber : 0;

  if (options?.underneathCardIds) {
    for (const underId of options.underneathCardIds) {
      engine.zoneMgr.moveCard(underId, 'UNDERNEATH', { isFaceUp: true });
      const under = state.cards[underId]!;
      under.underneathOfCardId = card.instanceId;
      under.slotIndex = slotIndex;
      if (!card.underneathCardIds.includes(underId)) {
        card.underneathCardIds.push(underId);
      }
    }
  }
  recalculate(engine);
  return card;
}

function moveToHand(engine: GameEngine, cardId: string) {
  engine.zoneMgr.moveCard(cardId, 'HAND', { isFaceUp: true });
  recalculate(engine);
  return engine.getState().cards[cardId]!;
}

function moveToOrbZone(engine: GameEngine, cardId: string) {
  engine.zoneMgr.moveCard(cardId, 'SIGNAL_ORB', { isFaceUp: true });
  recalculate(engine);
  return engine.getState().cards[cardId]!;
}

function moveToGraveyard(engine: GameEngine, cardId: string) {
  engine.zoneMgr.moveCard(cardId, 'GRAVEYARD', { isFaceUp: true });
  recalculate(engine);
  return engine.getState().cards[cardId]!;
}

function moveToCost(engine: GameEngine, cardId: string, isFaceUp: boolean) {
  engine.zoneMgr.moveCard(cardId, 'COST', { isFaceUp, isReady: true });
  recalculate(engine);
  return engine.getState().cards[cardId]!;
}

function moveToDeckTop(engine: GameEngine, cardIds: string[]) {
  const state = engine.getState();
  for (const id of cardIds) {
    engine.zoneMgr.moveCard(id, 'DECK', { isFaceUp: false, isReady: true });
  }
  const snapshot = { ...state.cards };
  const topSet = new Set(cardIds);
  for (const key of Object.keys(state.cards)) {
    delete state.cards[key];
  }
  for (const id of cardIds) {
    state.cards[id] = snapshot[id]!;
  }
  for (const [id, c] of Object.entries(snapshot)) {
    if (!topSet.has(id)) {
      state.cards[id] = c;
    }
  }
}

function chooseOption(engine: GameEngine, selectedIds: string[]) {
  const choice = engine.getState().currentPendingChoice;
  if (!choice) {
    throw new Error('当前无待处理的玩家决策');
  }
  const res = engine.dispatchAction({
    type: 'SELECT_CHOICE_OPTION',
    playerId: choice.playerId,
    pendingChoiceId: choice.id,
    selectedIds,
  });
  expect(res.success, `SELECT_CHOICE_OPTION 失败: ${res.error} (choice=${choice.effectType})`).toBe(true);
  return res;
}

function resolveChoicesWith(
  engine: GameEngine,
  chooser: (choice: NonNullable<ReturnType<GameEngine['getState']>['currentPendingChoice']>) => string[]
) {
  let guard = 0;
  while (engine.getState().currentPendingChoice && guard < 40) {
    const choice = engine.getState().currentPendingChoice!;
    chooseOption(engine, chooser(choice));
    guard++;
  }
  expect(guard).toBeLessThan(40);
}

function mustDispatch(engine: GameEngine, action: GameAction) {
  const res = engine.dispatchAction(action);
  expect(res.success, `Action ${action.type} 失败: ${res.error}`).toBe(true);
  return res;
}

describe('BP04《终焉圣歌》声明式效果库校验与端到端规则测试', () => {
  it('BP04_EFFECT_SPECS 应精确覆盖全部 89 张卡号且通过注册表零报错校验', () => {
    const officialBp04 = OFFICIAL_CARDS_DATA.filter((c) => c.cardNumber.startsWith('BP04-'));
    expect(officialBp04).toHaveLength(89);

    const specNumbers = BP04_EFFECT_SPECS.map((s) => s.cardNumber);
    expect(specNumbers).toHaveLength(89);
    expect(new Set(specNumbers).size).toBe(89);

    for (const def of officialBp04) {
      const spec = BP04_EFFECT_SPECS.find((s) => s.cardNumber === def.cardNumber);
      expect(spec, `缺失 ${def.cardNumber}`).toBeDefined();
      expect(spec!.name).toBe(def.name);
      expect(STARTER_DECK_SPEC_MAP.has(def.cardNumber)).toBe(true);
    }

    expect(() => validateCardEffectRegistry(BP04_EFFECT_SPECS, db)).not.toThrow();
    expect(() => validateCardEffectRegistry(STARTER_DECK_EFFECT_SPECS, db)).not.toThrow();
  });

  describe('1. 露娜·终焉体系 (BP04-001 ~ BP04-011)', () => {
    it('BP04-001：下方每1张 PP+1000、>=10 张 DP+1；回合结束叠手牌并选叠其他角色/免疫己方叠置与消3球竖直', () => {
      const underCards = Array.from({ length: 10 }, () => 'BP04-081');
      const engine = createEngine(
        expandDeck('ST02', ['BP04-001', 'BP04-008', 'ST02-003', 'ST02-003', ...underCards]),
        expandDeck('ST01')
      );
      const underIds = findCards(engine, 'BP04-081', 'p1').slice(0, 10).map((c) => c.instanceId);
      const luna001 = placeRole(engine, 'p1', 'BP04-001', 0, { isReady: false, underneathCardIds: underIds });
      const stats001 = engine.continuousEffects.evaluateCard(luna001.instanceId);
      expect(stats001.pp).toBe(db.getCard('BP04-001')!.basePP! + 10_000);
      expect(stats001.dp).toBe(db.getCard('BP04-001')!.baseDP! + 1);

      const ally = placeRole(engine, 'p1', 'ST02-003', 1);
      const luna008 = placeRole(engine, 'p1', 'BP04-008', 2);
      const handCard = findCards(engine, 'ST02-003', 'p1').find((c) => c.instanceId !== ally.instanceId)!;
      moveToHand(engine, handCard.instanceId);

      // 我方回合结束：将手牌放下方并选择模式 1（其余角色置入下方并变为辅助机）
      // 变为辅助机期间仍保持 BP04-001 【永】的下方 PP/DP 加成，不会被 SBA 9.4 误判 PP 归 0 破坏 (Q&A·10)
      mustDispatch(engine, { type: 'PASS_ACTION_TIMING', playerId: 'p1' });
      resolveChoicesWith(engine, (choice) => {
        if (choice.effectType === 'DSL_BP04_001_HAND') return [handCard.instanceId];
        if (choice.effectType === 'DSL_BP04_001_MODE') return ['tuck_all_become_assist'];
        return choice.options.slice(0, choice.minSelections).map((o) => o.id);
      });

      expect(engine.getState().battlefields.p1![1]!.roleCardId).toBeUndefined();
      expect(engine.getState().battlefields.p1![2]!.roleCardId).toBe(luna008.instanceId);
      expect(engine.getState().cards[luna001.instanceId]!.zone).toBe('BATTLEFIELD');
      expect(engine.continuousEffects.getEffectiveCardType(luna001.instanceId)).toBe('ASSIST');
      const assistStats = engine.continuousEffects.evaluateCard(luna001.instanceId);
      expect(assistStats.pp).toBe(db.getCard('BP04-001')!.basePP! + engine.getState().cards[luna001.instanceId]!.underneathCardIds.length * 1000);

      // 验证 BP04-001 模式 2（手牌叠入下方并消除 3 球竖直）
      const engine2 = createEngine(
        expandDeck('ST02', ['BP04-001', 'BP04-081', 'BP04-082', 'BP04-083', 'BP04-084', 'ST02-003']),
        expandDeck('ST01')
      );
      const luna001b = placeRole(engine2, 'p1', 'BP04-001', 0, { isReady: false });
      const orbIds = ['BP04-081', 'BP04-082', 'BP04-083'].map((n) => moveToOrbZone(engine2, findCard(engine2, n, 'p1').instanceId).instanceId);
      const tuckHand = moveToHand(engine2, findCard(engine2, 'ST02-003', 'p1').instanceId);
      // 给 luna001b 先塞 1 张底牌确保 PP >= 1000（免于 PP_ZERO）
      const seedUnder = findCard(engine2, 'BP04-084', 'p1');
      engine2.zoneMgr.moveCard(seedUnder.instanceId, 'UNDERNEATH', { isFaceUp: true });
      seedUnder.underneathOfCardId = luna001b.instanceId;
      luna001b.underneathCardIds.push(seedUnder.instanceId);

      mustDispatch(engine2, { type: 'PASS_ACTION_TIMING', playerId: 'p1' });
      resolveChoicesWith(engine2, (choice) => {
        if (choice.effectType === 'DSL_BP04_001_HAND') return [tuckHand.instanceId];
        if (choice.effectType === 'DSL_BP04_001_MODE') return ['elim3_untap'];
        if (choice.effectType === 'DSL_BP04_001_ORB') return orbIds;
        return choice.options.slice(0, choice.minSelections).map((o) => o.id);
      });
      expect(luna001b.underneathCardIds).toContain(tuckHand.instanceId);
      expect(luna001b.isReady).toBe(true);
    });

    it('BP04-002：出场消2球依据《露娜·终焉》下方每4张多选1项（不可重复），且防置入下方并减对方PP', () => {
      const voidCosts = Array.from({ length: 6 }, () => 'BP04-005');
      const under4 = ['BP04-082', 'BP04-083', 'BP04-084', 'BP04-085'];
      const engine = createEngine(
        expandDeck('ST02', ['BP04-002', 'BP04-008', ...voidCosts, ...under4, 'BP04-086', 'BP04-087']),
        expandDeck('ST01', ['ST01-002'])
      );
      setupOpenCosts(engine, 'p1', voidCosts);
      const underIds = under4.map((n) => findCard(engine, n, 'p1').instanceId);
      placeRole(engine, 'p1', 'BP04-008', 0, { underneathCardIds: underIds });
      const oppRole = placeRole(engine, 'p2', 'ST01-002', 0);
      const orb1 = findCard(engine, 'BP04-086', 'p1');
      const orb2 = findCard(engine, 'BP04-087', 'p1');
      moveToOrbZone(engine, orb1.instanceId);
      moveToOrbZone(engine, orb2.instanceId);

      const luna002 = findCard(engine, 'BP04-002', 'p1');
      moveToHand(engine, luna002.instanceId);
      mustDispatch(engine, {
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: luna002.instanceId,
        targetSlotIndex: 1,
      });

      resolveChoicesWith(engine, (choice) => {
        if (choice.effectType === 'DSL_BP04_002_ORB_COST') {
          return [`${orb1.instanceId},${orb2.instanceId}`];
        }
        if (choice.effectType === 'DSL_BP04_002_MODE') {
          expect(choice.minSelections).toBe(2);
          expect(choice.maxSelections).toBe(2);
          return ['protect_pp', 'debuff_opp'];
        }
        if (choice.effectType === 'DSL_BP04_002_DEBUFF') return [oppRole.instanceId];
        return choice.options.slice(0, choice.minSelections).map((o) => o.id);
      });

      const stats002 = engine.continuousEffects.evaluateCard(luna002.instanceId);
      expect(stats002.pp).toBe(db.getCard('BP04-002')!.basePP! + 1000);
      expect(stats002.prohibitions).toContain('CANNOT_BE_PLACED_UNDERNEATH');
      expect(engine.continuousEffects.evaluateCard(oppRole.instanceId).pp).toBe(
        Math.max(0, db.getCard('ST01-002')!.basePP! - 3000)
      );
    });

    it('BP04-003、BP04-007、BP04-009、BP04-010：月冕/红月入下方、Q&A·10 全场基本DP=1 与出场下方>=7获速攻保护', () => {
      const voidCosts = Array.from({ length: 8 }, () => 'BP04-005');
      const fillerOrbs = Array.from({ length: 6 }, () => 'BP04-085');
      const engine = createEngine(
        expandDeck('ST02', ['BP04-003', 'BP04-007', 'BP04-007', 'BP04-008', 'BP04-009', 'BP04-010', ...voidCosts, ...fillerOrbs]),
        expandDeck('ST01', ['ST01-002'])
      );
      setupOpenCosts(engine, 'p1', voidCosts);

      const luna003 = findCard(engine, 'BP04-003', 'p1');
      const luna008 = findCard(engine, 'BP04-008', 'p1');
      const luna007a = findCards(engine, 'BP04-007', 'p1')[0]!;
      const luna007b = findCards(engine, 'BP04-007', 'p1')[1]!;
      const tactic009 = findCard(engine, 'BP04-009', 'p1');
      const tactic010 = findCard(engine, 'BP04-010', 'p1');

      placeRole(engine, 'p1', 'BP04-008', 0, {
        isReady: false,
        underneathCardIds: findCards(engine, 'BP04-085', 'p1').slice(0, 5).map((c) => c.instanceId),
      });
      placeRole(engine, 'p1', 'BP04-007', 1);
      placeRole(engine, 'p1', 'BP04-007', 2);
      const oppRole = placeRole(engine, 'p2', 'ST01-002', 0);

      // 打出《月冕权能》放到 BP04-008 下方并竖直 +1000PP（下方此时 6 张）
      moveToHand(engine, tactic009.instanceId);
      mustDispatch(engine, { type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: tactic009.instanceId });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_009_LUNA') return [luna008.instanceId];
        if (c.effectType === 'DSL_BP04_009_CONFIRM') return ['opt_yes'];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(luna008.isReady).toBe(true);
      expect(luna008.underneathCardIds).toContain(tactic009.instanceId);

      // 打出《红月临空》放到 BP04-008 下方（此时下方已有 7 张牌 -> floor(7/2)=3 -> 对方 -3000 PP）
      moveToHand(engine, tactic010.instanceId);
      mustDispatch(engine, { type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: tactic010.instanceId });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_010_LUNA') return [luna008.instanceId];
        if (c.effectType === 'DSL_BP04_010_CONFIRM') return ['opt_yes'];
        if (c.effectType === 'DSL_BP04_010_DEBUFF') return [oppRole.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(engine.continuousEffects.evaluateCard(oppRole.instanceId).pp).toBe(
        Math.max(0, db.getCard('ST01-002')!.basePP! - 3000)
      );

      // 验证 BP04-007 Q&A·10：下方同时有《月冕权能》和《红月临空》时，两张 BP04-007 基本 DP 都变为 1
      expect(engine.continuousEffects.evaluateCard(luna007a.instanceId).dp).toBe(1);
      expect(engine.continuousEffects.evaluateCard(luna007b.instanceId).dp).toBe(1);

      // 下方已达到 7 张，此时从手牌打出 BP04-003 选择第 2 项获得【速攻】与 CANNOT_BE_PLACED_UNDERNEATH
      untapCosts(engine, 'p1');
      moveToHand(engine, luna003.instanceId);
      mustDispatch(engine, {
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: luna003.instanceId,
        targetSlotIndex: 3,
      });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_003_MODE') return ['underneath7_rush'];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      const stats003 = engine.continuousEffects.evaluateCard(luna003.instanceId);
      expect(stats003.keywords).toContain('速攻');
      expect(stats003.prohibitions).toContain('CANNOT_BE_PLACED_UNDERNEATH');
    });

    it('BP04-011 & BP04-007 + BP04-010：被攻击时在《露娜·终焉》下方使用瞬时《升空凌视》与非战术瞬时拉下方的牌并触发《红月临空》+1000 PP', () => {
      const voidCosts = Array.from({ length: 8 }, () => 'BP04-004');
      const engine = createEngine(
        expandDeck('ST02', ['BP04-008', 'BP04-005', 'BP04-007', 'BP04-010', 'BP04-011', ...voidCosts]),
        expandDeck('ST01', ['ST01-002'])
      );
      setupOpenCosts(engine, 'p1', voidCosts);
      const under005 = findCard(engine, 'BP04-005', 'p1');
      const under007 = findCard(engine, 'BP04-007', 'p1');
      const under010 = findCard(engine, 'BP04-010', 'p1');
      const under011 = findCard(engine, 'BP04-011', 'p1');
      placeRole(engine, 'p1', 'BP04-008', 0, {
        underneathCardIds: [under005.instanceId, under007.instanceId, under010.instanceId, under011.instanceId],
      });
      const oppAtk = placeRole(engine, 'p2', 'ST01-002', 0);

      endTurn(engine);
      if (engine.getState().phase === 'DRAW_CHARGE_PHASE') {
        mustDispatch(engine, { type: 'CHARGE_COST_FROM_HAND', playerId: 'p2' });
      }
      mustDispatch(engine, {
        type: 'DECLARE_ATTACK',
        playerId: 'p2',
        attackerCardId: oppAtk.instanceId,
        targetType: 'PLAYER',
      });
      // 对手攻击我方玩家 -> 自由时点从《露娜·终焉》下方使用瞬时《升空凌视》拉出<=5费《露娜·终焉》
      mustDispatch(engine, {
        type: 'USE_INSTANT',
        playerId: 'p1',
        cardInstanceId: under011.instanceId,
      });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_011_DEPLOY') return [under005.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(under005.zone).toBe('BATTLEFIELD');

      // 同一自由时点再由下方的 BP04-007 发动内置非战术【瞬时】（card-effects.ts 携带 deployedFromHostCardId）触发《红月临空》+1000 PP
      mustDispatch(engine, {
        type: 'USE_INSTANT',
        playerId: 'p1',
        cardInstanceId: under007.instanceId,
      });
      resolvePendingChoices(engine);
      expect(under007.zone).toBe('BATTLEFIELD');
      expect(engine.continuousEffects.evaluateCard(under007.instanceId).pp).toBe(
        db.getCard('BP04-007')!.basePP! + 1000
      );
    });
  });

  describe('2. 薇拉·灼惘体系 (BP04-012 ~ BP04-022)', () => {
    it('BP04-012 / BP04-014：侵蚀>=5 获【速攻】+2000PP；起动自伤1触发BP04-014减2费；攻击玩家伤触发暗费置墓减侵蚀', () => {
      const fireCosts = Array.from({ length: 6 }, () => 'BP04-018');
      const engine = createEngine(
        expandDeck('ST01', ['BP04-012', 'BP04-014', 'ST01-002', ...fireCosts]),
        expandDeck('ST01')
      );
      setupOpenCosts(engine, 'p1', fireCosts);
      const hidden1 = findCard(engine, 'ST01-002', 'p1');
      moveToCost(engine, hidden1.instanceId, false);

      // 预设侵蚀 4，让 BP04-012 上场后发动【起】自伤 1 使侵蚀达到 5，获得【速攻】与 PP+2000 且触发本回合受伤 >= 1
      engine.getState().players.p1.erosionCount = 4;
      const vera012 = placeRole(engine, 'p1', 'BP04-012', 1, { enteredThisTurn: true });
      mustDispatch(engine, {
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: vera012.instanceId,
        abilityIndex: 0,
      });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_012_RUSH') return [vera012.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(engine.getState().players.p1.erosionCount).toBe(5);
      const stats012 = engine.continuousEffects.evaluateCard(vera012.instanceId);
      expect(stats012.keywords).toContain('速攻');
      expect(stats012.pp).toBe(db.getCard('BP04-012')!.basePP! + 2000);

      // 此时已受过 1 次伤：BP04-014 手牌费用 -2（原6费 -> 实付4费）
      const vera014 = findCard(engine, 'BP04-014', 'p1');
      moveToHand(engine, vera014.instanceId);
      const openBefore = engine.getState().players.p1.availableOpenCostCount;
      mustDispatch(engine, {
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: vera014.instanceId,
        targetSlotIndex: 0,
      });
      expect(engine.getState().players.p1.availableOpenCostCount).toBe(openBefore - (db.getCard('BP04-014')!.cost - 2));

      // 用 BP04-012 攻击玩家造成伤害 -> 触发将暗费置墓使侵蚀 -1
      mustDispatch(engine, {
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: vera012.instanceId,
        targetType: 'PLAYER',
      });
      passInstantWindows(engine);
      if (engine.getState().currentCombat?.step === 'BLOCK') {
        mustDispatch(engine, { type: 'DECLARE_BLOCK', playerId: 'p2' });
      }
      passInstantWindows(engine);
      resolveChoicesWith(engine, (c) => {
        if (c.effectType?.includes('HIDDEN') || c.prompt.includes('暗费')) return [hidden1.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(hidden1.zone).toBe('GRAVEYARD');
      expect(engine.getState().players.p1.erosionCount).toBe(4);
    });

    it('BP04-013 / BP04-016 / BP04-022：BP04-013 二选一消球自伤充能+2、BP04-016 对方回合防改PP与进场炸<=3、BP04-022 破曙疾行', () => {
      const lowCostRole = OFFICIAL_CARDS_DATA.find(
        (c) => c.cardNumber.startsWith('ST01-') && c.cardType === CardType.ROLE && c.cost <= 3
      )!.cardNumber;
      const fireCosts = Array.from({ length: 8 }, () => 'BP04-018');
      const engine = createEngine(
        expandDeck('ST01', ['BP04-013', 'BP04-016', 'BP04-022', 'BP04-086', 'ST01-002', ...fireCosts]),
        expandDeck('ST01', [lowCostRole, 'ST01-003', ...Array.from({ length: 6 }, () => 'ST01-001')])
      );
      setupOpenCosts(engine, 'p1', fireCosts);
      setupOpenCosts(engine, 'p2', Array.from({ length: 6 }, () => 'ST01-001'));
      const hidden1 = findCard(engine, 'ST01-002', 'p1');
      moveToCost(engine, hidden1.instanceId, false);
      const oppLow = placeRole(engine, 'p2', lowCostRole, 0, { isReady: false });

      // 对方明费 >= 5 时，BP04-016 进场可自伤 1 且暗费置墓破坏<=3费
      const vera016 = findCard(engine, 'BP04-016', 'p1');
      moveToHand(engine, vera016.instanceId);
      mustDispatch(engine, {
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: vera016.instanceId,
        targetSlotIndex: 0,
      });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_016_DAMAGE') return ['opt_yes'];
        if (c.effectType === 'DSL_BP04_016_HIDDEN') return [hidden1.instanceId];
        if (c.effectType === 'DSL_BP04_016_DESTROY') return [oppLow.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(engine.getState().players.p1.erosionCount).toBe(1);
      expect(oppLow.zone).toBe('GRAVEYARD');

      // BP04-013：以蓝色信号球发动【起】自伤1得充能+2
      const vera013 = placeRole(engine, 'p1', 'BP04-013', 1);
      const blueOrb = findCard(engine, 'BP04-086', 'p1');
      moveToOrbZone(engine, blueOrb.instanceId);
      mustDispatch(engine, {
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: vera013.instanceId,
        abilityIndex: 0,
      });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_013_COST_MODE') return ['blue_1'];
        if (c.effectType === 'DSL_BP04_013_BLUE') return [blueOrb.instanceId];
        if (c.effectType === 'DSL_BP04_013_DAMAGE') return ['opt_yes'];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(engine.getState().players.p1.erosionCount).toBe(2);
      // BP04-013 自带【充能1】，发动【起】自伤 1 后获得【充能+2】，合计 3
      expect(engine.continuousEffects.evaluateCard(vera013.instanceId).charge).toBe(3);

      // BP04-022 破曙疾行（本回合已受2次伤且破坏对方横置<=6费角色 ST01-003）
      const oppTapped = placeRole(engine, 'p2', 'ST01-003', 1, { isReady: false });
      const card022 = findCard(engine, 'BP04-022', 'p1');
      moveToHand(engine, card022.instanceId);
      mustDispatch(engine, { type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: card022.instanceId });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_022_DAMAGE') return ['opt_no'];
        if (c.effectType === 'DSL_BP04_022_DESTROY') return [oppTapped.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(oppTapped.zone).toBe('GRAVEYARD');

      // 切换至对手回合，验证 static:BP04-016 防对方效果改写 PP
      endTurn(engine);
      if (engine.getState().phase === 'DRAW_CHARGE_PHASE') {
        mustDispatch(engine, { type: 'CHARGE_COST_FROM_HAND', playerId: 'p2' });
      }
      const ppBefore = engine.continuousEffects.evaluateCard(vera016.instanceId).pp;
      vera016.modifiers = vera016.modifiers ?? [];
      vera016.modifiers.push({
        id: 'test-opp-debuff',
        sourceCardId: 'opp-source',
        sourcePlayerId: 'p2',
        ppBonus: -3000,
        expiresAt: 'END_OF_TURN',
      });
      recalculate(engine);
      expect(engine.continuousEffects.evaluateCard(vera016.instanceId).pp).toBe(ppBefore);
    });
  });

  describe('3. 渡边·尘铭与《炽能球》体系 (BP04-023 ~ BP04-033)', () => {
    it('BP04-032 + BP04-024 + BP04-027 + BP04-028：《炽能球》视为红球、墓地协战消《炽能球》直接出场搭档', () => {
      const fireCosts = Array.from({ length: 8 }, () => 'BP04-018');
      const engine = createEngine(
        expandDeck('ST01', ['BP04-024', 'BP04-027', 'BP04-028', 'BP04-032', 'BP04-032', 'ST01-002', ...fireCosts]),
        expandDeck('ST01')
      );
      setupOpenCosts(engine, 'p1', fireCosts);

      const orbBlazing = findCards(engine, 'BP04-032', 'p1')[0]!;
      const orbBlazingHand = findCards(engine, 'BP04-032', 'p1')[1]!;
      const wata027 = findCard(engine, 'BP04-027', 'p1');
      const wata024 = findCard(engine, 'BP04-024', 'p1');
      const wata028 = findCard(engine, 'BP04-028', 'p1');
      const fillerAtk = placeRole(engine, 'p1', 'ST01-002', 3);

      // 攻击自由时点使用 BP04-032《炽能球》：拉出<=3费<遗忘者>（BP04-028），之后自身置入信号球区最上方
      moveToHand(engine, orbBlazingHand.instanceId);
      moveToHand(engine, wata028.instanceId);
      moveToGraveyard(engine, orbBlazing.instanceId);

      mustDispatch(engine, {
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: fillerAtk.instanceId,
        targetType: 'PLAYER',
      });
      mustDispatch(engine, {
        type: 'USE_INSTANT',
        playerId: 'p1',
        cardInstanceId: orbBlazingHand.instanceId,
      });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_032_DEPLOY') return [wata028.instanceId];
        if (c.effectType === 'DSL_BP04_028_PICK_ORB') return [orbBlazing.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      passInstantWindows(engine);
      if (engine.getState().currentCombat?.step === 'BLOCK') {
        mustDispatch(engine, { type: 'DECLARE_BLOCK', playerId: 'p2' });
      }
      passInstantWindows(engine);

      expect(wata028.zone).toBe('BATTLEFIELD');
      expect(orbBlazingHand.zone).toBe('SIGNAL_ORB');
      // static:BP04-032：场上有《渡边·尘铭》时，《炽能球》在信号球区视为 RED
      expect(engine.continuousEffects.getEffectiveOrbInfo(orbBlazingHand.instanceId).colors).toContain('RED');

      // 将 BP04-027 发动【起】+1500/+1DP/+1充能，攻击自毁从而满足本回合有我方角色被破坏的条件
      placeRole(engine, 'p1', 'BP04-027', 1);
      mustDispatch(engine, {
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: wata027.instanceId,
        abilityIndex: 0,
      });
      expect(engine.continuousEffects.evaluateCard(wata027.instanceId).pp).toBe(
        db.getCard('BP04-027')!.basePP! + 1500
      );
      mustDispatch(engine, {
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: wata027.instanceId,
        targetType: 'PLAYER',
      });
      passInstantWindows(engine);
      if (engine.getState().currentCombat?.step === 'BLOCK') {
        mustDispatch(engine, { type: 'DECLARE_BLOCK', playerId: 'p2' });
      }
      passInstantWindows(engine);
      resolvePendingChoices(engine);
      expect(wata027.zone).toBe('GRAVEYARD');

      // 此时 wata024 上场（具【协战搭档】<=3费<遗忘者>）且墓地放入 wata028（<=3费<遗忘者>）；攻击时发动墓地协战并在攻击结束消《炽能球》将搭档直接出场
      placeRole(engine, 'p1', 'BP04-024', 1);
      moveToGraveyard(engine, wata028.instanceId);
      moveToOrbZone(engine, orbBlazing.instanceId);

      mustDispatch(engine, {
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: wata024.instanceId,
        targetType: 'PLAYER',
      });
      mustDispatch(engine, {
        type: 'PERFORM_ASSIST',
        playerId: 'p1',
        hostRoleCardId: wata024.instanceId,
        partnerCardId: wata028.instanceId,
        orbCardInstanceIds: [orbBlazingHand.instanceId],
      });
      expect(wata024.partnerCardId).toBe(wata028.instanceId);

      passInstantWindows(engine);
      if (engine.getState().currentCombat?.step === 'BLOCK') {
        mustDispatch(engine, { type: 'DECLARE_BLOCK', playerId: 'p2' });
      }
      passInstantWindows(engine);
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_024_ORB_COST') return [orbBlazing.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });

      expect(wata028.zone).toBe('BATTLEFIELD');
    });
  });

  describe('4. 卡列尼娜·辉晓与亚里莎·回音体系 (BP04-034 ~ BP04-049)', () => {
    it('BP04-034 / BP04-038 / BP04-039 / BP04-044：全员暗工程获速攻、协战消3球全体-3000、开端瞬时拉布偶熊与变更攻击目标', () => {
      const engine = createEngine(
        expandDeck('ST03', [
          'BP04-034',
          'BP04-038',
          'BP04-039',
          'BP04-042',
          'BP04-044',
          'BP04-081',
          'BP04-082',
          'BP04-086',
          ...Array.from({ length: 6 }, () => 'BP04-037'),
        ]),
        expandDeck('ST01', ['ST01-002'])
      );
      setupOpenCosts(engine, 'p1', Array.from({ length: 6 }, () => 'BP04-037'));

      // BP04-034 仅暗属性<工程部队>在场时获得【速攻】
      const karenina = placeRole(engine, 'p1', 'BP04-034', 0);
      expect(engine.continuousEffects.evaluateCard(karenina.instanceId).keywords).toContain('速攻');

      // 墓地放 BP04-042（具<工程部队>的布偶熊·觅语）与 3 张信号球，在攻击自由时点发动墓地协战并触发消 3 球对方全员 PP-3000
      const teddy42 = findCard(engine, 'BP04-042', 'p1');
      moveToGraveyard(engine, teddy42.instanceId);
      const orbIds = ['BP04-081', 'BP04-082', 'BP04-086'].map(
        (n) => moveToOrbZone(engine, findCard(engine, n, 'p1').instanceId).instanceId
      );
      const extraOrbs = findCards(engine, 'ST03-016', 'p1');
      void extraOrbs;
      const orbForPay = ['BP04-081', 'BP04-082', 'BP04-086'];
      void orbForPay;
      const oppAtk = placeRole(engine, 'p2', 'ST01-002', 0);

      // 我方先攻声明攻击 -> 自由时点由 BP04-034 从墓地协战 BP04-042（同时补 3 颗信号球供 BP04-034 自身【协战自】消除）
      mustDispatch(engine, {
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: karenina.instanceId,
        targetType: 'PLAYER',
      });
      mustDispatch(engine, {
        type: 'PERFORM_ASSIST',
        playerId: 'p1',
        hostRoleCardId: karenina.instanceId,
        partnerCardId: teddy42.instanceId,
        orbCardInstanceIds: orbIds,
      });
      // 上方消3球把 orbIds 送墓后若触发 BP04-034【协战自】需再消3球：提前无额外3球则可选不支付，若想触发可跳过
      resolveChoicesWith(engine, (c) => c.options.slice(0, c.minSelections).map((o) => o.id));
      expect(karenina.partnerCardId).toBe(teddy42.instanceId);
      passInstantWindows(engine);
      if (engine.getState().currentCombat?.step === 'BLOCK') {
        mustDispatch(engine, { type: 'DECLARE_BLOCK', playerId: 'p2' });
      }
      passInstantWindows(engine);
      resolvePendingChoices(engine);

      // 补上 1 张竖直状态的我方角色以免对手攻击在无阻挡者时直接结束战斗，确保停留至 BLOCK 步骤
      placeRole(engine, 'p1', 'BP04-037', 2, { isReady: true });

      // 验证 BP04-038 Q&A·9：对手攻击时由《开端》(BP04-044) 瞬时出场 BP04-038，且成为《卡列尼娜· 辉晓》搭档时可变更攻击目标
      const teddy38 = findCard(engine, 'BP04-038', 'p1');
      const start44 = findCard(engine, 'BP04-044', 'p1');
      moveToGraveyard(engine, teddy38.instanceId);
      moveToHand(engine, start44.instanceId);

      endTurn(engine);
      if (engine.getState().phase === 'DRAW_CHARGE_PHASE') {
        mustDispatch(engine, { type: 'CHARGE_COST_FROM_HAND', playerId: 'p2' });
      }
      mustDispatch(engine, {
        type: 'DECLARE_ATTACK',
        playerId: 'p2',
        attackerCardId: oppAtk.instanceId,
        targetType: 'PLAYER',
      });
      // 对手攻击时 P1 先有自由时点优先权，使用瞬时《开端》拉出横置 BP04-038
      mustDispatch(engine, { type: 'USE_INSTANT', playerId: 'p1', cardInstanceId: start44.instanceId });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_044_DEPLOY') return [teddy38.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(teddy38.zone).toBe('BATTLEFIELD');
      expect(teddy38.isReady).toBe(false);

      // 验证 BP04-038【协战自】：成为《卡列尼娜· 辉晓》搭档时将攻击目标变更为《卡列尼娜· 辉晓》（Q&A·9）
      const attached = engine.fieldMgr.attachPartner('p1', karenina.instanceId, teddy38.instanceId);
      expect(attached).toBe(true);
      engine.triggerMgr.emit({
        type: 'PARTNER_GAINED',
        playerId: 'p1',
        cardInstanceId: karenina.instanceId,
        targetCardId: teddy38.instanceId,
      });
      engine.checkTimingMgr.resolveCheckTiming();
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_038_REDIRECT') return ['opt_yes'];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(engine.getState().currentCombat?.targetType).toBe('CHARACTER');
      expect(engine.getState().currentCombat?.targetCardId).toBe(karenina.instanceId);
    });

    it('BP04-045 / BP04-047 / BP04-049：《理想的彼岸 亚里莎·回音》绑《塞西莉》获【速攻】、BP04-047 降1费、对方回合《双生回响》协战竖直', () => {
      const physCosts = Array.from({ length: 10 }, () => 'ST01-002');
      const engine = createEngine(
        expandDeck('ST01', ['BP04-045', 'BP04-048', 'BP04-047', 'BP04-047', 'BP04-049', 'ST01-003', ...physCosts]),
        expandDeck('ST01', ['ST01-002'])
      );
      setupOpenCosts(engine, 'p1', physCosts);

      const arisa45 = findCard(engine, 'BP04-045', 'p1');
      const cecily47a = findCards(engine, 'BP04-047', 'p1')[0]!;
      const cecily47b = findCards(engine, 'BP04-047', 'p1')[1]!;
      const physFodder = findCard(engine, 'ST01-003', 'p1');
      const twin49 = findCard(engine, 'BP04-049', 'p1');

      moveToHand(engine, arisa45.instanceId);
      moveToHand(engine, physFodder.instanceId);
      moveToHand(engine, cecily47a.instanceId);
      moveToHand(engine, cecily47b.instanceId);
      moveToHand(engine, twin49.instanceId);

      // 丢 1 张物理牌打出 BP04-045，将《塞西莉》直接绑为自身搭档，验证获得【速攻】
      mustDispatch(engine, {
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: arisa45.instanceId,
        targetSlotIndex: 0,
      });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_045_DISCARD') return [physFodder.instanceId];
        if (c.effectType === 'DSL_BP04_045_CECILY') return [cecily47a.instanceId];
        if (c.effectType === 'DSL_BP04_045_MODE') return ['attach_to_arisa'];
        if (c.effectType === 'DSL_BP04_045_HOST') return [arisa45.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(arisa45.partnerCardId).toBe(cecily47a.instanceId);
      expect(engine.continuousEffects.evaluateCard(arisa45.instanceId).keywords).toContain('速攻');

      // 场上放 1 张未协战的《亚里莎·回音》（BP04-048 横置），验证另一张 BP04-047 在手牌获得 -1 费
      const arisa2 = placeRole(engine, 'p1', 'BP04-048', 1, { isReady: false });
      expect(engine.calculateCardCost('p1', cecily47b.instanceId).costToPay).toBe(
        db.getCard('BP04-047')!.cost - 1
      );

      // 对手回合使用瞬时《双生回响》绑搭档并竖直宿主
      endTurn(engine);
      if (engine.getState().phase === 'DRAW_CHARGE_PHASE') {
        mustDispatch(engine, { type: 'CHARGE_COST_FROM_HAND', playerId: 'p2' });
      }
      mustDispatch(engine, { type: 'PASS_ACTION_TIMING', playerId: 'p2' });
      mustDispatch(engine, { type: 'USE_INSTANT', playerId: 'p1', cardInstanceId: twin49.instanceId });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_049_MODE') return ['arisa_host'];
        if (c.effectType === 'DSL_BP04_049_HOST_arisa_host') return [arisa2.instanceId];
        if (c.effectType === 'DSL_BP04_049_PARTNER_arisa_host') return [cecily47b.instanceId];
        if (c.effectType === 'DSL_BP04_049_UNTAP_arisa_host') return ['opt_yes'];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(arisa2.isReady).toBe(true);
    });
  });

  describe('5. 神寂启示录 / 比安卡 / 拉弥亚 / 含英体系 (BP04-050 ~ BP04-089)', () => {
    it('BP04-050 / BP04-052 / BP04-059：冰冻对手、血契者同场至多 1 张与神寂启示录无视属性', () => {
      const mixCosts = ['ST01-002', 'ST01-002', 'ST01-002', 'ST01-002', 'ST01-002', 'BP04-055', 'BP04-055', 'BP04-055', 'BP04-055', 'BP04-055'];
      const engine = createEngine(
        expandDeck('ST03', ['BP04-050', 'BP04-052', 'BP04-052', 'BP04-059', ...mixCosts]),
        expandDeck('ST01', ['ST01-002', 'ST01-011'])
      );
      setupOpenCosts(engine, 'p1', mixCosts);
      const first052 = placeRole(engine, 'p1', 'BP04-052', 0);
      const second052 = findCards(engine, 'BP04-052', 'p1').find((c) => c.instanceId !== first052.instanceId)!;
      moveToHand(engine, second052.instanceId);
      // Q&A·9：已有《血契者》时不能再出场新的，PLAY_CARD 在支付费用前即被阻止
      const secondPlayRes = engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: second052.instanceId,
        targetSlotIndex: 1,
      });
      expect(secondPlayRes.success).toBe(false);
      expect(engine.getState().cards[second052.instanceId]!.zone).toBe('HAND');
      const active052Count = engine
        .getState()
        .battlefields.p1!.filter(
          (s) => s.roleCardId && engine.getState().cards[s.roleCardId]?.cardNumber === 'BP04-052'
        ).length;
      expect(active052Count).toBe(1);

      untapCosts(engine, 'p1');
      // BP04-059 在辅助机位启用 <神寂启示录> 无视属性条件；BP04-050 出场冰冻对手角色
      const apoc = findCard(engine, 'BP04-059', 'p1');
      moveToHand(engine, apoc.instanceId);
      mustDispatch(engine, { type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: apoc.instanceId, targetSlotIndex: 2 });
      expect(engine.getState().battlefields.p1![2]!.assistCardId).toBe(apoc.instanceId);

      untapCosts(engine, 'p1');
      const oppTarget = placeRole(engine, 'p2', 'ST01-002', 0);
      const plague = findCard(engine, 'BP04-050', 'p1');
      moveToHand(engine, plague.instanceId);
      mustDispatch(engine, { type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: plague.instanceId, targetSlotIndex: 3 });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_050_FREEZE') return [oppTarget.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(oppTarget.isFrozen).toBe(true);
    });

    it('BP04-061 ~ BP04-065：信号球区正面<比安卡>直接升变为 BP04-061、《莱特宁》自动装备及攻击结束同步回信号球区最下方', () => {
      const lightningCosts = Array.from({ length: 8 }, () => 'BP04-063');
      const engine = createEngine(
        expandDeck('ST03', ['BP04-061', 'BP04-062', 'BP04-064', 'BP04-065', 'BP04-086', ...lightningCosts]),
        expandDeck('ST01')
      );
      setupOpenCosts(engine, 'p1', lightningCosts);

      const orbBianca = findCard(engine, 'BP04-064', 'p1');
      const orbLightning = findCard(engine, 'BP04-065', 'p1');
      moveToOrbZone(engine, orbBianca.instanceId);
      moveToOrbZone(engine, orbLightning.instanceId);

      // 信号球区《比安卡》直接升变为手牌中的 BP04-061《比安卡·真理》
      const bianca61 = findCard(engine, 'BP04-061', 'p1');
      moveToHand(engine, bianca61.instanceId);
      mustDispatch(engine, {
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: bianca61.instanceId,
        targetSlotIndex: 0,
        targetAscensionCardId: orbBianca.instanceId,
        isAscension: true,
      });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_065_EQUIP') return [orbLightning.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });

      expect(engine.getState().battlefields.p1![0]!.roleCardId).toBe(bianca61.instanceId);
      expect(bianca61.underneathCardIds).toContain(orbBianca.instanceId);
      expect(bianca61.attachedEquipmentId).toBe(orbLightning.instanceId);

      // BP04-061 攻击结束返回信号球区最下方，且 builtin:BP04-065_ORPHAN_TO_ORB_BOTTOM 将《莱特宁》置换至信号球区最下方
      bianca61.turnEnteredZone = 0;
      mustDispatch(engine, {
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: bianca61.instanceId,
        targetType: 'PLAYER',
      });
      passInstantWindows(engine);
      if (engine.getState().currentCombat?.step === 'BLOCK') {
        mustDispatch(engine, { type: 'DECLARE_BLOCK', playerId: 'p2' });
      }
      passInstantWindows(engine);
      resolvePendingChoices(engine);

      const orbIds = engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB').map((c) => c.instanceId);
      expect(bianca61.zone).toBe('SIGNAL_ORB');
      expect(orbLightning.zone).toBe('SIGNAL_ORB');
      expect(orbIds).toContain(bianca61.instanceId);
      expect(orbIds).toContain(orbLightning.instanceId);

      // 信号球区发动 BP04-061【起】消蓝球加入手牌
      const blueOrb = findCard(engine, 'BP04-086', 'p1');
      moveToOrbZone(engine, blueOrb.instanceId);
      mustDispatch(engine, {
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: bianca61.instanceId,
        abilityIndex: 0,
      });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_061_ORB_COST') return [blueOrb.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(bianca61.zone).toBe('HAND');
    });

    it('BP04-067 / BP04-068 / BP04-070：取《潮涌球》补明费、攻击磨 3 触发 BP04-068 回收', () => {
      const surgeCardNumber = OFFICIAL_CARDS_DATA.find((c) => c.name === '潮涌球')?.cardNumber;
      expect(surgeCardNumber).toBeDefined();

      const darkCosts = Array.from({ length: 6 }, () => 'BP04-083');
      const engine = createEngine(
        expandDeck('ST03', ['BP04-067', 'BP04-068', 'BP04-070', surgeCardNumber!, ...darkCosts]),
        expandDeck('ST01')
      );
      setupOpenCosts(engine, 'p1', [...darkCosts, surgeCardNumber!]);
      const surgeOrb = findCard(engine, surgeCardNumber!, 'p1');

      // 出场 BP04-067：拿回明费《潮涌球》到手牌并翻顶1置横置明费
      const lamia67 = findCard(engine, 'BP04-067', 'p1');
      moveToHand(engine, lamia67.instanceId);
      mustDispatch(engine, {
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: lamia67.instanceId,
        targetSlotIndex: 0,
      });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_067_COST') return [surgeOrb.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(surgeOrb.zone).toBe('HAND');

      // 装备《墨提斯》给 BP04-067，在牌组顶放 BP04-068；攻击触发双方磨 3，继而触发 BP04-068 弃 2 回收
      const metis = findCard(engine, 'BP04-070', 'p1');
      const lamia68 = findCard(engine, 'BP04-068', 'p1');
      moveToHand(engine, metis.instanceId);
      mustDispatch(engine, {
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: metis.instanceId,
        targetEquipRoleId: lamia67.instanceId,
      });
      expect(lamia67.attachedEquipmentId).toBe(metis.instanceId);

      lamia67.turnEnteredZone = 0;
      moveToDeckTop(engine, [lamia68.instanceId]);
      mustDispatch(engine, {
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: lamia67.instanceId,
        targetType: 'PLAYER',
      });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_068_DISCARD') {
          return engine.zoneMgr.getCardsInZone('p1', 'HAND').slice(0, 2).map((x) => x.instanceId);
        }
        if (c.effectType === 'DSL_BP04_068_RECOVER') return [lamia68.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(lamia68.zone).toBe('HAND');
    });

    it('BP04-076 ~ BP04-080（含英·清商 Q&A·10）：077/078/079 独立每回合 1 次叠置与下方消球+费出场、076 装备《飞叶点翠》', () => {
      const leafCardNumber = OFFICIAL_CARDS_DATA.find((c) => c.name === '飞叶点翠')?.cardNumber;
      expect(leafCardNumber).toBeDefined();

      const engine = createEngine(
        expandDeck('ST02', ['BP04-076', 'BP04-077', 'BP04-078', 'BP04-079', leafCardNumber!, 'BP04-081', ...Array.from({ length: 6 }, () => 'ST02-001')]),
        expandDeck('ST01')
      );
      setupOpenCosts(engine, 'p1', Array.from({ length: 6 }, () => 'ST02-001'));

      // BP04-076 本回合出场：发动【起】选项 1 从手牌装备《飞叶点翠》，牌组塞入<含英>到下方并获【速攻】
      const h76 = placeRole(engine, 'p1', 'BP04-076', 0, { enteredThisTurn: true });
      const leaf = findCard(engine, leafCardNumber!, 'p1');
      const h77 = findCard(engine, 'BP04-077', 'p1');
      const h78 = findCard(engine, 'BP04-078', 'p1');
      const h79 = findCard(engine, 'BP04-079', 'p1');
      moveToHand(engine, leaf.instanceId);

      mustDispatch(engine, {
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: h76.instanceId,
        abilityIndex: 0,
      });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_076_MODE') return ['equip_leaf_tuck_hanying'];
        if (c.effectType === 'DSL_BP04_076_PICK_EQ') return [leaf.instanceId];
        if (c.effectType === 'DSL_BP04_076_PICK_DECK') return [h77.instanceId];
        if (c.effectType === 'DSL_BP04_076_PICK_HOST') return [h76.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(h76.attachedEquipmentId).toBe(leaf.instanceId);
      expect(h76.underneathCardIds).toContain(h77.instanceId);
      expect(engine.continuousEffects.evaluateCard(h76.instanceId).keywords).toContain('速攻');

      // Q&A·10：不同卡号的《含英·清商》（078 与 079）同一回合可分别发动叠置能力（因宿主已有《飞叶点翠》均为 0 费）
      moveToHand(engine, h78.instanceId);
      moveToHand(engine, h79.instanceId);
      for (const [cardNum, hCard] of [
        ['BP04-078', h78],
        ['BP04-079', h79],
      ] as const) {
        mustDispatch(engine, {
          type: 'ACTIVATE_ABILITY',
          playerId: 'p1',
          sourceCardId: hCard.instanceId,
          abilityIndex: 1,
        });
        resolveChoicesWith(engine, (c) => {
          if (c.effectType === `DSL_${cardNum}_PICK_HOST`) return [h76.instanceId];
          if (c.effectType === `DSL_${cardNum}_FREE_TUCK`) return ['opt_yes'];
          return c.options.slice(0, c.minSelections).map((o) => o.id);
        });
      }
      expect(h76.underneathCardIds).toContain(h78.instanceId);
      expect(h76.underneathCardIds).toContain(h79.instanceId);

      // 检验 BP04-077 从<九龙商会>下方支付 红球+2费 出场
      const redOrb = findCard(engine, 'BP04-081', 'p1');
      moveToOrbZone(engine, redOrb.instanceId);
      mustDispatch(engine, {
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: h77.instanceId,
        abilityIndex: 0,
      });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04-077_ORB_DEPLOY') return [redOrb.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(h77.zone).toBe('BATTLEFIELD');
    });

    it('BP04-071 / BP04-081：牺牲其他《丽芙·极昼》加攻获【速攻】，以及标准信号球使用入球区', () => {
      const engine = createEngine(
        expandDeck('ST01', ['BP04-071', 'BP04-071', 'BP04-081', ...Array.from({ length: 6 }, () => 'ST01-001')]),
        expandDeck('ST01')
      );
      setupOpenCosts(engine, 'p1', Array.from({ length: 6 }, () => 'ST01-001'));

      const livMain = placeRole(engine, 'p1', 'BP04-071', 0, { enteredThisTurn: true });
      const livSac = placeRole(engine, 'p1', 'BP04-071', 1);
      mustDispatch(engine, {
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: livMain.instanceId,
        abilityIndex: 1,
      });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_071_SAC') return [livSac.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(livSac.zone).toBe('GRAVEYARD');
      const statsLiv = engine.continuousEffects.evaluateCard(livMain.instanceId);
      expect(statsLiv.keywords).toContain('速攻');
      expect(statsLiv.pp).toBe(db.getCard('BP04-071')!.basePP! + 2000);

      // BP04-081 标准信号球战术牌使用后进入信号球区
      const orb81 = findCard(engine, 'BP04-081', 'p1');
      moveToHand(engine, orb81.instanceId);
      mustDispatch(engine, { type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: orb81.instanceId });
      expect(orb81.zone).toBe('SIGNAL_ORB');
      expect(engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB').map((c) => c.instanceId)).toContain(orb81.instanceId);
    });

    it('BP04-029 / BP04-033 / BP04-046 / BP04-080 / BP04-086：巴克豪斯+葬火于碑、塞西莉双色协战与《苍山悠梦境》联动', () => {
      const leafCardNumber = OFFICIAL_CARDS_DATA.find((c) => c.name === '飞叶点翠')?.cardNumber!;
      const mixedCosts = ['BP04-018', 'BP04-018', 'BP04-018', 'ST02-001', 'ST02-001', 'ST02-001', 'ST01-002', 'ST01-002'];
      const engine = createEngine(
        expandDeck('ST02', [
          'BP04-029',
          'BP04-028',
          'BP04-027',
          'BP04-033',
          'BP04-045',
          'BP04-046',
          'BP04-047',
          'BP04-076',
          'BP04-077',
          'BP04-078',
          'BP04-080',
          'BP04-081',
          'BP04-082',
          'BP04-086',
          'BP04-086',
          'BP04-087',
          leafCardNumber,
          ...mixedCosts,
        ]),
        expandDeck('ST01', ['ST01-002', 'ST01-004'])
      );
      setupOpenCosts(engine, 'p1', mixedCosts);

      // 1) BP04-029 在场上有其他 2 名<遗忘者>时基本 DP 变为 1；《葬火于碑》(BP04-033) 破坏己方 BP04-029 破坏对手大怪，并触发 BP04-029 消黄球横置对方 PP<=3000 角色
      const buck = placeRole(engine, 'p1', 'BP04-029', 0);
      placeRole(engine, 'p1', 'BP04-028', 1);
      placeRole(engine, 'p1', 'BP04-027', 2);
      expect(engine.continuousEffects.evaluateCard(buck.instanceId).dp).toBe(1);

      const oppBig = placeRole(engine, 'p2', 'ST01-002', 0); // 3500 PP
      const oppSmall = placeRole(engine, 'p2', 'ST01-004', 1); // <= 3000 PP
      const yellowOrb = findCard(engine, 'BP04-087', 'p1');
      moveToOrbZone(engine, yellowOrb.instanceId);

      const card033 = findCard(engine, 'BP04-033', 'p1');
      moveToHand(engine, card033.instanceId);
      mustDispatch(engine, { type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: card033.instanceId });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_033_SAC') return [buck.instanceId];
        if (c.effectType === 'DSL_BP04_033_DESTROY') return [oppBig.instanceId];
        if (c.effectType === 'DSL_BP04_029_YELLOW_1') return [yellowOrb.instanceId];
        if (c.effectType === 'DSL_BP04_029_TAP_1') return [oppSmall.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(buck.zone).toBe('GRAVEYARD');
      expect(oppBig.zone).toBe('GRAVEYARD');
      expect(oppSmall.isReady).toBe(false);

      // 2) BP04-045 + BP04-046：攻击时手牌协战消 2 蓝球复活墓地 <=5 费<塞西莉>(BP04-047) 并验证 BP04-046 触发弹窗完整结算
      const alisa45 = placeRole(engine, 'p1', 'BP04-045', 0);
      const cecily46 = findCard(engine, 'BP04-046', 'p1');
      const cecily47 = findCard(engine, 'BP04-047', 'p1');
      moveToHand(engine, cecily46.instanceId);
      moveToGraveyard(engine, cecily47.instanceId);
      const blue1 = findCards(engine, 'BP04-086', 'p1')[0]!;
      const blue2 = findCards(engine, 'BP04-086', 'p1')[1]!;
      moveToOrbZone(engine, blue1.instanceId);
      moveToOrbZone(engine, blue2.instanceId);
      untapCosts(engine, 'p1');

      mustDispatch(engine, {
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: alisa45.instanceId,
        targetType: 'PLAYER',
      });
      mustDispatch(engine, {
        type: 'PERFORM_ASSIST',
        playerId: 'p1',
        hostRoleCardId: alisa45.instanceId,
        partnerCardId: cecily46.instanceId,
      });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_046_ORB_COST') return [`${blue1.instanceId},${blue2.instanceId}`];
        if (c.effectType === 'DSL_BP04_046_REVIVE') return [cecily47.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(cecily47.zone).toBe('BATTLEFIELD');
      passInstantWindows(engine);
      if (engine.getState().currentCombat?.step === 'BLOCK') {
        mustDispatch(engine, { type: 'DECLARE_BLOCK', playerId: 'p2' });
      }
      passInstantWindows(engine);
      resolvePendingChoices(engine);

      // 3) BP04-080《苍山悠梦境》：弃手牌《飞叶点翠》将牌组最多 2 <含英> 置入<九龙商会>下方
      const hanyingHost = placeRole(engine, 'p1', 'BP04-076', 4);
      const leafHand = findCard(engine, leafCardNumber, 'p1');
      const h77 = findCard(engine, 'BP04-077', 'p1');
      const h78 = findCard(engine, 'BP04-078', 'p1');
      const dream80 = findCard(engine, 'BP04-080', 'p1');
      moveToDeckTop(engine, [h77.instanceId, h78.instanceId]);
      moveToHand(engine, leafHand.instanceId);
      moveToHand(engine, dream80.instanceId);
      untapCosts(engine, 'p1');

      mustDispatch(engine, { type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: dream80.instanceId });
      resolveChoicesWith(engine, (c) => {
        if (c.effectType === 'DSL_BP04_080_SAC') return [leafHand.instanceId];
        if (c.effectType === 'DSL_BP04_080_HOST') return [hanyingHost.instanceId];
        if (c.effectType === 'DSL_BP04_080_PICK') return [h77.instanceId, h78.instanceId];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(leafHand.zone).toBe('GRAVEYARD');
      expect(hanyingHost.underneathCardIds).toContain(h77.instanceId);
      expect(hanyingHost.underneathCardIds).toContain(h78.instanceId);

      // 4) BP04-086 标准信号球牌【充能自】：在伤害充能处理中触发抽 1 或 PP+2000 选项
      moveToDeckTop(engine, [blue1.instanceId]);
      const handBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
      engine.zoneMgr.applyDamageToPlayer('p1', 1);
      resolveChoicesWith(engine, (c) => {
        if (c.options.some((o) => o.id === 'opt_draw_1')) return ['opt_draw_1'];
        return c.options.slice(0, c.minSelections).map((o) => o.id);
      });
      expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore + 1);
    });
  });
});
