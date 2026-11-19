import type { CardEffectSpec } from '../types.js';
import { validateCardEffectRegistry } from '../validator.js';
import { ST01_EFFECT_SPECS } from './st01.js';
import { ST02_EFFECT_SPECS } from './st02.js';
import { ST03_EFFECT_SPECS } from './st03.js';

/**
 * 官方预组 ST01~ST03 全部 42 张卡牌的声明式效果描述集合
 */
export const STARTER_DECK_EFFECT_SPECS: readonly CardEffectSpec[] = [
  ...ST01_EFFECT_SPECS,
  ...ST02_EFFECT_SPECS,
  ...ST03_EFFECT_SPECS,
];

/**
 * 经结构校验后的官方预组声明式效果索引 (启动加载时即验证，格式错误直接抛出异常)
 */
export const STARTER_DECK_SPEC_MAP: ReadonlyMap<string, CardEffectSpec> =
  validateCardEffectRegistry(STARTER_DECK_EFFECT_SPECS);
