import {
  ActiveReplacementEffect,
  CardInstance,
  GameState,
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
  | { kind: 'PREVENT' }
  | {
      kind: 'REDIRECT_ZONE';
      zone: ZoneId;
      isFaceUp?: boolean;
      isReady?: boolean;
      toBottom?: boolean;
    }
  | { kind: 'MODIFY_DAMAGE'; newAmount: number };

export interface ReplacementRuleContext {
  state: GameState;
  cardDb: ICardDatabase;
  getZoneCards: (playerId: string, zone: ZoneId) => CardInstance[];
  hasLostAbilities: (cardInstanceId: string) => boolean;
  hasCardName: (cardInstanceId: string, name: string) => boolean;
}

/**
 * 8.2.1.c / 8.10 静态或卡牌绑定的置换效果规则定义
 */
export interface ReplacementRule {
  id: string;
  eventTypes: ReplacementEventType[];
  /** 返回匹配并执行后的置换结果；返回 { kind: 'NONE' } 或 undefined 表示本次不适用 */
  apply: (event: ReplacementEvent, ctx: ReplacementRuleContext) => ReplacementOutcome | undefined;
}

export interface InterceptDestroyResult {
  replaced: boolean;
  prevented: boolean;
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
  toZone: ZoneId;
  isFaceUp?: boolean;
  isReady?: boolean;
  toBottom?: boolean;
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

  constructor(
    private state: GameState,
    private cardDb: ICardDatabase,
    private getZoneCards: (playerId: string, zone: ZoneId) => CardInstance[],
    private hasLostAbilities: (cardInstanceId: string) => boolean,
    private hasCardName: (cardInstanceId: string, name: string) => boolean
  ) {
    this.registerBuiltinReplacements();
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
    appliedIds: Set<string> = new Set()
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

    // 1. 先检查状态内置换效果 (activeReplacements)
    const activeMatch = this.findAndConsumeActiveReplacement(event, appliedIds);
    if (activeMatch) {
      appliedIds.add(activeMatch.id);
      if (activeMatch.action.kind === 'PREVENT') {
        return { replaced: true, prevented: true, appliedIds };
      }
      const adjusted = this.applyCostZoneCapRule(card.controllerPlayerId, activeMatch.action);
      return { replaced: true, prevented: true, redirect: adjusted, appliedIds };
    }

    // 2. 再检查已注册的静态/卡牌置换规则
    const ctx = this.makeContext();
    for (const rule of this.rules) {
      if (appliedIds.has(rule.id)) continue;
      if (!rule.eventTypes.includes('DESTROY_ROLE')) continue;
      const outcome = rule.apply(event, ctx);
      if (!outcome || outcome.kind === 'NONE') continue;
      appliedIds.add(rule.id);
      if (outcome.kind === 'PREVENT') {
        return { replaced: true, prevented: true, appliedIds };
      }
      if (outcome.kind === 'REDIRECT_ZONE') {
        const adjusted = this.applyCostZoneCapRule(card.controllerPlayerId, outcome);
        return { replaced: true, prevented: true, redirect: adjusted, appliedIds };
      }
    }

    return { replaced: false, prevented: false, appliedIds };
  }

  /**
   * 8.10 拦截卡牌区域移动 (支持多次链式置换，且 8.10.2.c 保证每条规则对同一事件最多适用一次)
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
    let replaced = false;

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
      };

      const activeMatch = this.findAndConsumeActiveReplacement(event, appliedIds);
      if (activeMatch) {
        appliedIds.add(activeMatch.id);
        replaced = true;
        if (activeMatch.action.kind === 'PREVENT') {
          return { replaced: true, prevented: true, toZone: fromZone, appliedIds };
        }
        const adjusted = this.applyCostZoneCapRule(card.controllerPlayerId, activeMatch.action);
        currentToZone = adjusted.zone;
        currentFaceUp = adjusted.isFaceUp;
        currentReady = adjusted.isReady;
        currentToBottom = adjusted.toBottom;
        continue;
      }

      let matchedRule = false;
      for (const rule of this.rules) {
        if (appliedIds.has(rule.id)) continue;
        if (!rule.eventTypes.includes('MOVE_CARD')) continue;
        const outcome = rule.apply(event, ctx);
        if (!outcome || outcome.kind === 'NONE') continue;
        appliedIds.add(rule.id);
        replaced = true;
        matchedRule = true;
        if (outcome.kind === 'PREVENT') {
          return { replaced: true, prevented: true, toZone: fromZone, appliedIds };
        }
        if (outcome.kind === 'REDIRECT_ZONE') {
          const adjusted = this.applyCostZoneCapRule(card.controllerPlayerId, outcome);
          currentToZone = adjusted.zone;
          currentFaceUp = adjusted.isFaceUp;
          currentReady = adjusted.isReady;
          currentToBottom = adjusted.toBottom;
        }
        break;
      }
      if (!matchedRule) break;
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
   * 8.10 拦截玩家受到的伤害量
   */
  interceptDealDamage(
    defenderPlayerId: string,
    amount: number,
    sourceCardId?: string,
    appliedIds: Set<string> = new Set()
  ): number {
    let current = amount;
    if (current <= 0) return 0;

    const ctx = this.makeContext();
    for (let guard = 0; guard < 10 && current > 0; guard++) {
      const event: ReplacementDamageEvent = {
        type: 'DEAL_DAMAGE',
        defenderPlayerId,
        amount: current,
        sourceCardId,
      };
      const activeMatch = this.findAndConsumeActiveReplacement(event, appliedIds);
      if (activeMatch) {
        appliedIds.add(activeMatch.id);
        if (activeMatch.action.kind === 'PREVENT') return 0;
      }

      let matchedRule = false;
      for (const rule of this.rules) {
        if (appliedIds.has(rule.id)) continue;
        if (!rule.eventTypes.includes('DEAL_DAMAGE')) continue;
        const outcome = rule.apply(event, ctx);
        if (!outcome || outcome.kind === 'NONE') continue;
        appliedIds.add(rule.id);
        matchedRule = true;
        if (outcome.kind === 'PREVENT') return 0;
        if (outcome.kind === 'MODIFY_DAMAGE') current = Math.max(0, outcome.newAmount);
        break;
      }
      if (!matchedRule) break;
    }
    return current;
  }

  private findAndConsumeActiveReplacement(
    event: ReplacementEvent,
    appliedIds: Set<string>
  ): ActiveReplacementEffect | undefined {
    const list = this.state.activeReplacements;
    if (!list || list.length === 0) return undefined;

    for (let i = 0; i < list.length; i++) {
      const item = list[i]!;
      if (appliedIds.has(item.id)) continue;
      if (item.eventType !== event.type) continue;
      if (item.untilTurn !== undefined && item.untilTurn < this.state.turnNumber) continue;

      if (event.type === 'DESTROY_ROLE') {
        if (item.targetCardInstanceId && item.targetCardInstanceId !== event.cardInstanceId) continue;
        if (!item.targetCardInstanceId && item.controllerPlayerId !== event.controllerPlayerId) continue;
        if (item.destroyReason && item.destroyReason !== event.reason) continue;
      } else if (event.type === 'MOVE_CARD') {
        if (item.targetCardInstanceId && item.targetCardInstanceId !== event.cardInstanceId) continue;
        if (!item.targetCardInstanceId && item.controllerPlayerId !== event.controllerPlayerId) continue;
        if (item.fromZone && item.fromZone !== event.fromZone) continue;
        if (item.toZone && item.toZone !== event.toZone) continue;
      } else if (event.type === 'DEAL_DAMAGE') {
        if (item.controllerPlayerId !== event.defenderPlayerId) continue;
      }

      if (item.once) {
        list.splice(i, 1);
        if (list.length === 0) this.state.activeReplacements = undefined;
      }
      return item;
    }
    return undefined;
  }

  /**
   * 3.6.4 / Q&A·5：置换效果要求放置到费用区，但费用区已达上限 (10张) 时，改为正面放置到墓地
   */
  private applyCostZoneCapRule(
    playerId: string,
    target: { zone: ZoneId; isFaceUp?: boolean; isReady?: boolean; toBottom?: boolean }
  ): { zone: ZoneId; isFaceUp?: boolean; isReady?: boolean; toBottom?: boolean } {
    if (target.zone === 'COST') {
      const costCount = this.getZoneCards(playerId, 'COST').length;
      if (costCount >= RULE_CONSTANTS.MAX_COST_ZONE_CAPACITY) {
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
    };
  }

  private registerBuiltinReplacements(): void {
    // Q&A·9 BP04-065 莱特宁：装备角色《比安卡·真理》离场导致莱特宁无所属送墓时，强制置换为放置到我方信号球区最下方
    this.registerRule({
      id: 'builtin:BP04-065_ORPHAN_TO_ORB_BOTTOM',
      eventTypes: ['MOVE_CARD'],
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
  }
}
