import { CardInstance, SignalOrbColor, SignalOrbType } from '@zhanshuang/shared';
import { findCardByNumberOrId } from '@/lib/cards-data';
import { hasCardProhibition } from '@/lib/card-stats';

export type OrbColorType = 'RED' | 'BLUE' | 'YELLOW' | 'UNKNOWN';

export interface OrbDisplayInfo {
  instanceId: string;
  cardNumber: string;
  isFaceUp: boolean;
  colors: SignalOrbColor[];
  color: OrbColorType;
  orbValue: number;
  cannotEliminate: boolean;
  isEliminatable: boolean;
  label: string;
  name: string;
  index: number;
}

export interface AvailableOrbTriple {
  type: 'RED' | 'BLUE' | 'YELLOW' | 'ADJACENT';
  label: string;
  orbIds: string[];
}

const COLOR_LABEL: Record<SignalOrbColor, string> = {
  RED: '红',
  BLUE: '蓝',
  YELLOW: '黄',
};

function inferColorsFromDef(orb: CardInstance): SignalOrbColor[] {
  const def = findCardByNumberOrId(orb.cardNumber || orb.cardId);
  const num = (orb.cardNumber || '').toUpperCase();
  const name = def?.name || '';
  const traits = def?.traits || [];
  const signalOrb = def?.signalOrb;

  if (signalOrb === SignalOrbType.RED) return ['RED'];
  if (signalOrb === SignalOrbType.BLUE) return ['BLUE'];
  if (signalOrb === SignalOrbType.YELLOW) return ['YELLOW'];

  if (
    traits.some((t) => t === '信号球·红' || t.includes('球·红')) ||
    num.includes('ORB-RED') ||
    num.endsWith('-RED') ||
    name.includes('信号球·红') ||
    name.includes('红球')
  ) {
    return ['RED'];
  }
  if (
    traits.some((t) => t === '信号球·蓝' || t.includes('球·蓝')) ||
    num.includes('ORB-BLUE') ||
    num.endsWith('-BLUE') ||
    name.includes('信号球·蓝') ||
    name.includes('蓝球')
  ) {
    return ['BLUE'];
  }
  if (
    traits.some((t) => t === '信号球·黄' || t.includes('球·黄')) ||
    num.includes('ORB-YELLOW') ||
    num.endsWith('-YELLOW') ||
    name.includes('信号球·黄') ||
    name.includes('黄球')
  ) {
    return ['YELLOW'];
  }
  return [];
}

/**
 * 解析信号球区单张卡牌的前端展示与规则属性：
 * - 背面牌 (!isFaceUp) 不可消除，不泄露颜色与名称
 * - 优先读取服务端 8.9 持续效果层计算的 effectiveOrbColors / effectiveOrbValue / effectiveProhibitions
 */
export function resolveOrbDisplayInfo(orb: CardInstance, index: number): OrbDisplayInfo {
  if (!orb.isFaceUp) {
    return {
      instanceId: orb.instanceId,
      cardNumber: orb.cardNumber,
      isFaceUp: false,
      colors: [],
      color: 'UNKNOWN',
      orbValue: 0,
      cannotEliminate: true,
      isEliminatable: false,
      label: '暗',
      name: '背面信号球',
      index,
    };
  }

  const def = findCardByNumberOrId(orb.cardNumber || orb.cardId);
  const modColors = orb.modifiers?.flatMap((m) => m.treatedAsOrbColors ?? []) ?? [];
  const colors: SignalOrbColor[] =
    orb.effectiveOrbColors && orb.effectiveOrbColors.length > 0
      ? orb.effectiveOrbColors
      : modColors.length > 0
      ? Array.from(new Set(modColors))
      : inferColorsFromDef(orb);

  const primaryColor: OrbColorType = colors[0] ?? 'UNKNOWN';
  const cannotEliminate = hasCardProhibition(orb, 'CANNOT_ELIMINATE');
  const modOrbValue = orb.modifiers
    ?.slice()
    .reverse()
    .find((m) => m.orbValue !== undefined)?.orbValue;
  const orbValue =
    orb.effectiveOrbValue !== undefined
      ? orb.effectiveOrbValue
      : modOrbValue !== undefined
      ? modOrbValue
      : colors.length > 0
      ? 1
      : 0;

  const isEliminatable = colors.length > 0 && orbValue > 0 && !cannotEliminate;
  const label =
    colors.length === 0
      ? '非'
      : colors.length === 1
      ? COLOR_LABEL[colors[0]!]
      : colors.map((c) => COLOR_LABEL[c]).join('');

  return {
    instanceId: orb.instanceId,
    cardNumber: orb.cardNumber,
    isFaceUp: true,
    colors,
    color: primaryColor,
    orbValue,
    cannotEliminate,
    isEliminatable,
    label,
    name: def?.name || (colors.length > 0 ? `信号球·${label}` : orb.cardNumber),
    index,
  };
}

