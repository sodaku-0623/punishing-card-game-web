import { describe, it, expect } from 'vitest';
import {
  GameEngine,
  MemoryCardDatabase,
  OFFICIAL_CARDS_DATA,
} from '../src/index.js';
import { validateCardEffectRegistry } from '../src/effects/dsl/validator.js';
import { BP03_EFFECT_SPECS } from '../src/effects/dsl/specs/bp03.js';
import { STARTER_DECK_SPEC_MAP } from '../src/effects/dsl/specs/starter-decks.js';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import { endTurn, fillCostZone, passInstantWindows, resolvePendingChoices } from './helpers.js';

const db = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);

function makeDeck(baseCode: 'ST01' | 'ST02' | 'ST03', inject: string[] = []): string[] {
  const deckDef = OFFICIAL_STARTER_DECKS.find((d) => d.name.includes(`(${baseCode})`))!;
  const baseCards: string[] = [];
  for (const item of deckDef.cards) {
    for (let i = 0; i < item.count; i++) baseCards.push(item.cardNumber);
  }
  return [...inject, ...baseCards.slice(0, Math.max(0, 50 - inject.length))];
}

function createEngine(p1Deck: string[], p2Deck: string[], seed = 20261125): GameEngine {
  const engine = new GameEngine(
    'bp03-e2e-test',
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

function findCards(engine: GameEngine, playerId: string, cardNumber: string) {
  return Object.values(engine.getState().cards)
    .filter((c) => c.controllerPlayerId === playerId && c.cardNumber === cardNumber)
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId, undefined, { numeric: true }));
}

function findCard(engine: GameEngine, playerId: string, cardNumber: string, index = 0) {
  const card = findCards(engine, playerId, cardNumber)[index];
  if (!card) throw new Error(`未找到玩家 ${playerId} 的卡牌 ${cardNumber}#${index}`);
  return card;
}

function placeRole(
  engine: GameEngine,
  playerId: string,
  cardNumber: string,
  slotIndex: number,
  options?: { isReady?: boolean; enteredEarlier?: boolean; instanceIndex?: number }
) {
  const card = findCard(engine, playerId, cardNumber, options?.instanceIndex ?? 0);
  engine.zoneMgr.moveCard(card.instanceId, 'HAND', { isFaceUp: true });
  const ok = engine.fieldMgr.playRoleCard(playerId, card.instanceId, slotIndex, { suppressEntryTrigger: true });
  expect(ok).toBe(true);
  if (options?.enteredEarlier !== false) card.turnEnteredZone = 0;
  if (options?.isReady !== undefined) card.isReady = options.isReady;
  return card;
}

function setOpenCosts(engine: GameEngine, playerId: string, attrSeedCardNumbers: string[], total = 10) {
  for (const c of engine.zoneMgr.getCardsInZone(playerId, 'COST')) {
    engine.zoneMgr.moveCardToBottomOfDeck(c.instanceId);
  }
  for (const num of attrSeedCardNumbers) {
    const c = findCards(engine, playerId, num).find((x) => x.zone !== 'COST' && x.zone !== 'BATTLEFIELD');
    if (c) {
      engine.zoneMgr.moveCard(c.instanceId, 'COST', { isFaceUp: true, isReady: true });
    }
  }
  fillCostZone(engine, playerId, total);
  engine.zoneMgr.syncCostStats(playerId);
}

function putNonOrbOnDeckTop(engine: GameEngine, playerId: string) {
  const nonOrb = engine.zoneMgr
    .getCardsInZone(playerId, 'DECK')
    .find((c) => !db.getCard(c.cardNumber)?.signalOrb && !db.getCard(c.cardNumber)?.rulesText.includes('充能自'));
  if (nonOrb) engine.zoneMgr.moveCardToTopOfDeck(nonOrb.instanceId);
}

function pickChoice(engine: GameEngine, playerId: string, selectedIds: string[]) {
  const ch = engine.getState().currentPendingChoice;
  expect(ch, '预期存在待处理决策').toBeDefined();
  const res = engine.dispatchAction({
    type: 'SELECT_CHOICE_OPTION',
    playerId,
    pendingChoiceId: ch!.id,
    selectedIds,
  });
  expect(res.success, res.error).toBe(true);
  return res;
}

function advanceTurnTo(engine: GameEngine, targetPlayerId: string) {
  endTurn(engine);
  const st = engine.getState();
  if (st.phase === 'DRAW_CHARGE_PHASE' && !st.currentPendingChoice) {
    engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: st.activePlayerId });
  }
  expect(engine.getState().activePlayerId).toBe(targetPlayerId);
}

function cardState(engine: GameEngine, instanceId: string) {
  return engine.getState().cards[instanceId]!;
}

function ensureMainPhase(engine: GameEngine) {
  const st = engine.getState();
  if (st.phase === 'DRAW_CHARGE_PHASE' && !st.currentPendingChoice) {
    const res = engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: st.activePlayerId });
    expect(res.success, res.error).toBe(true);
  }
}

function finishCombat(engine: GameEngine, onChoice?: () => boolean) {
  for (let guard = 0; guard < 40; guard++) {
    const st = engine.getState();
    if (st.currentPendingChoice) {
      if (onChoice && onChoice()) continue;
      resolvePendingChoices(engine);
      continue;
    }
    if (!st.currentCombat && st.phase === 'MAIN_PHASE') return;
    if (st.timingWindow) {
      passInstantWindows(engine);
      continue;
    }
    if (st.currentCombat?.step === 'BLOCK') {
      const res = engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: st.nonActivePlayerId });
      expect(res.success, res.error).toBe(true);
      continue;
    }
    break;
  }
}

// ============================================================================
// 1. 注册表完整性与结构校验
// ============================================================================

describe('BP03《超刻溯梦》声明式效果注册表校验', () => {
  it('BP03_EFFECT_SPECS 精确覆盖官方卡表全部 90 张 BP03 卡牌且 validateCardEffectRegistry 零报错', () => {
    const officialBp03 = OFFICIAL_CARDS_DATA.filter((c) => c.cardNumber.startsWith('BP03-'));
    expect(officialBp03).toHaveLength(90);
    expect(BP03_EFFECT_SPECS).toHaveLength(90);

    const validatedMap = validateCardEffectRegistry(BP03_EFFECT_SPECS, db);
    expect(validatedMap.size).toBe(90);

    for (const def of officialBp03) {
      const spec = validatedMap.get(def.cardNumber);
      expect(spec, `缺少 ${def.cardNumber}`).toBeDefined();
      expect(spec!.name).toBe(def.name);
      expect(STARTER_DECK_SPEC_MAP.has(def.cardNumber)).toBe(true);
    }
  });

  it('异画 BP03-003 与 BP03-003【冠军】均已注册且能力结构等价、ID 互不冲突', () => {
    const base = BP03_EFFECT_SPECS.find((s) => s.cardNumber === 'BP03-003');
    const champ = BP03_EFFECT_SPECS.find((s) => s.cardNumber === 'BP03-003【冠军】');
    expect(base).toBeDefined();
    expect(champ).toBeDefined();
    expect(base!.entry).toBeDefined();
    expect(champ!.entry).toBeDefined();
    expect(base!.activate?.id).not.toBe(champ!.activate?.id);
  });

  it('不重复注册内置【充能自】及 BP03-054 非战术【瞬时】', () => {
    const s054 = BP03_EFFECT_SPECS.find((s) => s.cardNumber === 'BP03-054')!;
    expect(s054.activate).toBeUndefined();
    expect(s054.activates).toBeUndefined();

    for (const num of ['BP03-023', 'BP03-024', 'BP03-028', 'BP03-032']) {
      const spec = BP03_EFFECT_SPECS.find((s) => s.cardNumber === num)!;
      expect(spec.isSignalOrbCard, `${num} 应标记 isSignalOrbCard`).toBe(true);
    }

    for (let i = 81; i <= 89; i++) {
      const num = `BP03-0${i}`;
      const spec = BP03_EFFECT_SPECS.find((s) => s.cardNumber === num)!;
      expect(spec.isSignalOrbCard).toBe(true);
      expect(spec.triggers ?? []).toHaveLength(0);
    }
  });
});

// ============================================================================
// 2. 露西亚·誓焰 & 浮空体系 (BP03-001 ~ BP03-011)
// ============================================================================

