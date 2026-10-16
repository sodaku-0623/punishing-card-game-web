import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/engine.js';
import { MemoryCardDatabase, OFFICIAL_CARDS_DATA } from '../src/database/card-registry.js';
import type { CardInstance } from '@zhanshuang/shared';
import { endTurn, fillCostZone, passInstantWindows, resolvePendingChoices } from './helpers.js';

/**
 * 流程挂起/恢复与轮流使用瞬时的时机：
 * 攻击充能、伤害充能中的玩家选择会暂停攻击流程，选择完毕后从原位置继续；
 * 自由时点步骤与结束阶段由持有优先权的玩家轮流使用或放弃【瞬时】。
 */

const cardDb = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);

const ST01_DECK = [
  ...Array(4).fill('ST01-012'), ...Array(4).fill('ST01-013'), ...Array(4).fill('ST01-014'),
  'ST01-001', ...Array(4).fill('ST01-002'), ...Array(4).fill('ST01-003'), ...Array(4).fill('ST01-004'),
  ...Array(4).fill('ST01-005'), ...Array(4).fill('ST01-006'), ...Array(4).fill('ST01-007'),
  ...Array(2).fill('ST01-008'), ...Array(2).fill('ST01-009'), ...Array(4).fill('ST01-010'),
  ...Array(4).fill('ST01-011'), 'ST01-001',
];

const ST02_DECK = [
  ...Array(4).fill('ST02-012'), ...Array(4).fill('ST02-013'), ...Array(4).fill('ST02-014'),
  ...Array(4).fill('ST02-001'), ...Array(2).fill('ST02-002'), ...Array(4).fill('ST02-003'),
  ...Array(4).fill('ST02-004'), ...Array(4).fill('ST02-005'), ...Array(4).fill('ST02-006'),
  ...Array(4).fill('ST02-007'), ...Array(2).fill('ST02-008'), ...Array(2).fill('ST02-009'),
  ...Array(4).fill('ST02-010'), ...Array(4).fill('ST02-011'),
];

function setup(seed = 5): { engine: GameEngine; p1: string; p2: string } {
  const engine = new GameEngine(
    `game-flow-${seed}`,
    { playerId: 'p1', deckCardNumbers: ST01_DECK },
    { playerId: 'p2', deckCardNumbers: ST02_DECK },
    seed,
    cardDb
  );
  // 固定由 p1 先攻，便于构造局面
  const state = engine.getState();
  if (state.activePlayerId !== 'p1') {
    state.activePlayerId = 'p1';
    state.nonActivePlayerId = 'p2';
    state.priorityPlayerId = 'p1';
  }
  engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p1' });
  expect(state.phase).toBe('MAIN_PHASE');
  // 清空双方手牌，按需要放入
  for (const c of Object.values(state.cards)) {
    if (c.zone === 'HAND') engine.zoneMgr.moveCard(c.instanceId, 'DECK', { isFaceUp: false });
  }
  return { engine, p1: 'p1', p2: 'p2' };
}

function pick(engine: GameEngine, playerId: string, cardNumber: string): CardInstance {
  const card = Object.values(engine.getState().cards).find(
    (c) => c.controllerPlayerId === playerId && c.cardNumber === cardNumber && c.zone !== 'BATTLEFIELD'
  );
  if (!card) throw new Error(`找不到 ${playerId} 的 ${cardNumber}`);
  return card;
}

function placeRole(engine: GameEngine, playerId: string, cardNumber: string, slot: number): CardInstance {
  const card = pick(engine, playerId, cardNumber);
  expect(engine.fieldMgr.playRoleCard(playerId, card.instanceId, slot)).toBe(true);
  card.turnEnteredZone = 0;
  return card;
}

function putOnDeckTop(engine: GameEngine, playerId: string, cardNumber: string): CardInstance {
  const card = pick(engine, playerId, cardNumber);
  engine.zoneMgr.moveCardToTopOfDeck(card.instanceId);
  return card;
}

