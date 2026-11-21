import type {
  CardType,
  ElementAttribute,
  ProhibitionFlag,
  SignalOrbColor,
  TriggerEventType,
  ZoneId,
} from '@zhanshuang/shared';

export type PlayerSide = 'SELF' | 'OPPONENT';
export type OrbColorFilter = 'ANY' | 'SAME' | 'RED' | 'BLUE' | 'YELLOW';
export type ModifierDuration = 'END_OF_TURN' | 'END_OF_NEXT_TURN' | 'END_OF_COMBAT' | 'UNTIL_LEAVE_ZONE';
export type CompareOp = '>=' | '<=' | '==' | '>' | '<';

/**
 * 卡牌筛选条件 (供选择、群体效果、持续能力与前置条件复用)
 */
export interface CardFilter {
  cardType?: CardType;
  attribute?: ElementAttribute;
  trait?: string;
  /** 满足列表中任意一个特征即匹配 */
  anyTraits?: string[];
  /** 满足列表中任意一个子过滤条件即匹配 (如 BP01-046《帕瓦》或<机械教会>角色) */
  anyFilters?: CardFilter[];
  exactName?: string;
  maxCost?: number;
  minCost?: number;
  exactCost?: number;
  /** true 时要求卡牌费用 <= 操控玩家的明费上限 (如 BP01-073) */
  maxCostOpenCostLimit?: boolean;
  /** 基本 DP 上限 (如 BP01-051 要求基本 DP<=1 的《七实·遥星之座》) */
  maxBaseDP?: number;
  /** true 时要求为升变角色 (如 BP01-054 / BP01-055) */
  isAscended?: boolean;
  maxEffectivePP?: number;
  minEffectivePP?: number;
  isSignalOrb?: boolean;
  signalOrbColor?: SignalOrbColor;
  /** true = 仅正面/明牌，false = 仅背面/暗牌 */
  isFaceUp?: boolean;
  /** true = 仅竖直，false = 仅横置 */
  isReady?: boolean;
  /** true = 仅处于协战状态的角色，false = 仅非协战状态 */
  hasPartner?: boolean;
  /** 限制卡牌当前所在区域 (如 Q&A·7 BP01-056 结算时确认仍在墓地) */
  inZone?: ZoneId;
  excludeSelf?: boolean;
}

/**
 * 声明式数值表达式 (支持字面量与实时派生数值，如侵蚀计数倍率)
 */
export type NumberExpr =
  | number
  | { kind: 'EROSION_MULT'; side: PlayerSide; multiplier: number }
  | { kind: 'ROLE_COUNT_MULT'; side: PlayerSide; filter?: CardFilter; multiplier: number }
  | { kind: 'UNDERNEATH_COUNT_MULT'; multiplier: number }
  | { kind: 'VAR_COUNT_MULT'; varName: string; multiplier: number }
  | { kind: 'FLOOR_DIV'; expr: NumberExpr; divisor: number };

/**
 * 声明式条件表达式 (支持前置条件、静态持续效果条件、「若如此做」等分支判定)
 */
export type ConditionExpr =
  | { kind: 'HAS_ROLE'; side: PlayerSide; filter?: CardFilter; minCount?: number }
  | { kind: 'EROSION_COMPARE'; side: PlayerSide; op: CompareOp; value: number }
  | { kind: 'EROSION_CHANGED_THIS_TURN'; side: PlayerSide }
  | { kind: 'OPEN_COST_COMPARE_OPPONENT'; op: CompareOp }
  | { kind: 'SIGNAL_ORB_BOTTOM_COST_PARITY'; parity: 'ODD' | 'EVEN' }
  | { kind: 'SELF_UNDERNEATH_COUNT'; op: CompareOp; value: number; filter?: CardFilter }
  | { kind: 'SELF_MATCHES_FILTER'; filter: CardFilter }
  | { kind: 'GAME_ABILITY_UNUSED'; abilityKey: string }
  | { kind: 'TURN_ABILITY_UNUSED'; abilityKey: string }
  | { kind: 'ZONE_COUNT'; side: PlayerSide; zone: ZoneId; filter?: CardFilter; op: CompareOp; value: number }
  | { kind: 'HAS_EMPTY_SLOT'; side: PlayerSide }
  | { kind: 'TURN_OWNER'; isSelfTurn: boolean }
  | { kind: 'VAR_NON_EMPTY'; varName: string }
  | { kind: 'VAR_HAS_CARD_MATCHING'; varName: string; filter: CardFilter }
  | { kind: 'ALL'; conditions: ConditionExpr[] }
  | { kind: 'ANY'; conditions: ConditionExpr[] }
  | { kind: 'NOT'; condition: ConditionExpr };

