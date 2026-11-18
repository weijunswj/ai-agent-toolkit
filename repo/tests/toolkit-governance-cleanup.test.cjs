'use strict';

// The cleanup route for a governed repository: the leftover scan's instruction copies are removed from
// the working tree (every byte outside the markers kept), the programme file gains min_toolkit, and
// nothing else changes. A preview writes nothing.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cleanup = require('../scripts/toolkit-governance-cleanup.cjs');

const TEMPLATES = path.join(__dirname, '..', '..', 'skills', 'repository-agent-rules', 'repo-local');
const PLAYBOOKS = require('../scripts/toolkit-playbooks.cjs').repositoryPlaybooks();
const BLOCK = /<!-- AI-AGENT-TOOLKIT:\S+:BEGIN TOOLKIT-GOVERNED-RULES[\s\S]*?END TOOLKIT-GOVERNED-RULES -->/.exec(fs.readFileSync(path.join(TEMPLATES, 'AGENTS.managed.template.md'), 'utf8'))[0];
const CHECK = `#!/usr/bin/env node\n// AI-AGENT-TOOLKIT:secure-ci-cd:VENDORED plain-text-check check=3 sha256=0123456789ab\n'use strict';\n`;
const BINDING = '{\n  "schema": "toolkit.programme-binding.v2",\n  "repository": "example/adopter",\n  "governance": "enabled"\n}\n';

function repo(t, files, state = 'ENABLED') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-cleanup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.git'));
  for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); }
  const governance = {
    readIdentity: dir => ({ valid: true, root: dir, remote: { host: 'github.com', path: '/example/adopter.git' } }),
    governanceState: () => ({ state }),
  };
  return { root, governance };
}
const read = (root, file) => { try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return null; } };

test('a preview lists the changes and writes nothing; the cleanup removes only the copies and sets min_toolkit', t => {
  const own = '# Adopter rules\r\n\r\nKeep these exactly.\r\n';
  const r = repo(t, {
    'AGENTS.md': `${BLOCK.replace(/\n/g, '\r\n')}\r\n\r\n${own}`,
    'CLAUDE.md': '@AGENTS.md\n',
    'docs/agent-playbooks/INDEX.md': PLAYBOOKS['INDEX.md'],
    'docs/agent-playbooks/safety-gates.md': PLAYBOOKS['safety-gates.md'],
    'docs/agent-playbooks/our-own.md': '# Ours\n',
    '.github/scripts/plain-text-check.cjs': CHECK,
    '.github/toolkit-programme.json': BINDING,
  });
  const preview = cleanup.run({ root: r.root, write: false, governance: r.governance });
  assert.equal(preview.ok, true, preview.lines.join('\n'));
  assert.deepEqual(preview.changes.map(change => [change.file, change.action]), [
    ['AGENTS.md', 'remove-block'], ['docs/agent-playbooks/INDEX.md', 'delete'], ['docs/agent-playbooks/safety-gates.md', 'delete'],
    ['.github/toolkit-programme.json', 'set-min-toolkit']]);
  assert.equal(read(r.root, 'docs/agent-playbooks/INDEX.md'), PLAYBOOKS['INDEX.md'], 'a preview writes nothing');

  const done = cleanup.run({ root: r.root, write: true, governance: r.governance });
  assert.equal(done.ok, true, done.lines.join('\n'));
  assert.equal(read(r.root, 'AGENTS.md'), own, 'every byte outside the markers is kept');
  assert.equal(read(r.root, 'CLAUDE.md'), '@AGENTS.md\n', 'the shim that loads the repository\'s own rules stays');
  assert.equal(read(r.root, 'docs/agent-playbooks/INDEX.md'), null);
  assert.equal(read(r.root, 'docs/agent-playbooks/safety-gates.md'), null);
  assert.equal(read(r.root, 'docs/agent-playbooks/our-own.md'), '# Ours\n');
  assert.equal(read(r.root, '.github/scripts/plain-text-check.cjs'), CHECK, 'the check governance uses stays');
  assert.deepEqual(JSON.parse(read(r.root, '.github/toolkit-programme.json')), { ...JSON.parse(BINDING), min_toolkit: cleanup.MIN_TOOLKIT });
  assert.match(done.lines.join('\n'), /pull request/);
  // Running again finds nothing more to do.
  assert.deepEqual(cleanup.run({ root: r.root, write: false, governance: r.governance }).changes, []);
});

