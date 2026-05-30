const fs = require('fs');
const path = require('path');

const testPath = path.join(__dirname, '..', '..', 'repo', 'tests', 'n8n-local-setup-fidelity.test.cjs');
let text = fs.readFileSync(testPath, 'utf8');

text = text.replace(
  `  assert.match(readme, /^\#\# Start Here$/m);\n  assert.match(readme, /\\[1\\\\. Local Setup\\]\\(\\\\\\.\\/Page%201%20-%20Local%20Setup\\\\.md\\)/);\n  assert.match(readme, /\\[2\\\\. Upgrading\\]\\(\\\\\\.\\/Page%202%20-%20Upgrading\\\\.md\\)/);\n  assert.match(readme, /\\[3\\\\. VPS Hosting\\]\\(\\\\\\.\\/Page%203%20-%20VPS%20Hosting\\\\.md\\)/);`,
  `  assert.match(readme, /^\#\# Start Here$/m);\n  assert.match(readme, /\\[1\\\\. Local Setup\\]\\(\\\\\\.\\/Page%201%20-%20Local%20Setup\\\\.md\\)/);\n  assert.match(readme, /These pages are secondary references\\\\. They are not equal start paths for local setup\\\\./);\n  assert.match(readme, /\\[3\\\\. VPS Hosting\\]\\(\\\\\\.\\/Page%203%20-%20VPS%20Hosting\\\\.md\\)/);`
);

fs.writeFileSync(testPath, text, 'utf8');
console.log('Fixed test file 6');
