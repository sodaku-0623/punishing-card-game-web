import type { CardEffectSpec } from '../types.js';
import { validateCardEffectRegistry } from '../validator.js';
import { ST01_EFFECT_SPECS } from './st01.js';
import { ST02_EFFECT_SPECS } from './st02.js';
import { ST03_EFFECT_SPECS } from './st03.js';
import { ST04_EFFECT_SPECS } from './st04.js';
import { ST05_EFFECT_SPECS } from './st05.js';
import { ST06_EFFECT_SPECS } from './st06.js';
import { BP01_PART1_EFFECT_SPECS } from './bp01-part1.js';
import { BP01_PART2_SPECS } from './bp01-part2.js';

/**
 * 所有已完成精确声明式迁移的卡牌效果描述集合 (ST01~ST06 83 张 + BP01 全部 88 张 = 171 张)
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
];

/**
 * 经结构校验后的声明式效果总索引 (启动加载时即验证，格式错误直接抛出异常)
 */
export const STARTER_DECK_SPEC_MAP: ReadonlyMap<string, CardEffectSpec> =
  validateCardEffectRegistry(STARTER_DECK_EFFECT_SPECS);