describe('BP03 露西亚·誓焰 浮空体系', () => {
  it('BP03-001：战场【浮空】后下回合回归触发【出】最多1项；侵蚀>=4且从浮空升变可全选2项并消2同色球破坏费用合计<=8', () => {
    const engine = createEngine(
      makeDeck('ST01', [
        'BP03-001',
        'BP03-006',
        'BP03-001',
        'BP03-007',
        'BP03-081',
        'BP03-082',
      ]),
      makeDeck('ST02', ['ST02-003', 'ST02-005', 'ST02-008'])
    );

    // 先验证 BP03-001 自浮空并在我方下回合开始回场触发【出】
    const lucia1 = placeRole(engine, 'p1', 'BP03-001', 0, { instanceIndex: 0 });
    setOpenCosts(engine, 'p1', ['BP03-007'], 9);

    const actRes = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: lucia1.instanceId,
    });
    expect(actRes.success, actRes.error).toBe(true);
    expect(lucia1.zone).toBe('PROCESSING');
    expect(lucia1.isAirborne).toBe(true);

    // 推至我方下回合，lucia1 从处理区回场并触发【出】(侵蚀<4，最多选1项)
    advanceTurnTo(engine, 'p2');
    advanceTurnTo(engine, 'p1');
    expect(cardState(engine, lucia1.instanceId).zone).toBe('BATTLEFIELD');
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-001_MODE_1');
    expect(engine.getState().currentPendingChoice?.maxSelections).toBe(1);
    pickChoice(engine, 'p1', ['buff_self']);
    ensureMainPhase(engine);
    expect(engine.fieldMgr.calculateRoleEffectivePP(lucia1.instanceId)).toBe(8000);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(lucia1.instanceId)).toBe(2);

    // 验证将浮空模式角色作为升变对象升变成功后，再让侵蚀>=4且己方角色少于对方时从浮空(PROCESSING)回场全选 2 项
    const airborneHost = placeRole(engine, 'p1', 'BP03-006', 1);
    expect(engine.fieldMgr.airborneRole(airborneHost.instanceId)).toBe(true);
    engine.getState().players.p1!.erosionCount = 4;

    const oppA = placeRole(engine, 'p2', 'ST02-003', 0); // cost 4
    const oppB = placeRole(engine, 'p2', 'ST02-005', 1); // cost 2
    const oppC = placeRole(engine, 'p2', 'ST02-008', 2); // cost 5
    const r1 = findCard(engine, 'p1', 'BP03-081');
    const r2 = findCard(engine, 'p1', 'BP03-082');
    engine.zoneMgr.moveCard(r1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(r2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    const second001 = findCard(engine, 'p1', 'BP03-001', 1);
    engine.zoneMgr.moveCard(second001.instanceId, 'HAND', { isFaceUp: true });
    const ascRes = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: second001.instanceId,
      isAscension: true,
      targetAscensionCardId: airborneHost.instanceId,
    });
    expect(ascRes.success, ascRes.error).toBe(true);
    expect(cardState(engine, second001.instanceId).zone).toBe('BATTLEFIELD');
    expect(cardState(engine, second001.instanceId).ascendedFromAirborne).toBe(true);
    // 浮空升变入场立即触发【出】，且侵蚀>=4 时可选最多 2 项
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-001_MODE_2');
    expect(engine.getState().currentPendingChoice?.maxSelections).toBe(2);
    pickChoice(engine, 'p1', ['buff_self']);

    // 将 second001 【浮空】并于我方下回合开始回场再次触发【出】(从 PROCESSING 回归)
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: second001.instanceId,
      }).success
    ).toBe(true);
    advanceTurnTo(engine, 'p2');
    advanceTurnTo(engine, 'p1');

    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-001_MODE_2');
    expect(engine.getState().currentPendingChoice?.maxSelections).toBe(2);
    pickChoice(engine, 'p1', ['buff_self']);
    ensureMainPhase(engine);
    expect(engine.fieldMgr.calculateRoleEffectivePP(second001.instanceId)).toBe(8000);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(second001.instanceId)).toBe(2);
    expect(cardState(engine, oppA.instanceId).zone).toBe('BATTLEFIELD');
    expect(cardState(engine, oppB.instanceId).zone).toBe('BATTLEFIELD');
    expect(cardState(engine, oppC.instanceId).zone).toBe('BATTLEFIELD');
  });

  it('BP03-003 与 BP03-003【冠军】：出场回合可直接攻击玩家，且竖直状态【起】【浮空】后消2球强化《露西亚·誓焰》', () => {
    const engine = createEngine(
      makeDeck('ST01', ['BP03-003', 'BP03-003【冠军】', 'BP03-006', 'BP03-081', 'BP03-082']),
      makeDeck('ST02')
    );
    setOpenCosts(engine, 'p1', ['BP03-003', 'BP03-006'], 10);

    const anchor = placeRole(engine, 'p1', 'BP03-006', 0);
    const champ = findCard(engine, 'p1', 'BP03-003【冠军】');
    engine.zoneMgr.moveCard(champ.instanceId, 'HAND', { isFaceUp: true });

    const playRes = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: champ.instanceId,
    });
    expect(playRes.success, playRes.error).toBe(true);

    // 刚出场无【速攻】但因【出】允许攻击对方玩家
    putNonOrbOnDeckTop(engine, 'p1');
    putNonOrbOnDeckTop(engine, 'p2');
    const atkRes = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p1',
      attackerCardId: champ.instanceId,
      targetType: 'PLAYER',
    });
    expect(atkRes.success, atkRes.error).toBe(true);
    finishCombat(engine);

    // 横置后无法发动需要「竖直状态」的【起】
    expect(cardState(engine, champ.instanceId).isReady).toBe(false);
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: champ.instanceId,
      }).success
    ).toBe(false);

    // 普通版 BP03-003 处于竖直状态，可【浮空】并追加消 2 球赋予场上 anchor【速攻】PP+1000
    const r1 = findCard(engine, 'p1', 'BP03-081');
    const r2 = findCard(engine, 'p1', 'BP03-082');
    engine.zoneMgr.moveCard(r1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(r2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    const normal003 = placeRole(engine, 'p1', 'BP03-003', 2, { isReady: true, enteredEarlier: false });
    const actRes = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: normal003.instanceId,
    });
    expect(actRes.success, actRes.error).toBe(true);
    expect(cardState(engine, normal003.instanceId).isAirborne).toBe(true);

    const orbOpt = engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    pickChoice(engine, 'p1', [orbOpt.id]);
    pickChoice(engine, 'p1', [anchor.instanceId]);

    expect(engine.fieldMgr.calculateRoleEffectivePP(anchor.instanceId)).toBe(5000);
    expect(engine.fieldMgr.evaluateRoleStats(anchor.instanceId).keywords).toContain('速攻');
  });

  it('BP03-004 暗费减2费、BP03-005 自身浮空回场触发【自】、BP03-007/009/011 协同运作', () => {
    const engine = createEngine(
      makeDeck('ST01', ['BP03-004', 'BP03-005', 'BP03-007', 'BP03-009', 'BP03-011', 'BP03-011', 'BP03-081', 'BP03-082']),
      makeDeck('ST02')
    );
    setOpenCosts(engine, 'p1', ['BP03-004', 'BP03-005'], 4);
    const hidden = engine.zoneMgr.getCardsInZone('p1', 'DECK')[0]!;
    engine.zoneMgr.moveCard(hidden.instanceId, 'COST', { isFaceUp: false, isReady: true });
    engine.zoneMgr.syncCostStats('p1');

    // 4 明费 + 1 暗费 = 5 可用费；存在暗费时 6 费的 BP03-004 减 2 费后只需 4 费即可使用
    const bp03004 = findCard(engine, 'p1', 'BP03-004');
    engine.zoneMgr.moveCard(bp03004.instanceId, 'HAND', { isFaceUp: true });
    const pRes = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: bp03004.instanceId,
    });
    expect(pRes.success, pRes.error).toBe(true);
    expect(cardState(engine, bp03004.instanceId).zone).toBe('BATTLEFIELD');

    // 清理回卡组测试 BP03-005 / BP03-009 / BP03-011
    engine.fieldMgr.handleCardLeaveField(bp03004.instanceId);
    engine.zoneMgr.moveCardToBottomOfDeck(bp03004.instanceId);

    const bp03009 = placeRole(engine, 'p1', 'BP03-009', 0);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(bp03009.instanceId)).toBe(0);

    const bp03005 = placeRole(engine, 'p1', 'BP03-005', 1);
    const r1 = findCard(engine, 'p1', 'BP03-081');
    const r2 = findCard(engine, 'p1', 'BP03-082');
    engine.zoneMgr.moveCard(r1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(r2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    // 为 p1 准备好火属性明费再切到对方回合，在对方回合结束阶段用 BP03-011 把 BP03-005 【浮空】(手牌多留1张备用瞬时以保住瞬时窗口观察浮空态)
    setOpenCosts(engine, 'p1', ['BP03-007'], 4);
    advanceTurnTo(engine, 'p2');
    const bp03011 = findCard(engine, 'p1', 'BP03-011', 0);
    const dummyInstant = findCard(engine, 'p1', 'BP03-011', 1);
    engine.zoneMgr.moveCard(bp03011.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(dummyInstant.instanceId, 'HAND', { isFaceUp: true });

    // p2 结束主要阶段进入结束阶段瞬时窗口
    expect(engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' }).success).toBe(true);
    if (engine.getState().timingWindow?.priorityPlayerId === 'p2') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    }
    expect(engine.getState().timingWindow?.priorityPlayerId).toBe('p1');
    const instRes = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: bp03011.instanceId,
    });
    expect(instRes.success, instRes.error).toBe(true);
    pickChoice(engine, 'p1', [bp03005.instanceId]);
    expect(cardState(engine, bp03005.instanceId).isAirborne).toBe(true);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(bp03009.instanceId)).toBe(1);

    // 结束对方回合回到 p1 回合：BP03-005 回场自身先处理【出】可选浮空 (跳过)，随后触发 Q&A·6 【自】
    passInstantWindows(engine);
    expect(cardState(engine, bp03005.instanceId).zone).toBe('BATTLEFIELD');
    expect(engine.getState().currentPendingChoice?.effectType).toBe('CHOOSE_TRIGGER_ORDER');
    const entryOrderOpt = engine.getState().currentPendingChoice!.options.find(
      (o) => (o.payload as { abilityId?: string } | undefined)?.abilityId === 'dsl:CARD_ENTRY'
    )!;
    pickChoice(engine, 'p1', [entryOrderOpt.id]);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-005_AIRBORNE');
    pickChoice(engine, 'p1', []);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-005_ORB_COST');
    pickChoice(engine, 'p1', [engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    ensureMainPhase(engine);
    expect(engine.fieldMgr.calculateRoleEffectivePP(bp03005.instanceId)).toBe(6000);
    expect(engine.fieldMgr.evaluateRoleStats(bp03005.instanceId).keywords).toContain('速攻');
  });
});

// ============================================================================
// 3. 七实·芒星之迹 体系 (BP03-012 ~ BP03-022)
// ============================================================================

