import fs from 'node:fs';

// card_effects.json 路径通过命令行参数传入，默认读取仓库内卡表目录
const effectsPath = process.argv[2] || new URL('../../战双帕弥什对战卡牌卡表/card_effects.json', import.meta.url);
const rawData = JSON.parse(fs.readFileSync(effectsPath, 'utf8'));

function parseAscensionConfig(rulesText) {
  if (!rulesText || (!rulesText.includes('升变条件') && !rulesText.includes('【升变】') && !rulesText.includes('【升变对象】') && !rulesText.includes('【升变费用】') && !rulesText.includes('升变代价'))) {
    return undefined;
  }
  const costMatch = rulesText.match(/(?:【升变费用】|【升变代价】)?\s*(?:【|\[)?(?:费用\s*(\d+)|(\d+)\s*费)(?:】|\])?/);
  const rawCost = costMatch ? (costMatch[1] || costMatch[2]) : undefined;
  if (!rawCost) return undefined;
  const ascensionCost = parseInt(rawCost, 10);

  let maxCost = 99;
  let nameIncludes = '';
  const targetWithCost = rulesText.match(/费用(?:为)?\s*(\d+)\s*(?:以下)?(?:的)?\s*[<《](.+?)[>》]/);
  if (targetWithCost) {
    maxCost = parseInt(targetWithCost[1], 10);
    nameIncludes = targetWithCost[2];
  } else {
    const directTarget = rulesText.match(/(?:升变条件|【升变条件】|【升变对象】)\s*(?:竖直状态)?\s*[<《](.+?)[>》]/);
    if (directTarget) {
      nameIncludes = directTarget[1];
      maxCost = 99;
    }
  }
  if (!nameIncludes) return undefined;

  const limitMatch = rulesText.match(/费用上限(\d+)/);
  const minCostLimit = limitMatch && limitMatch[1] ? parseInt(limitMatch[1], 10) : undefined;
  const grantKeywords = [];
  if (rulesText.includes('速攻')) grantKeywords.push('速攻');
  return {
    targetFilter: { maxCost, nameIncludes },
    restrictionFilter: minCostLimit ? { minCostLimit } : undefined,
    ascensionCost,
    grantKeywords,
  };
}

const allCards = Object.values(rawData);
const ascCards = allCards.filter(c => parseAscensionConfig(c.rulesText));
console.log(`Parsed ${ascCards.length} ascension cards out of ${allCards.length}`);
for (const c of ascCards) {
  const cfg = parseAscensionConfig(c.rulesText);
  console.log(`${c.card_no} [${c.name}] Cost: ${cfg.ascensionCost}, Target: <${cfg.targetFilter.nameIncludes}> (maxCost ${cfg.targetFilter.maxCost}), Limit: ${cfg.restrictionFilter?.minCostLimit || 'none'}, Grant: ${cfg.grantKeywords.join(',')}`);
}
