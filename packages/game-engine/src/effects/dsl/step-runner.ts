import { CardInstance, CardModifier } from '@zhanshuang/shared';
import { extractCoreCardNumber } from '@zhanshuang/game-rules';
import { addCardModifier, nextEffectTimestamp } from '../continuous-effects.js';
import { getAttachedEquipmentIds } from '../../zone/battlefield-manager.js';
import { resolveCustomChoice, startCustomHandler } from './custom-handlers.js';
import type { CostOrbActionWithCount, HostWithRequiredOrbCount } from './cost-handler.js';
import type {
  DslChoiceAction,
  DslExecutionFrame,
  DslInterpreterHost,
  DslPendingAction,
  DslResult,
} from './runtime-types.js';
import type { EffectStep } from './types.js';

export type StepPendingAction = Exclude<
  DslPendingAction,
  { kind: 'COST_DISCARD' | 'COST_ORB' | 'COST_ORB_OR_DISCARD' | 'COST_PAY_COST' }
>;

const LILITH_REVEAL_COST_CHOICES: Readonly<Record<string, number[]>> = {
  'BP03-065': [2, 4, 6, 8],
  'BP03-066': [1, 3, 5, 7],
};

/**
 * 声明式效果步骤执行器：
 * 承接 EffectStep 指令队列主循环及所有步骤类决策回流 (CONFIRM / CHOOSE_* / SAVE_CHOICE / REORDER_ZONE 等)。
 */
export class DslStepRunner {
  constructor(private readonly host: DslInterpreterHost) {}

