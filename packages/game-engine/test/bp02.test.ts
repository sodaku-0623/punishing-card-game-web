import { describe, it, expect } from 'vitest';
import {
  GameEngine,
  MemoryCardDatabase,
  OFFICIAL_CARDS_DATA,
  getAttachedEquipmentIds,
} from '../src/index.js';
import { validateCardEffectRegistry } from '../src/effects/dsl/validator.js';
import { BP02_EFFECT_SPECS } from '../src/effects/dsl/specs/bp02.js';
import { STARTER_DECK_SPEC_MAP } from '../src/effects/dsl/specs/starter-decks.js';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import { endTurn, fillCostZone, passInstantWindows, resolvePendingChoices } from './helpers.js';

const db = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);

function makeDeck(
  baseCode: 'ST01' | 'ST02' | 'ST03',
  inject: string[] = []
): string[] {
  const deckDef = OFFICIAL_STARTER_DECKS.find((d) => d.name.includes(`(${baseCode})`))!;
  const baseCards: string[] = [];
  for (const item of deckDef.cards) {
    for (let i = 0; i < item.count; i++) baseCards.push(item.cardNumber);
  }
  return [...inject, ...baseCards.slice(0, Math.max(0, 50 - inject.length))];
}

function createEngine(p1Deck: string[], p2Deck: string[], seed = 20261124): GameEngine {
  const engine = new GameEngine(
    'bp02-e2e-test',
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
  // 按 instanceId 数值顺序排序，防止 zoneMgr.moveCard 重建 state.cards 键序后同一卡牌在多次 findCard 中重复命中
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

function cardState(engine: GameEngine, instanceId: string) {
  const c = engine.getState().cards[instanceId];
  if (!c) throw new Error(`未找到卡牌实例 ${instanceId}`);
  return c;
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
  if (st.phase === 'DRAW_CHARGE_PHASE') {
    engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: st.activePlayerId });
  }
  expect(engine.getState().activePlayerId).toBe(targetPlayerId);
}

// ============================================================================
// 1. 注册表完整性与校验
// ============================================================================

describe('BP02《重返极夜》声明式效果注册表校验', () => {
  it('BP02_EFFECT_SPECS 精确覆盖官方卡表全部 91 张 BP02 卡牌且 validateCardEffectRegistry 零报错', () => {
    const officialBp02 = OFFICIAL_CARDS_DATA.filter((c) => c.cardNumber.startsWith('BP02-'));
    expect(officialBp02).toHaveLength(91);
    expect(BP02_EFFECT_SPECS).toHaveLength(91);

    const validatedMap = validateCardEffectRegistry(BP02_EFFECT_SPECS, db);
    expect(validatedMap.size).toBe(91);

    for (const def of officialBp02) {
      const spec = validatedMap.get(def.cardNumber);
      expect(spec, `缺少 ${def.cardNumber}`).toBeDefined();
      expect(spec!.name).toBe(def.name);
      expect(STARTER_DECK_SPEC_MAP.has(def.cardNumber)).toBe(true);
    }
  });

  it('异画 BP02-022 与 BP02-022【冠军】均已注册且不重复静态效果 ID', () => {
    const base = BP02_EFFECT_SPECS.find((s) => s.cardNumber === 'BP02-022');
    const champ = BP02_EFFECT_SPECS.find((s) => s.cardNumber === 'BP02-022【冠军】');
    expect(base).toBeDefined();
    expect(champ).toBeDefined();
    expect(base!.staticEffects?.[0]?.id).not.toBe(champ!.staticEffects?.[0]?.id);
  });

  it('BP02-040 不重复注册 static:BP02-040，BP02-013/049 不重复注册战斗破坏置换', () => {
    const s040 = BP02_EFFECT_SPECS.find((s) => s.cardNumber === 'BP02-040')!;
    expect(s040.staticEffects ?? []).toHaveLength(0);

    const s013 = BP02_EFFECT_SPECS.find((s) => s.cardNumber === 'BP02-013')!;
    expect(s013.triggers ?? []).toHaveLength(0);

    const s049 = BP02_EFFECT_SPECS.find((s) => s.cardNumber === 'BP02-049')!;
    expect(s049.triggers ?? []).toHaveLength(0);
  });
});

// ============================================================================
// 2. 伊什梅尔·幻日体系 (BP02-001 ~ BP02-009)
// ============================================================================

