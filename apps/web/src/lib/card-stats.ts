import type { CardInstance, ProhibitionFlag, SignalOrbColor } from '@zhanshuang/shared';

interface BaseStats {
  basePP?: number;
  baseDP?: number;
  rulesText?: string;
}

const PROHIBITION_LABELS: Record<ProhibitionFlag, string> = {
  CANNOT_ATTACK: '不能攻击',
  CANNOT_BLOCK: '不能阻挡',
  CANNOT_DEAL_DAMAGE: '不能造成伤害',
  CANNOT_GAIN_ABILITIES: '不能获得新能力',
  CANNOT_ELIMINATE: '不能被消除',
  CANNOT_MODIFY_PP_BY_OPPONENT: 'PP不受对手效果增减',
  CANNOT_DISCARD_HIDDEN_COST_AT_END: '回合末不送墓',
};

const ORB_COLOR_LABELS: Record<SignalOrbColor, string> = {
  RED: '红',
  BLUE: '蓝',
  YELLOW: '黄',
};

/**
 * 1.3.3 检查卡牌是否处于指定禁止状态 (优先读取服务端计算的 effectiveProhibitions)
 */
export function hasCardProhibition(
  card: CardInstance | null | undefined,
  flag: ProhibitionFlag
): boolean {
  if (!card) return false;
  if (card.effectiveProhibitions?.includes(flag)) return true;
  return Boolean(card.modifiers?.some((m) => m.prohibitions?.includes(flag)));
}

/**
 * 将服务端计算的禁止标志转为中文展示标签
 */
export function formatCardProhibitions(card: CardInstance): string[] {
  const flags = card.effectiveProhibitions ?? [];
  return flags.map((f) => PROHIBITION_LABELS[f] ?? f);
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
 * 将卡牌当前生效的 8.9 持续效果修改器与 10.15 冰冻状态整理为简明中文标签，供悬停/详情面板展示
 */
export function formatCardModifiers(card: CardInstance): string[] {
  const modifiers = card.modifiers ?? [];
  const tags: string[] = [];
  if (card.isFrozen) {
    tags.push('冰冻状态 (下回合竖直阶段无法因规则竖直)');
  }
  for (const mod of modifiers) {
    const parts: string[] = [];
    if (mod.loseAbilities) parts.push('能力无效');
    if (mod.prohibitions && mod.prohibitions.length > 0) {
      parts.push(mod.prohibitions.map((p) => PROHIBITION_LABELS[p] ?? p).join('、'));
    }
    if (mod.addTraits && mod.addTraits.length > 0) {
      parts.push(`特征+${mod.addTraits.map((t) => `<${t}>`).join('')}`);
    }
    if (mod.keywords && mod.keywords.length > 0) {
      parts.push(`+${mod.keywords.map((k) => `【${k}】`).join('')}`);
    }
    if (mod.removeKeywords && mod.removeKeywords.length > 0) {
      parts.push(`-${mod.removeKeywords.map((k) => `【${k}】`).join('')}`);
    }
    if (mod.treatedAsOrbColors && mod.treatedAsOrbColors.length > 0) {
      const colors = mod.treatedAsOrbColors.map((c) => ORB_COLOR_LABELS[c] ?? c).join('/');
      parts.push(`视为${colors}信号球`);
    }
    if (mod.orbValue !== undefined) {
      parts.push(`视为${mod.orbValue}个信号球`);
    }
    if (mod.treatedAsNames && mod.treatedAsNames.length > 0) {
      parts.push(`卡名视为${mod.treatedAsNames.map((n) => `《${n}》`).join('/')}`);
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
