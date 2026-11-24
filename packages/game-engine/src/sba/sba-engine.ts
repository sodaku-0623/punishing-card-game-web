import { GameState, GameEvent, CardInstance, CardType } from '@zhanshuang/shared';
import { RULE_CONSTANTS } from '@zhanshuang/game-rules';
import { ZoneManager } from '../zone/zone-manager.js';
import {
  BattlefieldManager,
  getAttachedEquipmentIds,
  isFengrenTachiEquipmentDef,
  setAttachedEquipmentIds,
} from '../zone/battlefield-manager.js';
import { ReplacementEngine } from '../effects/replacement-engine.js';
import type { ContinuousEffectEngine } from '../effects/continuous-effects.js';
import type { TriggerEvent } from '../priority/trigger-system.js';

export class SbaEngine {
  private onTriggerEventCallback?: (event: TriggerEvent) => void;
  private snapshotProvider?: (cardInstanceId: string) => TriggerEvent['subjectSnapshot'];
  private replacementEngine?: ReplacementEngine;
  private continuousEffects?: ContinuousEffectEngine;

  constructor(
    private state: GameState,
    private zoneMgr: ZoneManager,
    private fieldMgr: BattlefieldManager,
    private events: GameEvent[]
  ) {}

  setReplacementEngine(engine: ReplacementEngine): void {
    this.replacementEngine = engine;
  }

  setContinuousEffectEngine(engine: ContinuousEffectEngine): void {
    this.continuousEffects = engine;
  }

  setTriggerEventHandler(
    handler: (event: TriggerEvent) => void,
    snapshotProvider?: (cardInstanceId: string) => TriggerEvent['subjectSnapshot']
  ): void {
    this.onTriggerEventCallback = handler;
    this.snapshotProvider = snapshotProvider;
  }

  /**
   * 9.3 败北判定处理 (9.3.1)：检查是否有玩家侵蚀达到上限或牌组与墓地均耗尽
   */
  checkDefeatCondition(): boolean {
    if (this.state.status === 'FINISHED') return false;
    const p1 = this.state.players[this.state.activePlayerId];
    const p2 = this.state.players[this.state.nonActivePlayerId];
    if (!p1 || !p2) return false;

    const p1Loss =
      p1.erosionCount >= RULE_CONSTANTS.EROSION_LOSS_THRESHOLD ||
      (this.zoneMgr.getCardsInZone(p1.playerId, 'DECK').length === 0 &&
        this.zoneMgr.getCardsInZone(p1.playerId, 'GRAVEYARD').length === 0);

    const p2Loss =
      p2.erosionCount >= RULE_CONSTANTS.EROSION_LOSS_THRESHOLD ||
      (this.zoneMgr.getCardsInZone(p2.playerId, 'DECK').length === 0 &&
        this.zoneMgr.getCardsInZone(p2.playerId, 'GRAVEYARD').length === 0);

    if (p1Loss && p2Loss) {
      // 1.2.3 双方同时处于败北状态时，该局游戏判定为平局
      this.state.status = 'FINISHED';
      this.state.isDraw = true;
      this.state.finishReason = '双方同时满足败北条件，判定为平局 (1.2.3)';
      this.events.push({
        type: 'GAME_OVER',
        isDraw: true,
        reason: this.state.finishReason,
      });
      return true;
    }
    if (p1Loss) {
      this.state.status = 'FINISHED';
      this.state.winnerId = p2.playerId;
      this.state.finishReason = `${p1.playerId} 满足败北条件 (侵蚀达标或牌组墓地耗尽)`;
      this.events.push({
        type: 'GAME_OVER',
        winnerPlayerId: p2.playerId,
        isDraw: false,
        reason: this.state.finishReason,
      });
      return true;
    }
    if (p2Loss) {
      this.state.status = 'FINISHED';
      this.state.winnerId = p1.playerId;
      this.state.finishReason = `${p2.playerId} 满足败北条件 (侵蚀达标或牌组墓地耗尽)`;
      this.events.push({
        type: 'GAME_OVER',
        winnerPlayerId: p1.playerId,
        isDraw: false,
        reason: this.state.finishReason,
      });
      return true;
    }
    return false;
  }

