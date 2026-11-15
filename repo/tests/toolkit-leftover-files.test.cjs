'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const leftovers = require('../scripts/toolkit-leftover-files.cjs');

const SCRIPT = require.resolve('../scripts/toolkit-leftover-files.cjs');
const TEMPLATES = path.join(__dirname, '..', '..', 'skills', 'repository-agent-rules', 'repo-local');
const template = name => fs.readFileSync(path.join(TEMPLATES, name), 'utf8');
const BLOCK = /<!-- AI-AGENT-TOOLKIT:\S+:BEGIN TOOLKIT-GOVERNED-RULES[\s\S]*?END TOOLKIT-GOVERNED-RULES -->/.exec(template('AGENTS.managed.template.md'))[0];
const CHECK = `#!/usr/bin/env node\n// AI-AGENT-TOOLKIT:secure-ci-cd:VENDORED plain-text-check check=3 sha256=0123456789ab\n'use strict';\n`;

// A GitHub folder of fixture checkouts. Each checkout's governance state is given by the test, the
// way this computer's saved governance state would give it.
function world(t, repositories) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-leftovers-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const states = new Map();
  for (const [name, { state, files = {} }] of Object.entries(repositories)) {
    const root = path.join(folder, name);
    fs.mkdirSync(path.join(root, '.git'), { recursive: true });
    for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); }
    states.set(root, state);
  }
  const governance = {
    readIdentity: root => ({ valid: true, root, remote: { host: 'github.com', path: `/example/${path.basename(root)}.git` } }),
    governanceState: root => { if (states.get(root) === 'THROWS') throw new Error('unreadable'); return { state: states.get(root) }; },
  };
  const scan = () => new leftovers.LeftoverScan({ githubFolder: folder, governance }).scan();
  const of = (report, name) => report.repositories.find(row => row.name === `example/${name}`);
  return { folder, governance, scan, of };
}

const treeOf = folder => {
  const out = {};
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isSymbolicLink()) out[path.relative(folder, file)] = `link:${fs.readlinkSync(file)}`; else if (entry.isDirectory()) { out[`${path.relative(folder, file)}/`] = 'dir'; walk(file); } else out[path.relative(folder, file)] = fs.readFileSync(file, 'hex'); } };
  walk(folder);
  return out;
};

const TOOLKIT_FILES = {
  'AGENTS.md': `# My rules\n\n${BLOCK}\n\nMy own notes.\n`,
  'CLAUDE.md': '@AGENTS.md\n',
  'docs/agent-playbooks/INDEX.md': template('docs/agent-playbooks/INDEX.md'),
  'docs/agent-playbooks/safety-gates.md': `${template('docs/agent-playbooks/safety-gates.md')}\nMy own extra rule.\n`,
  '.github/scripts/plain-text-check.cjs': CHECK,
  '.github/toolkit-programme.json': '{ "governance": "disabled" }\n',
  'src/app.js': '// AI-AGENT-TOOLKIT is mentioned here, and this is still my file\n',
};

