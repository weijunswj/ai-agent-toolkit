'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');

test('scripts in require cycles export before running their CLI', () => {
  const root = path.resolve(__dirname, '../..');
  const files = execFileSync('git', ['ls-files', '-z', '--', 'repo/scripts', 'skills'],
    { cwd: root, encoding: 'utf8', windowsHide: true }).split('\0')
    .filter(file => /^(?:repo\/scripts\/.*|skills\/.*\/scripts\/.*)\.cjs$/.test(file));
  assert.ok(files.includes('repo/scripts/toolkit-tasks.cjs'), 'tracked runtime scripts must be scanned');
  const sources = new Map(files.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
  const graph = new Map(files.map(file => {
    const edges = [];
    // Scan the whole source, including requires inside functions.
    for (const match of sources.get(file).matchAll(/\brequire\s*\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[2]));
      const resolved = [target, `${target}.cjs`, `${target}/index.cjs`].find(candidate => sources.has(candidate));
      if (resolved) edges.push(resolved);
    }
    return [file, edges];
  }));
  function inCycle(start) {
    const seen = new Set();
    const pending = [...graph.get(start)];
    while (pending.length) {
      const next = pending.pop();
      if (next === start) return true;
      if (seen.has(next)) continue;
      seen.add(next);
      pending.push(...graph.get(next));
    }
    return false;
  }
  const offenders = files.filter(file => {
    const source = sources.get(file);
    const cli = source.search(/require\.main\s*===\s*module/);
    const exports = source.search(/module\.exports\s*=/);
    return cli >= 0 && (exports < 0 || cli < exports) && inCycle(file);
  });
  assert.deepEqual(offenders, [], `Export before CLI execution in require cycles:\n${offenders.join('\n')}`);
});
