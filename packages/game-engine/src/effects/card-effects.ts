import {
  GameState,
  GameEvent,
  GameAction,
  CardInstance,
  CardType,
  CardVersionData,
  PendingChoice,
} from '@zhanshuang/shared';
import { ICardDatabase } from '../database/card-registry.js';
import { ZoneManager } from '../zone/zone-manager.js';
import { BattlefieldManager } from '../zone/battlefield-manager.js';
import { PresetCardEffects } from './preset-cards.js';
import { ContinuousEffectEngine, addCardModifier } from './continuous-effects.js';
import { ReplacementEngine } from './replacement-engine.js';
import type { TriggerManager } from '../priority/trigger-system.js';
import { nextChoiceId } from '../state/pending-choice.js';

export interface CardEffectContext {
  state: GameState;
  zoneMgr: ZoneManager;
  fieldMgr: BattlefieldManager;
  cardDb: ICardDatabase;
  events: GameEvent[];
  continuousEffects?: ContinuousEffectEngine;
  triggerMgr?: TriggerManager;
  replacementEngine?: ReplacementEngine;
  payCost: (playerId: string, costToPay: number, selectedCostCardIds?: string[]) => boolean;
  setPendingChoice: (choice?: PendingChoice) => void;
}

/**
 * 战双卡牌对战 全卡牌效果执行引擎
 * 负责识别并处理所有卡牌的登场效果【出】、战术效果、起动能力【起】与决策分支结算
 */
export class CardEffectEngine {
  /** 官方预组 (ST01~ST03) 的逐卡精确实现，优先于下方的通用近似解析 */
  readonly presets: PresetCardEffects;

  constructor(private ctx: CardEffectContext) {
    this.presets = new PresetCardEffects(ctx, this);
    if (ctx.continuousEffects) {
      this.presets.registerStaticEffects(ctx.continuousEffects);
    }
    if (ctx.replacementEngine) {
      this.presets.registerReplacements(ctx.replacementEngine);
    }
    if (ctx.triggerMgr) {
      this.presets.registerTriggers(ctx.triggerMgr);
      ctx.triggerMgr.registerTrigger({
        abilityId: 'legacy:CARD_ENTRY',
        eventTypes: ['CARD_ENTERED_FIELD'],
        collect: ({ state, event, continuousEffects }) => {
          if (event.suppressEntryTrigger) return [];
          const enteredId = event.cardInstanceId;
          const playerId = event.playerId;
          if (!enteredId || !playerId) return [];
          const card = state.cards[enteredId];
          if (!card || card.zone !== 'BATTLEFIELD') return [];
          if (continuousEffects.hasLostInherentAbilities(enteredId)) return [];
          if (this.presets.handlesEntry(card.cardNumber) || this.presets.isVanillaEntry(card.cardNumber)) {
            return [];
          }
          const def = this.getCardDef(card);
          if (!def) return [];
          if (
            !def.rulesText.includes('【出】') &&
            !def.rulesText.includes('登场时') &&
            def.cardNumber !== 'BP04-028'
          ) {
            return [];
          }
          return [
            {
              sourceCardInstanceId: enteredId,
              sourceCardNumber: card.cardNumber,
              controllerPlayerId: playerId,
              label: `【${def.name}】【出】登场能力`,
              triggerContext: { cardNumber: card.cardNumber },
            },
          ];
        },
        execute: (trigger) => {
          const card = this.ctx.state.cards[trigger.sourceCardInstanceId];
          const def = card ? this.getCardDef(card) : undefined;
          if (def) {
            this.handleRoleEntryEffect(trigger.controllerPlayerId, trigger.sourceCardInstanceId, def, {
              keepQueuedTrigger: true,
            });
          }
        },
      });
    }
  }

  private getOpponentPlayerId(playerId: string): string {
    return playerId === this.ctx.state.activePlayerId
      ? this.ctx.state.nonActivePlayerId
      : this.ctx.state.activePlayerId;
  }

  /**
   * 8.10 统一角色效果/PP归零破坏入口：经由置换引擎拦截，被置换时返回 false (8.10.1.a 视为未破坏)
   */
  private destroyRoleWithReplacement(cardInstanceId: string, reason: 'EFFECT' | 'PP_ZERO'): boolean {
    const target = this.ctx.state.cards[cardInstanceId];
    if (!target || !this.ctx.fieldMgr.isSlotRole(target.controllerPlayerId, cardInstanceId)) {
      return false;
    }
    const intercept = this.ctx.replacementEngine?.interceptDestroyRole(cardInstanceId, reason);
    if (intercept?.replaced) {
      if (intercept.redirect) {
        this.ctx.zoneMgr.moveCard(cardInstanceId, intercept.redirect.zone, {
          isFaceUp: intercept.redirect.isFaceUp,
          isReady: intercept.redirect.isReady,
          toBottom: intercept.redirect.toBottom,
          appliedReplacementIds: intercept.appliedIds,
        });
      }
      return false;
    }
    const snapshot = this.ctx.triggerMgr?.snapshotCard(cardInstanceId);
    const moved = this.ctx.zoneMgr.moveCard(cardInstanceId, 'GRAVEYARD', { isFaceUp: true });
    if (!moved) return false;
    this.ctx.events.push({
      type: 'CARD_DESTROYED',
      cardInstanceId,
      reason,
    });
    this.ctx.triggerMgr?.emit({
      type: 'CARD_DESTROYED',
      playerId: target.controllerPlayerId,
      cardInstanceId,
      fromZone: 'BATTLEFIELD',
      toZone: this.ctx.state.cards[cardInstanceId]?.zone ?? 'GRAVEYARD',
      destroyReason: reason,
      subjectSnapshot: snapshot,
    });
    return true;
  }

  private collectSlotRolesForPlayer(playerId: string): CardInstance[] {
    const slots = this.ctx.state.battlefields[playerId] || [];
    const roles: CardInstance[] = [];
    for (const s of slots) {
      for (const id of [s.roleCardId, s.assistCardId]) {
        if (!id) continue;
        if (!this.ctx.fieldMgr.isSlotRole(playerId, id)) continue;
        const c = this.ctx.state.cards[id];
        if (c) roles.push(c);
      }
    }
    return roles;
  }

  private getFriendlyRoles(playerId: string): CardInstance[] {
    return this.collectSlotRolesForPlayer(playerId);
  }

  private getOpponentRoles(playerId: string): CardInstance[] {
    return this.collectSlotRolesForPlayer(this.getOpponentPlayerId(playerId));
  }

  getCardDef(cardOrId: CardInstance | string): CardVersionData | undefined {
    const num = typeof cardOrId === 'string'
      ? cardOrId
      : (cardOrId.cardNumber || cardOrId.cardId);
    return this.ctx.cardDb.getCard(num);
  }

  createRoleChoiceOption(
    card: CardInstance,
    options?: {
      eligible?: boolean;
      ineligibleReason?: string;
      customLabel?: string;
    }
  ): { id: string; label: string; payload: any } {
    const d = this.getCardDef(card);
    const effectivePP = this.ctx.fieldMgr.calculateRoleEffectivePP(card.instanceId);
    const eligible = options?.eligible !== false;
    const name = d?.name || card.cardNumber;
    const slotText = card.slotIndex !== undefined ? ` (卡位 ${card.slotIndex + 1})` : '';
    const label = options?.customLabel || `【${name}】[PP: ${effectivePP}]${slotText}`;

    return {
      id: card.instanceId,
      label,
      payload: {
        cardNumber: card.cardNumber,
        name,
        cardType: d?.cardType || CardType.ROLE,
        cost: d?.cost ?? 0,
        basePP: effectivePP,
        baseDP: d?.baseDP ?? 1,
        attribute: d?.attribute,
        traits: d?.traits || [],
        imageUrl: (d as any)?.imageUrl || card.imageUrl || `/cards/${card.cardNumber}.png`,
        rulesText: d?.rulesText || '',
        slotIndex: card.slotIndex,
        eligible,
        ineligibleReason: !eligible ? (options?.ineligibleReason || '不符合选择条件') : undefined,
      },
    };
  }

  createGeneralCardChoiceOption(
    card: CardInstance,
    options?: {
      eligible?: boolean;
      ineligibleReason?: string;
      customLabel?: string;
    }
  ): { id: string; label: string; payload: any } {
    const d = this.getCardDef(card);
    const eligible = options?.eligible !== false;
    const name = d?.name || card.cardNumber;
    const label = options?.customLabel || `【${name}】${d?.cost !== undefined ? `费用:${d.cost}` : ''} ${d?.basePP !== undefined ? `PP:${d.basePP}` : ''}`;

    return {
      id: card.instanceId,
      label,
      payload: {
        cardNumber: card.cardNumber,
        name,
        cardType: d?.cardType,
        cost: d?.cost ?? 0,
        basePP: d?.basePP,
        baseDP: d?.baseDP,
        attribute: d?.attribute,
        traits: d?.traits || [],
        imageUrl: (d as any)?.imageUrl || card.imageUrl || `/cards/${card.cardNumber}.png`,
        rulesText: d?.rulesText || '',
        eligible,
        ineligibleReason: !eligible ? (options?.ineligibleReason || '不符合选择条件') : undefined,
      },
    };
  }

