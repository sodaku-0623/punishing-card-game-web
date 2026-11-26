import type {
  CardType,
  ElementAttribute,
  ProhibitionFlag,
  ReplacementEventType,
  SignalOrbColor,
  TriggerEventType,
  ZoneId,
} from '@zhanshuang/shared';

export type PlayerSide = 'SELF' | 'OPPONENT';
export type OrbColorFilter = 'ANY' | 'SAME' | 'RED' | 'BLUE' | 'YELLOW';
export type ModifierDuration = 'END_OF_TURN' | 'END_OF_NEXT_TURN' | 'END_OF_COMBAT' | 'UNTIL_LEAVE_ZONE';
export type CompareOp = '>=' | '<=' | '==' | '>' | '<';

export type UsableActivationZone =
  | 'BATTLEFIELD'
  | 'HAND'
  | 'GRAVEYARD'
  | 'SIGNAL_ORB'
  | 'COST'
  | 'UNDERNEATH';

export type CustomHandlerId =
  | 'BP02_048_WANSHIMING_SACRIFICE'
  | 'BP03_056_COPY_GY_ENTRY'
  | 'BP03_057_LILITH_CHALLENGE'
  | 'BP03_058_ASCENDING_COST_5'
  | 'BP03_059_BLACKJACK_21'
  | 'BP03_061_GUESS_PARITY'
  | 'BP03_063_CLASH_TOP'
  | 'BP03_064_SIMULTANEOUS_REVEAL_ORB';

/**
 * 卡牌筛选条件 (供选择、群体效果、持续能力与前置条件复用)
 */
export interface CardFilter {
  cardType?: CardType;
  attribute?: ElementAttribute;
  /** 排除指定属性 (如「不为空属性」「不为火属性」) */
  excludeAttribute?: ElementAttribute;
  trait?: string;
  /** 排除拥有指定特征的卡牌 (如 PR-035「不为<升格者>的角色」) */
  excludeTrait?: string;
  /** 满足列表中任意一个特征即匹配 */
  anyTraits?: string[];
  /** 满足列表中任意一个子过滤条件即匹配 (如 BP01-046《帕瓦》或<机械教会>角色) */
  anyFilters?: CardFilter[];
  exactName?: string;
  /** 排除指定卡名 (如 PR-039「《加百列》以外」) */
  excludeName?: string;
  /** 指定匹配的卡号集合 */
  cardNumbers?: string[];
  maxCost?: number;
  minCost?: number;
  exactCost?: number;
  /** true 时要求卡牌费用 <= 操控玩家的明费上限 (如 BP01-073 / BP02-001) */
  maxCostOpenCostLimit?: boolean;
  /** 基本 DP 上限 (如 BP01-051 要求基本 DP<=1 的《七实·遥星之座》) */
  maxBaseDP?: number;
  /** true 时要求为升变角色 (如 BP01-054 / BP01-055 / BP02-001) */
  isAscended?: boolean;
  maxEffectivePP?: number;
  minEffectivePP?: number;
  /** true 时要求目标有效 PP <= 来源角色 (self) 的当前有效 PP (如 BP04-023) */
  maxEffectivePPSourceSelf?: boolean;
  isSignalOrb?: boolean;
  signalOrbColor?: SignalOrbColor;
  /** true = 仅正面/明牌，false = 仅背面/暗牌 */
  isFaceUp?: boolean;
  /** true = 仅竖直，false = 仅横置 */
  isReady?: boolean;
  /** true = 仅冰冻状态，false = 仅非冰冻状态 */
  isFrozen?: boolean;
  /** 仅匹配可进行协战的角色牌 (即卡表具备 assistConfig，如 PR-044) */
  hasAssistConfig?: boolean;
  /** true = 仅匹配当前附着了装备牌的角色，false = 未附着装备的角色 */
  hasEquipment?: boolean;
  /** true = 仅处于协战状态的角色，false = 仅非协战状态 */
  hasPartner?: boolean;
  /** 角色下方至少存在 N 张卡牌 */
  minUnderneathCount?: number;
  /** 角色下方或附着装备中存在满足子筛选的卡牌 (如 BP04-077~079 判断下方/装备《飞叶点翠》) */
  hasUnderneathOrEquipMatching?: CardFilter;
  /** true = 仅浮空模式 (处理区浮空卡)，false = 非浮空模式 */
  isAirborne?: boolean;
  /** true = 仅正在进行本次攻击的角色，false = 非攻击中角色 */
  isAttacking?: boolean;
  /** true = 仅本次攻击中被选为目标的角色，false = 非被攻击目标角色 */
  isBeingAttacked?: boolean;
  /** true = 仅当前处于本次攻击战斗中 (攻击或被攻击) 的角色，false = 非战斗中角色 */
  isInCombat?: boolean;
  /** true = 仅升变出场的卡牌，false = 非升变出场的卡牌 */
  wasAscendedPlay?: boolean;
  /** 限制卡牌进入当前区域前的来源区域 */
  enteredFromZones?: ZoneId[];
  /** true = 仅以浮空模式角色为对象升变出场的角色 */
  ascendedFromAirborne?: boolean;
  /** 限制卡牌当前所在区域 (如 Q&A·7 BP01-056 结算时确认仍在墓地) */
  inZone?: ZoneId;
  excludeSelf?: boolean;
}

