import { SignalOrbType } from '@zhanshuang/shared';
import { RULE_CONSTANTS } from '../constants/rules.js';

export interface DeckCardInput {
  cardId: string;
  cardNumber: string; // 如 "BP01-001" 或带变体后缀 "BP01-001a"
  name: string;
  signalOrb?: SignalOrbType;
  count: number;
}

export interface DeckValidationResult {
  isValid: boolean;
  errors: string[];
  totalCards: number;
  redOrbCount: number;
  blueOrbCount: number;
  yellowOrbCount: number;
  cardCopies: Record<string, number>;
}

/**
 * 提取核心卡牌编号 (2.7.3 部分卡牌编号末尾会记述有小写字母 a、b、c等。该部分不视为卡牌编号)
 * 注意：必须严格匹配小写字母，不能大小写无关匹配，避免误删类似 ORB-RED 的大写标识
 */
export function extractCoreCardNumber(cardNumber: string): string {
  return cardNumber.replace(/[a-z]+$/, '').trim();
}

/**
 * 牌组合法性严格检验 (5.1 牌组的准备)
 */
export function validateDeck(deckCards: DeckCardInput[]): DeckValidationResult {
  const errors: string[] = [];
  let totalCards = 0;
  let redOrbCount = 0;
  let blueOrbCount = 0;
  let yellowOrbCount = 0;
  const cardCopies: Record<string, number> = {};

  for (const card of deckCards) {
    if (card.count <= 0) {
      errors.push(`卡牌 ${card.name} (${card.cardNumber}) 数量非法: ${card.count}`);
      continue;
    }

    totalCards += card.count;

    // 统计信号球 (5.1.2.c)
    if (card.signalOrb === SignalOrbType.RED) {
      redOrbCount += card.count;
    } else if (card.signalOrb === SignalOrbType.BLUE) {
      blueOrbCount += card.count;
    } else if (card.signalOrb === SignalOrbType.YELLOW) {
      yellowOrbCount += card.count;
    }

    // 统计同编号卡牌 (5.1.2.b)
    const coreNumber = extractCoreCardNumber(card.cardNumber);
    cardCopies[coreNumber] = (cardCopies[coreNumber] ?? 0) + card.count;
  }

  // 1. 检查总张数是否刚好 50 张 (5.1.2.a)
  if (totalCards !== RULE_CONSTANTS.DECK_EXACT_SIZE) {
    errors.push(
      `牌组必须由刚好 ${RULE_CONSTANTS.DECK_EXACT_SIZE} 张卡牌构成，当前总数为 ${totalCards} 张`
    );
  }

  // 2. 检查同一编号卡牌是否超过 4 张 (5.1.2.b)
  for (const [coreNumber, count] of Object.entries(cardCopies)) {
    if (count > RULE_CONSTANTS.MAX_COPIES_PER_CARD) {
      errors.push(
        `同一卡牌编号 [${coreNumber}] 在牌组中不得超过 ${RULE_CONSTANTS.MAX_COPIES_PER_CARD} 张，当前投入了 ${count} 张`
      );
    }
  }

  // 3. 检查信号球硬性构成 (5.1.2.c: 各4张)
  if (redOrbCount !== RULE_CONSTANTS.REQUIRED_SIGNAL_ORBS_EACH) {
    errors.push(
      `牌组必须且只能投入 ${RULE_CONSTANTS.REQUIRED_SIGNAL_ORBS_EACH} 张 <信号球·红>，当前有 ${redOrbCount} 张`
    );
  }
  if (blueOrbCount !== RULE_CONSTANTS.REQUIRED_SIGNAL_ORBS_EACH) {
    errors.push(
      `牌组必须且只能投入 ${RULE_CONSTANTS.REQUIRED_SIGNAL_ORBS_EACH} 张 <信号球·蓝>，当前有 ${blueOrbCount} 张`
    );
  }
  if (yellowOrbCount !== RULE_CONSTANTS.REQUIRED_SIGNAL_ORBS_EACH) {
    errors.push(
      `牌组必须且只能投入 ${RULE_CONSTANTS.REQUIRED_SIGNAL_ORBS_EACH} 张 <信号球·黄>，当前有 ${yellowOrbCount} 张`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    totalCards,
    redOrbCount,
    blueOrbCount,
    yellowOrbCount,
    cardCopies,
  };
}
