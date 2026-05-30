const fs = require('fs');
const path = require('path');

function processFile(filePath) {
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
      // H1 - remove all numbering
      const text = line.replace(/^#\s+(\d+\.?\s*|[A-Z]\.\s*|\d+\.\d+\.\d+\.?\s*)?/, '').trim();
      return `# ${text}`;
    } else if (line.match(/^## /)) {
      // H2 - 1. 2. 3.
      currentH2++;
      currentH3 = 0; // reset H3
      // Remove any existing numbering
      const text = line.replace(/^##\s+(\d+\.\d+\.?\s*|\d+\.\s*|[A-Z]\.\s*)?/, '').trim();
      return `## ${currentH2}. ${text}`;
    } else if (line.match(/^### /)) {
      // H3 - 1.1. 1.2.
      currentH3++;
      // Remove any existing numbering
      let text = line.replace(/^###\s+([A-Z]\.\s*|[ivxIVX]+\)\s*|\d+\.\d+\.\d+\.?\s*|\d+\.\d+\.?\s*)?/, '').trim();
      return `### ${currentH2}.${currentH3}. ${text}`;
    }
    return line;
  });

  fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
  console.log(`Processed ${filePath}`);
}

const dir = path.join(__dirname, '..', '..', '_projects', 'n8n', 'local-setup', '_main');
if (fs.existsSync(path.join(dir, 'Page 1.md'))) processFile(path.join(dir, 'Page 1.md'));
if (fs.existsSync(path.join(dir, 'Page 2.md'))) processFile(path.join(dir, 'Page 2.md'));
if (fs.existsSync(path.join(dir, 'Page 3.md'))) processFile(path.join(dir, 'Page 3.md'));
