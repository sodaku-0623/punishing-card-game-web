import { CardVersionData } from '@zhanshuang/shared';
import { MemoryCardDatabase, OFFICIAL_CARDS_DATA } from '@zhanshuang/game-engine';
import { validateDeck, DeckCardInput, findOfficialStarterDeck } from '@zhanshuang/game-rules';

/** 官方卡牌全集 (引擎内置卡表，与 Node 服务端使用同一份数据) */
export const OFFICIAL_CARD_DB = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);

const MAX_CUSTOM_DECK_ENTRIES = 200;

/**
 * 按卡牌 ID、卡号或前端变体 ID (如 "c-st01-001_ST01-R_ST01-001R★") 查找卡牌
 */
export function findOfficialCard(idOrNumber?: string): CardVersionData | undefined {
  if (!idOrNumber || typeof idOrNumber !== 'string') return undefined;
  const direct = OFFICIAL_CARD_DB.getCard(idOrNumber);
  if (direct) return direct;
  const match = idOrNumber.match(/([A-Z]{2,}\d*-\d+)/i);
  return match ? OFFICIAL_CARD_DB.getCard(match[1]!.toUpperCase()) : undefined;
}

export interface ResolvedDeck {
  id: string;
  name: string;
  isOfficial: boolean;
  /** 展开后的 50 张卡号序列 */
  cardNumbers: string[];
  /** 与 cardNumbers 一一对应的卡图 (异画选择) */
  imageUrls: string[];
}

/**
 * 解析玩家出战卡组。
 * - 官方预组：一律使用服务端权威卡表，忽略客户端上传内容；
 * - 自定义卡组：每张卡必须存在于官方卡表，并通过 5.1 构筑规则校验。
 */
export function resolveDeck(deckId: unknown, customDeck: any): { deck?: ResolvedDeck; error?: string } {
  const requestedId = typeof deckId === 'string' ? deckId : '';
  const official = findOfficialStarterDeck(requestedId) ?? findOfficialStarterDeck(customDeck?.id);
  if (official) {
    const cardNumbers: string[] = [];
    const imageUrls: string[] = [];
    for (const entry of official.cards) {
      for (let i = 0; i < entry.count; i++) {
        cardNumbers.push(entry.cardNumber);
        imageUrls.push(entry.imageUrl);
      }
    }
    return { deck: { id: official.id, name: official.name, isOfficial: true, cardNumbers, imageUrls } };
  }

  if (!customDeck || !Array.isArray(customDeck.cards) || customDeck.cards.length === 0) {
    return { error: '请选择出战卡组' };
  }
  if (customDeck.cards.length > MAX_CUSTOM_DECK_ENTRIES) {
    return { error: '自定义卡组条目数量异常' };
  }

  const validationInput: DeckCardInput[] = [];
  const cardNumbers: string[] = [];
  const imageUrls: string[] = [];
  for (const item of customDeck.cards) {
    const card = findOfficialCard(item?.cardNumber) ?? findOfficialCard(item?.cardId);
    if (!card) {
      return { error: `自定义卡组包含未知卡牌: ${item?.cardNumber || item?.cardId || '(空)'}` };
    }
    const count = Math.floor(Number(item.count));
    if (!Number.isFinite(count) || count <= 0) {
      return { error: `卡牌 ${card.name} (${card.cardNumber}) 数量非法` };
    }
    validationInput.push({
      cardId: card.id,
      cardNumber: card.cardNumber,
      name: card.name,
      signalOrb: card.signalOrb,
      count,
    });
    const imageUrl =
      typeof item.imageUrl === 'string' && item.imageUrl.startsWith('/cards/') ? item.imageUrl : card.imageUrl ?? '';
    for (let i = 0; i < count; i++) {
      cardNumbers.push(card.cardNumber);
      imageUrls.push(imageUrl);
    }
  }

  const validation = validateDeck(validationInput);
  if (!validation.isValid) {
    return { error: `卡组不符合构筑规则：${validation.errors.join('；')}` };
  }

  return {
    deck: {
      id: String(customDeck.id || requestedId || 'custom-deck').slice(0, 128),
      name: String(customDeck.name || '自定义构筑卡组').slice(0, 64),
      isOfficial: false,
      cardNumbers,
      imageUrls,
    },
  };
}
