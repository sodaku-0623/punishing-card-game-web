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

describe('开局手牌调度阶段 (5.2.1.e Mulligan Phase)', () => {
  it('1. 开局进入 MULLIGAN_PHASE，双方持有4张手牌且未完成调度', () => {
    const engine = new GameEngine(
      'game-mulligan-01',
      { playerId: 'p1', deckCardNumbers: create50CardDeck() },
      { playerId: 'p2', deckCardNumbers: create50CardDeck() },
      12345,
      undefined,
      { skipMulligan: false }
    );

    const state = engine.getState();
    expect(state.phase).toBe('MULLIGAN_PHASE');
    expect(state.players.p1!.hasMulliganed).toBe(false);
    expect(state.players.p2!.hasMulliganed).toBe(false);

    const p1Hand = engine.zoneMgr.getCardsInZone('p1', 'HAND');
    const p2Hand = engine.zoneMgr.getCardsInZone('p2', 'HAND');
    expect(p1Hand).toHaveLength(4);
    expect(p2Hand).toHaveLength(4);

    // 依据 5.2.1.e & 5.2.1.f：调度阶段费用区为0，牌组包含全部46张未扣除费用的卡牌
    const p1Costs = engine.zoneMgr.getCardsInZone('p1', 'COST');
    const p2Costs = engine.zoneMgr.getCardsInZone('p2', 'COST');
    expect(p1Costs).toHaveLength(0);
    expect(p2Costs).toHaveLength(0);

    const p1Deck = engine.zoneMgr.getCardsInZone('p1', 'DECK');
    const p2Deck = engine.zoneMgr.getCardsInZone('p2', 'DECK');
    expect(p1Deck).toHaveLength(46);
    expect(p2Deck).toHaveLength(46);
  });

  it('2. 调度执行：选择2张放回牌组底、重新抽取2张并洗牌，双方完成后进入第1回合', () => {
    const engine = new GameEngine(
      'game-mulligan-02',
      { playerId: 'p1', deckCardNumbers: create50CardDeck() },
      { playerId: 'p2', deckCardNumbers: create50CardDeck() },
      99999,
      undefined,
      { skipMulligan: false }
    );

    const p1HandBefore = engine.zoneMgr.getCardsInZone('p1', 'HAND');
    const cardsToReplace = [p1HandBefore[0]!.instanceId, p1HandBefore[1]!.instanceId];

    // p1 执行调度
    const res1 = engine.applyAction({
      type: 'RESOLVE_MULLIGAN',
      playerId: 'p1',
      cardInstanceIdsToBottom: cardsToReplace,
    });
    expect(res1.success).toBe(true);

    const p1HandAfter = engine.zoneMgr.getCardsInZone('p1', 'HAND');
    expect(p1HandAfter).toHaveLength(4);
    // 原先选中的2张牌不应该在手牌中
    expect(p1HandAfter.some((c) => cardsToReplace.includes(c.instanceId))).toBe(false);
    expect(engine.getState().players.p1!.hasMulliganed).toBe(true);
    // 依然在 MULLIGAN_PHASE，等待 p2
    expect(engine.getState().phase).toBe('MULLIGAN_PHASE');

    // p1 重复调度应被拒绝
    const resDup = engine.applyAction({
      type: 'RESOLVE_MULLIGAN',
      playerId: 'p1',
      cardInstanceIdsToBottom: [],
    });
    expect(resDup.success).toBe(false);
    expect(resDup.error).toContain('仅有一次手牌调度机会');

    // p2 选择保留全部手牌 (0张调度)
    const res2 = engine.applyAction({
      type: 'RESOLVE_MULLIGAN',
      playerId: 'p2',
      cardInstanceIdsToBottom: [],
    });
    expect(res2.success).toBe(true);
    expect(engine.getState().players.p2!.hasMulliganed).toBe(true);

    // 双方均完成调度，执行 5.2.1.f 放置起始明费后推进到第1回合 STAND_PHASE -> DRAW_CHARGE_PHASE
    expect(engine.getState().phase).toBe('DRAW_CHARGE_PHASE');
    expect(engine.getState().turnNumber).toBe(1);

    // 验证双方在调度完成后均获得 2 张正面竖直的起始明费 (5.2.1.f)
    const p1CostsAfter = engine.zoneMgr.getCardsInZone('p1', 'COST');
    const p2CostsAfter = engine.zoneMgr.getCardsInZone('p2', 'COST');
    expect(p1CostsAfter).toHaveLength(2);
    expect(p2CostsAfter).toHaveLength(2);
    expect(p1CostsAfter.every((c) => c.isFaceUp && c.isReady)).toBe(true);
    expect(p2CostsAfter.every((c) => c.isFaceUp && c.isReady)).toBe(true);
    expect(engine.getState().players.p1!.availableOpenCostCount).toBe(2);
    expect(engine.getState().players.p2!.availableOpenCostCount).toBe(2);

    // 先攻玩家在其第1回合自动抽1张牌 (4 + 1 = 5)，牌组剩余 46 - 2 - 1 = 43 张
    const firstPlayerId = engine.getState().activePlayerId;
    const secondPlayerId = engine.getState().nonActivePlayerId;
    const firstPlayerHand = engine.zoneMgr.getCardsInZone(firstPlayerId, 'HAND');
    const secondPlayerHand = engine.zoneMgr.getCardsInZone(secondPlayerId, 'HAND');
    expect(firstPlayerHand).toHaveLength(5);
    expect(secondPlayerHand).toHaveLength(4);

    expect(engine.zoneMgr.getCardsInZone(firstPlayerId, 'DECK')).toHaveLength(43);
    expect(engine.zoneMgr.getCardsInZone(secondPlayerId, 'DECK')).toHaveLength(44);
  });

  it('3. 在 MULLIGAN_PHASE 使用 PASS_ACTION_TIMING 自动视为保留手牌', () => {
    const engine = new GameEngine(
      'game-mulligan-03',
      { playerId: 'p1', deckCardNumbers: create50CardDeck() },
      { playerId: 'p2', deckCardNumbers: create50CardDeck() },
      77777,
      undefined,
      { skipMulligan: false }
    );

    const res1 = engine.applyAction({
      type: 'PASS_ACTION_TIMING',
      playerId: 'p1',
    });
    expect(res1.success).toBe(true);
    expect(engine.getState().players.p1!.hasMulliganed).toBe(true);

    const res2 = engine.applyAction({
      type: 'PASS_ACTION_TIMING',
      playerId: 'p2',
    });
    expect(res2.success).toBe(true);
    expect(engine.getState().players.p2!.hasMulliganed).toBe(true);

    expect(engine.getState().phase).toBe('DRAW_CHARGE_PHASE');
  });

  it('4. 调度安全校验：不能调度对手的手牌或非手牌区域卡牌', () => {
    const engine = new GameEngine(
      'game-mulligan-04',
      { playerId: 'p1', deckCardNumbers: create50CardDeck() },
      { playerId: 'p2', deckCardNumbers: create50CardDeck() },
      88888,
      undefined,
      { skipMulligan: false }
    );

    const p2Hand = engine.zoneMgr.getCardsInZone('p2', 'HAND');
    // p1 试图调度 p2 的手牌
    const resIllegal = engine.applyAction({
      type: 'RESOLVE_MULLIGAN',
      playerId: 'p1',
      cardInstanceIdsToBottom: [p2Hand[0]!.instanceId],
    });
    expect(resIllegal.success).toBe(false);
    expect(resIllegal.error).toContain('不在手牌中');
  });
});
