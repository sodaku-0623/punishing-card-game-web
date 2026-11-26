import { describe, it, expect } from 'vitest';
import { CardType } from '@zhanshuang/shared';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import {
  GameEngine,
  MemoryCardDatabase,
  OFFICIAL_CARDS_DATA,
  addCardModifier,
  getAttachedEquipmentIds,
} from '../src/index.js';
import { endTurn, fillCostZone, passInstantWindows, resolvePendingChoices } from './helpers.js';

const db = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);
const coveredCardNumbers = new Set<string>();

/** 专用于填充五属性明费的垫底白板卡 */
const ATTR_PADS = ['ST01-006', 'ST02-005', 'ST04-006', 'BP01-019', 'BP01-048'] as const;

function buildDeck(
  extras: string[],
  basePack: 'ST01' | 'ST02' | 'ST03' | 'ST04' | 'ST05' | 'ST06' = 'ST01'
): string[] {
  let pool: string[] = [];
  if (basePack === 'ST01' || basePack === 'ST02' || basePack === 'ST03') {
    const deckDef = OFFICIAL_STARTER_DECKS.find((d) => d.name.includes(`(${basePack})`))!;
    for (const item of deckDef.cards) {
      for (let i = 0; i < item.count; i++) pool.push(item.cardNumber);
    }
  } else {
    const packCards = OFFICIAL_CARDS_DATA.filter((c) => c.cardNumber.startsWith(`${basePack}-`)).map(
      (c) => c.cardNumber
    );
    while (pool.length < 50) pool.push(...packCards);
    pool = pool.slice(0, 50);
  }
  return [...extras, ...ATTR_PADS, ...pool].slice(0, 50);
}

function createEngine(p1Deck: string[], p2Deck: string[], seed = 20261126): GameEngine {
  const engine = new GameEngine(
    `stage4b-${seed}`,
    { playerId: 'p1', deckCardNumbers: p1Deck },
    { playerId: 'p2', deckCardNumbers: p2Deck },
    seed,
    db,
    { skipMulligan: true }
  );
  const chargeIfNeeded = () => {
    const st = engine.getState();
    if (st.phase === 'DRAW_CHARGE_PHASE') {
      const hand = engine.zoneMgr.getCardsInZone(st.activePlayerId, 'HAND');
      engine.dispatchAction({
        type: 'CHARGE_COST_FROM_HAND',
        playerId: st.activePlayerId,
        cardInstanceId: hand[0]?.instanceId,
      });
    }
  };
  chargeIfNeeded();
  if (engine.getState().activePlayerId !== 'p1') {
    endTurn(engine);
    chargeIfNeeded();
  }
  return engine;
}

function advanceTurnTo(engine: GameEngine, targetPlayerId: string): void {
  for (let i = 0; i < 10; i++) {
    resolvePendingChoices(engine);
    const st = engine.getState();
    if (st.activePlayerId === targetPlayerId && st.phase === 'MAIN_PHASE') return;
    if (st.phase === 'DRAW_CHARGE_PHASE') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: st.activePlayerId });
    } else if (st.phase === 'END_PHASE') {
      if (st.timingWindow) passInstantWindows(engine);
      resolvePendingChoices(engine);
      if (st.phase === 'END_PHASE' && !st.currentPendingChoice && !st.timingWindow) {
        engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: st.activePlayerId });
      }
    } else {
      endTurn(engine);
    }
  }
}

function findCard(
  engine: GameEngine,
  playerId: string,
  cardNumber: string,
  index = 0,
  excludeIds: Set<string> = new Set()
) {
  const matches = Object.values(engine.getState().cards).filter(
    (c) => c.controllerPlayerId === playerId && c.cardNumber === cardNumber && !excludeIds.has(c.instanceId)
  );
  const card = matches[index];
  if (!card) throw new Error(`未找到卡牌 ${playerId}/${cardNumber}[${index}]`);
  return card;
}

function setupOpenCost(
  engine: GameEngine,
  playerId: string,
  attrCardNumbers: string[],
  totalCount: number,
  reserveIds: Set<string> = new Set()
): void {
  for (const c of engine.zoneMgr.getCardsInZone(playerId, 'COST')) {
    engine.zoneMgr.moveCardToBottomOfDeck(c.instanceId);
  }
  for (const num of attrCardNumbers) {
    const c = Object.values(engine.getState().cards).find(
      (x) =>
        x.controllerPlayerId === playerId &&
        x.cardNumber === num &&
        x.zone !== 'COST' &&
        !reserveIds.has(x.instanceId)
    );
    if (c) engine.zoneMgr.moveCard(c.instanceId, 'COST', { isFaceUp: true, isReady: true });
  }
  // 先用非保留卡补齐费用，再 sync
  let costCount = engine.zoneMgr.getCardsInZone(playerId, 'COST').filter((c) => c.isFaceUp).length;
  for (const deckCard of engine.zoneMgr.getCardsInZone(playerId, 'DECK')) {
    if (costCount >= totalCount) break;
    if (reserveIds.has(deckCard.instanceId)) continue;
    engine.zoneMgr.moveCard(deckCard.instanceId, 'COST', { isFaceUp: true, isReady: true });
    costCount++;
  }
  if (costCount < totalCount) {
    fillCostZone(engine, playerId, totalCount);
  }
  engine.zoneMgr.syncCostStats(playerId);
}

function refreshCost(engine: GameEngine, playerId: string, minTotal = 10): void {
  fillCostZone(engine, playerId, minTotal);
  engine.zoneMgr.syncCostStats(playerId);
}

function setOrbs(engine: GameEngine, playerId: string, orbNumbers: string[]): string[] {
  for (const old of engine.zoneMgr.getCardsInZone(playerId, 'SIGNAL_ORB')) {
    engine.zoneMgr.moveCardToBottomOfDeck(old.instanceId);
  }
  const placed: string[] = [];
  for (const num of orbNumbers) {
    const card = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === playerId && c.cardNumber === num && c.zone !== 'SIGNAL_ORB'
    );
    if (!card) throw new Error(`无可用信号球 ${num}`);
    engine.zoneMgr.moveCard(card.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    placed.push(card.instanceId);
  }
  return placed;
}

function putNonOrbOnTop(engine: GameEngine, playerId: string): void {
  const card = engine.zoneMgr
    .getCardsInZone(playerId, 'DECK')
    .find((c) => !db.getCard(c.cardNumber)?.signalOrb);
  if (card) engine.zoneMgr.moveCardToTopOfDeck(card.instanceId);
}

function playCard(
  engine: GameEngine,
  playerId: string,
  cardInstanceId: string,
  extra: Record<string, unknown> = {}
) {
  const card = engine.getState().cards[cardInstanceId]!;
  if (card.zone !== 'HAND' && card.zone !== 'GRAVEYARD') {
    engine.zoneMgr.moveCard(cardInstanceId, 'HAND', { isFaceUp: true });
  }
  const res = engine.dispatchAction({
    type: 'PLAY_CARD',
    playerId,
    cardInstanceId,
    ...extra,
  } as Parameters<GameEngine['dispatchAction']>[0]);
  if (res.success) coveredCardNumbers.add(card.cardNumber);
  return res;
}

function mustPlay(
  engine: GameEngine,
  playerId: string,
  cardInstanceId: string,
  extra: Record<string, unknown> = {}
) {
  const card = engine.getState().cards[cardInstanceId]!;
  const res = playCard(engine, playerId, cardInstanceId, extra);
  expect(res.success, `打出 ${card.cardNumber} 失败: ${res.error}`).toBe(true);
  return res;
}

function mustUseInstant(engine: GameEngine, playerId: string, cardInstanceId: string) {
  const card = engine.getState().cards[cardInstanceId]!;
  if (card.zone !== 'HAND') {
    engine.zoneMgr.moveCard(cardInstanceId, 'HAND', { isFaceUp: true });
  }
  const res = engine.dispatchAction({
    type: 'USE_INSTANT',
    playerId,
    cardInstanceId,
  });
  expect(res.success, `使用瞬时 ${card.cardNumber} 失败: ${res.error}`).toBe(true);
  coveredCardNumbers.add(card.cardNumber);
  return res;
}

function pickChoice(engine: GameEngine, selectedIds: string[], playerId?: string) {
  const ch = engine.getState().currentPendingChoice;
  expect(ch, '预期存在待处理决策').toBeDefined();
  return engine.dispatchAction({
    type: 'SELECT_CHOICE_OPTION',
    playerId: playerId ?? ch!.playerId,
    pendingChoiceId: ch!.id,
    selectedIds,
  });
}

function mustPick(engine: GameEngine, selectedIds: string[], playerId?: string) {
  const ch = engine.getState().currentPendingChoice;
  const res = pickChoice(engine, selectedIds, playerId);
  expect(res.success, `决策 ${ch?.effectType} 选择 ${selectedIds.join(',')} 失败: ${res.error}`).toBe(true);
  return res;
}

function expectOrderAndPickReversed(
  engine: GameEngine,
  expectedEffectType: string,
  expectedCount: number
): string[] {
  const ch = engine.getState().currentPendingChoice;
  expect(ch?.effectType).toBe(expectedEffectType);
  expect(ch!.options).toHaveLength(expectedCount);
  const ordered = ch!.options.map((o) => o.id).reverse();
  mustPick(engine, ordered);
  return ordered;
}

function finishCombat(engine: GameEngine, defenderId = 'p2'): void {
  const st = engine.getState();
  for (let guard = 0; guard < 12 && st.currentCombat && !st.winnerId; guard++) {
    resolvePendingChoices(engine);
    if (st.timingWindow) {
      passInstantWindows(engine);
    }
    if (st.currentCombat?.step === 'BLOCK') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: defenderId });
      passInstantWindows(engine);
    }
    resolvePendingChoices(engine);
  }
}

