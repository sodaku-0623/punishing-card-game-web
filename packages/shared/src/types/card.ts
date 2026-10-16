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

/**
 * 8.11.2.a.2 升变条件中「&」右侧的限制条件
 */
export type AscensionRestriction =
  | { kind: 'MIN_COST_LIMIT'; value: number } // 费用上限X及以上 (3.6.6)
  | { kind: 'MIN_OPEN_COST_LIMIT'; value: number } // 明费上限X及以上 (3.6.6.a)
  | { kind: 'MIN_ORB_ZONE_CARDS'; value: number; cardName?: string } // 信号球区的(《卡名》)牌X张及以上
  | { kind: 'MAX_FIELD_ROLES'; value: number } // 我方战场的角色为X张及以下
  | { kind: 'COST_ZONE_ROLES_ATTRIBUTE'; attribute: string }; // 费用区所有角色牌为X属性

export interface AscensionRuleConfig {
  /** 8.11.2.a.1 升变对象 */
  targetFilter: {
    /** 升变对象费用的上限 (含)。「费用8以下」按 10.12 为「小于8」，即 maxCost = 7 */
    maxCost?: number;
    /** 「费用为X的」：费用必须恰好为 X */
    exactCost?: number;
    /** 以 <特征> 指定的升变对象 */
    traits?: string[];
    /** 以《卡名》指定的升变对象 (卡名完全一致，2.1.3) */
    exactName?: string;
    /** 对象的特征或卡名关键字 (兼容旧数据) */
    nameIncludes?: string;
    /** 升变对象须为竖直状态 */
    requireReady?: boolean;
  };
  restrictionFilter?: {
    minCostLimit?: number;
    conditions?: AscensionRestriction[];
  };
  /** 升变条件或代价中包含引擎尚未支持的内容时记录原因，此时不允许使用升变机制 */
  unsupportedReason?: string;
  ascensionCost: number;
  /** 8.11.2.c 升变能力赋予的关键字 (如 速攻、突进) */
  grantKeywords: string[];
  /** 可以从哪些区域使用升变机制 (默认手牌) */
  sourceZones?: ('HAND' | 'GRAVEYARD')[];
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
