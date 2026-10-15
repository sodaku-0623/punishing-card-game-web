import { describe, it, expect } from 'vitest';
import { SignalOrbType } from '@zhanshuang/shared';
import { validateDeck, extractCoreCardNumber, DeckCardInput } from '../src/validators/deck.js';

describe('Deck Validation Rules (5.1 牌组的准备)', () => {
  it('正确解析卡牌编号并剥除异画小写后缀 (2.7.3)', () => {
    expect(extractCoreCardNumber('BP01-001')).toBe('BP01-001');
    expect(extractCoreCardNumber('BP01-001a')).toBe('BP01-001');
    expect(extractCoreCardNumber('BP01-001b')).toBe('BP01-001');
  });

  function createLegalDeck(): DeckCardInput[] {
    const cards: DeckCardInput[] = [
      // 12张信号球牌 (各4张)
      { cardId: 'c-red', cardNumber: 'ST01-012', name: '红莲-起手式', signalOrb: SignalOrbType.RED, count: 4 },
      { cardId: 'c-blue', cardNumber: 'ST01-013', name: '红莲-波动斩', signalOrb: SignalOrbType.BLUE, count: 4 },
      { cardId: 'c-yellow', cardNumber: 'ST01-014', name: '红莲-闪击', signalOrb: SignalOrbType.YELLOW, count: 4 },
      // 38张常规战术与角色卡 (共50张)
      { cardId: 'c-lucia', cardNumber: 'BP01-001', name: '露西亚·红莲', count: 4 },
      { cardId: 'c-liv', cardNumber: 'BP01-002', name: '丽芙·蚀暗', count: 4 },
      { cardId: 'c-lee', cardNumber: 'BP01-003', name: '里·异火', count: 4 },
      { cardId: 'c-nanami', cardNumber: 'BP01-004', name: '七实·风暴', count: 4 },
      { cardId: 'c-karenina', cardNumber: 'BP01-005', name: '卡列尼娜·爆裂', count: 4 },
      { cardId: 'c-bianca', cardNumber: 'BP01-006', name: '比安卡·零度', count: 4 },
      { cardId: 'c-watanabe', cardNumber: 'BP01-007', name: '渡边·夜刃', count: 4 },
      { cardId: 'c-kamui', cardNumber: 'BP01-008', name: '神威·重能', count: 4 },
      { cardId: 'c-tactic-1', cardNumber: 'BP01-009', name: '战术补给', count: 4 },
      { cardId: 'c-tactic-2', cardNumber: 'BP01-010', name: '精确打击', count: 2 },
    ];
    return cards;
  }

  it('合法牌组验证成功 (刚好50张，同号<=4，红蓝黄各4张)', () => {
    const deck = createLegalDeck();
    const result = validateDeck(deck);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.totalCards).toBe(50);
    expect(result.redOrbCount).toBe(4);
    expect(result.blueOrbCount).toBe(4);
    expect(result.yellowOrbCount).toBe(4);
  });

  it('总张数不是50张时判定非法 (5.1.2.a)', () => {
    const deck = createLegalDeck();
    deck[deck.length - 1]!.count = 1; // 变成 49 张
    const result = validateDeck(deck);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('50 张卡牌构成'))).toBe(true);
  });

  it('同编号卡牌超过4张时判定非法 (5.1.2.b)', () => {
    const deck = createLegalDeck();
    // 将 001 设为 5 张，010 设为 1 张保持总数 50
    deck.find((c) => c.cardNumber === 'BP01-001')!.count = 5;
    deck.find((c) => c.cardNumber === 'BP01-010')!.count = 1;
    const result = validateDeck(deck);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('不得超过 4 张'))).toBe(true);
  });

  it('带不同变体小写后缀但同核心编号超过4张时判定非法 (2.7.3 & 5.1.2.b)', () => {
    const deck = createLegalDeck();
    // 3张 BP01-001 + 2张 BP01-001a = 5张同号卡
    deck.find((c) => c.cardNumber === 'BP01-001')!.count = 3;
    deck.push({
      cardId: 'c-lucia-alt',
      cardNumber: 'BP01-001a',
      name: '露西亚·红莲(异画)',
      count: 2,
    });
    deck.find((c) => c.cardNumber === 'BP01-010')!.count = 1; // 维持50张
    const result = validateDeck(deck);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('不得超过 4 张'))).toBe(true);
  });

  it('信号球缺少或超量时判定非法 (5.1.2.c)', () => {
    const deck = createLegalDeck();
    deck.find((c) => c.signalOrb === SignalOrbType.RED)!.count = 3;
    deck.find((c) => c.signalOrb === SignalOrbType.BLUE)!.count = 5;
    const result = validateDeck(deck);
    expect(result.isValid).toBe(false);
    expect(result.errors.some((e) => e.includes('<信号球·红>'))).toBe(true);
    expect(result.errors.some((e) => e.includes('<信号球·蓝>'))).toBe(true);
  });
});
