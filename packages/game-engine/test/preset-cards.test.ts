import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/engine.js';
import { MemoryCardDatabase, OFFICIAL_CARDS_DATA } from '../src/database/card-registry.js';
import type { CardInstance } from '@zhanshuang/shared';
import { endTurn, passInstantWindows, resolvePendingChoices } from './helpers.js';

/**
 * 官方预组 ST01 (灰鸦小队)、ST02 (升格者)、ST03 (三头犬小队) 的逐卡效果，按卡牌文本逐条验证。
 */

const cardDb = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);

const ALL_PRESET_NUMBERS = ['ST01', 'ST02', 'ST03'].flatMap((set) =>
  Array.from({ length: 14 }, (_, i) => `${set}-${String(i + 1).padStart(3, '0')}`)
);
// 每种卡牌 2 张，便于构造局面；另加填充费用区用的卡牌
const COST_FILLER = 'BP01-010';
const DECK = [...ALL_PRESET_NUMBERS, ...ALL_PRESET_NUMBERS, ...Array(10).fill(COST_FILLER)];

function setup(seed = 11): { engine: GameEngine; state: ReturnType<GameEngine['getState']> } {
  const engine = new GameEngine(
    `game-preset-${seed}`,
    { playerId: 'p1', deckCardNumbers: DECK },
    { playerId: 'p2', deckCardNumbers: DECK },
    seed,
    cardDb
  );
  const state = engine.getState();
  if (state.activePlayerId !== 'p1') {
    state.activePlayerId = 'p1';
    state.nonActivePlayerId = 'p2';
    state.priorityPlayerId = 'p1';
  }
  engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p1' });
  expect(state.phase).toBe('MAIN_PHASE');
  for (const c of Object.values(state.cards)) {
    if (c.zone === 'HAND' || c.zone === 'SIGNAL_ORB' || c.zone === 'GRAVEYARD' || c.zone === 'COST') {
      engine.zoneMgr.moveCard(c.instanceId, 'DECK', { isFaceUp: false });
    }
  }
  giveCost(engine, 'p1');
  return { engine, state };
}

/** 费用区放入物理与暗属性明费各1张，共 10 张竖直明费 */
function giveCost(engine: GameEngine, playerId: string): void {
  for (const num of ['ST01-007', 'ST03-007', ...Array(8).fill(COST_FILLER)]) {
    engine.zoneMgr.moveCard(pick(engine, playerId, num).instanceId, 'COST', { isFaceUp: true, isReady: true });
  }
  engine.zoneMgr.syncCostStats(playerId);
}