/**
 * 声明式数值表达式 (支持字面量、实时派生数值与基本算术组合)
 */
export type NumberExpr =
  | number
  | { kind: 'EROSION_MULT'; side: PlayerSide; multiplier: number }
  | { kind: 'ROLE_COUNT_MULT'; side: PlayerSide; filter?: CardFilter; multiplier: number }
  | { kind: 'UNDERNEATH_COUNT_MULT'; multiplier: number; uniqueNames?: boolean; uniqueCardNumbers?: boolean; filter?: CardFilter }
  | { kind: 'SUM_UNDERNEATH_COUNT'; side: PlayerSide; roleFilter?: CardFilter; filter?: CardFilter; uniqueNames?: boolean; uniqueCardNumbers?: boolean; multiplier?: number }
  | { kind: 'ORB_ZONE_COUNT_MULT'; side: PlayerSide; filter?: CardFilter; multiplier: number }
  | { kind: 'ZONE_COUNT_MULT'; side: PlayerSide; zone: ZoneId; filter?: CardFilter; uniqueNames?: boolean; uniqueCardNumbers?: boolean; multiplier: number }
  | { kind: 'VAR_COUNT_MULT'; varName: string; multiplier: number }
  | { kind: 'VAR_DISTINCT_COST_MULT'; varName: string; multiplier: number }
  | { kind: 'FLOOR_DIV'; expr: NumberExpr; divisor: number }
  | { kind: 'ADD'; left: NumberExpr; right: NumberExpr };

/**
 * 声明式条件表达式 (支持前置条件、静态持续效果条件、「若如此做」等分支判定)
 */