/**
 * 效果作用目标引用 (纯 JSON 可序列化)
 */
export type CardTargetRef =
  | { kind: 'SELF' }
  | { kind: 'VAR'; varName: string }
  | { kind: 'REST_OF_VAR'; allVar: string; excludeVar: string }
  | { kind: 'ALL_MATCHING_ROLES'; side: PlayerSide; filter?: CardFilter }
  | { kind: 'ZONE_CARDS'; side: PlayerSide; zone: 'SIGNAL_ORB' | 'BATTLEFIELD'; filter?: CardFilter }
  | { kind: 'TRIGGER_ATTACKER' }
  | { kind: 'TRIGGER_BLOCKER' }
  | { kind: 'TRIGGER_HOST' };

/**
 * 8.4 能力代价描述 (在效果主体执行之前支付；optional=true 时可选择不支付并中止能力)
 */
export type AbilityCost =
  | {
      kind: 'DISCARD_HAND';
      count: number;
      filter?: CardFilter;
      optional?: boolean;
      prompt?: string;
      choiceEffectType?: string;
    }
  | {
      kind: 'ELIMINATE_ORBS';
      filter: OrbColorFilter;
      count: number;
      optional?: boolean;
      prompt?: string;
      choiceEffectType?: string;
      /** 将本次消除的信号球卡牌 ID 写入变量，供后续按信号球颜色分支执行 */
      savePaidToVar?: string;
    }
  | {
      kind: 'ELIMINATE_ORB_OR_DISCARD_HAND';
      optional?: boolean;
      prompt?: string;
      choiceEffectType?: string;
    }
  | {
      kind: 'TAP_SELF';
    }
  | {
      kind: 'TAP_SELF_AND_DISCARD_HAND';
      count: number;
      filter?: CardFilter;
      prompt?: string;
      choiceEffectType?: string;
    }
  | {
      kind: 'TAP_SELF_AND_ELIMINATE_ORBS';
      filter: OrbColorFilter;
      count: number;
      prompt?: string;
      choiceEffectType?: string;
    }
  | {
      kind: 'SELF_TO_DECK_BOTTOM';
    }
  | {
      kind: 'PAY_COST';
      amount: number;
    };

/**
 * 声明式效果原语指令 (纯 JSON AST，可随 PendingChoice.metadata 序列化并通过快照完整恢复)
 */
