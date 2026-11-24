'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { OfficialN8nSkills, installSummary } = require('../scripts/toolkit-n8n-official-skills.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');

function home(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-n8n-skills-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the 15 official skill folders reach this app, and Antigravity only when Toolkit\'s skills are kept there', (t) => {
  const dir = home(t);
  const owner = new OfficialN8nSkills({ toolkitRoot: repoRoot, host: 'claude-code', homeDir: dir });
  assert.equal(owner.skillNames().length, 15);
  assert.deepEqual(owner.targets(), [path.join(dir, '.claude', 'skills')]);
  const first = owner.install();
  assert.equal(first.copied.length, 15);
  for (const name of owner.skillNames()) assert.ok(fs.existsSync(path.join(dir, '.claude', 'skills', name, 'SKILL.md')), name);
  // Nothing that runs: no hook scripts or plugin wrappers come along.
  const copied = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : copied.push(p); } };
  walk(path.join(dir, '.claude', 'skills'));
  assert.equal(copied.some((p) => /\.(sh|ps1|cmd|bat)$|hooks\.json$|plugin\.json$/.test(p)), false);
  assert.deepEqual(owner.install().copied, [], 'a second run copies nothing');
  fs.mkdirSync(path.join(dir, '.gemini'));
  assert.deepEqual(owner.targets(), [path.join(dir, '.claude', 'skills')], 'an installed Antigravity alone is not consent');
  const withAntigravity = new OfficialN8nSkills({ toolkitRoot: repoRoot, host: 'claude-code', homeDir: dir, antigravity: true });
  assert.deepEqual(withAntigravity.targets(), [path.join(dir, '.claude', 'skills'), path.join(dir, '.gemini', 'config', 'skills')]);
  assert.equal(withAntigravity.install().copied.length, 15);
  assert.equal(new OfficialN8nSkills({ toolkitRoot: repoRoot, host: 'codex', homeDir: dir }).targets()[0], path.join(dir, '.agents', 'skills'));
});

test('a hand copy is reported and never changed; stale Toolkit copies are refreshed; CRLF counts as current', (t) => {
  const dir = home(t);
  const owner = new OfficialN8nSkills({ toolkitRoot: repoRoot, host: 'codex', homeDir: dir });
  const target = path.join(dir, '.agents', 'skills');
  const hand = path.join(target, 'n8n-expressions-official');
  fs.mkdirSync(hand, { recursive: true });
  fs.writeFileSync(path.join(hand, 'SKILL.md'), 'my own copy\n');
  const result = owner.install();
  assert.equal(fs.readFileSync(path.join(hand, 'SKILL.md'), 'utf8'), 'my own copy\n');
  assert.deepEqual(result.handCopies.map((row) => row.skill), ['n8n-expressions-official']);
  assert.match(installSummary(result), /kept your own copies of n8n-expressions-official/);

  const owned = path.join(target, 'n8n-loops-official', 'SKILL.md');
  fs.writeFileSync(owned, fs.readFileSync(owned, 'utf8').replace(/\n/g, '\r\n'));
  assert.equal(owner.inspect().find((row) => row.skill === 'n8n-loops-official').state, 'current');
  fs.appendFileSync(owned, 'edited\n');
  assert.equal(owner.inspect().find((row) => row.skill === 'n8n-loops-official').state, 'stale');
  owner.install();
  assert.equal(owner.inspect().find((row) => row.skill === 'n8n-loops-official').state, 'current');
});

test('removal deletes only the folders Toolkit recorded', (t) => {
  const dir = home(t);
  const owner = new OfficialN8nSkills({ toolkitRoot: repoRoot, host: 'claude-code', homeDir: dir });
  const target = path.join(dir, '.claude', 'skills');
  fs.mkdirSync(path.join(target, 'my-skill'), { recursive: true });
  fs.mkdirSync(path.join(target, 'n8n-debugging-official'), { recursive: true });
  owner.install();
  const removed = owner.remove();
  assert.equal(removed.length, 14);
  assert.ok(fs.existsSync(path.join(target, 'my-skill')));
  assert.ok(fs.existsSync(path.join(target, 'n8n-debugging-official')), 'the hand copy stays');
  assert.equal(fs.existsSync(path.join(target, 'n8n-loops-official')), false);
  assert.equal(fs.existsSync(path.join(dir, '.ai-agent-toolkit', 'n8n-official-skills.json')), false);
});