describe('Stage 4B 第一部分：ST01~ST06 精度修复、漏测卡与全 83 卡真打回归', () => {
  it('ST01-002 【出】chargeIsAbility=true：赋予<灰鸦小队>【充能+1】，失能后随能力一并失去', () => {
    const engine = createEngine(
      buildDeck(['ST01-002', 'ST01-005', 'ST01-012', 'ST01-006'], 'ST01'),
      buildDeck([], 'ST02')
    );
    const state = engine.getState();
    const ally = findCard(engine, 'p1', 'ST01-005'); // 基础充能 1 (无【充能0】)
    const li = findCard(engine, 'p1', 'ST01-002');
    setupOpenCost(engine, 'p1', ['ST01-006'], 6, new Set([ally.instanceId, li.instanceId]));

    mustPlay(engine, 'p1', ally.instanceId, { targetSlotIndex: 0 });
    resolvePendingChoices(engine);
    expect(engine.combatMgr.calculateRoleChargeCount(ally.instanceId)).toBe(1);

    const orb = findCard(engine, 'p1', 'ST01-012');
    refreshCost(engine, 'p1', 8);
    engine.zoneMgr.moveCardToTopOfDeck(orb.instanceId);
    mustPlay(engine, 'p1', li.instanceId, { targetSlotIndex: 1 });
    mustPick(engine, ['opt_yes']);
    mustPick(engine, [ally.instanceId]);
    expect(engine.combatMgr.calculateRoleChargeCount(ally.instanceId)).toBe(2);

    // 施加外部失能 (官方卡表暂无我方回合对己方角色的失能牌)，刷新帧缓存后 chargeIsAbility 随能力丢失回到 1
    addCardModifier(state, state.cards[ally.instanceId]!, { loseAbilities: true, untilTurn: state.turnNumber, source: 'EXT_LOSE' });
    engine.continuousEffects.invalidateEvalFrame();
    expect(engine.combatMgr.calculateRoleChargeCount(ally.instanceId)).toBe(1);
  });

  it('ST03-003 弃牌分支、BP02-066 CANNOT_ELIMINATE 拦截、BP01-037 作1球消除且不误置三消', () => {
    // 1. 弃牌分支 + BP02-066 封锁信号球拦截
    const engine1 = createEngine(
      buildDeck(['ST03-003', 'ST03-006', 'ST03-009', 'ST03-012', 'ST03-013'], 'ST03'),
      buildDeck(['BP02-066', 'ST04-009', 'ST04-005', 'ST04-005'], 'ST04')
    );
    const st1 = engine1.getState();
    const vera03 = findCard(engine1, 'p1', 'ST03-003');
    const orb1 = setOrbs(engine1, 'p1', ['ST03-012'])[0]!;
    const handFodder = findCard(engine1, 'p1', 'ST03-013');
    const c21 = findCard(engine1, 'p1', 'ST03-006');
    const partner = findCard(engine1, 'p1', 'ST03-009');

    // 由 p2 升变打出 BP02-066 万事·明晰梦，封锁 p1 的信号球 orb1 (CANNOT_ELIMINATE)
    advanceTurnTo(engine1, 'p2');
    const wanshiBase = findCard(engine1, 'p2', 'ST04-009');
    const wanshi66 = findCard(engine1, 'p2', 'BP02-066');
    setupOpenCost(engine1, 'p2', ['ST04-006'], 10, new Set([wanshiBase.instanceId, wanshi66.instanceId]));
    mustPlay(engine1, 'p2', wanshiBase.instanceId, { targetSlotIndex: 0 });
    refreshCost(engine1, 'p2', 10);
    mustPlay(engine1, 'p2', wanshi66.instanceId, { isAscension: true, targetAscensionCardId: wanshiBase.instanceId });
    if (st1.currentPendingChoice?.effectType === 'CHOOSE_TRIGGER_ORDER') {
      const lockOpt = st1.currentPendingChoice.options.find((o) => o.label.includes('封锁'))!;
      mustPick(engine1, [lockOpt.id], 'p2');
    }
    mustPick(engine1, [orb1], 'p2');
    resolvePendingChoices(engine1);

    // 回到 p1 回合：打出 ST03-003，唯一信号球 orb1 被禁止消除，走弃牌分支
    advanceTurnTo(engine1, 'p1');
    engine1.zoneMgr.moveCard(handFodder.instanceId, 'HAND', { isFaceUp: true });
    setupOpenCost(engine1, 'p1', ['ST02-005'], 8, new Set([vera03.instanceId, handFodder.instanceId, c21.instanceId, partner.instanceId]));
    engine1.zoneMgr.moveCardToTopOfDeck(c21.instanceId);
    engine1.zoneMgr.moveCardToTopOfDeck(partner.instanceId);
    mustPlay(engine1, 'p1', vera03.instanceId, { targetSlotIndex: 0 });
    expect(st1.currentPendingChoice?.effectType).toBe('PRESET_ST03_003_COST');
    const costOpts = st1.currentPendingChoice!.options.map((o) => o.id);
    expect(costOpts.some((id) => id.startsWith('orb:'))).toBe(false);
    mustPick(engine1, [`hand:${handFodder.instanceId}`]);
    expect(st1.cards[handFodder.instanceId]!.zone).toBe('GRAVEYARD');
    expect(st1.currentPendingChoice?.effectType).toBe('PRESET_ST03_003_PICK');
    mustPick(engine1, [c21.instanceId, partner.instanceId]);
    expect(st1.cards[c21.instanceId]!.zone).toBe('HAND');
    expect(st1.cards[partner.instanceId]!.zone).toBe('HAND');

    // 2. BP01-037 赋予1张信号球 orbValue=3 后，ST03-003 消该单球作1球且不误置 eliminatedThreeOrbsThisTurn
    const engineQu = createEngine(
      buildDeck(['ST03-003', 'BP01-037', 'BP01-032', 'ST03-012'], 'ST03'),
      buildDeck([], 'ST02')
    );
    const stQu = engineQu.getState();
    const quRole = findCard(engineQu, 'p1', 'BP01-032');
    const wsm37 = findCard(engineQu, 'p1', 'BP01-037');
    const vera03b = findCard(engineQu, 'p1', 'ST03-003');
    setupOpenCost(
      engineQu,
      'p1',
      ['ST01-006', 'ST02-005'],
      8,
      new Set([quRole.instanceId, wsm37.instanceId, vera03b.instanceId])
    );
    mustPlay(engineQu, 'p1', quRole.instanceId, { targetSlotIndex: 0 });
    const boostedOrb = setOrbs(engineQu, 'p1', ['ST03-012'])[0]!;
    mustPlay(engineQu, 'p1', wsm37.instanceId);
    mustPick(engineQu, [boostedOrb]);
    expect(engineQu.continuousEffects.getEffectiveOrbInfo(boostedOrb).orbValue).toBe(3);

    mustPlay(engineQu, 'p1', vera03b.instanceId, { targetSlotIndex: 1 });
    mustPick(engineQu, [`orb:${boostedOrb}`]);
    resolvePendingChoices(engineQu);
    expect(stQu.cards[boostedOrb]!.zone).toBe('GRAVEYARD');
    expect(stQu.players['p1']!.eliminatedThreeOrbsThisTurn).toBe(false);
  });

  it('ST03-008 减免<薇拉>升变费用 (移除 excludeAscension 限制)', () => {
    const engine = createEngine(buildDeck(['ST03-008', 'ST03-005', 'ST03-001'], 'ST03'), buildDeck([], 'ST02'));
    const state = engine.getState();
    const c21Cost = findCard(engine, 'p1', 'ST03-008');
    const veraBase = findCard(engine, 'p1', 'ST03-005');
    const veraAsc = findCard(engine, 'p1', 'ST03-001');
    setupOpenCost(
      engine,
      'p1',
      ['ST02-005'],
      8,
      new Set([c21Cost.instanceId, veraBase.instanceId, veraAsc.instanceId])
    );
    mustPlay(engine, 'p1', c21Cost.instanceId, { targetSlotIndex: 0 });
    mustPlay(engine, 'p1', veraBase.instanceId, { targetSlotIndex: 1 });
    refreshCost(engine, 'p1', 8);
    expect(engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: c21Cost.instanceId, abilityIndex: 0 }).success).toBe(true);

    const openBefore = state.players['p1']!.availableOpenCostCount;
    // ST03-001 升变代价 3 费，减免 1 费后仅需支付 2 费
    mustPlay(engine, 'p1', veraAsc.instanceId, { isAscension: true, targetAscensionCardId: veraBase.instanceId });
    resolvePendingChoices(engine);
    expect(state.players['p1']!.availableOpenCostCount).toBe(openBefore - 2);
  });

  it('ST04-002 【自】【回合1】正向消2同色球破坏攻击角色；ST04-010 阻挡抽牌【回合1】限制', () => {
    const engine = createEngine(
      buildDeck(['ST04-002', 'ST04-001', 'ST04-010', 'ST04-012', 'ST04-012'], 'ST04'),
      buildDeck(['ST01-005', 'ST01-006'], 'ST01')
    );
    const state = engine.getState();
    const chrome02 = findCard(engine, 'p1', 'ST04-002');
    const shield = findCard(engine, 'p1', 'ST04-001');
    const apollo = findCard(engine, 'p1', 'ST04-010');
    setupOpenCost(
      engine,
      'p1',
      ['ST04-006'],
      10,
      new Set([chrome02.instanceId, shield.instanceId, apollo.instanceId])
    );
    engine.zoneMgr.moveCard(shield.instanceId, 'GRAVEYARD', { isFaceUp: true });
    mustPlay(engine, 'p1', chrome02.instanceId, { targetSlotIndex: 0 });
    mustPick(engine, [shield.instanceId]);
    refreshCost(engine, 'p1', 10);
    mustPlay(engine, 'p1', apollo.instanceId, { targetSlotIndex: 3 });
    const equipRes = engine.dispatchAction({
      type: 'EQUIP_ITEM',
      playerId: 'p1',
      equipmentCardId: apollo.instanceId,
      targetRoleCardId: chrome02.instanceId,
    });
    expect(equipRes.success, equipRes.error).toBe(true);
    setOrbs(engine, 'p1', ['ST04-012', 'ST04-012']);

    advanceTurnTo(engine, 'p2');
    const atk1 = findCard(engine, 'p2', 'ST01-005');
    const atk2 = findCard(engine, 'p2', 'ST01-006');
    setupOpenCost(engine, 'p2', ['ST01-006'], 10, new Set([atk1.instanceId, atk2.instanceId]));
    mustPlay(engine, 'p2', atk1.instanceId, { targetSlotIndex: 0 });
    resolvePendingChoices(engine);
    refreshCost(engine, 'p2', 10);
    mustPlay(engine, 'p2', atk2.instanceId, { targetSlotIndex: 1 });

    advanceTurnTo(engine, 'p1');
    refreshCost(engine, 'p1', 10);
    advanceTurnTo(engine, 'p2');
    const p1HandBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    putNonOrbOnTop(engine, 'p2');
    putNonOrbOnTop(engine, 'p1');
    expect(engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p2', attackerCardId: atk1.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    passInstantWindows(engine);
    expect(engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: 'p1', blockerCardId: chrome02.instanceId }).success).toBe(true);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(p1HandBefore + 1);
    passInstantWindows(engine);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST04_002_ORB_COST');
    const payOpt = state.currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    mustPick(engine, [payOpt.id], 'p1');
    expect(state.cards[atk1.instanceId]!.zone).toBe('GRAVEYARD');

    expect(engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p2', attackerCardId: atk2.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    if (state.timingWindow?.priorityPlayerId === 'p2') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    }
    mustPlay(engine, 'p1', shield.instanceId);
    mustPick(engine, [chrome02.instanceId], 'p1');
    passInstantWindows(engine);
    const p1HandBeforeSecondBlock = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    expect(engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: 'p1', blockerCardId: chrome02.instanceId }).success).toBe(true);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(p1HandBeforeSecondBlock);
    passInstantWindows(engine);
    resolvePendingChoices(engine);
  });

  it('ST05-004 / ST05-005 / ST05-008 / ST05-009 / ST05-010 真打与修复分支全覆盖', () => {
    const engine = createEngine(
      buildDeck(
        ['ST05-004', 'ST05-005', 'ST05-005', 'ST05-008', 'ST05-009', 'ST05-010', 'ST05-010', 'BP02-021', 'ST05-001', 'ST05-003', 'ST05-006', 'ST05-006', 'ST05-007'],
        'ST05'
      ),
      buildDeck(['ST02-004', 'ST02-005'], 'ST02')
    );
    const state = engine.getState();

    const st05004 = findCard(engine, 'p1', 'ST05-004');
    const st05005 = findCard(engine, 'p1', 'ST05-005', 0);
    const st05005b = findCard(engine, 'p1', 'ST05-005', 1);
    const st05008 = findCard(engine, 'p1', 'ST05-008');
    const st05009 = findCard(engine, 'p1', 'ST05-009');
    const st05010a = findCard(engine, 'p1', 'ST05-010', 0);
    const st05010b = findCard(engine, 'p1', 'ST05-010', 1);
    const bianca21 = findCard(engine, 'p1', 'BP02-021');
    const darkHand = findCard(engine, 'p1', 'ST05-007');
    const darkHand2 = findCard(engine, 'p1', 'ST05-003');
    const darkDelayed = findCard(engine, 'p1', 'ST05-006', 0);
    const biancaInRev = findCard(engine, 'p1', 'ST05-001');
    const reserved = new Set([
      st05004.instanceId,
      st05005.instanceId,
      st05005b.instanceId,
      st05008.instanceId,
      st05009.instanceId,
      st05010a.instanceId,
      st05010b.instanceId,
      bianca21.instanceId,
      darkHand.instanceId,
      darkHand2.instanceId,
      darkDelayed.instanceId,
      biancaInRev.instanceId,
    ]);

    // 1. ST05-009 费用区不足3张《比安卡·晖暮》时拒绝打出
    setupOpenCost(engine, 'p1', ['ST02-005'], 4, reserved);
    expect(playCard(engine, 'p1', st05009.instanceId).success).toBe(false);

    // 2. ST05-005 出场：放1张暗属性手牌到信号球区最下方，抽1张
    engine.zoneMgr.moveCard(darkHand.instanceId, 'HAND', { isFaceUp: true });
    setOrbs(engine, 'p1', ['ST05-011', 'ST05-012']);
    mustPlay(engine, 'p1', st05005.instanceId, { targetSlotIndex: 0 });
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST05_005_PLACE_ORB');
    mustPick(engine, [darkHand.instanceId]);
    expect(engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB')[0]!.instanceId).toBe(darkHand.instanceId);

    // 3. ST05-004 与 BP02-021 装备 ST05-008(奥罗拉)
    setupOpenCost(engine, 'p1', ['ST05-006', 'ST05-006', 'ST05-006'], 10, reserved);
    mustPlay(engine, 'p1', st05004.instanceId, { targetSlotIndex: 1 });
    refreshCost(engine, 'p1', 10);
    mustPlay(engine, 'p1', bianca21.instanceId, { targetSlotIndex: 2 });
    resolvePendingChoices(engine);
    refreshCost(engine, 'p1', 10);
    mustPlay(engine, 'p1', st05008.instanceId, { targetSlotIndex: 3 });
    const equip08Res = engine.dispatchAction({
      type: 'EQUIP_ITEM',
      playerId: 'p1',
      equipmentCardId: st05008.instanceId,
      targetRoleCardId: bianca21.instanceId,
    });
    expect(equip08Res.success, equip08Res.error).toBe(true);

    advanceTurnTo(engine, 'p2');
    const oppA = findCard(engine, 'p2', 'ST02-004');
    const oppB = findCard(engine, 'p2', 'ST02-005');
    setupOpenCost(engine, 'p2', ['ST02-005'], 8, new Set([oppA.instanceId, oppB.instanceId]));
    mustPlay(engine, 'p2', oppA.instanceId, { targetSlotIndex: 0 });
    mustPlay(engine, 'p2', oppB.instanceId, { targetSlotIndex: 1 });

    advanceTurnTo(engine, 'p1');
    const revCards = [
      findCard(engine, 'p1', 'ST05-011', 0, reserved),
      findCard(engine, 'p1', 'ST05-012', 0, reserved),
      findCard(engine, 'p1', 'ST05-013', 0, reserved),
      biancaInRev,
    ];
    revCards.forEach((c) => engine.zoneMgr.moveCardToTopOfDeck(c.instanceId));
    putNonOrbOnTop(engine, 'p2');
    expect(engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p1', attackerCardId: st05004.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST05_004_CONFIRM');
    mustPick(engine, ['opt_yes']);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST05_004_PICK');
    mustPick(engine, [biancaInRev.instanceId]);
    const order04 = expectOrderAndPickReversed(engine, 'DSL_ORDER_MOVE_ST05-004', 3);
    expect(engine.zoneMgr.getCardsInZone('p1', 'DECK').slice(-3).map((c) => c.instanceId)).toEqual(order04);
    finishCombat(engine, 'p2');

    addCardModifier(state, bianca21, {
      loseAbilities: true,
      prohibitions: ['CANNOT_GAIN_ABILITIES'],
      untilTurn: state.turnNumber,
      source: 'EXT_DEBUFF',
    });
    engine.continuousEffects.invalidateEvalFrame();
    engine.zoneMgr.moveCard(darkHand2.instanceId, 'HAND', { isFaceUp: true });
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p1', attackerCardId: bianca21.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST05_008_PLACE_ORB');
    mustPick(engine, [darkHand2.instanceId]);
    expect(state.players['p1']!.turnAbilityUsage[`${st05008.instanceId}:ST05_008_EQUIP_ATTACK`]).toBe(1);
    finishCombat(engine, 'p2');

    bianca21.modifiers = [];
    engine.continuousEffects.invalidateEvalFrame();
    // 奇数费用 (3费 ST05-005) 在 index 0，保持晖形态，随后接2张同色球竖直 bianca21
    setOrbs(engine, 'p1', ['ST05-005', 'ST05-011', 'ST05-011']);
    expect(engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: bianca21.instanceId, abilityIndex: 0 }).success).toBe(true);
    expect(bianca21.isReady).toBe(true);
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p1', attackerCardId: bianca21.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    expect(state.currentPendingChoice?.effectType).not.toBe('PRESET_ST05_008_PLACE_ORB');

    if (state.timingWindow?.priorityPlayerId !== 'p1') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: state.timingWindow!.priorityPlayerId });
    }
    mustPlay(engine, 'p1', st05010a.instanceId);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST05_010_MODE');
    expect(state.currentPendingChoice?.minSelections).toBe(0);
    expect(state.currentPendingChoice?.maxSelections).toBe(2);
    mustPick(engine, []);
    finishCombat(engine, 'p2');

    // 切至偶数(ST05-011 0费) 并保证费用区至少3张《比安卡·晖暮》
    setOrbs(engine, 'p1', ['ST05-011', 'ST05-012', 'ST05-013']);
    for (const c of [
      findCard(engine, 'p1', 'ST05-002', 0, reserved),
      findCard(engine, 'p1', 'ST05-002', 1, reserved),
      findCard(engine, 'p1', 'ST05-006', 0, reserved),
    ]) {
      engine.zoneMgr.moveCard(c.instanceId, 'COST', { isFaceUp: true, isReady: true });
    }
    refreshCost(engine, 'p1', 10);
    mustPlay(engine, 'p1', st05009.instanceId);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST05_009_FIRST');
    mustPick(engine, [oppA.instanceId]);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST05_009_SECOND');
    mustPick(engine, [oppB.instanceId]);
    expect(state.cards[oppA.instanceId]!.zone).toBe('GRAVEYARD');
    expect(engine.fieldMgr.calculateRoleEffectivePP(oppB.instanceId)).toBe(3000);

    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p1', attackerCardId: st05005.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    if (state.timingWindow?.priorityPlayerId !== 'p1') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: state.timingWindow!.priorityPlayerId });
    }
    mustPlay(engine, 'p1', st05010b.instanceId);
    expect(state.currentPendingChoice?.minSelections).toBe(1);
    expect(state.currentPendingChoice?.maxSelections).toBe(1);
    expect(pickChoice(engine, []).success).toBe(false);
    expect(pickChoice(engine, ['mode_draw', 'mode_buff']).success).toBe(false);
    mustPick(engine, ['mode_draw']);
    finishCombat(engine, 'p2');

    refreshCost(engine, 'p1', 10);
    engine.zoneMgr.moveCard(darkDelayed.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p1', st05005b.instanceId, { targetSlotIndex: 3 });
    mustPick(engine, [darkDelayed.instanceId]);
    endTurn(engine);
    while (state.currentPendingChoice && state.activePlayerId === 'p1') {
      resolvePendingChoices(engine);
      if (state.timingWindow) passInstantWindows(engine);
    }
    expect(state.cards[darkDelayed.instanceId]!.zone).toBe('GRAVEYARD');
  });

  it('ST06-001 / ST06-002 / ST06-003 / ST06-006 / ST06-010 / ST06-011 全精准分支校验', () => {
    const engine = createEngine(
      buildDeck(
        ['ST06-001', 'ST06-002', 'ST06-003', 'ST06-003', 'ST06-006', 'ST06-008', 'ST06-009', 'ST06-010', 'ST06-010', 'ST06-011', 'ST06-013'],
        'ST06'
      ),
      buildDeck(['BP01-025', 'BP01-014', 'BP01-019', 'ST01-005', 'ST01-006'], 'ST01')
    );
    const state = engine.getState();

    // 1. ST06-011 无协战回手分支
    advanceTurnTo(engine, 'p2');
    const oppRole = findCard(engine, 'p2', 'ST01-005');
    setupOpenCost(engine, 'p2', ['ST01-006'], 10, new Set([oppRole.instanceId]));
    mustPlay(engine, 'p2', oppRole.instanceId, { targetSlotIndex: 0 });
    resolvePendingChoices(engine);

    advanceTurnTo(engine, 'p1');
    const alisa03 = findCard(engine, 'p1', 'ST06-003', 0);
    const alisa03b = findCard(engine, 'p1', 'ST06-003', 1);
    const alisa01 = findCard(engine, 'p1', 'ST06-001');
    const cecil06 = findCard(engine, 'p1', 'ST06-006');
    const cecil02 = findCard(engine, 'p1', 'ST06-002');
    const equip10 = findCard(engine, 'p1', 'ST06-010', 0);
    const equip10b = findCard(engine, 'p1', 'ST06-010', 1);
    const gyCecil = findCard(engine, 'p1', 'ST06-009');
    const gyCecil2 = findCard(engine, 'p1', 'ST06-008');
    const st06011 = findCard(engine, 'p1', 'ST06-011');
    const res1 = new Set([
      alisa03.instanceId,
      alisa03b.instanceId,
      alisa01.instanceId,
      cecil06.instanceId,
      cecil02.instanceId,
      equip10.instanceId,
      equip10b.instanceId,
      gyCecil.instanceId,
      gyCecil2.instanceId,
      st06011.instanceId,
    ]);
    setupOpenCost(engine, 'p1', ['ST01-006', 'ST02-005', 'ST04-006', 'BP01-019', 'BP01-048'], 10, res1);
    mustPlay(engine, 'p1', alisa03.instanceId, { targetSlotIndex: 0 });
    expect(engine.continuousEffects.evaluateCard(alisa03.instanceId).dp).toBe(1);

    mustPlay(engine, 'p1', st06011.instanceId);
    mustPick(engine, [oppRole.instanceId]);
    expect(state.cards[oppRole.instanceId]!.zone).toBe('HAND');

    // 推进到下个 p1 回合以便 alisa03 可以宣攻进入自由时点 (8.13.3.a)
    advanceTurnTo(engine, 'p2');
    advanceTurnTo(engine, 'p1');

    // 2. ST06-006 协战搭档：我方回合 PP+1500 & chargeIsAbility=true，宿主失能后失充能保 PP+1500，对方回合全失效
    refreshCost(engine, 'p1', 10);
    engine.zoneMgr.moveCard(cecil06.instanceId, 'HAND', { isFaceUp: true });
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p1', attackerCardId: alisa03.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    const assist06Res = engine.dispatchAction({
      type: 'PERFORM_ASSIST',
      playerId: 'p1',
      hostRoleCardId: alisa03.instanceId,
      partnerCardId: cecil06.instanceId,
    });
    expect(assist06Res.success, assist06Res.error).toBe(true);
    coveredCardNumbers.add('ST06-006');
    // 攻击中协战加成：基础 3000 + 搭档 3000 + ST06-006(+1500) = 7500；基本充能1 + ST06-006(+1) = 2
    expect(engine.fieldMgr.calculateRoleEffectivePP(alisa03.instanceId)).toBe(7500);
    expect(engine.combatMgr.calculateRoleChargeCount(alisa03.instanceId)).toBe(2);
    finishCombat(engine, 'p2');
    expect(engine.fieldMgr.calculateRoleEffectivePP(alisa03.instanceId)).toBe(7500);
    expect(engine.combatMgr.calculateRoleChargeCount(alisa03.instanceId)).toBe(2);

    addCardModifier(state, alisa03, { loseAbilities: true, untilTurn: state.turnNumber, source: 'EXT_LOSE' });
    engine.continuousEffects.invalidateEvalFrame();
    expect(engine.fieldMgr.calculateRoleEffectivePP(alisa03.instanceId)).toBe(7500);
    expect(engine.combatMgr.calculateRoleChargeCount(alisa03.instanceId)).toBe(1);
    alisa03.modifiers = [];
    engine.continuousEffects.invalidateEvalFrame();

    // ST06-001 【出】存在协战角色时获得【速攻】
    refreshCost(engine, 'p1', 10);
    mustPlay(engine, 'p1', alisa01.instanceId, { targetSlotIndex: 1 });
    expect(engine.continuousEffects.evaluateCard(alisa01.instanceId).keywords).toContain('速攻');

    // ST06-002 非手牌成搭档回合末解除 & 蓝球竖直费用区
    const tappedAlisaCost = findCard(engine, 'p1', 'ST06-007', 0, res1);
    const blueOrb = setOrbs(engine, 'p1', ['ST06-013'])[0]!;
    refreshCost(engine, 'p1', 10);
    const curCostBefore02 = engine.zoneMgr.getCardsInZone('p1', 'COST');
    if (curCostBefore02.length >= 10) {
      const popTarget = curCostBefore02.find((c) => c.instanceId !== tappedAlisaCost.instanceId) ?? curCostBefore02[curCostBefore02.length - 1]!;
      engine.zoneMgr.moveCardToBottomOfDeck(popTarget.instanceId);
    }
    engine.zoneMgr.moveCard(tappedAlisaCost.instanceId, 'COST', { isFaceUp: true, isReady: false });
    engine.zoneMgr.syncCostStats('p1');
    mustPlay(engine, 'p1', cecil02.instanceId, { targetSlotIndex: 2 });
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p1', attackerCardId: alisa01.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    expect(
      engine.dispatchAction({
        type: 'PERFORM_ASSIST',
        playerId: 'p1',
        hostRoleCardId: alisa01.instanceId,
        partnerCardId: cecil02.instanceId,
      }).success
    ).toBe(true);
    coveredCardNumbers.add('ST06-002');
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST06_002_ORB_COST');
    mustPick(engine, [blueOrb]);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST06_002_READY_COST');
    mustPick(engine, [tappedAlisaCost.instanceId]);
    expect(tappedAlisaCost.isReady).toBe(true);
    finishCombat(engine, 'p2');

    // 切到 p2：非手牌成搭档的 ST06-002 在回合末解除置入墓地 (8.13.4.c)；ST06-006 对方回合失效
    advanceTurnTo(engine, 'p2');
    expect(alisa01.partnerCardId).toBeUndefined();
    expect(state.cards[cecil02.instanceId]!.zone).toBe('GRAVEYARD');
    expect(engine.fieldMgr.calculateRoleEffectivePP(alisa03.instanceId)).toBe(3000);
    expect(engine.combatMgr.calculateRoleChargeCount(alisa03.instanceId)).toBe(1);

    // 回到 p1：测试 ST06-010 2费墓地协战 & 无协战底座拒发 & ST06-003 明费>对方DP=0 与搭档叠加
    advanceTurnTo(engine, 'p1');
    engine.zoneMgr.moveCard(cecil02.instanceId, 'HAND', { isFaceUp: true });
    setupOpenCost(engine, 'p2', ['ST01-006'], 8); // p1=10 > p2=8 -> baseDP=0
    setupOpenCost(engine, 'p1', ['ST01-006', 'ST02-005', 'ST04-006', 'BP01-019', 'BP01-048'], 10, res1);
    expect(engine.continuousEffects.evaluateCard(alisa03.instanceId).dp).toBe(0);
    setupOpenCost(engine, 'p2', ['ST01-006'], 10); // p1=10 <= p2=10 -> baseDP=1
    expect(engine.continuousEffects.evaluateCard(alisa03.instanceId).dp).toBe(1);

    mustPlay(engine, 'p1', equip10.instanceId, { targetSlotIndex: 2 });
    expect(
      engine.dispatchAction({
        type: 'EQUIP_ITEM',
        playerId: 'p1',
        equipmentCardId: equip10.instanceId,
        targetRoleCardId: alisa03.instanceId,
      }).success
    ).toBe(true);
    engine.zoneMgr.moveCard(gyCecil.instanceId, 'GRAVEYARD', { isFaceUp: true });
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p1', attackerCardId: alisa01.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    expect(
      engine.dispatchAction({
        type: 'PERFORM_ASSIST',
        playerId: 'p1',
        hostRoleCardId: alisa01.instanceId,
        partnerCardId: gyCecil.instanceId,
      }).success
    ).toBe(false);
    expect(
      engine.dispatchAction({
        type: 'PERFORM_ASSIST',
        playerId: 'p1',
        hostRoleCardId: alisa01.instanceId,
        partnerCardId: cecil02.instanceId,
      }).success
    ).toBe(true);
    resolvePendingChoices(engine);
    finishCombat(engine, 'p2');
    expect(engine.continuousEffects.evaluateCard(alisa01.instanceId).dp).toBe(2);

    refreshCost(engine, 'p1', 10);
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p1', attackerCardId: alisa03.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    expect(
      engine.dispatchAction({
        type: 'PERFORM_ASSIST',
        playerId: 'p1',
        hostRoleCardId: alisa03.instanceId,
        partnerCardId: gyCecil.instanceId,
      }).success
    ).toBe(true);
    finishCombat(engine, 'p2');

    refreshCost(engine, 'p1', 10);
    mustPlay(engine, 'p1', alisa03b.instanceId, { targetSlotIndex: 3 });
    mustPlay(engine, 'p1', equip10b.instanceId, { targetSlotIndex: 4 });
    expect(
      engine.dispatchAction({
        type: 'EQUIP_ITEM',
        playerId: 'p1',
        equipmentCardId: equip10b.instanceId,
        targetRoleCardId: alisa03b.instanceId,
      }).success
    ).toBe(true);

    advanceTurnTo(engine, 'p2');
    expect(state.cards[alisa01.instanceId]!.partnerCardId).toBe(cecil02.instanceId);
    addCardModifier(state, state.cards[cecil02.instanceId]!, { loseAbilities: true, untilTurn: state.turnNumber, source: 'EXT_LOSE' });
    engine.continuousEffects.invalidateEvalFrame();

    const p2Lucia = findCard(engine, 'p2', 'BP01-014');
    const p2Base = findCard(engine, 'p2', 'BP01-019');
    const p2WindSnow = findCard(engine, 'p2', 'BP01-025');
    setupOpenCost(
      engine,
      'p2',
      ['ST01-006', 'BP01-019'],
      10,
      new Set([p2Lucia.instanceId, p2Base.instanceId, p2WindSnow.instanceId])
    );
    mustPlay(engine, 'p2', p2Base.instanceId, { targetSlotIndex: 0 });
    mustPlay(engine, 'p2', p2Lucia.instanceId, { isAscension: true, targetAscensionCardId: p2Base.instanceId });
    refreshCost(engine, 'p2', 10);
    engine.zoneMgr.moveCard(p2WindSnow.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engine, 'p2', p2WindSnow.instanceId);
    mustPick(engine, [alisa03b.instanceId], 'p2');
    resolvePendingChoices(engine);
    expect(engine.continuousEffects.hasLostInherentAbilities(alisa03b.instanceId)).toBe(true);

    engine.zoneMgr.moveCard(gyCecil2.instanceId, 'GRAVEYARD', { isFaceUp: true });
    putNonOrbOnTop(engine, 'p1');
    putNonOrbOnTop(engine, 'p2');
    expect(engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p2', attackerCardId: p2Lucia.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    if (state.timingWindow?.priorityPlayerId === 'p2') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    }
    expect(
      engine.dispatchAction({
        type: 'PERFORM_ASSIST',
        playerId: 'p1',
        hostRoleCardId: alisa03b.instanceId,
        partnerCardId: gyCecil2.instanceId,
      }).success
    ).toBe(false);
    finishCombat(engine, 'p1');

    endTurn(engine);
    expect(state.cards[cecil02.instanceId]!.zone).toBe('GRAVEYARD');
  });
});