export type EffectStep =
  | {
      op: 'DRAW';
      count: number;
      side?: PlayerSide;
    }
  | {
      op: 'MILL';
      count: number;
      side?: PlayerSide;
      saveToVar?: string;
    }
  | {
      op: 'REVEAL_TOP';
      count: number;
      side?: PlayerSide;
      saveToVar: string;
    }
  | {
      op: 'CONFIRM_YES_NO';
      prompt: string;
      yesLabel: string;
      noLabel: string;
      choiceEffectType?: string;
      onYes: EffectStep[];
      onNo?: EffectStep[];
    }
  | {
      op: 'CHOOSE_ROLES';
      side: PlayerSide | 'ANY';
      prompt: string;
      /** 决定出现在候选列表中的角色 */
      filter?: CardFilter;
      /** 决定候选列表中哪些角色可被选中 (不符合者置灰展示，如 ST01-011 PP>8000) */
      eligibilityFilter?: CardFilter;
      ineligibleReason?: string;
      min?: number;
      max?: number;
      saveToVar: string;
      choiceEffectType?: string;
    }
  | {
      op: 'CHOOSE_ZONE_CARDS';
      side: PlayerSide;
      zone: 'HAND' | 'GRAVEYARD' | 'SIGNAL_ORB' | 'COST' | 'DECK' | 'BATTLEFIELD';
      /** 可选多区域联合选择 (如 BP01-028 墓地+费用区合计最多6张<万世铭>) */
      zones?: ('HAND' | 'GRAVEYARD' | 'SIGNAL_ORB' | 'COST' | 'DECK' | 'BATTLEFIELD')[];
      /** zone 为 BATTLEFIELD 时：true 仅匹配卡位顶层卡牌 (不含附着装备与下方牌) */
      topLevelOnly?: boolean;
      prompt: string;
      filter?: CardFilter;
      requireEmptySlot?: boolean;
      ineligibleReason?: string;
      min?: number;
      max?: number;
      saveToVar: string;
      choiceEffectType?: string;
    }
  | {
      op: 'CHOOSE_FROM_VAR';
      varName: string;
      prompt: string;
      filter?: CardFilter;
      requireEmptySlot?: boolean;
      /** 选多张时要求所选卡牌费用合计 <= maxTotalCost (如 BP01-001 费用合计为6及以下) */
      maxTotalCost?: number;
      /** 选多张时要求各自对应到不同特征 (如 ST03-003 最多1张<21号>和最多1张<诺克提>) */
      distinctTraits?: string[];
      distinctTraitsError?: string;
      /** true 时即使没有符合条件的卡牌也会弹出确认框 (如公开牌组顶检索) */
      alwaysShow?: boolean;
      min?: number;
      max?: number;
      saveToVar: string;
      choiceEffectType?: string;
    }
  | {
      op: 'CHOOSE_MODE';
      prompt: string;
      modes: { id: string; label: string; steps: EffectStep[] }[];
      min?: number;
      max?: number;
      /** 动态计算需要选择的不可重复模式数量 (如 BP01-028 每2张选1项、BP01-059 每1张选1项) */
      pickCountExpr?: NumberExpr;
      choiceEffectType?: string;
    }
  | {
      op: 'ELIMINATE_ORB_COST';
      filter: OrbColorFilter;
      count: number;
      optional?: boolean;
      prompt?: string;
      choiceEffectType?: string;
      savePaidToVar?: string;
      onPaid: EffectStep[];
    }
  | {
      op: 'DISCARD_COST_STEP';
      count: number;
      /** 可选最小弃牌数 (默认等于 count；如 BP01-059「丢弃手牌最多2张」时 minCount=1, count=2) */
      minCount?: number;
      filter?: CardFilter;
      optional?: boolean;
      prompt?: string;
      choiceEffectType?: string;
      savePaidToVar?: string;
      onPaid: EffectStep[];
    }
  | {
      /** 横置我方战场顶层竖直卡牌作为可选代价 (如 BP01-023 Q&A·2/7：不含附着装备与下方牌) */
      op: 'TAP_FIELD_CARD_COST_STEP';
      optional?: boolean;
      prompt?: string;
      choiceEffectType?: string;
      onPaid: EffectStep[];
    }
  | {
      /** 将变量中选出的装备牌附着到指定战场角色 (如 BP01-014 / BP01-016 从墓地装备太刀) */
      op: 'EQUIP_FROM_VAR';
      varName: string;
      host: CardTargetRef;
    }
  | {
      /** 将变量中选出的信号球放置到信号球区任意位置 (如 BP01-038 万世铭·重铸) */
      op: 'PLACE_ORB_AT_POSITION';
      varName: string;
      prompt?: string;
      choiceEffectType?: string;
    }
  | {
      op: 'SHUFFLE_DECK';
      side?: PlayerSide;
    }
  | {
      op: 'REORDER_ZONE';
      zone: 'SIGNAL_ORB';
      prompt: string;
      choiceEffectType?: string;
    }
  | {
      op: 'MOVE_CARDS';
      target: CardTargetRef;
      toZone:
        | 'HAND'
        | 'GRAVEYARD'
        | 'SIGNAL_ORB'
        | 'SIGNAL_ORB_BOTTOM'
        | 'DECK_TOP'
        | 'DECK_BOTTOM'
        | 'DECK_SHUFFLE'
        | 'COST'
        | 'UNDERNEATH'
        | 'BATTLEFIELD';
      /** 仅 toZone === 'UNDERNEATH' 时必填：指定置入哪张战场角色下方 */
      underneathHost?: CardTargetRef;
      isFaceUp?: boolean;
      /** 移动到费用区等区域时的竖直/横置状态 (如 BP01-029 竖直放费用区、BP01-039 横置放对方费用区) */
      isReady?: boolean;
      /** 仅 toZone === 'BATTLEFIELD' 时有效：是否以横置状态出场 (如 ST05-002) */
      enterTapped?: boolean;
      /** 仅 toZone === 'BATTLEFIELD' 时有效：是否自动触发被出场角色的【出】能力 */
      triggerEntry?: boolean;
      /** 保存实际完成移动/出场的卡牌 ID (供后续 8.6.4「若如此做」判定) */
      saveMovedToVar?: string;
    }
  | {
      op: 'ASCEND_FROM_VAR';
      /** 待升变出场的卡牌变量 (如 BP01-055 从牌组选出的升变角色) */
      cardVar: string;
      /** 升变目标角色变量 */
      targetVar: string;
      /** 可选额外置入下方的角色变量 (如 BP01-055 同步选的《帕瓦》) */
      extraStackVar?: string;
      shuffleDeckAfter?: boolean;
    }
  | {
      op: 'DEAL_DAMAGE';
      side: PlayerSide;
      amount: number;
    }
  | {
      op: 'MARK_GAME_ABILITY_USED';
      abilityKey: string;
    }
  | {
      op: 'MARK_TURN_ABILITY_USED';
      abilityKey: string;
    }
  | {
      op: 'DESTROY_ROLES';
      target: CardTargetRef;
      saveDestroyedToVar?: string;
    }
  | {
      op: 'SET_READY';
      target: CardTargetRef;
      isReady: boolean;
    }
  | {
      op: 'SET_FROZEN';
      target: CardTargetRef;
      isFrozen: boolean;
    }
  | {
      op: 'PREVENT_COMBAT_DAMAGE';
    }
  | {
      op: 'AIRBORNE';
      target: CardTargetRef;
      saveAirborneToVar?: string;
    }
  | {
      op: 'ATTACH_PARTNER';
      host: CardTargetRef;
      partner: CardTargetRef;
    }
  | {
      op: 'MODIFY_STATS';
      target: CardTargetRef;
      pp?: NumberExpr;
      dp?: NumberExpr;
      setBasePP?: NumberExpr;
      setPP?: NumberExpr;
      setDP?: NumberExpr;
      charge?: NumberExpr;
      setCharge?: NumberExpr;
      keywords?: string[];
      removeKeywords?: string[];
      addTraits?: string[];
      loseAbilities?: boolean;
      prohibitions?: ProhibitionFlag[];
      treatedAsOrbColors?: SignalOrbColor[];
      orbValue?: number;
      treatedAsNames?: string[];
      grantedTriggerIds?: string[];
      canAttackPlayerOnEnterTurn?: boolean;
      unblockableMaxPP?: number;
      duration: ModifierDuration;
      /** 覆盖来源卡号 (默认为当前能力所属卡牌编号) */
      source?: string;
    }
  | {
      op: 'ADD_COST_MODIFIER';
      amount: number;
      targetTrait?: string;
      targetName?: string;
      cardType?: CardType;
      excludeAscension?: boolean;
      remainingCount?: number;
      logText?: string;
    }
  | {
      op: 'CHANGE_EROSION';
      side?: PlayerSide;
      delta: number;
    }
  | {
      op: 'REGISTER_DELAYED_TRIGGER';
      target: CardTargetRef;
      eventType: 'END_PHASE_TRIGGERS';
      turnOffset?: number;
      abilityId: 'DELAYED_END_OF_TURN_TO_GRAVEYARD';
      /** 默认 BATTLEFIELD；放入信号球区最下方后回合结束送墓时填 SIGNAL_ORB (如 ST05-004~008) */
      expectedZone?: ZoneId;
      labelSuffix?: string;
      markLegacyEndOfTurnToGraveyard?: boolean;
    }
  | {
      op: 'IF';
      condition: ConditionExpr;
      then: EffectStep[];
      else?: EffectStep[];
    };