// Toolkit only copies the n8n skills; the n8n Skills plugin is the owner's to turn on or off in each app.
test('setup copies the n8n skills and never turns the n8n Skills plugin on or off', () => {
  // The switch-off route is gone, so setup has no way to reach the plugin.
  assert.equal(Object.hasOwn(require('../scripts/setup-claude-toolkit-plugin.cjs'), 'disableUserPlugin'), false);
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'setup-toolkit-core.cjs'), 'utf8');
  assert.doesNotMatch(source, /n8n-skills@n8n-io|n8n Skills plugin|plugin disable /);
  const { installOfficialN8nSkills } = require('../scripts/setup-toolkit-core.cjs');
  const added = [];
  const notice = { addCopies: (result) => added.push(result) };
  const owner = { install: () => ({ copied: [], current: [{ app: 'Claude Code', folder: 'x', skills: 15 }], handCopies: [] }) };
  for (const host of ['claude-code', 'codex']) {
    const said = installOfficialN8nSkills({ host }, owner, notice);
    assert.match(said, /^Toolkit's n8n skills|\.$/, host);
    assert.doesNotMatch(said, /plugin|load twice/i, host);
  }
  assert.equal(added.length, 2, 'the new-session notice still hears about the copies');
  assert.equal(installOfficialN8nSkills({ host: 'claude-code' }, { install: () => { throw new Error('copy failed'); } }), 'not copied (copy failed).');
});

test('older-name copies in Antigravity older skills folder are reported as loading twice and never touched', (t) => {
  const dir = home(t);
  const older = path.join(dir, '.gemini', 'antigravity', 'skills', 'n8n-expressions');
  fs.mkdirSync(older, { recursive: true });
  fs.writeFileSync(path.join(older, 'SKILL.md'), 'mine\n');
  const result = new OfficialN8nSkills({ toolkitRoot: repoRoot, host: 'claude-code', homeDir: dir, antigravity: true }).install();
  assert.deepEqual(result.loadTwice, ['n8n-expressions in .gemini/antigravity/skills']);
  assert.match(installSummary(result), /your own older copies also load \(n8n-expressions in ~\/\.gemini\/antigravity\/skills\); delete them yourself/);
  assert.equal(fs.readFileSync(path.join(older, 'SKILL.md'), 'utf8'), 'mine\n');
});

test('an older release copy in the app skills folder is reported too', (t) => {
  const dir = home(t);
  fs.mkdirSync(path.join(dir, '.claude', 'skills', 'using-n8n-skills'), { recursive: true });
  const result = new OfficialN8nSkills({ toolkitRoot: repoRoot, host: 'claude-code', homeDir: dir }).install();
  assert.deepEqual(result.loadTwice, ['using-n8n-skills in .claude/skills']);
  assert.ok(fs.existsSync(path.join(dir, '.claude', 'skills', 'using-n8n-skills')));
});

test('install removes Toolkit copies of retired skills; a bad ledger entry is never acted on', (t) => {
  const dir = home(t);
  const owner = new OfficialN8nSkills({ toolkitRoot: repoRoot, host: 'codex', homeDir: dir });
  owner.install();
  const target = path.join(dir, '.agents', 'skills');
  const ledgerPath = path.join(dir, '.ai-agent-toolkit', 'n8n-official-skills.json');
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  fs.mkdirSync(path.join(target, 'n8n-retired-official'));
  fs.mkdirSync(path.join(target, 'mine'));
  ledger.targets[target].push('n8n-retired-official', '', '..', 'a/b');
  ledger.targets[dir] = ['mine'];
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
  const result = owner.install();
  assert.deepEqual(result.pruned.map((row) => row.skill), ['n8n-retired-official']);
  assert.equal(fs.existsSync(path.join(target, 'n8n-retired-official')), false);
  assert.match(installSummary(result), /removed 1 retired skill copy/);
  owner.remove();
  assert.ok(fs.existsSync(target), 'an empty or traversal name never removes the skills folder itself');
  assert.ok(fs.existsSync(path.join(target, 'mine')), 'a folder outside a skills folder is never removed');
});

test('n8n copies left in Antigravity by an earlier build are removed when Antigravity is not chosen', (t) => {
  const dir = home(t);
  new OfficialN8nSkills({ toolkitRoot: repoRoot, host: 'codex', homeDir: dir, antigravity: true }).install();
  const antigravity = path.join(dir, '.gemini', 'config', 'skills');
  assert.equal(fs.readdirSync(antigravity).length, 15);
  const result = new OfficialN8nSkills({ toolkitRoot: repoRoot, host: 'codex', homeDir: dir }).install();
  assert.equal(result.antigravityRemoved.length, 15);
  assert.deepEqual(result.pruned, []);
  assert.match(installSummary(result), /removed 15 n8n skill copies from Antigravity \(not chosen\)/);
  assert.doesNotMatch(installSummary(result), /retired/);
  assert.deepEqual(fs.readdirSync(antigravity), []);
  assert.equal(fs.readdirSync(path.join(dir, '.agents', 'skills')).length, 15);
});
