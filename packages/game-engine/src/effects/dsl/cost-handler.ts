import type {
  DslExecutionFrame,
  DslInterpreterHost,
  DslPendingAction,
  DslResult,
} from './runtime-types.js';
import type { AbilityCost, EffectStep } from './types.js';

export type CostPendingAction = Extract<
  DslPendingAction,
  { kind: 'COST_DISCARD' | 'COST_ORB' | 'COST_ORB_OR_DISCARD' | 'COST_PAY_COST' }
>;

export type HostWithRequiredOrbCount = DslInterpreterHost & {
  eliminate(
    playerId: string,
    ids: string[],
    sourceId?: string,
    excludeFromAbilityOrbCount?: boolean,
    requiredCount?: number
  ): void;
};

export type CostOrbActionWithCount = Extract<DslPendingAction, { kind: 'COST_ORB' }> & {
  requiredCount?: number;
};

type CostOrbOrDiscardActionWithCount = Extract<DslPendingAction, { kind: 'COST_ORB_OR_DISCARD' }> & {
  requiredCount?: number;
};

export function isCostPendingAction(pending: DslPendingAction): pending is CostPendingAction {
  return (
    pending.kind === 'COST_DISCARD' ||
    pending.kind === 'COST_ORB' ||
    pending.kind === 'COST_ORB_OR_DISCARD' ||
    pending.kind === 'COST_PAY_COST'
  );
}

/**
 * 声明式能力代价处理器：
 * 承接全部 13 种 AbilityCost 支付与 4 类代价决策回流 (COST_DISCARD / COST_ORB / COST_ORB_OR_DISCARD / COST_PAY_COST)。
 */
export class DslCostHandler {
  constructor(private readonly host: DslInterpreterHost) {}