export type ConditionExpr =
  | { kind: 'HAS_ROLE'; side: PlayerSide; filter?: CardFilter; minCount?: number }
  | { kind: 'EROSION_COMPARE'; side: PlayerSide; op: CompareOp; value: number }
  | { kind: 'EROSION_CHANGED_THIS_TURN'; side: PlayerSide }
  | { kind: 'OPEN_COST_COMPARE_OPPONENT'; op: CompareOp }
  | { kind: 'FRIENDLY_ROLE_COUNT_COMPARE_OPPONENT'; op: CompareOp }
  | { kind: 'SIGNAL_ORB_BOTTOM_COST_PARITY'; parity: 'ODD' | 'EVEN' }
  | { kind: 'SELF_UNDERNEATH_COUNT'; op: CompareOp; value: number; filter?: CardFilter }
  | { kind: 'TOTAL_UNDERNEATH_COUNT'; side: PlayerSide; roleFilter?: CardFilter; filter?: CardFilter; op: CompareOp; value: number }
  | { kind: 'ANY_HOST_UNDERNEATH_CONTAINS'; side: PlayerSide; roleFilter?: CardFilter; cardFilter: CardFilter }
  | { kind: 'SELF_MATCHES_FILTER'; filter: CardFilter }
  | { kind: 'GAME_ABILITY_UNUSED'; abilityKey: string }
  | { kind: 'TURN_ABILITY_UNUSED'; abilityKey: string }
  | { kind: 'ZONE_COUNT'; side: PlayerSide; zone: ZoneId; filter?: CardFilter; op: CompareOp; value: number }
  | { kind: 'ALL_ZONE_CARDS_MATCH'; side: PlayerSide; zone: ZoneId; preFilter?: CardFilter; matchFilter: CardFilter }
  | { kind: 'ALL_ROLES_MATCH'; side: PlayerSide; filter: CardFilter; requireAtLeastOne?: boolean }
  | { kind: 'ROLE_ATTRIBUTE_DIVERSITY'; side: PlayerSide; filter?: CardFilter; minDistinct: number }
  | { kind: 'HAS_EMPTY_SLOT'; side: PlayerSide }
  | { kind: 'TURN_OWNER'; isSelfTurn: boolean }
  | { kind: 'CURRENT_COMBAT_EXISTS' }
  | { kind: 'IS_ENTER_TURN' }
  | { kind: 'IS_DEPLOYED_FROM_PROCESSING_TURN' }
  | { kind: 'CARD_WAS_ASCENDED_PLAY' }
  | { kind: 'CARD_WAS_ASCENDED_FROM_AIRBORNE' }
  | { kind: 'CARD_ENTERED_FROM_ZONE'; zones: ZoneId[] }
  | { kind: 'CARD_PAID_HIDDEN_COST_ON_PLAY' }
  | { kind: 'COMBAT_CHARGED_AUTO' }
  | { kind: 'CHARGED_AUTO_BY_LEE_THIS_TURN' }
  | { kind: 'DESTROYED_FRIENDLY_ROLES_THIS_TURN'; op: CompareOp; value: number }
  | { kind: 'ELIMINATED_THREE_ORBS_THIS_TURN'; side: PlayerSide }
  | { kind: 'ELIMINATED_ORBS_BY_KARENINA_THIS_TURN'; op: CompareOp; value: number }
  | { kind: 'DAMAGE_TAKEN_THIS_TURN'; side: PlayerSide; op: CompareOp; value: number }
  | { kind: 'CARDS_PLAYED_THIS_TURN'; side: PlayerSide; op: CompareOp; value: number }
  | { kind: 'ART_ASSOC_TACTICS_PLAYED_THIS_TURN'; side: PlayerSide; op: CompareOp; value: number }
  | { kind: 'VAR_NON_EMPTY'; varName: string }
  | { kind: 'VAR_COUNT_COMPARE'; varName: string; op: CompareOp; value: number }
  | { kind: 'VAR_HAS_CARD_MATCHING'; varName: string; filter: CardFilter }
  | { kind: 'VAR_HAS_DUPLICATE_COST'; varName: string }
  | { kind: 'HAS_ELIMINABLE_ORBS'; filter: OrbColorFilter; count: number }
  | { kind: 'IS_STANDALONE_EQUIPMENT' }
  | { kind: 'PARTNER_FROM_ZONE'; zones: ZoneId[] }
  | { kind: 'ALL'; conditions: ConditionExpr[] }
  | { kind: 'ANY'; conditions: ConditionExpr[] }
  | { kind: 'NOT'; condition: ConditionExpr };

/**
 * 效果作用目标引用 (纯 JSON 可序列化)
 */
