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

// ---- refresh governance -------------------------------------------------------------------------

const bank = require('../scripts/toolkit-governance-bank.cjs');
const questionBank = require('../scripts/toolkit-question-bank.cjs');

test('the governance bank of a governed repository offers the cleanup while copies are left, and says when none are', () => {
  const state = { state: 'ENABLED', repository: 'owner/app', root: '/x' };
  const merged = { store: { repository: 'owner/store' }, required_checks: [], ci_shards: { answer: 'never' } };
  const permissions = { checked: true, host: 'claude', missing: 0, stale: 0 };
  const app = { variable: 'found', secret: 'found' };
  const left = bank.governanceBankSpecs({ state, task: 'off', merged, permissions, app, cleanup: { files: 19 } });
  const table = questionBank.renderCompactQuestionTable(left, true).join('\n');
  assert.match(table, /\| Toolkit instruction copies \| 19 left \| B\. Clean up: [^|]*pull request[^|]* \| A\. Keep current \|/);
  const reference = bank.bankReference(left);
  assert.equal(bank.parseBankAnswer(`${reference}: all recommended`, left).instructionCopies, 'clean');
  const row = left.find(spec => spec.id === 'instruction-copies').presentation.question_ref;
  assert.equal(bank.parseBankAnswer(`${reference}: ${row}=A`, left).instructionCopies, 'keep');
  assert.equal(bank.parseBankAnswer(`${reference}: 1.1=B`, left).governance, 'off', 'turning governance off is never refused because Clean up is recommended; the cleanup then does nothing');
  const none = bank.governanceBankSpecs({ state, task: 'off', merged, permissions, app, cleanup: { files: 0 } });
  assert.match(questionBank.renderCompactQuestionTable(none, true).join('\n'), /Status \(nothing to answer\): Toolkit instruction copies: None left\./);
  assert.equal(bank.parseBankAnswer(`${bank.bankReference(none)}: all recommended`, none).instructionCopies, undefined, 'nothing to answer');
  const undecided = bank.governanceBankSpecs({ state: { state: 'UNDECIDED', repository: 'owner/app', root: '/x' }, permissions });
  assert.equal(undecided.some(spec => spec.id === 'instruction-copies'), false, 'only a governed repository is offered it');
});

test('refresh governance: the owner\'s clean up answer removes the copies in the working tree and names the one pull request to open', async t => {
  const { makeGoverned, recordMerged } = require('./toolkit-governed-fixture-support.cjs');
  const governance = require('../scripts/toolkit-governance-state.cjs');
  const gate = require('../scripts/toolkit-governance-gate.cjs');
  const { ToolkitGovernanceCli } = require('../scripts/toolkit-governance.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-cleanup-bank-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const target = makeGoverned(path.join(root, 'adopter'), 'adopter', { home });
  const registryPath = path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  const registryOptions = { registryPath, testOnly: true };
  const text = `${JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: 'toolkit-test-fixture/adopter', governance: 'enabled',
    parents: [{ issue: 1, record_prefix: 'INT-FX', writer_prefix: 'FX' }], store: { kind: 'github', repository: 'toolkit-test-fixture/store', branch: 'main', path: 'state/' },
    required_checks: ['validate'], ci_shards: { answer: 'never' } }, null, 2)}\n`;
  fs.writeFileSync(path.join(target, '.github', 'toolkit-programme.json'), text);
  recordMerged(target, { registryPath, text });
  fs.mkdirSync(path.join(target, 'docs', 'agent-playbooks'), { recursive: true });
  fs.writeFileSync(path.join(target, 'docs', 'agent-playbooks', 'safety-gates.md'), PLAYBOOKS['safety-gates.md']);
  const SESSION = 'session-owner-cleanup';
  const runCli = async argv => {
    let out = '', err = '';
    const cli = new ToolkitGovernanceCli({
      stdout: { write: chunk => { out += chunk; return true; } }, stderr: { write: chunk => { err += chunk; return true; } },
      cwd: target, interactive: false, registryOptions, ask: async () => '', refresh: () => ({ refreshed: true }), hookReader: () => null, queueReader: () => null,
      permissionsChecker: () => ({ checked: true, host: 'claude', missing: 0, stale: 0 }), appReader: () => ({ variable: 'found', secret: 'found' }),
      environment: { TOOLKIT_HOST_SESSION: SESSION }, ciEstimator: () => null, ciReaders: () => ({ ok: true }),
    });
    return { code: await cli.main(argv), out, err };
  };
  new gate.SessionEpochs({ registryOptions }).start(SESSION, 'startup', governance.governanceState(target, registryOptions).repository_id);
  const shown = await runCli(['setup']);
  assert.match(shown.out, /\| Toolkit instruction copies \| 2 left \| B\. Clean up: /, shown.out + shown.err);
  assert.ok(fs.existsSync(path.join(target, 'AGENTS.md')), 'showing the bank changes nothing');
  const reference = /Bank reference: (\S+)/.exec(shown.out)[1];
  const ticket = new bank.BankTickets({ registryOptions }).issue(SESSION, new gate.SessionEpochs({ registryOptions }).get(SESSION));
  const done = await runCli(['setup', '--answers', `${reference}: all recommended`, '--ticket', ticket]);
  assert.equal(done.code, 0, done.out + done.err);
  assert.equal(read(target, 'AGENTS.md'), null, 'the template-only AGENTS.md goes');
  assert.equal(read(target, 'docs/agent-playbooks/safety-gates.md'), null);
  assert.equal(JSON.parse(read(target, '.github/toolkit-programme.json')).min_toolkit, cleanup.MIN_TOOLKIT);
  assert.match(done.out, /Toolkit instruction copies: changed in the working tree only/);
  assert.match(done.out, /one pull request .*typed merge/);
});
