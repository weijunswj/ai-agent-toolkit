const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '..', '_projects', 'n8n', 'local-setup', '_main');
const files = fs.readdirSync(dir);

files.forEach(file => {
  if (file.endsWith('.md') || file.startsWith('mcp')) {
    const fullPath = path.join(dir, file);
    if (!fs.statSync(fullPath).isFile()) return;
    let content = fs.readFileSync(fullPath, 'utf8');
    
    // Replace URL encoded
    content = content.replace(/1\.%20local%20setup\.md/g, 'Page%201.md');
    content = content.replace(/2\.%20upgrading\.md/g, 'Page%202.md');
    content = content.replace(/3\.%20vps%20hosting\.md/g, 'Page%203.md');
    
    // Replace non-encoded
    content = content.replace(/1\.\s+local\s+setup\.md/g, 'Page 1.md');
    content = content.replace(/2\.\s+upgrading\.md/g, 'Page 2.md');
    content = content.replace(/3\.\s+vps\s+hosting\.md/g, 'Page 3.md');
    
    // Replace markdown titles
    content = content.replace(/\[1\. Local Setup\]/g, '[1. Local Setup]');
    content = content.replace(/\[2\. Upgrading\]/g, '[2. Upgrading]');
    content = content.replace(/\[3\. VPS Hosting\]/g, '[3. VPS Hosting]');
    
    fs.writeFileSync(fullPath, content, 'utf8');
  }
});

// Now fix the test file regexes
const testPath = path.join(__dirname, '..', '..', 'repo', 'tests', 'n8n-local-setup-fidelity.test.cjs');
let testContent = fs.readFileSync(testPath, 'utf8');

// Fixing upgrading guide regex
testContent = testContent.replace(/## 2\\\\\.1\\\\\. Upgrade/g, '## 1\\\\. Upgrade');
testContent = testContent.replace(/## 2\\\\\.2\\\\\. Upgrade/g, '## 2\\\\. Upgrade');
testContent = testContent.replace(/## 2\\\\\.3\\\\\. Upgrade/g, '## 3\\\\. Upgrade');

fs.writeFileSync(testPath, testContent, 'utf8');
console.log('Fixed links and tests');
