import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 卡表素材目录：默认使用仓库内的「战双帕弥什对战卡牌卡表」，也可通过命令行参数指定
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = process.argv[2] || path.join(repoRoot, '战双帕弥什对战卡牌卡表');
const rawCardsPath = path.join(sourceDir, 'card_effects.json');

if (!fs.existsSync(rawCardsPath)) {
  console.error('Source card_effects.json not found at', rawCardsPath);
  process.exit(1);
}

const rawCards = JSON.parse(fs.readFileSync(rawCardsPath, 'utf8'));

const featureMap = {
  1: '21号', 2: '阿尔法', 3: '升格者', 4: '阿波罗', 5: '大太刀', 6: '小太刀', 7: '太刀',
  8: '灰鸦小队', 9: '卡穆', 10: '库洛姆', 11: '里', 12: '丽芙', 13: '青赫', 14: '露娜',
  15: '露西亚', 16: '罗兰', 17: '诺克提', 18: '三头犬小队', 19: '苦刑之女', 20: '七实',
  21: '火花', 22: '曲', 23: '九龙商会', 24: '赛琳娜', 25: '艺术协会', 26: '神威',
  27: '沙利叶', 28: '突击鹰小队', 29: '万世铭', 30: '万事', 31: '薇拉', 32: '帕瓦',
  33: '摇篮', 34: '信号球·红', 35: '信号球·黄', 36: '信号球·蓝', 37: '冕饵', 38: '奥罗拉',
  39: '比安卡', 40: '清洁部队', 41: '伊什梅尔', 42: '幻日', 43: '灰鸦小队·高级', 44: '拉弥亚',
  45: '含英', 46: '飞叶点翠', 47: '异聚体', 48: '艾拉', 49: '罗塞塔', 50: '守林人',
  51: '莉莉丝', 52: '艺术协会', 53: '冈格尼尔', 54: '蜃景', 55: '斯托克斯', 56: '亚里莎',
  57: '莱特宁', 58: '塞西莉', 59: '卡列尼娜', 60: '工程部队', 61: '赫斯提亚', 62: '墨提斯',
  63: '巴克豪斯', 64: '遗忘者', 65: '布偶熊', 66: '渡边'
};

