import {
  CardInstance,
  CardType,
  CardVersionData,
  ElementAttribute,
  SignalOrbColor,
  ZoneId,
} from '@zhanshuang/shared';
import { extractCoreCardNumber } from '@zhanshuang/game-rules';
import type { CardEffectContext } from '../card-effects.js';
import {
  expandBaseTraits,
  getModifierEffectiveCardType,
  normalizeCardName,
} from '../continuous-effects.js';
import type { CardTriggerSnapshot } from '../../priority/trigger-system.js';
import { getAttachedEquipmentIds } from '../../zone/battlefield-manager.js';
import type { DslInterpreterHost, DslStaticEvalContext } from './runtime-types.js';
import type {
  CardFilter,
  CardTargetRef,
  CompareOp,
  ConditionExpr,
  ModifierDuration,
  NumberExpr,
  OrbColorFilter,
  PlayerSide,
} from './types.js';

export interface OrbSlotInfo {
  isOrb: boolean;
  colors: string[];
  orbValue: number;
  cannotEliminate: boolean;
}

/**
 * 截取区域顶部或底部固定 N 张卡牌：
 * - DECK：index 0 为牌组顶，length - 1 为牌组底
 * - 非牌组 (SIGNAL_ORB / GRAVEYARD / PROCESSING 等)：index 0 为最下方，length - 1 为最上方
 */
export function sliceZoneEdge<T>(
  list: readonly T[],
  zone: ZoneId,
  edge: 'TOP' | 'BOTTOM',
  count: number
): T[] {
  if (count <= 0 || list.length === 0) return [];
  const takeFromStart =
    (zone === 'DECK' && edge === 'TOP') || (zone !== 'DECK' && edge === 'BOTTOM');
  return takeFromStart ? list.slice(0, count) : list.slice(-count).reverse();
}

/**
 * Q&A·1 (BP01-037)：判断一组信号球卡牌能否精确匹配目标信号球数量。
 * 每张视为 N 球 (v > 1) 的卡牌可选作 1 球或 v 球使用，不可拆成 1 与 v 之间的中间值。
 */
export function canMatchOrbCount(orbValues: number[], target: number): boolean {
  if (target < 0) return false;
  let sums = new Set<number>([0]);
  for (const v of orbValues) {
    if (v <= 0) return false;
    const opts = v > 1 ? [1, v] : [v];
    const next = new Set<number>();
    for (const s of sums) {
      for (const o of opts) {
        const ns = s + o;
        if (ns <= target) next.add(ns);
      }
    }
    if (next.size === 0) return false;
    sums = next;
  }
  return sums.has(target);
}

/**
 * 4.16.2 / Q&A·1 从已解析的信号球槽位信息中滑窗匹配所有可消除的相邻组合
 */
export function findOrbGroupsFromInfos(
  zoneCards: CardInstance[],
  infos: OrbSlotInfo[],
  size: number,
  filter: OrbColorFilter
): string[][] {
  if (size <= 0) return [];
  const groups: string[][] = [];
  for (let start = 0; start < zoneCards.length; start++) {
    let minSum = 0;
    let reachable = new Set<number>([0]);
    let commonColors: string[] | undefined;
    const sliceIds: string[] = [];

    for (let end = start; end < zoneCards.length; end++) {
      const info = infos[end]!;
      if (!info.isOrb || info.cannotEliminate || info.orbValue <= 0) break;

      if (filter !== 'ANY' && filter !== 'SAME' && !info.colors.includes(filter)) {
        break;
      }
      if (filter === 'SAME') {
        commonColors =
          commonColors === undefined
            ? [...info.colors]
            : commonColors.filter((col) => info.colors.includes(col as SignalOrbColor));
        if (commonColors.length === 0) break;
      }

      const opts = info.orbValue > 1 ? [1, info.orbValue] : [info.orbValue];
      const nextReachable = new Set<number>();
      for (const s of reachable) {
        for (const o of opts) {
          const ns = s + o;
          if (ns <= size) nextReachable.add(ns);
        }
      }
      reachable = nextReachable;
      minSum += 1;
      sliceIds.push(zoneCards[end]!.instanceId);
      if (reachable.has(size)) {
        groups.push([...sliceIds]);
      }
      if (minSum >= size || reachable.size === 0) break;
    }
  }
  return groups;
}

/**
 * 参数化卡牌过滤视图适配器 (统一 live / static / snapshot 三种求值模式)
 */
export interface CardFilterView {
  readonly mode: 'live' | 'static' | 'snapshot';
  readonly card: CardInstance;
  readonly def: CardVersionData | undefined;
  readonly controllerPlayerId: string;
  readonly zone: ZoneId;
  readonly isReady: boolean;
  readonly isAirborne: boolean;
  readonly isAttacking: boolean;
  readonly isBeingAttacked: boolean;
  readonly isInCombat: boolean;
  readonly wasAscendedPlay: boolean;
  readonly enteredFromZone: ZoneId | undefined;
  readonly ascendedFromAirborne: boolean;
  readonly hasEquipment: boolean;
  getEffectiveCardType(): CardType | undefined;
  hasTrait(trait: string): boolean;
  hasName(expectedName: string): boolean;
  getCost(): number;
  isSignalOrb(): boolean;
  matchesOrbColor(color: SignalOrbColor): boolean;
  getEffectivePP(): number;
  getSourceEffectivePP(sourceId: string): number;
  matchSubCard(subCard: CardInstance, subFilter: CardFilter, sourceId?: string): boolean;
}

/**
 * 声明式 DSL 求值与查询模块：
 * 承接目标解析、数值表达式、条件表达式（含静态条件）与统一卡牌过滤视图。
 */
export class DslEvaluator {
  constructor(private readonly host: DslInterpreterHost) {}