describe('攻击流程的挂起与恢复', () => {
  it('攻击充能翻出信号球时暂停，选择「DP+1」后本次攻击的伤害随之增加', () => {
    const { engine, p1, p2 } = setup();
    const state = engine.getState();
    const attacker = placeRole(engine, p1, 'ST01-002', 0); // 里·异火 DP 1
    putOnDeckTop(engine, p1, 'ST01-012'); // 红色信号球：充能自 DP+1 / PP+2000
    // 守方牌组顶放非信号球，避免伤害充能也产生选择
    putOnDeckTop(engine, p2, 'ST02-005');
    const nextDamageCard = pick(engine, p2, 'ST02-002');
    engine.zoneMgr.moveCardToTopOfDeck(nextDamageCard.instanceId);
    const erosionBefore = state.players[p2]!.erosionCount;

    engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: p1, attackerCardId: attacker.instanceId, targetType: 'PLAYER' });
    passInstantWindows(engine);

    // 守方战场没有角色，自动不阻挡；攻击充能翻出信号球后暂停在充能步骤
    const choice = state.currentPendingChoice;
    expect(choice?.effectType).toBe('SIGNATURE_MOVE_EFFECT');
    expect(state.currentCombat?.step).toBe('CHARGE');
    expect(state.players[p2]!.erosionCount).toBe(erosionBefore);
    // 处理完毕前，信号球仍在处理区 (4.12.2.a)
    expect(state.cards[state.currentCombat!.pendingChargeCardId!]!.zone).toBe('PROCESSING');

    engine.dispatchAction({ type: 'SELECT_CHOICE_OPTION', playerId: p1, pendingChoiceId: choice!.id, selectedIds: ['opt_dp_plus_1'] });
    const targetChoice = state.currentPendingChoice!;
    expect(targetChoice.effectType).toBe('SELECT_ROLE_FOR_CHARGE_BUFF');
    engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: p1,
      pendingChoiceId: targetChoice.id,
      selectedIds: [attacker.instanceId],
    });

    // DP 1 + 1 = 2 点伤害，攻击结束
    expect(state.currentCombat).toBeUndefined();
    expect(state.phase).toBe('MAIN_PHASE');
    expect(state.players[p2]!.erosionCount).toBe(erosionBefore + 2);
    expect(engine.zoneMgr.getCardsInZone(p1, 'SIGNAL_ORB').some((c) => c.cardNumber === 'ST01-012')).toBe(true);
  });

  it('伤害充能翻出信号球时暂停，选择处理完毕后才放入费用区并增加侵蚀计数', () => {
    const { engine, p1, p2 } = setup(6);
    const state = engine.getState();
    const attacker = placeRole(engine, p1, 'ST01-005', 0); // 露西亚·红莲 DP 0 → 改用 DP 1 的角色
    engine.zoneMgr.moveCard(attacker.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const realAttacker = placeRole(engine, p1, 'ST01-004', 1); // 【充能0】DP 1：不进行攻击充能
    const damageOrb = putOnDeckTop(engine, p2, 'ST02-014'); // 黄色信号球
    const erosionBefore = state.players[p2]!.erosionCount;

    engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: p1, attackerCardId: realAttacker.instanceId, targetType: 'PLAYER' });
    passInstantWindows(engine);

    const choice = state.currentPendingChoice;
    expect(choice?.playerId).toBe(p2);
    expect(state.currentCombat?.step).toBe('DAMAGE');
    expect(state.cards[damageOrb.instanceId]!.zone).toBe('PROCESSING');
    expect(state.players[p2]!.erosionCount).toBe(erosionBefore);

    // 攻方在守方处理选择期间不能行动
    expect(engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: p1 }).success).toBe(false);

    resolvePendingChoices(engine);
    expect(state.cards[damageOrb.instanceId]!.zone).toBe('COST');
    expect(state.cards[damageOrb.instanceId]!.isFaceUp).toBe(false);
    expect(state.players[p2]!.erosionCount).toBe(erosionBefore + 1);
    expect(state.currentCombat).toBeUndefined();
  });

  it('攻击流程暂停时导出的快照可以恢复并继续', () => {
    const { engine, p1, p2 } = setup(7);
    const state = engine.getState();
    const attacker = placeRole(engine, p1, 'ST01-002', 0);
    putOnDeckTop(engine, p1, 'ST01-013'); // 蓝色信号球：抽 1 / PP+2000
    putOnDeckTop(engine, p2, 'ST02-005');

    engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: p1, attackerCardId: attacker.instanceId, targetType: 'PLAYER' });
    passInstantWindows(engine);
    expect(state.currentCombat?.step).toBe('CHARGE');

    const restored = GameEngine.fromSnapshot(engine.toSnapshot(), cardDb);
    const choice = restored.getState().currentPendingChoice!;
    const erosionBefore = restored.getState().players[p2]!.erosionCount;
    expect(
      restored.dispatchAction({ type: 'SELECT_CHOICE_OPTION', playerId: p1, pendingChoiceId: choice.id, selectedIds: ['opt_draw_1'] })
        .success
    ).toBe(true);
    resolvePendingChoices(restored);
    expect(restored.getState().currentCombat).toBeUndefined();
    expect(restored.getState().players[p2]!.erosionCount).toBe(erosionBefore + 1);
  });
});

