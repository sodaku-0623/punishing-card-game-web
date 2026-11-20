/**
 * 《战双帕弥什 卡牌对战》游戏状态模型 (第3章 区域、第4章 用语、第6章 流程)
 */

import { CardType } from './card.js';

export type GameStatus = 'WAITING' | 'PREPARING' | 'PLAYING' | 'FINISHED';

export type GamePhase =
  | 'MULLIGAN_PHASE' // 5.2.1.e 开局手牌调度阶段
  | 'STAND_PHASE' // 6.2 竖直阶段
  | 'DRAW_CHARGE_PHASE' // 6.3 抽牌填充阶段
  | 'MAIN_PHASE' // 6.4 主要阶段
  | 'COMBAT_ATTACK_DECLARATION' // 7.2 攻击宣言步骤
  | 'COMBAT_FREE_TIMING' // 7.3 自由时点步骤
  | 'COMBAT_CHARGE' // 7.4 充能步骤
  | 'COMBAT_DAMAGE' // 7.5 伤害步骤
  | 'COMBAT_BATTLE' // 7.6 角色战斗步骤
  | 'END_PHASE'; // 6.5 结束阶段

export type ZoneId =
  | 'BATTLEFIELD' // 3.2 战场
  | 'DECK' // 3.3 牌组
  | 'HAND' // 3.4 手牌
  | 'GRAVEYARD' // 3.5 墓地
  | 'COST' // 3.6 费用区
  | 'SIGNAL_ORB' // 3.7 信号球区
  | 'PROCESSING' // 3.8 处理区
  | 'EROSION' // 3.9 侵蚀计数区
  | 'REMOVED'; // 游戏外/放逐区

/**
 * 1.3.3 禁止效果标记 (禁止效果优先于要求执行该行动的效果)
 */
export type ProhibitionFlag =
  | 'CANNOT_ATTACK' // 不能攻击 (BP01-049/050/051/073, BP03-079)
  | 'CANNOT_BLOCK' // 不能阻挡 (BP01-025)
  | 'CANNOT_DEAL_DAMAGE' // 不能造成伤害，亦防止贯通 (Q&A·7 PR-034)
  | 'CANNOT_GAIN_ABILITIES' // 不能获得新能力 (Q&A·4 BP02-058)
  | 'CANNOT_ELIMINATE' // 信号球不能被消除 (BP02-066)
  | 'CANNOT_MODIFY_PP_BY_OPPONENT' // PP 不会因对方的效果增减 (Q&A·9 BP04-016，不阻止「PP变为X」)
  | 'CANNOT_DISCARD_HIDDEN_COST_AT_END'; // 回合结束时暗费不因规则送墓 (BP03-079)

export type SignalOrbColor = 'RED' | 'BLUE' | 'YELLOW';

/**
 * 8.2.1.c / 8.10 置换效果拦截事件类型
 */
export type ReplacementEventType = 'DESTROY_ROLE' | 'MOVE_CARD' | 'DEAL_DAMAGE';

/**
 * 8.10 可序列化的状态置换效果实例 (支持随 Durable Object 快照恢复)
 */
export interface ActiveReplacementEffect {
  id: string;
  eventType: ReplacementEventType;
  /** 仅作用于指定卡牌实例；为空时作用于 controllerPlayerId 操控的任意卡牌 */
  targetCardInstanceId?: string;
  controllerPlayerId: string;
  /** 限定破坏原因 (如仅限 BATTLE 战斗破坏) */
  destroyReason?: 'BATTLE' | 'EFFECT' | 'PP_ZERO';
  /** 限定来源区域 / 目标区域 (用于 MOVE_CARD 置换) */
  fromZone?: ZoneId;
  toZone?: ZoneId;
  /** 置换结果：PREVENT = 改为不执行/不离场/不破坏；REDIRECT_ZONE = 改为放置到指定区域 */
  action:
    | { kind: 'PREVENT' }
    | { kind: 'REDIRECT_ZONE'; zone: ZoneId; isFaceUp?: boolean; isReady?: boolean; toBottom?: boolean };
  /** 8.7.5 / 8.10 仅生效一次后自动移除 */
  once?: boolean;
  /** 有效截止回合 (undefined 表示持续到卡牌离场或本局结束) */
  untilTurn?: number;
  source?: string;
  label?: string;
}