function pick(engine: GameEngine, playerId: string, cardNumber: string, zone?: CardInstance['zone']): CardInstance {
  const card = Object.values(engine.getState().cards).find(
    (c) =>
      c.controllerPlayerId === playerId &&
      c.cardNumber === cardNumber &&
      (zone ? c.zone === zone : c.zone === 'DECK')
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

function toHand(engine: GameEngine, playerId: string, cardNumber: string): CardInstance {
  const card = pick(engine, playerId, cardNumber);
  engine.zoneMgr.moveCard(card.instanceId, 'HAND', { isFaceUp: true });
  return card;
}

function toGraveyard(engine: GameEngine, playerId: string, cardNumber: string): CardInstance {
  const card = pick(engine, playerId, cardNumber);
  engine.zoneMgr.moveCard(card.instanceId, 'GRAVEYARD', { isFaceUp: true });
  return card;
}

function putOnDeckTop(engine: GameEngine, playerId: string, cardNumber: string): CardInstance {
  const card = pick(engine, playerId, cardNumber);
  engine.zoneMgr.moveCardToTopOfDeck(card.instanceId);
  return card;
}

/** 按从下到上的顺序放置信号球区 */
function setOrbs(engine: GameEngine, playerId: string, numbers: string[]): CardInstance[] {
  return numbers.map((num) => {
    const card = pick(engine, playerId, num);
    engine.zoneMgr.moveCard(card.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    return card;
  });
}

function play(engine: GameEngine, card: CardInstance, extra: Record<string, unknown> = {}) {
  return engine.dispatchAction({ type: 'PLAY_CARD', playerId: card.controllerPlayerId, cardInstanceId: card.instanceId, ...extra });
}

function choose(engine: GameEngine, selectedIds: string[]) {
  const choice = engine.getState().currentPendingChoice;
  if (!choice) throw new Error('没有待处理的决策');
  return engine.dispatchAction({ type: 'SELECT_CHOICE_OPTION', playerId: choice.playerId, pendingChoiceId: choice.id, selectedIds });
}

function eligibleIds(engine: GameEngine): string[] {
  return engine
    .getState()
    .currentPendingChoice!.options.filter((o) => (o.payload as { eligible?: boolean } | undefined)?.eligible !== false)
    .map((o) => o.id);
}

/** 失败的行动会整体回滚并替换卡牌对象，断言时按 ID 读取最新状态 */
const at = (engine: GameEngine, card: CardInstance) => engine.getState().cards[card.instanceId]!;
const pp = (engine: GameEngine, card: CardInstance) => engine.fieldMgr.calculateRoleEffectivePP(card.instanceId);
const dp = (engine: GameEngine, card: CardInstance) => engine.fieldMgr.calculateRoleEffectiveDP(card.instanceId);
const zone = (engine: GameEngine, playerId: string, z: CardInstance['zone']) => engine.zoneMgr.getCardsInZone(playerId, z);

// =====================================================================
// ST01 灰鸦小队
// =====================================================================
describe('ST01 灰鸦小队', () => {
  it('ST01-001 露西亚·红莲【出】丢弃1张手牌：公开牌组顶5张，费用3及以下的<灰鸦小队>角色出场，其余置于牌组底', () => {
    const { engine, state } = setup();
    const lucia = toHand(engine, 'p1', 'ST01-001');
    const fodder = toHand(engine, 'p1', 'ST02-005');
    const top = ['ST01-004', 'ST01-006', 'ST02-004', 'ST01-012', 'ST03-005'].reverse().map((n) => putOnDeckTop(engine, 'p1', n));
    const [cheap, expensive] = [top[4]!, top[3]!];

    expect(play(engine, lucia).success).toBe(true);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_DISCARD_COST');
    expect(choose(engine, [fodder.instanceId]).success).toBe(true);
    expect(at(engine, fodder).zone).toBe('GRAVEYARD');

    // 公开的 5 张进入处理区；费用 7 的露西亚不可选
    expect(top.every((c) => at(engine, c).zone === 'PROCESSING')).toBe(true);
    expect(eligibleIds(engine)).toEqual([cheap.instanceId]);
    expect(choose(engine, [expensive.instanceId]).success).toBe(false);
    expect(choose(engine, [cheap.instanceId]).success).toBe(true);

    expect(at(engine, cheap).zone).toBe('BATTLEFIELD');
    const deck = zone(engine, 'p1', 'DECK');
    expect(deck.slice(-4).map((c) => c.instanceId).sort()).toEqual(
      top.filter((c) => c !== cheap).map((c) => c.instanceId).sort()
    );
  });

  it('ST01-001【出】不支付丢弃代价时不公开任何牌', () => {
    const { engine, state } = setup();
    const lucia = toHand(engine, 'p1', 'ST01-001');
    toHand(engine, 'p1', 'ST02-005');
    const deckBefore = zone(engine, 'p1', 'DECK').length;
    play(engine, lucia);
    expect(choose(engine, []).success).toBe(true);
    expect(state.currentPendingChoice).toBeUndefined();
    expect(zone(engine, 'p1', 'DECK').length).toBe(deckBefore);
    expect(zone(engine, 'p1', 'PROCESSING')).toHaveLength(0);
  });

  it('ST01-001【起】消除2蓝色信号球：我方1张角色返回手牌，若如此做，手牌1张费用4及以下的<灰鸦小队>角色出场', () => {
    const { engine, state } = setup();
    const lucia = placeRole(engine, 'p1', 'ST01-001', 0);
    const bounced = placeRole(engine, 'p1', 'ST01-006', 1);
    const deployable = toHand(engine, 'p1', 'ST01-002');
    toHand(engine, 'p1', 'ST01-006'); // 费用 7，不可出场

    // 没有相邻的2张蓝色信号球时不能发动 (8.4.2.b)
    setOrbs(engine, 'p1', ['ST01-013', 'ST01-012', 'ST02-013']);
    expect(engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: lucia.instanceId }).success).toBe(false);

    const blues = setOrbs(engine, 'p1', ['ST03-013']); // 现在 ST02-013 与 ST03-013 相邻
    expect(engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: lucia.instanceId }).success).toBe(true);
    expect(at(engine, blues[0]!).zone).toBe('GRAVEYARD');
    expect(zone(engine, 'p1', 'SIGNAL_ORB')).toHaveLength(2);

    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST01_001_BOUNCE');
    expect(choose(engine, [bounced.instanceId]).success).toBe(true);
    expect(at(engine, bounced).zone).toBe('HAND');

    expect(state.currentPendingChoice?.effectType).toBe('PRESET_DEPLOY');
    expect(state.currentPendingChoice!.options.map((o) => o.id)).toEqual([deployable.instanceId]);
    expect(choose(engine, [deployable.instanceId]).success).toBe(true);
    expect(at(engine, deployable).zone).toBe('BATTLEFIELD');
    // 出场的里·异火触发自身的【出】
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST01_002_MILL');
  });

  it('ST01-002 里·异火【出】将牌组顶3张放置到墓地，其中有信号球时<灰鸦小队>角色获得【充能+1】直到回合结束', () => {
    const { engine, state } = setup();
    const ally = placeRole(engine, 'p1', 'ST01-004', 0);
    placeRole(engine, 'p2', 'ST03-005', 0);
    const li = toHand(engine, 'p1', 'ST01-002');
    putOnDeckTop(engine, 'p1', 'ST03-005');
    putOnDeckTop(engine, 'p1', 'ST01-013');
    putOnDeckTop(engine, 'p1', 'ST02-005');

    play(engine, li);
    expect(choose(engine, ['opt_yes']).success).toBe(true);
    expect(zone(engine, 'p1', 'GRAVEYARD')).toHaveLength(3);
    // 只能选择我方<灰鸦小队>角色
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST01_002_CHARGE');
    expect(state.currentPendingChoice!.options.map((o) => o.id).sort()).toEqual([ally.instanceId, li.instanceId].sort());
    expect(choose(engine, [ally.instanceId]).success).toBe(true);
    // ST01-004 自身为【充能0】，【充能+1】在其基础上增加 (10.4)
    expect(engine.combatMgr.calculateRoleChargeCount(ally.instanceId)).toBe(1);

    endTurn(engine);
    expect(engine.combatMgr.calculateRoleChargeCount(ally.instanceId)).toBe(0);
  });

  it('ST01-002【出】可以不放置；放置的3张中没有信号球时不产生选择', () => {
    const { engine, state } = setup();
    const li = toHand(engine, 'p1', 'ST01-002');
    ['ST01-004', 'ST02-004', 'ST03-004'].forEach((n) => putOnDeckTop(engine, 'p1', n));
    play(engine, li);
    choose(engine, ['opt_no']);
    expect(zone(engine, 'p1', 'GRAVEYARD')).toHaveLength(0);

    const li2 = toHand(engine, 'p1', 'ST01-002');
    play(engine, li2);
    choose(engine, ['opt_yes']);
    expect(zone(engine, 'p1', 'GRAVEYARD')).toHaveLength(3);
    expect(state.currentPendingChoice).toBeUndefined();
  });

  it('ST01-003 丽芙·蚀暗【出】墓地1张信号球放置到信号球区最上方', () => {
    const { engine, state } = setup();
    setOrbs(engine, 'p1', ['ST01-012']);
    const orb = toGraveyard(engine, 'p1', 'ST01-014');
    toGraveyard(engine, 'p1', 'ST02-004');
    play(engine, toHand(engine, 'p1', 'ST01-003'));
    expect(state.currentPendingChoice!.options.map((o) => o.id)).toEqual([orb.instanceId]);
    choose(engine, [orb.instanceId]);
    expect(zone(engine, 'p1', 'SIGNAL_ORB').at(-1)?.instanceId).toBe(orb.instanceId);
  });

  it('ST01-005 露西亚·红莲【出】抽1张牌，丢弃1张手牌', () => {
    const { engine, state } = setup();
    const drawn = putOnDeckTop(engine, 'p1', 'ST03-004');
    play(engine, toHand(engine, 'p1', 'ST01-005'));
    expect(at(engine, drawn).zone).toBe('HAND');
    expect(state.currentPendingChoice?.minSelections).toBe(1);
    choose(engine, [drawn.instanceId]);
    expect(at(engine, drawn).zone).toBe('GRAVEYARD');
  });

  it('预组中没有【出】的角色出场时不执行任何效果', () => {
    const { engine, state } = setup();
    const handBefore = zone(engine, 'p1', 'HAND').length;
    play(engine, toHand(engine, 'p1', 'ST01-004'));
    expect(state.currentPendingChoice).toBeUndefined();
    expect(zone(engine, 'p1', 'HAND').length).toBe(handBefore);
  });

  it('ST01-009 阿呆蛙与铃铛羊：抽1张牌，<灰鸦小队>角色PP+2000直到回合结束', () => {
    const { engine, state } = setup();
    const crow = placeRole(engine, 'p1', 'ST01-004', 0);
    placeRole(engine, 'p1', 'ST02-004', 1);
    const tactic = toHand(engine, 'p1', 'ST01-009');
    const handBefore = zone(engine, 'p1', 'HAND').length;

    expect(play(engine, tactic).success).toBe(true);
    expect(zone(engine, 'p1', 'HAND').length).toBe(handBefore); // 打出1张、抽1张
    expect(state.currentPendingChoice!.options.map((o) => o.id)).toEqual([crow.instanceId]);
    choose(engine, [crow.instanceId]);
    expect(pp(engine, crow)).toBe(5000);
    // 下发给前端的展示数值随之更新
    expect(at(engine, crow).effectivePP).toBe(5000);
    expect(at(engine, tactic).zone).toBe('GRAVEYARD');

    endTurn(engine);
    expect(pp(engine, crow)).toBe(3000);
  });

  it('ST01-010 灰鸦小队，集合！：公开5张选1张<灰鸦小队>角色加入手牌，其余置于牌组底；不能选择不符合条件的牌', () => {
    const { engine, state } = setup();
    const top = ['ST01-007', 'ST01-009', 'ST02-004', 'ST01-012', 'ST03-005'].reverse().map((n) => putOnDeckTop(engine, 'p1', n));
    const role = top[4]!;
    const crowTactic = top[3]!;
    const tactic = toHand(engine, 'p1', 'ST01-010');
    play(engine, tactic);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST01_010_PICK');
    // <灰鸦小队>战术牌不是角色，不能选择
    expect(choose(engine, [crowTactic.instanceId]).success).toBe(false);
    expect(choose(engine, [role.instanceId]).success).toBe(true);
    expect(at(engine, role).zone).toBe('HAND');
    expect(at(engine, tactic).zone).toBe('GRAVEYARD');
    expect(zone(engine, 'p1', 'PROCESSING')).toHaveLength(0);
    expect(zone(engine, 'p1', 'DECK').slice(-4).map((c) => c.instanceId).sort()).toEqual(
      top.slice(0, 4).map((c) => c.instanceId).sort()
    );
  });

  it('ST01-010：公开的牌中没有<灰鸦小队>角色时，确认后全部置于牌组底', () => {
    const { engine, state } = setup();
    const top = ['ST02-004', 'ST02-005', 'ST03-004', 'ST03-005', 'ST02-012'].map((n) => putOnDeckTop(engine, 'p1', n));
    play(engine, toHand(engine, 'p1', 'ST01-010'));
    expect(state.currentPendingChoice?.minSelections).toBe(0);
    expect(choose(engine, []).success).toBe(true);
    expect(top.every((c) => at(engine, c).zone === 'DECK')).toBe(true);
    expect(zone(engine, 'p1', 'PROCESSING')).toHaveLength(0);
  });

  it('ST01-011 重逢：需要我方<露西亚>角色；只能破坏PP为8000及以下的角色', () => {
    const { engine, state } = setup();
    const tactic = toHand(engine, 'p1', 'ST01-011');
    const weak = placeRole(engine, 'p2', 'ST02-001', 0); // 6000
    const strong = placeRole(engine, 'p2', 'ST02-002', 1); // 8000
    strong.modifiers = [{ pp: 500, untilTurn: 99 }];
    expect(play(engine, tactic).success).toBe(false);
    expect(at(engine, tactic).zone).toBe('HAND');

    placeRole(engine, 'p1', 'ST01-004', 0);
    expect(play(engine, tactic).success).toBe(true);
    expect(eligibleIds(engine)).toEqual([weak.instanceId]);
    expect(choose(engine, [strong.instanceId]).success).toBe(false);
    choose(engine, [weak.instanceId]);
    expect(at(engine, weak).zone).toBe('GRAVEYARD');
    expect(at(engine, tactic).zone).toBe('GRAVEYARD');
    expect(state.currentPendingChoice).toBeUndefined();
  });
});

