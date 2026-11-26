import type {
  CardInstance,
  CardVersionData,
  GameAction,
  PendingChoice,
  ZoneId,
} from '@zhanshuang/shared';
import type { CardEffectContext, CardEffectEngine } from '../card-effects.js';
import type { CustomHandlerFrameState, CustomHandlerRuntime } from './custom-handlers.js';
import type { DslEvaluator } from './evaluator.js';
import type {
  AbilityCost,
  CardEffectSpec,
  EffectStep,
  OrbColorFilter,
  PlayerSide,
} from './types.js';

export type DslResult = { success: boolean; error?: string };
export type DslChoiceAction = Extract<GameAction, { type: 'SELECT_CHOICE_OPTION' }>;

/**
 * 声明式效果挂起决策动作联合类型 (纯 JSON 可序列化)
 */
export type DslPendingAction =
  | {
      kind: 'COST_DISCARD';
      onPaid: EffectStep[];
      optional: boolean;
      requiredMin?: number;
      markUsed?: boolean;
      markUsedKey?: string;
      savePaidToVar?: string;
    }
  | {
      kind: 'COST_ORB';
      onPaid: EffectStep[];
      optional: boolean;
      markUsed?: boolean;
      markUsedKey?: string;
      savePaidToVar?: string;
      excludeFromAbilityOrbCount?: boolean;
    }
  | {
      kind: 'COST_ORB_OR_DISCARD';
      onPaid: EffectStep[];
      optional: boolean;
      markUsed?: boolean;
      markUsedKey?: string;
    }
  | {
      kind: 'COST_PAY_COST';
      amount: number;
      onPaid: EffectStep[];
      optional: boolean;
      markUsed?: boolean;
      markUsedKey?: string;
    }
  | { kind: 'COST_TAP_FIELD'; onPaid: EffectStep[]; optional: boolean }
  | { kind: 'CONFIRM_YES_NO'; onYes: EffectStep[]; onNo?: EffectStep[] }
  | { kind: 'CHOOSE_MODE'; modes: { id: string; steps: EffectStep[] }[] }
  | {
      kind: 'SAVE_CHOICE';
      saveToVar: string;
      distinctTraits?: string[];
      distinctTraitsError?: string;
      uniqueNames?: boolean;
      uniqueCardNumbers?: boolean;
      distinctAttributes?: boolean;
      maxTotalCost?: number;
      requireEmptySlotCount?: boolean;
    }
  | { kind: 'REORDER_ZONE'; zone: 'SIGNAL_ORB' }
  | {
      kind: 'ORDER_MOVE_CARDS';
      moveStep: Extract<EffectStep, { op: 'MOVE_CARDS' }>;
      candidateIds: string[];
    }
  | { kind: 'PLACE_ORB_AT_POSITION'; cardInstanceId: string }
  | { kind: 'WANSHIMING_REVEAL_TO_COST'; revealVar: string }
  | {
      kind: 'CHOOSE_ACTIVATED_ABILITY';
      costCardInstanceIds?: string[];
      entries: Array<{
        id: string;
        cardNumber: string;
        usageKey: string;
        oncePerTurn: boolean;
        oncePerTurnByPlayer?: boolean;
        cost?: AbilityCost;
        steps: EffectStep[];
      }>;
    }
  | { kind: 'CUSTOM_CHOICE'; customFrame: CustomHandlerFrameState };

/**
 * 声明式效果执行帧：纯 JSON 可序列化，存放于 PendingChoice.metadata.__dsl，
 * 以便 Durable Object 快照持久化后从任意暂停点精确恢复。
 */
export interface DslExecutionFrame {
  cardNumber: string;
  sourceCardInstanceId: string;
  playerId: string;
  vars: Record<string, string[]>;
  remainingSteps: EffectStep[];
  pendingAction: DslPendingAction;
}

/**
 * 声明式决策元数据布局 (保证 PendingChoice.metadata.__dsl 向后兼容)
 */
export interface DslChoiceMetadata {
  __dsl?: DslExecutionFrame;
  [key: string]: unknown;
}

/**
 * 静态持续效果求值上下文 (由 ContinuousEffectEngine 传入)
 */
export interface DslStaticEvalContext {
  getCardsInZone: (pid: string, z: ZoneId) => CardInstance[];
  getFieldRoles: (pid: string) => CardInstance[];
  hasTraitFn: (id: string, trait: string) => boolean;
}

/**
 * 解释器宿主机契约接口：向子模块 (求值器 / 代价处理器 / 步骤执行器 / 触发适配器) 暴露受控原语，
 * 避免模块间循环依赖。
 */
export interface DslInterpreterHost {
  readonly ctx: CardEffectContext;
  readonly effects: CardEffectEngine;
  readonly registry: ReadonlyMap<string, CardEffectSpec>;
  readonly evaluator: DslEvaluator;

  enqueueDslChoice(
    choice: Omit<PendingChoice, 'metadata'>,
    frame: DslExecutionFrame,
    extraMetadata?: Record<string, unknown>
  ): void;
  resolveSide(playerId: string, side: PlayerSide): string;
  zone(playerId: string, zone: ZoneId): CardInstance[];
  roles(playerId: string): CardInstance[];
  fieldTopHosts(playerId: string): CardInstance[];
  def(card: CardInstance): CardVersionData | undefined;
  hasTrait(card: CardInstance, trait: string): boolean;
  isOrb(card: CardInstance): boolean;
  hasEmptySlot(playerId: string): boolean;
  emptySlotCount(playerId: string): number;
  choiceId(tag: string): string;
  orbGroups(playerId: string, size: number, filter: OrbColorFilter): string[][];
  eliminate(
    playerId: string,
    ids: string[],
    sourceId?: string,
    excludeFromAbilityOrbCount?: boolean
  ): void;
  peekTop(playerId: string, count: number): string[];
  revealTop(playerId: string, count: number): string[];
  mill(playerId: string, count: number): string[];
  bringToField(
    playerId: string,
    cardId: string,
    triggerEntry: boolean,
    enterTapped?: boolean,
    enterAbilitiesLost?: boolean,
    sourceCardNumber?: string
  ): boolean;
  destroy(cardId: string): boolean;
  markUsed(playerId: string, cardId: string): void;
  makeCustomRuntime(): CustomHandlerRuntime;
  calculateHandCostDiscount(playerId: string, cardNumber: string): number;
  executeWithCost(
    cardNumber: string,
    sourceId: string,
    playerId: string,
    cost: AbilityCost | undefined,
    steps: EffectStep[],
    markUsed: boolean,
    initialVars?: Record<string, string[]>,
    markUsedKey?: string,
    costCardInstanceIds?: string[]
  ): DslResult;
  runSteps(
    cardNumber: string,
    sourceId: string,
    playerId: string,
    vars: Record<string, string[]>,
    queue: EffectStep[]
  ): void;
}
