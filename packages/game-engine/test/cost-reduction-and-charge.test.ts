import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/engine.js';
import { CardType, ElementAttribute } from '@zhanshuang/shared';

function createST03Deck(): string[] {
  return [
    'ST03-001', 'ST03-001', 'ST03-001', 'ST03-001',
    'ST03-002', 'ST03-002', 'ST03-002', 'ST03-002',
    'ST03-003', 'ST03-003', 'ST03-003', 'ST03-003',
    'ST03-004', 'ST03-004',
    'ST03-005', 'ST03-005', 'ST03-005', 'ST03-005',
    'ST03-006', 'ST03-006', 'ST03-006', 'ST03-006',
    'ST03-007', 'ST03-007',
    'ST03-008', 'ST03-008', 'ST03-008', 'ST03-008',
    'ST03-009', 'ST03-009', 'ST03-009', 'ST03-009',
    'ST03-010', 'ST03-010',
    'ST03-011', 'ST03-011', 'ST03-011', 'ST03-011',
    'ST03-012', 'ST03-012', 'ST03-012', 'ST03-012',
    'ST03-013', 'ST03-013', 'ST03-013', 'ST03-013',
    'ST03-014', 'ST03-014', 'ST03-014', 'ST03-014',
  ];
}

function createST01Deck(): string[] {
  return [
    'ST01-001', 'ST01-001', 'ST01-001', 'ST01-001',
    'ST01-002', 'ST01-002', 'ST01-002', 'ST01-002',
    'ST01-003', 'ST01-003', 'ST01-003', 'ST01-003',
    'ST01-004', 'ST01-004',
    'ST01-005', 'ST01-005', 'ST01-005', 'ST01-005',
    'ST01-006', 'ST01-006', 'ST01-006', 'ST01-006',
    'ST01-007', 'ST01-007',
    'ST01-008', 'ST01-008', 'ST01-008', 'ST01-008',
    'ST01-009', 'ST01-009', 'ST01-009', 'ST01-009',
    'ST01-010', 'ST01-010',
    'ST01-011', 'ST01-011', 'ST01-011', 'ST01-011',
    'ST01-012', 'ST01-012', 'ST01-012', 'ST01-012',
    'ST01-013', 'ST01-013', 'ST01-013', 'ST01-013',
    'ST01-014', 'ST01-014', 'ST01-014', 'ST01-014',
  ];
}

