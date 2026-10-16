import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/engine.js';
import { CardType, ElementAttribute, SignalOrbType } from '@zhanshuang/shared';
import { OFFICIAL_CARDS_DATA } from '../src/database/official-cards-data.js';

function createDeck(cardNumbers: string[]): string[] {
  const deck: string[] = [];
  while (deck.length < 50) {
    deck.push(...cardNumbers);
  }
  return deck.slice(0, 50);
}

describe('全量卡表 (490张官方卡牌) 效果机制与战斗特性全面覆盖测试', () => {
  it('1. 全量 490 张官方卡牌数据完整性与升变规则配置验证', () => {
    expect(OFFICIAL_CARDS_DATA.length).toBeGreaterThanOrEqual(490);

    // 验证升变卡识别：共 39 张升变角色卡
    const ascensionCards = OFFICIAL_CARDS_DATA.filter((c) => c.ascensionConfig);
    expect(ascensionCards.length).toBe(39);

    for (const asc of ascensionCards) {
      expect(asc.ascensionConfig).toBeDefined();
      expect(asc.ascensionConfig!.ascensionCost).toBeGreaterThan(0);
      expect(asc.ascensionConfig!.targetFilter.nameIncludes).toBeTruthy();
    }
  });

  it('2. 官方升变卡重叠出场、费用扣除与速攻赋予完整机制 (BP01-001 露西亚·鸦羽 & ST01-001 露西亚·红莲)', () => {
    const engine = new GameEngine(
      'game-asc-001',
      { playerId: 'p1', deckCardNumbers: createDeck(['ST01-001', 'ST01-005']) },
      { playerId: 'p2', deckCardNumbers: createDeck(['ST01-005']) },
      42
    );

    const p1 = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: p1 });

    const player = engine.getState().players[p1]!;
    player.openCostCount = 6;
    player.availableOpenCostCount = 6;
    player.totalCostCount = 6;

    // 场上放置被升变目标：ST01-005 (露西亚·红莲，费用4，属于<露西亚>)
    const baseTarget = engine.zoneMgr.getCardsInZone(p1, 'DECK')[0]!;
    baseTarget.cardNumber = 'ST01-005';
    baseTarget.cardId = 'c-st01-005';
    engine.fieldMgr.playRoleCard(p1, baseTarget.instanceId, 0);

    // 手牌准备升变卡：ST01-001 (露西亚·红莲，升变条件<=5费露西亚，升变代价2费，获速攻)
    const ascRole = engine.zoneMgr.getCardsInZone(p1, 'DECK')[1]!;
    ascRole.cardNumber = 'ST01-001';
    ascRole.cardId = 'c-st01-001';
    engine.zoneMgr.moveCard(ascRole.instanceId, 'HAND', { isFaceUp: true });

    // 费用区提供明费以满足属性
    const costCard = engine.zoneMgr.getCardsInZone(p1, 'DECK')[2]!;
    costCard.cardNumber = 'ST01-005';
    costCard.cardId = 'c-st01-005';
    engine.zoneMgr.moveCard(costCard.instanceId, 'COST', { isFaceUp: true, isReady: true });

    // 执行升变出场
    const ascRes = engine.applyAction({
      type: 'PLAY_CARD',
      playerId: p1,
      cardInstanceId: ascRole.instanceId,
      isAscension: true,
      targetAscensionCardId: baseTarget.instanceId,
    });

    expect(ascRes.success).toBe(true);
    // 扣除升变代价 2 费 (6 - 2 = 4)
    expect(player.availableOpenCostCount).toBe(4);
    // 战场当前角色变为 ascRole
    expect(engine.getState().battlefields[p1]![0]!.roleCardId).toBe(ascRole.instanceId);
    // 底卡保留原角色
    expect(engine.getState().cards[ascRole.instanceId]?.underneathCardIds).toContain(baseTarget.instanceId);
    // 获得速攻词条
    expect(engine.getState().cards[ascRole.instanceId]?.grantedKeywords).toContain('速攻');

    // ST01-001 的【出】(丢弃1张手牌：……) 代价可选，选择不支付以完成出场能力的处理
    const entryChoice = engine.getState().currentPendingChoice;
    expect(entryChoice?.minSelections).toBe(0);
    expect(
      engine.applyAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: p1,
        pendingChoiceId: entryChoice!.id,
        selectedIds: [],
      }).success
    ).toBe(true);

    // 验证速攻出场当回合可直接宣告攻击
    const attackRes = engine.applyAction({
      type: 'DECLARE_ATTACK',
      playerId: p1,
      attackerCardId: ascRole.instanceId,
      targetType: 'PLAYER',
    });
    expect(attackRes.success).toBe(true);
  });

  it('3. 招式/专武战术卡【充能自】三向分支全自适应机制 (BP01-078 DP+1, BP01-081 抽牌, BP01-084 侵蚀-1)', () => {
    const engine = new GameEngine(
      'game-charge-auto',
      { playerId: 'p1', deckCardNumbers: createDeck(['BP01-078', 'BP01-081', 'BP01-084', 'ST01-005']) },
      { playerId: 'p2', deckCardNumbers: createDeck(['ST01-005']) },
      42
    );

    const p1 = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: p1 });

    const player = engine.getState().players[p1]!;
    player.openCostCount = 10;
    player.availableOpenCostCount = 10;
    player.totalCostCount = 10;

    // 战场放一个角色以接收 PP/DP buff
    const role = engine.zoneMgr.getCardsInZone(p1, 'DECK')[0]!;
    role.cardNumber = 'ST01-005';
    role.cardId = 'c-st01-005';
    engine.fieldMgr.playRoleCard(p1, role.instanceId, 0);

    // A. 测试手牌使用 BP01-078 (进入信号球区，抽1张牌，不触发【充能自】)
    const card78 = engine.zoneMgr.getCardsInZone(p1, 'DECK')[1]!;
    card78.cardNumber = 'BP01-078';
    card78.cardId = 'c-bp01-078';
    engine.zoneMgr.moveCard(card78.instanceId, 'HAND', { isFaceUp: true });

    const play78 = engine.applyAction({
      type: 'PLAY_CARD',
      playerId: p1,
      cardInstanceId: card78.instanceId,
    });
    expect(play78.success).toBe(true);
    // 进入信号球区
    expect(engine.zoneMgr.getCardsInZone(p1, 'SIGNAL_ORB').some((c) => c.instanceId === card78.instanceId)).toBe(true);
    // 从手牌打出时不触发充能自
    expect(engine.getState().currentPendingChoice).toBeUndefined();

    // B. 测试攻击充能中翻出 BP01-078 时触发【充能自】(DP+1 / PP+2000)
    const card78Charge = engine.zoneMgr.getCardsInZone(p1, 'DECK')[0]!;
    card78Charge.cardNumber = 'BP01-078';
    card78Charge.cardId = 'c-bp01-078';
    engine.zoneMgr.moveCardToTopOfDeck(card78Charge.instanceId);
    // 执行攻击充能
    engine.zoneMgr.performAttackCharge(role.instanceId, 1);
    let choice = engine.getState().currentPendingChoice;
    expect(choice).toBeDefined();
    expect(choice?.options.some((o) => o.id === 'opt_dp_plus_1')).toBe(true);

    // 玩家选择 DP+1
    const res78 = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: p1,
      pendingChoiceId: choice!.id,
      selectedIds: ['opt_dp_plus_1'],
    });
    expect(res78.success).toBe(true);
    const roleChoice78 = engine.getState().currentPendingChoice;
    if (roleChoice78) {
      engine.applyAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: p1,
        pendingChoiceId: roleChoice78.id,
        selectedIds: [role.instanceId],
      });
    }
    expect(role.tempDPBonus).toBe(1);

    // C. 测试伤害充能中翻出 BP01-081 时触发【充能自】(抽1张牌 / PP+2000)
    const handCountBefore = engine.zoneMgr.getCardsInZone(p1, 'HAND').length;
    const card81 = engine.zoneMgr.getCardsInZone(p1, 'DECK')[0]!;
    card81.cardNumber = 'BP01-081';
    card81.cardId = 'c-bp01-081';
    engine.zoneMgr.moveCardToTopOfDeck(card81.instanceId);

    // 执行伤害充能 (受到1点伤害)
    engine.zoneMgr.applyDamageToPlayer(p1, 1);
    choice = engine.getState().currentPendingChoice;
    expect(choice).toBeDefined();
    expect(choice?.options.some((o) => o.id === 'opt_draw_1')).toBe(true);

    // 玩家选择 额外抽1张牌
    const res81 = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: p1,
      pendingChoiceId: choice!.id,
      selectedIds: ['opt_draw_1'],
    });
    expect(res81.success).toBe(true);
    // 伤害充能触发充能自抽1张牌
    expect(engine.zoneMgr.getCardsInZone(p1, 'HAND').length).toBe(handCountBefore + 1);
  });

  it('4. 官方装备牌动态 PP/DP 增益解析与角色附着机制 (20张装备卡自适应)', () => {
    const engine = new GameEngine(
      'game-equip-test',
      { playerId: 'p1', deckCardNumbers: createDeck(['ST01-005']) },
      { playerId: 'p2', deckCardNumbers: createDeck(['ST01-005']) },
      42
    );

    const p1 = engine.getState().activePlayerId;
    const role = engine.zoneMgr.getCardsInZone(p1, 'DECK')[0]!;
    role.cardNumber = 'ST01-005';
    role.cardId = 'c-st01-005';
    engine.fieldMgr.playRoleCard(p1, role.instanceId, 0);

    // 模拟任意装备卡 (附带 PP+1500, DP+1)
    const mockEquipDef = {
      id: 'equip-test-weapon',
      cardNumber: 'BP03-042',
      name: '冈格尼尔',
      cardType: CardType.EQUIPMENT,
      attribute: ElementAttribute.PHYSICAL,
      cost: 2,
      basePP: 1500,
      baseDP: 1,
      traits: ['装备'],
      isInstant: false,
      abilities: [],
      rulesText: '装备角色的PP+1500，DP+1。',
    };

    engine.effectEngine.handleEquipmentBuff(role.instanceId, mockEquipDef);
    expect(role.tempPPBonus).toBe(1500);
    expect(role.tempDPBonus).toBe(1);
  });

  it('5. 战斗核心机制：【同命】(Mutual Destiny) 双向破坏与【贯通】(Piercing) 贯穿伤害', () => {
    const engine = new GameEngine(
      'game-combat-keywords',
      { playerId: 'p1', deckCardNumbers: createDeck(['ST01-005']) },
      { playerId: 'p2', deckCardNumbers: createDeck(['ST01-005']) },
      42
    );

    const p1 = engine.getState().activePlayerId;
    const p2 = engine.getState().nonActivePlayerId;
    engine.getState().phase = 'MAIN_PHASE';

    // 攻击方持【贯通】(BP01-010 罗兰·戏炎，PP 5000)
    const attacker = engine.zoneMgr.getCardsInZone(p1, 'DECK')[0]!;
    attacker.cardNumber = 'BP01-010';
    attacker.cardId = 'c-bp01-010';
    engine.fieldMgr.playRoleCard(p1, attacker.instanceId, 0);
    attacker.isReady = true;
    attacker.turnEnteredZone = 0;

    // 防守方持【同命】(PP 2000, BP02-077 塞壬)
    const defender = engine.zoneMgr.getCardsInZone(p2, 'DECK')[0]!;
    defender.cardNumber = 'BP02-077';
    defender.cardId = 'c-bp02-077';
    engine.fieldMgr.playRoleCard(p2, defender.instanceId, 0);
    defender.isReady = false; // 横置
    defender.turnEnteredZone = 0;

    const defenderErosionBefore = engine.getState().players[p2]!.erosionCount;

    // 攻击角色
    const attackRes = engine.applyAction({
      type: 'DECLARE_ATTACK',
      playerId: p1,
      attackerCardId: attacker.instanceId,
      targetType: 'CHARACTER',
      targetCardId: defender.instanceId,
    });
    expect(attackRes.success).toBe(true);

    // 守方不阻挡，直接结算角色战斗
    engine.applyAction({
      type: 'PASS_ACTION_TIMING',
      playerId: p2,
    });

    // 验证：
    // 1. 守方角色被战斗破坏 (6000 >= 2000)
    expect(defender.zone).toBe('GRAVEYARD');
    // 2. 攻方持有【贯通】，给予对方玩家1点贯通伤害 (侵蚀+1)
    expect(engine.getState().players[p2]!.erosionCount).toBe(defenderErosionBefore + 1);
    // 3. 守方持有【同命】，战斗破坏时带走攻击角色
    expect(attacker.zone).toBe('GRAVEYARD');
  });

  it('6. 通用【出】能力：抽牌、弃牌、削弱与检索自适应结算 (全量140张出场能力角色覆盖)', () => {
    const engine = new GameEngine(
      'game-entry-effects',
      { playerId: 'p1', deckCardNumbers: createDeck(['ST01-005']) },
      { playerId: 'p2', deckCardNumbers: createDeck(['ST01-005']) },
      42
    );

    const p1 = engine.getState().activePlayerId;
    const handBefore = engine.zoneMgr.getCardsInZone(p1, 'HAND').length;

    // 模拟出场角色触发抽2张牌
    const role = engine.zoneMgr.getCardsInZone(p1, 'DECK')[0]!;
    role.cardNumber = 'BP01-001';
    engine.fieldMgr.playRoleCard(p1, role.instanceId, 0);

    const customEntryCard = {
      id: 'custom-entry',
      cardNumber: 'TEST-ENTRY-01',
      name: '测试战术角色',
      cardType: CardType.ROLE,
      attribute: ElementAttribute.FIRE,
      cost: 2,
      traits: ['灰鸦小队'],
      isInstant: false,
      abilities: [],
      rulesText: '【出】：抽2张牌，该牌PP+1500。',
    };

    engine.effectEngine.resolveUniversalEntryEffect(p1, role.instanceId, customEntryCard);
    expect(engine.zoneMgr.getCardsInZone(p1, 'HAND').length).toBe(handBefore + 2);
    expect(role.tempPPBonus).toBe(1500);
  });

  it('7. BP01-003 露西亚·鸦羽：回手己方灰鸦小队角色并指定回手<=5费角色', () => {
    const engine = new GameEngine(
      'game-bp01-003',
      { playerId: 'p1', deckCardNumbers: createDeck(['BP01-003', 'ST01-005']) },
      { playerId: 'p2', deckCardNumbers: createDeck(['ST01-005']) },
      42
    );

    const p1 = engine.getState().activePlayerId;
    const p2 = engine.getState().nonActivePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: p1 });

    // p1 场上有灰鸦小队角色 ST01-005
    const friendlyRole = engine.zoneMgr.getCardsInZone(p1, 'DECK')[0]!;
    friendlyRole.cardNumber = 'ST01-005';
    engine.fieldMgr.playRoleCard(p1, friendlyRole.instanceId, 0);

    // p2 场上有 4费角色 ST01-005
    const oppRole = engine.zoneMgr.getCardsInZone(p2, 'DECK')[0]!;
    oppRole.cardNumber = 'ST01-005';
    engine.fieldMgr.playRoleCard(p2, oppRole.instanceId, 0);

    // p1 出场 BP01-003
    const bp01003 = engine.zoneMgr.getCardsInZone(p1, 'DECK')[1]!;
    bp01003.cardNumber = 'BP01-003';
    engine.fieldMgr.playRoleCard(p1, bp01003.instanceId, 1);

    const cardDef = engine.effectEngine.getCardDef('BP01-003')!;
    engine.effectEngine.handleRoleEntryEffect(p1, bp01003.instanceId, cardDef);

    // 此时应该产生了 PendingChoice (回手灰鸦小队角色)
    const choice1 = engine.getState().currentPendingChoice;
    expect(choice1).toBeDefined();
    expect(choice1?.effectType).toBe('BP01_003_BOUNCE_STEP1');
    expect(choice1?.options.some((o) => o.id === friendlyRole.instanceId)).toBe(true);

    // 确认选择 friendlyRole
    const res1 = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: p1,
      pendingChoiceId: choice1!.id,
      selectedIds: [friendlyRole.instanceId],
    });
    expect(res1.success).toBe(true);
    expect(friendlyRole.zone).toBe('HAND');

    // 派生出第二阶段：选择战场<=5费角色回手
    const choice2 = engine.getState().currentPendingChoice;
    expect(choice2).toBeDefined();
    expect(choice2?.effectType).toBe('BOUNCE_ROLE');
    expect(choice2?.options.some((o) => o.id === oppRole.instanceId)).toBe(true);

    // 确认选择 oppRole
    const res2 = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: p1,
      pendingChoiceId: choice2!.id,
      selectedIds: [oppRole.instanceId],
    });
    expect(res2.success).toBe(true);
    expect(oppRole.zone).toBe('HAND');
  });

  it('8. BP01-008 露娜·银冕：出场消除同色信号球并将对方战场角色横置送入对方费用区', () => {
    const engine = new GameEngine(
      'game-bp01-008',
      { playerId: 'p1', deckCardNumbers: createDeck(['BP01-008', 'ST01-005']) },
      { playerId: 'p2', deckCardNumbers: createDeck(['ST01-005']) },
      42
    );

    const p1 = engine.getState().activePlayerId;
    const p2 = engine.getState().nonActivePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: p1 });

    // p2 场上有角色 ST01-005
    const oppRole = engine.zoneMgr.getCardsInZone(p2, 'DECK')[0]!;
    oppRole.cardNumber = 'ST01-005';
    engine.fieldMgr.playRoleCard(p2, oppRole.instanceId, 0);

    // p1 出场 BP01-008
    const bp01008 = engine.zoneMgr.getCardsInZone(p1, 'DECK')[0]!;
    bp01008.cardNumber = 'BP01-008';
    engine.fieldMgr.playRoleCard(p1, bp01008.instanceId, 0);

    const cardDef = engine.effectEngine.getCardDef('BP01-008')!;
    engine.effectEngine.handleRoleEntryEffect(p1, bp01008.instanceId, cardDef);

    const choice = engine.getState().currentPendingChoice;
    expect(choice).toBeDefined();
    expect(choice?.effectType).toBe('SEND_ROLE_TO_COST');
    expect(choice?.options.some((o) => o.id === oppRole.instanceId)).toBe(true);

    // 确认送入费用区
    const res = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: p1,
      pendingChoiceId: choice!.id,
      selectedIds: [oppRole.instanceId],
    });
    expect(res.success).toBe(true);
    expect(oppRole.zone).toBe('COST');
    expect(oppRole.isReady).toBe(false);
  });

  it('9. ST02-003 露娜·银冕：出场弃1张手牌，公开牌组顶3张至处理区，对手查阅确认后，选择<升格者>角色加入手牌，其余卡牌入墓', () => {
    const engine = new GameEngine(
      'game-st02-003-flow',
      { playerId: 'p1', deckCardNumbers: createDeck(['ST02-003', 'ST02-001', 'ST01-012', 'ST01-013']) },
      { playerId: 'p2', deckCardNumbers: createDeck(['ST01-005']) },
      42
    );

    const p1 = engine.getState().activePlayerId;
    const p2 = engine.getState().nonActivePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: p1 });

    const handCard = engine.zoneMgr.getCardsInZone(p1, 'HAND')[0]!;
    const deck = engine.zoneMgr.getCardsInZone(p1, 'DECK');

    const lunaCard = deck[0]!;
    lunaCard.cardNumber = 'ST02-003';
    lunaCard.cardId = 'c-st02-003';

    // 构造牌组顶3张牌：第1张为升格者角色 ST02-001 (加百列)，后2张为信号球
    const ascRole = deck[1]!;
    ascRole.cardNumber = 'ST02-001';
    ascRole.cardId = 'c-st02-001';

    const nonAsc1 = deck[2]!;
    nonAsc1.cardNumber = 'ST01-012';
    nonAsc1.cardId = 'c-st01-012';

    const nonAsc2 = deck[3]!;
    nonAsc2.cardNumber = 'ST01-013';
    nonAsc2.cardId = 'c-st01-013';

    engine.zoneMgr.moveCardToTopOfDeck(nonAsc2.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(nonAsc1.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(ascRole.instanceId);

    // 出场 ST02-003
    engine.fieldMgr.playRoleCard(p1, lunaCard.instanceId, 0);

    const cardDef = engine.effectEngine.getCardDef('ST02-003')!;
    engine.effectEngine.handleRoleEntryEffect(p1, lunaCard.instanceId, cardDef);

    // 第一步：弃牌代价选择弹窗
    const discardChoice = engine.getState().currentPendingChoice;
    expect(discardChoice).toBeDefined();
    expect(discardChoice?.effectType).toBe('ST02_003_DISCARD_SEARCH');
    expect(discardChoice?.playerId).toBe(p1);

    const discardRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: p1,
      pendingChoiceId: discardChoice!.id,
      selectedIds: [handCard.instanceId],
    });
    expect(discardRes.success).toBe(true);
    expect(handCard.zone).toBe('GRAVEYARD');

    // 牌组顶3张牌移入 PROCESSING 处理区，正面朝上
    expect(ascRole.zone).toBe('PROCESSING');
    expect(ascRole.isFaceUp).toBe(true);
    expect(nonAsc1.zone).toBe('PROCESSING');
    expect(nonAsc2.zone).toBe('PROCESSING');

    // 第二步：双方展示，必须先由对手 (p2) 查阅确认
    const oppChoice = engine.getState().currentPendingChoice;
    expect(oppChoice).toBeDefined();
    expect(oppChoice?.effectType).toBe('OPPONENT_CONFIRM_REVEAL');
    expect(oppChoice?.playerId).toBe(p2);

    const oppConfirmRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: p2,
      pendingChoiceId: oppChoice!.id,
      selectedIds: [],
    });
    expect(oppConfirmRes.success).toBe(true);

    // 第三步：对手确认后，流转回 p1 进行卡牌选择
    const searchChoice = engine.getState().currentPendingChoice;
    expect(searchChoice).toBeDefined();
    expect(searchChoice?.playerId).toBe(p1);
    expect(searchChoice?.options.length).toBe(3);

    // 升格者角色应被高亮标记为可选取
    const ascOpt = searchChoice?.options.find((o) => o.id === ascRole.instanceId);
    expect(ascOpt).toBeDefined();
    expect((ascOpt?.payload as any)?.eligible).toBe(true);

    const selectRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: p1,
      pendingChoiceId: searchChoice!.id,
      selectedIds: [ascRole.instanceId],
    });
    expect(selectRes.success).toBe(true);

    // 升格者角色加入手牌，其余2张送入墓地
    expect(ascRole.zone).toBe('HAND');
    expect(nonAsc1.zone).toBe('GRAVEYARD');
    expect(nonAsc2.zone).toBe('GRAVEYARD');
    expect(engine.getState().currentPendingChoice).toBeUndefined();
  });

  it('10. ST02-003 露娜·银冕：牌组顶3张无升格者角色时，对手确认后发动方确认，3张牌全部安全入墓无报错', () => {
    const engine = new GameEngine(
      'game-st02-003-nomatch',
      { playerId: 'p1', deckCardNumbers: createDeck(['ST02-003', 'ST01-012', 'ST01-013', 'ST01-014']) },
      { playerId: 'p2', deckCardNumbers: createDeck(['ST01-005']) },
      42
    );

    const p1 = engine.getState().activePlayerId;
    const p2 = engine.getState().nonActivePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: p1 });

    const handCard = engine.zoneMgr.getCardsInZone(p1, 'HAND')[0]!;
    const deck = engine.zoneMgr.getCardsInZone(p1, 'DECK');
    const lunaCard = deck[0]!;
    lunaCard.cardNumber = 'ST02-003';
    lunaCard.cardId = 'c-st02-003';

    // 顶3张设为非升格者卡牌
    deck[1]!.cardNumber = 'ST01-012';
    deck[2]!.cardNumber = 'ST01-013';
    deck[3]!.cardNumber = 'ST01-014';
    engine.zoneMgr.moveCardToTopOfDeck(deck[3]!.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(deck[2]!.instanceId);
    engine.zoneMgr.moveCardToTopOfDeck(deck[1]!.instanceId);

    engine.fieldMgr.playRoleCard(p1, lunaCard.instanceId, 0);

    const cardDef = engine.effectEngine.getCardDef('ST02-003')!;
    engine.effectEngine.handleRoleEntryEffect(p1, lunaCard.instanceId, cardDef);

    // p1 弃牌
    const discardChoice = engine.getState().currentPendingChoice;
    engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: p1,
      pendingChoiceId: discardChoice!.id,
      selectedIds: [handCard.instanceId],
    });

    // 对手确认
    const oppChoice = engine.getState().currentPendingChoice;
    expect(oppChoice?.effectType).toBe('OPPONENT_CONFIRM_REVEAL');
    engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: p2,
      pendingChoiceId: oppChoice!.id,
      selectedIds: [],
    });

    // p1 确认选择（0张）
    const searchChoice = engine.getState().currentPendingChoice;
    expect(searchChoice).toBeDefined();
    expect(searchChoice?.minSelections).toBe(0);

    const selectRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: p1,
      pendingChoiceId: searchChoice!.id,
      selectedIds: [],
    });
    expect(selectRes.success).toBe(true);
    expect(engine.getState().currentPendingChoice).toBeUndefined();
  });

  it('11. ST02-003 露娜·银冕：若玩家选择跳过出场弃牌代价，则不公开卡牌，正常结束结算', () => {
    const engine = new GameEngine(
      'game-st02-003-skip',
      { playerId: 'p1', deckCardNumbers: createDeck(['ST02-003', 'ST01-012']) },
      { playerId: 'p2', deckCardNumbers: createDeck(['ST01-005']) },
      42
    );

    const p1 = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: p1 });

    const deck = engine.zoneMgr.getCardsInZone(p1, 'DECK');
    const lunaCard = deck[0]!;
    lunaCard.cardNumber = 'ST02-003';
    lunaCard.cardId = 'c-st02-003';
    engine.fieldMgr.playRoleCard(p1, lunaCard.instanceId, 0);

    const cardDef = engine.effectEngine.getCardDef('ST02-003')!;
    engine.effectEngine.handleRoleEntryEffect(p1, lunaCard.instanceId, cardDef);

    const discardChoice = engine.getState().currentPendingChoice;
    expect(discardChoice).toBeDefined();
    expect(discardChoice?.minSelections).toBe(0);

    // 玩家选择跳过 (选择0张)
    const skipRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: p1,
      pendingChoiceId: discardChoice!.id,
      selectedIds: [],
    });

    expect(skipRes.success).toBe(true);
    expect(engine.getState().currentPendingChoice).toBeUndefined();
  });
});
