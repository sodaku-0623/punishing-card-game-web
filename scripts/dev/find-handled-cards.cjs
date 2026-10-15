const fs = require('fs');

const content = fs.readFileSync('packages/game-engine/src/effects/card-effects.ts', 'utf8');
const cardNumMatches = [...content.matchAll(/([A-Z]{2}\d{2}-\d{3}[a-z]?)/g)].map(m => m[1]);
const uniqueCards = Array.from(new Set(cardNumMatches));

console.log('Cards explicitly mentioned in card-effects.ts:', uniqueCards.length);
console.log(uniqueCards.sort());
