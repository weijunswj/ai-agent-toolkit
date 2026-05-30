const fs = require('fs');
const path = require('path');

const testPath = path.join(__dirname, '..', '..', 'repo', 'tests', 'n8n-local-setup-fidelity.test.cjs');
let text = fs.readFileSync(testPath, 'utf8');

// The multi_replace_file_content incorrectly changed lines around 593.
// Let's restore those lines.
text = text.replace(/assert\.match\(index, \/\\\[1\\\\\. Local Setup\\\]\\\(\\\\\.\\\/Page%201\\\\\.md\\\)\/\);/, "assert.match(index, /\\[local-setup\\.md\\]\\(local-setup\\.md\\)/);");
text = text.replace(/assert\.match\(index, \/\\\[2\\\\\. Upgrading\\\]\\\(\\\\\.\\\/Page%202\\\\\.md\\\)\/\);/, "assert.match(index, /\\[upgrading\\.md\\]\\(upgrading\\.md\\)/);");
text = text.replace(/assert\.match\(index, \/\\\[3\\\\\. VPS Hosting\\\]\\\(\\\\\.\\\/Page%203\\\\\.md\\\)\/\);/, "assert.match(index, /\\[vps-hosting\\.md\\]\\(vps-hosting\\.md\\)/);");

// Now fix the actual lines around 180.
text = text.replace(/assert\.match\(readme, \/\\\[1\\\\\. Local Setup\\\]\\\(\\\\\.\\\/1\\\\\.%20local%20setup\\\\\.md\\\)\/\);/, "assert.match(readme, /\\[1\\. Local Setup\\]\\(\\.\\/Page%201\\.md\\)/);");
text = text.replace(/assert\.match\(readme, \/\\\[2\\\\\. Upgrading\\\]\\\(\\\\\.\\\/2\\\\\.%20upgrading\\\\\.md\\\)\/\);/, "assert.match(readme, /\\[2\\. Upgrading\\]\\(\\.\\/Page%202\\.md\\)/);");
text = text.replace(/assert\.match\(readme, \/\\\[3\\\\\. VPS Hosting\\\]\\\(\\\\\.\\\/3\\\\\.%20vps%20hosting\\\\\.md\\\)\/\);/, "assert.match(readme, /\\[3\\. VPS Hosting\\]\\(\\.\\/Page%203\\.md\\)/);");

fs.writeFileSync(testPath, text, 'utf8');
console.log('Fixed test file');