/**
 * 带期限的持续效果 (8.2.1.b / 8.9)：
 * - untilTurn 为数字：「直到回合结束为止」= 当前回合，「直到下个回合结束为止」= 当前回合 + 1，在该回合结束阶段 (6.5.1.d) 消失
 * - untilTurn 为 undefined：持续到卡牌离开当前区域为止 (3.1.4，如升变能力赋予的【速攻】)
 * 卡牌移动区域时一律消失 (3.1.4)。
 */
export interface CardModifier {
  id?: string;
  /** 8.9.1.e 适用顺序时间戳 (单调递增，随快照保存) */
  timestamp?: number;
  pp?: number;
  /** 8.9.1.e / Q&A·6「PP 变为 X」，覆盖此前的 PP 增减 */
  setPP?: number;
  dp?: number;
  /** 「DP 变为 X」 */
  setDP?: number;
  charge?: number; // 10.4【充能+X】
  /** 10.3 效果赋予的「充能X」 */
  setCharge?: number;
  keywords?: string[]; // 8.9.1.b 获得的词条 (如 速攻、突进、贯通、同命)
  removeKeywords?: string[]; // 8.9.1.b 失去的词条
  addTraits?: string[]; // 8.9.1.b 获得的特征 (如 <升格者>)
  loseAbilities?: boolean; // 8.3.4 失去能力 / 效果无效
  /** 1.3.3 禁止效果标记 */
  prohibitions?: ProhibitionFlag[];
  /** 「视为」效果：信号球区中可视为指定颜色的信号球 (BP01-014/022, BP03-077, BP04-032) */
  treatedAsOrbColors?: SignalOrbColor[];
  /** 「视为」效果：1 张信号球可视为 N 个同色信号球 (Q&A·1 BP01-037 万世铭 = 3) */
  orbValue?: number;
  /** 「视为」效果：卡牌名称可视为指定卡名 (Q&A·4/5 BP02-040 视为《飞叶点翠》) */
  treatedAsNames?: string[];
  /** 施加该修改器的玩家 ID (供 Q&A·9 BP04-016 区分己方与对方效果) */
  appliedByPlayerId?: string;
  untilTurn?: number;
  source?: string; // 产生该效果的卡牌编号 (用于展示)
  sourceCardInstanceId?: string;
}

