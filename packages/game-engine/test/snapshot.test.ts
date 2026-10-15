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

describe('GameEngine 快照导出与恢复机制 (Durable Object 驱逐后 O(1) 恢复)', () => {
  const p1 = { playerId: 'p1', deckCardNumbers: create50CardDeck() };
  const p2 = { playerId: 'p2', deckCardNumbers: create50CardDeck() };

  it('导出的快照通过 fromSnapshot 恢复后，游戏状态、RNG 及当前回合完全一致', () => {
    const originalEngine = new GameEngine('game_snap_1', p1, p2, 123456);

    expect(originalEngine.state.status).toBe('PLAYING');
    expect(originalEngine.state.activePlayerId).toBe('p1');

    // 导出快照
    const snapshot = originalEngine.toSnapshot();

    // 从快照重建新引擎实例
    const restoredEngine = GameEngine.fromSnapshot(snapshot);

    // 验证状态一致性
    expect(restoredEngine.state.gameId).toBe(originalEngine.state.gameId);
    expect(restoredEngine.state.phase).toBe(originalEngine.state.phase);
    expect(restoredEngine.state.activePlayerId).toBe(originalEngine.state.activePlayerId);
    expect(restoredEngine.state.turnNumber).toBe(originalEngine.state.turnNumber);
    expect(restoredEngine.state.players.p1!.erosionCount).toBe(originalEngine.state.players.p1!.erosionCount);
    expect(restoredEngine.state.players.p2!.erosionCount).toBe(originalEngine.state.players.p2!.erosionCount);

    // 验证随机数生成序列一致性：两者的下一个随机数必须完全相同
    const nextOriginalRng = originalEngine.rng.next();
    const nextRestoredRng = restoredEngine.rng.next();
    expect(nextRestoredRng).toBe(nextOriginalRng);
  });

  it('从快照恢复后，后续执行的行动产生与原引擎完全一致的事件与对局状态', () => {
    const originalEngine = new GameEngine('game_snap_2', p1, p2, 999888);

    // 让原引擎执行行动
    const snapBeforeAction = originalEngine.toSnapshot();
    const origResult = originalEngine.dispatchAction({
      type: 'PASS_ACTION_TIMING',
      playerId: originalEngine.state.activePlayerId,
    });
    expect(origResult.success).toBe(true);

    // 恢复备份引擎并执行相同的行动
    const restoredEngine = GameEngine.fromSnapshot(snapBeforeAction);
    const restoredResult = restoredEngine.dispatchAction({
      type: 'PASS_ACTION_TIMING',
      playerId: restoredEngine.state.activePlayerId,
    });

    expect(restoredResult.success).toBe(true);
    expect(restoredResult.state.phase).toBe(origResult.state.phase);
    expect(restoredResult.state.activePlayerId).toBe(origResult.state.activePlayerId);
    expect(restoredResult.events.length).toBe(origResult.events.length);
  });
});
