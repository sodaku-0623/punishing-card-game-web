import { describe, it, expect } from 'vitest';
import {
  EXACT_IMPLEMENTED_CARDS,
  EXACT_IMPLEMENTED_CARD_LIST,
  getCardImplementationStatus,
  isCardApproximatelyImplemented,
} from '../src/index.js';

describe('卡牌效果实现状态登记表 (docs/future-work.md §3.6)', () => {
  it('官方预组 ST01~ST06 (83 张) 与 BP01 第一批 (47 张) 共 130 张卡牌均登记为 EXACT，且无重复编号', () => {
    expect(EXACT_IMPLEMENTED_CARD_LIST.length).toBe(130);
    expect(EXACT_IMPLEMENTED_CARDS.size).toBe(130);
    const packCounts: Array<[string, number]> = [
      ['ST01', 14],
      ['ST02', 14],
      ['ST03', 14],
      ['ST04', 14],
      ['ST05', 13],
      ['ST06', 14],
    ];
    for (const [prefix, count] of packCounts) {
      for (let i = 1; i <= count; i++) {
        const num = `${prefix}-${String(i).padStart(3, '0')}`;
        expect(getCardImplementationStatus(num, '【出】：测试文本')).toBe('EXACT');
        expect(isCardApproximatelyImplemented(num, '【出】：测试文本')).toBe(false);
      }
    }
    expect(getCardImplementationStatus('BP01-001', '【出】消除2同色信号球：…')).toBe('EXACT');
    expect(getCardImplementationStatus('BP01-040', '【永】：…')).toBe('EXACT');
    expect(getCardImplementationStatus('BP01-086', '【充能自】：…')).toBe('EXACT');
  });

  it('2.7.3 异画同编号 (末尾小写字母如 ST01-001a) 共享精确实现判定', () => {
    expect(getCardImplementationStatus('ST01-001a', '【出】：…')).toBe('EXACT');
    expect(isCardApproximatelyImplemented('ST02-011b', '【瞬时】：…')).toBe(false);
  });

  it('无规则文本的白板卡为 VANILLA (不标记为近似效果)，有复杂规则文本的未迁移卡包牌为 APPROXIMATE', () => {
    expect(getCardImplementationStatus('BP01-099', '')).toBe('VANILLA');
    expect(getCardImplementationStatus('BP01-099', '   ')).toBe('VANILLA');
    expect(isCardApproximatelyImplemented('BP01-099', '')).toBe(false);

    expect(getCardImplementationStatus('BP01-014', '【起】【回合1】：…')).toBe('APPROXIMATE');
    expect(isCardApproximatelyImplemented('BP01-014', '【起】【回合1】：…')).toBe(true);
    expect(isCardApproximatelyImplemented('BP04-001', '【永】：该牌下方的牌每有1张…')).toBe(true);
  });
});