  // =========================================================================
  // 1. 战术牌打出效果处理 (含信号球、专属大招等)
  // =========================================================================
  handlePlayTactics(
    playerId: string,
    cardInstanceId: string,
    cardDef: CardVersionData
  ): { success: boolean; error?: string } {
    const cardNum = cardDef.cardNumber || cardDef.id;

    if (this.presets.handlesTactics(cardNum)) {
      this.ctx.zoneMgr.moveCard(cardInstanceId, 'PROCESSING', { isFaceUp: true });
      return this.presets.playTactics(playerId, cardInstanceId, cardDef);
    }

    // --- 分流执行效果 ---

    // A. 专武/招式战术牌 (使用后放置到信号球区最上方，抽1张牌)
    // ST01-012/013/014, ST02-012/013/014, ST03-012/013/014
    // 只有信号球牌 (带信号球颜色) 才在使用后直接放置到信号球区；BP04-032 炽能球等需先执行效果
    if (cardDef.signalOrb && cardDef.rulesText.includes('信号球区最上方')) {
      // 1. 移动至信号球区最上方 (不进入墓地)
      this.ctx.zoneMgr.moveCard(cardInstanceId, 'SIGNAL_ORB', { isFaceUp: true });
      // 2. 抽1张牌
      this.ctx.zoneMgr.drawCards(playerId, 1);

      this.ctx.events.push({
        type: 'ABILITY_ACTIVATED',
        playerId,
        cardInstanceId,
        abilityName: `${cardDef.name} 充能就绪并抽牌`,
        rulesText: cardDef.rulesText,
      });

      // 规则：玩家从手牌中发动信号球将其填充到信号球区则只能发动其<充能自>效果以外的效果
      // 不在此处执行 <充能自> 效果 (仅在攻击充能与伤害充能流程中触发)
      return { success: true };
    }

    // B. 基础信号球牌 (ORB-RED, ORB-BLUE, ORB-YELLOW)
    if (cardNum.startsWith('ORB-') || (cardDef.signalOrb && cardDef.cost === 0)) {
      this.ctx.zoneMgr.moveCard(cardInstanceId, 'SIGNAL_ORB', { isFaceUp: true });
      this.ctx.events.push({
        type: 'ABILITY_ACTIVATED',
        playerId,
        cardInstanceId,
        abilityName: `${cardDef.name} 信号球就绪`,
        rulesText: cardDef.rulesText,
      });
      return { success: true };
    }

    // C. 常规战术牌：先移入处理区，兜底发射能力事件并送入墓地 (490 张官方卡已由声明式预设接管)
    this.ctx.zoneMgr.moveCard(cardInstanceId, 'PROCESSING', { isFaceUp: true });
    this.ctx.events.push({
      type: 'ABILITY_ACTIVATED',
      playerId,
      cardInstanceId,
      abilityName: cardDef.name,
      rulesText: cardDef.rulesText,
    });
    this.ctx.zoneMgr.moveCard(cardInstanceId, 'GRAVEYARD', { isFaceUp: true });
    return { success: true };
  }

  // =========================================================================
  // 2. 角色登场效果处理【出】/【自】(出场时自动触发)
  // =========================================================================
  handleRoleEntryEffect(
    playerId: string,
    roleInstanceId: string,
    cardDef: CardVersionData,
    options?: { keepQueuedTrigger?: boolean }
  ): void {
    const cardNum = cardDef.cardNumber;
    const roleCard = this.ctx.state.cards[roleInstanceId];
    if (!roleCard) return;

    if (!options?.keepQueuedTrigger && this.ctx.state.pendingTriggers.length > 0) {
      this.ctx.state.pendingTriggers = this.ctx.state.pendingTriggers.filter(
        (t) =>
          !(
            t.sourceCardInstanceId === roleInstanceId &&
            (t.abilityId === 'dsl:CARD_ENTRY' || t.abilityId === 'legacy:CARD_ENTRY')
          )
      );
    }

    if (this.presets.handlesEntry(cardNum) || this.presets.isVanillaEntry(cardNum)) {
      if (this.presets.handlesEntry(cardNum)) this.presets.enter(playerId, roleInstanceId, cardDef);
      return;
    }

    // 通用【出】效果解析与自动触发
    this.resolveUniversalEntryEffect(playerId, roleInstanceId, cardDef);
  }

  // =========================================================================
  // 3. 装备卡与辅助机生效处理
  // =========================================================================
  /**
   * 装备出场后的处理。4.18.2 装备角色的 PP 增加装备牌的基本 PP 由 calculateRoleEffectivePP 计入；
   * 装备牌文本中的能力 (如「装备角色为《…》时获得…」) 尚未实现，不再按文本中的「PP+X」近似追加加成。
   */
  handleEquipmentBuff(_targetRoleId: string, _equipDef: CardVersionData): void {}

  /**
   * 辅助机出场后的处理。辅助机的能力尚未实现。
   */
  handleAssistBuff(_playerId: string, _assistDef: CardVersionData): void {}

  // =========================================================================
  // 4. 起动能力【起】处理
  // =========================================================================
  handleActivateAbility(
    playerId: string,
    sourceCardId: string,
    cardDef: CardVersionData
  ): { success: boolean; error?: string } {
    const card = this.ctx.state.cards[sourceCardId];
    if (!card) return { success: false, error: '未找到来源卡牌' };

    return this.resolveUniversalActivatedEffect(playerId, sourceCardId, cardDef);
  }

