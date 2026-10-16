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
  turnEnteredZone: number; // 进入当前区域的回合编号 (用于出场攻击限制 7.2.1.b.1)
  tempPPBonus?: number; // 临时PP加成
  tempDPBonus?: number; // 临时DP加成
  grantedKeywords?: string[]; // 临时获得的词条 (如【速攻】、【突进】等)
  imageUrl?: string; // 卡面插画链接
}

export interface BattlefieldSlot {
  slotIndex: number; // 0..4
  roleCardId?: string;
  standaloneEquipmentId?: string; // 单独占位的装备牌 (8.6.2.e.2)
  assistCardId?: string; // 辅助机牌 (2.2.2.c.2)
}

export interface PendingTrigger {
  id: string;
  abilityId: string;
  sourceCardInstanceId: string;
  controllerPlayerId: string;
  triggerContext: Record<string, unknown>;
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

export interface CombatState {
  attackerCardId: string;
  targetType: 'PLAYER' | 'CHARACTER';
  targetCardId?: string;
  blockerCardId?: string;
  battledCardId?: string; // 7.6.1 角色战斗步骤中与攻击角色发生战斗的角色 (【同命】参照)
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
  currentPendingChoice?: PendingChoice; // 待决玩家决策
  pendingChoiceQueue?: PendingChoice[]; // 排队等待的后续决策 (当前决策处理完毕后依次进行)
  
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
