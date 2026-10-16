import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/engine.js';
import { MemoryCardDatabase, OFFICIAL_CARDS_DATA } from '../src/database/card-registry.js';
import type { CardInstance } from '@zhanshuang/shared';

/**
 * 对局完整性与防作弊回归测试：
 * 决策提交校验、待决策期间的行动限制、行动失败回滚、装备/三消/起动能力/攻击的合法性校验、
 * 卡牌实例 ID 不泄露卡组顺序。
 */

const cardDb = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);

function st03Deck(): string[] {
  return [
    'ST03-012', 'ST03-012', 'ST03-012', 'ST03-012',
    'ST03-013', 'ST03-013', 'ST03-013', 'ST03-013',
    'ST03-014', 'ST03-014', 'ST03-014', 'ST03-014',
    'ST03-001', 'ST03-002', 'ST03-002', 'ST03-002', 'ST03-002',
    'ST03-003', 'ST03-003', 'ST03-003', 'ST03-003',
    'ST03-004', 'ST03-004', 'ST03-005', 'ST03-005', 'ST03-005', 'ST03-005',
    'ST03-006', 'ST03-006', 'ST03-006', 'ST03-006', 'ST03-007', 'ST03-007',
    'ST03-008', 'ST03-008', 'ST03-008', 'ST03-008',
    'ST03-009', 'ST03-009', 'ST03-009', 'ST03-009',
    'ST03-010', 'ST03-010', 'ST03-011', 'ST03-011', 'ST03-011', 'ST03-011',
    'ST02-009', 'ST02-009', 'BP01-024',
  ];
}

function newEngine(seed = 7): GameEngine {
  const engine = new GameEngine(
    `game-integrity-${seed}`,
    { playerId: 'p1', deckCardNumbers: st03Deck() },
    { playerId: 'p2', deckCardNumbers: st03Deck() },
    seed,
    cardDb
  );
  // 进入回合玩家的主要阶段
  engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: engine.getState().activePlayerId });
  expect(engine.getState().phase).toBe('MAIN_PHASE');
  return engine;
}

function findCard(engine: GameEngine, playerId: string, cardNumber: string): CardInstance {
  const card = Object.values(engine.getState().cards).find(
    (c) => c.controllerPlayerId === playerId && c.cardNumber === cardNumber && c.zone !== 'BATTLEFIELD'
  );
  if (!card) throw new Error(`找不到 ${playerId} 的 ${cardNumber}`);
  return card;
}

/** 给玩家准备足够的同属性明费 */
function giveOpenCosts(engine: GameEngine, playerId: string, cardNumber: string, count: number): void {
  const candidates = Object.values(engine.getState().cards).filter(
    (c) => c.controllerPlayerId === playerId && c.cardNumber === cardNumber && c.zone === 'DECK'
  );
  for (const c of candidates.slice(0, count)) {
    engine.zoneMgr.moveCard(c.instanceId, 'COST', { isFaceUp: true, isReady: true });
  }
  const player = engine.getState().players[playerId]!;
  const openCosts = engine.zoneMgr.getCardsInZone(playerId, 'COST').filter((c) => c.isFaceUp);
  player.openCostCount = openCosts.length;
  player.availableOpenCostCount = openCosts.filter((c) => c.isReady).length;
  player.totalCostCount = engine.zoneMgr.getCardsInZone(playerId, 'COST').length;
}