  // =========================================================================
  // 5. 玩家决策确认与执行 (SELECT_CHOICE_OPTION)
  // =========================================================================
  handleChoiceResolution(
    action: Extract<GameAction, { type: 'SELECT_CHOICE_OPTION' }>,
    choice: PendingChoice
  ): { success: boolean; error?: string } {
    const selectedIds = action.selectedIds || (action as any).selectedOptionIds || [];
    const playerId = action.playerId;
    const player = this.ctx.state.players[playerId];

    if (this.presets.handlesChoice(choice) || choice.effectType?.startsWith('PRESET_')) {
      const result = this.presets.resolveChoice(action, choice);
      if (!result.success) return result;
      return this.finishChoiceResolution(choice, playerId, selectedIds);
    }

    switch (choice.effectType) {
      // 专武信号球二选一 / 充能自
      case 'SIGNATURE_MOVE_EFFECT': {
        const option = selectedIds[0];
        if (option === 'opt_draw_1') {
          this.ctx.zoneMgr.drawCards(playerId, 1);
        } else if (option === 'opt_erosion_minus_1') {
          const oppId = this.getOpponentPlayerId(playerId);
          const opp = this.ctx.state.players[oppId];
          if (player && opp && player.erosionCount >= opp.erosionCount && player.erosionCount > 0) {
            player.erosionCount -= 1;
            player.erosionChangedThisTurn = true;
          }
        } else if (option === 'opt_dp_plus_1') {
          const friendlyRoles = this.getFriendlyRoles(playerId);
          const directTargetId = selectedIds[1] || (action as any).targetCardId;
          const directTarget = directTargetId ? friendlyRoles.find((r) => r.instanceId === directTargetId) : undefined;
          if (directTarget) {
            addCardModifier(this.ctx.state, directTarget, {
              dp: 1,
              untilTurn: this.ctx.state.turnNumber,
              source: (choice.metadata?.cardNumber as string) || 'CHARGE_AUTO',
              sourceCardInstanceId: choice.sourceCardInstanceId,
              appliedByPlayerId: playerId,
            });
          } else if (friendlyRoles.length > 0) {
            this.ctx.setPendingChoice({
              id: nextChoiceId(this.ctx.state, 'effect'),
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: `【${choice.metadata?.cardName || choice.metadata?.cardNumber || '信号球'}】充能自：请选择我方战场最多1张角色（直到回合结束 DP+1）：`,
              options: friendlyRoles.map((r) => {
                const def = this.getCardDef(r);
                return {
                  id: r.instanceId,
                  label: `${def?.name || r.cardNumber} (卡位 ${(r.slotIndex ?? 0) + 1})`,
                  payload: {
                    cardNumber: r.cardNumber,
                    name: def?.name,
                    cardType: def?.cardType,
                    attribute: def?.attribute,
                    basePP: this.ctx.fieldMgr.calculateRoleEffectivePP(r.instanceId),
                    baseDP: this.ctx.fieldMgr.calculateRoleEffectiveDP(r.instanceId),
                    slotIndex: r.slotIndex,
                    imageUrl: r.imageUrl || def?.imageUrl,
                    eligible: true,
                  },
                };
              }),
              effectType: 'SELECT_ROLE_FOR_CHARGE_BUFF',
              sourceCardInstanceId: choice.sourceCardInstanceId,
              metadata: {
                buffType: 'DP',
                buffAmount: 1,
                cardName: choice.metadata?.cardName || choice.metadata?.cardNumber || '信号球',
                cardNumber: choice.metadata?.cardNumber,
              },
              minSelections: 0,
              maxSelections: 1,
            });
          }
        } else if (option === 'opt_pp_plus_2000') {
          const friendlyRoles = this.getFriendlyRoles(playerId);
          const directTargetId = selectedIds[1] || (action as any).targetCardId;
          const directTarget = directTargetId ? friendlyRoles.find((r) => r.instanceId === directTargetId) : undefined;
          if (directTarget) {
            addCardModifier(this.ctx.state, directTarget, {
              pp: 2000,
              untilTurn: this.ctx.state.turnNumber,
              source: (choice.metadata?.cardNumber as string) || 'CHARGE_AUTO',
              sourceCardInstanceId: choice.sourceCardInstanceId,
              appliedByPlayerId: playerId,
            });
          } else if (friendlyRoles.length > 0) {
            this.ctx.setPendingChoice({
              id: nextChoiceId(this.ctx.state, 'effect'),
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: `【${choice.metadata?.cardName || choice.metadata?.cardNumber || '信号球'}】充能自：请选择我方战场最多1张角色（直到回合结束 PP+2000）：`,
              options: friendlyRoles.map((r) => {
                const def = this.getCardDef(r);
                return {
                  id: r.instanceId,
                  label: `${def?.name || r.cardNumber} (卡位 ${(r.slotIndex ?? 0) + 1})`,
                  payload: {
                    cardNumber: r.cardNumber,
                    name: def?.name,
                    cardType: def?.cardType,
                    attribute: def?.attribute,
                    basePP: this.ctx.fieldMgr.calculateRoleEffectivePP(r.instanceId),
                    baseDP: this.ctx.fieldMgr.calculateRoleEffectiveDP(r.instanceId),
                    slotIndex: r.slotIndex,
                    imageUrl: r.imageUrl || def?.imageUrl,
                    eligible: true,
                  },
                };
              }),
              effectType: 'SELECT_ROLE_FOR_CHARGE_BUFF',
              sourceCardInstanceId: choice.sourceCardInstanceId,
              metadata: {
                buffType: 'PP',
                buffAmount: 2000,
                cardName: choice.metadata?.cardName || choice.metadata?.cardNumber || '信号球',
                cardNumber: choice.metadata?.cardNumber,
              },
              minSelections: 0,
              maxSelections: 1,
            });
          }
        } else if (option === 'opt_grant_sugong_chaoke') {
          const target = this.getFriendlyRoles(playerId).find((r) => this.getCardDef(r)?.name.includes('超刻'));
          if (target) {
            addCardModifier(this.ctx.state, target, {
              keywords: ['速攻'],
              untilTurn: this.ctx.state.turnNumber,
              source: (choice.metadata?.cardNumber as string) || 'CHARGE_AUTO',
              sourceCardInstanceId: choice.sourceCardInstanceId,
              appliedByPlayerId: playerId,
            });
          }
        } else if (option === 'opt_ready_chaoke') {
          const target = this.getFriendlyRoles(playerId).find((r) => this.getCardDef(r)?.name.includes('超刻'));
          if (target) {
            target.isReady = true;
          }
        }
        break;
      }

      // 充能自指定己方角色增益
      case 'SELECT_ROLE_FOR_CHARGE_BUFF': {
        const buffType = choice.metadata?.buffType as 'PP' | 'DP';
        const buffAmount = (choice.metadata?.buffAmount as number) || (buffType === 'PP' ? 2000 : 1);
        const targetId = selectedIds[0];
        if (targetId) {
          const role = this.ctx.state.cards[targetId];
          if (role) {
            addCardModifier(this.ctx.state, role, {
              ...(buffType === 'PP' ? { pp: buffAmount } : { dp: buffAmount }),
              untilTurn: this.ctx.state.turnNumber,
              source: (choice.metadata?.cardNumber as string) || (choice.metadata?.cardName as string) || 'CHARGE_AUTO',
              sourceCardInstanceId: choice.sourceCardInstanceId,
              appliedByPlayerId: playerId,
            });
            const roleDef = this.getCardDef(role);
            this.ctx.events.push({
              type: 'ABILITY_ACTIVATED',
              playerId,
              cardInstanceId: targetId,
              abilityName: `【${choice.metadata?.cardName || '充能自'}】${buffType}+${buffAmount}`,
              rulesText: `${roleDef?.name || '角色'} 获得 ${buffType}+${buffAmount} 增益`,
            });
          }
        }
        break;
      }

      // 角色破坏
      case 'DESTROY_ROLE': {
        for (const id of selectedIds) {
          this.destroyRoleWithReplacement(id, 'EFFECT');
        }
        if (choice.sourceCardInstanceId) {
          this.ctx.zoneMgr.moveCard(choice.sourceCardInstanceId, 'GRAVEYARD', { isFaceUp: true });
        }
        break;
      }

      // 效果伤害角色
      case 'DEAL_DAMAGE_TO_ROLE': {
        const dmg = (choice.metadata?.damage as number) || 1000;
        const srcNum = choice.sourceCardInstanceId
          ? this.ctx.state.cards[choice.sourceCardInstanceId]?.cardNumber
          : undefined;
        for (const id of selectedIds) {
          const role = this.ctx.state.cards[id];
          if (role) {
            addCardModifier(this.ctx.state, role, {
              pp: -dmg,
              untilTurn: this.ctx.state.turnNumber,
              source: srcNum,
              sourceCardInstanceId: choice.sourceCardInstanceId,
              appliedByPlayerId: playerId,
            });
            const effectivePP = this.ctx.fieldMgr.calculateRoleEffectivePP(id);
            if (effectivePP <= 0) {
              this.destroyRoleWithReplacement(id, 'PP_ZERO');
            }
          }
        }
        break;
      }

      // 10.16 同命：攻击结束时可以破坏该角色；若如此做，破坏与其发生战斗的角色
      case 'MUTUAL_DESTINY': {
        if (selectedIds[0] !== 'opt_yes') break;
        const attackerId = choice.metadata?.attackerCardId as string | undefined;
        const battledId = choice.metadata?.battledCardId as string | undefined;
        const attacker = attackerId ? this.ctx.state.cards[attackerId] : undefined;
        // 10.16.2.2 无法将该角色破坏时 (或被 8.10 置换未破坏时)，不执行后续效果
        if (!attacker || !this.ctx.fieldMgr.isSlotRole(playerId, attacker.instanceId)) break;
        if (!this.destroyRoleWithReplacement(attacker.instanceId, 'EFFECT')) break;
        const battled = battledId ? this.ctx.state.cards[battledId] : undefined;
        if (battled && this.ctx.fieldMgr.isSlotRole(battled.controllerPlayerId, battled.instanceId)) {
          this.destroyRoleWithReplacement(battled.instanceId, 'EFFECT');
        }
        break;
      }

      // 使用装备牌时选择装备对象 (8.6.2.e.2)
      case 'EQUIP_FROM_PROCESSING': {
        const equipId = choice.sourceCardInstanceId;
        const roleId = selectedIds[0];
        const equipCard = equipId ? this.ctx.state.cards[equipId] : undefined;
        if (!equipCard || equipCard.zone !== 'PROCESSING' || !roleId) {
          return { success: false, error: '装备牌已不在处理区' };
        }
        if (!this.ctx.fieldMgr.equipToRole(playerId, equipCard.instanceId, roleId)) {
          return { success: false, error: '装备对象必须是自身战场上未装备装备牌的角色 (4.18.3)' };
        }
        const equipDef = this.getCardDef(equipCard);
        if (equipDef) {
          this.handleEquipmentBuff(roleId, equipDef);
        }
        break;
      }

      // 10.2.1.b BP03-023 【充能自】确认升变出场 (无视费用上限，代价变为3费，获得【速攻】)
      case 'BP03_023_CHARGE_ASCEND': {
        if (selectedIds[0] !== 'opt_yes') break;
        const chargeCardId = choice.sourceCardInstanceId;
        const chargeCard = chargeCardId ? this.ctx.state.cards[chargeCardId] : undefined;
        if (!chargeCard || chargeCard.zone !== 'PROCESSING') break;
        const targets = this.getFriendlyRoles(playerId).filter((r) => {
          const d = this.getCardDef(r);
          return d && d.name === '里·超刻' && d.cost < 9;
        });
        if (targets.length === 0) break;
        if (targets.length === 1) {
          if (this.ctx.payCost(playerId, 3)) {
            this.ctx.fieldMgr.playAscensionCard(playerId, chargeCardId!, targets[0]!.instanceId);
          }
        } else {
          this.ctx.setPendingChoice({
            id: nextChoiceId(this.ctx.state, 'effect'),
            playerId,
            choiceType: 'SELECT_CARDS',
            prompt: '【里·超刻】充能自：请选择要升变的我方费用 9 以下的《里·超刻》：',
            options: targets.map((r) => this.createRoleChoiceOption(r)),
            effectType: 'BP03_023_CHOOSE_ASCEND_TARGET',
            sourceCardInstanceId: chargeCardId,
            minSelections: 1,
            maxSelections: 1,
          });
        }
        break;
      }

      case 'BP03_023_CHOOSE_ASCEND_TARGET': {
        const chargeCardId = choice.sourceCardInstanceId;
        const chargeCard = chargeCardId ? this.ctx.state.cards[chargeCardId] : undefined;
        const targetId = selectedIds[0];
        if (!chargeCard || chargeCard.zone !== 'PROCESSING' || !targetId) break;
        if (this.ctx.payCost(playerId, 3)) {
          this.ctx.fieldMgr.playAscensionCard(playerId, chargeCardId!, targetId);
        }
        break;
      }

      // 10.2.1.b BP03-024 【充能自】丢弃3张手牌《里·超刻》从处理区出场并回合末回牌组底
      case 'BP03_024_CHARGE_DEPLOY': {
        if (selectedIds.length !== 3) break;
        const chargeCardId = choice.sourceCardInstanceId;
        const chargeCard = chargeCardId ? this.ctx.state.cards[chargeCardId] : undefined;
        const slotIdx = this.ctx.fieldMgr.findFirstEmptySlot(playerId);
        if (!chargeCard || chargeCard.zone !== 'PROCESSING' || slotIdx === undefined) break;
        const player = this.ctx.state.players[playerId];
        if (player) {
          player.turnAbilityUsage['BP03-024:CHARGE_AUTO'] = (player.turnAbilityUsage['BP03-024:CHARGE_AUTO'] ?? 0) + 1;
        }
        for (const id of selectedIds) {
          this.ctx.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
        }
        if (this.ctx.fieldMgr.playRoleCard(playerId, chargeCardId!, slotIdx)) {
          this.ctx.triggerMgr?.registerDelayedTrigger({
            eventType: 'END_PHASE_TRIGGERS',
            triggerTurn: this.ctx.state.turnNumber,
            sourceCardInstanceId: chargeCardId!,
            sourceCardNumber: chargeCard.cardNumber,
            controllerPlayerId: playerId,
            abilityId: 'DELAYED_END_OF_TURN_TO_DECK_BOTTOM',
            label: '【里·超刻】该回合结束时放置到牌组底',
            once: true,
          });
        }
        break;
      }

      // 10.2.1.b BP03-028 【充能自】进墓地并消1黄球：攻击中的《里·超刻》获得【速攻】
      case 'BP03_028_CHARGE_AUTO': {
        const orbId = selectedIds[0];
        const chargeCardId = choice.sourceCardInstanceId;
        if (!orbId || !chargeCardId) break;
        const chargeCard = this.ctx.state.cards[chargeCardId];
        if (!chargeCard || chargeCard.zone !== 'PROCESSING') break;
        const orbColors =
          this.ctx.continuousEffects?.getEffectiveOrbInfo(orbId).colors ??
          ((): string[] => {
            const c = this.ctx.state.cards[orbId];
            const d = c ? this.getCardDef(c) : undefined;
            return d?.signalOrb ? [d.signalOrb] : [];
          })();
        this.ctx.zoneMgr.moveCard(chargeCardId, 'GRAVEYARD', { isFaceUp: true });
        this.ctx.zoneMgr.moveCard(orbId, 'GRAVEYARD', { isFaceUp: true });
        this.ctx.events.push({
          type: 'ORBS_ELIMINATED',
          playerId,
          orbCardIds: [orbId],
          cardDrawnCount: 0,
        });
        this.ctx.triggerMgr?.emit({
          type: 'ORBS_ELIMINATED',
          playerId,
          orbCardIds: [orbId],
          orbColors: orbColors.length > 0 ? orbColors : ['YELLOW'],
        });
        const targetId = choice.metadata?.attackerCardId as string | undefined;
        const target =
          (targetId ? this.ctx.state.cards[targetId] : undefined) ??
          this.getFriendlyRoles(playerId).find((r) =>
            this.ctx.continuousEffects
              ? this.ctx.continuousEffects.hasCardName(r.instanceId, '里·超刻')
              : this.getCardDef(r)?.name === '里·超刻'
          );
        if (target && target.zone === 'BATTLEFIELD') {
          this.ctx.setPendingChoice({
            id: nextChoiceId(this.ctx.state, 'effect'),
            playerId,
            choiceType: 'SELECT_OPTION',
            prompt: '【里·超刻】充能自：请从以下 2 项选择 1 项：',
            options: [
              { id: 'opt_quick', label: '选择我方战场 1 张《里·超刻》，直到回合结束获得【速攻】' },
              { id: 'opt_untap', label: '选择我方战场 1 张《里·超刻》，该回合结束时将其竖直' },
            ],
            effectType: 'BP03_028_PICK_MODE',
            sourceCardInstanceId: chargeCardId,
            metadata: { targetRoleId: target.instanceId },
            minSelections: 1,
            maxSelections: 1,
          });
        }
        break;
      }

      case 'BP03_028_PICK_MODE': {
        const targetId = choice.metadata?.targetRoleId as string | undefined;
        const target = targetId ? this.ctx.state.cards[targetId] : undefined;
        if (!target || target.zone !== 'BATTLEFIELD') break;
        if (selectedIds[0] === 'opt_untap') {
          this.ctx.triggerMgr?.registerDelayedTrigger({
            eventType: 'END_PHASE_TRIGGERS',
            triggerTurn: this.ctx.state.turnNumber,
            sourceCardInstanceId: target.instanceId,
            sourceCardNumber: target.cardNumber,
            controllerPlayerId: target.controllerPlayerId,
            abilityId: 'DELAYED_END_OF_TURN_UNTAP',
            label: `【${this.getCardDef(target)?.name ?? target.cardNumber}】该回合结束时将其竖直`,
            once: true,
            payload: {
              expectedZone: 'BATTLEFIELD',
              expectedEnteredTimestamp: target.enteredZoneTimestamp,
            },
          });
        } else {
          addCardModifier(this.ctx.state, target, {
            keywords: ['速攻'],
            untilTurn: this.ctx.state.turnNumber,
            source: 'BP03-028',
            sourceCardInstanceId: choice.sourceCardInstanceId,
            appliedByPlayerId: playerId,
          });
        }
        break;
      }

      // 10.2.1.b BP03-032 超宏爆发【充能自】进墓地并付3费：对方1张角色回牌组底
      case 'BP03_032_CHARGE_BOUNCE_BOTTOM': {
        const targetId = selectedIds[0];
        const chargeCardId = choice.sourceCardInstanceId;
        if (!targetId || !chargeCardId) break;
        const chargeCard = this.ctx.state.cards[chargeCardId];
        if (!chargeCard || chargeCard.zone !== 'PROCESSING') break;
        if (!this.ctx.payCost(playerId, 3)) break;
        this.ctx.zoneMgr.moveCard(chargeCardId, 'GRAVEYARD', { isFaceUp: true });
        if (this.ctx.state.cards[targetId]?.zone === 'BATTLEFIELD') {
          this.ctx.zoneMgr.moveCardToBottomOfDeck(targetId);
        }
        break;
      }

      // 10.8 BP03-054 艾拉·万华【瞬时】：选择<艺术协会>角色直到攻击结束 PP+1000
      case 'BP03_054_BUFF_ROLE': {
        const targetId = selectedIds[0];
        const role = targetId ? this.ctx.state.cards[targetId] : undefined;
        if (role && role.zone === 'BATTLEFIELD') {
          addCardModifier(this.ctx.state, role, {
            id: `combat-bp03-054-${this.ctx.events.length}`,
            pp: 1000,
            untilTurn: this.ctx.state.turnNumber,
            source: 'BP03-054',
            sourceCardInstanceId: choice.sourceCardInstanceId,
            appliedByPlayerId: playerId,
          });
        }
        break;
      }

      // 10.2.1.b PR-030 里·超刻【充能自】进墓地并消1蓝球：从手牌出场费用<=3《里·超刻》
      case 'PR030_CHARGE_AUTO_ORB': {
        const orbId = selectedIds[0];
        const chargeCardId = choice.sourceCardInstanceId;
        if (!orbId || !chargeCardId) break;
        const chargeCard = this.ctx.state.cards[chargeCardId];
        if (!chargeCard || chargeCard.zone !== 'PROCESSING') break;
        const slotIdx = this.ctx.fieldMgr.findFirstEmptySlot(playerId);
        if (slotIdx === undefined) break;
        const orbColors =
          this.ctx.continuousEffects?.getEffectiveOrbInfo(orbId).colors ??
          ((): string[] => {
            const c = this.ctx.state.cards[orbId];
            const d = c ? this.getCardDef(c) : undefined;
            return d?.signalOrb ? [d.signalOrb] : [];
          })();
        this.ctx.zoneMgr.moveCard(chargeCardId, 'GRAVEYARD', { isFaceUp: true });
        this.ctx.zoneMgr.moveCard(orbId, 'GRAVEYARD', { isFaceUp: true });
        this.ctx.events.push({
          type: 'ORBS_ELIMINATED',
          playerId,
          orbCardIds: [orbId],
          cardDrawnCount: 0,
        });
        this.ctx.triggerMgr?.emit({
          type: 'ORBS_ELIMINATED',
          playerId,
          orbCardIds: [orbId],
          orbColors: orbColors.length > 0 ? orbColors : ['BLUE'],
        });
        const handLees = this.ctx.zoneMgr.getCardsInZone(playerId, 'HAND').filter((c) => {
          const d = this.getCardDef(c);
          return (
            d &&
            d.cardType === CardType.ROLE &&
            (this.ctx.continuousEffects?.hasCardName(c.instanceId, '里·超刻') || d.name === '里·超刻') &&
            d.cost <= 3
          );
        });
        if (handLees.length === 1) {
          const targetLee = handLees[0]!;
          this.ctx.fieldMgr.playRoleCard(playerId, targetLee.instanceId, slotIdx);
        } else if (handLees.length > 1) {
          this.ctx.setPendingChoice({
            id: nextChoiceId(this.ctx.state, 'effect'),
            playerId,
            choiceType: 'SELECT_CARDS',
            prompt: '【里·超刻】充能自：请选择我方手牌 1 张费用为3及以下的《里·超刻》出场：',
            options: handLees.map((c) => this.createGeneralCardChoiceOption(c)),
            effectType: 'PR030_CHOOSE_DEPLOY_ROLE',
            sourceCardInstanceId: chargeCardId,
            minSelections: 1,
            maxSelections: 1,
          });
        }
        break;
      }

      case 'PR030_CHOOSE_DEPLOY_ROLE': {
        const pickedId = selectedIds[0];
        const picked = pickedId ? this.ctx.state.cards[pickedId] : undefined;
        const slotIdx = this.ctx.fieldMgr.findFirstEmptySlot(playerId);
        if (!picked || picked.zone !== 'HAND' || slotIdx === undefined) break;
        this.ctx.fieldMgr.playRoleCard(playerId, picked.instanceId, slotIdx);
        break;
      }

      // 10.2.1.b BP04-012 薇拉·灼惘：侵蚀>=6时蓝/黄球充能自改为发动标准红色信号球【充能自】（DP+1 或 PP+2000）
      case 'BP04_012_RED_ORB_SUBSTITUTE': {
        const chargeCardId = choice.sourceCardInstanceId;
        const chargeCard = chargeCardId ? this.ctx.state.cards[chargeCardId] : undefined;
        const chargeDef = chargeCard ? this.getCardDef(chargeCard) : undefined;
        if (!chargeCard || !chargeDef || chargeCard.zone !== 'PROCESSING') break;
        if (selectedIds[0] === 'vera_red') {
          this.ctx.setPendingChoice({
            id: nextChoiceId(this.ctx.state, 'effect'),
            playerId,
            choiceType: 'SELECT_OPTION',
            prompt: '【薇拉·灼惘 / 红色信号球】充能自：请从以下 2 项选择 1 项执行：',
            options: [
              { id: 'opt_dp_plus_1', label: '选择我方战场最多1张角色，直到回合结束 DP+1' },
              { id: 'opt_pp_plus_2000', label: '选择我方战场最多1张角色，直到回合结束 PP+2000' },
            ],
            effectType: 'SIGNATURE_MOVE_EFFECT',
            sourceCardInstanceId: chargeCardId,
            metadata: { cardName: chargeDef.name, cardNumber: chargeDef.cardNumber, signalOrb: 'RED' },
            minSelections: 1,
            maxSelections: 1,
          });
        } else {
          this.resolveStandardOrbChargeAuto(playerId, chargeCardId!, chargeDef);
        }
        break;
      }

      // 10.8 BP04-007 露娜·终焉【瞬时】出场后可选放置手牌 1 张至《露娜·终焉》下方
      case 'BP04_007_HAND_TO_UNDERNEATH': {
        const pickedHandId = selectedIds[0];
        if (!pickedHandId) break;
        const pickedCard = this.ctx.state.cards[pickedHandId];
        if (!pickedCard || pickedCard.zone !== 'HAND') break;
        const lunaHosts = this.getFriendlyRoles(playerId).filter((r) =>
          this.ctx.continuousEffects
            ? this.ctx.continuousEffects.hasCardName(r.instanceId, '露娜·终焉')
            : this.getCardDef(r)?.name === '露娜·终焉'
        );
        if (lunaHosts.length === 1) {
          this.ctx.fieldMgr.placeCardUnderneath(pickedHandId, lunaHosts[0]!.instanceId, { actorPlayerId: playerId });
        } else if (lunaHosts.length > 1) {
          this.ctx.setPendingChoice({
            id: nextChoiceId(this.ctx.state, 'effect'),
            playerId,
            choiceType: 'SELECT_CARDS',
            prompt: '【BP04-007 露娜·终焉】请选择要将手牌放置到其下方的《露娜·终焉》：',
            options: lunaHosts.map((r) => this.createRoleChoiceOption(r)),
            effectType: 'BP04_007_CHOOSE_LUNA_HOST',
            sourceCardInstanceId: pickedHandId,
            minSelections: 1,
            maxSelections: 1,
          });
        }
        break;
      }

      case 'BP04_007_CHOOSE_LUNA_HOST': {
        const hostId = selectedIds[0];
        const pickedHandId = choice.sourceCardInstanceId;
        const host = hostId ? this.ctx.state.cards[hostId] : undefined;
        const picked = pickedHandId ? this.ctx.state.cards[pickedHandId] : undefined;
        if (!host || !picked || picked.zone !== 'HAND' || !this.ctx.fieldMgr.isSlotRole(playerId, host.instanceId)) {
          break;
        }
        this.ctx.fieldMgr.placeCardUnderneath(pickedHandId!, host.instanceId, { actorPlayerId: playerId });
        break;
      }

      // 10.8 BP04-028 渡边·尘铭【瞬时】：选 2 相邻信号球消除后出场
      case 'BP04_028_INSTANT_ELIM': {
        const firstOrbId = selectedIds[0];
        const cardId = choice.sourceCardInstanceId;
        const card = cardId ? this.ctx.state.cards[cardId] : undefined;
        if (!firstOrbId || !card || card.zone !== 'HAND') break;
        const orbs = this.ctx.zoneMgr.getCardsInZone(playerId, 'SIGNAL_ORB');
        const idx = orbs.findIndex((o) => o.instanceId === firstOrbId);
        if (idx < 0 || idx + 1 >= orbs.length) break;
        const orbIds = [orbs[idx]!.instanceId, orbs[idx + 1]!.instanceId];
        const orbColors = orbIds.map(
          (oid) =>
            this.ctx.continuousEffects?.getEffectiveOrbInfo(oid).colors[0] ??
            this.getCardDef(this.ctx.state.cards[oid]!)?.signalOrb ??
            'UNKNOWN'
        );
        for (const oid of orbIds) {
          this.ctx.zoneMgr.moveCard(oid, 'GRAVEYARD', { isFaceUp: true });
        }
        this.ctx.events.push({ type: 'ORBS_ELIMINATED', playerId, orbCardIds: orbIds, cardDrawnCount: 0 });
        this.ctx.triggerMgr?.emit({
          type: 'ORBS_ELIMINATED',
          playerId,
          orbCardIds: orbIds,
          orbColors,
        });
        const slotIdx = this.ctx.fieldMgr.findFirstEmptySlot(playerId);
        if (slotIdx !== undefined) {
          this.ctx.fieldMgr.playRoleCard(playerId, card.instanceId, slotIdx);
        }
        break;
      }

      // 默认兼容旧格式
      default: {
        for (const selectedId of selectedIds) {
          const targetCard = this.ctx.state.cards[selectedId];
          if (targetCard) {
            if (choice.prompt.includes('返回手牌')) {
              this.ctx.zoneMgr.moveCard(targetCard.instanceId, 'HAND', { isFaceUp: true, isReady: true });
            } else if (choice.prompt.includes('装备')) {
              const processingEquip = this.ctx.zoneMgr
                .getCardsInZone(playerId, 'PROCESSING')
                .find((c) => this.getCardDef(c)?.cardType === CardType.EQUIPMENT);
              if (processingEquip) {
                this.ctx.fieldMgr.equipToRole(playerId, processingEquip.instanceId, targetCard.instanceId);
                const equipDef = this.getCardDef(processingEquip);
                if (equipDef) this.handleEquipmentBuff(targetCard.instanceId, equipDef);
              }
            } else if (choice.prompt.includes('PP-2000')) {
              addCardModifier(this.ctx.state, targetCard, {
                pp: -2000,
                untilTurn: this.ctx.state.turnNumber,
                sourceCardInstanceId: choice.sourceCardInstanceId,
                appliedByPlayerId: playerId,
              });
            } else if (choice.prompt.includes('PP+2000') || choice.prompt.includes('PP+1000')) {
              const val = choice.prompt.includes('PP+2000') ? 2000 : 1000;
              addCardModifier(this.ctx.state, targetCard, {
                pp: val,
                untilTurn: this.ctx.state.turnNumber,
                sourceCardInstanceId: choice.sourceCardInstanceId,
                appliedByPlayerId: playerId,
              });
            }
          }
        }
        break;
      }
    }

    return this.finishChoiceResolution(choice, playerId, selectedIds);
  }

