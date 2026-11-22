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
  hasTrait?: (cardInstanceId: string, trait: string) => boolean;
  sendCardToGraveyard?: (cardInstanceId: string, sentByEffectOrCost?: boolean) => void;
  getMaxCostZoneCapacity?: (playerId: string) => number;
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
  private sendCardToGraveyardCallback?: (cardInstanceId: string, sentByEffectOrCost?: boolean) => void;
  private maxCostCapProvider?: (playerId: string) => number;

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
      sendCardToGraveyard: this.sendCardToGraveyardCallback,
      getMaxCostZoneCapacity: this.maxCostCapProvider,
    };
  }

  private registerBuiltinReplacements(): void {
    // BP01-017 露西亚·深红囚影：该牌离场时，若同时装备<小太刀>和<大太刀>，将其放置到墓地并改为不离场 (8.10.1.a)
    this.registerRule({
      id: 'builtin:BP01-017_LEAVE_REPLACEMENT',
      eventTypes: ['DESTROY_ROLE', 'MOVE_CARD'],
      apply: (event, ctx) => {
        if (event.type === 'MOVE_CARD') {
          if (event.fromZone !== 'BATTLEFIELD' || event.toZone === 'BATTLEFIELD' || event.isOrphanCleanup) {
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

        // 卸下并送入墓地
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

    // Q&A·2 BP02-013 丽芙·极昼：我方的1张费用为6及以下的火属性角色因战斗被破坏时，可将战场该牌置墓，改为不破坏 (阻止贯通并触发效果送墓)
    this.registerRule({
      id: 'builtin:BP02-013_BATTLE_SAVE',
      eventTypes: ['DESTROY_ROLE'],
      apply: (event, ctx) => {
        if (event.type !== 'DESTROY_ROLE' || event.reason !== 'BATTLE') return undefined;
        const dying = ctx.state.cards[event.cardInstanceId];
        if (!dying || dying.zone !== 'BATTLEFIELD') return undefined;
        const dyingDef =
          ctx.cardDb.getCard(dying.cardNumber) || (dying.cardId ? ctx.cardDb.getCard(dying.cardId) : undefined);
        if (!dyingDef || dyingDef.cardType !== 'ROLE' || dyingDef.attribute !== 'FIRE' || dyingDef.cost > 6) {
          return undefined;
        }
        const fieldCards = ctx.getZoneCards(event.controllerPlayerId, 'BATTLEFIELD').filter((c) => {
          if (c.cardNumber !== 'BP02-013' || ctx.hasLostAbilities(c.instanceId)) return false;
          // 必须是顶层战场角色 (排除下方牌/装备)
          const slots = ctx.state.battlefields[event.controllerPlayerId] ?? [];
          return slots.some((s) => s.roleCardId === c.instanceId);
        });
        // Q&A·5：BP02-013 自身因战斗被破坏时不能将自身送墓代替，必须牺牲我方场上另一张《丽芙·极昼》
        const saver = fieldCards.find((c) => c.instanceId !== event.cardInstanceId);
        if (!saver) return undefined;
        if (ctx.sendCardToGraveyard) {
          ctx.sendCardToGraveyard(saver.instanceId, true);
        } else {
          saver.zone = 'GRAVEYARD';
          saver.slotIndex = undefined;
          saver.isFaceUp = true;
        }
        return { kind: 'PREVENT' };
      },
    });

    // BP02-049 曲·启明：【自】【回合1】该牌因战斗被破坏时，可以将我方手牌1张<万世铭>放置到墓地。若如此做，改为不破坏。
    this.registerRule({
      id: 'builtin:BP02-049_BATTLE_SAVE',
      eventTypes: ['DESTROY_ROLE'],
      apply: (event, ctx) => {
        if (event.type !== 'DESTROY_ROLE' || event.reason !== 'BATTLE') return undefined;
        const card = ctx.state.cards[event.cardInstanceId];
        if (!card || card.cardNumber !== 'BP02-049' || card.zone !== 'BATTLEFIELD') return undefined;
        if (ctx.hasLostAbilities(card.instanceId)) return undefined;
        const player = ctx.state.players[card.controllerPlayerId];
        if (!player) return undefined;
        const usageKey = `${card.instanceId}:BP02-049_BATTLE_SAVE`;
        if ((player.turnAbilityUsage[usageKey] ?? 0) > 0) return undefined;

        const handWanshiming = ctx.getZoneCards(card.controllerPlayerId, 'HAND').find((h) => {
          if (ctx.hasTrait) return ctx.hasTrait(h.instanceId, '万世铭');
          const hDef = ctx.cardDb.getCard(h.cardNumber) || (h.cardId ? ctx.cardDb.getCard(h.cardId) : undefined);
          return Boolean(hDef?.traits?.includes('万世铭'));
        });
        if (!handWanshiming) return undefined;

        player.turnAbilityUsage[usageKey] = (player.turnAbilityUsage[usageKey] ?? 0) + 1;
        if (ctx.sendCardToGraveyard) {
          ctx.sendCardToGraveyard(handWanshiming.instanceId, true);
        } else {
          handWanshiming.zone = 'GRAVEYARD';
          handWanshiming.isFaceUp = true;
        }
        return { kind: 'PREVENT' };
      },
    });
  }
}
