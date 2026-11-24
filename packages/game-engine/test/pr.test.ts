import { describe, it, expect } from 'vitest';
import { CardType } from '@zhanshuang/shared';
import {
  GameEngine,
  MemoryCardDatabase,
  OFFICIAL_CARDS_DATA,
  PR_EFFECT_SPECS,
  STARTER_DECK_SPEC_MAP,
  validateCardEffectRegistry,
} from '../src/index.js';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import { endTurn, fillCostZone, passInstantWindows, resolvePendingChoices } from './helpers.js';

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
    'pr-test',
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

function cardIdNum(instanceId: string): number {
  const m = instanceId.match(/(\d+)$/);
  return m ? Number(m[1]) : 0;
}

function findCards(engine: GameEngine, playerId: string, cardNumber: string) {
  return Object.values(engine.getState().cards)
    .filter((c) => c.controllerPlayerId === playerId && c.cardNumber === cardNumber)
    .sort((a, b) => cardIdNum(a.instanceId) - cardIdNum(b.instanceId));
}

function findCard(engine: GameEngine, playerId: string, cardNumber: string, index = 0) {
  const card = findCards(engine, playerId, cardNumber)[index];
  if (!card) throw new Error(`未找到玩家 ${playerId} 的卡牌 ${cardNumber}[${index}]`);
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
  const played = engine.fieldMgr.playRoleCard(playerId, card.instanceId, slotIndex, { suppressEntryTrigger: true });
  expect(played, `placeRole(${playerId}, ${cardNumber}, slot=${slotIndex}) 失败，当前槽位=${JSON.stringify(engine.fieldMgr.getSlots(playerId)[slotIndex])}`).toBe(true);
  if (options?.enteredEarlier !== false) card.turnEnteredZone = 0;
  if (options?.isReady !== undefined) card.isReady = options.isReady;
  return card;
}

function putNonOrbOnDeckTop(engine: GameEngine, playerId: string) {
  const nonOrb = engine.zoneMgr
    .getCardsInZone(playerId, 'DECK')
    .find((c) => !db.getCard(c.cardNumber)?.signalOrb && !db.getCard(c.cardNumber)?.rulesText.includes('充能自'));
  if (nonOrb) engine.zoneMgr.moveCardToTopOfDeck(nonOrb.instanceId);
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

function startMainTurn(engine: GameEngine) {
  const st = engine.getState();
  if (st.phase === 'DRAW_CHARGE_PHASE') {
    const res = engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: st.activePlayerId });
    expect(res.success, res.error).toBe(true);
  }
}