  private finishChoiceResolution(
    choice: PendingChoice,
    playerId: string,
    selectedIds: string[]
  ): { success: boolean; error?: string } {
    // 若当前决策衍生出了下一阶段的目标选择决策 (如 SELECT_ROLE_FOR_CHARGE_BUFF)，予以保留
    if (this.ctx.state.currentPendingChoice && this.ctx.state.currentPendingChoice.id !== choice.id) {
      // 保持派生的二级目标选择决策激活状态
    } else {
      // 8.6.2.e.3 使用的战术牌处理完毕后放置到所属玩家的墓地。只处理产生本次决策的战术牌：
      // 正在充能中、等待放置的卡牌 (4.12) 也位于处理区，不能一并送墓
      const combat = this.ctx.state.currentCombat;
      const source = choice.sourceCardInstanceId ? this.ctx.state.cards[choice.sourceCardInstanceId] : undefined;
      if (
        source &&
        source.zone === 'PROCESSING' &&
        source.instanceId !== combat?.pendingChargeCardId &&
        source.instanceId !== combat?.pendingDamageCardId &&
        !this.ctx.state.pendingChargeQueue?.some((t) => t.pendingCardId === source.instanceId) &&
        this.getCardDef(source)?.cardType === CardType.TACTICS
      ) {
        this.ctx.zoneMgr.moveCard(source.instanceId, 'GRAVEYARD', { isFaceUp: true });
      }

      this.ctx.setPendingChoice(undefined);
    }

    this.ctx.events.push({
      type: 'CHOICE_RESOLVED',
      playerId,
      pendingChoiceId: choice.id,
      selectedIds,
    });

    return { success: true };
  }

