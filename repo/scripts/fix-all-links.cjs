const fs = require('fs');
const path = require('path');

function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) { 
      results = results.concat(walk(file));
    } else { 
      if (file.endsWith('.md') || file.endsWith('.json') || file.endsWith('.cjs')) results.push(file);
    }
  });
  return results;
}

const dir = path.join(__dirname, '..', '..', '_projects', 'n8n', 'local-setup');
const files = walk(dir);

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');
  let original = content;
  
  content = content.replace(/1\.%20local%20setup\.md/g, 'Page%201.md');
  content = content.replace(/2\.%20upgrading\.md/g, 'Page%202.md');
  content = content.replace(/3\.%20vps%20hosting\.md/g, 'Page%203.md');
  
  content = content.replace(/1\.\s+local\s+setup\.md/gi, 'Page 1.md');
  content = content.replace(/2\.\s+upgrading\.md/gi, 'Page 2.md');
  content = content.replace(/3\.\s+vps\s+hosting\.md/gi, 'Page 3.md');
  
  // Also non .md ones sometimes used in prose
  content = content.replace(/\[1\. Local Setup\]\(\.\/1\.\s+local\s+setup\)/gi, '[1. Local Setup](./Page 1)');

  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Updated ${file}`);
  }
});