export interface CardInstance {
  readonly instanceId: string; // 唯一运行时实体ID
  readonly cardId: string; // 静态数据库Card ID
  readonly cardNumber: string; // 卡牌编号
  readonly ownerPlayerId: string; // 4.2 所属玩家
  controllerPlayerId: string; // 4.3 操控玩家
  zone: ZoneId; // 当前区域
  slotIndex?: number; // 战场卡位 0..4 (3.2.3)
  underneathCardIds: string[]; // 8.11 升变垫在下方的卡牌
  attachedEquipmentId?: string; // 4.18 装备的装备牌ID
  isFaceUp: boolean; // 4.6.2 正面 / 背面
  isReady: boolean; // 4.6.1 竖直 / 横置
  /** 10.15 冰冻状态：下个回合竖直阶段不因规则竖直，竖直阶段结束时解除 (10.15.3) */
  isFrozen?: boolean;
  /** 10.18.3 【浮空模式】：处于处理区的浮空卡牌，操控玩家下个回合开始时因规则回到战场 */
  isAirborne?: boolean;
  /** 8.13.4 协战角色当前绑定的协战搭档卡牌实例 ID */
  partnerCardId?: string;
  /** 8.13.4 协战搭档所属的协战角色卡牌实例 ID */
  partnerOfCardId?: string;
  /** 8.13.4.c / BP04-038 / ST06-002：在指定回合结束前不会因规则解除协战状态 */
  cannotReleasePartnerUntilTurn?: number;
  turnEnteredZone: number; // 进入当前区域的回合编号 (用于出场攻击限制 7.2.1.b.1)
  /** 8.9.1.e.1 进入当前区域的单调时间戳 (永久能力持续效果适用顺序基准) */
  enteredZoneTimestamp?: number;
  /** @deprecated 已迁移至 modifiers (CardModifier)，仅保留用于兼容旧快照只读回退 */
  tempPPBonus?: number;
  /** @deprecated 已迁移至 modifiers (CardModifier)，仅保留用于兼容旧快照只读回退 */
  tempDPBonus?: number;
  /** @deprecated 已迁移至 modifiers (CardModifier)，仅保留用于兼容旧快照只读回退 */
  grantedKeywords?: string[];
  modifiers?: CardModifier[]; // 8.9 持续效果 (PP/DP/充能数/词条/特征/失去能力/禁止/视为)
  endOfTurnToGraveyard?: number; // 「该回合结束时，将该牌放置到墓地」的回合编号
  effectivePP?: number; // 服务端计算的当前 PP (含装备、持续效果与永久能力；仅战场卡位上的角色)
  effectiveDP?: number; // 服务端计算的当前 DP
  effectiveKeywords?: string[]; // 服务端计算的当前有效词条列表 (含固有词条、持续效果与永久能力)
  effectiveTraits?: string[]; // 服务端计算的当前有效特征列表 (含基本特征与持续效果赋予特征)
  effectiveProhibitions?: ProhibitionFlag[]; // 服务端计算的当前生效禁止效果标记 (1.3.3)
  effectiveOrbColors?: SignalOrbColor[]; // 服务端计算的当前有效信号球颜色 (含「视为」效果)
  imageUrl?: string; // 卡面插画链接
}

export interface BattlefieldSlot {
  slotIndex: number; // 0..4
  roleCardId?: string;
  standaloneEquipmentId?: string; // 单独占位的装备牌 (8.6.2.e.2)
  assistCardId?: string; // 辅助机牌 (2.2.2.c.2)
}

/**
 * 8.5 / 8.7 自动能力触发事件类型
 */
export type TriggerEventType =
  | 'CARD_ENTERED_FIELD' // 角色/道具出场 (含升变出场)
  | 'CARD_LEFT_FIELD' // 卡牌离开战场 (8.7.4.a.2)
  | 'CARD_DESTROYED' // 卡牌被破坏 (战斗/效果/PP不足)
  | 'ATTACK_DECLARED' // 7.2.1.d 攻击宣言时
  | 'FREE_TIMING_STARTED' // 7.3.1.a 自由时点步骤开始时
  | 'BLOCK_DECLARED' // 7.3.1.c 阻挡宣言时
  | 'ATTACK_CHARGE_STARTED' // 7.4.1.a 攻击充能开始时
  | 'DAMAGE_STEP_STARTED' // 7.5.1.a 伤害步骤开始时
  | 'CHARACTER_BATTLE_STARTED' // 7.6.1.a 角色战斗步骤开始时
  | 'ATTACK_ENDED' // 7.5.1.d / 7.6.1.f 攻击结束时
  | 'TURN_STARTED' // 6.2 竖直阶段/回合开始时
  | 'END_PHASE_TRIGGERS' // 6.5.1.b 回合结束时
  | 'ORBS_ELIMINATED' // 4.16.2 消除信号球时
  | 'DAMAGE_DEALT' // 4.10 玩家受到伤害时
  | 'CARD_CHARGED' // 4.12 充能翻开卡牌时
  | 'PARTNER_GAINED'; // 8.13.3.e 获得或成为协战搭档时

export interface PendingTrigger {
  id: string;
  abilityId: string;
  eventType?: TriggerEventType;
  sourceCardInstanceId: string;
  sourceCardNumber?: string;
  controllerPlayerId: string;
  label?: string; // 展示给玩家的触发能力说明 (用于多触发顺序选择与前端展示)
  oncePerTurn?: boolean; // 10.1 【回合1】限制
  triggerContext: Record<string, unknown>;
}