/**
 * 声明式【自】自动能力触发匹配器 (8.5 / 8.7)
 */
export type DeclarativeTriggerMatcher =
  | {
      kind: 'EQUIPPED_ROLE_ATTACKING';
      /** 要求装备对象为指定卡名 (如 ST02-009 要求《露娜·银冕》) */
      requiredHostName?: string;
      requiredHostTrait?: string;
    }
  | {
      kind: 'OTHER_FRIENDLY_ROLE_ENTERED';
      enteredName?: string;
      enteredTrait?: string;
    }
  | {
      kind: 'SELF_ATTACKING';
    }
  | {
      kind: 'SELF_ATTACKING_OR_BLOCKING';
    }
  | {
      kind: 'SELF_ATTACK_END';
    }
  | {
      /** 由 MODIFY_STATS.grantedTriggerIds 动态赋予：该牌攻击的充能步骤中充能满足条件卡牌时触发 (如 BP01-028) */
      kind: 'GRANTED_ATTACK_CHARGE_CARD';
      chargedCardFilter?: CardFilter;
    }
  | {
      /** 墓地中触发：我方消除信号球时触发 (如 BP01-056/056a/056b 梦赴光寥之乡) */
      kind: 'SELF_IN_GRAVEYARD_ON_SELF_ORBS_ELIMINATED';
    }
  | {
      kind: 'SELF_BLOCKED_ATTACK_END';
    }
  | {
      /** 由 MODIFY_STATS.grantedTriggerIds 动态赋予到角色身上的阻挡攻击结束触发 (如 ST04-001) */
      kind: 'GRANTED_BLOCKED_ATTACK_END';
    }
  | {
      kind: 'FRIENDLY_ROLE_BLOCKING';
      blockerTrait?: string;
      /** 默认 ROLE；EQUIPMENT 表示来源卡为已装备在角色下方的装备牌 (如 ST04-010) */
      sourceKind?: 'ROLE' | 'EQUIPMENT';
    }
  | {
      kind: 'SELF_TURN_END';
      /** true = 操控玩家的回合结束时；false = 对方回合结束时 */
      isSelfTurn: boolean;
    }
  | {
      /** 8.13 【协战自】：该牌成为协战搭档时触发 */
      kind: 'SELF_BECAME_PARTNER';
      requiredHostTrait?: string;
      requiredHostName?: string;
      onlyOpponentTurn?: boolean;
    };

