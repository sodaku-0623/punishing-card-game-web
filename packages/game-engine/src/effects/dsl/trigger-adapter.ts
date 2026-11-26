import { CardInstance, ZoneId } from '@zhanshuang/shared';
import type { CardEffectContext } from '../card-effects.js';
import { ContinuousEffectEngine, expandBaseTraits } from '../continuous-effects.js';
import type {
  ReplacementEngine,
  ReplacementEvent,
  ReplacementOutcome,
  ReplacementRuleContext,
} from '../replacement-engine.js';
import type { TriggerManager } from '../../priority/trigger-system.js';
import { getAttachedEquipmentIds } from '../../zone/battlefield-manager.js';
import type { DslEvaluator } from './evaluator.js';
import type { DslInterpreterHost } from './runtime-types.js';
import type { CardEffectSpec, CardFilter, DeclarativeReplacementSpec } from './types.js';

/**
 * 8.5 / 8.7 向 TriggerManager 注册统一【出】登场能力 (`CARD_ENTERED_FIELD`) 与所有声明式【自】自动能力
 */
export function registerDeclarativeTriggers(
  host: DslInterpreterHost,
  triggerMgr: TriggerManager
): void {
  // 8.6.2 / 8.7 / 8.11 统一将声明式卡牌【出】登场能力迁入检查时机处理，彻底消除效果子角色抢跑与双【出】顺序僵化
  triggerMgr.registerTrigger({
    abilityId: 'dsl:CARD_ENTRY',
    eventTypes: ['CARD_ENTERED_FIELD'],
    collect: ({ state, event, continuousEffects }) => {
      if (event.suppressEntryTrigger) return [];
      const enteredId = event.cardInstanceId;
      const playerId = event.playerId;
      if (!enteredId || !playerId) return [];
      const card = state.cards[enteredId];
      if (!card || card.zone !== 'BATTLEFIELD') return [];
      if (continuousEffects.hasLostInherentAbilities(enteredId)) return [];
      const spec = host.registry.get(card.cardNumber);
      if (!spec) return [];
      const cardDef = host.def(card);
      const cardName = cardDef?.name ?? spec.name ?? card.cardNumber;
      if (spec.entries && spec.entries.length > 0) {
        return spec.entries.map((entry, idx) => ({
          sourceCardInstanceId: enteredId,
          sourceCardNumber: card.cardNumber,
          controllerPlayerId: playerId,
          label: entry.label ? `【${cardName}】${entry.label}` : `【${cardName}】【出 ${idx + 1}】`,
          triggerContext: {
            cardNumber: card.cardNumber,
            entryIndex: idx,
            entryId: entry.id ?? String(idx),
          },
        }));
      }
      if (spec.entry) {
        return [
          {
            sourceCardInstanceId: enteredId,
            sourceCardNumber: card.cardNumber,
            controllerPlayerId: playerId,
            label: `【${cardName}】【出】登场能力`,
            triggerContext: {
              cardNumber: card.cardNumber,
              entryIndex: -1,
            },
          },
        ];
      }
      return [];
    },
    execute: (trigger) => {
      const cardNumber =
        (trigger.triggerContext?.cardNumber as string | undefined) ?? trigger.sourceCardNumber;
      if (!cardNumber) return;
      const spec = host.registry.get(cardNumber);
      if (!spec) return;
      const entryIndex = Number(trigger.triggerContext?.entryIndex ?? -1);
      if (entryIndex >= 0 && spec.entries && spec.entries[entryIndex]) {
        const entrySpec = spec.entries[entryIndex]!;
        host.executeWithCost(
          cardNumber,
          trigger.sourceCardInstanceId,
          trigger.controllerPlayerId,
          entrySpec.cost,
          entrySpec.steps,
          false
        );
        return;
      }
      if (spec.entry) {
        host.executeWithCost(
          cardNumber,
          trigger.sourceCardInstanceId,
          trigger.controllerPlayerId,
          spec.entry.cost,
          spec.entry.steps,
          false
        );
      }
    },
  });

  for (const spec of host.registry.values()) {
    for (const trig of spec.triggers ?? []) {
      triggerMgr.registerTrigger({
        abilityId: trig.abilityId,
        eventTypes:
          trig.eventTypes && trig.eventTypes.length > 0 ? trig.eventTypes : [trig.eventType],
        oncePerTurn: trig.oncePerTurn,
        maxPerTurn: trig.maxPerTurn,
        deferOncePerTurnUntilCostPaid: trig.deferOncePerTurnUntilCostPaid,
        oncePerTurnByPlayer: trig.oncePerTurnByPlayer,
        maxPerTurnByPlayer: trig.maxPerTurnByPlayer,
        sharedTurnKey: trig.sharedTurnKey,
        collect: ({ state, event, cardDb, fieldMgr, continuousEffects, zoneMgr }) => {
          const condOk = (
            pid: string,
            srcId: string,
            extraVars: Record<string, string[]> = {}
          ) => !trig.condition || host.evaluator.evalCondition(trig.condition, pid, srcId, extraVars);

          switch (trig.matcher.kind) {
            case 'EQUIPPED_ROLE_ATTACKING': {
              const attackerId = event.cardInstanceId;
              if (!attackerId) return [];
              const attacker = state.cards[attackerId];
              if (!attacker) return [];
              // 宿主被禁止获得新能力 (如 BP02-058 CANNOT_GAIN_ABILITIES) 时，装备赋予的【自】同样不得触发
              if (
                continuousEffects.hasProhibition(attacker.instanceId, 'CANNOT_GAIN_ABILITIES') ||
                host.ctx.continuousEffects?.hasProhibition(
                  attacker.instanceId,
                  'CANNOT_GAIN_ABILITIES'
                )
              ) {
                return [];
              }
              const eqIds = getAttachedEquipmentIds(attacker);
              if (eqIds.length === 0) return [];
              const attackerDef = cardDb.getCard(attacker.cardNumber);
              if (
                trig.matcher.requiredHostName &&
                !continuousEffects.hasCardName(
                  attacker.instanceId,
                  trig.matcher.requiredHostName
                ) &&
                attackerDef?.name !== trig.matcher.requiredHostName
              ) {
                return [];
              }
              if (
                trig.matcher.requiredHostTrait &&
                !host.hasTrait(attacker, trig.matcher.requiredHostTrait)
              ) {
                return [];
              }
              if (!condOk(attacker.controllerPlayerId, attacker.instanceId)) return [];
              const matches = [];
              for (const eqId of eqIds) {
                const equip = state.cards[eqId];
                if (!equip || equip.cardNumber !== spec.cardNumber) continue;
                if (continuousEffects.hasLostInherentAbilities(equip.instanceId)) continue;
                // Q&A·2：不同装备卡给予同一角色的同文本能力各自计次，且升变后宿主实例变化可再次发动
                const onceKey = `${attacker.instanceId}:${trig.abilityId}:${equip.instanceId}`;
                matches.push({
                  sourceCardInstanceId: attacker.instanceId,
                  sourceCardNumber: spec.cardNumber,
                  controllerPlayerId: attacker.controllerPlayerId,
                  label: trig.label,
                  oncePerTurnKey: onceKey,
                  triggerContext: {
                    equipmentCardId: equip.instanceId,
                    attackerCardId: attacker.instanceId,
                    oncePerTurnKey: onceKey,
                  },
                });
              }
              return matches;
            }
            case 'OTHER_FRIENDLY_ROLE_ENTERED': {
              const enteredId = event.cardInstanceId;
              const playerId = event.playerId;
              if (!enteredId || !playerId) return [];
              const enteredCard = state.cards[enteredId];
              if (
                !enteredCard ||
                continuousEffects.getEffectiveCardType(enteredCard.instanceId) !== 'ROLE'
              ) {
                return [];
              }
              const enteredName =
                event.subjectSnapshot?.name ??
                (enteredCard ? cardDb.getCard(enteredCard.cardNumber)?.name : undefined);
              if (trig.matcher.enteredName && enteredName !== trig.matcher.enteredName) return [];
              if (trig.matcher.enteredTrait) {
                const enteredTraits =
                  event.subjectSnapshot?.traits ??
                  (enteredCard
                    ? Array.from(expandBaseTraits(cardDb.getCard(enteredCard.cardNumber)?.traits))
                    : []);
                if (!enteredTraits.includes(trig.matcher.enteredTrait)) return [];
              }
              if (
                trig.matcher.enteredFilter &&
                enteredCard &&
                !host.evaluator.matchesFilter(enteredCard, trig.matcher.enteredFilter)
              ) {
                return [];
              }

              const matches = [];
              for (const slot of fieldMgr.getSlots(playerId)) {
                const slotIds = [slot.roleCardId, slot.assistCardId].filter(
                  (x): x is string => Boolean(x)
                );
                for (const sid of slotIds) {
                  if (!trig.matcher.includeSelf && sid === enteredId) continue;
                  const hostCard = state.cards[sid];
                  if (!hostCard || hostCard.cardNumber !== spec.cardNumber) continue;
                  if (!condOk(playerId, hostCard.instanceId)) continue;
                  matches.push({
                    sourceCardInstanceId: hostCard.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: playerId,
                    label: trig.label.replace('{slot}', String((hostCard.slotIndex ?? 0) + 1)),
                    triggerContext: { enteredCardId: enteredId, targetCardId: enteredId },
                  });
                }
              }
              return matches;
            }
            case 'SELF_IN_SIGNAL_ORB_ON_FRIENDLY_ROLE_ENTERED': {
              const enteredId = event.cardInstanceId;
              const playerId = event.playerId;
              if (!enteredId || !playerId) return [];
              const enteredCard = state.cards[enteredId];
              if (
                !enteredCard ||
                continuousEffects.getEffectiveCardType(enteredCard.instanceId) !== 'ROLE'
              ) {
                return [];
              }
              if (
                trig.matcher.enteredFilter &&
                !host.evaluator.matchesFilter(enteredCard, trig.matcher.enteredFilter)
              ) {
                return [];
              }
              const matches = [];
              for (const c of zoneMgr.getCardsInZone(playerId, 'SIGNAL_ORB')) {
                if (c.cardNumber !== spec.cardNumber || !c.isFaceUp) continue;
                if (!condOk(playerId, c.instanceId)) continue;
                matches.push({
                  sourceCardInstanceId: c.instanceId,
                  sourceCardNumber: spec.cardNumber,
                  controllerPlayerId: playerId,
                  label: trig.label,
                  triggerContext: { enteredCardId: enteredId, targetCardId: enteredId },
                });
              }
              return matches;
            }
            case 'SELF_IN_UNDERNEATH_ON_FRIENDLY_DEPLOY_FROM_UNDERNEATH': {
              const enteredId = event.cardInstanceId;
              const playerId = event.playerId;
              const fromHostId = event.deployedFromHostCardId;
              if (!enteredId || !playerId || !fromHostId) return [];
              const fromHost = state.cards[fromHostId];
              if (!fromHost) return [];
              if (
                trig.matcher.hostName &&
                !continuousEffects.hasCardName(fromHost.instanceId, trig.matcher.hostName) &&
                cardDb.getCard(fromHost.cardNumber)?.name !== trig.matcher.hostName
              ) {
                return [];
              }
              const matches = [];
              for (const slot of fieldMgr.getSlots(playerId)) {
                const hostCard = slot.roleCardId ? state.cards[slot.roleCardId] : undefined;
                if (!hostCard) continue;
                for (const uid of hostCard.underneathCardIds ?? []) {
                  const uc = state.cards[uid];
                  if (!uc || uc.cardNumber !== spec.cardNumber) continue;
                  if (!condOk(playerId, uc.instanceId)) continue;
                  matches.push({
                    sourceCardInstanceId: uc.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: playerId,
                    label: trig.label,
                    triggerContext: { enteredCardId: enteredId, targetCardId: enteredId },
                  });
                }
              }
              return matches;
            }
            case 'ANY_CARD_SENT_FIELD_TO_GY_BY_EFFECT': {
              const sentId = event.cardInstanceId;
              const ownerPid = event.playerId;
              if (!sentId || !ownerPid) return [];
              const sentCard = state.cards[sentId];
              const snap = event.subjectSnapshot;
              const matchSentSnapshot = (filter: CardFilter): boolean => {
                if (sentCard && host.evaluator.matchesFilterWithSnapshot(sentCard, snap, filter)) {
                  return true;
                }
                return false;
              };
              if (trig.matcher.filter && !matchSentSnapshot(trig.matcher.filter)) return [];

              const watchersPid =
                trig.matcher.side === 'SELF'
                  ? ownerPid
                  : host.resolveSide(ownerPid, 'OPPONENT');
              if (ownerPid !== watchersPid && trig.matcher.side === 'SELF') return [];
              const matches: Array<{
                sourceCardInstanceId: string;
                sourceCardNumber: string;
                controllerPlayerId: string;
                label: string;
                triggerContext: Record<string, unknown>;
              }> = [];
              // 场上存活的己方来源卡 (角色 / 辅助机 / 独立装备)
              for (const slot of fieldMgr.getSlots(watchersPid)) {
                const slotIds = [
                  slot.roleCardId,
                  slot.assistCardId,
                  slot.standaloneEquipmentId,
                ].filter((x): x is string => Boolean(x));
                for (const sid of slotIds) {
                  const card = state.cards[sid];
                  if (!card || card.cardNumber !== spec.cardNumber || card.instanceId === sentId) {
                    continue;
                  }
                  if (!condOk(watchersPid, card.instanceId)) continue;
                  matches.push({
                    sourceCardInstanceId: card.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: watchersPid,
                    label: trig.label,
                    triggerContext: { targetCardId: sentId },
                  });
                }
              }
              // Q&A·4/8：「该牌因效果或代价从战场放置到墓地时也会发动」(含离场瞬间是否失能快照)
              if (
                trig.matcher.includeSelf &&
                sentCard &&
                sentCard.cardNumber === spec.cardNumber &&
                watchersPid === ownerPid &&
                !snap?.abilitiesLost
              ) {
                if (condOk(watchersPid, sentCard.instanceId)) {
                  matches.push({
                    sourceCardInstanceId: sentCard.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: watchersPid,
                    label: trig.label,
                    triggerContext: {
                      targetCardId: sentId,
                      sourceAbilitiesLostAtTrigger: Boolean(snap?.abilitiesLost),
                    },
                  });
                }
              }
              return matches;
            }
            case 'SELF_MOVED_DECK_TO_GY': {
              const movedId = event.cardInstanceId;
              const playerId = event.playerId;
              if (!movedId || !playerId) return [];
              const movedCard = state.cards[movedId];
              if (!movedCard || movedCard.cardNumber !== spec.cardNumber) return [];
              if (!condOk(playerId, movedCard.instanceId)) return [];
              return [
                {
                  sourceCardInstanceId: movedCard.instanceId,
                  sourceCardNumber: spec.cardNumber,
                  controllerPlayerId: playerId,
                  label: trig.label,
                  triggerContext: { targetCardId: movedId },
                },
              ];
            }
            case 'FRIENDLY_CARD_MOVED_DECK_TO_GY': {
              const movedId = event.cardInstanceId;
              const playerId = event.playerId;
              if (!movedId || !playerId) return [];
              const movedCard = state.cards[movedId];
              if (!movedCard) return [];
              if (
                trig.matcher.filter &&
                !host.evaluator.matchesFilterWithSnapshot(
                  movedCard,
                  event.subjectSnapshot,
                  trig.matcher.filter
                )
              ) {
                return [];
              }
              const matches = [];
              for (const slot of fieldMgr.getSlots(playerId)) {
                const slotIds = [
                  slot.roleCardId,
                  slot.assistCardId,
                  slot.standaloneEquipmentId,
                ].filter((x): x is string => Boolean(x));
                for (const sid of slotIds) {
                  const card = state.cards[sid];
                  if (!card || card.cardNumber !== spec.cardNumber) continue;
                  if (!condOk(playerId, card.instanceId)) continue;
                  matches.push({
                    sourceCardInstanceId: card.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: playerId,
                    label: trig.label,
                    triggerContext: { targetCardId: movedId },
                  });
                }
              }
              return matches;
            }
            case 'FRIENDLY_CARD_MOVED_GY_TO_DECK_BOTTOM': {
              const movedId = event.cardInstanceId;
              const playerId = event.playerId;
              if (!movedId || !playerId) return [];
              const movedCard = state.cards[movedId];
              if (!movedCard) return [];
              if (
                trig.matcher.filter &&
                !host.evaluator.matchesFilterWithSnapshot(
                  movedCard,
                  event.subjectSnapshot,
                  trig.matcher.filter
                )
              ) {
                return [];
              }
              const matches = [];
              for (const slot of fieldMgr.getSlots(playerId)) {
                const slotIds = [
                  slot.roleCardId,
                  slot.assistCardId,
                  slot.standaloneEquipmentId,
                ].filter((x): x is string => Boolean(x));
                for (const sid of slotIds) {
                  const c = state.cards[sid];
                  if (!c || c.cardNumber !== spec.cardNumber) continue;
                  if (!condOk(playerId, c.instanceId)) continue;
                  matches.push({
                    sourceCardInstanceId: c.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: playerId,
                    label: trig.label,
                    triggerContext: { targetCardId: movedId },
                  });
                }
              }
              return matches;
            }
            case 'SELF_TAPPED': {
              const tappedId = event.cardInstanceId;
              const playerId = event.playerId;
              if (!tappedId || !playerId) return [];
              const card = state.cards[tappedId];
              if (!card || card.cardNumber !== spec.cardNumber) return [];
              if (!condOk(playerId, card.instanceId)) return [];
              return [
                {
                  sourceCardInstanceId: card.instanceId,
                  sourceCardNumber: spec.cardNumber,
                  controllerPlayerId: playerId,
                  label: trig.label,
                  triggerContext: { targetCardId: tappedId },
                },
              ];
            }
            case 'SELF_DESTROYED': {
              const destroyedId = event.cardInstanceId;
              const playerId = event.playerId;
              if (!destroyedId || !playerId) return [];
              if (trig.matcher.destroyReason && trig.matcher.destroyReason !== 'ANY') {
                if (event.destroyReason !== trig.matcher.destroyReason) return [];
              }
              const card = state.cards[destroyedId];
              if (!card || card.cardNumber !== spec.cardNumber) return [];
              if (event.subjectSnapshot?.abilitiesLost) return [];
              if (!condOk(playerId, card.instanceId)) return [];
              return [
                {
                  sourceCardInstanceId: card.instanceId,
                  sourceCardNumber: spec.cardNumber,
                  controllerPlayerId: playerId,
                  label: trig.label,
                  triggerContext: {
                    targetCardId: destroyedId,
                    sourceAbilitiesLostAtTrigger: Boolean(event.subjectSnapshot?.abilitiesLost),
                  },
                },
              ];
            }
            case 'SELF_ATTACKING': {
              const attackerId = event.cardInstanceId;
              if (!attackerId) return [];
              const attacker = state.cards[attackerId];
              if (!attacker || attacker.cardNumber !== spec.cardNumber) return [];
              if (!condOk(attacker.controllerPlayerId, attacker.instanceId)) return [];
              return [
                {
                  sourceCardInstanceId: attacker.instanceId,
                  sourceCardNumber: spec.cardNumber,
                  controllerPlayerId: attacker.controllerPlayerId,
                  label: trig.label,
                  triggerContext: {
                    attackerCardId: attacker.instanceId,
                  },
                },
              ];
            }
            case 'SELF_ATTACKING_OR_BLOCKING': {
              const targetId =
                event.type === 'BLOCK_DECLARED' ? event.cardInstanceId : event.cardInstanceId;
              if (!targetId) return [];
              const role = state.cards[targetId];
              if (!role || role.cardNumber !== spec.cardNumber) return [];
              if (!fieldMgr.isSlotRole(role.controllerPlayerId, role.instanceId)) return [];
              if (!condOk(role.controllerPlayerId, role.instanceId)) return [];
              return [
                {
                  sourceCardInstanceId: role.instanceId,
                  sourceCardNumber: spec.cardNumber,
                  controllerPlayerId: role.controllerPlayerId,
                  label: trig.label,
                  triggerContext:
                    event.type === 'BLOCK_DECLARED'
                      ? { blockerCardId: role.instanceId, attackerCardId: event.targetCardId }
                      : { attackerCardId: role.instanceId },
                },
              ];
            }
            case 'SELF_ATTACK_END': {
              const attackerId = event.cardInstanceId;
              if (!attackerId) return [];
              const attacker = state.cards[attackerId];
              if (!attacker || attacker.cardNumber !== spec.cardNumber) return [];
              if (!fieldMgr.isSlotRole(attacker.controllerPlayerId, attackerId)) return [];
              if (
                !condOk(
                  attacker.controllerPlayerId,
                  attackerId,
                  event.attackChargedHasChargeAuto ? { __combatChargedAuto: ['1'] } : {}
                )
              ) {
                return [];
              }
              return [
                {
                  sourceCardInstanceId: attacker.instanceId,
                  sourceCardNumber: spec.cardNumber,
                  controllerPlayerId: attacker.controllerPlayerId,
                  label: trig.label,
                  triggerContext: {
                    attackerCardId: attacker.instanceId,
                    combatChargedAuto: Boolean(event.attackChargedHasChargeAuto),
                  },
                },
              ];
            }
            case 'GRANTED_ATTACK_CHARGE_CARD': {
              if (event.chargeKind !== 'ATTACK') return [];
              const attackerId = event.targetCardId;
              const chargedId = event.cardInstanceId;
              if (!attackerId || !chargedId) return [];
              const attacker = state.cards[attackerId];
              const charged = state.cards[chargedId];
              if (
                !attacker ||
                !charged ||
                !fieldMgr.isSlotRole(attacker.controllerPlayerId, attackerId)
              ) {
                return [];
              }
              if (!continuousEffects.hasGrantedTrigger(attackerId, trig.abilityId)) return [];
              if (
                trig.matcher.chargedCardFilter &&
                !host.evaluator.matchesFilter(charged, trig.matcher.chargedCardFilter, attackerId)
              ) {
                return [];
              }
              if (!condOk(attacker.controllerPlayerId, attackerId)) return [];
              return [
                {
                  sourceCardInstanceId: attacker.instanceId,
                  sourceCardNumber: attacker.cardNumber,
                  controllerPlayerId: attacker.controllerPlayerId,
                  label: trig.label,
                  triggerContext: {
                    attackerCardId: attacker.instanceId,
                    chargedCardId: charged.instanceId,
                  },
                },
              ];
            }
            case 'SELF_IN_GRAVEYARD_ON_SELF_ORBS_ELIMINATED': {
              const playerId = event.playerId;
              if (!playerId) return [];
              const gyCards = zoneMgr.getCardsInZone(playerId, 'GRAVEYARD');
              const matches = [];
              for (const c of gyCards) {
                if (c.cardNumber !== spec.cardNumber) continue;
                if (!condOk(playerId, c.instanceId)) continue;
                matches.push({
                  sourceCardInstanceId: c.instanceId,
                  sourceCardNumber: spec.cardNumber,
                  controllerPlayerId: playerId,
                  label: trig.label,
                  triggerContext: {},
                });
              }
              return matches;
            }
            case 'SELF_DEALT_PLAYER_DAMAGE': {
              const attackerId = event.cardInstanceId;
              const playerId = event.playerId;
              if (!attackerId || !playerId) return [];
              const attacker = state.cards[attackerId];
              if (!attacker || attacker.cardNumber !== spec.cardNumber) return [];
              if (!condOk(playerId, attacker.instanceId)) return [];
              return [
                {
                  sourceCardInstanceId: attacker.instanceId,
                  sourceCardNumber: spec.cardNumber,
                  controllerPlayerId: playerId,
                  label: trig.label,
                  triggerContext: { attackerCardId: attacker.instanceId },
                },
              ];
            }
            case 'SELF_EQUIPPED': {
              const eqId = event.cardInstanceId;
              const roleId = event.targetCardId;
              const playerId = event.playerId;
              if (!eqId || !playerId) return [];
              const eq = state.cards[eqId];
              if (!eq || eq.cardNumber !== spec.cardNumber) return [];
              if (!condOk(playerId, eq.instanceId)) return [];
              return [
                {
                  sourceCardInstanceId: eq.instanceId,
                  sourceCardNumber: spec.cardNumber,
                  controllerPlayerId: playerId,
                  label: trig.label,
                  triggerContext: { hostCardId: roleId, targetCardId: roleId },
                },
              ];
            }
            case 'PARTNER_HOST_ATTACKING': {
              const attackerId = event.cardInstanceId;
              if (!attackerId) return [];
              const attacker = state.cards[attackerId];
              const partnerId = attacker?.partnerCardId;
              const partner = partnerId ? state.cards[partnerId] : undefined;
              if (!attacker || !partner || partner.cardNumber !== spec.cardNumber) return [];
              if (
                trig.matcher.requiredHostName &&
                !continuousEffects.hasCardName(attacker.instanceId, trig.matcher.requiredHostName)
              ) {
                return [];
              }
              if (
                trig.matcher.requiredHostTrait &&
                !host.hasTrait(attacker, trig.matcher.requiredHostTrait)
              ) {
                return [];
              }
              if (!condOk(partner.controllerPlayerId, partner.instanceId)) return [];
              return [
                {
                  sourceCardInstanceId: partner.instanceId,
                  sourceCardNumber: spec.cardNumber,
                  controllerPlayerId: partner.controllerPlayerId,
                  label: trig.label,
                  triggerContext: {
                    hostCardId: attacker.instanceId,
                    attackerCardId: attacker.instanceId,
                  },
                },
              ];
            }
            case 'SELF_ORBS_ELIMINATED': {
              const playerId = event.playerId;
              if (!playerId) return [];
              const matches = [];
              for (const slot of fieldMgr.getSlots(playerId)) {
                const slotIds = [slot.roleCardId, slot.assistCardId].filter(
                  (x): x is string => Boolean(x)
                );
                for (const sid of slotIds) {
                  const card = state.cards[sid];
                  if (!card || card.cardNumber !== spec.cardNumber) continue;
                  if (!condOk(playerId, card.instanceId)) continue;
                  matches.push({
                    sourceCardInstanceId: card.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: playerId,
                    label: trig.label,
                    triggerContext: {},
                  });
                }
              }
              return matches;
            }
            case 'SELF_BLOCKED_ATTACK_END': {
              const blockerId = event.blockerCardId;
              if (!blockerId) return [];
              const blocker = state.cards[blockerId];
              if (!blocker || blocker.cardNumber !== spec.cardNumber) return [];
              if (!fieldMgr.isSlotRole(blocker.controllerPlayerId, blockerId)) return [];
              if (!condOk(blocker.controllerPlayerId, blockerId)) return [];
              return [
                {
                  sourceCardInstanceId: blocker.instanceId,
                  sourceCardNumber: spec.cardNumber,
                  controllerPlayerId: blocker.controllerPlayerId,
                  label: trig.label,
                  triggerContext: {
                    blockerCardId: blocker.instanceId,
                    attackerCardId: event.cardInstanceId,
                  },
                },
              ];
            }
            case 'GRANTED_BLOCKED_ATTACK_END': {
              const blockerId = event.blockerCardId;
              if (!blockerId) return [];
              const blocker = state.cards[blockerId];
              if (!blocker || !fieldMgr.isSlotRole(blocker.controllerPlayerId, blockerId)) {
                return [];
              }
              const grantKeys = continuousEffects.getGrantedTriggerKeys(blockerId, trig.abilityId);
              if (grantKeys.length === 0) return [];
              if (!condOk(blocker.controllerPlayerId, blockerId)) return [];
              // Q&A·7 (ST04-001 荣光护盾)：多张《荣光护盾》对同一角色赋予的能力各自独立，分别拥有独立的【回合1】计次
              return grantKeys.map((grantKey, idx) => {
                const onceKey = `${blocker.instanceId}:${trig.abilityId}:${grantKey}`;
                return {
                  sourceCardInstanceId: blocker.instanceId,
                  sourceCardNumber: blocker.cardNumber,
                  controllerPlayerId: blocker.controllerPlayerId,
                  label: grantKeys.length > 1 ? `${trig.label} (#${idx + 1})` : trig.label,
                  oncePerTurnKey: onceKey,
                  triggerContext: {
                    blockerCardId: blocker.instanceId,
                    attackerCardId: event.cardInstanceId,
                    oncePerTurnKey: onceKey,
                    // 仅当赋予位于 loseAbilities 之后才会保留于 grantKeys 中 (Q&A·3)
                    sourceAbilitiesLostAtTrigger: false,
                  },
                };
              });
            }
            case 'FRIENDLY_ROLE_BLOCKING': {
              const blockerId = event.cardInstanceId;
              const playerId = event.playerId;
              if (!blockerId || !playerId) return [];
              const blocker = state.cards[blockerId];
              if (!blocker) return [];
              if (
                trig.matcher.blockerTrait &&
                !host.hasTrait(blocker, trig.matcher.blockerTrait)
              ) {
                return [];
              }
              const matches = [];
              for (const slot of fieldMgr.getSlots(playerId)) {
                if (trig.matcher.sourceKind === 'EQUIPMENT') {
                  const role = slot.roleCardId ? state.cards[slot.roleCardId] : undefined;
                  const equipIds = [
                    ...getAttachedEquipmentIds(role),
                    slot.standaloneEquipmentId,
                  ].filter((id): id is string => Boolean(id));
                  for (const eid of equipIds) {
                    const eq = state.cards[eid];
                    if (!eq || eq.cardNumber !== spec.cardNumber) continue;
                    if (!condOk(playerId, eq.instanceId)) continue;
                    matches.push({
                      sourceCardInstanceId: eq.instanceId,
                      sourceCardNumber: spec.cardNumber,
                      controllerPlayerId: playerId,
                      label: trig.label,
                      triggerContext: { blockerCardId: blockerId, attackerCardId: event.targetCardId },
                    });
                  }
                } else {
                  const role = slot.roleCardId ? state.cards[slot.roleCardId] : undefined;
                  if (!role || role.cardNumber !== spec.cardNumber) continue;
                  if (!condOk(playerId, role.instanceId)) continue;
                  matches.push({
                    sourceCardInstanceId: role.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: playerId,
                    label: trig.label,
                    triggerContext: { blockerCardId: blockerId, attackerCardId: event.targetCardId },
                  });
                }
              }
              return matches;
            }
            case 'SELF_TURN_END': {
              const activePid = event.playerId ?? state.activePlayerId;
              const targetPid = trig.matcher.isSelfTurn
                ? activePid
                : activePid === state.activePlayerId
                  ? state.nonActivePlayerId
                  : state.activePlayerId;
              const matches = [];
              for (const slot of fieldMgr.getSlots(targetPid)) {
                const slotIds = [slot.roleCardId, slot.assistCardId].filter(
                  (x): x is string => Boolean(x)
                );
                for (const sid of slotIds) {
                  const role = state.cards[sid];
                  if (!role || role.cardNumber !== spec.cardNumber) continue;
                  if (!condOk(targetPid, role.instanceId)) continue;
                  matches.push({
                    sourceCardInstanceId: role.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: targetPid,
                    label: trig.label.replace('{slot}', String((role.slotIndex ?? 0) + 1)),
                    triggerContext: {},
                  });
                }
              }
              return matches;
            }
            case 'SELF_BECAME_PARTNER': {
              const hostId = event.cardInstanceId;
              const partnerId = event.targetCardId;
              if (!hostId || !partnerId) return [];
              const hostCard = state.cards[hostId];
              const partner = state.cards[partnerId];
              if (!hostCard || !partner || partner.cardNumber !== spec.cardNumber) return [];
              if (
                trig.matcher.fromZones &&
                (!event.fromZone || !trig.matcher.fromZones.includes(event.fromZone))
              ) {
                return [];
              }
              if (
                trig.matcher.onlyOpponentTurn &&
                state.activePlayerId === partner.controllerPlayerId
              ) {
                return [];
              }
              if (
                trig.matcher.requiredHostTrait &&
                !host.hasTrait(hostCard, trig.matcher.requiredHostTrait)
              ) {
                return [];
              }
              if (
                trig.matcher.requiredHostName &&
                !continuousEffects.hasCardName(hostCard.instanceId, trig.matcher.requiredHostName)
              ) {
                return [];
              }
              if (
                !condOk(
                  partner.controllerPlayerId,
                  partner.instanceId,
                  event.fromZone ? { __partnerFromZone: [event.fromZone] } : {}
                )
              ) {
                return [];
              }
              return [
                {
                  sourceCardInstanceId: partner.instanceId,
                  sourceCardNumber: spec.cardNumber,
                  controllerPlayerId: partner.controllerPlayerId,
                  label: trig.label,
                  triggerContext: {
                    hostCardId: hostCard.instanceId,
                    partnerCardId: partner.instanceId,
                    ...(event.fromZone ? { partnerFromZone: event.fromZone } : {}),
                  },
                },
              ];
            }
            case 'SELF_GAINED_PARTNER': {
              const hostId = event.cardInstanceId;
              const partnerId = event.targetCardId;
              if (!hostId || !partnerId) return [];
              const hostCard = state.cards[hostId];
              const partner = state.cards[partnerId];
              if (!hostCard || !partner || hostCard.cardNumber !== spec.cardNumber) return [];
              if (
                trig.matcher.fromZones &&
                (!event.fromZone || !trig.matcher.fromZones.includes(event.fromZone))
              ) {
                return [];
              }
              if (
                trig.matcher.requiredPartnerTrait &&
                !host.hasTrait(partner, trig.matcher.requiredPartnerTrait)
              ) {
                return [];
              }
              if (
                trig.matcher.requiredPartnerName &&
                !continuousEffects.hasCardName(
                  partner.instanceId,
                  trig.matcher.requiredPartnerName
                )
              ) {
                return [];
              }
              if (
                !condOk(
                  hostCard.controllerPlayerId,
                  hostCard.instanceId,
                  event.fromZone ? { __partnerFromZone: [event.fromZone] } : {}
                )
              ) {
                return [];
              }
              return [
                {
                  sourceCardInstanceId: hostCard.instanceId,
                  sourceCardNumber: spec.cardNumber,
                  controllerPlayerId: hostCard.controllerPlayerId,
                  label: trig.label,
                  triggerContext: {
                    hostCardId: hostCard.instanceId,
                    partnerCardId: partner.instanceId,
                    targetCardId: partner.instanceId,
                    ...(event.fromZone ? { partnerFromZone: event.fromZone } : {}),
                  },
                },
              ];
            }
            case 'SELF_LEFT_FIELD': {
              const leftId = event.cardInstanceId;
              const playerId = event.playerId;
              if (!leftId || !playerId) return [];
              const card = state.cards[leftId];
              if (!card || card.cardNumber !== spec.cardNumber) return [];
              if (event.subjectSnapshot?.abilitiesLost) return [];
              if (trig.matcher.requiredEquipTrait) {
                const eqTraits = event.subjectSnapshot?.attachedEquipmentTraits ?? [];
                if (!eqTraits.includes(trig.matcher.requiredEquipTrait)) return [];
              }
              if (!condOk(playerId, card.instanceId)) return [];
              return [
                {
                  sourceCardInstanceId: card.instanceId,
                  sourceCardNumber: spec.cardNumber,
                  controllerPlayerId: playerId,
                  label: trig.label,
                  triggerContext: {
                    targetCardId: leftId,
                    sourceAbilitiesLostAtTrigger: Boolean(event.subjectSnapshot?.abilitiesLost),
                  },
                },
              ];
            }
            case 'GRANTED_SELF_LEFT_FIELD': {
              const leftId = event.cardInstanceId;
              const playerId = event.playerId;
              if (!leftId || !playerId) return [];
              if (event.subjectSnapshot?.abilitiesLost) return [];
              const card = state.cards[leftId];
              if (!card) return [];
              const grantKeys = (event.subjectSnapshot?.grantedTriggerEntries ?? [])
                .filter((e) => e.triggerId === trig.abilityId)
                .map((e) => e.grantKey);
              if (grantKeys.length === 0) return [];
              if (!condOk(playerId, card.instanceId)) return [];
              return grantKeys.map((grantKey, idx) => {
                const onceKey = `${card.instanceId}:${trig.abilityId}:${grantKey}`;
                return {
                  sourceCardInstanceId: card.instanceId,
                  sourceCardNumber: card.cardNumber,
                  controllerPlayerId: playerId,
                  label: grantKeys.length > 1 ? `${trig.label} (#${idx + 1})` : trig.label,
                  oncePerTurnKey: onceKey,
                  triggerContext: {
                    targetCardId: leftId,
                    grantKey,
                    oncePerTurnKey: onceKey,
                    sourceAbilitiesLostAtTrigger: false,
                  },
                };
              });
            }
            case 'SELF_PLAYER_DAMAGED': {
              const damagedPlayerId = event.playerId;
              if (!damagedPlayerId) return [];
              if (trig.matcher.onlySelfTurn && state.activePlayerId !== damagedPlayerId) return [];
              const matches = [];
              for (const slot of fieldMgr.getSlots(damagedPlayerId)) {
                const slotIds = [slot.roleCardId, slot.assistCardId].filter(
                  (x): x is string => Boolean(x)
                );
                for (const sid of slotIds) {
                  const card = state.cards[sid];
                  if (!card || card.cardNumber !== spec.cardNumber) continue;
                  if (!condOk(damagedPlayerId, card.instanceId)) continue;
                  matches.push({
                    sourceCardInstanceId: card.instanceId,
                    sourceCardNumber: spec.cardNumber,
                    controllerPlayerId: damagedPlayerId,
                    label: trig.label,
                    triggerContext: {},
                  });
                }
              }
              return matches;
            }
            case 'SELF_IN_GRAVEYARD_ON_FRIENDLY_ROLE_ATTACKED': {
              if (event.targetType !== 'CHARACTER' || !event.targetCardId) return [];
              const defenderRole = state.cards[event.targetCardId];
              if (
                !defenderRole ||
                !fieldMgr.isSlotRole(defenderRole.controllerPlayerId, defenderRole.instanceId)
              ) {
                return [];
              }
              const defenderPlayerId = defenderRole.controllerPlayerId;
              if (
                trig.matcher.targetFilter &&
                !host.evaluator.matchesFilter(
                  defenderRole,
                  trig.matcher.targetFilter,
                  defenderRole.instanceId
                )
              ) {
                return [];
              }
              const matches = [];
              for (const gyCard of zoneMgr.getCardsInZone(defenderPlayerId, 'GRAVEYARD')) {
                if (gyCard.cardNumber !== spec.cardNumber) continue;
                if (!condOk(defenderPlayerId, gyCard.instanceId)) continue;
                matches.push({
                  sourceCardInstanceId: gyCard.instanceId,
                  sourceCardNumber: spec.cardNumber,
                  controllerPlayerId: defenderPlayerId,
                  label: trig.label,
                  triggerContext: {
                    attackerCardId: event.cardInstanceId,
                    targetCardId: defenderRole.instanceId,
                  },
                });
              }
              return matches;
            }
          }
        },
        execute: (pending) => {
          const initialVars: Record<string, string[]> = {};
          const attackerId = pending.triggerContext.attackerCardId as string | undefined;
          const blockerId = pending.triggerContext.blockerCardId as string | undefined;
          const hostId = pending.triggerContext.hostCardId as string | undefined;
          const targetId = pending.triggerContext.targetCardId as string | undefined;
          const partnerFromZone = pending.triggerContext.partnerFromZone as string | undefined;
          const onceKey =
            (pending.triggerContext.oncePerTurnKey as string | undefined) ??
            pending.oncePerTurnKey ??
            `${pending.sourceCardInstanceId}:${pending.abilityId}`;
          if (attackerId) initialVars.__triggerAttacker = [attackerId];
          if (blockerId) initialVars.__triggerBlocker = [blockerId];
          if (hostId) initialVars.__triggerHost = [hostId];
          if (targetId) initialVars.__triggerTarget = [targetId];
          if (partnerFromZone) initialVars.__partnerFromZone = [partnerFromZone];
          if (pending.triggerContext.combatChargedAuto) initialVars.__combatChargedAuto = ['1'];
          initialVars.__oncePerTurnKey = [onceKey];
          if (
            trig.condition &&
            !host.evaluator.evalCondition(
              trig.condition,
              pending.controllerPlayerId,
              pending.sourceCardInstanceId,
              initialVars
            )
          ) {
            return;
          }
          host.executeWithCost(
            spec.cardNumber,
            pending.sourceCardInstanceId,
            pending.controllerPlayerId,
            trig.cost,
            trig.steps,
            false,
            initialVars
          );
        },
      });
    }
  }
}

