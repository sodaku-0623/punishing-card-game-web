import type { CardInstance } from '@zhanshuang/shared';

interface BaseStats {
  basePP?: number;
  baseDP?: number;
}

/**
 * 战场角色当前的 PP/DP：优先使用服务端计算的数值 (含装备、持续效果与永久能力)，
 * 旧版本服务端没有下发时退回到基础值 + 临时加成。
 */
export function getDisplayStats(card: CardInstance, cardDef?: BaseStats | null): { pp: number; dp: number; ppBonus: number; dpBonus: number } {
  const basePP = cardDef?.basePP ?? 0;
  const baseDP = cardDef?.baseDP ?? 0;
  const pp = card.effectivePP ?? basePP + (card.tempPPBonus ?? 0);
  const dp = card.effectiveDP ?? baseDP + (card.tempDPBonus ?? 0);
  return { pp, dp, ppBonus: pp - basePP, dpBonus: dp - baseDP };
}

export function formatBonus(value: number): string {
  if (value === 0) return '';
  return value > 0 ? ` (+${value})` : ` (${value})`;
}
