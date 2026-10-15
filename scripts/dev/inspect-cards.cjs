const fs = require('fs');
const content = fs.readFileSync('packages/game-engine/test/card-effects.test.ts', 'utf8');
const lines = content.split('\n');

lines.forEach((l, idx) => {
  if (l.includes('ST01-010') || l.includes('SEARCH_TOP_CARDS') || l.includes('ST02-003')) {
    console.log(`${idx + 1}: ${l}`);
  }
});