  executeWithCost(
    cardNumber: string,
    sourceId: string,
    playerId: string,
    cost: AbilityCost | undefined,
    steps: EffectStep[],
    markUsed: boolean,
    initialVars: Record<string, string[]> = {},
    markUsedKey?: string,
    costCardInstanceIds?: string[]
  ): DslResult {
    const vars = { ...initialVars };
    const effectiveUsageKey = markUsedKey ?? sourceId;
    if (!cost) {
      if (markUsed) this.host.markUsed(playerId, effectiveUsageKey);
      this.host.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
      return { success: true };
    }

    switch (cost.kind) {
      case 'TAP_SELF': {
        const card = this.host.ctx.state.cards[sourceId];
        if (!card || !card.isReady) {
          return { success: false, error: '该牌已横置，无法支付「横置该牌」的代价' };
        }
        this.host.ctx.zoneMgr.setCardReady(sourceId, false);
        if (markUsed) this.host.markUsed(playerId, effectiveUsageKey);
        this.host.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
        return { success: true };
      }

      case 'TAP_SELF_AND_DISCARD_HAND': {
        const card = this.host.ctx.state.cards[sourceId];
        if (!card || !card.isReady) {
          return { success: false, error: '该牌已横置，无法支付「横置该牌」的代价' };
        }
        const hand = this.host
          .zone(playerId, 'HAND')
          .filter((c) => !cost.filter || this.host.evaluator.matchesFilter(c, cost.filter, sourceId));
        if (hand.length < cost.count) {
          return {
            success: false,
            error: `符合条件的手牌不足 ${cost.count} 张，无法支付丢弃代价 (8.4.2.b)`,
          };
        }
        this.host.ctx.zoneMgr.setCardReady(sourceId, false);
        const effectType = cost.choiceEffectType ?? 'PRESET_DISCARD_COST';
        const promptBase = cost.prompt ?? `请选择 ${cost.count} 张手牌丢弃作为代价`;
        this.host.enqueueDslChoice(
          {
            id: this.host.choiceId('tap-discard-cost'),
            playerId,
            choiceType: 'SELECT_CARDS',
            prompt: promptBase,
            options: hand.map((c) => this.host.effects.createGeneralCardChoiceOption(c)),
            effectType,
            sourceCardInstanceId: sourceId,
            minSelections: cost.count,
            maxSelections: cost.count,
          },
          {
            cardNumber,
            sourceCardInstanceId: sourceId,
            playerId,
            vars,
            remainingSteps: [],
            pendingAction: {
              kind: 'COST_DISCARD',
              onPaid: [...steps],
              optional: false,
              requiredMin: cost.count,
              markUsed,
              markUsedKey: effectiveUsageKey,
            },
          }
        );
        return { success: true };
      }

      case 'TAP_SELF_AND_ELIMINATE_ORBS': {
        const card = this.host.ctx.state.cards[sourceId];
        if (!card || !card.isReady) {
          return { success: false, error: '该牌已横置，无法支付「横置该牌」的代价' };
        }
        const groups = this.host.orbGroups(playerId, cost.count, cost.filter);
        if (groups.length === 0) {
          return {
            success: false,
            error: '信号球区没有满足代价的相邻信号球，无法发动 (8.4.2.b)',
          };
        }
        this.host.ctx.zoneMgr.setCardReady(sourceId, false);
        if (groups.length === 1) {
          (this.host as HostWithRequiredOrbCount).eliminate(
            playerId,
            groups[0]!,
            sourceId,
            undefined,
            cost.count
          );
          if (markUsed) this.host.markUsed(playerId, effectiveUsageKey);
          this.host.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
          return { success: true };
        }
        const effectType = cost.choiceEffectType ?? 'PRESET_ORB_COST';
        const tapOrbPending: CostOrbActionWithCount = {
          kind: 'COST_ORB',
          onPaid: [...steps],
          optional: false,
          markUsed,
          markUsedKey: effectiveUsageKey,
          requiredCount: cost.count,
        };
        this.host.enqueueDslChoice(
          {
            id: this.host.choiceId('tap-orb-cost'),
            playerId,
            choiceType: 'SELECT_OPTION',
            prompt: cost.prompt ?? '选择要消除的信号球 (起动能力的代价)',
            options: groups.map((g) => ({
              id: g.join(','),
              label: `消除 ${g
                .map((id) => this.host.def(this.host.ctx.state.cards[id]!)?.name ?? id)
                .join('、')}`,
            })),
            effectType,
            sourceCardInstanceId: sourceId,
            minSelections: 1,
            maxSelections: 1,
          },
          {
            cardNumber,
            sourceCardInstanceId: sourceId,
            playerId,
            vars,
            remainingSteps: [],
            pendingAction: tapOrbPending,
          }
        );
        return { success: true };
      }

      case 'SELF_TO_DECK_BOTTOM': {
        const card = this.host.ctx.state.cards[sourceId];
        if (!card || card.zone !== 'BATTLEFIELD') {
          return { success: false, error: '该牌不在战场，无法支付「放置到牌组底」的代价' };
        }
        this.host.ctx.zoneMgr.moveCardToBottomOfDeck(sourceId);
        if (markUsed) this.host.markUsed(playerId, effectiveUsageKey);
        this.host.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
        return { success: true };
      }

      case 'PAY_COST': {
        if (!this.host.ctx.payCost(playerId, cost.amount, costCardInstanceIds)) {
          return { success: false, error: `费用不足，需要支付 ${cost.amount} 费` };
        }
        if (markUsed) this.host.markUsed(playerId, effectiveUsageKey);
        this.host.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
        return { success: true };
      }

      case 'SELF_TO_GRAVEYARD': {
        const card = this.host.ctx.state.cards[sourceId];
        if (!card || (card.zone !== 'BATTLEFIELD' && card.zone !== 'HAND')) {
          return { success: false, error: '该牌不在战场或手牌，无法作为代价放置到墓地' };
        }
        const fromField = card.zone === 'BATTLEFIELD';
        this.host.ctx.zoneMgr.moveCard(sourceId, 'GRAVEYARD', {
          isFaceUp: true,
          sentByEffectOrCost: cost.sentByEffectOrCost ?? fromField,
        });
        if (markUsed) this.host.markUsed(playerId, effectiveUsageKey);
        this.host.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
        return { success: true };
      }

      case 'SELF_AIRBORNE': {
        if (!this.host.ctx.fieldMgr.airborneRole(sourceId)) {
          return {
            success: false,
            error: '无法将该牌【浮空】(请确认已在战场且处理区尚无浮空模式卡牌)',
          };
        }
        if (markUsed) this.host.markUsed(playerId, effectiveUsageKey);
        this.host.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
        return { success: true };
      }

      case 'DISCARD_SELF_FROM_HAND': {
        const card = this.host.ctx.state.cards[sourceId];
        if (!card || card.zone !== 'HAND') {
          return { success: false, error: '该牌不在手牌中，无法丢弃手牌中的该牌' };
        }
        this.host.ctx.zoneMgr.moveCard(sourceId, 'GRAVEYARD', { isFaceUp: true });
        if (markUsed) this.host.markUsed(playerId, effectiveUsageKey);
        this.host.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
        return { success: true };
      }

      case 'DEAL_SELF_DAMAGE': {
        this.host.ctx.zoneMgr.applyDamageToPlayer(playerId, cost.amount, sourceId, {
          deferCheckTiming: steps.length > 0,
        });
        if (markUsed) this.host.markUsed(playerId, effectiveUsageKey);
        if (this.host.ctx.state.status === 'FINISHED') {
          return { success: true };
        }
        if (
          (this.host.ctx.state.currentPendingChoice || this.host.ctx.zoneMgr.hasPendingCharges()) &&
          steps.length > 0
        ) {
          this.host.ctx.state.pendingDslContinuations ??= [];
          this.host.ctx.state.pendingDslContinuations.push({
            cardNumber,
            sourceCardInstanceId: sourceId,
            playerId,
            vars: { ...vars },
            remainingSteps: [...steps],
          });
          return { success: true };
        }
        this.host.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
        return { success: true };
      }

      case 'COMPOSITE': {
        // 先行校验组合代价中的全部子项均可支付，再按顺序执行同步项与交互项
        const player = this.host.ctx.state.players[playerId];
        const totalPayCost = cost.costs.reduce(
          (sum, c) => sum + (c.kind === 'PAY_COST' ? c.amount : 0),
          0
        );
        if (totalPayCost > 0) {
          const avail = (player?.availableOpenCostCount ?? 0) + (player?.hiddenCostCount ?? 0);
          if (avail < totalPayCost) {
            return { success: false, error: `费用不足，共需要支付 ${totalPayCost} 费` };
          }
        }
        for (const sub of cost.costs) {
          const card = this.host.ctx.state.cards[sourceId];
          if (sub.kind === 'TAP_SELF' && (!card || !card.isReady)) {
            return { success: false, error: '该牌已横置，无法支付「横置该牌」的代价' };
          }
          if (sub.kind === 'DISCARD_SELF_FROM_HAND' && (!card || card.zone !== 'HAND')) {
            return { success: false, error: '该牌不在手牌中' };
          }
          if (
            sub.kind === 'SELF_TO_GRAVEYARD' &&
            (!card || (card.zone !== 'BATTLEFIELD' && card.zone !== 'HAND'))
          ) {
            return { success: false, error: '该牌无法从当前区域放置到墓地' };
          }
          if (sub.kind === 'SELF_AIRBORNE') {
            const hasAirborne = this.host
              .zone(playerId, 'PROCESSING')
              .some((c) => c.isAirborne === true);
            const srcCard = this.host.ctx.state.cards[sourceId];
            const canAirborneFromZone =
              this.host.ctx.fieldMgr.isSlotRole(playerId, sourceId) || srcCard?.zone === 'HAND';
            if (hasAirborne || !canAirborneFromZone) {
              return {
                success: false,
                error: '处理区已存在浮空模式卡牌或该牌无法从当前区域【浮空】',
              };
            }
          }
          if (sub.kind === 'DISCARD_HAND' && !sub.optional) {
            const hand = this.host
              .zone(playerId, 'HAND')
              .filter(
                (c) => !sub.filter || this.host.evaluator.matchesFilter(c, sub.filter, sourceId)
              );
            if (hand.length < sub.count) {
              return { success: false, error: `符合条件的手牌不足 ${sub.count} 张` };
            }
          }
          if (sub.kind === 'ELIMINATE_ORBS' && !sub.optional) {
            if (this.host.orbGroups(playerId, sub.count, sub.filter).length === 0) {
              return { success: false, error: '信号球区没有满足条件的信号球' };
            }
          }
        }
        const interactive: AbilityCost[] = [];
        for (const sub of cost.costs) {
          if (
            sub.kind === 'DISCARD_HAND' ||
            sub.kind === 'ELIMINATE_ORBS' ||
            sub.kind === 'ELIMINATE_ORB_OR_DISCARD_HAND'
          ) {
            interactive.push(sub);
          } else {
            const res = this.executeWithCost(
              cardNumber,
              sourceId,
              playerId,
              sub,
              [],
              false,
              vars,
              undefined,
              costCardInstanceIds
            );
            if (!res.success) return res;
          }
        }
        if (interactive.length === 0) {
          if (markUsed) this.host.markUsed(playerId, effectiveUsageKey);
          this.host.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
          return { success: true };
        }
        if (interactive.length === 1) {
          return this.executeWithCost(
            cardNumber,
            sourceId,
            playerId,
            interactive[0]!,
            steps,
            markUsed,
            vars,
            effectiveUsageKey
          );
        }
        const extraSteps: EffectStep[] = [];
        for (let i = 1; i < interactive.length; i++) {
          const ic = interactive[i]!;
          if (ic.kind === 'ELIMINATE_ORBS') {
            extraSteps.push({
              op: 'ELIMINATE_ORB_COST',
              filter: ic.filter,
              count: ic.count,
              optional: ic.optional,
              prompt: ic.prompt,
              savePaidToVar: ic.savePaidToVar,
              onPaid: i === interactive.length - 1 ? steps : [],
            });
          } else if (ic.kind === 'DISCARD_HAND') {
            extraSteps.push({
              op: 'DISCARD_COST_STEP',
              count: ic.count,
              filter: ic.filter,
              optional: ic.optional,
              prompt: ic.prompt,
              onPaid: i === interactive.length - 1 ? steps : [],
            });
          }
        }
        return this.executeWithCost(
          cardNumber,
          sourceId,
          playerId,
          interactive[0]!,
          extraSteps.length > 0 ? extraSteps : steps,
          markUsed,
          vars,
          effectiveUsageKey
        );
      }

      case 'DISCARD_HAND': {
        const hand = this.host
          .zone(playerId, 'HAND')
          .filter((c) => !cost.filter || this.host.evaluator.matchesFilter(c, cost.filter, sourceId));
        const optional = Boolean(cost.optional);
        if (hand.length < cost.count) {
          return optional
            ? { success: true }
            : {
                success: false,
                error: `符合条件的手牌不足 ${cost.count} 张，无法支付丢弃代价 (8.4.2.b)`,
              };
        }
        const effectType = cost.choiceEffectType ?? 'PRESET_DISCARD_COST';
        const promptBase = cost.prompt ?? `请选择 ${cost.count} 张手牌丢弃作为代价`;
        this.host.enqueueDslChoice(
          {
            id: this.host.choiceId('discard-cost'),
            playerId,
            choiceType: 'SELECT_CARDS',
            prompt: optional ? `${promptBase} (不选择则不支付代价)` : promptBase,
            options: hand.map((c) => this.host.effects.createGeneralCardChoiceOption(c)),
            effectType,
            sourceCardInstanceId: sourceId,
            minSelections: optional ? 0 : cost.count,
            maxSelections: cost.count,
          },
          {
            cardNumber,
            sourceCardInstanceId: sourceId,
            playerId,
            vars,
            remainingSteps: [],
            pendingAction: {
              kind: 'COST_DISCARD',
              onPaid: [...steps],
              optional,
              requiredMin: cost.count,
              markUsed,
              markUsedKey: effectiveUsageKey,
            },
          }
        );
        return { success: true };
      }

      case 'ELIMINATE_ORBS': {
        const groups = this.host.orbGroups(playerId, cost.count, cost.filter);
        const optional = Boolean(cost.optional);
        if (groups.length === 0) {
          return optional
            ? { success: true }
            : {
                success: false,
                error: '信号球区没有满足代价的相邻信号球，无法发动 (8.4.2.b)',
              };
        }
        if (!optional && groups.length === 1) {
          (this.host as HostWithRequiredOrbCount).eliminate(
            playerId,
            groups[0]!,
            sourceId,
            undefined,
            cost.count
          );
          if (cost.savePaidToVar) vars[cost.savePaidToVar] = [...groups[0]!];
          if (markUsed) this.host.markUsed(playerId, effectiveUsageKey);
          this.host.runSteps(cardNumber, sourceId, playerId, vars, [...steps]);
          return { success: true };
        }
        const effectType = cost.choiceEffectType ?? 'PRESET_ORB_COST';
        const options = [
          ...(optional ? [{ id: 'skip', label: '不支付代价 (不发动)' }] : []),
          ...groups.map((g) => ({
            id: g.join(','),
            label: `消除 ${g
              .map((id) => this.host.def(this.host.ctx.state.cards[id]!)?.name ?? id)
              .join('、')}`,
          })),
        ];
        const orbPending: CostOrbActionWithCount = {
          kind: 'COST_ORB',
          onPaid: [...steps],
          optional,
          markUsed,
          markUsedKey: effectiveUsageKey,
          savePaidToVar: cost.savePaidToVar,
          requiredCount: cost.count,
        };
        this.host.enqueueDslChoice(
          {
            id: this.host.choiceId('orb-cost'),
            playerId,
            choiceType: 'SELECT_OPTION',
            prompt: cost.prompt ?? '选择要消除的信号球 (起动能力的代价)',
            options,
            effectType,
            sourceCardInstanceId: sourceId,
            minSelections: 1,
            maxSelections: 1,
          },
          {
            cardNumber,
            sourceCardInstanceId: sourceId,
            playerId,
            vars,
            remainingSteps: [],
            pendingAction: orbPending,
          }
        );
        return { success: true };
      }

      case 'ELIMINATE_ORB_OR_DISCARD_HAND': {
        const optional = cost.optional !== false;
        const orbGroups = this.host.orbGroups(playerId, 1, 'ANY');
        const hand = this.host.zone(playerId, 'HAND');
        const options = [
          ...(optional ? [{ id: 'skip', label: '不支付代价 (不发动)' }] : []),
          ...orbGroups.map((g) => {
            const c = this.host.ctx.state.cards[g[0]!]!;
            return {
              id: `orb:${g[0]!}`,
              label: `消除信号球【${this.host.def(c)?.name ?? c.cardNumber}】`,
            };
          }),
          ...hand.map((c) => ({
            id: `hand:${c.instanceId}`,
            label: `丢弃手牌【${this.host.def(c)?.name ?? c.cardNumber}】`,
          })),
        ];
        if (options.length === (optional ? 1 : 0)) {
          return optional
            ? { success: true }
            : { success: false, error: '没有可支付的信号球或手牌代价' };
        }
        const orbOrDiscardPending: CostOrbOrDiscardActionWithCount = {
          kind: 'COST_ORB_OR_DISCARD',
          onPaid: [...steps],
          optional,
          markUsed,
          markUsedKey: effectiveUsageKey,
          requiredCount: 1,
        };
        this.host.enqueueDslChoice(
          {
            id: this.host.choiceId('orb-or-hand-cost'),
            playerId,
            choiceType: 'SELECT_OPTION',
            prompt: cost.prompt ?? '请选择要支付的信号球或手牌代价',
            options,
            effectType: cost.choiceEffectType ?? 'PRESET_ORB_OR_HAND_COST',
            sourceCardInstanceId: sourceId,
            minSelections: 1,
            maxSelections: 1,
          },
          {
            cardNumber,
            sourceCardInstanceId: sourceId,
            playerId,
            vars,
            remainingSteps: [],
            pendingAction: orbOrDiscardPending,
          }
        );
        return { success: true };
      }
    }
  }

