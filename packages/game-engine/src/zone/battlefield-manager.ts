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
  getModifierEffectiveCardType,
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
    readonly cardDb: ICardDatabase,
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
    return this.getSlots(playerId).some((s) => {
      if (s.roleCardId === cardInstanceId) {
        const rc = this.state.cards[cardInstanceId];
        const def = rc ? this.cardDb.getCard(rc.cardNumber) || (rc.cardId ? this.cardDb.getCard(rc.cardId) : undefined) : undefined;
        return getModifierEffectiveCardType(rc, def) === CardType.ROLE;
      }
      if (s.assistCardId === cardInstanceId) {
        const ac = this.state.cards[cardInstanceId];
        const def = ac ? this.cardDb.getCard(ac.cardNumber) || (ac.cardId ? this.cardDb.getCard(ac.cardId) : undefined) : undefined;
        return getModifierEffectiveCardType(ac, def) === CardType.ROLE;
      }
      return false;
    });
  }

  /**
   * Q&A·9 BP04-052《血契者》：检查让指定卡牌进入战场是否违反「我方战场只能存在1张《血契者》」并应在进场前阻止
   */
  wouldViolateUniqueBloodPact(playerId: string, cardInstanceId: string, enterAbilitiesLost?: boolean): boolean {
    const incoming = this.state.cards[cardInstanceId];
    if (!incoming) return false;
    const incomingDef =
      this.cardDb.getCard(incoming.cardNumber) ||
      (incoming.cardId ? this.cardDb.getCard(incoming.cardId) : undefined);
    const isIncomingBloodPact =
      this.continuousEffects?.hasCardName(cardInstanceId, '血契者') ||
      incomingDef?.name === '血契者' ||
      incoming.cardNumber === 'BP04-052';
    if (!isIncomingBloodPact) return false;

    const existingBloodPacts = this.getSlots(playerId)
      .map((s) => {
        const id = s.roleCardId ?? s.assistCardId;
        return id ? this.state.cards[id] : undefined;
      })
      .filter((c): c is CardInstance => {
        if (!c || c.instanceId === cardInstanceId) return false;
        const d = this.cardDb.getCard(c.cardNumber) || (c.cardId ? this.cardDb.getCard(c.cardId) : undefined);
        return Boolean(
          this.continuousEffects?.hasCardName(c.instanceId, '血契者') ||
            d?.name === '血契者' ||
            c.cardNumber === 'BP04-052'
        );
      });
    if (existingBloodPacts.length === 0) return false;

    const anyExistingActive = existingBloodPacts.some(
      (c) => !this.continuousEffects?.hasLostInherentAbilities(c.instanceId)
    );
    const incomingActive = incoming.cardNumber === 'BP04-052' && !enterAbilitiesLost;
    return anyExistingActive || incomingActive;
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
      suppressEntryTrigger?: boolean;
    }
  ): boolean {
    const slot = this.getSlots(playerId)[slotIndex];
    if (!slot || slot.roleCardId || slot.standaloneEquipmentId || slot.assistCardId) {
      return false; // 卡位已被占用
    }
    if (this.wouldViolateUniqueBloodPact(playerId, cardInstanceId, options?.enterAbilitiesLost)) {
      return false; // Q&A·9 BP04-052 已有《血契者》时不能再出场新的
    }

    const srcCard = this.state.cards[cardInstanceId];
    const fromZone = srcCard?.zone;
    const wasAirborne = Boolean(srcCard && fromZone === 'PROCESSING' && srcCard.isAirborne);
    const airborneUnderIds = wasAirborne ? [...(srcCard!.underneathCardIds ?? [])] : [];
    const airborneEqIds = wasAirborne ? getAttachedEquipmentIds(srcCard) : [];

    const moved = this.zoneMgr.moveCard(cardInstanceId, 'BATTLEFIELD', {
      slotIndex,
      isFaceUp: true,
      isReady: !options?.enterTapped,
      ...(wasAirborne ? { preserveAttachments: true } : {}),
    });
    const movedCard = this.state.cards[cardInstanceId];
    if (!moved || !movedCard || movedCard.zone !== 'BATTLEFIELD') {
      return false;
    }

    slot.roleCardId = cardInstanceId;
    if (wasAirborne) {
      movedCard.underneathCardIds = airborneUnderIds;
      setAttachedEquipmentIds(movedCard, airborneEqIds);
      for (const uid of airborneUnderIds) {
        this.zoneMgr.syncAttachedCardZone(uid, 'BATTLEFIELD');
      }
      for (const eqId of airborneEqIds) {
        this.zoneMgr.syncAttachedCardZone(eqId, 'BATTLEFIELD', {
          slotIndex,
          isFaceUp: true,
          isReady: true,
        });
      }
    }
    if (options?.enterAbilitiesLost) {
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
      suppressEntryTrigger: options?.suppressEntryTrigger,
      subjectSnapshot: this.snapshotProvider?.(cardInstanceId),
    });
    return true;
  }

  /**
   * 8.6.2.e.2 装备牌以正面竖直状态单独放置到空余卡位 (占用该卡位，4.18.5)
   */
  playStandaloneEquipment(
    playerId: string,
    cardInstanceId: string,
    slotIndex: number,
    options?: {
      enterTapped?: boolean;
      enterAbilitiesLost?: boolean;
      sourceCardNumber?: string;
      suppressEntryTrigger?: boolean;
    }
  ): boolean {
    const slot = this.getSlots(playerId)[slotIndex];
    if (!slot || slot.roleCardId || slot.standaloneEquipmentId || slot.assistCardId) {
      return false;
    }

    const fromZone = this.state.cards[cardInstanceId]?.zone;
    const moved = this.zoneMgr.moveCard(cardInstanceId, 'BATTLEFIELD', {
      slotIndex,
      isFaceUp: true,
      isReady: !options?.enterTapped,
    });
    const movedCard = this.state.cards[cardInstanceId];
    if (!moved || !movedCard || movedCard.zone !== 'BATTLEFIELD') {
      return false;
    }

    slot.standaloneEquipmentId = cardInstanceId;
    if (options?.enterAbilitiesLost) {
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
      suppressEntryTrigger: options?.suppressEntryTrigger,
      subjectSnapshot: this.snapshotProvider?.(cardInstanceId),
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
    options?: {
      targetSlotIndex?: number;
      extraStackRoleCardId?: string;
      additionalTargetRoleCardIds?: string[];
      suppressEntryTrigger?: boolean;
    }
  ): boolean {
    const targetCard = this.state.cards[targetRoleCardId];
    if (!targetCard || targetCard.controllerPlayerId !== playerId) {
      return false;
    }

    const ascensionCard = this.state.cards[ascensionCardId];
    if (!ascensionCard) return false;

    const wasTargetAirborne = targetCard.zone === 'PROCESSING' && targetCard.isAirborne === true;
    const targetFromZone = targetCard.zone;
    let slotIndex: number | undefined;
    if (targetFromZone === 'BATTLEFIELD') {
      if (!this.isSlotRole(playerId, targetRoleCardId) || targetCard.slotIndex === undefined) {
        return false;
      }
      slotIndex = targetCard.slotIndex;
    } else if (targetFromZone === 'SIGNAL_ORB') {
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
    const moved = this.zoneMgr.moveCard(ascensionCardId, 'BATTLEFIELD', {
      slotIndex,
      isFaceUp: true,
      isReady: true,
    });
    if (!moved || ascensionCard.zone !== 'BATTLEFIELD') {
      return false;
    }

    // 8.13.4.a.3 / 8.13.4.c.4 协战角色作为升变对象时，原搭档解除协战置入墓地
    if (targetFromZone === 'BATTLEFIELD' && targetCard.partnerCardId) {
      this.releasePartner(targetRoleCardId, true);
    }

    slot.roleCardId = ascensionCardId;

    // 8.11.4.c & 8.11.3.f.1 升变对象及下方原本的卡牌同步留在该卡位下方 (不继承持续效果与状态)
    const stackedCardIds = [...targetCard.underneathCardIds, targetRoleCardId];
    for (const underId of targetCard.underneathCardIds) {
      this.zoneMgr.syncAttachedCardZone(underId, 'BATTLEFIELD', {
        slotIndex: undefined,
        isFaceUp: true,
        isReady: true,
        clearTransientState: true,
      });
    }

    // 8.11.3.f.2 升变对象原本的装备将保留并成为升变出场的卡牌的装备 (支持双持装备)
    const inheritedEqIds = getAttachedEquipmentIds(targetCard);
    if (inheritedEqIds.length > 0) {
      for (const eqId of inheritedEqIds) {
        this.zoneMgr.syncAttachedCardZone(eqId, 'BATTLEFIELD', { slotIndex });
      }
      setAttachedEquipmentIds(ascensionCard, inheritedEqIds);
      setAttachedEquipmentIds(targetCard, []);
    }

    this.zoneMgr.syncAttachedCardZone(targetRoleCardId, 'BATTLEFIELD', {
      slotIndex: undefined,
      isFaceUp: true,
      isReady: true,
      clearTransientState: true,
    });
    // 被升变的原卡不再单独计为顶层角色
    targetCard.underneathCardIds = [];
    ascensionCard.underneathCardIds = stackedCardIds;

    // BP04-001 等多对象升变：将其余被选中的己方战场角色及它们的下方牌一并重叠至升变卡下方
    if (options?.additionalTargetRoleCardIds?.length) {
      const seen = new Set<string>([targetRoleCardId, ascensionCardId]);
      for (const extraId of options.additionalTargetRoleCardIds) {
        if (!extraId || seen.has(extraId)) continue;
        seen.add(extraId);
        const extraCard = this.state.cards[extraId];
        if (!extraCard || extraCard.controllerPlayerId !== playerId || !this.isSlotRole(playerId, extraId)) {
          continue;
        }
        if (extraCard.partnerCardId) {
          this.releasePartner(extraId, true);
        }
        for (const s of this.getSlots(playerId)) {
          if (s.roleCardId === extraId) {
            s.roleCardId = undefined;
          }
        }
        const extraEqIds = getAttachedEquipmentIds(extraCard);
        if (extraEqIds.length > 0) {
          setAttachedEquipmentIds(extraCard, []);
          const currentHostEqIds = getAttachedEquipmentIds(ascensionCard);
          if (currentHostEqIds.length === 0) {
            const firstEqId = extraEqIds[0]!;
            this.zoneMgr.syncAttachedCardZone(firstEqId, 'BATTLEFIELD', { slotIndex });
            setAttachedEquipmentIds(ascensionCard, [firstEqId]);
            for (const remEqId of extraEqIds.slice(1)) {
              this.zoneMgr.moveCard(remEqId, 'GRAVEYARD', {
                isFaceUp: true,
                isOrphanCleanup: true,
                orphanHostCardId: extraId,
              });
            }
          } else {
            for (const eqId of extraEqIds) {
              this.zoneMgr.moveCard(eqId, 'GRAVEYARD', {
                isFaceUp: true,
                isOrphanCleanup: true,
                orphanHostCardId: extraId,
              });
            }
          }
        }
        const extraUnderIds = [...extraCard.underneathCardIds];
        extraCard.underneathCardIds = [];
        for (const uid of extraUnderIds) {
          this.zoneMgr.syncAttachedCardZone(uid, 'BATTLEFIELD', {
            slotIndex: undefined,
            isFaceUp: true,
            isReady: true,
            clearTransientState: true,
          });
          ascensionCard.underneathCardIds.push(uid);
        }
        this.zoneMgr.syncAttachedCardZone(extraId, 'BATTLEFIELD', {
          slotIndex: undefined,
          isFaceUp: true,
          isReady: true,
          clearTransientState: true,
        });
        ascensionCard.underneathCardIds.push(extraId);
      }
    }

    // BP01-040 额外升变代价：将我方战场 1 张《帕瓦》放置到该牌下方
    if (options?.extraStackRoleCardId && options.extraStackRoleCardId !== targetRoleCardId) {
      const extraCard = this.state.cards[options.extraStackRoleCardId];
      if (extraCard && this.isSlotRole(playerId, extraCard.instanceId)) {
        this.placeCardUnderneath(extraCard.instanceId, ascensionCardId, { actorPlayerId: playerId });
      }
    }

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
      underneathCardIds: [...ascensionCard.underneathCardIds],
    });
    this.onTriggerEventCallback?.({
      type: 'CARD_ENTERED_FIELD',
      playerId,
      cardInstanceId: ascensionCardId,
      fromZone,
      toZone: 'BATTLEFIELD',
      isAscension: true,
      suppressEntryTrigger: options?.suppressEntryTrigger,
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
   * 4.18 装备道具牌给角色 (从手牌/处理区/墓地直接装备视为出场；从战场独立装备改为装备不算出场，Q&A·4)
   */
  equipToRole(
    playerId: string,
    equipmentCardId: string,
    roleCardId: string,
    options?: { suppressEntryTrigger?: boolean }
  ): boolean {
    if (!this.canEquipToRole(playerId, equipmentCardId, roleCardId)) return false;
    const equipCard = this.state.cards[equipmentCardId]!;
    const roleCard = this.state.cards[roleCardId]!;
    const prevZone = equipCard.zone;
    const origSlotIdx = equipCard.slotIndex;

    const nextEqIds = [...getAttachedEquipmentIds(roleCard), equipmentCardId];
    const moved = this.zoneMgr.moveCard(equipmentCardId, 'BATTLEFIELD', {
      slotIndex: roleCard.slotIndex,
      isFaceUp: true,
      isReady: true,
      ...(prevZone === 'BATTLEFIELD' ? { skipLeftFieldTrigger: true } : {}),
    });
    if (!moved || equipCard.zone !== 'BATTLEFIELD') {
      return false;
    }

    // 如果装备牌原本单独占位，清空原卡位
    if (prevZone === 'BATTLEFIELD' && origSlotIdx !== undefined) {
      const origSlot = this.getSlots(playerId)[origSlotIdx];
      if (origSlot && origSlot.standaloneEquipmentId === equipmentCardId) {
        origSlot.standaloneEquipmentId = undefined;
      }
    }

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
    if (prevZone !== 'BATTLEFIELD') {
      this.onTriggerEventCallback?.({
        type: 'CARD_ENTERED_FIELD',
        playerId,
        cardInstanceId: equipmentCardId,
        fromZone: prevZone,
        toZone: 'BATTLEFIELD',
        isAscension: false,
        suppressEntryTrigger: options?.suppressEntryTrigger,
        subjectSnapshot: this.snapshotProvider?.(equipmentCardId),
      });
    }

    return true;
  }

  /**
   * 2.2.2.c.2 放置辅助机出场 (玩家战场最多存在1张辅助机)
   */
  playAssistCard(
    playerId: string,
    assistCardId: string,
    slotIndex: number,
    options?: {
      enterTapped?: boolean;
      enterAbilitiesLost?: boolean;
      sourceCardNumber?: string;
      suppressEntryTrigger?: boolean;
    }
  ): boolean {
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

    const fromZone = this.state.cards[assistCardId]?.zone;
    const moved = this.zoneMgr.moveCard(assistCardId, 'BATTLEFIELD', {
      slotIndex,
      isFaceUp: true,
      isReady: !options?.enterTapped,
    });
    const movedCard = this.state.cards[assistCardId];
    if (!moved || !movedCard || movedCard.zone !== 'BATTLEFIELD') {
      return false;
    }

    // 8.6.2.e.3 若已有辅助机（且当前有效类型仍为 ASSIST），将其置入墓地替换
    for (const slot of slots) {
      if (slot.assistCardId && isEffectiveAssist(slot.assistCardId)) {
        const oldAssistId = slot.assistCardId;
        slot.assistCardId = undefined;
        this.zoneMgr.moveCard(oldAssistId, 'GRAVEYARD', { isFaceUp: true });
      }
    }

    targetSlot.assistCardId = assistCardId;
    if (options?.enterAbilitiesLost) {
      addCardModifier(this.state, movedCard, {
        loseAbilities: true,
        untilTurn: undefined,
        source: options.sourceCardNumber ?? movedCard.cardNumber,
      });
    }

    this.events.push({
      type: 'CARD_PLAYED',
      playerId,
      cardInstanceId: assistCardId,
      slotIndex,
      isAscension: false,
    });
    this.onTriggerEventCallback?.({
      type: 'CARD_ENTERED_FIELD',
      playerId,
      cardInstanceId: assistCardId,
      fromZone,
      toZone: 'BATTLEFIELD',
      isAscension: false,
      suppressEntryTrigger: options?.suppressEntryTrigger,
      subjectSnapshot: this.snapshotProvider?.(assistCardId),
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

    const underIds = fromBattlefield ? [...card.underneathCardIds] : [];
    const eqIds = fromBattlefield ? getAttachedEquipmentIds(card) : [];

    card.isAirborne = true;
    const moved = this.zoneMgr.moveCard(cardInstanceId, 'PROCESSING', {
      isFaceUp: true,
      isReady: true,
      preserveAttachments: fromBattlefield,
    });
    if (!moved || card.zone !== 'PROCESSING') {
      card.isAirborne = undefined;
      return false;
    }

    if (fromBattlefield) {
      card.underneathCardIds = underIds;
      setAttachedEquipmentIds(card, eqIds);
      for (const id of [...underIds, ...eqIds]) {
        this.zoneMgr.syncAttachedCardZone(id, 'PROCESSING', { clearTransientState: true });
      }
    }
    this.zoneMgr.invalidateZoneCache();
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
    this.zoneMgr.invalidateZoneCache();
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

    const moved = this.zoneMgr.moveCard(airborne.instanceId, 'BATTLEFIELD', {
      slotIndex,
      isFaceUp: true,
      isReady: true,
      preserveAttachments: true,
    });
    if (!moved || airborne.zone !== 'BATTLEFIELD') {
      return undefined;
    }

    const slot = this.getSlots(playerId)[slotIndex]!;
    slot.roleCardId = airborne.instanceId;
    airborne.underneathCardIds = underIds;
    setAttachedEquipmentIds(airborne, eqIds);
    for (const id of underIds) {
      this.zoneMgr.syncAttachedCardZone(id, 'BATTLEFIELD');
    }
    for (const eqId of eqIds) {
      this.zoneMgr.syncAttachedCardZone(eqId, 'BATTLEFIELD', {
        slotIndex,
        isFaceUp: true,
        isReady: true,
      });
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
   * 统一将指定卡牌置入战场目标角色下方 (经过 ZoneManager.moveCard + 8.10 置换拦截，禁止直写 zone)
   */
  placeCardUnderneath(
    cardInstanceId: string,
    hostCardId: string,
    options?: {
      includeUnderneath?: boolean;
      actorPlayerId?: string;
      appliedReplacementIds?: Set<string>;
      preferredReplacementId?: string;
    }
  ): boolean {
    const card = this.state.cards[cardInstanceId];
    const host = this.state.cards[hostCardId];
    if (!card || !host || host.zone !== 'BATTLEFIELD' || host.instanceId === cardInstanceId) {
      return false;
    }

    // 1.3.3 / Q&A·10：禁止因效果或我方效果置入角色下方 (BP04-002/003/005/008)
    const prohibitions = this.evaluateRoleStats(cardInstanceId).prohibitions;
    if (prohibitions.includes('CANNOT_BE_PLACED_UNDERNEATH')) return false;
    if (
      options?.actorPlayerId &&
      card.controllerPlayerId === options.actorPlayerId &&
      prohibitions.includes('CANNOT_BE_PLACED_UNDERNEATH_BY_SELF')
    ) {
      return false;
    }

    const wasTopLevelField =
      card.zone === 'BATTLEFIELD' && this.isTopLevelFieldCard(card.controllerPlayerId, cardInstanceId);
    const carriedUnderIds = options?.includeUnderneath ? [...(card.underneathCardIds ?? [])] : [];

    const moved = this.zoneMgr.moveCard(cardInstanceId, 'BATTLEFIELD', {
      isFaceUp: true,
      isReady: true,
      isPlacingUnderneath: true,
      underneathHostId: hostCardId,
      includeUnderneath: options?.includeUnderneath,
      preserveAttachments: false,
      appliedReplacementIds: options?.appliedReplacementIds,
      preferredReplacementId: options?.preferredReplacementId,
      skipLeftFieldTrigger: !wasTopLevelField,
    });
    if (!moved || card.zone !== 'BATTLEFIELD') {
      return false;
    }

    if (card.controllerPlayerId !== host.controllerPlayerId) {
      card.controllerPlayerId = host.controllerPlayerId;
      this.zoneMgr.invalidateZoneCache();
    }
    card.slotIndex = undefined;
    if (options?.includeUnderneath) {
      card.underneathCardIds = [];
    }
    if (!host.underneathCardIds.includes(cardInstanceId)) {
      host.underneathCardIds.push(cardInstanceId);
    }

    for (const carriedId of carriedUnderIds) {
      const cc = this.state.cards[carriedId];
      if (!cc || carriedId === host.instanceId) continue;
      this.zoneMgr.syncAttachedCardZone(carriedId, 'BATTLEFIELD', {
        slotIndex: undefined,
        controllerPlayerId: host.controllerPlayerId,
        isFaceUp: true,
        isReady: true,
        clearTransientState: true,
      });
      if (!host.underneathCardIds.includes(carriedId)) {
        host.underneathCardIds.push(carriedId);
      }
    }

    return true;
  }

  /**
   * Q&A·8 / Q&A·9 检查当前协战搭档是否处于「不会解除协战状态」保护中
   */
  isPartnerProtectedFromRelease(hostRoleCardId: string): boolean {
    const host = this.state.cards[hostRoleCardId];
    if (!host || !host.partnerCardId) return false;
    const partnerId = host.partnerCardId;
    const partner = this.state.cards[partnerId];
    if (!partner) return false;
    if (
      partner.cannotReleasePartnerUntilTurn !== undefined &&
      partner.cannotReleasePartnerUntilTurn >= this.state.turnNumber
    ) {
      return true;
    }
    if (
      partner.cardNumber === 'BP04-038' &&
      partner.turnEnteredZone === this.state.turnNumber &&
      !this.continuousEffects?.hasLostInherentAbilities(partnerId) &&
      (this.state.players[host.controllerPlayerId]?.eliminatedOrbsByKareninaCountThisTurn ?? 0) > 0
    ) {
      return true;
    }
    return false;
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

    // Q&A·8 / Q&A·9：若当前搭档「不会解除协战状态」，则获得新搭档的行动改为不执行
    if (host.partnerCardId && host.partnerCardId !== partnerCardId && this.isPartnerProtectedFromRelease(hostRoleCardId)) {
      return false;
    }

    const prevZone = partner.zone;
    const fromDeck = prevZone === 'DECK';

    const moved = this.zoneMgr.moveCard(partnerCardId, 'BATTLEFIELD', {
      slotIndex: host.slotIndex,
      isFaceUp: true,
      isReady: true,
      skipLeftFieldTrigger: true,
      resetStateOnSameZone: true,
    });
    if (!moved || partner.zone !== 'BATTLEFIELD') {
      return false;
    }

    // 8.13.2.a.2 / 8.13.4.c.3 已有搭档时解除原搭档并置入墓地
    if (host.partnerCardId && host.partnerCardId !== partnerCardId) {
      this.releasePartner(hostRoleCardId, false);
    }

    partner.partnerOfCardId = hostRoleCardId;
    partner.releasePartnerToDeckBottom = options?.releaseToDeckBottom || undefined;
    host.partnerCardId = partnerCardId;

    // ST06-002 坠落与新生 塞西莉【协战永】：从手牌成为《坠落与新生 亚里莎·回音》协战搭档的回合中，不会解除协战状态
    if (
      prevZone === 'HAND' &&
      partner.cardNumber === 'ST06-002' &&
      !this.continuousEffects?.hasLostInherentAbilities(partner.instanceId) &&
      this.continuousEffects?.hasCardName(hostRoleCardId, '坠落与新生 亚里莎·回音')
    ) {
      partner.cannotReleasePartnerUntilTurn = this.state.turnNumber;
    }

    if (fromDeck) {
      // 8.13.3.b.3 从牌组选择搭档后洗切牌组
      this.zoneMgr.shuffleDeck(playerId);
    }

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
    if (!force && this.isPartnerProtectedFromRelease(hostRoleCardId)) {
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