describe('BP03 七实·芒星之迹 体系', () => {
  it('BP03-012：信号球区>=7张全部置墓，基本PP变7777+攻击竖直角色+【贯通】，且覆盖对方角色 PP 为 70', () => {
    const engine = createEngine(
      makeDeck('ST03', [
        'BP03-012',
        'BP03-016',
        'BP03-019',
        'BP03-084',
        'BP03-085',
        'BP03-086',
        'ST03-012',
        'ST03-013',
        'ST03-014',
        'ST03-015', // 再塞一张常规球
      ]),
      makeDeck('ST02', ['ST02-001', 'ST02-008'])
    );
    const st = engine.getState();
    setOpenCosts(engine, 'p1', ['BP03-019'], 8);

    const baseNanami = placeRole(engine, 'p1', 'BP03-016', 0);
    // 放入 7 张信号球进 p1 信号球区
    const orbPool = engine.zoneMgr.getCardsInZone('p1', 'DECK').filter((c) => db.getCard(c.cardNumber)?.signalOrb).slice(0, 7);
    expect(orbPool.length).toBe(7);
    for (const o of orbPool) engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    // 对手场上有 ST02-001 和竖直的 ST02-008 (带 <升格者> 加PP效果 -> 5000，用于测试 Q&A·6「PP变为70」覆盖原增减)
    const oppLeader = placeRole(engine, 'p2', 'ST02-001', 0, { isReady: true });
    const oppLuna = placeRole(engine, 'p2', 'ST02-008', 1, { isReady: true });
    expect(engine.fieldMgr.calculateRoleEffectivePP(oppLuna.instanceId)).toBeGreaterThan(4000);

    const bp03012 = findCard(engine, 'p1', 'BP03-012');
    engine.zoneMgr.moveCard(bp03012.instanceId, 'HAND', { isFaceUp: true });
    const ascRes = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: bp03012.instanceId,
      isAscension: true,
      targetAscensionCardId: baseNanami.instanceId,
    });
    expect(ascRes.success, ascRes.error).toBe(true);

    pickChoice(engine, 'p1', ['opt_yes']);
    pickChoice(engine, 'p1', [oppLuna.instanceId]);

    expect(engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB')).toHaveLength(0);
    expect(engine.fieldMgr.calculateRoleEffectivePP(bp03012.instanceId)).toBe(7777);
    expect(engine.fieldMgr.evaluateRoleStats(bp03012.instanceId).keywords).toContain('贯通');
    expect(engine.fieldMgr.calculateRoleEffectivePP(oppLuna.instanceId)).toBe(70);

    // 能够攻击竖直状态的 oppLuna (PP=70)
    const atkRes = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p1',
      attackerCardId: bp03012.instanceId,
      targetType: 'CHARACTER',
      targetCardId: oppLuna.instanceId,
    });
    expect(atkRes.success, atkRes.error).toBe(true);
    expect(st.currentCombat?.targetCardId).toBe(oppLuna.instanceId);
    expect(cardState(engine, oppLeader.instanceId).zone).toBe('BATTLEFIELD');
  });

  it('BP03-013 攻击置雷手牌至球区底(选0张不触发) + 起动置墓3球给速攻，BP03-015 暗费出场突进，BP03-022 攻击<=4费竖直', () => {
    const engine = createEngine(
      makeDeck('ST03', ['BP03-013', 'BP03-015', 'BP03-018', 'BP03-021', 'BP03-022', 'BP03-081', 'BP03-082', 'BP03-083', 'BP03-084', 'BP03-085', 'BP03-086', 'BP03-087', 'BP03-088']),
      makeDeck('ST02', ['ST02-003', 'ST02-002'])
    );
    setOpenCosts(engine, 'p1', ['BP03-013', 'BP03-015'], 5);
    const hidden = engine.zoneMgr.getCardsInZone('p1', 'DECK')[0]!;
    engine.zoneMgr.moveCard(hidden.instanceId, 'COST', { isFaceUp: false, isReady: true });
    engine.zoneMgr.syncCostStats('p1');

    // 使用 BP03-015 并指定暗费一起支付
    const bp03015 = findCard(engine, 'p1', 'BP03-015');
    engine.zoneMgr.moveCard(bp03015.instanceId, 'HAND', { isFaceUp: true });
    const readyOpen = engine.zoneMgr.getCardsInZone('p1', 'COST').filter((c) => c.isFaceUp && c.isReady).slice(0, 4);
    const payRes = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: bp03015.instanceId,
      costCardInstanceIds: [hidden.instanceId, ...readyOpen.map((c) => c.instanceId)],
    });
    expect(payRes.success, payRes.error).toBe(true);
    expect(engine.fieldMgr.evaluateRoleStats(bp03015.instanceId).keywords).toContain('突进');

    // 测试 BP03-022 星芒构解：可攻击费用<=4的竖直，不能攻击费用>4的竖直
    const oppCost4 = placeRole(engine, 'p2', 'ST02-003', 0, { isReady: true }); // cost 4
    const oppCost7 = placeRole(engine, 'p2', 'ST02-002', 1, { isReady: true }); // cost 7
    fillCostZone(engine, 'p1', 4);
    const bp03022 = findCard(engine, 'p1', 'BP03-022');
    engine.zoneMgr.moveCard(bp03022.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: bp03022.instanceId }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [bp03015.instanceId]);

    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: bp03015.instanceId,
        targetType: 'CHARACTER',
        targetCardId: oppCost7.instanceId,
      }).success
    ).toBe(false);

    const bp03013 = placeRole(engine, 'p1', 'BP03-013', 1);
    const lightningInHand = findCard(engine, 'p1', 'BP03-021');
    engine.zoneMgr.moveCard(lightningInHand.instanceId, 'HAND', { isFaceUp: true });

    // BP03-013 未获得可攻击竖直角色能力，攻击竖直 oppCost4 应失败
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: bp03013.instanceId,
        targetType: 'CHARACTER',
        targetCardId: oppCost4.instanceId,
      }).success
    ).toBe(false);

    // 攻击玩家，弹出 BP03-013 手牌雷置球区底选择，选 0 张不抽牌且 PP 不变 7777
    const handCountBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    putNonOrbOnDeckTop(engine, 'p1');
    putNonOrbOnDeckTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: bp03013.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-013_HAND_TO_ORB');
    pickChoice(engine, 'p1', []);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(handCountBefore);
    expect(engine.fieldMgr.calculateRoleEffectivePP(bp03013.instanceId)).toBe(6000);
    finishCombat(engine);

    // BP03-013 在信号球>=7 时发动【起】自动将最上方 3 张信号球置墓，并选 BP03-018 给【速攻】
    const bp03018 = placeRole(engine, 'p1', 'BP03-018', 2);
    for (const existingOrb of engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB')) {
      engine.zoneMgr.moveCardToBottomOfDeck(existingOrb.instanceId);
    }
    const extraOrbs = engine.zoneMgr.getCardsInZone('p1', 'DECK').filter((c) => db.getCard(c.cardNumber)?.signalOrb).slice(0, 7);
    expect(extraOrbs).toHaveLength(7);
    for (const o of extraOrbs) engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    expect(engine.getState().currentPendingChoice).toBeUndefined();

    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: bp03013.instanceId,
      }).success
    ).toBe(true);
    pickChoice(engine, 'p1', ['opt_yes']);
    pickChoice(engine, 'p1', [bp03018.instanceId]);
    expect(extraOrbs.slice(-3).every((c) => cardState(engine, c.instanceId).zone === 'GRAVEYARD')).toBe(true);
    expect(extraOrbs.slice(0, 4).every((c) => cardState(engine, c.instanceId).zone === 'SIGNAL_ORB')).toBe(true);
    expect(engine.fieldMgr.evaluateRoleStats(bp03018.instanceId).keywords).toContain('速攻');
  });
});

// ============================================================================
// 4. 里·超刻 & 充能自体系 (BP03-023 ~ BP03-033)
// ============================================================================

describe('BP03 里·超刻 充能自体系', () => {
  it('BP03-023/026/027/033：充能持有【充能自】的卡牌后触发 BP03-023 升变出场、攻击结束炸怪、BP03-026 减费及 BP03-027 判定非信号球充能自', () => {
    const engine = createEngine(
      makeDeck('ST01', ['BP03-023', 'BP03-023', 'BP03-024', 'BP03-026', 'BP03-027', 'BP03-029', 'BP03-031', 'BP03-032', 'BP03-033', 'BP03-081', 'BP03-082']),
      makeDeck('ST02', ['ST02-003'])
    );
    setOpenCosts(engine, 'p1', ['BP03-024'], 8);

    const leeAttacker = placeRole(engine, 'p1', 'BP03-029', 0);
    const bp03033 = findCard(engine, 'p1', 'BP03-033');
    engine.zoneMgr.moveCard(bp03033.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: bp03033.instanceId,
        targetEquipRoleId: leeAttacker.instanceId,
      }).success
    ).toBe(true);
    expect(engine.fieldMgr.evaluateRoleStats(leeAttacker.instanceId).charge).toBe(2);

    const oppVictim = placeRole(engine, 'p2', 'ST02-003', 0); // PP 4000 <= 5000
    const r1 = findCard(engine, 'p1', 'BP03-081');
    const r2 = findCard(engine, 'p1', 'BP03-082');
    engine.zoneMgr.moveCard(r1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(r2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    // 放 1 张《里·超刻》(BP03-031) 在手牌确保 BP03-029 攻击触发弹出可选弹窗，再选 0 张放牌组顶
    const leeInHand = findCard(engine, 'p1', 'BP03-031');
    engine.zoneMgr.moveCard(leeInHand.instanceId, 'HAND', { isFaceUp: true });

    // 把 1 张 BP03-023 置顶用于第一次充能，1 张非充能牌作为第二次充能；p2 牌组顶放非充能牌避免打断伤害步骤
    const chargeLee = findCard(engine, 'p1', 'BP03-023', 0);
    putNonOrbOnDeckTop(engine, 'p1');
    engine.zoneMgr.moveCardToTopOfDeck(chargeLee.instanceId);
    putNonOrbOnDeckTop(engine, 'p2');

    // 攻击对方玩家 (先取消可选攻击放牌组顶选择)
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: leeAttacker.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    pickChoice(engine, 'p1', []); // BP03-029 攻击时选 0 张放牌组顶
    passInstantWindows(engine);
    engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' }); // 不阻挡
    passInstantWindows(engine);

    // 第 1 次充能命中 BP03-023，弹出 BP03_023_CHARGE_ASCEND
    expect(engine.getState().currentPendingChoice?.effectType).toBe('BP03_023_CHARGE_ASCEND');
    pickChoice(engine, 'p1', ['opt_yes']);
    // BP03-023 成功无视费用上限 9 以 3 费覆盖 leeAttacker 升变出场并获【速攻】
    expect(cardState(engine, chargeLee.instanceId).zone).toBe('BATTLEFIELD');
    expect(engine.fieldMgr.evaluateRoleStats(chargeLee.instanceId).keywords).toContain('速攻');
    finishCombat(engine);

    // 本回合《里·超刻》攻击中充能过【充能自】，BP03-026 费用减 2 变成 4 费；且 BP03-027 公开顶 1 张 BP03-023(二号) 也可命中
    fillCostZone(engine, 'p1', 9);
    const lee023Second = findCard(engine, 'p1', 'BP03-023', 1);
    engine.zoneMgr.moveCardToTopOfDeck(lee023Second.instanceId);
    const bp03027 = findCard(engine, 'p1', 'BP03-027');
    engine.zoneMgr.moveCard(bp03027.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: bp03027.instanceId }).success
    ).toBe(true);
    expect(engine.fieldMgr.evaluateRoleStats(bp03027.instanceId).canAttackPlayerOnEnterTurn).toBe(true);
    expect(engine.zoneMgr.getCardsInZone('p1', 'DECK')[0]!.instanceId).toBe(lee023Second.instanceId);

    // 验证 BP03-026 在只剩 4 费时仍能成功使用 (6-2=4)
    setOpenCosts(engine, 'p1', ['BP03-024'], 4);
    const bp03026 = findCard(engine, 'p1', 'BP03-026');
    engine.zoneMgr.moveCard(bp03026.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: bp03026.instanceId }).success
    ).toBe(true);
    expect(cardState(engine, bp03026.instanceId).zone).toBe('BATTLEFIELD');

    // 验证 chargeLee (BP03-023) 自己再攻击时，充能非信号球【充能自】BP03-032 弹出 BP03_032_CHARGE_BOUNCE_BOTTOM
    // 且攻击结束时 COMBAT_CHARGED_AUTO 触发将 oppVictim 破坏进墓地
    fillCostZone(engine, 'p1', 6);
    const bp03032 = findCard(engine, 'p1', 'BP03-032');
    engine.zoneMgr.moveCardToTopOfDeck(bp03032.instanceId);
    putNonOrbOnDeckTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: chargeLee.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    passInstantWindows(engine);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('BP03_032_CHARGE_BOUNCE_BOTTOM');
    pickChoice(engine, 'p1', []);
    finishCombat(engine, () => {
      const ch = engine.getState().currentPendingChoice;
      if (ch?.effectType === 'DSL_BP03-023_ORB_COST') {
        const pay = ch.options.find((o) => o.id !== 'skip')!;
        pickChoice(engine, 'p1', [pay.id]);
        return true;
      }
      if (ch?.effectType === 'DSL_BP03-023_DESTROY') {
        pickChoice(engine, 'p1', [oppVictim.instanceId]);
        return true;
      }
      return false;
    });
    expect(cardState(engine, bp03032.instanceId).zone).toBe('HAND');
    expect(engine.getState().players.p1!.chargedAutoByLeeThisTurn).toBe(true);
    expect(cardState(engine, oppVictim.instanceId).zone).toBe('GRAVEYARD');
  });
});

