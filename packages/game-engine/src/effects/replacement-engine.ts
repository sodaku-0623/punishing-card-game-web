import {
  ActiveReplacementEffect,
  CardInstance,
  GameState,
  PendingChoice,
  ReplacementEventType,
  ZoneId,
} from '@zhanshuang/shared';
import { RULE_CONSTANTS } from '@zhanshuang/game-rules';
import { ICardDatabase } from '../database/card-registry.js';
import { nextEffectTimestamp } from './continuous-effects.js';

export interface ReplacementDestroyEvent {
  type: 'DESTROY_ROLE';
  cardInstanceId: string;
  controllerPlayerId: string;
  reason: 'BATTLE' | 'EFFECT' | 'PP_ZERO';
  attackerCardId?: string;
}

export interface ReplacementMoveEvent {
  type: 'MOVE_CARD';
  cardInstanceId: string;
  controllerPlayerId: string;
  fromZone: ZoneId;
  toZone: ZoneId;
  isFaceUp?: boolean;
  isReady?: boolean;
  toBottom?: boolean;
  isOrphanCleanup?: boolean;
  orphanHostCardId?: string;
  isPlacingUnderneath?: boolean;
  underneathHostId?: string;
  includeUnderneath?: boolean;
  skipLeftFieldTrigger?: boolean;
  sentByEffectOrCost?: boolean;
  countAsDeckToGy?: boolean;
}

export interface ReplacementDamageEvent {
  type: 'DEAL_DAMAGE';
  defenderPlayerId: string;
  amount: number;
  sourceCardId?: string;
}

export type ReplacementEvent =
  | ReplacementDestroyEvent
  | ReplacementMoveEvent
  | ReplacementDamageEvent;

export type ReplacementOutcome =
  | { kind: 'NONE' }
  | { kind: 'PREVENT'; pendingChoice?: boolean }
  | {
      kind: 'REDIRECT_ZONE';
      zone: ZoneId;
      isFaceUp?: boolean;
      isReady?: boolean;
      toBottom?: boolean;
      pendingChoice?: boolean;
    }
  | { kind: 'MODIFY_DAMAGE'; newAmount: number };

export interface ReplacementRuleContext {
  state: GameState;
  cardDb: ICardDatabase;
  getZoneCards: (playerId: string, zone: ZoneId) => CardInstance[];
  hasLostAbilities: (cardInstanceId: string) => boolean;
  hasCardName: (cardInstanceId: string, name: string) => boolean;
  hasTrait?: (cardInstanceId: string, trait: string) => boolean;
  getEffectiveCardCost?: (cardInstanceId: string) => number;
  sendCardToGraveyard?: (cardInstanceId: string, sentByEffectOrCost?: boolean) => void;
  getMaxCostZoneCapacity?: (playerId: string) => number;
  enqueueChoice?: (choice: PendingChoice) => void;
}

export interface OptionalReplacementDecisionParams {
  ruleId: string;
  label: string;
  controllerPlayerId: string;
  subjectCardId: string;
  event: ReplacementDestroyEvent | ReplacementMoveEvent;
  appliedIds?: Set<string>;
  prompt?: string;
  choiceEffectType?: string; // 默认 'OPTIONAL_REPLACEMENT_DECISION'
  sacrificeCandidates?: string[];
  sacrificeCount?: number;
  fixedSacrificeIds?: string[];
  detachFromSubject?: boolean;
  oncePerTurnUsageKey?: string;
  action:
    | { kind: 'PREVENT' }
    | { kind: 'REDIRECT_ZONE'; zone: ZoneId; isFaceUp?: boolean; isReady?: boolean; toBottom?: boolean };
  replaceOptionLabel?: string;
  declineOptionLabel?: string;
}

/**
 * 8.2.1.c / 8.10 静态或卡牌绑定的置换效果规则定义
 */
export interface ReplacementRule {
  id: string;
  label?: string;
  eventTypes: ReplacementEventType[];
  /** 无副作用的匹配判定 (供 8.10.2 多置换选序使用) */
  matches?: (event: ReplacementEvent, ctx: ReplacementRuleContext) => boolean;
  /** 返回匹配并执行后的置换结果；返回 { kind: 'NONE' } 或 undefined 表示本次不适用 */
  apply: (
    event: ReplacementEvent,
    ctx: ReplacementRuleContext,
    appliedIds?: Set<string>
  ) => ReplacementOutcome | undefined;
}

export interface InterceptDestroyResult {
  replaced: boolean;
  prevented: boolean;
  pendingChoice?: boolean;
  redirect?: {
    zone: ZoneId;
    isFaceUp?: boolean;
    isReady?: boolean;
    toBottom?: boolean;
  };
  appliedIds: Set<string>;
}

export interface InterceptMoveResult {
  replaced: boolean;
  prevented: boolean;
  pendingChoice?: boolean;
  toZone: ZoneId;
  isFaceUp?: boolean;
  isReady?: boolean;
  toBottom?: boolean;
  appliedIds: Set<string>;
}

export interface InterceptDamageResult {
  amount: number;
  pendingChoice?: boolean;
  appliedIds: Set<string>;
}

/**
 * 8.2.1.c / 8.10 置换效果统一拦截引擎：
 * - 在破坏、区域移动、伤害等行动即将发生前介入 (不在检查时机执行，8.2.1.c.3)
 * - 被置换的原本事件视为完全未发生 (8.10.1.a)
 * - 同一事件中每个置换效果最多适用一次 (8.10.2.c)，防止循环置换
 * - 1.2.4.a 弃权 (SURRENDER) 不经由本引擎，永远不可被置换
 * - 3.6.4 / Q&A·5 置换目标为费用区且费用区已满 (10张) 时，自动改放墓地
 */
export class ReplacementEngine {
  private rules: ReplacementRule[] = [];
  private sendCardToGraveyardCallback?: (cardInstanceId: string, sentByEffectOrCost?: boolean) => void;
  private maxCostCapProvider?: (playerId: string) => number;
  private effectiveCostProvider?: (cardInstanceId: string) => number;
  private choiceEnqueuer?: (choice: PendingChoice) => void;

  constructor(
    private state: GameState,
    private cardDb: ICardDatabase,
    private getZoneCards: (playerId: string, zone: ZoneId) => CardInstance[],
    private hasLostAbilities: (cardInstanceId: string) => boolean,
    private hasCardName: (cardInstanceId: string, name: string) => boolean,
    private hasTraitProvider?: (cardInstanceId: string, trait: string) => boolean
  ) {
    this.registerBuiltinReplacements();
  }

