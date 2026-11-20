'use strict';

// The governed copies' call surface (repo/contracts/cloud-workflows-layout.json). Governed copies run
// Toolkit main, so main must keep serving the layout they were rendered with until each repository's
// refresh pull request lands: the current layout and the previous one. A change to what a copy runs
// (a Toolkit script, its arguments, the environment names a step passes or a sparse checkout) fails
// here until the contract records it as a new layout, with the old calls kept as `previous` and still
// served by main.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const workflows = require(path.join(ROOT, 'repo/scripts/toolkit-cloud-workflows.cjs'));
const { LAYOUT } = require(path.join(ROOT, 'repo/scripts/toolkit-cloud-workflows-render.cjs'));
const CONTRACT = path.join(ROOT, 'repo/contracts/cloud-workflows-layout.json');
const COMMIT = workflows.toolkitHead(ROOT);
const source = file => spawnSync('git', ['show', `${COMMIT}:${file}`], { cwd: ROOT, encoding: 'utf8' }).stdout;

// Every copy, with every optional part present: the gate following a CI workflow, both shard systems.
function renders() {
  const inputs = { 'programme-sweep': null, 'programme-sweep-gate': { file: 'ci.yml', name: 'CI' }, 'test-shards': { systems: { linux: ['linux-1'], windows: ['windows-1'] } }, 'shard-timings': {} };
  return [...workflows.WORKFLOWS, ...workflows.SHARD_WORKFLOWS].map(row => ({ id: row.id, text: workflows.render(row.id, source(row.source || row.file), COMMIT, inputs[row.id]) }));
}

// The steps of a copy that run or check out Toolkit code: { copy, step, run[], env[], sparse }.
function callSurface(id, text) {
  const calls = [];
  for (const step of text.split(/\n(?= {6}- name: )/).slice(1)) {
    const name = /^ {6}- name: (.+)$/m.exec(step)[1];
    const runs = [...step.matchAll(/node (\.toolkit\/repo\/scripts\/[^\n]+)/g)].map(match => match[1].trim().replace(/\$\{\{[^}]*\}\}/g, '<expr>'));
    const toolkit = /repository: weijunswj\/ai-agent-toolkit\n/.test(step);
    if (!runs.length && !toolkit) continue;
    const env = /\n {8}env:\n((?: {10}[A-Z_]+:[^\n]*\n)+)/.exec(`${step}\n`);
    const sparse = /\n {10}sparse-checkout: ([^\n]+)/.exec(step);
    calls.push({ copy: id, step: name, run: runs, env: env ? [...env[1].matchAll(/^ {10}([A-Z_]+):/gm)].map(match => match[1]).sort() : [], ...(toolkit ? { sparse: sparse ? sparse[1] : null } : {}) });
  }
  return calls;
}

const contract = () => JSON.parse(fs.readFileSync(CONTRACT, 'utf8'));
const current = () => renders().flatMap(copy => callSurface(copy.id, copy.text));

test('layout contract: the copies\' call surface is the one recorded for this layout', () => {
  const recorded = contract();
  assert.equal(recorded.schema, 'toolkit.cloud-workflows-layout.v1');
  assert.equal(recorded.layout, LAYOUT, 'the render and the contract name the same layout');
  assert.deepEqual(current(), recorded.calls, 'what the governed copies run changed. Governed copies keep running the old layout on Toolkit main until their refresh pull request lands, so keep what they call working, then record the new surface here as layout N+1 with the old calls under previous, and bump LAYOUT in toolkit-cloud-workflows-render.cjs.');
  if (recorded.previous) assert.equal(recorded.previous.layout, LAYOUT - 1, 'previous is the layout just before this one');
});

test('layout contract: main still serves every call of this layout and the previous one', () => {
  const recorded = contract();
  for (const call of [...recorded.calls, ...(recorded.previous?.calls || [])]) {
    for (const line of call.run) {
      const [script, first] = line.split(/\s+/);
      const file = path.join(ROOT, script.replace(/^\.toolkit\//, ''));
      assert.ok(fs.existsSync(file), `${call.copy} / ${call.step}: ${script} is still in the Toolkit`);
      // The script and the Toolkit modules it requires directly, where an argument may be parsed.
      const own = fs.readFileSync(file, 'utf8');
      const text = [own, ...[...own.matchAll(/require\(\s*'\.\/([a-z0-9-]+\.cjs)'\s*\)/g)].map(match => fs.readFileSync(path.join(path.dirname(file), match[1]), 'utf8'))].join('\n');
      if (first && !first.startsWith('-')) assert.ok(text.includes(`'${first}'`), `${call.copy} / ${call.step}: ${script} still takes ${first}`);
      for (const flag of line.match(/(?<=\s)--[a-z][a-z-]*/g) || []) assert.ok(text.includes(`'${flag}'`) || text.includes(`"${flag}"`), `${call.copy} / ${call.step}: ${script} still takes ${flag}`);
    }
    // A sparse checkout of one script needs that script to stand alone.
    if (call.sparse && /\.cjs$/.test(call.sparse)) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, call.sparse), 'utf8'), /require\(\s*['"]\.{1,2}\//, `${call.sparse} is checked out alone, so it may require no Toolkit module`);
  }
});
