import { AscensionRestriction, AscensionRuleConfig } from '@zhanshuang/shared';

const ATTRIBUTE_BY_CHAR: Record<string, string> = {
  火: 'FIRE',
  雷: 'LIGHTNING',
  暗: 'DARK',
  冰: 'ICE',
  物: 'PHYSICAL',
  空: 'VOID',
};

/**
 * 解析卡牌文本中的升变机制 (8.11.2)：升变条件 (升变对象 & 限制条件)、升变代价、升变能力。
 * 不含升变机制的卡牌返回 undefined。
 *
 * 数值区间严格按 10.12：「X以下」= 小于 X，「X及以下」= 小于等于 X。
 */
export function parseAscensionConfig(rulesText: string): AscensionRuleConfig | undefined {
  if (!rulesText) return undefined;
  const conditionMatch = rulesText.match(/(?:【升变条件】|升变条件|【升变对象】)[：:\s]*([^\n]+)/);
  const costLine = rulesText.split('\n').find((line) => /升变代价|升变费用/.test(line));
  if (!conditionMatch || !costLine) return undefined;

  const unsupported: string[] = [];
  const conditionText = conditionMatch[1]!.trim();
  const [targetPartRaw, restrictionPartRaw] = conditionText.split(/[&＆]/, 2) as [string, string | undefined];

  // ---------- 升变对象 ----------
  let targetPart = targetPartRaw.trim();
  const targetFilter: AscensionRuleConfig['targetFilter'] = {};
  if (targetPart.includes('信号球区中')) {
    unsupported.push('以信号球区中的卡牌作为升变对象');
  }
  targetPart = targetPart.replace(/^战场或浮空模式的/, '').replace(/^信号球区中/, '');
  if (targetPart.startsWith('竖直状态')) {
    targetFilter.requireReady = true;
    targetPart = targetPart.slice('竖直状态'.length);
  }

  const costMatch = targetPart.match(/费用(?:为)?\s*(\d+)\s*(及以下|以下)?/);
  if (costMatch) {
    const value = parseInt(costMatch[1]!, 10);
    if (costMatch[2] === '以下') targetFilter.maxCost = value - 1;
    else if (costMatch[2] === '及以下') targetFilter.maxCost = value;
    else targetFilter.exactCost = value;
  }

  const subjectMatch = targetPart.match(/([<《])([^>》]+)[>》]/);
  if (!subjectMatch) return undefined;
  const subject = subjectMatch[2]!.trim();
  targetFilter.nameIncludes = subject;
  if (subjectMatch[1] === '<') targetFilter.traits = [subject];
  else targetFilter.exactName = subject;

  // ---------- 限制条件 ----------
  const conditions: AscensionRestriction[] = [];
  const restrictionText = (restrictionPartRaw ?? '').replace(/[「」]/g, '').trim();
  if (restrictionText) {
    for (const clause of restrictionText.split('且').map((c) => c.trim()).filter(Boolean)) {
      let m: RegExpMatchArray | null;
      if ((m = clause.match(/^明费上限(\d+)及以上$/))) {
        conditions.push({ kind: 'MIN_OPEN_COST_LIMIT', value: parseInt(m[1]!, 10) });
      } else if ((m = clause.match(/费用上限(\d+)及以上$/))) {
        conditions.push({ kind: 'MIN_COST_LIMIT', value: parseInt(m[1]!, 10) });
      } else if ((m = clause.match(/^信号球区的《(.+?)》(\d+)张及以上$/))) {
        conditions.push({ kind: 'MIN_ORB_ZONE_CARDS', cardName: m[1]!, value: parseInt(m[2]!, 10) });
      } else if ((m = clause.match(/^信号球区的牌(\d+)张及以上$/))) {
        conditions.push({ kind: 'MIN_ORB_ZONE_CARDS', value: parseInt(m[1]!, 10) });
      } else if ((m = clause.match(/^我方战场的角色为(\d+)张及以下$/))) {
        conditions.push({ kind: 'MAX_FIELD_ROLES', value: parseInt(m[1]!, 10) });
      } else if ((m = clause.match(/^费用区所有角色牌为(.)属性$/)) && ATTRIBUTE_BY_CHAR[m[1]!]) {
        conditions.push({ kind: 'COST_ZONE_ROLES_ATTRIBUTE', attribute: ATTRIBUTE_BY_CHAR[m[1]!]! });
      } else {
        unsupported.push(`升变限制条件「${clause}」`);
      }
    }
  }

  // ---------- 升变代价 ----------
  const costTextMatch = costLine.match(/(?:升变代价|升变费用)】?[：:\s]*(「[^」]*」|【[^】]*】|\S+)/);
  const costText = costTextMatch?.[1] ?? '';
  const costValueMatch = costText.match(/(?:【|^|「)(?:费用\s*(\d+)|(\d+)\s*费)/);
  if (!costValueMatch) return undefined;
  const ascensionCost = parseInt(costValueMatch[1] ?? costValueMatch[2]!, 10);
  if (/[&＆]/.test(costText)) {
    unsupported.push('升变代价中的额外行动');
  }

  // ---------- 升变能力 (8.11.2.c) ----------
  const abilityLine =
    rulesText.split('\n').find((line) => /升变能力/.test(line)) ?? costLine;
  const grantKeywords: string[] = [];
  for (const keyword of ['速攻', '突进']) {
    if (new RegExp(`获得[【\\[]${keyword}(?:icon)?[】\\]]`).test(abilityLine)) {
      grantKeywords.push(keyword);
    }
  }

  const sourceZones: ('HAND' | 'GRAVEYARD')[] = /手牌或墓地的该牌/.test(abilityLine) ? ['HAND', 'GRAVEYARD'] : ['HAND'];

  const minCostLimit = conditions.find((c) => c.kind === 'MIN_COST_LIMIT')?.value;
  return {
    targetFilter,
    restrictionFilter: conditions.length > 0 ? { minCostLimit, conditions } : undefined,
    unsupportedReason: unsupported.length > 0 ? `暂不支持${unsupported.join('、')}` : undefined,
    ascensionCost,
    grantKeywords,
    sourceZones,
  };
}