test('only the ungoverned repository is scanned, only its provably Toolkit files are listed, and nothing is written', t => {
  const w = world(t, {
    governed: { state: 'ENABLED', files: TOOLKIT_FILES },
    widget: { state: 'DISABLED', files: TOOLKIT_FILES },
    clean: { state: 'UNDECIDED', files: { 'AGENTS.md': '# Mine\n', 'CLAUDE.md': '@AGENTS.md\nAnd my own line.\n', 'docs/agent-playbooks/mine.md': 'mine\n' } },
    unknown: { state: 'UNAVAILABLE', files: TOOLKIT_FILES },
    broken: { state: 'ERROR', files: TOOLKIT_FILES },
    unreadable: { state: 'THROWS', files: TOOLKIT_FILES },
  });
  const before = treeOf(w.folder);
  const report = w.scan();
  assert.deepEqual(treeOf(w.folder), before, 'the scan changes nothing');

  assert.deepEqual([w.of(report, 'governed').scanned, w.of(report, 'governed').reason], [false, 'governance is on, so its Toolkit files are in use']);
  for (const name of ['unknown', 'broken', 'unreadable']) assert.deepEqual([w.of(report, name).scanned, w.of(report, name).reason], [false, 'its governance could not be checked'], name);

  const widget = w.of(report, 'widget');
  assert.equal(widget.governance, 'governance off');
  assert.deepEqual(widget.files.map(item => [item.file, item.kind, item.proof]), [
    ['AGENTS.md', 'block', 'Toolkit marker'],
    ['CLAUDE.md', 'file', "same as Toolkit's shipped copy"],
    ['docs/agent-playbooks/INDEX.md', 'file', "same as Toolkit's shipped copy"],
    ['.github/scripts/plain-text-check.cjs', 'check', 'Toolkit marker'],
  ]);
  assert.equal(widget.files[0].block, 'TOOLKIT-GOVERNED-RULES');
  assert.equal(widget.files[0].edited, false);
  assert.deepEqual(widget.kept, [{ file: '.github/toolkit-programme.json', reason: 'it records this repository\'s "governance off" decision' }]);
  assert.deepEqual(widget.unproven, [{ file: 'docs/agent-playbooks/safety-gates.md', reason: "it differs from Toolkit's shipped copy" }]);

  const clean = w.of(report, 'clean');
  assert.deepEqual([clean.scanned, clean.governance, clean.files, clean.kept, clean.unproven], [true, 'no governance decision', [], [], []]);

  const text = leftovers.describe(report).join('\n');
  assert.match(text, /^Leftover Toolkit files \(report only: nothing was changed or deleted\)/);
  assert.match(text, /example\/governed: not scanned, because governance is on, so its Toolkit files are in use\./);
  assert.match(text, /- AGENTS\.md: Toolkit block TOOLKIT-GOVERNED-RULES inside the file\. The rest of the file is yours\./);
  assert.match(text, /- Kept: \.github\/toolkit-programme\.json, because it records this repository's "governance off" decision\./);
  assert.match(text, /- Not listed as Toolkit's: docs\/agent-playbooks\/safety-gates\.md, because it differs from Toolkit's shipped copy\./);
  assert.match(text, /example\/clean \(no governance decision\), .*:\n- No file here is provably Toolkit's\./);
  assert.match(text, /Nothing is removed without your OK\.$/);
  assert.equal(text.includes('My own notes'), false, 'no file contents are printed');
  assert.equal(text.includes('src/app.js'), false, 'a file that only mentions Toolkit is not listed');
});

test('a block edited by hand is still listed, and says so; Windows line endings still match', t => {
  const w = world(t, { widget: { state: 'DISABLED', files: {
    'AGENTS.md': BLOCK.replace('## Delivery', '## Delivery, my way'),
    'docs/agent-playbooks/INDEX.md': template('docs/agent-playbooks/INDEX.md').replace(/\r?\n/g, '\r\n'),
    'CLAUDE.md': '@AGENTS.md\r\n',
  } } });
  const widget = w.of(w.scan(), 'widget');
  assert.deepEqual(widget.files.map(item => [item.file, Boolean(item.edited)]), [['AGENTS.md', true], ['CLAUDE.md', false], ['docs/agent-playbooks/INDEX.md', false]]);
  assert.match(leftovers.describe({ folder: w.folder, readable: true, repositories: [widget] }).join('\n'), /TOOLKIT-GOVERNED-RULES inside the file, edited by hand since\./);
});

test('cloud sweep copies with the Toolkit marker are listed; an edited one says so; an unmarked one is not', t => {
  const cloud = require('../scripts/toolkit-cloud-workflows.cjs');
  const [sweep, gate] = cloud.WORKFLOWS;
  const commit = 'c'.repeat(40);
  const copy = (id, text = 'name: X\non: push\njobs: {}\n') => {
    const body = `# A copy\n${text}`;
    return `# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED ${id} toolkit=${commit} sha256=${cloud.bodyHash(body)}\n${body}`;
  };
  const w = world(t, {
    widget: { state: 'DISABLED', files: { [sweep.file]: copy(sweep.id).replace(/\n/g, '\r\n'), [gate.file]: `${copy(gate.id)}# my extra line\n` } },
    mine: { state: 'UNDECIDED', files: { [sweep.file]: 'name: Mine\non: push\n', [gate.file]: copy(sweep.id) } },
    governed: { state: 'ENABLED', files: { [sweep.file]: copy(sweep.id) } },
  });
  const report = w.scan();
  const widget = w.of(report, 'widget');
  assert.deepEqual(widget.files.map(item => [item.file, item.kind, item.proof, item.edited]), [
    [sweep.file, 'workflow', 'Toolkit marker', false],
    [gate.file, 'workflow', 'Toolkit marker', true],
  ]);
  assert.deepEqual(w.of(report, 'mine').files, [], 'an unmarked file, or a marker naming another workflow, is not listed');
  assert.equal(w.of(report, 'governed').scanned, false);
  const text = leftovers.describe(report).join('\n');
  assert.match(text, /- \.github\/workflows\/toolkit-programme-sweep\.yml: a Toolkit cloud sweep copy\. With governance off it writes nothing, but its runs still start on GitHub, so removing it is suggested\./);
  assert.match(text, /toolkit-programme-sweep-gate\.yml: a Toolkit cloud sweep copy, edited by hand since\./);
});

test('the test shards and Shard Timings copies are found by their marker, the test shards copy at any workflow name', t => {
  const cloud = require('../scripts/toolkit-cloud-workflows.cjs');
  const commit = 'c'.repeat(40);
  const copy = id => {
    const body = '# A copy\nname: X\non: push\njobs: {}\n';
    return `# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED ${id} toolkit=${commit} sha256=${cloud.bodyHash(body)}\n${body}`;
  };
  const w = world(t, {
    widget: { state: 'DISABLED', files: {
      '.github/workflows/shards.yml': copy('test-shards'),
      '.github/workflows/toolkit-shard-timings.yml': copy('shard-timings'),
      // A Shard Timings marker at another name, and a marker for no known copy, are not Toolkit copies.
      '.github/workflows/timings.yml': copy('shard-timings'),
      '.github/workflows/other.yml': copy('something-else'),
      '.github/workflows/ci.yml': 'name: CI\n',
    } },
  });
  const widget = w.of(w.scan(), 'widget');
  assert.deepEqual(widget.files.map(item => [item.file, item.copy]), [['.github/workflows/toolkit-shard-timings.yml', 'shard-timings'], ['.github/workflows/shards.yml', 'test-shards']]);
  const text = leftovers.describe({ folder: w.folder, readable: true, repositories: [widget] }).join('\n');
  assert.match(text, /shards\.yml: a Toolkit test shards workflow copy\. Governance is off/);
  assert.match(text, /toolkit-shard-timings\.yml: a Toolkit Shard Timings copy\. Governance is off/);
});

test('broken markers, an old shim block, a programme file that is not "off", and a check without the marker', t => {
  const w = world(t, { widget: { state: 'UNDECIDED', files: {
    'AGENTS.md': '<!-- AI-AGENT-TOOLKIT:x:BEGIN TOOLKIT-GOVERNED-RULES v2 toolkit=3.0.0 sha256=000000000000 -->\nno end marker\n',
    'GEMINI.md': '<!-- AI-AGENT-TOOLKIT:x:BEGIN GEMINI.SHIM v1 -->\n@AGENTS.md\n<!-- AI-AGENT-TOOLKIT:x:END GEMINI.SHIM -->\n',
    '.github/toolkit-programme.json': 'not json',
    '.github/scripts/plain-text-check.cjs': "'use strict';\n// my own script with the same name\n",
    '.github/scripts/personal-data-guard.cjs': CHECK,
  } } });
  const widget = w.of(w.scan(), 'widget');
  assert.deepEqual(widget.files.map(item => [item.file, item.block || null]), [['GEMINI.md', 'GEMINI.SHIM']]);
  assert.deepEqual(widget.unproven, [{ file: 'AGENTS.md', reason: 'its Toolkit markers are broken' }]);
  assert.deepEqual(widget.kept, [{ file: '.github/toolkit-programme.json', reason: "it is the repository's programme file, which Toolkit reads for the on/off decision" }]);
});

test('a symbolic link is never followed', { skip: process.platform === 'win32' }, t => {
  const w = world(t, { widget: { state: 'DISABLED', files: {} } });
  const root = path.join(w.folder, 'widget'), outside = path.join(w.folder, 'outside.md');
  fs.writeFileSync(outside, `${BLOCK}\n`);
  fs.symlinkSync(outside, path.join(root, 'AGENTS.md'));
  fs.mkdirSync(path.join(w.folder, 'elsewhere'));
  fs.writeFileSync(path.join(w.folder, 'elsewhere', 'INDEX.md'), template('docs/agent-playbooks/INDEX.md'));
  fs.mkdirSync(path.join(root, 'docs'));
  fs.symlinkSync(path.join(w.folder, 'elsewhere'), path.join(root, 'docs', 'agent-playbooks'));
  const widget = w.of(w.scan(), 'widget');
  assert.deepEqual(widget.files, []);
  assert.ok(widget.unproven.some(item => item.file === 'AGENTS.md' && item.reason === 'it is a symbolic link'));
  assert.ok(widget.unproven.every(item => item.reason === 'it is a symbolic link'));
});

// Directory links are made as junctions, which Windows allows without extra rights, so this runs on
// every system. A linked playbook folder is one line, and a linked .github folder is never shown as
// the kept programme file.
test('a linked folder is never followed: one line for the playbooks, and no programme file kept', t => {
  const w = world(t, { widget: { state: 'DISABLED', files: {} } });
  const root = path.join(w.folder, 'widget');
  for (const name of ['elsewhere', 'other-github']) fs.mkdirSync(path.join(w.folder, name));
  fs.writeFileSync(path.join(w.folder, 'elsewhere', 'INDEX.md'), template('docs/agent-playbooks/INDEX.md'));
  fs.writeFileSync(path.join(w.folder, 'other-github', 'toolkit-programme.json'), '{"governance":"disabled"}');
  fs.mkdirSync(path.join(root, 'docs'));
  fs.symlinkSync(path.join(w.folder, 'elsewhere'), path.join(root, 'docs', 'agent-playbooks'), 'junction');
  fs.symlinkSync(path.join(w.folder, 'other-github'), path.join(root, '.github'), 'junction');
  const widget = w.of(w.scan(), 'widget');
  assert.deepEqual(widget.files, []);
  assert.deepEqual(widget.kept, []);
  assert.deepEqual(widget.unproven.filter(item => item.file.startsWith('docs/')), [{ file: 'docs/agent-playbooks', reason: 'it is a symbolic link' }]);
  assert.ok(widget.unproven.some(item => item.file === '.github/toolkit-programme.json' && item.reason === 'it is a symbolic link'));
});

test('a missing folder, an unreadable folder and a folder that is not a checkout', t => {
  const missing = new leftovers.LeftoverScan({ githubFolder: path.join(os.tmpdir(), 'tk-leftovers-none', 'GitHub'), governance: {} }).scan();
  assert.deepEqual([missing.readable, missing.repositories], [true, []]);
  assert.match(leftovers.describe(missing).join('\n'), /No GitHub checkouts were found there\./);
  const failing = new leftovers.LeftoverScan({ githubFolder: 'x', governance: {}, discover: () => { throw new Error('denied'); } }).scan();
  assert.equal(failing.readable, false);
  assert.match(leftovers.describe(failing).join('\n'), /The folder could not be read, so nothing was scanned\./);
  const held = new leftovers.LeftoverScan({ githubFolder: 'x', governance: {}, discover: () => [{ root: path.join('x', 'group'), held: true, reason: 'denied' }] }).scan();
  assert.deepEqual(held.repositories.map(row => [row.name, row.scanned, row.reason]), [['group', false, 'the folder could not be read']]);
});

test('command line: scan prints the report, --json prints the same data, anything else prints usage', t => {
  const w = world(t, { widget: { state: 'DISABLED', files: TOOLKIT_FILES } });
  const lines = [], errors = [];
  const deps = { governance: w.governance, log: line => lines.push(line), error: line => errors.push(line) };
  assert.equal(leftovers.main(['scan', '--github-folder', w.folder], deps), 0);
  assert.match(lines.join('\n'), /example\/widget \(governance off\)/);
  lines.length = 0;
  assert.equal(leftovers.main(['scan', '--github-folder', w.folder, '--json'], deps), 0);
  assert.deepEqual(JSON.parse(lines.join('\n')), JSON.parse(JSON.stringify(w.scan())));
  for (const argv of [[], ['remove'], ['scan', '--delete'], ['scan', '--github-folder'], ['scan', '--github-folder', '--json']]) assert.equal(leftovers.main(argv, deps), 2, argv.join(' '));
  assert.ok(errors.every(line => line.startsWith('Usage: ')));
  const run = spawnSync(process.execPath, [SCRIPT, 'delete'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /^Usage: /);
});

test('the script has no way to change a file', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(source, /\b(?:writeFileSync|appendFileSync|rmSync|unlinkSync|renameSync|rmdirSync|mkdirSync|copyFileSync|child_process|spawn\w*|exec(?:File)?Sync)\b/);
});
