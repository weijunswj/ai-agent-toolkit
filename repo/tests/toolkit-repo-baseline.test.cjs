'use strict';

// This repository is the baseline: it uses Toolkit's own permission lines and holds none of its own.
// A line an agent here needs and Toolkit does not ship is a Toolkit gap, added to Toolkit's block or
// left to ask; Toolkit ships no web line, so web fetch and web search stay each computer's own choice.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');

test('this repository tracks no Claude Code permission lines', () => {
  const tracked = spawnSync('git', ['-C', ROOT, 'ls-files', '--', '.claude'], { encoding: 'utf8' });
  assert.equal(tracked.status, 0, tracked.stderr);
  const files = tracked.stdout.split('\n').filter(Boolean);
  for (const file of files) {
    const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    let settings = null;
    try { settings = JSON.parse(text); } catch { settings = null; }
    const lists = settings && settings.permissions ? ['allow', 'ask', 'deny'].flatMap(key => settings.permissions[key] || []) : [];
    assert.deepEqual(lists, [], `${file} holds permission lines`);
  }
  assert.ok(!files.includes('.claude/settings.json'), 'no shared settings file is tracked');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8'), /^!\/\.claude\/settings\.json$/m, 'the ignore file lets no shared settings file back in');
});