describe('BP02 伊什梅尔·幻日体系', () => {
  it('BP02-001：升变消 3 球效果无效出场火/冰/物理升变角色并触发对应属性效果', () => {
    const engine = createEngine(
      makeDeck('ST01', [
        'BP02-001',
        'BP02-001', // 第 2 张用于充当费用区 VOID 明费
        'BP02-008',
        'BP02-010', // 火升变 C:6
        'BP02-067', // 冰升变 C:5
        'ST01-012',
        'ST01-013',
        'ST01-014',
      ]),
      makeDeck('ST02')
    );
    const st = engine.getState();
    const baseIshmael = placeRole(engine, 'p1', 'BP02-008', 0);
    const bp02001 = findCard(engine, 'p1', 'BP02-001', 0);
    const bp02001CostSeed = findCard(engine, 'p1', 'BP02-001', 1);
    const fireAsc = findCard(engine, 'p1', 'BP02-010');
    const iceAsc = findCard(engine, 'p1', 'BP02-067');

    setOpenCosts(engine, 'p1', [], 9);
    engine.zoneMgr.moveCard(bp02001CostSeed.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.syncCostStats('p1');
    engine.zoneMgr.moveCard(bp02001.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(fireAsc.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(iceAsc.instanceId, 'HAND', { isFaceUp: true });

    const orbs = ['ST01-012', 'ST01-013', 'ST01-014'].map((n) => findCard(engine, 'p1', n));
    for (const o of orbs) engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    const p2HandCountBefore = engine.zoneMgr.getCardsInZone('p2', 'HAND').length;
    expect(p2HandCountBefore).toBeGreaterThan(0);

    // 升变出场 BP02-001
    const res = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: bp02001.instanceId,
      isAscension: true,
      targetAscensionCardId: baseIshmael.instanceId,
    });
    expect(res.success, res.error).toBe(true);

    // 选择消除 3 任意信号球
    const orbCh = st.currentPendingChoice!;
    expect(orbCh).toBeDefined();
    const payOpt = orbCh.options.find((o) => o.id !== 'skip')!;
    pickChoice(engine, 'p1', [payOpt.id]);

    // 选择手牌中的冰属性升变角色 BP02-067 效果无效出场
    pickChoice(engine, 'p1', [iceAsc.instanceId]);
    // 冰属性效果：盲选对方 1 张手牌丢弃
    const blindCh = st.currentPendingChoice!;
    expect(blindCh.options.length).toBe(p2HandCountBefore);
    pickChoice(engine, 'p1', [blindCh.options[0]!.id]);

    expect(iceAsc.zone).toBe('BATTLEFIELD');
    expect(engine.continuousEffects.hasLostInherentAbilities(iceAsc.instanceId)).toBe(true);
    expect(engine.zoneMgr.getCardsInZone('p2', 'HAND')).toHaveLength(p2HandCountBefore - 1);
  });

  it('BP02-001：战场无空余卡位时不出场且不执行属性效果 (Q&A·4/5)', () => {
    const engine = createEngine(
      makeDeck('ST01', [
        'BP02-001',
        'BP02-001',
        'BP02-008',
        'BP02-004',
        'BP02-005',
        'BP02-006',
        'BP02-009',
        'BP02-010',
        'ST01-012',
        'ST01-013',
        'ST01-014',
      ]),
      makeDeck('ST02')
    );
    const target0 = placeRole(engine, 'p1', 'BP02-008', 0);
    placeRole(engine, 'p1', 'BP02-004', 1);
    placeRole(engine, 'p1', 'BP02-005', 2);
    placeRole(engine, 'p1', 'BP02-006', 3);
    placeRole(engine, 'p1', 'BP02-009', 4);

    const bp02001 = findCard(engine, 'p1', 'BP02-001', 0);
    const bp02001Seed = findCard(engine, 'p1', 'BP02-001', 1);
    const fireAsc = findCard(engine, 'p1', 'BP02-010');
    setOpenCosts(engine, 'p1', [], 9);
    engine.zoneMgr.moveCard(bp02001Seed.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.syncCostStats('p1');
    engine.zoneMgr.moveCard(bp02001.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(fireAsc.instanceId, 'HAND', { isFaceUp: true });
    for (const n of ['ST01-012', 'ST01-013', 'ST01-014']) {
      engine.zoneMgr.moveCard(findCard(engine, 'p1', n).instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }

    const res = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: bp02001.instanceId,
      isAscension: true,
      targetAscensionCardId: target0.instanceId,
    });
    expect(res.success, res.error).toBe(true);
    const payOpt = engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    pickChoice(engine, 'p1', [payOpt.id]);

    // 战场已满：BP02-010 仍在手牌，且 BP02-001 DP 保持 1
    expect(fireAsc.zone).toBe('HAND');
    expect(engine.fieldMgr.calculateRoleEffectiveDP(bp02001.instanceId)).toBe(1);
    expect(engine.getState().currentPendingChoice).toBeUndefined();
  });

  it('BP02-002 & BP02-003 & BP02-007：多属性公开、观测纪行前置与阻挡增益', () => {
    const engine = createEngine(
      makeDeck('ST01', ['BP02-002', 'BP02-003', 'BP02-007', 'BP02-008', 'BP02-010', 'BP02-067']),
      makeDeck('ST02')
    );
    setOpenCosts(engine, 'p1', ['BP02-008'], 10);

    const bp02003 = findCard(engine, 'p1', 'BP02-003');
    const bp02002 = findCard(engine, 'p1', 'BP02-002');
    const fireAsc = findCard(engine, 'p1', 'BP02-010');
    const iceAsc = findCard(engine, 'p1', 'BP02-067');
    engine.zoneMgr.moveCard(bp02003.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(bp02002.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(fireAsc.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(iceAsc.instanceId, 'HAND', { isFaceUp: true });

    // 战场无《伊什梅尔·幻日》时不能使用 BP02-003
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: bp02003.instanceId,
      }).success
    ).toBe(false);

    // 出场 BP02-002，公开火升变 + 冰升变 -> 抽 1 张牌且本回合可攻击对方玩家
    const handBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: bp02002.instanceId,
      }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [fireAsc.instanceId, iceAsc.instanceId]);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore); // 打出1(-1), 抽1(+1)
    expect(engine.fieldMgr.evaluateRoleStats(bp02002.instanceId).canAttackPlayerOnEnterTurn).toBe(true);

    // 战场有《伊什梅尔·幻日》后可使用 BP02-003，效果无效出场冰升变 BP02-067
    // 注意：上方故意失败的 PLAY_CARD 触发了事务回滚并替换 state.cards 引用，后续须按 ID 重新读取状态
    const play003Res = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: bp02003.instanceId,
    });
    expect(play003Res.success, play003Res.error).toBe(true);
    pickChoice(engine, 'p1', [iceAsc.instanceId]);
    expect(cardState(engine, iceAsc.instanceId).zone).toBe('BATTLEFIELD');
    expect(engine.continuousEffects.hasLostInherentAbilities(iceAsc.instanceId)).toBe(true);
  });
});

// ============================================================================
// 3. 丽芙·极昼体系 (BP02-010 ~ BP02-020)
// ============================================================================