export type CardTargetRef =
  | { kind: 'SELF' }
  | { kind: 'SELF_UNDERNEATH'; filter?: CardFilter }
  | { kind: 'SELF_PARTNER' }
  | { kind: 'EQUIPPED_HOST'; filter?: CardFilter }
  | { kind: 'ZONE_BOTTOM_CARD'; side: PlayerSide; zone: ZoneId }
  | {
      kind: 'ZONE_SLICE';
      side: PlayerSide;
      zone: 'DECK' | 'SIGNAL_ORB' | 'GRAVEYARD' | 'PROCESSING';
      edge: 'TOP' | 'BOTTOM';
      count: number;
      filter?: CardFilter;
    }
  | { kind: 'VAR'; varName: string }
  | { kind: 'REST_OF_VAR'; allVar: string; excludeVar: string }
  | { kind: 'ALL_MATCHING_ROLES'; side: PlayerSide | 'ANY'; filter?: CardFilter }
  | {
      kind: 'ZONE_CARDS';
      side: PlayerSide;
      zone: 'SIGNAL_ORB' | 'BATTLEFIELD' | 'GRAVEYARD' | 'HAND' | 'COST' | 'PROCESSING';
      filter?: CardFilter;
    }
  | { kind: 'HOST_UNDERNEATH_MATCHING'; side: PlayerSide; roleFilter?: CardFilter; cardFilter?: CardFilter }
  | { kind: 'TRIGGER_ATTACKER' }
  | { kind: 'TRIGGER_BLOCKER' }
  | { kind: 'TRIGGER_HOST' }
  | { kind: 'TRIGGER_TARGET' };

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
      kind: 'SELF_TO_GRAVEYARD';
      sentByEffectOrCost?: boolean;
    }
  | {
      kind: 'SELF_AIRBORNE';
    }
  | {
      kind: 'DISCARD_SELF_FROM_HAND';
    }
  | {
      kind: 'DEAL_SELF_DAMAGE';
      amount: number;
    }
  | {
      kind: 'PAY_COST';
      amount: number;
    }
  | {
      kind: 'COMPOSITE';
      costs: AbilityCost[];
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
      op: 'PEEK_TOP';
      side?: PlayerSide;
      count: number;
      saveToVar: string;
    }
  | {
      op: 'PEEK_ZONE';
      side?: PlayerSide;
      zone: 'SIGNAL_ORB' | 'COST';
      filter?: CardFilter;
      saveToVar: string;
    }
  | {
      op: 'DISCARD_OPPONENT_RANDOM_HAND';
      count: number;
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
      uniqueNames?: boolean;
      uniqueCardNumbers?: boolean;
      distinctAttributes?: boolean;
      maxTotalCost?: number;
      saveToVar: string;
      choiceEffectType?: string;
    }
  | {
      op: 'CHOOSE_ZONE_CARDS';
      side: PlayerSide;
      zone:
        | 'HAND'
        | 'GRAVEYARD'
        | 'SIGNAL_ORB'
        | 'COST'
        | 'DECK'
        | 'BATTLEFIELD'
        | 'PROCESSING'
        | 'HOST_UNDERNEATH'
        | 'SELF_UNDERNEATH'
        | 'OPPONENT_HAND_BLIND';
      /** 可选多区域联合选择 (如 BP01-028 墓地+费用区合计最多6张<万世铭>) */
      zones?: (
        | 'HAND'
        | 'GRAVEYARD'
        | 'SIGNAL_ORB'
        | 'COST'
        | 'DECK'
        | 'BATTLEFIELD'
        | 'PROCESSING'
        | 'HOST_UNDERNEATH'
        | 'SELF_UNDERNEATH'
      )[];
      /** zone 为 HOST_UNDERNEATH 时筛选宿主角色 (如《露娜·终焉》) */
      hostFilter?: CardFilter;
      /** zone 为 BATTLEFIELD 时：true 仅匹配卡位顶层卡牌 (不含附着装备与下方牌) */
      topLevelOnly?: boolean;
      prompt: string;
      filter?: CardFilter;
      requireEmptySlot?: boolean;
      ineligibleReason?: string;
      min?: number;
      max?: number;
      dynamicMin?: NumberExpr;
      dynamicMax?: NumberExpr;
      uniqueNames?: boolean;
      uniqueCardNumbers?: boolean;
      distinctAttributes?: boolean;
      maxTotalCost?: number;
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
      uniqueNames?: boolean;
      uniqueCardNumbers?: boolean;
      distinctAttributes?: boolean;
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
      /** 动态计算需要选择的不可重复模式数量 (如 BP01-028 每2张选1项、BP04-002 每4张+1) */
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
      /** true 时不计入「因《卡列尼娜·辉晓》能力消除信号球」计数 (BP04-040) */
      excludeFromAbilityOrbCount?: boolean;
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
      op: 'PAY_COST_STEP';
      amount: NumberExpr;
      optional?: boolean;
      prompt?: string;
      choiceEffectType?: string;
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
      /** 仅 toZone === 'UNDERNEATH' 时：true 表示连同目标原本下方的所有牌一并转移到新宿主下方 (PR-041) */
      includeUnderneath?: boolean;
      isFaceUp?: boolean;
      /** 移动到费用区等区域时的竖直/横置状态 (如 BP01-029 竖直放费用区、BP01-039 横置放对方费用区) */
      isReady?: boolean;
      /** 仅 toZone === 'BATTLEFIELD' 时有效：是否以横置状态出场 (如 ST05-002) */
      enterTapped?: boolean;
      /** 仅 toZone === 'BATTLEFIELD' 时有效：效果无效出场 (如 BP02-001 / PR-020) */
      loseAbilities?: boolean;
      /** 仅 toZone === 'BATTLEFIELD' 时有效：是否自动触发被出场角色的【出】能力 */
      triggerEntry?: boolean;
      /** 仅 toZone === 'GRAVEYARD' 时：是否标记为因效果/代价从战场送墓 (触发 BP02-010 等) */
      sentByEffectOrCost?: boolean;
      /** 保存实际完成移动/出场的卡牌 ID (供后续 8.6.4「若如此做」判定) */
      saveMovedToVar?: string;
      /** true 且待移动目标 >= 2 张时，由操作玩家选择入区排列顺序 */
      chooseOrder?: boolean;
      orderPrompt?: string;
      orderChoiceEffectType?: string;
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
      op: 'SET_COMBAT_MAX_DAMAGE';
      maxDamage: number;
    }
  | {
      op: 'REDIRECT_ATTACK';
      targetType: 'PLAYER';
    }
  | {
      op: 'REDIRECT_ATTACK';
      targetType: 'CHARACTER';
      target: CardTargetRef;
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
      releaseToDeckBottom?: boolean;
    }
  | {
      op: 'DETACH_AND_MOVE_PARTNER';
      host: CardTargetRef;
      toZone: 'HAND' | 'BATTLEFIELD' | 'GRAVEYARD' | 'DECK_BOTTOM';
      triggerEntry?: boolean;
    }
  | {
      op: 'COPY_STATS_FROM_VAR';
      target: CardTargetRef;
      fromVar: string;
      copyBasePP?: boolean;
      copyBaseDP?: boolean;
      duration: ModifierDuration;
    }
  | {
      op: 'INCREMENT_CARDS_PLAYED_THIS_TURN';
      amount?: number;
    }
  | {
      op: 'REGISTER_REPLACEMENT';
      eventType: 'DESTROY_ROLE' | 'MOVE_CARD' | 'DEAL_DAMAGE';
      target?: CardTargetRef;
      targetSide?: PlayerSide;
      destroyReason?: 'BATTLE' | 'EFFECT' | 'PP_ZERO';
      fromZone?: ZoneId;
      toZone?: ZoneId;
      label?: string;
      action:
        | { kind: 'PREVENT' }
        | { kind: 'REDIRECT_ZONE'; zone: ZoneId; isFaceUp?: boolean; isReady?: boolean; toBottom?: boolean }
        | { kind: 'MODIFY_DAMAGE'; delta?: number; setAmount?: number; maxAmount?: number };
      duration: ModifierDuration;
      once?: boolean;
    }
  | {
      op: 'MODIFY_STATS';
      target: CardTargetRef;
      pp?: NumberExpr;
      dp?: NumberExpr;
      setBasePP?: NumberExpr;
      setBaseDP?: NumberExpr;
      setPP?: NumberExpr;
      setDP?: NumberExpr;
      charge?: NumberExpr;
      chargeIsAbility?: boolean;
      setCharge?: NumberExpr;
      keywords?: string[];
      removeKeywords?: string[];
      addTraits?: string[];
      clearBaseTraits?: boolean;
      setCardType?: CardType;
      costDelta?: NumberExpr;
      setCost?: NumberExpr;
      canAttackReadyRolesMaxCost?: number;
      mustBeAttackTarget?: boolean;
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
      amount: NumberExpr;
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
      eventType: 'END_PHASE_TRIGGERS' | 'ATTACK_ENDED';
      turnOffset?: number;
      abilityId:
        | 'DELAYED_END_OF_TURN_TO_GRAVEYARD'
        | 'DELAYED_END_OF_TURN_TO_DECK_BOTTOM'
        | 'DELAYED_END_OF_TURN_UNTAP'
        | 'DELAYED_END_OF_TURN_DRAW'
        | 'DELAYED_ATTACK_END_TO_SIGNAL_ORB_BOTTOM'
        | 'DELAYED_ATTACK_END_DEPLOY_PARTNER';
      /** 默认 BATTLEFIELD；放入信号球区最下方后回合结束送墓时填 SIGNAL_ORB */
      expectedZone?: ZoneId;
      /** 仅 DELAYED_ATTACK_END_DEPLOY_PARTNER：若协战搭档来自该区域 (如 GRAVEYARD)，出场时赋予【速攻】 */
      grantRushIfPartnerFromZone?: ZoneId;
      drawCount?: number;
      targetSide?: PlayerSide;
      labelSuffix?: string;
      markLegacyEndOfTurnToGraveyard?: boolean;
    }
  | {
      op: 'IF';
      condition: ConditionExpr;
      then: EffectStep[];
      else?: EffectStep[];
    }
  | {
      op: 'CUSTOM_HANDLER';
      handlerId: CustomHandlerId;
      params?: Record<string, unknown>;
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
      /** true 表示该【自】为装备牌自身持有而非赋予宿主角色 (如 ST05-008) */
      ownedByEquipment?: boolean;
    }
  | {
      kind: 'OTHER_FRIENDLY_ROLE_ENTERED';
      enteredName?: string;
      enteredTrait?: string;
      enteredFilter?: CardFilter;
      includeSelf?: boolean;
    }
  | {
      kind: 'SELF_IN_SIGNAL_ORB_ON_FRIENDLY_ROLE_ENTERED';
      enteredFilter?: CardFilter;
    }
  | {
      kind: 'SELF_IN_UNDERNEATH_ON_FRIENDLY_DEPLOY_FROM_UNDERNEATH';
      hostName?: string;
    }
  | {
      kind: 'ANY_CARD_SENT_FIELD_TO_GY_BY_EFFECT';
      side: PlayerSide;
      filter?: CardFilter;
      includeSelf?: boolean;
    }
  | {
      kind: 'SELF_MOVED_DECK_TO_GY';
    }
  | {
      kind: 'FRIENDLY_CARD_MOVED_DECK_TO_GY';
      filter?: CardFilter;
    }
  | {
      kind: 'FRIENDLY_CARD_MOVED_GY_TO_DECK_BOTTOM';
      filter?: CardFilter;
    }
  | {
      kind: 'SELF_TAPPED';
    }
  | {
      kind: 'SELF_DESTROYED';
      destroyReason?: 'BATTLE' | 'EFFECT' | 'ANY';
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
      kind: 'SELF_DEALT_PLAYER_DAMAGE';
    }
  | {
      kind: 'SELF_EQUIPPED';
    }
  | {
      kind: 'PARTNER_HOST_ATTACKING';
      requiredHostName?: string;
      requiredHostTrait?: string;
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
      kind: 'SELF_ORBS_ELIMINATED';
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
      fromZones?: ZoneId[];
    }
  | {
      /** 8.13 该牌通过协战获得搭档时触发 (搭配 PARTNER_GAINED) */
      kind: 'SELF_GAINED_PARTNER';
      requiredPartnerTrait?: string;
      requiredPartnerName?: string;
      fromZones?: ZoneId[];
    }
  | {
      /** 该牌离开战场时触发 (搭配 CARD_LEFT_FIELD，支持检查离场前是否装备特定特征装备) */
      kind: 'SELF_LEFT_FIELD';
      requiredEquipTrait?: string;
    }
  | {
      /** 由静态效果 grantedTriggerIds 赋予到角色身上的离场【自】触发 (如 PR-015 位于《七实·遥星之座》下方) */
      kind: 'GRANTED_SELF_LEFT_FIELD';
    }
  | {
      /** 我方玩家受到伤害时触发 (搭配 DAMAGE_DEALT，如 BP04-015 薇拉·灼惘) */
      kind: 'SELF_PLAYER_DAMAGED';
      onlySelfTurn?: boolean;
    }
  | {
      /** 墓地中触发：我方满足条件的角色被攻击时 (搭配 ATTACK_DECLARED，如 BP04-047 塞西莉) */
      kind: 'SELF_IN_GRAVEYARD_ON_FRIENDLY_ROLE_ATTACKED';
      targetFilter?: CardFilter;
    };

