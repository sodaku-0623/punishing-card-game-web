const fs = require('fs');
const content = fs.readFileSync('packages/game-engine/src/effects/card-effects.ts', 'utf8');
const lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.match(/^  [a-zA-Z0-9_]+\s*\(/) || line.match(/^  (public|private)\s+[a-zA-Z0-9_]+\s*\(/)) {
    console.log(`${i + 1}: ${line}`);
  }
}