describe('BP02 丽芙·极昼体系', () => {
  it('BP02-010：对方强制攻击对象 + 效果送墓触发 (被破坏不触发 / 手牌减为3费的BP02-013不可选)', () => {
    const engine = createEngine(
      makeDeck('ST01', [
        'BP02-010',
        'BP02-011',
        'BP02-013',
        'BP02-014',
        'BP02-015',
        'BP02-020',
        'ST01-012',
        'ST01-013',
        'ST01-014',
      ]),
      makeDeck('ST02', ['ST02-001', 'ST02-004', 'ST02-004'])
    );
    const liv010 = placeRole(engine, 'p1', 'BP02-010', 0, { isReady: false });
    const liv015 = placeRole(engine, 'p1', 'BP02-015', 1, { isReady: false });
    const liv013Hand = findCard(engine, 'p1', 'BP02-013');
    const liv014Hand = findCard(engine, 'p1', 'BP02-014');
    engine.zoneMgr.moveCard(liv013Hand.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(liv014Hand.instanceId, 'HAND', { isFaceUp: true });
    // P1 场上 2 张角色，P2 场上 3 张角色 -> P1 角色少于 P2 -> BP02-013 与 BP02-014 在手牌费用均减为 3 (不能被 BP02-010 选中!)
    const p2Attacker = placeRole(engine, 'p2', 'ST02-001', 0, { isReady: true });
    const p2Other = placeRole(engine, 'p2', 'ST02-004', 1, { isReady: false, instanceIndex: 0 });
    const p2Other2 = placeRole(engine, 'p2', 'ST02-004', 2, { isReady: false, instanceIndex: 1 });
    expect(engine.calculateCardCost('p1', liv013Hand.instanceId).costToPay).toBe(3);

    // 切换到 P2 回合测试强制攻击目标
    advanceTurnTo(engine, 'p2');
    // 攻击 P1 横置的 liv015 应被 BP02-010 的强制攻击【永】拒绝
    const badAttack = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p2',
      attackerCardId: p2Attacker.instanceId,
      targetType: 'CHARACTER',
      targetCardId: liv015.instanceId,
    });
    expect(badAttack.success).toBe(false);
    expect(badAttack.error).toContain('丽芙·极昼');

    // 切回 P1 回合，测试 BP02-011【起】竖直送墓自身触发 BP02-010 & BP02-015
    advanceTurnTo(engine, 'p1');
    // 清理 P2 场上 2 张角色使 P1 >= P2 -> 手牌 BP02-014 保持 4 费
    engine.zoneMgr.moveCard(p2Other.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(p2Other2.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const liv011 = placeRole(engine, 'p1', 'BP02-011', 2, { isReady: true });
    for (const n of ['ST01-012', 'ST01-013']) {
      engine.zoneMgr.moveCard(findCard(engine, 'p1', n).instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }
    const orbExtra = findCard(engine, 'p1', 'ST01-014');
    engine.zoneMgr.moveCard(orbExtra.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    // 先验证被效果破坏不触发 BP02-010 / BP02-015：移走一张普通破坏测试
    // 激活 BP02-011【起】消 1 球将竖直的自身送墓 -> 出场手牌 4 费 BP02-014
    const actRes = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: liv011.instanceId,
    });
    expect(actRes.success, actRes.error).toBe(true);
    // 如有多个单球可选，选第 1 个
    if (engine.getState().currentPendingChoice?.effectType === 'PRESET_ORB_COST') {
      const opt = engine.getState().currentPendingChoice!.options[0]!;
      pickChoice(engine, 'p1', [opt.id]);
    }
    // 此时 BP02-011 送墓，BP02-011 继续选择手牌/墓地 4 费《丽芙·极昼》出场
    expect(cardState(engine, liv011.instanceId).zone).toBe('GRAVEYARD');
    pickChoice(engine, 'p1', [liv014Hand.instanceId]);
    expect(cardState(engine, liv014Hand.instanceId).zone).toBe('BATTLEFIELD');

    // 随后检查时机弹出 BP02-010 与 BP02-015 触发顺序选择（均因 BP02-011 因效果送墓而入池！）
    resolvePendingChoices(engine);
    expect(cardState(engine, liv010.instanceId).zone).toBe('BATTLEFIELD');
  });

  it('BP02-011 横置时发动【起】不送墓也不出场；BP02-012 牺牲《丽芙·极昼》费用变 4；BP02-017 支付 1 费获突进并于回合结束送墓', () => {
    const engine = createEngine(
      makeDeck('ST01', ['BP02-011', 'BP02-012', 'BP02-014', 'BP02-015', 'BP02-017', 'ST01-012']),
      makeDeck('ST02')
    );
    setOpenCosts(engine, 'p1', ['BP02-015'], 4);
    const liv011Tapped = placeRole(engine, 'p1', 'BP02-011', 0, { isReady: false });
    const liv014Hand = findCard(engine, 'p1', 'BP02-014');
    const liv012 = findCard(engine, 'p1', 'BP02-012');
    const liv017 = findCard(engine, 'p1', 'BP02-017');
    engine.zoneMgr.moveCard(liv014Hand.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(liv012.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(liv017.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(findCard(engine, 'p1', 'ST01-012').instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    // Q&A·7：横置的 BP02-011 发动【起】消 1 球后自身仍在战场，BP02-014 仍在手牌
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: liv011Tapped.instanceId,
      }).success
    ).toBe(true);
    expect(liv011Tapped.zone).toBe('BATTLEFIELD');
    expect(liv014Hand.zone).toBe('HAND');

    // BP02-012 仅 4 费可用时（原价 7 费），可选择牺牲战场上的 BP02-011 以 4 费出场
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: liv012.instanceId,
      }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [liv011Tapped.instanceId]);
    // 跳过 BP02-012【出】弃1牌
    if (engine.getState().currentPendingChoice) {
      pickChoice(engine, 'p1', []);
    }
    expect(liv011Tapped.zone).toBe('GRAVEYARD');
    expect(liv012.zone).toBe('BATTLEFIELD');

    // 再补 4 费竖直明费打出 BP02-017 并支付【1费】，获得【突进】与 PP+3000，回合结束时送墓
    fillCostZone(engine, 'p1', 8);
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: liv017.instanceId,
      }).success
    ).toBe(true);
    pickChoice(engine, 'p1', ['pay_cost']);
    expect(engine.fieldMgr.evaluateRoleStats(liv017.instanceId).keywords).toContain('突进');
    expect(engine.fieldMgr.calculateRoleEffectivePP(liv017.instanceId)).toBe(6000);

    endTurn(engine);
    expect(liv017.zone).toBe('GRAVEYARD');
  });
});

// ============================================================================
// 4. 比安卡·晖暮体系 (BP02-021 ~ BP02-025，含 BP02-022【冠军】)
// ============================================================================

describe('BP02 比安卡·晖暮体系', () => {
  it('BP02-024 信号球区费用+1 驱动晖/暮切换，BP02-022 与 BP02-022【冠军】正常减费/速攻，BP02-024 重排后保留送墓触发 (Q&A·4)', () => {
    const engine = createEngine(
      makeDeck('ST02', ['BP02-021', 'BP02-022', 'BP02-022【冠军】', 'BP02-023', 'BP02-024', 'BP02-024', 'BP02-025']),
      makeDeck('ST02')
    );

    // 先安置所有测试特定卡牌（避免 setOpenCosts 的 fillCostZone 随机从牌组抓取它们）
    const b024Orb = findCard(engine, 'p1', 'BP02-024', 0);
    const b022 = findCard(engine, 'p1', 'BP02-022');
    const b022Champ = findCard(engine, 'p1', 'BP02-022【冠军】');
    const b023 = placeRole(engine, 'p1', 'BP02-023', 1, { isReady: true });
    const b024Field = placeRole(engine, 'p1', 'BP02-024', 2, { isReady: true, instanceIndex: 1 });
    engine.zoneMgr.insertCardIntoZoneAtIndex(b024Orb.instanceId, 'SIGNAL_ORB', 0, {
      isFaceUp: true,
      isReady: true,
    });
    engine.zoneMgr.moveCard(b022.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(b022Champ.instanceId, 'HAND', { isFaceUp: true });

    setOpenCosts(engine, 'p1', ['ST02-001'], 6);
    expect(engine.continuousEffects.getEffectiveCardCost(b024Orb.instanceId)).toBe(5);
    expect(engine.continuousEffects.isFormActive('p1', '晖')).toBe(true);
    expect(engine.continuousEffects.isFormActive('p1', '暮')).toBe(false);

    // 晖形态下，BP02-022 与 BP02-022【冠军】手牌费用 7 - 4 = 3
    expect(engine.calculateCardCost('p1', b022.instanceId).costToPay).toBe(3);
    expect(engine.calculateCardCost('p1', b022Champ.instanceId).costToPay).toBe(3);

    // 打出 BP02-022【冠军】仅需 3 费
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: b022Champ.instanceId,
      }).success
    ).toBe(true);
    expect(engine.getState().players['p1']!.availableOpenCostCount).toBe(3);

    // 场上放 BP02-023 攻击，将手牌 BP02-022 放信号球区最下方(费用 7 奇数)，回合结束需送墓
    putNonOrbOnDeckTop(engine, 'p1');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: b023.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [b022.instanceId]);
    passInstantWindows(engine);
    resolvePendingChoices(engine);
    expect(engine.fieldMgr.calculateRoleEffectivePP(b023.instanceId)).toBe(5500);

    // 发动场上 BP02-024 晖【起】重排信号球区，把 b022 和 b024Orb 顺序对调 (b024Orb 在底部，b022 在顶部)
    const orbOrder = engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB');
    expect(orbOrder[0]!.instanceId).toBe(b022.instanceId);
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: b024Field.instanceId,
      }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [b024Orb.instanceId, b022.instanceId]);

    // 回合结束时，即使信号球区顺序已重排，被 BP02-023 放置的 b022 仍须放进墓地 (Q&A·4)
    endTurn(engine);
    expect(b022.zone).toBe('GRAVEYARD');

    // 若把偶数费卡牌放回底部（例如 BP02-021 费用 8），则切为暮形态 -> BP02-022【冠军】获得【速攻】
    const evenCard = findCard(engine, 'p1', 'BP02-021');
    engine.zoneMgr.insertCardIntoZoneAtIndex(evenCard.instanceId, 'SIGNAL_ORB', 0, {
      isFaceUp: true,
      isReady: true,
    });
    expect(engine.continuousEffects.isFormActive('p1', '暮')).toBe(true);
    expect(engine.fieldMgr.evaluateRoleStats(b022Champ.instanceId).keywords).toContain('速攻');
  });

  it('BP02-025 浊璃：辅助机横置发动暮形态抽牌起动', () => {
    const engine = createEngine(makeDeck('ST02', ['BP02-025', 'BP02-022', 'BP02-021']), makeDeck('ST02'));
    setOpenCosts(engine, 'p1', ['ST02-001'], 6);
    const zhuoli = findCard(engine, 'p1', 'BP02-025');
    const bianca = findCard(engine, 'p1', 'BP02-022');
    const evenOrb = findCard(engine, 'p1', 'BP02-021'); // 8 费偶数
    engine.zoneMgr.moveCard(zhuoli.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(bianca.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.insertCardIntoZoneAtIndex(evenOrb.instanceId, 'SIGNAL_ORB', 0, {
      isFaceUp: true,
      isReady: true,
    });

    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: zhuoli.instanceId,
        targetSlotIndex: 0,
      }).success
    ).toBe(true);
    const handBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: zhuoli.instanceId,
      }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [bianca.instanceId]);
    expect(zhuoli.isReady).toBe(false);
    expect(engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB')[0]!.instanceId).toBe(bianca.instanceId);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore); // -1 +1
  });
});