test('an AGENTS.md left with nothing of its own goes, with its one-line CLAUDE.md and the bootstrap', t => {
  const r = repo(t, {
    'AGENTS.md': fs.readFileSync(path.join(TEMPLATES, 'AGENTS.managed.template.md'), 'utf8'),
    'CLAUDE.md': '@AGENTS.md\n',
    '.agents/rules/00-agent-toolkit-bootstrap.md': fs.readFileSync(path.join(TEMPLATES, 'antigravity-bootstrap.template.md'), 'utf8'),
    '.github/toolkit-programme.json': BINDING,
  });
  const done = cleanup.run({ root: r.root, write: true, governance: r.governance });
  assert.equal(done.ok, true, done.lines.join('\n'));
  for (const file of ['AGENTS.md', 'CLAUDE.md', '.agents/rules/00-agent-toolkit-bootstrap.md']) assert.equal(read(r.root, file), null, file);
});

test('only a governed repository is cleaned, and a broken or unreadable programme file stops it', t => {
  const off = repo(t, { 'AGENTS.md': BLOCK, '.github/toolkit-programme.json': BINDING }, 'DISABLED');
  const refused = cleanup.run({ root: off.root, write: true, governance: off.governance });
  assert.equal(refused.ok, false);
  assert.match(refused.lines.join('\n'), /governance is not on/);
  assert.equal(read(off.root, 'AGENTS.md'), BLOCK);
  const broken = repo(t, { 'AGENTS.md': BLOCK, '.github/toolkit-programme.json': 'not json' });
  const stopped = cleanup.run({ root: broken.root, write: true, governance: broken.governance });
  assert.equal(stopped.ok, false);
  assert.equal(read(broken.root, 'AGENTS.md'), BLOCK, 'nothing is removed when the programme file cannot be updated');
});

test('a version 1 programme file and a Toolkit source checkout are refused, so a merge never leaves an unusable binding or breaks the source sync', t => {
  const v1 = '{\n  "schema": "toolkit.programme-binding.v1",\n  "repository": "example/adopter",\n  "parent_issue": 1\n}\n';
  const old = repo(t, { 'AGENTS.md': BLOCK, '.github/toolkit-programme.json': v1 });
  const refused = cleanup.run({ root: old.root, write: true, governance: old.governance });
  assert.equal(refused.ok, false);
  assert.match(refused.lines.join('\n'), /version 2/);
  assert.equal(read(old.root, 'AGENTS.md'), BLOCK);
  assert.equal(read(old.root, '.github/toolkit-programme.json'), v1);
  const source = repo(t, {
    'AGENTS.md': BLOCK, '.github/toolkit-programme.json': BINDING,
    'skills/repository-agent-rules/repo-local/AGENTS.managed.template.md': BLOCK,
    'repo/scripts/sync-agent-instruction-shims.cjs': '// sync\n',
  });
  const held = cleanup.run({ root: source.root, write: true, governance: source.governance });
  assert.equal(held.ok, false);
  assert.match(held.lines.join('\n'), /Toolkit source checkout/);
  assert.equal(read(source.root, 'AGENTS.md'), BLOCK);
});

