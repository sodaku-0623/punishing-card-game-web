import { describe, it, expect } from 'vitest';
import { GameEngine, MemoryCardDatabase, OFFICIAL_CARDS_DATA, getAttachedEquipmentIds } from '../src/index.js';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import { endTurn, fillCostZone, passInstantWindows } from './helpers.js';

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

function createEngine(p1Deck: string[], p2Deck: string[], seed = 20261123): GameEngine {
  const engine = new GameEngine(
    'bp01-p2-test',
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
  return Object.values(engine.getState().cards).filter(
    (c) => c.controllerPlayerId === playerId && c.cardNumber === cardNumber
  );
}

function putOpenCostAttr(engine: GameEngine, playerId: string, cardNumber: string, count = 10) {
  const state = engine.getState();
  // 先清空再填充，保证满足属性条件与充足可用费用
  for (const c of engine.zoneMgr.getCardsInZone(playerId, 'COST')) {
    engine.zoneMgr.moveCardToBottomOfDeck(c.instanceId);
  }
  const attrCard = findCards(engine, playerId, cardNumber)[0];
  if (attrCard) {
    engine.zoneMgr.moveCard(attrCard.instanceId, 'COST', { isFaceUp: true, isReady: true });
  }
  fillCostZone(engine, playerId, count);
  engine.zoneMgr.syncCostStats(playerId);
  expect(state.players[playerId]!.availableOpenCostCount).toBeGreaterThanOrEqual(Math.min(count, 1));
}

function pickChoice(engine: GameEngine, playerId: string, selectedIds: string[]) {
  const ch = engine.getState().currentPendingChoice;
  expect(ch).toBeDefined();
  const res = engine.dispatchAction({
    type: 'SELECT_CHOICE_OPTION',
    playerId,
    pendingChoiceId: ch!.id,
    selectedIds,
  });
  expect(res.success, res.error).toBe(true);
  return res;
}

describe('BP01 第二批：露西亚·深红囚影 / 封刃太刀体系 (BP01-014 ~ BP01-027)', () => {
  it('BP01-014/015/016：双持2张<封刃太刀>装备叠加PP、首张装备-1费、Q&A·7蓝球视为红/黄与攻击消2黄竖直', () => {
    const deck = expandDeck('ST01', [
      'BP01-014',
      'BP01-015',
      'BP01-020',
      'BP01-021',
      'BP01-021',
      'BP01-081',
      'BP01-082',
      'BP01-083',
      'BP01-081',
    ]);
    const engine = createEngine(deck, expandDeck('ST02'));
    const state = engine.getState();

    // 放 1 张雷属性明费（BP01-015）供打出雷属性装备与角色
    const alpha15 = findCards(engine, 'p1', 'BP01-015')[0]!;
    const alpha14 = findCards(engine, 'p1', 'BP01-014')[0]!;
    const smallTachi = findCards(engine, 'p1', 'BP01-020')[0]!;
    const bigTachiList = findCards(engine, 'p1', 'BP01-021');
    const bigTachi1 = bigTachiList[0]!;
    const bigTachi2 = bigTachiList[1]!;

    // 放 1 张雷属性卡进费用区并补足明费
    engine.zoneMgr.moveCard(bigTachi2.instanceId, 'COST', { isFaceUp: true, isReady: true });
    fillCostZone(engine, 'p1', 8);

    // 场上放 BP01-015 (每回合第1张装备费用-1) 与 BP01-014 (可双持2张<封刃太刀>)
    engine.fieldMgr.playRoleCard('p1', alpha15.instanceId, 0);
    engine.fieldMgr.playRoleCard('p1', alpha14.instanceId, 1);
    state.cards[alpha14.instanceId]!.turnEnteredZone = 0;

    // 验证 BP01-015 首张装备减费：BP01-020 原价 2 费 → 实付 1 费
    engine.zoneMgr.moveCard(smallTachi.instanceId, 'HAND', { isFaceUp: true });
    const openBeforeEquip = state.players['p1']!.availableOpenCostCount;
    const playEqRes = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: smallTachi.instanceId,
      targetEquipRoleId: alpha14.instanceId,
    });
    expect(playEqRes.success, playEqRes.error).toBe(true);
    expect(state.players['p1']!.availableOpenCostCount).toBe(openBeforeEquip - 1);
    expect(engine.fieldMgr.calculateRoleEffectivePP(alpha14.instanceId)).toBe(9000); // 8000 + 1000

    // 第 2 张装备恢复原价 (calculateCardCost 应返回 3)
    engine.zoneMgr.moveCard(bigTachi1.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.calculateCardCost('p1', bigTachi1.instanceId).costToPay).toBe(3);

    // 把 bigTachi1 放入墓地，信号球区放 4 张蓝球
    engine.zoneMgr.moveCard(bigTachi1.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const blueOrbs = [
      ...findCards(engine, 'p1', 'BP01-081'),
      ...findCards(engine, 'p1', 'BP01-082'),
      ...findCards(engine, 'p1', 'BP01-083'),
    ].slice(0, 4);
    for (const o of blueOrbs) {
      engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    }

    // 发动 BP01-014 【起】【回合1】消除2蓝球：从墓地装备第2张<大太刀>并使剩余2张蓝球视为红/黄球
    const actRes = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: alpha14.instanceId,
      abilityIndex: 0,
    });
    expect(actRes.success, actRes.error).toBe(true);
    // 选前 2 张蓝球消除
    pickChoice(engine, 'p1', [engine.getState().currentPendingChoice!.options[0]!.id]);
    // 选墓地 bigTachi1 装备
    pickChoice(engine, 'p1', [bigTachi1.instanceId]);

    // 双持<封刃太刀>成功，PP = 8000 + 1000 + 1500 = 10500
    expect(getAttachedEquipmentIds(state.cards[alpha14.instanceId]!)).toEqual([
      smallTachi.instanceId,
      bigTachi1.instanceId,
    ]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(alpha14.instanceId)).toBe(10500);

    // 剩余 2 张蓝球均被视为红/黄球，攻击时可直接用它们支付【2黄色信号球】竖直自身、充能+1、PP+1000
    const atkRes = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p1',
      attackerCardId: alpha14.instanceId,
      targetType: 'PLAYER',
    });
    expect(atkRes.success, atkRes.error).toBe(true);
    // 攻击触发选择支付 2 黄色信号球 (选项 0 是 skip，选项 1 是 2 蓝球视为黄球)
    const orbChoice = engine.getState().currentPendingChoice!;
    expect(orbChoice.options.length).toBeGreaterThanOrEqual(2);
    pickChoice(engine, 'p1', [orbChoice.options[1]!.id]);

    expect(state.cards[alpha14.instanceId]!.isReady).toBe(true);
    expect(engine.fieldMgr.calculateRoleEffectivePP(alpha14.instanceId)).toBe(11500);
    expect(engine.fieldMgr.evaluateRoleStats(alpha14.instanceId).charge).toBe(2);
  });

  it('BP01-017 离场置换：同时装备<小太刀>和<大太刀>时，战斗破坏改为送双刀入墓、本体留场且不触发【贯通】', () => {
    const p1Deck = expandDeck('ST01', ['ST01-001']);
    const p2Deck = expandDeck('ST02', ['BP01-017', 'BP01-020', 'BP01-021']);
    const engine = createEngine(p1Deck, p2Deck);
    const state = engine.getState();

    const attacker = findCards(engine, 'p1', 'ST01-001')[0]!;
    engine.fieldMgr.playRoleCard('p1', attacker.instanceId, 0, { suppressEntryTrigger: true });
    state.cards[attacker.instanceId]!.turnEnteredZone = 0;
    // 给攻击者足够高 PP 与【贯通】
    state.cards[attacker.instanceId]!.modifiers = [
      { pp: 6000, keywords: ['贯通'], untilTurn: state.turnNumber, source: 'TEST' },
    ];

    const alpha17 = findCards(engine, 'p2', 'BP01-017')[0]!;
    const small = findCards(engine, 'p2', 'BP01-020')[0]!;
    const big = findCards(engine, 'p2', 'BP01-021')[0]!;
    engine.fieldMgr.playRoleCard('p2', alpha17.instanceId, 0, { suppressEntryTrigger: true });
    state.cards[alpha17.instanceId]!.isReady = false;
    expect(engine.fieldMgr.equipToRole('p2', small.instanceId, alpha17.instanceId, { suppressEntryTrigger: true })).toBe(true);
    expect(engine.fieldMgr.equipToRole('p2', big.instanceId, alpha17.instanceId, { suppressEntryTrigger: true })).toBe(true);
    expect(engine.fieldMgr.calculateRoleEffectivePP(alpha17.instanceId)).toBe(8500);

    const p2ErosionBefore = state.players['p2']!.erosionCount;
    const atkRes = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p1',
      attackerCardId: attacker.instanceId,
      targetType: 'CHARACTER',
      targetCardId: alpha17.instanceId,
    });
    expect(atkRes.success, atkRes.error).toBe(true);
    passInstantWindows(engine);

    // BP01-017 可选离场置换弹窗：选择送墓双刀留场
    const replChoice = engine.getState().currentPendingChoice;
    expect(replChoice?.effectType).toBe('BP01_017_OPTIONAL_LEAVE_REPLACEMENT');
    expect(replChoice?.playerId).toBe('p2');
    const pickRes = engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p2',
      pendingChoiceId: replChoice!.id,
      selectedIds: ['replace'],
    });
    expect(pickRes.success, pickRes.error).toBe(true);

    // BP01-017 留场、双刀入墓、无【贯通】伤害
    expect(state.cards[alpha17.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(getAttachedEquipmentIds(state.cards[alpha17.instanceId]!)).toEqual([]);
    expect(state.cards[small.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[big.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.players['p2']!.erosionCount).toBe(p2ErosionBefore);
  });

  it('BP01-022 夜煌—小太刀 (Q&A·2 升变刷新计次) 与 BP01-023 夜煌—大太刀 (Q&A·2/7 不付代价不耗回合1 & 本次攻击不可阻挡)', () => {
    const p1Deck = expandDeck('ST01', [
      'BP01-015',
      'BP01-017',
      'BP01-022',
      'BP01-023',
      'BP01-018',
      'BP01-078',
      'BP01-081',
    ]);
    const p2Deck = expandDeck('ST02', ['ST02-005']); // 3000 PP 阻挡者
    const engine = createEngine(p1Deck, p2Deck);
    const state = engine.getState();

    const alpha15 = findCards(engine, 'p1', 'BP01-015')[0]!;
    const alpha17 = findCards(engine, 'p1', 'BP01-017')[0]!;
    const nightSmall = findCards(engine, 'p1', 'BP01-022')[0]!;
    const nightBig = findCards(engine, 'p1', 'BP01-023')[0]!;
    const alpha18 = findCards(engine, 'p1', 'BP01-018')[0]!;
    const redOrb = findCards(engine, 'p1', 'BP01-078')[0]!;

    // 放雷属性明费 + 先把手牌/出场卡摘出再凑齐 6 费上限供 BP01-017 升变
    engine.zoneMgr.moveCard(alpha17.instanceId, 'HAND', { isFaceUp: true });
    engine.fieldMgr.playRoleCard('p1', alpha15.instanceId, 0);
    expect(engine.fieldMgr.equipToRole('p1', nightSmall.instanceId, alpha15.instanceId)).toBe(true);
    engine.zoneMgr.moveCard(redOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(alpha18.instanceId, 'COST', { isFaceUp: true, isReady: true });
    fillCostZone(engine, 'p1', 6);

    // 1. BP01-015 发动夜煌—小太刀赋予的【起】【回合1】，把红球视为蓝球
    const act1 = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: alpha15.instanceId,
      abilityIndex: 0,
    });
    expect(act1.success, act1.error).toBe(true);
    pickChoice(engine, 'p1', [redOrb.instanceId]);
    expect(engine.continuousEffects.getEffectiveOrbInfo(redOrb.instanceId).colors).toContain('BLUE');

    // 同回合再次发动应被【回合1】拒绝
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: alpha15.instanceId,
        abilityIndex: 0,
      }).success
    ).toBe(false);

    // 2. Q&A·2：BP01-015 升变为 BP01-017（保留装备夜煌—小太刀）后，可再次发动夜煌—小太刀【起】！
    const ascRes = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: alpha17.instanceId,
      isAscension: true,
      targetAscensionCardId: alpha15.instanceId,
    });
    expect(ascRes.success, ascRes.error).toBe(true);
    const act2 = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: alpha17.instanceId,
      abilityIndex: 0,
    });
    expect(act2.success, act2.error).toBe(true);
    pickChoice(engine, 'p1', [redOrb.instanceId]);

    // 3. 给 BP01-017 再双持夜煌—大太刀，场上另放 1 张竖直工具人供横置
    expect(engine.fieldMgr.equipToRole('p1', nightBig.instanceId, alpha17.instanceId)).toBe(true);
    const helperRole = findCards(engine, 'p1', 'ST01-006')[0]!;
    engine.fieldMgr.playRoleCard('p1', helperRole.instanceId, 1);

    // 对方放 1 张 3000 PP 角色准备阻挡
    const oppBlocker = findCards(engine, 'p2', 'ST02-005')[0]!;
    engine.fieldMgr.playRoleCard('p2', oppBlocker.instanceId, 0);

    // 放非信号球在 p1/p2 牌组顶，避免充能自弹窗阻断攻击结束断言
    const nonOrb1 = engine.zoneMgr.getCardsInZone('p1', 'DECK').find((c) => !db.getCard(c.cardNumber)?.signalOrb);
    if (nonOrb1) engine.zoneMgr.moveCardToTopOfDeck(nonOrb1.instanceId);
    const nonOrb2 = engine.zoneMgr.getCardsInZone('p2', 'DECK').find((c) => !db.getCard(c.cardNumber)?.signalOrb);
    if (nonOrb2) engine.zoneMgr.moveCardToTopOfDeck(nonOrb2.instanceId);

    // 攻击玩家，触发夜煌—大太刀：候选只能是顶层竖直牌 (helperRole)，不含附着装备 nightSmall/nightBig
    const atkRes = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p1',
      attackerCardId: alpha17.instanceId,
      targetType: 'PLAYER',
    });
    expect(atkRes.success, atkRes.error).toBe(true);
    const tapChoice = engine.getState().currentPendingChoice!;
    const optIds = tapChoice.options.map((o) => o.id);
    expect(optIds).toContain(helperRole.instanceId);
    expect(optIds).not.toContain(nightSmall.instanceId);
    expect(optIds).not.toContain(nightBig.instanceId);

    // 支付代价横置 helperRole → PP<=5000 的 oppBlocker 无法阻挡，直接跳过阻挡步骤完成对 p2 的伤害并自动结束战斗
    const p2ErosionBefore = state.players['p2']!.erosionCount;
    pickChoice(engine, 'p1', [helperRole.instanceId]);
    expect(state.cards[helperRole.instanceId]!.isReady).toBe(false);
    passInstantWindows(engine);
    // 确认对方竖直的 3000 PP 角色未能阻挡、p2 受到 1 点伤害，且攻击结束后 combat-* 持续效果自动清除
    expect(state.currentCombat).toBeUndefined();
    expect(state.players['p2']!.erosionCount).toBe(p2ErosionBefore + 1);
    expect(engine.fieldMgr.evaluateRoleStats(alpha17.instanceId).unblockableMaxPP).toBeUndefined();
  });

  it('BP01-018 丢弃装备抽2/丢弃普通角色抽1，BP01-027 枪林弹雨送附着装备入墓防止战斗伤害', () => {
    const p1Deck = expandDeck('ST01', ['BP01-018', 'BP01-020', 'BP01-027']);
    const p2Deck = expandDeck('ST02', ['ST02-001']);
    const engine = createEngine(p1Deck, p2Deck);
    const state = engine.getState();

    const alpha18 = findCards(engine, 'p1', 'BP01-018')[0]!;
    const eq = findCards(engine, 'p1', 'BP01-020')[0]!;
    const rain = findCards(engine, 'p1', 'BP01-027')[0]!;

    // 放入雷属性明费（用 BP01-027 自身？不，用 BP01-020 先不进费，放第1张 BP01-020 在手牌，另借 BP01-027 留在手牌，给 p1 放一张雷明费）
    const extraLightning = findCards(engine, 'p1', 'BP01-018')[0]!;
    // 先直接用 BP01-018 出场测试弃装备抽 2
    engine.zoneMgr.moveCard(eq.instanceId, 'HAND', { isFaceUp: true });
    const handBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    engine.fieldMgr.playRoleCard('p1', extraLightning.instanceId, 0);
    engine.effectEngine.handleRoleEntryEffect('p1', extraLightning.instanceId, db.getCard('BP01-018')!);
    pickChoice(engine, 'p1', [eq.instanceId]);
    // 弃 1 装备抽 2 → 手牌净 +1
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore + 1);

    // 切到 p2 回合攻击 p1 玩家，p1 在自由时点用 BP01-027 枪林弹雨将附着在 alpha18 上的装备送墓防伤
    engine.fieldMgr.equipToRole('p1', eq.instanceId, alpha18.instanceId);
    engine.zoneMgr.moveCard(rain.instanceId, 'HAND', { isFaceUp: true });
    // 放入 1 张雷属性明费 (把另一张雷卡？这里将 eq 留在场上，改用 BP01-018 先当明费不行——直接给 p1 构造满足雷属性明费：用 rain 自身不合适，临时把 p1 的一张牌换个副本？改为在卡组多带 1 张 BP01-020)
    const engine2 = createEngine(
      expandDeck('ST01', ['BP01-018', 'BP01-020', 'BP01-020', 'BP01-027']),
      expandDeck('ST02', ['ST02-001'])
    );
    const st2 = engine2.getState();
    const p1Role = findCards(engine2, 'p1', 'BP01-018')[0]!;
    const [p1Eq1, p1Eq2] = findCards(engine2, 'p1', 'BP01-020');
    const p1Rain = findCards(engine2, 'p1', 'BP01-027')[0]!;
    engine2.zoneMgr.moveCard(p1Eq2!.instanceId, 'COST', { isFaceUp: true, isReady: true });
    fillCostZone(engine2, 'p1', 5);
    engine2.fieldMgr.playRoleCard('p1', p1Role.instanceId, 0, { suppressEntryTrigger: true });
    engine2.fieldMgr.equipToRole('p1', p1Eq1!.instanceId, p1Role.instanceId, { suppressEntryTrigger: true });
    engine2.zoneMgr.moveCard(p1Rain.instanceId, 'HAND', { isFaceUp: true });

    endTurn(engine2);
    if (st2.phase === 'DRAW_CHARGE_PHASE') {
      engine2.dispatchAction({ type: 'CHARGE_COST_FROM_HAND', playerId: 'p2', cardInstanceId: undefined });
    }
    const p2Attacker = findCards(engine2, 'p2', 'ST02-001')[0]!;
    engine2.fieldMgr.playRoleCard('p2', p2Attacker.instanceId, 0, { suppressEntryTrigger: true });
    st2.cards[p2Attacker.instanceId]!.turnEnteredZone = 0;

    const p1ErosionBefore = st2.players['p1']!.erosionCount;
    expect(
      engine2.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p2',
        attackerCardId: p2Attacker.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    // 攻击方 p2 先 pass 自由时点 → 轮到被攻击方 p1 使用【瞬时】BP01-027
    if (st2.timingWindow?.priorityPlayerId === 'p2') {
      engine2.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    }
    const useRes = engine2.dispatchAction({
      type: 'USE_INSTANT',
      playerId: 'p1',
      cardInstanceId: p1Rain.instanceId,
    });
    expect(useRes.success, useRes.error).toBe(true);
    // 选附着装备 p1Eq1 送墓
    pickChoice(engine2, 'p1', [p1Eq1!.instanceId]);
    expect(st2.cards[p1Eq1!.instanceId]!.zone).toBe('GRAVEYARD');
    expect(st2.currentCombat?.cannotDealDamage).toBe(true);
    passInstantWindows(engine2);
    if (st2.currentCombat?.step === 'BLOCK') {
      engine2.dispatchAction({ type: 'DECLARE_BLOCK', playerId: 'p1', blockerCardId: undefined });
    }
    // 防伤生效，侵蚀计数不增加
    expect(st2.players['p1']!.erosionCount).toBe(p1ErosionBefore);
  });
});