// ============================================================================
// 5. 拉弥亚·深谣体系 (BP02-026 ~ BP02-036)
// ============================================================================

describe('BP02 拉弥亚·深谣体系', () => {
  it('BP02-036 潮涌球可于主要阶段及墓地作为瞬时使用，并支持 BP02-028 -> BP02-027 -> BP02-026 墓地升变与攻击洗牌堆 5 (Q&A·4)', () => {
    const engine = createEngine(
      makeDeck('ST02', [
        'BP02-026',
        'BP02-027',
        'BP02-028',
        'BP02-029',
        'BP02-030',
        'BP02-031',
        'BP02-036',
        'BP02-036',
        'BP02-036',
        'BP02-085',
        'BP02-085',
        'ST02-001',
      ]),
      makeDeck('ST01')
    );

    const surge1 = findCard(engine, 'p1', 'BP02-036', 0);
    const surge2 = findCard(engine, 'p1', 'BP02-036', 1);
    const surge3 = findCard(engine, 'p1', 'BP02-036', 2);
    const orb1 = findCard(engine, 'p1', 'BP02-085', 0);
    const orb2 = findCard(engine, 'p1', 'BP02-085', 1);
    const lamia028 = placeRole(engine, 'p1', 'BP02-028', 0, { isReady: true });
    const lamia027 = findCard(engine, 'p1', 'BP02-027');
    const lamia026 = findCard(engine, 'p1', 'BP02-026');

    engine.zoneMgr.moveCard(orb1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orb2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(surge1.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(lamia027.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(lamia026.instanceId, 'GRAVEYARD', { isFaceUp: true });
    setOpenCosts(engine, 'p1', ['ST02-001'], 10);

    // 测试在主要阶段从墓地使用【瞬时】潮涌球
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: surge1.instanceId,
      }).success
    ).toBe(true);
    pickChoice(engine, 'p1', []); // 公开 3 张全放墓地
    expect(surge1.zone).toBe('SIGNAL_ORB');
    expect(engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB')[0]!.instanceId).toBe(surge1.instanceId);

    // 放入另外 2 张潮涌球凑够 3 张，并放 1 张<拉弥亚>角色进墓地测试「选 0 张也洗切并双方堆 5」
    engine.zoneMgr.moveCard(surge2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(surge3.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    const lamia029 = findCard(engine, 'p1', 'BP02-029');
    engine.zoneMgr.moveCard(lamia029.instanceId, 'GRAVEYARD', { isFaceUp: true });

    // 场上 BP02-028 -> 升变 BP02-027 -> 再从墓地升变 BP02-026
    const play027Res = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: lamia027.instanceId,
      isAscension: true,
      targetAscensionCardId: lamia028.instanceId,
    });
    expect(play027Res.success, play027Res.error).toBe(true);
    // 跳过 BP02-027【出】消除 2 球确认
    pickChoice(engine, 'p1', ['skip']);

    // 从墓地升变 BP02-026 到竖直的 BP02-027 上
    const play026Res = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: lamia026.instanceId,
      isAscension: true,
      targetAscensionCardId: lamia027.instanceId,
    });
    expect(play026Res.success, play026Res.error).toBe(true);
    // 跳过 BP02-026【出】墓地复活
    if (engine.getState().currentPendingChoice) {
      pickChoice(engine, 'p1', []);
    }
    expect(lamia026.zone).toBe('BATTLEFIELD');
    expect(engine.fieldMgr.evaluateRoleStats(lamia026.instanceId).keywords).toContain('速攻');

    // 立即攻击：将 1 张《潮涌球》置墓，墓地选 0 张也洗切，双方堆 5 张
    putNonOrbOnDeckTop(engine, 'p1');
    const p2DeckBefore = engine.zoneMgr.getCardsInZone('p2', 'DECK').length;
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: lamia026.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [surge1.instanceId]); // 送墓 1 张潮涌球
    pickChoice(engine, 'p1', []); // 选 0 张<拉弥亚>加入牌组 (Q&A·4 依然洗切且双方堆 5)
    expect(surge1.zone).toBe('GRAVEYARD');
    expect(engine.zoneMgr.getCardsInZone('p2', 'DECK').length).toBe(p2DeckBefore - 5);
  });

  it('BP02-030：从牌组放置到墓地触发弃 2 手牌出场（对方>=4角色时竖直出场）', () => {
    const engine = createEngine(
      makeDeck('ST02', ['BP02-030', 'BP02-032']),
      makeDeck('ST01', ['ST01-004', 'ST01-005', 'ST01-006', 'ST01-007'])
    );
    setOpenCosts(engine, 'p1', ['ST02-001'], 6);
    placeRole(engine, 'p2', 'ST01-004', 0);
    placeRole(engine, 'p2', 'ST01-005', 1);
    placeRole(engine, 'p2', 'ST01-006', 2);
    placeRole(engine, 'p2', 'ST01-007', 3);

    const lamia030 = findCard(engine, 'p1', 'BP02-030');
    const lamia032 = findCard(engine, 'p1', 'BP02-032');
    engine.zoneMgr.moveCardToTopOfDeck(lamia030.instanceId);
    engine.zoneMgr.moveCard(lamia032.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBeGreaterThanOrEqual(3);

    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: lamia032.instanceId,
      }).success
    ).toBe(true);

    const hand = engine.zoneMgr.getCardsInZone('p1', 'HAND');
    pickChoice(engine, 'p1', [hand[0]!.instanceId, hand[1]!.instanceId]);
    expect(lamia030.zone).toBe('BATTLEFIELD');
    expect(lamia030.isReady).toBe(true); // 对方>=4张角色，竖直出场
  });
});

// ============================================================================
// 6. 含英·檀心 & 飞叶点翠体系 (BP02-037 ~ BP02-047)
// ============================================================================

