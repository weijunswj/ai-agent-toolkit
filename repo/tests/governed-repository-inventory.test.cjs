'use strict';

// The governed repository inventory (repo/contracts/governed-repository-inventory.json) names every part a
// governed repository gets from Toolkit and how it follows Toolkit main. It fails when a default cloud
// workflow, a file a refresh pull request may change or a governance check finding has no row, so a part
// added later cannot silently leave repositories behind with no way to follow main. It also fails on a row
// that names something no longer there.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const INVENTORY = path.join(ROOT, 'repo/contracts/governed-repository-inventory.json');
const workflows = require('../scripts/toolkit-cloud-workflows.cjs');
const refresh = require('../scripts/toolkit-cloud-workflows-refresh.cjs');

// The finding ids the governance check can raise: each quoted id in its source and in the App's
// finding, the base of every templated variant included.
function findingIds() {
  const ids = new Set();
  for (const file of ['repo/scripts/toolkit-governance-conformance.cjs', 'repo/scripts/toolkit-governance-app.cjs']) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const scope = file.endsWith('app.cjs') ? source.slice(source.indexOf('function appFinding')) : source;
    for (const [, id] of scope.matchAll(/'([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)'/g)) ids.add(id);
  }
  return ids;
}

// What the code has that the inventory must cover: { workflows, files, findings }.
function sources() {
  const files = new Set([...workflows.DEFAULT_FILES]);
  // Every other path a refresh may change by name.
  for (const file of ['.github/scripts/plain-text-check.cjs', '.github/plain-text-baseline.json']) if (refresh.isToolkitFile(file, workflows)) files.add(file);
  return { workflows: new Set(workflows.DEFAULT_CLOUD_WORKFLOWS.map(row => row.id)), files, findings: findingIds() };
}

// Every gap between the inventory and the code, as one line each.
function gaps(inventory, have) {
  const out = [];
  const kinds = new Set(Object.keys(inventory.follows || {}));
  const ids = new Set();
  for (const part of inventory.parts || []) {
    if (ids.has(part.id)) out.push(`${part.id}: listed twice`);
    ids.add(part.id);
    if (!kinds.has(part.follows)) out.push(`${part.id}: follows "${part.follows}", which is not one of ${[...kinds].join(', ')}`);
    if (typeof part.how !== 'string' || !part.how.trim()) out.push(`${part.id}: says not how it follows main`);
    for (const key of ['workflows', 'files', 'findings']) if (!Array.isArray(part[key])) out.push(`${part.id}: ${key} is not a list`);
  }
  const listed = key => new Set((inventory.parts || []).flatMap(part => part[key] || []));
  for (const key of ['workflows', 'files', 'findings']) {
    for (const item of have[key]) if (!listed(key).has(item)) out.push(`${key.slice(0, -1)} ${item} has no row`);
  }
  // A row naming a workflow or finding the code no longer has is stale.
  for (const key of ['workflows', 'findings']) {
    for (const item of listed(key)) if (!have[key].has(item)) out.push(`${key.slice(0, -1)} ${item} is listed but no longer exists`);
  }
  return out;
}

test('every default cloud workflow, refreshable file and governance finding has an inventory row, each saying how it follows main', () => {
  const inventory = JSON.parse(fs.readFileSync(INVENTORY, 'utf8'));
  assert.equal(inventory.schema, 'toolkit.governed-repository-inventory.v1');
  assert.deepEqual(gaps(inventory, sources()), []);
  // The three sides the plan covers are all there.
  assert.deepEqual([...new Set(inventory.parts.map(part => part.side))].sort(), ['computer', 'projects', 'repository']);
});

test('a part added without a row, or a row left behind, fails the check', () => {
  const inventory = JSON.parse(fs.readFileSync(INVENTORY, 'utf8'));
  const have = sources();
  have.workflows.add('a-new-workflow');
  have.files.add('.github/workflows/a-new-workflow.yml');
  have.findings.add('A_NEW_FINDING');
  assert.deepEqual(gaps(inventory, have), ['workflow a-new-workflow has no row', 'file .github/workflows/a-new-workflow.yml has no row', 'finding A_NEW_FINDING has no row']);
  const stale = { ...inventory, parts: [...inventory.parts, { id: 'X1', side: 'repository', part: 'x', follows: 'sometimes', how: '', workflows: ['gone'], files: [], findings: ['GONE_FINDING'] }] };
  assert.deepEqual(gaps(stale, sources()), ['X1: follows "sometimes", which is not one of run-time, refresh, owner, plugin, auto', 'X1: says not how it follows main', 'workflow gone is listed but no longer exists', 'finding GONE_FINDING is listed but no longer exists']);
});