// ============================================================================
// 5. 罗塞塔·凛冽 & 使用张数计数体系 (BP03-034 ~ BP03-044)
// ============================================================================

describe('BP03 罗塞塔·凛冽 使用张数体系', () => {
  it('BP03-034~044：1张/2张/3张分支、手牌增加计数与第3张减费(-2)/PP+1500/回合末抽1/攻击buff', () => {
    const engine = createEngine(
      makeDeck('ST03', [
        'BP03-034',
        'BP03-034',
        'BP03-035',
        'BP03-036',
        'BP03-038',
        'BP03-039',
        'BP03-040',
        'BP03-041',
        'BP03-042',
        'BP03-044',
      ]),
      makeDeck('ST02', ['ST02-004'])
    );
    const st = engine.getState();
    setOpenCosts(engine, 'p1', ['BP03-034', 'BP03-042'], 10);

    // 预先放 1 张独立《冈格尼尔》在场上，确保 BP03-034 第 1 张使用后【出】能向其下方垫牌
    const gungnir = findCard(engine, 'p1', 'BP03-042');
    engine.zoneMgr.moveCard(gungnir.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.fieldMgr.playStandaloneEquipment(engine.getState().activePlayerId, gungnir.instanceId, 0)).toBe(true);

    // 第 1 张：BP03-034 (cardsPlayedThisTurn = 1) -> 向《冈格尼尔》下方置入 1 张手牌
    const r034a = findCard(engine, 'p1', 'BP03-034', 0);
    const fillerHand = findCard(engine, 'p1', 'BP03-040');
    engine.zoneMgr.moveCard(r034a.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(fillerHand.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: r034a.instanceId }).success
    ).toBe(true);
    expect(st.players.p1!.cardsPlayedThisTurn).toBe(1);
    pickChoice(engine, 'p1', [gungnir.instanceId]);
    pickChoice(engine, 'p1', [fillerHand.instanceId]);
    expect(gungnir.underneathCardIds).toContain(fillerHand.instanceId);

    // 第 2 张：BP03-034 (cardsPlayedThisTurn = 2) -> 下 1 张《罗塞塔·凛冽》费用 -4
    fillCostZone(engine, 'p1', 10);
    const r034b = findCard(engine, 'p1', 'BP03-034', 1);
    engine.zoneMgr.moveCard(r034b.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: r034b.instanceId }).success
    ).toBe(true);
    expect(st.players.p1!.cardsPlayedThisTurn).toBe(2);

    // 第 3 张：BP03-036 (原本 5 费，前已使用 2 张减 2 费，再叠加前一张的 -4 费 -> 0 费！且自身【出】无额外效果)
    // 先把所有可用费消耗至只剩 0 费，验证第 3 张 BP03-036 确实减到 0 费！
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'COST')) {
      c.isReady = false;
    }
    engine.zoneMgr.syncCostStats('p1');
    const bp03036 = findCard(engine, 'p1', 'BP03-036');
    engine.zoneMgr.moveCard(bp03036.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: bp03036.instanceId }).success
    ).toBe(true);
    expect(bp03036.zone).toBe('BATTLEFIELD');
    expect(st.players.p1!.cardsPlayedThisTurn).toBe(3);

    // 验证 BP03-039 在回合结束时若已使用卡牌张数为 3 张则抽 1 张牌 (卡位 4 空余)
    const bp03039 = placeRole(engine, 'p1', 'BP03-039', 4);
    const handBeforeEnd = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    endTurn(engine);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBeforeEnd + 1);
    expect(bp03039.zone).toBe('BATTLEFIELD');

    // 下一个我方回合测 BP03-041 增加计数 + BP03-038 第 3 张突进 PP+1500 (先腾出 2 个空槽位)
    advanceTurnTo(engine, 'p1');
    engine.fieldMgr.handleCardLeaveField(r034a.instanceId);
    engine.zoneMgr.moveCardToBottomOfDeck(r034a.instanceId);
    engine.fieldMgr.handleCardLeaveField(bp03036.instanceId);
    engine.zoneMgr.moveCardToBottomOfDeck(bp03036.instanceId);
    setOpenCosts(engine, 'p1', ['BP03-035'], 10);
    const bp03041 = findCard(engine, 'p1', 'BP03-041');
    engine.zoneMgr.moveCard(bp03041.instanceId, 'HAND', { isFaceUp: true });
    // 打出第 1 张 BP03-041 并视为增加 1 张 -> 计数直接变 2
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: bp03041.instanceId }).success
    ).toBe(true);
    pickChoice(engine, 'p1', ['opt_yes']);
    expect(st.players.p1!.cardsPlayedThisTurn).toBe(2);

    // 紧接着打出 BP03-038 作为第 3 张 -> 获得【突进】且 PP+1500
    const bp03038 = findCard(engine, 'p1', 'BP03-038');
    engine.zoneMgr.moveCard(bp03038.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: bp03038.instanceId }).success
    ).toBe(true);
    expect(engine.fieldMgr.evaluateRoleStats(bp03038.instanceId).keywords).toContain('突进');
    expect(engine.fieldMgr.calculateRoleEffectivePP(bp03038.instanceId)).toBe(5500);
  });
});

// ============================================================================
// 6. 艾拉·万华 & 艺术协会 体系 (BP03-045 ~ BP03-055, BP03-071 ~ BP03-074)
// ============================================================================