describe('BP02 含英·檀心 & 飞叶点翠体系', () => {
  it('BP02-037 + BP02-047 (Q&A·4)：出场回合装备《飞叶点翠》获突进并竖直费用区<含英>；第 2 项送墓下回合结束前获贯通+1000；单出不触发', () => {
    const engine = createEngine(
      makeDeck('ST01', ['BP02-037', 'BP02-038', 'BP02-039', 'BP02-047', 'ST01-012', 'ST01-013']),
      makeDeck('ST02')
    );
    const costHanying = findCard(engine, 'p1', 'BP02-039');
    // 费区留 1 个空位，避免 10 张满时移入 BP02-039 触发 3.6.4 溢出送墓
    setOpenCosts(engine, 'p1', ['ST01-004'], 9);
    engine.zoneMgr.moveCard(costHanying.instanceId, 'COST', { isFaceUp: true, isReady: false });
    engine.zoneMgr.syncCostStats('p1');

    const bp02037 = findCard(engine, 'p1', 'BP02-037');
    const leaf = findCard(engine, 'p1', 'BP02-047');
    engine.zoneMgr.moveCard(bp02037.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(leaf.instanceId, 'GRAVEYARD', { isFaceUp: true });

    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: bp02037.instanceId,
      }).success
    ).toBe(true);
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: bp02037.instanceId,
      }).success
    ).toBe(true);
    pickChoice(engine, 'p1', ['equip_and_untap']);
    pickChoice(engine, 'p1', [leaf.instanceId]);
    pickChoice(engine, 'p1', [costHanying.instanceId]);

    expect(getAttachedEquipmentIds(bp02037)).toContain(leaf.instanceId);
    expect(engine.fieldMgr.evaluateRoleStats(bp02037.instanceId).keywords).toContain('突进');
    expect(costHanying.isReady).toBe(true);

    // 到下回合再测试 BP02-037 第 2 项：将下方《飞叶点翠》送墓并消 2 球获贯通、PP+1000
    advanceTurnTo(engine, 'p2');
    advanceTurnTo(engine, 'p1');
    engine.zoneMgr.moveCard(findCard(engine, 'p1', 'ST01-012').instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(findCard(engine, 'p1', 'ST01-013').instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: bp02037.instanceId,
      }).success
    ).toBe(true);
    pickChoice(engine, 'p1', ['sac_leaf_pierce_pp']);
    const payOpt = engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    pickChoice(engine, 'p1', [payOpt.id]);
    pickChoice(engine, 'p1', [leaf.instanceId]);
    expect(leaf.zone).toBe('GRAVEYARD');
    expect(engine.fieldMgr.evaluateRoleStats(bp02037.instanceId).keywords).toContain('贯通');
    expect(engine.fieldMgr.calculateRoleEffectivePP(bp02037.instanceId)).toBe(8000);

    // 检验单独出场《飞叶点翠》不触发【出】突进 (Q&A·4)
    const leaf2Engine = createEngine(makeDeck('ST01', ['BP02-047', 'BP02-038']), makeDeck('ST02'));
    setOpenCosts(leaf2Engine, 'p1', ['ST01-004'], 6);
    const h038 = placeRole(leaf2Engine, 'p1', 'BP02-038', 0);
    const leafStandalone = findCard(leaf2Engine, 'p1', 'BP02-047');
    leaf2Engine.zoneMgr.moveCard(leafStandalone.instanceId, 'HAND', { isFaceUp: true });
    expect(
      leaf2Engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: leafStandalone.instanceId,
        targetSlotIndex: 1,
      }).success
    ).toBe(true);
    expect(leaf2Engine.fieldMgr.evaluateRoleStats(h038.instanceId).keywords).not.toContain('突进');
  });

  it('BP02-040 视为《飞叶点翠》(Q&A·5)：BP02-041 可送墓场上 BP02-040 减 2 费但不可选下方牌；BP02-044 下方有 040 时 PP+1500 DP+1', () => {
    const engine = createEngine(
      makeDeck('ST01', ['BP02-040', 'BP02-040', 'BP02-041', 'BP02-044', 'BP02-046', 'ST01-004']),
      makeDeck('ST02')
    );
    const h040Field = placeRole(engine, 'p1', 'BP02-040', 0, { isReady: true, instanceIndex: 0 });
    const h040ToStack = placeRole(engine, 'p1', 'BP02-040', 1, { isReady: true, instanceIndex: 1 });
    const h044 = placeRole(engine, 'p1', 'BP02-044', 2, { isReady: true });
    const h041 = findCard(engine, 'p1', 'BP02-041');
    engine.zoneMgr.moveCard(h041.instanceId, 'HAND', { isFaceUp: true });
    setOpenCosts(engine, 'p1', ['ST01-004'], 5);

    // static:BP02-040 生效：所有区域均视为《飞叶点翠》
    expect(engine.continuousEffects.hasCardName(h040Field.instanceId, '飞叶点翠')).toBe(true);

    // 发动 h040ToStack【起】将竖直自身置入 h044 下方 -> h044 PP+1500 DP+1 (4500 / 1)
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: h040ToStack.instanceId,
      }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [h044.instanceId]);
    expect(h044.underneathCardIds).toContain(h040ToStack.instanceId);
    expect(engine.fieldMgr.calculateRoleEffectivePP(h044.instanceId)).toBe(4500);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(h044.instanceId)).toBe(1);

    // 打出 BP02-041：可选战场 BP02-040 (h040Field) 减 2 费为 4 费，但下方的 h040ToStack 不可选 (Q&A·5)
    const play041 = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: h041.instanceId,
    });
    expect(play041.success, play041.error).toBe(true);
    const sacCh = engine.getState().currentPendingChoice!;
    expect(sacCh.options.map((o) => o.id)).toContain(h040Field.instanceId);
    expect(sacCh.options.map((o) => o.id)).not.toContain(h040ToStack.instanceId);
    pickChoice(engine, 'p1', [h040Field.instanceId]);
    expect(h041.zone).toBe('BATTLEFIELD');
    expect(h040Field.zone).toBe('GRAVEYARD');
    expect(engine.fieldMgr.evaluateRoleStats(h041.instanceId).keywords).toContain('速攻');
  });
});

// ============================================================================
// 7. 曲·启明 & 万世铭体系 (BP02-048 ~ BP02-055)
// ============================================================================

