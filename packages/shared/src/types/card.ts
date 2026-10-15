/**
 * 《战双帕弥什 卡牌对战》卡牌模型定义 (第2章 卡牌的情报)
 */

export enum CardType {
  ROLE = 'ROLE', // 角色牌 (2.2.2.a)
  TACTICS = 'TACTICS', // 战术牌 (2.2.2.b)
  EQUIPMENT = 'EQUIPMENT', // 道具牌-装备 (2.2.2.c.1)
  ASSIST = 'ASSIST', // 道具牌-辅助机 (2.2.2.c.2)
}

export enum ElementAttribute {
  FIRE = 'FIRE', // 火属性 (10.13)
  LIGHTNING = 'LIGHTNING', // 雷属性
  DARK = 'DARK', // 暗属性
  ICE = 'ICE', // 冰属性
  PHYSICAL = 'PHYSICAL', // 物理属性
  NONE = 'NONE', // 无属性 (4.16.1.a 信号球牌等)
  VOID = 'VOID', // 空属性
}

export enum SignalOrbType {
  RED = 'RED', // 信号球·红 (2.10)
  BLUE = 'BLUE', // 信号球·蓝
  YELLOW = 'YELLOW', // 信号球·黄
}

export enum AbilityType {
  STATIC = 'STATIC', // 永久能力 (8.1.1.a)
  TRIGGERED = 'TRIGGERED', // 自动能力 (8.1.1.b)
  ENTER_FIELD = 'ENTER_FIELD', // 出场能力 (8.1.1.b.2)
  ACTIVATED = 'ACTIVATED', // 起动能力 (8.1.1.c)
}

export interface AbilityDefinition {
  id: string;
  type: AbilityType;
  costDescription?: string;
  rulesText: string;
  isInstant?: boolean; // 10.8 是否具备【瞬时】
  oncePerTurn?: boolean; // 10.1 是否【回合1】
  oncePerGame?: boolean; // 10.11 是否【游戏1】
  payload?: Record<string, unknown>; // 结构化效果数据
}

export interface AscensionRuleConfig {
  targetFilter: {
    maxCost?: number;
    traits?: string[];
    nameIncludes?: string;
  };
  restrictionFilter?: {
    minCostLimit?: number;
  };
  ascensionCost: number;
  grantKeywords: string[];
}

export interface CardVersionData {
  id: string;
  cardNumber: string; // 2.7 如 "BP01-001"
  name: string; // 2.1
  cardType: CardType; // 2.2
  cost: number; // 2.3 费用
  attribute: ElementAttribute; // 2.4 属性
  traits: string[]; // 2.6 卡牌特征
  basePP?: number; // 2.8 基本PP (角色/装备牌)
  baseDP?: number; // 2.9 基本DP (角色牌)
  signalOrb?: SignalOrbType; // 2.10 信号球标记
  isInstant: boolean; // 10.8 是否持有【瞬时】
  ascensionConfig?: AscensionRuleConfig; // 8.11 升变配置
  abilities: AbilityDefinition[];
  rulesText: string;
  flavorText?: string;
  imageUrl?: string; // 卡面插画链接
}
