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
