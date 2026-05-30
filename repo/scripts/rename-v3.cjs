const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..', '..');
const mainDir = path.join(rootDir, '_projects', 'n8n', 'local-setup', '_main');

const renames = {
  'Page 1.md': 'Page 1 - Local Setup.md',
  'Page 2.md': 'Page 2 - Upgrading.md',
  'Page 3.md': 'Page 3 - VPS Hosting.md'
};

// 1. Rename files in Git
for (const [oldName, newName] of Object.entries(renames)) {
  const oldPath = path.join(mainDir, oldName);
  const newPath = path.join(mainDir, newName);
  if (fs.existsSync(oldPath)) {
    execSync(`git mv "${oldPath}" "${newPath}"`);
    console.log(`Renamed ${oldName} to ${newName}`);
  } else {
    console.log(`Could not find ${oldPath}`);
  }
}

// 2. Replacements mappings
const replacements = [
  { old: 'Page 1.md', new: 'Page 1 - Local Setup.md' },
  { old: 'Page%201.md', new: 'Page%201%20-%20Local%20Setup.md' },
  { old: 'Page 2.md', new: 'Page 2 - Upgrading.md' },
  { old: 'Page%202.md', new: 'Page%202%20-%20Upgrading.md' },
  { old: 'Page 3.md', new: 'Page 3 - VPS Hosting.md' },
  { old: 'Page%203.md', new: 'Page%203%20-%20VPS%20Hosting.md' },
];

function replaceInFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  let text = fs.readFileSync(filePath, 'utf8');
  let newText = text;
  
  for (const rep of replacements) {
    // Escape old string for regex, except we don't want to double escape %
    // We'll just use split-join for exact string replacement
    newText = newText.split(rep.old).join(rep.new);
  }
  
  if (text !== newText) {
    fs.writeFileSync(filePath, newText, 'utf8');
    console.log(`Updated links in ${path.relative(rootDir, filePath)}`);
  }
}

// Update files in _main
const mainFiles = fs.readdirSync(mainDir);
for (const file of mainFiles) {
  if (file.endsWith('.md') || !file.includes('.')) {
    replaceInFile(path.join(mainDir, file));
  }
}

// Update toolkit.project.json
replaceInFile(path.join(rootDir, '_projects', 'n8n', 'local-setup', 'toolkit.project.json'));

// Update tests
replaceInFile(path.join(rootDir, 'repo', 'tests', 'n8n-local-setup-fidelity.test.cjs'));

// Update curated output MCP file
replaceInFile(path.join(rootDir, '_projects', 'n8n', 'local-setup', 'curated_output_for_ai', 'mcp', 'n8n-local-setup.md'));

console.log('Done!');
