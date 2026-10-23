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

test('the 15 official skill folders reach this app, and Antigravity only when it is installed', (t) => {
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
  assert.deepEqual(owner.targets(), [path.join(dir, '.claude', 'skills'), path.join(dir, '.gemini', 'config', 'skills')]);
  assert.equal(owner.install().copied.length, 15);
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

test('after a good copy, setup turns off the n8n Skills plugin in Claude Code and only says how in Codex', () => {
  const { installOfficialN8nSkills } = require('../scripts/setup-toolkit-core.cjs');
  const owner = { install: () => ({ copied: [], current: [{ app: 'Claude Code', folder: 'x', skills: 15 }], handCopies: [] }) };
  const asked = [];
  const off = (result) => (id) => { asked.push(id); if (result instanceof Error) throw result; return result; };
  assert.match(installOfficialN8nSkills({ host: 'claude-code' }, owner, off(true)), /Turned off the n8n Skills plugin so the skills do not load twice\.$/);
  assert.deepEqual(asked, ['n8n-skills@n8n-io']);
  assert.doesNotMatch(installOfficialN8nSkills({ host: 'claude-code' }, owner, off(false)), /n8n Skills plugin/);
  assert.match(installOfficialN8nSkills({ host: 'claude-code' }, owner, off(new Error('boom'))), /Could not turn off the n8n Skills plugin \(boom\); run `claude plugin disable n8n-skills@n8n-io`/);
  asked.length = 0;
  assert.match(installOfficialN8nSkills({ host: 'codex' }, owner, off(true)), /turn it off in the Codex app's plugin settings/);
  const failed = { install: () => { throw new Error('copy failed'); } };
  assert.equal(installOfficialN8nSkills({ host: 'claude-code' }, failed, off(true)), 'not copied (copy failed).');
  assert.deepEqual(asked, [], 'no copy, or Codex: the plugin is not touched');
});

test('the Claude Code switch-off acts on the user scope only and reads the list back', (t) => {
  const { disableUserPlugin } = require('../scripts/setup-claude-toolkit-plugin.cjs');
  const dir = home(t);
  const state = path.join(dir, 'plugins.json');
  const fake = path.join(dir, 'fake-claude.cjs');
  fs.writeFileSync(fake, `const fs = require('fs'); const state = ${JSON.stringify(state)}; const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('2.1.300 (Claude Code)'); process.exit(0); }
const list = JSON.parse(fs.readFileSync(state, 'utf8'));
if (a[0] === 'plugin' && a[1] === 'list') { console.log(JSON.stringify(list)); process.exit(0); }
if (a[0] === 'plugin' && a[1] === 'disable') { for (const e of list) if (e.id === a[2] && e.scope === a[4]) e.enabled = false; fs.writeFileSync(state, JSON.stringify(list)); process.exit(0); }
process.exit(2);`);
  const write = (list) => fs.writeFileSync(state, JSON.stringify(list));
  write([{ id: 'n8n-skills@n8n-io', scope: 'user', enabled: true }, { id: 'n8n-skills@n8n-io', scope: 'project', enabled: true }]);
  assert.equal(disableUserPlugin('n8n-skills@n8n-io', { claudeCli: fake }), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(state, 'utf8')).map((e) => e.enabled), [false, true]);
  assert.equal(disableUserPlugin('n8n-skills@n8n-io', { claudeCli: fake }), false);
  write([]);
  assert.equal(disableUserPlugin('n8n-skills@n8n-io', { claudeCli: fake }), false);
});