describe('对局完整性与防作弊', () => {
  it('决策只能提交给出的、可选的选项，数量也必须符合要求', () => {
    const engine = newEngine();
    const state = engine.getState();
    const p1 = state.activePlayerId;
    const p2 = state.nonActivePlayerId;

    // 对手战场放置两张角色
    const oppRoleA = findCard(engine, p2, 'ST03-002');
    const oppRoleB = findCard(engine, p2, 'ST03-005');
    engine.fieldMgr.playRoleCard(p2, oppRoleA.instanceId, 0);
    engine.fieldMgr.playRoleCard(p2, oppRoleB.instanceId, 1);

    state.pendingTriggers = [];
    state.currentPendingChoice = {
      id: 'choice-destroy',
      playerId: p1,
      choiceType: 'SELECT_CARDS',
      prompt: '选择对方战场1张PP为3000及以下的角色破坏',
      options: [
        engine.effectEngine.createRoleChoiceOption(oppRoleA, { eligible: false }),
        engine.effectEngine.createRoleChoiceOption(oppRoleB),
      ],
      effectType: 'DESTROY_ROLE',
      minSelections: 1,
      maxSelections: 1,
    };

    const submit = (selectedIds: string[]) =>
      engine.dispatchAction({ type: 'SELECT_CHOICE_OPTION', playerId: p1, pendingChoiceId: 'choice-destroy', selectedIds });

    // 不在选项中的卡牌 (己方手牌)
    const myHandCard = engine.zoneMgr.getCardsInZone(p1, 'HAND')[0]!;
    expect(submit([myHandCard.instanceId]).success).toBe(false);
    // 不满足条件的选项
    expect(submit([oppRoleA.instanceId]).error).toContain('不符合');
    // 超过最大数量、重复选择、少于最少数量
    expect(submit([oppRoleB.instanceId, oppRoleA.instanceId]).success).toBe(false);
    expect(submit([oppRoleB.instanceId, oppRoleB.instanceId]).success).toBe(false);
    expect(submit([]).success).toBe(false);
    // 对手不能替我方提交
    expect(
      engine.dispatchAction({
        type: 'SELECT_CHOICE_OPTION',
        playerId: p2,
        pendingChoiceId: 'choice-destroy',
        selectedIds: [oppRoleB.instanceId],
      }).success
    ).toBe(false);

    // 以上非法提交都没有破坏任何角色
    expect(state.cards[oppRoleA.instanceId]!.zone).toBe('BATTLEFIELD');
    expect(state.cards[oppRoleB.instanceId]!.zone).toBe('BATTLEFIELD');

    // 合法提交
    expect(submit([oppRoleB.instanceId]).success).toBe(true);
    expect(state.cards[oppRoleB.instanceId]!.zone).toBe('GRAVEYARD');
    expect(state.cards[oppRoleA.instanceId]!.zone).toBe('BATTLEFIELD');
  });

  it('存在待处理的决策时，只能提交该决策或弃权', () => {
    const engine = newEngine();
    const state = engine.getState();
    const p1 = state.activePlayerId;

    state.currentPendingChoice = {
      id: 'choice-pending',
      playerId: p1,
      choiceType: 'SELECT_OPTION',
      prompt: '测试决策',
      options: [{ id: 'a', label: 'A' }],
      effectType: 'TEST_ONLY',
      minSelections: 1,
      maxSelections: 1,
    };

    const res = engine.dispatchAction({ type: 'PASS_ACTION_TIMING', playerId: p1 });
    expect(res.success).toBe(false);
    expect(res.error).toContain('完成当前的效果选择');
    expect(state.phase).toBe('MAIN_PHASE');
    expect(state.currentPendingChoice?.id).toBe('choice-pending');

    expect(engine.dispatchAction({ type: 'SURRENDER', playerId: p1 }).success).toBe(true);
  });

  it('行动失败时回滚：卡位已满时出角色不会扣除费用、卡牌留在手牌', () => {
    const engine = newEngine();
    const state = engine.getState();
    const p1 = state.activePlayerId;

    // 占满己方 5 个卡位
    for (let i = 0; i < 5; i++) {
      const filler = Object.values(state.cards).find(
        (c) => c.controllerPlayerId === p1 && c.zone === 'DECK' && c.cardNumber === 'ST03-005'
      ) ?? Object.values(state.cards).find(
        (c) => c.controllerPlayerId === p1 && c.zone === 'DECK' && c.cardNumber === 'ST03-006'
      )!;
      engine.fieldMgr.playRoleCard(p1, filler.instanceId, i);
    }
    giveOpenCosts(engine, p1, 'ST03-002', 2);

    const roleInHand = findCard(engine, p1, 'ST03-004');
    engine.zoneMgr.moveCard(roleInHand.instanceId, 'HAND', { isFaceUp: true });
    const eventCountBefore = engine.getEvents().length;
    const readyCostsBefore = engine.zoneMgr.getCardsInZone(p1, 'COST').filter((c) => c.isReady).length;

    const res = engine.dispatchAction({ type: 'PLAY_CARD', playerId: p1, cardInstanceId: roleInHand.instanceId });
    expect(res.success).toBe(false);
    expect(res.events).toEqual([]);
    expect(engine.getEvents().length).toBe(eventCountBefore);
    expect(state.cards[roleInHand.instanceId]!.zone).toBe('HAND');
    expect(engine.zoneMgr.getCardsInZone(p1, 'COST').filter((c) => c.isReady).length).toBe(readyCostsBefore);
  });

  it('不能把对方的卡牌或非装备牌当作装备', () => {
    const engine = newEngine();
    const state = engine.getState();
    const p1 = state.activePlayerId;
    const p2 = state.nonActivePlayerId;

    const myRole = findCard(engine, p1, 'ST03-005');
    engine.fieldMgr.playRoleCard(p1, myRole.instanceId, 0);

    const oppHandCard = engine.zoneMgr.getCardsInZone(p2, 'HAND')[0]!;
    const res = engine.dispatchAction({
      type: 'EQUIP_ITEM',
      playerId: p1,
      equipmentCardId: oppHandCard.instanceId,
      targetRoleCardId: myRole.instanceId,
    });
    expect(res.success).toBe(false);
    expect(state.cards[oppHandCard.instanceId]!.zone).toBe('HAND');
    expect(state.cards[myRole.instanceId]!.attachedEquipmentId).toBeUndefined();

    // 单独占位的己方装备牌可以装备
    const equip = findCard(engine, p1, 'ST02-009');
    expect(engine.fieldMgr.playStandaloneEquipment(p1, equip.instanceId, 1)).toBe(true);
    const ok = engine.dispatchAction({
      type: 'EQUIP_ITEM',
      playerId: p1,
      equipmentCardId: equip.instanceId,
      targetRoleCardId: myRole.instanceId,
    });
    expect(ok.success).toBe(true);
    expect(state.cards[myRole.instanceId]!.attachedEquipmentId).toBe(equip.instanceId);
    expect(state.battlefields[p1]![1]!.standaloneEquipmentId).toBeUndefined();
  });

  it('单独放置的装备牌占用卡位，之后不能再在该卡位出场其他卡牌', () => {
    const engine = newEngine();
    const p1 = engine.getState().activePlayerId;
    const equip = findCard(engine, p1, 'ST02-009');
    expect(engine.fieldMgr.playStandaloneEquipment(p1, equip.instanceId, 0)).toBe(true);
    expect(engine.fieldMgr.findFirstEmptySlot(p1)).toBe(1);
    const role = findCard(engine, p1, 'ST03-005');
    expect(engine.fieldMgr.playRoleCard(p1, role.instanceId, 0)).toBe(false);
  });

  it('攻击者、攻击对象、阻挡者都必须是卡位上的角色', () => {
    const engine = newEngine();
    const state = engine.getState();
    const p1 = state.activePlayerId;
    const p2 = state.nonActivePlayerId;

    // 己方放置辅助机 (竖直)，不能用它攻击
    const assist = findCard(engine, p1, 'BP01-024');
    expect(engine.fieldMgr.playAssistCard(p1, assist.instanceId, 0)).toBe(true);
    state.cards[assist.instanceId]!.turnEnteredZone = 0;
    expect(
      engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: p1, attackerCardId: assist.instanceId, targetType: 'PLAYER' })
        .success
    ).toBe(false);

    // 对方横置的单独装备不能作为攻击对象
    const myRole = findCard(engine, p1, 'ST03-005');
    engine.fieldMgr.playRoleCard(p1, myRole.instanceId, 1);
    state.cards[myRole.instanceId]!.turnEnteredZone = 0;
    const oppEquip = findCard(engine, p2, 'ST02-009');
    engine.fieldMgr.playStandaloneEquipment(p2, oppEquip.instanceId, 0);
    state.cards[oppEquip.instanceId]!.isReady = false;
    expect(
      engine.dispatchAction({
        type: 'DECLARE_ATTACK',
        playerId: p1,
        attackerCardId: myRole.instanceId,
        targetType: 'CHARACTER',
        targetCardId: oppEquip.instanceId,
      }).success
    ).toBe(false);

    // 攻击玩家后，对方不能用装备牌阻挡
    state.cards[oppEquip.instanceId]!.isReady = true;
    expect(
      engine.dispatchAction({ type: 'DECLARE_ATTACK', playerId: p1, attackerCardId: myRole.instanceId, targetType: 'PLAYER' })
        .success
    ).toBe(true);
    expect(
      engine.dispatchAction({ type: 'DECLARE_BLOCK', playerId: p2, blockerCardId: oppEquip.instanceId }).success
    ).toBe(false);
  });

  it('起动能力只能由回合玩家在主要阶段、以战场上的卡牌发动', () => {
    const engine = newEngine();
    const state = engine.getState();
    const p1 = state.activePlayerId;
    const p2 = state.nonActivePlayerId;

    // ST03-002 的【起】横置该牌：在手牌中不能发动
    const vera = findCard(engine, p1, 'ST03-002');
    engine.zoneMgr.moveCard(vera.instanceId, 'HAND', { isFaceUp: true });
    expect(
      engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: p1, sourceCardId: vera.instanceId, abilityIndex: 0 }).success
    ).toBe(false);

    // 回合外玩家不能发动
    const oppVera = findCard(engine, p2, 'ST03-002');
    engine.fieldMgr.playRoleCard(p2, oppVera.instanceId, 0);
    expect(
      engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: p2, sourceCardId: oppVera.instanceId, abilityIndex: 0 }).success
    ).toBe(false);

    // 回合玩家在主要阶段以战场上的卡牌发动
    engine.fieldMgr.playRoleCard(p1, vera.instanceId, 0);
    expect(
      engine.dispatchAction({ type: 'ACTIVATE_ABILITY', playerId: p1, sourceCardId: vera.instanceId, abilityIndex: 0 }).success
    ).toBe(true);
    expect(state.cards[vera.instanceId]!.isReady).toBe(false);
  });

  it('卡牌实例 ID 不按卡组列表顺序编号，无法据此推算卡牌', () => {
    const idsOf = (seed: number) => {
      const engine = new GameEngine(
        `game-ids-${seed}`,
        { playerId: 'p1', deckCardNumbers: st03Deck() },
        { playerId: 'p2', deckCardNumbers: st03Deck() },
        seed,
        cardDb
      );
      return Object.values(engine.getState().cards)
        .filter((c) => c.ownerPlayerId === 'p1')
        .sort((a, b) => a.instanceId.localeCompare(b.instanceId, 'en', { numeric: true }))
        .map((c) => c.cardNumber);
    };

    for (const id of Object.keys(newEngine(11).getState().cards)) {
      expect(id).not.toContain('p1');
      expect(id).not.toContain('p2');
    }
    // 按 ID 排序后的卡牌序列与卡组列表顺序无关，且不同对局各不相同
    expect(idsOf(1)).not.toEqual(st03Deck());
    expect(idsOf(1)).not.toEqual(idsOf(2));
  });
});
