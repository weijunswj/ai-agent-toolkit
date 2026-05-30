const fs = require('fs');
const path = require('path');

const testPath = path.join(__dirname, '..', '..', 'repo', 'tests', 'n8n-local-setup-fidelity.test.cjs');
let text = fs.readFileSync(testPath, 'utf8');

// Fixing n8n local setup main guide follows beginner-first install structure
text = text.replace(/assert\.match\(text, \/## 1\\\\.\/, 'Must contain fast path reference section'\);/, "assert.match(text, /## 1\\\\./, 'Must contain fast path reference section');");
text = text.replace(/assert\.match\(text, \/## 2\\\\.\/, 'Must contain before you start section'\);/, "assert.match(text, /## 2\\\\./, 'Must contain before you start section');");
text = text.replace(/assert\.match\(text, \/## 15\\\\.\/, 'Must contain troubleshooting section'\);/, "assert.match(text, /## 15\\\\./, 'Must contain troubleshooting section');");
text = text.replace(/assert\.match\(text, \/## 5\\\\\. Create And Fill \\`\\.env\\`\/\);/, "assert.match(text, /## 5\\\\. Create And Fill \\`\\.env\\`/);");
text = text.replace(/assert\.match\(text, \/## 8\\\\\. First Launch: Local-Only Owner Setup\/\);/, "assert.match(text, /## 8\\\\. First Launch: Local-Only Owner Setup/);");

text = text.replace(/assert\.match\(localSetup, \/## 3\\\\\. Create The Local Stack Folder\/\);/g, "assert.match(localSetup, /## 3\\\\. Create The Local Stack Folder/);");

// Wait, the previous replacement script might have replaced `1\.1` with `1\.` inside regexes but let's just make sure:
text = text.replace(/assert\.match\(text, \/## 1\\\\.1\\\\.\/, 'Must contain fast path reference section'\);/g, "assert.match(text, /## 1\\\\./, 'Must contain fast path reference section');");
text = text.replace(/assert\.match\(text, \/## 1\\\\.2\\\\.\/, 'Must contain before you start section'\);/g, "assert.match(text, /## 2\\\\./, 'Must contain before you start section');");
text = text.replace(/assert\.match\(text, \/## 1\\\\.15\\\\.\/, 'Must contain troubleshooting section'\);/g, "assert.match(text, /## 15\\\\./, 'Must contain troubleshooting section');");
text = text.replace(/assert\.match\(text, \/## 1\\\\.5 Create And Fill \\`\\.env\\`\/\);/g, "assert.match(text, /## 5\\\\. Create And Fill \\`\\.env\\`/);");
text = text.replace(/assert\.match\(text, \/## 1\\\\.8 First Launch: Local-Only Owner Setup\/\);/g, "assert.match(text, /## 8\\\\. First Launch: Local-Only Owner Setup/);");

// n8n local setup keeps run-location guidance with cd before folder-specific PowerShell
text = text.replace(/## 4\\\\. Copy The Local Stack Templates\$\/m/g, "## 4\\\\. Copy The Local Stack Templates$/m");
text = text.replace(/## 1\\\\.4 Copy The Local Stack Templates\$\/m/g, "## 4\\\\. Copy The Local Stack Templates$/m");

// n8n upgrading guide order and content
text = text.replace(/assert\.match\(upgrading, \/## 1\\\\. Upgrade This Guide.s Local Setup\/\);/g, "assert.match(upgrading, /## 1\\\\. Upgrade This Guide.s Local Setup/);");
text = text.replace(/assert\.match\(upgrading, \/## 2\\\\. Upgrade Hostinger n8n\/\);/g, "assert.match(upgrading, /## 2\\\\. Upgrade Hostinger n8n/);");
text = text.replace(/assert\.match\(upgrading, \/## 3\\\\. Upgrade Other VPS \\\/ Docker Compose n8n\/\);/g, "assert.match(upgrading, /## 3\\\\. Upgrade Other VPS \\\/ Docker Compose n8n/);");

text = text.replace(/assert\.match\(upgrading, \/## 2\\\\.1\\\\. Upgrade This Guide.s Local Setup\/\);/g, "assert.match(upgrading, /## 1\\\\. Upgrade This Guide.s Local Setup/);");
text = text.replace(/assert\.match\(upgrading, \/## 2\\\\.2\\\\. Upgrade Hostinger n8n\/\);/g, "assert.match(upgrading, /## 2\\\\. Upgrade Hostinger n8n/);");
text = text.replace(/assert\.match\(upgrading, \/## 2\\\\.3\\\\. Upgrade Other VPS \\\/ Docker Compose n8n\/\);/g, "assert.match(upgrading, /## 3\\\\. Upgrade Other VPS \\\/ Docker Compose n8n/);");

fs.writeFileSync(testPath, text, 'utf8');
