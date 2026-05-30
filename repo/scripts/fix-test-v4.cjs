const fs = require('fs');
const path = require('path');

const testPath = path.join(__dirname, '..', '..', 'repo', 'tests', 'n8n-local-setup-fidelity.test.cjs');
let text = fs.readFileSync(testPath, 'utf8');

text = text.replace(/Page 1\.md/g, 'Page 1 - Local Setup.md');
text = text.replace(/Page%201\.md/g, 'Page%201%20-%20Local%20Setup.md');

text = text.replace(/Page 2\.md/g, 'Page 2 - Upgrading.md');
text = text.replace(/Page%202\.md/g, 'Page%202%20-%20Upgrading.md');

text = text.replace(/Page 3\.md/g, 'Page 3 - VPS Hosting.md');
text = text.replace(/Page%203\.md/g, 'Page%203%20-%20VPS%20Hosting.md');

fs.writeFileSync(testPath, text, 'utf8');
console.log('Fixed test file');