describe('BP03 艾拉·万华 & 艺术协会 体系', () => {
  it('BP03-052 费用上限扩展至 11、BP03-045 费用区>=7张换人出场 (编号不同) 与 BP03-054 攻击自由时点瞬时不付2费加PP', () => {
    const engine = createEngine(
      makeDeck('ST01', [
        'BP03-045',
        'BP03-045',
        'BP03-046',
        'BP03-047',
        'BP03-048',
        'BP03-049',
        'BP03-050',
        'BP03-051',
        'BP03-052',
        'BP03-054',
      ]),
      makeDeck('ST02', ['ST02-005'])
    );
    const st = engine.getState();

    // 放入 8 张不同卡号的《艾拉·万华》明费进费用区 (含 BP03-052 和 BP03-045#0)
    const aylaCostNumbers = ['BP03-045', 'BP03-046', 'BP03-047', 'BP03-048', 'BP03-049', 'BP03-050', 'BP03-051', 'BP03-052', 'BP03-054'];
    for (const num of aylaCostNumbers) {
      const c = findCard(engine, 'p1', num, 0);
      engine.zoneMgr.moveCard(c.instanceId, 'COST', { isFaceUp: true, isReady: true });
    }
    // 再多补 2 张达到 11 张，验证 BP03-052 允许费用区容纳第 11 张卡牌而不被送墓
    const extras = engine.zoneMgr.getCardsInZone('p1', 'DECK').slice(0, 2);
    for (const ex of extras) engine.zoneMgr.moveCard(ex.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.syncCostStats('p1');
    expect(engine.zoneMgr.getMaxCostZoneCapacity('p1')).toBe(11);
    expect(st.players.p1!.totalCostCount).toBe(11);

    // 验证「该牌以外」= 编号不同：若场上只有另一张同卡号 BP03-045#1，无法作为 BP03-045#0 的对象完成替换
    const same045OnField = placeRole(engine, 'p1', 'BP03-045', 0, { instanceIndex: 1 });
    const ayla045InCost = findCard(engine, 'p1', 'BP03-045', 0);
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: ayla045InCost.instanceId,
      }).success
    ).toBe(true);
    // 场上没有不同编号的《艾拉·万华》，无法选目标因此不出场
    expect(ayla045InCost.zone).toBe('COST');
    expect(same045OnField.zone).toBe('BATTLEFIELD');

    // 将不同编号的角色放到场上，再将费用区所有卡竖直
    engine.fieldMgr.handleCardLeaveField(same045OnField.instanceId);
    engine.zoneMgr.moveCardToBottomOfDeck(same045OnField.instanceId);
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'COST')) c.isReady = true;
    engine.zoneMgr.syncCostStats('p1');

    const otherAyla = placeRole(engine, 'p1', 'BP03-048', 0);
    engine.zoneMgr.moveCard(findCard(engine, 'p1', 'BP03-050').instanceId, 'COST', { isFaceUp: true, isReady: true });
    // 放 1 张 BP03-046 在战场被 BP03-045 替换出场
    const field046 = findCard(engine, 'p1', 'BP03-046');
    engine.zoneMgr.moveCard(field046.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.fieldMgr.playRoleCard('p1', field046.instanceId, 1)).toBe(true);
    field046.turnEnteredZone = 0;

    // 发动费用区 BP03-045#0 出场替换战场 field046
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: ayla045InCost.instanceId,
      }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [field046.instanceId]);
    expect(field046.zone).toBe('DECK');
    expect(ayla045InCost.zone).toBe('BATTLEFIELD');

    // 攻击时在自由时点使用费用区的 BP03-054 (不消耗费用) 给场上 <艺术协会> 加 1000 PP 直到攻击结束
    // 在 p2 放 1 张竖直角色确保自由时点结束后战斗停在 BLOCK 步骤以便观察攻击中 PP 加成
    placeRole(engine, 'p2', 'ST02-005', 0, { isReady: true });
    const ayla054InCost = findCard(engine, 'p1', 'BP03-054');
    // 保证攻击前 otherAyla 未横置且在场
    otherAyla.turnEnteredZone = 0;
    otherAyla.isReady = true;
    putNonOrbOnDeckTop(engine, 'p1');
    putNonOrbOnDeckTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: ayla045InCost.instanceId, // 拥有【速攻】
        targetType: 'PLAYER',
      }).success
    ).toBe(true);

    // 自由时点若 p2 先有优先权则让 p2 过，再由 p1 使用 BP03-054 非战术【瞬时】
    if (engine.getState().timingWindow?.priorityPlayerId === 'p2') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    }
    expect(engine.getState().timingWindow?.priorityPlayerId).toBe('p1');
    expect(
      engine.dispatchAction({
        type: 'USE_INSTANT',
        playerId: 'p1',
        cardInstanceId: ayla054InCost.instanceId,
      }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [ayla045InCost.instanceId]);
    expect(cardState(engine, ayla054InCost.instanceId).zone).toBe('DECK');
    expect(engine.fieldMgr.calculateRoleEffectivePP(ayla045InCost.instanceId)).toBe(7000);

    // 攻击结束后 BP03-054 增益消失回到 6000
    finishCombat(engine);
    expect(engine.fieldMgr.calculateRoleEffectivePP(ayla045InCost.instanceId)).toBe(6000);
  });

  it('BP03-071 赛琳娜·岚音「X种及以上」累积执行 vs BP03-074 风暴终曲「X种」仅执行对应项 (Q&A·6)', () => {
    const engine = createEngine(
      makeDeck('ST03', [
        'BP03-071',
        'BP03-072',
        'BP03-072',
        'BP03-074',
        'BP03-074',
        'BP03-081',
        'BP03-084',
        'BP03-087',
        'BP03-082',
        'BP03-085',
        'BP03-088',
      ]),
      makeDeck('ST02')
    );
    const st = engine.getState();
    setOpenCosts(engine, 'p1', ['BP03-071', 'BP03-072', 'BP03-074'], 10);
    // 横置 2 张 <艺术协会> 明费 (BP03-072#0 和 BP03-074#0) 以测试竖直效果
    const tappedAssoc1 = findCard(engine, 'p1', 'BP03-072', 0);
    const tappedAssoc2 = findCard(engine, 'p1', 'BP03-074', 0);
    engine.zoneMgr.moveCard(tappedAssoc1.instanceId, 'COST', { isFaceUp: true, isReady: false });
    engine.zoneMgr.moveCard(tappedAssoc2.instanceId, 'COST', { isFaceUp: true, isReady: false });
    engine.zoneMgr.syncCostStats('p1');

    // 1. 信号球区放入 红+蓝+黄 (3种不同标记)，使用 BP03-071 消除 3 球 -> 1种/2种/3种三项全执行！
    const r1 = findCard(engine, 'p1', 'BP03-081');
    const b1 = findCard(engine, 'p1', 'BP03-084');
    const y1 = findCard(engine, 'p1', 'BP03-087');
    engine.zoneMgr.moveCard(r1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(b1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(y1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    const bp03071 = findCard(engine, 'p1', 'BP03-071');
    engine.zoneMgr.moveCard(bp03071.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: bp03071.instanceId }).success
    ).toBe(true);
    pickChoice(engine, 'p1', ['elim_3']);
    pickChoice(engine, 'p1', [st.currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    pickChoice(engine, 'p1', [tappedAssoc1.instanceId, tappedAssoc2.instanceId]);

    expect(engine.fieldMgr.calculateRoleEffectivePP(bp03071.instanceId)).toBe(6500);
    expect(engine.fieldMgr.evaluateRoleStats(bp03071.instanceId).keywords).toContain('速攻');
    expect(tappedAssoc1.isReady).toBe(true);
    expect(tappedAssoc2.isReady).toBe(true);

    // 2. 放入另一组 红+蓝+黄，横置 1 张费用<=5 的 <赛琳娜> 角色 (BP03-072#1)，打出 BP03-074#1
    fillCostZone(engine, 'p1', 10);
    const selena4 = placeRole(engine, 'p1', 'BP03-072', 1, { isReady: false, instanceIndex: 1 });
    tappedAssoc1.isReady = false;
    engine.zoneMgr.syncCostStats('p1');
    const r2 = findCard(engine, 'p1', 'BP03-082');
    const b2 = findCard(engine, 'p1', 'BP03-085');
    const y2 = findCard(engine, 'p1', 'BP03-088');
    engine.zoneMgr.moveCard(r2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(b2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(y2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    const spell = findCard(engine, 'p1', 'BP03-074', 1);
    engine.zoneMgr.moveCard(spell.instanceId, 'HAND', { isFaceUp: true });
    const handCountBeforeAfterAdd = engine.zoneMgr.getCardsInZone('p1', 'HAND').length - 1;
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: spell.instanceId }).success
    ).toBe(true);
    pickChoice(engine, 'p1', ['elim_3']);
    pickChoice(engine, 'p1', [st.currentPendingChoice!.options.find((o) => o.id !== 'skip')!.id]);
    pickChoice(engine, 'p1', [selena4.instanceId]);

    // 「3种」仅竖直赛琳娜，不会触发抽1张也不会竖直费用区
    expect(selena4.isReady).toBe(true);
    expect(tappedAssoc1.isReady).toBe(false);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(handCountBeforeAfterAdd);
  });
});

// ============================================================================
// 7. 莉莉丝·谬影 体系 (BP03-056 ~ BP03-066)
// ============================================================================

describe('BP03 莉莉丝·谬影 赌场博弈体系', () => {
  it('BP03-056 复制墓地 BP03-061 奇偶猜测 (宣言不同则回合结束竖直) 与 BP03-065/066 声明费用联动', () => {
    const engine = createEngine(
      makeDeck('ST02', ['BP03-056', 'BP03-061', 'BP03-065', 'BP03-081', 'BP03-082']),
      makeDeck('ST02')
    );
    const st = engine.getState();
    setOpenCosts(engine, 'p1', ['BP03-056', 'BP03-061'], 8);

    const paperHouse = placeRole(engine, 'p1', 'BP03-056', 0, { isReady: false });
    const gyLilith = findCard(engine, 'p1', 'BP03-061');
    engine.zoneMgr.moveCard(gyLilith.instanceId, 'GRAVEYARD', { isFaceUp: true });

    const r1 = findCard(engine, 'p1', 'BP03-081');
    const r2 = findCard(engine, 'p1', 'BP03-082');
    engine.zoneMgr.moveCard(r1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(r2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    // 把 BP03-065 (偶数 2/4/6/8) 置顶
    const bloodCard = findCard(engine, 'p1', 'BP03-065');
    engine.zoneMgr.moveCardToTopOfDeck(bloodCard.instanceId);

    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: paperHouse.instanceId,
      }).success
    ).toBe(true);
    // 复制墓地 BP03-061 的第 2 个【出】能力 (奇偶猜测)
    pickChoice(engine, 'p1', [gyLilith.instanceId]);
    pickChoice(engine, 'p1', ['1']);
    // 对方宣言「奇数」
    expect(st.currentPendingChoice?.playerId).toBe('p2');
    pickChoice(engine, 'p2', ['odd']);
    // 公开到 BP03-065，由 <莉莉丝> 玩家宣言其视为的偶数费用 (如 8)
    expect(st.currentPendingChoice?.effectType).toBe('DSL_LILITH_DECLARE_BP03-065');
    pickChoice(engine, 'p1', ['8']);
    // 实际 8(偶数) !== 宣言 odd(奇数) -> 选择我方 <莉莉丝> 角色 paperHouse 回合结束时竖直
    pickChoice(engine, 'p1', [paperHouse.instanceId]);

    // 被复制的墓地 BP03-061 已移回牌组底
    expect(gyLilith.zone).toBe('DECK');
    expect(paperHouse.isReady).toBe(false);

    // 结束我方回合时，时限触发器将 paperHouse 竖直
    endTurn(engine);
    expect(paperHouse.isReady).toBe(true);
  });

  it('BP03-058 公开顶 5 张并凑 5 张严格递增放置墓地 (含声明 BP03-066 费用)，墓地出场 <=4 费《莉莉丝·谬影》', () => {
    const engine = createEngine(
      makeDeck('ST02', ['BP03-058', 'BP03-061', 'BP03-062', 'BP03-064', 'BP03-066', 'BP03-081', 'ST02-003']),
      makeDeck('ST02')
    );
    setOpenCosts(engine, 'p1', ['BP03-058'], 8);

    // 牌组顶放：BP03-081 (C:0)、BP03-066 (可宣言为 1/3/5/7，选 1)、BP03-064 (C:2)、BP03-062 (C:3)、ST02-003 (C:4)
    const c0 = findCard(engine, 'p1', 'BP03-081');
    const c1Flex = findCard(engine, 'p1', 'BP03-066');
    const c2 = findCard(engine, 'p1', 'BP03-064');
    const c3 = findCard(engine, 'p1', 'BP03-062');
    const c4 = findCard(engine, 'p1', 'ST02-003');
    // 墓地先放一张 4 费《莉莉丝·谬影》待拉起
    const gyTarget = findCard(engine, 'p1', 'BP03-061');
    engine.zoneMgr.moveCard(gyTarget.instanceId, 'GRAVEYARD', { isFaceUp: true });

    for (const c of [c4, c3, c2, c1Flex, c0]) {
      engine.zoneMgr.moveCardToTopOfDeck(c.instanceId);
    }

    const bp03058 = findCard(engine, 'p1', 'BP03-058');
    engine.zoneMgr.moveCard(bp03058.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: bp03058.instanceId }).success
    ).toBe(true);

    // 声明公开的 BP03-066 为费用 1
    pickChoice(engine, 'p1', ['1']);
    // 选中费用严格递增的 0, 1, 2, 3, 4 共 5 张牌
    pickChoice(engine, 'p1', [c0.instanceId, c1Flex.instanceId, c2.instanceId, c3.instanceId, c4.instanceId]);
    // 从墓地出场 gyTarget (BP03-061, cost 4 <= 4)
    pickChoice(engine, 'p1', [gyTarget.instanceId]);
    resolvePendingChoices(engine); // 处理 gyTarget 出场后的第1个/第2个【出】弹窗(快速跳过即可)
    expect(cardState(engine, gyTarget.instanceId).zone).toBe('BATTLEFIELD');
    expect([c0, c1Flex, c2, c3, c4].every((c) => cardState(engine, c.instanceId).zone === 'GRAVEYARD')).toBe(true);
  });

  it('BP03-059 黑杰克 21 点：公开手牌<莉莉丝> + 牌组顶牌并声明费用凑出合计 21 点给予对方 -9999 PP', () => {
    const engine = createEngine(
      makeDeck('ST02', ['BP03-059', 'BP03-057', 'BP03-065', 'BP03-066']),
      makeDeck('ST02', ['ST02-002'])
    );
    const st = engine.getState();
    setOpenCosts(engine, 'p1', ['BP03-059'], 8);
    const oppTarget = placeRole(engine, 'p2', 'ST02-002', 0);

    // 手牌公开 BP03-057 (C:6) + BP03-065 (血色醍醐带<莉莉丝>特征，宣言为 8) => 6 + 8 = 14
    // 牌组顶翻出 BP03-066 (繁宵蜃景之哀带<莉莉丝>特征，宣言为 7) => 14 + 7 = 21！
    const h57 = findCard(engine, 'p1', 'BP03-057');
    const h65 = findCard(engine, 'p1', 'BP03-065');
    const d66 = findCard(engine, 'p1', 'BP03-066');
    engine.zoneMgr.moveCard(h57.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(h65.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCardToTopOfDeck(d66.instanceId);

    const bp03059 = findCard(engine, 'p1', 'BP03-059');
    engine.zoneMgr.moveCard(bp03059.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: bp03059.instanceId }).success
    ).toBe(true);

    pickChoice(engine, 'p1', [h57.instanceId, h65.instanceId]);
    pickChoice(engine, 'p1', ['8']); // BP03-065 宣言为 8
    pickChoice(engine, 'p1', ['reveal_one']);
    pickChoice(engine, 'p1', ['7']); // BP03-066 宣言为 7
    pickChoice(engine, 'p1', ['stop']);
    expect(st.currentPendingChoice?.effectType).toBe('DSL_CUSTOM_BP03_059_DEBUFF');
    const debuffRes = pickChoice(engine, 'p1', [oppTarget.instanceId]);

    // 9.4：8000 PP 角色被 -9999 PP 降至 <= 0 后立即因规则破坏置入墓地
    expect(cardState(engine, oppTarget.instanceId).zone).toBe('GRAVEYARD');
    expect(st.battlefields.p2?.[0]?.roleCardId).toBeUndefined();
    expect(
      debuffRes.events.some(
        (e) => e.type === 'CARD_DESTROYED' && e.cardInstanceId === oppTarget.instanceId && e.reason === 'PP_ZERO'
      )
    ).toBe(true);
  });

  it('BP03-064 双方同时公开至信号球洗牌抽2弃1、BP03-065 血色醍醐攻击瞬时洗回4张改DP', () => {
    const engine = createEngine(
      makeDeck('ST02', ['BP03-063', 'BP03-064', 'BP03-065', 'BP03-057', 'BP03-058', 'BP03-061', 'BP03-062', 'BP03-081']),
      makeDeck('ST02', ['ST02-005'])
    );
    const st = engine.getState();
    setOpenCosts(engine, 'p1', ['BP03-063', 'BP03-065'], 8);

    // 1. BP03-064：双方牌组顶第 1 张保证是非信号球（避开 BP03-065/066 以免触发公开改费宣言），第 2 张 p1 放信号球 BP03-081
    putNonOrbOnDeckTop(engine, 'p2');
    const p1Orb = findCard(engine, 'p1', 'BP03-081');
    engine.zoneMgr.moveCardToTopOfDeck(p1Orb.instanceId);
    const p1SafeNonOrb = engine.zoneMgr
      .getCardsInZone('p1', 'DECK')
      .find(
        (c) =>
          c.cardNumber !== 'BP03-065' &&
          c.cardNumber !== 'BP03-066' &&
          !db.getCard(c.cardNumber)?.signalOrb &&
          !db.getCard(c.cardNumber)?.rulesText.includes('充能自')
      )!;
    engine.zoneMgr.moveCardToTopOfDeck(p1SafeNonOrb.instanceId);

    const bp03064 = findCard(engine, 'p1', 'BP03-064');
    engine.zoneMgr.moveCard(bp03064.instanceId, 'HAND', { isFaceUp: true });
    const p1HandBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: bp03064.instanceId }).success
    ).toBe(true);
    // p1 公开到信号球，抽 2 并选 1 弃置 (+2 - 1 = +1 手牌，且已打出的 bp03064 -1 = 净变化 0)
    const discardChoice = engine.getState().currentPendingChoice!;
    expect(discardChoice.effectType).toBe('DSL_CUSTOM_BP03_064_DISCARD');
    pickChoice(engine, 'p1', [discardChoice.options[0]!.id]);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(p1HandBefore);

    // 2. BP03-065：墓地放 4 张《莉莉丝·谬影》，在 bp03064 攻击自由时点打出使自身 DP+1 (放竖直阻挡者停在 BLOCK 以检查攻击中 DP)
    placeRole(engine, 'p2', 'ST02-005', 0, { isReady: true });
    const gyLiliths = ['BP03-057', 'BP03-058', 'BP03-061', 'BP03-062'].map((n) => findCard(engine, 'p1', n));
    for (const c of gyLiliths) engine.zoneMgr.moveCard(c.instanceId, 'GRAVEYARD', { isFaceUp: true });
    cardState(engine, bp03064.instanceId).turnEnteredZone = 0;

    const bloodSpell = findCard(engine, 'p1', 'BP03-065');
    engine.zoneMgr.moveCard(bloodSpell.instanceId, 'HAND', { isFaceUp: true });

    // 主阶段无战斗不能打 BP03-065
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: bloodSpell.instanceId }).success
    ).toBe(false);

    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: bp03064.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    if (engine.getState().timingWindow?.priorityPlayerId === 'p2') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    }
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: bloodSpell.instanceId }).success
    ).toBe(true);
    pickChoice(engine, 'p1', gyLiliths.map((c) => c.instanceId));
    pickChoice(engine, 'p1', [bp03064.instanceId]);
    pickChoice(engine, 'p1', ['dp_plus_1']);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(bp03064.instanceId)).toBe(1);
    expect(gyLiliths.every((c) => cardState(engine, c.instanceId).zone === 'DECK')).toBe(true);
    expect(st.currentCombat?.attackerCardId).toBe(bp03064.instanceId);
  });
});