  resolveTargetIds(
    target: CardTargetRef,
    playerId: string,
    sourceId: string,
    vars: Record<string, string[]>
  ): string[] {
    switch (target.kind) {
      case 'SELF':
        return sourceId ? [sourceId] : [];
      case 'SELF_UNDERNEATH': {
        const selfCard = sourceId ? this.host.ctx.state.cards[sourceId] : undefined;
        return (selfCard?.underneathCardIds ?? []).filter((uid) => {
          const uc = this.host.ctx.state.cards[uid];
          return Boolean(uc && (!target.filter || this.matchesFilter(uc, target.filter, sourceId)));
        });
      }
      case 'SELF_PARTNER': {
        const pid = sourceId ? this.host.ctx.state.cards[sourceId]?.partnerCardId : undefined;
        return pid ? [pid] : [];
      }
      case 'EQUIPPED_HOST': {
        if (!sourceId) return [];
        const oppId = this.host.resolveSide(playerId, 'OPPONENT');
        for (const pid of [playerId, oppId]) {
          for (const host of this.host.fieldTopHosts(pid)) {
            if (!getAttachedEquipmentIds(host).includes(sourceId)) continue;
            if (target.filter && !this.matchesFilter(host, target.filter, sourceId)) {
              return [];
            }
            return [host.instanceId];
          }
        }
        return [];
      }
      case 'ZONE_BOTTOM_CARD': {
        const sidePlayer = this.host.resolveSide(playerId, target.side);
        const list = this.host.zone(sidePlayer, target.zone);
        return sliceZoneEdge(list, target.zone, 'BOTTOM', 1).map((c) => c.instanceId);
      }
      case 'ZONE_SLICE': {
        const sidePlayer = this.host.resolveSide(playerId, target.side);
        const list = this.host.zone(sidePlayer, target.zone);
        return sliceZoneEdge(list, target.zone, target.edge, target.count)
          .filter((c) => !target.filter || this.matchesFilter(c, target.filter, sourceId))
          .map((c) => c.instanceId);
      }
      case 'TRIGGER_ATTACKER':
        return vars.__triggerAttacker ?? [];
      case 'TRIGGER_BLOCKER':
        return vars.__triggerBlocker ?? [];
      case 'TRIGGER_HOST':
        return vars.__triggerHost ?? [];
      case 'TRIGGER_TARGET':
        return vars.__triggerTarget ?? [];
      case 'VAR':
        return vars[target.varName] ?? [];
      case 'REST_OF_VAR': {
        const all = vars[target.allVar] ?? [];
        const excluded = new Set(vars[target.excludeVar] ?? []);
        return all.filter((id) => !excluded.has(id));
      }
      case 'ALL_MATCHING_ROLES': {
        const roles =
          target.side === 'ANY'
            ? [
                ...this.host.roles(playerId),
                ...this.host.roles(this.host.resolveSide(playerId, 'OPPONENT')),
              ]
            : this.host.roles(this.host.resolveSide(playerId, target.side));
        return roles
          .filter((r) => !target.filter || this.matchesFilter(r, target.filter, sourceId))
          .map((r) => r.instanceId);
      }
      case 'ZONE_CARDS': {
        const sidePlayer = this.host.resolveSide(playerId, target.side);
        return this.host
          .zone(sidePlayer, target.zone)
          .filter((c) => !target.filter || this.matchesFilter(c, target.filter, sourceId))
          .map((c) => c.instanceId);
      }
      case 'HOST_UNDERNEATH_MATCHING': {
        const sidePlayer = this.host.resolveSide(playerId, target.side);
        const result: string[] = [];
        for (const host of this.host.fieldTopHosts(sidePlayer)) {
          if (target.roleFilter && !this.matchesFilter(host, target.roleFilter, sourceId)) continue;
          for (const uid of host.underneathCardIds ?? []) {
            const uc = this.host.ctx.state.cards[uid];
            if (!uc) continue;
            if (target.cardFilter && !this.matchesFilter(uc, target.cardFilter, sourceId)) continue;
            result.push(uid);
          }
        }
        return result;
      }
    }
  }

