import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/engine.js';

function create50CardDeck(): string[] {
  // 12张信号球 + 38张卡牌 = 恰好50张
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

describe('GameEngine 核心规则引擎测试套件', () => {
  it('1. 游戏初始化与准备流程 (5.2 游戏准备)', () => {
    const engine = new GameEngine(
      'game-001',
      { playerId: 'p1', deckCardNumbers: create50CardDeck() },
      { playerId: 'p2', deckCardNumbers: create50CardDeck() },
      123456
    );

    const state = engine.getState();
    expect(state.status).toBe('PLAYING');
    expect(state.turnNumber).toBe(1);

    // 侵蚀计数初始化为0 (5.2.1.d)
    expect(state.players.p1!.erosionCount).toBe(0);
    expect(state.players.p2!.erosionCount).toBe(0);

    expect(state.phase).toBe('DRAW_CHARGE_PHASE');

    // 先攻玩家第1回合抽1张牌 (6.3.1.b: 4 + 1 = 5)，后攻玩家起始手牌为4张
    const activeHand = Object.values(state.cards).filter((c) => c.controllerPlayerId === state.activePlayerId && c.zone === 'HAND');
    const nonActiveHand = Object.values(state.cards).filter((c) => c.controllerPlayerId === state.nonActivePlayerId && c.zone === 'HAND');
    expect(activeHand).toHaveLength(5);
    expect(nonActiveHand).toHaveLength(4);

    // 双方牌组顶2张正面竖直作为明费 (5.2.1.f)
    const p1Costs = Object.values(state.cards).filter((c) => c.controllerPlayerId === 'p1' && c.zone === 'COST');
    expect(p1Costs).toHaveLength(2);
    expect(p1Costs.every((c) => c.isFaceUp && c.isReady)).toBe(true);

    // 先攻牌组剩余 50 - 4 - 2 - 1 = 43 张
    const activeDeck = Object.values(state.cards).filter((c) => c.controllerPlayerId === state.activePlayerId && c.zone === 'DECK');
    expect(activeDeck).toHaveLength(43);

    // 战场卡位为5个 (3.2.3)
    expect(state.battlefields.p1).toHaveLength(5);
    expect(state.battlefields.p2).toHaveLength(5);
  });

  it('2. 隐藏信息安全脱敏检验 (12. 隐藏信息)', () => {
    const engine = new GameEngine(
      'game-002',
      { playerId: 'p1', deckCardNumbers: create50CardDeck() },
      { playerId: 'p2', deckCardNumbers: create50CardDeck() },
      999
    );

    const p1View = engine.getPublicState('p1');
    // p1 能够看到自己的手牌
    expect(p1View.myHandCards?.length).toBeGreaterThanOrEqual(4);
    // p1 只能看到对手手牌的数量，无法获取卡牌具体情报
    expect(p1View.opponentHandCount).toBeGreaterThanOrEqual(4);
    expect(p1View.myHandCards!.length + p1View.opponentHandCount).toBe(9);
    // p1 无法直接读取对手牌组内部具体卡牌
    expect(p1View.opponentDeckCount).toBeGreaterThanOrEqual(43);
  });

  it('3. 信号球消除并抽牌机制 (6.4.1.b.5 & 4.16.2)', () => {
    const engine = new GameEngine(
      'game-003',
      { playerId: 'p1', deckCardNumbers: create50CardDeck() },
      { playerId: 'p2', deckCardNumbers: create50CardDeck() },
      111
    );

    const state = engine.getState();
    const activePlayer = state.activePlayerId;

    // 6.4.1.b.5 三消是主要阶段的行动：先放弃填充明费进入主要阶段
    engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: activePlayer });
    expect(state.phase).toBe('MAIN_PHASE');

    // 手动在信号球区放置3张相邻信号球
    const orbs = ['ST01-012', 'ST01-012', 'ST01-013'];
    const orbInstIds: [string, string, string] = ['test-orb-1', 'test-orb-2', 'test-orb-3'];
    for (let i = 0; i < 3; i++) {
      state.cards[orbInstIds[i]!] = {
        instanceId: orbInstIds[i]!,
        cardId: orbs[i]!,
        cardNumber: orbs[i]!,
        ownerPlayerId: activePlayer,
        controllerPlayerId: activePlayer,
        zone: 'SIGNAL_ORB',
        underneathCardIds: [],
        isFaceUp: true,
        isReady: true,
        turnEnteredZone: 1,
      };
    }

    const handCountBefore = Object.values(state.cards).filter(
      (c) => c.controllerPlayerId === activePlayer && c.zone === 'HAND'
    ).length;

    // 消除信号球
    const res = engine.dispatchAction({
      type: 'ELIMINATE_3_ORBS',
      playerId: activePlayer,
      orbCardInstanceIds: orbInstIds,
    });

    expect(res.success).toBe(true);

    // 验证信号球进入墓地
    expect(state.cards[orbInstIds[0]!]?.zone).toBe('GRAVEYARD');
    expect(state.cards[orbInstIds[1]!]?.zone).toBe('GRAVEYARD');
    expect(state.cards[orbInstIds[2]!]?.zone).toBe('GRAVEYARD');

    // 验证成功抽1张牌 (6.4.1.b.5)
    const handCountAfter = Object.values(state.cards).filter(
      (c) => c.controllerPlayerId === activePlayer && c.zone === 'HAND'
    ).length;
    expect(handCountAfter).toBe(handCountBefore + 1);
  });

  it('4. 角色战斗比较机制 (7.6.1.b PP对比与不反伤规则)', () => {
    const engine = new GameEngine(
      'game-004',
      { playerId: 'p1', deckCardNumbers: create50CardDeck() },
      { playerId: 'p2', deckCardNumbers: create50CardDeck() },
      222
    );

    const state = engine.getState();
    const attackerPlayer = state.activePlayerId;
    const defenderPlayer = state.nonActivePlayerId;

    // 在战场各放置1张角色：p1 露西亚(PP 3000), p2 神威(PP 4000, 横置)
    const luciaId = 'test-lucia-att';
    const kamuiId = 'test-kamui-def';

    state.cards[luciaId] = {
      instanceId: luciaId,
      cardId: 'c-lucia-01',
      cardNumber: 'ST01-005',
      ownerPlayerId: attackerPlayer,
      controllerPlayerId: attackerPlayer,
      zone: 'BATTLEFIELD',
      slotIndex: 0,
      underneathCardIds: [],
      isFaceUp: true,
      isReady: true,
      tempPPBonus: -1000, // 4000 - 1000 = 3000 PP < 4000 PP
      turnEnteredZone: 0, // 非出场回合，可攻击
    };
    state.battlefields[attackerPlayer]![0]!.roleCardId = luciaId;

    state.cards[kamuiId] = {
      instanceId: kamuiId,
      cardId: 'c-kamui-pierce',
      cardNumber: 'BP01-005',
      ownerPlayerId: defenderPlayer,
      controllerPlayerId: defenderPlayer,
      zone: 'BATTLEFIELD',
      slotIndex: 0,
      underneathCardIds: [],
      isFaceUp: true,
      isReady: false, // 横置状态，可被选为攻击对象 (7.2.1.b.1)
      turnEnteredZone: 0,
    };
    state.battlefields[defenderPlayer]![0]!.roleCardId = kamuiId;

    state.phase = 'MAIN_PHASE';

    // 露西亚(PP 3000) 攻击 神威(PP 4000)
    const attackRes = engine.dispatchAction({
      type: 'DECLARE_ATTACK',
      playerId: attackerPlayer,
      attackerCardId: luciaId,
      targetType: 'CHARACTER',
      targetCardId: kamuiId,
    });
    expect(attackRes.success).toBe(true);

    // 防守方在自由时点 Pass (不阻挡)
    const passRes = engine.dispatchAction({
      type: 'PASS_ACTION_TIMING',
      playerId: defenderPlayer,
    });
    expect(passRes.success).toBe(true);

    // 7.6.1.b 核心规则验证：
    // 露西亚PP(3000) < 神威PP(4000) -> 无事发生！双方角色均未被破坏！
    expect(state.cards[luciaId]?.zone).toBe('BATTLEFIELD');
    expect(state.cards[kamuiId]?.zone).toBe('BATTLEFIELD');
  });

  it('5. 升变机制与装备继承及离场连带送墓 (8.11 & 9.6)', () => {
    const engine = new GameEngine(
      'game-005',
      { playerId: 'p1', deckCardNumbers: create50CardDeck() },
      { playerId: 'p2', deckCardNumbers: create50CardDeck() },
      333
    );

    const state = engine.getState();
    const p1 = state.activePlayerId;
    state.phase = 'MAIN_PHASE';

    // 构造费用区包含火属性明费与足够费用
    const costCardId = 'fire-cost';
    state.cards[costCardId] = {
      instanceId: costCardId,
      cardId: 'c-lucia-cost',
      cardNumber: 'ST01-005',
      ownerPlayerId: p1,
      controllerPlayerId: p1,
      zone: 'COST',
      underneathCardIds: [],
      isFaceUp: true,
      isReady: true,
      turnEnteredZone: 1,
    };
    state.players[p1]!.openCostCount = 5;
    state.players[p1]!.availableOpenCostCount = 5;
    state.players[p1]!.totalCostCount = 5;

    // 场上已存在角色 露西亚·红莲 (ST01-005)，带装备 红莲狂士 (BP01-006)
    const baseRoleId = 'base-lucia';
    const equipId = 'equip-weapon';
    state.cards[baseRoleId] = {
      instanceId: baseRoleId,
      cardId: 'c-lucia-01',
      cardNumber: 'ST01-005',
      ownerPlayerId: p1,
      controllerPlayerId: p1,
      zone: 'BATTLEFIELD',
      slotIndex: 0,
      attachedEquipmentId: equipId,
      underneathCardIds: [],
      isFaceUp: true,
      isReady: true,
      turnEnteredZone: 0,
    };
    state.cards[equipId] = {
      instanceId: equipId,
      cardId: 'c-weapon-redlotus',
      cardNumber: 'BP01-006',
      ownerPlayerId: p1,
      controllerPlayerId: p1,
      zone: 'BATTLEFIELD',
      slotIndex: 0,
      underneathCardIds: [],
      isFaceUp: true,
      isReady: true,
      turnEnteredZone: 0,
    };
    state.battlefields[p1]![0]!.roleCardId = baseRoleId;

    // 手牌中有升变卡 露西亚·红莲 (ST01-001)
    const ascensionCardId = 'ascension-lucia';
    state.cards[ascensionCardId] = {
      instanceId: ascensionCardId,
      cardId: 'c-lucia-ascension',
      cardNumber: 'ST01-001',
      ownerPlayerId: p1,
      controllerPlayerId: p1,
      zone: 'HAND',
      underneathCardIds: [],
      isFaceUp: true,
      isReady: true,
      turnEnteredZone: 1,
    };

    // 执行升变出场 (8.11)
    const playRes = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: p1,
      cardInstanceId: ascensionCardId,
      isAscension: true,
      targetAscensionCardId: baseRoleId,
    });
    expect(playRes.success).toBe(true);

    // 验证升变后顶层角色为 露西亚·黎明，底卡包含 原露西亚
    expect(state.battlefields[p1]![0]!.roleCardId).toBe(ascensionCardId);
    expect(state.cards[ascensionCardId]?.underneathCardIds).toContain(baseRoleId);
    // 验证装备自动继承 (8.11.3.f.2)
    expect(state.cards[ascensionCardId]?.attachedEquipmentId).toBe(equipId);

    // 模拟升变角色因伤害或效果离场 -> 检验 9.6 无所属卡牌连带送墓
    const zoneMgr = (engine as any).zoneMgr;
    const fieldMgr = (engine as any).fieldMgr;
    fieldMgr.handleCardLeaveField(ascensionCardId);
    zoneMgr.moveCard(ascensionCardId, 'GRAVEYARD', { isFaceUp: true });

    // 验证底卡与装备牌全部因规则送入墓地 (9.6.1)
    expect(state.cards[ascensionCardId]?.zone).toBe('GRAVEYARD');
    expect(state.cards[baseRoleId]?.zone).toBe('GRAVEYARD');
    expect(state.cards[equipId]?.zone).toBe('GRAVEYARD');
  });

  it('6. 侵蚀度达到7判负与脱离浏览器完整运行一局 (1.2.2.a & 9.3.1.a)', () => {
    const engine = new GameEngine(
      'game-full-run',
      { playerId: 'alice', deckCardNumbers: create50CardDeck() },
      { playerId: 'bob', deckCardNumbers: create50CardDeck() },
      88888
    );

    const state = engine.getState();
    expect(state.status).toBe('PLAYING');

    // 模拟连续对战伤害结算：使 bob 的侵蚀度达到 7
    const zoneMgr = (engine as any).zoneMgr;
    zoneMgr.applyDamageToPlayer('bob', 7);

    // 触发检查时机与规则处理 (8.5 & 9.3)
    const checkMgr = (engine as any).checkTimingMgr;
    checkMgr.resolveCheckTiming();

    expect(state.status).toBe('FINISHED');
    expect(state.winnerId).toBe('alice');
    expect(state.finishReason).toContain('侵蚀达标');
  });
});