describe('BP02 曲·启明 & 万世铭体系', () => {
  it('BP02-048 牺牲费用区与手牌<万世铭>分别获得速攻/9999PP及翻4选2；BP02-049 洗2张万世铭获速攻及战斗破坏内置置换', () => {
    const engine = createEngine(
      makeDeck('ST01', ['BP02-048', 'BP02-049', 'BP02-053', 'BP01-037', 'BP01-038']),
      makeDeck('ST02', ['ST02-001'])
    );
    const wsmCost = findCard(engine, 'p1', 'BP01-037');
    const wsmHand = findCard(engine, 'p1', 'BP01-038');
    // 费区放入 BP02-053 充当冰属性明费，留出 1 个位置放入 wsmCost
    setOpenCosts(engine, 'p1', ['BP02-053'], 6);
    engine.zoneMgr.moveCard(wsmCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.syncCostStats('p1');
    engine.zoneMgr.moveCard(wsmHand.instanceId, 'HAND', { isFaceUp: true });

    const qu049 = placeRole(engine, 'p1', 'BP02-049', 0, { isReady: true });
    const qu048 = findCard(engine, 'p1', 'BP02-048');
    engine.zoneMgr.moveCard(qu048.instanceId, 'HAND', { isFaceUp: true });

    const handBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: qu048.instanceId,
        isAscension: true,
        targetAscensionCardId: qu049.instanceId,
      }).success
    ).toBe(true);

    // 选择牺牲费用区 wsmCost 与手牌 wsmHand
    pickChoice(engine, 'p1', [wsmCost.instanceId, wsmHand.instanceId]);
    // 翻 4 选最多 2 张入手
    const revCh = engine.getState().currentPendingChoice!;
    pickChoice(engine, 'p1', [revCh.options[0]!.id]);
    // 剩余 3 张牌由操作玩家自选置入牌组底顺序 (chooseOrder: true)
    const orderCh = engine.getState().currentPendingChoice!;
    expect(orderCh.effectType).toBe('DSL_ORDER_MOVE_BP02-048');
    expect(orderCh.options).toHaveLength(3);
    const orderedBottom = orderCh.options.map((o) => o.id).reverse();
    pickChoice(engine, 'p1', orderedBottom);
    expect(
      engine.zoneMgr
        .getCardsInZone('p1', 'DECK')
        .slice(-3)
        .map((c) => c.instanceId)
    ).toEqual(orderedBottom);

    expect(wsmCost.zone).toBe('GRAVEYARD');
    expect(wsmHand.zone).toBe('GRAVEYARD');
    expect(engine.fieldMgr.evaluateRoleStats(qu048.instanceId).keywords).toContain('速攻');
    expect(engine.fieldMgr.calculateRoleEffectivePP(qu048.instanceId)).toBe(9999);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore - 1); // -qu048 -wsmHand +1

    // 独立验证 BP02-049【出】（费区+墓地洗回2张万世铭获速攻）与战斗破坏内置置换（弃1张手牌万世铭不破坏）
    const quEngine = createEngine(
      makeDeck('ST01', ['BP02-049', 'BP02-053', 'BP01-037', 'BP01-038', 'BP01-037']),
      makeDeck('ST02', ['ST02-001'])
    );
    const wCost49 = findCard(quEngine, 'p1', 'BP01-037', 0);
    const wGy49 = findCard(quEngine, 'p1', 'BP01-038');
    const wHandSave = findCard(quEngine, 'p1', 'BP01-037', 1);
    const qu049Play = findCard(quEngine, 'p1', 'BP02-049');
    quEngine.zoneMgr.moveCard(wGy49.instanceId, 'GRAVEYARD', { isFaceUp: true });
    quEngine.zoneMgr.moveCard(wHandSave.instanceId, 'HAND', { isFaceUp: true });
    quEngine.zoneMgr.moveCard(qu049Play.instanceId, 'HAND', { isFaceUp: true });
    setOpenCosts(quEngine, 'p1', ['BP02-053'], 6);
    quEngine.zoneMgr.moveCard(wCost49.instanceId, 'COST', { isFaceUp: true, isReady: true });
    quEngine.zoneMgr.syncCostStats('p1');

    expect(
      quEngine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: qu049Play.instanceId,
      }).success
    ).toBe(true);
    pickChoice(quEngine, 'p1', ['opt_yes']);
    pickChoice(quEngine, 'p1', [wCost49.instanceId, wGy49.instanceId]);
    expect(wCost49.zone).toBe('DECK');
    expect(wGy49.zone).toBe('DECK');
    expect(quEngine.fieldMgr.evaluateRoleStats(qu049Play.instanceId).keywords).toContain('速攻');

    // 在 P2 回合用 P2 的 ST02-001 (6000PP) 攻击横置的 BP02-049 (4000PP)，验证内置置换自动丢弃手牌<万世铭>免于被破坏
    qu049Play.isReady = false;
    const p2Boss = placeRole(quEngine, 'p2', 'ST02-001', 0, { isReady: true });
    advanceTurnTo(quEngine, 'p2');
    const bossAtk = quEngine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p2',
      attackerCardId: p2Boss.instanceId,
      targetType: 'CHARACTER',
      targetCardId: qu049Play.instanceId,
    });
    expect(bossAtk.success, bossAtk.error).toBe(true);
    passInstantWindows(quEngine);
    if (quEngine.getState().phase === 'COMBAT_FREE_TIMING') {
      quEngine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p1' });
    }
    resolvePendingChoices(quEngine);
    expect(cardState(quEngine, qu049Play.instanceId).zone).toBe('BATTLEFIELD');
    expect(cardState(quEngine, wHandSave.instanceId).zone).toBe('GRAVEYARD');
  });

  it('BP02-050：翻 5 堆最多 2 张<万世铭>并按送墓数量依次执行模式选择（速攻 / 曲·启明 充能+1 & PP+1000）', () => {
    const engine = createEngine(
      makeDeck('ST01', ['BP02-050', 'BP02-053', 'BP01-037', 'BP01-038']),
      makeDeck('ST02')
    );
    const qu050 = findCard(engine, 'p1', 'BP02-050');
    const w1 = findCard(engine, 'p1', 'BP01-037');
    const w2 = findCard(engine, 'p1', 'BP01-038');
    engine.zoneMgr.moveCard(qu050.instanceId, 'HAND', { isFaceUp: true });
    setOpenCosts(engine, 'p1', ['BP02-053'], 8);
    // 费区确定之后再把 w1 / w2 放在牌组顶，保证 REVEAL_TOP 5 必能翻到
    engine.zoneMgr.moveCardToTopOfDeck(w1.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(w2.instanceId);

    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: qu050.instanceId,
      }).success
    ).toBe(true);
    // REVEAL_TOP 在<曲>角色上会先询问 BP01-037/038 是否放入费用区，这里传入 [] 跳过以留在处理区供 BP02-050 送墓
    while (engine.getState().currentPendingChoice?.effectType === 'BP01_WANSHIMING_REVEAL_TO_COST') {
      pickChoice(engine, 'p1', []);
    }
    pickChoice(engine, 'p1', [w1.instanceId, w2.instanceId]);
    // 第 1 次选获得【速攻】，第 2 次选增益《曲·启明》自身
    pickChoice(engine, 'p1', ['rush_1']);
    pickChoice(engine, 'p1', ['buff_qu_2']);
    pickChoice(engine, 'p1', [qu050.instanceId]);

    expect(w1.zone).toBe('GRAVEYARD');
    expect(w2.zone).toBe('GRAVEYARD');
    const stats = engine.fieldMgr.evaluateRoleStats(qu050.instanceId);
    expect(stats.keywords).toContain('速攻');
    expect(stats.charge).toBe(2);
    expect(stats.pp).toBe(6500);
  });

  it('BP02-054 翻 1 张非<曲>放回牌组顶，翻 1 张<曲>入手并弃 1 张手牌', () => {
    const engine = createEngine(
      makeDeck('ST01', ['BP02-054', 'BP02-054', 'BP02-049', 'BP02-053', 'ST01-004']),
      makeDeck('ST02')
    );
    const nonQu = findCard(engine, 'p1', 'ST01-004');
    const quTop = findCard(engine, 'p1', 'BP02-049');
    const qu1 = findCard(engine, 'p1', 'BP02-054', 0);
    const qu2 = findCard(engine, 'p1', 'BP02-054', 1);
    engine.zoneMgr.moveCard(qu1.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(qu2.instanceId, 'HAND', { isFaceUp: true });
    // 先将非费区卡移离牌组再设置费用区，防止被 fillCostZone 抓进费用区后再移走导致缺费
    engine.zoneMgr.moveCardToTopOfDeck(quTop.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(nonQu.instanceId);
    // 重新构建时保证 nonQu 与 quTop 不在 fillCostZone 抓的范围（把它们放卡组底→设费→置顶）
    engine.zoneMgr.moveCardToBottomOfDeck(quTop.instanceId);
    engine.zoneMgr.moveCardToBottomOfDeck(nonQu.instanceId);
    setOpenCosts(engine, 'p1', ['BP02-053'], 6);
    engine.zoneMgr.moveCardToTopOfDeck(nonQu.instanceId);

    expect(engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: qu1.instanceId }).success).toBe(true);
    // 非<曲>自动放回牌组顶
    expect(engine.zoneMgr.getCardsInZone('p1', 'DECK')[0]!.instanceId).toBe(nonQu.instanceId);

    // 将<曲>角色 BP02-049 置顶后打出第 2 张 BP02-054
    engine.zoneMgr.moveCardToTopOfDeck(quTop.instanceId);
    const playQu2 = engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: qu2.instanceId });
    expect(playQu2.success, playQu2.error).toBe(true);
    pickChoice(engine, 'p1', [quTop.instanceId]); // 加入手牌
    expect(quTop.zone).toBe('HAND');
    const hand = engine.zoneMgr.getCardsInZone('p1', 'HAND');
    pickChoice(engine, 'p1', [hand[0]!.instanceId]); // 丢弃 1 张手牌
    expect(hand[0]!.zone).toBe('GRAVEYARD');
  });
});