  evalNumberExpr(
    expr: NumberExpr,
    playerId: string,
    sourceId: string,
    vars: Record<string, string[]> = {},
    staticCtx?: DslStaticEvalContext
  ): number {
    if (typeof expr === 'number') return expr;
    const resolveRoles = (pid: string) =>
      staticCtx ? staticCtx.getFieldRoles(pid) : this.host.roles(pid);
    const resolveTopHosts = (pid: string) =>
      (this.host.ctx.state.battlefields[pid] ?? [])
        .flatMap((s) => [s.roleCardId, s.assistCardId, s.standaloneEquipmentId])
        .map((id) => (id ? this.host.ctx.state.cards[id] : undefined))
        .filter((c): c is CardInstance => Boolean(c));
    const resolveZone = (pid: string, z: ZoneId) =>
      staticCtx ? staticCtx.getCardsInZone(pid, z) : this.host.zone(pid, z);
    const checkFilter = (c: CardInstance, f: CardFilter) =>
      staticCtx
        ? this.matchesFilterSafe(c, f, staticCtx.hasTraitFn, sourceId, undefined, true)
        : this.matchesFilter(c, f, sourceId);

    switch (expr.kind) {
      case 'EROSION_MULT': {
        const pid = this.host.resolveSide(playerId, expr.side);
        return (this.host.ctx.state.players[pid]?.erosionCount ?? 0) * expr.multiplier;
      }
      case 'ROLE_COUNT_MULT': {
        const pid = this.host.resolveSide(playerId, expr.side);
        const count = resolveRoles(pid).filter(
          (r) => !expr.filter || checkFilter(r, expr.filter)
        ).length;
        return count * expr.multiplier;
      }
      case 'UNDERNEATH_COUNT_MULT': {
        const ids = (this.host.ctx.state.cards[sourceId]?.underneathCardIds ?? []).filter((id) => {
          const c = this.host.ctx.state.cards[id];
          return Boolean(c && (!expr.filter || checkFilter(c, expr.filter)));
        });
        if (expr.uniqueCardNumbers) {
          const nums = new Set<string>();
          for (const id of ids) {
            const c = this.host.ctx.state.cards[id];
            if (c) nums.add(extractCoreCardNumber(c.cardNumber));
          }
          return nums.size * expr.multiplier;
        }
        if (!expr.uniqueNames) return ids.length * expr.multiplier;
        const names = new Set<string>();
        for (const id of ids) {
          const c = this.host.ctx.state.cards[id];
          const name = c ? this.host.def(c)?.name : undefined;
          if (name) names.add(normalizeCardName(name));
        }
        return names.size * expr.multiplier;
      }
      case 'SUM_UNDERNEATH_COUNT': {
        const pid = this.host.resolveSide(playerId, expr.side);
        const hosts = resolveTopHosts(pid).filter(
          (r) => !expr.roleFilter || checkFilter(r, expr.roleFilter)
        );
        const seenNames = new Set<string>();
        const seenCardNumbers = new Set<string>();
        let total = 0;
        for (const h of hosts) {
          for (const uid of h.underneathCardIds ?? []) {
            const c = this.host.ctx.state.cards[uid];
            if (!c) continue;
            if (expr.filter && !checkFilter(c, expr.filter)) continue;
            if (expr.uniqueCardNumbers) {
              seenCardNumbers.add(extractCoreCardNumber(c.cardNumber));
            } else if (expr.uniqueNames) {
              const name = this.host.def(c)?.name;
              if (name) seenNames.add(normalizeCardName(name));
            } else {
              total += 1;
            }
          }
        }
        const count = expr.uniqueCardNumbers
          ? seenCardNumbers.size
          : expr.uniqueNames
            ? seenNames.size
            : total;
        return count * (expr.multiplier ?? 1);
      }
      case 'ORB_ZONE_COUNT_MULT': {
        const pid = this.host.resolveSide(playerId, expr.side);
        const count = resolveZone(pid, 'SIGNAL_ORB').filter(
          (c) => !expr.filter || checkFilter(c, expr.filter)
        ).length;
        return count * expr.multiplier;
      }
      case 'ZONE_COUNT_MULT': {
        const pid = this.host.resolveSide(playerId, expr.side);
        const matched = resolveZone(pid, expr.zone).filter(
          (c) => !expr.filter || checkFilter(c, expr.filter)
        );
        if (expr.uniqueCardNumbers) {
          const nums = new Set<string>();
          for (const c of matched) {
            nums.add(extractCoreCardNumber(c.cardNumber));
          }
          return nums.size * expr.multiplier;
        }
        if (!expr.uniqueNames) return matched.length * expr.multiplier;
        const names = new Set<string>();
        for (const c of matched) {
          const name = this.host.def(c)?.name;
          if (name) names.add(name);
        }
        return names.size * expr.multiplier;
      }
      case 'VAR_COUNT_MULT':
        return (vars[expr.varName]?.length ?? 0) * expr.multiplier;
      case 'VAR_DISTINCT_COST_MULT': {
        const distinctCosts = new Set<number>();
        for (const id of vars[expr.varName] ?? []) {
          const c = this.host.ctx.state.cards[id];
          const cost = c ? this.getRevealedCardEffectiveCost(c, vars) : undefined;
          if (cost !== undefined) distinctCosts.add(cost);
        }
        return distinctCosts.size * expr.multiplier;
      }
      case 'FLOOR_DIV':
        return Math.floor(
          this.evalNumberExpr(expr.expr, playerId, sourceId, vars, staticCtx) / expr.divisor
        );
      case 'ADD':
        return (
          this.evalNumberExpr(expr.left, playerId, sourceId, vars, staticCtx) +
          this.evalNumberExpr(expr.right, playerId, sourceId, vars, staticCtx)
        );
    }
  }