test('min_toolkit goes into the programme file in its own layout, so the pull request shows one added line', t => {
  const crlf = '{\r\n    "schema": "toolkit.programme-binding.v2",\r\n    "repository": "example/adopter",\r\n    "governance": "enabled",\r\n    "required_checks": ["validate", "plain-text"]\r\n}\r\n';
  const r = repo(t, { 'AGENTS.md': BLOCK, '.github/toolkit-programme.json': crlf });
  assert.equal(cleanup.run({ root: r.root, write: true, governance: r.governance }).ok, true);
  assert.equal(read(r.root, '.github/toolkit-programme.json'), crlf.replace('"plain-text"]\r\n}', `"plain-text"],\r\n    "min_toolkit": "${cleanup.MIN_TOOLKIT}"\r\n}`));
  const older = repo(t, { 'AGENTS.md': BLOCK, '.github/toolkit-programme.json': BINDING.replace('"enabled"', '"enabled",\n  "min_toolkit": "3.100.0"') });
  assert.equal(cleanup.run({ root: older.root, write: true, governance: older.governance }).ok, true);
  assert.equal(read(older.root, '.github/toolkit-programme.json'), BINDING.replace('"enabled"', `"enabled",\n  "min_toolkit": "${cleanup.MIN_TOOLKIT}"`), 'an older value is raised in place');
});

test('setting min_toolkit also deletes the retired schedule_folder line in the file\'s own layout, and the preview says so', t => {
  const crlf = BINDING.replace(/\n  /g, '\n    ').replace(/\n/g, '\r\n');
  for (const [layout, base, indent, newline] of [['two spaces', BINDING, '  ', '\n'], ['four spaces and CRLF', crlf, '    ', '\r\n']]) {
    const plain = repo(t, { 'AGENTS.md': BLOCK, '.github/toolkit-programme.json': base });
    assert.match(cleanup.run({ root: plain.root, write: false, governance: plain.governance }).lines.join('\n'), /- \.github\/toolkit-programme\.json: set min_toolkit to \d+\.\d+\.\d+\.\n/, 'without the key, the line is as before');
    assert.equal(cleanup.run({ root: plain.root, write: true, governance: plain.governance }).ok, true);
    const expected = read(plain.root, '.github/toolkit-programme.json');
    const key = `"schedule_folder": "TOOLKIT"`;
    for (const carried of [base.replace('"enabled"', `"enabled",${newline}${indent}${key}`), base.replace('"governance"', `${key},${newline}${indent}"governance"`)]) {
      const r = repo(t, { 'AGENTS.md': BLOCK, '.github/toolkit-programme.json': carried });
      const preview = cleanup.run({ root: r.root, write: false, governance: r.governance });
      assert.match(preview.lines.join('\n'), /- \.github\/toolkit-programme\.json: set min_toolkit to \d+\.\d+\.\d+, and delete the retired schedule_folder, which nothing reads any more\./);
      assert.equal(cleanup.run({ root: r.root, write: true, governance: r.governance }).ok, true);
      assert.equal(read(r.root, '.github/toolkit-programme.json'), expected, `${layout}: the key's line goes and nothing else changes`);
    }
  }
});