export interface DeclarativeTriggerSpec {
  abilityId: string;
  eventType: TriggerEventType;
  /** 可选多事件触发 (如 BP01-029 同时监听 ATTACK_DECLARED 与 BLOCK_DECLARED) */
  eventTypes?: TriggerEventType[];
  oncePerTurn?: boolean;
  /** 10.1 【回合N】限制 (按卡牌实例计数，如 BP04-015 【回合2】) */
  maxPerTurn?: number;
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
  scope: 'SELF' | 'ALL_FRIENDLY_ROLES' | 'PARTNER_HOST' | 'UNDERNEATH_HOST' | 'EQUIPPED_HOST';
  /** 允许来源卡生效的非战场区域 (如 ['SIGNAL_ORB']、['GRAVEYARD']、全区域等) */
  sourceZones?: ZoneId[];
  /** scope === 'SELF' 时限制自身状态 (如 ST03-004 自身须横置) */
  selfFilter?: CardFilter;
  /** scope !== 'SELF' 时筛选被增益的我方目标角色 */
  targetFilter?: CardFilter;
  condition?: ConditionExpr;
  pp?: NumberExpr;
  setPP?: NumberExpr;
  dp?: NumberExpr;
  setDP?: NumberExpr;
  setBaseDP?: NumberExpr;
  /** 增量修改基本 DP (如 BP01-051 帕瓦对下方宿主的基本 DP+1) */
  baseDPDelta?: number;
  /** 仅当当前已结算基本 DP <= maxCurrentBaseDP 时才叠加 baseDPDelta (如 BP01-051 基本DP为1及以下) */
  maxCurrentBaseDP?: number;
  charge?: NumberExpr;
  /** true 表示以「获得【充能+X】能力」形式赋予 (Q&A·1 BP01-050：宿主失去能力时该【充能+1】一并失去) */
  chargeIsAbility?: boolean;
  setCharge?: NumberExpr;
  keywords?: string[];
  addTraits?: string[];
  clearBaseTraits?: boolean;
  setCardType?: CardType;
  costDelta?: NumberExpr;
  setCost?: NumberExpr;
  canAttackReadyRolesMaxCost?: number;
  mustBeAttackTarget?: boolean;
  prohibitions?: ProhibitionFlag[];
  treatedAsOrbColors?: SignalOrbColor[];
  orbValue?: number;
  treatedAsNames?: string[];
  unblockableMaxPP?: number;
  /** 静态赋予宿主的【自】能力 ID 列表 (如 PR-015 存在于《七实·遥星之座》下方时赋予离场【自】) */
  grantedTriggerIds?: string[];
  /** 允许同时装备 2 张<封刃太刀>装备 (BP01-014 / BP01-016 / BP01-017) */
  canDualEquipFengren?: boolean;
  /** 是否依赖特征层 (8.9.1.d) */
  dependsOnTraits?: boolean;
}