  evalConditionWithResolvers(
    cond: ConditionExpr,
    playerId: string,
    sourceId: string,
    vars: Record<string, string[]>,
    state: CardEffectContext['state'],
    getCardsInZone: (pid: string, z: ZoneId) => CardInstance[],
    getFieldRoles: (pid: string) => CardInstance[],
    hasTraitFn: (cardInstanceId: string, trait: string) => boolean,
    inStaticEval: boolean
  ): boolean {
    const resolveSide = (side: PlayerSide) =>
      side === 'SELF'
        ? playerId
        : playerId === state.activePlayerId
          ? state.nonActivePlayerId
          : state.activePlayerId;

    const matchCard = (c: CardInstance, filter: CardFilter): boolean =>
      inStaticEval
        ? this.matchesFilterSafe(c, filter, hasTraitFn, sourceId, undefined, true)
        : this.matchesFilter(c, filter, sourceId);

    switch (cond.kind) {
      case 'HAS_ROLE': {
        const pid = resolveSide(cond.side);
        const count = getFieldRoles(pid).filter(
          (r) => !cond.filter || matchCard(r, cond.filter)
        ).length;
        return count >= (cond.minCount ?? 1);
      }
      case 'EROSION_COMPARE': {
        const pid = resolveSide(cond.side);
        return this.compare(state.players[pid]?.erosionCount ?? 0, cond.op, cond.value);
      }
      case 'EROSION_CHANGED_THIS_TURN': {
        const pid = resolveSide(cond.side);
        return Boolean(state.players[pid]?.erosionChangedThisTurn);
      }
      case 'OPEN_COST_COMPARE_OPPONENT': {
        const oppId = resolveSide('OPPONENT');
        const selfOpen = state.players[playerId]?.openCostCount ?? 0;
        const oppOpen = state.players[oppId]?.openCostCount ?? 0;
        return this.compare(selfOpen, cond.op, oppOpen);
      }
      case 'COST_LIMIT_COMPARE_OPPONENT': {
        const oppId = resolveSide('OPPONENT');
        const selfLimit = getCardsInZone(playerId, 'COST').length;
        const oppLimit = getCardsInZone(oppId, 'COST').length;
        return this.compare(selfLimit, cond.op, oppLimit);
      }
      case 'FRIENDLY_ROLE_COUNT_COMPARE_OPPONENT': {
        const oppId = resolveSide('OPPONENT');
        return this.compare(getFieldRoles(playerId).length, cond.op, getFieldRoles(oppId).length);
      }
      case 'SIGNAL_ORB_BOTTOM_COST_PARITY': {
        const bottom = getCardsInZone(playerId, 'SIGNAL_ORB')[0];
        if (!bottom || !bottom.isFaceUp) return false;
        const cost =
          this.host.ctx.continuousEffects && (!inStaticEval || bottom.instanceId !== sourceId)
            ? this.host.ctx.continuousEffects.getEffectiveCardCost(bottom.instanceId)
            : this.host.def(bottom)?.cost;
        if (cost === undefined) return false;
        return cond.parity === 'ODD' ? cost % 2 === 1 : cost % 2 === 0;
      }
      case 'SELF_UNDERNEATH_COUNT': {
        const src = state.cards[sourceId];
        const underCards = (src?.underneathCardIds ?? [])
          .map((id) => state.cards[id])
          .filter((c): c is CardInstance => Boolean(c));
        const count = underCards.filter((c) => !cond.filter || matchCard(c, cond.filter)).length;
        return this.compare(count, cond.op, cond.value);
      }
      case 'TOTAL_UNDERNEATH_COUNT': {
        const pid = resolveSide(cond.side);
        const topHosts = (state.battlefields[pid] ?? [])
          .flatMap((s) => [s.roleCardId, s.assistCardId, s.standaloneEquipmentId])
          .map((id) => (id ? state.cards[id] : undefined))
          .filter((c): c is CardInstance => Boolean(c));
        const hosts = topHosts.filter((r) => !cond.roleFilter || matchCard(r, cond.roleFilter));
        let count = 0;
        for (const h of hosts) {
          for (const uid of h.underneathCardIds ?? []) {
            const c = state.cards[uid];
            if (c && (!cond.filter || matchCard(c, cond.filter))) count += 1;
          }
        }
        return this.compare(count, cond.op, cond.value);
      }
      case 'ANY_HOST_UNDERNEATH_CONTAINS': {
        const pid = resolveSide(cond.side);
        const topHosts = (state.battlefields[pid] ?? [])
          .flatMap((s) => [s.roleCardId, s.assistCardId, s.standaloneEquipmentId])
          .map((id) => (id ? state.cards[id] : undefined))
          .filter((c): c is CardInstance => Boolean(c));
        return topHosts
          .filter((r) => !cond.roleFilter || matchCard(r, cond.roleFilter))
          .some((r) =>
            (r.underneathCardIds ?? []).some((uid) => {
              const c = state.cards[uid];
              return Boolean(c && matchCard(c, cond.cardFilter));
            })
          );
      }
      case 'SELF_MATCHES_FILTER': {
        const src = state.cards[sourceId];
        return Boolean(src && matchCard(src, cond.filter));
      }
      case 'GAME_ABILITY_UNUSED':
        return (state.players[playerId]?.gameAbilityUsage?.[cond.abilityKey] ?? 0) === 0;
      case 'TURN_ABILITY_UNUSED':
        return (
          (state.players[playerId]?.turnAbilityUsage?.[`${sourceId}:${cond.abilityKey}`] ?? 0) ===
          0
        );
      case 'ZONE_COUNT': {
        const pid = resolveSide(cond.side);
        const count = getCardsInZone(pid, cond.zone).filter(
          (c) => !cond.filter || matchCard(c, cond.filter)
        ).length;
        return this.compare(count, cond.op, cond.value);
      }
      case 'ALL_ZONE_CARDS_MATCH': {
        const pid = resolveSide(cond.side);
        const pre = getCardsInZone(pid, cond.zone).filter(
          (c) => !cond.preFilter || matchCard(c, cond.preFilter)
        );
        return pre.every((c) => matchCard(c, cond.matchFilter));
      }
      case 'ALL_ROLES_MATCH': {
        const pid = resolveSide(cond.side);
        const roles = getFieldRoles(pid);
        if (cond.requireAtLeastOne && roles.length === 0) return false;
        return roles.every((r) => matchCard(r, cond.filter));
      }
      case 'ROLE_ATTRIBUTE_DIVERSITY': {
        const pid = resolveSide(cond.side);
        const attrs = new Set<ElementAttribute>();
        for (const r of getFieldRoles(pid)) {
          if (cond.filter && !matchCard(r, cond.filter)) continue;
          const attr = this.host.def(r)?.attribute;
          if (attr) attrs.add(attr);
        }
        return attrs.size >= cond.minDistinct;
      }
      case 'HAS_EMPTY_SLOT': {
        const pid = resolveSide(cond.side);
        return (state.battlefields[pid] ?? []).some(
          (s) => !s.roleCardId && !s.standaloneEquipmentId && !s.assistCardId
        );
      }
      case 'TURN_OWNER':
        return cond.isSelfTurn
          ? state.activePlayerId === playerId
          : state.activePlayerId !== playerId;
      case 'CURRENT_COMBAT_EXISTS':
        return Boolean(state.currentCombat);
      case 'IS_ENTER_TURN': {
        const src = state.cards[sourceId];
        return Boolean(src && src.zone === 'BATTLEFIELD' && src.turnEnteredZone === state.turnNumber);
      }
      case 'IS_DEPLOYED_FROM_PROCESSING_TURN': {
        const src = state.cards[sourceId];
        return Boolean(
          src &&
            src.zone === 'BATTLEFIELD' &&
            src.turnEnteredZone === state.turnNumber &&
            src.enteredFromZone === 'PROCESSING'
        );
      }
      case 'CARD_WAS_ASCENDED_PLAY':
        return Boolean(state.cards[sourceId]?.wasAscendedPlay);
      case 'CARD_WAS_ASCENDED_FROM_AIRBORNE':
        return Boolean(state.cards[sourceId]?.ascendedFromAirborne);
      case 'CARD_ENTERED_FROM_ZONE': {
        const src = state.cards[sourceId];
        return Boolean(src?.enteredFromZone && cond.zones.includes(src.enteredFromZone));
      }
      case 'CARD_PAID_HIDDEN_COST_ON_PLAY':
        return Boolean(state.cards[sourceId]?.paidHiddenCostOnPlay);
      case 'COMBAT_CHARGED_AUTO':
        return Boolean(
          state.currentCombat?.attackChargedHasChargeAuto || vars.__combatChargedAuto?.[0] === '1'
        );
      case 'CHARGED_AUTO_BY_LEE_THIS_TURN':
        return Boolean(state.players[playerId]?.chargedAutoByLeeThisTurn);
      case 'DESTROYED_FRIENDLY_ROLES_THIS_TURN':
        return this.compare(
          state.players[playerId]?.destroyedFriendlyRoleCountThisTurn ?? 0,
          cond.op,
          cond.value
        );
      case 'ELIMINATED_THREE_ORBS_THIS_TURN': {
        const pid = resolveSide(cond.side);
        return Boolean(state.players[pid]?.eliminatedThreeOrbsThisTurn);
      }
      case 'ELIMINATED_ORBS_BY_KARENINA_THIS_TURN':
        return this.compare(
          state.players[playerId]?.eliminatedOrbsByKareninaCountThisTurn ?? 0,
          cond.op,
          cond.value
        );
      case 'DAMAGE_TAKEN_THIS_TURN': {
        const pid = resolveSide(cond.side);
        return this.compare(state.players[pid]?.damageTakenThisTurn ?? 0, cond.op, cond.value);
      }
      case 'CARDS_PLAYED_THIS_TURN': {
        const pid = resolveSide(cond.side);
        return this.compare(state.players[pid]?.cardsPlayedThisTurn ?? 0, cond.op, cond.value);
      }
      case 'ART_ASSOC_TACTICS_PLAYED_THIS_TURN': {
        const pid = resolveSide(cond.side);
        return this.compare(
          state.players[pid]?.turnArtAssocTacticsPlayedCount ?? 0,
          cond.op,
          cond.value
        );
      }
      case 'VAR_NON_EMPTY':
        return (vars[cond.varName]?.length ?? 0) > 0;
      case 'VAR_COUNT_COMPARE':
        return this.compare(vars[cond.varName]?.length ?? 0, cond.op, cond.value);
      case 'VAR_HAS_CARD_MATCHING':
        return (vars[cond.varName] ?? []).some((id) => {
          const card = state.cards[id];
          return Boolean(card && matchCard(card, cond.filter));
        });
      case 'VAR_HAS_DUPLICATE_COST': {
        const seen = new Set<number>();
        for (const id of vars[cond.varName] ?? []) {
          const c = state.cards[id];
          const cost = c ? this.getRevealedCardEffectiveCost(c, vars) : undefined;
          if (cost === undefined) continue;
          if (seen.has(cost)) return true;
          seen.add(cost);
        }
        return false;
      }
      case 'ELIMINATED_ORB_COLOR_COUNT': {
        const validOrbColors = new Set<string>(['RED', 'BLUE', 'YELLOW']);
        const distinctColors = new Set<string>();
        const snapshot = vars[`__orbColors:${cond.varName}`];
        if (snapshot !== undefined) {
          for (const col of snapshot) {
            if (validOrbColors.has(col)) distinctColors.add(col);
          }
        } else {
          for (const id of vars[cond.varName] ?? []) {
            const c = state.cards[id];
            const col = c ? this.host.def(c)?.signalOrb : undefined;
            if (col && validOrbColors.has(col)) distinctColors.add(col);
          }
        }
        return this.compare(distinctColors.size, cond.op, cond.value);
      }
      case 'HAS_ELIMINABLE_ORBS': {
        if (!inStaticEval) {
          return this.host.orbGroups(playerId, cond.count, cond.filter).length > 0;
        }
        // 静态持续效果求值期禁止重入 continuousEffects / fieldMgr，直接基于传入信号球区与 cardDb 判定
        const orbZoneCards = getCardsInZone(playerId, 'SIGNAL_ORB');
        const infos: OrbSlotInfo[] = orbZoneCards.map((c) => {
          if (!c.isFaceUp) {
            return { isOrb: false, colors: [], orbValue: 0, cannotEliminate: false };
          }
          const baseColor = this.host.def(c)?.signalOrb;
          const colors = new Set<string>(baseColor ? [baseColor] : []);
          let orbValue: number | undefined;
          let cannotEliminate = false;
          for (const m of c.modifiers ?? []) {
            if (m.treatedAsOrbColors) {
              for (const col of m.treatedAsOrbColors) colors.add(col);
            }
            if (m.orbValue !== undefined) orbValue = m.orbValue;
            if (m.prohibitions?.includes('CANNOT_ELIMINATE')) cannotEliminate = true;
          }
          const colorList = Array.from(colors);
          return {
            isOrb: colorList.length > 0,
            colors: colorList,
            orbValue: orbValue ?? (colorList.length > 0 ? 1 : 0),
            cannotEliminate,
          };
        });
        return findOrbGroupsFromInfos(orbZoneCards, infos, cond.count, cond.filter).length > 0;
      }
      case 'IS_STANDALONE_EQUIPMENT': {
        if (!sourceId) return false;
        if (!inStaticEval) {
          return this.host.ctx.fieldMgr.isStandaloneEquipment(playerId, sourceId);
        }
        // 静态求值期直接基于传入 state.battlefields 判定，避免回呼 fieldMgr
        return (state.battlefields[playerId] ?? []).some(
          (s) => s.standaloneEquipmentId === sourceId
        );
      }
      case 'PARTNER_FROM_ZONE': {
        if (inStaticEval) return false;
        const fromZone = vars.__partnerFromZone?.[0] as ZoneId | undefined;
        return Boolean(fromZone && cond.zones.includes(fromZone));
      }
      case 'ALL':
        return cond.conditions.every((c) =>
          this.evalConditionWithResolvers(
            c,
            playerId,
            sourceId,
            vars,
            state,
            getCardsInZone,
            getFieldRoles,
            hasTraitFn,
            inStaticEval
          )
        );
      case 'ANY':
        return cond.conditions.some((c) =>
          this.evalConditionWithResolvers(
            c,
            playerId,
            sourceId,
            vars,
            state,
            getCardsInZone,
            getFieldRoles,
            hasTraitFn,
            inStaticEval
          )
        );
      case 'NOT':
        return !this.evalConditionWithResolvers(
          cond.condition,
          playerId,
          sourceId,
          vars,
          state,
          getCardsInZone,
          getFieldRoles,
          hasTraitFn,
          inStaticEval
        );
    }
  }

