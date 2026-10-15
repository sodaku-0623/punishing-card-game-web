const fs = require('fs');
const content = fs.readFileSync('packages/game-engine/src/effects/card-effects.ts', 'utf8');
const lines = content.split('\n');

lines.forEach((line, idx) => {
  if (line.match(/^\s*(public|private|static)?\s*[a-zA-Z0-9_]+\([^)]*\)\s*[:{]/)) {
    console.log(`${idx + 1}: ${line.trim()}`);
  }
});