// =====================================================================
// ST02 升格者
// =====================================================================
describe('ST02 升格者', () => {
  it('ST02-001 露娜·银冕【永】侵蚀计数5及以上时所有<升格者>角色PP+1000', () => {
    const { engine, state } = setup();
    placeRole(engine, 'p1', 'ST02-001', 0);
    const ally = placeRole(engine, 'p1', 'ST02-005', 1);
    const other = placeRole(engine, 'p1', 'ST01-004', 2);
    state.players.p1!.erosionCount = 4;
    expect(pp(engine, ally)).toBe(3000);
    state.players.p1!.erosionCount = 5;
    expect(pp(engine, ally)).toBe(4000);
    expect(pp(engine, other)).toBe(3000);
  });

  it('ST02-001【起】【回合1】消除2蓝色信号球：墓地1张费用4及以下的<升格者>角色出场', () => {
    const { engine, state } = setup();
    const luna = placeRole(engine, 'p1', 'ST02-001', 0);
    const revive = toGraveyard(engine, 'p1', 'ST02-007');
    toGraveyard(engine, 'p1', 'ST02-006'); // 费用 5
    setOrbs(engine, 'p1', ['ST01-013', 'ST02-013', 'ST03-013', 'ST01-013']);

    expect(engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: luna.instanceId }).success).toBe(true);
    // 有多种相邻组合时由玩家选择消除哪2张
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ORB_COST');
    expect(state.currentPendingChoice!.options).toHaveLength(3);
    choose(engine, [state.currentPendingChoice!.options[0]!.id]);
    expect(zone(engine, 'p1', 'SIGNAL_ORB')).toHaveLength(2);
    expect(state.currentPendingChoice!.options.map((o) => o.id)).toEqual([revive.instanceId]);
    choose(engine, [revive.instanceId]);
    expect(at(engine, revive).zone).toBe('BATTLEFIELD');
    // 出场的不明构造体α 触发【出】，但没有手牌可以支付代价
    expect(state.currentPendingChoice).toBeUndefined();

    expect(engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: luna.instanceId }).success).toBe(false);
  });

  it('ST02-003 露娜·银冕【出】丢弃1张手牌：公开3张，1张<升格者>角色加入手牌，其余放置到墓地', () => {
    const { engine, state } = setup();
    const fodder = toHand(engine, 'p1', 'ST01-004');
    const top = ['ST02-005', 'ST01-007', 'ST02-011'].reverse().map((n) => putOnDeckTop(engine, 'p1', n));
    play(engine, toHand(engine, 'p1', 'ST02-003'));
    choose(engine, [fodder.instanceId]);
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST02_003_PICK');
    // <升格者>战术牌 (筛选开始) 不是角色
    expect(eligibleIds(engine)).toEqual([top[2]!.instanceId]);
    choose(engine, [top[2]!.instanceId]);
    expect(at(engine, top[2]!).zone).toBe('HAND');
    expect(at(engine, top[0]!).zone).toBe('GRAVEYARD');
    expect(at(engine, top[1]!).zone).toBe('GRAVEYARD');
  });

  it('ST02-004 露娜·银冕【永】墓地10张及以上时PP+1500', () => {
    const { engine } = setup();
    const luna = placeRole(engine, 'p1', 'ST02-004', 0);
    for (let i = 0; i < 9; i++) engine.zoneMgr.moveCard(zone(engine, 'p1', 'DECK')[0]!.instanceId, 'GRAVEYARD', { isFaceUp: true });
    expect(pp(engine, luna)).toBe(2000);
    engine.zoneMgr.moveCard(zone(engine, 'p1', 'DECK')[0]!.instanceId, 'GRAVEYARD', { isFaceUp: true });
    expect(pp(engine, luna)).toBe(3500);
  });

  it('ST02-006 露娜·银冕【永】侵蚀4及以上PP+1000；【出】按任意顺序排列信号球区', () => {
    const { engine, state } = setup();
    const orbs = setOrbs(engine, 'p1', ['ST01-012', 'ST01-013', 'ST01-014']);
    const luna = toHand(engine, 'p1', 'ST02-006');
    play(engine, luna);
    expect(state.currentPendingChoice?.minSelections).toBe(3);
    // 选择顺序为从下到上
    choose(engine, [orbs[2]!.instanceId, orbs[0]!.instanceId, orbs[1]!.instanceId]);
    expect(zone(engine, 'p1', 'SIGNAL_ORB').map((c) => c.instanceId)).toEqual([
      orbs[2]!.instanceId,
      orbs[0]!.instanceId,
      orbs[1]!.instanceId,
    ]);

    expect(pp(engine, luna)).toBe(4500);
    state.players.p1!.erosionCount = 4;
    expect(pp(engine, luna)).toBe(5500);
  });

  it('ST02-007 不明构造体α【出】丢弃1张手牌：墓地1张<升格者>角色加入手牌', () => {
    const { engine, state } = setup();
    const fodder = toHand(engine, 'p1', 'ST01-004');
    const target = toGraveyard(engine, 'p1', 'ST02-002');
    toGraveyard(engine, 'p1', 'ST01-006');
    play(engine, toHand(engine, 'p1', 'ST02-007'));
    choose(engine, [fodder.instanceId]);
    expect(state.currentPendingChoice!.options.map((o) => o.id)).toEqual([target.instanceId]);
    choose(engine, [target.instanceId]);
    expect(at(engine, target).zone).toBe('HAND');
  });

  it('ST02-008 苦刑之女【永】战场存在<升格者>时PP+1000 (自身也计入)；【起】【回合1】消除1信号球：侵蚀+1，DP+1', () => {
    const { engine, state } = setup();
    const daughter = placeRole(engine, 'p1', 'ST02-008', 0);
    expect(pp(engine, daughter)).toBe(5000);

    // 没有信号球时不能支付代价
    expect(engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: daughter.instanceId }).success).toBe(false);
    const [orb] = setOrbs(engine, 'p1', ['ST02-014']);
    expect(engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: daughter.instanceId }).success).toBe(true);
    expect(at(engine, orb!).zone).toBe('GRAVEYARD');
    choose(engine, ['opt_yes']);
    expect(state.players.p1!.erosionCount).toBe(1);
    expect(dp(engine, daughter)).toBe(2);

    setOrbs(engine, 'p1', ['ST02-014']);
    expect(engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: daughter.instanceId }).success).toBe(false);

    endTurn(engine);
    expect(dp(engine, daughter)).toBe(1);
  });

  it('ST02-009 奥兹玛：装备的《露娜·银冕》攻击时可以消除2同色信号球，对方1张角色PP-4000', () => {
    const { engine, state } = setup();
    const luna = placeRole(engine, 'p1', 'ST02-001', 0);
    const enemy = placeRole(engine, 'p2', 'ST01-006', 0);
    const ozma = toHand(engine, 'p1', 'ST02-009');
    expect(play(engine, ozma, { targetEquipRoleId: luna.instanceId }).success).toBe(true);
    expect(at(engine, luna).attachedEquipmentId).toBe(ozma.instanceId);
    setOrbs(engine, 'p1', ['ST01-012', 'ST02-012']);

    engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p1', attackerCardId: luna.instanceId, targetType: 'PLAYER' });
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ORB_COST');
    choose(engine, [state.currentPendingChoice!.options[1]!.id]);
    expect(zone(engine, 'p1', 'SIGNAL_ORB')).toHaveLength(0);
    choose(engine, [enemy.instanceId]);
    expect(pp(engine, enemy)).toBe(4000);
  });

  it('ST02-010 刹那制裁：需要《露娜·银冕》；对方1张角色PP-2000×我方侵蚀计数', () => {
    const { engine, state } = setup();
    const tactic = toHand(engine, 'p1', 'ST02-010');
    const enemy = placeRole(engine, 'p2', 'ST01-006', 0);
    placeRole(engine, 'p1', 'ST02-007', 0); // <升格者>但不是《露娜·银冕》
    expect(play(engine, tactic).success).toBe(false);
    placeRole(engine, 'p1', 'ST02-005', 1);
    state.players.p1!.erosionCount = 3;
    expect(play(engine, tactic).success).toBe(true);
    choose(engine, [enemy.instanceId]);
    expect(pp(engine, enemy)).toBe(2000);
    endTurn(engine);
    expect(pp(engine, enemy)).toBe(8000);
  });

  it('ST02-011 筛选开始：被攻击时墓地费用3及以下的<升格者>角色出场，侵蚀4及以下时该回合结束时放置到墓地', () => {
    const { engine, state } = setup();
    giveCost(engine, 'p2');
    const attacker = placeRole(engine, 'p1', 'ST01-004', 0);
    placeRole(engine, 'p2', 'ST02-001', 0);
    const revive = toGraveyard(engine, 'p2', 'ST02-007');
    toGraveyard(engine, 'p2', 'ST01-004'); // 不是<升格者>
    const tactic = toHand(engine, 'p2', 'ST02-011');

    engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: 'p1', attackerCardId: attacker.instanceId, targetType: 'PLAYER' });
    expect(state.timingWindow?.priorityPlayerId).toBe('p2');
    expect(play(engine, tactic).success).toBe(true);
    expect(state.currentPendingChoice!.options.map((o) => o.id)).toEqual([revive.instanceId]);
    choose(engine, [revive.instanceId]);
    expect(at(engine, revive).zone).toBe('BATTLEFIELD');
    expect(at(engine, revive).endOfTurnToGraveyard).toBe(state.turnNumber);

    for (let guard = 0; guard < 10 && state.currentCombat; guard++) {
      passInstantWindows(engine);
      if (state.currentCombat?.step === 'BLOCK') engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: 'p2' });
      resolvePendingChoices(engine);
    }
    expect(state.currentCombat).toBeUndefined();
    endTurn(engine);
    expect(at(engine, revive).zone).toBe('GRAVEYARD');
  });

  it('ST02-011：不在我方玩家被攻击时不能使用', () => {
    const { engine } = setup();
    placeRole(engine, 'p1', 'ST02-001', 0);
    toGraveyard(engine, 'p1', 'ST02-007');
    expect(play(engine, toHand(engine, 'p1', 'ST02-011')).success).toBe(false);
  });
});

