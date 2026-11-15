'use strict';

// The playbooks the toolkit-playbooks skill ships, as older turn-ons copied them into a repository's
// docs/agent-playbooks/ folder: the skill's SKILL.md is the index, as INDEX.md without its skill
// frontmatter. Nothing copies them any more; the leftover scan compares a repository's copies with
// this text to find Toolkit's own.

const fs = require('node:fs');
const path = require('node:path');

const FOLDER = path.join(__dirname, '..', '..', 'skills', 'toolkit-playbooks');

// { 'INDEX.md': text, '<name>.md': text, ... } with LF line endings, sorted by name.
function repositoryPlaybooks(folder = FOLDER) {
  const files = {};
  // The skill's README.md is about the skill, not a playbook, so it never goes into a repository.
  for (const name of fs.readdirSync(folder).filter(entry => entry.endsWith('.md') && entry !== 'README.md').sort()) {
    const text = fs.readFileSync(path.join(folder, name), 'utf8').replace(/\r\n/g, '\n');
    if (name === 'SKILL.md') files['INDEX.md'] = text.replace(/^---\n[\s\S]*?\n---\n\n?/, '');
    else files[name] = text;
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

module.exports = Object.freeze({ FOLDER, repositoryPlaybooks });