/**
 * 8.9 向 ContinuousEffectEngine 注册所有声明式【永】持续效果 (自动分派至 Layer 1 NON_STAT / Layer 2 STAT)
 */
export function registerDeclarativeStaticEffects(
  host: DslInterpreterHost,
  continuousEffects: ContinuousEffectEngine
): void {
  for (const spec of host.registry.values()) {
    for (const eff of spec.staticEffects ?? []) {
      const hasNonStat = Boolean(
        eff.keywords?.length ||
          eff.addTraits?.length ||
          eff.clearBaseTraits ||
          eff.setCardType !== undefined ||
          eff.costDelta !== undefined ||
          eff.setCost !== undefined ||
          eff.canAttackReadyRolesMaxCost !== undefined ||
          eff.mustBeAttackTarget ||
          eff.prohibitions?.length ||
          eff.treatedAsOrbColors?.length ||
          eff.orbValue !== undefined ||
          eff.treatedAsNames?.length ||
          eff.unblockableMaxPP !== undefined ||
          eff.grantedTriggerIds?.length ||
          eff.canDualEquipFengren === true
      );
      const hasStat =
        eff.pp !== undefined ||
        eff.setPP !== undefined ||
        eff.dp !== undefined ||
        eff.setDP !== undefined ||
        eff.setBaseDP !== undefined ||
        eff.charge !== undefined ||
        eff.setCharge !== undefined;

      const matchesTargetAndCond = (
        source: CardInstance,
        target: CardInstance,
        ctx: Parameters<Parameters<ContinuousEffectEngine['registerStaticRule']>[0]['evaluate']>[2]
      ): boolean => {
        if (eff.scope === 'SELF') {
          if (source.instanceId !== target.instanceId) return false;
          if (
            eff.selfFilter &&
            !host.evaluator.matchesFilterSafe(
              target,
              eff.selfFilter,
              ctx.hasCardTrait,
              source.instanceId,
              undefined,
              true
            )
          ) {
            return false;
          }
        } else if (eff.scope === 'PARTNER_HOST') {
          if (source.partnerOfCardId !== target.instanceId) return false;
          if (
            eff.targetFilter &&
            !host.evaluator.matchesFilterSafe(
              target,
              eff.targetFilter,
              ctx.hasCardTrait,
              source.instanceId,
              undefined,
              true
            )
          ) {
            return false;
          }
        } else if (eff.scope === 'UNDERNEATH_HOST') {
          if (!(target.underneathCardIds ?? []).includes(source.instanceId)) return false;
          if (
            eff.targetFilter &&
            !host.evaluator.matchesFilterSafe(
              target,
              eff.targetFilter,
              ctx.hasCardTrait,
              source.instanceId,
              undefined,
              true
            )
          ) {
            return false;
          }
        } else if (eff.scope === 'EQUIPPED_HOST') {
          if (!getAttachedEquipmentIds(target).includes(source.instanceId)) return false;
          if (
            eff.targetFilter &&
            !host.evaluator.matchesFilterSafe(
              target,
              eff.targetFilter,
              ctx.hasCardTrait,
              source.instanceId,
              undefined,
              true
            )
          ) {
            return false;
          }
        } else {
          if (source.controllerPlayerId !== target.controllerPlayerId) return false;
          if (
            eff.targetFilter &&
            !host.evaluator.matchesFilterSafe(
              target,
              eff.targetFilter,
              ctx.hasCardTrait,
              source.instanceId,
              undefined,
              true
            )
          ) {
            return false;
          }
        }
        if (
          eff.condition &&
          !host.evaluator.evalStaticCondition(
            eff.condition,
            source.controllerPlayerId,
            source.instanceId,
            ctx.state,
            ctx.getCardsInZone,
            ctx.getFieldRoles,
            ctx.hasCardTrait
          )
        ) {
          return false;
        }
        return true;
      };

      const sourceKind =
        eff.scope === 'PARTNER_HOST'
          ? ('PARTNER' as const)
          : eff.scope === 'UNDERNEATH_HOST'
            ? ('UNDERNEATH' as const)
            : eff.scope === 'EQUIPPED_HOST'
              ? ('EQUIPPED' as const)
              : ('FIELD_ROLE' as const);

      if (hasNonStat) {
        continuousEffects.registerStaticRule({
          id: `dsl:${eff.id}:nonstat`,
          sourceCardNumber: spec.cardNumber,
          layer: 'NON_STAT',
          sourceKind,
          ...(eff.sourceZones ? { sourceZones: eff.sourceZones } : {}),
          providesTraits: Boolean(eff.addTraits?.length || eff.clearBaseTraits),
          providesProhibitions: eff.prohibitions ?? [],
          dependsOnTraits: eff.dependsOnTraits,
          matchSource: (src) => src.cardNumber === spec.cardNumber,
          evaluate: (source, target, ctx) => {
            if (!matchesTargetAndCond(source, target, ctx)) return undefined;
            const staticEval = {
              getCardsInZone: ctx.getCardsInZone,
              getFieldRoles: ctx.getFieldRoles,
              hasTraitFn: ctx.hasCardTrait,
            };
            const costDelta =
              eff.costDelta !== undefined
                ? host.evaluator.evalNumberExpr(
                    eff.costDelta,
                    source.controllerPlayerId,
                    source.instanceId,
                    {},
                    staticEval
                  )
                : undefined;
            const setCost =
              eff.setCost !== undefined
                ? host.evaluator.evalNumberExpr(
                    eff.setCost,
                    source.controllerPlayerId,
                    source.instanceId,
                    {},
                    staticEval
                  )
                : undefined;
            return {
              ...(eff.keywords ? { keywords: eff.keywords } : {}),
              ...(eff.addTraits ? { addTraits: eff.addTraits } : {}),
              ...(eff.clearBaseTraits ? { clearBaseTraits: true } : {}),
              ...(eff.setCardType !== undefined ? { setCardType: eff.setCardType } : {}),
              ...(costDelta !== undefined ? { costDelta } : {}),
              ...(setCost !== undefined ? { setCost } : {}),
              ...(eff.canAttackReadyRolesMaxCost !== undefined
                ? { canAttackReadyRolesMaxCost: eff.canAttackReadyRolesMaxCost }
                : {}),
              ...(eff.mustBeAttackTarget ? { mustBeAttackTarget: true } : {}),
              ...(eff.prohibitions ? { prohibitions: eff.prohibitions } : {}),
              ...(eff.treatedAsOrbColors ? { treatedAsOrbColors: eff.treatedAsOrbColors } : {}),
              ...(eff.orbValue !== undefined ? { orbValue: eff.orbValue } : {}),
              ...(eff.treatedAsNames ? { treatedAsNames: eff.treatedAsNames } : {}),
              ...(eff.unblockableMaxPP !== undefined
                ? { unblockableMaxPP: eff.unblockableMaxPP }
                : {}),
              ...(eff.grantedTriggerIds?.length
                ? { grantedTriggerIds: eff.grantedTriggerIds }
                : {}),
              ...(eff.canDualEquipFengren ? { canDualEquipFengren: true } : {}),
            };
          },
        });
      }

      if (hasStat) {
        continuousEffects.registerStaticRule({
          id: `dsl:${eff.id}:stat`,
          sourceCardNumber: spec.cardNumber,
          layer: 'STAT',
          sourceKind,
          ...(eff.sourceZones ? { sourceZones: eff.sourceZones } : {}),
          dependsOnTraits: eff.dependsOnTraits,
          matchSource: (src) => src.cardNumber === spec.cardNumber,
          evaluate: (source, target, ctx) => {
            if (!matchesTargetAndCond(source, target, ctx)) return undefined;
            const staticEval = {
              getCardsInZone: ctx.getCardsInZone,
              getFieldRoles: ctx.getFieldRoles,
              hasTraitFn: ctx.hasCardTrait,
            };
            const evalStaticNum = (expr: Parameters<typeof host.evaluator.evalNumberExpr>[0]) =>
              host.evaluator.evalNumberExpr(
                expr,
                source.controllerPlayerId,
                source.instanceId,
                {},
                staticEval
              );
            const pp = eff.pp !== undefined ? evalStaticNum(eff.pp) : undefined;
            const setPP = eff.setPP !== undefined ? evalStaticNum(eff.setPP) : undefined;
            const dp = eff.dp !== undefined ? evalStaticNum(eff.dp) : undefined;
            const setDP = eff.setDP !== undefined ? evalStaticNum(eff.setDP) : undefined;
            const setBaseDP =
              eff.setBaseDP !== undefined ? evalStaticNum(eff.setBaseDP) : undefined;
            const charge = eff.charge !== undefined ? evalStaticNum(eff.charge) : undefined;
            const setCharge =
              eff.setCharge !== undefined ? evalStaticNum(eff.setCharge) : undefined;
            return {
              ...(pp !== undefined ? { pp } : {}),
              ...(setPP !== undefined ? { setPP } : {}),
              ...(dp !== undefined ? { dp } : {}),
              ...(setDP !== undefined ? { setDP } : {}),
              ...(setBaseDP !== undefined ? { setBaseDP } : {}),
              ...(charge !== undefined ? { charge } : {}),
              ...(eff.chargeIsAbility ? { chargeIsAbility: true } : {}),
              ...(setCharge !== undefined ? { setCharge } : {}),
              appliedByPlayerId: source.controllerPlayerId,
            };
          },
        });
      }
    }
  }
}