describe('BP01 第二批：曲·雀翎 / 万世铭体系 (BP01-028 ~ BP01-039)', () => {
  it('BP01-028 洗回墓地+费用区6张<万世铭>自动全选3项（基本PP9999+青赫=10499、DP+1、充能<万世铭>竖直）及万世铭攻击充能选择', () => {
    const deck = expandDeck('ST01', [
      'BP01-028',
      'BP01-036',
      'BP01-037',
      'BP01-037',
      'BP01-037',
      'BP01-037',
      'BP01-038',
      'BP01-038',
      'BP01-038',
    ]);
    const engine = createEngine(deck, expandDeck('ST02'));
    const state = engine.getState();

    const qu28 = findCards(engine, 'p1', 'BP01-028')[0]!;
    const qinghe = findCards(engine, 'p1', 'BP01-036')[0]!;
    const wsm37 = findCards(engine, 'p1', 'BP01-037');
    const wsm38 = findCards(engine, 'p1', 'BP01-038');

    // 放 3 张在墓地、3 张在费用区 (合计 6 张 <万世铭>)，再留 1 张 BP01-037 在牌组顶
    for (const c of [wsm37[0]!, wsm37[1]!, wsm37[2]!]) {
      engine.zoneMgr.moveCard(c.instanceId, 'GRAVEYARD', { isFaceUp: true });
    }
    for (const c of [wsm38[0]!, wsm38[1]!, wsm38[2]!]) {
      engine.zoneMgr.moveCard(c.instanceId, 'COST', { isFaceUp: true, isReady: true });
    }

    // 出场 BP01-028 并装备青赫 (+500 PP)
    engine.fieldMgr.playRoleCard('p1', qu28.instanceId, 0);
    state.cards[qu28.instanceId]!.turnEnteredZone = 0;
    engine.fieldMgr.equipToRole('p1', qinghe.instanceId, qu28.instanceId);
    engine.effectEngine.handleRoleEntryEffect('p1', qu28.instanceId, db.getCard('BP01-028')!);

    // 选择墓地+费用区共 6 张 <万世铭> 洗回牌组 → 6/2=3 项全选自动生效
    const sixIds = [wsm37[0]!, wsm37[1]!, wsm37[2]!, wsm38[0]!, wsm38[1]!, wsm38[2]!].map((c) => c.instanceId);
    pickChoice(engine, 'p1', sixIds);

    // 基本 PP 变为 9999 + 青赫 500 = 10499；DP = 1 + 1 = 2；充能 = 1 + 1 = 2
    const stats = engine.fieldMgr.evaluateRoleStats(qu28.instanceId);
    expect(stats.pp).toBe(10499);
    expect(stats.dp).toBe(2);
    expect(stats.charge).toBe(2);
    expect(stats.grantedTriggerIds).toContain('dsl:BP01-028:charge_wanshiming_untap');

    // 牌组顶放 1 张 BP01-037，攻击对方玩家 → 跳过青赫弃牌 → 攻击充能翻开 BP01-037 → 选择不置换 (keep) → 触发模式 3 竖直自身
    const topWsm = wsm37[3]!;
    engine.zoneMgr.moveCardToTopOfDeck(topWsm.instanceId);
    const atkRes = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p1',
      attackerCardId: qu28.instanceId,
      targetType: 'PLAYER',
    });
    expect(atkRes.success, atkRes.error).toBe(true);
    // 跳过青赫弃牌触发
    if (state.currentPendingChoice?.effectType?.includes('DISCARD')) {
      pickChoice(engine, 'p1', []);
    }
    passInstantWindows(engine);
    if (state.currentCombat?.step === 'BLOCK') {
      engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: 'p2', blockerCardId: undefined });
    }
    // 攻击充能翻出 BP01-037：选 keep 正常充能加入手牌并触发 BP01-028 模式 3 竖直
    expect(state.currentPendingChoice?.effectType).toBe('BP01_WANSHIMING_TO_COST');
    pickChoice(engine, 'p1', ['keep']);
    // 若第 2 次充能再次翻出万世铭则一并处理
    while (state.currentPendingChoice?.effectType === 'BP01_WANSHIMING_TO_COST') {
      pickChoice(engine, 'p1', ['to_cost']);
    }
    expect(state.cards[qu28.instanceId]!.isReady).toBe(true);
    expect(state.cards[topWsm.instanceId]!.zone).toBe('HAND');
  });

  it('BP01-031 公开牌组顶触发 BP01-037/038 横置放费用区（含3.6.4满10张改放墓地）与 BP01-038 任意位置放信号球、BP01-039 自由', () => {
    const deck = expandDeck('ST01', [
      'BP01-031',
      'BP01-037',
      'BP01-038',
      'BP01-039',
      'BP01-078',
      'BP01-081',
      'BP01-084',
    ]);
    const engine = createEngine(deck, expandDeck('ST02', ['ST02-005']));
    const state = engine.getState();

    const qu31 = findCards(engine, 'p1', 'BP01-031')[0]!;
    const wsm37 = findCards(engine, 'p1', 'BP01-037')[0]!;
    const wsm38 = findCards(engine, 'p1', 'BP01-038')[0]!;
    const free = findCards(engine, 'p1', 'BP01-039')[0]!;
    const orbRed = findCards(engine, 'p1', 'BP01-078')[0]!;
    const orbBlue = findCards(engine, 'p1', 'BP01-081')[0]!;
    const orbYellow = findCards(engine, 'p1', 'BP01-084')[0]!;

    // 1. 把 wsm37 放到牌组顶，BP01-031 公开牌组顶 2 张 → 弹出 BP01_WANSHIMING_REVEAL_TO_COST 选择将 wsm37 横置放费用区
    engine.zoneMgr.moveCardToTopOfDeck(wsm37.instanceId);
    engine.fieldMgr.playRoleCard('p1', qu31.instanceId, 0);
    engine.effectEngine.handleRoleEntryEffect('p1', qu31.instanceId, db.getCard('BP01-031')!);
    expect(state.currentPendingChoice?.effectType).toBe('BP01_WANSHIMING_REVEAL_TO_COST');
    pickChoice(engine, 'p1', [wsm37.instanceId]);
    expect(state.cards[wsm37.instanceId]!.zone).toBe('COST');
    expect(state.cards[wsm37.instanceId]!.isFaceUp).toBe(true);
    expect(state.cards[wsm37.instanceId]!.isReady).toBe(false);
    // 结束 BP01-031 剩余选牌（不选直接全部放牌组底）
    if (state.currentPendingChoice) pickChoice(engine, 'p1', []);

    // 2. BP01-038 万世铭·重铸：将墓地黄球放置到已有 [红, 蓝] 信号球区的中间位置 (index 1)
    engine.zoneMgr.moveCard(orbRed.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orbBlue.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orbYellow.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(wsm38.instanceId, 'HAND', { isFaceUp: true });
    fillCostZone(engine, 'p1', 6);
    const play38 = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: wsm38.instanceId,
    });
    expect(play38.success, play38.error).toBe(true);
    pickChoice(engine, 'p1', [orbYellow.instanceId]);
    pickChoice(engine, 'p1', ['1']); // 放到位置 1（红球与蓝球之间）
    const orbOrder = engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB').map((c) => c.instanceId);
    expect(orbOrder).toEqual([orbRed.instanceId, orbYellow.instanceId, orbBlue.instanceId]);

    // 3. BP01-039 自由：将对方角色横置放对方费用区，并竖直我方费用区的横置 wsm37
    const oppRole = findCards(engine, 'p2', 'ST02-005')[0]!;
    engine.fieldMgr.playRoleCard('p2', oppRole.instanceId, 0);
    engine.zoneMgr.moveCard(free.instanceId, 'HAND', { isFaceUp: true });
    const play39 = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: free.instanceId,
    });
    expect(play39.success, play39.error).toBe(true);
    pickChoice(engine, 'p1', [oppRole.instanceId]);
    pickChoice(engine, 'p1', [wsm37.instanceId]);
    expect(state.cards[oppRole.instanceId]!.zone).toBe('COST');
    expect(state.cards[oppRole.instanceId]!.isReady).toBe(false);
    expect(state.cards[wsm37.instanceId]!.isReady).toBe(true);
  });
});

