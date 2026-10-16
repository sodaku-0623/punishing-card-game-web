import {
  GameState,
  GameEvent,
  BattlefieldSlot,
} from '@zhanshuang/shared';
import { ICardDatabase } from '../database/card-registry.js';
import { ZoneManager } from './zone-manager.js';

export class BattlefieldManager {
  /** 永久能力带来的 PP 增减 (8.9.1.c)，由卡牌效果引擎提供 */
  private staticPPProvider?: (cardInstanceId: string) => number;

  setStaticPPProvider(provider: (cardInstanceId: string) => number): void {
    this.staticPPProvider = provider;
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
   * 将手牌中的升变卡重叠在升变对象上方出场
   */
  playAscensionCard(
    playerId: string,
    ascensionCardId: string,
    targetRoleCardId: string
  ): boolean {
    const targetCard = this.state.cards[targetRoleCardId];
    if (!targetCard || targetCard.controllerPlayerId !== playerId || targetCard.zone !== 'BATTLEFIELD') {
      return false;
    }

    const slotIndex = targetCard.slotIndex;
    if (slotIndex === undefined) return false;

    const slot = this.getSlots(playerId)[slotIndex];
    if (!slot || slot.roleCardId !== targetRoleCardId) return false;

    const ascensionCard = this.state.cards[ascensionCardId];
    if (!ascensionCard) return false;

    // 先将升变卡放置到卡位 (移动区域会重置卡牌状态，下方卡牌与装备须在移动之后再挂接)
    slot.roleCardId = ascensionCardId;
    this.zoneMgr.moveCard(ascensionCardId, 'BATTLEFIELD', {
      slotIndex,
      isFaceUp: true,
      isReady: true,
    });

    // 8.11.3.f.1 升变对象及其下方原本的卡牌将保留在升变出场的卡牌下方
    const stackedCardIds = [...targetCard.underneathCardIds, targetRoleCardId];
    ascensionCard.underneathCardIds = stackedCardIds;

    // 8.11.3.f.2 升变对象原本的装备将保留并成为升变出场的卡牌的装备
    if (targetCard.attachedEquipmentId) {
      ascensionCard.attachedEquipmentId = targetCard.attachedEquipmentId;
      targetCard.attachedEquipmentId = undefined;
    }

    // 8.11.4.c 升变对象原本的卡牌状态不继承；作为下方的牌，其临时效果也不再适用 (3.2.6)
    targetCard.tempPPBonus = undefined;
    targetCard.tempDPBonus = undefined;
    targetCard.grantedKeywords = undefined;

    // 8.11.2.c 执行升变能力：获得升变能力中记述的关键字 (如【速攻】、【突进】)
    const ascensionDef =
      this.cardDb.getCard(ascensionCard.cardNumber) ||
      (ascensionCard.cardId ? this.cardDb.getCard(ascensionCard.cardId) : undefined);
    const grantKeywords = ascensionDef?.ascensionConfig?.grantKeywords ?? [];
    if (grantKeywords.length > 0) {
      ascensionCard.grantedKeywords = [...new Set([...(ascensionCard.grantedKeywords ?? []), ...grantKeywords])];
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
      for (const underneathId of card.underneathCardIds) {
        this.zoneMgr.moveCard(underneathId, 'GRAVEYARD', { isFaceUp: true });
      }
      card.underneathCardIds = [];
    }

    // 4.18.6 装备角色离开战场时，其装备牌因规则处理 (9.6) 放置到墓地
    if (card.attachedEquipmentId) {
      const eqId = card.attachedEquipmentId;
      card.attachedEquipmentId = undefined;
      this.zoneMgr.moveCard(eqId, 'GRAVEYARD', { isFaceUp: true });
    }
  }

  /**
   * 计算角色当前有效 PP (8.9 持续效果层级计算 Layer 1 + 装备 4.18.2 + 临时加成)
   */
  calculateRoleEffectivePP(cardInstanceId: string): number {
    const card = this.state.cards[cardInstanceId];
    if (!card) return 0;

    const cardDef = (card.cardId ? this.cardDb.getCard(card.cardId) : undefined) || this.cardDb.getCard(card.cardNumber);
    let pp = cardDef?.basePP ?? 0;

    // 4.18.2 装备角色的PP会增加其装备牌的基本PP数值
    if (card.attachedEquipmentId) {
      const eqCard = this.state.cards[card.attachedEquipmentId];
      if (eqCard) {
        const eqDef = this.cardDb.getCard(eqCard.cardNumber);
        pp += eqDef?.basePP ?? 0;
      }
    }

    // 临时加成与带期限的持续效果 (8.9.1.c)
    if (card.tempPPBonus) {
      pp += card.tempPPBonus;
    }
    for (const m of card.modifiers ?? []) {
      pp += m.pp ?? 0;
    }
    pp += this.staticPPProvider?.(cardInstanceId) ?? 0;

    return pp;
  }

  /**
   * 计算角色当前有效 DP (2.9 & 8.9.1.c)
   */
  calculateRoleEffectiveDP(cardInstanceId: string): number {
    const card = this.state.cards[cardInstanceId];
    if (!card) return 0;

    const cardDef = (card.cardId ? this.cardDb.getCard(card.cardId) : undefined) || this.cardDb.getCard(card.cardNumber);
    let dp = cardDef?.baseDP ?? 0;
    if (card.tempDPBonus) {
      dp += card.tempDPBonus;
    }
    for (const m of card.modifiers ?? []) {
      dp += m.dp ?? 0;
    }
    return Math.max(0, dp);
  }
}