export interface DeclarativeTriggerSpec {
  abilityId: string;
  eventType: TriggerEventType;
  /** 可选多事件触发 (如 BP01-029 同时监听 ATTACK_DECLARED 与 BLOCK_DECLARED) */
  eventTypes?: TriggerEventType[];
  oncePerTurn?: boolean;
  /** 可选代价未支付时不消耗【回合1】次数 (如 Q&A·2/7 BP01-023) */
  deferOncePerTurnUntilCostPaid?: boolean;
  /** 「《XXX》的该能力每回合最多发动1次」(按玩家+能力ID限制，如 ST06-008) */
  oncePerTurnByPlayer?: boolean;
  /** 「《XXX》的该能力每回合最多发动 N 次」(如 Q&A·7 BP01-056 N=2) */
  maxPerTurnByPlayer?: number;
  /** 跨异画同编号共享的按玩家每回合计数键 (如 BP01-056/056a/056b) */
  sharedTurnKey?: string;
  /** 触发与结算的前置条件 (如 10.14 晖形态有效) */
  condition?: ConditionExpr;
  matcher: DeclarativeTriggerMatcher;
  label: string;
  cost?: AbilityCost;
  steps: EffectStep[];
}

/**
 * 声明式【永】持续效果定义 (8.9，自动注册至 ContinuousEffectEngine)
 */