test('a sweep copy pinned to a Toolkit that does not know min_toolkit holds the cleanup, so the programme board keeps updating', t => {
  const offer = require('../scripts/toolkit-ci-shards-offer.cjs');
  // A copy pinned to a commit from before min_toolkit: its validator would read the cleaned binding as invalid.
  const sweep = `# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED programme-sweep toolkit=${offer.CI_SHARDS_READER} sha256=000000000000\nname: Toolkit Programme Sweep\n`;
  const pinned = repo(t, { 'AGENTS.md': `${BLOCK}\n\n# Own\n`, '.github/toolkit-programme.json': BINDING, '.github/workflows/toolkit-programme-sweep.yml': sweep });
  const held = cleanup.run({ root: pinned.root, write: true, governance: pinned.governance });
  assert.equal(held.ok, false);
  assert.equal(held.files, 1, 'the copies it would remove are still counted for the bank');
  assert.match(held.held, /\.github\/workflows\/toolkit-programme-sweep\.yml run a Toolkit that does not know min_toolkit/);
  assert.match(held.lines.join('\n'), /Nothing was changed: .+ Refresh them first \(toolkit-cloud-workflows\.cjs --repo <repository>/);
  assert.equal(read(pinned.root, 'AGENTS.md'), `${BLOCK}\n\n# Own\n`);
  assert.equal(read(pinned.root, '.github/toolkit-programme.json'), BINDING);
  // Copies that read min_toolkit let it run; the check is skipped when min_toolkit is already current.
  const ready = repo(t, { 'AGENTS.md': `${BLOCK}\n\n# Own\n`, '.github/toolkit-programme.json': BINDING });
  assert.equal(cleanup.run({ root: ready.root, write: true, governance: ready.governance, sweepReaders: () => [] }).ok, true);
  const current = repo(t, { 'AGENTS.md': `${BLOCK}\n\n# Own\n`, '.github/toolkit-programme.json': BINDING.replace('"enabled"', `"enabled",\n  "min_toolkit": "${cleanup.MIN_TOOLKIT}"`) });
  assert.equal(cleanup.run({ root: current.root, write: false, governance: current.governance, sweepReaders: () => { throw new Error('not asked'); } }).ok, true);

  // The bank shows the held cleanup as a status line, never a question to answer.
  const bank = require('../scripts/toolkit-governance-bank.cjs');
  const state = { state: 'ENABLED', repository: 'owner/app', root: '/x' };
  const specs = bank.governanceBankSpecs({ state, task: 'off', merged: { store: { repository: 'owner/store' }, required_checks: [] }, permissions: { checked: true, host: 'claude', missing: 0, stale: 0 }, copies: { files: 1, held: held.held } });
  const row = specs.find(spec => spec.id === 'instruction-copies');
  assert.equal(row.report_only, true);
  assert.equal(row.current, '1 file left, cleanup held');
  assert.equal(bank.parseBankAnswer(`${bank.bankReference(specs)}: all recommended`, specs).instructionCopies, undefined);
});

test('a governed block edited by hand is named in the preview, because those edits go with it', t => {
  const edited = BLOCK.replace(/(BEGIN TOOLKIT-GOVERNED-RULES[^\n]*-->\n)/, '$1Our own extra line.\n');
  const r = repo(t, { 'AGENTS.md': `${edited}\n\n# Own\n`, '.github/toolkit-programme.json': BINDING });
  const preview = cleanup.run({ root: r.root, governance: r.governance, sweepReaders: () => [] });
  assert.equal(preview.ok, true);
  assert.match(preview.lines.join('\n'), /- AGENTS\.md: remove the Toolkit block, keeping the rest of the file \(the block was edited by hand since Toolkit wrote it, and those edits go with it\)\./);
  const plain = repo(t, { 'AGENTS.md': `${BLOCK}\n\n# Own\n`, '.github/toolkit-programme.json': BINDING });
  assert.doesNotMatch(cleanup.run({ root: plain.root, governance: plain.governance, sweepReaders: () => [] }).lines.join('\n'), /edited by hand/);
});

// The cleanup is wired into refresh governance: the bank of a governed repository with copies asks
// about them, and only the owner's ticketed Clean up writes the cleanup in the working tree.
test('refresh governance asks about the copies; Keep current is recommended and Clean up writes the cleanup', async t => {
  const { makeGoverned, recordMerged } = require('./toolkit-governed-fixture-support.cjs');
  const gate = require('../scripts/toolkit-governance-gate.cjs');
  const governance = require('../scripts/toolkit-governance-state.cjs');
  const { ToolkitGovernanceCli } = require('../scripts/toolkit-governance.cjs');
  const { BankTickets } = require('../scripts/toolkit-governance-bank.cjs');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-cleanup-bank-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const home = path.join(base, 'home');
  const repoDir = makeGoverned(path.join(base, 'adopter'), 'adopter', { home });
  const registryPath = path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  const registryOptions = { registryPath, testOnly: true };
  const own = '# Adopter rules\n';
  fs.writeFileSync(path.join(repoDir, 'AGENTS.md'), `${BLOCK}\n\n${own}`);
  fs.mkdirSync(path.join(repoDir, 'docs', 'agent-playbooks'), { recursive: true });
  fs.writeFileSync(path.join(repoDir, 'docs', 'agent-playbooks', 'INDEX.md'), PLAYBOOKS['INDEX.md']);
  const binding = `${JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: 'toolkit-test-fixture/adopter', governance: 'enabled',
    parents: [{ issue: 1, record_prefix: 'INT-FX', writer_prefix: 'FX' }], store: { kind: 'github', repository: 'toolkit-test-fixture/store', branch: 'main', path: 'state/' },
    required_checks: ['validate'], ci_shards: { answer: 'never' } }, null, 2)}\n`;
  fs.writeFileSync(path.join(repoDir, '.github', 'toolkit-programme.json'), binding);
  recordMerged(repoDir, { registryPath, text: binding });
  const SESSION = 'session-owner-cleanup';
  const cli = async argv => {
    let out = '', err = '';
    const code = await new ToolkitGovernanceCli({
      stdout: { write: text => { out += text; return true; } }, stderr: { write: text => { err += text; return true; } },
      cwd: repoDir, interactive: false, registryOptions, ask: async () => '', refresh: () => ({ refreshed: true }), hookReader: () => null, queueReader: () => null,
      permissionsChecker: () => ({ checked: true, host: 'claude', missing: 0, stale: 0, update: 'x', remove: 'y' }), environment: { TOOLKIT_HOST_SESSION: SESSION },
    }).main(argv);
    return { code, out, err };
  };
  const answer = async reply => {
    new gate.SessionEpochs({ registryOptions }).start(SESSION, 'startup', governance.governanceState(repoDir, registryOptions).repository_id);
    const shown = await cli(['setup']);
    assert.equal(shown.code, 0, shown.err);
    const reference = /Bank reference: (\S+)/.exec(shown.out)[1];
    const ticket = new BankTickets({ registryOptions }).issue(SESSION, new gate.SessionEpochs({ registryOptions }).get(SESSION));
    return { shown, ...(await cli(['setup', '--answers', `${reference}: ${reply}`, '--ticket', ticket])) };
  };

  const kept = await answer('all recommended');
  const row = /\| (1\.\d+) \| Toolkit instruction copies \| 2 files to clean up \| A\. Keep current \| B\. Clean up \|/.exec(kept.shown.out);
  assert.ok(row, kept.shown.out);
  assert.equal(kept.code, 0, kept.err);
  assert.equal(read(repoDir, 'docs/agent-playbooks/INDEX.md'), PLAYBOOKS['INDEX.md'], 'all recommended removes nothing');

  const cleaned = await answer(`${row[1]}=B`);
  assert.equal(cleaned.code, 0, cleaned.err);
  assert.equal(read(repoDir, 'AGENTS.md'), own, 'every byte outside the markers is kept');
  assert.equal(read(repoDir, 'docs/agent-playbooks/INDEX.md'), null);
  assert.equal(JSON.parse(read(repoDir, '.github/toolkit-programme.json')).min_toolkit, cleanup.MIN_TOOLKIT);
  assert.match(cleaned.out, /Changed in .*:\n- AGENTS\.md: remove the Toolkit block/);
  assert.match(cleaned.out, /one pull request for the owner to merge/);
  assert.doesNotMatch((await cli(['setup'])).out, /Toolkit instruction copies \|/, 'nothing left to ask about');
});

// The floor the cleanup writes is the first release with S2, S3 and the session-start truncation fix,
// so it can never be newer than this Toolkit; Toolkit's own binding carries the same floor first.
test('MIN_TOOLKIT is no newer than this Toolkit, and Toolkit\'s own binding carries it', () => {
  const ROOT = path.join(__dirname, '..', '..');
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'repo', 'contracts', 'toolkit-local-bridge', 'version.json'), 'utf8')).version;
  const parts = value => value.split('.').map(Number);
  const [floor, current] = [parts(cleanup.MIN_TOOLKIT), parts(version)];
  const order = floor.map((part, index) => Math.sign(part - current[index])).find(sign => sign !== 0) || 0;
  assert.ok(order <= 0, `MIN_TOOLKIT ${cleanup.MIN_TOOLKIT} is newer than version.json ${version}`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, '.github', 'toolkit-programme.json'), 'utf8')).min_toolkit, cleanup.MIN_TOOLKIT);
});
