import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/engine.js';
import { CardType } from '@zhanshuang/shared';
import { endTurn, fillCostZone } from './helpers.js';

function createCustomDeck(): string[] {
  return [
    'ST01-012', 'ST01-012', 'ST01-013', 'ST01-014',
    'ST01-001', 'ST01-002', 'ST01-003', 'ST01-004', 'ST01-005', 'ST01-006',
    'ST01-009', 'ST01-010', 'ST01-011', 'ST01-012', 'ST01-013', 'ST01-014',
    'ST02-001', 'ST02-003', 'ST02-007', 'ST02-008', 'ST02-010', 'ST02-011', 'ST02-012',
    'ST03-001', 'ST03-002', 'ST03-003', 'ST03-006', 'ST03-008', 'ST03-010', 'ST03-011', 'ST03-012',
    'BP01-001', 'BP01-002', 'BP01-003', 'BP01-004', 'BP01-005', 'BP01-007',
    'BP01-010', 'BP01-011', 'BP01-012', 'BP01-013',
    'ST01-012', 'ST01-013', 'ST01-014', 'BP01-001', 'BP01-003', 'BP01-004',
    'BP01-005', 'BP01-007', 'BP01-010', 'BP01-012',
  ];
}

describe('CardEffectEngine 全卡牌效果识别与自动触发测试', () => {
  it('1. 基础信号球牌打出后直接进入信号球区 (ST01-012/013/014)', () => {
    const engine = new GameEngine(
      'game-orb-01',
      { playerId: 'p1', deckCardNumbers: createCustomDeck() },
      { playerId: 'p2', deckCardNumbers: createCustomDeck() },
      42
    );

    const activeId = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });
    expect(engine.getState().phase).toBe('MAIN_PHASE');

    // 寻找手牌中的信号球
    const hand = engine.zoneMgr.getCardsInZone(activeId, 'HAND');
    let orbCard = hand.find((c) => c.cardNumber === 'ST01-012' || c.cardNumber === 'ST01-013' || c.cardNumber === 'ST01-014');
    if (!orbCard) {
      const deckOrb = engine.zoneMgr.getCardsInZone(activeId, 'DECK').find((c) => c.cardNumber === 'ST01-012')!;
      engine.zoneMgr.moveCard(deckOrb.instanceId, 'HAND', { isFaceUp: true });
      orbCard = deckOrb;
    }

    const res = engine.applyAction({
      type: 'PLAY_CARD',
      playerId: activeId,
      cardInstanceId: orbCard.instanceId,
    });

    expect(res.success).toBe(true);
    // 信号球牌应直接进入 SIGNAL_ORB 区域，不应进入墓地或处理区
    const inOrbZone = engine.zoneMgr.getCardsInZone(activeId, 'SIGNAL_ORB');
    expect(inOrbZone.some((c) => c.instanceId === orbCard!.instanceId)).toBe(true);
  });

  it('2. 专武/招式战术牌从手牌打出进入信号球区最上方并抽1张牌，不触发【充能自】(仅充能步骤触发) (ST01-012)', () => {
    const engine = new GameEngine(
      'game-sig-01',
      { playerId: 'p1', deckCardNumbers: createCustomDeck() },
      { playerId: 'p2', deckCardNumbers: createCustomDeck() },
      42
    );

    const activeId = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });

    // 场上先放一个己方角色
    const roleCard = engine.zoneMgr.getCardsInZone(activeId, 'DECK').find((c) => c.cardNumber === 'BP01-001')!;
    engine.fieldMgr.playRoleCard(activeId, roleCard.instanceId, 0);

    // 将 ST01-012 移入手牌
    const sigCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST01-012'
    )!;
    engine.zoneMgr.moveCard(sigCard.instanceId, 'HAND', { isFaceUp: true });

    const handCountBefore = engine.zoneMgr.getCardsInZone(activeId, 'HAND').length;

    const res = engine.applyAction({
      type: 'PLAY_CARD',
      playerId: activeId,
      cardInstanceId: sigCard.instanceId,
    });

    expect(res.success).toBe(true);
    // 卡牌应放置在 SIGNAL_ORB 区域
    expect(engine.zoneMgr.getCardsInZone(activeId, 'SIGNAL_ORB').some((c) => c.instanceId === sigCard.instanceId)).toBe(true);
    // 应该抽1张牌 (打出1张，抽1张，手牌数持平)
    expect(engine.zoneMgr.getCardsInZone(activeId, 'HAND').length).toBe(handCountBefore);

    // 从手牌打出时不应触发【充能自】效果，无 pendingChoice
    expect(engine.getState().currentPendingChoice).toBeUndefined();

    // 验证在攻击充能中翻出 ST01-012 时，正常触发【充能自】
    // 将另一张 ST01-012 放到牌组顶
    const deckSigCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST01-012' && c.zone === 'DECK'
    );
    if (deckSigCard) {
      engine.zoneMgr.moveCardToTopOfDeck(deckSigCard.instanceId);
      // 触发攻击充能
      engine.zoneMgr.performAttackCharge(roleCard.instanceId, 1);
      // 翻出信号球应放置在 SIGNAL_ORB 并且触发充能自决策
      const choice = engine.getState().currentPendingChoice;
      expect(choice).toBeDefined();
      expect(choice?.effectType).toBe('SIGNATURE_MOVE_EFFECT');

      // 玩家选择 PP+2000
      const resolveRes = engine.applyAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: activeId,
        pendingChoiceId: choice!.id,
        selectedIds: ['opt_pp_plus_2000'],
      });
      expect(resolveRes.success).toBe(true);
      const roleChoice = engine.getState().currentPendingChoice;
      if (roleChoice) {
        engine.applyAction({
          type: 'SELECT_CHOICE_OPTION',
          playerId: activeId,
          pendingChoiceId: roleChoice.id,
          selectedIds: [roleCard.instanceId],
        });
      }
      expect(roleCard.tempPPBonus).toBe(2000);
    }
  });

  it('4. 破坏型战术自动弹出敌方目标选择并成功执行消灭 (ST03-011 三头犬出击)', () => {
    const engine = new GameEngine(
      'game-destroy-01',
      { playerId: 'p1', deckCardNumbers: createCustomDeck() },
      { playerId: 'p2', deckCardNumbers: createCustomDeck() },
      42
    );

    const activeId = engine.getState().activePlayerId;
    const oppId = engine.getState().nonActivePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });

    // 给对手放置一个角色
    const oppRole = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === oppId && c.cardNumber === 'BP01-001' && c.zone !== 'BATTLEFIELD'
    )!;
    engine.fieldMgr.playRoleCard(oppId, oppRole.instanceId, 0);

    // 确保费用区有 PHYSICAL 属性明费
    const costCards = engine.zoneMgr.getCardsInZone(activeId, 'COST');
    for (const c of costCards) {
      c.isFaceUp = true;
      c.isReady = true;
    }
    const physCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST01-001'
    )!;
    engine.zoneMgr.moveCard(physCard.instanceId, 'COST', { isFaceUp: true, isReady: true });

    // 给 activeId 手牌中放 ST03-011
    const killCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST03-011'
    )!;
    engine.zoneMgr.moveCard(killCard.instanceId, 'HAND', { isFaceUp: true });

    const activePlayer = engine.getState().players[activeId]!;
    fillCostZone(engine, activePlayer, 10);

    const res = engine.applyAction({
      type: 'PLAY_CARD',
      playerId: activeId,
      cardInstanceId: killCard.instanceId,
    });

    expect(res.success).toBe(true);
    const choice = engine.getState().currentPendingChoice;
    expect(choice).toBeDefined();
    expect(choice?.effectType).toBe('DESTROY_ROLE');

    // 提交破坏对手角色
    const resolveRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: activeId,
      pendingChoiceId: choice!.id,
      selectedIds: [oppRole.instanceId],
    });

    expect(resolveRes.success).toBe(true);
    expect(oppRole.zone).toBe('GRAVEYARD');
    expect(killCard.zone).toBe('GRAVEYARD');
  });

  it('6. 角色【出】墓地信号球回收自动触发 (ST01-003 丽芙·蚀暗)', () => {
    const engine = new GameEngine(
      'game-role-02',
      { playerId: 'p1', deckCardNumbers: createCustomDeck() },
      { playerId: 'p2', deckCardNumbers: createCustomDeck() },
      42
    );

    const activeId = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });

    // 在墓地放一张信号球
    const gyOrb = engine.zoneMgr.getCardsInZone(activeId, 'DECK').find((c) => c.cardNumber === 'ST01-012')!;
    engine.zoneMgr.moveCard(gyOrb.instanceId, 'GRAVEYARD', { isFaceUp: true });

    // 确保有 PHYSICAL 属性明费
    const costCards = engine.zoneMgr.getCardsInZone(activeId, 'COST');
    for (const c of costCards) {
      c.isFaceUp = true;
      c.isReady = true;
    }
    const physCost = engine.zoneMgr.getCardsInZone(activeId, 'DECK').find((c) => c.cardNumber === 'ST01-001')!;
    engine.zoneMgr.moveCard(physCost.instanceId, 'COST', { isFaceUp: true, isReady: true });

    // 出场 ST01-003
    const roleCard = engine.zoneMgr.getCardsInZone(activeId, 'DECK').find((c) => c.cardNumber === 'ST01-003')!;
    engine.zoneMgr.moveCard(roleCard.instanceId, 'HAND', { isFaceUp: true });

    const activePlayer = engine.getState().players[activeId]!;
    fillCostZone(engine, activePlayer, 5);

    const res = engine.applyAction({
      type: 'PLAY_CARD',
      playerId: activeId,
      cardInstanceId: roleCard.instanceId,
      targetSlotIndex: 0,
    });

    expect(res.success).toBe(true);
    // 墓地信号球应被自动回收至信号球区最上方
    expect(gyOrb.zone).toBe('SIGNAL_ORB');
  });

  it('7. 角色【起】动能力造成效果伤害并破坏角色 (BP01-004 里·异火)', () => {
    const engine = new GameEngine(
      'game-act-01',
      { playerId: 'p1', deckCardNumbers: createCustomDeck() },
      { playerId: 'p2', deckCardNumbers: createCustomDeck() },
      42
    );

    const activeId = engine.getState().activePlayerId;
    const oppId = engine.getState().nonActivePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });

    // activeId 场上有 c-lee-ignite-activate
    const p1Role = engine.zoneMgr.getCardsInZone(activeId, 'DECK')[0]!;
    p1Role.cardNumber = 'c-lee-ignite-activate';
    p1Role.cardId = 'c-lee-ignite-activate';
    engine.fieldMgr.playRoleCard(activeId, p1Role.instanceId, 0);

    // oppId 场上放一个 1000 PP 以下角色 (比如临时 PP 为 1000)
    const oppRole = engine.zoneMgr.getCardsInZone(oppId, 'DECK')[0]!;
    oppRole.cardNumber = 'ST01-005';
    oppRole.cardId = 'c-st01-005';
    engine.fieldMgr.playRoleCard(oppId, oppRole.instanceId, 0);
    oppRole.tempPPBonus = -3000; // 4000 - 3000 = 1000 PP

    const activePlayer = engine.getState().players[activeId]!;
    fillCostZone(engine, activePlayer, 5);

    // 发动起动能力
    const actRes = engine.applyAction({
      type: 'ACTIVATE_ABILITY',
      playerId: activeId,
      sourceCardId: p1Role.instanceId,
      abilityIndex: 0,
    });

    expect(actRes.success).toBe(true);
    const choice = engine.getState().currentPendingChoice;
    expect(choice).toBeDefined();
    expect(choice?.effectType).toBe('DEAL_DAMAGE_TO_ROLE');

    // 选中 oppRole 造成 1000 伤害
    const resolveRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: activeId,
      pendingChoiceId: choice!.id,
      selectedIds: [oppRole.instanceId],
    });

    expect(resolveRes.success).toBe(true);
    // 剩余 0 PP，触发规则破坏送入墓地
    expect(oppRole.zone).toBe('GRAVEYARD');
  });

  it('8. 战术牌【灰鸦小队，集合！】(ST01-010) 发动并公开顶5张牌选择灰鸦角色入手机制测试', () => {
    const engine = new GameEngine(
      'game-tactics-st01-010',
      { playerId: 'p1', deckCardNumbers: createCustomDeck() },
      { playerId: 'p2', deckCardNumbers: createCustomDeck() },
      42
    );

    const activeId = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });
    expect(engine.getState().phase).toBe('MAIN_PHASE');

    // 确保有可支付的物理明费
    const physCost = engine.zoneMgr.getCardsInZone(activeId, 'DECK').find((c) => c.cardNumber === 'ST01-001')!;
    engine.zoneMgr.moveCard(physCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    const pState = engine.getState().players[activeId]!;
    fillCostZone(engine, pState, 3);

    // 将 ST01-010 放入手牌
    const tacticsCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST01-010'
    )!;
    engine.zoneMgr.moveCard(tacticsCard.instanceId, 'HAND', { isFaceUp: true });

    // 检查牌库顶 5 张牌中是否有灰鸦小队角色，若无则人为放置一张 ST01-004 到牌库顶第 2 张
    const deckCards = engine.zoneMgr.getCardsInZone(activeId, 'DECK');
    const top5 = deckCards.slice(0, 5);
    const hasTargetInTop5 = top5.some((c) => {
      const def = engine.cardDb.getCard(c.cardNumber);
      return def?.cardType === CardType.ROLE && def?.traits?.includes('灰鸦小队');
    });

    const grayRavenRole = deckCards.find((c) => {
      const def = engine.cardDb.getCard(c.cardNumber);
      return def?.cardType === CardType.ROLE && def?.traits?.includes('灰鸦小队');
    })!;
    engine.zoneMgr.moveCardToTopOfDeck(grayRavenRole.instanceId);

    // 打出战术卡 ST01-010
    const playRes = engine.applyAction({
      type: 'PLAY_CARD',
      playerId: activeId,
      cardInstanceId: tacticsCard.instanceId,
    });

    expect(playRes.success).toBe(true);

    // 检查是否生成了对手确认公开卡牌弹窗
    const oppId = engine.getState().nonActivePlayerId;
    const oppChoice = engine.getState().currentPendingChoice;
    expect(oppChoice).toBeDefined();
    expect(oppChoice?.effectType).toBe('OPPONENT_CONFIRM_REVEAL');
    expect(oppChoice?.playerId).toBe(oppId);

    // 对手查阅公开卡牌并确认
    const oppConfirmRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: oppId,
      pendingChoiceId: oppChoice!.id,
      selectedIds: [],
    });
    expect(oppConfirmRes.success).toBe(true);

    // 对手确认后流转到发动方选择
    const choice = engine.getState().currentPendingChoice;
    expect(choice).toBeDefined();
    expect(choice?.effectType).toBe('SEARCH_TOP_CARDS');
    expect(choice?.choiceType).toBe('SELECT_CARDS');
    expect(choice?.prompt).toContain('灰鸦小队');
    expect(choice?.options.length).toBeGreaterThan(0);

    const eligibleOpt = choice!.options.find((o) => (o.payload as any)?.eligible);
    expect(eligibleOpt).toBeDefined();
    const chosenOptionId = eligibleOpt!.id;

    // 玩家在弹窗中选择该灰鸦小队角色
    const selectRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: activeId,
      pendingChoiceId: choice!.id,
      selectedIds: [chosenOptionId],
    });

    expect(selectRes.success).toBe(true);

    // 验证：
    // 1. 被选中的灰鸦角色进入手牌
    const chosenCard = engine.getState().cards[chosenOptionId]!;
    expect(chosenCard.zone).toBe('HAND');

    // 2. 战术卡【灰鸦小队，集合！】进入墓地
    expect(tacticsCard.zone).toBe('GRAVEYARD');

    // 3. 待办选择已清空
    expect(engine.getState().currentPendingChoice).toBeUndefined();

    // 4. 剩余顶牌被移至牌组最底端
    const finalDeck = engine.zoneMgr.getCardsInZone(activeId, 'DECK');
    const remainingInTop5 = choice!.metadata!.topCardIds.filter((id: string) => id !== chosenOptionId);
    for (const remId of remainingInTop5) {
      const idx = finalDeck.findIndex((c) => c.instanceId === remId);
      // 应处于后半段（即牌组底）
      expect(idx).toBeGreaterThanOrEqual(finalDeck.length - 5);
    }
  });

  it('9. 战术牌【灰鸦小队，集合！】(ST01-010) 牌组顶5张无灰鸦角色时，全部安全沉底且无报错挂死', () => {
    // 构造一个除了 ST01-010 和 物理明费外全为信号球的牌组（无任何灰鸦角色）
    const noGrayRavenDeck = [
      'ST01-010',
      'ST01-009', // 物理属性战术卡，作为明费
      ...Array(48).fill('ST01-012'),
    ];

    const engine = new GameEngine(
      'game-tactics-st01-010-nomatch',
      { playerId: 'p1', deckCardNumbers: noGrayRavenDeck },
      { playerId: 'p2', deckCardNumbers: noGrayRavenDeck },
      42
    );

    const activeId = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });

    // 确保有可支付的物理明费
    const physCost = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST01-009'
    )!;
    engine.zoneMgr.moveCard(physCost.instanceId, 'COST', { isFaceUp: true, isReady: true });
    const pState = engine.getState().players[activeId]!;
    fillCostZone(engine, pState, 3);

    // 将 ST01-010 移入手牌
    const tacticsCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST01-010'
    )!;
    engine.zoneMgr.moveCard(tacticsCard.instanceId, 'HAND', { isFaceUp: true });

    // 打出 ST01-010
    const playRes = engine.applyAction({
      type: 'PLAY_CARD',
      playerId: activeId,
      cardInstanceId: tacticsCard.instanceId,
    });

    expect(playRes.success).toBe(true);

    const oppId = engine.getState().nonActivePlayerId;
    // 即使无匹配目标，也先由对手查阅公开卡牌并确认
    const oppChoice = engine.getState().currentPendingChoice;
    expect(oppChoice).toBeDefined();
    expect(oppChoice?.effectType).toBe('OPPONENT_CONFIRM_REVEAL');
    expect(oppChoice?.playerId).toBe(oppId);

    const oppConfirmRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: oppId,
      pendingChoiceId: oppChoice!.id,
      selectedIds: [],
    });
    expect(oppConfirmRes.success).toBe(true);

    // 对手确认后展示5张公开卡牌供发动方查验
    const choice = engine.getState().currentPendingChoice;
    expect(choice).toBeDefined();
    expect(choice?.effectType).toBe('SEARCH_TOP_CARDS');
    expect(choice?.options.length).toBe(5);
    expect(choice?.minSelections).toBe(0);
    expect(choice?.maxSelections).toBe(0);

    // 所有5张牌均应标记为不符合条件
    for (const opt of choice!.options) {
      expect((opt.payload as any)?.eligible).toBe(false);
    }

    // 玩家点击确认，5张卡牌全部移至牌组底，战术牌进入墓地
    const resolveRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: activeId,
      pendingChoiceId: choice!.id,
      selectedIds: [],
    });

    expect(resolveRes.success).toBe(true);
    expect(tacticsCard.zone).toBe('GRAVEYARD');
    expect(engine.getState().currentPendingChoice).toBeUndefined();

    // 检查广播事件
    const hasEvent = engine.getEvents().some(
      (e) => e.type === 'ABILITY_ACTIVATED' && e.abilityName?.includes('灰鸦小队，集合！')
    );
    expect(hasEvent).toBe(true);
  });

  it('10. 角色【起】动能力发动与【回合1】限制拦截 (ST02-008 苦刑之女)', () => {
    const engine = new GameEngine(
      'game-act-st02-008',
      { playerId: 'p1', deckCardNumbers: createCustomDeck() },
      { playerId: 'p2', deckCardNumbers: createCustomDeck() },
      42
    );

    const activeId = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });

    // 放置 ST02-008 到战场
    const roleCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST02-008'
    )!;
    engine.fieldMgr.playRoleCard(activeId, roleCard.instanceId, 0);

    const pState = engine.getState().players[activeId]!;
    fillCostZone(engine, pState, 5);
    const initialErosion = pState.erosionCount;

    // 第一次发动【起】
    const actRes1 = engine.applyAction({
      type: 'ACTIVATE_ABILITY',
      playerId: activeId,
      sourceCardId: roleCard.instanceId,
      abilityIndex: 0,
    });

    expect(actRes1.success).toBe(true);
    // 侵蚀计数+1
    expect(pState.erosionCount).toBe(initialErosion + 1);
    // DP 临时+1
    expect(roleCard.tempDPBonus).toBe(1);

    // 第二次尝试在同回合发动，应被【回合1】拦截
    const actRes2 = engine.applyAction({
      type: 'ACTIVATE_ABILITY',
      playerId: activeId,
      sourceCardId: roleCard.instanceId,
      abilityIndex: 0,
    });

    expect(actRes2.success).toBe(false);
    expect(actRes2.error).toContain('【回合1】限制');
  });

  it('11. 角色【起】动能力从墓地苏生角色 (ST02-001 露娜·银冕)', () => {
    const engine = new GameEngine(
      'game-act-st02-001',
      { playerId: 'p1', deckCardNumbers: createCustomDeck() },
      { playerId: 'p2', deckCardNumbers: createCustomDeck() },
      42
    );

    const activeId = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });

    // 放置 ST02-001 到战场
    const luna = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST02-001'
    )!;
    engine.fieldMgr.playRoleCard(activeId, luna.instanceId, 0);

    // 墓地放一张 <=4 费角色 (ST02-007 不明构造体α，4费)
    const gyRole = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST02-007'
    )!;
    engine.zoneMgr.moveCard(gyRole.instanceId, 'GRAVEYARD', { isFaceUp: true });

    const pState = engine.getState().players[activeId]!;
    fillCostZone(engine, pState, 5);

    // 发动【起】能力
    const actRes = engine.applyAction({
      type: 'ACTIVATE_ABILITY',
      playerId: activeId,
      sourceCardId: luna.instanceId,
      abilityIndex: 0,
    });

    expect(actRes.success).toBe(true);
    const choice = engine.getState().currentPendingChoice;
    expect(choice).toBeDefined();
    expect(choice?.effectType).toBe('RESURRECT_ROLE');

    // 玩家选择苏生 gyRole
    const resolveRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: activeId,
      pendingChoiceId: choice!.id,
      selectedIds: [gyRole.instanceId],
    });

    expect(resolveRes.success).toBe(true);
    // gyRole 成功出场进入战场
    expect(gyRole.zone).toBe('BATTLEFIELD');
  });

  it('12. 角色【起】动能力需横置自身作为代价 (ST03-002 薇拉·瑰丽)', () => {
    const engine = new GameEngine(
      'game-act-st03-002',
      { playerId: 'p1', deckCardNumbers: createCustomDeck() },
      { playerId: 'p2', deckCardNumbers: createCustomDeck() },
      42
    );

    const activeId = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });

    // 放置 ST03-002 到战场
    const vera = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST03-002'
    )!;
    engine.fieldMgr.playRoleCard(activeId, vera.instanceId, 0);
    expect(vera.isReady).toBe(true);

    // 发动【起】能力
    const actRes1 = engine.applyAction({
      type: 'ACTIVATE_ABILITY',
      playerId: activeId,
      sourceCardId: vera.instanceId,
      abilityIndex: 0,
    });

    expect(actRes1.success).toBe(true);
    // 角色因横置代价变为横置状态
    expect(vera.isReady).toBe(false);

    // 再次尝试发动，因已处于横置状态被拦截
    const actRes2 = engine.applyAction({
      type: 'ACTIVATE_ABILITY',
      playerId: activeId,
      sourceCardId: vera.instanceId,
      abilityIndex: 0,
    });

    expect(actRes2.success).toBe(false);
    expect(actRes2.error).toContain('已横置');
  });

  it('13. 角色【起】动能力回手己方角色并连携出场 (ST01-001 露西亚·红莲)', () => {
    const engine = new GameEngine(
      'game-act-st01-001',
      { playerId: 'p1', deckCardNumbers: createCustomDeck() },
      { playerId: 'p2', deckCardNumbers: createCustomDeck() },
      42
    );

    const activeId = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });

    // 战场放置 ST01-001 和另一张己方角色 (ST01-004)
    const lucia = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST01-001'
    )!;
    const allyRole = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST01-004'
    )!;
    engine.fieldMgr.playRoleCard(activeId, lucia.instanceId, 0);
    engine.fieldMgr.playRoleCard(activeId, allyRole.instanceId, 1);

    // 手牌中放置一张 <=4 费灰鸦角色 (ST01-005)
    const recruitRole = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST01-005'
    )!;
    engine.zoneMgr.moveCard(recruitRole.instanceId, 'HAND', { isFaceUp: true });

    const pState = engine.getState().players[activeId]!;
    fillCostZone(engine, pState, 5);

    // 满足 ST01-001 起动代价：在信号球区准备 2 个蓝色信号球
    const blueOrbs = Object.values(engine.getState().cards).filter(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST01-013'
    );
    expect(blueOrbs.length).toBeGreaterThanOrEqual(2);
    engine.zoneMgr.moveCard(blueOrbs[0]!.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
    engine.zoneMgr.moveCard(blueOrbs[1]!.instanceId, 'SIGNAL_ORB', { isFaceUp: true });

    // 发动 ST01-001 【起】能力
    const actRes = engine.applyAction({
      type: 'ACTIVATE_ABILITY',
      playerId: activeId,
      sourceCardId: lucia.instanceId,
      abilityIndex: 0,
    });

    expect(actRes.success).toBe(true);

    // 步骤一：消除2个蓝色信号球
    const orbChoice = engine.getState().currentPendingChoice;
    expect(orbChoice).toBeDefined();
    expect(orbChoice?.effectType).toBe('ST01_001_ACTIVATE_ELIMINATE_ORBS');

    const orbRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: activeId,
      pendingChoiceId: orbChoice!.id,
      selectedIds: [blueOrbs[0]!.instanceId, blueOrbs[1]!.instanceId],
    });
    expect(orbRes.success).toBe(true);
    expect(blueOrbs[0]!.zone).toBe('GRAVEYARD');
    expect(blueOrbs[1]!.zone).toBe('GRAVEYARD');

    // 步骤二：选择 allyRole 回手
    const choice1 = engine.getState().currentPendingChoice;
    expect(choice1).toBeDefined();
    expect(choice1?.effectType).toBe('BOUNCE_FRIENDLY_ROLE');

    const resolveRes1 = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: activeId,
      pendingChoiceId: choice1!.id,
      selectedIds: [allyRole.instanceId],
    });

    expect(resolveRes1.success).toBe(true);
    expect(allyRole.zone).toBe('HAND');

    // 步骤二：触发连携出场弹窗
    const choice2 = engine.getState().currentPendingChoice;
    expect(choice2).toBeDefined();
    expect(choice2?.effectType).toBe('RESURRECT_ROLE');

    // 选择 recruitRole 出场
    const resolveRes2 = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: activeId,
      pendingChoiceId: choice2!.id,
      selectedIds: [recruitRole.instanceId],
    });

    expect(resolveRes2.success).toBe(true);
    expect(recruitRole.zone).toBe('BATTLEFIELD');
  });

  it('19. 战术牌【灰鸦小队，集合！】(ST01-010) 公开5张牌，高亮展示并支持选择符合条件的灰鸦角色加入手牌', () => {
    const engine = new GameEngine(
      'game-st01-010-01',
      { playerId: 'p1', deckCardNumbers: createCustomDeck() },
      { playerId: 'p2', deckCardNumbers: createCustomDeck() },
      42
    );

    const activeId = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });

    // 确保费用区有 PHYSICAL 属性明费
    const costCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST01-002'
    )!;
    engine.zoneMgr.moveCard(costCard.instanceId, 'COST', { isFaceUp: true, isReady: true });

    const pState = engine.getState().players[activeId]!;
    fillCostZone(engine, pState, 5);

    // 手牌中放入 ST01-010
    const tacticsCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST01-010'
    )!;
    engine.zoneMgr.moveCard(tacticsCard.instanceId, 'HAND', { isFaceUp: true });

    // 构造牌组顶5张牌：前2张为灰鸦角色，后3张为非灰鸦卡牌
    const deckCards = engine.zoneMgr.getCardsInZone(activeId, 'DECK');
    const matchRole = deckCards.find((c) => {
      const def = engine.cardDb.getCard(c.cardNumber);
      return def?.cardType === CardType.ROLE && def?.traits?.includes('灰鸦小队');
    })!;
    engine.zoneMgr.moveCardToTopOfDeck(matchRole.instanceId);
    expect(matchRole).toBeDefined();

    const top5 = engine.zoneMgr.getCardsInZone(activeId, 'DECK').slice(0, 5);

    const handCountBefore = engine.zoneMgr.getCardsInZone(activeId, 'HAND').length;

    // 打出 ST01-010
    const playRes = engine.applyAction({
      type: 'PLAY_CARD',
      playerId: activeId,
      cardInstanceId: tacticsCard.instanceId,
    });

    expect(playRes.success).toBe(true);

    const oppId = engine.getState().nonActivePlayerId;
    // 验证当前弹出了对手检视确认弹窗
    const oppChoice = engine.getState().currentPendingChoice;
    expect(oppChoice).toBeDefined();
    expect(oppChoice?.effectType).toBe('OPPONENT_CONFIRM_REVEAL');
    expect(oppChoice?.playerId).toBe(oppId);

    // 对手点击确认
    const oppConfirmRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: oppId,
      pendingChoiceId: oppChoice!.id,
      selectedIds: [],
    });
    expect(oppConfirmRes.success).toBe(true);

    // 验证流转到发动方的 PendingChoice 决策
    const choice = engine.getState().currentPendingChoice;
    expect(choice).toBeDefined();
    expect(choice?.effectType).toBe('SEARCH_TOP_CARDS');
    // 验证选项包含了全部 5 张牌
    expect(choice?.options.length).toBe(5);

    // 验证符合条件的选项带有 eligible: true，不符合条件的带有 eligible: false
    const matchOption = choice?.options.find((o) => o.id === matchRole.instanceId);
    expect(matchOption).toBeDefined();
    expect((matchOption?.payload as any)?.eligible).toBe(true);

    // 选中的灰鸦角色加入手牌
    const resolveRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: activeId,
      pendingChoiceId: choice!.id,
      selectedIds: [matchRole.instanceId],
    });

    expect(resolveRes.success).toBe(true);
    // 目标角色已成功移入手牌
    expect(matchRole.zone).toBe('HAND');
    // 手牌总数：打出1张(-1) + 检索加入1张(+1) = 持平
    expect(engine.zoneMgr.getCardsInZone(activeId, 'HAND').length).toBe(handCountBefore);

    // ST01-010 战术牌移入墓地
    expect(tacticsCard.zone).toBe('GRAVEYARD');

    // 其余 4 张牌移入牌组底
    const remainingTop4 = top5.filter((c) => c.instanceId !== matchRole.instanceId);
    for (const rem of remainingTop4) {
      expect(rem.zone).toBe('DECK');
    }
  });

  it('20. 战术牌【灰鸦小队，集合！】(ST01-010) 若玩家试图选取不符合条件的非灰鸦角色卡，则拒绝执行并报错', () => {
    const engine = new GameEngine(
      'game-st01-010-03',
      { playerId: 'p1', deckCardNumbers: createCustomDeck() },
      { playerId: 'p2', deckCardNumbers: createCustomDeck() },
      42
    );

    const activeId = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });

    // 确保费用区有 PHYSICAL 属性明费
    const costCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST01-002'
    )!;
    engine.zoneMgr.moveCard(costCard.instanceId, 'COST', { isFaceUp: true, isReady: true });

    const pState = engine.getState().players[activeId]!;
    fillCostZone(engine, pState, 5);

    // 手牌中放入 ST01-010
    const tacticsCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST01-010'
    )!;
    engine.zoneMgr.moveCard(tacticsCard.instanceId, 'HAND', { isFaceUp: true });

    // 确保牌组顶包含信号球 (非灰鸦角色)
    const deckCards = engine.zoneMgr.getCardsInZone(activeId, 'DECK');
    const orbCard = deckCards.find((c) => c.cardNumber === 'ST01-012' || c.cardNumber === 'ST01-013' || c.cardNumber === 'ST01-014')!;
    engine.zoneMgr.moveCardToTopOfDeck(orbCard.instanceId);

    const playRes = engine.applyAction({
      type: 'PLAY_CARD',
      playerId: activeId,
      cardInstanceId: tacticsCard.instanceId,
    });
    expect(playRes.success).toBe(true);

    const oppId = engine.getState().nonActivePlayerId;
    // 对手先查验公开卡牌
    const oppChoice = engine.getState().currentPendingChoice;
    expect(oppChoice).toBeDefined();
    expect(oppChoice?.effectType).toBe('OPPONENT_CONFIRM_REVEAL');
    expect(oppChoice?.playerId).toBe(oppId);

    const oppConfirmRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: oppId,
      pendingChoiceId: oppChoice!.id,
      selectedIds: [],
    });
    expect(oppConfirmRes.success).toBe(true);

    const choice = engine.getState().currentPendingChoice;
    expect(choice).toBeDefined();

    // 找到一个不符合条件的选项（如信号球或战术牌）
    const ineligibleOpt = choice?.options.find((o) => (o.payload as any)?.eligible === false);
    expect(ineligibleOpt).toBeDefined();

    // 试图强行选择不符合条件的卡牌
    const invalidRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: activeId,
      pendingChoiceId: choice!.id,
      selectedIds: [ineligibleOpt!.id],
    });

    // 应当被拦截拒绝，不能加入手牌
    expect(invalidRes.success).toBe(false);
    expect(invalidRes.error).toContain('不符合');
  });

  it('21. ST01-002【里·异火】登场【出】效果堆墓3张牌，检测到信号球时打开战场角色卡面窗口选择灰鸦赋能充能+1', () => {
    const engine = new GameEngine(
      'game-st01-002-01',
      { playerId: 'p1', deckCardNumbers: createCustomDeck() },
      { playerId: 'p2', deckCardNumbers: createCustomDeck() },
      42
    );

    const activeId = engine.getState().activePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });

    // 确保有足够的 PHYSICAL 明费
    const costCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST01-001'
    )!;
    engine.zoneMgr.moveCard(costCard.instanceId, 'COST', { isFaceUp: true, isReady: true });
    const pState = engine.getState().players[activeId]!;
    fillCostZone(engine, pState, 10);

    // 场上先放置一张露西亚 (灰鸦小队角色)
    const luciaCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST01-004'
    )!;
    engine.fieldMgr.playRoleCard(activeId, luciaCard.instanceId, 0);

    // 调整牌组顶3张牌中至少包含1张信号球
    const deck = engine.zoneMgr.getCardsInZone(activeId, 'DECK');
    const orbCard2 = deck.find((c) => c.cardNumber === 'ST01-012' || c.cardNumber === 'ST01-013' || c.cardNumber === 'ST01-014')!;
    engine.zoneMgr.moveCardToTopOfDeck(orbCard2.instanceId);

    // 手牌中放入 ST01-002 (里·异火)
    const leeCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST01-002'
    )!;
    engine.zoneMgr.moveCard(leeCard.instanceId, 'HAND', { isFaceUp: true });

    // 打出 ST01-002 到战场卡位 1
    const playRes = engine.applyAction({
      type: 'PLAY_CARD',
      playerId: activeId,
      cardInstanceId: leeCard.instanceId,
      targetSlotIndex: 1,
    });

    expect(playRes.success).toBe(true);

    const oppId = engine.getState().nonActivePlayerId;

    // 步骤 1：首先由对手确认公开卡牌展示 (OPPONENT_CONFIRM_REVEAL)
    const oppChoice = engine.getState().currentPendingChoice;
    expect(oppChoice).toBeDefined();
    expect(oppChoice?.playerId).toBe(oppId);
    expect(oppChoice?.effectType).toBe('OPPONENT_CONFIRM_REVEAL');
    expect(oppChoice?.options.length).toBe(3);

    const oppConfirmRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: oppId,
      pendingChoiceId: oppChoice!.id,
      selectedIds: [],
    });
    expect(oppConfirmRes.success).toBe(true);

    // 步骤 2：转回发动方进行卡牌检视确认 (ST01_002_INSPECT_ORB)
    const inspectChoice = engine.getState().currentPendingChoice;
    expect(inspectChoice).toBeDefined();
    expect(inspectChoice?.playerId).toBe(activeId);
    expect(inspectChoice?.effectType).toBe('ST01_002_INSPECT_ORB');
    expect(inspectChoice?.metadata?.hasOrb).toBe(true);

    const inspectConfirmRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: activeId,
      pendingChoiceId: inspectChoice!.id,
      selectedIds: [],
    });
    expect(inspectConfirmRes.success).toBe(true);

    // 步骤 3：由于检测到信号球，发动方进入选择战场灰鸦角色赋能阶段 (BUFF_ROLE_CHARGE)
    const buffChoice = engine.getState().currentPendingChoice;
    expect(buffChoice).toBeDefined();
    expect(buffChoice?.effectType).toBe('BUFF_ROLE_CHARGE');
    expect(buffChoice?.choiceType).toBe('SELECT_CARDS');

    // 验证选项带有丰富的战场角色卡面属性
    for (const opt of buffChoice!.options) {
      const payload = opt.payload as any;
      expect(payload).toBeDefined();
      expect(payload.cardNumber).toBeDefined();
      expect(payload.name).toBeDefined();
      expect(payload.basePP).toBeDefined();
      expect(payload.slotIndex).toBeDefined();
    }

    // 选择露西亚获得充能+1
    const luciaBeforePP = luciaCard.tempPPBonus || 0;
    const resolveRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: activeId,
      pendingChoiceId: buffChoice!.id,
      selectedIds: [luciaCard.instanceId],
    });

    expect(resolveRes.success).toBe(true);
    expect(luciaCard.tempPPBonus || 0).toBe(luciaBeforePP + 1000);
    expect(engine.getState().currentPendingChoice).toBeUndefined();

    // 验证翻开的3张卡牌全部已送入墓地
    const gyCards = engine.zoneMgr.getCardsInZone(activeId, 'GRAVEYARD');
    expect(gyCards.some((c) => c.instanceId === orbCard2.instanceId)).toBe(true);
  });

  it('21b. ST01-002【里·异火】翻开牌组顶3张未检出信号球时，双方展示检视后所有卡牌全部送入墓地且不触发赋能', () => {
    const engine = new GameEngine(
      'game-st01-002-no-orb',
      { playerId: 'p1', deckCardNumbers: createCustomDeck() },
      { playerId: 'p2', deckCardNumbers: createCustomDeck() },
      42
    );

    const activeId = engine.getState().activePlayerId;
    const oppId = engine.getState().nonActivePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });

    // 增加费用以打出 ST01-002
    const costCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST01-001'
    )!;
    engine.zoneMgr.moveCard(costCard.instanceId, 'COST', { isFaceUp: true, isReady: true });
    const pState = engine.getState().players[activeId]!;
    fillCostZone(engine, pState, 10);

    // 调整牌组顶3张牌为非信号球的角色牌
    const deck = engine.zoneMgr.getCardsInZone(activeId, 'DECK');
    const nonOrbs = deck.filter((c) => c.cardNumber.startsWith('ST01-00') || c.cardNumber.startsWith('BP01-00'));
    for (let i = 0; i < 3; i++) {
      if (nonOrbs[i]) {
        engine.zoneMgr.moveCardToTopOfDeck(nonOrbs[i].instanceId);
      }
    }

    // 手牌中放入 ST01-002
    const leeCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST01-002'
    )!;
    engine.zoneMgr.moveCard(leeCard.instanceId, 'HAND', { isFaceUp: true });

    // 打出 ST01-002
    const playRes = engine.applyAction({
      type: 'PLAY_CARD',
      playerId: activeId,
      cardInstanceId: leeCard.instanceId,
      targetSlotIndex: 0,
    });
    expect(playRes.success).toBe(true);

    // 对手确认公开展示
    const oppChoice = engine.getState().currentPendingChoice;
    expect(oppChoice?.effectType).toBe('OPPONENT_CONFIRM_REVEAL');
    engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: oppId,
      pendingChoiceId: oppChoice!.id,
      selectedIds: [],
    });

    // 发动方检视确认（无信号球）
    const inspectChoice = engine.getState().currentPendingChoice;
    expect(inspectChoice?.effectType).toBe('ST01_002_INSPECT_ORB');
    expect(inspectChoice?.metadata?.hasOrb).toBe(false);

    const inspectRes = engine.applyAction({
      type: 'SELECT_CHOICE_OPTION',
      playerId: activeId,
      pendingChoiceId: inspectChoice!.id,
      selectedIds: [],
    });
    expect(inspectRes.success).toBe(true);

    // 未检出信号球，流程直接结束，翻开卡牌入墓，不弹出 BUFF 决策
    expect(engine.getState().currentPendingChoice).toBeUndefined();
  });

  it('22. ST02-008【苦刑之女】的【起】【回合1】能力在回合切换后正确重置并在下回合可再次发动', () => {
    const engine = new GameEngine(
      'game-st02-008-reset',
      { playerId: 'p1', deckCardNumbers: createCustomDeck() },
      { playerId: 'p2', deckCardNumbers: createCustomDeck() },
      42
    );

    const activeId = engine.getState().activePlayerId;
    const oppId = engine.getState().nonActivePlayerId;
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });

    // 战场上放置苦刑之女
    const roleCard = Object.values(engine.getState().cards).find(
      (c) => c.controllerPlayerId === activeId && c.cardNumber === 'ST02-008'
    )!;
    engine.fieldMgr.playRoleCard(activeId, roleCard.instanceId, 0);

    const pState = engine.getState().players[activeId]!;
    fillCostZone(engine, pState, 10);

    // 回合 1 第一次发动
    const act1 = engine.applyAction({
      type: 'ACTIVATE_ABILITY',
      playerId: activeId,
      sourceCardId: roleCard.instanceId,
      abilityIndex: 0,
    });
    expect(act1.success).toBe(true);
    expect(roleCard.tempDPBonus).toBe(1);

    // 同一回合尝试第二次发动 -> 应被【回合1】拦截阻止
    const act2 = engine.applyAction({
      type: 'ACTIVATE_ABILITY',
      playerId: activeId,
      sourceCardId: roleCard.instanceId,
      abilityIndex: 0,
    });
    expect(act2.success).toBe(false);
    expect(act2.error).toContain('【回合1】限制');

    // 结束当前玩家回合 -> 进入对手回合
    endTurn(engine);
    // 对手抽牌充能后进入主要阶段，再结束对手回合
    engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: oppId });
    endTurn(engine);

    // 此时回到 activeId 的新一回合主要阶段
    if (engine.getState().phase === 'DRAW_CHARGE_PHASE') {
      engine.applyAction({ type: 'PASS_ACTION_TIMING', playerId: activeId });
    }
    expect(engine.getState().activePlayerId).toBe(activeId);
    expect(engine.getState().phase).toBe('MAIN_PHASE');

    // 补充费用
    fillCostZone(engine, pState, 10);

    // 新回合再次发动【起】能力 -> 应该顺利发动成功！
    const act3 = engine.applyAction({
      type: 'ACTIVATE_ABILITY',
      playerId: activeId,
      sourceCardId: roleCard.instanceId,
      abilityIndex: 0,
    });
    expect(act3.success).toBe(true);
  });

  it('23. 开局牌组进行充分随机洗切，卡牌顺序不再是初始录入顺序', () => {
    const rawDeck = createCustomDeck();
    const engine = new GameEngine(
      'game-shuffle-verify',
      { playerId: 'p1', deckCardNumbers: rawDeck },
      { playerId: 'p2', deckCardNumbers: rawDeck },
      12345
    );

    const p1Deck = engine.zoneMgr.getCardsInZone('p1', 'DECK');
    const p1CardNumbers = p1Deck.map((c) => c.cardNumber);

    // 验证剩余牌库不等于原始输入的切片顺序
    const originalSub = rawDeck.slice(6); // 扣掉初始4手牌与2明费
    const isExactMatch = originalSub.every((num, i) => p1CardNumbers[i] === num);
    expect(isExactMatch).toBe(false);

    // 验证生成了洗牌事件
    const hasShuffleEvent = engine.getEvents().some(
      (e) => e.type === 'DECK_REFRESHED' && e.playerId === 'p1'
    );
    expect(hasShuffleEvent).toBe(true);
  });
});