interface ResolvedReplacementMatch {
  src: CardInstance;
  subjectCardId: string;
  oncePerTurnUsageKey?: string;
  sacrificeCandidates?: string[];
  sacrificeCount?: number;
  fixedSacrificeIds?: string[];
  detachFromSubject: boolean;
}

function collectUnderneathIdSet(
  state: CardEffectContext['state'],
  playerId: string
): Set<string> {
  const hidden = new Set<string>();
  for (const slot of state.battlefields[playerId] ?? []) {
    for (const hid of [slot.roleCardId, slot.assistCardId, slot.standaloneEquipmentId]) {
      if (!hid) continue;
      const hostCard = state.cards[hid];
      for (const uid of hostCard?.underneathCardIds ?? []) {
        hidden.add(uid);
      }
    }
  }
  return hidden;
}

function collectActiveBattlefieldCards(
  state: CardEffectContext['state'],
  playerId: string
): CardInstance[] {
  const result: CardInstance[] = [];
  const seen = new Set<string>();
  const pushCard = (id: string | undefined) => {
    if (!id || seen.has(id)) return;
    const c = state.cards[id];
    if (c && c.zone === 'BATTLEFIELD') {
      seen.add(id);
      result.push(c);
    }
  };
  for (const slot of state.battlefields[playerId] ?? []) {
    pushCard(slot.roleCardId);
    pushCard(slot.assistCardId);
    pushCard(slot.standaloneEquipmentId);
    if (slot.roleCardId) {
      const role = state.cards[slot.roleCardId];
      for (const eqId of getAttachedEquipmentIds(role)) {
        pushCard(eqId);
      }
    }
  }
  return result;
}