  evalCondition(
    cond: ConditionExpr,
    playerId: string,
    sourceId: string,
    vars: Record<string, string[]>
  ): boolean {
    return this.evalConditionWithResolvers(
      cond,
      playerId,
      sourceId,
      vars,
      this.host.ctx.state,
      (pid, z) => this.host.zone(pid, z),
      (pid) => this.host.roles(pid),
      (id, trait) => {
        const card = this.host.ctx.state.cards[id];
        return Boolean(card && this.host.hasTrait(card, trait));
      },
      false
    );
  }

  /**
   * 8.9.1.d 持续效果静态条件求值 (使用 ContinuousEffectEngine 提供的无递归 hasTrait)
   */
  evalStaticCondition(
    cond: ConditionExpr,
    playerId: string,
    sourceId: string,
    state: CardEffectContext['state'],
    getCardsInZone: (pid: string, z: ZoneId) => CardInstance[],
    getFieldRoles: (pid: string) => CardInstance[],
    hasTrait: (cardInstanceId: string, trait: string) => boolean
  ): boolean {
    return this.evalConditionWithResolvers(
      cond,
      playerId,
      sourceId,
      {},
      state,
      getCardsInZone,
      getFieldRoles,
      hasTrait,
      true
    );
  }

  matchesFilter(
    card: CardInstance,
    filter: CardFilter,
    sourceId?: string,
    options?: { allowFaceDownSignalOrb?: boolean }
  ): boolean {
    return this.matchesFilterSafe(
      card,
      filter,
      (id, trait) => {
        const target = this.host.ctx.state.cards[id];
        return Boolean(target && this.host.hasTrait(target, trait));
      },
      sourceId,
      (id, name) => {
        const target = this.host.ctx.state.cards[id];
        if (!target) return false;
        return this.host.ctx.continuousEffects
          ? this.host.ctx.continuousEffects.hasCardName(id, name)
          : this.host.def(target)?.name === name;
      },
      false,
      options?.allowFaceDownSignalOrb ?? false
    );
  }