  // =========================================================================
  // 6. 充能自能力自动判定与决策窗口 (含信号球牌及 10.2.1.b 带条件/代价的【充能自】)
  // =========================================================================
  handleChargeAutoEffect(
    playerId: string,
    cardInstanceId: string,
    cardDef: CardVersionData,
    chargeKind: 'ATTACK' | 'DAMAGE' = 'ATTACK',
    attackerCardId?: string
  ): boolean {
    const rules = cardDef.rulesText || '';
    const index = rules.indexOf('【充能自】');
    if (index < 0) return false;
    const cardNum = cardDef.cardNumber;
    const player = this.ctx.state.players[playerId];

    // A. 带条件或代价的非信号球牌【充能自】(10.2.1.b)
    if (cardNum === 'BP04-020') {
      if (chargeKind !== 'DAMAGE') return false;
      const veras = this.getFriendlyRoles(playerId).filter((r) =>
        this.ctx.continuousEffects ? this.ctx.continuousEffects.hasCardName(r.instanceId, '薇拉·灼惘') : this.getCardDef(r)?.name === '薇拉·灼惘'
      );
      if (veras.length === 0) return false;
      this.ctx.setPendingChoice({
        id: nextChoiceId(this.ctx.state, 'effect'),
        playerId,
        choiceType: 'SELECT_CARDS',
        prompt: `【${cardDef.name}】充能自：选择我方战场1张《薇拉·灼惘》，直到回合结束 PP+2000：`,
        options: veras.map((r) => this.createRoleChoiceOption(r)),
        effectType: 'SELECT_ROLE_FOR_CHARGE_BUFF',
        sourceCardInstanceId: cardInstanceId,
        metadata: { buffType: 'PP', buffAmount: 2000, cardName: cardDef.name, cardNumber: cardNum },
        minSelections: 1,
        maxSelections: 1,
      });
      return true;
    }

    if (cardNum === 'BP04-021') {
      if (chargeKind !== 'DAMAGE') return false;
      const openCostRolesAllFire = this.ctx.zoneMgr
        .getCardsInZone(playerId, 'COST')
        .filter((c) => c.isFaceUp)
        .every((c) => {
          const d = this.getCardDef(c);
          return !d || d.cardType !== CardType.ROLE || d.attribute === 'FIRE';
        });
      if (!openCostRolesAllFire) return false;
      this.ctx.zoneMgr.drawCards(playerId, 1);
      this.ctx.events.push({
        type: 'ABILITY_ACTIVATED',
        playerId,
        cardInstanceId,
        abilityName: `${cardDef.name}【充能自】`,
        rulesText: '伤害充能且费用区所有明费角色为火属性：抽1张牌',
      });
      return true;
    }

    if (cardNum === 'BP03-023') {
      if (chargeKind !== 'ATTACK' || !attackerCardId) return false;
      const attacker = this.ctx.state.cards[attackerCardId];
      if (!attacker || this.getCardDef(attacker)?.name !== '里·超刻') return false;
      const availCost = (player?.availableOpenCostCount ?? 0) + (player?.hiddenCostCount ?? 0);
      if (availCost < 3) return false;
      const eligibleTargets = this.getFriendlyRoles(playerId).filter((r) => {
        const d = this.getCardDef(r);
        return d && d.name === '里·超刻' && d.cost < 9;
      });
      if (eligibleTargets.length === 0) return false;
      this.ctx.setPendingChoice({
        id: nextChoiceId(this.ctx.state, 'effect'),
        playerId,
        choiceType: 'YES_NO',
        prompt: `【${cardDef.name}】充能自：是否支付 3 费将该牌无视费用上限升变出场并获得【速攻】？`,
        options: [
          { id: 'opt_yes', label: '支付 3 费升变出场' },
          { id: 'opt_no', label: '不发动' },
        ],
        effectType: 'BP03_023_CHARGE_ASCEND',
        sourceCardInstanceId: cardInstanceId,
        metadata: { attackerCardId, cardNumber: cardNum },
        minSelections: 1,
        maxSelections: 1,
      });
      return true;
    }

    if (cardNum === 'BP03-024') {
      if (!player || (player.turnAbilityUsage['BP03-024:CHARGE_AUTO'] ?? 0) > 0) return false;
      const fieldRoles = this.getFriendlyRoles(playerId);
      if (fieldRoles.length === 0 || !fieldRoles.every((r) => this.getCardDef(r)?.name === '里·超刻')) return false;
      if (this.ctx.fieldMgr.findFirstEmptySlot(playerId) === undefined) return false;
      const handLees = this.ctx.zoneMgr
        .getCardsInZone(playerId, 'HAND')
        .filter((c) => this.getCardDef(c)?.name === '里·超刻');
      if (handLees.length < 3) return false;
      this.ctx.setPendingChoice({
        id: nextChoiceId(this.ctx.state, 'effect'),
        playerId,
        choiceType: 'SELECT_CARDS',
        prompt: `【${cardDef.name}】充能自：可丢弃手牌 3 张《里·超刻》将该牌从处理区出场 (不选则放弃)：`,
        options: handLees.map((c) => this.createGeneralCardChoiceOption(c)),
        effectType: 'BP03_024_CHARGE_DEPLOY',
        sourceCardInstanceId: cardInstanceId,
        metadata: { cardNumber: cardNum },
        minSelections: 0,
        maxSelections: 3,
      });
      return true;
    }

    if (cardNum === 'BP03-028') {
      if (chargeKind !== 'ATTACK' || !attackerCardId) return false;
      const attacker = this.ctx.state.cards[attackerCardId];
      if (!attacker || this.getCardDef(attacker)?.name !== '里·超刻') return false;
      const yellowOrbs = this.ctx.zoneMgr.getCardsInZone(playerId, 'SIGNAL_ORB').filter((c) => {
        if (!this.ctx.continuousEffects) return c.isFaceUp && this.getCardDef(c)?.signalOrb === 'YELLOW';
        const info = this.ctx.continuousEffects.getEffectiveOrbInfo(c.instanceId);
        return info.isOrb && !info.cannotEliminate && info.colors.includes('YELLOW');
      });
      if (yellowOrbs.length === 0) return false;
      this.ctx.setPendingChoice({
        id: nextChoiceId(this.ctx.state, 'effect'),
        playerId,
        choiceType: 'SELECT_CARDS',
        prompt: `【${cardDef.name}】充能自：可将其置入墓地并消除 1 张【黄色信号球】，使《里·超刻》获得【速攻】：`,
        options: yellowOrbs.map((c) => this.createGeneralCardChoiceOption(c)),
        effectType: 'BP03_028_CHARGE_AUTO',
        sourceCardInstanceId: cardInstanceId,
        metadata: { attackerCardId, cardNumber: cardNum },
        minSelections: 0,
        maxSelections: 1,
      });
      return true;
    }

    if (cardNum === 'BP03-032') {
      const fieldRoles = this.getFriendlyRoles(playerId);
      if (fieldRoles.length === 0 || !fieldRoles.every((r) => this.getCardDef(r)?.name === '里·超刻')) return false;
      const availCost = (player?.availableOpenCostCount ?? 0) + (player?.hiddenCostCount ?? 0);
      if (availCost < 3) return false;
      const oppRoles = this.getOpponentRoles(playerId);
      if (oppRoles.length === 0) return false;
      this.ctx.setPendingChoice({
        id: nextChoiceId(this.ctx.state, 'effect'),
        playerId,
        choiceType: 'SELECT_CARDS',
        prompt: `【${cardDef.name}】充能自：可将其置入墓地并支付 3 费，选择对方战场 1 张角色放置到牌组底：`,
        options: oppRoles.map((r) => this.createRoleChoiceOption(r)),
        effectType: 'BP03_032_CHARGE_BOUNCE_BOTTOM',
        sourceCardInstanceId: cardInstanceId,
        metadata: { cardNumber: cardNum },
        minSelections: 0,
        maxSelections: 1,
      });
      return true;
    }

    if (cardNum === 'PR-030') {
      if (chargeKind !== 'ATTACK' || !attackerCardId) return false;
      const attacker = this.ctx.state.cards[attackerCardId];
      const attackerIsLee =
        Boolean(attacker) &&
        (this.ctx.continuousEffects
          ? this.ctx.continuousEffects.hasCardName(attackerCardId, '里·超刻')
          : this.getCardDef(attacker!)?.name === '里·超刻');
      if (!attackerIsLee) return false;
      if (this.ctx.fieldMgr.findFirstEmptySlot(playerId) === undefined) return false;
      const blueOrbs = this.ctx.zoneMgr.getCardsInZone(playerId, 'SIGNAL_ORB').filter((c) => {
        if (!this.ctx.continuousEffects) return c.isFaceUp && this.getCardDef(c)?.signalOrb === 'BLUE';
        const info = this.ctx.continuousEffects.getEffectiveOrbInfo(c.instanceId);
        return info.isOrb && !info.cannotEliminate && info.colors.includes('BLUE');
      });
      const handLees = this.ctx.zoneMgr.getCardsInZone(playerId, 'HAND').filter((c) => {
        const d = this.getCardDef(c);
        return (
          d &&
          d.cardType === CardType.ROLE &&
          (this.ctx.continuousEffects?.hasCardName(c.instanceId, '里·超刻') || d.name === '里·超刻') &&
          d.cost <= 3
        );
      });
      if (blueOrbs.length === 0 || handLees.length === 0) return false;
      this.ctx.setPendingChoice({
        id: nextChoiceId(this.ctx.state, 'effect'),
        playerId,
        choiceType: 'SELECT_CARDS',
        prompt: `【${cardDef.name}】充能自：可将其置入墓地并消除 1 张【蓝色信号球】，使手牌 1 张费用<=3的《里·超刻》出场：`,
        options: blueOrbs.map((c) => this.createGeneralCardChoiceOption(c)),
        effectType: 'PR030_CHARGE_AUTO_ORB',
        sourceCardInstanceId: cardInstanceId,
        metadata: { attackerCardId, cardNumber: cardNum },
        minSelections: 0,
        maxSelections: 1,
      });
      return true;
    }

    // BP04-012 薇拉·灼惘：侵蚀>=6且在场未失能时，蓝/黄信号球可改为发动红色信号球【充能自】
    if (
      player &&
      player.erosionCount >= 6 &&
      (cardDef.signalOrb === 'BLUE' || cardDef.signalOrb === 'YELLOW') &&
      this.getFriendlyRoles(playerId).some(
        (r) =>
          r.cardNumber === 'BP04-012' &&
          !this.ctx.continuousEffects?.hasLostInherentAbilities(r.instanceId)
      )
    ) {
      const segCheck = rules.slice(index).split(/\n(?=【)/)[0]!;
      if (/^【充能自】[:：]\s*从以下2项选择1项/.test(segCheck)) {
        this.ctx.setPendingChoice({
          id: nextChoiceId(this.ctx.state, 'effect'),
          playerId,
          choiceType: 'SELECT_OPTION',
          prompt: `【BP04-012 薇拉·灼惘】侵蚀>=6：是否将【${cardDef.name}】视作【红色信号球】处理其【充能自】？`,
          options: [
            { id: 'vera_red', label: '改为发动红色信号球【充能自】' },
            { id: 'normal_orb', label: `保持原【${cardDef.name}】充能自` },
          ],
          effectType: 'BP04_012_RED_ORB_SUBSTITUTE',
          sourceCardInstanceId: cardInstanceId,
          metadata: { cardNumber: cardNum },
          minSelections: 1,
          maxSelections: 1,
        });
        return true;
      }
    }

    // B. 信号球牌的标准【充能自】：只解析【充能自】能力本身的文本
    return this.resolveStandardOrbChargeAuto(playerId, cardInstanceId, cardDef);
  }