export interface DeclarativeActivateSpec {
  id?: string;
  label?: string;
  oncePerTurn?: boolean;
  oncePerTurnByPlayer?: boolean;
  sharedTurnKey?: string;
  usableZones?: UsableActivationZone[];
  /** 发动前置条件 (不满足时拒绝发动并报错，如 BP01-070 需3张<三头犬小队>、帕瓦需自身竖直) */
  condition?: ConditionExpr;
  conditionError?: string;
  cost?: AbilityCost;
  steps: EffectStep[];
}

export interface DeclarativeEntrySpec {
  id?: string;
  label?: string;
  cost?: AbilityCost;
  steps: EffectStep[];
}

/**
 * 8.10 声明式置换效果代价描述
 */
export type DeclarativeReplacementCost =
  | {
      kind: 'SEND_ZONE_CARD_TO_GY';
      zone: 'HAND' | 'BATTLEFIELD' | 'SIGNAL_ORB' | 'COST';
      filter: CardFilter;
      count: number;
      excludeEventCard?: boolean;
      selfOnly?: boolean;
      sentByEffectOrCost?: boolean;
    }
  | {
      kind: 'SEND_SELF_ATTACHED_EQUIPS_TO_GY';
      requiredTraits: string[];
    };

/**
 * 8.10 声明式卡牌级置换效果规则描述 (自动注册至 ReplacementEngine)
 */