function resolveDeclarativeReplacementMatch(
  spec: CardEffectSpec,
  repl: DeclarativeReplacementSpec,
  event: ReplacementEvent,
  rCtx: ReplacementRuleContext,
  evaluator: DslEvaluator
): ResolvedReplacementMatch | undefined {
  const hasTraitSafe = (id: string, trait: string): boolean => {
    if (rCtx.hasTrait) return rCtx.hasTrait(id, trait);
    const c = rCtx.state.cards[id];
    const d = c
      ? rCtx.cardDb.getCard(c.cardNumber) ||
        (c.cardId ? rCtx.cardDb.getCard(c.cardId) : undefined)
      : undefined;
    return expandBaseTraits(d?.traits).has(trait);
  };
  const matchFilter = (card: CardInstance, filter: CardFilter, srcId?: string): boolean =>
    evaluator.matchesFilterSafe(
      card,
      filter,
      hasTraitSafe,
      srcId,
      (id, name) => rCtx.hasCardName(id, name),
      false
    );

  let eventCardId: string | undefined;
  let eventControllerId: string;

  if (event.type === 'DESTROY_ROLE') {
    if (repl.destroyReason && event.reason !== repl.destroyReason) return undefined;
    const eventCard = rCtx.state.cards[event.cardInstanceId];
    if (!eventCard) return undefined;
    if (repl.eventCardFilter && !matchFilter(eventCard, repl.eventCardFilter)) return undefined;
    eventCardId = event.cardInstanceId;
    eventControllerId = event.controllerPlayerId;
  } else if (event.type === 'MOVE_CARD') {
    if (repl.fromZone && event.fromZone !== repl.fromZone) return undefined;
    if (repl.toZone && event.toZone !== repl.toZone) return undefined;
    if (repl.onlyLeaveBattlefield) {
      if (
        event.fromZone !== 'BATTLEFIELD' ||
        (event.toZone === 'BATTLEFIELD' && !event.isPlacingUnderneath) ||
        (repl.isOrphanCleanup !== true && event.isOrphanCleanup)
      ) {
        return undefined;
      }
    }
    if (
      repl.isOrphanCleanup !== undefined &&
      Boolean(event.isOrphanCleanup) !== repl.isOrphanCleanup
    ) {
      return undefined;
    }
    if (repl.orphanHostName) {
      if (
        !event.orphanHostCardId ||
        !rCtx.hasCardName(event.orphanHostCardId, repl.orphanHostName)
      ) {
        return undefined;
      }
    }
    const eventCard = rCtx.state.cards[event.cardInstanceId];
    if (!eventCard) return undefined;
    if (repl.eventCardFilter && !matchFilter(eventCard, repl.eventCardFilter)) return undefined;
    eventCardId = event.cardInstanceId;
    eventControllerId = event.controllerPlayerId;
  } else {
    if (repl.eventCardFilter) {
      const dmgSrc = event.sourceCardId ? rCtx.state.cards[event.sourceCardId] : undefined;
      if (!dmgSrc || !matchFilter(dmgSrc, repl.eventCardFilter)) return undefined;
    }
    eventCardId = event.sourceCardId;
    eventControllerId = event.defenderPlayerId;
  }

  const sourceZones: ZoneId[] = repl.sourceZones ?? ['BATTLEFIELD'];
  const sourceCandidates: CardInstance[] = [];
  const seenSourceIds = new Set<string>();

  if (repl.subjectScope === 'SELF') {
    if (event.type === 'DEAL_DAMAGE') {
      const dmgSrc = event.sourceCardId ? rCtx.state.cards[event.sourceCardId] : undefined;
      if (dmgSrc && dmgSrc.cardNumber === spec.cardNumber && sourceZones.includes(dmgSrc.zone)) {
        sourceCandidates.push(dmgSrc);
      }
    } else {
      const eventCard = rCtx.state.cards[event.cardInstanceId];
      if (
        eventCard &&
        eventCard.cardNumber === spec.cardNumber &&
        sourceZones.includes(eventCard.zone)
      ) {
        const buriedInBattlefield =
          eventCard.zone === 'BATTLEFIELD' &&
          !(event.type === 'MOVE_CARD' && event.isOrphanCleanup) &&
          collectUnderneathIdSet(rCtx.state, eventCard.controllerPlayerId).has(
            eventCard.instanceId
          );
        if (!buriedInBattlefield) {
          sourceCandidates.push(eventCard);
        }
      }
    }
  } else {
    for (const z of sourceZones) {
      const zoneCards =
        z === 'BATTLEFIELD'
          ? collectActiveBattlefieldCards(rCtx.state, eventControllerId)
          : rCtx.getZoneCards(eventControllerId, z);
      for (const c of zoneCards) {
        if (c.cardNumber === spec.cardNumber && !seenSourceIds.has(c.instanceId)) {
          seenSourceIds.add(c.instanceId);
          sourceCandidates.push(c);
        }
      }
    }
  }

  for (const src of sourceCandidates) {
    if (rCtx.hasLostAbilities(src.instanceId)) continue;
    const oncePerTurnUsageKey = repl.oncePerTurn
      ? `${src.instanceId}:repl:${repl.id}`
      : undefined;
    if (oncePerTurnUsageKey) {
      const player = rCtx.state.players[src.controllerPlayerId];
      if (!player || (player.turnAbilityUsage[oncePerTurnUsageKey] ?? 0) > 0) continue;
    }

    const subjectCardId = eventCardId ?? src.instanceId;
    if (!repl.cost) {
      return {
        src,
        subjectCardId,
        oncePerTurnUsageKey,
        detachFromSubject: false,
      };
    }

    if (repl.cost.kind === 'SEND_SELF_ATTACHED_EQUIPS_TO_GY') {
      const eqIds = getAttachedEquipmentIds(src);
      if (eqIds.length < repl.cost.requiredTraits.length) continue;
      const usedEqIds: string[] = [];
      let allMatched = true;
      for (const reqTrait of repl.cost.requiredTraits) {
        const matchEqId = eqIds.find(
          (eid) => !usedEqIds.includes(eid) && hasTraitSafe(eid, reqTrait)
        );
        if (!matchEqId) {
          allMatched = false;
          break;
        }
        usedEqIds.push(matchEqId);
      }
      if (!allMatched) continue;
      return {
        src,
        subjectCardId,
        oncePerTurnUsageKey,
        fixedSacrificeIds: usedEqIds,
        detachFromSubject: true,
      };
    }

    // SEND_ZONE_CARD_TO_GY
    const cost = repl.cost;
    const underSet =
      cost.zone === 'BATTLEFIELD'
        ? collectUnderneathIdSet(rCtx.state, src.controllerPlayerId)
        : undefined;
    let sacrificeCandidates: string[];
    if (cost.selfOnly) {
      const selfOk =
        src.zone === cost.zone &&
        !underSet?.has(src.instanceId) &&
        !(cost.excludeEventCard && eventCardId === src.instanceId) &&
        matchFilter(src, cost.filter, src.instanceId);
      sacrificeCandidates = selfOk ? [src.instanceId] : [];
    } else {
      sacrificeCandidates = rCtx
        .getZoneCards(src.controllerPlayerId, cost.zone)
        .filter((c) => {
          if (underSet?.has(c.instanceId)) return false;
          if (cost.excludeEventCard && eventCardId && c.instanceId === eventCardId) return false;
          return matchFilter(c, cost.filter, src.instanceId);
        })
        .map((c) => c.instanceId);
    }
    if (sacrificeCandidates.length < cost.count) continue;
    return {
      src,
      subjectCardId,
      oncePerTurnUsageKey,
      sacrificeCandidates,
      sacrificeCount: cost.count,
      detachFromSubject: false,
    };
  }

  return undefined;
}

