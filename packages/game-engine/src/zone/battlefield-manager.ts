import {
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
   * 是否为该玩家战场卡位上的角色 (不含升变垫在下方的牌、装备中的装备牌)
   */
  isSlotRole(playerId: string, cardInstanceId: string | undefined): boolean {
    if (!cardInstanceId) return false;
    return this.getSlots(playerId).some((s) => s.roleCardId === cardInstanceId);
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
  playRoleCard(playerId: string, cardInstanceId: string, slotIndex: number): boolean {
    const slot = this.getSlots(playerId)[slotIndex];
    if (!slot || slot.roleCardId || slot.standaloneEquipmentId || slot.assistCardId) {
      return false; // 卡位已被占用
    }

    const fromZone = this.state.cards[cardInstanceId]?.zone;
    slot.roleCardId = cardInstanceId;
    this.zoneMgr.moveCard(cardInstanceId, 'BATTLEFIELD', {
      slotIndex,
      isFaceUp: true,
      isReady: true,
    });

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
    } else if (targetCard.zone === 'PROCESSING' && targetCard.isAirborne) {
      slotIndex = options?.targetSlotIndex ?? this.findFirstEmptySlot(playerId);
      if (slotIndex === undefined) return false;
      const chosenSlot = this.getSlots(playerId)[slotIndex];
      if (!chosenSlot || chosenSlot.roleCardId || chosenSlot.standaloneEquipmentId || chosenSlot.assistCardId) {
        return false;
      }
      targetCard.isAirborne = undefined;
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

    // 8.11.3.f.1 升变对象及其下方原本的卡牌将保留在升变出场的卡牌下方
    const stackedCardIds = [...targetCard.underneathCardIds, targetRoleCardId];
    for (const underId of targetCard.underneathCardIds) {
      const uc = this.state.cards[underId];
      if (uc) {
        uc.zone = 'BATTLEFIELD';
        uc.slotIndex = undefined;
      }
    }

    // 8.11.3.f.2 升变对象原本的装备将保留并成为升变出场的卡牌的装备
    if (targetCard.attachedEquipmentId) {
      const eqCard = this.state.cards[targetCard.attachedEquipmentId];
      if (eqCard) {
        eqCard.zone = 'BATTLEFIELD';
        eqCard.slotIndex = slotIndex;
      }
      ascensionCard.attachedEquipmentId = targetCard.attachedEquipmentId;
      targetCard.attachedEquipmentId = undefined;
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
        const extraOrphans = [...extraCard.underneathCardIds];
        if (extraCard.attachedEquipmentId) extraOrphans.push(extraCard.attachedEquipmentId);
        extraCard.underneathCardIds = [];
        extraCard.attachedEquipmentId = undefined;
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
   * 4.18 装备道具牌给角色
   */
  equipToRole(playerId: string, equipmentCardId: string, roleCardId: string): boolean {
    const equipCard = this.state.cards[equipmentCardId];
    const roleCard = this.state.cards[roleCardId];
    if (!equipCard || !roleCard) return false;
    if (equipCard.controllerPlayerId !== playerId) return false;
    if (!this.isSlotRole(playerId, roleCardId)) return false;

    // 4.18.3 每张角色只能装备最多1张装备牌
    if (roleCard.attachedEquipmentId) return false;

    // 如果装备牌原本单独占位，清空原卡位
    if (equipCard.zone === 'BATTLEFIELD' && equipCard.slotIndex !== undefined) {
      const origSlot = this.getSlots(playerId)[equipCard.slotIndex];
      if (origSlot && origSlot.standaloneEquipmentId === equipmentCardId) {
        origSlot.standaloneEquipmentId = undefined;
      }
    }

    roleCard.attachedEquipmentId = equipmentCardId;
    this.zoneMgr.moveCard(equipmentCardId, 'BATTLEFIELD', {
      slotIndex: roleCard.slotIndex,
      isFaceUp: true,
      isReady: true,
    });

    this.events.push({
      type: 'CARD_EQUIPPED',
      equipmentCardId,
      roleCardId,
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
    // 8.6.2.e.3 只能放置到空余卡位，或替换原有辅助机所占的卡位
    if (targetSlot.roleCardId || targetSlot.standaloneEquipmentId) return false;

    // 8.6.2.e.3 若已有辅助机，可将其置入墓地替换
    for (const slot of slots) {
      if (slot.assistCardId) {
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

    // 4.18.6 装备角色离开战场时，其装备牌因规则处理 (9.6) 放置到墓地 (允许 BP04-065 等置换效果拦截)
    if (card.attachedEquipmentId) {
      const eqId = card.attachedEquipmentId;
      card.attachedEquipmentId = undefined;
      this.zoneMgr.moveCard(eqId, 'GRAVEYARD', {
        isFaceUp: true,
        isOrphanCleanup: true,
        orphanHostCardId: cardInstanceId,
      });
    }

    // 8.13.4.a.3 协战角色离开战场时，其搭档因规则放置到墓地 (不视为离场)
    if (card.partnerCardId) {
      this.releasePartner(cardInstanceId, true);
    }
  }

  /**
   * 10.18 将战场角色【浮空】到处理区成为【浮空模式】
   * - 10.18.2.a 每位玩家处理区最多 1 张浮空模式卡牌；已存在时不执行并返回 false
   * - 10.18.2.b / 10.18.2.d.3 下方的卡牌与装备保持不变一同移动，但它们不视为浮空模式/处理区牌
   */
  airborneRole(cardInstanceId: string): boolean {
    const card = this.state.cards[cardInstanceId];
    if (!card || !this.isSlotRole(card.controllerPlayerId, cardInstanceId)) {
      return false;
    }
    const playerId = card.controllerPlayerId;
    const existingAirborne = this.zoneMgr
      .getCardsInZone(playerId, 'PROCESSING')
      .some((c) => c.isAirborne === true);
    if (existingAirborne) {
      return false;
    }

    // 8.13.4.a.3 若处于协战状态，离场前先解除协战并将搭档置入墓地
    if (card.partnerCardId) {
      this.releasePartner(cardInstanceId, true);
    }

    const underIds = [...card.underneathCardIds];
    const eqId = card.attachedEquipmentId;

    for (const slot of this.getSlots(playerId)) {
      if (slot.roleCardId === cardInstanceId) {
        slot.roleCardId = undefined;
      }
    }

    card.isAirborne = true;
    const moved = this.zoneMgr.moveCard(cardInstanceId, 'PROCESSING', {
      isFaceUp: true,
      isReady: true,
      preserveAttachments: true,
    });
    if (!moved) {
      card.isAirborne = undefined;
      return false;
    }

    card.underneathCardIds = underIds;
    card.attachedEquipmentId = eqId;
    for (const id of [...underIds, ...(eqId ? [eqId] : [])]) {
      const sub = this.state.cards[id];
      if (sub) {
        sub.zone = 'PROCESSING';
        sub.slotIndex = undefined;
        sub.modifiers = undefined;
        sub.isFrozen = undefined;
        sub.isAirborne = undefined;
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
    const eqId = airborne.attachedEquipmentId;
    const slotIndex = this.findFirstEmptySlot(playerId);

    if (slotIndex === undefined) {
      // 10.18.2.e 没有空余卡位，本体与下方/装备卡牌一并置入墓地
      this.zoneMgr.moveCard(airborne.instanceId, 'GRAVEYARD', { isFaceUp: true });
      for (const id of [...underIds, ...(eqId ? [eqId] : [])]) {
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
    airborne.attachedEquipmentId = eqId;
    for (const id of underIds) {
      const uc = this.state.cards[id];
      if (uc) {
        uc.zone = 'BATTLEFIELD';
        uc.slotIndex = undefined;
      }
    }
    if (eqId && this.state.cards[eqId]) {
      const eq = this.state.cards[eqId]!;
      eq.zone = 'BATTLEFIELD';
      eq.slotIndex = slotIndex;
      eq.isFaceUp = true;
      eq.isReady = true;
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
  attachPartner(playerId: string, hostRoleCardId: string, partnerCardId: string): boolean {
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
      const oldEq = partner.attachedEquipmentId;
      partner.underneathCardIds = [];
      partner.attachedEquipmentId = undefined;
      for (const oid of oldUnder) {
        if (this.state.cards[oid]?.zone === 'BATTLEFIELD') {
          this.zoneMgr.moveCard(oid, 'GRAVEYARD', {
            isFaceUp: true,
            isOrphanCleanup: true,
            orphanHostCardId: partnerCardId,
          });
        }
      }
      if (oldEq && this.state.cards[oldEq]?.zone === 'BATTLEFIELD') {
        this.zoneMgr.moveCard(oldEq, 'GRAVEYARD', {
          isFaceUp: true,
          isOrphanCleanup: true,
          orphanHostCardId: partnerCardId,
        });
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
    partner.attachedEquipmentId = undefined;
    partner.partnerOfCardId = hostRoleCardId;
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
      partner?.cannotReleasePartnerUntilTurn !== undefined &&
      partner.cannotReleasePartnerUntilTurn >= this.state.turnNumber
    ) {
      return false;
    }

    host.partnerCardId = undefined;
    if (partner) {
      partner.partnerOfCardId = undefined;
      partner.cannotReleasePartnerUntilTurn = undefined;
      if (partner.zone === 'BATTLEFIELD') {
        this.zoneMgr.moveCard(partnerId, 'GRAVEYARD', {
          isFaceUp: true,
          skipLeftFieldTrigger: true,
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
      };
    }
    const cardDef = (card.cardId ? this.cardDb.getCard(card.cardId) : undefined) || this.cardDb.getCard(card.cardNumber);
    let pp = cardDef?.basePP ?? 0;
    if (card.attachedEquipmentId) {
      const eqCard = this.state.cards[card.attachedEquipmentId];
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