const processedCards = rawCards.map((c) => {
  // 根据卡号推断基础卡所属系列/卡包（避免因推广异画排在首位而将卡包误标为 PR-推广卡）
  let cardImages = c.images || [];
  let cardPackageName = c.package_name;
  if (c.card_no.startsWith('BP01')) cardPackageName = 'BP01-命运交锋';
  else if (c.card_no.startsWith('BP02')) cardPackageName = 'BP02-星海时溯';
  else if (c.card_no.startsWith('BP03')) cardPackageName = 'BP03-誓焰破晓';
  else if (c.card_no.startsWith('BP04')) cardPackageName = 'BP04-终焉月冕';
  else if (c.card_no.startsWith('ST01')) cardPackageName = 'ST01-灰鸦小队预组';
  else if (c.card_no.startsWith('ST02')) cardPackageName = 'ST02-升格者小队预组';
  else if (c.card_no.startsWith('ST03')) cardPackageName = 'ST03-三头犬小队预组';
  else if (c.card_no.startsWith('ST04')) cardPackageName = 'ST04-突击鹰小队预组';
  else if (c.card_no.startsWith('ST05')) cardPackageName = 'ST05-比安卡·晖暮预组';
  else if (c.card_no.startsWith('ST06')) cardPackageName = 'ST06-亚里莎·回音预组';
  else if (c.card_no.startsWith('PR')) cardPackageName = 'PR-推广卡';

  const traits = [];
  if (c.feature) {
    c.feature.split(',').forEach((f) => {
      const trimmed = f.trim();
      if (featureMap[trimmed] && !traits.includes(featureMap[trimmed])) {
        traits.push(featureMap[trimmed]);
      }
    });
  }
  const prefix = c.name.split('·')[0].split(' ')[0].trim();
  if (prefix && prefix.length <= 4 && !traits.includes(prefix)) {
    traits.push(prefix);
  }

  // 提取 <> 中的特征
  const brackets = c.effect.match(/<([^>]+)>/g) || [];
  for (const b of brackets) {
    const t = b.slice(1, -1).trim();
    if (['灰鸦小队', '升格者', '三头犬小队', '突击鹰小队', '九龙商会', '艺术协会', '遗忘者', '工程部队', '清洁部队'].includes(t)) {
      if (!traits.includes(t)) traits.push(t);
    }
  }

  let cardType = 'TACTICS';
  if (c.card_type.includes('6')) {
    cardType = 'ROLE';
  } else if (c.card_type === '3,5' || c.card_type === '5') {
    cardType = 'EQUIPMENT';
  } else if (c.card_type === '3,4') {
    cardType = 'ASSIST';
  }

  let attribute = 'NONE';
  let attributeName = '无';
  switch (c.attribute) {
    case 1: attribute = 'NONE'; attributeName = '无'; break;
    case 2: attribute = 'DARK'; attributeName = '暗'; break;
    case 3: attribute = 'ICE'; attributeName = '冰'; break;
    case 4: attribute = 'FIRE'; attributeName = '火'; break;
    case 5: attribute = 'LIGHTNING'; attributeName = '雷'; break;
    case 6: attribute = 'PHYSICAL'; attributeName = '物理'; break;
    case 7: attribute = 'VOID'; attributeName = '空'; break; // 空属性
  }

  let signalOrb = null;
  switch (c.signal_color) {
    case 1: signalOrb = 'RED'; break;
    case 2: signalOrb = 'YELLOW'; break;
    case 3: signalOrb = 'BLUE'; break;
  }

  const isInstant = Boolean(c.card_type === '8,10' || c.effect.includes('【瞬时】'));

  // 提取基础稀有度 (C, R, SR, PR, ST, U)
  let baseRarity = '';
  if (cardImages && cardImages.length > 0) {
    for (const img of cardImages) {
      const fn = img.split('/').pop() || '';
      const starMatch = fn.match(/★+/);
      const stars = starMatch ? starMatch[0].length : 0;
      const rMatch = fn.match(/(?:[_-]|^)(C|R|SR|SSR|SEC|SP|ST|PR|UR|HR|U)(?:★|[_-]|\.|\s|[\(（]|$)/i);
      let r = rMatch ? rMatch[1].toUpperCase() : '';
      if (!r && (fn.toUpperCase().includes('PR') || img.includes('PR-推广卡'))) {
        r = 'PR';
      }
      if (stars === 0 && r && (!c.card_no.startsWith('BP') || r !== 'PR')) {
        baseRarity = r;
        break;
      }
      if (!baseRarity && r && (!c.card_no.startsWith('BP') || r !== 'PR')) {
        baseRarity = r;
      }
    }
  }
  if (!baseRarity) {
    if (c.card_no.startsWith('PR')) {
      baseRarity = 'PR';
    } else if (c.card_no.startsWith('ST')) {
      baseRarity = 'ST';
    } else {
      baseRarity = 'C';
    }
  }

  // 1. Cost 转换规则 (官方卡表数据对照: 9=8, 8=7, 7=6, 6=5, 5=4, 4=3, 3=2, 2=1, 1=0, 10=9, 11=10)
  let finalCost = 0;
  if (c.card_no === 'BP04-001') {
    finalCost = 99; // 露娜·终焉 特殊费用 99
  } else if (c.card_no === 'PR-036') {
    finalCost = 3;
  } else if (c.card_no === 'PR-037') {
    finalCost = 4;
  } else if (c.card_no === 'PR-038') {
    finalCost = 2;
  } else if (c.card_no === 'PR-039') {
    finalCost = 4;
  } else if (c.card_no === 'PR-040') {
    finalCost = 2;
  } else if (c.cost !== null && c.cost !== undefined) {
    const rawCost = Number(c.cost);
    finalCost = rawCost >= 1 ? rawCost - 1 : 0;
  }

  // 2. pp_value 转换规则 (官方对照: 11=8000, 10=7000, 9=6000, 8=5000, 7=4500, 6=4000, 5=3500, 4=3000, 3=2500, 2=2000, 1=1000)
  // 扩展规则 (实卡高费高战力角色与武器加成: 12=500, 13=1000, 14=1500, 15=5500, 16=6500, 17=9000, 21=10000)
  const ppLookup = {
    1: 1000,
    2: 2000,
    3: 2500,
    4: 3000,
    5: 3500,
    6: 4000,
    7: 4500,
    8: 5000,
    9: 6000,
    10: 7000,
    11: 8000,
    12: 500,
    13: 1000,
    14: 1500,
    15: 5500,
    16: 6500,
    17: 9000,
    21: 10000,
  };
  let finalPP = null;
  if (c.card_no === 'BP04-001') {
    finalPP = 0;
  } else if (c.card_no === 'PR-036') {
    finalPP = 3000;
  } else if (c.card_no === 'PR-037') {
    finalPP = 4000;
  } else if (c.card_no === 'PR-038') {
    finalPP = 1000;
  } else if (c.card_no === 'PR-039') {
    finalPP = 4000;
  } else if (c.card_no === 'PR-040') {
    finalPP = null;
  } else if (c.pp_value !== null && c.pp_value !== undefined && ppLookup[c.pp_value] !== undefined) {
    finalPP = ppLookup[c.pp_value];
  } else if (c.pp_value !== null && c.pp_value !== undefined) {
    finalPP = c.pp_value * 1000;
  }

  // 3. dp_value 转换规则 (官方对照: 3=2, 2=1, 1=0)
  let finalDP = null;
  if (c.card_no === 'BP04-052') {
    finalDP = 3;
  } else if (c.card_no === 'PR-036') {
    finalDP = 0;
  } else if (c.card_no === 'PR-037') {
    finalDP = 1;
  } else if (c.card_no === 'PR-038') {
    finalDP = 0;
  } else if (c.card_no === 'PR-039') {
    finalDP = 1;
  } else if (c.card_no === 'PR-040') {
    finalDP = null;
  } else if (cardType === 'ROLE') {
    if (c.dp_value === 3) {
      finalDP = 2;
    } else if (c.dp_value === 2) {
      finalDP = 1;
    } else if (c.dp_value === 1) {
      finalDP = 0;
    } else if (c.dp_value !== null && c.dp_value !== undefined) {
      finalDP = Math.max(0, c.dp_value - 1);
    } else {
      finalDP = 1;
    }
  } else {
    finalDP = null;
  }

  return {
    cardNumber: c.card_no,
    name: c.name,
    cardType,
    attribute,
    attributeName,
    cost: finalCost,
    basePP: finalPP,
    baseDP: finalDP,
    signalOrb,
    traits,
    isInstant,
    imageUrl: `/cards/${c.card_no}.png`,
    rulesText: c.effect,
    flavorText: cardPackageName,
    packageName: cardPackageName,
    rarity: baseRarity,
    rawCardType: c.card_type,
    rawImages: cardImages,
  };
});

console.log(`Processed ${processedCards.length} cards from card_effects.json`);

// 1. 生成 packages/database/src/seed/official-cards.ts
const dbSeedContent = `import { CardTypeEnum, ElementAttributeEnum, SignalOrbTypeEnum } from '@prisma/client';
import { CardCreateInput } from '../repositories/interfaces.js';

export const OFFICIAL_SEED_CARDS: CardCreateInput[] = [
${processedCards
  .map(
    (c) => `  {
    cardNumber: ${JSON.stringify(c.cardNumber)},
    name: ${JSON.stringify(c.name)},
    cardType: CardTypeEnum.${c.cardType},
    attribute: ElementAttributeEnum.${c.attribute},
    cost: ${c.cost},
    basePP: ${c.basePP !== null ? c.basePP : 'null'},
    baseDP: ${c.baseDP !== null ? c.baseDP : 'null'},
    signalOrb: ${c.signalOrb ? `SignalOrbTypeEnum.${c.signalOrb}` : 'null'},
    traits: ${JSON.stringify(c.traits)},
    isInstant: ${c.isInstant},
    imageUrl: ${JSON.stringify(c.imageUrl)},
    rulesText: ${JSON.stringify(c.rulesText)},
    flavorText: ${JSON.stringify(c.flavorText)},
  },`
  )
  .join('\n')}
];
`;

fs.writeFileSync('f:/zhanshuangpamishi/packages/database/src/seed/official-cards.ts', dbSeedContent, 'utf8');
console.log('Updated packages/database/src/seed/official-cards.ts');

// 2. 生成 packages/game-engine/src/database/official-cards-data.ts
const engineDataContent = `import { CardVersionData, CardType, ElementAttribute, SignalOrbType, AscensionRuleConfig } from '@zhanshuang/shared';

export function parseAscensionConfig(rulesText: string): AscensionRuleConfig | undefined {
  if (!rulesText || (!rulesText.includes('升变条件') && !rulesText.includes('【升变】') && !rulesText.includes('【升变对象】') && !rulesText.includes('【升变费用】') && !rulesText.includes('升变代价'))) {
    return undefined;
  }
  const costMatch = rulesText.match(/(?:【升变费用】|【升变代价】)?\\s*(?:【|\\[)?(?:费用\\s*(\\d+)|(\\d+)\\s*费)(?:】|\\])?/);
  const rawCost = costMatch ? (costMatch[1] || costMatch[2]) : undefined;
  if (!rawCost) return undefined;
  const ascensionCost = parseInt(rawCost, 10);

  let maxCost = 99;
  let nameIncludes = '';
  const targetWithCost = rulesText.match(/费用(?:为)?\\s*(\\d+)\\s*(?:以下)?(?:的)?\\s*[<《](.+?)[>》]/);
  if (targetWithCost && targetWithCost[1] && targetWithCost[2]) {
    maxCost = parseInt(targetWithCost[1], 10);
    nameIncludes = targetWithCost[2];
  } else {
    const directTarget = rulesText.match(/(?:升变条件|【升变条件】|【升变对象】)\\s*(?:竖直状态)?\\s*[<《](.+?)[>》]/);
    if (directTarget && directTarget[1]) {
      nameIncludes = directTarget[1];
      maxCost = 99;
    }
  }
  if (!nameIncludes) return undefined;

  const limitMatch = rulesText.match(/费用上限(\\d+)/);
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

const RAW_OFFICIAL_CARDS: any[] = [
${processedCards
  .map(
    (c) => `  {
    cardNumber: ${JSON.stringify(c.cardNumber)},
    name: ${JSON.stringify(c.name)},
    cardType: CardType.${c.cardType},
    attribute: ElementAttribute.${c.attribute},
    cost: ${c.cost},
    basePP: ${c.basePP !== null ? c.basePP : 'undefined'},
    baseDP: ${c.baseDP !== null ? c.baseDP : 'undefined'},
    signalOrb: ${c.signalOrb ? `SignalOrbType.${c.signalOrb}` : 'undefined'},
    traits: ${JSON.stringify(c.traits)},
    isInstant: ${c.isInstant},
    imageUrl: ${JSON.stringify(c.imageUrl)},
    rulesText: ${JSON.stringify(c.rulesText)},
    flavorText: ${JSON.stringify(c.flavorText)},
  },`
  )
  .join('\n')}
];

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
  imageUrl: c.imageUrl,
}));
`;

fs.writeFileSync('f:/zhanshuangpamishi/packages/game-engine/src/database/official-cards-data.ts', engineDataContent, 'utf8');
console.log('Updated packages/game-engine/src/database/official-cards-data.ts');

// 3. 复制全部 805 张不同稀有度/星级的高清卡图并生成精准的变体映射
const destCardsDir = 'f:/zhanshuangpamishi/apps/web/public/cards';
if (!fs.existsSync(destCardsDir)) {
  fs.mkdirSync(destCardsDir, { recursive: true });
}

let copiedCount = 0;
let baseCopiedCount = 0;
const variantsMapObj = {};

for (const c of processedCards) {
  if (c.rawImages && c.rawImages.length > 0) {
    const cardVariants = [];

    for (const imgPath of c.rawImages) {
      const srcFile = path.join(sourceDir, imgPath);
      const filename = path.basename(imgPath);
      const destFile = path.join(destCardsDir, filename);

      // 拷贝该异画/稀有度卡图
      if (fs.existsSync(srcFile)) {
        if (!fs.existsSync(destFile) || fs.statSync(srcFile).size !== fs.statSync(destFile).size) {
          fs.copyFileSync(srcFile, destFile);
        }
        copiedCount++;
      }

      // 解析星级
      const starMatch = filename.match(/★+/);
      const stars = starMatch ? starMatch[0].length : 0;

      // 提取稀有度 (C, R, SR, SSR, SEC, SP, ST, PR, UR 等)
      const rarityMatch = filename.match(/(?:[_-]|^)(C|R|SR|SSR|SEC|SP|ST|PR|UR|HR)(?:★|[_-]|\.|\s|$)/i);
      let rarity = rarityMatch ? rarityMatch[1].toUpperCase() : '';
      const isPR = filename.toUpperCase().includes('PR') || imgPath.includes('PR-推广卡') || c.cardNumber.startsWith('PR');
      if (isPR) {
        rarity = 'PR';
      }

      // 提取分支 (如 056a, 056b)
      const branchMatch = filename.match(/\d+([a-z])(?:[A-Z★]|\.|$)/);
      const branch = branchMatch ? branchMatch[1].toUpperCase() : '';

      let variantName = '';
      let badge = '';

      if (isPR || rarity === 'PR') {
        if (filename.includes('冠军')) {
          variantName = 'PR 冠军典藏';
          badge = 'PR 冠军';
        } else if (filename.toLowerCase().includes('top') || filename.includes('瑞士轮')) {
          const matchTop = filename.match(/top\d+/i) || filename.match(/瑞士轮[^\.\)]+/i);
          const detail = matchTop ? ` (${matchTop[0]})` : '';
          variantName = `PR 赛事限定${detail}`;
          badge = 'PR 排名';
        } else {
          variantName = 'PR 推广异画';
          badge = 'PR 推广';
        }
      } else if (stars === 0) {
        variantName = rarity ? `${rarity} 基础标准` : '基础标准';
        if (branch) variantName += ` (${branch}版)`;
        badge = rarity ? `${rarity} 原画` : '0★ 基础';
      } else if (stars === 1) {
        variantName = `1★ 箔面异画${branch ? ' (' + branch + '版)' : ''}`;
        badge = '1★ 闪卡';
      } else if (stars === 2) {
        variantName = `2★ 典藏异画${branch ? ' (' + branch + '版)' : ''}`;
        badge = '2★ 典藏';
      } else if (stars >= 3) {
        variantName = `${stars}★ 签名极罕${branch ? ' (' + branch + '版)' : ''}`;
        badge = `${stars}★ 极罕`;
      }

      const variantPkg = isPR ? 'PR-推广卡' : c.packageName;

      cardVariants.push({
        key: filename.replace(/\.[^.]+$/, ''),
        star: stars,
        rarity: rarity || undefined,
        name: variantName,
        shortLabel: isPR ? 'PR' : (stars > 0 ? `${stars}★` : (rarity || '0★')),
        imageUrl: `/cards/${filename}`,
        badge,
        packageName: variantPkg,
        series: variantPkg,
      });
    }

    // 变体排序：常规基础原画(0星非PR) -> 异画(1星/2星) -> PR推广异画
    cardVariants.sort((a, b) => {
      if (a.rarity === 'PR' && b.rarity !== 'PR') return 1;
      if (a.rarity !== 'PR' && b.rarity === 'PR') return -1;
      return a.star - b.star || a.name.localeCompare(b.name);
    });
    variantsMapObj[c.cardNumber] = cardVariants;

    // 将 0星且非PR (或第1张) 变体作为默认卡面，并同时复制为标准 ${c.cardNumber}.png
    const baseVariant = cardVariants.find((v) => v.star === 0 && v.rarity !== 'PR') || cardVariants.find((v) => v.star === 0) || cardVariants[0];
    if (baseVariant) {
      c.imageUrl = baseVariant.imageUrl;
      const srcBaseFile = path.join(destCardsDir, path.basename(baseVariant.imageUrl));
      const destBaseCardFile = path.join(destCardsDir, `${c.cardNumber}.png`);
      if (fs.existsSync(srcBaseFile)) {
        if (!fs.existsSync(destBaseCardFile) || fs.statSync(srcBaseFile).size !== fs.statSync(destBaseCardFile).size) {
          fs.copyFileSync(srcBaseFile, destBaseCardFile);
        }
        baseCopiedCount++;
      }
    }
  }
}