/**
 * 8.10 向 ReplacementEngine 注册所有声明式卡牌置换规则 (`CardEffectSpec.replacements`)
 */
export function registerDeclarativeReplacements(
  replacementEngine: ReplacementEngine,
  _ctx: CardEffectContext,
  specs: ReadonlyMap<string, CardEffectSpec> | Iterable<CardEffectSpec>,
  evaluator: DslEvaluator
): void {
  const specIter: Iterable<CardEffectSpec> =
    specs instanceof Map ||
    typeof (specs as ReadonlyMap<string, CardEffectSpec>).get === 'function'
      ? (specs as ReadonlyMap<string, CardEffectSpec>).values()
      : (specs as Iterable<CardEffectSpec>);
  for (const spec of specIter) {
    for (const repl of spec.replacements ?? []) {
      const ruleId = `dsl:repl:${spec.cardNumber}:${repl.id}`;
      replacementEngine.registerRule({
        id: ruleId,
        label: repl.label,
        eventTypes: repl.eventTypes,
        matches: (event, rCtx) =>
          Boolean(resolveDeclarativeReplacementMatch(spec, repl, event, rCtx, evaluator)),
        apply: (event, rCtx, appliedIds): ReplacementOutcome | undefined => {
          const match = resolveDeclarativeReplacementMatch(spec, repl, event, rCtx, evaluator);
          if (!match) return undefined;

          if (
            repl.optional &&
            (event.type === 'DESTROY_ROLE' || event.type === 'MOVE_CARD') &&
            (repl.action.kind === 'PREVENT' || repl.action.kind === 'REDIRECT_ZONE')
          ) {
            return replacementEngine.enqueueOptionalReplacementDecision(
              {
                ruleId,
                label: repl.label,
                controllerPlayerId: match.src.controllerPlayerId,
                subjectCardId: match.subjectCardId,
                event,
                appliedIds,
                prompt: repl.confirmPrompt,
                choiceEffectType: repl.choiceEffectType,
                sacrificeCandidates: match.sacrificeCandidates,
                sacrificeCount: match.sacrificeCount,
                fixedSacrificeIds: match.fixedSacrificeIds,
                detachFromSubject: repl.cost?.kind === 'SEND_SELF_ATTACHED_EQUIPS_TO_GY',
                oncePerTurnUsageKey: match.oncePerTurnUsageKey,
                action: repl.action,
                replaceOptionLabel: repl.replaceOptionLabel,
                declineOptionLabel: repl.declineOptionLabel,
              },
              rCtx
            );
          }

          if (match.oncePerTurnUsageKey) {
            const player = rCtx.state.players[match.src.controllerPlayerId];
            if (player) {
              player.turnAbilityUsage[match.oncePerTurnUsageKey] =
                (player.turnAbilityUsage[match.oncePerTurnUsageKey] ?? 0) + 1;
            }
          }

          const sacIds =
            match.fixedSacrificeIds ??
            (match.sacrificeCandidates && match.sacrificeCount
              ? match.sacrificeCandidates.slice(0, match.sacrificeCount)
              : []);
          if (match.detachFromSubject && sacIds.length > 0) {
            const sacSet = new Set(sacIds);
            const eqIds = getAttachedEquipmentIds(match.src);
            const remain = eqIds.filter((id) => !sacSet.has(id));
            match.src.attachedEquipmentId = remain[0];
            match.src.extraAttachedEquipmentIds = remain.length > 1 ? remain.slice(1) : undefined;
          }
          const sentByEffectOrCost =
            repl.cost?.kind === 'SEND_ZONE_CARD_TO_GY'
              ? (repl.cost.sentByEffectOrCost ?? true)
              : true;
          for (const sacId of sacIds) {
            if (rCtx.sendCardToGraveyard) {
              rCtx.sendCardToGraveyard(sacId, sentByEffectOrCost);
            } else {
              const sac = rCtx.state.cards[sacId];
              if (sac) {
                sac.zone = 'GRAVEYARD';
                sac.slotIndex = undefined;
                sac.isFaceUp = true;
              }
            }
          }

          if (repl.action.kind === 'MODIFY_DAMAGE') {
            if (event.type !== 'DEAL_DAMAGE') return undefined;
            let next = event.amount;
            if (repl.action.setAmount !== undefined) next = repl.action.setAmount;
            if (repl.action.delta !== undefined) next += repl.action.delta;
            if (repl.action.maxAmount !== undefined) next = Math.min(next, repl.action.maxAmount);
            return { kind: 'MODIFY_DAMAGE', newAmount: Math.max(0, next) };
          }
          return repl.action;
        },
      });
    }
  }
}