describe('Stage 4B 第二部分：BP01 精度修复、10张0测卡、13张弱测卡与全 88 卡回归', () => {
  it('BP01-037 万世铭：单张可作1/3球、禁单张付2球、[3,1]付2球、[3,1,1]3消；与038伤害充能Q&A·5', () => {
    const engine = createEngine(
      buildDeck(['BP01-032', 'BP01-037', 'BP01-010', 'BP01-078', 'BP01-078', 'BP01-078', 'BP01-078'], 'ST01'),
      buildDeck([], 'ST02')
    );
    const state = engine.getState();
    const qu = findCard(engine, 'p1', 'BP01-032');
    const wsm37 = findCard(engine, 'p1', 'BP01-037');
    const roland = findCard(engine, 'p1', 'BP01-010');
    setupOpenCost(engine, 'p1', ['ST01-006'], 10, new Set([qu.instanceId, wsm37.instanceId, roland.instanceId]));
    mustPlay(engine, 'p1', qu.instanceId, { targetSlotIndex: 0 });

    const [r1, r2, r3, r4] = setOrbs(engine, 'p1', ['BP01-078', 'BP01-078', 'BP01-078', 'BP01-078']);
    mustPlay(engine, 'p1', wsm37.instanceId);
    mustPick(engine, [r1!]);
    expect(engine.continuousEffects.getEffectiveOrbInfo(r1!).orbValue).toBe(3);

    mustPlay(engine, 'p1', roland.instanceId, { targetSlotIndex: 1 });
    expect(state.currentPendingChoice?.effectType).toBe('CHOOSE_TRIGGER_ORDER');
    const grantOpt = state.currentPendingChoice!.options.find((o) => o.label.includes('出2'))!;
    mustPick(engine, [grantOpt.id]);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_BP01_010_ORB_COST');
    const twoOrbOpts = state.currentPendingChoice!.options.map((o) => o.id);
    expect(twoOrbOpts).not.toContain(r1!);
    expect(twoOrbOpts).toContain(`${r1!},${r2!}`);
    mustPick(engine, [`${r1!},${r2!}`]);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_BP01_010_REORDER');
    mustPick(engine, [r4!, r3!]);

    // 2) 在当前回合先铺好 qu34(DP=1)/qu29(DP=1) 并过回合后，于新回合打出 BP01-037 并同回合攻击触发单张作3球 & 伤害充能 Q&A·5
    const engine3 = createEngine(
      buildDeck(['BP01-033', 'BP01-037', 'BP01-029', 'BP01-078', 'BP01-078', 'BP01-078'], 'ST01'),
      buildDeck(['BP01-037', 'BP01-038'], 'ST02')
    );
    const st3 = engine3.getState();
    const qu3 = findCard(engine3, 'p1', 'BP01-033'); // baseDP: 1
    const qu29 = findCard(engine3, 'p1', 'BP01-029');
    const wsm3b = findCard(engine3, 'p1', 'BP01-037');
    setupOpenCost(engine3, 'p1', ['ST01-006'], 10, new Set([qu3.instanceId, qu29.instanceId, wsm3b.instanceId]));
    mustPlay(engine3, 'p1', qu3.instanceId, { targetSlotIndex: 0 });
    mustPlay(engine3, 'p1', qu29.instanceId, { targetSlotIndex: 1 });
    mustPick(engine3, []);

    advanceTurnTo(engine3, 'p2');
    advanceTurnTo(engine3, 'p1');
    refreshCost(engine3, 'p1', 10);
    const [a1, a2, a3] = setOrbs(engine3, 'p1', ['BP01-078', 'BP01-078', 'BP01-078']);
    mustPlay(engine3, 'p1', wsm3b.instanceId);
    mustPick(engine3, [a1!]);
    expect(engine3.continuousEffects.getEffectiveOrbInfo(a1!).orbValue).toBe(3);

    const p2Dmg37 = findCard(engine3, 'p2', 'BP01-037');
    const p2Dmg38 = findCard(engine3, 'p2', 'BP01-038');
    engine3.zoneMgr.moveCardToTopOfDeck(p2Dmg37.instanceId);
    putNonOrbOnTop(engine3, 'p1');
    expect(engine3.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p1', attackerCardId: qu29.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    const orb3Opts = st3.currentPendingChoice!.options.map((o) => o.id);
    expect(orb3Opts).toContain(a1!);
    expect(orb3Opts).toContain(`${a1!},${a2!},${a3!}`);
    mustPick(engine3, [a1!]);
    expect(st3.players['p1']!.eliminatedThreeOrbsThisTurn).toBe(true);
    mustPick(engine3, []);
    passInstantWindows(engine3);

    const p2ErosionBefore = st3.players['p2']!.erosionCount;
    expect(st3.currentPendingChoice?.playerId).toBe('p2');
    mustPick(engine3, ['to_cost'], 'p2');
    expect(st3.cards[p2Dmg37.instanceId]!.zone).toBe('COST');
    expect(st3.cards[p2Dmg37.instanceId]!.isFaceUp).toBe(true);
    expect(st3.cards[p2Dmg37.instanceId]!.isReady).toBe(false);
    expect(st3.players['p2']!.erosionCount).toBe(p2ErosionBefore + 1);

    engine3.zoneMgr.moveCardToTopOfDeck(p2Dmg38.instanceId);
    putNonOrbOnTop(engine3, 'p1');
    expect(engine3.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p1', attackerCardId: qu3.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    passInstantWindows(engine3);
    mustPick(engine3, ['keep'], 'p2');
    expect(st3.cards[p2Dmg38.instanceId]!.zone).toBe('COST');
    expect(st3.cards[p2Dmg38.instanceId]!.isFaceUp).toBe(false);
    expect(st3.cards[p2Dmg38.instanceId]!.isReady).toBe(true);
    expect(st3.players['p2']!.erosionCount).toBe(p2ErosionBefore + 2);
  });

  it('BP01-010 侵蚀<=3仍可消2球 & 双【出】自选顺序；BP01-051 双张叠置止步 DP=2；BP01-040 activates 拒发分支', () => {
    const engine = createEngine(
      buildDeck(['BP01-010', 'BP01-008', 'ST02-004', 'BP01-078', 'BP01-078'], 'ST01'),
      buildDeck([], 'ST02')
    );
    const state = engine.getState();
    const lunaBase = findCard(engine, 'p1', 'ST02-004');
    const luna08 = findCard(engine, 'p1', 'BP01-008');
    const roland10 = findCard(engine, 'p1', 'BP01-010');
    setupOpenCost(
      engine,
      'p1',
      ['ST02-005', 'ST01-006'],
      10,
      new Set([lunaBase.instanceId, luna08.instanceId, roland10.instanceId])
    );
    mustPlay(engine, 'p1', lunaBase.instanceId, { targetSlotIndex: 0 });
    mustPlay(engine, 'p1', luna08.instanceId, { isAscension: true, targetAscensionCardId: lunaBase.instanceId });

    refreshCost(engine, 'p1', 10);
    const orbs = setOrbs(engine, 'p1', ['BP01-078', 'BP01-078']);
    expect(state.players['p1']!.erosionCount).toBe(0);
    mustPlay(engine, 'p1', roland10.instanceId, { targetSlotIndex: 1 });
    expect(state.currentPendingChoice?.effectType).toBe('CHOOSE_TRIGGER_ORDER');
    const reorderOpt = state.currentPendingChoice!.options.find((o) => o.label.includes('出1'))!;
    mustPick(engine, [reorderOpt.id]);
    mustPick(engine, orbs);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_BP01_010_ORB_COST');
    const orbOpt = state.currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    mustPick(engine, [orbOpt.id]);
    expect(engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB')).toHaveLength(0);
    expect(engine.continuousEffects.evaluateCard(luna08.instanceId).keywords).not.toContain('贯通');

    // 2. BP01-051 双张叠置止步 DP=2 & BP01-040 activates 双起空手牌/缺黄球拒发
    const engineN = createEngine(
      buildDeck(
        [
          'BP01-040',
          'BP01-051',
          'BP01-051',
          'BP01-049',
          'BP01-050',
          'BP01-052',
          'BP01-053',
          'BP01-048',
          'BP01-078',
          'BP01-078',
        ],
        'ST01'
      ),
      buildDeck([], 'ST02')
    );
    const stN = engineN.getState();
    const baseNanami = findCard(engineN, 'p1', 'BP01-048');
    const pawaA = findCard(engineN, 'p1', 'BP01-051', 0);
    const pawaB = findCard(engineN, 'p1', 'BP01-051', 1);
    const nanami40 = findCard(engineN, 'p1', 'BP01-040');
    const gyPawa = findCard(engineN, 'p1', 'BP01-049');
    const p50 = findCard(engineN, 'p1', 'BP01-050');
    const p52 = findCard(engineN, 'p1', 'BP01-052');
    const n53 = findCard(engineN, 'p1', 'BP01-053');
    setupOpenCost(
      engineN,
      'p1',
      ['BP01-048'],
      10,
      new Set([
        baseNanami.instanceId,
        pawaA.instanceId,
        pawaB.instanceId,
        nanami40.instanceId,
        gyPawa.instanceId,
        p50.instanceId,
        p52.instanceId,
        n53.instanceId,
      ])
    );
    mustPlay(engineN, 'p1', baseNanami.instanceId, { targetSlotIndex: 0 });
    mustPlay(engineN, 'p1', pawaA.instanceId, { targetSlotIndex: 1 });
    mustPlay(engineN, 'p1', nanami40.instanceId, {
      isAscension: true,
      targetAscensionCardId: baseNanami.instanceId,
      extraAscensionCostCardId: pawaA.instanceId,
    });
    expect(engineN.continuousEffects.evaluateCard(nanami40.instanceId).dp).toBe(2);

    refreshCost(engineN, 'p1', 10);
    mustPlay(engineN, 'p1', pawaB.instanceId, { targetSlotIndex: 1 });
    setOrbs(engineN, 'p1', ['BP01-078', 'BP01-078']);
    expect(engineN.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: pawaB.instanceId, abilityIndex: 0 }).success).toBe(true);
    mustPick(engineN, [nanami40.instanceId]);
    expect(engineN.continuousEffects.evaluateCard(nanami40.instanceId).dp).toBe(2);

    for (const h of engineN.zoneMgr.getCardsInZone('p1', 'HAND')) {
      engineN.zoneMgr.moveCardToBottomOfDeck(h.instanceId);
    }
    expect(
      engineN.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: nanami40.instanceId, abilityIndex: 0 })
        .success
    ).toBe(false);

    engineN.zoneMgr.moveCard(gyPawa.instanceId, 'GRAVEYARD', { isFaceUp: true });
    for (const c of [p50, p52, n53, findCard(engineN, 'p1', 'ST01-004'), findCard(engineN, 'p1', 'ST01-005')]) {
      engineN.zoneMgr.moveCard(c.instanceId, 'BATTLEFIELD', { isFaceUp: true });
      stN.cards[nanami40.instanceId]!.underneathCardIds.push(c.instanceId);
    }
    expect(stN.cards[nanami40.instanceId]!.underneathCardIds.length).toBeGreaterThanOrEqual(7);
    setOrbs(engineN, 'p1', ['BP01-078', 'BP01-078']);
    expect(
      engineN.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: nanami40.instanceId, abilityIndex: 1 })
        .success
    ).toBe(false);

    const fodder = findCard(engineN, 'p1', 'ST01-006');
    engineN.zoneMgr.moveCard(fodder.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engineN.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: nanami40.instanceId, abilityIndex: 0 })
        .success
    ).toBe(true);
    expect(stN.currentPendingChoice?.effectType).toBe('BP01_040_DISCARD');
    mustPick(engineN, [fodder.instanceId]);
    mustPick(engineN, [gyPawa.instanceId]);
    expect(stN.cards[nanami40.instanceId]!.underneathCardIds).toContain(gyPawa.instanceId);
  });

  it('BP01-056/056a/056b 抽1弃1与满2次上限后不弹顺序框；BP01-031 空候选不弹空窗与不中途刷侵蚀+1', () => {
    const engine56 = createEngine(
      buildDeck(
        ['BP01-056', 'BP01-056a', 'BP01-056b', 'BP01-078', 'BP01-078', 'BP01-078', 'BP01-078', 'ST01-001', 'ST01-001', 'ST01-004', 'ST01-004', 'ST01-005', 'ST01-013', 'ST01-013', 'ST01-013', 'ST01-013'],
        'ST01'
      ),
      buildDeck([], 'ST02')
    );
    const st56 = engine56.getState();
    const d56 = findCard(engine56, 'p1', 'BP01-056');
    const d56a = findCard(engine56, 'p1', 'BP01-056a');
    const d56b = findCard(engine56, 'p1', 'BP01-056b');
    const lucia01 = findCard(engine56, 'p1', 'ST01-001', 0);
    const lucia01b = findCard(engine56, 'p1', 'ST01-001', 1);
    const base1 = findCard(engine56, 'p1', 'ST01-004', 0);
    const base2 = findCard(engine56, 'p1', 'ST01-004', 1);
    const ally04 = findCard(engine56, 'p1', 'ST01-005', 0);
    const res56 = new Set([
      d56.instanceId,
      d56a.instanceId,
      d56b.instanceId,
      lucia01.instanceId,
      lucia01b.instanceId,
      base1.instanceId,
      base2.instanceId,
      ally04.instanceId,
    ]);
    setupOpenCost(engine56, 'p1', ['ST01-006'], 10, res56);

    const pickNonReservedHand = () =>
      engine56.zoneMgr.getCardsInZone('p1', 'HAND').find((c) => !res56.has(c.instanceId))?.instanceId ??
      engine56.zoneMgr.getCardsInZone('p1', 'HAND')[0]!.instanceId;

    const handBefore56 = engine56.zoneMgr.getCardsInZone('p1', 'HAND').length;
    mustPlay(engine56, 'p1', d56.instanceId);
    expect(engine56.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore56 + 1);
    mustPick(engine56, [pickNonReservedHand()]);
    expect(st56.cards[d56.instanceId]!.zone).toBe('GRAVEYARD');

    mustPlay(engine56, 'p1', d56a.instanceId);
    mustPick(engine56, [pickNonReservedHand()]);
    mustPlay(engine56, 'p1', d56b.instanceId);
    mustPick(engine56, [pickNonReservedHand()]);

    refreshCost(engine56, 'p1', 10);
    mustPlay(engine56, 'p1', base1.instanceId, { targetSlotIndex: 0 });
    mustPlay(engine56, 'p1', lucia01.instanceId, { isAscension: true, targetAscensionCardId: base1.instanceId });
    resolvePendingChoices(engine56);
    refreshCost(engine56, 'p1', 10);
    mustPlay(engine56, 'p1', ally04.instanceId, { targetSlotIndex: 1 });
    resolvePendingChoices(engine56);

    setOrbs(engine56, 'p1', ['ST01-013', 'ST01-013', 'ST01-013', 'ST01-013']);
    expect(engine56.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: lucia01.instanceId, abilityIndex: 0 }).success).toBe(true);
    expect(st56.currentPendingChoice?.effectType).toBe('PRESET_ORB_COST');
    mustPick(engine56, [st56.currentPendingChoice!.options[0]!.id]);
    mustPick(engine56, [ally04.instanceId]);
    while (st56.currentPendingChoice) {
      const ch = st56.currentPendingChoice;
      if (ch.effectType === 'CHOOSE_TRIGGER_ORDER') {
        mustPick(engine56, [ch.options[0]!.id]);
      } else if (ch.choiceType === 'SELECT_OPTION' && ch.options.some((o) => o.id === 'opt_yes')) {
        mustPick(engine56, ['opt_yes']);
      } else {
        mustPick(engine56, ch.options.slice(0, ch.minSelections).map((o) => o.id));
      }
    }
    expect(st56.players['p1']!.turnAbilityUsage['player:BP01-056:ORB_RETURN']).toBe(2);

    refreshCost(engine56, 'p1', 10);
    mustPlay(engine56, 'p1', base2.instanceId, { targetSlotIndex: 2 });
    mustPlay(engine56, 'p1', lucia01b.instanceId, { isAscension: true, targetAscensionCardId: base2.instanceId });
    resolvePendingChoices(engine56);
    refreshCost(engine56, 'p1', 10);
    mustPlay(engine56, 'p1', ally04.instanceId, { targetSlotIndex: 1 });
    resolvePendingChoices(engine56);
    expect(engine56.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: lucia01b.instanceId, abilityIndex: 0 }).success).toBe(true);
    expect(engine56.getState().currentPendingChoice?.effectType).toBe('PRESET_ST01_001_BOUNCE');
    mustPick(engine56, [ally04.instanceId]);
    expect(engine56.getState().currentPendingChoice?.effectType).not.toBe('CHOOSE_TRIGGER_ORDER');

    // 2. BP01-031：仅剩2张牌组时公开不中途触发 3.3.3.c 侵蚀+1，选0张不弹模式空窗且 chooseOrder 置底
    const engine31 = createEngine(buildDeck(['BP01-031'], 'ST01'), buildDeck([], 'ST02'));
    const st31 = engine31.getState();
    const qu31 = findCard(engine31, 'p1', 'BP01-031');
    setupOpenCost(engine31, 'p1', ['ST01-006'], 8, new Set([qu31.instanceId]));
    engine31.zoneMgr.moveCard(qu31.instanceId, 'HAND', { isFaceUp: true });
    const deckCards = engine31.zoneMgr.getCardsInZone('p1', 'DECK');
    for (let i = 2; i < deckCards.length; i++) {
      engine31.zoneMgr.moveCard(deckCards[i]!.instanceId, 'GRAVEYARD', { isFaceUp: true });
    }
    expect(engine31.zoneMgr.getCardsInZone('p1', 'DECK')).toHaveLength(2);
    const erosionBefore31 = st31.players['p1']!.erosionCount;
    mustPlay(engine31, 'p1', qu31.instanceId, { targetSlotIndex: 0 });
    expect(st31.players['p1']!.erosionCount).toBe(erosionBefore31);
    mustPick(engine31, []);
    const order31 = expectOrderAndPickReversed(engine31, 'DSL_ORDER_MOVE_BP01-031', 2);
    expect(engine31.zoneMgr.getCardsInZone('p1', 'DECK').map((c) => c.instanceId)).toEqual(order31);
    expect(st31.players['p1']!.erosionCount).toBe(erosionBefore31);
  });

  it('BP01-002 【出】消2球获突进与公开入处理区减3费；BP01-008/014/028/035 chargeIsAbility；BP01-024/026/034/036/046/061 chooseOrder', () => {
    const engine02 = createEngine(
      buildDeck(
        ['BP01-001', 'BP01-002', 'BP01-006', 'ST01-002', 'ST01-003', 'ST01-004', 'ST01-012', 'ST01-013', 'ST01-014', 'BP01-078', 'BP01-078', 'BP01-078', 'BP01-078'],
        'ST01'
      ),
      buildDeck([], 'ST02')
    );
    const st02 = engine02.getState();
    const luciaBase = findCard(engine02, 'p1', 'ST01-004');
    const lee = findCard(engine02, 'p1', 'ST01-002');
    const liv = findCard(engine02, 'p1', 'ST01-003');
    const bp01001 = findCard(engine02, 'p1', 'BP01-001');
    const bp01002 = findCard(engine02, 'p1', 'BP01-002');
    const bp01006 = findCard(engine02, 'p1', 'BP01-006');
    const topFill = ['ST01-012', 'ST01-013', 'ST01-014'].map((n) => findCard(engine02, 'p1', n));
    setupOpenCost(
      engine02,
      'p1',
      ['ST01-006', 'ST04-006'],
      10,
      new Set([
        luciaBase.instanceId,
        lee.instanceId,
        liv.instanceId,
        bp01001.instanceId,
        bp01002.instanceId,
        bp01006.instanceId,
        ...topFill.map((c) => c.instanceId),
      ])
    );
    mustPlay(engine02, 'p1', luciaBase.instanceId, { targetSlotIndex: 0 });
    mustPlay(engine02, 'p1', lee.instanceId, { targetSlotIndex: 1 });
    mustPick(engine02, ['opt_no']);
    refreshCost(engine02, 'p1', 10);
    mustPlay(engine02, 'p1', liv.instanceId, { targetSlotIndex: 2 });
    resolvePendingChoices(engine02);

    topFill.forEach((c) => engine02.zoneMgr.moveCardToTopOfDeck(c.instanceId));
    engine02.zoneMgr.moveCardToTopOfDeck(bp01006.instanceId);
    engine02.zoneMgr.moveCardToTopOfDeck(bp01002.instanceId);
    setOrbs(engine02, 'p1', ['BP01-078', 'BP01-078', 'BP01-078', 'BP01-078']);

    refreshCost(engine02, 'p1', 10);
    mustPlay(engine02, 'p1', bp01001.instanceId, { isAscension: true, targetAscensionCardId: luciaBase.instanceId });
    mustPick(engine02, [st02.currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    expect(st02.currentPendingChoice?.effectType).toBe('PRESET_BP01_001_PICK');
    mustPick(engine02, [bp01002.instanceId, bp01006.instanceId]);
    expectOrderAndPickReversed(engine02, 'DSL_ORDER_MOVE_BP01-001', 3);
    expect(st02.currentPendingChoice?.effectType).toBe('PRESET_BP01_002_ORB_COST');
    mustPick(engine02, [st02.currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    expect(engine02.continuousEffects.evaluateCard(bp01002.instanceId).keywords).toContain('突进');
    expect(engine02.combatMgr.calculateRoleChargeCount(bp01002.instanceId)).toBe(0);
    coveredCardNumbers.add('BP01-002');
    coveredCardNumbers.add('BP01-006');

    // 2. BP01-008 跨回合真打 BP02-058 验证 chargeIsAbility=true
    const engine08 = createEngine(
      buildDeck(['BP01-008', 'ST02-004', 'BP01-078', 'BP01-078'], 'ST01'),
      buildDeck(['BP02-058', 'BP01-070', 'BP01-019', 'BP01-019'], 'ST02')
    );
    const lunaBase = findCard(engine08, 'p1', 'ST02-004');
    const luna08 = findCard(engine08, 'p1', 'BP01-008');
    setupOpenCost(engine08, 'p1', ['ST02-005'], 10, new Set([lunaBase.instanceId, luna08.instanceId]));
    mustPlay(engine08, 'p1', lunaBase.instanceId, { targetSlotIndex: 0 });
    resolvePendingChoices(engine08);
    mustPlay(engine08, 'p1', luna08.instanceId, { isAscension: true, targetAscensionCardId: lunaBase.instanceId });
    advanceTurnTo(engine08, 'p2');
    advanceTurnTo(engine08, 'p1');
    setOrbs(engine08, 'p1', ['BP01-078', 'BP01-078']);
    putNonOrbOnTop(engine08, 'p1');
    putNonOrbOnTop(engine08, 'p2');
    expect(engine08.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p1', attackerCardId: luna08.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    mustPick(engine08, [engine08.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    mustPick(engine08, [luna08.instanceId]);
    passInstantWindows(engine08);
    if (engine08.getState().currentCombat?.step === 'BLOCK') {
      engine08.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
      passInstantWindows(engine08);
    }
    resolvePendingChoices(engine08);
    expect(engine08.combatMgr.calculateRoleChargeCount(luna08.instanceId)).toBe(2);

    advanceTurnTo(engine08, 'p2');
    const r1 = findCard(engine08, 'p2', 'BP01-019', 0);
    const r2 = findCard(engine08, 'p2', 'BP01-019', 1);
    const noktiBase = findCard(engine08, 'p2', 'BP01-070');
    const nokti58 = findCard(engine08, 'p2', 'BP02-058');
    setupOpenCost(
      engine08,
      'p2',
      ['BP01-019', 'ST02-005'],
      10,
      new Set([r1.instanceId, r2.instanceId, noktiBase.instanceId, nokti58.instanceId])
    );
    mustPlay(engine08, 'p2', r1.instanceId, { targetSlotIndex: 0 });
    mustPlay(engine08, 'p2', r2.instanceId, { targetSlotIndex: 1 });
    mustPlay(engine08, 'p2', noktiBase.instanceId, { targetSlotIndex: 2 });
    refreshCost(engine08, 'p2', 10);
    mustPlay(engine08, 'p2', nokti58.instanceId, { isAscension: true, targetAscensionCardId: noktiBase.instanceId });
    mustPick(engine08, [luna08.instanceId], 'p2');
    expect(engine08.combatMgr.calculateRoleChargeCount(luna08.instanceId)).toBe(1);

    // 3. BP01-014 / BP01-028 / BP01-035 chargeIsAbility + BP01-024/026/034/036/046/061 chooseOrder
    const engineMix = createEngine(
      buildDeck(
        [
          'BP01-014',
          'BP01-019',
          'BP01-020',
          'BP01-024',
          'BP01-026',
          'BP01-028',
          'BP01-034',
          'BP01-035',
          'BP01-036',
          'BP01-037',
          'BP01-038',
          'BP01-046',
          'BP01-056',
          'BP01-061',
          'BP01-084',
          'BP01-085',
          'ST01-002',
          'ST01-003',
          'ST01-004',
          'ST01-005',
          'ST01-007',
          'ST01-008',
          'ST01-009',
          'ST01-010',
          'ST01-011',
          'ST01-012',
          'ST01-013',
        ],
        'ST01'
      ),
      buildDeck([], 'ST02')
    );
    const stMix = engineMix.getState();
    const alphaBase = findCard(engineMix, 'p1', 'BP01-019');
    const alpha14 = findCard(engineMix, 'p1', 'BP01-014');
    const tachi20 = findCard(engineMix, 'p1', 'BP01-020');
    const bp01024 = findCard(engineMix, 'p1', 'BP01-024');
    const bp01026 = findCard(engineMix, 'p1', 'BP01-026');
    const qu28 = findCard(engineMix, 'p1', 'BP01-028');
    const qu34 = findCard(engineMix, 'p1', 'BP01-034');
    const qu35 = findCard(engineMix, 'p1', 'BP01-035');
    const eq36 = findCard(engineMix, 'p1', 'BP01-036');
    const wsm37 = findCard(engineMix, 'p1', 'BP01-037');
    const wsm38 = findCard(engineMix, 'p1', 'BP01-038');
    const nanami46 = findCard(engineMix, 'p1', 'BP01-046');
    const dreamGy = findCard(engineMix, 'p1', 'BP01-056');
    const selena61 = findCard(engineMix, 'p1', 'BP01-061');
    const resMix = new Set([
      alphaBase.instanceId,
      alpha14.instanceId,
      tachi20.instanceId,
      bp01024.instanceId,
      bp01026.instanceId,
      qu28.instanceId,
      qu34.instanceId,
      qu35.instanceId,
      eq36.instanceId,
      wsm37.instanceId,
      wsm38.instanceId,
      nanami46.instanceId,
      dreamGy.instanceId,
      selena61.instanceId,
    ]);
    setupOpenCost(engineMix, 'p1', ['ST01-006', 'BP01-019', 'BP01-048'], 10, resMix);

    const r26 = [
      alpha14,
      tachi20,
      findCard(engineMix, 'p1', 'ST01-012', 0, resMix),
      findCard(engineMix, 'p1', 'ST01-013', 0, resMix),
      findCard(engineMix, 'p1', 'ST01-004', 0, resMix),
      findCard(engineMix, 'p1', 'ST01-005', 0, resMix),
      findCard(engineMix, 'p1', 'ST01-006', 0, resMix),
    ];
    r26.forEach((c) => engineMix.zoneMgr.moveCardToTopOfDeck(c.instanceId));
    mustPlay(engineMix, 'p1', bp01026.instanceId);
    mustPick(engineMix, [alpha14.instanceId]);
    mustPick(engineMix, [tachi20.instanceId]);
    const ord26 = expectOrderAndPickReversed(engineMix, 'DSL_ORDER_MOVE_BP01-026', 5);
    expect(engineMix.zoneMgr.getCardsInZone('p1', 'DECK').slice(-5).map((c) => c.instanceId)).toEqual(ord26);

    refreshCost(engineMix, 'p1', 10);
    const fillers24 = [
      findCard(engineMix, 'p1', 'ST01-007', 0, resMix),
      findCard(engineMix, 'p1', 'ST01-008', 0, resMix),
      findCard(engineMix, 'p1', 'ST01-009', 0, resMix),
      findCard(engineMix, 'p1', 'ST01-010', 0, resMix),
    ];
    fillers24.forEach((c) => engineMix.zoneMgr.moveCardToTopOfDeck(c.instanceId));
    engineMix.zoneMgr.moveCardToTopOfDeck(eq36.instanceId);
    mustPlay(engineMix, 'p1', bp01024.instanceId);
    setOrbs(engineMix, 'p1', ['BP01-084']);
    expect(engineMix.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: bp01024.instanceId, abilityIndex: 0 }).success).toBe(true);
    mustPick(engineMix, [eq36.instanceId]);
    expectOrderAndPickReversed(engineMix, 'DSL_ORDER_MOVE_BP01-024', 4);
    engineMix.zoneMgr.moveCardToBottomOfDeck(bp01024.instanceId);

    refreshCost(engineMix, 'p1', 10);
    mustPlay(engineMix, 'p1', qu35.instanceId, { targetSlotIndex: 0 });
    engineMix.zoneMgr.moveCard(wsm37.instanceId, 'HAND', { isFaceUp: true });
    expect(engineMix.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: qu35.instanceId, abilityIndex: 0 }).success).toBe(true);
    mustPick(engineMix, [wsm37.instanceId]);
    mustPick(engineMix, ['charge_plus_1']);
    expect(engineMix.combatMgr.calculateRoleChargeCount(qu35.instanceId)).toBe(2);
    expect(qu35.modifiers?.some((m) => m.chargeIsAbility === true)).toBe(true);

    refreshCost(engineMix, 'p1', 10);
    const quTop3 = [
      findCard(engineMix, 'p1', 'ST01-011', 0, resMix),
      findCard(engineMix, 'p1', 'ST01-002', 0, resMix),
      qu28,
    ];
    quTop3.forEach((c) => engineMix.zoneMgr.moveCardToTopOfDeck(c.instanceId));
    const handDrop = findCard(engineMix, 'p1', 'ST01-003', 0, resMix);
    engineMix.zoneMgr.moveCard(handDrop.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engineMix, 'p1', qu34.instanceId, { targetSlotIndex: 1 });
    mustPick(engineMix, [handDrop.instanceId]);
    mustPick(engineMix, [qu28.instanceId]);
    expectOrderAndPickReversed(engineMix, 'DSL_ORDER_MOVE_BP01-034', 2);

    refreshCost(engineMix, 'p1', 10);
    mustPlay(engineMix, 'p1', eq36.instanceId, { targetSlotIndex: 2 });
    expect(engineMix.dispatchAction({ type: 'EQUIP_ITEM', playerId: 'p1', equipmentCardId: eq36.instanceId, targetRoleCardId: qu35.instanceId }).success).toBe(true);
    engineMix.zoneMgr.moveCard(dreamGy.instanceId, 'GRAVEYARD', { isFaceUp: true });
    refreshCost(engineMix, 'p1', 10);
    mustPlay(engineMix, 'p1', selena61.instanceId, { targetSlotIndex: 2 });
    refreshCost(engineMix, 'p1', 10);
    mustPlay(engineMix, 'p1', alphaBase.instanceId, { targetSlotIndex: 3 });
    refreshCost(engineMix, 'p1', 10);
    mustPlay(engineMix, 'p1', alpha14.instanceId, { isAscension: true, targetAscensionCardId: alphaBase.instanceId });

    engineMix.zoneMgr.moveCard(wsm38.instanceId, 'GRAVEYARD', { isFaceUp: true });
    refreshCost(engineMix, 'p1', 10);
    mustPlay(engineMix, 'p1', qu28.instanceId, { isAscension: true, targetAscensionCardId: qu35.instanceId });
    mustPick(engineMix, [wsm37.instanceId, wsm38.instanceId]);
    mustPick(engineMix, ['charge_and_9999']);
    expect(qu28.modifiers?.some((m) => m.chargeIsAbility === true)).toBe(true);
    expect(engineMix.combatMgr.calculateRoleChargeCount(qu28.instanceId)).toBe(2);

    refreshCost(engineMix, 'p1', 10);
    mustPlay(engineMix, 'p1', nanami46.instanceId, { targetSlotIndex: 4 });
    mustPick(engineMix, []);
    expectOrderAndPickReversed(engineMix, 'DSL_ORDER_MOVE_BP01-046', 5);

    advanceTurnTo(engineMix, 'p2');
    advanceTurnTo(engineMix, 'p1');
    const drop36 = findCard(engineMix, 'p1', 'ST01-004', 0, resMix);
    engineMix.zoneMgr.moveCard(drop36.instanceId, 'HAND', { isFaceUp: true });
    const nonWsmTop3 = engineMix.zoneMgr
      .getCardsInZone('p1', 'DECK')
      .filter((c) => c.cardNumber !== 'BP01-037' && c.cardNumber !== 'BP01-038')
      .slice(0, 3);
    for (const c of nonWsmTop3) engineMix.zoneMgr.moveCardToTopOfDeck(c.instanceId);
    putNonOrbOnTop(engineMix, 'p2');
    expect(engineMix.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p1', attackerCardId: qu28.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    expect(stMix.currentPendingChoice?.effectType).toBe('DSL_DISCARD_COST_BP01-036');
    mustPick(engineMix, [drop36.instanceId]);
    expect(stMix.currentPendingChoice?.effectType).toBe('DSL_CHOOSE_VAR_BP01-036');
    mustPick(engineMix, []);
    expectOrderAndPickReversed(engineMix, 'DSL_ORDER_MOVE_BP01-036', 3);
    finishCombat(engineMix, 'p2');

    putNonOrbOnTop(engineMix, 'p1');
    putNonOrbOnTop(engineMix, 'p2');
    expect(engineMix.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p1', attackerCardId: selena61.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    mustPick(engineMix, ['opt_yes']);
    mustPick(engineMix, []);
    expectOrderAndPickReversed(engineMix, 'DSL_ORDER_MOVE_BP01-061', 2);
    finishCombat(engineMix, 'p2');

    setOrbs(engineMix, 'p1', ['BP01-084', 'BP01-085']);
    putNonOrbOnTop(engineMix, 'p1');
    putNonOrbOnTop(engineMix, 'p2');
    expect(engineMix.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p1', attackerCardId: alpha14.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    mustPick(engineMix, [stMix.currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    expect(alpha14.modifiers?.some((m) => m.chargeIsAbility === true)).toBe(true);
    expect(engineMix.combatMgr.calculateRoleChargeCount(alpha14.instanceId)).toBe(2);
    finishCombat(engineMix, 'p2');
  });

  it('10张0测卡 + 13张弱测卡 + BP01-070/073 缺失分支全面真打校验', () => {
    // 批次 A
    const engineA = createEngine(
      buildDeck(
        [
          'BP01-004',
          'BP01-012',
          'BP01-016',
          'BP01-020',
          'BP01-025',
          'BP01-030',
          'BP01-033',
          'BP01-037',
          'BP01-041',
          'BP01-042',
          'BP01-043',
          'BP01-044',
          'BP01-049',
          'BP01-049',
          'BP01-053',
          'BP01-078',
          'BP01-078',
          'BP01-078',
          'ST01-004',
          'ST01-005',
          'ST01-007',
          'ST01-008',
          'ST01-012',
          'ST01-013',
        ],
        'ST01'
      ),
      buildDeck(['ST02-004', 'ST02-005'], 'ST02')
    );
    const stA = engineA.getState();

    advanceTurnTo(engineA, 'p2');
    const oppWeak = findCard(engineA, 'p2', 'ST02-004');
    const oppBlock = findCard(engineA, 'p2', 'ST02-005');
    setupOpenCost(engineA, 'p2', ['ST02-005'], 8, new Set([oppWeak.instanceId, oppBlock.instanceId]));
    mustPlay(engineA, 'p2', oppWeak.instanceId, { targetSlotIndex: 0 });
    mustPlay(engineA, 'p2', oppBlock.instanceId, { targetSlotIndex: 1 });

    advanceTurnTo(engineA, 'p1');
    const bp04 = findCard(engineA, 'p1', 'BP01-004');
    const voto = findCard(engineA, 'p1', 'BP01-012');
    const alpha16 = findCard(engineA, 'p1', 'BP01-016');
    const gyTachi = findCard(engineA, 'p1', 'BP01-020');
    const windSnow = findCard(engineA, 'p1', 'BP01-025');
    const qu33 = findCard(engineA, 'p1', 'BP01-033');
    const qu30 = findCard(engineA, 'p1', 'BP01-030');
    const wsmCost = findCard(engineA, 'p1', 'BP01-037');
    const nanami42 = findCard(engineA, 'p1', 'BP01-042');
    const nanami41 = findCard(engineA, 'p1', 'BP01-041');
    const nanami43 = findCard(engineA, 'p1', 'BP01-043');
    const nanami44 = findCard(engineA, 'p1', 'BP01-044');
    const pawa49 = findCard(engineA, 'p1', 'BP01-049', 0);
    const pawa49b = findCard(engineA, 'p1', 'BP01-049', 1);
    const nanami53 = findCard(engineA, 'p1', 'BP01-053');
    const takeCost = findCard(engineA, 'p1', 'ST01-006', 0);
    const resA = new Set([
      bp04.instanceId,
      voto.instanceId,
      alpha16.instanceId,
      gyTachi.instanceId,
      windSnow.instanceId,
      qu33.instanceId,
      qu30.instanceId,
      wsmCost.instanceId,
      nanami42.instanceId,
      nanami41.instanceId,
      nanami43.instanceId,
      nanami44.instanceId,
      pawa49.instanceId,
      pawa49b.instanceId,
      nanami53.instanceId,
      takeCost.instanceId,
    ]);
    setupOpenCost(engineA, 'p1', ['ST04-006', 'BP01-019', 'ST01-006', 'BP01-048'], 9, resA);
    engineA.zoneMgr.moveCard(takeCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engineA.zoneMgr.syncCostStats('p1');

    const drop04 = findCard(engineA, 'p1', 'ST01-007', 0, resA);
    engineA.zoneMgr.moveCard(drop04.instanceId, 'HAND', { isFaceUp: true });
    mustPlay(engineA, 'p1', bp04.instanceId, { targetSlotIndex: 0 });
    mustPick(engineA, [drop04.instanceId]);
    mustPick(engineA, [takeCost.instanceId]);
    expect(stA.cards[takeCost.instanceId]!.zone).toBe('HAND');

    const gyOrb = findCard(engineA, 'p1', 'ST01-012', 0, resA);
    engineA.zoneMgr.moveCard(gyOrb.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const roleDrop1 = findCard(engineA, 'p1', 'ST01-008', 0, resA);
    const roleDrop2 = findCard(engineA, 'p1', 'ST01-004', 0, resA);
    engineA.zoneMgr.moveCard(roleDrop1.instanceId, 'HAND', { isFaceUp: true });
    engineA.zoneMgr.moveCard(roleDrop2.instanceId, 'HAND', { isFaceUp: true });
    refreshCost(engineA, 'p1', 10);
    mustPlay(engineA, 'p1', voto.instanceId, { targetSlotIndex: 3 });
    expect(engineA.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: voto.instanceId, abilityIndex: 0 }).success).toBe(true);
    mustPick(engineA, [roleDrop1.instanceId, roleDrop2.instanceId]);
    mustPick(engineA, [gyOrb.instanceId]);
    expect(engineA.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB').at(-1)!.instanceId).toBe(gyOrb.instanceId);

    engineA.zoneMgr.moveCard(gyTachi.instanceId, 'GRAVEYARD', { isFaceUp: true });
    refreshCost(engineA, 'p1', 10);
    mustPlay(engineA, 'p1', alpha16.instanceId, { targetSlotIndex: 1 });
    setOrbs(engineA, 'p1', ['ST01-013']);
    expect(engineA.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: alpha16.instanceId, abilityIndex: 0 }).success).toBe(true);
    mustPick(engineA, [gyTachi.instanceId]);
    expect(getAttachedEquipmentIds(alpha16)).toContain(gyTachi.instanceId);

    refreshCost(engineA, 'p1', 10);
    setOrbs(engineA, 'p1', ['BP01-078', 'BP01-078']);
    mustPlay(engineA, 'p1', windSnow.instanceId);
    mustPick(engineA, [oppBlock.instanceId]);
    mustPick(engineA, [stA.currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    mustPick(engineA, [alpha16.instanceId]);
    expect(engineA.continuousEffects.hasProhibition(oppBlock.instanceId, 'CANNOT_BLOCK')).toBe(true);

    refreshCost(engineA, 'p1', 10);
    mustPlay(engineA, 'p1', qu33.instanceId, { targetSlotIndex: 2 });
    engineA.zoneMgr.moveCard(wsmCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    refreshCost(engineA, 'p1', 10);
    setOrbs(engineA, 'p1', ['BP01-078', 'BP01-078', 'BP01-078']);
    mustPlay(engineA, 'p1', qu30.instanceId, { isAscension: true, targetAscensionCardId: qu33.instanceId });
    mustPick(engineA, [stA.currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    mustPick(engineA, [wsmCost.instanceId]);
    if (stA.currentPendingChoice) mustPick(engineA, []);
    expect(stA.cards[wsmCost.instanceId]!.zone).toBe('GRAVEYARD');

    // 清理已完成测试的战场卡位以便后续角色出场
    engineA.zoneMgr.moveCardToBottomOfDeck(bp04.instanceId);
    engineA.zoneMgr.moveCardToBottomOfDeck(voto.instanceId);
    engineA.zoneMgr.moveCardToBottomOfDeck(alpha16.instanceId);
    engineA.zoneMgr.moveCardToBottomOfDeck(qu30.instanceId);

    refreshCost(engineA, 'p1', 10);
    mustPlay(engineA, 'p1', nanami42.instanceId, { targetSlotIndex: 3 });
    expect(engineA.continuousEffects.evaluateCard(nanami42.instanceId).keywords).not.toContain('速攻');
    refreshCost(engineA, 'p1', 10);
    mustPlay(engineA, 'p1', pawa49.instanceId, { targetSlotIndex: 4 });
    setOrbs(engineA, 'p1', ['BP01-078']);
    expect(engineA.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: pawa49.instanceId, abilityIndex: 0 }).success).toBe(true);
    mustPick(engineA, [nanami42.instanceId]);
    expect(engineA.continuousEffects.evaluateCard(nanami42.instanceId).keywords).toContain('速攻');

    engineA.zoneMgr.moveCard(pawa49b.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const drop41 = findCard(engineA, 'p1', 'ST01-005', 0, resA);
    engineA.zoneMgr.moveCard(drop41.instanceId, 'HAND', { isFaceUp: true });
    refreshCost(engineA, 'p1', 10);
    mustPlay(engineA, 'p1', nanami41.instanceId, { isAscension: true, targetAscensionCardId: nanami42.instanceId });
    expect(engineA.fieldMgr.calculateRoleEffectivePP(nanami41.instanceId)).toBe(7000);
    mustPick(engineA, [drop41.instanceId]);
    mustPick(engineA, [pawa49b.instanceId]);
    expect(stA.cards[pawa49b.instanceId]!.zone).toBe('BATTLEFIELD');

    refreshCost(engineA, 'p1', 10);
    mustPlay(engineA, 'p1', nanami43.instanceId, { targetSlotIndex: 1 });
    mustPick(engineA, [pawa49b.instanceId]);
    mustPick(engineA, [oppWeak.instanceId]);
    expect(stA.cards[oppWeak.instanceId]!.zone).toBe('GRAVEYARD');

    engineA.zoneMgr.moveCardToBottomOfDeck(nanami41.instanceId);
    engineA.zoneMgr.moveCard(pawa49b.instanceId, 'HAND', { isFaceUp: true });
    const handB44 = engineA.zoneMgr.getCardsInZone('p1', 'HAND').length;
    refreshCost(engineA, 'p1', 10);
    mustPlay(engineA, 'p1', nanami44.instanceId, { targetSlotIndex: 2 });
    mustPick(engineA, [pawa49b.instanceId]);
    expect(engineA.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handB44 - 1 + 2);

    const gyOrb53 = findCard(engineA, 'p1', 'BP01-078', 0, resA);
    engineA.zoneMgr.moveCard(gyOrb53.instanceId, 'GRAVEYARD', { isFaceUp: true });
    refreshCost(engineA, 'p1', 10);
    mustPlay(engineA, 'p1', nanami53.instanceId, { targetSlotIndex: 3 });
    mustPick(engineA, [gyOrb53.instanceId]);
    expect(engineA.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB').at(-1)!.instanceId).toBe(gyOrb53.instanceId);

    // 批次 B: BP01-065, BP01-066, BP01-069, BP01-070, BP01-071, BP01-073, BP01-075
    const engineB = createEngine(
      buildDeck(
        [
          'BP01-069',
          'BP01-070',
          'BP01-071',
          'BP01-073',
          'BP01-074',
          'BP01-075',
          'ST04-007',
          'BP01-066',
          'BP01-065',
          'BP01-056',
          'BP01-056',
          'BP01-056',
          'BP01-056',
          'BP01-078',
          'BP01-078',
          'ST03-012',
          'ST04-006',
        ],
        'ST03'
      ),
      buildDeck(['ST04-005', 'ST04-009'], 'ST04')
    );
    const stB = engineB.getState();
    const vera05 = findCard(engineB, 'p1', 'ST03-005');
    const nokti70 = findCard(engineB, 'p1', 'BP01-070');
    const vera69 = findCard(engineB, 'p1', 'BP01-069');
    const bp71 = findCard(engineB, 'p1', 'BP01-071');
    const chrome73 = findCard(engineB, 'p1', 'BP01-073');
    const eagle74 = findCard(engineB, 'p1', 'BP01-074');
    const kamuiBase = findCard(engineB, 'p1', 'ST04-007');
    const kamui75 = findCard(engineB, 'p1', 'BP01-075');
    const bp66 = findCard(engineB, 'p1', 'BP01-066');
    const bp65 = findCard(engineB, 'p1', 'BP01-065');
    const dreams = [0, 1, 2, 3].map((i) => findCard(engineB, 'p1', 'BP01-056', i));
    const resB = new Set([
      vera05.instanceId,
      nokti70.instanceId,
      vera69.instanceId,
      bp71.instanceId,
      chrome73.instanceId,
      eagle74.instanceId,
      kamuiBase.instanceId,
      kamui75.instanceId,
      bp66.instanceId,
      bp65.instanceId,
      ...dreams.map((d) => d.instanceId),
    ]);
    setupOpenCost(engineB, 'p1', ['ST02-005', 'ST01-006', 'ST04-006'], 10, resB);

    mustPlay(engineB, 'p1', vera05.instanceId, { targetSlotIndex: 0 });
    mustPlay(engineB, 'p1', nokti70.instanceId, { targetSlotIndex: 1 });
    expect(engineB.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: nokti70.instanceId, abilityIndex: 0 }).success).toBe(false);
    refreshCost(engineB, 'p1', 10);
    mustPlay(engineB, 'p1', vera69.instanceId, { targetSlotIndex: 2 });
    expect(engineB.fieldMgr.calculateRoleEffectivePP(vera69.instanceId)).toBe(7000);
    mustPick(engineB, [nokti70.instanceId]);
    expect(engineB.continuousEffects.evaluateCard(vera69.instanceId).keywords).toContain('速攻');
    expect(stB.cards[nokti70.instanceId]!.isReady).toBe(false);
    const [o1, o2] = setOrbs(engineB, 'p1', ['BP01-078', 'ST03-012']);
    refreshCost(engineB, 'p1', 10);
    expect(engineB.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: nokti70.instanceId, abilityIndex: 0 }).success).toBe(true);
    mustPick(engineB, [o2!, o1!]);
    expect(engineB.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB').map((c) => c.instanceId)).toEqual([o2!, o1!]);

    dreams.forEach((d) => engineB.zoneMgr.moveCard(d.instanceId, 'GRAVEYARD', { isFaceUp: true }));
    const handB66 = engineB.zoneMgr.getCardsInZone('p1', 'HAND').length;
    refreshCost(engineB, 'p1', 10);
    mustPlay(engineB, 'p1', bp66.instanceId);
    mustPick(engineB, ['opt_yes']);
    mustPick(engineB, dreams.map((d) => d.instanceId));
    expect(engineB.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handB66 + 2);

    const chromeBase = findCard(engineB, 'p1', 'ST04-006', 1, resB);
    refreshCost(engineB, 'p1', 10);
    mustPlay(engineB, 'p1', chromeBase.instanceId, { targetSlotIndex: 3 });
    mustPlay(engineB, 'p1', chrome73.instanceId, { isAscension: true, targetAscensionCardId: chromeBase.instanceId });
    engineB.zoneMgr.moveCard(eagle74.instanceId, 'HAND', { isFaceUp: true });
    setOrbs(engineB, 'p1', ['BP01-078', 'BP01-078']);
    expect(engineB.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: chrome73.instanceId, abilityIndex: 0 }).success).toBe(true);
    mustPick(engineB, [eagle74.instanceId]);
    expect(engineB.continuousEffects.hasProhibition(eagle74.instanceId, 'CANNOT_ATTACK')).toBe(true);

    advanceTurnTo(engineB, 'p2');
    const p2Cheap = findCard(engineB, 'p2', 'ST04-005');
    const p2Exp = findCard(engineB, 'p2', 'ST04-009');
    setupOpenCost(engineB, 'p2', ['ST04-006'], 10, new Set([p2Cheap.instanceId, p2Exp.instanceId]));
    mustPlay(engineB, 'p2', p2Cheap.instanceId, { targetSlotIndex: 0 });
    refreshCost(engineB, 'p2', 10);
    mustPlay(engineB, 'p2', p2Exp.instanceId, { targetSlotIndex: 1 });
    resolvePendingChoices(engineB);

    advanceTurnTo(engineB, 'p1');
    engineB.zoneMgr.moveCardToBottomOfDeck(vera05.instanceId);
    refreshCost(engineB, 'p1', 10);
    mustPlay(engineB, 'p1', kamuiBase.instanceId, { targetSlotIndex: 0 });
    setOrbs(engineB, 'p1', ['BP01-078', 'BP01-078']);
    mustPlay(engineB, 'p1', kamui75.instanceId, { isAscension: true, targetAscensionCardId: kamuiBase.instanceId });
    mustPick(engineB, [stB.currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    expect(stB.currentPendingChoice!.options.map((o) => o.id)).toEqual([p2Cheap.instanceId]);
    mustPick(engineB, [p2Cheap.instanceId]);
    expect(p2Cheap.isReady).toBe(false);

    advanceTurnTo(engineB, 'p2');
    // 保持 p1 场上存在横置的<三头犬小队>角色以满足 BP01-071 条件
    stB.cards[nokti70.instanceId]!.isReady = false;
    const p1ErosionBefore = stB.players['p1']!.erosionCount;
    refreshCost(engineB, 'p1', 10);
    engineB.zoneMgr.moveCard(bp71.instanceId, 'HAND', { isFaceUp: true });
    putNonOrbOnTop(engineB, 'p1');
    putNonOrbOnTop(engineB, 'p2');
    expect(engineB.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p2', attackerCardId: p2Exp.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    if (stB.timingWindow?.priorityPlayerId === 'p2') {
      engineB.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    }
    mustUseInstant(engineB, 'p1', bp71.instanceId);
    finishCombat(engineB, 'p1');
    expect(stB.players['p1']!.erosionCount).toBe(p1ErosionBefore);

    advanceTurnTo(engineB, 'p1');
    dreams.slice(0, 2).forEach((d) => engineB.zoneMgr.moveCard(d.instanceId, 'GRAVEYARD', { isFaceUp: true }));
    advanceTurnTo(engineB, 'p2');
    refreshCost(engineB, 'p1', 10);
    engineB.zoneMgr.moveCard(bp65.instanceId, 'HAND', { isFaceUp: true });
    putNonOrbOnTop(engineB, 'p1');
    putNonOrbOnTop(engineB, 'p2');
    expect(engineB.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p2', attackerCardId: p2Exp.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    if (stB.timingWindow?.priorityPlayerId === 'p2') {
      engineB.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    }
    mustUseInstant(engineB, 'p1', bp65.instanceId);
    mustPick(engineB, ['opt_yes'], 'p1');
    mustPick(engineB, dreams.slice(0, 2).map((d) => d.instanceId), 'p1');
    finishCombat(engineB, 'p1');
    expect(stB.players['p1']!.erosionCount).toBe(p1ErosionBefore);

    putNonOrbOnTop(engineB, 'p1');
    putNonOrbOnTop(engineB, 'p2');
    expect(engineB.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p2', attackerCardId: p2Cheap.instanceId, targetType: 'PLAYER' }).success).toBe(true);
    passInstantWindows(engineB);
    // ST04-005 PP=4000；chrome73 (BP01-073 PP=5000) 阻挡触发【自】PP+1000 达 6000 存活并留下回合末 PP+1000
    const blockerPPBefore = engineB.fieldMgr.calculateRoleEffectivePP(chrome73.instanceId);
    expect(engineB.dispatchAction({ type: 'DECLARE_BLOCK', playerId: 'p1', blockerCardId: chrome73.instanceId }).success).toBe(true);
    expect(engineB.fieldMgr.calculateRoleEffectivePP(chrome73.instanceId)).toBe(blockerPPBefore + 1000);
    expect(engineB.combatMgr.calculateRoleChargeCount(eagle74.instanceId)).toBe(0);
    passInstantWindows(engineB);
    resolvePendingChoices(engineB);
  });

  it('全 171 卡（ST01~ST06 83张 + BP01 88张）真打冒烟核验与 100% 覆盖断言', () => {
    const all171 = OFFICIAL_CARDS_DATA.filter(
      (c) => /^ST0[1-6]-/.test(c.cardNumber) || /^BP01-/.test(c.cardNumber)
    ).map((c) => c.cardNumber);
    expect(all171).toHaveLength(171);

    const remaining = all171.filter((n) => !coveredCardNumbers.has(n));
    const chunkSize = 12;
    for (let i = 0; i < remaining.length; i += chunkSize) {
      const batch = remaining.slice(i, i + chunkSize);
      const helperCards = [
        ...ATTR_PADS,
        ...ATTR_PADS,
        'ST02-004',
        'ST02-004',
        'ST03-005',
        'ST03-005',
        'BP01-063',
        'BP01-063',
        'BP01-032',
        'BP01-032',
        'BP01-042',
        'ST04-007',
        'BP01-056',
        'BP01-056',
        'BP01-049',
        'BP01-020',
        'ST01-012',
        'ST01-012',
        'ST01-013',
        'ST01-014',
      ];
      const engine = createEngine(
        buildDeck([...batch, ...helperCards], 'ST01'),
        buildDeck(['ST02-004', 'ST02-005', 'ST01-006'], 'ST02')
      );
      const state = engine.getState();

      advanceTurnTo(engine, 'p2');
      const p2a = findCard(engine, 'p2', 'ST02-004');
      const p2b = findCard(engine, 'p2', 'ST02-005');
      const p2c = findCard(engine, 'p2', 'ST01-006');
      setupOpenCost(engine, 'p2', ['ST02-005'], 10, new Set([p2a.instanceId, p2b.instanceId, p2c.instanceId]));
      mustPlay(engine, 'p2', p2a.instanceId, { targetSlotIndex: 0 });
      mustPlay(engine, 'p2', p2b.instanceId, { targetSlotIndex: 1 });
      refreshCost(engine, 'p2', 10);
      mustPlay(engine, 'p2', p2c.instanceId, { targetSlotIndex: 2 });

      advanceTurnTo(engine, 'p1');
      const reserved = new Set(batch.map((n) => findCard(engine, 'p1', n).instanceId));
      const baseSlots: Array<[number, string]> = [
        [0, 'ST02-004'],
        [1, 'BP01-019'],
        [2, 'BP01-063'],
        [3, 'BP01-032'],
      ];
      for (const [slotIdx, num] of baseSlots) {
        const b = findCard(engine, 'p1', num, 0, reserved);
        reserved.add(b.instanceId);
        engine.fieldMgr.playRoleCard('p1', b.instanceId, slotIdx, { suppressEntryTrigger: true });
      }
      const dream1 = findCard(engine, 'p1', 'BP01-056', 0, reserved);
      const dream2 = findCard(engine, 'p1', 'BP01-056', 1, reserved);
      const eqHelper = findCard(engine, 'p1', 'BP01-020', 0, reserved);
      const orbHelper = findCard(engine, 'p1', 'ST01-012', 0, reserved);
      reserved.add(dream1.instanceId);
      reserved.add(dream2.instanceId);
      reserved.add(eqHelper.instanceId);
      reserved.add(orbHelper.instanceId);
      engine.zoneMgr.moveCard(dream1.instanceId, 'GRAVEYARD', { isFaceUp: true });
      engine.zoneMgr.moveCard(dream2.instanceId, 'HAND', { isFaceUp: true });
      engine.zoneMgr.moveCard(orbHelper.instanceId, 'GRAVEYARD', { isFaceUp: true });
      engine.fieldMgr.equipToRole('p1', eqHelper.instanceId, state.battlefields['p1']![0]!.roleCardId!);
      setOrbs(engine, 'p1', ['ST01-012', 'ST01-013', 'ST01-014', 'ST01-012']);
      state.players['p1']!.erosionCount = 5;

      for (const cardNumber of batch) {
        if (coveredCardNumbers.has(cardNumber)) continue;
        const card = findCard(engine, 'p1', cardNumber);
        const def = db.getCard(cardNumber)!;
        setupOpenCost(
          engine,
          'p1',
          ['ST01-006', 'ST02-005', 'ST04-006', 'BP01-019', 'BP01-048'],
          10,
          reserved
        );
        const slot4 = state.battlefields['p1']![4]!.roleCardId;
        if (slot4) engine.zoneMgr.moveCardToBottomOfDeck(slot4);
        engine.zoneMgr.moveCard(card.instanceId, 'HAND', { isFaceUp: true });

        if (def.signalOrb) {
          mustPlay(engine, 'p1', card.instanceId);
          expect(engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB').at(-1)?.instanceId).toBe(card.instanceId);
          resolvePendingChoices(engine);
        } else if (def.isInstant) {
          for (const pid of ['p1', 'p2'] as const) {
            if (engine.zoneMgr.getCardsInZone(pid, 'DECK').length < 15) {
              for (const g of engine.zoneMgr.getCardsInZone(pid, 'GRAVEYARD')) {
                if (!reserved.has(g.instanceId)) engine.zoneMgr.moveCardToBottomOfDeck(g.instanceId);
              }
            }
          }
          state.players['p1']!.erosionCount = 4;
          engine.zoneMgr.moveCard(card.instanceId, 'HAND', { isFaceUp: true });
          advanceTurnTo(engine, 'p2');
          let atkId = state.battlefields['p2']!.find((s) => s.roleCardId)?.roleCardId;
          if (!atkId) {
            const p2Spare = Object.values(state.cards).find(
              (c) =>
                c.controllerPlayerId === 'p2' &&
                c.zone !== 'BATTLEFIELD' &&
                db.getCard(c.cardNumber)?.cardType === CardType.ROLE &&
                !db.getCard(c.cardNumber)?.ascensionConfig
            )!;
            engine.fieldMgr.playRoleCard('p2', p2Spare.instanceId, 0, { suppressEntryTrigger: true });
            atkId = p2Spare.instanceId;
          }
          const atk = state.cards[atkId]!;
          atk.isReady = true;
          atk.turnEnteredZone = 0;
          putNonOrbOnTop(engine, 'p1');
          putNonOrbOnTop(engine, 'p2');
          if (cardNumber === 'ST04-001') {
            const eagle = findCard(engine, 'p1', 'ST04-006', 0, reserved);
            engine.fieldMgr.playRoleCard('p1', eagle.instanceId, 4, { suppressEntryTrigger: true });
          }
          expect(engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p2', attackerCardId: atk.instanceId, targetType: 'PLAYER' }).success).toBe(true);
          if (state.timingWindow?.priorityPlayerId === 'p2') {
            engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
          }
          mustPlay(engine, 'p1', card.instanceId);
          finishCombat(engine, 'p1');
          state.players['p1']!.erosionCount = 5;
          advanceTurnTo(engine, 'p1');
        } else if (def.cardType === CardType.ROLE) {
          if (def.ascensionConfig) {
            const baseNum =
              def.traits?.includes('露娜') ? 'ST02-004' :
              def.traits?.includes('阿尔法') ? 'BP01-019' :
              def.traits?.includes('赛琳娜') ? 'BP01-063' :
              def.traits?.includes('库洛姆') ? 'ST04-006' :
              def.traits?.includes('薇拉') ? 'ST03-005' :
              def.traits?.includes('曲') ? 'BP01-032' :
              def.traits?.includes('七实') ? 'BP01-042' :
              def.traits?.includes('神威') ? 'ST04-007' :
              'ST01-006';
            const ascBase = findCard(engine, 'p1', baseNum, 0, reserved);
            engine.fieldMgr.playRoleCard('p1', ascBase.instanceId, 4, { suppressEntryTrigger: true });
            mustPlay(engine, 'p1', card.instanceId, {
              isAscension: true,
              targetAscensionCardId: ascBase.instanceId,
            });
          } else {
            mustPlay(engine, 'p1', card.instanceId, { targetSlotIndex: 4 });
          }
          while (state.currentPendingChoice) {
            const ch = state.currentPendingChoice;
            if (ch.effectType === 'CHOOSE_TRIGGER_ORDER') {
              mustPick(engine, [ch.options[0]!.id]);
            } else if (ch.effectType?.startsWith('DSL_ORDER_MOVE_')) {
              mustPick(engine, ch.options.map((o) => o.id));
            } else {
              resolvePendingChoices(engine);
            }
          }
          if (def.rulesText.includes('【充能0】')) {
            expect(engine.combatMgr.calculateRoleChargeCount(card.instanceId)).toBe(0);
          }
        } else {
          if (cardNumber === 'ST01-011' || cardNumber === 'ST04-011') {
            const needNum = cardNumber === 'ST04-011' ? 'ST04-006' : 'ST01-006';
            const helperRole = findCard(engine, 'p1', needNum, 0, reserved);
            engine.fieldMgr.playRoleCard('p1', helperRole.instanceId, 4, { suppressEntryTrigger: true });
          }
          mustPlay(engine, 'p1', card.instanceId);
          while (state.currentPendingChoice) {
            const ch = state.currentPendingChoice;
            if (ch.effectType === 'CHOOSE_TRIGGER_ORDER') {
              mustPick(engine, [ch.options[0]!.id]);
            } else if (ch.effectType?.startsWith('DSL_ORDER_MOVE_')) {
              mustPick(engine, ch.options.map((o) => o.id));
            } else {
              resolvePendingChoices(engine);
            }
          }
        }
      }
    }

    const stCovered = all171.filter((n) => n.startsWith('ST') && coveredCardNumbers.has(n));
    const bp01Covered = all171.filter((n) => n.startsWith('BP01') && coveredCardNumbers.has(n));
    expect(stCovered).toHaveLength(83);
    expect(bp01Covered).toHaveLength(88);
    expect(new Set([...stCovered, ...bp01Covered]).size).toBe(171);
  });
});