  matchesFilterSafe(
    card: CardInstance,
    filter: CardFilter,
    hasTraitFn: (cardInstanceId: string, trait: string) => boolean,
    sourceId?: string,
    hasNameFn?: (cardInstanceId: string, name: string) => boolean,
    inStaticEval = false,
    allowFaceDownSignalOrb = false
  ): boolean {
    const view = this.createLiveOrStaticView(
      card,
      hasTraitFn,
      hasNameFn,
      inStaticEval,
      allowFaceDownSignalOrb
    );
    return this.matchesFilterWithView(view, filter, sourceId);
  }

  /**
   * 8.7.4 利用离开瞬间快照判定过滤条件 (用于离场/从牌组送墓/从墓地放牌组底等触发匹配)
   */
  matchesFilterWithSnapshot(
    card: CardInstance,
    snapshot: CardTriggerSnapshot | undefined,
    filter: CardFilter,
    sourceId?: string
  ): boolean {
    if (!snapshot) {
      return this.matchesFilter(card, filter, sourceId);
    }
    const view = this.createSnapshotView(card, snapshot);
    return this.matchesFilterWithView(view, filter, sourceId);
  }

  private createLiveOrStaticView(
    card: CardInstance,
    hasTraitFn: (cardInstanceId: string, trait: string) => boolean,
    hasNameFn: ((cardInstanceId: string, name: string) => boolean) | undefined,
    inStaticEval: boolean,
    allowFaceDownSignalOrb = false
  ): CardFilterView {
    const def = this.host.def(card);
    const continuousEffects = this.host.ctx.continuousEffects;
    const combat = this.host.ctx.state.currentCombat;
    const isAttacking = Boolean(combat && combat.attackerCardId === card.instanceId);
    const isBeingAttacked = Boolean(
      combat?.targetType === 'CHARACTER' && combat.targetCardId === card.instanceId
    );
    return {
      mode: inStaticEval ? 'static' : 'live',
      card,
      def,
      controllerPlayerId: card.controllerPlayerId,
      zone: card.zone,
      isReady: card.isReady,
      isAirborne: Boolean(card.isAirborne),
      isAttacking,
      isBeingAttacked,
      isInCombat: isAttacking || isBeingAttacked,
      wasAscendedPlay: Boolean(card.wasAscendedPlay),
      enteredFromZone: card.enteredFromZone,
      ascendedFromAirborne: Boolean(card.ascendedFromAirborne),
      hasEquipment: getAttachedEquipmentIds(card).length > 0,
      getEffectiveCardType: () =>
        !inStaticEval && continuousEffects
          ? continuousEffects.getEffectiveCardType(card.instanceId)
          : getModifierEffectiveCardType(card, def),
      hasTrait: (trait) => hasTraitFn(card.instanceId, trait),
      hasName: (expectedName) => {
        const normExpected = normalizeCardName(expectedName);
        return hasNameFn
          ? hasNameFn(card.instanceId, expectedName)
          : Boolean(def && normalizeCardName(def.name) === normExpected) ||
              Boolean(
                card.modifiers?.some((m) =>
                  m.treatedAsNames?.some((n) => normalizeCardName(n) === normExpected)
                )
              ) ||
              (card.cardNumber === 'BP02-040' && normExpected === '飞叶点翠');
      },
      getCost: () => {
        let cost: number;
        if (!inStaticEval && continuousEffects) {
          cost = continuousEffects.getEffectiveCardCost(card.instanceId);
        } else {
          cost = def?.cost ?? 99;
          if (card.zone === 'BATTLEFIELD' && card.partnerCardId) {
            const partner = this.host.ctx.state.cards[card.partnerCardId];
            if (partner) cost += this.host.def(partner)?.cost ?? 0;
          }
          for (const m of card.modifiers ?? []) {
            if (m.setCost !== undefined) cost = m.setCost;
            else if (m.costDelta !== undefined) cost += m.costDelta;
          }
          cost = Math.max(0, cost);
        }
        if (
          !inStaticEval &&
          (card.zone === 'HAND' ||
            (card.cardNumber === 'BP01-002' &&
              (card.zone === 'DECK' ||
                (card.zone === 'PROCESSING' && card.enteredFromZone === 'DECK'))))
        ) {
          cost = Math.max(
            0,
            cost - this.host.calculateHandCostDiscount(card.controllerPlayerId, card.cardNumber)
          );
        }
        return cost;
      },
      isSignalOrb: () => {
        if (inStaticEval) {
          return Boolean(
            def?.signalOrb ||
              (card.zone === 'SIGNAL_ORB' &&
                card.modifiers?.some((m) => Boolean(m.treatedAsOrbColors?.length)))
          );
        }
        return this.host.isOrb(card);
      },
      matchesOrbColor: (color) => {
        // 背面信号球属于非公开信息，不得按印刷颜色匹配 (3.5.3 / 12)；仅操控方私密查看 (PEEK_ZONE) 时允许
        if (card.zone === 'SIGNAL_ORB' && !card.isFaceUp) {
          return allowFaceDownSignalOrb ? def?.signalOrb === color : false;
        }
        if (inStaticEval) {
          return def?.signalOrb === color;
        }
        if (card.zone === 'SIGNAL_ORB') {
          return (
            Boolean(continuousEffects?.getEffectiveOrbInfo(card.instanceId).colors.includes(color)) ||
            (!continuousEffects && def?.signalOrb === color)
          );
        }
        return def?.signalOrb === color;
      },
      getEffectivePP: () =>
        inStaticEval
          ? (def?.basePP ?? 0)
          : this.host.ctx.fieldMgr.calculateRoleEffectivePP(card.instanceId),
      getSourceEffectivePP: (sourceId) => {
        if (inStaticEval) {
          const src = this.host.ctx.state.cards[sourceId];
          return src ? (this.host.def(src)?.basePP ?? 0) : 0;
        }
        return this.host.ctx.fieldMgr.calculateRoleEffectivePP(sourceId);
      },
      matchSubCard: (subCard, subFilter, sourceId) =>
        this.matchesFilterSafe(subCard, subFilter, hasTraitFn, sourceId, hasNameFn, inStaticEval),
    };
  }