  private resolveStandardOrbChargeAuto(
    playerId: string,
    cardInstanceId: string,
    cardDef: CardVersionData
  ): boolean {
    const rules = cardDef.rulesText || '';
    const index = rules.indexOf('【充能自】');
    if (index < 0) return false;
    const segment = rules.slice(index).split(/\n(?=【)/)[0]!;
    if (!/^【充能自】[:：]\s*从以下2项选择1项/.test(segment)) return false;

    const options: { id: string; label: string }[] = [];
    if (segment.includes('DP+1')) {
      options.push({ id: 'opt_dp_plus_1', label: '选择我方战场最多1张角色，直到回合结束 DP+1' });
    }
    if (segment.includes('抽1张牌')) {
      options.push({ id: 'opt_draw_1', label: '抽 1 张牌' });
    }
    if (segment.includes('侵蚀计数-1')) {
      options.push({ id: 'opt_erosion_minus_1', label: '若我方侵蚀计数不小于对方，我方侵蚀计数 -1' });
    }
    if (segment.includes('PP+2000')) {
      options.push({ id: 'opt_pp_plus_2000', label: '选择我方战场最多1张角色，直到回合结束 PP+2000' });
    }

    if (options.length === 0) return false;

    this.ctx.setPendingChoice({
      id: nextChoiceId(this.ctx.state, 'effect'),
      playerId,
      choiceType: 'SELECT_OPTION',
      prompt: `【${cardDef.name}】充能自效果触发！请从以下选项中选择 1 项执行：`,
      options,
      effectType: 'SIGNATURE_MOVE_EFFECT',
      sourceCardInstanceId: cardInstanceId,
      metadata: { cardNumber: cardDef.cardNumber },
      minSelections: 1,
      maxSelections: 1,
    });
    return true;
  }

