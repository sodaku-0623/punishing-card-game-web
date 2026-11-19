import { describe, it, expect } from 'vitest';
import { CardType } from '@zhanshuang/shared';
import { OFFICIAL_STARTER_DECKS } from '@zhanshuang/game-rules';
import {
  addCardModifier,
  GameEngine,
  MemoryCardDatabase,
  OFFICIAL_CARDS_DATA,
} from '../src/index.js';
import { endTurn, fillCostZone, passInstantWindows, resolvePendingChoices } from './helpers.js';

const db = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);

function expandDeck(presetId: 'ST01' | 'ST02' | 'ST03'): string[] {
  const deck = OFFICIAL_STARTER_DECKS.find((d) => d.name.includes(`(${presetId})`))!;
  const list: string[] = [];
  for (const entry of deck.cards) {
    for (let i = 0; i < entry.count; i++) list.push(entry.cardNumber);
  }
  return list;
}

function createEngine(
  p1Deck: string[] = expandDeck('ST01'),
  p2Deck: string[] = expandDeck('ST02'),
  seed = 20261119
): GameEngine {
  const engine = new GameEngine(
    `qa-${seed}`,
    { playerId: 'p1', deckCardNumbers: p1Deck },
    { playerId: 'p2', deckCardNumbers: p2Deck },
    seed,
    db,
    { skipMulligan: true }
  );
  const state = engine.getState();
  if (state.activePlayerId !== 'p1') {
    state.activePlayerId = 'p1';
    state.nonActivePlayerId = 'p2';
    state.priorityPlayerId = 'p1';
  }
  engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p1' });
  return engine;
}

function findCard(engine: GameEngine, playerId: string, cardNumber: string, exclude: string[] = []) {
  return Object.values(engine.getState().cards).find(
    (c) => c.controllerPlayerId === playerId && c.cardNumber === cardNumber && !exclude.includes(c.instanceId)
  )!;
}

function placeRole(engine: GameEngine, playerId: string, cardNumber: string, slot: number, exclude: string[] = []) {
  const card = findCard(engine, playerId, cardNumber, exclude);
  engine.zoneMgr.moveCard(card.instanceId, 'HAND', { isFaceUp: true });
  expect(engine.fieldMgr.playRoleCard(playerId, card.instanceId, slot)).toBe(true);
  card.turnEnteredZone = 0;
  engine.checkTimingMgr.resolveCheckTiming();
  return card;
}