  private createSnapshotView(card: CardInstance, snapshot: CardTriggerSnapshot): CardFilterView {
    const def = this.host.def(card);
    const continuousEffects = this.host.ctx.continuousEffects;
    const traitSet = expandBaseTraits(snapshot.traits);
    const liveCard = this.host.ctx.state.cards[card.instanceId] ?? card;
    const combat = this.host.ctx.state.currentCombat;
    const isAttacking = Boolean(combat && combat.attackerCardId === card.instanceId);
    const isBeingAttacked = Boolean(
      combat?.targetType === 'CHARACTER' && combat.targetCardId === card.instanceId
    );
    return {
      mode: 'snapshot',
      card,
      def,
      controllerPlayerId: snapshot.controllerPlayerId,
      zone: snapshot.zone,
      isReady: snapshot.isReady,
      isAirborne: snapshot.isAirborne ?? Boolean(liveCard.isAirborne),
      isAttacking,
      isBeingAttacked,
      isInCombat: isAttacking || isBeingAttacked,
      wasAscendedPlay: snapshot.wasAscendedPlay ?? Boolean(liveCard.wasAscendedPlay),
      enteredFromZone: snapshot.enteredFromZone ?? liveCard.enteredFromZone,
      ascendedFromAirborne:
        snapshot.ascendedFromAirborne ?? Boolean(liveCard.ascendedFromAirborne),
      hasEquipment:
        snapshot.hasAttachedEquipment !== undefined
          ? snapshot.hasAttachedEquipment
          : getAttachedEquipmentIds(card).length > 0,
      getEffectiveCardType: () =>
        continuousEffects
          ? continuousEffects.getEffectiveCardType(card.instanceId)
          : getModifierEffectiveCardType(card, def),
      hasTrait: (trait) => traitSet.has(trait),
      hasName: (expectedName) => {
        const normExpected = normalizeCardName(expectedName);
        return (
          normalizeCardName(snapshot.name) === normExpected ||
          Boolean(def && normalizeCardName(def.name) === normExpected) ||
          Boolean(continuousEffects?.hasCardName(card.instanceId, expectedName))
        );
      },
      getCost: () => snapshot.cost ?? def?.cost ?? 99,
      isSignalOrb: () => this.host.isOrb(card),
      matchesOrbColor: (color) => {
        if (snapshot.zone === 'SIGNAL_ORB' && !card.isFaceUp) return false;
        return def?.signalOrb === color;
      },
      getEffectivePP: () =>
        snapshot.effectivePP ?? this.host.ctx.fieldMgr.calculateRoleEffectivePP(card.instanceId),
      getSourceEffectivePP: (sourceId) =>
        this.host.ctx.fieldMgr.calculateRoleEffectivePP(sourceId),
      matchSubCard: (subCard, subFilter, sourceId) =>
        this.matchesFilter(subCard, subFilter, sourceId),
    };
  }

