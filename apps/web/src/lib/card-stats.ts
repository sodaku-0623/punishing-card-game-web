import type { CardInstance } from '@zhanshuang/shared';

interface BaseStats {
  basePP?: number;
  baseDP?: number;
  rulesText?: string;
}

/**
 * 战场角色当前的 PP/DP：优先使用服务端计算的数值 (含装备、8.9 持续效果与永久能力)，
 * 旧版本服务端没有下发时退回到基础值 + 临时加成。
 */
export function getDisplayStats(card: CardInstance, cardDef?: BaseStats | null): { pp: number; dp: number; ppBonus: number; dpBonus: number } {
  const basePP = cardDef?.basePP ?? 0;
  const baseDP = cardDef?.baseDP ?? 0;
  const pp = card.effectivePP ?? basePP + (card.tempPPBonus ?? 0);
  const dp = card.effectiveDP ?? baseDP + (card.tempDPBonus ?? 0);
  return { pp, dp, ppBonus: pp - basePP, dpBonus: dp - baseDP };
}

/**
 * 检查角色是否持有指定关键字能力 (优先使用服务端 8.9 持续效果层计算结果 effectiveKeywords)
 */
export function hasCardKeyword(
  card: CardInstance | null | undefined,
  cardDef: BaseStats | null | undefined,
  keyword: string
): boolean {
  if (card?.effectiveKeywords !== undefined) {
    return card.effectiveKeywords.includes(keyword);
  }
  if (card?.modifiers?.some((m) => m.keywords?.includes(keyword))) {
    return true;
  }
  if (card?.grantedKeywords?.includes(keyword)) {
    return true;
  }
  return Boolean(cardDef?.rulesText?.includes(keyword));
}

/**
 * 角色出场当回合是否允许宣告攻击 (10.5 速攻 或 10.6 突进)
 */
export function canRoleAttackOnEnterTurn(
  card: CardInstance | null | undefined,
  cardDef: BaseStats | null | undefined
): boolean {
  return hasCardKeyword(card, cardDef, '速攻') || hasCardKeyword(card, cardDef, '突进');
}

/**
 * 将卡牌当前生效的 8.9 持续效果修改器整理为简明中文标签，供悬停/详情面板展示
 */
export function formatCardModifiers(card: CardInstance): string[] {
  const modifiers = card.modifiers ?? [];
  const tags: string[] = [];
  for (const mod of modifiers) {
    const parts: string[] = [];
    if (mod.loseAbilities) parts.push('能力无效');
    if (mod.addTraits && mod.addTraits.length > 0) {
      parts.push(`特征+${mod.addTraits.map((t) => `<${t}>`).join('')}`);
    }
    if (mod.keywords && mod.keywords.length > 0) {
      parts.push(`+${mod.keywords.map((k) => `【${k}】`).join('')}`);
    }
    if (mod.removeKeywords && mod.removeKeywords.length > 0) {
      parts.push(`-${mod.removeKeywords.map((k) => `【${k}】`).join('')}`);
    }
    if (mod.setPP !== undefined) parts.push(`PP=${mod.setPP}`);
    if (mod.pp) parts.push(`PP${mod.pp > 0 ? `+${mod.pp}` : mod.pp}`);
    if (mod.setDP !== undefined) parts.push(`DP=${mod.setDP}`);
    if (mod.dp) parts.push(`DP${mod.dp > 0 ? `+${mod.dp}` : mod.dp}`);
    if (mod.setCharge !== undefined) parts.push(`充能${mod.setCharge}`);
    if (mod.charge) parts.push(`充能${mod.charge > 0 ? `+${mod.charge}` : mod.charge}`);
    if (parts.length === 0) continue;
    const scope = mod.untilTurn !== undefined ? `至T${mod.untilTurn}末` : '至离场';
    const src = mod.source ? `${mod.source} ` : '';
    tags.push(`${src}${parts.join(' ')} (${scope})`);
  }
  return tags;
}

export function formatBonus(value: number): string {
  if (value === 0) return '';
  return value > 0 ? ` (+${value})` : ` (${value})`;
}
