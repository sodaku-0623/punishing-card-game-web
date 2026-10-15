const fs = require('fs');

function checkFile(path) {
  const content = fs.readFileSync(path, 'utf8');
  const lines = content.split('\n');
  lines.forEach((l, idx) => {
    if (l.includes('SEARCH_TOP_CARDS') || l.includes('ST01-010') || l.includes('ST02-003')) {
      console.log(`${path}:${idx + 1}: ${l}`);
    }
  });
}

checkFile('packages/game-engine/test/official-all-cards-effects.test.ts');
checkFile('packages/game-engine/test/game-engine.test.ts');
checkFile('packages/game-engine/test/cost-reduction-and-charge.test.ts');
