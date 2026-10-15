const fs = require('fs');

const content = fs.readFileSync('packages/database/src/seed/official-cards.ts', 'utf8');
const cardBlocks = content.split('{\n    cardNumber:').slice(1);

const revealCards = [];

for (const b of cardBlocks) {
  const numMatch = b.match(/"([^"]+)"/);
  const nameMatch = b.match(/name:\s*"([^"]+)"/);
  const textMatch = b.match(/rulesText:\s*"([^"]*)"/);
  if (!numMatch || !nameMatch || !textMatch) continue;
  const num = numMatch[1];
  const name = nameMatch[1];
  const text = textMatch[1];
  
  if (text.includes('公开') && text.includes('牌组顶')) {
    revealCards.push({ num, name, text });
  }
}

console.log('Total cards with 公开牌组顶:', revealCards.length);
revealCards.forEach(c => {
  console.log(`${c.num} [${c.name}]: ${c.text.replace(/\\n/g, ' ')}`);
});
