'use strict';

// The lane file map (repo/contracts/lanes/lane-map.json) names who edits which file when host
// lanes run in parallel: every listed file exists and has exactly one owner, and every script
// named for a host belongs to that host's lane.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const MAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'repo', 'contracts', 'lanes', 'lane-map.json'), 'utf8'));
const HOST_LANES = ['claude', 'codex'];

function owners() {
  const result = new Map();
  const add = (rel, owner) => result.set(rel, [...(result.get(rel) || []), owner]);
  for (const [lane, files] of Object.entries(MAP.lanes)) for (const rel of files) add(rel, lane);
  for (const rel of MAP.integration) add(rel, 'integration');
  return result;
}

test('the lane map has the claude and codex lanes and an integration list', () => {
  assert.equal(MAP.schema, 'toolkit-lane-map/v1');
  assert.deepEqual(Object.keys(MAP.lanes).sort(), HOST_LANES);
  for (const files of [...Object.values(MAP.lanes), MAP.integration]) {
    assert.ok(Array.isArray(files) && files.length > 0);
    assert.deepEqual(files, [...files].sort(), 'each list stays sorted');
  }
});

test('every listed file exists and has exactly one owner', () => {
  const missing = [], shared = [];
  for (const [rel, list] of owners()) {
    if (!fs.existsSync(path.join(ROOT, ...rel.split('/')))) missing.push(rel);
    if (list.length !== 1) shared.push(`${rel}: ${list.join(', ')}`);
  }
  assert.deepEqual(missing, []);
  assert.deepEqual(shared, []);
});

test('every script named for a host belongs to that host lane', () => {
  const map = owners(), wrong = [];
  for (const name of fs.readdirSync(path.join(ROOT, 'repo', 'scripts'))) {
    const lane = HOST_LANES.find((host) => name.includes(host));
    if (!lane || !/\.(?:cjs|ps1)$/.test(name)) continue;
    const owner = map.get(`repo/scripts/${name}`);
    if (!owner || owner[0] !== lane) wrong.push(`repo/scripts/${name} (${owner ? owner.join(', ') : 'unlisted'}, expected ${lane})`);
  }
  assert.deepEqual(wrong, []);
});