  runSteps(
    cardNumber: string,
    sourceId: string,
    playerId: string,
    vars: Record<string, string[]>,
    queue: EffectStep[]
  ): void {
    const turn = this.host.ctx.state.turnNumber;

    while (queue.length > 0) {
      const step = queue.shift()!;

      switch (step.op) {
        case 'DRAW': {
          const targetPlayer = this.host.resolveSide(playerId, step.side ?? 'SELF');
          this.host.ctx.zoneMgr.drawCards(targetPlayer, step.count);
          break;
        }

        case 'MILL': {
          const targetPlayer = this.host.resolveSide(playerId, step.side ?? 'SELF');
          const milled = this.host.mill(targetPlayer, step.count);
          if (step.saveToVar) vars[step.saveToVar] = milled;
          break;
        }

        case 'PEEK_TOP': {
          const targetPlayer = this.host.resolveSide(playerId, step.side ?? 'SELF');
          vars[step.saveToVar] = this.host.peekTop(targetPlayer, step.count);
          break;
        }

        case 'PEEK_ZONE': {
          const targetPlayer = this.host.resolveSide(playerId, step.side ?? 'SELF');
          const allowFaceDownSignalOrb = (step.side ?? 'SELF') === 'SELF';
          const peeked = this.host
            .zone(targetPlayer, step.zone)
            .filter(
              (c) =>
                !step.filter ||
                this.host.evaluator.matchesFilter(c, step.filter, sourceId, {
                  allowFaceDownSignalOrb,
                })
            )
            .map((c) => c.instanceId);
          vars[step.saveToVar] = peeked;
          if ((step.side ?? 'SELF') === 'SELF') {
            vars.__peekedIds = Array.from(new Set([...(vars.__peekedIds ?? []), ...peeked]));
          }
          break;
        }

        case 'REVEAL_TOP': {
          const targetPlayer = this.host.resolveSide(playerId, step.side ?? 'SELF');
          const revealedIds = this.host.revealTop(targetPlayer, step.count);
          vars[step.saveToVar] = revealedIds;
          if (
            this.tryEnqueueWanshimingRevealToCost(
              cardNumber,
              sourceId,
              playerId,
              targetPlayer,
              revealedIds,
              step.saveToVar,
              vars,
              queue
            )
          ) {
            return;
          }
          if (
            this.tryEnqueueLilithRevealCostDeclaration(
              cardNumber,
              sourceId,
              playerId,
              revealedIds,
              vars,
              queue
            )
          ) {
            return;
          }
          break;
        }

        case 'DISCARD_OPPONENT_RANDOM_HAND': {
          const oppId = this.host.resolveSide(playerId, 'OPPONENT');
          for (let i = 0; i < step.count; i++) {
            const hand = this.host.zone(oppId, 'HAND');
            if (hand.length === 0) break;
            const pickIdx = this.host.ctx.zoneMgr.nextRandomInt(hand.length);
            const victim = hand[pickIdx]!;
            this.host.ctx.zoneMgr.moveCard(victim.instanceId, 'GRAVEYARD', { isFaceUp: true });
          }
          break;
        }

        case 'CONFIRM_YES_NO': {
          this.host.enqueueDslChoice(
            {
              id: this.host.choiceId(step.choiceEffectType ?? 'confirm'),
              playerId,
              choiceType: 'SELECT_OPTION',
              prompt: this.host.evaluator.formatPrompt(step.prompt, playerId),
              options: [
                { id: 'opt_yes', label: step.yesLabel },
                { id: 'opt_no', label: step.noLabel },
              ],
              effectType: step.choiceEffectType ?? `DSL_CONFIRM_${cardNumber}`,
              sourceCardInstanceId: sourceId,
              minSelections: 1,
              maxSelections: 1,
            },
            {
              cardNumber,
              sourceCardInstanceId: sourceId,
              playerId,
              vars,
              remainingSteps: queue,
              pendingAction: { kind: 'CONFIRM_YES_NO', onYes: step.onYes, onNo: step.onNo },
            }
          );
          return;
        }

        case 'CHOOSE_ROLES': {
          const allRoles =
            step.side === 'ANY'
              ? [
                  ...this.host.roles(playerId),
                  ...this.host.roles(this.host.resolveSide(playerId, 'OPPONENT')),
                ]
              : this.host.roles(this.host.resolveSide(playerId, step.side));
          const candidates = allRoles.filter(
            (r) => !step.filter || this.host.evaluator.matchesFilter(r, step.filter, sourceId)
          );
          const isEligible = (c: CardInstance) =>
            !step.eligibilityFilter ||
            this.host.evaluator.matchesFilter(c, step.eligibilityFilter, sourceId);
          const eligibleCount = candidates.filter(isEligible).length;
          if (candidates.length === 0 || eligibleCount === 0) {
            vars[step.saveToVar] = [];
            break;
          }
          const max = step.max ?? 1;
          const min = Math.min(step.min ?? 1, eligibleCount);
          const effectType = step.choiceEffectType ?? `DSL_CHOOSE_ROLES_${cardNumber}`;
          const filterRules =
            step.uniqueNames ||
            step.uniqueCardNumbers ||
            step.distinctAttributes ||
            step.maxTotalCost !== undefined
              ? {
                  ...(step.uniqueNames ? { uniqueNames: true } : {}),
                  ...(step.uniqueCardNumbers ? { uniqueCardNumbers: true } : {}),
                  ...(step.distinctAttributes ? { distinctAttributes: true } : {}),
                  ...(step.maxTotalCost !== undefined ? { maxTotalCost: step.maxTotalCost } : {}),
                }
              : undefined;
          this.host.enqueueDslChoice(
            {
              id: this.host.choiceId(effectType),
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: this.host.evaluator.formatPrompt(step.prompt, playerId),
              options: candidates.map((c) =>
                this.host.effects.createRoleChoiceOption(c, {
                  eligible: isEligible(c),
                  ineligibleReason: step.ineligibleReason,
                })
              ),
              effectType,
              sourceCardInstanceId: sourceId,
              minSelections: min,
              maxSelections: Math.min(max, eligibleCount),
            },
            {
              cardNumber,
              sourceCardInstanceId: sourceId,
              playerId,
              vars,
              remainingSteps: queue,
              pendingAction: {
                kind: 'SAVE_CHOICE',
                saveToVar: step.saveToVar,
                uniqueNames: step.uniqueNames,
                uniqueCardNumbers: step.uniqueCardNumbers,
                distinctAttributes: step.distinctAttributes,
                maxTotalCost: step.maxTotalCost,
              },
            },
            filterRules ? { filterRules } : undefined
          );
          return;
        }

        case 'CHOOSE_ZONE_CARDS': {
          const targetPlayer = this.host.resolveSide(playerId, step.side);
          const isBlindOpponentHand = step.zone === 'OPPONENT_HAND_BLIND';
          const zonesToScan = step.zones && step.zones.length > 0 ? step.zones : [step.zone];
          const rawPool: CardInstance[] = [];
          const seenIds = new Set<string>();
          for (const z of zonesToScan) {
            if (z === 'BATTLEFIELD') {
              for (const slot of this.host.ctx.fieldMgr.getSlots(targetPlayer)) {
                const topIds = [
                  slot.roleCardId,
                  slot.assistCardId,
                  slot.standaloneEquipmentId,
                ].filter((id): id is string => Boolean(id));
                for (const id of topIds) {
                  if (!seenIds.has(id) && this.host.ctx.state.cards[id]) {
                    seenIds.add(id);
                    rawPool.push(this.host.ctx.state.cards[id]!);
                  }
                }
                if (!step.topLevelOnly && slot.roleCardId) {
                  const role = this.host.ctx.state.cards[slot.roleCardId];
                  for (const eqId of getAttachedEquipmentIds(role)) {
                    if (!seenIds.has(eqId) && this.host.ctx.state.cards[eqId]) {
                      seenIds.add(eqId);
                      rawPool.push(this.host.ctx.state.cards[eqId]!);
                    }
                  }
                  if (!step.filter?.cardType && role?.partnerCardId) {
                    const pid = role.partnerCardId;
                    if (!seenIds.has(pid) && this.host.ctx.state.cards[pid]) {
                      seenIds.add(pid);
                      rawPool.push(this.host.ctx.state.cards[pid]!);
                    }
                  }
                }
              }
            } else if (z === 'SELF_UNDERNEATH') {
              const selfCard = this.host.ctx.state.cards[sourceId];
              for (const uid of selfCard?.underneathCardIds ?? []) {
                if (!seenIds.has(uid) && this.host.ctx.state.cards[uid]) {
                  seenIds.add(uid);
                  rawPool.push(this.host.ctx.state.cards[uid]!);
                }
              }
            } else if (z === 'SELF_ATTACHED_EQUIP') {
              const selfCard = this.host.ctx.state.cards[sourceId];
              for (const eqId of getAttachedEquipmentIds(selfCard)) {
                if (!seenIds.has(eqId) && this.host.ctx.state.cards[eqId]) {
                  seenIds.add(eqId);
                  rawPool.push(this.host.ctx.state.cards[eqId]!);
                }
              }
            } else if (z === 'HOST_UNDERNEATH') {
              for (const host of this.host.fieldTopHosts(targetPlayer)) {
                if (
                  step.hostFilter &&
                  !this.host.evaluator.matchesFilter(host, step.hostFilter, sourceId)
                ) {
                  continue;
                }
                for (const uid of host.underneathCardIds ?? []) {
                  if (!seenIds.has(uid) && this.host.ctx.state.cards[uid]) {
                    seenIds.add(uid);
                    rawPool.push(this.host.ctx.state.cards[uid]!);
                  }
                }
              }
            } else if (z === 'OPPONENT_HAND_BLIND') {
              for (const c of this.host.zone(targetPlayer, 'HAND')) {
                if (!seenIds.has(c.instanceId)) {
                  seenIds.add(c.instanceId);
                  rawPool.push(c);
                }
              }
            } else if (z === 'DECK') {
              const sortedDeck = [...this.host.zone(targetPlayer, 'DECK')].sort(
                (a, b) =>
                  a.cardNumber.localeCompare(b.cardNumber) ||
                  a.instanceId.localeCompare(b.instanceId)
              );
              for (const c of sortedDeck) {
                if (!seenIds.has(c.instanceId)) {
                  seenIds.add(c.instanceId);
                  rawPool.push(c);
                }
              }
            } else {
              for (const c of this.host.zone(targetPlayer, z)) {
                if (!seenIds.has(c.instanceId)) {
                  seenIds.add(c.instanceId);
                  rawPool.push(c);
                }
              }
            }
          }
          const candidates = rawPool.filter(
            (c) => !step.filter || this.host.evaluator.matchesFilter(c, step.filter, sourceId)
          );
          const rawMax =
            step.dynamicMax !== undefined
              ? Math.max(
                  0,
                  Math.floor(
                    this.host.evaluator.evalNumberExpr(step.dynamicMax, playerId, sourceId, vars)
                  )
                )
              : (step.max ?? 1);
          const rawMin =
            step.dynamicMin !== undefined
              ? Math.max(
                  0,
                  Math.floor(
                    this.host.evaluator.evalNumberExpr(step.dynamicMin, playerId, sourceId, vars)
                  )
                )
              : (step.min ?? 1);
          const slotCap = step.requireEmptySlot
            ? this.host.emptySlotCount(playerId)
            : candidates.length;
          const maxSelections = Math.min(rawMax, candidates.length, slotCap);
          const minSelections = Math.min(rawMin, maxSelections);
          if (
            candidates.length === 0 ||
            (step.requireEmptySlot && !this.host.hasEmptySlot(playerId)) ||
            maxSelections <= 0
          ) {
            vars[step.saveToVar] = [];
            break;
          }
          const effectType = step.choiceEffectType ?? `DSL_CHOOSE_ZONE_${cardNumber}`;
          this.host.enqueueDslChoice(
            {
              id: this.host.choiceId(effectType),
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: this.host.evaluator.formatPrompt(step.prompt, playerId),
              options: isBlindOpponentHand
                ? candidates.map((c, idx) => ({
                    id: c.instanceId,
                    label: `对方手牌 #${idx + 1}`,
                  }))
                : candidates.map((c, idx) =>
                    !c.isFaceUp && (c.zone === 'SIGNAL_ORB' || c.zone === 'COST')
                      ? {
                          id: c.instanceId,
                          label:
                            c.zone === 'SIGNAL_ORB'
                              ? `背面信号球 #${idx + 1}`
                              : `背面暗费 #${idx + 1}`,
                        }
                      : this.host.effects.createGeneralCardChoiceOption(c, {
                          ineligibleReason: step.ineligibleReason,
                        })
                  ),
              effectType,
              sourceCardInstanceId: sourceId,
              minSelections,
              maxSelections,
            },
            {
              cardNumber,
              sourceCardInstanceId: sourceId,
              playerId,
              vars,
              remainingSteps: queue,
              pendingAction: {
                kind: 'SAVE_CHOICE',
                saveToVar: step.saveToVar,
                uniqueNames: step.uniqueNames,
                uniqueCardNumbers: step.uniqueCardNumbers,
                distinctAttributes: step.distinctAttributes,
                maxTotalCost: step.maxTotalCost,
                requireEmptySlotCount: Boolean(step.requireEmptySlot && rawMax > 1),
                ...(step.revealPickedToProcessing
                  ? {
                      revealPickedToProcessing: true,
                      revealPickedTargetPlayerId: targetPlayer,
                    }
                  : {}),
              },
            }
          );
          return;
        }

        case 'CHOOSE_FROM_VAR': {
          const ids = vars[step.varName] ?? [];
          const cards = ids
            .map((id) => this.host.ctx.state.cards[id])
            .filter((c): c is CardInstance => !!c);
          const isPrivatePeek =
            cards.length > 0 &&
            cards.some(
              (c) =>
                c.zone === 'DECK' ||
                ((c.zone === 'SIGNAL_ORB' || c.zone === 'COST') && !c.isFaceUp)
            );
          const isEligible = (c: CardInstance) => {
            if (step.requireEmptySlot && !this.host.hasEmptySlot(playerId)) return false;
            return (
              !step.filter ||
              this.host.evaluator.matchesFilter(c, step.filter, sourceId, {
                allowFaceDownSignalOrb: isPrivatePeek && c.controllerPlayerId === playerId,
              })
            );
          };
          const eligibleCount = cards.filter(isEligible).length;
          if (cards.length === 0 || (!step.alwaysShow && eligibleCount === 0)) {
            vars[step.saveToVar] = [];
            break;
          }
          const slotCap = step.requireEmptySlot
            ? this.host.emptySlotCount(playerId)
            : eligibleCount;
          const max = Math.min(step.max ?? 1, eligibleCount, slotCap);
          const min = Math.min(step.min ?? 1, max);
          const effectType = step.choiceEffectType ?? `DSL_CHOOSE_VAR_${cardNumber}`;
          const prompt = this.host.evaluator.formatPrompt(step.prompt, playerId);
          this.host.enqueueDslChoice(
            {
              id: this.host.choiceId(effectType),
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt:
                eligibleCount > 0
                  ? prompt
                  : `${prompt}：${isPrivatePeek ? '没有符合条件的卡牌' : '公开的牌中没有符合条件的卡牌'}，请确认`,
              options: cards.map((c) =>
                this.host.effects.createGeneralCardChoiceOption(c, {
                  eligible: isEligible(c),
                  ineligibleReason: '不符合条件',
                })
              ),
              effectType,
              sourceCardInstanceId: sourceId,
              minSelections: min,
              maxSelections: max,
            },
            {
              cardNumber,
              sourceCardInstanceId: sourceId,
              playerId,
              vars,
              remainingSteps: queue,
              pendingAction: {
                kind: 'SAVE_CHOICE',
                saveToVar: step.saveToVar,
                distinctTraits: step.distinctTraits,
                distinctTraitsError: step.distinctTraitsError,
                uniqueNames: step.uniqueNames,
                uniqueCardNumbers: step.uniqueCardNumbers,
                distinctAttributes: step.distinctAttributes,
                maxTotalCost: step.maxTotalCost,
                requireEmptySlotCount: Boolean(step.requireEmptySlot && (step.max ?? 1) > 1),
              },
            },
            isPrivatePeek ? undefined : { revealed: ids }
          );
          return;
        }

        case 'CHOOSE_MODE': {
          let min = step.min ?? 1;
          let max = step.max ?? 1;
          if (step.pickCountExpr !== undefined) {
            const count = Math.min(
              step.modes.length,
              Math.max(
                0,
                Math.floor(
                  this.host.evaluator.evalNumberExpr(step.pickCountExpr, playerId, sourceId, vars)
                )
              )
            );
            if (count <= 0) break;
            if (count === step.modes.length) {
              // 须全选且不可重复时直接按顺序执行全部模式
              const allSteps: EffectStep[] = [];
              for (const m of step.modes) allSteps.push(...m.steps);
              queue.unshift(...allSteps);
              break;
            }
            min = count;
            max = count;
          }
          const effectType = step.choiceEffectType ?? `DSL_CHOOSE_MODE_${cardNumber}`;
          this.host.enqueueDslChoice(
            {
              id: this.host.choiceId(effectType),
              playerId,
              choiceType: 'SELECT_OPTION',
              prompt: this.host.evaluator.formatPrompt(step.prompt, playerId, { pickCount: max }),
              options: step.modes.map((m) => ({ id: m.id, label: m.label })),
              effectType,
              sourceCardInstanceId: sourceId,
              minSelections: min,
              maxSelections: max,
            },
            {
              cardNumber,
              sourceCardInstanceId: sourceId,
              playerId,
              vars,
              remainingSteps: queue,
              pendingAction: {
                kind: 'CHOOSE_MODE',
                modes: step.modes.map((m) => ({ id: m.id, steps: m.steps })),
              },
            }
          );
          return;
        }

        case 'ELIMINATE_ORB_COST': {
          const groups = this.host.orbGroups(playerId, step.count, step.filter);
          const optional = Boolean(step.optional);
          if (groups.length === 0) {
            break;
          }
          if (!optional && groups.length === 1) {
            if (step.savePaidToVar) {
              vars[step.savePaidToVar] = [...groups[0]!];
              vars[`__orbColors:${step.savePaidToVar}`] = this.host.snapshotEliminatedOrbColors(groups[0]!);
            }
            (this.host as HostWithRequiredOrbCount).eliminate(
              playerId,
              groups[0]!,
              sourceId,
              step.excludeFromAbilityOrbCount,
              step.count
            );
            queue.unshift(...step.onPaid);
            break;
          }
          const effectType = step.choiceEffectType ?? `DSL_ORB_COST_${cardNumber}`;
          const options = [
            ...(optional ? [{ id: 'skip', label: '不消除信号球' }] : []),
            ...groups.map((g) => ({
              id: g.join(','),
              label: `消除 ${g
                .map((id) => this.host.def(this.host.ctx.state.cards[id]!)?.name ?? id)
                .join('、')}`,
            })),
          ];
          const stepOrbPending: CostOrbActionWithCount = {
            kind: 'COST_ORB',
            onPaid: [...step.onPaid],
            optional,
            savePaidToVar: step.savePaidToVar,
            excludeFromAbilityOrbCount: step.excludeFromAbilityOrbCount,
            requiredCount: step.count,
          };
          this.host.enqueueDslChoice(
            {
              id: this.host.choiceId('step-orb-cost'),
              playerId,
              choiceType: 'SELECT_OPTION',
              prompt: this.host.evaluator.formatPrompt(
                step.prompt ?? '选择要消除的信号球',
                playerId
              ),
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
              remainingSteps: queue,
              pendingAction: stepOrbPending,
            }
          );
          return;
        }

        case 'DISCARD_COST_STEP': {
          const hand = this.host
            .zone(playerId, 'HAND')
            .filter(
              (c) => !step.filter || this.host.evaluator.matchesFilter(c, step.filter, sourceId)
            );
          const optional = Boolean(step.optional);
          const requiredMin = step.minCount ?? step.count;
          if (hand.length < requiredMin || hand.length === 0) {
            break;
          }
          const maxDiscard = Math.min(step.count, hand.length);
          const minDiscard = optional ? 0 : Math.min(requiredMin, maxDiscard);
          const effectType = step.choiceEffectType ?? `DSL_DISCARD_COST_${cardNumber}`;
          const promptBase = step.prompt ?? `请选择 ${step.count} 张手牌丢弃作为代价`;
          this.host.enqueueDslChoice(
            {
              id: this.host.choiceId('step-discard-cost'),
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: optional ? `${promptBase} (不选择则不发动)` : promptBase,
              options: hand.map((c) => this.host.effects.createGeneralCardChoiceOption(c)),
              effectType,
              sourceCardInstanceId: sourceId,
              minSelections: minDiscard,
              maxSelections: maxDiscard,
            },
            {
              cardNumber,
              sourceCardInstanceId: sourceId,
              playerId,
              vars,
              remainingSteps: queue,
              pendingAction: {
                kind: 'COST_DISCARD',
                onPaid: [...step.onPaid],
                optional,
                requiredMin,
                savePaidToVar: step.savePaidToVar,
              },
            }
          );
          return;
        }

        case 'PAY_COST_STEP': {
          const amount = Math.max(
            0,
            Math.floor(this.host.evaluator.evalNumberExpr(step.amount, playerId, sourceId, vars))
          );
          const player = this.host.ctx.state.players[playerId];
          const avail = (player?.availableOpenCostCount ?? 0) + (player?.hiddenCostCount ?? 0);
          const optional = Boolean(step.optional);
          if (amount <= 0) {
            queue.unshift(...step.onPaid);
            break;
          }
          if (avail < amount) {
            break;
          }
          if (!optional) {
            if (this.host.ctx.payCost(playerId, amount)) {
              queue.unshift(...step.onPaid);
            }
            break;
          }
          const effectType = step.choiceEffectType ?? `DSL_PAY_COST_${cardNumber}`;
          this.host.enqueueDslChoice(
            {
              id: this.host.choiceId('step-pay-cost'),
              playerId,
              choiceType: 'SELECT_OPTION',
              prompt: this.host.evaluator.formatPrompt(
                step.prompt ?? `是否支付 ${amount} 费？`,
                playerId
              ),
              options: [
                { id: 'pay_cost', label: `支付 ${amount} 费` },
                { id: 'skip', label: '不支付' },
              ],
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
              remainingSteps: queue,
              pendingAction: {
                kind: 'COST_PAY_COST',
                amount,
                onPaid: [...step.onPaid],
                optional: true,
              },
            }
          );
          return;
        }

        case 'TAP_FIELD_CARD_COST_STEP': {
          // Q&A·2/7 (BP01-023)：只能横置我方战场卡位上的竖直顶层卡牌 (角色/辅助机/单独装备)，不可横置装备中或下方的牌
          const readyTopCards: CardInstance[] = [];
          for (const slot of this.host.ctx.fieldMgr.getSlots(playerId)) {
            for (const id of [slot.roleCardId, slot.assistCardId, slot.standaloneEquipmentId]) {
              if (!id) continue;
              const c = this.host.ctx.state.cards[id];
              if (c && c.isReady) readyTopCards.push(c);
            }
          }
          if (readyTopCards.length === 0) break;
          const optional = step.optional !== false;
          const effectType = step.choiceEffectType ?? `DSL_TAP_FIELD_COST_${cardNumber}`;
          const promptBase = step.prompt ?? '请选择我方战场 1 张竖直状态的卡牌横置作为代价';
          this.host.enqueueDslChoice(
            {
              id: this.host.choiceId('tap-field-cost'),
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: optional ? `${promptBase} (不选择则不发动)` : promptBase,
              options: readyTopCards.map((c) => this.host.effects.createGeneralCardChoiceOption(c)),
              effectType,
              sourceCardInstanceId: sourceId,
              minSelections: optional ? 0 : 1,
              maxSelections: 1,
            },
            {
              cardNumber,
              sourceCardInstanceId: sourceId,
              playerId,
              vars,
              remainingSteps: queue,
              pendingAction: {
                kind: 'COST_TAP_FIELD',
                onPaid: [...step.onPaid],
                optional,
              },
            }
          );
          return;
        }

        case 'EQUIP_FROM_VAR': {
          const eqIds = vars[step.varName] ?? [];
          const hostId = this.host.evaluator.resolveTargetIds(step.host, playerId, sourceId, vars)[0];
          if (hostId) {
            for (const eqId of eqIds) {
              if (this.host.ctx.fieldMgr.equipToRole(playerId, eqId, hostId)) {
                const eqCard = this.host.ctx.state.cards[eqId];
                const eqDef = eqCard ? this.host.def(eqCard) : undefined;
                if (eqDef) {
                  this.host.effects.handleEquipmentBuff(hostId, eqDef);
                }
              }
            }
          }
          break;
        }

        case 'PLACE_ORB_AT_POSITION': {
          const orbId = (vars[step.varName] ?? [])[0];
          if (!orbId) break;
          const orbZone = this.host.zone(playerId, 'SIGNAL_ORB');
          if (orbZone.length === 0) {
            this.host.ctx.zoneMgr.moveCard(orbId, 'SIGNAL_ORB', { isFaceUp: true, isReady: true });
            break;
          }
          const options: { id: string; label: string }[] = [];
          for (let pos = 0; pos <= orbZone.length; pos++) {
            const belowCard = pos > 0 ? orbZone[pos - 1] : undefined;
            const belowLabel = belowCard
              ? belowCard.isFaceUp
                ? `【${this.host.def(belowCard)?.name ?? pos}】`
                : `背面信号球 #${pos}`
              : String(pos);
            const label =
              pos === 0
                ? '放置到信号球区最下方 (位置 1)'
                : pos === orbZone.length
                  ? `放置到信号球区最上方 (位置 ${pos + 1})`
                  : `放置到第 ${pos + 1} 位 (在${belowLabel}上方)`;
            options.push({ id: String(pos), label });
          }
          const effectType = step.choiceEffectType ?? `DSL_PLACE_ORB_POS_${cardNumber}`;
          this.host.enqueueDslChoice(
            {
              id: this.host.choiceId('place-orb-pos'),
              playerId,
              choiceType: 'SELECT_OPTION',
              prompt: step.prompt ?? '请选择将该信号球放置到我方信号球区的哪个位置：',
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
              remainingSteps: queue,
              pendingAction: { kind: 'PLACE_ORB_AT_POSITION', cardInstanceId: orbId },
            }
          );
          return;
        }

        case 'SHUFFLE_DECK': {
          const targetPlayer = this.host.resolveSide(playerId, step.side ?? 'SELF');
          this.host.ctx.zoneMgr.shuffleDeck(targetPlayer);
          break;
        }

        case 'REORDER_ZONE': {
          const cards = this.host.zone(playerId, step.zone);
          if (cards.length <= 1) break;
          const effectType = step.choiceEffectType ?? `DSL_REORDER_${cardNumber}`;
          this.host.enqueueDslChoice(
            {
              id: this.host.choiceId(effectType),
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: this.host.evaluator.formatPrompt(step.prompt, playerId, {
                orbCount: cards.length,
              }),
              options: cards.map((c, idx) =>
                !c.isFaceUp && (c.zone === 'SIGNAL_ORB' || c.zone === 'COST')
                  ? {
                      id: c.instanceId,
                      label:
                        c.zone === 'SIGNAL_ORB'
                          ? `背面信号球 #${idx + 1}`
                          : `背面暗费 #${idx + 1}`,
                    }
                  : this.host.effects.createGeneralCardChoiceOption(c)
              ),
              effectType,
              sourceCardInstanceId: sourceId,
              minSelections: cards.length,
              maxSelections: cards.length,
            },
            {
              cardNumber,
              sourceCardInstanceId: sourceId,
              playerId,
              vars,
              remainingSteps: queue,
              pendingAction: { kind: 'REORDER_ZONE', zone: step.zone },
            }
          );
          return;
        }

        case 'MOVE_CARDS': {
          const targets = this.host.evaluator.resolveTargetIds(
            step.target,
            playerId,
            sourceId,
            vars
          );
          if (step.chooseOrder) {
            const wanshimingMovedSet = new Set(vars.__wanshimingMovedToCost ?? []);
            const candidateIds = targets.filter((id) => {
              const card = this.host.ctx.state.cards[id];
              if (!card) return false;
              if (wanshimingMovedSet.has(id) && card.zone !== 'PROCESSING') {
                return false;
              }
              if (
                step.target.kind === 'REST_OF_VAR' &&
                card.zone !== 'PROCESSING' &&
                card.zone !== 'DECK'
              ) {
                return false;
              }
              return true;
            });
            if (candidateIds.length >= 2) {
              const cards = candidateIds
                .map((id) => this.host.ctx.state.cards[id])
                .filter((c): c is CardInstance => Boolean(c));
              const isAllPrivate =
                cards.length > 0 &&
                cards.some(
                  (c) =>
                    c.zone === 'DECK' ||
                    ((c.zone === 'SIGNAL_ORB' || c.zone === 'COST') && !c.isFaceUp)
                );
              const peekedSet = new Set(vars.__peekedIds ?? []);
              const defaultOrderPrompt =
                step.toZone === 'DECK_BOTTOM'
                  ? `请按顺序依次点选全部 ${candidateIds.length} 张牌置入牌组底（先选者靠上、后选者在最底）：`
                  : step.toZone === 'DECK_TOP'
                    ? `请按顺序依次点选全部 ${candidateIds.length} 张牌置入牌组顶（先选者靠下、后选者在最顶）：`
                    : step.toZone === 'SIGNAL_ORB_BOTTOM'
                      ? `请按顺序依次点选全部 ${candidateIds.length} 张牌放置到信号球区最下方（先选者靠上、后选者在最下方）：`
                      : `请按顺序依次点选全部 ${candidateIds.length} 张牌放置到信号球区（先选者靠下、后选者在最上方）：`;
              const effectType = step.orderChoiceEffectType ?? `DSL_ORDER_MOVE_${cardNumber}`;
              this.host.enqueueDslChoice(
                {
                  id: this.host.choiceId(effectType),
                  playerId,
                  choiceType: 'SELECT_CARDS',
                  prompt: step.orderPrompt
                    ? this.host.evaluator.formatPrompt(step.orderPrompt, playerId, {
                        count: candidateIds.length,
                      })
                    : defaultOrderPrompt,
                  options: cards.map((c, idx) =>
                    !c.isFaceUp &&
                    (c.zone === 'SIGNAL_ORB' || c.zone === 'COST') &&
                    !peekedSet.has(c.instanceId)
                      ? {
                          id: c.instanceId,
                          label:
                            c.zone === 'SIGNAL_ORB'
                              ? `背面信号球 #${idx + 1}`
                              : `背面暗费 #${idx + 1}`,
                        }
                      : this.host.effects.createGeneralCardChoiceOption(c)
                  ),
                  effectType,
                  sourceCardInstanceId: sourceId,
                  minSelections: candidateIds.length,
                  maxSelections: candidateIds.length,
                },
                {
                  cardNumber,
                  sourceCardInstanceId: sourceId,
                  playerId,
                  vars,
                  remainingSteps: queue,
                  pendingAction: {
                    kind: 'ORDER_MOVE_CARDS',
                    moveStep: step,
                    candidateIds,
                  },
                },
                isAllPrivate ? undefined : { revealed: candidateIds }
              );
              return;
            }
          }
          if (this.executeMoveCardsStep(step, targets, cardNumber, playerId, sourceId, vars, queue)) {
            return;
          }
          break;
        }

        case 'ASCEND_FROM_VAR': {
          const cardId = (vars[step.cardVar] ?? [])[0];
          const targetId = (vars[step.targetVar] ?? [])[0];
          const extraId = step.extraStackVar ? (vars[step.extraStackVar] ?? [])[0] : undefined;
          if (cardId && targetId) {
            const tax = this.host.ctx.fieldMgr.getTappedWanshiAscensionTax(playerId, [targetId]);
            if (tax > 0) {
              this.host.ctx.zoneMgr.syncCostStats(playerId);
              const player = this.host.ctx.state.players[playerId];
              const availCost =
                (player?.availableOpenCostCount ?? 0) + (player?.hiddenCostCount ?? 0);
              if (availCost >= tax) {
                const targetCard = this.host.ctx.state.cards[targetId];
                const targetName = (targetCard && this.host.def(targetCard)?.name) ?? '目标角色';
                this.host.enqueueDslChoice(
                  {
                    id: this.host.choiceId('wanshi-ascend-tax'),
                    playerId,
                    choiceType: 'YES_NO',
                    prompt: `对方场上有横置状态的《万事·明晰梦》，在横置的《${targetName}》上方升变须额外支付 ${tax} 费，是否支付并升变？`,
                    options: [
                      { id: 'opt_yes', label: `额外支付 ${tax} 费升变` },
                      { id: 'opt_no', label: '不支付（跳过升变）' },
                    ],
                    effectType: 'BP02_067_ASCEND_TAX_CONFIRM',
                    sourceCardInstanceId: sourceId,
                    minSelections: 1,
                    maxSelections: 1,
                  },
                  {
                    cardNumber,
                    sourceCardInstanceId: sourceId,
                    playerId,
                    vars,
                    remainingSteps: queue,
                    pendingAction: {
                      kind: 'ASCEND_FROM_VAR_WITH_TAX',
                      cardId,
                      targetId,
                      extraId,
                      tax,
                      shuffleDeckAfter: Boolean(step.shuffleDeckAfter),
                    },
                  }
                );
                return;
              }
            } else {
              this.host.ctx.fieldMgr.playAscensionCard(playerId, cardId, targetId, {
                extraStackRoleCardId: extraId,
              });
            }
          }
          if (step.shuffleDeckAfter) {
            this.host.ctx.zoneMgr.shuffleDeck(playerId);
          }
          break;
        }

        case 'DEAL_DAMAGE': {
          const targetPlayer = this.host.resolveSide(playerId, step.side);
          this.host.ctx.zoneMgr.applyDamageToPlayer(
            targetPlayer,
            step.amount,
            sourceId || undefined,
            {
              deferCheckTiming: queue.length > 0,
            }
          );
          if (this.host.ctx.state.status === 'FINISHED') {
            return;
          }
          if (
            (this.host.ctx.state.currentPendingChoice ||
              this.host.ctx.zoneMgr.hasPendingCharges()) &&
            queue.length > 0
          ) {
            this.host.ctx.state.pendingDslContinuations ??= [];
            this.host.ctx.state.pendingDslContinuations.push({
              cardNumber,
              sourceCardInstanceId: sourceId,
              playerId,
              vars: { ...vars },
              remainingSteps: [...queue],
            });
            return;
          }
          break;
        }

        case 'MARK_GAME_ABILITY_USED': {
          const player = this.host.ctx.state.players[playerId];
          if (player) {
            player.gameAbilityUsage[step.abilityKey] =
              (player.gameAbilityUsage[step.abilityKey] ?? 0) + 1;
          }
          break;
        }

        case 'MARK_TURN_ABILITY_USED': {
          const player = this.host.ctx.state.players[playerId];
          if (player) {
            const key =
              step.abilityKey === '__TRIGGER_ONCE_KEY__' && vars.__oncePerTurnKey?.[0]
                ? vars.__oncePerTurnKey[0]
                : `${sourceId}:${step.abilityKey}`;
            player.turnAbilityUsage[key] = (player.turnAbilityUsage[key] ?? 0) + 1;
          }
          break;
        }

        case 'DESTROY_ROLES': {
          const isResumedRest =
            step.target.kind === 'VAR' && step.target.varName === '__pendingReplaceRest';
          const targets = this.host.evaluator.resolveTargetIds(
            step.target,
            playerId,
            sourceId,
            vars
          );
          if (isResumedRest) {
            delete vars.__pendingReplaceRest;
          }
          const destroyed: string[] =
            isResumedRest && vars.__pendingReplaceAccum ? [...vars.__pendingReplaceAccum] : [];
          if (isResumedRest) {
            delete vars.__pendingReplaceAccum;
          }
          for (let i = 0; i < targets.length; i++) {
            const id = targets[i]!;
            const prevPendingId = this.host.ctx.state.currentPendingChoice?.id;
            const prevQueueLen = this.host.ctx.state.pendingChoiceQueue?.length ?? 0;
            const prevEventCount = this.host.ctx.events.length;
            if (this.host.destroy(id)) {
              destroyed.push(id);
            }
            if (this.didCreatePendingChoice(prevPendingId, prevQueueLen)) {
              const remainingTargets = targets.slice(i + 1);
              if (remainingTargets.length > 0 || queue.length > 0 || Boolean(step.saveDestroyedToVar)) {
                const resumeQueue: EffectStep[] = [...queue];
                if (remainingTargets.length > 0) {
                  vars.__pendingReplaceRest = remainingTargets;
                  resumeQueue.unshift({
                    ...step,
                    target: { kind: 'VAR', varName: '__pendingReplaceRest' },
                  });
                }
                vars.__pendingReplaceVerify = [
                  'DESTROY',
                  id,
                  step.saveDestroyedToVar ?? '',
                  String(prevEventCount),
                ];
                vars.__pendingReplacePartial = [...destroyed];
                if (step.saveDestroyedToVar) vars[step.saveDestroyedToVar] = [...destroyed];
                this.pushContinuation(cardNumber, sourceId, playerId, vars, resumeQueue);
                return;
              }
            }
          }
          if (step.saveDestroyedToVar) vars[step.saveDestroyedToVar] = destroyed;
          break;
        }

        case 'SET_READY': {
          const targets = this.host.evaluator.resolveTargetIds(
            step.target,
            playerId,
            sourceId,
            vars
          );
          const syncCostPlayers = new Set<string>();
          for (const id of targets) {
            const card = this.host.ctx.state.cards[id];
            if (!card) continue;
            if (step.target.kind === 'SELF' && !this.host.ctx.fieldMgr.isSlotRole(playerId, id)) {
              continue;
            }
            this.host.ctx.zoneMgr.setCardReady(id, step.isReady);
            if (card.zone === 'COST') syncCostPlayers.add(card.controllerPlayerId);
          }
          for (const pid of syncCostPlayers) {
            this.host.ctx.zoneMgr.syncCostStats(pid);
          }
          break;
        }

        case 'SET_FROZEN': {
          // 10.15 冰冻：被冰冻卡牌在下个操控玩家竖直阶段无法因规则竖直 (10.15.3.1 已冰冻则维持现状)
          const targets = this.host.evaluator.resolveTargetIds(
            step.target,
            playerId,
            sourceId,
            vars
          );
          for (const id of targets) {
            const card = this.host.ctx.state.cards[id];
            if (!card || card.zone !== 'BATTLEFIELD') continue;
            card.isFrozen = step.isFrozen ? true : undefined;
          }
          break;
        }

        case 'PREVENT_COMBAT_DAMAGE': {
          // 1.3.3 / Q&A·7 (PR-034)：本次攻击不会给予玩家伤害 (含【贯通】伤害)
          if (this.host.ctx.state.currentCombat) {
            this.host.ctx.state.currentCombat.cannotDealDamage = true;
          }
          break;
        }

        case 'SET_COMBAT_MAX_DAMAGE': {
          const combat = this.host.ctx.state.currentCombat;
          if (combat) {
            combat.maxDamageInDamageStep =
              combat.maxDamageInDamageStep === undefined
                ? step.maxDamage
                : Math.min(combat.maxDamageInDamageStep, step.maxDamage);
          }
          break;
        }

        case 'REDIRECT_ATTACK': {
          const combat = this.host.ctx.state.currentCombat;
          if (!combat) break;
          if (step.targetType === 'PLAYER') {
            combat.targetType = 'PLAYER';
            combat.targetCardId = undefined;
            combat.blockerCardId = undefined;
          } else {
            const attackerCard = this.host.ctx.state.cards[combat.attackerCardId];
            if (!attackerCard) break;
            const defenderId = this.host.resolveSide(
              attackerCard.controllerPlayerId,
              'OPPONENT'
            );
            const targetId = this.host.evaluator.resolveTargetIds(
              step.target,
              playerId,
              sourceId,
              vars
            )[0];
            const targetCard = targetId ? this.host.ctx.state.cards[targetId] : undefined;
            if (
              targetId &&
              targetCard &&
              targetCard.controllerPlayerId === defenderId &&
              this.host.ctx.fieldMgr.isSlotRole(defenderId, targetId)
            ) {
              combat.targetType = 'CHARACTER';
              combat.targetCardId = targetId;
              combat.blockerCardId = undefined;
            }
          }
          break;
        }

        case 'AIRBORNE': {
          // 10.18 将目标角色【浮空】到处理区成为【浮空模式】
          const targets = this.host.evaluator.resolveTargetIds(
            step.target,
            playerId,
            sourceId,
            vars
          );
          const airborned: string[] = [];
          for (const id of targets) {
            if (this.host.ctx.fieldMgr.airborneRole(id)) airborned.push(id);
          }
          if (step.saveAirborneToVar) vars[step.saveAirborneToVar] = airborned;
          break;
        }

        case 'ATTACH_PARTNER': {
          // 8.13.3.d.1 通过卡牌能力使指定卡牌成为协战搭档 (可不满足协战搭档条件，不计入回合协战次数)
          const hosts = this.host.evaluator.resolveTargetIds(step.host, playerId, sourceId, vars);
          const partners = this.host.evaluator.resolveTargetIds(
            step.partner,
            playerId,
            sourceId,
            vars
          );
          const hostId = hosts[0];
          const partnerId = partners[0];
          const prevPartnerZone = partnerId ? this.host.ctx.state.cards[partnerId]?.zone : undefined;
          if (
            hostId &&
            partnerId &&
            this.host.ctx.fieldMgr.attachPartner(playerId, hostId, partnerId, {
              releaseToDeckBottom: step.releaseToDeckBottom,
            })
          ) {
            this.host.ctx.triggerMgr?.emit({
              type: 'PARTNER_GAINED',
              playerId,
              cardInstanceId: hostId,
              targetCardId: partnerId,
              fromZone: prevPartnerZone,
            });
          }
          break;
        }

        case 'DETACH_AND_MOVE_PARTNER': {
          const hosts = this.host.evaluator.resolveTargetIds(step.host, playerId, sourceId, vars);
          for (const hostId of hosts) {
            const host = this.host.ctx.state.cards[hostId];
            const partnerId = host?.partnerCardId;
            const partner = partnerId ? this.host.ctx.state.cards[partnerId] : undefined;
            if (!host || !partnerId || !partner) continue;
            // 8.7.4：必须在解除协战并移动前采集搭档快照
            const partnerSnapshot = this.host.ctx.triggerMgr?.snapshotCard(partnerId);
            host.partnerCardId = undefined;
            partner.partnerOfCardId = undefined;
            partner.cannotReleasePartnerUntilTurn = undefined;
            partner.releasePartnerToDeckBottom = undefined;
            if (step.toZone === 'BATTLEFIELD') {
              if (!this.host.bringToField(host.controllerPlayerId, partnerId, step.triggerEntry !== false)) {
                this.host.ctx.zoneMgr.moveCard(partnerId, 'GRAVEYARD', { isFaceUp: true });
              }
            } else if (step.toZone === 'DECK_BOTTOM') {
              this.host.ctx.zoneMgr.moveCardToBottomOfDeck(partnerId);
            } else {
              this.host.ctx.zoneMgr.moveCard(partnerId, step.toZone, { isFaceUp: true });
            }
            this.host.ctx.triggerMgr?.emit({
              type: 'PARTNER_RELEASED',
              playerId: host.controllerPlayerId,
              cardInstanceId: hostId,
              targetCardId: partnerId,
              subjectSnapshot: partnerSnapshot,
            });
          }
          break;
        }

        case 'COPY_STATS_FROM_VAR': {
          const refId = (vars[step.fromVar] ?? [])[0];
          const refCard = refId ? this.host.ctx.state.cards[refId] : undefined;
          const refDef = refCard ? this.host.def(refCard) : undefined;
          if (!refCard || !refDef) break;
          const targets = this.host.evaluator.resolveTargetIds(
            step.target,
            playerId,
            sourceId,
            vars
          );
          const untilTurn = this.host.evaluator.resolveUntilTurn(step.duration, turn);
          for (const id of targets) {
            const card = this.host.ctx.state.cards[id];
            if (!card) continue;
            const mod: CardModifier = {
              ...(step.duration === 'END_OF_COMBAT'
                ? {
                    id: `combat-${card.instanceId}-${nextEffectTimestamp(this.host.ctx.state)}`,
                  }
                : {}),
              ...(step.copyBasePP ? { setBasePP: refDef.basePP ?? 0 } : {}),
              ...(step.copyBaseDP ? { setBaseDP: refDef.baseDP ?? 0 } : {}),
              untilTurn,
              source: cardNumber,
              sourceCardInstanceId: sourceId,
              appliedByPlayerId: playerId,
            };
            addCardModifier(this.host.ctx.state, card, mod);
          }
          break;
        }

        case 'INCREMENT_CARDS_PLAYED_THIS_TURN': {
          const player = this.host.ctx.state.players[playerId];
          if (player) {
            player.cardsPlayedThisTurn = (player.cardsPlayedThisTurn ?? 0) + (step.amount ?? 1);
          }
          break;
        }

        case 'REGISTER_REPLACEMENT': {
          const untilTurn = this.host.evaluator.resolveUntilTurn(step.duration, turn);
          const expiresAtCombatEnd = step.duration === 'END_OF_COMBAT' ? true : undefined;
          const commonFields = {
            action: step.action,
            once: step.once,
            untilTurn,
            ...(expiresAtCombatEnd ? { expiresAtCombatEnd } : {}),
            ...(step.destroyReason ? { destroyReason: step.destroyReason } : {}),
            ...(step.fromZone ? { fromZone: step.fromZone } : {}),
            ...(step.toZone ? { toZone: step.toZone } : {}),
            ...(step.label ? { label: step.label } : {}),
            source: cardNumber,
          };
          if (step.eventType === 'DEAL_DAMAGE') {
            const controllerPlayerId = this.host.resolveSide(playerId, step.targetSide ?? 'SELF');
            const sourceCardInstanceId = step.target
              ? this.host.evaluator.resolveTargetIds(step.target, playerId, sourceId, vars)[0]
              : undefined;
            if (step.target && !sourceCardInstanceId) break;
            this.host.ctx.replacementEngine?.addActiveReplacement({
              eventType: step.eventType,
              controllerPlayerId,
              ...(sourceCardInstanceId ? { sourceCardInstanceId } : {}),
              ...commonFields,
            });
            break;
          }
          if (!step.target) break;
          const targets = this.host.evaluator.resolveTargetIds(
            step.target,
            playerId,
            sourceId,
            vars
          );
          for (const id of targets) {
            const card = this.host.ctx.state.cards[id];
            if (!card) continue;
            this.host.ctx.replacementEngine?.addActiveReplacement({
              eventType: step.eventType,
              targetCardInstanceId: id,
              controllerPlayerId: card.controllerPlayerId,
              ...commonFields,
            });
          }
          break;
        }

        case 'MODIFY_STATS': {
          const targets = this.host.evaluator.resolveTargetIds(
            step.target,
            playerId,
            sourceId,
            vars
          );
          const untilTurn = this.host.evaluator.resolveUntilTurn(step.duration, turn);
          const source = step.source ?? cardNumber;
          for (const id of targets) {
            const card = this.host.ctx.state.cards[id];
            if (!card) continue;
            if (step.target.kind === 'SELF' && !this.host.ctx.fieldMgr.isSlotRole(playerId, id)) {
              continue;
            }
            const evalNum = (expr: Parameters<DslInterpreterHost['evaluator']['evalNumberExpr']>[0]) =>
              this.host.evaluator.evalNumberExpr(expr, playerId, sourceId, vars);
            const mod: CardModifier = {
              ...(step.duration === 'END_OF_COMBAT'
                ? {
                    id: `combat-${card.instanceId}-${nextEffectTimestamp(this.host.ctx.state)}`,
                  }
                : {}),
              ...(step.pp !== undefined ? { pp: evalNum(step.pp) } : {}),
              ...(step.dp !== undefined ? { dp: evalNum(step.dp) } : {}),
              ...(step.setBasePP !== undefined ? { setBasePP: evalNum(step.setBasePP) } : {}),
              ...(step.setBaseDP !== undefined ? { setBaseDP: evalNum(step.setBaseDP) } : {}),
              ...(step.setPP !== undefined ? { setPP: evalNum(step.setPP) } : {}),
              ...(step.setDP !== undefined ? { setDP: evalNum(step.setDP) } : {}),
              ...(step.charge !== undefined ? { charge: evalNum(step.charge) } : {}),
              ...(step.chargeIsAbility ? { chargeIsAbility: true } : {}),
              ...(step.setCharge !== undefined ? { setCharge: evalNum(step.setCharge) } : {}),
              ...(step.keywords ? { keywords: step.keywords } : {}),
              ...(step.removeKeywords ? { removeKeywords: step.removeKeywords } : {}),
              ...(step.addTraits ? { addTraits: step.addTraits } : {}),
              ...(step.clearBaseTraits ? { clearBaseTraits: true } : {}),
              ...(step.setCardType !== undefined ? { setCardType: step.setCardType } : {}),
              ...(step.costDelta !== undefined ? { costDelta: evalNum(step.costDelta) } : {}),
              ...(step.setCost !== undefined ? { setCost: evalNum(step.setCost) } : {}),
              ...(step.canAttackReadyRolesMaxCost !== undefined
                ? { canAttackReadyRolesMaxCost: step.canAttackReadyRolesMaxCost }
                : {}),
              ...(step.mustBeAttackTarget ? { mustBeAttackTarget: true } : {}),
              ...(step.loseAbilities ? { loseAbilities: true } : {}),
              ...(step.prohibitions ? { prohibitions: step.prohibitions } : {}),
              ...(step.treatedAsOrbColors ? { treatedAsOrbColors: step.treatedAsOrbColors } : {}),
              ...(step.orbValue !== undefined ? { orbValue: step.orbValue } : {}),
              ...(step.treatedAsNames ? { treatedAsNames: step.treatedAsNames } : {}),
              ...(step.grantedTriggerIds ? { grantedTriggerIds: step.grantedTriggerIds } : {}),
              ...(step.canAttackPlayerOnEnterTurn ? { canAttackPlayerOnEnterTurn: true } : {}),
              ...(step.unblockableMaxPP !== undefined
                ? { unblockableMaxPP: step.unblockableMaxPP }
                : {}),
              untilTurn,
              source,
              sourceCardInstanceId: sourceId,
              appliedByPlayerId: playerId,
            };
            addCardModifier(this.host.ctx.state, card, mod);
          }
          break;
        }

        case 'ADD_COST_MODIFIER': {
          const player = this.host.ctx.state.players[playerId]!;
          const amount = this.host.evaluator.evalNumberExpr(step.amount, playerId, sourceId, vars);
          player.costModifiers = [
            ...(player.costModifiers ?? []),
            {
              id: `cost-mod-${sourceId}-${this.host.ctx.events.length}`,
              amount,
              targetTrait: step.targetTrait,
              targetName: step.targetName,
              cardType: step.cardType,
              excludeAscension: step.excludeAscension,
              remainingCount: step.remainingCount,
            },
          ];
          const sourceCard = this.host.ctx.state.cards[sourceId];
          const sourceDef = sourceCard ? this.host.def(sourceCard) : undefined;
          if (sourceDef && step.logText) {
            this.host.ctx.events.push({
              type: 'ABILITY_ACTIVATED',
              playerId,
              cardInstanceId: sourceId,
              abilityName: `${sourceDef.name}【起】`,
              rulesText: step.logText,
            });
          }
          break;
        }

        case 'CHANGE_EROSION': {
          const targetPlayer = this.host.resolveSide(playerId, step.side ?? 'SELF');
          const player = this.host.ctx.state.players[targetPlayer];
          if (!player) break;
          const previous = player.erosionCount;
          player.erosionCount = Math.max(0, player.erosionCount + step.delta);
          if (player.erosionCount !== previous) {
            player.erosionChangedThisTurn = true;
          }
          if (step.delta > 0) {
            this.host.ctx.events.push({
              type: 'EROSION_INCREASED',
              playerId: targetPlayer,
              previousValue: previous,
              newValue: player.erosionCount,
              reason: 'EFFECT',
            });
          }
          break;
        }

        case 'REGISTER_DELAYED_TRIGGER': {
          const triggerTurn = turn + (step.turnOffset ?? 0);
          if (step.abilityId === 'DELAYED_END_OF_TURN_DRAW') {
            const drawController = this.host.resolveSide(playerId, step.targetSide ?? 'SELF');
            const drawCount = step.drawCount ?? 1;
            this.host.ctx.triggerMgr?.registerDelayedTrigger({
              eventType: step.eventType,
              triggerTurn,
              sourceCardInstanceId: sourceId,
              sourceCardNumber: cardNumber,
              controllerPlayerId: drawController,
              abilityId: step.abilityId,
              label: step.labelSuffix ?? `回合结束时抽 ${drawCount} 张牌`,
              once: true,
              payload: { count: drawCount },
            });
            break;
          }
          if (step.abilityId === 'DELAYED_ATTACK_END_DEPLOY_PARTNER') {
            const hostCard = this.host.ctx.state.cards[sourceId];
            const partnerId =
              this.host.evaluator.resolveTargetIds(step.target, playerId, sourceId, vars)[0] ??
              hostCard?.partnerCardId;
            const partnerCard = partnerId ? this.host.ctx.state.cards[partnerId] : undefined;
            if (hostCard && partnerCard) {
              const partnerFromZone = vars.__partnerFromZone?.[0];
              const grantRush = Boolean(
                step.grantRushIfPartnerFromZone &&
                  partnerFromZone === step.grantRushIfPartnerFromZone
              );
              this.host.ctx.triggerMgr?.registerDelayedTrigger({
                eventType: step.eventType,
                triggerTurn,
                sourceCardInstanceId: hostCard.instanceId,
                sourceCardNumber: cardNumber,
                controllerPlayerId: hostCard.controllerPlayerId,
                abilityId: 'DELAYED_ATTACK_END_DEPLOY_PARTNER',
                label:
                  step.labelSuffix ??
                  `【${this.host.def(partnerCard)?.name ?? partnerCard.cardNumber}】攻击结束时从协战搭档出场${grantRush ? '并获得【速攻】' : ''}`,
                once: true,
                payload: {
                  hostCardId: hostCard.instanceId,
                  partnerCardId: partnerCard.instanceId,
                  grantRush,
                },
              });
            }
            break;
          }
          const targets = this.host.evaluator.resolveTargetIds(
            step.target,
            playerId,
            sourceId,
            vars
          );
          const expectedZone = step.expectedZone ?? 'BATTLEFIELD';
          const defaultLabel =
            step.abilityId === 'DELAYED_END_OF_TURN_UNTAP'
              ? '该回合结束时将其竖直'
              : step.abilityId === 'DELAYED_END_OF_TURN_TO_DECK_BOTTOM'
                ? '该回合结束时放置到牌组底'
                : step.abilityId === 'DELAYED_ATTACK_END_TO_SIGNAL_ORB_BOTTOM'
                  ? '那次攻击结束时放置到我方信号球区最下方'
                  : '该回合结束时放置到墓地';
          for (const id of targets) {
            const card = this.host.ctx.state.cards[id];
            if (!card) continue;
            if (step.markLegacyEndOfTurnToGraveyard && expectedZone === 'BATTLEFIELD') {
              card.endOfTurnToGraveyard = triggerTurn;
            }
            this.host.ctx.triggerMgr?.registerDelayedTrigger({
              eventType: step.eventType,
              triggerTurn,
              sourceCardInstanceId: id,
              sourceCardNumber: card.cardNumber,
              controllerPlayerId: card.controllerPlayerId,
              abilityId: step.abilityId,
              label: `【${this.host.def(card)?.name ?? card.cardNumber}】${step.labelSuffix ?? defaultLabel}`,
              once: true,
              payload: {
                expectedZone,
                expectedEnteredTimestamp: card.enteredZoneTimestamp,
              },
            });
          }
          break;
        }

        case 'IF': {
          const branch = this.host.evaluator.evalCondition(
            step.condition,
            playerId,
            sourceId,
            vars
          )
            ? step.then
            : (step.else ?? []);
          if (branch.length > 0) {
            queue.unshift(...branch);
          }
          break;
        }

        case 'CUSTOM_HANDLER': {
          const paused = startCustomHandler(
            step.handlerId,
            this.host.makeCustomRuntime(),
            cardNumber,
            sourceId,
            playerId,
            vars,
            queue
          );
          if (paused) return;
          break;
        }
      }
    }
  }

