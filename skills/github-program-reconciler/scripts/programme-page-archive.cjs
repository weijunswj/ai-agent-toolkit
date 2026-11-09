'use strict';

// Pure graph archive comment formatting. The reconciler owns all state and effects.
const crypto = require('node:crypto');
const digest = text => crypto.createHash('sha256').update(text).digest('hex');
const COMMENT_LIMIT = 60000;
const GROUPS = ['RETIRED', 'COMPLETED', 'OPTIONAL', 'LATER', 'NOW'];
const marker = key => `<!-- programme-page-archive key=${key} -->`;
function graphComments(rows) {
  const parts = [];
  for (const group of GROUPS) {
    let lines = [], part = 1;
    const text = list => `${marker(`graph-${group.toLowerCase()}-${part}`)}\n# Programme graph: ${group}\n\n${list.length ? '| Task | Task Description | Child # | PR # | Class | Status | Last updated (SGT) |\n|---|---|---|---|---|---|---|\n' + list.join('\n') : 'No rows are archived in this part.'}\n`;
    const emit = () => { parts.push({ key: `graph-${group.toLowerCase()}-${part}`, kind: 'graph', group, title: group, body: text(lines), count: lines.length }); part++; lines = []; };
    for (const row of rows.filter(row => row.group === group)) {
      if (text([...lines, row.text]).length >= COMMENT_LIMIT) emit();
      if (text([row.text]).length >= COMMENT_LIMIT) throw new Error('A graph row exceeds the archive comment limit.');
      lines.push(row.text);
    }
    if (lines.length) emit();
  }
  return parts;
}

module.exports = { GROUPS, digest, marker, graphComments };