/**
 * 8.7.5 时限触发：效果注册在未来特定时点自动触发的能力 (默认触发一次后移除)
 */
export interface DelayedTrigger {
  id: string;
  eventType: TriggerEventType;
  triggerTurn?: number;
  sourceCardInstanceId: string;
  sourceCardNumber: string;
  controllerPlayerId: string;
  abilityId: string;
  label: string;
  once: boolean;
  payload?: Record<string, unknown>;
}

/** 对客户端公开的待机自动能力摘要 (不含隐藏信息) */
export interface PublicPendingTrigger {
  id: string;
  sourceCardInstanceId: string;
  sourceCardNumber: string;
  controllerPlayerId: string;
  label: string;
}

export interface PendingChoice {
  id: string;
  playerId: string;
  choiceType: 'SELECT_CARDS' | 'SELECT_SLOT' | 'SELECT_OPTION' | 'YES_NO';
  prompt: string;
  options: { id: string; label: string; payload?: unknown }[];
  minSelections: number;
  maxSelections: number;
  expiresAt?: number;
  sourceCardInstanceId?: string;
  effectType?: string;
  metadata?: Record<string, any>;
}

export interface PlayerState {
  readonly playerId: string;
  readonly seatOrder: 0 | 1;
  readonly isFirstPlayer: boolean;
  erosionCount: number; // 3.9 侵蚀计数 (0..7)
  hasMulliganed: boolean; // 是否已完成调度
  surrendered: boolean; // 是否投降
  
  totalCostCount: number; // 费用区总数
  openCostCount: number; // 明费总数
  availableOpenCostCount: number; // 可用竖直明费
  exhaustedOpenCostCount: number; // 已横置明费
  hiddenCostCount: number; // 暗费数量 (背面竖直)
  
  turnAbilityUsage: Record<string, number>; // cardInstanceId -> 发动次数 (10.1)
  gameAbilityUsage: Record<string, number>; // cardNumber -> 发动次数 (10.11)
  costModifiers?: CostModifier[]; // 动态费用修改器 (如卡牌【起】动能力减费)
  /** 该回合中被破坏的我方火属性角色数量 (供 BP04-028 渡边·尘铭瞬时能力条件判定) */
  destroyedFireRoleCountThisTurn?: number;
}

export interface CostModifier {
  id: string;
  amount: number; // 费用减少值 (如 2)
  targetTrait?: string; // 特征/名称过滤 (如 '三头犬小队' 或 '薇拉')
  targetName?: string;
  cardType?: CardType; // 如 CardType.ROLE
  excludeAscension?: boolean; // 不包含升变费用
  remainingCount?: number; // 1 表示下1张
}

/**
 * 角色攻击流程中的当前步骤 (第 7 章)
 * ATTACK_DECLARATION: 7.2.1.d 攻击时触发处理；FREE_TIMING: 7.3.1.b 轮流使用瞬时；
 * BLOCK: 7.3.1.c 被攻击玩家选择是否阻挡；CHARGE: 7.4 攻击充能；
 * DAMAGE: 7.5 伤害步骤；BATTLE: 7.6 角色战斗步骤；END: 攻击结束
 */
export type CombatStep =
  | 'ATTACK_DECLARATION'
  | 'FREE_TIMING'
  | 'BLOCK'
  | 'CHARGE'
  | 'DAMAGE'
  | 'BATTLE'
  | 'END';

/**
 * 轮流使用【瞬时】的时机 (7.3.1.b 自由时点步骤 / 6.5.1.a 结束阶段)
 */
export interface TimingWindow {
  kind: 'FREE_TIMING' | 'END_PHASE';
  priorityPlayerId: string; // 当前可以使用瞬时或选择不使用的玩家
  consecutivePasses: number; // 连续选择不使用的次数，达到 2 时结束
}