  setSendCardToGraveyardHandler(handler: (cardInstanceId: string, sentByEffectOrCost?: boolean) => void): void {
    this.sendCardToGraveyardCallback = handler;
  }

  setTraitProvider(handler: (cardInstanceId: string, trait: string) => boolean): void {
    this.hasTraitProvider = handler;
  }

  setMaxCostCapacityProvider(provider: (playerId: string) => number): void {
    this.maxCostCapProvider = provider;
  }

  setEffectiveCardCostProvider(provider: (cardInstanceId: string) => number): void {
    this.effectiveCostProvider = provider;
  }

  setChoiceEnqueuer(enqueuer: (choice: PendingChoice) => void): void {
    this.choiceEnqueuer = enqueuer;
  }

  /** 注册卡牌级或扩展置换规则 */
  registerRule(rule: ReplacementRule): void {
    const idx = this.rules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) this.rules[idx] = rule;
    else this.rules.push(rule);
  }

  /** 添加可序列化的状态置换效果 (随快照保存恢复) */
  addActiveReplacement(
    effect: Omit<ActiveReplacementEffect, 'id'> & { id?: string }
  ): ActiveReplacementEffect {
    const seq = nextEffectTimestamp(this.state);
    const full: ActiveReplacementEffect = {
      ...effect,
      id: effect.id ?? `repl-${effect.eventType}-${seq}`,
    };
    this.state.activeReplacements = [...(this.state.activeReplacements ?? []), full];
    return full;
  }

  /** 6.5.1.d 结束阶段清理已到期的状态置换效果 */
  cleanupExpired(turnNumber: number): void {
    if (!this.state.activeReplacements?.length) return;
    const remaining = this.state.activeReplacements.filter(
      (r) => r.untilTurn === undefined || r.untilTurn > turnNumber
    );
    this.state.activeReplacements = remaining.length > 0 ? remaining : undefined;
  }

  /** 7.5.1.d / 7.6.1.f 攻击结束时清理 expiresAtCombatEnd 标志的活动置换效果 */
  clearCombatReplacements(): void {
    if (!this.state.activeReplacements?.length) return;
    const remaining = this.state.activeReplacements.filter((r) => r.expiresAtCombatEnd !== true);
    this.state.activeReplacements = remaining.length > 0 ? remaining : undefined;
  }

  /** 3.1.4 卡牌离开原区域时清理绑定在该卡牌实例上的置换效果 */
  cleanupForCard(cardInstanceId: string): void {
    if (!this.state.activeReplacements?.length) return;
    const remaining = this.state.activeReplacements.filter(
      (r) => r.targetCardInstanceId !== cardInstanceId
    );
    this.state.activeReplacements = remaining.length > 0 ? remaining : undefined;
  }

  /**
   * 8.10 拦截角色破坏 (战斗破坏 / 效果破坏 / 9.4 PP=0 规则破坏)
   */
  interceptDestroyRole(
    cardInstanceId: string,
    reason: 'BATTLE' | 'EFFECT' | 'PP_ZERO',
    attackerCardId?: string,
    appliedIds: Set<string> = new Set(),
    options?: { preferredReplacementId?: string }
  ): InterceptDestroyResult {
    const card = this.state.cards[cardInstanceId];
    if (!card) return { replaced: false, prevented: false, appliedIds };

    const event: ReplacementDestroyEvent = {
      type: 'DESTROY_ROLE',
      cardInstanceId,
      controllerPlayerId: card.controllerPlayerId,
      reason,
      attackerCardId,
    };

    const ctx = this.makeContext();
    const candidates = this.collectMatchingCandidates(event, ctx, appliedIds);

    let chosenCandidate = options?.preferredReplacementId
      ? candidates.find((c) => c.id === options.preferredReplacementId)
      : undefined;

    if (!chosenCandidate && candidates.length >= 2 && this.choiceEnqueuer) {
      const affectedPlayerId = card.ownerPlayerId || card.controllerPlayerId;
      const seq = nextEffectTimestamp(this.state);
      this.choiceEnqueuer({
        id: `choice-repl-order-destroy-${this.state.turnNumber}-${seq}`,
        playerId: affectedPlayerId,
        choiceType: 'SELECT_OPTION',
        prompt: `存在 ${candidates.length} 个同时适用的置换效果 (8.10.2)，请选择优先适用哪一个：`,
        options: candidates.map((c) => ({ id: c.id, label: c.label })),
        effectType: 'CHOOSE_REPLACEMENT_ORDER',
        sourceCardInstanceId: cardInstanceId,
        minSelections: 1,
        maxSelections: 1,
        metadata: {
          eventKind: 'DESTROY_ROLE',
          cardInstanceId,
          reason,
          attackerCardId,
          combatCannotDealDamage: Boolean(this.state.currentCombat?.cannotDealDamage),
          appliedIds: Array.from(appliedIds),
        },
      });
      return { replaced: true, prevented: true, pendingChoice: true, appliedIds };
    }

    if (!chosenCandidate && candidates.length > 0) {
      chosenCandidate = candidates[0];
    }

    if (chosenCandidate) {
      appliedIds.add(chosenCandidate.id);
      if (chosenCandidate.kind === 'ACTIVE') {
        const active = chosenCandidate.effect;
        this.consumeActiveReplacementIfOnce(active);
        if (active.action.kind === 'PREVENT') {
          return { replaced: true, prevented: true, appliedIds };
        }
        if (active.action.kind === 'REDIRECT_ZONE') {
          const adjusted = this.applyCostZoneCapRule(card.controllerPlayerId, active.action);
          return { replaced: true, prevented: true, redirect: adjusted, appliedIds };
        }
      } else {
        const outcome = chosenCandidate.rule.apply(event, ctx, appliedIds);
        if (outcome?.kind === 'PREVENT') {
          return {
            replaced: true,
            prevented: true,
            ...(outcome.pendingChoice ? { pendingChoice: true } : {}),
            appliedIds,
          };
        }
        if (outcome?.kind === 'REDIRECT_ZONE') {
          const adjusted = this.applyCostZoneCapRule(card.controllerPlayerId, outcome);
          return {
            replaced: true,
            prevented: true,
            ...(outcome.pendingChoice ? { pendingChoice: true } : {}),
            redirect: adjusted,
            appliedIds,
          };
        }
      }
    }

    // 兼容未提供 matches 判定的自定义规则
    for (const rule of this.rules) {
      if (rule.matches) continue;
      if (appliedIds.has(rule.id)) continue;
      if (!rule.eventTypes.includes('DESTROY_ROLE')) continue;
      const outcome = rule.apply(event, ctx, appliedIds);
      if (!outcome || outcome.kind === 'NONE') continue;
      appliedIds.add(rule.id);
      if (outcome.kind === 'PREVENT') {
        return {
          replaced: true,
          prevented: true,
          ...(outcome.pendingChoice ? { pendingChoice: true } : {}),
          appliedIds,
        };
      }
      if (outcome.kind === 'REDIRECT_ZONE') {
        const adjusted = this.applyCostZoneCapRule(card.controllerPlayerId, outcome);
        return {
          replaced: true,
          prevented: true,
          ...(outcome.pendingChoice ? { pendingChoice: true } : {}),
          redirect: adjusted,
          appliedIds,
        };
      }
    }

    return { replaced: false, prevented: false, appliedIds };
  }

  /**
   * 8.10 拦截卡牌区域移动 (支持多置换选序 8.10.2、多次链式置换、3.6.4 二次置换链，以及 8.10.2.c 单事件防循环)
   */
  interceptMoveCard(
    cardInstanceId: string,
    fromZone: ZoneId,
    toZone: ZoneId,
    options?: {
      isFaceUp?: boolean;
      isReady?: boolean;
      toBottom?: boolean;
      isOrphanCleanup?: boolean;
      orphanHostCardId?: string;
      isPlacingUnderneath?: boolean;
      underneathHostId?: string;
      includeUnderneath?: boolean;
      skipLeftFieldTrigger?: boolean;
      sentByEffectOrCost?: boolean;
      countAsDeckToGy?: boolean;
      preferredReplacementId?: string;
    },
    appliedIds: Set<string> = new Set()
  ): InterceptMoveResult {
    const card = this.state.cards[cardInstanceId];
    if (!card) {
      return {
        replaced: false,
        prevented: false,
        toZone,
        isFaceUp: options?.isFaceUp,
        isReady: options?.isReady,
        toBottom: options?.toBottom,
        appliedIds,
      };
    }

    let currentToZone = toZone;
    let currentFaceUp = options?.isFaceUp;
    let currentReady = options?.isReady;
    let currentToBottom = options?.toBottom;
    let currentPlacingUnderneath = options?.isPlacingUnderneath;
    let replaced = false;
    let preferredId = options?.preferredReplacementId;

    const ctx = this.makeContext();

    for (let guard = 0; guard < 10; guard++) {
      const event: ReplacementMoveEvent = {
        type: 'MOVE_CARD',
        cardInstanceId,
        controllerPlayerId: card.controllerPlayerId,
        fromZone,
        toZone: currentToZone,
        isFaceUp: currentFaceUp,
        isReady: currentReady,
        toBottom: currentToBottom,
        isOrphanCleanup: options?.isOrphanCleanup,
        orphanHostCardId: options?.orphanHostCardId,
        isPlacingUnderneath: currentPlacingUnderneath,
        underneathHostId: options?.underneathHostId,
        includeUnderneath: options?.includeUnderneath,
        skipLeftFieldTrigger: options?.skipLeftFieldTrigger,
        sentByEffectOrCost: options?.sentByEffectOrCost,
        countAsDeckToGy: options?.countAsDeckToGy,
      };

      const candidates = this.collectMatchingCandidates(event, ctx, appliedIds);
      let chosen = preferredId ? candidates.find((c) => c.id === preferredId) : undefined;
      preferredId = undefined;

      if (!chosen && candidates.length >= 2 && this.choiceEnqueuer) {
        const affectedPlayerId = card.ownerPlayerId || card.controllerPlayerId;
        const seq = nextEffectTimestamp(this.state);
        this.choiceEnqueuer({
          id: `choice-repl-order-move-${this.state.turnNumber}-${seq}`,
          playerId: affectedPlayerId,
          choiceType: 'SELECT_OPTION',
          prompt: `存在 ${candidates.length} 个同时适用的移动置换效果 (8.10.2)，请选择优先适用哪一个：`,
          options: candidates.map((c) => ({ id: c.id, label: c.label })),
          effectType: 'CHOOSE_REPLACEMENT_ORDER',
          sourceCardInstanceId: cardInstanceId,
          minSelections: 1,
          maxSelections: 1,
          metadata: {
            eventKind: 'MOVE_CARD',
            cardInstanceId,
            fromZone,
            toZone: currentToZone,
            isFaceUp: currentFaceUp,
            isReady: currentReady,
            toBottom: currentToBottom,
            isOrphanCleanup: options?.isOrphanCleanup,
            orphanHostCardId: options?.orphanHostCardId,
            isPlacingUnderneath: currentPlacingUnderneath,
            underneathHostId: options?.underneathHostId,
            includeUnderneath: options?.includeUnderneath,
            skipLeftFieldTrigger: options?.skipLeftFieldTrigger,
            sentByEffectOrCost: options?.sentByEffectOrCost,
            countAsDeckToGy: options?.countAsDeckToGy,
            appliedIds: Array.from(appliedIds),
          },
        });
        return {
          replaced: true,
          prevented: true,
          pendingChoice: true,
          toZone: fromZone,
          appliedIds,
        };
      }

      if (!chosen && candidates.length > 0) {
        chosen = candidates[0];
      }

      if (chosen) {
        appliedIds.add(chosen.id);
        replaced = true;
        if (chosen.kind === 'ACTIVE') {
          const active = chosen.effect;
          this.consumeActiveReplacementIfOnce(active);
          if (active.action.kind === 'PREVENT') {
            return { replaced: true, prevented: true, toZone: fromZone, appliedIds };
          }
          if (active.action.kind === 'REDIRECT_ZONE') {
            currentToZone = active.action.zone;
            currentFaceUp = active.action.isFaceUp;
            currentReady = active.action.isReady;
            currentToBottom = active.action.toBottom;
            currentPlacingUnderneath = false;
            continue;
          }
        } else {
          const outcome = chosen.rule.apply(event, ctx, appliedIds);
          if (outcome?.kind === 'PREVENT') {
            return {
              replaced: true,
              prevented: true,
              ...(outcome.pendingChoice ? { pendingChoice: true } : {}),
              toZone: fromZone,
              appliedIds,
            };
          }
          if (outcome?.kind === 'REDIRECT_ZONE') {
            if (outcome.pendingChoice) {
              return {
                replaced: true,
                prevented: true,
                pendingChoice: true,
                toZone: outcome.zone,
                isFaceUp: outcome.isFaceUp,
                isReady: outcome.isReady,
                toBottom: outcome.toBottom,
                appliedIds,
              };
            }
            currentToZone = outcome.zone;
            currentFaceUp = outcome.isFaceUp;
            currentReady = outcome.isReady;
            currentToBottom = outcome.toBottom;
            currentPlacingUnderneath = false;
            continue;
          }
        }
      }

      // 兼容未提供 matches 判定的自定义规则
      let matchedLegacyRule = false;
      for (const rule of this.rules) {
        if (rule.matches) continue;
        if (appliedIds.has(rule.id)) continue;
        if (!rule.eventTypes.includes('MOVE_CARD')) continue;
        const outcome = rule.apply(event, ctx, appliedIds);
        if (!outcome || outcome.kind === 'NONE') continue;
        appliedIds.add(rule.id);
        replaced = true;
        matchedLegacyRule = true;
        if (outcome.kind === 'PREVENT') {
          return {
            replaced: true,
            prevented: true,
            ...(outcome.pendingChoice ? { pendingChoice: true } : {}),
            toZone: fromZone,
            appliedIds,
          };
        }
        if (outcome.kind === 'REDIRECT_ZONE') {
          if (outcome.pendingChoice) {
            return {
              replaced: true,
              prevented: true,
              pendingChoice: true,
              toZone: outcome.zone,
              isFaceUp: outcome.isFaceUp,
              isReady: outcome.isReady,
              toBottom: outcome.toBottom,
              appliedIds,
            };
          }
          currentToZone = outcome.zone;
          currentFaceUp = outcome.isFaceUp;
          currentReady = outcome.isReady;
          currentToBottom = outcome.toBottom;
          currentPlacingUnderneath = false;
        }
        break;
      }
      if (matchedLegacyRule) continue;

      // 3.6.4 / Q&A·5：目标为费用区且已达上限 (默认10/BP03-052为11) 时，改为正面放置到墓地，并继续允许针对 GRAVEYARD 的二次置换链
      const capRuleId = 'rule:3.6.4_COST_ZONE_CAP';
      if (
        currentToZone === 'COST' &&
        fromZone !== 'COST' &&
        !appliedIds.has(capRuleId)
      ) {
        const costCount = this.getZoneCards(card.controllerPlayerId, 'COST').length;
        const cap = this.maxCostCapProvider?.(card.controllerPlayerId) ?? RULE_CONSTANTS.MAX_COST_ZONE_CAPACITY;
        if (costCount >= cap) {
          appliedIds.add(capRuleId);
          replaced = true;
          currentToZone = 'GRAVEYARD';
          currentFaceUp = true;
          currentReady = true;
          currentToBottom = false;
          currentPlacingUnderneath = false;
          continue;
        }
      }

      break;
    }

    return {
      replaced,
      prevented: false,
      toZone: currentToZone,
      isFaceUp: currentFaceUp,
      isReady: currentReady,
      toBottom: currentToBottom,
      appliedIds,
    };
  }

  /**
   * 8.10 拦截玩家受到的伤害量 (支持多置换选序、MODIFY_DAMAGE 与 pendingChoice 挂起恢复)
   */
  interceptDealDamageDetailed(
    defenderPlayerId: string,
    amount: number,
    sourceCardId?: string,
    appliedIds: Set<string> = new Set(),
    options?: { preferredReplacementId?: string; applyMode?: 'DIRECT_DAMAGE' | 'COMBAT_DAMAGE' }
  ): InterceptDamageResult {
    let current = amount;
    if (current <= 0) return { amount: 0, appliedIds };

    const ctx = this.makeContext();
    let preferredId = options?.preferredReplacementId;

    for (let guard = 0; guard < 10 && current > 0; guard++) {
      const event: ReplacementDamageEvent = {
        type: 'DEAL_DAMAGE',
        defenderPlayerId,
        amount: current,
        sourceCardId,
      };

      const candidates = this.collectMatchingCandidates(event, ctx, appliedIds);
      let chosen = preferredId ? candidates.find((c) => c.id === preferredId) : undefined;
      preferredId = undefined;

      if (!chosen && candidates.length >= 2 && this.choiceEnqueuer) {
        const seq = nextEffectTimestamp(this.state);
        this.choiceEnqueuer({
          id: `choice-repl-order-damage-${this.state.turnNumber}-${seq}`,
          playerId: defenderPlayerId,
          choiceType: 'SELECT_OPTION',
          prompt: `存在 ${candidates.length} 个同时适用的伤害置换效果 (8.10.2)，请选择优先适用哪一个：`,
          options: candidates.map((c) => ({ id: c.id, label: c.label })),
          effectType: 'CHOOSE_REPLACEMENT_ORDER',
          sourceCardInstanceId: sourceCardId,
          minSelections: 1,
          maxSelections: 1,
          metadata: {
            eventKind: 'DEAL_DAMAGE',
            defenderPlayerId,
            amount: current,
            sourceCardId,
            applyMode: options?.applyMode ?? 'DIRECT_DAMAGE',
            appliedIds: Array.from(appliedIds),
          },
        });
        return { amount: 0, pendingChoice: true, appliedIds };
      }

      if (!chosen && candidates.length > 0) {
        chosen = candidates[0];
      }

      if (chosen) {
        appliedIds.add(chosen.id);
        if (chosen.kind === 'ACTIVE') {
          const active = chosen.effect;
          this.consumeActiveReplacementIfOnce(active);
          if (active.action.kind === 'PREVENT') {
            return { amount: 0, appliedIds };
          }
          if (active.action.kind === 'MODIFY_DAMAGE') {
            current = applyDamageModifier(current, active.action);
            continue;
          }
        } else {
          const outcome = chosen.rule.apply(event, ctx, appliedIds);
          if (outcome?.kind === 'PREVENT') return { amount: 0, appliedIds };
          if (outcome?.kind === 'MODIFY_DAMAGE') {
            current = Math.max(0, outcome.newAmount);
            continue;
          }
        }
      }

      // 兼容未提供 matches 判定的自定义规则
      let matchedLegacyRule = false;
      for (const rule of this.rules) {
        if (rule.matches) continue;
        if (appliedIds.has(rule.id)) continue;
        if (!rule.eventTypes.includes('DEAL_DAMAGE')) continue;
        const outcome = rule.apply(event, ctx, appliedIds);
        if (!outcome || outcome.kind === 'NONE') continue;
        appliedIds.add(rule.id);
        matchedLegacyRule = true;
        if (outcome.kind === 'PREVENT') return { amount: 0, appliedIds };
        if (outcome.kind === 'MODIFY_DAMAGE') current = Math.max(0, outcome.newAmount);
        break;
      }
      if (!matchedLegacyRule) break;
    }
    return { amount: current, appliedIds };
  }

  /**
   * 8.10 拦截玩家受到的伤害量 (数值便捷入口)
   */
  interceptDealDamage(
    defenderPlayerId: string,
    amount: number,
    sourceCardId?: string,
    appliedIds: Set<string> = new Set()
  ): number {
    return this.interceptDealDamageDetailed(defenderPlayerId, amount, sourceCardId, appliedIds).amount;
  }

  private matchesActiveReplacement(item: ActiveReplacementEffect, event: ReplacementEvent): boolean {
    if (item.eventType !== event.type) return false;
    if (item.untilTurn !== undefined && item.untilTurn < this.state.turnNumber) return false;

    if (event.type === 'DESTROY_ROLE') {
      if (item.targetCardInstanceId && item.targetCardInstanceId !== event.cardInstanceId) return false;
      if (!item.targetCardInstanceId && item.controllerPlayerId !== event.controllerPlayerId) return false;
      if (item.destroyReason && item.destroyReason !== event.reason) return false;
    } else if (event.type === 'MOVE_CARD') {
      if (item.targetCardInstanceId && item.targetCardInstanceId !== event.cardInstanceId) return false;
      if (!item.targetCardInstanceId && item.controllerPlayerId !== event.controllerPlayerId) return false;
      if (item.fromZone && item.fromZone !== event.fromZone) return false;
      if (item.toZone && item.toZone !== event.toZone) return false;
    } else if (event.type === 'DEAL_DAMAGE') {
      if (item.controllerPlayerId !== event.defenderPlayerId) return false;
      if (item.sourceCardInstanceId && item.sourceCardInstanceId !== event.sourceCardId) return false;
    }
    return true;
  }

  private consumeActiveReplacementIfOnce(item: ActiveReplacementEffect): void {
    if (!item.once || !this.state.activeReplacements) return;
    const idx = this.state.activeReplacements.findIndex((x) => x.id === item.id);
    if (idx >= 0) {
      this.state.activeReplacements.splice(idx, 1);
      if (this.state.activeReplacements.length === 0) {
        this.state.activeReplacements = undefined;
      }
    }
  }

  private collectMatchingCandidates(
    event: ReplacementEvent,
    ctx: ReplacementRuleContext,
    appliedIds: Set<string>
  ): Array<
    | { id: string; label: string; kind: 'ACTIVE'; effect: ActiveReplacementEffect }
    | { id: string; label: string; kind: 'RULE'; rule: ReplacementRule }
  > {
    const out: Array<
      | { id: string; label: string; kind: 'ACTIVE'; effect: ActiveReplacementEffect }
      | { id: string; label: string; kind: 'RULE'; rule: ReplacementRule }
    > = [];

    for (const item of this.state.activeReplacements ?? []) {
      if (appliedIds.has(item.id)) continue;
      if (!this.matchesActiveReplacement(item, event)) continue;
      const defaultLabel =
        item.action.kind === 'PREVENT'
          ? '防止原事件发生'
          : item.action.kind === 'REDIRECT_ZONE'
            ? `改为放置到 ${item.action.zone}`
            : '修改伤害数值';
      out.push({
        id: item.id,
        label: item.label ?? `${item.source ? `【${item.source}】` : ''}${defaultLabel}`,
        kind: 'ACTIVE',
        effect: item,
      });
    }

    for (const rule of this.rules) {
      if (appliedIds.has(rule.id)) continue;
      if (!rule.eventTypes.includes(event.type)) continue;
      if (!rule.matches) continue;
      if (!rule.matches(event, ctx)) continue;
      out.push({
        id: rule.id,
        label: rule.label ?? rule.id,
        kind: 'RULE',
        rule,
      });
    }

    return out;
  }

  /**
   * 3.6.4 / Q&A·5 / Q&A·6：置换效果要求放置到费用区，但费用区已达上限 (默认10张，BP03-052满足条件时11张) 时，改为正面放置到墓地
   */
  private applyCostZoneCapRule(
    playerId: string,
    target: { zone: ZoneId; isFaceUp?: boolean; isReady?: boolean; toBottom?: boolean }
  ): { zone: ZoneId; isFaceUp?: boolean; isReady?: boolean; toBottom?: boolean } {
    if (target.zone === 'COST') {
      const costCount = this.getZoneCards(playerId, 'COST').length;
      const cap = this.maxCostCapProvider?.(playerId) ?? RULE_CONSTANTS.MAX_COST_ZONE_CAPACITY;
      if (costCount >= cap) {
        return { zone: 'GRAVEYARD', isFaceUp: true, isReady: true, toBottom: false };
      }
    }
    return target;
  }

  private makeContext(): ReplacementRuleContext {
    return {
      state: this.state,
      cardDb: this.cardDb,
      getZoneCards: this.getZoneCards,
      hasLostAbilities: this.hasLostAbilities,
      hasCardName: this.hasCardName,
      hasTrait: this.hasTraitProvider,
      getEffectiveCardCost: this.effectiveCostProvider,
      sendCardToGraveyard: this.sendCardToGraveyardCallback,
      getMaxCostZoneCapacity: this.maxCostCapProvider,
      enqueueChoice: this.choiceEnqueuer,
    };
  }

  /**
   * 8.10 通用可选置换决策原语：
   * - 存在多个可选代价卡牌 (sacrificeCandidates.length > sacrificeCount) 时挂起 SELECT_CARDS (0 张表示放弃)
   * - 否则挂起 SELECT_OPTION ('replace' / 'decline' 或 'leave')
   * - 无 enqueueChoice 回调时（独立引擎单元测试回退）直接支付代价并执行置换结果
   */
  enqueueOptionalReplacementDecision(
    params: OptionalReplacementDecisionParams,
    ctx: ReplacementRuleContext
  ): ReplacementOutcome {
    const sacrificeCount = params.sacrificeCount ?? 0;
    const candidates = params.sacrificeCandidates ?? [];
    const seq = nextEffectTimestamp(ctx.state);

    const originalEvent =
      params.event.type === 'DESTROY_ROLE'
        ? {
            type: 'DESTROY_ROLE' as const,
            cardInstanceId: params.event.cardInstanceId,
            reason: params.event.reason,
            attackerCardId: params.event.attackerCardId,
            combatCannotDealDamage: Boolean(ctx.state.currentCombat?.cannotDealDamage),
          }
        : {
            type: 'MOVE_CARD' as const,
            cardInstanceId: params.event.cardInstanceId,
            fromZone: params.event.fromZone,
            toZone: params.event.toZone,
            isFaceUp: params.event.isFaceUp,
            isReady: params.event.isReady,
            toBottom: params.event.toBottom,
            isOrphanCleanup: params.event.isOrphanCleanup,
            orphanHostCardId: params.event.orphanHostCardId,
            isPlacingUnderneath: params.event.isPlacingUnderneath,
            underneathHostId: params.event.underneathHostId,
            includeUnderneath: params.event.includeUnderneath,
            skipLeftFieldTrigger: params.event.skipLeftFieldTrigger,
            sentByEffectOrCost: params.event.sentByEffectOrCost,
            countAsDeckToGy: params.event.countAsDeckToGy,
          };

    if (ctx.enqueueChoice) {
      const effectType = params.choiceEffectType ?? 'OPTIONAL_REPLACEMENT_DECISION';

      // 情形 A：多张可选代价卡牌，由玩家直接选择代价卡牌（选 0 张表示放弃置换）
      if (candidates.length > 0 && sacrificeCount > 0 && candidates.length > sacrificeCount) {
        const firstCard = ctx.state.cards[candidates[0]!];
        ctx.enqueueChoice({
          id: `choice-repl-opt-${ctx.state.turnNumber}-${seq}`,
          playerId: params.controllerPlayerId,
          choiceType: 'SELECT_CARDS',
          prompt:
            params.prompt ??
            `${params.label}：请选择 ${sacrificeCount} 张卡牌作为置换代价（选 0 张放弃置换）`,
          options: candidates.map((cid) => {
            const c = ctx.state.cards[cid];
            const def = c
              ? ctx.cardDb.getCard(c.cardNumber) || (c.cardId ? ctx.cardDb.getCard(c.cardId) : undefined)
              : undefined;
            return {
              id: cid,
              label: `${def?.name ?? c?.cardNumber ?? cid}${c ? ` (${c.cardNumber})` : ''}`,
              payload: c ? { cardInstanceId: cid, cardNumber: c.cardNumber, zone: c.zone } : undefined,
            };
          }),
          effectType,
          sourceCardInstanceId: params.subjectCardId,
          minSelections: 0,
          maxSelections: sacrificeCount,
          metadata: {
            ruleId: params.ruleId,
            subjectCardId: params.subjectCardId,
            appliedIds: Array.from(params.appliedIds ?? []),
            originalEvent,
            costZone: firstCard?.zone,
            sacrificeCandidates: candidates,
            sacrificeCount,
            detachFromSubject: params.detachFromSubject,
            oncePerTurnUsageKey: params.oncePerTurnUsageKey,
            action: params.action,
          },
        });
        return { kind: 'PREVENT', pendingChoice: true };
      }

      // 情形 B：固定代价、唯一候选或零选牌代价 -> SELECT_OPTION
      const fixedIds =
        params.fixedSacrificeIds ??
        (candidates.length > 0
          ? candidates.slice(0, sacrificeCount > 0 ? sacrificeCount : candidates.length)
          : []);
      const declineId = effectType === 'BP01_017_OPTIONAL_LEAVE_REPLACEMENT' ? 'leave' : 'decline';
      ctx.enqueueChoice({
        id: `choice-repl-opt-${ctx.state.turnNumber}-${seq}`,
        playerId: params.controllerPlayerId,
        choiceType: 'SELECT_OPTION',
        prompt: params.prompt ?? `${params.label}：是否发动该置换效果？`,
        options: [
          { id: 'replace', label: params.replaceOptionLabel ?? '发动置换效果 (8.10)' },
          { id: declineId, label: params.declineOptionLabel ?? '不发动置换，按原事件结算' },
        ],
        effectType,
        sourceCardInstanceId: params.subjectCardId,
        minSelections: 1,
        maxSelections: 1,
        metadata: {
          ruleId: params.ruleId,
          subjectCardId: params.subjectCardId,
          appliedIds: Array.from(params.appliedIds ?? []),
          originalEvent,
          fixedSacrificeIds: fixedIds,
          detachFromSubject: params.detachFromSubject,
          oncePerTurnUsageKey: params.oncePerTurnUsageKey,
          action: params.action,
        },
      });
      return { kind: 'PREVENT', pendingChoice: true };
    }

    // 无决策回调时（独立引擎单元测试回退）直接执行代价支付与置换结果
    if (params.oncePerTurnUsageKey) {
      const player = ctx.state.players[params.controllerPlayerId];
      if (player) {
        player.turnAbilityUsage[params.oncePerTurnUsageKey] =
          (player.turnAbilityUsage[params.oncePerTurnUsageKey] ?? 0) + 1;
      }
    }
    const sacIds =
      params.fixedSacrificeIds ??
      (candidates.length > 0
        ? candidates.slice(0, sacrificeCount > 0 ? sacrificeCount : candidates.length)
        : []);
    if (params.detachFromSubject && sacIds.length > 0) {
      const subject = ctx.state.cards[params.subjectCardId];
      if (subject) {
        const sacSet = new Set(sacIds);
        const eqIds: string[] = [];
        if (subject.attachedEquipmentId) eqIds.push(subject.attachedEquipmentId);
        if (subject.extraAttachedEquipmentIds?.length) eqIds.push(...subject.extraAttachedEquipmentIds);
        const remain = eqIds.filter((id) => !sacSet.has(id));
        subject.attachedEquipmentId = remain[0];
        subject.extraAttachedEquipmentIds = remain.length > 1 ? remain.slice(1) : undefined;
      }
    }
    for (const sacId of sacIds) {
      if (ctx.sendCardToGraveyard) {
        ctx.sendCardToGraveyard(sacId, true);
      } else {
        const sac = ctx.state.cards[sacId];
        if (sac) {
          sac.zone = 'GRAVEYARD';
          sac.slotIndex = undefined;
          sac.isFaceUp = true;
        }
      }
    }
    return params.action;
  }

  private findBP01017Swords(
    event: ReplacementEvent,
    ctx: ReplacementRuleContext
  ): { card: CardInstance; smallId: string; largeId: string } | undefined {
    if (event.type === 'MOVE_CARD') {
      if (
        event.fromZone !== 'BATTLEFIELD' ||
        (event.toZone === 'BATTLEFIELD' && !event.isPlacingUnderneath) ||
        event.isOrphanCleanup
      ) {
        return undefined;
      }
    } else if (event.type !== 'DESTROY_ROLE') {
      return undefined;
    }
    const card = ctx.state.cards[event.cardInstanceId];
    if (!card || card.cardNumber !== 'BP01-017' || card.zone !== 'BATTLEFIELD') return undefined;
    if (ctx.hasLostAbilities(card.instanceId)) return undefined;

    const eqIds: string[] = [];
    if (card.attachedEquipmentId) eqIds.push(card.attachedEquipmentId);
    if (card.extraAttachedEquipmentIds?.length) eqIds.push(...card.extraAttachedEquipmentIds);
    if (eqIds.length < 2) return undefined;

    const getTraits = (eqId: string): string[] => {
      const eq = ctx.state.cards[eqId];
      if (!eq) return [];
      const def = ctx.cardDb.getCard(eq.cardNumber) || (eq.cardId ? ctx.cardDb.getCard(eq.cardId) : undefined);
      return def?.traits ?? [];
    };

    const smallId = eqIds.find((id) => getTraits(id).includes('小太刀'));
    const largeId = eqIds.find((id) => id !== smallId && getTraits(id).includes('大太刀'));
    if (!smallId || !largeId) return undefined;
    return { card, smallId, largeId };
  }

  private findBP02013Savers(
    event: ReplacementEvent,
    ctx: ReplacementRuleContext
  ): CardInstance[] {
    if (event.type !== 'DESTROY_ROLE' || event.reason !== 'BATTLE') return [];
    const dying = ctx.state.cards[event.cardInstanceId];
    if (!dying || dying.zone !== 'BATTLEFIELD') return [];
    const dyingDef =
      ctx.cardDb.getCard(dying.cardNumber) || (dying.cardId ? ctx.cardDb.getCard(dying.cardId) : undefined);
    const dyingCost = ctx.getEffectiveCardCost ? ctx.getEffectiveCardCost(dying.instanceId) : dyingDef?.cost;
    if (!dyingDef || dyingDef.cardType !== 'ROLE' || dyingDef.attribute !== 'FIRE' || (dyingCost ?? 99) > 6) {
      return [];
    }
    const fieldCards = ctx.getZoneCards(event.controllerPlayerId, 'BATTLEFIELD').filter((c) => {
      if (c.cardNumber !== 'BP02-013' || ctx.hasLostAbilities(c.instanceId)) return false;
      const slots = ctx.state.battlefields[event.controllerPlayerId] ?? [];
      return slots.some((s) => s.roleCardId === c.instanceId);
    });
    // Q&A·5：BP02-013 自身因战斗被破坏时不能将自身送墓代替，必须牺牲我方场上另一张《丽芙·极昼》
    return fieldCards.filter((c) => c.instanceId !== event.cardInstanceId);
  }

  private findBP02049Wanshimings(
    event: ReplacementEvent,
    ctx: ReplacementRuleContext
  ): { card: CardInstance; usageKey: string; handWanshimings: CardInstance[] } | undefined {
    if (event.type !== 'DESTROY_ROLE' || event.reason !== 'BATTLE') return undefined;
    const card = ctx.state.cards[event.cardInstanceId];
    if (!card || card.cardNumber !== 'BP02-049' || card.zone !== 'BATTLEFIELD') return undefined;
    if (ctx.hasLostAbilities(card.instanceId)) return undefined;
    const player = ctx.state.players[card.controllerPlayerId];
    if (!player) return undefined;
    const usageKey = `${card.instanceId}:BP02-049_BATTLE_SAVE`;
    if ((player.turnAbilityUsage[usageKey] ?? 0) > 0) return undefined;

    const handWanshimings = ctx.getZoneCards(card.controllerPlayerId, 'HAND').filter((h) => {
      if (ctx.hasTrait) return ctx.hasTrait(h.instanceId, '万世铭');
      const hDef = ctx.cardDb.getCard(h.cardNumber) || (h.cardId ? ctx.cardDb.getCard(h.cardId) : undefined);
      return Boolean(hDef?.traits?.includes('万世铭'));
    });
    if (handWanshimings.length === 0) return undefined;
    return { card, usageKey, handWanshimings };
  }

  private registerBuiltinReplacements(): void {
    // BP01-017 露西亚·深红囚影：该牌离场时，若同时装备<小太刀>和<大太刀>，将其放置到墓地并改为不离场 (8.10.1.a)
    this.registerRule({
      id: 'builtin:BP01-017_LEAVE_REPLACEMENT',
      label: '【露西亚·深红囚影】将装备的<小太刀>和<大太刀>置墓，改为不离场',
      eventTypes: ['DESTROY_ROLE', 'MOVE_CARD'],
      matches: (event, ctx) => Boolean(this.findBP01017Swords(event, ctx)),
      apply: (event, ctx, appliedIds) => {
        const found = this.findBP01017Swords(event, ctx);
        if (!found) return undefined;
        const { card, smallId, largeId } = found;
        const eqIds: string[] = [];
        if (card.attachedEquipmentId) eqIds.push(card.attachedEquipmentId);
        if (card.extraAttachedEquipmentIds?.length) eqIds.push(...card.extraAttachedEquipmentIds);

        // 文本为「可以将其放置到墓地。若如此做，改为不离场」：交由操控玩家自主选择是否发动置换
        if (ctx.enqueueChoice && (event.type === 'DESTROY_ROLE' || event.type === 'MOVE_CARD')) {
          const seq = nextEffectTimestamp(ctx.state);
          const originalEvent =
            event.type === 'DESTROY_ROLE'
              ? {
                  type: 'DESTROY_ROLE' as const,
                  reason: event.reason,
                  attackerCardId: event.attackerCardId,
                  combatCannotDealDamage: Boolean(ctx.state.currentCombat?.cannotDealDamage),
                }
              : {
                  type: 'MOVE_CARD' as const,
                  toZone: event.toZone,
                  isFaceUp: event.isFaceUp,
                  isReady: event.isReady,
                  toBottom: event.toBottom,
                  isPlacingUnderneath: event.isPlacingUnderneath,
                  underneathHostId: event.underneathHostId,
                  includeUnderneath: event.includeUnderneath,
                };
          ctx.enqueueChoice({
            id: `choice-bp01-017-leave-${ctx.state.turnNumber}-${seq}`,
            playerId: card.controllerPlayerId,
            choiceType: 'SELECT_OPTION',
            prompt: '【露西亚·深红囚影】即将离场：是否将装备的<小太刀>和<大太刀>放置到墓地，改为不离场？',
            options: [
              { id: 'replace', label: '送墓双刀，改为不离场 (8.10 置换)' },
              { id: 'leave', label: '不发动置换，让该牌离场' },
            ],
            effectType: 'BP01_017_OPTIONAL_LEAVE_REPLACEMENT',
            sourceCardInstanceId: card.instanceId,
            minSelections: 1,
            maxSelections: 1,
            metadata: {
              cardInstanceId: card.instanceId,
              smallId,
              largeId,
              originalEvent,
              appliedIds: Array.from(appliedIds ?? []),
            },
          });
          return { kind: 'PREVENT', pendingChoice: true };
        }

        // 无决策回调时（独立引擎单元测试回退）直接执行置换
        const remain = eqIds.filter((id) => id !== smallId && id !== largeId);
        card.attachedEquipmentId = remain[0];
        card.extraAttachedEquipmentIds = remain.length > 1 ? remain.slice(1) : undefined;
        for (const sacId of [smallId, largeId]) {
          if (ctx.sendCardToGraveyard) {
            ctx.sendCardToGraveyard(sacId);
          } else {
            const sac = ctx.state.cards[sacId];
            if (sac) {
              sac.zone = 'GRAVEYARD';
              sac.slotIndex = undefined;
              sac.isFaceUp = true;
            }
          }
        }
        return { kind: 'PREVENT' };
      },
    });

    // Q&A·9 BP04-065 莱特宁：装备角色《比安卡·真理》离场导致莱特宁无所属送墓时，强制置换为放置到我方信号球区最下方
    this.registerRule({
      id: 'builtin:BP04-065_ORPHAN_TO_ORB_BOTTOM',
      label: '【莱特宁】改为放置到我方信号球区最下方',
      eventTypes: ['MOVE_CARD'],
      matches: (event, ctx) => {
        if (event.type !== 'MOVE_CARD') return false;
        if (!event.isOrphanCleanup || event.toZone !== 'GRAVEYARD') return false;
        const card = ctx.state.cards[event.cardInstanceId];
        if (!card || card.cardNumber !== 'BP04-065') return false;
        if (ctx.hasLostAbilities(card.instanceId)) return false;
        if (event.orphanHostCardId && !ctx.hasCardName(event.orphanHostCardId, '比安卡·真理')) {
          return false;
        }
        return true;
      },
      apply: (event, ctx) => {
        if (event.type !== 'MOVE_CARD') return undefined;
        if (!event.isOrphanCleanup || event.toZone !== 'GRAVEYARD') return undefined;
        const card = ctx.state.cards[event.cardInstanceId];
        if (!card || card.cardNumber !== 'BP04-065') return undefined;
        if (ctx.hasLostAbilities(card.instanceId)) return undefined;
        // 校验离场宿主是否为《比安卡·真理》 (含卡牌名称「视为」效果)
        if (event.orphanHostCardId && !ctx.hasCardName(event.orphanHostCardId, '比安卡·真理')) {
          return undefined;
        }
        return {
          kind: 'REDIRECT_ZONE',
          zone: 'SIGNAL_ORB',
          isFaceUp: true,
          isReady: true,
          toBottom: true,
        };
      },
    });

    // Q&A·2 BP02-013 丽芙·极昼：我方的1张费用为6及以下的火属性角色因战斗被破坏时，可将战场该牌置墓，改为不破坏 (阻止贯通并触发效果送墓)
    this.registerRule({
      id: 'builtin:BP02-013_BATTLE_SAVE',
      label: '【丽芙·极昼】将战场《丽芙·极昼》置墓，改为不破坏',
      eventTypes: ['DESTROY_ROLE'],
      matches: (event, ctx) => this.findBP02013Savers(event, ctx).length > 0,
      apply: (event, ctx, appliedIds) => {
        if (event.type !== 'DESTROY_ROLE') return undefined;
        const savers = this.findBP02013Savers(event, ctx);
        if (savers.length === 0) return undefined;
        const dying = ctx.state.cards[event.cardInstanceId];
        const dyingDef = dying
          ? ctx.cardDb.getCard(dying.cardNumber) || (dying.cardId ? ctx.cardDb.getCard(dying.cardId) : undefined)
          : undefined;
        return this.enqueueOptionalReplacementDecision(
          {
            ruleId: 'builtin:BP02-013_BATTLE_SAVE',
            label: '【丽芙·极昼】将战场《丽芙·极昼》置墓，改为不破坏',
            controllerPlayerId: event.controllerPlayerId,
            subjectCardId: event.cardInstanceId,
            event,
            appliedIds,
            prompt: `【丽芙·极昼】「${dyingDef?.name ?? dying?.cardNumber ?? '火属性角色'}」即将因战斗被破坏，是否将我方战场上 1 张其他《丽芙·极昼》放置到墓地，改为不破坏？`,
            sacrificeCandidates: savers.map((s) => s.instanceId),
            sacrificeCount: 1,
            action: { kind: 'PREVENT' },
            replaceOptionLabel: '将战场《丽芙·极昼》置墓，改为不破坏 (8.10 置换)',
            declineOptionLabel: '不发动置换，让该角色被破坏',
          },
          ctx
        );
      },
    });

    // BP02-049 曲·启明：【自】【回合1】该牌因战斗被破坏时，可以将我方手牌1张<万世铭>放置到墓地。若如此做，改为不破坏。
    this.registerRule({
      id: 'builtin:BP02-049_BATTLE_SAVE',
      label: '【曲·启明】将手牌 1 张<万世铭>置墓，改为不破坏',
      eventTypes: ['DESTROY_ROLE'],
      matches: (event, ctx) => Boolean(this.findBP02049Wanshimings(event, ctx)),
      apply: (event, ctx, appliedIds) => {
        if (event.type !== 'DESTROY_ROLE') return undefined;
        const found = this.findBP02049Wanshimings(event, ctx);
        if (!found) return undefined;
        const { card, usageKey, handWanshimings } = found;
        return this.enqueueOptionalReplacementDecision(
          {
            ruleId: 'builtin:BP02-049_BATTLE_SAVE',
            label: '【曲·启明】将手牌 1 张<万世铭>置墓，改为不破坏',
            controllerPlayerId: card.controllerPlayerId,
            subjectCardId: card.instanceId,
            event,
            appliedIds,
            prompt: '【曲·启明】即将因战斗被破坏，是否将手牌 1 张<万世铭>放置到墓地，改为不破坏？（【回合1】）',
            sacrificeCandidates: handWanshimings.map((h) => h.instanceId),
            sacrificeCount: 1,
            oncePerTurnUsageKey: usageKey,
            action: { kind: 'PREVENT' },
            replaceOptionLabel: '将手牌 1 张<万世铭>置墓，改为不破坏 (8.10 置换)',
            declineOptionLabel: '不发动置换，让该角色被破坏',
          },
          ctx
        );
      },
    });
  }
}

function applyDamageModifier(
  current: number,
  action: { kind: 'MODIFY_DAMAGE'; delta?: number; setAmount?: number; maxAmount?: number }
): number {
  let next = current;
  if (action.setAmount !== undefined) {
    next = action.setAmount;
  }
  if (action.delta !== undefined) {
    next += action.delta;
  }
  if (action.maxAmount !== undefined) {
    next = Math.min(next, action.maxAmount);
  }
  return Math.max(0, next);
}