export interface DeclarativeStaticEffectSpec {
  id: string;
  scope: 'SELF' | 'ALL_FRIENDLY_ROLES' | 'PARTNER_HOST' | 'UNDERNEATH_HOST';
  /** scope === 'SELF' 时限制自身状态 (如 ST03-004 自身须横置) */
  selfFilter?: CardFilter;
  /** scope === 'ALL_FRIENDLY_ROLES' / 'PARTNER_HOST' / 'UNDERNEATH_HOST' 时筛选被增益的我方角色 */
  targetFilter?: CardFilter;
  condition?: ConditionExpr;
  pp?: NumberExpr;
  setPP?: NumberExpr;
  dp?: NumberExpr;
  setDP?: NumberExpr;
  charge?: NumberExpr;
  setCharge?: NumberExpr;
  keywords?: string[];
  addTraits?: string[];
  prohibitions?: ProhibitionFlag[];
  treatedAsOrbColors?: SignalOrbColor[];
  orbValue?: number;
  treatedAsNames?: string[];
  unblockableMaxPP?: number;
  /** 允许同时装备 2 张<封刃太刀>装备 (BP01-014 / BP01-016 / BP01-017) */
  canDualEquipFengren?: boolean;
  /** 是否依赖特征层 (8.9.1.d) */
  dependsOnTraits?: boolean;
}

/**
 * 单张卡牌的声明式效果完整描述 (docs/future-work.md §3)
 */
export interface CardEffectSpec {
  cardNumber: string;
  name: string;
  /** 该角色无【出】能力 (或仅含【永】/【起】/【自】)，出场时不回退到通用关键字解析 */
  vanillaEntry?: boolean;
  /** 信号球牌标记 (【充能自】由统一充能自处理器处理) */
  isSignalOrbCard?: boolean;
  /** 【永】：满足条件时无视属性条件使用 (如 ST04-008 卡穆·狂犬) */
  ignoreAttributeCondition?: ConditionExpr;
  /** 战术牌使用前置条件 (不满足则拒绝打出，8.6.2) */
  playPrecondition?: {
    condition: ConditionExpr;
    errorMessage: string;
  };
  /** 战术牌效果序列 */
  tactics?: EffectStep[];
  /** 【出】登场能力 */
  entry?: {
    cost?: AbilityCost;
    steps: EffectStep[];
  };
  /** 【起】起动能力 */
  activate?: {
    oncePerTurn?: boolean;
    /** 发动前置条件 (不满足时拒绝发动并报错，如 BP01-070 需3张<三头犬小队>、帕瓦需自身竖直) */
    condition?: ConditionExpr;
    conditionError?: string;
    cost?: AbilityCost;
    steps: EffectStep[];
  };
  /** 【自】自动能力列表 */
  triggers?: DeclarativeTriggerSpec[];
  /** 【永】持续效果列表 */
  staticEffects?: DeclarativeStaticEffectSpec[];
  /** 【永】该角色在场时对我方手牌使用的费用修正 (如 BP01-077 首张《荣光护盾》变1费、BP01-015 首张装备-1费) */
  fieldCardCostRule?: {
    targetName?: string;
    cardType?: CardType;
    firstPerTurnOnly?: boolean;
    setCost?: number;
    discount?: number;
  };
  /** 装备在符合条件的角色下方时，赋予该角色的【起】动能力 (如 BP01-022 夜煌—小太刀，Q&A·2 按装备实例+宿主各自计次) */
  equipmentGrantedActivate?: {
    requiredHostName?: string;
    requiredHostTrait?: string;
    label: string;
    activate: NonNullable<CardEffectSpec['activate']>;
  };
  /** 使用该牌时可丢弃手牌中满足条件的任意张牌来减费 (如 BP01-067 最后的晚空) */
  playDiscardDiscount?: {
    filter: CardFilter;
    discountPerCard: number;
    prompt?: string;
  };
  /** 【永】手牌静态费用减免 (8.6.2.c，如 ST03-011 按角色计数减费、ST05-009 晖形态固定减费、BP01-059 墓地计数减费) */
  handCostDiscount?:
    | {
        filter: CardFilter;
        discountPerRole: number;
      }
    | {
        condition: ConditionExpr;
        flatDiscount: number;
      }
    | {
        zone: ZoneId;
        filter: CardFilter;
        discountPerCard: number;
      };
}
