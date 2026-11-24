import { describe, it, expect } from 'vitest';
import { CardInstance } from '@zhanshuang/shared';
import { GameEngine, MemoryCardDatabase, OFFICIAL_CARDS_DATA } from '../src/index.js';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import { fillCostZone, passInstantWindows, endTurn } from './helpers.js';

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
    'test-stage1b-2',
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

function addCostCard(engine: GameEngine, playerId: string, cardInstanceId: string): void {
  engine.zoneMgr.moveCard(cardInstanceId, 'COST', { isFaceUp: true, isReady: true });
  engine.zoneMgr.syncCostStats(playerId);
}

describe('Stage 1B-2 (§2.4) 全表 19 张白板/空桩/死分支/必败卡修复回归', () => {
  it('1. BP03-002 & BP04-071 手牌【起】直接【浮空】至 PROCESSING', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP03-002', 'BP03-004', 'BP04-071', 'BP01-044']),
      expandDeck('ST02')
    );
    const state = engine.getState();

    const bp03002 = findCards(engine, 'p1', 'BP03-002')[0]!;
    const oathOnField = findCards(engine, 'p1', 'BP03-004')[0]!;
    const bp04071 = findCards(engine, 'p1', 'BP04-071')[0]!;
    const fireCost = findCards(engine, 'p1', 'BP01-044')[0]!;

    engine.fieldMgr.playRoleCard('p1', oathOnField.instanceId, 0);
    engine.zoneMgr.moveCard(bp03002.instanceId, 'HAND');
    engine.zoneMgr.moveCard(bp04071.instanceId, 'HAND');
    addCostCard(engine, 'p1', fireCost.instanceId);
    fillCostZone(engine, 'p1', 8);

    // BP03-002 从手牌支付 5 费直接浮空
    const res002 = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: bp03002.instanceId,
      abilityIndex: 0,
    });
    expect(res002.success, res002.error).toBe(true);
    expect(state.cards[bp03002.instanceId]!.zone).toBe('PROCESSING');
    expect(state.cards[bp03002.instanceId]!.isAirborne).toBe(true);

    // 已有浮空卡时，BP04-071 手牌浮空应被拒 (10.18.2.a)
    const blocked071 = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: bp04071.instanceId,
      abilityIndex: 0,
    });
    expect(blocked071.success).toBe(false);
    expect(state.cards[bp04071.instanceId]!.zone).toBe('HAND');

    // 清空原浮空卡后，BP04-071 支付 2 费从手牌直接浮空成功
    engine.zoneMgr.moveCard(bp03002.instanceId, 'GRAVEYARD', { isFaceUp: true });
    fillCostZone(engine, 'p1', 8);
    const res071 = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: bp04071.instanceId,
      abilityIndex: 0,
    });
    expect(res071.success, res071.error).toBe(true);
    expect(state.cards[bp04071.instanceId]!.zone).toBe('PROCESSING');
    expect(state.cards[bp04071.instanceId]!.isAirborne).toBe(true);
  });

  it('2. BP03-004 第1项丢2火手牌后从处理区拉出浮空《露西亚·誓焰》', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP03-004', 'BP03-002', 'BP01-044', 'BP01-045', 'BP01-046']),
      expandDeck('ST02')
    );
    const state = engine.getState();

    const bp03004 = findCards(engine, 'p1', 'BP03-004')[0]!;
    const airborneFire = findCards(engine, 'p1', 'BP03-002')[0]!;
    const fire1 = findCards(engine, 'p1', 'BP01-044')[0]!;
    const fire2 = findCards(engine, 'p1', 'BP01-045')[0]!;
    const fireCost = findCards(engine, 'p1', 'BP01-046')[0]!;

    // 先将 BP03-002 浮空至处理区
    engine.zoneMgr.moveCard(airborneFire.instanceId, 'HAND');
    expect(engine.fieldMgr.airborneRole(airborneFire.instanceId)).toBe(true);
    expect(state.cards[airborneFire.instanceId]!.isAirborne).toBe(true);

    engine.zoneMgr.moveCard(bp03004.instanceId, 'HAND');
    engine.zoneMgr.moveCard(fire1.instanceId, 'HAND');
    engine.zoneMgr.moveCard(fire2.instanceId, 'HAND');
    addCostCard(engine, 'p1', fireCost.instanceId);
    fillCostZone(engine, 'p1', 8);

    const play = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: bp03004.instanceId,
      targetSlotIndex: 0,
    });
    expect(play.success, play.error).toBe(true);

    // 丢弃 2 张火属性手牌
    expect(state.currentPendingChoice?.effectType).toBe('DSL_BP03-004_DISCARD');
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [fire1.instanceId, fire2.instanceId],
    });

    // 选择第 1 项：拉出浮空《露西亚·誓焰》
    expect(state.currentPendingChoice?.effectType).toBe('DSL_BP03-004_MODE');
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: ['deploy_airborne'],
    });

    expect(state.currentPendingChoice?.effectType).toBe('DSL_BP03-004_DEPLOY');
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [airborneFire.instanceId],
    });

    expect(state.cards[airborneFire.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(state.cards[airborneFire.instanceId]!.isAirborne).toBeUndefined();
  });

  it('3. BP03-010《旋光灿昼》按双方角色数对比横置或竖直出场浮空《露西亚·誓焰》', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP03-010', 'BP03-010', 'BP03-002', 'BP01-044']),
      expandDeck('ST02', ['ST02-001'])
    );
    const state = engine.getState();

    const tactics = findCards(engine, 'p1', 'BP03-010');
    const fireRole = findCards(engine, 'p1', 'BP03-002')[0]!;
    const fireCost = findCards(engine, 'p1', 'BP01-044')[0]!;
    const oppRole = findCards(engine, 'p2', 'ST02-001')[0]!;

    // 场景 A：双方角色均为 0（我方不少于对方）-> 2 张旋光灿昼均在手牌，进入结束阶段瞬时窗发动，横置出场
    engine.zoneMgr.moveCard(fireRole.instanceId, 'HAND');
    expect(engine.fieldMgr.airborneRole(fireRole.instanceId)).toBe(true);
    engine.zoneMgr.moveCard(tactics[0]!.instanceId, 'HAND');
    engine.zoneMgr.moveCard(tactics[1]!.instanceId, 'HAND');
    addCostCard(engine, 'p1', fireCost.instanceId);
    fillCostZone(engine, 'p1', 6);
    engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p1' });

    const playA = engine.dispatchAction({
      type: 'USE_INSTANT',
      playerId: 'p1',
      cardInstanceId: tactics[0]!.instanceId,
    });
    expect(playA.success, playA.error).toBe(true);
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [fireRole.instanceId],
    });
    expect(state.cards[fireRole.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(state.cards[fireRole.instanceId]!.isReady).toBe(false);

    // 场景 B：同一结束阶段瞬时窗内，我方 0 角色 < 对方 1 角色 -> 竖直出场
    expect(engine.fieldMgr.airborneRole(fireRole.instanceId)).toBe(true);
    engine.fieldMgr.playRoleCard('p2', oppRole.instanceId, 0);
    fillCostZone(engine, 'p1', 6);
    if (state.timingWindow?.priorityPlayerId === 'p2') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    }

    const playB = engine.dispatchAction({
      type: 'USE_INSTANT',
      playerId: 'p1',
      cardInstanceId: tactics[1]!.instanceId,
    });
    expect(playB.success, playB.error).toBe(true);
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [fireRole.instanceId],
    });
    expect(state.cards[fireRole.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(state.cards[fireRole.instanceId]!.isReady).toBe(true);
  });

  it('4. BP03-042《冈格尼尔》第1项排除自身，第2项清下方+消2同色球破坏对方全部横置角色', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP03-042', 'BP03-034', 'ST01-012', 'ST01-012', 'ST01-001', 'ST01-002', 'ST01-003']),
      expandDeck('ST02', ['ST02-001', 'ST02-002'])
    );
    const state = engine.getState();

    const gungnir = findCards(engine, 'p1', 'BP03-042')[0]!;
    const rosetta = findCards(engine, 'p1', 'BP03-034')[0]!;
    const mat1 = findCards(engine, 'p1', 'ST01-001')[0]!;
    const mat2 = findCards(engine, 'p1', 'ST01-002')[0]!;
    const mat3 = findCards(engine, 'p1', 'ST01-003')[0]!;

    engine.fieldMgr.playRoleCard('p1', rosetta.instanceId, 0);
    engine.fieldMgr.playStandaloneEquipment('p1', gungnir.instanceId, 1);
    state.players['p1']!.cardsPlayedThisTurn = 3;

    // 第 1 项：可选物理牌必须排除冈格尼尔自身
    const act1 = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: gungnir.instanceId,
      abilityIndex: 0,
    });
    expect(act1.success, act1.error).toBe(true);
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: ['put_physical_underneath'],
    });
    expect(state.currentPendingChoice?.effectType).toBe('DSL_BP03-042_PICK_MAT');
    const optionIds = state.currentPendingChoice!.options.map((o) => o.id);
    expect(optionIds).not.toContain(gungnir.instanceId);
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [optionIds[0]!],
    });

    // 准备第 2 项：重置回合使用计次，给冈格尼尔下方补足 3 张牌，放 2 个同色红球，对方 1 横置 1 竖直
    state.players['p1']!.turnAbilityUsage = {};
    for (const m of [mat1, mat2, mat3]) {
      engine.zoneMgr.moveCard(m.instanceId, 'BATTLEFIELD', { isFaceUp: true });
      if (!state.cards[gungnir.instanceId]!.underneathCardIds.includes(m.instanceId)) {
        state.cards[gungnir.instanceId]!.underneathCardIds.push(m.instanceId);
      }
    }
    const redOrbs = findCards(engine, 'p1', 'ST01-012').slice(0, 2);
    for (const o of redOrbs) engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    const oppTapped = findCards(engine, 'p2', 'ST02-001')[0]!;
    const oppReady = findCards(engine, 'p2', 'ST02-002')[0]!;
    engine.fieldMgr.playRoleCard('p2', oppTapped.instanceId, 0, { enterTapped: true });
    engine.fieldMgr.playRoleCard('p2', oppReady.instanceId, 1);

    const act2 = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: gungnir.instanceId,
      abilityIndex: 0,
    });
    expect(act2.success, act2.error).toBe(true);
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: ['clear_underneath_wipe'],
    });
    expect(state.currentPendingChoice?.effectType).toBe('DSL_BP03-042_ORBS');
    const orbOpt = state.currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [orbOpt.id],
    });

    expect(state.cards[gungnir.instanceId]!.underneathCardIds).toHaveLength(0);
    expect(state.cards[oppTapped.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[oppReady.instanceId]!.zone).toBe('BATTLEFIELD');
  });

  it('5. BP03-057/060/062 莉莉丝体系：对手丢更高费拦贯通/不丢获贯通、不同费数+PP、同费回收墓地', () => {
    const engine = createEngine(
      expandDeck('ST02', ['BP03-057', 'BP03-060', 'BP03-062', 'BP03-061', 'BP03-059']),
      expandDeck('ST01', ['ST01-001'])
    );
    const state = engine.getState();

    // 5A. BP03-057：公开费用 5 的 BP03-059，对手手牌仅保留费用 <= 5 的卡 -> 即使对手有手牌仍直接获得【贯通】
    const bp03057 = findCards(engine, 'p1', 'BP03-057')[0]!;
    const handLilith = findCards(engine, 'p1', 'BP03-059')[0]!; // cost=5
    for (const c of engine.zoneMgr.getCardsInZone('p2', 'HAND')) {
      engine.zoneMgr.moveCard(c.instanceId, 'DECK', { isFaceUp: false });
    }
    const oppLowCard = Object.values(state.cards).find(
      (c) => c.ownerPlayerId === 'p2' && (db.getCard(c.cardNumber)?.cost ?? 99) <= 4
    )!;
    engine.zoneMgr.moveCard(oppLowCard.instanceId, 'HAND');
    engine.zoneMgr.moveCard(bp03057.instanceId, 'HAND');
    engine.zoneMgr.moveCard(handLilith.instanceId, 'HAND');
    fillCostZone(engine, 'p1', 8);

    const play57 = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: bp03057.instanceId,
      targetSlotIndex: 0,
    });
    expect(play57.success, play57.error).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('DSL_CUSTOM_BP03_057_PICK_SELF');
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [handLilith.instanceId],
    });
    expect(state.cards[handLilith.instanceId]!.zone).toBe('GRAVEYARD');
    expect(engine.continuousEffects.evaluateCard(bp03057.instanceId).keywords).toContain('贯通');

    // 5B. BP03-060：牌组顶 3 张费用分别为 2, 2, 4（2 种不同费用）-> 目标<莉莉丝>获得 +2000 PP
    const bp03060 = findCards(engine, 'p1', 'BP03-060')[0]!;
    const p1DeckCards = engine.zoneMgr.getCardsInZone('p1', 'DECK');
    const cCost2A = p1DeckCards.find((c) => db.getCard(c.cardNumber)?.cost === 2)!;
    const cCost2B = p1DeckCards.find((c) => c.instanceId !== cCost2A.instanceId && db.getCard(c.cardNumber)?.cost === 2)!;
    const cCost4 = p1DeckCards.find((c) => db.getCard(c.cardNumber)?.cost === 4)!;
    engine.zoneMgr.moveCardToTopOfDeck(cCost4.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(cCost2B.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(cCost2A.instanceId);

    const ppBefore = engine.continuousEffects.evaluateCard(bp03057.instanceId).pp;
    engine.zoneMgr.moveCard(bp03060.instanceId, 'HAND');
    fillCostZone(engine, 'p1', 8);
    const play60 = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: bp03060.instanceId,
      targetSlotIndex: 1,
    });
    expect(play60.success, play60.error).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('DSL_BP03-060_PICK');
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [bp03057.instanceId],
    });
    expect(engine.continuousEffects.evaluateCard(bp03057.instanceId).pp).toBe(ppBefore + 2000);
    expect(state.cards[cCost2A.instanceId]!.zone).toBe('DECK');

    // 5C. BP03-062：牌组顶 3 张包含相同费用 (2, 2, 4) -> 触发从墓地回收 1 张<莉莉丝>
    const bp03062 = findCards(engine, 'p1', 'BP03-062')[0]!;
    engine.zoneMgr.moveCardToTopOfDeck(cCost4.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(cCost2B.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(cCost2A.instanceId);
    engine.zoneMgr.moveCard(bp03062.instanceId, 'HAND');
    fillCostZone(engine, 'p1', 8);

    const play62 = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: bp03062.instanceId,
      targetSlotIndex: 2,
    });
    expect(play62.success, play62.error).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('DSL_BP03-062_RECOVER');
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [handLilith.instanceId],
    });
    expect(state.cards[handLilith.instanceId]!.zone).toBe('HAND');
  });

  it('6. BP03-075《露西亚·深红之渊》送墓蓝球减费（每张-2）且不视为消除信号球', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP03-075', 'BP01-081', 'BP01-082']),
      expandDeck('ST02')
    );
    const state = engine.getState();

    const bp03075 = findCards(engine, 'p1', 'BP03-075')[0]!;
    const blue1 = findCards(engine, 'p1', 'BP01-081')[0]!;
    const blue2 = findCards(engine, 'p1', 'BP01-082')[0]!;

    engine.zoneMgr.moveCard(bp03075.instanceId, 'HAND');
    engine.zoneMgr.moveCard(blue1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(blue2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    fillCostZone(engine, 'p1', 4); // 仅 4 费，原费 8 费，须至少送墓 2 蓝球减 4 费

    const eventsBefore = engine.events.length;
    const play = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: bp03075.instanceId,
      targetSlotIndex: 0,
    });
    expect(play.success, play.error).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PLAY_CARD_DISCARD_DISCOUNT');
    expect(state.currentPendingChoice!.minSelections).toBe(2);

    const pickRes = engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [blue1.instanceId, blue2.instanceId],
    });
    expect(pickRes.success, pickRes.error).toBe(true);
    expect(state.cards[bp03075.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(state.cards[blue1.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[blue2.instanceId]!.zone).toBe('GRAVEYARD');
    const newElimEvents = engine.events.slice(eventsBefore).filter((e) => e.type === 'ORBS_ELIMINATED');
    expect(newElimEvents).toHaveLength(0);
  });

  it('7. BP04-012 侵蚀>=6 蓝球改红球【充能自】派发标准 SIGNATURE_MOVE_EFFECT 正确加 PP+2000', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP04-012', 'ST01-013']),
      expandDeck('ST02')
    );
    const state = engine.getState();

    const vera = findCards(engine, 'p1', 'BP04-012')[0]!;
    const blueOrb = findCards(engine, 'p1', 'ST01-013')[0]!;
    engine.fieldMgr.playRoleCard('p1', vera.instanceId, 0);
    state.players['p1']!.erosionCount = 6;
    engine.zoneMgr.moveCard(blueOrb.instanceId, 'PROCESSING', { isFaceUp: true });

    const ppBefore = engine.continuousEffects.evaluateCard(vera.instanceId).pp;
    const triggered = engine.effectEngine.handleChargeAutoEffect('p1', blueOrb.instanceId, db.getCard('ST01-013')!);
    expect(triggered).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('BP04_012_RED_ORB_SUBSTITUTE');

    // 选择改为红色信号球【充能自】
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: ['vera_red'],
    });
    expect(state.currentPendingChoice?.effectType).toBe('SIGNATURE_MOVE_EFFECT');
    expect(state.currentPendingChoice!.options.map((o) => o.id)).toEqual(['opt_dp_plus_1', 'opt_pp_plus_2000']);

    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: ['opt_pp_plus_2000'],
    });
    expect(state.currentPendingChoice?.effectType).toBe('SELECT_ROLE_FOR_CHARGE_BUFF');
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [vera.instanceId],
    });
    expect(engine.continuousEffects.evaluateCard(vera.instanceId).pp).toBe(ppBefore + 2000);
  });

  it('8. BP04-015【自】【回合2】我方回合受伤消蓝球/2球3选1，且第3次受伤不再触发', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP04-015', 'ST01-013', 'ST01-013', 'ST01-013']),
      expandDeck('ST02', ['ST02-001'])
    );
    const state = engine.getState();

    const vera15 = findCards(engine, 'p1', 'BP04-015')[0]!;
    const blues = findCards(engine, 'p1', 'ST01-013').slice(0, 3);
    engine.fieldMgr.playRoleCard('p1', vera15.instanceId, 0);
    for (const b of blues) engine.zoneMgr.moveCard(b.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    // 第 1 次受伤：触发并选消除蓝球 -> 获得【速攻】
    engine.zoneMgr.applyDamageToPlayer('p1', 1);
    engine.checkTimingMgr.resolveCheckTiming();
    expect(state.currentPendingChoice?.effectType).toBe('DSL_BP04_015_COST_MODE');
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: ['blue1'],
    });
    if (state.currentPendingChoice?.effectType === 'DSL_BP04_015_BLUE') {
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: 'p1',
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [state.currentPendingChoice!.options[0]!.id],
      });
    }
    expect(state.currentPendingChoice?.effectType).toBe('DSL_BP04_015_MODE');
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: ['rush'],
    });
    expect(engine.continuousEffects.evaluateCard(vera15.instanceId).keywords).toContain('速攻');

    // 第 2 次受伤：再次触发 -> 选充能+1 & PP+1000
    const ppBefore2 = engine.continuousEffects.evaluateCard(vera15.instanceId).pp;
    engine.zoneMgr.applyDamageToPlayer('p1', 1);
    engine.checkTimingMgr.resolveCheckTiming();
    expect(state.currentPendingChoice).toBeDefined();
    if (state.currentPendingChoice!.effectType === 'DSL_BP04_015_COST_MODE') {
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: 'p1',
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: ['blue1'],
      });
    }
    if (state.currentPendingChoice!.effectType === 'DSL_BP04_015_BLUE' || state.currentPendingChoice!.effectType === 'DSL_BP04_015_BLUE_OPT') {
      const opt = state.currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: 'p1',
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [opt.id],
      });
    }
    expect(state.currentPendingChoice?.effectType).toBe('DSL_BP04_015_MODE');
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: ['charge_pp_next'],
    });
    expect(engine.continuousEffects.evaluateCard(vera15.instanceId).pp).toBe(ppBefore2 + 1000);

    // 第 3 次受伤：【回合2】上限已满，不得再弹出决策
    engine.zoneMgr.applyDamageToPlayer('p1', 1);
    engine.checkTimingMgr.resolveCheckTiming();
    expect(state.currentPendingChoice).toBeUndefined();
  });

  it('9. BP04-035 从墓地协战消3球后攻击结束将搭档出场并获【速攻】，BP04-040 消球代价不计入卡列尼娜次数', () => {
    const engine = createEngine(
      expandDeck('ST02', ['BP04-035', 'BP04-040', 'BP04-037', 'BP04-039', 'ST01-012', 'ST01-012', 'ST01-012', 'ST01-013', 'ST01-013', 'ST01-013']),
      expandDeck('ST01')
    );
    const state = engine.getState();

    // 9A. BP04-040 消除 3 球从墓地拉 BP04-039，严禁增加 eliminatedOrbsByKareninaCountThisTurn
    const bp04040 = findCards(engine, 'p1', 'BP04-040')[0]!;
    const gyEng = findCards(engine, 'p1', 'BP04-039')[0]!;
    const orbs = [...findCards(engine, 'p1', 'ST01-012').slice(0, 3), ...findCards(engine, 'p1', 'ST01-013').slice(0, 3)];
    // 清掉 p1 手牌防止走手牌分支，强制仅走消球代价
    for (const h of engine.zoneMgr.getCardsInZone('p1', 'HAND')) {
      engine.zoneMgr.moveCard(h.instanceId, 'DECK', { isFaceUp: false });
    }
    engine.zoneMgr.moveCard(bp04040.instanceId, 'HAND');
    engine.zoneMgr.moveCard(gyEng.instanceId, 'GRAVEYARD', { isFaceUp: true });
    for (const o of orbs) engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    fillCostZone(engine, 'p1', 6);

    const play40 = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: bp04040.instanceId,
      targetSlotIndex: 0,
    });
    expect(play40.success, play40.error).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('DSL_BP04_040_ORB');
    const orbOpt40 = state.currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [orbOpt40.id],
    });
    if (state.currentPendingChoice?.effectType === 'DSL_BP04_040_REVIVE') {
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: 'p1',
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [gyEng.instanceId],
      });
    }
    expect(state.cards[gyEng.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(state.players['p1']!.eliminatedOrbsByKareninaCountThisTurn ?? 0).toBe(0);

    // 9B. BP04-035 攻击自由时点从墓地协战 BP04-037，消 3 球 -> 攻击结束时 BP04-037 出场且获【速攻】
    const bp04035 = findCards(engine, 'p1', 'BP04-035')[0]!;
    const gyPartner = findCards(engine, 'p1', 'BP04-037')[0]!;
    expect(engine.fieldMgr.playRoleCard('p1', bp04035.instanceId, 2)).toBe(true);
    state.cards[bp04035.instanceId]!.turnEnteredZone = 0;
    engine.zoneMgr.moveCard(gyPartner.instanceId, 'GRAVEYARD', { isFaceUp: true });
    // 再补足 6 球（3 球付墓地协战代价 + 3 球付 BP04-035 触发代价）
    const extraOrbs = Object.values(state.cards)
      .filter((c) => c.ownerPlayerId === 'p1' && c.zone !== 'SIGNAL_ORB' && Boolean(db.getCard(c.cardNumber)?.signalOrb))
      .slice(0, 6);
    for (const o of extraOrbs) engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    const atk = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p1',
      attackerCardId: bp04035.instanceId,
      targetType: 'PLAYER',
    });
    expect(atk.success, atk.error).toBe(true);
    if (state.timingWindow?.priorityPlayerId === 'p2') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    }
    const assist = engine.dispatchAction({
      type: 'PERFORM_ASSIST',
      playerId: 'p1',
      hostRoleCardId: bp04035.instanceId,
      partnerCardId: gyPartner.instanceId,
    });
    expect(assist.success, assist.error).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('DSL_BP04_035_ORB_COST');
    const orbOpt35 = state.currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [orbOpt35.id],
    });

    // 结束自由时点并推进攻击完成（如有充能选择自动选择首项）
    passInstantWindows(engine);
    let guard = 0;
    while (state.currentPendingChoice && guard++ < 10) {
      const ch = state.currentPendingChoice;
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: ch.playerId,
        pendingChoiceId: ch.id,
        selectedIds: [ch.options[0]!.id],
      });
    }

    expect(state.cards[gyPartner.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(state.cards[gyPartner.instanceId]!.partnerOfCardId).toBeUndefined();
    expect(engine.continuousEffects.evaluateCard(gyPartner.instanceId).keywords).toContain('速攻');
  });

  it('10. BP04-047《塞西莉》墓地【游戏1】替非协战《亚里莎·回音》出场抗攻', () => {
    const engine = createEngine(
      expandDeck('ST01', ['ST01-001']),
      expandDeck('ST01', ['BP04-047', 'BP04-048', 'BP01-084'])
    );
    const state = engine.getState();

    const attacker = findCards(engine, 'p1', 'ST01-001')[0]!;
    const cecily = findCards(engine, 'p2', 'BP04-047')[0]!;
    const alisa = findCards(engine, 'p2', 'BP04-048')[0]!;
    const yellowOrb = findCards(engine, 'p2', 'BP01-084')[0]!;

    engine.fieldMgr.playRoleCard('p1', attacker.instanceId, 0);
    state.cards[attacker.instanceId]!.turnEnteredZone = 0;
    engine.fieldMgr.playRoleCard('p2', alisa.instanceId, 0, { enterTapped: true });
    engine.zoneMgr.moveCard(cecily.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(yellowOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    const atk = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p1',
      attackerCardId: attacker.instanceId,
      targetType: 'CHARACTER',
      targetCardId: alisa.instanceId,
    });
    expect(atk.success, atk.error).toBe(true);
    expect(state.currentPendingChoice).toBeDefined();
    if (state.currentPendingChoice!.effectType === 'DSL_BP04_047_COST_MODE') {
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: 'p2',
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: ['yellow1'],
      });
    }
    if (state.currentPendingChoice?.effectType?.startsWith('DSL_BP04_047_YELLOW')) {
      const opt = state.currentPendingChoice.options.find((o) => o.id !== 'skip')!;
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: 'p2',
        pendingChoiceId: state.currentPendingChoice.id,
        selectedIds: [opt.id],
      });
    }

    expect(state.cards[cecily.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(state.players['p2']!.gameAbilityUsage['BP04_047_BODYGUARD']).toBe(1);
    expect(state.cards[alisa.instanceId]!.zone).toBe('BATTLEFIELD');
  });

  it('11. BP04-059《神寂启示录》墓地回底触发叠牌，且减费只统计下方不同名<神寂启示录>角色', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP04-059', 'BP04-050', 'BP04-051', 'BP04-060', 'ST01-012', 'ST01-013']),
      expandDeck('ST02')
    );
    const state = engine.getState();

    const assist59 = findCards(engine, 'p1', 'BP04-059')[0]!;
    const knight1 = findCards(engine, 'p1', 'BP04-050')[0]!; // <神寂启示录> ROLE
    const knight2 = findCards(engine, 'p1', 'BP04-051')[0]!; // <神寂启示录> ROLE
    const bloodTax = findCards(engine, 'p1', 'BP04-060')[0]!; // <神寂启示录> TACTICS (非角色，不得计入)
    const nonApoc = findCards(engine, 'p1', 'ST01-012')[0]!;

    engine.fieldMgr.playAssistCard('p1', assist59.instanceId, 0);
    engine.zoneMgr.moveCard(knight1.instanceId, 'GRAVEYARD', { isFaceUp: true });
    // 将 knight1 从墓地放置到牌组底 -> 触发 BP04-059 【自】将牌组底（即 knight1）置入 BP04-059 下方
    engine.zoneMgr.moveCardToBottomOfDeck(knight1.instanceId);
    engine.checkTimingMgr.resolveCheckTiming();

    expect(state.currentPendingChoice?.effectType).toBe('DSL_BP04_059_TUCK_CONFIRM');
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: ['opt_yes'],
    });
    expect(state.cards[assist59.instanceId]!.underneathCardIds).toContain(knight1.instanceId);

    // 再额外塞 1 张<神寂启示录>角色 + 1 张非角色<神寂启示录>战术 + 1 张普通卡在下方 -> 合法计数应精确为 2
    for (const c of [knight2, bloodTax, nonApoc]) {
      engine.zoneMgr.moveCard(c.instanceId, 'BATTLEFIELD', { isFaceUp: true });
      state.cards[assist59.instanceId]!.underneathCardIds.push(c.instanceId);
    }
    const orb1 = findCards(engine, 'p1', 'ST01-013')[0]!;
    const orb2 = Object.values(state.cards).find(
      (c) => c.ownerPlayerId === 'p1' && c.instanceId !== orb1.instanceId && c.zone !== 'BATTLEFIELD' && Boolean(db.getCard(c.cardNumber)?.signalOrb)
    )!;
    engine.zoneMgr.moveCard(orb1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orb2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    const act = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: assist59.instanceId,
      abilityIndex: 0,
    });
    expect(act.success, act.error).toBe(true);
    if (state.currentPendingChoice?.effectType === 'DSL_BP04_059_ORB_COST') {
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: 'p1',
        pendingChoiceId: state.currentPendingChoice!.id,
        selectedIds: [state.currentPendingChoice!.options[0]!.id],
      });
    }
    const mod = state.players['p1']!.costModifiers?.at(-1);
    expect(mod?.amount).toBe(2);
    expect(mod?.targetTrait).toBe('神寂启示录');
  });

  it('12. PR-015 位于《七实·遥星之座》下方赋予离场【自】，离场消2球从墓地拉《帕瓦》', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP01-040', 'PR-015', 'BP01-049', 'ST01-012', 'ST01-013']),
      expandDeck('ST02')
    );
    const state = engine.getState();

    const nanami = findCards(engine, 'p1', 'BP01-040')[0]!;
    const pr015 = findCards(engine, 'p1', 'PR-015')[0]!;
    const pawa = findCards(engine, 'p1', 'BP01-049')[0]!;
    const orb1 = findCards(engine, 'p1', 'ST01-012')[0]!;
    const orb2 = findCards(engine, 'p1', 'ST01-013')[0]!;

    engine.fieldMgr.playRoleCard('p1', nanami.instanceId, 0);
    engine.zoneMgr.moveCard(pr015.instanceId, 'BATTLEFIELD', { isFaceUp: true });
    state.cards[nanami.instanceId]!.underneathCardIds = [pr015.instanceId];
    engine.zoneMgr.moveCard(pawa.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(orb1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orb2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    // 验证宿主确实获得了 PR_015_GRANTED_HOST_LEFT_FIELD
    expect(engine.continuousEffects.getGrantedTriggerKeys(nanami.instanceId, 'PR_015_GRANTED_HOST_LEFT_FIELD')).toHaveLength(1);

    // 令宿主离场 -> 触发离场【自】
    engine.zoneMgr.moveCard(nanami.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.checkTimingMgr.resolveCheckTiming();

    expect(state.currentPendingChoice?.effectType).toBe('PRESET_PR_015_ORB');
    const orbOpt = state.currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [orbOpt.id],
    });
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_PR_015_REVIVE');
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [pawa.instanceId],
    });
    expect(state.cards[pawa.instanceId]!.zone).toBe('BATTLEFIELD');
  });

  it('13. PR-020《杼菱》第2项送墓升变角色后，从自身下方效果无效出场费用<=明费上限的升变角色', () => {
    const engine = createEngine(
      expandDeck('ST01', ['PR-020', 'BP02-001', 'BP01-075', 'BP01-075']),
      expandDeck('ST02')
    );
    const state = engine.getState();

    const pr020 = findCards(engine, 'p1', 'PR-020')[0]!;
    const ishmael = findCards(engine, 'p1', 'BP02-001')[0]!;
    const kamuis = findCards(engine, 'p1', 'BP01-075'); // 非空升变角色 cost=4
    const fieldAsc = kamuis[0]!;
    const underAsc = kamuis[1]!;

    engine.fieldMgr.playRoleCard('p1', ishmael.instanceId, 0);
    engine.fieldMgr.playRoleCard('p1', fieldAsc.instanceId, 1);
    engine.fieldMgr.playAssistCard('p1', pr020.instanceId, 2);
    engine.zoneMgr.moveCard(underAsc.instanceId, 'BATTLEFIELD', { isFaceUp: true });
    state.cards[pr020.instanceId]!.underneathCardIds = [underAsc.instanceId];
    fillCostZone(engine, 'p1', 4); // 明费上限 = 4 >= underAsc.cost(4)

    const act = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: pr020.instanceId,
      abilityIndex: 0,
    });
    expect(act.success, act.error).toBe(true);
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: ['swap_asc_from_underneath'],
    });
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_PR_020_SAC');
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [fieldAsc.instanceId],
    });
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_PR_020_DEPLOY');
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [underAsc.instanceId],
    });

    expect(state.cards[fieldAsc.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[underAsc.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(engine.continuousEffects.evaluateCard(underAsc.instanceId).abilitiesLost).toBe(true);
  });

  it('14. PR-028《熠空》过滤 isAirborne 且第2项将处理区浮空《露西亚·誓焰》加入手牌', () => {
    const engine = createEngine(
      expandDeck('ST01', ['PR-028', 'BP03-002', 'BP03-004']),
      expandDeck('ST02')
    );
    const state = engine.getState();

    const pr028 = findCards(engine, 'p1', 'PR-028')[0]!;
    const nonAirborne = findCards(engine, 'p1', 'BP03-004')[0]!;
    const airborne = findCards(engine, 'p1', 'BP03-002')[0]!;

    engine.fieldMgr.playAssistCard('p1', pr028.instanceId, 0);
    // 放一张非浮空（仅普通在处理区）的《露西亚·誓焰》 -> 第 1 项不应抽牌
    engine.zoneMgr.moveCard(nonAirborne.instanceId, 'PROCESSING', { isFaceUp: true });
    const handBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: pr028.instanceId,
      abilityIndex: 0,
    });
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: ['draw_if_airborne'],
    });
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore);

    // 竖直 PR-028，将 airborne 真正浮空至处理区 -> 第 2 项仅可选浮空者并加入手牌
    state.cards[pr028.instanceId]!.isReady = true;
    engine.zoneMgr.moveCard(airborne.instanceId, 'HAND');
    expect(engine.fieldMgr.airborneRole(airborne.instanceId)).toBe(true);

    engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: pr028.instanceId,
      abilityIndex: 0,
    });
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: ['return_airborne_to_hand'],
    });
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_PR_028_RETURN');
    expect(state.currentPendingChoice!.options.map((o) => o.id)).toEqual([airborne.instanceId]);
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [airborne.instanceId],
    });
    expect(state.cards[airborne.instanceId]!.zone).toBe('HAND');
    expect(state.cards[airborne.instanceId]!.isAirborne).toBeUndefined();
  });

  it('15. PR-041《肃噩》变角色期间不被新辅助机误杀，且置入《露娜·终焉》下方时同步转移原下方牌', () => {
    const engine = createEngine(
      expandDeck('ST01', ['PR-041', 'PR-028', 'BP04-002', 'BP02-003']),
      expandDeck('ST02')
    );
    const state = engine.getState();

    const pr041 = findCards(engine, 'p1', 'PR-041')[0]!;
    const secondAssist = findCards(engine, 'p1', 'PR-028')[0]!;
    const luna = findCards(engine, 'p1', 'BP04-002')[0]!;
    const voidCard = findCards(engine, 'p1', 'BP02-003')[0]!;

    engine.fieldMgr.playAssistCard('p1', pr041.instanceId, 0);
    engine.fieldMgr.playRoleCard('p1', luna.instanceId, 1);
    engine.zoneMgr.moveCard(voidCard.instanceId, 'HAND');

    // 触发 PR-041 回合结束变身为角色牌，并将 voidCard 置入其下方
    engine.triggerMgr.emit({ type: 'END_PHASE_TRIGGERS', playerId: 'p1' });
    engine.checkTimingMgr.resolveCheckTiming();
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_PR_041_CONFIRM');
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: ['opt_yes'],
    });
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [voidCard.instanceId],
    });
    expect(engine.continuousEffects.getEffectiveCardType(pr041.instanceId)).toBe('ROLE');
    expect(state.cards[pr041.instanceId]!.underneathCardIds).toContain(voidCard.instanceId);

    // 不可覆盖 PR-041 所在卡位 0，但在空卡位 2 放置新辅助机时，变身中的 PR-041 严禁被误杀送墓
    expect(engine.fieldMgr.playAssistCard('p1', secondAssist.instanceId, 0)).toBe(false);
    expect(engine.fieldMgr.playAssistCard('p1', secondAssist.instanceId, 2)).toBe(true);
    expect(state.cards[pr041.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(state.cards[secondAssist.instanceId]!.zone).toBe('BATTLEFIELD');

    // 移除本回合「不能被置入下方」限制（模拟下回合），发动 PR-041 【起】移入《露娜·终焉》下方
    state.cards[pr041.instanceId]!.modifiers = (state.cards[pr041.instanceId]!.modifiers ?? []).filter(
      (m) => !m.prohibitions?.includes('CANNOT_BE_PLACED_UNDERNEATH')
    );
    const act = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: pr041.instanceId,
      abilityIndex: 0,
    });
    expect(act.success, act.error).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_PR_041_LUNA');
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [luna.instanceId],
    });

    // PR-041 本体与原下方的 voidCard 都必须在《露娜·终焉》下方，而非送墓
    expect(state.cards[luna.instanceId]!.underneathCardIds).toContain(pr041.instanceId);
    expect(state.cards[luna.instanceId]!.underneathCardIds).toContain(voidCard.instanceId);
    expect(state.cards[voidCard.instanceId]!.zone).toBe('BATTLEFIELD');
  });
});