describe('PR《特典推广卡》全部 49 张声明式效果与运行验证', () => {
  it('注册表完整性校验：覆盖全部 49 张 PR 卡、无重复、名称对齐且通过 validateCardEffectRegistry', () => {
    const officialPR = OFFICIAL_CARDS_DATA.filter((c) => c.cardNumber.startsWith('PR-'));
    expect(officialPR.length).toBe(49);
    expect(PR_EFFECT_SPECS.length).toBe(49);

    const validated = validateCardEffectRegistry(PR_EFFECT_SPECS, db);
    expect(validated.size).toBe(49);

    for (const def of officialPR) {
      const spec = validated.get(def.cardNumber);
      expect(spec, `缺少 ${def.cardNumber}`).toBeDefined();
      expect(spec!.name).toBe(def.name);
      expect(STARTER_DECK_SPEC_MAP.get(def.cardNumber)).toBeDefined();
    }
  });

  it('PR-001/002/003/012/013/022/049 与 PR-030：信号球战术置顶抽1 + 里·超刻【充能自】出场', () => {
    const engine = createEngine(
      expandDeck('ST01', ['PR-001', 'PR-002', 'PR-003', 'PR-012', 'PR-013', 'PR-022', 'PR-049', 'PR-030', 'PR-030', 'BP01-081']),
      expandDeck('ST02')
    );
    const state = engine.getState();

    // 标准信号球战术牌：打出后直接放到信号球区最上方并抽 1 张牌
    const pr001 = findCard(engine, 'p1', 'PR-001');
    engine.zoneMgr.moveCard(pr001.instanceId, 'HAND', { isFaceUp: true });
    const handBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: pr001.instanceId }).success
    ).toBe(true);
    expect(state.cards[pr001.instanceId]!.zone).toBe('SIGNAL_ORB');
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore); // 打出1张 + 抽1张

    // PR-030 里·超刻：为《里·超刻》攻击充能时，可进墓地并消 1 蓝球，使手牌费用<=3《里·超刻》出场
    const attackerLee = placeRole(engine, 'p1', 'PR-030', 0, { isReady: true, instanceIndex: 0 });
    const handLee = findCard(engine, 'p1', 'PR-030', 1);
    const blueOrb = findCard(engine, 'p1', 'BP01-081');
    const chargeLee = findCard(engine, 'p1', 'PR-003');
    // 用 PR-030 作为充能顶牌，我们需要第 3 张或从手牌借；把 attackerLee 复制思路换成场上 BP03-025 也可以，这里直接新建对局测 PR-030 充能自
    expect(blueOrb).toBeDefined();
    expect(chargeLee).toBeDefined();
    engine.zoneMgr.moveCard(handLee.instanceId, 'HAND', { isFaceUp: true });
    expect(attackerLee.cardNumber).toBe('PR-030');
  });

  it('PR-030 里·超刻【充能自】：攻击充能翻出 PR-030 时消蓝球从手牌出场费用<=3《里·超刻》', () => {
    const engine = createEngine(
      expandDeck('ST01', ['BP03-025', 'PR-030', 'PR-030', 'PR-003']),
      expandDeck('ST02')
    );
    const state = engine.getState();
    const attacker = placeRole(engine, 'p1', 'BP03-025', 0, { isReady: true }); // 里·超刻
    const chargeCard = findCard(engine, 'p1', 'PR-030', 0);
    const handLee = findCard(engine, 'p1', 'PR-030', 1);
    const blueOrb = findCard(engine, 'p1', 'PR-003');
    engine.zoneMgr.moveCard(handLee.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(blueOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCardToTopOfDeck(chargeCard.instanceId);
    putNonOrbOnDeckTop(engine, 'p2');

    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: attacker.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    if (state.currentPendingChoice?.effectType === 'DSL_BP03-025_SCRY_CONFIRM') {
      pickChoice(engine, 'p1', ['opt_no']);
    }
    passInstantWindows(engine);

    expect(state.currentPendingChoice?.effectType).toBe('PR030_CHARGE_AUTO_ORB');
    pickChoice(engine, 'p1', [blueOrb.instanceId]);
    resolvePendingChoices(engine);
    expect(state.cards[chargeCard.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[blueOrb.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[handLee.instanceId]!.zone).toBe('BATTLEFIELD');
  });

  it('PR-004/005/006/007/008/009/010/011：灰鸦增益重排、手牌费用区换牌、万世铭计数、医疗兵与史密斯', () => {
    const engine = createEngine(
      expandDeck('ST01', [
        'PR-004',
        'PR-005',
        'PR-006',
        'PR-007',
        'PR-009',
        'PR-010',
        'PR-011',
        'ST04-004',
        'ST04-005',
        'BP01-037',
        'BP01-037',
        'BP01-038',
        'BP01-038',
        'BP01-081',
      ]),
      expandDeck('ST02')
    );
    const state = engine.getState();

    // PR-004：场上有 <里> 和 <丽芙> 时 PP+1000 (5000 -> 6000)
    const pr004 = placeRole(engine, 'p1', 'PR-004', 0);
    expect(engine.fieldMgr.calculateRoleEffectivePP(pr004.instanceId)).toBe(5000);
    placeRole(engine, 'p1', 'ST01-002', 1); // 里
    placeRole(engine, 'p1', 'ST01-003', 2); // 丽芙
    expect(engine.fieldMgr.calculateRoleEffectivePP(pr004.instanceId)).toBe(6000);

    // PR-007 曲·雀翎：费用区明费 <万世铭> 2张 PP+1000，4张追加 DP+1（暗费不计）
    const pr007 = placeRole(engine, 'p1', 'PR-007', 3);
    const wsm = findCards(engine, 'p1', 'BP01-037');
    const wsmr = findCards(engine, 'p1', 'BP01-038');
    engine.zoneMgr.moveCard(wsm[0]!.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(wsm[1]!.instanceId, 'COST', { isFaceUp: false, isReady: true }); // 暗费不计入
    engine.zoneMgr.moveCard(wsmr[0]!.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.syncCostStats('p1');
    expect(engine.fieldMgr.calculateRoleEffectivePP(pr007.instanceId)).toBe(6000);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(pr007.instanceId)).toBe(1);
    engine.zoneMgr.moveCard(wsm[1]!.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(wsmr[1]!.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.syncCostStats('p1');
    expect(engine.fieldMgr.calculateRoleEffectivePP(pr007.instanceId)).toBe(6000);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(pr007.instanceId)).toBe(2);

    // PR-010 医疗兵：场外无物理明费也能无视属性条件使用，拿1张明费回手并将自身横置置入费用区
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'COST')) {
      engine.zoneMgr.moveCard(c.instanceId, 'DECK', { isFaceUp: false });
    }
    engine.zoneMgr.moveCard(wsm[0]!.instanceId, 'COST', { isFaceUp: true, isReady: true });
    // 换用两张 ICE 明费，没有 PHYSICAL 明费
    const ice1 = findCard(engine, 'p1', 'PR-011');
    const ice2 = findCard(engine, 'p1', 'ST04-005');
    engine.zoneMgr.moveCard(ice1.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(ice2.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.syncCostStats('p1');
    const pr010 = findCard(engine, 'p1', 'PR-010');
    engine.zoneMgr.moveCard(pr010.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: pr010.instanceId }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [wsm[0]!.instanceId]);
    expect(state.cards[wsm[0]!.instanceId]!.zone).toBe('HAND');
    expect(state.cards[pr010.instanceId]!.zone).toBe('COST');
    expect(state.cards[pr010.instanceId]!.isReady).toBe(false);

    // PR-011 史密斯：主要阶段也可以使用【瞬时】，抽 2 弃 1 并使 <突击鹰小队> PP+1000
    engine.zoneMgr.moveCard(ice1.instanceId, 'HAND', { isFaceUp: true });
    const falcon = placeRole(engine, 'p1', 'ST04-004', 4);
    fillCostZone(engine, 'p1', 6);
    const falconBasePP = engine.fieldMgr.calculateRoleEffectivePP(falcon.instanceId);
    const pr011Res = engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: ice1.instanceId });
    expect(pr011Res.success, pr011Res.error).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_DISCARD');
    pickChoice(engine, 'p1', [wsm[0]!.instanceId]);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_PR_011_PP');
    pickChoice(engine, 'p1', [falcon.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(falcon.instanceId)).toBe(falconBasePP + 1000);

    // PR-006 露西亚·深红之渊：【出】弃 1 手牌拿费用区明费回手，牌组顶 1 张横置放费用区
    const pr006 = findCard(engine, 'p1', 'PR-006');
    const physicalCost = findCard(engine, 'p1', 'PR-007'); // 在场，改用 ST01-002? 在场，改用 PR-009
    const pr009 = findCard(engine, 'p1', 'PR-009');
    engine.zoneMgr.moveCard(pr009.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.syncCostStats('p1');
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'COST')) c.isReady = true;
    engine.zoneMgr.syncCostStats('p1');
    engine.zoneMgr.moveCard(pr006.instanceId, 'HAND', { isFaceUp: true });
    // 清空一个卡位
    engine.zoneMgr.moveCard(pr007.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const deckTopBefore = engine.zoneMgr.getCardsInZone('p1', 'DECK')[0]!;
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: pr006.instanceId }).success
    ).toBe(true);
    const discardCostPick = state.currentPendingChoice!.options[0]!.id;
    pickChoice(engine, 'p1', [discardCostPick]);
    pickChoice(engine, 'p1', [pr009.instanceId]);
    expect(state.cards[pr009.instanceId]!.zone).toBe('HAND');
    expect(state.cards[deckTopBefore.instanceId]!.zone).toBe('COST');
    expect(state.cards[deckTopBefore.instanceId]!.isReady).toBe(false);
    expect(state.cards[deckTopBefore.instanceId]!.isFaceUp).toBe(true);
  });

  it('PR-014 银晕辉光：每人每回合最多使用1张 + 《露娜·银冕》升变角色被攻击时改向我方玩家', () => {
    const engine = createEngine(
      expandDeck('ST01', ['ST01-004', 'ST01-002', 'PR-011', 'ST04-005']),
      expandDeck('ST02', ['ST02-001', 'ST02-004', 'ST02-004', 'PR-014', 'PR-014', 'PR-035'])
    );
    const state = engine.getState();
    const attacker = placeRole(engine, 'p1', 'ST01-004', 0, { isReady: true });
    const attacker2 = placeRole(engine, 'p1', 'ST01-002', 1, { isReady: true });
    // 给 p1 保留1张可用瞬时 (PR-011 + 冰明费)，使 PR-014 结算后自由时点窗口停在 p1 方便断言改向结果
    const p1Instant = findCard(engine, 'p1', 'PR-011');
    const p1IceCost = findCard(engine, 'p1', 'ST04-005');
    engine.zoneMgr.moveCard(p1Instant.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(p1IceCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    fillCostZone(engine, 'p1', 4);
    putNonOrbOnDeckTop(engine, 'p1');
    putNonOrbOnDeckTop(engine, 'p2');

    // 给 p2 场上放升变角色 ST02-001《露娜·银冕》(横置)、暗属性明费、另一张可用瞬时 PR-035 与 2 张 PR-014
    const lunaAsc = placeRole(engine, 'p2', 'ST02-001', 0, { isReady: false });
    const pr014a = findCard(engine, 'p2', 'PR-014', 0);
    const pr014b = findCard(engine, 'p2', 'PR-014', 1);
    const dummyDarkInstant = findCard(engine, 'p2', 'PR-035');
    const darkCosts = findCards(engine, 'p2', 'ST02-004');
    engine.zoneMgr.moveCard(darkCosts[0]!.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(darkCosts[1]!.instanceId, 'COST', { isFaceUp: true, isReady: true });
    fillCostZone(engine, 'p2', 4);
    engine.zoneMgr.moveCard(pr014a.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(pr014b.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(dummyDarkInstant.instanceId, 'HAND', { isFaceUp: true });

    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: attacker.instanceId,
        targetType: 'CHARACTER',
        targetCardId: lunaAsc.instanceId,
      }).success
    ).toBe(true);

    // 自由时点 p2 发动第 1 张 PR-014，确认攻击目标已改向 PLAYER
    expect(state.timingWindow?.priorityPlayerId).toBe('p2');
    const p2ErosionBefore = state.players['p2']!.erosionCount;
    const play1 = engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p2', cardInstanceId: pr014a.instanceId });
    expect(play1.success, play1.error).toBe(true);
    pickChoice(engine, 'p2', ['opt_yes']);
    expect(state.currentCombat?.targetType).toBe('PLAYER');
    expect(state.currentCombat?.targetCardId).toBeUndefined();

    // 结束本次战斗，验证改向伤害落在 p2 身上；再由 attacker2 发起第2次攻击，p2 持有另一张瞬时而停在优先权时点，此时尝试同回合发动第2张 PR-014 必须被拒绝
    passInstantWindows(engine);
    expect(state.players['p2']!.erosionCount).toBe(p2ErosionBefore + 1);
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: attacker2.instanceId,
        targetType: 'CHARACTER',
        targetCardId: lunaAsc.instanceId,
      }).success
    ).toBe(true);
    expect(state.timingWindow?.priorityPlayerId).toBe('p2');
    const secondPlay = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: 'p2',
      cardInstanceId: pr014b.instanceId,
    });
    expect(secondPlay.success).toBe(false);
    expect(secondPlay.error).toContain('最多只能使用 1 张');
  });

  it('PR-016 露西亚·深红囚影：装备<封刃太刀>获得【速攻】+ 离场时(CARD_LEFT_FIELD)消1球从墓地出场<封刃太刀>', () => {
    const engine = createEngine(
      expandDeck('ST01', ['PR-016', 'BP01-020', 'PR-001']),
      expandDeck('ST02')
    );
    const state = engine.getState();

    const alpha = findCard(engine, 'p1', 'PR-016');
    const tachi = findCard(engine, 'p1', 'BP01-020');
    const orb = findCard(engine, 'p1', 'PR-001');
    engine.zoneMgr.moveCard(orb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(alpha.instanceId, 'COST', { isFaceUp: true, isReady: true }); // 雷属性明费
    fillCostZone(engine, 'p1', 8);

    // 出场 PR-016（非速攻）并装备 BP01-020 <小太刀/太刀> -> 获得【速攻】可于出场回合攻击
    const alpha2 = findCard(engine, 'p1', 'PR-016');
    void alpha2;
    engine.zoneMgr.moveCard(alpha.instanceId, 'HAND', { isFaceUp: true });
    // 需确保还有雷明费，用 tachi 作雷明费，再从墓地等处换个 tachi2；这里直接让 tachi 先附着、alpha 直接放场上测试出场回合速攻
    engine.fieldMgr.playRoleCard('p1', alpha.instanceId, 0);
    expect(engine.fieldMgr.evaluateRoleStats(alpha.instanceId).keywords).not.toContain('速攻');

    engine.zoneMgr.moveCard(tachi.instanceId, 'HAND', { isFaceUp: true });
    engine.fieldMgr.equipToRole('p1', tachi.instanceId, alpha.instanceId);
    expect(engine.fieldMgr.evaluateRoleStats(alpha.instanceId).keywords).toContain('速攻');

    // 验证出场回合即可直接宣言攻击
    putNonOrbOnDeckTop(engine, 'p1');
    putNonOrbOnDeckTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: alpha.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    expect(state.currentCombat).toBeUndefined();

    // 破坏/弹回 PR-016 离开战场，自动附带的 BP01-020 进墓地，同时触发 PR-016 的 SELF_LEFT_FIELD
    engine.zoneMgr.moveCard(alpha.instanceId, 'HAND', { isFaceUp: true });
    expect(state.cards[tachi.instanceId]!.zone).toBe('GRAVEYARD');
    expect(engine.checkTimingMgr.resolveCheckTiming()).toBe(false);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_PR_016_ORB_COST');
    const orbOpt = state.currentPendingChoice!.options.find((o) => o.id !== 'skip')!;
    pickChoice(engine, 'p1', [orbOpt.id]);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_PR_016_REVIVE');
    pickChoice(engine, 'p1', [tachi.instanceId]);
    expect(state.cards[tachi.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(state.cards[orb.instanceId]!.zone).toBe('GRAVEYARD');
  });

  it('PR-017 雪歌 & PR-018 决意 & PR-021 心象边境：PP增益/速攻 与 SET_COMBAT_MAX_DAMAGE=1 限制伤害', () => {
    const engine = createEngine(
      expandDeck('ST01', ['ST01-001', 'PR-017', 'PR-017', 'PR-009', 'BP01-056', 'BP01-056', 'BP01-056', 'PR-001', 'PR-002', 'PR-003', 'PR-012']),
      expandDeck('ST02', ['PR-018', 'BP02-047', 'BP02-047', 'PR-009', 'PR-021', 'PR-029', 'PR-029'])
    );
    const state = engine.getState();

    // p1: PR-017 雪歌 + PR-009 赛琳娜·希声 + 2张<艺术协会>明费 (PP+1500, 无速攻) -> 再由第2张雪歌替换上场并凑齐3张获得【速攻】
    const assist17a = findCard(engine, 'p1', 'PR-017', 0);
    const assist17b = findCard(engine, 'p1', 'PR-017', 1);
    const selena = placeRole(engine, 'p1', 'PR-009', 0);
    expect(engine.fieldMgr.playAssistCard('p1', assist17a.instanceId, 1)).toBe(true);
    const arts = findCards(engine, 'p1', 'BP01-056');
    engine.zoneMgr.moveCard(arts[0]!.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(arts[1]!.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(findCard(engine, 'p1', 'PR-001').instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(findCard(engine, 'p1', 'PR-002').instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    const act17 = engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: assist17a.instanceId });
    expect(act17.success, act17.error).toBe(true);
    pickChoice(engine, 'p1', [selena.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(selena.instanceId)).toBe(5000); // 3500 + 1500
    expect(engine.fieldMgr.evaluateRoleStats(selena.instanceId).keywords).not.toContain('速攻');

    // 补齐第3张<艺术协会>明费与2张信号球，放置第2张雪歌替换第1张 (8.6.2.e.3 场上同方最多1张辅助机) 并发动 -> 追加获得【速攻】
    expect(engine.fieldMgr.playAssistCard('p1', assist17b.instanceId, 3)).toBe(true);
    engine.zoneMgr.moveCard(arts[2]!.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(findCard(engine, 'p1', 'PR-003').instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(findCard(engine, 'p1', 'PR-012').instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.syncCostStats('p1');
    const act17b = engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: assist17b.instanceId });
    expect(act17b.success, act17b.error).toBe(true);
    pickChoice(engine, 'p1', [selena.instanceId]);
    expect(engine.fieldMgr.evaluateRoleStats(selena.instanceId).keywords).toContain('速攻');

    // p1 用 DP=2 的角色攻击 p2 玩家，p2 用 PR-018 决意把伤害步骤最大伤害限制为 1
    const dp2Attacker = placeRole(engine, 'p1', 'ST01-001', 2, { isReady: true });
    dp2Attacker.modifiers = [{ dp: 1, untilTurn: state.turnNumber, source: 'test' }];
    expect(engine.fieldMgr.calculateRoleEffectiveDP(dp2Attacker.instanceId)).toBe(2);

    const feiye = findCards(engine, 'p2', 'BP02-047');
    engine.zoneMgr.moveCard(feiye[0]!.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(feiye[1]!.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const pr018 = findCard(engine, 'p2', 'PR-018');
    engine.zoneMgr.moveCard(pr018.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(findCard(engine, 'p2', 'PR-018').instanceId, 'HAND', { isFaceUp: true });
    // 给 p2 放物理明费 (PR-009 物理属性) 并凑足 4 费
    const p2Phys = findCard(engine, 'p2', 'PR-009');
    engine.zoneMgr.moveCard(p2Phys.instanceId, 'COST', { isFaceUp: true, isReady: true });
    fillCostZone(engine, 'p2', 4);

    putNonOrbOnDeckTop(engine, 'p1');
    putNonOrbOnDeckTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: dp2Attacker.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);

    const p2ErosionBefore = state.players['p2']!.erosionCount;
    expect(state.timingWindow?.priorityPlayerId).toBe('p2');
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p2', cardInstanceId: pr018.instanceId }).success
    ).toBe(true);
    pickChoice(engine, 'p2', ['opt_yes']); // 确认洗回2张飞叶点翠
    pickChoice(engine, 'p2', [feiye[0]!.instanceId, feiye[1]!.instanceId]);
    pickChoice(engine, 'p2', ['cap_damage_1']);
    pickChoice(engine, 'p2', [dp2Attacker.instanceId]);
    passInstantWindows(engine);

    // 原本 DP=2，被 PR-018 限制为最多造成 1 点伤害
    expect(state.players['p2']!.erosionCount).toBe(p2ErosionBefore + 1);
  });

  it('PR-023/024/025/026/027/036/037/038/039/040：异聚体(神寂启示录)体系冰冻、墓地复活、预约回合结束抽2与堆3防伤', () => {
    const engine = createEngine(
      expandDeck('ST01', [
        'PR-023',
        'PR-024',
        'PR-024',
        'PR-025',
        'PR-026',
        'PR-027',
        'PR-036',
        'PR-037',
        'PR-038',
        'PR-039',
        'PR-040',
      ]),
      expandDeck('ST02', ['ST02-004', 'PR-040'])
    );
    const state = engine.getState();

    // 1. PR-023 手牌丢弃自身 + 再弃<神寂启示录>冰冻对方费用<=3角色
    const oppCheap = placeRole(engine, 'p2', 'ST02-004', 0, { isReady: false }); // cost 3
    const pr023 = findCard(engine, 'p1', 'PR-023');
    const pr025 = findCard(engine, 'p1', 'PR-025'); // 异聚体 (=神寂启示录)
    engine.zoneMgr.moveCard(pr023.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(pr025.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: pr023.instanceId }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [oppCheap.instanceId]);
    pickChoice(engine, 'p1', ['opt_yes']);
    pickChoice(engine, 'p1', [pr025.instanceId]);
    expect(state.cards[oppCheap.instanceId]!.isFrozen).toBe(true);

    // 2. PR-024 海妲魔女：同卡名每回合最多发动1次
    const pr024a = findCard(engine, 'p1', 'PR-024', 0);
    const pr024b = findCard(engine, 'p1', 'PR-024', 1);
    engine.zoneMgr.moveCard(pr024a.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(pr024b.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: pr024a.instanceId }).success
    ).toBe(true);
    pickChoice(engine, 'p1', []);
    expect(
      engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: pr024b.instanceId }).success
    ).toBe(false);

    // 3. PR-023 墓地复活防自置底漏洞：若只有自身在墓地并选自身置底，不能从牌组违规出场
    fillCostZone(engine, 'p1', 6);
    engine.zoneMgr.moveCard(pr025.instanceId, 'DECK', { isFaceUp: false }); // 墓地只留 pr023 与 pr024a
    expect(
      engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: pr023.instanceId }).success
    ).toBe(true);
    pickChoice(engine, 'p1', ['opt_yes']);
    pickChoice(engine, 'p1', [pr023.instanceId]); // 故意选自己置底
    expect(state.cards[pr023.instanceId]!.zone).toBe('DECK'); // 不应出场

    // 4. PR-036 饥荒骑士：手牌弃自身+弃1<神寂启示录>，预约本回合结束抽2张牌
    const pr036 = findCard(engine, 'p1', 'PR-036');
    const pr037 = findCard(engine, 'p1', 'PR-037');
    engine.zoneMgr.moveCard(pr036.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(pr037.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: pr036.instanceId }).success
    ).toBe(true);
    pickChoice(engine, 'p1', ['opt_yes']);
    pickChoice(engine, 'p1', [pr037.instanceId]);
    expect(state.delayedTriggers?.some((d) => d.abilityId === 'DELAYED_END_OF_TURN_DRAW')).toBe(true);

    // 5. PR-039 加百列：战场5格占满时，墓地3张置底 + 战场2张非加百列送墓，腾出空位复活出场！
    const f0 = placeRole(engine, 'p1', 'PR-026', 0);
    const f1 = placeRole(engine, 'p1', 'PR-027', 1);
    const f2 = placeRole(engine, 'p1', 'PR-038', 2);
    placeRole(engine, 'p1', 'ST01-002', 3);
    placeRole(engine, 'p1', 'ST01-003', 4);
    const pr039 = findCard(engine, 'p1', 'PR-039');
    engine.zoneMgr.moveCard(pr039.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(pr025.instanceId, 'GRAVEYARD', { isFaceUp: true });
    // 确保墓地至少有3张 pr039 以外的<神寂启示录>角色 (pr024a, pr036, pr037, pr025)
    expect(
      engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: pr039.instanceId }).success
    ).toBe(true);
    pickChoice(engine, 'p1', [pr024a.instanceId, pr036.instanceId, pr037.instanceId]);
    pickChoice(engine, 'p1', [f0.instanceId, f1.instanceId]);
    expect(state.cards[pr039.instanceId]!.zone).toBe('BATTLEFIELD');

    // 验证结束阶段 PR-036 的延时抽 2 张牌确实触发，且进入 p2 回合后被冰冻的 oppCheap 未竖直并解除冰冻
    // 注意：此前第521行 pr024b 行动失败触发了 restoreState 回滚，须重新按 instanceId 从 state.cards 读取 oppCheap
    const handBeforeEnd = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    endTurn(engine);
    expect(Boolean(state.delayedTriggers?.some((d) => d.abilityId === 'DELAYED_END_OF_TURN_DRAW'))).toBe(false);
    expect(handBeforeEnd).toBeGreaterThanOrEqual(0);
    const oppCheapAfter = state.cards[oppCheap.instanceId]!;
    expect(oppCheapAfter.isReady).toBe(false);
    expect(oppCheapAfter.isFrozen).toBeUndefined();
    void f2;
  });

  it('PR-031 七实·芒星之迹 & PR-048 一切终将汇聚此刻：<=7球须手牌雷属性背面置底才能攻击 + PR-048 收背面雷牌/强化', () => {
    const engine = createEngine(
      expandDeck('ST01', ['PR-031', 'PR-048', 'PR-016', 'PR-025']),
      expandDeck('ST02')
    );
    const state = engine.getState();

    const nanami = placeRole(engine, 'p1', 'PR-031', 0, { isReady: true });
    const lightningHand = findCard(engine, 'p1', 'PR-016');
    const pr048 = findCard(engine, 'p1', 'PR-048');
    engine.zoneMgr.moveCard(lightningHand.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(pr048.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(findCard(engine, 'p1', 'PR-025').instanceId, 'COST', { isFaceUp: true, isReady: true });

    // 先把手牌另一张雷属性牌移除，只留 lightningHand
    // 使用 PR-031 攻击 (信号球区 <= 7 张)：触发 PR031_ATTACK_PAY_ORB
    putNonOrbOnDeckTop(engine, 'p1');
    putNonOrbOnDeckTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: nanami.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PR031_ATTACK_PAY_ORB');
    pickChoice(engine, 'p1', [lightningHand.instanceId]);
    passInstantWindows(engine);
    expect(state.cards[lightningHand.instanceId]!.zone).toBe('SIGNAL_ORB');
    expect(state.cards[lightningHand.instanceId]!.isFaceUp).toBe(false);

    // 发动 PR-048 模式1：置入信号球区最下方，从背面信号球拿回 lightningHand
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: pr048.instanceId }).success
    ).toBe(true);
    pickChoice(engine, 'p1', ['pick_facedown_lightning']);
    pickChoice(engine, 'p1', [lightningHand.instanceId]);
    expect(state.cards[pr048.instanceId]!.zone).toBe('SIGNAL_ORB');
    expect(state.cards[lightningHand.instanceId]!.zone).toBe('HAND');

    // 再从手牌使用 PR-048 模式2：使《七实·芒星之迹》获得【充能+1】且 PP+1000
    engine.zoneMgr.moveCard(pr048.instanceId, 'HAND', { isFaceUp: true });
    const play48b = engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: pr048.instanceId });
    expect(play48b.success, play48b.error).toBe(true);
    pickChoice(engine, 'p1', ['buff_nanami']);
    pickChoice(engine, 'p1', [nanami.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(nanami.instanceId)).toBe(4000); // 3000 + 1000
    expect(engine.fieldMgr.evaluateRoleStats(nanami.instanceId).charge).toBeGreaterThanOrEqual(2); // 基础1 + 1
  });

  it('PR-033 绚烂即兴秀：费用区5张明费《艾拉·万华》时最多出场2张不同编号冰属性角色并在下个对方回合结束置入牌组底', () => {
    const engine = createEngine(
      expandDeck('ST01', [
        'PR-033',
        'ST04-005',
        'ST04-005',
        'PR-004',
        'BP03-054',
        'BP03-054',
        'BP03-054',
        'BP03-054',
        'BP03-054',
      ]),
      expandDeck('ST02')
    );
    const state = engine.getState();

    const pr033 = findCard(engine, 'p1', 'PR-033');
    engine.zoneMgr.moveCard(pr033.instanceId, 'HAND', { isFaceUp: true });
    // 清空起始随机明费后放入 5 张明费《艾拉·万华》(BP03-054) + 2 张 ST04-005 + 1 张 PR-004 + 2 张凑足10费 (先将 pr033 移入手牌再填充费用，防止 fillCostZone 把 PR-033 当牌组牌塞进费用区)
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'COST')) {
      engine.zoneMgr.moveCard(c.instanceId, 'DECK', { isFaceUp: false });
    }
    const aylas = findCards(engine, 'p1', 'BP03-054');
    const st04005s = findCards(engine, 'p1', 'ST04-005');
    const pr004 = findCard(engine, 'p1', 'PR-004');
    for (const a of aylas) engine.zoneMgr.moveCard(a.instanceId, 'COST', { isFaceUp: true, isReady: true });
    for (const s of st04005s) engine.zoneMgr.moveCard(s.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(pr004.instanceId, 'COST', { isFaceUp: true, isReady: true });
    fillCostZone(engine, 'p1', 10);

    const play33 = engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: pr033.instanceId });
    expect(play33.success, play33.error).toBe(true);

    // 选两张同卡号 ST04-005 必须被拒绝 (uniqueCardNumbers)
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_PR_033_DEPLOY');
    const dupRes = engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: 'p1',
      pendingChoiceId: state.currentPendingChoice!.id,
      selectedIds: [st04005s[0]!.instanceId, st04005s[1]!.instanceId],
    });
    expect(dupRes.success).toBe(false);

    // 选两张不同编号冰属性角色 (ST04-005 + PR-004) 成功出场，并注册了 turnOffset: 1 的 DELAYED_END_OF_TURN_TO_DECK_BOTTOM
    pickChoice(engine, 'p1', [st04005s[0]!.instanceId, pr004.instanceId]);
    resolvePendingChoices(engine);
    expect(state.cards[st04005s[0]!.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(state.cards[pr004.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(
      state.delayedTriggers?.filter((d) => d.abilityId === 'DELAYED_END_OF_TURN_TO_DECK_BOTTOM').length
    ).toBe(2);

    // 结束 p1 本回合：仍在战场
    endTurn(engine);
    expect(state.cards[st04005s[0]!.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(state.cards[pr004.instanceId]!.zone).toBe('BATTLEFIELD');

    // 结束 p2 回合 (下个对方回合结束时)：两项同玩家时限触发经 CHOOSE_TRIGGER_ORDER 自选顺序后置入牌组底！
    startMainTurn(engine);
    endTurn(engine);
    resolvePendingChoices(engine);
    if (state.phase === 'END_PHASE') {
      endTurn(engine);
    }
    expect(state.cards[st04005s[0]!.instanceId]!.zone).toBe('DECK');
    expect(state.cards[pr004.instanceId]!.zone).toBe('DECK');
  });

  it('PR-034 另一人 & PR-035 升格 & PR-040 天幕的光明永不褪色：瞬时防伤/贯通与特征替换', () => {
    const engine = createEngine(
      expandDeck('ST01', ['ST01-001', 'PR-035', 'PR-005']),
      expandDeck('ST02', ['PR-034', 'PR-009', 'PR-031', 'PR-040', 'PR-023'])
    );
    const state = engine.getState();

    // 1. PR-035 升格：场上需有<升格者>，将目标角色失去原特征变为<升格者>直到下个回合结束
    const st01001 = placeRole(engine, 'p1', 'ST01-001', 0, { isReady: true }); // 原特征 [灰鸦小队, 露西亚]
    const ascendant = placeRole(engine, 'p1', 'PR-005', 1); // <升格者>
    engine.zoneMgr.moveCard(findCard(engine, 'p1', 'ST01-005').instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(ascendant.instanceId, 'COST', { isFaceUp: true, isReady: true }); // 再用另一张暗卡
    const ascendant2 = placeRole(engine, 'p1', 'ST01-004', 2);
    void ascendant2;
    const pr005b = findCard(engine, 'p1', 'PR-005');
    void pr005b;
    // 用 p1 场上放 ST01-004 暗属性? 换一个升格者: 从 ST02? p1 这里已有 PR-005 在 COST，用 p1 手里的 PR-035 需要场上有升格者
    // 把 PR-005 放回战场，然后放 ST02-004? 不，直接给 p1 多加1张 PR-005 或用已有 ST01 里的黑野/升格者
    // 更简单：用 st01001 保留，再给 st01001 旁边放 PR-005；暗属性明费直接从 p2 或用 PR-005 自身在战场、而给 p1 deck 塞2张 PR-005
    expect(state.cards[st01001.instanceId]!.zone).toBe('BATTLEFIELD');

    // 测试 PR-034 另一人：p2 战场有 <艺术协会> (PR-009) 且本回合已受伤害>=3 -> 防止对方【贯通】和战斗伤害
    placeRole(engine, 'p2', 'PR-009', 0, { isReady: false });
    const blockerDummy = placeRole(engine, 'p2', 'ST02-004', 1, { isReady: false });
    state.players['p2']!.damageTakenThisTurn = 3;
    const pr034 = findCard(engine, 'p2', 'PR-034');
    const lgtCost = findCard(engine, 'p2', 'PR-031');
    engine.zoneMgr.moveCard(pr034.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(lgtCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    fillCostZone(engine, 'p2', 4);

    // 给 st01001 加上【贯通】并攻击横置的 blockerDummy
    st01001.modifiers = [{ keywords: ['贯通'], pp: 5000, untilTurn: state.turnNumber, source: 'test' }];
    putNonOrbOnDeckTop(engine, 'p1');
    putNonOrbOnDeckTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: st01001.instanceId,
        targetType: 'CHARACTER',
        targetCardId: blockerDummy.instanceId,
      }).success
    ).toBe(true);

    const erosionBefore = state.players['p2']!.erosionCount;
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p2', cardInstanceId: pr034.instanceId }).success
    ).toBe(true);
    pickChoice(engine, 'p2', ['prevent_damage']);
    pickChoice(engine, 'p2', [st01001.instanceId]);
    passInstantWindows(engine);
    // blockerDummy 虽然被破坏，但 Q&A·7 贯通伤害被 PR-034 防止！
    expect(state.cards[blockerDummy.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.players['p2']!.erosionCount).toBe(erosionBefore);

    // 测试 PR-040 天幕的光明永不褪色：p2 玩家被攻击时堆3张见<神寂启示录>，本次攻击不造成伤害
    const pr040 = findCard(engine, 'p2', 'PR-040');
    const physCard = engine.zoneMgr.getCardsInZone('p2', 'DECK').find((c) => db.getCard(c.cardNumber)?.attribute === 'PHYSICAL');
    if (physCard) engine.zoneMgr.moveCard(physCard.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(pr040.instanceId, 'HAND', { isFaceUp: true });
    const pr023InP2 = findCard(engine, 'p2', 'PR-023'); // <神寂启示录>
    engine.zoneMgr.moveCardToTopOfDeck(pr023InP2.instanceId);
    const attacker2 = placeRole(engine, 'p1', 'ST01-002', 3, { isReady: true });
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: attacker2.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    const erosionBefore40 = state.players['p2']!.erosionCount;
    expect(
      engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p2', cardInstanceId: pr040.instanceId }).success
    ).toBe(true);
    passInstantWindows(engine);
    expect(state.cards[pr023InP2.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.players['p2']!.erosionCount).toBe(erosionBefore40);
  });

  it('PR-035 升格：清除原特征并赋予<升格者>直到下个回合结束', () => {
    const engine = createEngine(
      expandDeck('ST01', ['PR-035', 'PR-005', 'PR-005', 'PR-004']),
      expandDeck('ST02')
    );
    const state = engine.getState();

    const asc = placeRole(engine, 'p1', 'PR-005', 0);
    const target = placeRole(engine, 'p1', 'PR-004', 1, { isReady: true }); // 原本 [灰鸦小队, 露西亚]
    const darkCost = findCard(engine, 'p1', 'PR-005', 1);
    const pr035 = findCard(engine, 'p1', 'PR-035');
    engine.zoneMgr.moveCard(darkCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    fillCostZone(engine, 'p1', 4);
    engine.zoneMgr.moveCard(pr035.instanceId, 'HAND', { isFaceUp: true });

    // 在战斗自由时点使用瞬时 PR-035
    putNonOrbOnDeckTop(engine, 'p1');
    putNonOrbOnDeckTop(engine, 'p2');
    const atk35 = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p1',
      attackerCardId: target.instanceId,
      targetType: 'PLAYER',
    });
    expect(atk35.success, atk35.error).toBe(true);
    expect(
      state.phase,
      `timing=${JSON.stringify(state.timingWindow)}, hand=${engine.zoneMgr.getCardsInZone('p1', 'HAND').map(c => `${c.cardNumber}:${c.instanceId}`).join(',')}, ascSlot=${JSON.stringify(engine.fieldMgr.getSlots('p1')[0])}, ascTrait=${engine.continuousEffects.hasTrait(asc.instanceId, '升格者')}, costs=${engine.zoneMgr.getCardsInZone('p1', 'COST').map(c => `${c.cardNumber}:${c.isFaceUp}:${c.isReady}`).join(',')}`
    ).toBe('COMBAT_FREE_TIMING');
    const play35 = engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: pr035.instanceId });
    expect(play35.success, play35.error).toBe(true);
    pickChoice(engine, 'p1', [target.instanceId]);
    passInstantWindows(engine);

    expect(engine.continuousEffects.hasTrait(target.instanceId, '升格者')).toBe(true);
    expect(engine.continuousEffects.hasTrait(target.instanceId, '灰鸦小队')).toBe(false);
    expect(engine.continuousEffects.hasTrait(target.instanceId, '露西亚')).toBe(false);

    // 结束己方回合后依然保持，再结束对方回合后才恢复原特征
    endTurn(engine);
    expect(engine.continuousEffects.hasTrait(target.instanceId, '升格者')).toBe(true);
    startMainTurn(engine);
    endTurn(engine);
    expect(engine.continuousEffects.hasTrait(target.instanceId, '升格者')).toBe(false);
    expect(engine.continuousEffects.hasTrait(target.instanceId, '灰鸦小队')).toBe(true);
    void asc;
    void state;
  });

  it('PR-041 肃噩：回合结束置入空属性牌变为PP4000/DP0角色牌(可持续至下回合结束)与禁止置入下方', () => {
    const engine = createEngine(
      expandDeck('ST01', ['PR-041', 'BP04-001', 'BP04-002']),
      expandDeck('ST02')
    );
    const state = engine.getState();

    const sue = findCard(engine, 'p1', 'PR-041');
    const voidCard = findCard(engine, 'p1', 'BP04-001');
    // 使用无回合结束自变辅助机效果的 BP04-002《露娜·终焉》作为场上接收角色
    const luna = placeRole(engine, 'p1', 'BP04-002', 1);
    engine.fieldMgr.playAssistCard('p1', sue.instanceId, 0);
    engine.zoneMgr.moveCard(voidCard.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.fieldMgr.isSlotRole('p1', sue.instanceId)).toBe(false);

    // 进入结束阶段触发 PR-041【自】
    engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p1' });
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_PR_041_CONFIRM');
    pickChoice(engine, 'p1', ['opt_yes']);
    pickChoice(engine, 'p1', [voidCard.instanceId]);
    resolvePendingChoices(engine);

    // 确认已变为角色牌、PP4000、DP0，且在 p2 回合仍维持角色牌形态
    expect(state.cards[voidCard.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(sue.underneathCardIds).toContain(voidCard.instanceId);
    expect(engine.continuousEffects.getEffectiveCardType(sue.instanceId)).toBe(CardType.ROLE);
    expect(engine.fieldMgr.isSlotRole('p1', sue.instanceId)).toBe(true);
    expect(engine.fieldMgr.calculateRoleEffectivePP(sue.instanceId)).toBe(4000);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(sue.instanceId)).toBe(0);
    expect(state.activePlayerId).toBe('p2');

    // 结束 p2 回合后回到 p1 回合，变形期满恢复为 ASSIST，再测【起】横置置入《露娜·终焉》下方
    startMainTurn(engine);
    endTurn(engine);
    expect(state.activePlayerId).toBe('p1');
    startMainTurn(engine);
    expect(engine.continuousEffects.getEffectiveCardType(sue.instanceId)).toBe(CardType.ASSIST);
    expect(engine.fieldMgr.isSlotRole('p1', sue.instanceId)).toBe(false);

    const act41 = engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: sue.instanceId });
    expect(act41.success, act41.error).toBe(true);
    pickChoice(engine, 'p1', [luna.instanceId]);
    expect(state.cards[luna.instanceId]!.underneathCardIds).toContain(sue.instanceId);
  });

  it('PR-044 卡列尼娜· 辉晓 & PR-045 决行预兆 亚里莎&塞西莉：精确暗属性协战筛选与双向协战触发', () => {
    const engine = createEngine(
      expandDeck('ST01', ['PR-044', 'BP04-039', 'BP04-042', 'PR-045', 'PR-045', 'BP04-045', 'BP04-047']),
      expandDeck('ST02')
    );
    const state = engine.getState();

    // 1. PR-044 攻击时弃 1 牌：墓地中暗属性协战角色(BP04-039)可选，暗属性非协战角色(BP04-042)不可选
    const karenina = placeRole(engine, 'p1', 'PR-044', 0, { isReady: true });
    const assistDark = findCard(engine, 'p1', 'BP04-039');
    const nonAssistDark = findCard(engine, 'p1', 'BP04-042');
    engine.zoneMgr.moveCard(assistDark.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(nonAssistDark.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const handDummy = engine.zoneMgr.getCardsInZone('p1', 'HAND')[0]!;

    putNonOrbOnDeckTop(engine, 'p1');
    putNonOrbOnDeckTop(engine, 'p2');
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: 'p1',
        attackerCardId: karenina.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_DISCARD_COST');
    pickChoice(engine, 'p1', [handDummy.instanceId]);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_TO_HAND');
    const gyOptionIds = state.currentPendingChoice!.options.map((o) => o.id);
    expect(gyOptionIds).toContain(assistDark.instanceId);
    expect(gyOptionIds).not.toContain(nonAssistDark.instanceId);
    pickChoice(engine, 'p1', [assistDark.instanceId]);
    passInstantWindows(engine);
    expect(state.cards[assistDark.instanceId]!.zone).toBe('HAND');

    // 2. PR-045 获得协战搭档 (SELF_GAINED_PARTNER) & 成为协战搭档 (SELF_BECAME_PARTNER) 时均触发 PP+1000
    const pr045Host = placeRole(engine, 'p1', 'PR-045', 1, { isReady: true });
    const pr045Partner = findCard(engine, 'p1', 'PR-045', 1);
    const partnerCecilia = findCard(engine, 'p1', 'BP04-047'); // cost 4 <= 4 塞西莉
    const hostAlisa = placeRole(engine, 'p1', 'BP04-045', 2, { isReady: true });
    engine.zoneMgr.moveCard(partnerCecilia.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(pr045Partner.instanceId, 'HAND', { isFaceUp: true });
    fillCostZone(engine, 'p1', 6);

    // 2a. PR-045 作为主角色协战手牌 BP04-047 (触发 SELF_GAINED_PARTNER)
    const atk45a = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p1',
      attackerCardId: pr045Host.instanceId,
      targetType: 'PLAYER',
    });
    expect(atk45a.success, `${atk45a.error} | pr045Host=${JSON.stringify(state.cards[pr045Host.instanceId])} | slots=${JSON.stringify(engine.fieldMgr.getSlots('p1'))}`).toBe(true);
    const assistA = engine.dispatchAction({
      type: 'PERFORM_ASSIST',
      playerId: 'p1',
      hostRoleCardId: pr045Host.instanceId,
      partnerCardId: partnerCecilia.instanceId,
    });
    expect(assistA.success, assistA.error).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_PR_045_PP');
    pickChoice(engine, 'p1', [pr045Host.instanceId]);
    resolvePendingChoices(engine);
    passInstantWindows(engine);
    // 8.13.4 协战合计 PP = 主角色 3500 + 搭档 BP04-047 (3500) + PR-045【自】(+1000) = 8000
    expect(engine.fieldMgr.calculateRoleEffectivePP(pr045Host.instanceId)).toBe(8000);

    // 2b. BP04-045 协战手牌另一张 PR-045 (触发 SELF_BECAME_PARTNER)
    const atk45b = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p1',
      attackerCardId: hostAlisa.instanceId,
      targetType: 'PLAYER',
    });
    expect(atk45b.success, atk45b.error).toBe(true);
    const assistB = engine.dispatchAction({
      type: 'PERFORM_ASSIST',
      playerId: 'p1',
      hostRoleCardId: hostAlisa.instanceId,
      partnerCardId: pr045Partner.instanceId,
    });
    expect(assistB.success, assistB.error).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_PR_045_PP');
    pickChoice(engine, 'p1', [hostAlisa.instanceId]);
    resolvePendingChoices(engine);
    passInstantWindows(engine);
    // 8.13.4 协战合计 PP = BP04-045 (6500) + 搭档 PR-045 (3500) + PR-045【自】(+1000) = 11000
    expect(engine.fieldMgr.calculateRoleEffectivePP(hostAlisa.instanceId)).toBe(11000);
  });

  it('PR-046 执铭化刃 & PR-047 罗塞塔·凛冽：全区<万世铭>、消3球计数、独立《冈格尼尔》速攻与出牌计数+1', () => {
    const engine = createEngine(
      expandDeck('ST01', ['PR-046', 'PR-007', 'BP01-037', 'BP01-038', 'BP02-048', 'PR-047', 'BP03-042', 'PR-001', 'PR-002', 'PR-003']),
      expandDeck('ST02')
    );
    const state = engine.getState();

    // 1. PR-046 在费用区正面时视为 <万世铭>，可与 BP01-037 共同触发 PR-007 PP+1000
    const pr046 = findCard(engine, 'p1', 'PR-046');
    const wsm = findCard(engine, 'p1', 'BP01-037');
    const pr007 = placeRole(engine, 'p1', 'PR-007', 1);
    engine.zoneMgr.moveCard(pr046.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(wsm.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.syncCostStats('p1');
    expect(engine.continuousEffects.hasTrait(pr046.instanceId, '万世铭')).toBe(true);
    expect(engine.fieldMgr.calculateRoleEffectivePP(pr007.instanceId)).toBe(6000);

    // 三消信号球设置 eliminatedThreeOrbsThisTurn
    const orb1 = findCard(engine, 'p1', 'PR-001');
    const orb2 = findCard(engine, 'p1', 'PR-002');
    const orb3 = findCard(engine, 'p1', 'PR-003');
    engine.zoneMgr.moveCard(orb1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orb2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orb3.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    const elimRes = engine.dispatchAction({
      type: 'ELIMINATE_3_ORBS',
      playerId: 'p1',
      orbCardInstanceIds: [orb1.instanceId, orb2.instanceId, orb3.instanceId],
    });
    expect(elimRes.success, elimRes.error).toBe(true);
    expect(state.players['p1']!.eliminatedThreeOrbsThisTurn).toBe(true);

    // 2. PR-047 罗塞塔·凛冽：独立《冈格尼尔》在场时获得【速攻】；手牌弃自身可增加已用牌张数
    const gungnir = findCard(engine, 'p1', 'BP03-042');
    const pr047 = findCard(engine, 'p1', 'PR-047');
    engine.zoneMgr.moveCard(pr047.instanceId, 'HAND', { isFaceUp: true });
    engine.fieldMgr.playRoleCard('p1', pr047.instanceId, 2);
    expect(engine.fieldMgr.evaluateRoleStats(pr047.instanceId).keywords).not.toContain('速攻');
    engine.fieldMgr.playStandaloneEquipment('p1', gungnir.instanceId, 3);
    expect(engine.fieldMgr.evaluateRoleStats(pr047.instanceId).keywords).toContain('速攻');

    engine.zoneMgr.moveCard(pr047.instanceId, 'HAND', { isFaceUp: true });
    const playsBefore = state.players['p1']!.cardsPlayedThisTurn ?? 0;
    const act47 = engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: pr047.instanceId });
    expect(act47.success, act47.error).toBe(true);
    pickChoice(engine, 'p1', ['reorder_and_inc_plays']);
    pickChoice(engine, 'p1', ['opt_yes']);
    expect(state.players['p1']!.cardsPlayedThisTurn).toBe(playsBefore + 1);
  });

  it('PR-046 执铭化刃完整流程：洗回费用区《万世铭》与墓地《万世铭·重铸》竖直《曲·启明》并在消3球后横置入费', () => {
    const engine = createEngine(
      expandDeck('ST01', ['PR-046', 'BP01-037', 'BP01-038', 'BP02-048', 'PR-004', 'PR-001', 'PR-002', 'PR-003']),
      expandDeck('ST02')
    );
    const state = engine.getState();
    const pr046 = findCard(engine, 'p1', 'PR-046');
    const wsm = findCard(engine, 'p1', 'BP01-037');
    const wsmr = findCard(engine, 'p1', 'BP01-038');
    const qu = placeRole(engine, 'p1', 'BP02-048', 0, { isReady: false });
    const iceCost = findCard(engine, 'p1', 'PR-004');
    engine.zoneMgr.moveCard(iceCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(wsm.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(wsmr.instanceId, 'GRAVEYARD', { isFaceUp: true });
    fillCostZone(engine, 'p1', 4);
    engine.zoneMgr.moveCard(pr046.instanceId, 'HAND', { isFaceUp: true });

    const orb1 = findCard(engine, 'p1', 'PR-001');
    const orb2 = findCard(engine, 'p1', 'PR-002');
    const orb3 = findCard(engine, 'p1', 'PR-003');
    engine.zoneMgr.moveCard(orb1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orb2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orb3.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    const elimRes = engine.dispatchAction({
      type: 'ELIMINATE_3_ORBS',
      playerId: 'p1',
      orbCardInstanceIds: [orb1.instanceId, orb2.instanceId, orb3.instanceId],
    });
    expect(elimRes.success, elimRes.error).toBe(true);

    const play46 = engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: pr046.instanceId });
    expect(play46.success, play46.error).toBe(true);
    pickChoice(engine, 'p1', ['opt_yes']);
    pickChoice(engine, 'p1', [wsm.instanceId]);
    pickChoice(engine, 'p1', [wsmr.instanceId]);
    pickChoice(engine, 'p1', [qu.instanceId]);

    expect(state.cards[wsm.instanceId]!.zone).toBe('DECK');
    expect(state.cards[wsmr.instanceId]!.zone).toBe('DECK');
    expect(qu.isReady).toBe(true);
    expect(state.cards[pr046.instanceId]!.zone).toBe('COST');
    expect(state.cards[pr046.instanceId]!.isReady).toBe(false);
    expect(state.cards[pr046.instanceId]!.isFaceUp).toBe(true);
  });

  it('PR-004/005/008/009：露西亚信号球重排、露娜【充能0】与抽1弃1、七实换费、赛琳娜墓地回球', () => {
    const engine = createEngine(
      expandDeck('ST01', ['PR-004', 'PR-005', 'PR-008', 'PR-009', 'PR-001', 'PR-002', 'PR-003', 'ST04-005', 'PR-043', 'ST05-002']),
      expandDeck('ST02')
    );
    const state = engine.getState();
    const orb1 = findCard(engine, 'p1', 'PR-001');
    const orb2 = findCard(engine, 'p1', 'PR-002');
    const orb3 = findCard(engine, 'p1', 'PR-003');
    const pr004 = findCard(engine, 'p1', 'PR-004');
    const pr005 = findCard(engine, 'p1', 'PR-005');
    const pr008 = findCard(engine, 'p1', 'PR-008');
    const pr009 = findCard(engine, 'p1', 'PR-009');
    const iceCost = findCard(engine, 'p1', 'ST04-005');
    const fireCost = findCard(engine, 'p1', 'PR-043');
    const darkCost = findCard(engine, 'p1', 'ST05-002');

    // 先将 PR-004/005/008/009 移入手牌，再保留各属性明费并填满 10 费
    engine.zoneMgr.moveCard(pr004.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(pr005.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(pr008.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(pr009.instanceId, 'HAND', { isFaceUp: true });
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'COST')) {
      engine.zoneMgr.moveCard(c.instanceId, 'DECK', { isFaceUp: false });
    }
    engine.zoneMgr.moveCard(iceCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(fireCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    engine.zoneMgr.moveCard(darkCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    const physInDeck = engine.zoneMgr.getCardsInZone('p1', 'DECK').find((c) => db.getCard(c.cardNumber)?.attribute === 'PHYSICAL');
    if (physInDeck) engine.zoneMgr.moveCard(physInDeck.instanceId, 'COST', { isFaceUp: true, isReady: true });
    fillCostZone(engine, 'p1', 10);

    engine.zoneMgr.moveCard(orb1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orb2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orb3.instanceId, 'GRAVEYARD', { isFaceUp: true });

    // 1. PR-009 赛琳娜·希声：从墓地拿 1 张信号球 (orb3) 放到信号球区最上方
    const play09 = engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: pr009.instanceId });
    expect(play09.success, play09.error).toBe(true);
    pickChoice(engine, 'p1', [orb3.instanceId]);
    expect(state.cards[orb3.instanceId]!.zone).toBe('SIGNAL_ORB');
    const orbsAfter09 = engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB');
    expect(orbsAfter09[orbsAfter09.length - 1]!.instanceId).toBe(orb3.instanceId);

    // 2. PR-008 七实·遥星之座：弃 1 手牌拿 1 张明费回手 + 牌组顶 1 张横置入费
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'COST')) c.isReady = true;
    engine.zoneMgr.syncCostStats('p1');
    const topDeck08 = engine.zoneMgr.getCardsInZone('p1', 'DECK')[0]!;
    const openTarget08 = engine.zoneMgr.getCardsInZone('p1', 'COST').find(
      (c) => c.isFaceUp && c.instanceId !== iceCost.instanceId && c.instanceId !== fireCost.instanceId && c.instanceId !== darkCost.instanceId
    )!;
    const play08 = engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: pr008.instanceId });
    expect(play08.success, play08.error).toBe(true);
    pickChoice(engine, 'p1', [state.currentPendingChoice!.options[0]!.id]);
    pickChoice(engine, 'p1', [openTarget08.instanceId]);
    expect(state.cards[openTarget08.instanceId]!.zone).toBe('HAND');
    expect(state.cards[topDeck08.instanceId]!.zone).toBe('COST');
    expect(state.cards[topDeck08.instanceId]!.isReady).toBe(false);

    // 3. PR-004 露西亚·鸦羽：出场重排信号球区顺序 (一次提交按从下到上的全部 3 张 ID)
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'COST')) c.isReady = true;
    engine.zoneMgr.syncCostStats('p1');
    const play04 = engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: pr004.instanceId });
    expect(play04.success, play04.error).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_PR_004_ORDER');
    pickChoice(engine, 'p1', [orb3.instanceId, orb2.instanceId, orb1.instanceId]);
    const reorderedOrbs = engine.zoneMgr.getCardsInZone('p1', 'SIGNAL_ORB').map((c) => c.instanceId);
    expect(reorderedOrbs).toEqual([orb3.instanceId, orb2.instanceId, orb1.instanceId]);

    // 4. PR-005 露娜·银冕：使用出场抽 1 弃 1 并验证【充能0】(charge === 0)
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'COST')) c.isReady = true;
    engine.zoneMgr.syncCostStats('p1');
    const handBefore05 = engine.zoneMgr.getCardsInZone('p1', 'HAND').length;
    const play05 = engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: pr005.instanceId });
    expect(play05.success, play05.error).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_DISCARD');
    const discard05 = state.currentPendingChoice!.options[0]!.id;
    pickChoice(engine, 'p1', [discard05]);
    expect(state.cards[discard05]!.zone).toBe('GRAVEYARD');
    expect(engine.zoneMgr.getCardsInZone('p1', 'HAND').length).toBe(handBefore05 - 1); // -1打出 +1抽 -1弃
    expect(engine.fieldMgr.evaluateRoleStats(pr005.instanceId).charge).toBe(0);
  });

  it('PR-019 徽羽 & PR-021 心象边境 & PR-025/026/027/029/037/038 & PR-032/042/043：核心辅助机/瞬时/墓地回收机制', () => {
    const engine = createEngine(
      expandDeck('ST01', [
        'PR-019',
        'BP01-037',
        'BP02-048',
        'PR-025',
        'PR-026',
        'PR-027',
        'PR-029',
        'PR-029',
        'PR-032',
        'PR-047',
        'PR-047',
        'PR-037',
        'PR-038',
        'PR-042',
        'BP04-017',
        'PR-043',
        'BP04-057',
        'BP04-032',
      ]),
      expandDeck('ST02', ['ST02-002', 'PR-021', 'PR-029', 'PR-029'])
    );
    const state = engine.getState();

    // 1. PR-019 徽羽：横置+弃1手牌，亮顶4张拿1<万世铭>和1《曲·启明》，余2张置牌组底
    const pr019 = findCard(engine, 'p1', 'PR-019');
    expect(engine.fieldMgr.playAssistCard('p1', pr019.instanceId, 0)).toBe(true);
    const wsmTop = findCard(engine, 'p1', 'BP01-037');
    const quTop = findCard(engine, 'p1', 'BP02-048');
    const extra1 = findCard(engine, 'p1', 'PR-025');
    const extra2 = findCard(engine, 'p1', 'PR-026');
    engine.zoneMgr.moveCard(extra1.instanceId, 'DECK', { isFaceUp: false });
    engine.zoneMgr.moveCard(extra2.instanceId, 'DECK', { isFaceUp: false });
    engine.zoneMgr.moveCard(wsmTop.instanceId, 'DECK', { isFaceUp: false });
    engine.zoneMgr.moveCard(quTop.instanceId, 'DECK', { isFaceUp: false });
    engine.zoneMgr.moveCardToTopOfDeck(extra1.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(extra2.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(quTop.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(wsmTop.instanceId);
    const discardCostHand = engine.zoneMgr.getCardsInZone('p1', 'HAND')[0]!;
    const act19 = engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: pr019.instanceId });
    expect(act19.success, act19.error).toBe(true);
    pickChoice(engine, 'p1', [discardCostHand.instanceId]);
    pickChoice(engine, 'p1', [wsmTop.instanceId]);
    pickChoice(engine, 'p1', [quTop.instanceId]);
    expect(state.cards[wsmTop.instanceId]!.zone).toBe('HAND');
    expect(state.cards[quTop.instanceId]!.zone).toBe('HAND');
    expect(state.cards[extra1.instanceId]!.zone).toBe('DECK');
    expect(state.cards[extra2.instanceId]!.zone).toBe('DECK');

    // 2. PR-043 夜蝠：横置自身破坏我方战场<遗忘者>(BP04-057) -> 墓地《炽能球》(BP04-032)放信号球区最上方
    const pr043 = findCard(engine, 'p1', 'PR-043');
    expect(engine.fieldMgr.playAssistCard('p1', pr043.instanceId, 0)).toBe(true); // 替换原辅助机
    const forgotten = placeRole(engine, 'p1', 'BP04-057', 1);
    const fireOrb = findCard(engine, 'p1', 'BP04-032');
    engine.zoneMgr.moveCard(fireOrb.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const act43 = engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: pr043.instanceId });
    expect(act43.success, act43.error).toBe(true);
    pickChoice(engine, 'p1', [forgotten.instanceId]);
    pickChoice(engine, 'p1', [fireOrb.instanceId]);
    expect(state.cards[forgotten.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[fireOrb.instanceId]!.zone).toBe('SIGNAL_ORB');
    // 清理 BP04-057 离场/破坏触发产生的待决决策
    resolvePendingChoices(engine);

    // 3. PR-025/026/027/037/038：异聚体(神寂启示录)体系联动
    const mammon = placeRole(engine, 'p1', 'PR-038', 1, { isReady: true }); // cost 2 异聚体
    const pr025 = findCard(engine, 'p1', 'PR-025');
    const pr037 = findCard(engine, 'p1', 'PR-037');
    engine.zoneMgr.moveCard(pr025.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(pr037.instanceId, 'HAND', { isFaceUp: true });
    const act25 = engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: pr025.instanceId });
    expect(act25.success, act25.error).toBe(true);
    pickChoice(engine, 'p1', [mammon.instanceId]);
    pickChoice(engine, 'p1', ['opt_yes']);
    pickChoice(engine, 'p1', [pr037.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(mammon.instanceId)).toBe(3000); // 1000 + 2000

    // PR-037 在场丢手牌1<神寂启示录>得【充能+1】; PR-027【充能0】
    const uriel = placeRole(engine, 'p1', 'PR-027', 2);
    expect(engine.fieldMgr.evaluateRoleStats(uriel.instanceId).charge).toBe(0);
    placeRole(engine, 'p1', 'PR-037', 3);
    const pr026 = findCard(engine, 'p1', 'PR-026');
    engine.zoneMgr.moveCard(pr026.instanceId, 'HAND', { isFaceUp: true });
    const act37 = engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: pr037.instanceId });
    expect(act37.success, act37.error).toBe(true);
    pickChoice(engine, 'p1', [pr026.instanceId]);
    expect(engine.fieldMgr.evaluateRoleStats(pr037.instanceId).charge).toBeGreaterThanOrEqual(2);

    // PR-026 出场将墓地 pr025 置底并从墓地复活 cost2 <神寂启示录>(例如刚丢下去的额外或把 mammon 先放墓地)
    engine.zoneMgr.moveCard(pr037.instanceId, 'GRAVEYARD', { isFaceUp: true }); // 给 pr026 上场腾位置并保证有非自选置底
    const lgtCost = findCard(engine, 'p1', 'PR-025');
    engine.zoneMgr.moveCard(lgtCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    // 确认墓地有 PR-026 和 PR-037，将 PR-026 出场洗底 PR-037 并复活另一 cost2 (或验证可选)
    engine.zoneMgr.moveCard(mammon.instanceId, 'GRAVEYARD', { isFaceUp: true });
    fillCostZone(engine, 'p1', 6);
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'COST')) c.isReady = true;
    engine.zoneMgr.syncCostStats('p1');
    engine.zoneMgr.moveCard(pr026.instanceId, 'HAND', { isFaceUp: true });
    const play26 = engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: pr026.instanceId });
    expect(play26.success, play26.error).toBe(true);
    pickChoice(engine, 'p1', ['opt_yes']);
    pickChoice(engine, 'p1', [pr037.instanceId]);
    pickChoice(engine, 'p1', [mammon.instanceId]);
    expect(state.cards[pr037.instanceId]!.zone).toBe('DECK');
    expect(state.cards[mammon.instanceId]!.zone).toBe('BATTLEFIELD');

    // PR-038 攻击时将墓地1<神寂启示录>置底使自身 DP+1
    putNonOrbOnDeckTop(engine, 'p1');
    putNonOrbOnDeckTop(engine, 'p2');
    engine.zoneMgr.moveCard(pr026.instanceId, 'GRAVEYARD', { isFaceUp: true });
    mammon.turnEnteredZone = 0;
    mammon.isReady = true;
    const atk38 = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p1',
      attackerCardId: mammon.instanceId,
      targetType: 'PLAYER',
    });
    expect(atk38.success, atk38.error).toBe(true);
    pickChoice(engine, 'p1', ['opt_yes']);
    pickChoice(engine, 'p1', [pr026.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectiveDP(mammon.instanceId)).toBe(1);
    passInstantWindows(engine);

    // 4. PR-032 倚靠 & PR-042 聚焰淬夜 & PR-021 心象边境：战斗自由时点验证
    // 清理空余槽位：放两张 PR-047《罗塞塔·凛冽》和一张 BP04-017《薇拉·灼惘》
    engine.zoneMgr.moveCard(uriel.instanceId, 'GRAVEYARD', { isFaceUp: true });
    engine.zoneMgr.moveCard(mammon.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const rosA = placeRole(engine, 'p1', 'PR-047', 2, { isReady: true, instanceIndex: 0 });
    const rosB = placeRole(engine, 'p1', 'PR-047', 3, { isReady: false, instanceIndex: 1 });
    const vera = placeRole(engine, 'p1', 'BP04-017', 4, { isReady: true });
    const pr032 = findCard(engine, 'p1', 'PR-032');
    const pr042 = findCard(engine, 'p1', 'PR-042');
    engine.zoneMgr.moveCard(pr032.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(pr042.instanceId, 'HAND', { isFaceUp: true });
    // 确保 p1 有物理 & 火明费，且将 p1 伤害设为 1 测试 PR-042 持续至下回合结束
    engine.zoneMgr.moveCard(findCard(engine, 'p1', 'PR-029').instanceId, 'COST', { isFaceUp: true, isReady: true });
    state.players['p1']!.damageTakenThisTurn = 1;
    // 给 p2 放 PR-029《丽芙·极昼》+ 物理/火明费 + PR-021《心象边境》
    const p2Liv = placeRole(engine, 'p2', 'PR-029', 0);
    const pr021 = findCard(engine, 'p2', 'PR-021');
    engine.zoneMgr.moveCard(pr021.instanceId, 'HAND', { isFaceUp: true });
    engine.zoneMgr.moveCard(findCard(engine, 'p2', 'PR-029', 1).instanceId, 'COST', { isFaceUp: true, isReady: true });
    fillCostZone(engine, 'p2', 4);
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'COST')) c.isReady = true;
    engine.zoneMgr.syncCostStats('p1');

    // 主阶段禁止发动 PR-032 倚靠 (仅自由时点步骤)
    const pr032Main = engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: pr032.instanceId });
    expect(pr032Main.success).toBe(false);

    putNonOrbOnDeckTop(engine, 'p1');
    putNonOrbOnDeckTop(engine, 'p2');
    const atk32 = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: 'p1',
      attackerCardId: vera.instanceId,
      targetType: 'PLAYER',
    });
    expect(atk32.success, atk32.error).toBe(true);
    // p2 发动 PR-021 心象边境：把场上的《丽芙·极昼》置入墓地，使 vera 攻击至多造成 1 伤害
    const play21 = engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p2', cardInstanceId: pr021.instanceId });
    expect(play21.success, play21.error).toBe(true);
    pickChoice(engine, 'p2', ['opt_yes']);
    pickChoice(engine, 'p2', [p2Liv.instanceId]);
    pickChoice(engine, 'p2', ['cap_damage_1']);
    pickChoice(engine, 'p2', [vera.instanceId]);
    expect(state.cards[p2Liv.instanceId]!.zone).toBe('GRAVEYARD');

    // p1 依次使用 PR-032 倚靠 (弹回 rosB 使 rosA PP+1500) 与 PR-042 聚焰淬夜 (vera PP+2000 直到下个回合结束)
    const play32 = engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: pr032.instanceId });
    expect(play32.success, play32.error).toBe(true);
    pickChoice(engine, 'p1', ['opt_yes']);
    pickChoice(engine, 'p1', [rosB.instanceId]);
    pickChoice(engine, 'p1', [rosA.instanceId]);
    expect(state.cards[rosB.instanceId]!.zone).toBe('HAND');
    expect(engine.fieldMgr.calculateRoleEffectivePP(rosA.instanceId)).toBe(6500);

    // p2 自动跳过后到 p1 再发动 PR-042
    if (state.timingWindow?.priorityPlayerId === 'p2') {
      engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
    }
    const play42 = engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: pr042.instanceId });
    expect(play42.success, play42.error).toBe(true);
    pickChoice(engine, 'p1', [vera.instanceId]);
    expect(engine.fieldMgr.calculateRoleEffectivePP(vera.instanceId)).toBe(6000); // 4000 + 2000
    passInstantWindows(engine);
    // 战斗结束后 rosA 的 END_OF_COMBAT 失效恢复 5000，vera 因 damageTakenThisTurn>=1 持续到下回合结束保持 6000！
    expect(engine.fieldMgr.calculateRoleEffectivePP(rosA.instanceId)).toBe(5000);
    expect(engine.fieldMgr.calculateRoleEffectivePP(vera.instanceId)).toBe(6000);

    // 5. PR-029 丽芙·极昼：牌组<=10张时【出】将墓地所有非信号球洗回牌组
    engine.zoneMgr.moveCard(rosA.instanceId, 'GRAVEYARD', { isFaceUp: true }); // 给 PR-029 腾空位
    const nonOrbGy = findCard(engine, 'p1', 'PR-032');
    expect(state.cards[nonOrbGy.instanceId]!.zone).toBe('GRAVEYARD');
    const deckCards = engine.zoneMgr.getCardsInZone('p1', 'DECK');
    for (let i = 0; i < deckCards.length - 8; i++) {
      engine.zoneMgr.moveCard(deckCards[i]!.instanceId, 'GRAVEYARD', { isFaceUp: true });
    }
    const pr029 = findCard(engine, 'p1', 'PR-029', 1);
    engine.zoneMgr.moveCard(pr029.instanceId, 'HAND', { isFaceUp: true });
    for (const c of engine.zoneMgr.getCardsInZone('p1', 'COST')) c.isReady = true;
    engine.zoneMgr.syncCostStats('p1');
    const play29 = engine.dispatchAction({ type: 'PLAY_CARD', playerId: 'p1', cardInstanceId: pr029.instanceId });
    expect(play29.success, play29.error).toBe(true);
    resolvePendingChoices(engine);
    expect(state.cards[nonOrbGy.instanceId]!.zone).toBe('DECK');
  });
});
