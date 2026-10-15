/**
 * 《战双帕弥什 卡牌对战》综合规则核心数值常量
 * 依据：《战双帕弥什 卡牌对战》综合规则 (A0 初版发行)
 */

export const RULE_CONSTANTS = {
  // 5.1 牌组构筑
  DECK_EXACT_SIZE: 50, // 5.1.2.a 牌组必须由刚好50张卡牌构成
  MAX_COPIES_PER_CARD: 4, // 5.1.2.b 同一卡牌编号不得超过4张
  REQUIRED_SIGNAL_ORBS_EACH: 4, // 5.1.2.c 红、蓝、黄信号球牌各必须投入4张
  TOTAL_REQUIRED_SIGNAL_ORBS: 12, // 合计12张信号球牌

  // 5.2 游戏准备
  INITIAL_HAND_SIZE: 4, // 5.2.1.e 起始手牌4张
  INITIAL_OPEN_COSTS: 2, // 5.2.1.f 起始牌组顶2张正面放置为明费

  // 3.2 战场
  BATTLEFIELD_SLOTS_PER_PLAYER: 5, // 3.2.3 每位玩家战场设有5个卡位
  MAX_ASSIST_PER_PLAYER: 1, // 2.2.2.c.2 / 9.5.4 战场最多存在1张辅助机牌
  MAX_EQUIPMENT_PER_ROLE: 1, // 4.18.3 / 9.5.3 每张角色最多装备1张装备牌

  // 3.4 手牌
  MAX_HAND_SIZE_END_PHASE: 7, // 3.4.3.a / 6.5.1.c 结束阶段手牌上限7张

  // 3.6 费用区
  MAX_COST_ZONE_CAPACITY: 10, // 3.6.4.a / 9.5.5 费用区卡牌上限10张

  // 1.2 / 3.9 / 9.3 败北判定
  EROSION_LOSS_THRESHOLD: 7, // 1.2.2.a / 9.3.1.a 侵蚀计数达到7即败北

  // 6.4.1.b.5 消除信号球
  ORB_ELIMINATION_REQUIRED_COUNT: 3, // 必须消除3张相邻球
  ORB_ELIMINATION_DRAW_COUNT: 1, // 消除后抽1张牌

  // 10.7 贯通
  PIERCING_DAMAGE_VALUE: 1, // 贯通伤害固定给予1点伤害
} as const;