describe('官方规则 Q&A 第 1~10 期核心裁定回归用例 (docs/rules/rule-specification.md §11)', () => {
  it('Q&A·1 / Q&A·4 (BP01-025 / BP02-001 / BP02-069): 失去能力保留先前的 PP/DP 增减，清除固有能力与先前词条，之后新获得的词条有效', () => {
    const engine = createEngine(expandDeck('ST02'), expandDeck('ST01'));
    const state = engine.getState();
    const active = state.activePlayerId;

    // ST02-004 拥有自身【永】(墓地>=10 时 PP+1500)
    const luna = placeRole(engine, active, 'ST02-004', 0);
    const basePP = db.getCard('ST02-004')!.basePP!;
    const baseDP = db.getCard('ST02-004')!.baseDP!;

    // 先给予外来的 PP+1000, DP+1 与【贯通】
    addCardModifier(state, luna, {
      pp: 1000,
      dp: 1,
      keywords: ['贯通'],
      untilTurn: state.turnNumber,
      source: 'QNA1_PRE_BUFF',
    });
    // 使墓地达到 10 张，自身【永】本来应 +1500
    for (const c of engine.zoneMgr.getCardsInZone(active, 'DECK').slice(0, 10)) {
      engine.zoneMgr.moveCard(c.instanceId, 'GRAVEYARD', { isFaceUp: true });
    }
    expect(engine.fieldMgr.calculateRoleEffectivePP(luna.instanceId)).toBe(basePP + 1000 + 1500);

    // 施加「失去能力」(8.3.4)
    addCardModifier(state, luna, { loseAbilities: true, untilTurn: state.turnNumber, source: 'BP01-025' });
    // 之后再赋予新词条【速攻】(Q&A·4 BP02-001: 之后新获得的能力有效)
    addCardModifier(state, luna, { keywords: ['速攻'], untilTurn: state.turnNumber, source: 'QNA4_POST_KW' });

    const evaluated = engine.fieldMgr.evaluateRoleStats(luna.instanceId);
    // 自身【永】(+1500) 失效，外来 PP+1000 与 DP+1 保留
    expect(evaluated.pp).toBe(basePP + 1000);
    expect(evaluated.dp).toBe(baseDP + 1);
    // 先前的【贯通】失效，之后赋予的【速攻】保留
    expect(evaluated.keywords).not.toContain('贯通');
    expect(evaluated.keywords).toContain('速攻');
  });

  it('Q&A·3 (ST03-010 暗域力场): 8.9.2 仅锁定解决当时在场且横置的<三头犬小队>角色，之后出场或之后横置的不受影响', () => {
    const engine = createEngine(expandDeck('ST03'), expandDeck('ST01'));
    const state = engine.getState();
    const active = state.activePlayerId;

    const tappedNow = placeRole(engine, active, 'ST03-005', 0);
    tappedNow.isReady = false;
    const readyNow = placeRole(engine, active, 'ST03-007', 1);
    const baseTapped = db.getCard('ST03-005')!.basePP!;
    const baseReady = db.getCard('ST03-007')!.basePP!;

    fillCostZone(engine, active, 10);
    const tactic = findCard(engine, active, 'ST03-010');
    engine.zoneMgr.moveCard(tactic.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.dispatchAction({ type: 'PLAY_CARD', playerId: active, cardInstanceId: tactic.instanceId }).success).toBe(true);

    // 之后将 readyNow 横置，且新出场一张横置的<三头犬小队>角色，均不受 ST03-010 增益
    readyNow.isReady = false;
    const enteredLater = placeRole(engine, active, 'ST03-005', 2, [tappedNow.instanceId]);
    enteredLater.isReady = false;

    expect(engine.fieldMgr.calculateRoleEffectivePP(tappedNow.instanceId)).toBe(baseTapped + 1000);
    expect(engine.fieldMgr.calculateRoleEffectivePP(readyNow.instanceId)).toBe(baseReady);
    expect(engine.fieldMgr.calculateRoleEffectivePP(enteredLater.instanceId)).toBe(baseTapped);

    // 持续到下个回合结束为止：对方回合中仍有效，再过一回合失效
    endTurn(engine);
    expect(engine.fieldMgr.calculateRoleEffectivePP(tappedNow.instanceId)).toBe(baseTapped + 1000);
    endTurn(engine);
    expect(engine.fieldMgr.calculateRoleEffectivePP(tappedNow.instanceId)).toBe(baseTapped);
  });

  it('Q&A·4 (BP02-065 / 4.16.2 / 3.6.4 / 10.14.4): 【充能1】不增加基本充能数；非信号球不可消除；背面底球禁用暮/晖形态；费用满时伤害充能送墓仍侵蚀+1', () => {
    const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    // 1. BP02-065: setCharge=1 覆盖基本充能数 1，结果仍为 1 (不像 charge:+1 那样变为 2)
    const role = placeRole(engine, active, 'ST01-005', 0);
    expect(engine.combatMgr.calculateRoleChargeCount(role.instanceId)).toBe(1);
    addCardModifier(state, role, { setCharge: 1, untilTurn: state.turnNumber, source: 'BP02-065' });
    expect(engine.combatMgr.calculateRoleChargeCount(role.instanceId)).toBe(1);

    // 2. 4.16.2 / Q&A·4: 信号球区混入不带信号球标记的角色牌时，不能被 3 消
    const nonOrb = findCard(engine, active, 'ST01-006');
    const orb1 = findCard(engine, active, 'ST01-012');
    const orb2 = findCard(engine, active, 'ST01-013');
    engine.zoneMgr.moveCard(nonOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orb1.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(orb2.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    const elimRes = engine.dispatchAction({
      type: 'ELIMINATE_3_ORBS',
      playerId: active,
      orbCardInstanceIds: [nonOrb.instanceId, orb1.instanceId, orb2.instanceId],
    });
    expect(elimRes.success).toBe(false);

    // 3. 10.14.4 / Q&A·6: 信号球区最下方为背面牌时，暮形态与晖形态均无效 (失败行动回滚后会替换卡牌引用，按 ID 读取)
    state.cards[nonOrb.instanceId]!.isFaceUp = false;
    expect(engine.continuousEffects.isFormActive(active, '暮')).toBe(false);
    expect(engine.continuousEffects.isFormActive(active, '晖')).toBe(false);

    // 4. 3.6.4 / Q&A·4: 费用区已满 10 张时，伤害充能翻出的牌送入墓地而非费用区，且侵蚀仍 +1
    fillCostZone(engine, opp, 10);
    const erosionBefore = state.players[opp]!.erosionCount;
    const gyBefore = engine.zoneMgr.getCardsInZone(opp, 'GRAVEYARD').length;
    engine.zoneMgr.applyDamageToPlayer(opp, 1);
    expect(engine.zoneMgr.getCardsInZone(opp, 'COST')).toHaveLength(10);
    expect(engine.zoneMgr.getCardsInZone(opp, 'GRAVEYARD').length).toBe(gyBefore + 1);
    expect(state.players[opp]!.erosionCount).toBe(erosionBefore + 1);
  });

  it('Q&A·5 (BP01-001 / ST04-003 / 8.11.3 / 9.6.1): 升变先检条件再付费，条件不满足不消耗暗费；离场时下方牌立即送墓', () => {
    const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;

    // 费用区放 2 明费 + 2 暗费 = 费用上限 4 (< ST01-001 升变条件「费用上限5及以上」)
    fillCostZone(engine, active, 2);
    const deckCards = engine.zoneMgr.getCardsInZone(active, 'DECK').slice(0, 2);
    for (const c of deckCards) {
      engine.zoneMgr.moveCard(c.instanceId, 'COST', { isFaceUp: false, isReady: true });
    }
    engine.zoneMgr.syncCostStats(active);
    expect(state.players[active]!.totalCostCount).toBe(4);
    expect(state.players[active]!.hiddenCostCount).toBe(2);

    const baseLucia = placeRole(engine, active, 'ST01-005', 0); // 费用3 <露西亚>
    const ascLucia = findCard(engine, active, 'ST01-001');
    engine.zoneMgr.moveCard(ascLucia.instanceId, 'HAND', { isFaceUp: true });

    // 升变条件不满足 → 拒绝升变且暗费 1 张未动 (事务回滚 + 先查条件)
    const failAsc = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: active,
      cardInstanceId: ascLucia.instanceId,
      isAscension: true,
      targetAscensionCardId: baseLucia.instanceId,
    });
    expect(failAsc.success).toBe(false);
    expect(state.players[active]!.hiddenCostCount).toBe(2);

    // 补至费用上限 5 后升变成功，随后升变角色返回牌组底时下方牌立即送墓 (9.6.1 / ST04-003)
    fillCostZone(engine, active, 5);
    expect(
      engine.dispatchAction({
        type: 'PLAY_CARD',
        playerId: active,
        cardInstanceId: ascLucia.instanceId,
        isAscension: true,
        targetAscensionCardId: baseLucia.instanceId,
      }).success
    ).toBe(true);
    resolvePendingChoices(engine);
    expect(state.cards[ascLucia.instanceId]!.underneathCardIds).toContain(baseLucia.instanceId);

    engine.zoneMgr.moveCardToBottomOfDeck(ascLucia.instanceId);
    expect(state.cards[ascLucia.instanceId]!.zone).toBe('DECK');
    expect(state.cards[baseLucia.instanceId]!.zone).toBe('GRAVEYARD');
  });

  it('Q&A·6 (BP03-012 / BP03-034 / 7.4.1.b / 8.9.1.e): 「PP变为70」覆盖此前增减且卸装备继续扣减；费用减为负按0支付；充能次数锁定不受攻击者离场影响', () => {
    const engine = createEngine(expandDeck('ST02'), expandDeck('ST01'));
    const state = engine.getState();
    const active = state.activePlayerId;

    // 1. BP03-012: 装备 ST02-009 (+500 PP) + 效果 +1000 → 施加 setPP: 70 → 变为 70；之后再 +500 变为 570
    const luna = placeRole(engine, active, 'ST02-001', 0);
    const ozma = findCard(engine, active, 'ST02-009');
    engine.zoneMgr.moveCard(ozma.instanceId, 'PROCESSING', { isFaceUp: true });
    expect(engine.fieldMgr.equipToRole(active, ozma.instanceId, luna.instanceId)).toBe(true);
    addCardModifier(state, luna, { pp: 1000, untilTurn: state.turnNumber, source: 'PRE' });
    addCardModifier(state, luna, { setPP: 70, untilTurn: state.turnNumber, source: 'BP03-012' });
    expect(engine.fieldMgr.calculateRoleEffectivePP(luna.instanceId)).toBe(70);
    addCardModifier(state, luna, { pp: 500, untilTurn: state.turnNumber, source: 'POST' });
    expect(engine.fieldMgr.calculateRoleEffectivePP(luna.instanceId)).toBe(570);

    // 2. BP03-034: 费用减免超过卡牌基础费用时钳制为 0，不会变成负数
    const cheap = findCard(engine, active, 'ST02-005'); // 费用 2
    engine.zoneMgr.moveCard(cheap.instanceId, 'HAND', { isFaceUp: true });
    state.players[active]!.costModifiers = [
      { id: 'cm-over', amount: 10, cardType: CardType.ROLE, remainingCount: 1 },
    ];
    expect(engine.calculateCardCost(active, cheap.instanceId, false).costToPay).toBe(0);

    // 3. 7.4.1.b / Q&A·6 (BP03-023): 攻击充能次数在充能步骤开始时锁定，中途攻击者离场仍照常完成剩余充能
    const attacker = placeRole(engine, active, 'ST02-005', 1, [cheap.instanceId]);
    addCardModifier(state, attacker, { charge: 1, untilTurn: state.turnNumber, source: 'TEST_CHARGE2' }); // 总充能数 = 2
    // 牌组顶放入 1 张信号球 (暂停在第 1 次充能决策) + 1 张非信号球角色
    const orbTop = findCard(engine, active, 'ST02-012');
    const secondCard = findCard(engine, active, 'ST02-002');
    engine.zoneMgr.moveCardToTopOfDeck(secondCard.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(orbTop.instanceId);

    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: active,
        attackerCardId: attacker.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    passInstantWindows(engine);
    // 第 1 次充能翻出 ST02-012 暂停在充能自选择，此时攻击角色离场
    expect(state.phase).toBe('COMBAT_CHARGE');
    expect(state.currentPendingChoice?.effectType).toBe('SIGNATURE_MOVE_EFFECT');
    engine.zoneMgr.moveCard(attacker.instanceId, 'GRAVEYARD', { isFaceUp: true });
    expect(state.cards[attacker.instanceId]!.zone).toBe('GRAVEYARD');

    // 完成第 1 次充能选择后，第 2 次充能 (secondCard) 依然照常执行并加入手牌
    resolvePendingChoices(engine);
    expect(state.cards[secondCard.instanceId]!.zone).toBe('HAND');
  });

  it('Q&A·7 & Q&A·8 (12.4): 单独占位的装备不能被攻击；阻挡宣言后不再开启第二轮【瞬时】窗口', () => {
    const engine = createEngine(expandDeck('ST01'), expandDeck('ST02'));
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    const attacker = placeRole(engine, active, 'ST01-005', 0);
    // 对手放置单独占卡位的横置装备 ST02-009
    const standaloneEquip = findCard(engine, opp, 'ST02-009');
    engine.zoneMgr.moveCard(standaloneEquip.instanceId, 'HAND', { isFaceUp: true });
    expect(engine.fieldMgr.playStandaloneEquipment(opp, standaloneEquip.instanceId, 0)).toBe(true);
    standaloneEquip.isReady = false;

    // Q&A·7 / 12.4: 不能选择单独占位的装备作为攻击对象
    const badAtk = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: active,
      attackerCardId: attacker.instanceId,
      targetType: 'CHARACTER',
      targetCardId: standaloneEquip.instanceId,
    });
    expect(badAtk.success).toBe(false);

    // Q&A·8 / 12.4: 自由时点双方放弃后由被攻击方阻挡，阻挡后直接进入充能步骤，不再开瞬时窗口
    const blocker = placeRole(engine, opp, 'ST02-001', 1);
    const instant = findCard(engine, opp, 'ST02-011');
    engine.zoneMgr.moveCard(instant.instanceId, 'HAND', { isFaceUp: true });
    fillCostZone(engine, opp, 10);

    // 牌组顶放非信号球避免额外充能选择
    const nonOrb = engine.zoneMgr.getCardsInZone(active, 'DECK').find((c) => !db.getCard(c.cardNumber)?.signalOrb)!;
    engine.zoneMgr.moveCardToTopOfDeck(nonOrb.instanceId);

    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: active,
        attackerCardId: attacker.instanceId,
        targetType: 'PLAYER',
      }).success
    ).toBe(true);
    expect(state.timingWindow?.kind).toBe('FREE_TIMING');
    passInstantWindows(engine);
    expect(state.currentCombat?.step).toBe('BLOCK');

    // 宣告阻挡后直接推进完成充能与角色战斗，绝不会再进入 timingWindow
    expect(
      engine.dispatchAction({
        type: 'DECLARE_BLOCK',
        playerId: opp,
        blockerCardId: blocker.instanceId,
      }).success
    ).toBe(true);
    expect(state.timingWindow).toBeUndefined();
    expect(state.currentCombat).toBeUndefined();
  });

  it('Q&A·10 (BP04-012 / 9.3.1.a / ST02-008): 自伤效果使己方侵蚀达到 7 时立即在检查时机败北', () => {
    const engine = createEngine(expandDeck('ST02'), expandDeck('ST01'));
    const state = engine.getState();
    const active = state.activePlayerId;
    const opp = state.nonActivePlayerId;

    const daughter = placeRole(engine, active, 'ST02-008', 0);
    const orb = findCard(engine, active, 'ST02-012');
    engine.zoneMgr.moveCard(orb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    state.players[active]!.erosionCount = 6;

    // 发动苦刑之女【起】，选择侵蚀+1 → 侵蚀达到 7 → 9.3.1.a 立即判负
    expect(
      engine.dispatchAction({
        type: 'ACTIVATE_ABILITY',
        playerId: active,
        sourceCardId: daughter.instanceId,
      }).success
    ).toBe(true);
    const choice = state.currentPendingChoice!;
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: active,
        pendingChoiceId: choice.id,
        selectedIds: ['opt_yes'],
      }).success
    ).toBe(true);

    expect(state.players[active]!.erosionCount).toBe(7);
    expect(state.status).toBe('FINISHED');
    expect(state.winnerId).toBe(opp);
  });
});