  resolveCostChoice(
    pending: CostPendingAction,
    selected: string[],
    frame: DslExecutionFrame,
    vars: Record<string, string[]>,
    remaining: EffectStep[]
  ): DslResult {
    const { playerId, cardNumber, sourceCardInstanceId } = frame;

    switch (pending.kind) {
      case 'COST_DISCARD': {
        if (selected.length === 0) {
          if (pending.optional) {
            if (remaining.length > 0) {
              this.host.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
            }
            return { success: true };
          }
          return { success: false, error: '必须支付丢弃手牌代价' };
        }
        if (pending.requiredMin !== undefined && selected.length < pending.requiredMin) {
          return {
            success: false,
            error: `支付丢弃代价至少需要选择 ${pending.requiredMin} 张手牌 (8.4.2.b)`,
          };
        }
        for (const id of selected) {
          this.host.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
        }
        if (pending.savePaidToVar) vars[pending.savePaidToVar] = [...selected];
        if (pending.markUsed) {
          this.host.markUsed(playerId, pending.markUsedKey ?? sourceCardInstanceId);
        }
        this.host.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, [
          ...pending.onPaid,
          ...remaining,
        ]);
        return { success: true };
      }

      case 'COST_ORB': {
        const group = selected[0];
        if (!group || group === 'skip') {
          if (pending.optional) {
            if (remaining.length > 0) {
              this.host.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
            }
            return { success: true };
          }
          return { success: false, error: '必须支付消除信号球代价' };
        }
        const paidIds = group.split(',');
        (this.host as HostWithRequiredOrbCount).eliminate(
          playerId,
          paidIds,
          sourceCardInstanceId,
          pending.excludeFromAbilityOrbCount,
          (pending as CostOrbActionWithCount).requiredCount
        );
        if (pending.savePaidToVar) vars[pending.savePaidToVar] = [...paidIds];
        if (pending.markUsed) {
          this.host.markUsed(playerId, pending.markUsedKey ?? sourceCardInstanceId);
        }
        this.host.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, [
          ...pending.onPaid,
          ...remaining,
        ]);
        return { success: true };
      }