/**
 * 按规则 4.16.2 与 Q&A·1 校验所选信号球是否合法执行三消抽 1：
 * 1. 所有选中卡均须正面、视为信号球且不具 CANNOT_ELIMINATE
 * 2. 选中卡在信号球区中必须物理相邻（禁止非相邻跨球三消）
 * 3. 等效信号球数量之和必须精确等于 3（支持单张 orbValue === 3 的《万世铭》单卡三消）
 */
export function validateOrbElimination(
  orbs: CardInstance[],
  selectedOrbIds: string[]
): { valid: boolean; sortedIds: string[]; totalOrbValue: number } {
  if (!selectedOrbIds.length || new Set(selectedOrbIds).size !== selectedOrbIds.length) {
    return { valid: false, sortedIds: [], totalOrbValue: 0 };
  }

  const infos = orbs.map((orb, idx) => resolveOrbDisplayInfo(orb, idx));
  const idToIndex = new Map<string, number>();
  infos.forEach((info, idx) => idToIndex.set(info.instanceId, idx));

  const positions: number[] = [];
  for (const id of selectedOrbIds) {
    const pos = idToIndex.get(id);
    if (pos === undefined) return { valid: false, sortedIds: [], totalOrbValue: 0 };
    positions.push(pos);
  }
  positions.sort((a, b) => a - b);

  // 4.16.2：必须严格物理相邻
  const isAdjacent = positions.every((p, idx) => idx === 0 || p === positions[idx - 1]! + 1);
  if (!isAdjacent) {
    return { valid: false, sortedIds: [], totalOrbValue: 0 };
  }

  let totalOrbValue = 0;
  const sortedIds: string[] = [];
  for (const pos of positions) {
    const info = infos[pos]!;
    if (!info.isEliminatable) {
      return { valid: false, sortedIds: [], totalOrbValue: 0 };
    }
    totalOrbValue += info.orbValue;
    sortedIds.push(info.instanceId);
  }

  return {
    valid: totalOrbValue === 3,
    sortedIds: totalOrbValue === 3 ? sortedIds : [],
    totalOrbValue,
  };
}

/**
 * 扫描物理相邻且可消除的等效 3 球一键组合：
 * 优先返回单张 3 球或相邻同色三消，其次返回首个相邻异色三消。
 */
export function findAvailableOrbTriple(orbs: CardInstance[]): AvailableOrbTriple | null {
  const infos = orbs.map((orb, idx) => resolveOrbDisplayInfo(orb, idx));
  let firstMixed: AvailableOrbTriple | null = null;

  for (let start = 0; start < infos.length; start++) {
    let sum = 0;
    const windowInfos: OrbDisplayInfo[] = [];
    for (let end = start; end < infos.length; end++) {
      const info = infos[end]!;
      if (!info.isEliminatable) break;
      sum += info.orbValue;
      windowInfos.push(info);
      if (sum > 3) break;
      if (sum === 3) {
        const orbIds = windowInfos.map((w) => w.instanceId);
        // 检查区间内所有球是否存在共同颜色（支持多色「视为」球与单张 3 球）
        const commonColor = windowInfos[0]!.colors.find((col) =>
          windowInfos.every((w) => w.colors.includes(col))
        );
        if (commonColor) {
          const isSingleTriple = windowInfos.length === 1 && windowInfos[0]!.orbValue === 3;
          const colorName = COLOR_LABEL[commonColor];
          return {
            type: commonColor,
            label: isSingleTriple ? `${colorName}球单卡三消` : `${colorName}球三消`,
            orbIds,
          };
        }
        if (!firstMixed) {
          firstMixed = {
            type: 'ADJACENT',
            label: '相邻三消',
            orbIds,
          };
        }
        break;
      }
    }
  }

  return firstMixed;
}
