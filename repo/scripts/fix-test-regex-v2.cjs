const fs = require('fs');
const path = require('path');

const testPath = path.join(__dirname, '..', '..', 'repo', 'tests', 'n8n-local-setup-fidelity.test.cjs');
let content = fs.readFileSync(testPath, 'utf8');

// H2s were ## 1.1., now they are ## 1.
// We'll replace the hardcoded regexes.
content = content.replace(/## 1\\\\\.1\\\\./g, '## 1\\\\.');
content = content.replace(/## 1\\\\\.2\\\\./g, '## 2\\\\.');
content = content.replace(/## 1\\\\\.3\\\\./g, '## 3\\\\.');
content = content.replace(/## 1\\\\\.4\\\\./g, '## 4\\\\.');
content = content.replace(/## 1\\\\\.5\\\\./g, '## 5\\\\.');
content = content.replace(/## 1\\\\\.8\\\\./g, '## 8\\\\.'); // Wait, I need to check the original H2 number mappings.
// Let's just fix the tests manually or with a generic regex replace for the test file.
// Or I can just replace the test asserts with the exact strings since I know them.
content = content.replace(/## 1\\\\\.15\\\\./g, '## 15\\\\.');

// Upgrading guide H2s
content = content.replace(/## 2\\\\\.1\\\\\. Upgrade/g, '## 1\\\\. Upgrade');
content = content.replace(/## 2\\\\\.2\\\\\. Upgrade/g, '## 2\\\\. Upgrade');
content = content.replace(/## 2\\\\\.3\\\\\. Upgrade/g, '## 3\\\\. Upgrade');

fs.writeFileSync(testPath, content, 'utf8');
console.log('Fixed test file v2');