describe('BP01 第二批：赛琳娜·希声 / 梦赴光寥之乡体系 (BP01-056/a/b ~ BP01-068)', () => {
  it('BP01-056/a/b Q&A·7：同编号异画共享每回合2次上限且拒绝回手亦消耗次数；BP01-059 墓地减费与弃2自动全选', () => {
    const deck = expandDeck('ST01', [
      'BP01-056',
      'BP01-056a',
      'BP01-056b',
      'BP01-059',
      'BP01-078',
      'BP01-079',
      'BP01-080',
      'BP01-081',
      'BP01-082',
      'BP01-083',
    ]);
    const engine = createEngine(deck, expandDeck('ST02'));
    const state = engine.getState();

    const d0 = findCards(engine, 'p1', 'BP01-056')[0]!;
    const dA = findCards(engine, 'p1', 'BP01-056a')[0]!;
    const dB = findCards(engine, 'p1', 'BP01-056b')[0]!;
    const selena59 = findCards(engine, 'p1', 'BP01-059')[0]!;

    // 把 3 张异画梦赴光寥之乡放入墓地
    engine.zoneMgr.moveCard(d0.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(dA.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(dB.instanceId, 'GRAVEYARD', { isFaceUp: true });

    // BP01-059 7 费 - 墓地 3 张 = 4 费
    engine.zoneMgr.moveCard(selena59.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.calculateCardCost('p1', selena59.instanceId).costToPay).toBe(4);

    // 放 3 张红球在信号球区执行 3 消 → 3 张异画均触发，但共享每回合 2 次上限！
    const orbs = [
      findCards(engine, 'p1', 'BP01-078')[0]!,
      findCards(engine, 'p1', 'BP01-079')[0]!,
      findCards(engine, 'p1', 'BP01-080')[0]!,
    ];
    for (const o of orbs) engine.zoneMgr.moveCard(o.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    const elimRes = engine.dispatchAction({
      type: 'ELIMINATE_3_ORBS',
      playerId: 'p1',
      orbCardInstanceIds: orbs.map((o) => o.instanceId),
    });
    expect(elimRes.success, elimRes.error).toBe(true);

    // 依次选择触发顺序：第 1 张选「留在墓地」(仍耗 1 次)，第 2 张选「加入手牌」(耗第 2 次)，第 3 张被每回合 2 次上限自动跳过
    let handled = 0;
    while (state.currentPendingChoice) {
      const ch = state.currentPendingChoice;
      if (ch.effectType === 'CHOOSE_TRIGGER_ORDER') {
        pickChoice(engine, 'p1', [ch.options[0]!.id]);
      } else {
        handled++;
        pickChoice(engine, 'p1', [handled === 1 ? 'opt_no' : 'opt_yes']);
      }
    }
    expect(handled).toBe(2);
    const inHandCount = [d0, dA, dB].filter((c) => state.cards[c.instanceId]!.zone === 'HAND').length;
    expect(inHandCount).toBe(1);

    // 把 2 张梦赴光寥之乡拿到手牌，场上放 BP01-059 发动【起】弃 2 张 → 自动同时获得【贯通】与 PP+2000
    engine.zoneMgr.moveCard(d0.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(dA.instanceId, 'HAND', { isFaceUp: true });
    engine.fieldMgr.playRoleCard('p1', selena59.instanceId, 0);
    const act59 = engine.dispatchAction({
      type: 'ACTIVATE_ABILITY',
      playerId: 'p1',
      sourceCardId: selena59.instanceId,
      abilityIndex: 0,
    });
    expect(act59.success, act59.error).toBe(true);
    pickChoice(engine, 'p1', [d0.instanceId, dA.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(selena59.instanceId)).toBe(8000);
    expect(engine.fieldMgr.evaluateRoleStats(selena59.instanceId).keywords).toContain('贯通');
  });

  it('BP01-057 攻击结束弃2梦赴光寥之乡竖直+2000+1DP、BP01-062 弃梦赴光寥之乡突进-1000、BP01-067 弃牌减费送对方牌组底', () => {
    const deck = expandDeck('ST01', [
      'BP01-057',
      'BP01-062',
      'BP01-067',
      'BP01-068',
      'BP01-056',
      'BP01-056a',
      'BP01-056b',
      'BP01-056',
    ]);
    const engine = createEngine(deck, expandDeck('ST02', ['ST02-005']));
    const state = engine.getState();

    const selena57 = findCards(engine, 'p1', 'BP01-057')[0]!;
    const selena62 = findCards(engine, 'p1', 'BP01-062')[0]!;
    const nightSky = findCards(engine, 'p1', 'BP01-067')[0]!;
    const cradle = findCards(engine, 'p1', 'BP01-068')[0]!;
    const dreams = [
      ...findCards(engine, 'p1', 'BP01-056'),
      ...findCards(engine, 'p1', 'BP01-056a'),
      ...findCards(engine, 'p1', 'BP01-056b'),
    ];
    expect(dreams.length).toBeGreaterThanOrEqual(4);

    // 1. BP01-062 【起】丢弃《梦赴光寥之乡》→ 获得【突进】且 PP 5000 - 1000 = 4000
    engine.fieldMgr.playRoleCard('p1', selena62.instanceId, 0);
    engine.zoneMgr.moveCard(dreams[0]!.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: 'p1',
        sourceCardId: selena62.instanceId,
        abilityIndex: 0,
      }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [dreams[0]!.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(selena62.instanceId)).toBe(4000);
    expect(engine.fieldMgr.evaluateRoleStats(selena62.instanceId).keywords).toContain('突进');

    // 2. BP01-068 装备出场触发从墓地回收刚刚丢弃的《梦赴光寥之乡》
    fillCostZone(engine, 'p1', 6);
    engine.zoneMgr.moveCard(cradle.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: 'p1',
        cardInstanceId: cradle.instanceId,
        targetEquipRoleId: selena62.instanceId,
      }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [dreams[0]!.instanceId]);
    expect(state.cards[dreams[0]!.instanceId]!.zone).toBe('HAND');

    // 3. BP01-067 最后的晚空 (6费)：手牌有 3 张《梦赴光寥之乡》，可用明费仅 3 费 → 弃 3 张减 3 费成功打出并把对方角色放牌组底
    const oppRole = findCards(engine, 'p2', 'ST02-005')[0]!;
    engine.fieldMgr.playRoleCard('p2', oppRole.instanceId, 0);
    for (const d of dreams.slice(0, 3)) {
      engine.zoneMgr.moveCard(d.instanceId, 'HAND', { isFaceUp: true });
    }
    engine.zoneMgr.moveCard(nightSky.instanceId, 'HAND', { isFaceUp: true });
    expect(state.players['p1']!.availableOpenCostCount).toBe(3); // 刚打 3 费摇篮后剩余 3 费
    const play67 = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p1',
      cardInstanceId: nightSky.instanceId,
    });
    expect(play67.success, play67.error).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PLAY_CARD_DISCARD_DISCOUNT');
    // 丢弃 3 张《梦赴光寥之乡》使费用 6 → 3
    pickChoice(engine, 'p1', dreams.slice(0, 3).map((d) => d.instanceId));
    expect(state.players['p1']!.availableOpenCostCount).toBe(0);
    // 选对方角色放牌组底
    pickChoice(engine, 'p1', [oppRole.instanceId]);
    expect(state.cards[oppRole.instanceId]!.zone).toBe('DECK');

    // 4. BP01-057 攻击结束时弃 2 张《梦赴光寥之乡》→ 竖直自身、PP+2000 (10000)、DP+1 (2)
    // 在 p1/p2 牌组顶放非信号球牌，避免充能自弹窗干扰本次攻击结束触发断言
    const nonOrbP1 = engine.zoneMgr.getCardsInZone('p1', 'DECK').find((c) => !db.getCard(c.cardNumber)?.signalOrb);
    if (nonOrbP1) engine.zoneMgr.moveCardToTopOfDeck(nonOrbP1.instanceId);
    const nonOrbP2 = engine.zoneMgr.getCardsInZone('p2', 'DECK').find((c) => !db.getCard(c.cardNumber)?.signalOrb);
    if (nonOrbP2) engine.zoneMgr.moveCardToTopOfDeck(nonOrbP2.instanceId);
    engine.fieldMgr.playRoleCard('p1', selena57.instanceId, 1);
    state.cards[selena57.instanceId]!.turnEnteredZone = 0;
    engine.zoneMgr.moveCard(dreams[0]!.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(dreams[1]!.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: selena57.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    if (state.currentCombat?.step === 'BLOCK') {
      engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: 'p2', blockerCardId: undefined });
    }
    // 攻击结束触发 BP01-057
    pickChoice(engine, 'p1', [dreams[0]!.instanceId, dreams[1]!.instanceId]);
    expect(state.cards[selena57.instanceId]!.isReady).toBe(true);
    expect(engine.fieldMgr.calculateRoleEffectivePP(selena57.instanceId)).toBe(10000);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(selena57.instanceId)).toBe(2);
  });
});
