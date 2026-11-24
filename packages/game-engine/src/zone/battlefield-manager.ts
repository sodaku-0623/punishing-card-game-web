import {
  CardInstance,
  CardType,
  CardVersionData,
  GameState,
  GameEvent,
  BattlefieldSlot,
} from '@zhanshuang/shared';
import { ICardDatabase } from '../database/card-registry.js';
import { ZoneManager } from './zone-manager.js';
import {
  ContinuousEffectEngine,
  addCardModifier,
  EvaluatedCardStats,
} from '../effects/continuous-effects.js';
import type { TriggerEvent } from '../priority/trigger-system.js';

/** 获取角色当前附着的全部装备牌实例 ID (兼容单装备 attachedEquipmentId 与双持 extraAttachedEquipmentIds) */
export function getAttachedEquipmentIds(card: CardInstance | undefined): string[] {
  if (!card) return [];
  const ids: string[] = [];
  if (card.attachedEquipmentId) ids.push(card.attachedEquipmentId);
  if (card.extraAttachedEquipmentIds?.length) {
    for (const id of card.extraAttachedEquipmentIds) {
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** 写回角色的附着装备牌实例 ID 列表 (首张写入 attachedEquipmentId，其余写入 extraAttachedEquipmentIds) */
export function setAttachedEquipmentIds(card: CardInstance, ids: string[]): void {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  card.attachedEquipmentId = unique[0];
  card.extraAttachedEquipmentIds = unique.length > 1 ? unique.slice(1) : undefined;
}

/** 判断卡牌定义是否为<封刃太刀>装备 (官方数据中特征写作 小太刀/大太刀/太刀 或 封刃太刀) */
export function isFengrenTachiEquipmentDef(def: CardVersionData | undefined): boolean {
  if (!def || def.cardType !== CardType.EQUIPMENT) return false;
  const traits = def.traits ?? [];
  return traits.some((t) => t === '封刃太刀' || t === '太刀' || t === '小太刀' || t === '大太刀');
}

export class BattlefieldManager {
  /** 永久能力带来的 PP 增减 (8.9.1.c)，保留扩展钩子以兼容旧调用 */
  private staticPPProvider?: (cardInstanceId: string) => number;
  private continuousEffects?: ContinuousEffectEngine;
  private onTriggerEventCallback?: (event: TriggerEvent) => void;
  private snapshotProvider?: (cardInstanceId: string) => TriggerEvent['subjectSnapshot'];

  setStaticPPProvider(provider: (cardInstanceId: string) => number): void {
    this.staticPPProvider = provider;
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

  constructor(
    private state: GameState,
    private zoneMgr: ZoneManager,
    private cardDb: ICardDatabase,
    private events: GameEvent[]
  ) {}

  /**
   * 获取玩家战场的全部5个卡位
   */
  getSlots(playerId: string): BattlefieldSlot[] {
    return this.state.battlefields[playerId] ?? [];
  }

  /**
   * 是否为该玩家战场卡位上的角色 (不含升变垫在下方的牌、装备中的装备牌及变为辅助机的角色；兼容 PR-041 卡牌类型变为角色牌的辅助机)
   */
  isSlotRole(playerId: string, cardInstanceId: string | undefined): boolean {
    if (!cardInstanceId) return false;
    return this.getSlots(playerId).some(
      (s) =>
        (s.roleCardId === cardInstanceId &&
          !this.state.cards[cardInstanceId]?.modifiers?.some((m) => m.setCardType === CardType.ASSIST)) ||
        (s.assistCardId === cardInstanceId &&
          Boolean(this.state.cards[cardInstanceId]?.modifiers?.some((m) => m.setCardType === CardType.ROLE)))
    );
  }

  /**
   * 是否为该玩家战场上单独占用卡位、未被装备的装备牌
   */
  isStandaloneEquipment(playerId: string, cardInstanceId: string): boolean {
    return this.getSlots(playerId).some((s) => s.standaloneEquipmentId === cardInstanceId);
  }

  /**
   * 是否为该玩家战场卡位上的卡牌本体 (角色、辅助机、单独占位的装备)；
   * 角色下方的卡牌与装备中的装备牌不视为战场中的独立卡牌 (3.2.6、4.18.6)
   */
  isTopLevelFieldCard(playerId: string, cardInstanceId: string): boolean {
    return this.getSlots(playerId).some(
      (s) =>
        s.roleCardId === cardInstanceId ||
        s.assistCardId === cardInstanceId ||
        s.standaloneEquipmentId === cardInstanceId
    );
  }

  /**
   * 查找首个可用空卡位 (8.6.2.b)
   */
  findFirstEmptySlot(playerId: string): number | undefined {
    const slots = this.getSlots(playerId);
    for (const slot of slots) {
      if (!slot.roleCardId && !slot.standaloneEquipmentId && !slot.assistCardId) {
        return slot.slotIndex;
      }
    }
    return undefined;
  }

  /**
   * 8.6.2.e.1 放置角色牌出场
   */
  playRoleCard(
    playerId: string,
    cardInstanceId: string,
    slotIndex: number,
    options?: {
      enterTapped?: boolean;
      enterAbilitiesLost?: boolean;
      deployedFromHostCardId?: string;
      sourceCardNumber?: string;
    }
  ): boolean {
    const slot = this.getSlots(playerId)[slotIndex];
    if (!slot || slot.roleCardId || slot.standaloneEquipmentId || slot.assistCardId) {
      return false; // 卡位已被占用
    }

    const srcCard = this.state.cards[cardInstanceId];
    const fromZone = srcCard?.zone;
    const wasAirborne = Boolean(srcCard && fromZone === 'PROCESSING' && srcCard.isAirborne);
    const airborneUnderIds = wasAirborne ? [...(srcCard!.underneathCardIds ?? [])] : [];
    const airborneEqIds = wasAirborne ? getAttachedEquipmentIds(srcCard) : [];

    slot.roleCardId = cardInstanceId;
    this.zoneMgr.moveCard(cardInstanceId, 'BATTLEFIELD', {
      slotIndex,
      isFaceUp: true,
      isReady: !options?.enterTapped,
      ...(wasAirborne ? { preserveAttachments: true } : {}),
    });
    const movedCard = this.state.cards[cardInstanceId];
    if (movedCard && wasAirborne) {
      movedCard.underneathCardIds = airborneUnderIds;
      setAttachedEquipmentIds(movedCard, airborneEqIds);
      for (const uid of airborneUnderIds) {
        const uc = this.state.cards[uid];
        if (uc) {
          uc.zone = 'BATTLEFIELD';
          uc.slotIndex = undefined;
        }
      }
      for (const eqId of airborneEqIds) {
        const eq = this.state.cards[eqId];
        if (eq) {
          eq.zone = 'BATTLEFIELD';
          eq.slotIndex = slotIndex;
          eq.isFaceUp = true;
          eq.isReady = true;
        }
      }
    }
    if (movedCard && options?.enterAbilitiesLost) {
      addCardModifier(this.state, movedCard, {
        loseAbilities: true,
        untilTurn: undefined,
        source: options.sourceCardNumber ?? movedCard.cardNumber,
      });
    }

    this.events.push({
      type: 'CARD_PLAYED',
      playerId,
      cardInstanceId,
      slotIndex,
      isAscension: false,
    });
    this.onTriggerEventCallback?.({
      type: 'CARD_ENTERED_FIELD',
      playerId,
      cardInstanceId,
      fromZone,
      toZone: 'BATTLEFIELD',
      isAscension: false,
      deployedFromHostCardId: options?.deployedFromHostCardId,
      subjectSnapshot: this.snapshotProvider?.(cardInstanceId),
    });
    return true;
  }

  /**
   * 8.6.2.e.2 装备牌以正面竖直状态单独放置到空余卡位 (占用该卡位，4.18.5)
   */
  playStandaloneEquipment(playerId: string, cardInstanceId: string, slotIndex: number): boolean {
    const slot = this.getSlots(playerId)[slotIndex];
    if (!slot || slot.roleCardId || slot.standaloneEquipmentId || slot.assistCardId) {
      return false;
    }

    slot.standaloneEquipmentId = cardInstanceId;
    this.zoneMgr.moveCard(cardInstanceId, 'BATTLEFIELD', {
      slotIndex,
      isFaceUp: true,
      isReady: true,
    });
    return true;
  }

  /**
   * 8.11 升变出场 (Ascension)
   * 将手牌 (或允许区域) 中的升变卡重叠在升变对象上方出场。
   * 支持：战场角色、信号球区正面卡牌 (BP04-061)、浮空模式角色、以及 BP01-040 额外叠放战场《帕瓦》。
   */
  playAscensionCard(
    playerId: string,
    ascensionCardId: string,
    targetRoleCardId: string,
    options?: { targetSlotIndex?: number; extraStackRoleCardId?: string }
  ): boolean {
    const targetCard = this.state.cards[targetRoleCardId];
    if (!targetCard || targetCard.controllerPlayerId !== playerId) {
      return false;
    }

    const ascensionCard = this.state.cards[ascensionCardId];
    if (!ascensionCard) return false;

    const wasTargetAirborne = targetCard.zone === 'PROCESSING' && targetCard.isAirborne === true;
    let slotIndex: number | undefined;
    if (targetCard.zone === 'BATTLEFIELD') {
      if (!this.isSlotRole(playerId, targetRoleCardId) || targetCard.slotIndex === undefined) {
        return false;
      }
      slotIndex = targetCard.slotIndex;
      // 8.13.4.a.3 / 8.13.4.c.4 协战角色作为升变对象时，原搭档解除协战置入墓地
      if (targetCard.partnerCardId) {
        this.releasePartner(targetRoleCardId, true);
      }
    } else if (targetCard.zone === 'SIGNAL_ORB') {
      if (!targetCard.isFaceUp) return false; // Q&A·10 背面不能作为升变对象
      slotIndex = options?.targetSlotIndex ?? this.findFirstEmptySlot(playerId);
      if (slotIndex === undefined) return false;
      const chosenSlot = this.getSlots(playerId)[slotIndex];
      if (!chosenSlot || chosenSlot.roleCardId || chosenSlot.standaloneEquipmentId || chosenSlot.assistCardId) {
        return false;
      }
    } else if (wasTargetAirborne) {
      slotIndex = options?.targetSlotIndex ?? this.findFirstEmptySlot(playerId);
      if (slotIndex === undefined) return false;
      const chosenSlot = this.getSlots(playerId)[slotIndex];
      if (!chosenSlot || chosenSlot.roleCardId || chosenSlot.standaloneEquipmentId || chosenSlot.assistCardId) {
        return false;
      }
    } else {
      return false;
    }

    const slot = this.getSlots(playerId)[slotIndex];
    if (!slot) return false;

    // 先将升变卡放置到卡位 (移动区域会重置卡牌状态，下方卡牌与装备须在移动之后再挂接)
    const fromZone = ascensionCard.zone;
    slot.roleCardId = ascensionCardId;
    this.zoneMgr.moveCard(ascensionCardId, 'BATTLEFIELD', {
      slotIndex,
      isFaceUp: true,
      isReady: true,
    });

    // 确保从非战场 (信号球区/浮空区) 升变的原对象及其下方卡牌迁入 BATTLEFIELD
    targetCard.zone = 'BATTLEFIELD';
    targetCard.slotIndex = undefined;
    targetCard.isFaceUp = true;
    targetCard.isReady = true;
    targetCard.isAirborne = undefined;

    // 8.11.3.f.1 升变对象及其下方原本的卡牌将保留在升变出场的卡牌下方
    const stackedCardIds = [...targetCard.underneathCardIds, targetRoleCardId];
    for (const underId of targetCard.underneathCardIds) {
      const uc = this.state.cards[underId];
      if (uc) {
        uc.zone = 'BATTLEFIELD';
        uc.slotIndex = undefined;
      }
    }

    // 8.11.3.f.2 升变对象原本的装备将保留并成为升变出场的卡牌的装备 (支持双持装备)
    const inheritedEqIds = getAttachedEquipmentIds(targetCard);
    if (inheritedEqIds.length > 0) {
      for (const eqId of inheritedEqIds) {
        const eqCard = this.state.cards[eqId];
        if (eqCard) {
          eqCard.zone = 'BATTLEFIELD';
          eqCard.slotIndex = slotIndex;
        }
      }
      setAttachedEquipmentIds(ascensionCard, inheritedEqIds);
      setAttachedEquipmentIds(targetCard, []);
    }

    // BP01-040 额外升变代价：将我方战场 1 张《帕瓦》放置到该牌下方
    if (options?.extraStackRoleCardId && options.extraStackRoleCardId !== targetRoleCardId) {
      const extraCard = this.state.cards[options.extraStackRoleCardId];
      if (extraCard && this.isSlotRole(playerId, extraCard.instanceId)) {
        if (extraCard.partnerCardId) {
          this.releasePartner(extraCard.instanceId, true);
        }
        for (const s of this.getSlots(playerId)) {
          if (s.roleCardId === extraCard.instanceId) s.roleCardId = undefined;
        }
        const extraOrphans = [...extraCard.underneathCardIds, ...getAttachedEquipmentIds(extraCard)];
        extraCard.underneathCardIds = [];
        setAttachedEquipmentIds(extraCard, []);
        for (const oid of extraOrphans) {
          const o = this.state.cards[oid];
          if (o && o.zone === 'BATTLEFIELD') {
            this.zoneMgr.moveCard(oid, 'GRAVEYARD', {
              isFaceUp: true,
              isOrphanCleanup: true,
              orphanHostCardId: extraCard.instanceId,
            });
          }
        }
        extraCard.slotIndex = undefined;
        extraCard.tempPPBonus = undefined;
        extraCard.tempDPBonus = undefined;
        extraCard.grantedKeywords = undefined;
        extraCard.modifiers = undefined;
        extraCard.isFrozen = undefined;
        stackedCardIds.push(extraCard.instanceId);
      }
    }

    ascensionCard.underneathCardIds = stackedCardIds;

    // 8.11.4.c 升变对象原本的卡牌状态不继承；作为下方的牌，其持续效果也不再适用 (3.2.6)
    targetCard.tempPPBonus = undefined;
    targetCard.tempDPBonus = undefined;
    targetCard.grantedKeywords = undefined;
    targetCard.modifiers = undefined;
    targetCard.isFrozen = undefined;

    // 8.11.2.c 执行升变能力：通过 CardModifier 获得升变能力记述的关键字 (持续到离场为止，3.1.4)
    const ascensionDef =
      this.cardDb.getCard(ascensionCard.cardNumber) ||
      (ascensionCard.cardId ? this.cardDb.getCard(ascensionCard.cardId) : undefined);
    const grantKeywords = ascensionDef?.ascensionConfig?.grantKeywords ?? [];
    if (grantKeywords.length > 0) {
      addCardModifier(this.state, ascensionCard, {
        keywords: [...grantKeywords],
        untilTurn: undefined,
        source: ascensionCard.cardNumber,
        sourceCardInstanceId: ascensionCardId,
      });
    }

    // 被升变的原卡不再单独计为顶层角色
    targetCard.underneathCardIds = [];
    ascensionCard.wasAscendedPlay = true;
    ascensionCard.ascendedFromAirborne = wasTargetAirborne || undefined;

    this.events.push({
      type: 'CARD_PLAYED',
      playerId,
      cardInstanceId: ascensionCardId,
      slotIndex,
      isAscension: true,
    });
    this.events.push({
      type: 'CARD_ASCENDED',
      parentCardId: ascensionCardId,
      underneathCardIds: stackedCardIds,
    });
    this.onTriggerEventCallback?.({
      type: 'CARD_ENTERED_FIELD',
      playerId,
      cardInstanceId: ascensionCardId,
      fromZone,
      toZone: 'BATTLEFIELD',
      isAscension: true,
      subjectSnapshot: this.snapshotProvider?.(ascensionCardId),
    });

    return true;
  }

  /**
   * 4.18.3 检查指定装备牌当前能否装备给目标角色 (支持 BP01-014/016/017 双持2张<封刃太刀>装备)
   */
  canEquipToRole(playerId: string, equipmentCardId: string, roleCardId: string): boolean {
    const equipCard = this.state.cards[equipmentCardId];
    const roleCard = this.state.cards[roleCardId];
    if (!equipCard || !roleCard) return false;
    if (equipCard.controllerPlayerId !== playerId) return false;
    if (!this.isSlotRole(playerId, roleCardId)) return false;

    const existingIds = getAttachedEquipmentIds(roleCard);
    if (existingIds.includes(equipmentCardId)) return false;
    if (existingIds.length === 0) return true;
    if (existingIds.length >= 2) return false;

    // 已有 1 张装备时，仅当角色拥有有效的双持<封刃太刀>永久能力且已有与新装备均为<封刃太刀>时允许
    const stats = this.evaluateRoleStats(roleCardId);
    if (!stats.canDualEquipFengren) return false;
    const existingCard = this.state.cards[existingIds[0]!];
    const existingDef = existingCard
      ? this.cardDb.getCard(existingCard.cardNumber) || (existingCard.cardId ? this.cardDb.getCard(existingCard.cardId) : undefined)
      : undefined;
    const newDef =
      this.cardDb.getCard(equipCard.cardNumber) || (equipCard.cardId ? this.cardDb.getCard(equipCard.cardId) : undefined);
    return isFengrenTachiEquipmentDef(existingDef) && isFengrenTachiEquipmentDef(newDef);
  }

  /**
   * 4.18 装备道具牌给角色
   */
  equipToRole(playerId: string, equipmentCardId: string, roleCardId: string): boolean {
    if (!this.canEquipToRole(playerId, equipmentCardId, roleCardId)) return false;
    const equipCard = this.state.cards[equipmentCardId]!;
    const roleCard = this.state.cards[roleCardId]!;

    // 如果装备牌原本单独占位，清空原卡位
    if (equipCard.zone === 'BATTLEFIELD' && equipCard.slotIndex !== undefined) {
      const origSlot = this.getSlots(playerId)[equipCard.slotIndex];
      if (origSlot && origSlot.standaloneEquipmentId === equipmentCardId) {
        origSlot.standaloneEquipmentId = undefined;
      }
    }

    const nextEqIds = [...getAttachedEquipmentIds(roleCard), equipmentCardId];
    this.zoneMgr.moveCard(equipmentCardId, 'BATTLEFIELD', {
      slotIndex: roleCard.slotIndex,
      isFaceUp: true,
      isReady: true,
    });
    setAttachedEquipmentIds(roleCard, nextEqIds);

    this.events.push({
      type: 'CARD_EQUIPPED',
      equipmentCardId,
      roleCardId,
    });
    this.onTriggerEventCallback?.({
      type: 'CARD_EQUIPPED',
      playerId,
      cardInstanceId: equipmentCardId,
      targetCardId: roleCardId,
      subjectSnapshot: this.snapshotProvider?.(equipmentCardId),
    });

    return true;
  }

  /**
   * 2.2.2.c.2 放置辅助机出场 (玩家战场最多存在1张辅助机)
   */
  playAssistCard(playerId: string, assistCardId: string, slotIndex: number): boolean {
    const slots = this.getSlots(playerId);
    const targetSlot = slots[slotIndex];
    if (!targetSlot) return false;
    // 8.6.2.e.3 只能放置到空余卡位，或替换原有仍为辅助机类型的卡位 (PR-041 变为角色牌期间不可覆盖或误杀)
    const isEffectiveAssist = (cardId: string): boolean => {
      const c = this.state.cards[cardId];
      if (!c) return false;
      if (this.continuousEffects) {
        return this.continuousEffects.getEffectiveCardType(cardId) === CardType.ASSIST;
      }
      return !c.modifiers?.some((m) => m.setCardType === CardType.ROLE);
    };
    if (targetSlot.roleCardId || targetSlot.standaloneEquipmentId) return false;
    if (targetSlot.assistCardId && !isEffectiveAssist(targetSlot.assistCardId)) return false;

    // 8.6.2.e.3 若已有辅助机（且当前有效类型仍为 ASSIST），将其置入墓地替换
    for (const slot of slots) {
      if (slot.assistCardId && isEffectiveAssist(slot.assistCardId)) {
        const oldAssistId = slot.assistCardId;
        slot.assistCardId = undefined;
        this.zoneMgr.moveCard(oldAssistId, 'GRAVEYARD', { isFaceUp: true });
      }
    }

    targetSlot.assistCardId = assistCardId;
    this.zoneMgr.moveCard(assistCardId, 'BATTLEFIELD', {
      slotIndex,
      isFaceUp: true,
      isReady: true,
    });

    return true;
  }

  /**
   * 角色或卡牌离开战场处理 (9.6 无所属卡牌的卡牌处理 - 中断型规则处理)
   */
  handleCardLeaveField(cardInstanceId: string): void {
    const card = this.state.cards[cardInstanceId];
    if (!card) return;

    const playerId = card.controllerPlayerId;
    const slots = this.getSlots(playerId);

    // 清空对应卡位
    for (const slot of slots) {
      if (slot.roleCardId === cardInstanceId) {
        slot.roleCardId = undefined;
      }
      if (slot.standaloneEquipmentId === cardInstanceId) {
        slot.standaloneEquipmentId = undefined;
      }
      if (slot.assistCardId === cardInstanceId) {
        slot.assistCardId = undefined;
      }
    }

    // 9.6.1 升变出场角色离开战场时，其原本下方的卡牌（升变对象等）因规则移动到墓地
    if (card.underneathCardIds.length > 0) {
      const underneathIds = [...card.underneathCardIds];
      card.underneathCardIds = [];
      for (const underneathId of underneathIds) {
        this.zoneMgr.moveCard(underneathId, 'GRAVEYARD', {
          isFaceUp: true,
          isOrphanCleanup: true,
          orphanHostCardId: cardInstanceId,
        });
      }
    }

    // 4.18.6 装备角色离开战场时，其全部装备牌因规则处理 (9.6) 放置到墓地 (允许 BP04-065 等置换效果拦截)
    const attachedEqIds = getAttachedEquipmentIds(card);
    if (attachedEqIds.length > 0) {
      setAttachedEquipmentIds(card, []);
      for (const eqId of attachedEqIds) {
        this.zoneMgr.moveCard(eqId, 'GRAVEYARD', {
          isFaceUp: true,
          isOrphanCleanup: true,
          orphanHostCardId: cardInstanceId,
        });
      }
    }

    // 8.13.4.a.3 协战角色离开战场时，其搭档因规则放置到墓地 (不视为离场)
    if (card.partnerCardId) {
      this.releasePartner(cardInstanceId, true);
    }
  }

  /**
   * 10.18 将战场角色或手牌中的指定角色【浮空】到处理区成为【浮空模式】(支持 BP03-002 / BP04-071 手牌直接浮空)
   * - 10.18.2.a 每位玩家处理区最多 1 张浮空模式卡牌；已存在时不执行并返回 false
   * - 10.18.2.b / 10.18.2.d.3 下方的卡牌与装备保持不变一同移动，但它们不视为浮空模式/处理区牌
   */
  airborneRole(cardInstanceId: string): boolean {
    const card = this.state.cards[cardInstanceId];
    if (!card) return false;
    const playerId = card.controllerPlayerId;
    const fromBattlefield = this.isSlotRole(playerId, cardInstanceId);
    const fromHand = card.zone === 'HAND';
    if (!fromBattlefield && !fromHand) {
      return false;
    }
    const existingAirborne = this.zoneMgr
      .getCardsInZone(playerId, 'PROCESSING')
      .some((c) => c.isAirborne === true);
    if (existingAirborne) {
      return false;
    }

    // 8.13.4.a.3 若处于协战状态，离场前先解除协战并将搭档置入墓地
    if (fromBattlefield && card.partnerCardId) {
      this.releasePartner(cardInstanceId, true);
    }

    const underIds = fromBattlefield ? [...card.underneathCardIds] : [];
    const eqIds = fromBattlefield ? getAttachedEquipmentIds(card) : [];

    if (fromBattlefield) {
      for (const slot of this.getSlots(playerId)) {
        if (slot.roleCardId === cardInstanceId) {
          slot.roleCardId = undefined;
        }
      }
    }

    card.isAirborne = true;
    const moved = this.zoneMgr.moveCard(cardInstanceId, 'PROCESSING', {
      isFaceUp: true,
      isReady: true,
      preserveAttachments: fromBattlefield,
    });
    if (!moved) {
      card.isAirborne = undefined;
      return false;
    }

    if (fromBattlefield) {
      card.underneathCardIds = underIds;
      setAttachedEquipmentIds(card, eqIds);
      for (const id of [...underIds, ...eqIds]) {
        const sub = this.state.cards[id];
        if (sub) {
          sub.zone = 'PROCESSING';
          sub.slotIndex = undefined;
          sub.modifiers = undefined;
          sub.isFrozen = undefined;
          sub.isAirborne = undefined;
        }
      }
    }
    return true;
  }

  /**
   * 10.18.2.c 回合开始时 (6.2.1.a) 检查处理区的浮空模式卡牌并将其作为规则处理回到战场；
   * 若战场没有空余卡位则将其与下方卡牌、装备一并置入墓地 (10.18.2.e)。
   */
  returnAirborneRoleAtTurnStart(playerId: string): string | undefined {
    const airborne = this.zoneMgr
      .getCardsInZone(playerId, 'PROCESSING')
      .find((c) => c.isAirborne === true);
    if (!airborne) return undefined;

    airborne.isAirborne = undefined;
    const underIds = [...airborne.underneathCardIds];
    const eqIds = getAttachedEquipmentIds(airborne);
    const slotIndex = this.findFirstEmptySlot(playerId);

    if (slotIndex === undefined) {
      // 10.18.2.e 没有空余卡位，本体与下方/装备卡牌一并置入墓地
      this.zoneMgr.moveCard(airborne.instanceId, 'GRAVEYARD', { isFaceUp: true });
      for (const id of [...underIds, ...eqIds]) {
        if (this.state.cards[id]) {
          this.zoneMgr.moveCard(id, 'GRAVEYARD', { isFaceUp: true });
        }
      }
      return undefined;
    }

    const slot = this.getSlots(playerId)[slotIndex]!;
    slot.roleCardId = airborne.instanceId;
    this.zoneMgr.moveCard(airborne.instanceId, 'BATTLEFIELD', {
      slotIndex,
      isFaceUp: true,
      isReady: true,
      preserveAttachments: true,
    });
    airborne.underneathCardIds = underIds;
    setAttachedEquipmentIds(airborne, eqIds);
    for (const id of underIds) {
      const uc = this.state.cards[id];
      if (uc) {
        uc.zone = 'BATTLEFIELD';
        uc.slotIndex = undefined;
      }
    }
    for (const eqId of eqIds) {
      if (this.state.cards[eqId]) {
        const eq = this.state.cards[eqId]!;
        eq.zone = 'BATTLEFIELD';
        eq.slotIndex = slotIndex;
        eq.isFaceUp = true;
        eq.isReady = true;
      }
    }

    this.events.push({
      type: 'CARD_PLAYED',
      playerId,
      cardInstanceId: airborne.instanceId,
      slotIndex,
      isAscension: false,
    });
    this.onTriggerEventCallback?.({
      type: 'CARD_ENTERED_FIELD',
      playerId,
      cardInstanceId: airborne.instanceId,
      fromZone: 'PROCESSING',
      toZone: 'BATTLEFIELD',
      isAscension: false,
      subjectSnapshot: this.snapshotProvider?.(airborne.instanceId),
    });
    return airborne.instanceId;
  }

  /**
   * 8.13.3.d 使指定卡牌成为战场上协战角色的协战搭档
   */
  attachPartner(
    playerId: string,
    hostRoleCardId: string,
    partnerCardId: string,
    options?: { releaseToDeckBottom?: boolean }
  ): boolean {
    const host = this.state.cards[hostRoleCardId];
    const partner = this.state.cards[partnerCardId];
    if (!host || !partner || hostRoleCardId === partnerCardId) return false;
    if (!this.isSlotRole(playerId, hostRoleCardId) || partner.controllerPlayerId !== playerId) {
      return false;
    }
    if (partner.partnerOfCardId) return false;

    // 8.13.2.a.2 / 8.13.4.c.3 已有搭档时先将原搭档解除协战置入墓地
    if (host.partnerCardId) {
      this.releasePartner(hostRoleCardId, true);
    }

    const fromDeck = partner.zone === 'DECK';

    // 8.13.3.d.3 战场上的卡牌成为搭档时，清空其原有卡位并将下方牌/装备/搭档置入墓地
    if (partner.zone === 'BATTLEFIELD') {
      for (const s of this.getSlots(playerId)) {
        if (s.roleCardId === partnerCardId) s.roleCardId = undefined;
        if (s.assistCardId === partnerCardId) s.assistCardId = undefined;
        if (s.standaloneEquipmentId === partnerCardId) s.standaloneEquipmentId = undefined;
      }
      if (partner.partnerCardId) {
        this.releasePartner(partnerCardId, true);
      }
      const oldUnder = [...partner.underneathCardIds];
      const oldEqIds = getAttachedEquipmentIds(partner);
      partner.underneathCardIds = [];
      setAttachedEquipmentIds(partner, []);
      for (const oid of oldUnder) {
        if (this.state.cards[oid]?.zone === 'BATTLEFIELD') {
          this.zoneMgr.moveCard(oid, 'GRAVEYARD', {
            isFaceUp: true,
            isOrphanCleanup: true,
            orphanHostCardId: partnerCardId,
          });
        }
      }
      for (const oldEq of oldEqIds) {
        if (this.state.cards[oldEq]?.zone === 'BATTLEFIELD') {
          this.zoneMgr.moveCard(oldEq, 'GRAVEYARD', {
            isFaceUp: true,
            isOrphanCleanup: true,
            orphanHostCardId: partnerCardId,
          });
        }
      }
    }

    const prevZone = partner.zone;
    // 8.13.2.b.3 / 8.13.3.d.2 放置到战场紧贴宿主，不继承原有状态，不触发出场能力
    partner.zone = 'BATTLEFIELD';
    partner.slotIndex = host.slotIndex;
    partner.isFaceUp = true;
    partner.isReady = true;
    partner.modifiers = undefined;
    partner.tempPPBonus = undefined;
    partner.tempDPBonus = undefined;
    partner.grantedKeywords = undefined;
    partner.endOfTurnToGraveyard = undefined;
    partner.isFrozen = undefined;
    partner.isAirborne = undefined;
    partner.underneathCardIds = [];
    setAttachedEquipmentIds(partner, []);
    partner.partnerOfCardId = hostRoleCardId;
    partner.releasePartnerToDeckBottom = options?.releaseToDeckBottom || undefined;
    host.partnerCardId = partnerCardId;

    if (prevZone === 'COST') {
      this.zoneMgr.syncCostStats(playerId);
    }
    if (fromDeck) {
      // 8.13.3.b.3 从牌组选择搭档后洗切牌组
      this.zoneMgr.shuffleDeck(playerId);
    }

    this.events.push({
      type: 'CARD_MOVED',
      cardInstanceId: partnerCardId,
      fromZone: prevZone,
      toZone: 'BATTLEFIELD',
      toSlot: host.slotIndex,
      isFaceUp: true,
      isReady: true,
    });
    return true;
  }

  /**
   * 8.13.4.c 解除协战状态并将搭档置入墓地 (8.13.4.a.1 不视为离场)
   */
  releasePartner(hostRoleCardId: string, force: boolean = false): boolean {
    const host = this.state.cards[hostRoleCardId];
    if (!host || !host.partnerCardId) return false;
    const partnerId = host.partnerCardId;
    const partner = this.state.cards[partnerId];
    if (
      !force &&
      partner &&
      ((partner.cannotReleasePartnerUntilTurn !== undefined &&
        partner.cannotReleasePartnerUntilTurn >= this.state.turnNumber) ||
        (partner.cardNumber === 'BP04-038' &&
          partner.turnEnteredZone === this.state.turnNumber &&
          !this.continuousEffects?.hasLostInherentAbilities(partnerId) &&
          (this.state.players[host.controllerPlayerId]?.eliminatedOrbsByKareninaCountThisTurn ?? 0) > 0))
    ) {
      return false;
    }

    const toDeckBottom = Boolean(partner?.releasePartnerToDeckBottom);
    host.partnerCardId = undefined;
    if (partner) {
      partner.partnerOfCardId = undefined;
      partner.cannotReleasePartnerUntilTurn = undefined;
      partner.releasePartnerToDeckBottom = undefined;
      if (partner.zone === 'BATTLEFIELD') {
        if (toDeckBottom) {
          this.zoneMgr.moveCardToBottomOfDeck(partnerId);
        } else {
          this.zoneMgr.moveCard(partnerId, 'GRAVEYARD', {
            isFaceUp: true,
            skipLeftFieldTrigger: true,
          });
        }
        this.onTriggerEventCallback?.({
          type: 'PARTNER_RELEASED',
          playerId: host.controllerPlayerId,
          cardInstanceId: hostRoleCardId,
          targetCardId: partnerId,
          subjectSnapshot: this.snapshotProvider?.(partnerId),
        });
      }
    }
    return true;
  }

  /**
   * 8.9.1 统一评估战场角色的当前有效情报 (PP / DP / 充能数 / 词条 / 特征 / 禁止标志)
   */
  evaluateRoleStats(cardInstanceId: string): EvaluatedCardStats {
    if (this.continuousEffects) {
      const evaluated = this.continuousEffects.evaluateCard(cardInstanceId);
      const extraStaticPP = this.staticPPProvider?.(cardInstanceId) ?? 0;
      return {
        ...evaluated,
        pp: evaluated.pp + extraStaticPP,
      };
    }

    // 兜底：未注入 ContinuousEffectEngine 时按基本值 + 装备 + modifiers 计算
    const card = this.state.cards[cardInstanceId];
    if (!card) {
      return {
        pp: 0,
        dp: 0,
        charge: 0,
        keywords: [],
        traits: [],
        abilitiesLost: false,
        prohibitions: [],
        treatedAsNames: [],
        treatedAsOrbColors: [],
        orbValue: 0,
        grantedTriggerIds: [],
        canAttackPlayerOnEnterTurn: false,
        unblockableMaxPP: undefined,
      };
    }
    const cardDef = (card.cardId ? this.cardDb.getCard(card.cardId) : undefined) || this.cardDb.getCard(card.cardNumber);
    let pp = cardDef?.basePP ?? 0;
    for (const eqId of getAttachedEquipmentIds(card)) {
      const eqCard = this.state.cards[eqId];
      if (eqCard) pp += this.cardDb.getCard(eqCard.cardNumber)?.basePP ?? 0;
    }
    if (card.tempPPBonus) pp += card.tempPPBonus;
    let dp = (cardDef?.baseDP ?? 0) + (card.tempDPBonus ?? 0);
    for (const m of card.modifiers ?? []) {
      if (m.setPP !== undefined) pp = m.setPP;
      if (m.pp !== undefined) pp += m.pp;
      if (m.setDP !== undefined) dp = m.setDP;
      if (m.dp !== undefined) dp += m.dp;
    }
    pp += this.staticPPProvider?.(cardInstanceId) ?? 0;
    return {
      pp,
      dp: Math.max(0, dp),
      charge: 1,
      keywords: [...(card.grantedKeywords ?? [])],
      traits: [...(cardDef?.traits ?? [])],
      abilitiesLost: false,
      prohibitions: [],
      treatedAsNames: [],
      treatedAsOrbColors: [],
      orbValue: 0,
      grantedTriggerIds: [],
      canAttackPlayerOnEnterTurn: false,
      unblockableMaxPP: undefined,
    };
  }

  /**
   * 计算角色当前有效 PP (8.9 持续效果层级计算 + 装备 4.18.2)
   */
  calculateRoleEffectivePP(cardInstanceId: string): number {
    return this.evaluateRoleStats(cardInstanceId).pp;
  }

  /**
   * 计算角色当前有效 DP (2.9 & 8.9.1.c)
   */
  calculateRoleEffectiveDP(cardInstanceId: string): number {
    return this.evaluateRoleStats(cardInstanceId).dp;
  }
}
