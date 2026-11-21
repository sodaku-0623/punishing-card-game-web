/**
 * 卡牌效果实现精确度登记表 (docs/future-work.md §3.6)。
 *
 * - EXACT: 已按官方卡牌文本逐卡在声明式效果库中精确实现 (含 ST01~ST06 全部 83 张官方预组牌)
 * - VANILLA: 无规则文本的白板卡牌，无需效果解析
 * - APPROXIMATE: 尚处于按关键字匹配的近似实现阶段，前端应向玩家给出明确标记
 */
export type CardImplementationStatus = 'EXACT' | 'VANILLA' | 'APPROXIMATE';

export const EXACT_IMPLEMENTED_CARD_LIST: readonly string[] = [
  // ST01 灰鸦小队 (14 张)
  'ST01-001',
  'ST01-002',
  'ST01-003',
  'ST01-004',
  'ST01-005',
  'ST01-006',
  'ST01-007',
  'ST01-008',
  'ST01-009',
  'ST01-010',
  'ST01-011',
  'ST01-012',
  'ST01-013',
  'ST01-014',
  // ST02 升格者 (14 张)
  'ST02-001',
  'ST02-002',
  'ST02-003',
  'ST02-004',
  'ST02-005',
  'ST02-006',
  'ST02-007',
  'ST02-008',
  'ST02-009',
  'ST02-010',
  'ST02-011',
  'ST02-012',
  'ST02-013',
  'ST02-014',
  // ST03 三头犬小队 (14 张)
  'ST03-001',
  'ST03-002',
  'ST03-003',
  'ST03-004',
  'ST03-005',
  'ST03-006',
  'ST03-007',
  'ST03-008',
  'ST03-009',
  'ST03-010',
  'ST03-011',
  'ST03-012',
  'ST03-013',
  'ST03-014',
  // ST04 突击鹰小队 (14 张)
  'ST04-001',
  'ST04-002',
  'ST04-003',
  'ST04-004',
  'ST04-005',
  'ST04-006',
  'ST04-007',
  'ST04-008',
  'ST04-009',
  'ST04-010',
  'ST04-011',
  'ST04-012',
  'ST04-013',
  'ST04-014',
  // ST05 清洁部队 (13 张)
  'ST05-001',
  'ST05-002',
  'ST05-003',
  'ST05-004',
  'ST05-005',
  'ST05-006',
  'ST05-007',
  'ST05-008',
  'ST05-009',
  'ST05-010',
  'ST05-011',
  'ST05-012',
  'ST05-013',
  // ST06 亚里莎·回音 & 塞西莉 (14 张)
  'ST06-001',
  'ST06-002',
  'ST06-003',
  'ST06-004',
  'ST06-005',
  'ST06-006',
  'ST06-007',
  'ST06-008',
  'ST06-009',
  'ST06-010',
  'ST06-011',
  'ST06-012',
  'ST06-013',
  'ST06-014',
] as const;

export const EXACT_IMPLEMENTED_CARDS: ReadonlySet<string> = new Set(EXACT_IMPLEMENTED_CARD_LIST);

/** 去除同编号异画末尾小写字母 (2.7.3)，如 ST01-001a → ST01-001 */
function normalizeCardNumber(cardNumber: string | undefined): string {
  if (!cardNumber) return '';
  return cardNumber.trim().replace(/[a-z]+$/, '');
}

/**
 * 查询卡牌效果实现状态。
 */
export function getCardImplementationStatus(
  cardNumber: string | undefined,
  rulesText?: string
): CardImplementationStatus {
  const normalized = normalizeCardNumber(cardNumber);
  if (normalized && EXACT_IMPLEMENTED_CARDS.has(normalized)) {
    return 'EXACT';
  }
  if (!rulesText || rulesText.trim() === '') {
    return 'VANILLA';
  }
  return 'APPROXIMATE';
}

/**
 * 该卡牌当前是否仍处于「近似效果实现」阶段 (需要前端展示提示标记)。
 */
export function isCardApproximatelyImplemented(
  cardNumber: string | undefined,
  rulesText?: string
): boolean {
  return getCardImplementationStatus(cardNumber, rulesText) === 'APPROXIMATE';
}