export interface DeclarativeReplacementSpec {
  id: string;
  label: string;
  eventTypes: ReplacementEventType[];
  sourceZones?: ZoneId[];
  subjectScope: 'SELF' | 'FRIENDLY_CARD';
  eventCardFilter?: CardFilter;
  destroyReason?: 'BATTLE' | 'EFFECT' | 'PP_ZERO';
  fromZone?: ZoneId;
  toZone?: ZoneId;
  onlyLeaveBattlefield?: boolean;
  isOrphanCleanup?: boolean;
  orphanHostName?: string;
  oncePerTurn?: boolean;
  optional?: boolean;
  confirmPrompt?: string;
  choiceEffectType?: string;
  replaceOptionLabel?: string;
  declineOptionLabel?: string;
  cost?: DeclarativeReplacementCost;
  action:
    | { kind: 'PREVENT' }
    | { kind: 'REDIRECT_ZONE'; zone: ZoneId; isFaceUp?: boolean; isReady?: boolean; toBottom?: boolean }
    | { kind: 'MODIFY_DAMAGE'; delta?: number; setAmount?: number; maxAmount?: number };
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
  /** 【永】：满足条件时无视属性条件使用 (如 ST04-008 卡穆·狂犬 / BP04-059 神寂启示录) */
  ignoreAttributeCondition?: ConditionExpr;
  /** 【永】：该牌在指定区域时，使我方满足条件的其它卡牌无视属性条件使用 (BP02-009 / BP04-059) */
  fieldIgnoreAttributeRule?: {
    zones: ('BATTLEFIELD' | 'COST')[];
    onlyAscensionRoles?: boolean;
    targetTrait?: string;
  };
  /** 允许从非手牌区域使用该牌 (如 BP02-026 墓地升变、BP02-036 墓地战术、BP04-011 露娜·终焉下方) */
  playFromZones?: ('HAND' | 'GRAVEYARD' | 'UNDERNEATH')[];
  /** 【永】：该【瞬时】在主要阶段也可以发动 (BP02-036 潮涌球) */
  allowInstantInMainPhase?: boolean;
  /** 【永】：每位玩家每回合最多使用 N 张同名卡牌 (PR-014 银晕辉光 N=1) */
  maxPlaysPerTurnByName?: number;
  /** 战术牌使用前置条件 (不满足则拒绝打出，8.6.2) */
  playPrecondition?: {
    condition: ConditionExpr;
    errorMessage: string;
  };
  /** 战术牌效果序列 */
  tactics?: EffectStep[];
  /** 【出】登场能力 */
  entry?: DeclarativeEntrySpec;
  /** 多个独立【出】登场能力 (供 BP03-056 复制墓地 1 个【出】等情况区分) */
  entries?: DeclarativeEntrySpec[];
  /** 【起】起动能力 (单个) */
  activate?: DeclarativeActivateSpec;
  /** 多个独立【起】起动能力 (如 BP04-077/078/079、BP04-053/054) */
  activates?: DeclarativeActivateSpec[];
  /** 顶层允许发动起动能力的区域 (未配置时默认 BATTLEFIELD) */
  usableZones?: UsableActivationZone[];
  /** 【自】自动能力列表 */
  triggers?: DeclarativeTriggerSpec[];
  /** 【永】持续效果列表 */
  staticEffects?: DeclarativeStaticEffectSpec[];
  /** 8.10 声明式置换效果列表 */
  replacements?: DeclarativeReplacementSpec[];
  /** 【永】该角色在场时对我方手牌使用的费用修正 (如 BP01-077 首张《荣光护盾》变1费、BP01-015 首张装备-1费、BP03-073 首张<艺术协会>战术牌-1费) */
  fieldCardCostRule?: {
    targetName?: string;
    targetTrait?: string;
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
    activate: DeclarativeActivateSpec;
  };
  /** 使用该牌时可将手牌或信号球区中满足条件的任意张牌置入墓地来减费 (如 BP01-067 最后的晚空 / BP03-075 露西亚·深红之渊) */
  playDiscardDiscount?: {
    sourceZone?: 'HAND' | 'SIGNAL_ORB';
    signalOrbColor?: SignalOrbColor;
    filter: CardFilter;
    discountPerCard: number;
    prompt?: string;
  };
  /** 使用该牌时可将战场或手牌 1 张指定卡牌放置到墓地以覆写/减费 (BP02-012 / BP04-060) */
  playSacrificeDiscount?: {
    zones: ('HAND' | 'BATTLEFIELD')[];
    filter: CardFilter;
    setCost?: number;
    discount?: number;
    prompt?: string;
  };
  /** 【永】手牌静态费用减免 (8.6.2.c，如 ST03-011 / BP02-013 / BP03-026 / BP03-036 / BP04-066 / BP04-072) */
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