  private matchesFilterWithView(
    view: CardFilterView,
    filter: CardFilter,
    sourceId?: string
  ): boolean {
    const { card, def } = view;
    if (filter.excludeSelf && sourceId && card.instanceId === sourceId) return false;
    if (filter.anyFilters !== undefined) {
      if (!filter.anyFilters.some((sub) => this.matchesFilterWithView(view, sub, sourceId))) {
        return false;
      }
    }
    if (filter.cardType !== undefined && view.getEffectiveCardType() !== filter.cardType) {
      return false;
    }
    if (filter.attribute !== undefined && def?.attribute !== filter.attribute) return false;
    if (filter.excludeAttribute !== undefined && def?.attribute === filter.excludeAttribute) {
      return false;
    }
    if (filter.cardNumbers !== undefined && !filter.cardNumbers.includes(card.cardNumber)) {
      return false;
    }
    if (
      filter.excludeCoreCardNumbers !== undefined &&
      filter.excludeCoreCardNumbers.includes(extractCoreCardNumber(card.cardNumber))
    ) {
      return false;
    }

    if (filter.exactName !== undefined && !view.hasName(filter.exactName)) return false;
    if (filter.excludeName !== undefined && view.hasName(filter.excludeName)) return false;
    if (filter.trait !== undefined && !view.hasTrait(filter.trait)) return false;
    if (filter.excludeTrait !== undefined && view.hasTrait(filter.excludeTrait)) return false;
    if (filter.anyTraits !== undefined && !filter.anyTraits.some((t) => view.hasTrait(t))) {
      return false;
    }

    if (
      filter.maxCost !== undefined ||
      filter.minCost !== undefined ||
      filter.exactCost !== undefined ||
      filter.maxCostOpenCostLimit
    ) {
      const cost = view.getCost();
      if (filter.maxCost !== undefined && cost > filter.maxCost) return false;
      if (filter.minCost !== undefined && cost < filter.minCost) return false;
      if (filter.exactCost !== undefined && cost !== filter.exactCost) return false;
      if (filter.maxCostOpenCostLimit) {
        const openLimit = this.host.ctx.state.players[view.controllerPlayerId]?.openCostCount ?? 0;
        if (cost > openLimit) return false;
      }
    }

    if (filter.maxBaseDP !== undefined && (def?.baseDP ?? 0) > filter.maxBaseDP) return false;
    if (filter.isAscended !== undefined) {
      const isAsc = Boolean(def?.ascensionConfig);
      if (isAsc !== filter.isAscended) return false;
    }
    if (filter.isSignalOrb !== undefined && view.isSignalOrb() !== filter.isSignalOrb) return false;
    if (filter.signalOrbColor !== undefined && !view.matchesOrbColor(filter.signalOrbColor)) {
      return false;
    }
    if (filter.isFaceUp !== undefined && card.isFaceUp !== filter.isFaceUp) return false;
    if (filter.isReady !== undefined && view.isReady !== filter.isReady) return false;
    if (filter.isFrozen !== undefined && Boolean(card.isFrozen) !== filter.isFrozen) return false;
    if (filter.isAirborne !== undefined && view.isAirborne !== filter.isAirborne) {
      return false;
    }
    if (filter.isAttacking !== undefined && view.isAttacking !== filter.isAttacking) {
      return false;
    }
    if (filter.isBeingAttacked !== undefined && view.isBeingAttacked !== filter.isBeingAttacked) {
      return false;
    }
    if (filter.isInCombat !== undefined && view.isInCombat !== filter.isInCombat) {
      return false;
    }
    if (filter.wasAscendedPlay !== undefined && view.wasAscendedPlay !== filter.wasAscendedPlay) {
      return false;
    }
    if (
      filter.enteredFromZones !== undefined &&
      (!view.enteredFromZone || !filter.enteredFromZones.includes(view.enteredFromZone))
    ) {
      return false;
    }
    if (
      filter.ascendedFromAirborne !== undefined &&
      view.ascendedFromAirborne !== filter.ascendedFromAirborne
    ) {
      return false;
    }
    if (filter.hasAssistConfig !== undefined && Boolean(def?.assistConfig) !== filter.hasAssistConfig) {
      return false;
    }
    if (filter.hasEquipment !== undefined && view.hasEquipment !== filter.hasEquipment) {
      return false;
    }
    if (filter.hasPartner !== undefined && Boolean(card.partnerCardId) !== filter.hasPartner) {
      return false;
    }
    if (
      filter.minUnderneathCount !== undefined &&
      (card.underneathCardIds?.length ?? 0) < filter.minUnderneathCount
    ) {
      return false;
    }
    if (filter.hasUnderneathOrEquipMatching !== undefined) {
      const subIds = [...(card.underneathCardIds ?? []), ...getAttachedEquipmentIds(card)];
      const hasMatch = subIds.some((sid) => {
        const sc = this.host.ctx.state.cards[sid];
        return Boolean(sc && view.matchSubCard(sc, filter.hasUnderneathOrEquipMatching!, sourceId));
      });
      if (!hasMatch) return false;
    }
    if (filter.inZone !== undefined && view.zone !== filter.inZone) return false;
    if (filter.maxEffectivePP !== undefined && view.getEffectivePP() > filter.maxEffectivePP) {
      return false;
    }
    if (filter.minEffectivePP !== undefined && view.getEffectivePP() < filter.minEffectivePP) {
      return false;
    }
    if (filter.maxEffectivePPSourceSelf) {
      if (!sourceId) return false;
      const selfPP = view.getSourceEffectivePP(sourceId);
      if (view.getEffectivePP() > selfPP) return false;
    }
    return true;
  }

  /**
   * 校验所选卡牌能否分别一一对应到 distinctTraits 中的不同特征 (回溯二分匹配，覆盖 ST03-003 及未来多特征检索)
   */
  canAssignDistinctTraits(cards: CardInstance[], traits: string[]): boolean {
    if (cards.length > traits.length) return false;
    const used = new Array<boolean>(traits.length).fill(false);
    const dfs = (idx: number): boolean => {
      if (idx === cards.length) return true;
      const card = cards[idx]!;
      for (let t = 0; t < traits.length; t++) {
        if (used[t]) continue;
        if (this.host.hasTrait(card, traits[t]!)) {
          used[t] = true;
          if (dfs(idx + 1)) return true;
          used[t] = false;
        }
      }
      return false;
    };
    return dfs(0);
  }

  resolveUntilTurn(duration: ModifierDuration, turn: number): number | undefined {
    switch (duration) {
      case 'END_OF_TURN':
      case 'END_OF_COMBAT':
        return turn;
      case 'END_OF_NEXT_TURN':
        return turn + 1;
      case 'UNTIL_LEAVE_ZONE':
        return undefined;
    }
  }

  compare(actual: number, op: CompareOp, target: number): boolean {
    switch (op) {
      case '>=':
        return actual >= target;
      case '<=':
        return actual <= target;
      case '==':
        return actual === target;
      case '>':
        return actual > target;
      case '<':
        return actual < target;
    }
  }

  private getRevealedCardEffectiveCost(
    card: CardInstance,
    vars: Record<string, string[]>
  ): number | undefined {
    for (const item of vars.__lilith_cost_map ?? []) {
      const [id, rawCost] = item.split(':');
      if (id === card.instanceId) {
        const parsed = Number(rawCost);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    return this.host.def(card)?.cost;
  }

  formatPrompt(prompt: string, playerId: string, extra?: Record<string, string | number>): string {
    const erosion = this.host.ctx.state.players[playerId]?.erosionCount ?? 0;
    let text = prompt
      .replace(/\{erosion\*(\d+)\}/g, (_m, mult) => String(erosion * Number(mult)))
      .replace(/\{erosion\}/g, String(erosion));
    for (const [k, v] of Object.entries(extra ?? {})) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return text;
  }
}
