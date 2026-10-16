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