  /**
   * 执行检查型规则处理 (9.1.2.b 检查型规则处理)
   * 返回是否有规则处理被执行
   */
  runCheckTimingSba(): boolean {
    if (this.state.status === 'FINISHED') return false;

    let executedAny = false;

    // 1. 9.3 败北判定处理 (9.3.1)
    if (this.checkDefeatCondition()) {
      return true;
    }

    // 2. 9.4 角色PP不足处理 (当任意角色的PP变为0及以下时，该角色会因规则而破坏；支持 8.10 置换效果拦截)
    for (const card of Object.values(this.state.cards)) {
      if (card.zone === 'BATTLEFIELD') {
        const isTopRole = this.fieldMgr.isSlotRole(card.controllerPlayerId, card.instanceId);
        if (isTopRole) {
          const pp = this.fieldMgr.calculateRoleEffectivePP(card.instanceId);
          if (pp <= 0) {
            const intercept = this.replacementEngine?.interceptDestroyRole(card.instanceId, 'PP_ZERO');
            if (intercept?.replaced) {
              if (intercept.redirect) {
                this.zoneMgr.moveCard(card.instanceId, intercept.redirect.zone, {
                  isFaceUp: intercept.redirect.isFaceUp,
                  isReady: intercept.redirect.isReady,
                  toBottom: intercept.redirect.toBottom,
                  appliedReplacementIds: intercept.appliedIds,
                });
                executedAny = true;
              }
              continue;
            }
            const snapshot = this.snapshotProvider?.(card.instanceId);
            const moved = this.zoneMgr.moveCard(card.instanceId, 'GRAVEYARD', { isFaceUp: true });
            if (moved) {
              this.events.push({
                type: 'CARD_DESTROYED',
                cardInstanceId: card.instanceId,
                reason: 'PP_ZERO',
              });
              this.onTriggerEventCallback?.({
                type: 'CARD_DESTROYED',
                playerId: card.controllerPlayerId,
                cardInstanceId: card.instanceId,
                fromZone: 'BATTLEFIELD',
                toZone: this.state.cards[card.instanceId]?.zone ?? 'GRAVEYARD',
                destroyReason: 'PP_ZERO',
                subjectSnapshot: snapshot,
              });
              executedAny = true;
            }
          }
        }
      }
    }

    // 3. 9.5 违规卡牌处理
    const p1 = this.state.players[this.state.activePlayerId]!;
    const p2 = this.state.players[this.state.nonActivePlayerId]!;
    for (const p of [p1, p2]) {
      // 9.5.2 战场顶层卡位存在角色牌、道具牌、辅助机牌以外的卡牌时 (如违规滞留的战术牌)，移动到墓地
      for (const s of this.fieldMgr.getSlots(p.playerId)) {
        for (const topId of [s.roleCardId, s.assistCardId, s.standaloneEquipmentId]) {
          if (!topId) continue;
          const topCard = this.state.cards[topId];
          if (!topCard) continue;
          const topDef =
            this.fieldMgr.cardDb.getCard(topCard.cardNumber) ||
            (topCard.cardId ? this.fieldMgr.cardDb.getCard(topCard.cardId) : undefined);
          const effectiveType = this.continuousEffects?.getEffectiveCardType(topId) ?? topDef?.cardType;
          if (
            effectiveType !== CardType.ROLE &&
            effectiveType !== CardType.EQUIPMENT &&
            effectiveType !== CardType.ASSIST
          ) {
            this.zoneMgr.moveCard(topId, 'GRAVEYARD', { isFaceUp: true });
            executedAny = true;
          }
        }
      }

      // 9.5.3 每张角色最多装备 1 张装备；若因失去双持<封刃太刀>能力等导致超过上限，保留首张并将多余装备置入墓地
      for (const s of this.fieldMgr.getSlots(p.playerId)) {
        const candidateId =
          s.roleCardId && this.fieldMgr.isSlotRole(p.playerId, s.roleCardId)
            ? s.roleCardId
            : s.assistCardId && this.fieldMgr.isSlotRole(p.playerId, s.assistCardId)
              ? s.assistCardId
              : undefined;
        if (!candidateId) continue;
        const roleCard = this.state.cards[candidateId];
        if (!roleCard) continue;
        const attachedIds = getAttachedEquipmentIds(roleCard);
        if (attachedIds.length <= 1) continue;
        const canDual = this.continuousEffects?.evaluateCard(candidateId).canDualEquipFengren ?? false;
        const allFengren = attachedIds.every((eqId) => {
          const eq = this.state.cards[eqId];
          const eqDef = eq
            ? this.fieldMgr.cardDb.getCard(eq.cardNumber) ||
              (eq.cardId ? this.fieldMgr.cardDb.getCard(eq.cardId) : undefined)
            : undefined;
          return isFengrenTachiEquipmentDef(eqDef);
        });
        if (!canDual || !allFengren) {
          const keepId = attachedIds[0]!;
          setAttachedEquipmentIds(roleCard, [keepId]);
          for (const excessEqId of attachedIds.slice(1)) {
            this.zoneMgr.moveCard(excessEqId, 'GRAVEYARD', {
              isFaceUp: true,
              isOrphanCleanup: true,
              orphanHostCardId: candidateId,
            });
          }
          executedAny = true;
        }
      }

      // 9.5.5 费用区超过上限；含 BP03-052 动态上限11
      const maxCap = this.zoneMgr.getMaxCostZoneCapacity(p.playerId);
      const costCards = this.zoneMgr.getCardsInZone(p.playerId, 'COST');
      if (costCards.length > maxCap) {
        const excess = costCards.length - maxCap;
        // 自动选择末尾多出的费用置入墓地
        for (let i = 0; i < excess; i++) {
          const cardToDiscard = costCards[costCards.length - 1 - i]!;
          this.zoneMgr.moveCard(cardToDiscard.instanceId, 'GRAVEYARD', { isFaceUp: true });
        }
        executedAny = true;
      }

      // BP04-052 血契者【永】：我方战场只能存在1张《血契者》(超出上限时保留最早/后者中第一张，其余置入墓地)
      const bloodPactRoles = this.fieldMgr
        .getSlots(p.playerId)
        .map((s) => (s.roleCardId ? this.state.cards[s.roleCardId] : undefined))
        .filter(
          (c): c is CardInstance =>
            Boolean(c) &&
            (this.continuousEffects
              ? this.continuousEffects.hasCardName(c!.instanceId, '血契者')
              : c!.cardNumber === 'BP04-052') &&
            !this.continuousEffects?.hasLostInherentAbilities(c!.instanceId)
        );
      if (bloodPactRoles.length > 1) {
        // 保留最先在场的 1 张 (按 enteredZoneTimestamp 最小优先，其余置入墓地)
        const sorted = [...bloodPactRoles].sort(
          (a, b) => (a.enteredZoneTimestamp ?? 0) - (b.enteredZoneTimestamp ?? 0)
        );
        for (let i = 1; i < sorted.length; i++) {
          this.zoneMgr.moveCard(sorted[i]!.instanceId, 'GRAVEYARD', { isFaceUp: true });
        }
        executedAny = true;
      }

      // 9.5.4 / Q&A·9 (BP04-001 变为辅助机 / PR-041 变为角色)：战场辅助机超过 1 张时，保留最新成为辅助机的卡牌，其余置入墓地
      const assistEntries: Array<{ card: CardInstance; ts: number }> = [];
      for (const s of this.fieldMgr.getSlots(p.playerId)) {
        if (s.assistCardId) {
          const ac = this.state.cards[s.assistCardId];
          const isAssist = ac
            ? this.continuousEffects
              ? this.continuousEffects.getEffectiveCardType(ac.instanceId) === 'ASSIST'
              : !ac.modifiers?.some((m) => m.setCardType === 'ROLE')
            : false;
          if (ac && isAssist) {
            assistEntries.push({ card: ac, ts: ac.enteredZoneTimestamp ?? 0 });
          }
        }
        if (s.roleCardId) {
          const rc = this.state.cards[s.roleCardId];
          const isAssist = rc
            ? this.continuousEffects
              ? this.continuousEffects.getEffectiveCardType(rc.instanceId) === 'ASSIST'
              : Boolean(rc.modifiers?.some((m) => m.setCardType === 'ASSIST'))
            : false;
          const assistMod = rc?.modifiers?.find((m) => m.setCardType === 'ASSIST');
          if (rc && isAssist) {
            assistEntries.push({ card: rc, ts: assistMod?.timestamp ?? rc.enteredZoneTimestamp ?? 0 });
          }
        }
      }
      if (assistEntries.length > 1) {
        assistEntries.sort((a, b) => b.ts - a.ts);
        for (let i = 1; i < assistEntries.length; i++) {
          this.zoneMgr.moveCard(assistEntries[i]!.card.instanceId, 'GRAVEYARD', { isFaceUp: true });
        }
        executedAny = true;
      }
    }

    return executedAny;
  }
}