console.log(`Copied ${copiedCount} multi-rarity variant images and ensured ${baseCopiedCount} base card images in public/cards`);

const webCardsDataContent = `import { CardType, ElementAttribute, SignalOrbType } from '@zhanshuang/shared';

export interface CardVariant {
  key: string;
  star: number;
  rarity?: string;
  name: string;
  shortLabel: string;
  imageUrl: string;
  badge?: string;
  packageName?: string;
  series?: string;
}

export interface CardVariantEntry extends CardData {
  variantKey: string;
  variantStar: number;
  variantRarity?: string;
  variantName: string;
  variantBadge?: string;
  baseCardId: string;
}

export interface CardData {
  id: string;
  cardNumber: string;
  name: string;
  cardType: CardType;
  attribute: ElementAttribute;
  cost: number;
  basePP?: number;
  baseDP?: number;
  signalOrb?: SignalOrbType;
  traits: string[];
  isInstant?: boolean;
  imageUrl?: string;
  rulesText: string;
  flavorText?: string;
  series?: string;
  variants?: CardVariant[];
  packageName?: string;
  rarity?: string;
  rawCardType?: string;
  attributeName?: string;
}

export const CARD_VARIANTS_MAP: Record<string, CardVariant[]> = ${JSON.stringify(variantsMapObj, null, 2)};

export const ALL_OFFICIAL_CARDS: CardData[] = [
${processedCards
  .map(
    (c) => `  {
    id: ${JSON.stringify(`c-${c.cardNumber.toLowerCase()}`)},
    cardNumber: ${JSON.stringify(c.cardNumber)},
    name: ${JSON.stringify(c.name)},
    cardType: CardType.${c.cardType},
    attribute: ElementAttribute.${c.attribute},
    cost: ${c.cost},
    basePP: ${c.basePP !== null ? c.basePP : 'undefined'},
    baseDP: ${c.baseDP !== null ? c.baseDP : 'undefined'},
    signalOrb: ${c.signalOrb ? `SignalOrbType.${c.signalOrb}` : 'undefined'},
    traits: ${JSON.stringify(c.traits)},
    isInstant: ${c.isInstant},
    imageUrl: ${JSON.stringify(c.imageUrl)},
    rulesText: ${JSON.stringify(c.rulesText)},
    flavorText: ${JSON.stringify(c.flavorText)},
    series: ${JSON.stringify(c.flavorText)},
    packageName: ${JSON.stringify(c.packageName)},
    rarity: ${JSON.stringify(c.rarity)},
    rawCardType: ${JSON.stringify(c.rawCardType)},
    attributeName: ${JSON.stringify(c.attributeName)},
    variants: CARD_VARIANTS_MAP[${JSON.stringify(c.cardNumber)}],
  },`
  )
  .join('\n')}
];

/**
 * 获取卡牌的可切换卡面异画 (0星 / 1星 / 2星 / 3星)
 */
export function getCardVariants(cardNumber: string): CardVariant[] {
  if (CARD_VARIANTS_MAP[cardNumber]) {
    return CARD_VARIANTS_MAP[cardNumber]!;
  }
  return [
    {
      key: '0',
      star: 0,
      name: '0星 (基础标准)',
      shortLabel: '0★',
      imageUrl: \`/cards/\${cardNumber}.png\`,
      badge: '0★ 基础',
    },
  ];
}

/**
 * 依据卡牌编号、内部 ID、异画识别码全域检索卡牌
 */
export function findCardByNumberOrId(key: string): CardData | undefined {
  if (!key) return undefined;
  const decoded = decodeURIComponent(key).trim().toUpperCase();
  const direct = (
    ALL_OFFICIAL_CARDS.find((c) => c.cardNumber.toUpperCase() === decoded) ||
    ALL_OFFICIAL_CARDS.find((c) => c.id.toUpperCase() === decoded) ||
    ALL_OFFICIAL_CARDS.find((c) => c.name.toUpperCase() === decoded)
  );
  if (direct) return direct;
  return ALL_OFFICIAL_CARDS.find((c) => {
    if (decoded.startsWith(c.cardNumber.toUpperCase())) return true;
    if (decoded.startsWith(c.id.toUpperCase())) return true;
    const variants = CARD_VARIANTS_MAP[c.cardNumber];
    if (variants && variants.some((v) => v.key.toUpperCase() === decoded)) return true;
    return false;
  });
}

/**
 * 全量 808 张独立异画/原画版本卡牌实体清单
 * 满足卡牌图鉴与卡组构筑中每种异画版本独立展示的需求，
 * 但所有异画均保持相同的 cardNumber，从而在构筑规则中自动共用同一卡牌编号上限 (4张)
 */
export const ALL_CARD_VARIANT_ENTRIES: CardVariantEntry[] = (() => {
  const list: CardVariantEntry[] = [];
  for (const card of ALL_OFFICIAL_CARDS) {
    const variants = CARD_VARIANTS_MAP[card.cardNumber];
    if (variants && variants.length > 0) {
      for (const v of variants) {
        list.push({
          ...card,
          id: \`\${card.id}_\${v.key}\`,
          baseCardId: card.id,
          variantKey: v.key,
          variantStar: v.star,
          variantRarity: v.rarity || card.rarity,
          variantName: v.name,
          variantBadge: v.badge || (v.star > 0 ? \`\${v.star}★ 异画\` : \`\${card.rarity || ''} 原画\`),
          imageUrl: v.imageUrl,
          rarity: v.rarity || card.rarity,
          packageName: v.packageName || card.packageName,
          series: v.series || v.packageName || card.series,
        });
      }
    } else {
      list.push({
        ...card,
        baseCardId: card.id,
        variantKey: card.cardNumber,
        variantStar: 0,
        variantRarity: card.rarity,
        variantName: '基础标准',
        variantBadge: \`\${card.rarity || ''} 原画\`,
        imageUrl: card.imageUrl,
      });
    }
  }
  return list;
})();

/**
 * 获取关联角色或相同角色名卡牌 (形态升变链)
 */
export function getRelatedCards(currentCard: CardData): CardData[] {
  const baseName = currentCard.name.split('·')[0] || currentCard.name;
  return ALL_OFFICIAL_CARDS.filter((c) => {
    if (c.cardNumber === currentCard.cardNumber) return false;
    if (c.name.startsWith(baseName) || c.traits.some((t) => currentCard.traits.includes(t) && t !== '结构体' && t !== '信号球' && t !== '战术')) {
      return true;
    }
    return false;
  }).slice(0, 8);
}

/**
 * 根据卡号推断所属系列/卡包
 */
export function getCardSeries(cardNumber: string): string {
  if (!cardNumber) return '其他';
  const upper = cardNumber.trim().toUpperCase();
  if (upper.startsWith('BP01')) return 'BP01-命运交锋';
  if (upper.startsWith('BP02')) return 'BP02-星海时溯';
  if (upper.startsWith('BP03')) return 'BP03-誓焰破晓';
  if (upper.startsWith('BP04')) return 'BP04-终焉月冕';
  if (upper.startsWith('PR')) return 'PR-推广卡';
  if (upper.startsWith('ST01')) return 'ST01-灰鸦小队预组';
  if (upper.startsWith('ST02')) return 'ST02-升格者小队预组';
  if (upper.startsWith('ST03')) return 'ST03-三头犬小队预组';
  if (upper.startsWith('ST04')) return 'ST04-突击鹰小队预组';
  if (upper.startsWith('ST05')) return 'ST05-比安卡·晖暮预组';
  if (upper.startsWith('ST06')) return 'ST06-亚里莎·回音预组';
  return upper.split('-')[0] || '其他';
}

/**
 * 格式化卡牌类型为规范中文名称
 */
export function formatCardType(type: CardType | string | undefined, isInstant?: boolean): string {
  if (!type) return '卡牌';
  const t = String(type).toUpperCase();
  if (t === 'ROLE' || t.includes('ROLE')) return '角色牌';
  if (t === 'EQUIPMENT' || t.includes('EQUIP')) return '装备牌';
  if (t === 'ASSIST' || t.includes('ASSIST')) return '辅助机牌';
  if (t === 'TACTICS' || t.includes('TACTIC')) {
    return isInstant ? '瞬时战术牌' : '战术牌';
  }
  return String(type);
}

/**
 * 获取属性的中文名称与徽章显示样式
 */
export function getAttributeDisplay(attr?: ElementAttribute | string, attrName?: string) {
  if (attrName === '空' || attr === ElementAttribute.VOID || attr === 'VOID') {
    return {
      name: '空',
      fullName: '空属性',
      text: '空 VOID',
      badgeText: '空 VOID',
      color: 'text-cyan-300 border-cyan-400/40 bg-cyan-400/10',
      tagColor: 'text-cyan-300 border-cyan-500/40 bg-cyan-950/40',
    };
  }
  switch (attr) {
    case ElementAttribute.PHYSICAL:
    case 'PHYSICAL':
      return {
        name: '物理',
        fullName: '物理属性',
        text: '物理 PHYSICAL',
        badgeText: '物理 PHYSICAL',
        color: 'text-amber-400 border-amber-500/40 bg-amber-500/10',
        tagColor: 'text-amber-300 border-amber-500/40 bg-amber-950/40',
      };
    case ElementAttribute.DARK:
    case 'DARK':
      return {
        name: '暗',
        fullName: '暗属性',
        text: '暗 DARK',
        badgeText: '暗 DARK',
        color: 'text-purple-400 border-purple-500/40 bg-purple-500/10',
        tagColor: 'text-purple-400 border-purple-500/40 bg-purple-950/40',
      };
    case ElementAttribute.FIRE:
    case 'FIRE':
      return {
        name: '火',
        fullName: '火属性',
        text: '火 FIRE',
        badgeText: '火 FIRE',
        color: 'text-red-400 border-red-500/40 bg-red-500/10',
        tagColor: 'text-red-400 border-red-500/40 bg-red-950/40',
      };
    case ElementAttribute.ICE:
    case 'ICE':
      return {
        name: '冰',
        fullName: '冰属性',
        text: '冰 ICE',
        badgeText: '冰 ICE',
        color: 'text-blue-400 border-blue-500/40 bg-blue-500/10',
        tagColor: 'text-cyan-300 border-cyan-500/40 bg-cyan-950/40',
      };
    case ElementAttribute.LIGHTNING:
    case 'LIGHTNING':
      return {
        name: '雷',
        fullName: '雷属性',
        text: '雷 LIGHTNING',
        badgeText: '雷 LIGHTNING',
        color: 'text-yellow-400 border-yellow-500/40 bg-yellow-500/10',
        tagColor: 'text-yellow-400 border-yellow-500/40 bg-yellow-950/40',
      };
    default:
      return {
        name: '无',
        fullName: '无属性',
        text: '无属性 NONE',
        badgeText: '无属性 NONE',
        color: 'text-neutral-400 border-neutral-600 bg-neutral-800/40',
        tagColor: 'text-neutral-400 border-neutral-700 bg-neutral-900',
      };
  }
}
`;

fs.writeFileSync('f:/zhanshuangpamishi/apps/web/src/lib/cards-data.ts', webCardsDataContent, 'utf8');
console.log('Updated apps/web/src/lib/cards-data.ts');
console.log('All 490 card tables updated successfully across all packages!');
