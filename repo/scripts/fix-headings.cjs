const fs = require('fs');
const path = require('path');

function processFile(filePath, h1Prefix) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  
  let currentH2 = 0;
  let currentH3 = 0;
  let inCodeBlock = false;

  const newLines = lines.map(line => {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      return line;
    }
    if (inCodeBlock) return line;

    if (line.match(/^# /)) {
      // H1
      // Remove any existing numbering
      const text = line.replace(/^#\s+(\d+\.\s*)?/, '');
      return `# ${h1Prefix}. ${text}`;
    } else if (line.match(/^## /)) {
      // H2
      currentH2++;
      currentH3 = 0; // reset H3
      // Remove any existing numbering like `1.1`, `1.2`
      const text = line.replace(/^##\s+(\d+\.\d+\.?\s*)?/, '');
      return `## ${h1Prefix}.${currentH2}. ${text}`;
    } else if (line.match(/^### /)) {
      // H3
      currentH3++;
      // Remove any existing numbering like `A.`, `B.`, `1.1.1.`, `i)`
      let text = line.replace(/^###\s+([A-Z]\.\s*|[ivxIVX]+\)\s*|\d+\.\d+\.\d+\.?\s*)?/, '');
      return `### ${h1Prefix}.${currentH2}.${currentH3}. ${text}`;
    }
    return line;
  });

  fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
  console.log(`Processed ${filePath}`);
}

const dir = path.join(__dirname, '..', '..', '_projects', 'n8n', 'local-setup', '_main');
processFile(path.join(dir, 'Page 1.md'), 1);
processFile(path.join(dir, 'Page 2.md'), 2);
processFile(path.join(dir, 'Page 3.md'), 3);
