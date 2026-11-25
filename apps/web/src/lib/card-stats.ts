import { CardType, type CardInstance, type ProhibitionFlag, type SignalOrbColor } from '@zhanshuang/shared';

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
  CANNOT_BE_PLACED_UNDERNEATH: '不因效果置于下方',
  CANNOT_BE_PLACED_UNDERNEATH_BY_SELF: '不因己方效果置于下方',
};

const ORB_COLOR_LABELS: Record<SignalOrbColor, string> = {
  RED: '红',
  BLUE: '蓝',
  YELLOW: '黄',
};

const CARD_TYPE_TRANSFORM_LABELS: Record<CardType, string> = {
  [CardType.ROLE]: '变为角色',
  [CardType.ASSIST]: '变为辅助机',
  [CardType.EQUIPMENT]: '变为装备',
  [CardType.TACTICS]: '变为战术',
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

function normalizeCoreCardNumber(cardNumber?: string): string {
  if (!cardNumber) return '';
  const match = cardNumber.match(/^([A-Z]{2}\d*-\d+)/i);
  return match ? match[1]!.toUpperCase() : cardNumber.trim().toUpperCase();
}

function isModifierActive(untilTurn: number | undefined, turnNumber: number | undefined): boolean {
  return untilTurn === undefined || turnNumber === undefined || untilTurn >= turnNumber;
}

function getLatestLoseAbilitiesTimestamp(
  card: CardInstance | null | undefined,
  turnNumber?: number
): number {
  let latestLoseTs = -1;
  for (const m of card?.modifiers ?? []) {
    if (m.loseAbilities === true && isModifierActive(m.untilTurn, turnNumber)) {
      latestLoseTs = Math.max(latestLoseTs, m.timestamp ?? 0);
    }
  }
  return latestLoseTs;
}

/**
 * 获取角色当前生效的「不会被 PP 为 X 及以下的角色阻挡」上限（对齐 `continuous-effects.ts` 与 `BP01-040` 静态规则）
 */
export function getCardUnblockableMaxPP(
  card: CardInstance,
  turnNumber?: number
): number | undefined {
  const latestLoseTs = getLatestLoseAbilitiesTimestamp(card, turnNumber);
  let maxPP: number | undefined;
  for (const m of card.modifiers ?? []) {
    if (m.unblockableMaxPP === undefined) continue;
    if (!isModifierActive(m.untilTurn, turnNumber)) continue;
    if (latestLoseTs >= 0 && (m.timestamp ?? 0) <= latestLoseTs) continue;
    maxPP = maxPP === undefined ? m.unblockableMaxPP : Math.max(maxPP, m.unblockableMaxPP);
  }
  if (
    normalizeCoreCardNumber(card.cardNumber) === 'BP01-040' &&
    latestLoseTs < 0 &&
    (card.underneathCardIds?.length ?? 0) >= 4
  ) {
    maxPP = maxPP === undefined ? 5000 : Math.max(maxPP, 5000);
  }
  return maxPP;
}

/**
 * 角色出场当回合是否允许攻击对方玩家（10.5 速攻 或未过期的 canAttackPlayerOnEnterTurn 修改器，如 BP04-075 / ST05-001）
 */
export function canRoleAttackPlayerOnEnterTurn(
  card: CardInstance | null | undefined,
  cardDef: BaseStats | null | undefined,
  turnNumber?: number
): boolean {
  if (hasCardKeyword(card, cardDef, '速攻')) return true;
  return Boolean(
    card?.modifiers?.some(
      (m) => m.canAttackPlayerOnEnterTurn === true && isModifierActive(m.untilTurn, turnNumber)
    )
  );
}

/**
 * 角色出场当回合是否允许攻击对方角色（10.5 速攻 或 10.6 突进）
 */
export function canRoleAttackCharacterOnEnterTurn(
  card: CardInstance | null | undefined,
  cardDef: BaseStats | null | undefined
): boolean {
  return hasCardKeyword(card, cardDef, '速攻') || hasCardKeyword(card, cardDef, '突进');
}

/**
 * 角色出场当回合是否允许宣告攻击 (向后兼容：可攻击玩家或可攻击角色任一成立即返回 true)
 */
export function canRoleAttackOnEnterTurn(
  card: CardInstance | null | undefined,
  cardDef: BaseStats | null | undefined,
  turnNumber?: number
): boolean {
  return (
    canRoleAttackPlayerOnEnterTurn(card, cardDef, turnNumber) ||
    canRoleAttackCharacterOnEnterTurn(card, cardDef)
  );
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
  if (card.isAirborne) {
    tags.push('浮空模式 (下回合开始时回到战场)');
  }
  if (card.partnerCardId) {
    tags.push('协战状态');
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
    if (mod.setCardType !== undefined) {
      parts.push(CARD_TYPE_TRANSFORM_LABELS[mod.setCardType] ?? `变为${mod.setCardType}`);
    }
    if (mod.canAttackPlayerOnEnterTurn) {
      parts.push('出场回合可攻击玩家');
    }
    if (mod.unblockableMaxPP !== undefined) {
      parts.push(`PP${mod.unblockableMaxPP}及以下不可阻挡`);
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
