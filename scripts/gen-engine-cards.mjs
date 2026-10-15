import fs from 'node:fs';
import path from 'node:path';

// 读取 official-cards.ts
const officialCardsPath = path.resolve('packages/database/src/seed/official-cards.ts');
const targetPath = path.resolve('packages/game-engine/src/database/official-cards-data.ts');

const content = fs.readFileSync(officialCardsPath, 'utf8');

// 提取 OFFICIAL_SEED_CARDS 数组部分
const startIdx = content.indexOf('export const OFFICIAL_SEED_CARDS: CardCreateInput[] = [');
if (startIdx === -1) {
  console.error('Cannot find OFFICIAL_SEED_CARDS in', officialCardsPath);
  process.exit(1);
}

// 转换规则：
// CardTypeEnum.ROLE -> CardType.ROLE
// ElementAttributeEnum.FIRE -> ElementAttribute.FIRE
// SignalOrbTypeEnum.RED -> SignalOrbType.RED
// 加入 id 字段 (如果无 id，则使用 c-${cardNumber.toLowerCase()})
// 加入 abilities: []
// 为升变卡配置 ascensionConfig
let converted = content.substring(startIdx + 'export const OFFICIAL_SEED_CARDS: CardCreateInput[] = ['.length);
// 替换枚举名
converted = converted.replace(/CardTypeEnum\./g, 'CardType.');
converted = converted.replace(/ElementAttributeEnum\./g, 'ElementAttribute.');
converted = converted.replace(/SignalOrbTypeEnum\./g, 'SignalOrbType.');

// 写入输出文件
const outputContent = `import { CardVersionData, CardType, ElementAttribute, SignalOrbType, AscensionRuleConfig } from '@zhanshuang/shared';

export function parseAscensionConfig(rulesText: string): AscensionRuleConfig | undefined {
  if (!rulesText || !rulesText.includes('【升变】')) return undefined;
  const costMatch = rulesText.match(/\\[费用(\\d+)\\]|【(\\d+)费】/);
  const targetMatch = rulesText.match(/费用(\\d+)以下的[<《](.+?)[>》]/);
  const limitMatch = rulesText.match(/费用上限(\\d+)/);
  if (costMatch && targetMatch && targetMatch[1] && targetMatch[2]) {
    const rawCost = costMatch[1] || costMatch[2];
    if (!rawCost) return undefined;
    const ascensionCost = parseInt(rawCost, 10);
    const maxCost = parseInt(targetMatch[1], 10);
    const nameIncludes = targetMatch[2];
    const minCostLimit = limitMatch && limitMatch[1] ? parseInt(limitMatch[1], 10) : undefined;
    const grantKeywords: string[] = [];
    if (rulesText.includes('速攻')) grantKeywords.push('速攻');
    return {
      targetFilter: { maxCost, nameIncludes },
      restrictionFilter: minCostLimit ? { minCostLimit } : undefined,
      ascensionCost,
      grantKeywords,
    };
  }
  return undefined;
}

const RAW_OFFICIAL_CARDS: any[] = [${converted}

export const OFFICIAL_CARDS_DATA: CardVersionData[] = RAW_OFFICIAL_CARDS.map((c) => ({
  id: c.id || \`c-\${c.cardNumber.toLowerCase()}\`,
  cardNumber: c.cardNumber,
  name: c.name,
  cardType: c.cardType,
  attribute: c.attribute,
  cost: c.cost,
  basePP: c.basePP ?? undefined,
  baseDP: c.baseDP ?? undefined,
  signalOrb: c.signalOrb ?? undefined,
  traits: c.traits || [],
  isInstant: !!c.isInstant,
  ascensionConfig: parseAscensionConfig(c.rulesText),
  abilities: [],
  rulesText: c.rulesText || '',
  flavorText: c.flavorText ?? undefined,
}));
`;

fs.writeFileSync(targetPath, outputContent, 'utf8');
console.log('Successfully generated official-cards-data.ts at', targetPath);