describe('轮流使用【瞬时】', () => {
  /** 守方 p2：战场有《露娜·银冕》，墓地有费用 3 以下的<升格者>，手牌有《筛选开始》且费用足够 */
  function setupWithInstant(seed = 8) {
    const ctx = setup(seed);
    const { engine, p2 } = ctx;
    placeRole(engine, p2, 'ST02-001', 0);
    const gyRole = pick(engine, p2, 'ST02-005');
    engine.zoneMgr.moveCard(gyRole.instanceId, 'GRAVEYARD', { isFaceUp: true });
    const instant = pick(engine, p2, 'ST02-011');
    engine.zoneMgr.moveCard(instant.instanceId, 'HAND', { isFaceUp: true });
    // 明费需要暗属性以满足属性条件
    const darkCost = pick(engine, p2, 'ST02-003');
    engine.zoneMgr.moveCard(darkCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    fillCostZone(engine, p2, 4);
    return { ...ctx, instant, gyRole };
  }

  it('被攻击的玩家持有可用的瞬时时，自由时点等待其选择；回合玩家没有瞬时则自动放弃', () => {
    const { engine, p1, p2, instant, gyRole } = setupWithInstant();
    const state = engine.getState();
    const attacker = placeRole(engine, p1, 'ST01-006', 1);
    putOnDeckTop(engine, p1, 'ST01-005');

    engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: p1, attackerCardId: attacker.instanceId, targetType: 'PLAYER' });
    expect(state.timingWindow).toMatchObject({ kind: 'FREE_TIMING', priorityPlayerId: p2 });

    // 不持有优先权的玩家不能使用或放弃，也不能宣告阻挡
    expect(engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: p1 }).success).toBe(false);
    expect(engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: p2 }).success).toBe(false);

    // 守方使用《筛选开始》：从墓地出场费用 3 以下的<升格者>
    const use = engine.dispatchAction({ type: 'USE_INSTANT', playerId: p2, cardInstanceId: instant.instanceId });
    expect(use.success).toBe(true);
    const choice = state.currentPendingChoice!;
    expect(choice.effectType).toBe('RESURRECT_ROLE');
    engine.dispatchAction({ type: 'SELECT_CHOICE_OPTION', playerId: p2, pendingChoiceId: choice.id, selectedIds: [gyRole.instanceId] });
    expect(state.cards[gyRole.instanceId]!.zone).toBe('BATTLEFIELD');

    // 使用后轮到攻方；攻方没有瞬时自动放弃，再轮到守方 (手牌已无瞬时，自动放弃) → 进入阻挡宣言
    expect(state.timingWindow).toBeUndefined();
    expect(state.currentCombat?.step).toBe('BLOCK');
    expect(engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: p2 }).success).toBe(true);
    resolvePendingChoices(engine);
    expect(state.currentCombat).toBeUndefined();
  });

  it('【瞬时】不能在主要阶段使用，时机条件不满足时也不能使用', () => {
    const { engine, p1 } = setup(9);
    const state = engine.getState();
    // p1 手牌放入 p2 牌组里没有的瞬时：改为直接给 p1 一张 ST02-011 实例
    const instantCard = Object.values(state.cards).find((c) => c.cardNumber === 'ST02-011')!;
    instantCard.controllerPlayerId = p1;
    engine.zoneMgr.moveCard(instantCard.instanceId, 'HAND', { isFaceUp: true });
    fillCostZone(engine, p1, 6);
    const res = engine.dispatchAction({ type: 'PLAY_CARD', playerId: p1, cardInstanceId: instantCard.instanceId });
    expect(res.success).toBe(false);
    expect(res.error).toContain('10.8');
  });

  it('回合外玩家不能代替回合玩家结束主要阶段或放弃填充明费', () => {
    const { engine, p2 } = setup(10);
    const state = engine.getState();
    const res = engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: p2 });
    expect(res.success).toBe(false);
    expect(state.phase).toBe('MAIN_PHASE');
    expect(state.activePlayerId).toBe('p1');
  });
});

describe('结束阶段', () => {
  it('手牌超过 7 张时由回合玩家选择弃掉的手牌 (6.5.1.c)', () => {
    const { engine, p1 } = setup(11);
    const state = engine.getState();
    const deck = engine.zoneMgr.getCardsInZone(p1, 'DECK').slice(0, 9);
    for (const c of deck) engine.zoneMgr.moveCard(c.instanceId, 'HAND', { isFaceUp: true });

    engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: p1 });
    passInstantWindows(engine);
    const choice = state.currentPendingChoice!;
    expect(choice.effectType).toBe('END_PHASE_DISCARD');
    expect(choice.minSelections).toBe(2);
    expect(state.endPhaseStep).toBe('DISCARD');

    // 数量不对或选择非手牌被拒绝
    expect(
      engine.dispatchAction({ type: 'SELECT_CHOICE_OPTION', playerId: p1, pendingChoiceId: choice.id, selectedIds: [deck[0]!.instanceId] })
        .success
    ).toBe(false);

    const chosen = [deck[3]!.instanceId, deck[5]!.instanceId];
    expect(
      engine.dispatchAction({ type: 'SELECT_CHOICE_OPTION', playerId: p1, pendingChoiceId: choice.id, selectedIds: chosen }).success
    ).toBe(true);
    for (const id of chosen) expect(state.cards[id]!.zone).toBe('GRAVEYARD');
    expect(engine.zoneMgr.getCardsInZone(p1, 'HAND').length).toBe(7);
    expect(state.activePlayerId).toBe('p2');
    expect(state.phase).toBe('DRAW_CHARGE_PHASE');
  });

  it('结束阶段由回合玩家开始轮流使用瞬时；双方都没有瞬时时直接进入下一回合', () => {
    const { engine } = setup(12);
    const state = engine.getState();
    const turn = state.turnNumber;
    endTurn(engine);
    expect(state.turnNumber).toBe(turn + 1);
    expect(state.activePlayerId).toBe('p2');
    expect(state.timingWindow).toBeUndefined();
  });
});
