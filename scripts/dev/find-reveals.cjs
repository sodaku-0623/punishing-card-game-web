const fs = require('fs');
const content = fs.readFileSync('packages/game-engine/src/effects/card-effects.ts', 'utf8');
const lines = content.split('\n');

lines.forEach((l, idx) => {
  if (l.includes('公开') || l.includes('SEARCH_TOP_CARDS') || l.includes('topCardIds')) {
    console.log(`${idx + 1}: ${l}`);
  }
});