// =====================================================================
// ST03 三头犬小队
// =====================================================================
describe('ST03 三头犬小队', () => {
  it('ST03-001 薇拉·瑰丽【出】消除2同色信号球：竖直1张<三头犬小队>角色，所有<三头犬小队>角色PP+2000', () => {
    const { engine, state } = setup();
    const tapped = placeRole(engine, 'p1', 'ST03-005', 0);
    tapped.isReady = false;
    const other = placeRole(engine, 'p1', 'ST01-004', 1);
    setOrbs(engine, 'p1', ['ST03-012', 'ST01-012', 'ST02-013']);
    const vera = toHand(engine, 'p1', 'ST03-001');
    play(engine, vera);
    // 只有一组相邻同色 (红红)
    expect(state.currentPendingChoice!.options.map((o) => o.id)).toHaveLength(2);
    choose(engine, [state.currentPendingChoice!.options[1]!.id]);
    choose(engine, [tapped.instanceId]);
    expect(at(engine, tapped).isReady).toBe(true);
    expect(pp(engine, tapped)).toBe(5000);
    expect(pp(engine, vera)).toBe(9000);
    expect(pp(engine, other)).toBe(3000);
  });

  it('ST03-002 / ST03-004 对方回合中横置状态的<三头犬小队>角色PP+1000', () => {
    const { engine, state } = setup();
    placeRole(engine, 'p1', 'ST03-002', 0);
    const self = placeRole(engine, 'p1', 'ST03-004', 1);
    const ally = placeRole(engine, 'p1', 'ST03-007', 2);
    self.isReady = false;
    ally.isReady = false;
    expect(pp(engine, self)).toBe(2500);
    endTurn(engine);
    expect(state.activePlayerId).toBe('p2');
    expect(pp(engine, ally)).toBe(5000); // ST03-002
    expect(pp(engine, self)).toBe(4500); // ST03-002 + 自身
  });

  it('ST03-002【起】横置该牌：下1张<三头犬小队>角色费用-2', () => {
    const { engine, state } = setup();
    const vera = placeRole(engine, 'p1', 'ST03-002', 0);
    expect(engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: vera.instanceId }).success).toBe(true);
    expect(at(engine, vera).isReady).toBe(false);
    expect(state.players.p1!.costModifiers).toHaveLength(1);
    expect(engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: 'p1', sourceCardId: vera.instanceId }).success).toBe(false);
  });

  it('ST03-003 薇拉·瑰丽【出】消除1信号球或丢弃1张手牌：公开5张，最多各1张<21号>与<诺克提>加入手牌，其余放置到墓地', () => {
    const { engine, state } = setup();
    const [orb] = setOrbs(engine, 'p1', ['ST03-014']);
    const top = ['ST03-006', 'ST03-007', 'ST03-009', 'ST01-004', 'ST03-005'].reverse().map((n) => putOnDeckTop(engine, 'p1', n));
    play(engine, toHand(engine, 'p1', 'ST03-003'));
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ST03_003_COST');
    choose(engine, [`orb:${orb!.instanceId}`]);
    expect(at(engine, orb!).zone).toBe('GRAVEYARD');
    const [n21a, n21b, partner] = [top[4]!, top[3]!, top[2]!];
    // 2张<21号>不能同时选择
    expect(choose(engine, [n21a.instanceId, n21b.instanceId]).success).toBe(false);
    expect(choose(engine, [n21a.instanceId, partner.instanceId]).success).toBe(true);
    expect(at(engine, n21a).zone).toBe('HAND');
    expect(at(engine, partner).zone).toBe('HAND');
    expect(at(engine, n21b).zone).toBe('GRAVEYARD');
    expect(at(engine, top[0]!).zone).toBe('GRAVEYARD');
  });

  it('ST03-006 21号·XXI【出】丢弃1张手牌：<三头犬小队>角色3张及以上时墓地1张信号球放置到信号球区最上方', () => {
    const { engine, state } = setup();
    const orb = toGraveyard(engine, 'p1', 'ST03-012');
    placeRole(engine, 'p1', 'ST03-005', 0);
    const fodder = toHand(engine, 'p1', 'ST01-004');
    play(engine, toHand(engine, 'p1', 'ST03-006'));
    choose(engine, [fodder.instanceId]);
    // 只有2张<三头犬小队>角色：不回收
    expect(state.currentPendingChoice).toBeUndefined();

    placeRole(engine, 'p1', 'ST03-004', 2);
    const fodder2 = toHand(engine, 'p1', 'ST01-004');
    play(engine, toHand(engine, 'p1', 'ST03-006'));
    choose(engine, [fodder2.instanceId]);
    choose(engine, [orb.instanceId]);
    expect(at(engine, orb).zone).toBe('SIGNAL_ORB');
  });

  it('ST03-009 可靠的伙伴【自】《薇拉·瑰丽》出场时可以消除2红色信号球：竖直该牌，PP+2000，DP-1', () => {
    const { engine, state } = setup();
    const partner = placeRole(engine, 'p1', 'ST03-009', 0);
    partner.isReady = false;
    setOrbs(engine, 'p1', ['ST01-012', 'ST03-012']);
    play(engine, toHand(engine, 'p1', 'ST03-005'));
    expect(state.currentPendingChoice?.effectType).toBe('PRESET_ORB_COST');
    choose(engine, [state.currentPendingChoice!.options[1]!.id]);
    expect(at(engine, partner).isReady).toBe(true);
    expect(pp(engine, partner)).toBe(7000);
    expect(dp(engine, partner)).toBe(0);

    // 非《薇拉·瑰丽》出场不触发
    setOrbs(engine, 'p1', ['ST01-012', 'ST03-012']);
    play(engine, toHand(engine, 'p1', 'ST03-007'));
    expect(state.currentPendingChoice).toBeUndefined();
  });

  it('ST03-010 暗域力场：抽2张，此时横置的<三头犬小队>角色PP+1000直到下个回合结束', () => {
    const { engine, state } = setup();
    const tapped = placeRole(engine, 'p1', 'ST03-005', 0);
    tapped.isReady = false;
    const ready = placeRole(engine, 'p1', 'ST03-007', 1);
    const handBefore = zone(engine, 'p1', 'HAND').length;
    play(engine, toHand(engine, 'p1', 'ST03-010'));
    expect(zone(engine, 'p1', 'HAND').length).toBe(handBefore + 2);
    expect(pp(engine, tapped)).toBe(4000);
    expect(pp(engine, ready)).toBe(4000);
    // 8.9.2 之后横置的角色不受影响
    ready.isReady = false;
    expect(pp(engine, ready)).toBe(4000);

    endTurn(engine);
    expect(state.activePlayerId).toBe('p2');
    expect(pp(engine, tapped)).toBe(4000);
    endTurn(engine);
    expect(pp(engine, tapped)).toBe(3000);
  });

  it('ST03-011 三头犬出击：破坏对方战场1张角色', () => {
    const { engine } = setup();
    const enemy = placeRole(engine, 'p2', 'ST02-002', 0);
    const tactic = toHand(engine, 'p1', 'ST03-011');
    expect(play(engine, tactic).success).toBe(true);
    choose(engine, [enemy.instanceId]);
    expect(at(engine, enemy).zone).toBe('GRAVEYARD');
    expect(at(engine, tactic).zone).toBe('GRAVEYARD');
  });
});