/** 6.5.1 结束阶段的当前步骤 */
export type EndPhaseStep = 'INSTANTS' | 'TRIGGERS' | 'DISCARD' | 'CLEANUP';

export interface CombatState {
  step?: CombatStep;
  chargesRemaining?: number; // 7.4.1.b 尚未执行的攻击充能次数
  chargeIndex?: number;
  pendingChargeCardId?: string; // 已翻开到处理区、等待能力处理完毕后放置的充能卡牌
  damageRemaining?: number; // 7.5.1.b 尚未执行的伤害充能次数 (伤害量在伤害步骤开始时锁定)
  pendingDamageCardId?: string;
  attackerCardId: string;
  targetType: 'PLAYER' | 'CHARACTER';
  targetCardId?: string;
  blockerCardId?: string;
  battledCardId?: string; // 7.6.1 角色战斗步骤中与攻击角色发生战斗的角色 (【同命】参照)
  /** 1.3.3 本次攻击不能造成伤害 (BP01-027/065/071, PR-034/040；亦防止【贯通】Q&A·7) */
  cannotDealDamage?: boolean;
  freeTimingPassCount: number; // 双方连续Pass计数 (用于推动时点结束)
}

export interface GameState {
  readonly gameId: string;
  readonly rngSeed: number;
  readonly createdAt: number;
  status: GameStatus;
  turnNumber: number;
  activePlayerId: string; // 6.1.1.a 回合玩家
  nonActivePlayerId: string; // 6.1.1.b 回合外玩家
  phase: GamePhase;
  priorityPlayerId: string; // 当前拥有行动/选择优先权的玩家
  
  players: Record<string, PlayerState>;
  cards: Record<string, CardInstance>;
  battlefields: Record<string, BattlefieldSlot[]>; // playerId -> 5 slots
  
  currentCombat?: CombatState;
  pendingTriggers: PendingTrigger[]; // 8.5 待机自动能力池
  delayedTriggers?: DelayedTrigger[]; // 8.7.5 时限触发池
  activeReplacements?: ActiveReplacementEffect[]; // 8.10 状态内置换效果池 (可随快照恢复)
  effectTimestampSeq?: number; // 8.9.1.e 持续效果时间戳序号 (随快照保存)
  currentPendingChoice?: PendingChoice; // 待决玩家决策
  pendingChoiceQueue?: PendingChoice[]; // 排队等待的后续决策 (当前决策处理完毕后依次进行)
  timingWindow?: TimingWindow; // 轮流使用瞬时的时机 (7.3.1.b / 6.5.1.a)
  endPhaseStep?: EndPhaseStep;
  
  winnerId?: string;
  isDraw: boolean;
  finishReason?: string;
}

/**
 * 隐藏信息脱敏后的公开状态 (12. 隐藏信息)
 */
export interface PublicGameState {
  gameId: string;
  roomId?: string;
  stateVersion?: number; // 增量同步状态版本号 (用于网络优化与丢包校验)
  status: GameStatus;
  turnNumber: number;
  activePlayerId: string;
  nonActivePlayerId: string;
  phase: GamePhase;
  priorityPlayerId: string;
  
  players: Record<string, PlayerState>;
  battlefields: Record<string, BattlefieldSlot[]>;
  currentCombat?: CombatState;
  timingWindow?: TimingWindow;
  endPhaseStep?: EndPhaseStep;
  pendingTriggers?: PublicPendingTrigger[]; // 当前待处理的自动能力列表 (仅公开摘要)
  currentPendingChoice?: PendingChoice;
  opponentPendingChoice?: { playerId: string; prompt: string; effectType?: string };
  winnerId?: string;
  isDraw: boolean;
  finishReason?: string;
  
  // 公开/私密卡牌映射
  publicCards: Record<string, CardInstance>;
  myHandCards?: CardInstance[]; // 仅己方手牌可见具体信息
  opponentHandCount: number; // 对手手牌仅显示数量
  myDeckCount: number;
  opponentDeckCount: number;
}
