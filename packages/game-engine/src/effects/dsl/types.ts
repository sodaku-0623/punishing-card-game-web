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
export type ModifierDuration = 'END_OF_TURN' | 'END_OF_NEXT_TURN' | 'UNTIL_LEAVE_ZONE';
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
  exactName?: string;
  maxCost?: number;
  minCost?: number;
  exactCost?: number;
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
  excludeSelf?: boolean;
}

/**
 * 声明式数值表达式 (支持字面量与实时派生数值，如侵蚀计数倍率)
 */
export type NumberExpr =
  | number
  | { kind: 'EROSION_MULT'; side: PlayerSide; multiplier: number }
  | { kind: 'ROLE_COUNT_MULT'; side: PlayerSide; filter?: CardFilter; multiplier: number }
  | { kind: 'UNDERNEATH_COUNT_MULT'; multiplier: number };

/**
 * 声明式条件表达式 (支持前置条件、静态持续效果条件、「若如此做」等分支判定)
 */
export type ConditionExpr =
  | { kind: 'HAS_ROLE'; side: PlayerSide; filter?: CardFilter; minCount?: number }
  | { kind: 'EROSION_COMPARE'; side: PlayerSide; op: CompareOp; value: number }
  | { kind: 'OPEN_COST_COMPARE_OPPONENT'; op: CompareOp }
  | { kind: 'SIGNAL_ORB_BOTTOM_COST_PARITY'; parity: 'ODD' | 'EVEN' }
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
  | { kind: 'TRIGGER_ATTACKER' }
  | { kind: 'TRIGGER_HOST' };

/**
 * 8.4 能力代价描述 (在效果主体执行之前支付；optional=true 时可选择不支付并中止能力)
 */
export type AbilityCost =
  | {
      kind: 'DISCARD_HAND';
      count: number;
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
      prompt?: string;
      choiceEffectType?: string;
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
      side: PlayerSide;
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
      zone: 'HAND' | 'GRAVEYARD' | 'SIGNAL_ORB' | 'COST';
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
        | 'BATTLEFIELD';
      isFaceUp?: boolean;
      /** 仅 toZone === 'BATTLEFIELD' 时有效：是否以横置状态出场 (如 ST05-002) */
      enterTapped?: boolean;
      /** 仅 toZone === 'BATTLEFIELD' 时有效：是否自动触发被出场角色的【出】能力 */
      triggerEntry?: boolean;
      /** 保存实际完成移动/出场的卡牌 ID (供后续 8.6.4「若如此做」判定) */
      saveMovedToVar?: string;
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
  oncePerTurn?: boolean;
  /** 「《XXX》的该能力每回合最多发动1次」(按玩家+能力ID限制，如 ST06-008) */
  oncePerTurnByPlayer?: boolean;
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
  scope: 'SELF' | 'ALL_FRIENDLY_ROLES' | 'PARTNER_HOST';
  /** scope === 'SELF' 时限制自身状态 (如 ST03-004 自身须横置) */
  selfFilter?: CardFilter;
  /** scope === 'ALL_FRIENDLY_ROLES' 或 'PARTNER_HOST' 时筛选被增益的我方角色 */
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
    cost?: AbilityCost;
    steps: EffectStep[];
  };
  /** 【自】自动能力列表 */
  triggers?: DeclarativeTriggerSpec[];
  /** 【永】持续效果列表 */
  staticEffects?: DeclarativeStaticEffectSpec[];
  /** 【永】手牌静态费用减免 (8.6.2.c，如 ST03-011 按角色计数减费、ST05-009 晖形态固定减费) */
  handCostDiscount?:
    | {
        filter: CardFilter;
        discountPerRole: number;
      }
    | {
        condition: ConditionExpr;
        flatDiscount: number;
      };
}