  // =========================================================================
  // 7. 通用角色【出】能力解析与自动执行引擎 (仅供自定义测试卡兜底)
  // =========================================================================
  resolveUniversalEntryEffect(
    playerId: string,
    roleInstanceId: string,
    cardDef: CardVersionData
  ): void {
    const rules = cardDef.rulesText || '';
    if (!rules.includes('【出】')) return;

    const roleCard = this.ctx.state.cards[roleInstanceId];
    if (!roleCard) return;

    // 1. 抽牌
    const drawMatch = rules.match(/【出】.*?抽(\d+)张牌/);
    if (drawMatch && drawMatch[1]) {
      this.ctx.zoneMgr.drawCards(playerId, parseInt(drawMatch[1], 10));
    }

    // 2. 自身PP增益
    const selfPPMatch = rules.match(/【出】.*?(?:该牌|自身).*?PP\+(\d+)/);
    if (selfPPMatch && selfPPMatch[1]) {
      addCardModifier(this.ctx.state, roleCard, {
        pp: parseInt(selfPPMatch[1], 10),
        untilTurn: this.ctx.state.turnNumber,
        source: roleCard.cardNumber,
        sourceCardInstanceId: roleCard.instanceId,
        appliedByPlayerId: playerId,
      });
    }

    // 3. 全队PP增益
    const allPPMatch = rules.match(/【出】.*?所有角色PP\+(\d+)/);
    if (allPPMatch && allPPMatch[1]) {
      const bonus = parseInt(allPPMatch[1], 10);
      for (const r of this.getFriendlyRoles(playerId)) {
        addCardModifier(this.ctx.state, r, {
          pp: bonus,
          untilTurn: this.ctx.state.turnNumber,
          source: roleCard.cardNumber,
          sourceCardInstanceId: roleCard.instanceId,
          appliedByPlayerId: playerId,
        });
      }
    }

    // 4. 破坏对方角色
    if (rules.includes('【出】') && rules.includes('破坏') && rules.includes('对方战场')) {
      const oppRoles = this.getOpponentRoles(playerId);
      const ppLimitMatch = rules.match(/PP为(\d+)及以下/);
      const maxPP = ppLimitMatch && ppLimitMatch[1] ? parseInt(ppLimitMatch[1], 10) : undefined;
      const eligible = maxPP !== undefined
        ? oppRoles.filter((c) => this.ctx.fieldMgr.calculateRoleEffectivePP(c.instanceId) <= maxPP)
        : oppRoles;
      if (eligible.length > 0) {
        this.ctx.setPendingChoice({
          id: nextChoiceId(this.ctx.state, 'effect'),
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】出场：请选择对方战场1张角色破坏：`,
          options: oppRoles.map((c) => {
            const pp = this.ctx.fieldMgr.calculateRoleEffectivePP(c.instanceId);
            const isEligible = maxPP === undefined || pp <= maxPP;
            return this.createRoleChoiceOption(c, {
              eligible: isEligible,
              ineligibleReason: !isEligible ? `PP(${pp})超过${maxPP}限制` : undefined,
            });
          }),
          effectType: 'DESTROY_ROLE',
          sourceCardInstanceId: roleInstanceId,
          minSelections: 1,
          maxSelections: 1,
        });
      }
    }

    // 5. 削减对方PP
    const reduceMatch = rules.match(/【出】.*?选择对方战场1张角色.*?PP-(\d+)/);
    if (reduceMatch && reduceMatch[1]) {
      const oppRoles = this.getOpponentRoles(playerId);
      if (oppRoles.length > 0) {
        const reduction = parseInt(reduceMatch[1], 10);
        this.ctx.setPendingChoice({
          id: nextChoiceId(this.ctx.state, 'effect'),
          playerId,
          choiceType: 'SELECT_CARDS',
          prompt: `【${cardDef.name}】出场：请选择对方战场1张角色削减PP (-${reduction})：`,
          options: oppRoles.map((c) => this.createRoleChoiceOption(c)),
          effectType: 'DEAL_DAMAGE_TO_ROLE',
          sourceCardInstanceId: roleInstanceId,
          metadata: { damage: reduction },
          minSelections: 1,
          maxSelections: 1,
        });
      }
    }

    // 6. 信号球回收
    if (rules.includes('【出】') && rules.includes('信号球区最上方')) {
      const gyOrb = this.ctx.zoneMgr.getCardsInZone(playerId, 'GRAVEYARD').find((c) => {
        const d = this.getCardDef(c);
        return !!d?.signalOrb || c.cardNumber.startsWith('ORB-') || d?.name?.includes('信号球');
      });
      if (gyOrb) {
        this.ctx.zoneMgr.moveCard(gyOrb.instanceId, 'SIGNAL_ORB', { isFaceUp: true });
      }
    }

    this.ctx.events.push({
      type: 'ABILITY_ACTIVATED',
      playerId,
      cardInstanceId: roleInstanceId,
      abilityName: `${cardDef.name}【出】能力`,
      rulesText: cardDef.rulesText,
    });
  }

  // =========================================================================
  // 9. 通用起动能力【起】解析执行引擎
  // =========================================================================
  resolveUniversalActivatedEffect(
    playerId: string,
    sourceCardId: string,
    cardDef: CardVersionData
  ): { success: boolean; error?: string } {
    const card = this.ctx.state.cards[sourceCardId];
    if (!card) return { success: false, error: '未找到来源卡牌' };
    const rules = cardDef.rulesText || '';

    // 1. 判定并扣除费用代价
    const costMatch = rules.match(/【起】.*?(?:【(\d+)费】|\[费用(\d+)\])/);
    if (costMatch) {
      const rawCost = costMatch[1] || costMatch[2];
      if (rawCost) {
        const cost = parseInt(rawCost, 10);
        if (cost > 0 && !this.ctx.payCost(playerId, cost)) {
          return { success: false, error: `费用不足，需要支付 ${cost} 费用` };
        }
      }
    }

    // 2. 判定并横置自身
    if (rules.includes('【起】横置该牌') || rules.includes('【起】: 横置该牌') || rules.includes('【起】：横置该牌')) {
      if (!card.isReady) {
        return { success: false, error: '该角色已经处于横置状态，无法再次发动' };
      }
      card.isReady = false;
    }

    // 3. 效果伤害
    const dmgMatch = rules.match(/造成(\d+)点效果伤害/);
    if (dmgMatch && dmgMatch[1]) {
      const oppRoles = this.getOpponentRoles(playerId);
      if (oppRoles.length === 0) {
        return { success: false, error: '对方战场没有可指定的目标角色' };
      }
      const dmg = parseInt(dmgMatch[1], 10);
      this.ctx.setPendingChoice({
        id: nextChoiceId(this.ctx.state, 'effect'),
        playerId,
        choiceType: 'SELECT_CARDS',
        prompt: `【${cardDef.name}】起动能力：请选择对方战场1张角色造成 ${dmg} 点效果伤害：`,
        options: oppRoles.map((c) => this.createRoleChoiceOption(c)),
        effectType: 'DEAL_DAMAGE_TO_ROLE',
        sourceCardInstanceId: sourceCardId,
        metadata: { damage: dmg },
        minSelections: 1,
        maxSelections: 1,
      });
      return { success: true };
    }

    // 4. 浮空处理 (10.18)
    if (rules.includes('将该牌【浮空】') || rules.includes('将手牌的该牌【浮空】')) {
      const airborned = this.ctx.fieldMgr.airborneRole(sourceCardId);
      if (!airborned) {
        return { success: false, error: '当前处理区已存在浮空模式卡牌或角色不在战场，无法【浮空】 (10.18.2.a)' };
      }
      this.ctx.events.push({
        type: 'ABILITY_ACTIVATED',
        playerId,
        cardInstanceId: sourceCardId,
        abilityName: `${cardDef.name} 进入浮空模式`,
        rulesText: '卡牌进入处理区变为浮空模式',
      });
      return { success: true };
    }

    // 5. 抽牌
    const drawMatch = rules.match(/【起】.*?抽(\d+)张牌/);
    if (drawMatch && drawMatch[1]) {
      this.ctx.zoneMgr.drawCards(playerId, parseInt(drawMatch[1], 10));
    }

    this.ctx.events.push({
      type: 'ABILITY_ACTIVATED',
      playerId,
      cardInstanceId: sourceCardId,
      abilityName: `${cardDef.name} 起动能力发动`,
      rulesText: cardDef.rulesText,
    });
    return { success: true };
  }

  // =========================================================================
  // 8. 10.8 角色牌与装备牌上的【瞬时】能力检查与执行
  // =========================================================================

  private findHostUnderneathCard(playerId: string, cardInstanceId: string, requiredHostName: string): CardInstance | undefined {
    return this.getFriendlyRoles(playerId).find((role) => {
      if (!role.underneathCardIds.includes(cardInstanceId)) return false;
      return this.ctx.continuousEffects
        ? this.ctx.continuousEffects.hasCardName(role.instanceId, requiredHostName)
        : this.getCardDef(role)?.name === requiredHostName;
    });
  }

  private findEliminatableAdjacentOrbPairStarts(playerId: string): string[] {
    const orbs = this.ctx.zoneMgr.getCardsInZone(playerId, 'SIGNAL_ORB');
    const starts: string[] = [];
    for (let i = 0; i + 1 < orbs.length; i++) {
      const c1 = orbs[i]!;
      const c2 = orbs[i + 1]!;
      const ok1 = this.ctx.continuousEffects
        ? (() => {
            const info = this.ctx.continuousEffects.getEffectiveOrbInfo(c1.instanceId);
            return info.isOrb && !info.cannotEliminate;
          })()
        : c1.isFaceUp && Boolean(this.getCardDef(c1)?.signalOrb);
      const ok2 = this.ctx.continuousEffects
        ? (() => {
            const info = this.ctx.continuousEffects.getEffectiveOrbInfo(c2.instanceId);
            return info.isOrb && !info.cannotEliminate;
          })()
        : c2.isFaceUp && Boolean(this.getCardDef(c2)?.signalOrb);
      if (ok1 && ok2) starts.push(c1.instanceId);
    }
    return starts;
  }

  canUseNonTacticsInstant(
    playerId: string,
    card: CardInstance,
    cardDef: CardVersionData
  ): { usable: boolean; error?: string; costToPay: number } {
    const window = this.ctx.state.timingWindow;
    if (!window) {
      return { usable: false, error: '当前不在使用【瞬时】的时机 (10.8)', costToPay: 0 };
    }
    if (window.priorityPlayerId !== playerId) {
      return { usable: false, error: '当前不持有【瞬时】使用优先权，须等待对方先选择 (7.3.1.b / 10.8)', costToPay: 0 };
    }
    const player = this.ctx.state.players[playerId];
    if (!player) {
      return { usable: false, error: '玩家不存在', costToPay: 0 };
    }
    const availCost = player.availableOpenCostCount + player.hiddenCostCount;

    switch (cardDef.cardNumber) {
      case 'BP03-054': {
        if (card.zone !== 'COST' || !card.isFaceUp || card.controllerPlayerId !== playerId) {
          return { usable: false, error: '《艾拉·万华》须存在于我方明费中才能发动', costToPay: 0 };
        }
        if (window.kind !== 'FREE_TIMING') {
          return { usable: false, error: '《艾拉·万华》【瞬时】只能在角色攻击的自由时点发动', costToPay: 0 };
        }
        const hasIris = this.getFriendlyRoles(playerId).some((r) =>
          this.ctx.continuousEffects
            ? this.ctx.continuousEffects.hasTrait(r.instanceId, '艺术协会')
            : Boolean(this.getCardDef(r)?.traits.includes('艺术协会'))
        );
        if (!hasIris) {
          return { usable: false, error: '我方战场没有<艺术协会>角色', costToPay: 0 };
        }
        return { usable: true, costToPay: 0 };
      }

      case 'BP04-004': {
        const host = this.findHostUnderneathCard(playerId, card.instanceId, '露娜·终焉');
        if (!host) {
          return { usable: false, error: '该牌须存在于我方《露娜·终焉》下方才能发动', costToPay: 0 };
        }
        if (this.ctx.fieldMgr.findFirstEmptySlot(playerId) === undefined) {
          return { usable: false, error: '战场没有空余卡位', costToPay: 0 };
        }
        const isOppFreeTiming = window.kind === 'FREE_TIMING' && this.ctx.state.activePlayerId !== playerId;
        const cost = isOppFreeTiming ? 3 : 4;
        if (availCost < cost) {
          return { usable: false, error: `费用不足，需要 ${cost} 费`, costToPay: cost };
        }
        return { usable: true, costToPay: cost };
      }

      case 'BP04-007': {
        const host = this.findHostUnderneathCard(playerId, card.instanceId, '露娜·终焉');
        if (!host) {
          return { usable: false, error: '该牌须存在于我方《露娜·终焉》下方才能发动', costToPay: 0 };
        }
        if (this.ctx.fieldMgr.findFirstEmptySlot(playerId) === undefined) {
          return { usable: false, error: '战场没有空余卡位', costToPay: 0 };
        }
        if (availCost < 2) {
          return { usable: false, error: '费用不足，需要 2 费', costToPay: 2 };
        }
        return { usable: true, costToPay: 2 };
      }

      case 'BP04-028': {
        if (card.zone !== 'HAND' || card.controllerPlayerId !== playerId) {
          return { usable: false, error: '《渡边·尘铭》须在手牌才能发动', costToPay: 0 };
        }
        if ((player.turnAbilityUsage['BP04-028:INSTANT'] ?? 0) > 0) {
          return { usable: false, error: '《渡边·尘铭》的该能力本回合已发动过 (【回合1】)', costToPay: 0 };
        }
        if ((player.destroyedFireRoleCountThisTurn ?? 0) < 3) {
          return { usable: false, error: '本回合中被破坏的火属性角色未达到 3 张', costToPay: 0 };
        }
        if (this.ctx.fieldMgr.findFirstEmptySlot(playerId) === undefined) {
          return { usable: false, error: '战场没有空余卡位', costToPay: 0 };
        }
        if (this.findEliminatableAdjacentOrbPairStarts(playerId).length === 0) {
          return { usable: false, error: '信号球区没有 2 个相邻的可消除信号球', costToPay: 0 };
        }
        return { usable: true, costToPay: 0 };
      }

      default:
        return { usable: false, error: `卡牌【${cardDef.name}】没有可从当前区域使用的【瞬时】能力`, costToPay: 0 };
    }
  }

  handleUseNonTacticsInstant(
    playerId: string,
    card: CardInstance,
    cardDef: CardVersionData,
    costCardInstanceIds?: string[]
  ): { success: boolean; error?: string } {
    const check = this.canUseNonTacticsInstant(playerId, card, cardDef);
    if (!check.usable) {
      return { success: false, error: check.error ?? '当前无法使用该【瞬时】能力' };
    }

    if (check.costToPay > 0) {
      if (!this.ctx.payCost(playerId, check.costToPay, costCardInstanceIds)) {
        return { success: false, error: `费用不足或所选支付卡牌无效，需要 ${check.costToPay} 费` };
      }
    }

    switch (cardDef.cardNumber) {
      case 'BP03-054': {
        this.ctx.zoneMgr.moveCardToBottomOfDeck(card.instanceId);
        const irisRoles = this.getFriendlyRoles(playerId).filter((r) =>
          this.ctx.continuousEffects
            ? this.ctx.continuousEffects.hasTrait(r.instanceId, '艺术协会')
            : Boolean(this.getCardDef(r)?.traits.includes('艺术协会'))
        );
        if (irisRoles.length === 1) {
          addCardModifier(this.ctx.state, irisRoles[0]!, {
            id: `combat-bp03-054-${this.ctx.events.length}`,
            pp: 1000,
            untilTurn: this.ctx.state.turnNumber,
            source: 'BP03-054',
            sourceCardInstanceId: card.instanceId,
            appliedByPlayerId: playerId,
          });
        } else if (irisRoles.length > 1) {
          this.ctx.setPendingChoice({
            id: nextChoiceId(this.ctx.state, 'effect'),
            playerId,
            choiceType: 'SELECT_CARDS',
            prompt: '【艾拉·万华】瞬时：选择我方战场1张<艺术协会>角色，直到那次攻击结束 PP+1000：',
            options: irisRoles.map((r) => this.createRoleChoiceOption(r)),
            effectType: 'BP03_054_BUFF_ROLE',
            sourceCardInstanceId: card.instanceId,
            minSelections: 1,
            maxSelections: 1,
          });
        }
        break;
      }

      case 'BP04-004':
      case 'BP04-007': {
        const host = this.findHostUnderneathCard(playerId, card.instanceId, '露娜·终焉');
        const slotIdx = this.ctx.fieldMgr.findFirstEmptySlot(playerId);
        if (!host || slotIdx === undefined) {
          return { success: false, error: '无法从下方出场' };
        }
        if (!this.ctx.zoneMgr.moveCard(card.instanceId, 'PROCESSING', { isFaceUp: true, skipLeftFieldTrigger: true })) {
          return { success: false, error: '无法从下方出场' };
        }
        if (!this.ctx.fieldMgr.playRoleCard(playerId, card.instanceId, slotIdx, { deployedFromHostCardId: host.instanceId })) {
          return { success: false, error: '出场失败' };
        }
        if (cardDef.cardNumber === 'BP04-007') {
          const handCards = this.ctx.zoneMgr.getCardsInZone(playerId, 'HAND');
          const lunaHosts = this.getFriendlyRoles(playerId).filter((r) =>
            this.ctx.continuousEffects
              ? this.ctx.continuousEffects.hasCardName(r.instanceId, '露娜·终焉')
              : this.getCardDef(r)?.name === '露娜·终焉'
          );
          if (handCards.length > 0 && lunaHosts.length > 0) {
            this.ctx.setPendingChoice({
              id: nextChoiceId(this.ctx.state, 'effect'),
              playerId,
              choiceType: 'SELECT_CARDS',
              prompt: '【BP04-007 露娜·终焉】可以将我方 1 张手牌放置到我方战场 1 张《露娜·终焉》下方：',
              options: handCards.map((c) => this.createGeneralCardChoiceOption(c)),
              effectType: 'BP04_007_HAND_TO_UNDERNEATH',
              sourceCardInstanceId: card.instanceId,
              minSelections: 0,
              maxSelections: 1,
            });
          }
        }
        break;
      }

      case 'BP04-028': {
        const player = this.ctx.state.players[playerId]!;
        player.turnAbilityUsage['BP04-028:INSTANT'] = (player.turnAbilityUsage['BP04-028:INSTANT'] ?? 0) + 1;
        const orbs = this.ctx.zoneMgr.getCardsInZone(playerId, 'SIGNAL_ORB');
        const pairStarts = this.findEliminatableAdjacentOrbPairStarts(playerId);
        if (pairStarts.length === 1) {
          const idx = orbs.findIndex((o) => o.instanceId === pairStarts[0]!);
          const orbIds = [orbs[idx]!.instanceId, orbs[idx + 1]!.instanceId];
          const orbColors = orbIds.map(
            (oid) =>
              this.ctx.continuousEffects?.getEffectiveOrbInfo(oid).colors[0] ??
              this.getCardDef(this.ctx.state.cards[oid]!)?.signalOrb ??
              'UNKNOWN'
          );
          for (const oid of orbIds) {
            this.ctx.zoneMgr.moveCard(oid, 'GRAVEYARD', { isFaceUp: true });
          }
          this.ctx.events.push({ type: 'ORBS_ELIMINATED', playerId, orbCardIds: orbIds, cardDrawnCount: 0 });
          this.ctx.triggerMgr?.emit({
            type: 'ORBS_ELIMINATED',
            playerId,
            orbCardIds: orbIds,
            orbColors,
          });
          const slotIdx = this.ctx.fieldMgr.findFirstEmptySlot(playerId);
          if (slotIdx !== undefined) {
            this.ctx.fieldMgr.playRoleCard(playerId, card.instanceId, slotIdx);
          }
        } else if (pairStarts.length > 1) {
          this.ctx.setPendingChoice({
            id: nextChoiceId(this.ctx.state, 'effect'),
            playerId,
            choiceType: 'SELECT_OPTION',
            prompt: '【渡边·尘铭】瞬时：请选择要消除的 2 个相邻信号球：',
            options: pairStarts.map((startId) => {
              const i = orbs.findIndex((o) => o.instanceId === startId);
              const n1 = this.getCardDef(orbs[i]!)?.name ?? orbs[i]!.cardNumber;
              const n2 = this.getCardDef(orbs[i + 1]!)?.name ?? orbs[i + 1]!.cardNumber;
              return { id: startId, label: `消除 [${n1}] + [${n2}]` };
            }),
            effectType: 'BP04_028_INSTANT_ELIM',
            sourceCardInstanceId: card.instanceId,
            minSelections: 1,
            maxSelections: 1,
          });
        }
        break;
      }

      default:
        return { success: false, error: '未实现的非战术【瞬时】能力' };
    }

    this.ctx.events.push({
      type: 'ABILITY_ACTIVATED',
      playerId,
      cardInstanceId: card.instanceId,
      abilityName: `${cardDef.name}【瞬时】`,
      rulesText: cardDef.rulesText,
    });
    return { success: true };
  }
}