describe('预组效果的通用约束', () => {
  it('效果的决策可以随快照保存与恢复 (metadata 可序列化)', () => {
    const { engine } = setup();
    const top = ['ST01-007', 'ST02-004', 'ST02-005', 'ST03-004', 'ST03-005'].reverse().map((n) => putOnDeckTop(engine, 'p1', n));
    play(engine, toHand(engine, 'p1', 'ST01-010'));
    const restored = GameEngine.fromSnapshot(engine.toSnapshot(), cardDb);
    const choice = restored.getState().currentPendingChoice!;
    const res = restored.dispatchAction({ type: 'SELECT_CHOICE_OPTION', playerId: 'p1', pendingChoiceId: choice.id, selectedIds: [top[4]!.instanceId] });
    expect(res.success).toBe(true);
    expect(restored.getState().cards[top[4]!.instanceId]!.zone).toBe('HAND');
    expect(restored.zoneMgr.getCardsInZone('p1', 'PROCESSING')).toHaveLength(0);
  });

  it('信号球的【充能自】只从该能力自身的文本解析出两个选项；带条件的【充能自】不按近似处理', () => {
    const { engine, state } = setup();
    const optionsOf = (cardNumber: string) => {
      const card = pick(engine, 'p1', cardNumber);
      const handled = engine.effectEngine.handleChargeAutoEffect('p1', card.instanceId, cardDb.getCard(cardNumber)!);
      const ids = handled ? state.currentPendingChoice!.options.map((o) => o.id) : [];
      state.currentPendingChoice = undefined;
      return ids;
    };
    expect(optionsOf('ST01-012')).toEqual(['opt_dp_plus_1', 'opt_pp_plus_2000']);
    expect(optionsOf('ST02-013')).toEqual(['opt_draw_1', 'opt_pp_plus_2000']);
    expect(optionsOf('ST03-014')).toEqual(['opt_erosion_minus_1', 'opt_pp_plus_2000']);
    const any = pick(engine, 'p1', 'ST01-004');
    expect(engine.effectEngine.handleChargeAutoEffect('p1', any.instanceId, cardDb.getCard('BP04-020')!)).toBe(false);
    expect(state.currentPendingChoice).toBeUndefined();
  });

  it('BP04-032 炽能球不是信号球牌，使用时不会直接放置到信号球区', () => {
    const engine = new GameEngine(
      'game-bp04-032',
      { playerId: 'p1', deckCardNumbers: [...DECK, 'BP04-032'] },
      { playerId: 'p2', deckCardNumbers: DECK },
      3,
      cardDb
    );
    const state = engine.getState();
    const card = Object.values(state.cards).find((c) => c.cardNumber === 'BP04-032')!;
    const res = engine.effectEngine.handlePlayTactics('p1', card.instanceId, cardDb.getCard('BP04-032')!);
    expect(res.success).toBe(true);
    expect(at(engine, card).zone).not.toBe('SIGNAL_ORB');
  });
});
