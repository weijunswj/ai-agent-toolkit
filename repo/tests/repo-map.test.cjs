'use strict';

// The repository map (repo/ARCHITECTURE.md) is pointer-only: every path it lists must exist, and
// it records the commit it was last reviewed against.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const MAP = fs.readFileSync(path.join(ROOT, 'repo', 'ARCHITECTURE.md'), 'utf8');

test('every path in the repository map exists', () => {
  const paths = [...MAP.matchAll(/`((?:repo|skills|\.github|\.claude-plugin|\.codex-plugin)\/[^`*<>]*?)`/g)].map(match => match[1]);
  assert.ok(paths.length >= 20, 'the map lists the main parts and entry points');
  const missing = paths.filter(rel => !fs.existsSync(path.join(ROOT, rel)));
  assert.deepEqual(missing, []);
});

test('the map records its review commit and holds no rule text', () => {
  assert.match(MAP, /Last reviewed against `main` `[0-9a-f]{40}`/);
  assert.doesNotMatch(MAP, /MUST delegate|Finish authorised work before stopping|fresh executor contexts are mandatory/i);
});

test('the map locates the coordinator release reconciliation command', () => {
  assert.ok(MAP.includes('repo/scripts/toolkit-rebump-prs.cjs'));
  assert.ok(MAP.includes('report by default'));
});
