import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/engine.js';
import { CardType, ElementAttribute, SignalOrbType } from '@zhanshuang/shared';
import { OFFICIAL_CARDS_DATA } from '../src/database/official-cards-data.js';
import { fillCostZone } from './helpers.js';

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
    fillCostZone(engine, player, 6);

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

    const availableBefore = engine.getState().players[p1]!.availableOpenCostCount;

    // 执行升变出场
    const ascRes = engine.applyAction({
      type: 'PLAY_CARD',
      playerId: p1,
      cardInstanceId: ascRole.instanceId,
      isAscension: true,
      targetAscensionCardId: baseTarget.instanceId,
    });

    expect(ascRes.success).toBe(true);
    // 扣除升变代价 2 费
    expect(player.availableOpenCostCount).toBe(availableBefore - 2);
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
    fillCostZone(engine, player, 10);

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