      case 'COST_ORB_OR_DISCARD': {
        const pick = selected[0];
        if (!pick || pick === 'skip') {
          if (pending.optional) {
            if (remaining.length > 0) {
              this.host.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
            }
            return { success: true };
          }
          return { success: false, error: '必须支付代价' };
        }
        const [kind, id] = pick.split(':') as [string, string];
        if (kind === 'orb') {
          (this.host as HostWithRequiredOrbCount).eliminate(
            playerId,
            [id],
            sourceCardInstanceId,
            undefined,
            (pending as CostOrbOrDiscardActionWithCount).requiredCount ?? 1
          );
        } else {
          this.host.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
        }
        if (pending.markUsed) {
          this.host.markUsed(playerId, pending.markUsedKey ?? sourceCardInstanceId);
        }
        this.host.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, [
          ...pending.onPaid,
          ...remaining,
        ]);
        return { success: true };
      }

      case 'COST_PAY_COST': {
        if (selected[0] !== 'pay_cost') {
          if (pending.optional) {
            if (remaining.length > 0) {
              this.host.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
            }
            return { success: true };
          }
          return { success: false, error: `必须支付 ${pending.amount} 费` };
        }
        if (!this.host.ctx.payCost(playerId, pending.amount)) {
          return { success: false, error: `费用不足，需要 ${pending.amount} 费` };
        }
        if (pending.markUsed) {
          this.host.markUsed(playerId, pending.markUsedKey ?? sourceCardInstanceId);
        }
        this.host.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, [
          ...pending.onPaid,
          ...remaining,
        ]);
        return { success: true };
      }
    }
  }
}
