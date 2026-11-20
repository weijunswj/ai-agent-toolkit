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

// The Toolkit script a run line calls, with the script's own text and the text of the Toolkit modules
// it requires directly, where an argument or an environment name may be read.
function scriptOf(line) {
  const [script, first] = line.split(/\s+/);
  const file = path.join(ROOT, script.replace(/^\.toolkit\//, ''));
  if (!fs.existsSync(file)) return { script, first, file, own: null, text: null };
  const own = fs.readFileSync(file, 'utf8');
  const text = [own, ...[...own.matchAll(/require\(\s*'\.\/([a-z0-9-]+\.cjs)'\s*\)/g)].map(match => fs.readFileSync(path.join(path.dirname(file), match[1]), 'utf8'))].join('\n');
  return { script, first, file, own, text };
}

// Whether Toolkit code reads an environment name: as env.NAME or env['NAME'], or, for GH_TOKEN, by
// running the GitHub CLI, which reads it.
const reads = (text, name) => new RegExp(`\\benv(?:\\.${name}\\b|\\[\\s*['"]${name}['"]\\s*\\])`).test(text) || (name === 'GH_TOKEN' && /\(\s*'gh'\s*,/.test(text));
const scriptsRead = (run, name) => run.some(line => { const { text } = scriptOf(line); return text !== null && reads(text, name); });

// The steps of a copy that run or check out Toolkit code: { copy, step, run[], env[], stepEnv[], sparse }.
// stepEnv: the names the step's own shell reads and no Toolkit script of the step reads. They are part
// of the copy, so main need not serve them; every other passed name is read by Toolkit main.
function callSurface(id, text) {
  const calls = [];
  for (const step of text.split(/\n(?= {6}- name: )/).slice(1)) {
    const name = /^ {6}- name: (.+)$/m.exec(step)[1];
    const runs = [...step.matchAll(/node (\.toolkit\/repo\/scripts\/[^\n]+)/g)].map(match => match[1].trim().replace(/\$\{\{[^}]*\}\}/g, '<expr>'));
    const toolkit = /repository: weijunswj\/ai-agent-toolkit\n/.test(step);
    if (!runs.length && !toolkit) continue;
    const env = /\n {8}env:\n((?: {10}[A-Z_]+:[^\n]*\n)+)/.exec(`${step}\n`);
    const sparse = /\n {10}sparse-checkout: ([^\n]+)/.exec(step);
    const names = env ? [...env[1].matchAll(/^ {10}([A-Z_]+):/gm)].map(match => match[1]).sort() : [];
    const shell = (/\n {8}run: ([\s\S]*)$/.exec(step) || [])[1] || '';
    const stepEnv = names.filter(env => !scriptsRead(runs, env) && new RegExp(`\\$\\{?${env}\\b`).test(shell));
    calls.push({ copy: id, step: name, run: runs, env: names, ...(stepEnv.length ? { stepEnv } : {}), ...(toolkit ? { sparse: sparse ? sparse[1] : null } : {}) });
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
      const { script, first, file, own, text } = scriptOf(line);
      assert.ok(own !== null, `${call.copy} / ${call.step}: ${script} is still in the Toolkit`);
      // A subcommand is one the script's own dispatch names, not any quoted word in its modules.
      if (first && !first.startsWith('-')) assert.ok(own.includes(`process.argv[2] === '${first}'`), `${call.copy} / ${call.step}: ${path.relative(ROOT, file)} still dispatches ${first}`);
      for (const flag of line.match(/(?<=\s)--[a-z][a-z-]*/g) || []) assert.ok(text.includes(`'${flag}'`) || text.includes(`"${flag}"`), `${call.copy} / ${call.step}: ${script} still takes ${flag}`);
    }
    // Every name the step passes for Toolkit code is still read by the step's scripts on main.
    for (const name of call.env.filter(env => !(call.stepEnv || []).includes(env))) assert.ok(scriptsRead(call.run, name), `${call.copy} / ${call.step}: no Toolkit script of this step reads ${name} any more`);
    // A sparse checkout of one script needs that script to stand alone.
    if (call.sparse && /\.cjs$/.test(call.sparse)) assert.doesNotMatch(fs.readFileSync(path.join(ROOT, call.sparse), 'utf8'), /require\(\s*['"]\.{1,2}\//, `${call.sparse} is checked out alone, so it may require no Toolkit module`);
  }
});

test('layout contract: the sweep action refuses an unknown command instead of running a refresh', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'repo/scripts/toolkit-programme-sweep-action.cjs'), 'stores'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown command; use store, refresh or footers/);
});
