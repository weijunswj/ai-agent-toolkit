'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const leftovers = require('../scripts/toolkit-leftover-files.cjs');

const SCRIPT = require.resolve('../scripts/toolkit-leftover-files.cjs');
const PLAYBOOKS = require('../scripts/toolkit-playbooks.cjs').repositoryPlaybooks();
const { antigravityBootstrapCopy, managedAgentsCopy } = require('./support/retired-instruction-copies.cjs');
const template = name => PLAYBOOKS[name.slice('docs/agent-playbooks/'.length)];
const BLOCK = /<!-- AI-AGENT-TOOLKIT:\S+:BEGIN TOOLKIT-GOVERNED-RULES[\s\S]*?END TOOLKIT-GOVERNED-RULES -->/.exec(managedAgentsCopy())[0];
const BROKEN = "its Toolkit markers are broken, so Toolkit cannot tell its text from the rest; fixing them by hand is the owner's choice";
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

test('a repository whose governance could not be checked is not scanned, only provably Toolkit files are listed, and nothing is written', t => {
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

  // A governed repository is scanned for instruction copies only: its check and programme file are in use.
  const governed = w.of(report, 'governed');
  assert.deepEqual([governed.scanned, governed.governance], [true, 'governance on']);
  assert.deepEqual(governed.files.map(item => [item.file, item.kind]), [['AGENTS.md', 'block'], ['docs/agent-playbooks/INDEX.md', 'file']]);
  for (const name of ['unknown', 'broken', 'unreadable']) assert.deepEqual([w.of(report, name).scanned, w.of(report, name).reason], [false, 'its governance could not be checked'], name);

  const widget = w.of(report, 'widget');
  assert.equal(widget.governance, 'governance off');
  assert.deepEqual(widget.files.map(item => [item.file, item.kind, item.proof]), [
    ['AGENTS.md', 'block', 'Toolkit marker'],
    ['docs/agent-playbooks/INDEX.md', 'file', "same as Toolkit's shipped copy"],
    ['.github/scripts/plain-text-check.cjs', 'check', 'Toolkit marker'],
  ]);
  assert.equal(widget.files[0].block, 'TOOLKIT-GOVERNED-RULES');
  assert.equal(widget.files[0].edited, false);
  assert.deepEqual(widget.kept, [
    { file: 'CLAUDE.md', reason: "it loads this repository's own rules in AGENTS.md" },
    { file: '.github/toolkit-programme.json', reason: 'it records this repository\'s "governance off" decision' },
  ]);
  assert.deepEqual(widget.unproven, [{ file: 'docs/agent-playbooks/safety-gates.md', reason: "it differs from every Toolkit copy" }]);

  const clean = w.of(report, 'clean');
  assert.deepEqual([clean.scanned, clean.governance, clean.files, clean.kept, clean.unproven], [true, 'no governance decision', [], [], []]);

  const text = leftovers.describe(report).join('\n');
  assert.match(text, /^Leftover Toolkit files \(report only: nothing was changed or deleted\)/);
  assert.match(text, /example\/governed \(governance on\), /);
  assert.match(text, /- AGENTS\.md: Toolkit block TOOLKIT-GOVERNED-RULES inside the file\. The rest of the file is yours\./);
  assert.match(text, /- Kept: \.github\/toolkit-programme\.json, because it records this repository's "governance off" decision\./);
  assert.match(text, /- Not listed as Toolkit's: docs\/agent-playbooks\/safety-gates\.md, because it differs from every Toolkit copy\./);
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
  // In a governed repository the sweep copy is in use, so it is kept, never listed.
  assert.deepEqual(w.of(report, 'governed').files, []);
  assert.deepEqual(w.of(report, 'governed').kept.map(item => item.file), [sweep.file]);
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
  assert.deepEqual(widget.unproven, [{ file: 'AGENTS.md', reason: BROKEN }]);
  assert.deepEqual(widget.kept, [{ file: '.github/toolkit-programme.json', reason: "it is the repository's programme file, which Toolkit reads for the on/off decision" }]);
});

// A complete governed block beside a broken marker is not proven either: where a block ends cannot be
// told, so the file is named once, as not Toolkit's, and its one-line CLAUDE.md stays.
test('broken markers beside a complete governed block: the file is only named as not listed', t => {
  const w = world(t, { adopter: { state: 'ENABLED', files: {
    'AGENTS.md': `${BLOCK}\n\n<!-- AI-AGENT-TOOLKIT:x:BEGIN EXTRA v1 -->\n# Own rules\n`,
    'CLAUDE.md': '@AGENTS.md\n',
    'docs/agent-playbooks/INDEX.md': template('docs/agent-playbooks/INDEX.md'),
  } } });
  const adopter = w.of(w.scan(), 'adopter');
  assert.deepEqual(adopter.files.map(item => item.file), ['docs/agent-playbooks/INDEX.md']);
  assert.deepEqual(adopter.unproven, [{ file: 'AGENTS.md', reason: BROKEN }]);
  assert.deepEqual(adopter.kept.map(item => item.file), ['CLAUDE.md']);
});

// The curated-source comment is Toolkit's only as it last shipped and only as the first text left; an
// older wording, or the comment further down, stays as the owner's text.
test('the curated header goes only when it is the last shipped wording and the first text left', () => {
  const header = require('../contracts/agent-rules/playbook-history.json').agents_header;
  assert.equal(header, [
    '<!--',
    'Curated AI-facing source.',
    'Source: repo/contracts/agent-rules/repo-local',
    'Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.',
    '-->',
  ].join('\n'), 'the wording older setups wrote, kept as it shipped');
  const drop = leftovers.withoutCuratedHeader;
  assert.equal(drop(`${header}\n\n# Own rules\n`), '# Own rules\n');
  assert.equal(drop(`${header}\n# Own rules\n`), '# Own rules\n');
  assert.equal(drop(`${header}\n`), '');
  assert.equal(drop(`\n${header}\n\n# Own rules\n`), '# Own rules\n', 'blank lines before it go with it');
  assert.equal(drop(`${header.replace(/\n/g, '\r\n')}\r\n\r\n# Own rules\r\n`), '# Own rules\r\n', 'Windows line endings');
  assert.equal(drop(`\uFEFF${header}\n\n# Own rules\n`), '\uFEFF# Own rules\n', 'a byte order mark stays');
  for (const kept of [`# Own rules\n\n${header}\n`, `${header.replace('Curated', 'Older curated')}\n\n# Own rules\n`, `${header} trailing\n# Own rules\n`]) {
    assert.equal(drop(kept), kept);
  }
  assert.equal(drop(`${header}\n\n\n# Own rules\n`), '\n# Own rules\n', 'only one blank line after it goes');
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

// A governed repository shaped like an early adopter: an older governed block above its own rules,
// the shipped playbooks, an earlier copy of one, a retired one, one the owner edited, and the files
// governance uses. Only the instruction copies are listed; the rest is kept or not proven.
test('a governed repository lists its instruction copies, including earlier and retired playbooks, and keeps what governance uses', t => {
  const crypto = require('node:crypto');
  const hash = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
  const older = '# Safety gates\n\nAn earlier Toolkit wording.\n';
  const retired = '# Managed memory\n\nA playbook Toolkit no longer ships.\n';
  const history = { 'safety-gates.md': [hash(older)], 'managed-memory.md': [hash(retired)] };
  const cloud = require('../scripts/toolkit-cloud-workflows.cjs');
  const body = '# A copy\nname: X\non: push\njobs: {}\n';
  const sweep = `# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED ${cloud.WORKFLOWS[0].id} toolkit=${'c'.repeat(40)} sha256=${cloud.bodyHash(body)}\n${body}`;
  const playbooks = Object.fromEntries(Object.entries(PLAYBOOKS).map(([name, text]) => [`docs/agent-playbooks/${name}`, text]));
  const w = world(t, {
    adopter: { state: 'ENABLED', files: {
      'AGENTS.md': `${BLOCK}\n\n# Adopter rules\n\nKeep these.\n`,
      ...playbooks,
      'docs/agent-playbooks/safety-gates.md': older,
      'docs/agent-playbooks/managed-memory.md': retired,
      'docs/agent-playbooks/git-completion.md': `${PLAYBOOKS['git-completion.md']}\nMy own addition.\n`,
      'docs/agent-playbooks/my-team.md': '# Our own playbook\n',
      '.github/scripts/plain-text-check.cjs': CHECK,
      [cloud.WORKFLOWS[0].file]: sweep,
      '.github/toolkit-programme.json': '{ "governance": "enabled" }\n',
    } },
    // Nothing of its own is left once the block goes, so the one-line CLAUDE.md goes too.
    template: { state: 'ENABLED', files: { 'AGENTS.md': managedAgentsCopy(), 'CLAUDE.md': '@AGENTS.md\n', '.agents/rules/00-agent-toolkit-bootstrap.md': antigravityBootstrapCopy() } },
  });
  const scan = () => new leftovers.LeftoverScan({ githubFolder: w.folder, governance: w.governance, history }).scan();
  const report = scan();
  const adopter = w.of(report, 'adopter');
  const listed = adopter.files.map(item => item.file);
  const expected = Object.keys(PLAYBOOKS).filter(name => name !== 'git-completion.md').map(name => `docs/agent-playbooks/${name}`);
  assert.deepEqual(listed, ['AGENTS.md', ...[...expected, 'docs/agent-playbooks/managed-memory.md'].sort()]);
  assert.equal(adopter.files[0].empties, false, 'the adopter keeps its own rules in AGENTS.md');
  assert.deepEqual(adopter.files.filter(item => ['safety-gates.md', 'managed-memory.md'].some(name => item.file.endsWith(name))).map(item => item.proof), ['same as an earlier Toolkit copy', 'same as an earlier Toolkit copy']);
  assert.deepEqual(adopter.unproven, [{ file: 'docs/agent-playbooks/git-completion.md', reason: "it differs from every Toolkit copy" }]);
  assert.deepEqual(adopter.kept.map(item => item.file), ['.github/scripts/plain-text-check.cjs', cloud.WORKFLOWS[0].file, '.github/toolkit-programme.json']);
  assert.ok(!listed.includes('docs/agent-playbooks/my-team.md'));
  const plain = w.of(report, 'template');
  assert.deepEqual(plain.files.map(item => [item.file, item.kind, item.empties ?? null]), [
    ['AGENTS.md', 'block', true], ['.agents/rules/00-agent-toolkit-bootstrap.md', 'block', true], ['CLAUDE.md', 'file', null]]);
});

// Two shipped texts whose hashes were recorded only under another name: project-completion-audit.md
// (renamed to release-readiness-audit.md a day after it shipped) and a git-completion.md that was on
// main for under an hour. The scan looks a copy up by its own name, so each hash is listed under the
// name it shipped as. The texts are pinned by hash; reading them needs the full git history.
test('the playbook history lists every shipped text under the name it shipped as', t => {
  const history = require('../contracts/agent-rules/playbook-history.json').playbooks;
  assert.ok(history['project-completion-audit.md'].includes('1981258f7b9c3a41'), 'project-completion-audit.md, blob c7a3567');
  assert.ok(history['git-completion.md'].includes('59d87b96421ccca7'), 'git-completion.md, blob 9dbb943');
  // The scan finds a copy by the hash listed under its own name.
  const text = '# A text Toolkit shipped under one name\n';
  const hash = require('node:crypto').createHash('sha256').update(text).digest('hex').slice(0, 16);
  const w = world(t, { adopter: { state: 'ENABLED', files: { 'docs/agent-playbooks/project-completion-audit.md': text } } });
  const scanWith = names => w.of(new leftovers.LeftoverScan({ githubFolder: w.folder, governance: w.governance, history: names }).scan(), 'adopter');
  assert.deepEqual(scanWith({ 'project-completion-audit.md': [hash] }).files.map(item => [item.file, item.proof]), [['docs/agent-playbooks/project-completion-audit.md', 'same as an earlier Toolkit copy']]);
  assert.deepEqual(scanWith({ 'project-completion-audit.md': [], 'release-readiness-audit.md': [hash] }).files, [], 'a hash under another name is not proof');
});

test('every playbook Toolkit ships now is in the playbook history, so a copy made from it is always recognised', () => {
  const crypto = require('node:crypto');
  const history = require('../contracts/agent-rules/playbook-history.json').playbooks;
  for (const [name, text] of Object.entries(PLAYBOOKS)) {
    assert.ok((history[name] || []).includes(crypto.createHash('sha256').update(text).digest('hex').slice(0, 16)), `${name}: add its hash to repo/contracts/agent-rules/playbook-history.json`);
  }
});

test('the script has no way to change a file', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(source, /\b(?:writeFileSync|appendFileSync|rmSync|unlinkSync|renameSync|rmdirSync|mkdirSync|copyFileSync|child_process|spawn\w*|exec(?:File)?Sync)\b/);
});

test('discovery takes main checkouts at the top and one level down; a linked worktree is skipped', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-discover-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const main = path.join(folder, 'app'), nested = path.join(folder, 'group', 'lib'), linked = path.join(folder, 'app-worktree');
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  fs.mkdirSync(path.join(nested, '.git'), { recursive: true });
  fs.mkdirSync(linked); fs.writeFileSync(path.join(linked, '.git'), 'gitdir: ../app/.git/worktrees/x\n');
  assert.deepEqual(leftovers.discoverCheckouts(folder).sort(), [main, nested].sort());
});

test('discovery reports an unreadable folder as held without hiding readable neighbours', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-discover-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const blocked = path.join(folder, 'blocked'), good = path.join(folder, 'good');
  fs.mkdirSync(blocked); fs.mkdirSync(path.join(good, '.git'), { recursive: true });
  const found = leftovers.discoverCheckouts(folder, { readDir: dir => { if (dir === blocked) throw new Error('access denied'); return fs.readdirSync(dir, { withFileTypes: true }); } });
  assert.ok(found.includes(good));
  assert.ok(found.some(row => row.root === blocked && row.held && /could not be read/.test(row.reason)));
});