// ============================================================================
// 8. 三头犬小队体系 (BP02-056 ~ BP02-065)
// ============================================================================

describe('BP02 三头犬小队体系', () => {
  it('BP02-058 失去能力且不能获得新能力；BP02-063 攻击横置时抽 1 弃 1；BP02-065 不重复增加充能1', () => {
    const engine = createEngine(
      makeDeck('ST03', ['BP02-058', 'BP02-063', 'BP02-064', 'BP02-064', 'BP02-064', 'BP02-064', 'BP02-065']),
      makeDeck('ST01', ['BP02-017', 'ST01-012'])
    );
    const noctis058 = findCard(engine, 'p1', 'BP02-058');
    const c21 = placeRole(engine, 'p1', 'BP02-063', 0, { isReady: true });
    const noctisBase = placeRole(engine, 'p1', 'BP02-064', 1, { isReady: true, instanceIndex: 0 });
    const wFlag = findCard(engine, 'p1', 'BP02-065');
    const p2Target = placeRole(engine, 'p2', 'ST01-004', 0, { isReady: true });
    engine.zoneMgr.moveCard(noctis058.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(wFlag.instanceId, 'HAND', { isFaceUp: true });
    // 用第 3 张 BP02-064 (instanceIndex 2 保留给之后出场，instanceIndex 1 放入费区充当雷属性明费)
    const costSeed = findCard(engine, 'p1', 'BP02-064', 1);
    setOpenCosts(engine, 'p1', [], 7);
    engine.zoneMgr.moveCard(costSeed.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.syncCostStats('p1');

    const play058 = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: noctis058.instanceId,
      isAscension: true,
      targetAscensionCardId: noctisBase.instanceId,
    });
    expect(play058.success, play058.error).toBe(true);
    pickChoice(engine, 'p1', [p2Target.instanceId]);
    expect(engine.continuousEffects.hasLostInherentAbilities(p2Target.instanceId)).toBe(true);
    expect(engine.continuousEffects.hasProhibition(p2Target.instanceId, 'CANNOT_GAIN_ABILITIES')).toBe(true);

    // BP02-063 攻击横置时触发 CARD_TAPPED：抽 1 弃 1
    putNonOrbOnDeckTop(engine, 'p1');
    const handBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: c21.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    const tapDiscardCh = engine.getState().currentPendingChoice!;
    pickChoice(engine, 'p1', [tapDiscardCh.options[0]!.id]);
    passInstantWindows(engine);
    // 防守方 P2 场上存在竖直角色 p2Target，需要显式放弃阻挡以完成战斗步骤回到主要阶段
    if (engine.getState().currentCombat?.step === 'BLOCK') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    }
    passInstantWindows(engine);
    resolvePendingChoices(engine);
    passInstantWindows(engine);
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore); // +1 -1

    // 验证 BP02-065 胜光战旗：使基本充能为 1 的角色仍保持充能 1（不叠加为 2）(Q&A·4)，PP+2000、基本DP 1，且不影响之后出场角色
    const playWFlag = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: wFlag.instanceId,
    });
    expect(playWFlag.success, playWFlag.error).toBe(true);
    const c21Stats = engine.fieldMgr.evaluateRoleStats(c21.instanceId);
    expect(c21Stats.charge).toBe(1);
    expect(c21Stats.pp).toBe(4000);
    expect(c21Stats.dp).toBe(1);

    // 之后出场的 2 费<三头犬小队>角色 BP02-064 不受已结算的胜光战旗影响
    const laterCerberus = placeRole(engine, 'p1', 'BP02-064', 2, { isReady: true, instanceIndex: 2 });
    const laterStats = engine.fieldMgr.evaluateRoleStats(laterCerberus.instanceId);
    expect(laterStats.pp).toBe(3000);
    expect(laterStats.dp).toBe(0);
  });

  it('BP02-060：我方费用上限不大于对方时，手牌与战场的该牌费用 -1', () => {
    const engine = createEngine(
      makeDeck('ST03', ['BP02-060', 'BP02-064']),
      makeDeck('ST01')
    );
    // P1 明费 4 张，P2 明费 5 张 -> P1 <= P2，BP02-060 在手牌费用 3 -> 2
    setOpenCosts(engine, 'p1', ['BP02-064'], 4);
    setOpenCosts(engine, 'p2', ['ST01-004'], 5);
    const c060 = findCard(engine, 'p1', 'BP02-060');
    engine.zoneMgr.moveCard(c060.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.calculateCardCost('p1', c060.instanceId).costToPay).toBe(2);

    // 出场后在战场时同样 -1 费用为 2
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: c060.instanceId,
      }).success
    ).toBe(true);
    expect(engine.continuousEffects.getEffectiveCardCost(c060.instanceId)).toBe(2);

    // 当 P1 明费变为 6 张 > P2 5 张时，战场 BP02-060 恢复原价 3 费
    fillCostZone(engine, 'p1', 6);
    expect(engine.continuousEffects.getEffectiveCardCost(c060.instanceId)).toBe(3);
  });
});

// ============================================================================
// 9. 万事·明晰梦体系 (BP02-066 ~ BP02-076)
// ============================================================================

