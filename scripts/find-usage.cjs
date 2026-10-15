const fs = require('fs');
const path = require('path');

function searchInDir(dir, pattern, extList = ['.ts', '.tsx', '.js', '.vue']) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist' && entry.name !== 'release') {
        searchInDir(fullPath, pattern, extList);
      }
    } else if (extList.some(e => entry.name.endsWith(e))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (pattern.test(content)) {
        console.log(`Matched: ${fullPath}`);
      }
    }
  }
}

console.log('Searching for pendingChoice:');
searchInDir('packages', /pendingChoice/i);
searchInDir('apps', /pendingChoice/i);