describe('ST03费用减免、充能步骤与伤害充能详细规则测试', () => {
  it('1. ST03-002 (薇拉·瑰丽) 发动效果横置后，下1张<三头犬小队>角色费用-2，ST03-006 (21号·XXI) 可0费登场', () => {
    const engine = new GameEngine(
      'game-st03-cost-01',
      { playerId: 'p1', deckCardNumbers: createST03Deck() },
      { playerId: 'p2', deckCardNumbers: createST03Deck() },
      12345
    );

    const activeId = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });
    expect(engine.getState().phase).toBe('MAIN_PHASE');

    const player = engine.getState().players[activeId]!;

    // 确保费用区有匹配暗属性的明费 (8.6.2.a.1)，但让所有可用费用为 0
    player.availableOpenCostCount = 0;
    player.exhaustedOpenCostCount = 2;
    player.hiddenCostCount = 0;
    // 将费用区两张明费设为横置状态 (isReady = false)
    const costCards = engine.zoneMgr.getCardsInZone(activeId, 'COST');
    for (const c of costCards) {
      c.isFaceUp = true;
      c.isReady = false;
    }

    // 场上放置 ST03-002 (薇拉·瑰丽)
    const veraCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST03-002'
    )!;
    engine.fieldMgr.playRoleCard(activeId, veraCard.instanceId, 0);
    veraCard.isReady = true;

    // 手牌中放入 ST03-006 (21号·XXI，原费用2，特征含“三头犬小队”)
    const xxiCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST03-006'
    )!;
    engine.zoneMgr.moveCard(xxiCard.instanceId, 'HAND', { isFaceUp: true });

    // 发动 ST03-002 的【起】动能力 (横置该牌：下1张<三头犬小队>角色费用-2)
    const actRes = engine.applyAction({
      type: 'ACTIVATE_ABILITY',
      playerId: activeId,
      sourceCardId: veraCard.instanceId,
    });
    expect(actRes.success).toBe(true);
    expect(veraCard.isReady).toBe(false);
    expect(player.costModifiers?.length).toBe(1);
    expect(player.costModifiers?.[0].amount).toBe(2);

    // 登场 ST03-006：原费用2，减免2后为0费，即使当前可用费用为0也能成功登场！
    const playRes = engine.applyAction({
      type: 'PLAY_CARD',
      playerId: activeId,
      cardInstanceId: xxiCard.instanceId,
      targetSlotIndex: 1,
    });

    expect(playRes.success).toBe(true);
    expect(xxiCard.zone).toBe('BATTLEFIELD');
    expect(xxiCard.slotIndex).toBe(1);
    // 减费修改器已正常消耗
    expect(player.costModifiers?.length ?? 0).toBe(0);
  });

  it('2. ST03-008 (21号·XXI) 横置发动效果后，下1张<薇拉>角色费用-1', () => {
    const engine = new GameEngine(
      'game-st03-cost-02',
      { playerId: 'p1', deckCardNumbers: createST03Deck() },
      { playerId: 'p2', deckCardNumbers: createST03Deck() },
      54321
    );

    const activeId = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });

    // 确保费用区有 3 张 DARK 属性的竖直明费
    const player = engine.getState().players[activeId]!;
    const darkDeckCards = engine.zoneMgr.getCardsInZone(activeId, 'DECK').filter(c => engine.cardDb.getCard(c.cardNumber)?.attribute === ElementAttribute.DARK);
    for (let i = 0; i < 3; i++) {
      engine.zoneMgr.moveCard(darkDeckCards[i].instanceId, 'COST', { isFaceUp: true, isReady: true });
    }
    const currentCosts = engine.zoneMgr.getCardsInZone(activeId, 'COST');
    player.availableOpenCostCount = currentCosts.filter(c => c.isFaceUp && c.isReady).length;
    player.openCostCount = currentCosts.filter(c => c.isFaceUp).length;
    player.totalCostCount = currentCosts.length;

    // 场上放置 ST03-008
    const xxi8 = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST03-008'
    )!;
    engine.fieldMgr.playRoleCard(activeId, xxi8.instanceId, 0);
    xxi8.isReady = true;

    // 手牌中放置 ST03-003 (薇拉·瑰丽，原费用4)
    const vera3 = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST03-003'
    )!;
    engine.zoneMgr.moveCard(vera3.instanceId, 'HAND', { isFaceUp: true });

    // 发动 ST03-008 起动能力
    const actRes = engine.applyAction({
      type: 'ACTIVATE_ABILITY',
      playerId: activeId,
      sourceCardId: xxi8.instanceId,
    });
    expect(actRes.success).toBe(true);
    expect(xxi8.isReady).toBe(false);

    const costBefore = player.availableOpenCostCount;

    // 原本 4 费的薇拉在 -1 费后需支付 3 费登场
    const playRes = engine.applyAction({
      type: 'PLAY_CARD',
      playerId: activeId,
      cardInstanceId: vera3.instanceId,
      targetSlotIndex: 1,
    });
    expect(playRes.success).toBe(true);
    expect(vera3.zone).toBe('BATTLEFIELD');
    // 恰好扣除了 3 点费用 (4 - 1 = 3)
    expect(player.availableOpenCostCount).toBe(costBefore - 3);
  });

  it('3. 从手牌发动信号球填充到信号球区只发动除【充能自】以外的效果；手牌充明费也不触发【充能自】', () => {
    const engine = new GameEngine(
      'game-hand-charge-01',
      { playerId: 'p1', deckCardNumbers: createST03Deck() },
      { playerId: 'p2', deckCardNumbers: createST03Deck() },
      99999
    );

    const activeId = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });

    // 从手牌打出 ST03-012 (猩红连斩，带有【充能自】)
    const sig12 = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST03-012'
    )!;
    engine.zoneMgr.moveCard(sig12.instanceId, 'HAND', { isFaceUp: true });

    const handBefore = engine.zoneMgr.getCardsInZone(activeId, 'HAND').length;

    const playRes = engine.applyAction({
      type: 'PLAY_CARD',
      playerId: activeId,
      cardInstanceId: sig12.instanceId,
    });
    expect(playRes.success).toBe(true);
    // 放入信号球区最上方并抽1张牌
    expect(engine.zoneMgr.getCardsInZone(activeId, 'SIGNAL_ORB').some((c) => c.instanceId === sig12.instanceId)).toBe(true);
    expect(engine.zoneMgr.getCardsInZone(activeId, 'HAND').length).toBe(handBefore);
    // 绝对不触发【充能自】，无 pendingChoice
    expect(engine.getState().currentPendingChoice).toBeUndefined();
  });

  it('4. 攻击充能步骤：记述有【充能0】的角色充能次数为0，默认角色充能次数为1并触发信号球【充能自】', () => {
    const engine = new GameEngine(
      'game-attack-charge-01',
      { playerId: 'p1', deckCardNumbers: createST03Deck() },
      { playerId: 'p2', deckCardNumbers: createST03Deck() },
      88888
    );

    const p1 = engine.getState().activePlayerId;
    const p2 = engine.getState().nonActivePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: p1 });

    // A. 测试记述有【充能0】的角色 (如 ST03-005) 攻击时充能次数为 0
    const vanillaRole = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === p1 && c.cardNumber === 'ST03-005'
    )!;
    engine.fieldMgr.playRoleCard(p1, vanillaRole.instanceId, 0);
    vanillaRole.isReady = true;
    vanillaRole.turnEnteredZone = 0; // 非登场回合，允许正常攻击

    // 验证充能次数判定为 0
    const chargeCount = engine.combatMgr.calculateRoleChargeCount(vanillaRole.instanceId);
    expect(chargeCount).toBe(0);

    const p1DeckBefore = engine.zoneMgr.getCardsInZone(p1, 'DECK').length;

    // 宣告攻击
    engine.applyAction({
      type: 'DECLARE_ATTACK',
      playerId: p1,
      attackerCardId: vanillaRole.instanceId,
      targetType: 'PLAYER',
    });

    // p2 不阻挡
    engine.applyAction({
      type: 'PASS_ACTION_TIMING',
      playerId: p2,
    });

    // 因为充能次数为 0，p1 牌组数量未发生变化 (未执行攻击充能)
    expect(engine.zoneMgr.getCardsInZone(p1, 'DECK').length).toBe(p1DeckBefore);

    // B. 测试默认角色 (ST03-001，默认充能次数为 1)
    const normalRole = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === p1 && c.cardNumber === 'ST03-001'
    )!;
    engine.fieldMgr.playRoleCard(p1, normalRole.instanceId, 1);
    normalRole.isReady = true;
    normalRole.turnEnteredZone = 0; // 非登场回合，允许正常攻击

    expect(engine.combatMgr.calculateRoleChargeCount(normalRole.instanceId)).toBe(1);

    // 将一张 ST03-012 信号球放置在 p1 牌组顶
    const topOrb = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === p1 && c.cardNumber === 'ST03-012' && c.zone === 'DECK'
    )!;
    engine.zoneMgr.moveCardToTopOfDeck(topOrb.instanceId);

    engine.applyAction({
      type: 'DECLARE_ATTACK',
      playerId: p1,
      attackerCardId: normalRole.instanceId,
      targetType: 'PLAYER',
    });

    engine.applyAction({
      type: 'PASS_ACTION_TIMING',
      playerId: p2,
    });

    // 攻击充能翻出信号球 ST03-012，置入信号球区并触发【充能自】决策
    const choice = engine.getState().currentPendingChoice;
    expect(choice).toBeDefined();
    expect(choice?.effectType).toBe('SIGNATURE_MOVE_EFFECT');
  });

  it('5. 伤害步骤伤害充能：受击玩家翻开牌到处理区并执行【充能自】，之后作为暗费置入费用区', () => {
    const engine = new GameEngine(
      'game-damage-charge-01',
      { playerId: 'p1', deckCardNumbers: createST03Deck() },
      { playerId: 'p2', deckCardNumbers: createST03Deck() },
      77777
    );

    const p1 = engine.getState().activePlayerId;
    const p2 = engine.getState().nonActivePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: p1 });

    // 让 p2 牌组顶为 ST03-013 (侵蚀烙印，带有【充能自】)
    const p2Orb = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === p2 && c.cardNumber === 'ST03-013' && c.zone === 'DECK'
    )!;
    engine.zoneMgr.moveCardToTopOfDeck(p2Orb.instanceId);

    const p2HiddenCostBefore = engine.getState().players[p2]!.hiddenCostCount;

    // p2 受到 1 点伤害充能
    engine.zoneMgr.applyDamageToPlayer(p2, 1);

    // 1. 触发了 ST03-013 的【充能自】
    const choice = engine.getState().currentPendingChoice;
    expect(choice).toBeDefined();
    expect(choice?.playerId).toBe(p2);
    expect(choice?.effectType).toBe('SIGNATURE_MOVE_EFFECT');

    // 2. 该牌背面朝上放置到了费用区成为暗费
    expect(engine.getState().players[p2]!.hiddenCostCount).toBe(p2HiddenCostBefore + 1);
    expect(p2Orb.zone).toBe('COST');
    expect(p2Orb.isFaceUp).toBe(false);
  });

  it('6. 暗费在使用后直接进入墓地；未使用的暗费于获取暗费玩家的回合结束阶段全部送入墓地', () => {
    const engine = new GameEngine(
      'game-hidden-cost-01',
      { playerId: 'p1', deckCardNumbers: createST03Deck() },
      { playerId: 'p2', deckCardNumbers: createST03Deck() },
      66666
    );

    const p1 = engine.getState().activePlayerId;
    const p2 = engine.getState().nonActivePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: p1 });

    const p1Player = engine.getState().players[p1]!;

    // 先将 p1 现存的明费全部设为横置 (耗尽可用明费)，这样后续 payCost(p1, 1) 必须扣减暗费
    for (const c of engine.zoneMgr.getCardsInZone(p1, 'COST')) {
      c.isReady = false;
    }
    p1Player.availableOpenCostCount = 0;
    p1Player.exhaustedOpenCostCount = p1Player.openCostCount;

    // 1. 给 p1 增加 1 张暗费
    const cardFromDeck = engine.zoneMgr.getCardsInZone(p1, 'DECK')[0]!;
    engine.zoneMgr.moveCard(cardFromDeck.instanceId, 'COST', { isFaceUp: false, isReady: true });
    p1Player.hiddenCostCount += 1;
    p1Player.totalCostCount += 1;

    // 使用暗费支付费用
    const paid = engine.payCost(p1, 1);
    expect(paid).toBe(true);
    // 暗费使用后直接进入墓地
    expect(cardFromDeck.zone).toBe('GRAVEYARD');
    expect(p1Player.hiddenCostCount).toBe(0);

    // 2. 给 p1 再次增加 1 张暗费，但在回合结束阶段未被使用
    const unusedHiddenCard = engine.zoneMgr.getCardsInZone(p1, 'DECK')[0]!;
    engine.zoneMgr.moveCard(unusedHiddenCard.instanceId, 'COST', { isFaceUp: false, isReady: true });
    p1Player.hiddenCostCount += 1;
    p1Player.totalCostCount += 1;

    // 同时给 p2 (非当前回合玩家) 也加 1 张暗费 (验证 p2 的暗费不会在 p1 的回合结束时被丢弃)
    const p2Player = engine.getState().players[p2]!;
    const p2Card = engine.zoneMgr.getCardsInZone(p2, 'DECK')[0]!;
    engine.zoneMgr.moveCard(p2Card.instanceId, 'COST', { isFaceUp: false, isReady: true });
    p2Player.hiddenCostCount += 1;
    p2Player.totalCostCount += 1;

    // p1 结束回合，触发 startEndPhase
    engine.phaseMachine.startEndPhase();

    // p1 的未使用暗费被送入墓地
    expect(unusedHiddenCard.zone).toBe('GRAVEYARD');
    expect(p1Player.hiddenCostCount).toBe(0);

    // p2 作为获取暗费的玩家，其当前尚未到达自身回合结束阶段，暗费依然保留！
    expect(p2Card.zone).toBe('COST');
    expect(p2Player.hiddenCostCount).toBe(1);
  });

  it('7. 信号球颜色准确性与同色三消：ST01-013(红莲-波动斩)为蓝球，ST01-014(红莲-闪击)为黄球，ST01-012(红莲-起手式)为红球', () => {
    function createMixedDeck(): string[] {
      return [
        'ST01-012', 'ST01-012', 'ST01-012', 'ST01-012',
        'ST01-013', 'ST01-013', 'ST01-013', 'ST01-013',
        'ST01-014', 'ST01-014', 'ST01-014', 'ST01-014',
        'ST03-001', 'ST03-001', 'ST03-001', 'ST03-001',
        'ST03-002', 'ST03-002', 'ST03-002', 'ST03-002',
        'ST03-003', 'ST03-003', 'ST03-003', 'ST03-003',
        'ST03-004', 'ST03-004',
        'ST03-005', 'ST03-005', 'ST03-005', 'ST03-005',
        'ST03-006', 'ST03-006', 'ST03-006', 'ST03-006',
        'ST03-007', 'ST03-007',
        'ST03-008', 'ST03-008', 'ST03-008', 'ST03-008',
        'ST03-009', 'ST03-009', 'ST03-009', 'ST03-009',
        'ST03-010', 'ST03-010',
      ];
    }

    const engine = new GameEngine(
      'game-orb-color-test',
      { playerId: 'p1', deckCardNumbers: createMixedDeck() },
      { playerId: 'p2', deckCardNumbers: createMixedDeck() },
      42
    );

    const p1 = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: p1 });

    const redCards = Object.values(engine.getState().cards).filter(
      (c) => c.controllerPlayerId === p1 && c.cardNumber === 'ST01-012'
    );
    const blueCards = Object.values(engine.getState().cards).filter(
      (c) => c.controllerPlayerId === p1 && c.cardNumber === 'ST01-013'
    );
    const yellowCards = Object.values(engine.getState().cards).filter(
      (c) => c.controllerPlayerId === p1 && c.cardNumber === 'ST01-014'
    );

    // 将 3 张 ST01-013 (蓝球，带红莲字样) 移入信号球区，但它们物理位置不相邻 (中间夹着红球与黄球)
    engine.zoneMgr.moveCard(blueCards[0]!.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(redCards[0]!.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(blueCards[1]!.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(yellowCards[0]!.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(blueCards[2]!.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    // 尝试消除 3 张蓝球 (虽然物理不相邻，但同色三消应当成功！)
    const handBefore = engine.zoneMgr.getCardsInZone(p1, 'HAND').length;
    const eliminateRes = engine.dispatchAction({
      type: 'ELIMINATE_3_ORBS',
      playerId: p1,
      orbCardInstanceIds: [
        blueCards[0]!.instanceId,
        blueCards[1]!.instanceId,
        blueCards[2]!.instanceId,
      ],
    });

    expect(eliminateRes.success).toBe(true);
    // 3 张蓝球应进入墓地，并抽 1 张牌
    expect(blueCards[0]!.zone).toBe('GRAVEYARD');
    expect(blueCards[1]!.zone).toBe('GRAVEYARD');
    expect(blueCards[2]!.zone).toBe('GRAVEYARD');
    expect(engine.zoneMgr.getCardsInZone(p1, 'HAND').length).toBe(handBefore + 1);

    // 验证如果不满足同色也不满足相邻，三消应失败 (例如 1红 1黄 1蓝 且不相邻)
    const failRes = engine.dispatchAction({
      type: 'ELIMINATE_3_ORBS',
      playerId: p1,
      orbCardInstanceIds: [
        redCards[0]!.instanceId,
        yellowCards[0]!.instanceId,
        redCards[1]!.instanceId,
      ],
    });
    expect(failRes.success).toBe(false);
  });

  it('8. ST01-001 (露西亚·红莲) 升变费用正确解析为2费，并能成功升变重叠在己方<露西亚>上方出场', () => {
    const engine = new GameEngine(
      'game-st01-ascension-01',
      { playerId: 'p1', deckCardNumbers: createST01Deck() },
      { playerId: 'p2', deckCardNumbers: createST01Deck() },
      99999
    );

    const p1 = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: p1 });

    const st01Def = engine.cardDb.getCard('ST01-001');
    expect(st01Def).toBeDefined();
    expect(st01Def?.ascensionConfig).toBeDefined();
    // 关键：升变代价必须是 2 费，不能被“费用5以下”误匹配为 5 费！
    expect(st01Def?.ascensionConfig?.ascensionCost).toBe(2);
    expect(st01Def?.ascensionConfig?.targetFilter.maxCost).toBe(5);
    expect(st01Def?.ascensionConfig?.targetFilter.nameIncludes).toBe('露西亚');

    const player = engine.getState().players[p1]!;
    player.availableOpenCostCount = 2;
    player.totalCostCount = 5;

    // 寻找一张 2 费的露西亚 (ST01-004) 放置在战场 0 号位
    const luciaCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === p1 && c.cardNumber === 'ST01-004'
    )!;
    engine.fieldMgr.playRoleCard(p1, luciaCard.instanceId, 0);

    // 寻找手牌中的 ST01-001
    let st01Card = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === p1 && c.cardNumber === 'ST01-001' && c.zone === 'HAND'
    );
    if (!st01Card) {
      st01Card = Object.values(engine.getState().cards).find(
        (c) => c.controllerPlayerId === p1 && c.cardNumber === 'ST01-001'
      )!;
      engine.zoneMgr.moveCard(st01Card.instanceId, 'HAND');
    }

    // 尝试升变出场：需要 2 费 (如果误解析为 5 费则会在可用费用只有 2 时失败)
    const playRes = engine.dispatchAction({
      type: 'PLAY_CARD',
      playerId: p1,
      cardInstanceId: st01Card.instanceId,
      isAscension: true,
      targetAscensionCardId: luciaCard.instanceId,
    });

    expect(playRes.success).toBe(true);
    // 验证扣费为 2 (从 2 扣减至 0)
    expect(player.availableOpenCostCount).toBe(0);
    // 验证战场 0 号位为 ST01-001
    const slot0 = engine.fieldMgr.getSlots(p1)[0];
    expect(slot0.roleCardId).toBe(st01Card.instanceId);
    // 验证原角色进入垫牌区 (underneathCardIds)
    const currentOnField = engine.state.cards[st01Card.instanceId];
    expect(currentOnField?.underneathCardIds).toContain(luciaCard.instanceId);
  });

  it('9. ST01-012 (红莲-起手式) 【充能自】选择效果2(PP+2000)时，生成目标选择决策(SELECT_ROLE_FOR_CHARGE_BUFF)，并能正确指定我方战场角色加2000PP', () => {
    const engine = new GameEngine(
      'game-st01-012-target-01',
      { playerId: 'p1', deckCardNumbers: createST01Deck() },
      { playerId: 'p2', deckCardNumbers: createST01Deck() },
      11111
    );

    const p1 = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: p1 });

    // 在战场放置两名角色：角色A(ST01-004)与角色B(ST01-002)
    const roleA = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === p1 && c.cardNumber === 'ST01-004'
    )!;
    const roleB = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === p1 && c.cardNumber === 'ST01-002'
    )!;
    engine.fieldMgr.playRoleCard(p1, roleA.instanceId, 0);
    engine.fieldMgr.playRoleCard(p1, roleB.instanceId, 1);

    // 寻找一张 ST01-012 信号球放置在处理区
    const orb12 = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === p1 && c.cardNumber === 'ST01-012'
    )!;
    engine.zoneMgr.moveCard(orb12.instanceId, 'PROCESSING');

    const orbDef = engine.cardDb.getCard('ST01-012')!;
    // 触发【充能自】
    engine.effectEngine.handleChargeAutoEffect(p1, orb12.instanceId, orbDef);

    // 检查第1级决策：两项效果二选一
    const pending1 = engine.getState().currentPendingChoice;
    expect(pending1).toBeDefined();
    expect(pending1?.effectType).toBe('SIGNATURE_MOVE_EFFECT');
    expect(pending1?.options.some((o) => o.id === 'opt_pp_plus_2000')).toBe(true);

    // 玩家选择效果2：PP+2000
    const choiceRes1 = engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: p1,
      pendingChoiceId: pending1!.id,
      selectedIds: ['opt_pp_plus_2000'],
    });
    expect(choiceRes1.success).toBe(true);

    // 检查第2级决策：必须生成选择战场角色的决策 (SELECT_ROLE_FOR_CHARGE_BUFF)
    const pending2 = engine.getState().currentPendingChoice;
    expect(pending2).toBeDefined();
    expect(pending2?.effectType).toBe('SELECT_ROLE_FOR_CHARGE_BUFF');
    expect(pending2?.options.length).toBe(2);
    expect(pending2?.options.map((o) => o.id)).toContain(roleA.instanceId);
    expect(pending2?.options.map((o) => o.id)).toContain(roleB.instanceId);

    // 玩家指定卡位1的角色B进行加成
    const choiceRes2 = engine.dispatchAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: p1,
      pendingChoiceId: pending2!.id,
      selectedIds: [roleB.instanceId],
    });
    expect(choiceRes2.success).toBe(true);

    // 验证效果结算：角色B获得 tempPPBonus = 2000，角色A不受影响
    expect(roleB.tempPPBonus).toBe(2000);
    expect(roleA.tempPPBonus).toBeUndefined();
    // 决策完成，无待处理决策
    expect(engine.getState().currentPendingChoice).toBeUndefined();
  });

  it('9. ST03-011 (三头犬出击) 固有静态减费：我方战场有5张<三头犬小队>角色时，手牌中该牌由8费降为3费发动', () => {
    const engine = new GameEngine(
      'game-st03-011-cost-reduction',
      { playerId: 'p1', deckCardNumbers: createST03Deck() },
      { playerId: 'p2', deckCardNumbers: createST03Deck() },
      88888
    );

    const activeId = engine.getState().activePlayerId;
    const oppId = engine.getState().nonActivePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });
    expect(engine.getState().phase).toBe('MAIN_PHASE');

    const player = engine.getState().players[activeId]!;

    // 1. 在己方战场的 5 个卡位分别放置 5 张<三头犬小队>角色 (ST03-001 ~ ST03-005)
    const cerberusCardNums = ['ST03-001', 'ST03-002', 'ST03-003', 'ST03-004', 'ST03-005'];
    for (let slot = 0; slot < 5; slot++) {
      const card = Object.values(engine.getState().cards).find(
        (c) => c.controllerPlayerId === activeId && c.cardNumber === cerberusCardNums[slot] && c.zone === 'DECK'
      )!;
      engine.fieldMgr.playRoleCard(activeId, card.instanceId, slot);
      card.isReady = true;
    }

    // 2. 在对方战场放置 1 张角色卡 (供 ST03-011 破坏效果作为目标)
    const oppRole = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === oppId && c.zone === 'DECK' && engine.cardDb.getCard(c.cardNumber)?.cardType === CardType.ROLE
    )!;
    engine.fieldMgr.playRoleCard(oppId, oppRole.instanceId, 0);

    // 3. 将 ST03-011 放入 activeId 手牌
    const tacticsCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST03-011'
    )!;
    engine.zoneMgr.moveCard(tacticsCard.instanceId, 'HAND', { isFaceUp: true });

    // 4. 配置费用区：包含 PHYSICAL 属性明费 (满足 8.6.2.a.1 属性条件)，可用费用恰好为 3 费
    // 清空现有费用区卡牌
    const existingCosts = engine.zoneMgr.getCardsInZone(activeId, 'COST');
    for (const c of existingCosts) {
      engine.zoneMgr.moveCard(c.instanceId, 'GRAVEYARD');
    }
    // 从牌组中挑出 3 张 PHYSICAL 属性卡放入费用区 (如 ST03-004 / ST03-005 / ST03-009)
    const physDeckCards = engine.zoneMgr.getCardsInZone(activeId, 'DECK').filter(
      (c) => engine.cardDb.getCard(c.cardNumber)?.attribute === ElementAttribute.PHYSICAL
    );
    for (let i = 0; i < 3; i++) {
      engine.zoneMgr.moveCard(physDeckCards[i].instanceId, 'COST', { isFaceUp: true, isReady: true });
    }
    player.availableOpenCostCount = 3;
    player.openCostCount = 3;
    player.exhaustedOpenCostCount = 0;
    player.hiddenCostCount = 0;
    player.totalCostCount = 3;

    // 5. 验证静态减费计算：基础 8 费 - 5 张三头犬角色 = 3 费
    const { costToPay } = engine.calculateCardCost(activeId, tacticsCard.instanceId);
    expect(costToPay).toBe(3);

    // 6. 执行打出 ST03-011：只需 3 费即可成功发动！
    const playRes = engine.applyAction({
      type: 'PLAY_CARD',
      playerId: activeId,
      cardInstanceId: tacticsCard.instanceId,
    });
    expect(playRes.success).toBe(true);

    // 7. 费用已正确扣减 3 点 (可用费用变为 0)
    expect(player.availableOpenCostCount).toBe(0);
    expect(player.exhaustedOpenCostCount).toBe(3);

    // 8. 战术卡进入结算并弹出破坏对方角色的决策窗口
    const pendingChoice = engine.getState().currentPendingChoice;
    expect(pendingChoice).toBeDefined();
    expect(pendingChoice?.effectType).toBe('DESTROY_ROLE');
    expect(pendingChoice?.options.some((o) => o.id === oppRole.instanceId)).toBe(true);
  });
});
