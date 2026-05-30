const fs = require('fs');
const path = require('path');

const filesToUpdate = [
  'repo/tests/n8n-local-setup-fidelity.test.cjs',
  '_projects/n8n/local-setup/toolkit.project.json',
  '_projects/n8n/local-setup/SOURCE-LOCK.json',
  '_projects/n8n/local-setup/_main/README.md',
  'repo/docs/HOW-TO-USE.md'
];

filesToUpdate.forEach(relPath => {
  const fullPath = path.join(__dirname, '..', '..', relPath);
  if (!fs.existsSync(fullPath)) return;
  
  let content = fs.readFileSync(fullPath, 'utf8');
  content = content.replace(/1\.\s+local\s+setup\.md/g, 'Page 1.md');
  content = content.replace(/2\.\s+upgrading\.md/g, 'Page 2.md');
  content = content.replace(/3\.\s+vps\s+hosting\.md/g, 'Page 3.md');
  
  // Also handle url encoded ones
  content = content.replace(/1\.%20local%20setup\.md/g, 'Page%201.md');
  content = content.replace(/2\.%20upgrading\.md/g, 'Page%202.md');
  content = content.replace(/3\.%20vps%20hosting\.md/g, 'Page%203.md');

  // Also replace without .md for source tracking if any
  content = content.replace(/1\.\s+local\s+setup/g, 'Page 1');
  content = content.replace(/2\.\s+upgrading/g, 'Page 2');
  content = content.replace(/3\.\s+vps\s+hosting/g, 'Page 3');
  
  fs.writeFileSync(fullPath, content, 'utf8');
  console.log(`Updated ${relPath}`);
});