// ============================================================================
// 8. 罗兰·戏炎 / 深红之渊 / 暗费规则 / 标准信号球 (BP03-067 ~ BP03-089)
// ============================================================================

describe('BP03 罗兰·戏炎、深红之渊与暗费机制', () => {
  it('BP03-067/069/070：公开3种属性<升格者>获【速攻】、不同属性<升格者>使DP=1、虚缪赝戏与攻击复制基本PP', () => {
    const engine = createEngine(
      makeDeck('ST02', ['BP03-067', 'BP03-069', 'BP03-070', 'BP03-081', 'BP03-082', 'BP03-076']),
      makeDeck('ST02')
    );
    setOpenCosts(engine, 'p1', ['BP03-067'], 8);

    // 场上放 FIRE(069) + DARK(ST02-004 升格者) -> BP03-069 基本 DP 变为 1
    const r069 = placeRole(engine, 'p1', 'BP03-069', 0);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(r069.instanceId)).toBe(0);
    placeRole(engine, 'p1', 'ST02-004', 1); // DARK 升格者
    expect(engine.fieldMgr.calculateRoleEffectiveDP(r069.instanceId)).toBe(1);

    const fireAsc = findCard(engine, 'p1', 'BP03-069', 0);
    const darkAscRole = findCard(engine, 'p1', 'ST02-002'); // PP:8000, DP:2, 升格者
    const phyAscRole = findCard(engine, 'p1', 'BP03-076'); // PHYSICAL, PP:4000, 升格者
    engine.zoneMgr.moveCard(darkAscRole.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(phyAscRole.instanceId, 'HAND', { isFaceUp: true });

    // 打出虚缪赝戏 BP03-070 弃置手牌 darkAscRole -> 使 r069 基本PP变8000、基本DP变2
    const spell070 = findCard(engine, 'p1', 'BP03-070');
    engine.zoneMgr.moveCard(spell070.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: spell070.instanceId }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [r069.instanceId]);
    pickChoice(engine, 'p1', [darkAscRole.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(r069.instanceId)).toBe(8000);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(r069.instanceId)).toBe(2);

    // 验证 BP03-067 攻击时弃 1 张 <升格者> 角色 (phyAscRole 4000 PP) 并消 2 球复制其基本 PP
    const r067 = placeRole(engine, 'p1', 'BP03-067', 2);
    const orb1 = findCard(engine, 'p1', 'BP03-081');
    const orb2 = findCard(engine, 'p1', 'BP03-082');
    engine.zoneMgr.moveCard(orb1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orb2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: r067.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    const orbOpt = engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    pickChoice(engine, 'p1', [orbOpt.id]);
    pickChoice(engine, 'p1', [phyAscRole.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(r067.instanceId)).toBe(4000);
    expect(cardState(engine, fireAsc.instanceId).zone).toBe('BATTLEFIELD');
  });

  it('BP03-076/077/078：墓地蓝球置顶、其他<阿尔法>在场时红球视为蓝球用于二消、命定之战有鸦羽可全选2项', () => {
    const engine = createEngine(
      makeDeck('ST01', ['BP03-076', 'BP03-077', 'BP03-078', 'BP03-081', 'BP03-084', 'BP01-001']),
      makeDeck('ST02')
    );
    setOpenCosts(engine, 'p1', ['BP03-076', 'BP01-001'], 8);

    const alpha077 = placeRole(engine, 'p1', 'BP03-077', 0);
    const redOrb = findCard(engine, 'p1', 'BP03-081');
    const blueOrb = findCard(engine, 'p1', 'BP03-084');
    engine.zoneMgr.moveCard(redOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(blueOrb.instanceId, 'GRAVEYARD', { isFaceUp: true });

    // 打出 BP03-076 从墓地拿蓝球置顶
    const alpha076 = findCard(engine, 'p1', 'BP03-076');
    engine.zoneMgr.moveCard(alpha076.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: alpha076.instanceId }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [blueOrb.instanceId]);
    expect(cardState(engine, blueOrb.instanceId).zone).toBe('SIGNAL_ORB');

    // alpha077 攻击时因为存在其他 <阿尔法> (alpha076)，可将红球视为蓝色信号球
    putNonOrbOnDeckTop(engine, 'p1');
    putNonOrbOnDeckTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: alpha077.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [redOrb.instanceId]);
    expect(engine.continuousEffects.getEffectiveOrbInfo(redOrb.instanceId).colors).toContain('BLUE');
    expect(engine.continuousEffects.getEffectiveOrbInfo(redOrb.instanceId).colors).toContain('RED');
    finishCombat(engine);

    // 放置《露西亚·鸦羽》(BP01-001) 在场，命定之战 BP03-078 可选 2 项
    placeRole(engine, 'p1', 'BP01-001', 2);
    const spell078 = findCard(engine, 'p1', 'BP03-078');
    engine.zoneMgr.moveCard(spell078.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: spell078.instanceId }).success
    ).toBe(true);
    expect(engine.getState().currentPendingChoice?.maxSelections).toBe(2);
    pickChoice(engine, 'p1', ['buff_alpha']);
    pickChoice(engine, 'p1', [alpha076.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(alpha076.instanceId)).toBe(5000);
    expect(engine.fieldMgr.evaluateRoleStats(alpha076.instanceId).keywords).toContain('速攻');
  });

  it('BP03-079 库洛洛禁止攻击且保护指定暗费回合末不送墓；BP03-080 迫使对方回合优先支付暗费', () => {
    const engine = createEngine(
      makeDeck('ST02', ['BP03-079', 'BP03-080']),
      makeDeck('ST02', ['ST02-004'])
    );
    setOpenCosts(engine, 'p1', ['BP03-079', 'BP03-080'], 6);

    const hiddenKeep = engine.zoneMgr.getCardsInZone('p1', 'DECK')[0]!;
    const hiddenDrop = engine.zoneMgr.getCardsInZone('p1', 'DECK')[1]!;
    engine.zoneMgr.moveCard(hiddenKeep.instanceId, 'COST', { isFaceUp: false, isReady: true });
    engine.zoneMgr.moveCard(hiddenDrop.instanceId, 'COST', { isFaceUp: false, isReady: true });
    engine.zoneMgr.syncCostStats('p1');

    // 出场 BP03-079 保护 hiddenKeep，且 BP03-079 不能攻击
    const kuroro = findCard(engine, 'p1', 'BP03-079');
    engine.zoneMgr.moveCard(kuroro.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: kuroro.instanceId }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [hiddenKeep.instanceId]);
    cardState(engine, kuroro.instanceId).turnEnteredZone = 0;
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: kuroro.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(false);

    // 同时放置 BP03-080 在 p1 场上
    const duo = placeRole(engine, 'p1', 'BP03-080', 1);
    expect(duo.zone).toBe('BATTLEFIELD');

    // 结束 p1 回合：hiddenKeep 保留在费用区，hiddenDrop 进墓地
    endTurn(engine);
    expect(cardState(engine, hiddenKeep.instanceId).zone).toBe('COST');
    expect(cardState(engine, hiddenDrop.instanceId).zone).toBe('GRAVEYARD');

    // 到 p2 回合：p2 有 1 张暗费和明费，打出 ST02-004 (2费) 若自选全明费将被 BP03-080 拒绝，必须包含暗费！
    const st = engine.getState();
    if (st.phase === 'DRAW_CHARGE_PHASE') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    }
    setOpenCosts(engine, 'p2', ['ST02-004'], 5);
    const p2Hidden = engine.zoneMgr.getCardsInZone('p2', 'DECK')[0]!;
    engine.zoneMgr.moveCard(p2Hidden.instanceId, 'COST', { isFaceUp: false, isReady: true });
    engine.zoneMgr.syncCostStats('p2');

    const p2Role = findCard(engine, 'p2', 'ST02-004');
    engine.zoneMgr.moveCard(p2Role.instanceId, 'HAND', { isFaceUp: true });
    const p2Open2 = engine.zoneMgr.getCardsInZone('p2', 'COST').filter((c) => c.isFaceUp).slice(0, 2);
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p2',
        cardInstanceId: p2Role.instanceId,
        costCardInstanceIds: p2Open2.map((c) => c.instanceId),
      }).success
    ).toBe(false);

    const p2Open1 = p2Open2.slice(0, 1);
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p2',
        cardInstanceId: p2Role.instanceId,
        costCardInstanceIds: [p2Hidden.instanceId, ...p2Open1.map((c) => c.instanceId)],
      }).success
    ).toBe(true);
    expect(cardState(engine, p2Hidden.instanceId).zone).toBe('GRAVEYARD');
  });

  it('BP03-081 ~ BP03-089：标准信号球战术牌使用置顶抽 1，且在充能时正常触发【充能自】', () => {
    const engine = createEngine(
      makeDeck('ST01', ['BP03-081', 'BP03-084', 'BP03-087']),
      makeDeck('ST02')
    );
    const st = engine.getState();
    const attacker = placeRole(engine, 'p1', 'ST01-005', 0);

    // 直接使用 BP03-081：放置到信号球区最上方并抽 1 张牌
    const redOrb = findCard(engine, 'p1', 'BP03-081');
    engine.zoneMgr.moveCard(redOrb.instanceId, 'HAND', { isFaceUp: true });
    const handBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: redOrb.instanceId }).success
    ).toBe(true);
    expect(cardState(engine, redOrb.instanceId).zone).toBe('SIGNAL_ORB');
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(handBefore);

    // 将 BP03-087 (黄球) 放至牌组顶，攻击时充能触发【充能自】选 PP+2000
    const yellowOrb = findCard(engine, 'p1', 'BP03-087');
    engine.zoneMgr.moveCardToTopOfDeck(yellowOrb.instanceId);
    putNonOrbOnDeckTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: attacker.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    passInstantWindows(engine);

    expect(st.currentPendingChoice?.effectType).toBe('SIGNATURE_MOVE_EFFECT');
    pickChoice(engine, 'p1', ['opt_pp_plus_2000']);
    pickChoice(engine, 'p1', [attacker.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(attacker.instanceId)).toBe(5000);
    expect(cardState(engine, yellowOrb.instanceId).zone).toBe('SIGNAL_ORB');
  });
});

