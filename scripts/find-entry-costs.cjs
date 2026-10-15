const fs = require('fs');

const content = fs.readFileSync('packages/database/src/seed/official-cards.ts', 'utf8');
const cardBlocks = content.split('{\n    cardNumber:').slice(1);

const cards = [];
for (const b of cardBlocks) {
  const numMatch = b.match(/"([^"]+)"/);
  const nameMatch = b.match(/name:\s*"([^"]+)"/);
  const textMatch = b.match(/rulesText:\s*"([^"]*)"/);
  if (!numMatch || !nameMatch || !textMatch) continue;
  const num = numMatch[1];
  const name = nameMatch[1];
  const text = textMatch[1].replace(/\\n/g, '\n');

  const m = text.match(/【出】\s*(?:可以)?(?:丢弃|消除|横置|将该牌)[^：:\n]+[：:]([^\n]+)/);
  if (m) {
    cards.push({ num, name, full: m[0], effect: m[1] });
  }
}

console.log('Cards with 【出】 [cost] : [effect]:', cards.length);
cards.slice(0, 30).forEach(c => {
  console.log(`[${c.num}] ${c.name}: ${c.full}`);
});
