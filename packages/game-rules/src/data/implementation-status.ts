/**
 * 卡牌效果实现精确度登记表 (docs/future-work.md §3.6)。
 *
 * - EXACT: 已按官方卡牌文本逐卡在声明式效果库中精确实现 (含 ST01~ST06 83 张 + BP01 88 张 + BP02 91 张 + BP03 90 张 + BP04 89 张 + PR 49 张，全量 490 张)
 * - VANILLA: 无规则文本的白板卡牌，无需效果解析
 * - APPROXIMATE: 尚处于按关键字匹配的近似实现阶段，前端应向玩家给出明确标记
 */
export type CardImplementationStatus = 'EXACT' | 'VANILLA' | 'APPROXIMATE';

function rangeCards(prefix: string, maxNum: number, extra: readonly string[] = []): string[] {
  const list: string[] = [];
  for (let i = 1; i <= maxNum; i++) {
    list.push(`${prefix}-${String(i).padStart(3, '0')}`);
  }
  return [...list, ...extra];
}

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
  // BP01 第一批：灰鸦小队 / 升格者 / 七实与帕瓦 / 三头犬与突击鹰 / 全部信号球 (47 张)
  'BP01-001',
  'BP01-002',
  'BP01-003',
  'BP01-004',
  'BP01-005',
  'BP01-006',
  'BP01-007',
  'BP01-008',
  'BP01-009',
  'BP01-010',
  'BP01-011',
  'BP01-012',
  'BP01-013',
  'BP01-040',
  'BP01-041',
  'BP01-042',
  'BP01-043',
  'BP01-044',
  'BP01-045',
  'BP01-046',
  'BP01-047',
  'BP01-048',
  'BP01-049',
  'BP01-050',
  'BP01-051',
  'BP01-052',
  'BP01-053',
  'BP01-054',
  'BP01-055',
  'BP01-069',
  'BP01-070',
  'BP01-071',
  'BP01-072',
  'BP01-073',
  'BP01-074',
  'BP01-075',
  'BP01-076',
  'BP01-077',
  'BP01-078',
  'BP01-079',
  'BP01-080',
  'BP01-081',
  'BP01-082',
  'BP01-083',
  'BP01-084',
  'BP01-085',
  'BP01-086',
  // BP01 第二批：露西亚·深红囚影 / 封刃太刀、曲·雀翎 / 万世铭、赛琳娜·希声 / 梦赴光寥之乡 (41 张，补齐 BP01 全 88 张)
  'BP01-014',
  'BP01-015',
  'BP01-016',
  'BP01-017',
  'BP01-018',
  'BP01-019',
  'BP01-020',
  'BP01-021',
  'BP01-022',
  'BP01-023',
  'BP01-024',
  'BP01-025',
  'BP01-026',
  'BP01-027',
  'BP01-028',
  'BP01-029',
  'BP01-030',
  'BP01-031',
  'BP01-032',
  'BP01-033',
  'BP01-034',
  'BP01-035',
  'BP01-036',
  'BP01-037',
  'BP01-038',
  'BP01-039',
  'BP01-056',
  'BP01-056a',
  'BP01-056b',
  'BP01-057',
  'BP01-058',
  'BP01-059',
  'BP01-060',
  'BP01-061',
  'BP01-062',
  'BP01-063',
  'BP01-064',
  'BP01-065',
  'BP01-066',
  'BP01-067',
  'BP01-068',
  // BP02 重返极夜 (91 张，含冠军异画 BP02-022【冠军】)
  ...rangeCards('BP02', 90, ['BP02-022【冠军】']),
  // BP03 超刻溯梦 (90 张，含冠军异画 BP03-003【冠军】)
  ...rangeCards('BP03', 89, ['BP03-003【冠军】']),
  // BP04 终焉圣歌 (89 张)
  ...rangeCards('BP04', 89),
  // PR 特典推广卡 (49 张)
  ...rangeCards('PR', 49),
] as const;

export const EXACT_IMPLEMENTED_CARDS: ReadonlySet<string> = new Set(EXACT_IMPLEMENTED_CARD_LIST);

/** 去除同编号异画末尾小写字母或【冠军】等标识 (2.7.3)，如 ST01-001a → ST01-001、BP02-022【冠军】 → BP02-022 */
function normalizeCardNumber(cardNumber: string | undefined): string {
  if (!cardNumber) return '';
  return cardNumber
    .trim()
    .replace(/【[^】]+】$/g, '')
    .replace(/[a-z]+$/, '')
    .trim();
}

/**
 * 查询卡牌效果实现状态。
 */
export function getCardImplementationStatus(
  cardNumber: string | undefined,
  rulesText?: string
): CardImplementationStatus {
  const trimmed = cardNumber?.trim() ?? '';
  if (trimmed && EXACT_IMPLEMENTED_CARDS.has(trimmed)) {
    return 'EXACT';
  }
  const normalized = normalizeCardNumber(trimmed);
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