// ============================================================================
// 9. 核心卡牌机制扩展端到端测试 (BP03-025/028/031/040/043/044/047/055/063/075)
// ============================================================================

describe('BP03 核心卡牌机制扩展测试', () => {
  it('BP03-025/028/031：仅存在《里·超刻》基本DP=1、BP03-025 抽1放顶与攻击查看牌组顶、BP03-028 充能自消黄球获【速攻】', () => {
    const engine = createEngine(
      makeDeck('ST01', ['BP03-024', 'BP03-025', 'BP03-028', 'BP03-031', 'BP03-087']),
      makeDeck('ST02')
    );
    setOpenCosts(engine, 'p1', ['BP03-024'], 8);

    const lee031 = placeRole(engine, 'p1', 'BP03-031', 0);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(lee031.instanceId)).toBe(1);
    const outsider = placeRole(engine, 'p1', 'ST01-005', 1);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(lee031.instanceId)).toBe(0);
    engine.fieldMgr.handleCardLeaveField(outsider.instanceId);
    engine.zoneMgr.moveCardToBottomOfDeck(outsider.instanceId);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(lee031.instanceId)).toBe(1);

    // 准备 BP03-028 在手牌、黄球 BP03-087 在信号球区，出场 BP03-025 抽1并将 BP03-028 置顶
    const lee028 = findCard(engine, 'p1', 'BP03-028');
    engine.zoneMgr.moveCard(lee028.instanceId, 'HAND', { isFaceUp: true });
    const yellowOrb = findCard(engine, 'p1', 'BP03-087');
    engine.zoneMgr.moveCard(yellowOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    const lee025 = findCard(engine, 'p1', 'BP03-025');
    engine.zoneMgr.moveCard(lee025.instanceId, 'HAND', { isFaceUp: true });
    const handBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length - 1;
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: lee025.instanceId }).success
    ).toBe(true);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-025_HAND_TO_TOP');
    pickChoice(engine, 'p1', [lee028.instanceId]);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(handBefore);
    expect(engine.zoneMgr.getCardsInZone('p1', 'DECK')[0]!.instanceId).toBe(lee028.instanceId);

    // 令 lee025 攻击并查看牌组顶保持 BP03-028 在顶 -> 充能触发 BP03_028_CHARGE_AUTO 消黄球获【速攻】
    cardState(engine, lee025.instanceId).turnEnteredZone = 0;
    putNonOrbOnDeckTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: lee025.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-025_SCRY_CONFIRM');
    pickChoice(engine, 'p1', ['opt_yes']);
    pickChoice(engine, 'p1', [lee028.instanceId]);
    passInstantWindows(engine);
    engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    passInstantWindows(engine);

    expect(engine.getState().currentPendingChoice?.effectType).toBe('BP03_028_CHARGE_AUTO');
    pickChoice(engine, 'p1', [yellowOrb.instanceId]);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('BP03_028_PICK_MODE');
    pickChoice(engine, 'p1', ['opt_quick']);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('BP03_028_PICK_ROLE');
    pickChoice(engine, 'p1', [lee025.instanceId]);
    finishCombat(engine);
    expect(cardState(engine, lee028.instanceId).zone).toBe('GRAVEYARD');
    expect(cardState(engine, yellowOrb.instanceId).zone).toBe('GRAVEYARD');
    expect(engine.fieldMgr.evaluateRoleStats(lee025.instanceId).keywords).toContain('速攻');
  });

  it('BP03-040/043/044：第3张时BP03-043减1费弹回<=7000PP、BP03-040攻击+1000/+1DP、BP03-044竖直《罗塞塔·凛冽》', () => {
    const engine = createEngine(
      makeDeck('ST03', ['BP03-035', 'BP03-040', 'BP03-040', 'BP03-041', 'BP03-041', 'BP03-043', 'BP03-044']),
      makeDeck('ST02', ['ST02-001'])
    );
    const st = engine.getState();
    setOpenCosts(engine, 'p1', ['BP03-035'], 10);
    const oppTarget = placeRole(engine, 'p2', 'ST02-001', 0); // PP 6000 <= 7000

    // 第 1 张：BP03-040#0 (2费)；第 2 张：BP03-041#0 (2费，选不增加计数) -> cardsPlayedThisTurn = 2
    const r040a = findCard(engine, 'p1', 'BP03-040', 0);
    const r041a = findCard(engine, 'p1', 'BP03-041', 0);
    engine.zoneMgr.moveCard(r040a.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(r041a.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: r040a.instanceId }).success).toBe(true);
    expect(engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: r041a.instanceId }).success).toBe(true);
    pickChoice(engine, 'p1', ['opt_no']);
    expect(st.players.p1!.cardsPlayedThisTurn).toBe(2);

    // 把可用明费压成恰好 3 费 (含物理明费)，验证 4 费 BP03-043 减为 3 费打出并弹回 oppTarget
    const costCards = engine.zoneMgr.getCardsInZone('p1', 'COST');
    const phyCost = costCards.find((c) => db.getCard(c.cardNumber)?.attribute === 'PHYSICAL')!;
    let readyCount = 0;
    for (const c of costCards) {
      if (c.instanceId === phyCost.instanceId) {
        c.isReady = true;
        readyCount++;
      } else {
        c.isReady = false;
      }
    }
    for (const c of costCards) {
      if (readyCount >= 3) break;
      if (!c.isReady && c.isFaceUp) {
        c.isReady = true;
        readyCount++;
      }
    }
    engine.zoneMgr.syncCostStats('p1');

    const spell043 = findCard(engine, 'p1', 'BP03-043');
    engine.zoneMgr.moveCard(spell043.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: spell043.instanceId }).success).toBe(true);
    pickChoice(engine, 'p1', [oppTarget.instanceId]);
    expect(cardState(engine, oppTarget.instanceId).zone).toBe('HAND');
    expect(st.players.p1!.cardsPlayedThisTurn).toBe(3);

    // 计数 = 3 时让 r040a 攻击，触发 PP+1000、DP+1
    cardState(engine, r040a.instanceId).turnEnteredZone = 0;
    putNonOrbOnDeckTop(engine, 'p1');
    putNonOrbOnDeckTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: r040a.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    finishCombat(engine);
    expect(engine.fieldMgr.calculateRoleEffectivePP(r040a.instanceId)).toBe(3500);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(r040a.instanceId)).toBe(1);
    expect(cardState(engine, r040a.instanceId).isReady).toBe(false);

    // 下一我方回合：先后打出 2 张牌，再打 BP03-044 作为第 3 张选择竖直横置中的 r040a
    advanceTurnTo(engine, 'p2');
    advanceTurnTo(engine, 'p1');
    // 清理上一回合的 r041a 留空槽位
    engine.fieldMgr.handleCardLeaveField(r041a.instanceId);
    engine.zoneMgr.moveCardToBottomOfDeck(r041a.instanceId);
    cardState(engine, r040a.instanceId).isReady = false;
    setOpenCosts(engine, 'p1', ['BP03-035'], 10);

    const r040b = findCard(engine, 'p1', 'BP03-040', 1);
    const r041b = findCard(engine, 'p1', 'BP03-041', 1);
    const spell044 = findCard(engine, 'p1', 'BP03-044');
    engine.zoneMgr.moveCard(r040b.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(r041b.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(spell044.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: r040b.instanceId }).success).toBe(true);
    expect(engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: r041b.instanceId }).success).toBe(true);
    pickChoice(engine, 'p1', ['opt_no']);
    expect(engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: spell044.instanceId }).success).toBe(true);
    pickChoice(engine, 'p1', ['ready_rosetta']);
    pickChoice(engine, 'p1', [r040a.instanceId]);
    expect(cardState(engine, r040a.instanceId).isReady).toBe(true);
  });

  it('BP03-047 & BP03-055：BP03-047 把对方<=3费角色横置入对方费用区、虹霁横置交换手牌《艾拉·万华》与明费', () => {
    const engine = createEngine(
      makeDeck('ST01', [
        'BP03-045',
        'BP03-046',
        'BP03-047',
        'BP03-048',
        'BP03-049',
        'BP03-050',
        'BP03-051',
        'BP03-052',
        'BP03-055',
        'BP03-081',
        'BP03-082',
      ]),
      makeDeck('ST02', ['ST02-005'])
    );
    const aylaNums = ['BP03-045', 'BP03-046', 'BP03-047', 'BP03-048', 'BP03-049', 'BP03-050', 'BP03-052'];
    for (const num of aylaNums) {
      engine.zoneMgr.moveCard(findCard(engine, 'p1', num).instanceId, 'COST', { isFaceUp: true, isReady: true });
    }
    engine.zoneMgr.syncCostStats('p1');

    const oppCheap = placeRole(engine, 'p2', 'ST02-005', 0); // cost 2 <= 3
    const r1 = findCard(engine, 'p1', 'BP03-081');
    const r2 = findCard(engine, 'p1', 'BP03-082');
    engine.zoneMgr.moveCard(r1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(r2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    const ayla047 = findCard(engine, 'p1', 'BP03-047');
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: ayla047.instanceId,
      }).success
    ).toBe(true);
    const orbOpt = engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    pickChoice(engine, 'p1', [orbOpt.id]);
    pickChoice(engine, 'p1', [oppCheap.instanceId]);
    expect(cardState(engine, ayla047.instanceId).zone).toBe('DECK');
    expect(cardState(engine, oppCheap.instanceId).zone).toBe('COST');
    expect(cardState(engine, oppCheap.instanceId).isFaceUp).toBe(true);
    expect(cardState(engine, oppCheap.instanceId).isReady).toBe(false);

    // 放置 虹霁 BP03-055 在助战位，横置把手牌 BP03-051 横置放费用区，拿回费用区 BP03-048 回手牌
    const hongji = findCard(engine, 'p1', 'BP03-055');
    engine.zoneMgr.moveCard(hongji.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.fieldMgr.playAssistCard('p1', hongji.instanceId, 0)).toBe(true);
    const handAyla = findCard(engine, 'p1', 'BP03-051');
    engine.zoneMgr.moveCard(handAyla.instanceId, 'HAND', { isFaceUp: true });
    const costAyla = findCard(engine, 'p1', 'BP03-048');

    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: hongji.instanceId,
      }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [handAyla.instanceId]);
    pickChoice(engine, 'p1', [costAyla.instanceId]);
    expect(cardState(engine, hongji.instanceId).isReady).toBe(false);
    expect(cardState(engine, handAyla.instanceId).zone).toBe('COST');
    expect(cardState(engine, handAyla.instanceId).isReady).toBe(false);
    expect(cardState(engine, costAyla.instanceId).zone).toBe('HAND');
  });

  it('BP03-063 独立拼点 (含 BP03-066 声明费用) 与 BP03-075 露西亚·深红之渊【速攻】', () => {
    const engine = createEngine(
      makeDeck('ST02', ['BP03-063', 'BP03-066', 'BP03-075']),
      makeDeck('ST02', ['ST02-004'])
    );
    setOpenCosts(engine, 'p1', ['BP03-063'], 8);

    const p1Flex = findCard(engine, 'p1', 'BP03-066');
    const p2Low = findCard(engine, 'p2', 'ST02-004'); // cost 2
    engine.zoneMgr.moveCardToTopOfDeck(p1Flex.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(p2Low.instanceId);

    const bp03063 = findCard(engine, 'p1', 'BP03-063');
    engine.zoneMgr.moveCard(bp03063.instanceId, 'HAND', { isFaceUp: true });
    const handBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length - 1;
    expect(engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: bp03063.instanceId }).success).toBe(true);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('CHOOSE_TRIGGER_ORDER');
    pickChoice(engine, 'p1', [engine.getState().currentPendingChoice!.options[0]!.id]);
    // 第 1 个【出】查看顶1张(BP03-066)选择不送墓放回牌组顶；第 2 个【出】拼点声明 BP03-066 为 7 (> 2) -> p1 抽 1 张
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_BP03-063_PEEK_MILL');
    pickChoice(engine, 'p1', []);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('DSL_LILITH_DECLARE_BP03-066');
    pickChoice(engine, 'p1', ['7']);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND')).toHaveLength(handBefore + 1);

    // 验证 BP03-075 固有【速攻】
    const crimson075 = placeRole(engine, 'p1', 'BP03-075', 1);
    expect(engine.fieldMgr.evaluateRoleStats(crimson075.instanceId).keywords).toContain('速攻');
  });
});
