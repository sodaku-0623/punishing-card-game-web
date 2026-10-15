const fs = require('fs');
const content = fs.readFileSync('packages/game-engine/src/effects/card-effects.ts', 'utf8');

// Find all occurrences of setPendingChoice
const regex = /setPendingChoice\(\{[\s\S]*?effectType:\s*'([^']+)'[\s\S]*?\}\)/g;
const effectTypesInSet = new Set();
let match;
while ((match = regex.exec(content)) !== null) {
  effectTypesInSet.add(match[1]);
}
console.log('effectTypes in setPendingChoice:', Array.from(effectTypesInSet));

// Find all cases in handleChoiceResolution
const caseRegex = /case\s+'([^']+)':/g;
const cases = new Set();
while ((match = caseRegex.exec(content)) !== null) {
  cases.add(match[1]);
}
console.log('cases in handleChoiceResolution:', Array.from(cases));
