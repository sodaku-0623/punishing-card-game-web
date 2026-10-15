const fs = require('fs');

const content = fs.readFileSync('packages/database/src/seed/official-cards.ts', 'utf8');
const cardBlocks = content.split('{\n    cardNumber:').slice(1);

const cardsWithCosts = [];

for (const b of cardBlocks) {
  const numMatch = b.match(/"([^"]+)"/);
  const nameMatch = b.match(/name:\s*"([^"]+)"/);
  const textMatch = b.match(/rulesText:\s*"([^"]*)"/);
  if (!numMatch || !nameMatch || !textMatch) continue;
  const num = numMatch[1];
  const name = nameMatch[1];
  const text = textMatch[1].replace(/\\n/g, '\n');

  // Check for costs (cost: effect)
  // Usually marked with colon ':' like "丢弃1张手牌：", "消除...：", "横置该牌："
  const costMatches = text.match(/(?:【[出起自协战自]+】\s*)?([^：:\n]+[：:])([^\n]+)/g);
  if (costMatches) {
    for (const m of costMatches) {
      if (m.includes('丢弃') || m.includes('消除') || m.includes('横置') || m.includes('放置到墓地') || m.includes('返回手牌')) {
        cardsWithCosts.push({ num, name, match: m });
      }
    }
  }
}

console.log('Total card abilities with costs:', cardsWithCosts.length);
cardsWithCosts.slice(0, 40).forEach(c => {
  console.log(`[${c.num}] ${c.name} -> ${c.match.replace(/\n/g, ' ')}`);
});