  resolveStepChoice(
    pending: StepPendingAction,
    action: DslChoiceAction,
    frame: DslExecutionFrame,
    vars: Record<string, string[]>,
    remaining: EffectStep[]
  ): DslResult {
    const { playerId, cardNumber, sourceCardInstanceId } = frame;
    const selected = action.selectedIds;

    switch (pending.kind) {
      case 'COST_TAP_FIELD': {
        if (selected.length === 0) {
          if (pending.optional) {
            if (remaining.length > 0) {
              this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
            }
            return { success: true };
          }
          return { success: false, error: '必须横置我方战场1张牌作为代价' };
        }
        const tapId = selected[0]!;
        const tapCard = this.host.ctx.state.cards[tapId];
        if (!tapCard || !tapCard.isReady) {
          return { success: false, error: '所选战场卡牌不可横置' };
        }
        this.host.ctx.zoneMgr.setCardReady(tapId, false);
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, [
          ...pending.onPaid,
          ...remaining,
        ]);
        return { success: true };
      }

      case 'CONFIRM_YES_NO': {
        const branch = selected[0] === 'opt_yes' ? pending.onYes : (pending.onNo ?? []);
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, [
          ...branch,
          ...remaining,
        ]);
        return { success: true };
      }

      case 'CHOOSE_MODE': {
        const modeMap = new Map(pending.modes.map((m) => [m.id, m.steps]));
        const chosenSteps: EffectStep[] = [];
        for (const modeId of selected) {
          const steps = modeMap.get(modeId);
          if (steps) chosenSteps.push(...steps);
        }
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, [
          ...chosenSteps,
          ...remaining,
        ]);
        return { success: true };
      }

      case 'SAVE_CHOICE': {
        if (pending.requireEmptySlotCount && selected.length > this.host.emptySlotCount(playerId)) {
          return {
            success: false,
            error: `战场空余卡位不足，最多只能出场 ${this.host.emptySlotCount(playerId)} 张角色`,
          };
        }
        if (pending.maxTotalCost !== undefined && selected.length > 0) {
          let totalCost = 0;
          for (const id of selected) {
            const card = this.host.ctx.state.cards[id];
            const def = card ? this.host.def(card) : undefined;
            if (!def) continue;
            // 支持牌组中费用减免 (如 BP01-002 露西亚·鸦羽：若场上有<里>和<丽芙>手牌和牌组费用-3)
            const discount =
              def.cardNumber === 'BP01-002'
                ? this.host.calculateHandCostDiscount(playerId, def.cardNumber)
                : 0;
            totalCost += Math.max(0, def.cost - discount);
          }
          if (totalCost > pending.maxTotalCost) {
            return {
              success: false,
              error: `所选卡牌费用合计 (${totalCost}) 超过了上限 ${pending.maxTotalCost}`,
            };
          }
        }
        if (pending.distinctTraits && selected.length > 1) {
          const cards = selected.map((id) => this.host.ctx.state.cards[id]!).filter(Boolean);
          if (!this.host.evaluator.canAssignDistinctTraits(cards, pending.distinctTraits)) {
            return {
              success: false,
              error:
                pending.distinctTraitsError ??
                `所选卡牌须分别对应不同特征：${pending.distinctTraits.map((t) => `<${t}>`).join('、')}`,
            };
          }
        }
        if (pending.uniqueNames && selected.length > 1) {
          const names = selected.map((id) => {
            const c = this.host.ctx.state.cards[id];
            return (c && this.host.def(c)?.name) ?? id;
          });
          if (new Set(names).size !== names.length) {
            return { success: false, error: '所选卡牌的名称必须各不相同' };
          }
        }
        if (pending.uniqueCardNumbers && selected.length > 1) {
          const nums = selected.map((id) => {
            const card = this.host.ctx.state.cards[id];
            return card ? extractCoreCardNumber(card.cardNumber) : id;
          });
          if (new Set(nums).size !== nums.length) {
            return { success: false, error: '所选卡牌的卡牌编号必须各不相同' };
          }
        }
        if (pending.distinctAttributes && selected.length > 1) {
          const attrs = selected.map((id) => {
            const c = this.host.ctx.state.cards[id];
            return (c && this.host.def(c)?.attribute) ?? id;
          });
          if (new Set(attrs).size !== attrs.length) {
            return { success: false, error: '所选卡牌的属性必须各不相同' };
          }
        }
        vars[pending.saveToVar] = [...selected];
        if (pending.revealPickedToProcessing && selected.length > 0) {
          const movedToProcessing: string[] = [];
          for (const id of selected) {
            if (this.host.ctx.zoneMgr.moveCard(id, 'PROCESSING', { isFaceUp: true })) {
              movedToProcessing.push(id);
            }
          }
          if (
            movedToProcessing.length > 0 &&
            this.tryEnqueueWanshimingRevealToCost(
              cardNumber,
              sourceCardInstanceId,
              playerId,
              pending.revealPickedTargetPlayerId ?? playerId,
              movedToProcessing,
              pending.saveToVar,
              vars,
              remaining
            )
          ) {
            return { success: true };
          }
        }
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
        return { success: true };
      }

      case 'REORDER_ZONE': {
        for (const id of selected) {
          const card = this.host.ctx.state.cards[id];
          if (!card || card.zone !== pending.zone) continue;
          delete this.host.ctx.state.cards[id];
          this.host.ctx.state.cards[id] = card;
        }
        this.host.ctx.zoneMgr.invalidateZoneCache();
        this.host.ctx.continuousEffects?.invalidateEvalFrame();
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
        return { success: true };
      }

      case 'ORDER_MOVE_CARDS': {
        const candidateSet = new Set(pending.candidateIds);
        if (
          selected.length !== pending.candidateIds.length ||
          new Set(selected).size !== selected.length ||
          selected.some((id) => !candidateSet.has(id))
        ) {
          return { success: false, error: '请选择全部待排序卡牌的完整排列' };
        }
        if (
          this.executeMoveCardsStep(
            pending.moveStep,
            selected,
            cardNumber,
            playerId,
            sourceCardInstanceId,
            vars,
            remaining
          )
        ) {
          return { success: true };
        }
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
        return { success: true };
      }

      case 'PLACE_ORB_AT_POSITION': {
        const idx = Number(selected[0] ?? '0');
        const safeIdx = Number.isFinite(idx) ? idx : 0;
        this.host.ctx.zoneMgr.insertCardIntoZoneAtIndex(
          pending.cardInstanceId,
          'SIGNAL_ORB',
          safeIdx,
          {
            isFaceUp: true,
            isReady: true,
          }
        );
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
        return { success: true };
      }

      case 'WANSHIMING_REVEAL_TO_COST': {
        const movedSet = new Set<string>();
        for (const id of selected) {
          const card = this.host.ctx.state.cards[id];
          if (!card || card.zone !== 'PROCESSING') continue;
          // 3.6.4 / Q&A·5：以横置状态放置到费用区，费用区满 10 张时 ZoneManager 自动改放墓地
          this.host.ctx.zoneMgr.moveCard(id, 'COST', { isFaceUp: true, isReady: false });
          this.host.ctx.zoneMgr.syncCostStats(card.controllerPlayerId);
          movedSet.add(id);
        }
        if (movedSet.size > 0) {
          vars.__wanshimingMovedToCost = Array.from(
            new Set([...(vars.__wanshimingMovedToCost ?? []), ...movedSet])
          );
          if (vars[pending.revealVar]) {
            vars[pending.revealVar] = vars[pending.revealVar]!.filter((id) => !movedSet.has(id));
          }
        }
        if (
          this.tryEnqueueLilithRevealCostDeclaration(
            cardNumber,
            sourceCardInstanceId,
            playerId,
            vars[pending.revealVar] ?? [],
            vars,
            remaining
          )
        ) {
          return { success: true };
        }
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
        return { success: true };
      }

      case 'LILITH_REVEAL_DECLARE_COST': {
        const pickedNum = Number(selected[0]);
        if (!Number.isFinite(pickedNum)) {
          return { success: false, error: '无效的费用声明选择' };
        }
        const costMap = new Map<string, number>();
        for (const item of vars.__lilith_cost_map ?? []) {
          const [id, rawCost] = item.split(':');
          const parsed = Number(rawCost);
          if (id && Number.isFinite(parsed)) costMap.set(id, parsed);
        }
        costMap.set(pending.targetCardId, pickedNum);
        vars.__lilith_cost_map = Array.from(costMap.entries()).map(([id, c]) => `${id}:${c}`);
        if (
          this.tryEnqueueLilithRevealCostDeclaration(
            cardNumber,
            sourceCardInstanceId,
            playerId,
            pending.remainingCardIds,
            vars,
            remaining
          )
        ) {
          return { success: true };
        }
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
        return { success: true };
      }

      case 'ASCEND_FROM_VAR_WITH_TAX': {
        if (selected[0] === 'opt_yes') {
          if (this.host.ctx.payCost(playerId, pending.tax)) {
            this.host.ctx.fieldMgr.playAscensionCard(playerId, pending.cardId, pending.targetId, {
              extraStackRoleCardId: pending.extraId,
            });
          }
        }
        if (pending.shuffleDeckAfter) {
          this.host.ctx.zoneMgr.shuffleDeck(playerId);
        }
        this.runSteps(cardNumber, sourceCardInstanceId, playerId, vars, remaining);
        return { success: true };
      }

      case 'CHOOSE_ACTIVATED_ABILITY': {
        const picked = pending.entries.find((e) => e.id === selected[0]);
        if (!picked) {
          return { success: false, error: '未找到所选的起动能力' };
        }
        return this.host.executeWithCost(
          picked.cardNumber,
          sourceCardInstanceId,
          playerId,
          picked.cost,
          picked.steps,
          picked.oncePerTurn,
          vars,
          picked.usageKey,
          pending.costCardInstanceIds
        );
      }

      case 'CUSTOM_CHOICE': {
        return resolveCustomChoice(this.host.makeCustomRuntime(), action, pending.customFrame);
      }
    }
  }

  private tryEnqueueWanshimingRevealToCost(
    cardNumber: string,
    sourceId: string,
    playerId: string,
    targetPlayer: string,
    revealedIds: string[],
    revealVar: string,
    vars: Record<string, string[]>,
    queue: EffectStep[]
  ): boolean {
    // BP01-037 万世铭 / BP01-038 万世铭·重铸：因<曲>角色公开进入处理区时，可选改为横置放置到费用区 (Q&A·5)
    const srcCard = sourceId ? this.host.ctx.state.cards[sourceId] : undefined;
    if (!srcCard) return false;
    const srcDef = this.host.def(srcCard);
    const continuousEffects = this.host.ctx.continuousEffects;
    const isRole = continuousEffects
      ? continuousEffects.getEffectiveCardType(srcCard.instanceId) === 'ROLE'
      : srcDef?.cardType === 'ROLE';
    const isQuRole =
      isRole &&
      (this.host.hasTrait(srcCard, '曲') || Boolean(srcDef?.name.includes('曲')));
    if (!isQuRole) return false;
    const wanshimingCards = revealedIds
      .map((id) => this.host.ctx.state.cards[id])
      .filter(
        (c): c is CardInstance =>
          Boolean(
            c &&
              c.zone === 'PROCESSING' &&
              (c.cardNumber === 'BP01-037' || c.cardNumber === 'BP01-038')
          )
      );
    if (wanshimingCards.length === 0) return false;
    this.host.enqueueDslChoice(
      {
        id: this.host.choiceId('wanshiming-reveal-cost'),
        playerId: targetPlayer,
        choiceType: 'SELECT_CARDS',
        prompt:
          '公开的《万世铭》/《万世铭·重铸》因<曲>角色进入处理区，可选择任意张改为以横置状态放置到费用区（满10张时改放墓地）：',
        options: wanshimingCards.map((c) =>
          this.host.effects.createGeneralCardChoiceOption(c)
        ),
        effectType: 'BP01_WANSHIMING_REVEAL_TO_COST',
        sourceCardInstanceId: sourceId,
        minSelections: 0,
        maxSelections: wanshimingCards.length,
      },
      {
        cardNumber,
        sourceCardInstanceId: sourceId,
        playerId,
        vars,
        remainingSteps: queue,
        pendingAction: { kind: 'WANSHIMING_REVEAL_TO_COST', revealVar },
      }
    );
    return true;
  }

  private tryEnqueueLilithRevealCostDeclaration(
    cardNumber: string,
    sourceId: string,
    playerId: string,
    candidateIds: string[],
    vars: Record<string, string[]>,
    queue: EffectStep[]
  ): boolean {
    const srcCard = sourceId ? this.host.ctx.state.cards[sourceId] : undefined;
    if (!srcCard || !this.host.hasTrait(srcCard, '莉莉丝')) return false;
    const declaredIds = new Set(
      (vars.__lilith_cost_map ?? []).map((item) => item.split(':')[0]).filter(Boolean)
    );
    const eligibleIds = candidateIds.filter((id) => {
      if (declaredIds.has(id)) return false;
      const c = this.host.ctx.state.cards[id];
      return Boolean(
        c &&
          c.controllerPlayerId === playerId &&
          LILITH_REVEAL_COST_CHOICES[c.cardNumber]
      );
    });
    if (eligibleIds.length === 0) return false;
    const targetCardId = eligibleIds[0]!;
    const remainingCardIds = eligibleIds.slice(1);
    const targetCard = this.host.ctx.state.cards[targetCardId]!;
    const def = this.host.def(targetCard);
    const choices = LILITH_REVEAL_COST_CHOICES[targetCard.cardNumber]!;
    this.host.enqueueDslChoice(
      {
        id: this.host.choiceId(`lilith-declare-${targetCard.cardNumber}`),
        playerId,
        choiceType: 'SELECT_OPTION',
        prompt: `【${def?.name ?? targetCard.cardNumber}】被我方<莉莉丝>的效果公开，请选择该次处理中将其费用视为的数字：`,
        options: choices.map((n) => ({ id: String(n), label: `费用视为 ${n}` })),
        effectType: `DSL_LILITH_DECLARE_${targetCard.cardNumber}`,
        sourceCardInstanceId: sourceId,
        minSelections: 1,
        maxSelections: 1,
      },
      {
        cardNumber,
        sourceCardInstanceId: sourceId,
        playerId,
        vars,
        remainingSteps: queue,
        pendingAction: {
          kind: 'LILITH_REVEAL_DECLARE_COST',
          targetCardId,
          remainingCardIds,
        },
      }
    );
    return true;
  }

  private didCreatePendingChoice(prevPendingId: string | undefined, prevQueueLen: number): boolean {
    const state = this.host.ctx.state;
    return (
      (prevPendingId === undefined && Boolean(state.currentPendingChoice)) ||
      (state.pendingChoiceQueue?.length ?? 0) > prevQueueLen
    );
  }

  private pushContinuation(
    cardNumber: string,
    sourceId: string,
    playerId: string,
    vars: Record<string, string[]>,
    queue: EffectStep[]
  ): void {
    this.host.ctx.state.pendingDslContinuations ??= [];
    this.host.ctx.state.pendingDslContinuations.push({
      cardNumber,
      sourceCardInstanceId: sourceId,
      playerId,
      vars: { ...vars },
      remainingSteps: [...queue],
    });
  }

  private executeMoveCardsStep(
    step: Extract<EffectStep, { op: 'MOVE_CARDS' }>,
    targets: string[],
    cardNumber: string,
    playerId: string,
    sourceId: string,
    vars: Record<string, string[]>,
    queue: EffectStep[]
  ): boolean {
    const isResumedRest =
      step.target.kind === 'VAR' && step.target.varName === '__pendingReplaceRest';
    if (isResumedRest) {
      delete vars.__pendingReplaceRest;
    }
    const moved: string[] =
      isResumedRest && vars.__pendingReplaceAccum ? [...vars.__pendingReplaceAccum] : [];
    if (isResumedRest) {
      delete vars.__pendingReplaceAccum;
    }
    const ownersToShuffle = new Set<string>();
    const expectedZone =
      step.toZone === 'DECK_BOTTOM' ||
      step.toZone === 'DECK_TOP' ||
      step.toZone === 'DECK_SHUFFLE'
        ? 'DECK'
        : step.toZone === 'SIGNAL_ORB_BOTTOM'
          ? 'SIGNAL_ORB'
          : step.toZone;

    const wanshimingMovedSet = new Set(vars.__wanshimingMovedToCost ?? []);

    for (let i = 0; i < targets.length; i++) {
      const id = targets[i]!;
      const card = this.host.ctx.state.cards[id];
      if (!card) continue;
      if (wanshimingMovedSet.has(id) && card.zone !== 'PROCESSING') {
        continue;
      }
      const fromZone = card.zone;
      const prevPendingId = this.host.ctx.state.currentPendingChoice?.id;
      const prevQueueLen = this.host.ctx.state.pendingChoiceQueue?.length ?? 0;

      if (step.toZone === 'BATTLEFIELD') {
        if (
          this.host.bringToField(
            playerId,
            id,
            step.triggerEntry !== false,
            Boolean(step.enterTapped),
            Boolean(step.loseAbilities),
            cardNumber
          )
        ) {
          moved.push(id);
        }
      } else if (step.toZone === 'DECK_BOTTOM') {
        if (
          step.target.kind === 'REST_OF_VAR' &&
          card.zone !== 'PROCESSING' &&
          card.zone !== 'DECK'
        ) {
          continue;
        }
        if (this.host.ctx.zoneMgr.moveCardToBottomOfDeck(id)) {
          moved.push(id);
        }
      } else if (step.toZone === 'DECK_TOP') {
        if (
          step.target.kind === 'REST_OF_VAR' &&
          card.zone !== 'PROCESSING' &&
          card.zone !== 'DECK'
        ) {
          continue;
        }
        if (this.host.ctx.zoneMgr.moveCardToTopOfDeck(id)) {
          moved.push(id);
        }
      } else if (step.toZone === 'DECK_SHUFFLE') {
        if (
          step.target.kind === 'REST_OF_VAR' &&
          card.zone !== 'PROCESSING' &&
          card.zone !== 'DECK'
        ) {
          continue;
        }
        if (this.host.ctx.zoneMgr.moveCard(id, 'DECK', { isFaceUp: false })) {
          ownersToShuffle.add(card.ownerPlayerId);
          moved.push(id);
        }
      } else if (step.toZone === 'SIGNAL_ORB_BOTTOM') {
        if (
          step.target.kind === 'REST_OF_VAR' &&
          card.zone !== 'PROCESSING' &&
          card.zone !== 'DECK'
        ) {
          continue;
        }
        if (
          this.host.ctx.zoneMgr.moveCard(id, 'SIGNAL_ORB', {
            isFaceUp: step.isFaceUp ?? true,
            toBottom: true,
          })
        ) {
          moved.push(id);
        }
      } else if (step.toZone === 'COST') {
        if (
          step.target.kind === 'REST_OF_VAR' &&
          card.zone !== 'PROCESSING' &&
          card.zone !== 'GRAVEYARD' &&
          card.zone !== 'DECK'
        ) {
          continue;
        }
        if (
          this.host.ctx.zoneMgr.moveCard(id, 'COST', {
            isFaceUp: step.isFaceUp ?? false,
            isReady: step.isReady ?? true,
          })
        ) {
          this.host.ctx.zoneMgr.syncCostStats(card.controllerPlayerId);
          moved.push(id);
        }
      } else if (step.toZone === 'UNDERNEATH') {
        if (!step.underneathHost) continue;
        const hostId = this.host.evaluator.resolveTargetIds(
          step.underneathHost,
          playerId,
          sourceId,
          vars
        )[0];
        if (!hostId) continue;
        if (
          this.host.ctx.fieldMgr.placeCardUnderneath(id, hostId, {
            includeUnderneath: step.includeUnderneath,
            actorPlayerId: playerId,
          })
        ) {
          moved.push(id);
        }
      } else {
        if (
          step.target.kind === 'REST_OF_VAR' &&
          card.zone !== 'PROCESSING' &&
          card.zone !== 'DECK'
        ) {
          continue;
        }
        const ok =
          step.toZone === 'GRAVEYARD'
            ? this.host.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', {
                isFaceUp: step.isFaceUp ?? true,
                sentByEffectOrCost: step.sentByEffectOrCost ?? card.zone === 'BATTLEFIELD',
                countAsDeckToGy:
                  card.zone === 'DECK' ||
                  (card.zone === 'PROCESSING' && card.enteredFromZone === 'DECK'),
              })
            : this.host.ctx.zoneMgr.moveCard(id, step.toZone, {
                isFaceUp: step.isFaceUp ?? true,
                ...(step.isReady !== undefined ? { isReady: step.isReady } : {}),
              });
        if (ok) {
          moved.push(id);
        }
      }

      if (this.didCreatePendingChoice(prevPendingId, prevQueueLen)) {
        const remainingTargets = targets.slice(i + 1);
        if (remainingTargets.length > 0 || queue.length > 0 || Boolean(step.saveMovedToVar)) {
          const resumeQueue: EffectStep[] = [...queue];
          if (remainingTargets.length > 0) {
            vars.__pendingReplaceRest = remainingTargets;
            resumeQueue.unshift({
              ...step,
              chooseOrder: false,
              target: { kind: 'VAR', varName: '__pendingReplaceRest' },
            });
          }
          vars.__pendingReplaceVerify = [
            'MOVE',
            id,
            step.saveMovedToVar ?? '',
            expectedZone,
            fromZone,
            step.toZone === 'DECK_SHUFFLE' ? 'SHUFFLE' : '',
          ];
          vars.__pendingReplacePartial = [...moved];
          if (step.saveMovedToVar) vars[step.saveMovedToVar] = [...moved];
          for (const ownerId of ownersToShuffle) {
            this.host.ctx.zoneMgr.shuffleDeck(ownerId);
          }
          this.pushContinuation(cardNumber, sourceId, playerId, vars, resumeQueue);
          return true;
        }
      }
    }
    for (const ownerId of ownersToShuffle) {
      this.host.ctx.zoneMgr.shuffleDeck(ownerId);
    }
    if (step.saveMovedToVar) vars[step.saveMovedToVar] = moved;
    return false;
  }
}
