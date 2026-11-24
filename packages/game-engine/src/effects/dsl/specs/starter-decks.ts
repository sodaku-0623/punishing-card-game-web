import type { CardEffectSpec } from '../types.js';
import { validateCardEffectRegistry } from '../validator.js';
import { MemoryCardDatabase } from '../../../database/card-registry.js';
import { OFFICIAL_CARDS_DATA } from '../../../database/official-cards-data.js';
import { ST01_EFFECT_SPECS } from './st01.js';
import { ST02_EFFECT_SPECS } from './st02.js';
import { ST03_EFFECT_SPECS } from './st03.js';
import { ST04_EFFECT_SPECS } from './st04.js';
import { ST05_EFFECT_SPECS } from './st05.js';
import { ST06_EFFECT_SPECS } from './st06.js';
import { BP01_PART1_EFFECT_SPECS } from './bp01-part1.js';
import { BP01_PART2_SPECS } from './bp01-part2.js';
import { BP02_EFFECT_SPECS } from './bp02.js';
import { BP03_EFFECT_SPECS } from './bp03.js';
import { BP04_EFFECT_SPECS } from './bp04.js';
import { PR_EFFECT_SPECS } from './pr.js';

/**
 * 所有已完成精确声明式迁移的卡牌效果描述集合
 */
export const STARTER_DECK_EFFECT_SPECS: readonly CardEffectSpec[] = [
  ...ST01_EFFECT_SPECS,
  ...ST02_EFFECT_SPECS,
  ...ST03_EFFECT_SPECS,
  ...ST04_EFFECT_SPECS,
  ...ST05_EFFECT_SPECS,
  ...ST06_EFFECT_SPECS,
  ...BP01_PART1_EFFECT_SPECS,
  ...BP01_PART2_SPECS,
  ...BP02_EFFECT_SPECS,
  ...BP03_EFFECT_SPECS,
  ...BP04_EFFECT_SPECS,
  ...PR_EFFECT_SPECS,
];

/**
 * 经结构校验后的声明式效果总索引 (启动加载时即与官方全卡表交叉验证，格式或卡号/卡名错误直接抛出异常)
 */
export const STARTER_DECK_SPEC_MAP: ReadonlyMap<string, CardEffectSpec> =
  validateCardEffectRegistry(STARTER_DECK_EFFECT_SPECS, new MemoryCardDatabase(OFFICIAL_CARDS_DATA));