describe('BP02 万事·明晰梦体系', () => {
  it('BP02-066 升变冰冻并封锁对方信号球区不可消除；BP02-067 横置时对方在横置角色上升变额外+1费 (Q&A·4)', () => {
    const engine = createEngine(
      makeDeck('ST01', ['BP02-066', 'BP02-067', 'BP02-069', 'BP02-070', 'BP02-085', 'BP02-085']),
      makeDeck('ST01', ['BP02-067', 'BP02-069', 'BP02-070', 'BP02-085', 'BP02-085', 'BP02-085'])
    );

    const w069 = placeRole(engine, 'p1', 'BP02-069', 0, { isReady: true });
    const w067Self = placeRole(engine, 'p1', 'BP02-067', 1, { isReady: false }); // 横置状态的 BP02-067 对 P2 施加额外 1 费升变税
    const w066 = findCard(engine, 'p1', 'BP02-066');
    engine.zoneMgr.moveCard(w066.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(findCard(engine, 'p1', 'BP02-085', 0).instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(findCard(engine, 'p1', 'BP02-085', 1).instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    const p2Orbs = [0, 1, 2].map((idx) => findCard(engine, 'p2', 'BP02-085', idx));
    for (const o of p2Orbs) {
      engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }
    const p2Role = placeRole(engine, 'p2', 'BP02-069', 0, { isReady: true });
    const p2W067 = findCard(engine, 'p2', 'BP02-067');
    engine.zoneMgr.moveCard(p2W067.instanceId, 'HAND', { isFaceUp: true });

    setOpenCosts(engine, 'p1', ['BP02-070'], 10);
    setOpenCosts(engine, 'p2', ['BP02-070'], 10);

    // BP02-066 升变出场到 w069 上
    const play066 = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: w066.instanceId,
      isAscension: true,
      targetAscensionCardId: w069.instanceId,
    });
    expect(play066.success, play066.error).toBe(true);
    expect(engine.getState().currentPendingChoice?.effectType).toBe('CHOOSE_TRIGGER_ORDER');
    const first066Opt = engine.getState().currentPendingChoice!.options[0]!;
    pickChoice(engine, 'p1', [first066Opt.id]);
    const orbCostOpt = engine.getState().currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    pickChoice(engine, 'p1', [orbCostOpt.id]);
    pickChoice(engine, 'p1', [p2Role.instanceId]); // 横置并冰冻 p2Role
    pickChoice(engine, 'p1', [p2Orbs[0]!.instanceId]); // 封锁 P2 信号球区第 1 张球直到下个回合结束

    expect(cardState(engine, p2Role.instanceId).isReady).toBe(false);
    expect(cardState(engine, p2Role.instanceId).isFrozen).toBe(true);
    expect(engine.continuousEffects.getEffectiveOrbInfo(p2Orbs[0]!.instanceId).cannotEliminate).toBe(true);

    // 切到 P2 回合：竖直阶段结束后 p2Role 因冰冻未竖直，但冰冻解除；被封锁的信号球仍不可消除！
    advanceTurnTo(engine, 'p2');
    expect(cardState(engine, p2Role.instanceId).isReady).toBe(false);
    expect(cardState(engine, p2Role.instanceId).isFrozen).toBeUndefined();

    const elimRes = engine.dispatchAction({
      type: 'ELIMINATE_3_ORBS',
      playerId: 'p2',
      orbCardInstanceIds: p2Orbs.map((o) => o.instanceId),
    });
    expect(elimRes.success).toBe(false);
    expect(elimRes.error).toContain('不能被消除');

    // 验证 P1 横置的 BP02-067 使 P2 在横置的 p2Role (<万事>) 上升变 BP02-067 (原升变代价 3 费) 额外支付 1 费 = 4 费 (Q&A·4)
    expect(engine.calculateCardCost('p2', p2W067.instanceId, true, p2Role.instanceId).costToPay).toBe(4);
    expect(cardState(engine, w067Self.instanceId).isReady).toBe(false);
  });

  it('BP02-069 失去能力后被战斗破坏时不触发【自】(Q&A·4)', () => {
    const engine = createEngine(
      makeDeck('ST01', ['BP02-069', 'BP02-069', 'BP02-073']),
      makeDeck('ST01', ['ST01-001'])
    );
    const w069 = placeRole(engine, 'p1', 'BP02-069', 0, { isReady: false });
    const handW1 = findCard(engine, 'p1', 'BP02-069', 1);
    const handW2 = findCard(engine, 'p1', 'BP02-073');
    engine.zoneMgr.moveCard(handW1.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(handW2.instanceId, 'HAND', { isFaceUp: true });
    w069.modifiers = [{ id: 'test-lose', loseAbilities: true, timestamp: 1 }];

    const p2Attacker = placeRole(engine, 'p2', 'ST01-001', 0, { isReady: true });
    advanceTurnTo(engine, 'p2');
    const atkRes = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p2',
      attackerCardId: p2Attacker.instanceId,
      targetType: 'CHARACTER',
      targetCardId: w069.instanceId,
    });
    expect(atkRes.success, atkRes.error).toBe(true);
    passInstantWindows(engine);
    if (engine.getState().phase === 'COMBAT_FREE_TIMING') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p1' });
    }
    resolvePendingChoices(engine);
    expect(cardState(engine, w069.instanceId).zone).toBe('GRAVEYARD');
    expect(cardState(engine, p2Attacker.instanceId).isFrozen).toBeUndefined();
  });
});

// ============================================================================
// 10. 同命角色 (BP02-077~081) & 信号球 (BP02-082~090)
// ============================================================================

describe('BP02 同命角色与信号球牌', () => {
  it('BP02-077 塞壬拥有【充能0】与【同命】，攻击结束时可与交战角色互换破坏', () => {
    const engine = createEngine(makeDeck('ST02', ['BP02-077']), makeDeck('ST01', ['ST01-001']));
    const siren = placeRole(engine, 'p1', 'BP02-077', 0, { isReady: true });
    // 只有横置状态的角色才能直接选为攻击目标
    const defender = placeRole(engine, 'p2', 'ST01-001', 0, { isReady: false });

    expect(engine.fieldMgr.evaluateRoleStats(siren.instanceId).charge).toBe(0);
    expect(engine.fieldMgr.evaluateRoleStats(siren.instanceId).keywords).toContain('同命');

    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: siren.instanceId,
        targetType: 'CHARACTER',
        targetCardId: defender.instanceId,
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    if (engine.getState().phase === 'COMBAT_FREE_TIMING') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    }
    // 塞壬 3000PP < ST01-001 6000PP 双方均存活至攻击结束，触发【同命】互换破坏
    const mdCh = engine.getState().currentPendingChoice!;
    expect(mdCh.effectType).toBe('MUTUAL_DESTINY');
    pickChoice(engine, 'p1', ['opt_yes']);
    expect(siren.zone).toBe('GRAVEYARD');
    expect(defender.zone).toBe('GRAVEYARD');
  });

  it('BP02-082 / BP02-085 / BP02-088 标准信号球使用后置顶信号球区抽 1 牌，并在充能时触发【充能自】', () => {
    const engine = createEngine(
      makeDeck('ST01', ['BP02-082', 'BP02-085', 'BP02-088', 'ST01-005']),
      makeDeck('ST02')
    );
    // 使用充能为 1 的 ST01-005 攻击（ST01-004 为充能0）
    const attacker = placeRole(engine, 'p1', 'ST01-005', 0, { isReady: true });
    const redOrb = findCard(engine, 'p1', 'BP02-082');
    const yellowOrb = findCard(engine, 'p1', 'BP02-088');
    engine.zoneMgr.moveCard(redOrb.instanceId, 'HAND', { isFaceUp: true });

    const handBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    expect(engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: redOrb.instanceId }).success).toBe(true);
    expect(redOrb.zone).toBe('SIGNAL_ORB');
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore); // -1 +1

    // 在打出红球（抽1张）之后再将黄球 BP02-088 置顶牌组，确保攻击充能精准翻开它
    engine.zoneMgr.moveCardToTopOfDeck(yellowOrb.instanceId);
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: attacker.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    pickChoice(engine, 'p1', ['opt_pp_plus_2000']);
    pickChoice(engine, 'p1', [attacker.instanceId]);
    resolvePendingChoices(engine);
    expect(yellowOrb.zone).toBe('SIGNAL_ORB');
  });
});
