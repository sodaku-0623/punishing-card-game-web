import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/engine.js';

function create50CardDeck(): string[] {
  return [
    'ST01-012', 'ST01-012', 'ST01-012', 'ST01-012',
    'ST01-013', 'ST01-013', 'ST01-013', 'ST01-013',
    'ST01-014', 'ST01-014', 'ST01-014', 'ST01-014',
    'BP01-001', 'BP01-001', 'BP01-001', 'BP01-001',
    'BP01-002', 'BP01-002', 'BP01-002', 'BP01-002',
    'BP01-003', 'BP01-003', 'BP01-003', 'BP01-003',
    'BP01-004', 'BP01-004', 'BP01-004', 'BP01-004',
    'BP01-005', 'BP01-005', 'BP01-005', 'BP01-005',
    'BP01-006', 'BP01-006', 'BP01-006', 'BP01-006',
    'BP01-007', 'BP01-007', 'BP01-007', 'BP01-007',
    'BP01-008', 'BP01-008', 'BP01-008', 'BP01-008',
    'BP01-003', 'BP01-004', 'BP01-005', 'BP01-006',
    'BP01-007', 'BP01-008',
  ];
}

describe('GameEngine 战斗、充能、伤害与回合轮转全流程测试', () => {
  it('攻击角色出场限制与速攻突破 (7.2.1.b.1 & 10.5)', () => {
    const engine = new GameEngine(
      'game-rush-test',
      { playerId: 'p1', deckCardNumbers: create50CardDeck() },
      { playerId: 'p2', deckCardNumbers: create50CardDeck() },
      444
    );

    const state = engine.getState();
    const p1 = state.activePlayerId;
    state.phase = 'MAIN_PHASE';

    // 普通角色本回合刚出场 (turnEnteredZone = 1)
    const normalRoleId = 'normal-role';
    state.cards[normalRoleId] = {
      instanceId: normalRoleId,
      cardId: 'c-lucia-01',
      cardNumber: 'BP01-001', // 无速攻
      ownerPlayerId: p1,
      controllerPlayerId: p1,
      zone: 'BATTLEFIELD',
      slotIndex: 0,
      underneathCardIds: [],
      isFaceUp: true,
      isReady: true,
      turnEnteredZone: 1, // 出场当回合
    };
    state.battlefields[p1]![0]!.roleCardId = normalRoleId;

    // 普通角色攻击被拒绝 (7.2.1.b.1)
    const failAttack = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: p1,
      attackerCardId: normalRoleId,
      targetType: 'PLAYER',
    });
    expect(failAttack.success).toBe(false);
    expect(failAttack.error).toContain('出场的回合不可以进行攻击');

    // 速攻角色本回合出场 (BP02-041 含英·檀心「【永】：【速攻】」)
    const rushRoleId = 'rush-role';
    state.cards[rushRoleId] = {
      instanceId: rushRoleId,
      cardId: 'c-bp02-041',
      cardNumber: 'BP02-041',
      ownerPlayerId: p1,
      controllerPlayerId: p1,
      zone: 'BATTLEFIELD',
      slotIndex: 1,
      underneathCardIds: [],
      isFaceUp: true,
      isReady: true,
      turnEnteredZone: 1,
    };
    state.battlefields[p1]![1]!.roleCardId = rushRoleId;

    // 速攻角色攻击成功 (10.5.1.a)
    const rushAttack = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: p1,
      attackerCardId: rushRoleId,
      targetType: 'PLAYER',
    });
    expect(rushAttack.success).toBe(true);
  });

  it('攻击玩家直接命中：攻击充能与伤害充能产生暗费+侵蚀度+1 (4.10, 4.12.2, 4.12.3)', () => {
    const engine = new GameEngine(
      'game-damage-test',
      { playerId: 'p1', deckCardNumbers: create50CardDeck() },
      { playerId: 'p2', deckCardNumbers: create50CardDeck() },
      555
    );

    const state = engine.getState();
    const attackerPlayer = state.activePlayerId;
    const defenderPlayer = state.nonActivePlayerId;
    state.phase = 'MAIN_PHASE';

    // 放置一个可攻击的角色 (DP = 1)
    const attackerId = 'attacker-role';
    state.cards[attackerId] = {
      instanceId: attackerId,
      cardId: 'c-st01-001',
      cardNumber: 'ST01-001',
      ownerPlayerId: attackerPlayer,
      controllerPlayerId: attackerPlayer,
      zone: 'BATTLEFIELD',
      slotIndex: 0,
      underneathCardIds: [],
      isFaceUp: true,
      isReady: true,
      turnEnteredZone: 0,
    };
    state.battlefields[attackerPlayer]![0]!.roleCardId = attackerId;

    const defenderErosionBefore = state.players[defenderPlayer]!.erosionCount;
    const defenderHiddenCostBefore = state.players[defenderPlayer]!.hiddenCostCount;

    // 宣告攻击对方玩家
    engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: attackerPlayer,
      attackerCardId: attackerId,
      targetType: 'PLAYER',
    });

    // 防守方在自由时点 Pass 不阻挡
    engine.dispatchAction({
      type: 'PASS_ACTION_TIMING',
      playerId: defenderPlayer,
    });

    // 验证伤害结算后：
    // 1. 防守玩家受到 1 点伤害，侵蚀计数增加 1 (4.10.1.b)
    expect(state.players[defenderPlayer]!.erosionCount).toBe(defenderErosionBefore + 1);
    // 2. 防守玩家执行了1次伤害充能，费用区增加了1张暗费 (4.12.3.a)
    expect(state.players[defenderPlayer]!.hiddenCostCount).toBe(defenderHiddenCostBefore + 1);
    // 3. 战斗结束后自动返回主要阶段 (7.5.1.d)
    expect(state.phase).toBe('MAIN_PHASE');
    expect(state.currentCombat).toBeUndefined();
  });

  it('回合结束阶段暗费自动清理与下一回合竖直抽牌 (3.6.3.b.1 & 6.2, 6.3)', () => {
    const engine = new GameEngine(
      'game-phase-cycle',
      { playerId: 'p1', deckCardNumbers: create50CardDeck() },
      { playerId: 'p2', deckCardNumbers: create50CardDeck() },
      666
    );

    const state = engine.getState();
    const p1 = state.activePlayerId;
    const p2 = state.nonActivePlayerId;
    state.phase = 'MAIN_PHASE';

    // 模拟 p1 拥有 1 张暗费，并且有 1 张已横置明费
    const p1CostCard = Object.values(state.cards).find(
      (c) => c.controllerPlayerId === p1 && c.zone === 'COST' && c.isFaceUp
    )!;
    p1CostCard.isReady = false; // 横置

    // 注入1张暗费
    const hiddenCardId = 'p1-hidden-cost';
    state.cards[hiddenCardId] = {
      instanceId: hiddenCardId,
      cardId: 'c-hidden',
      cardNumber: 'BP01-001',
      ownerPlayerId: p1,
      controllerPlayerId: p1,
      zone: 'COST',
      underneathCardIds: [],
      isFaceUp: false, // 背面 = 暗费
      isReady: true,
      turnEnteredZone: 1,
    };

    // p1 主要阶段选择 Pass -> 进入结束阶段
    engine.dispatchAction({
      type: 'PASS_ACTION_TIMING',
      playerId: p1,
    });

    // 3.6.3.b.1 验证 p1 的暗费已在结束阶段被正面置入墓地
    expect(state.cards[hiddenCardId]?.zone).toBe('GRAVEYARD');
    expect(state.cards[hiddenCardId]?.isFaceUp).toBe(true);
    expect(state.players[p1]!.hiddenCostCount).toBe(0);

    // 验证攻守交接：现在回合玩家为 p2，进入第二回合
    expect(state.activePlayerId).toBe(p2);
    expect(state.turnNumber).toBe(2);

    // 验证 p2 已经自动经历 6.2 竖直阶段与 6.3 抽牌阶段，当前停留在 DRAW_CHARGE_PHASE 等待充费决策 (6.3.1.c)
    expect(state.phase).toBe('DRAW_CHARGE_PHASE');
    // p2 在第2回合抽了2张牌 (6.3.1.b)
    const p2Hand = Object.values(state.cards).filter(
      (c) => c.controllerPlayerId === p2 && c.zone === 'HAND'
    );
    expect(p2Hand).toHaveLength(6); // 初始4张 + 抽2张 = 6张

    // p2 在 6.3.1.c 决定不充明费，直接 Pass
    engine.dispatchAction({
      type: 'PASS_ACTION_TIMING',
      playerId: p2,
    });

    // 成功推进至 6.4 主要阶段
    expect(state.phase).toBe('MAIN_PHASE');
  });

  it('攻击自由时点双方Pass或守方阻挡正常推进，不误报只有被攻击玩家可以阻挡', () => {
    const engine = new GameEngine(
      'game-pass-timing-test',
      { playerId: 'p1', deckCardNumbers: create50CardDeck() },
      { playerId: 'p2', deckCardNumbers: create50CardDeck() },
      777
    );

    const state = engine.getState();
    const p1 = state.activePlayerId;
    const p2 = state.nonActivePlayerId;
    state.phase = 'MAIN_PHASE';

    // 攻方角色
    const attackerId = 'attacker-role';
    state.cards[attackerId] = {
      instanceId: attackerId,
      cardId: 'c-nanami-rush',
      cardNumber: 'BP01-004',
      ownerPlayerId: p1,
      controllerPlayerId: p1,
      zone: 'BATTLEFIELD',
      slotIndex: 0,
      underneathCardIds: [],
      isFaceUp: true,
      isReady: true,
      turnEnteredZone: 0,
    };
    state.battlefields[p1]![0]!.roleCardId = attackerId;

    // 守方竖直角色 (可阻挡)
    const blockerId = 'blocker-role';
    state.cards[blockerId] = {
      instanceId: blockerId,
      cardId: 'c-lucia-01',
      cardNumber: 'BP01-001',
      ownerPlayerId: p2,
      controllerPlayerId: p2,
      zone: 'BATTLEFIELD',
      slotIndex: 0,
      underneathCardIds: [],
      isFaceUp: true,
      isReady: true,
      turnEnteredZone: 0,
    };
    state.battlefields[p2]![0]!.roleCardId = blockerId;

    // 1. 攻方宣告攻击对方玩家
    const attackRes = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: p1,
      attackerCardId: attackerId,
      targetType: 'PLAYER',
    });
    expect(attackRes.success).toBe(true);
    expect(state.phase).toBe('COMBAT_FREE_TIMING');
    expect(state.cards[attackerId]?.isReady).toBe(false); // 攻方角色横置

    // 2. 攻方 (p1) 在自由时点试图单方面直接结算 (PASS_ACTION_TIMING)
    // 核心规则与业务需求：回合方玩家发起进攻时，只有在被攻击玩家选择是否阻挡后才能进行结算！
    const attackerPassRes = engine.dispatchAction({
      type: 'PASS_ACTION_TIMING',
      playerId: p1,
    });
    expect(attackerPassRes.success).toBe(false);
    expect(attackerPassRes.error).toContain('必须等待被攻击玩家选择是否阻挡');
    // 战斗状态依然保持在自由时点步骤，不被攻方单方面跳过
    expect(state.phase).toBe('COMBAT_FREE_TIMING');
    expect(state.currentCombat).toBeDefined();

    // 3. 守方 (p2) 做出阻挡决策：守方竖直角色进行阻挡 (7.3.1.c)
    const blockRes = engine.dispatchAction({
      type: 'DECLARE_BLOCK',
      playerId: p2,
      blockerCardId: blockerId,
    });
    expect(blockRes.success).toBe(true);
    // 阻挡角色已横置
    expect(state.cards[blockerId]?.isReady).toBe(false);

    // 阻挡后进入角色战斗步骤并结算完成，返回主要阶段
    expect(state.phase).toBe('MAIN_PHASE');
    expect(state.currentCombat).toBeUndefined();
  });

  it('攻方攻击后，守方选择不阻挡时才推进伤害结算', () => {
    const engine = new GameEngine(
      'game-pass-noblock-test',
      { playerId: 'p1', deckCardNumbers: create50CardDeck() },
      { playerId: 'p2', deckCardNumbers: create50CardDeck() },
      778
    );

    const state = engine.getState();
    const p1 = state.activePlayerId;
    const p2 = state.nonActivePlayerId;
    state.phase = 'MAIN_PHASE';

    const attackerId = 'attacker-role-2';
    state.cards[attackerId] = {
      instanceId: attackerId,
      cardId: 'c-nanami-rush',
      cardNumber: 'BP01-004',
      ownerPlayerId: p1,
      controllerPlayerId: p1,
      zone: 'BATTLEFIELD',
      slotIndex: 0,
      underneathCardIds: [],
      isFaceUp: true,
      isReady: true,
      turnEnteredZone: 0,
    };
    state.battlefields[p1]![0]!.roleCardId = attackerId;

    // 攻方攻击对方玩家
    engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: p1,
      attackerCardId: attackerId,
      targetType: 'PLAYER',
    });
    expect(state.phase).toBe('COMBAT_FREE_TIMING');

    // 攻方尝试结算被拒绝
    const earlyPass = engine.dispatchAction({
      type: 'PASS_ACTION_TIMING',
      playerId: p1,
    });
    expect(earlyPass.success).toBe(false);
    expect(earlyPass.error).toContain('必须等待被攻击玩家选择是否阻挡');

    // 守方选择放弃阻挡 (PASS_ACTION_TIMING 由守方发出)
    const defenderPass = engine.dispatchAction({
      type: 'PASS_ACTION_TIMING',
      playerId: p2,
    });
    expect(defenderPass.success).toBe(true);
    // 成功推进结算并对守方玩家造成伤害
    expect(state.phase).toBe('MAIN_PHASE');
    expect(state.players[p2]!.erosionCount).toBeGreaterThan(0);
  });

  it('主要阶段可以消除信号球区中相邻的3张信号球并抽1张牌，传入顺序不限 (6.4.1.b.5)', () => {
    const engine = new GameEngine(
      'game-orb-eliminate-test',
      { playerId: 'p1', deckCardNumbers: create50CardDeck() },
      { playerId: 'p2', deckCardNumbers: create50CardDeck() },
      888
    );

    const state = engine.getState();
    const p1 = state.activePlayerId;
    engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: p1 });
    expect(state.phase).toBe('MAIN_PHASE');

    const orbIds = Object.values(state.cards)
      .filter((c) => c.controllerPlayerId === p1 && c.zone === 'DECK' && c.cardNumber === 'ST01-012')
      .slice(0, 3)
      .map((c) => c.instanceId);
    expect(orbIds.length).toBe(3);
    for (const id of orbIds) {
      engine.zoneMgr.moveCard(id, 'SIGNAL_ORB', { isFaceUp: true });
    }

    // 回合外玩家不能执行三消
    const p2 = state.nonActivePlayerId;
    expect(
      engine.dispatchAction({ type: 'ELIMINATE_3_ORBS', playerId: p2, orbCardInstanceIds: orbIds as [string, string, string] }).success
    ).toBe(false);

    const initialHandCount = engine.zoneMgr.getCardsInZone(p1, 'HAND').length;
    const eliminateRes = engine.dispatchAction({
      type: 'ELIMINATE_3_ORBS',
      playerId: p1,
      orbCardInstanceIds: [orbIds[2]!, orbIds[0]!, orbIds[1]!], // 乱序传入
    });
    expect(eliminateRes.success).toBe(true);
    for (const id of orbIds) {
      expect(state.cards[id]?.zone).toBe('GRAVEYARD');
    }
    expect(engine.zoneMgr.getCardsInZone(p1, 'HAND').length).toBe(initialHandCount + 1);
  });
});
