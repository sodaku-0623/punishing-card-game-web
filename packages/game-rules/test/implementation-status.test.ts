import { describe, it, expect } from 'vitest';
import {
  EXACT_IMPLEMENTED_CARDS,
  EXACT_IMPLEMENTED_CARD_LIST,
  getCardImplementationStatus,
  isCardApproximatelyImplemented,
} from '../src/index.js';

describe('卡牌效果实现状态登记表 (docs/future-work.md §3.6)', () => {
  it('官方全卡表 490 张 (ST01~ST06 83 张 + BP01~BP04 + PR 含冠军异画) 均登记为 EXACT，且无重复编号', () => {
    expect(EXACT_IMPLEMENTED_CARD_LIST.length).toBe(490);
    expect(EXACT_IMPLEMENTED_CARDS.size).toBe(490);
    const packCounts: Array<[string, number]> = [
      ['ST01', 14],
      ['ST02', 14],
      ['ST03', 14],
      ['ST04', 14],
      ['ST05', 13],
      ['ST06', 14],
      ['BP01', 86],
      ['BP02', 90],
      ['BP03', 89],
      ['BP04', 89],
      ['PR', 49],
    ];
    for (const [prefix, count] of packCounts) {
      for (let i = 1; i <= count; i++) {
        const num = `${prefix}-${String(i).padStart(3, '0')}`;
        expect(getCardImplementationStatus(num, '【出】：测试文本')).toBe('EXACT');
        expect(isCardApproximatelyImplemented(num, '【出】：测试文本')).toBe(false);
      }
    }
    expect(getCardImplementationStatus('BP01-056a', '【自】：…')).toBe('EXACT');
    expect(getCardImplementationStatus('BP01-056b', '【自】：…')).toBe('EXACT');
    expect(getCardImplementationStatus('BP02-022【冠军】', '【出】：…')).toBe('EXACT');
    expect(getCardImplementationStatus('BP03-003【冠军】', '【永】：…')).toBe('EXACT');
  });

  it('2.7.3 异画同编号 (末尾小写字母如 ST01-001a) 共享精确实现判定', () => {
    expect(getCardImplementationStatus('ST01-001a', '【出】：…')).toBe('EXACT');
    expect(isCardApproximatelyImplemented('ST02-011b', '【瞬时】：…')).toBe(false);
  });

  it('无规则文本的白板卡为 VANILLA (不标记为近似效果)，未在登记表中的扩展编号牌为 APPROXIMATE', () => {
    expect(getCardImplementationStatus('BP99-099', '')).toBe('VANILLA');
    expect(getCardImplementationStatus('BP99-099', '   ')).toBe('VANILLA');
    expect(isCardApproximatelyImplemented('BP99-099', '')).toBe(false);

    expect(getCardImplementationStatus('BP99-001', '【起】【回合1】：…')).toBe('APPROXIMATE');
    expect(isCardApproximatelyImplemented('BP99-001', '【起】【回合1】：…')).toBe(true);
  });
});
