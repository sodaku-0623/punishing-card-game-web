import { AssistCostOption, AssistPartnerConfig } from '@zhanshuang/shared';

const ZONE_BY_TEXT: Record<string, AssistCostOption['zone']> = {
  战场: 'BATTLEFIELD',
  手牌: 'HAND',
  墓地: 'GRAVEYARD',
  牌组: 'DECK',
};

const ORB_COLOR_BY_TEXT: Record<string, NonNullable<AssistCostOption['eliminateOrbs']>['filter']> = {
  任意: 'ANY',
  同色: 'SAME',
  红色: 'RED',
  蓝色: 'BLUE',
  黄色: 'YELLOW',
};

/**
 * 解析卡牌文本中的协战机制 (8.13.2)：【协战搭档】与【协战代价】/【协战费用】。
 * 不含协战机制的卡牌返回 undefined。
 */
export function parseAssistConfig(rulesText: string): AssistPartnerConfig | undefined {
  if (!rulesText) return undefined;
  const partnerMatch = rulesText.match(/【协战搭档】[：:\s]*([^\n]+)/);
  const costMatch = rulesText.match(/【(?:协战代价|协战费用)】[：:\s]*([^\n]+)/);
  if (!partnerMatch || !costMatch) return undefined;

  const partnerText = partnerMatch[1]!.trim();
  const costLine = costMatch[1]!.trim();

  // ---------- 1. 协战搭档条件 (8.13.2.a & 10.12) ----------
  const partnerFilter: AssistPartnerConfig['partnerFilter'] = {};
  const costRangeMatch = partnerText.match(/费用(?:为)?\s*(\d+)\s*(及以下|以下)?/);
  if (costRangeMatch) {
    const val = parseInt(costRangeMatch[1]!, 10);
    partnerFilter.maxCost = costRangeMatch[2] === '以下' ? val - 1 : val;
  }

  const traits: string[] = [];
  const traitRegex = /<([^>]+)>/g;
  let tm: RegExpMatchArray | null;
  while ((tm = traitRegex.exec(partnerText)) !== null) {
    const trait = tm[1]!.trim();
    if (trait && !traits.includes(trait)) {
      traits.push(trait);
    }
  }
  if (traits.length > 0) {
    partnerFilter.traits = traits;
  }

  // ---------- 2. 协战代价选项 (按区域划分，8.13.2.b) ----------
  const costOptions: AssistCostOption[] = [];
  for (const rawClause of costLine.split('/').map((s) => s.trim()).filter(Boolean)) {
    const zoneMatch = rawClause.match(/^(战场|手牌|墓地|牌组)[【\[]([^】\]]+)[】\]]/);
    if (!zoneMatch) continue;
    const zone = ZONE_BY_TEXT[zoneMatch[1]!];
    if (!zone) continue;

    const inner = zoneMatch[2]!.trim();
    let costAmount = 0;
    let eliminateOrbs: AssistCostOption['eliminateOrbs'] | undefined;

    const feeMatch = inner.match(/(?:费用\s*(\d+)|(\d+)\s*费)/);
    if (feeMatch) {
      costAmount = parseInt(feeMatch[1] ?? feeMatch[2]!, 10);
    }

    const orbMatch = inner.match(/(\d+)?\s*(任意|同色|红色|蓝色|黄色)信号球/);
    if (orbMatch) {
      const count = orbMatch[1] ? parseInt(orbMatch[1], 10) : 1;
      const filter = ORB_COLOR_BY_TEXT[orbMatch[2]!] ?? 'ANY';
      eliminateOrbs = { filter, count };
    }

    costOptions.push({
      zone,
      costAmount,
      ...(eliminateOrbs ? { eliminateOrbs } : {}),
    });
  }

  if (costOptions.length === 0) return undefined;

  return {
    partnerFilter,
    costOptions,
  };
}
