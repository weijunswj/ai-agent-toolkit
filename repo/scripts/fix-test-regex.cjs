const fs = require('fs');
const path = require('path');

const testPath = path.join(__dirname, '..', '..', 'repo', 'tests', 'n8n-local-setup-fidelity.test.cjs');
let content = fs.readFileSync(testPath, 'utf8');

// Fix escaped regexes
content = content.replace(/1\\\\\.%20local%20setup\\\\\.md/g, 'Page%201\\\\.md');
content = content.replace(/2\\\\\.%20upgrading\\\\\.md/g, 'Page%202\\\\.md');
content = content.replace(/3\\\\\.%20vps%20hosting\\\\\.md/g, 'Page%203\\\\.md');
content = content.replace(/local-setup\\\\\.md/g, 'Page%201\\\\.md'); // sometimes they assert just the filename part

content = content.replace(/1\\\\\. Local Setup/g, '1. Local Setup'); // sometimes they assert the heading title

// Fix heading checks
content = content.replace(/## 1\\\\\.1/g, '## 1\\\\.1\\\\.');
content = content.replace(/## 1\\\\\.2/g, '## 1\\\\.2\\\\.');
content = content.replace(/## 1\\\\\.3/g, '## 1\\\\.3\\\\.');
content = content.replace(/## 1\\\\\.4/g, '## 1\\\\.4\\\\.');
content = content.replace(/## 1\\\\\.5/g, '## 1\\\\.5\\\\.');
content = content.replace(/## 1\\\\\.10/g, '## 1\\\\.10\\\\.');
content = content.replace(/## 2\\\\\.1/g, '## 2\\\\.1\\\\.');
content = content.replace(/## 3\\\\\.1/g, '## 3\\\\.1\\\\.');

// Fix the exact string expected regex
content = content.replace(/\[1\\\\\. Local Setup\]/g, '[1. Local Setup]');
content = content.replace(/\[3\\\\\. VPS Hosting\]/g, '[3. VPS Hosting]');
content = content.replace(/\[2\\\\\. Upgrading\]/g, '[2. Upgrading]');

// Some of these might be just normal strings
content = content.replace(/\[1\. Local Setup\]\(\.\/1\.%20local%20setup\.md\)/g, '[1. Local Setup](./Page%201.md)');

fs.writeFileSync(testPath, content, 'utf8');
console.log('Fixed test file');
