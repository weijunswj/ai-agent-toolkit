const fs = require('fs');
const path = require('path');

const testPath = path.join(__dirname, '..', '..', 'repo', 'tests', 'n8n-local-setup-fidelity.test.cjs');
let text = fs.readFileSync(testPath, 'utf8');
const oldText = text;

// For line 181:
text = text.replace(/assert\.match\(readme, \/\\\[1\\\. Local Setup\\\]\\\(\\.\\\/1\\\.%20local%20setup\\\.md\\\)\/\);/g, "assert.match(readme, /\\[1\\. Local Setup\\]\\(\\.\\/Page%201\\.md\\)/);");
text = text.replace(/assert\.match\(readme, \/\\\[2\\\. Upgrading\\\]\\\(\\.\\\/2\\\.%20upgrading\\\.md\\\)\/\);/g, "assert.match(readme, /\\[2\\. Upgrading\\]\\(\\.\\/Page%202\\.md\\)/);");
text = text.replace(/assert\.match\(readme, \/\\\[3\\\. VPS Hosting\\\]\\\(\\.\\\/3\\\.%20vps%20hosting\\\.md\\\)\/\);/g, "assert.match(readme, /\\[3\\. VPS Hosting\\]\\(\\.\\/Page%203\\.md\\)/);");

// And for line 593:
text = text.replace(/assert\.match\(index, \/\\\[1\\\. Local Setup\\\]\\\(\\.\\\/Page%201\\\.md\\\)\/\);/g, "assert.match(index, /\\[local-setup\\.md\\]\\(local-setup\\.md\\)/);");
text = text.replace(/assert\.match\(index, \/\\\[2\\\. Upgrading\\\]\\\(\\.\\\/Page%202\\\.md\\\)\/\);/g, "assert.match(index, /\\[upgrading\\.md\\]\\(upgrading\\.md\\)/);");
text = text.replace(/assert\.match\(index, \/\\\[3\\\. VPS Hosting\\\]\\\(\\.\\\/Page%203\\\.md\\\)\/\);/g, "assert.match(index, /\\[vps-hosting\\.md\\]\\(vps-hosting\\.md\\)/);");

if (text !== oldText) {
  fs.writeFileSync(testPath, text, 'utf8');
  console.log('Fixed test file v6');
} else {
  console.log('No changes made to test file!');
}
