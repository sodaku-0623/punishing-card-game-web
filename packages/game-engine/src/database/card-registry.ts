import { CardVersionData, CardType, ElementAttribute } from '@zhanshuang/shared';
import { OFFICIAL_CARDS_DATA } from './official-cards-data.js';

export { OFFICIAL_CARDS_DATA, parseAscensionConfig } from './official-cards-data.js';

/**
 * 引擎卡牌数据仓库接口
 */
export interface ICardDatabase {
  getCard(cardNumberOrId: string): CardVersionData | undefined;
  hasCard(cardNumberOrId: string): boolean;
}

/**
 * 规则书基础卡牌测试与官方卡牌全集
 */
export const BASE_TEST_CARDS: CardVersionData[] = [
  ...OFFICIAL_CARDS_DATA,
  // 保持单测专用角色别名兼容性
  {
    id: 'c-nanami-rush',
    cardNumber: 'c-nanami-rush',
    name: '七实·风暴',
    cardType: CardType.ROLE,
    attribute: ElementAttribute.FIRE,
    cost: 3,
    basePP: 3000,
    baseDP: 1,
    traits: ['结构体'],
    isInstant: false,
    abilities: [],
    rulesText: '持有【速攻】',
  },
  {
    id: 'c-kamui-pierce',
    cardNumber: 'c-kamui-pierce',
    name: '神威·重能',
    cardType: CardType.ROLE,
    attribute: ElementAttribute.DARK,
    cost: 4,
    basePP: 4000,
    baseDP: 1,
    traits: ['突击鹰小队', '结构体'],
    isInstant: false,
    abilities: [],
    rulesText: '持有【贯通】',
  },
  {
    id: 'c-karenina-burst',
    cardNumber: 'c-karenina-burst',
    name: '卡列尼娜·爆裂',
    cardType: CardType.ROLE,
    attribute: ElementAttribute.FIRE,
    cost: 3,
    basePP: 3000,
    baseDP: 1,
    traits: ['工程部队'],
    isInstant: false,
    abilities: [],
    rulesText: '【自】：该牌攻击宣言时，若我方信号球区存在2张及以上<信号球·红>，本回合DP+1。',
  },
  {
    id: 'c-lucia-entry-buff',
    cardNumber: 'c-lucia-entry-buff',
    name: '露西亚·红莲',
    cardType: CardType.ROLE,
    attribute: ElementAttribute.FIRE,
    cost: 3,
    basePP: 3000,
    baseDP: 1,
    traits: ['灰鸦小队'],
    isInstant: false,
    abilities: [],
    rulesText: '【出】：若我方费用区存在3张以上明费，该角色本回合PP+500。',
  },
  {
    id: 'c-lee-ignite-activate',
    cardNumber: 'c-lee-ignite-activate',
    name: '里·异火',
    cardType: CardType.ROLE,
    attribute: ElementAttribute.FIRE,
    cost: 3,
    basePP: 3000,
    baseDP: 1,
    traits: ['灰鸦小队'],
    isInstant: false,
    abilities: [],
    rulesText: '【起】【1费】: 对对方战场的1张角色造成1000点效果伤害。',
  },
];

/**
 * 内存卡牌注册表 (用于单机运行、自动化测试与引擎独立执行)
 */
export class MemoryCardDatabase implements ICardDatabase {
  private cards: Map<string, CardVersionData> = new Map();

  constructor(cards?: CardVersionData[]) {
    const list = cards && cards.length > 0 ? cards : BASE_TEST_CARDS;
    for (const card of list) {
      this.registerCard(card);
    }
  }

  registerCard(card: CardVersionData): void {
    if (card.cardNumber) {
      this.cards.set(card.cardNumber, card);
      this.cards.set(card.cardNumber.toUpperCase(), card);
    }
    if (card.id) {
      this.cards.set(card.id, card);
    }
  }

  getCard(cardNumberOrId: string): CardVersionData | undefined {
    if (!cardNumberOrId) return undefined;
    return this.cards.get(cardNumberOrId) || this.cards.get(cardNumberOrId.toUpperCase());
  }

  hasCard(cardNumberOrId: string): boolean {
    if (!cardNumberOrId) return false;
    return this.cards.has(cardNumberOrId) || this.cards.has(cardNumberOrId.toUpperCase());
  }
}
