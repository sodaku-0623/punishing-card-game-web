import { CardVersionData } from '@zhanshuang/shared';
import { MemoryCardDatabase, OFFICIAL_CARDS_DATA } from '@zhanshuang/game-engine';
import { validateDeck, DeckCardInput, findOfficialStarterDeck } from '@zhanshuang/game-rules';
import { initializeDatabase } from './db-client.js';

/** 官方卡牌全集 (引擎内置卡表，与 Node 服务端使用同一份数据) */
export const OFFICIAL_CARD_DB = new MemoryCardDatabase(OFFICIAL_CARDS_DATA);

export const MAX_CUSTOM_DECK_ENTRIES = 200;

/**
 * 校验自定义卡组条目列表的基础结构（用于草稿保存与构筑校验共享）
 */
export function validateDeckCardEntriesShape(cards: unknown): string | null {
  if (!Array.isArray(cards)) return '卡牌列表格式不正确';
  if (cards.length > MAX_CUSTOM_DECK_ENTRIES) return '自定义卡组条目数量异常';
  for (const item of cards) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return '自定义卡组条目格式不正确';
    }
    const count = (item as { count?: unknown }).count;
    if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) {
      return '卡牌数量必须为正整数';
    }
  }
  return null;
}

/**
 * 按卡牌 ID、卡号或前端变体 ID (如 "c-st01-001_ST01-R_ST01-001R★") 查找卡牌
 */
export function findOfficialCard(idOrNumber?: string): CardVersionData | undefined {
  if (!idOrNumber || typeof idOrNumber !== 'string') return undefined;
  const direct = OFFICIAL_CARD_DB.getCard(idOrNumber);
  if (direct) return direct;
  const championMatch = idOrNumber.match(/([A-Z]{2,}\d*-\d+)(?:【冠军】|-champion)/i);
  if (championMatch) {
    const champCard = OFFICIAL_CARD_DB.getCard(`${championMatch[1]!.toUpperCase()}【冠军】`);
    if (champCard) return champCard;
  }
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
  const requestedId = typeof deckId === 'string' ? deckId.trim() : '';
  const customObj = customDeck && typeof customDeck === 'object' && !Array.isArray(customDeck) ? customDeck : null;
  const official = findOfficialStarterDeck(requestedId) ?? findOfficialStarterDeck(customObj?.id);
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

  if (!customObj || !Array.isArray(customObj.cards) || customObj.cards.length === 0) {
    return { error: '请选择出战卡组' };
  }
  if (customObj.cards.length > MAX_CUSTOM_DECK_ENTRIES) {
    return { error: '自定义卡组条目数量异常' };
  }

  const validationInput: DeckCardInput[] = [];
  const cardNumbers: string[] = [];
  const imageUrls: string[] = [];
  for (const item of customObj.cards) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { error: '自定义卡组条目格式不正确' };
    }
    const card = findOfficialCard(item.cardNumber) ?? findOfficialCard(item.cardId);
    if (!card) {
      return { error: `自定义卡组包含未知卡牌: ${item.cardNumber || item.cardId || '(空)'}` };
    }
    if (typeof item.count !== 'number' || !Number.isInteger(item.count) || item.count <= 0) {
      return { error: `卡牌 ${card.name} (${card.cardNumber}) 数量非法` };
    }
    const count = item.count;
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

  const customName =
    typeof customObj.name === 'string' && customObj.name.trim() ? customObj.name.trim() : '自定义构筑卡组';
  const customId =
    typeof customObj.id === 'string' && customObj.id.trim()
      ? customObj.id.trim()
      : requestedId || 'custom-deck';

  return {
    deck: {
      id: customId.slice(0, 128),
      name: customName.slice(0, 64),
      isOfficial: false,
      cardNumbers,
      imageUrls,
    },
  };
}

export interface ResolveDeckD1Options {
  db?: D1Database;
  userId?: string;
  isGuest?: boolean;
  adminPassword?: string;
}

/**
 * 解析玩家出战卡组（支持已登录用户从 D1 回查本人同步的自定义卡组）：
 * - 优先使用官方预组或客户端自带的有效 customDeck.cards；
 * - 仅当未命中官方预组、未传有效 customDeck.cards、存在 requestedId 且为已登录用户时，
 *   按 (id, user_id) 联合查询 D1 并重新走 5.1 构筑规则校验。
 */
export async function resolveDeckWithD1(
  deckId: unknown,
  customDeck: any,
  options: ResolveDeckD1Options = {}
): Promise<{ deck?: ResolvedDeck; error?: string }> {
  const requestedId = typeof deckId === 'string' ? deckId.trim() : '';
  const customObj = customDeck && typeof customDeck === 'object' && !Array.isArray(customDeck) ? customDeck : null;
  const hasCustomCards = Array.isArray(customObj?.cards) && customObj.cards.length > 0;

  const direct = resolveDeck(requestedId, customDeck);
  if (direct.deck || hasCustomCards || findOfficialStarterDeck(requestedId) || findOfficialStarterDeck(customObj?.id)) {
    return direct;
  }

  if (requestedId && !options.isGuest && options.db && options.userId) {
    await initializeDatabase(options.db, options.adminPassword);
    const row = await options.db
      .prepare('SELECT id, user_id, name, cards_json FROM decks WHERE id = ? AND user_id = ?')
      .bind(requestedId, options.userId)
      .first<{ id: string; user_id: string; name: string; cards_json: string }>();

    if (row) {
      let cards: unknown = null;
      try {
        cards = JSON.parse(row.cards_json);
      } catch {
        return { error: '已保存卡组的数据格式异常，请重新编辑保存' };
      }
      if (!Array.isArray(cards) || cards.length === 0) {
        return { error: '该卡组尚未配置卡牌，请先完善卡组构筑' };
      }
      return resolveDeck(undefined, { id: row.id, name: row.name, cards });
    }
  }

  return direct;
}
