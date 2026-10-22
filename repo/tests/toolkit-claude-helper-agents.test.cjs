'use strict';
require('./toolkit-test-temp-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ClaudeHelperAgentRenderer, ClaudeHelperDefinitions, AgentDirectoryInstaller, MARKER, claudeUserAgentsDirectory, parseArgs } = require('../scripts/toolkit-claude-helper-agents.cjs');
const { ClaudeNamedHelperPolicy } = require('../scripts/toolkit-claude-helper-policy.cjs');
const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'controller-kernel', 'stack-registry-v3.json'), 'utf8'));
const REGISTRY_REL = 'repo/contracts/controller-kernel/stack-registry-v3.json';
const FILE = Object.freeze({ G0: 'toolkit-g0-helper.md', G1: 'toolkit-g1-helper.md' });
// A fixed clock keeps backup pruning deterministic: 21 October 2026 minus the 7-day retention.
const NOW = new Date('2026-10-21T00:00:00.000Z');
const now = () => new Date(NOW);
const denied = output => output?.hookSpecificOutput?.permissionDecision === 'deny';
const read = file => fs.readFileSync(file, 'utf8');

function tmp() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-helper-agents-')); return d; }

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-helper-agents-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A toolkit root holding a copy of the registry, and a Claude config directory: the user agents
// directory the definitions owner reads. Nothing here touches the real home or Claude config.
function userFixture(t) {
  const base = scratch(t);
  const repoRoot = path.join(base, 'toolkit');
  fs.mkdirSync(path.dirname(path.join(repoRoot, REGISTRY_REL)), { recursive: true });
  fs.copyFileSync(path.join(__dirname, '..', 'contracts', 'controller-kernel', 'stack-registry-v3.json'), path.join(repoRoot, REGISTRY_REL));
  const environment = { CLAUDE_CONFIG_DIR: path.join(base, 'claude') };
  const backupRoot = path.join(base, 'backups');
  const agents = path.join(base, 'claude', 'agents');
  const defs = (options = {}) => new ClaudeHelperDefinitions({ environment, repositoryRoot: repoRoot, backupRoot, now, ...options });
  return { base, repoRoot, environment, backupRoot, agents, defs };
}

// Writes the named roles' definitions as rendered from the fixture's registry copy.
function install(f, roles = ['G0', 'G1'], stack = 'owner-claude') {
  fs.mkdirSync(f.agents, { recursive: true });
  const renderer = ClaudeHelperAgentRenderer.fromRepository(stack, f.repoRoot);
  for (const role of roles) { const { file, text } = renderer.render(role); fs.writeFileSync(path.join(f.agents, file), text); }
}

function rendered(f, role, stack = 'owner-claude') { return ClaudeHelperAgentRenderer.fromRepository(stack, f.repoRoot).render(role).text; }

test('helper definitions take model and effort only from the selected registry stack', () => {
  const renderer = ClaudeHelperAgentRenderer.fromRepository('owner-claude');
  for (const [role, registryRole] of [['G0', 'DISCOVERY_HELPER'], ['G1', 'BUILDER_HELPER']]) {
    const { text } = renderer.render(role);
    const route = registry.profiles['owner-claude'].routes[registryRole];
    assert.match(text, new RegExp(`^model: claude-${route.model.replace('.', '-')}$`, 'm'));
    assert.match(text, new RegExp(`^effort: ${route.reasoning}$`, 'm'));
    assert.match(text, /disallowedTools: Agent, Task/);
    assert.ok(text.includes(MARKER));
    assert.doesNotMatch(text, /replacement21|commands 73-79|owner-mixed-claude-gpt/);
  }
  assert.match(renderer.render('G0').text, /^tools: Read, Glob, Grep$/m);
  assert.throws(() => ClaudeHelperAgentRenderer.fromRepository(''), e => e.code === 'HELPER_AGENTS_STACK_SELECTION_REQUIRED');
  // A GPT stack has no Claude-native helper route and is refused rather than substituted.
  assert.throws(() => ClaudeHelperAgentRenderer.fromRepository('owner-gpt').render('G1'), e => e.code === 'CLAUDE_NATIVE_ROUTE_UNSUPPORTED');
});

test('install creates, updates only managed files, retires known legacy files with a backup, and refuses unmanaged targets', () => {
  const dir = tmp(), backups = tmp();
  try {
    fs.writeFileSync(path.join(dir, 'toolkit-v3-g1-bounded.md'), 'legacy');
    fs.writeFileSync(path.join(dir, 'unrelated.md'), 'keep me');
    const files = ['G0', 'G1'].map(role => ClaudeHelperAgentRenderer.fromRepository('owner-claude').render(role));
    const first = new AgentDirectoryInstaller(dir, files).apply(backups);
    assert.deepEqual(first.actions.map(a => a.action).sort(), ['create', 'create', 'retire-legacy']);
    assert.equal(fs.readFileSync(path.join(first.backup_dir, 'toolkit-v3-g1-bounded.md'), 'utf8'), 'legacy');
    assert.equal(fs.existsSync(path.join(dir, 'toolkit-v3-g1-bounded.md')), false);
    assert.equal(fs.readFileSync(path.join(dir, 'unrelated.md'), 'utf8'), 'keep me');
    assert.deepEqual(new AgentDirectoryInstaller(dir, files).plan().map(a => a.action), ['unchanged', 'unchanged']);
    fs.writeFileSync(path.join(dir, 'toolkit-g1-helper.md'), 'hand-written, no marker');
    assert.throws(() => new AgentDirectoryInstaller(dir, files).apply(backups), e => e.code === 'HELPER_AGENTS_UNMANAGED_TARGET');
    assert.equal(fs.readFileSync(path.join(dir, 'toolkit-g1-helper.md'), 'utf8'), 'hand-written, no marker');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(backups, { recursive: true, force: true }); }
});

test('the user agents directory has one owner: CLAUDE_CONFIG_DIR, else ~/.claude, and the generator default follows it', () => {
  const config = path.join(os.tmpdir(), 'claude-config-probe');
  assert.equal(claudeUserAgentsDirectory({ CLAUDE_CONFIG_DIR: config }), path.join(config, 'agents'));
  assert.equal(claudeUserAgentsDirectory({}), path.join(os.homedir(), '.claude', 'agents'));
  assert.equal(parseArgs(['--stack', 'owner-claude'], { CLAUDE_CONFIG_DIR: config }).agentsDir, path.join(config, 'agents'));
  assert.equal(parseArgs(['--stack', 'owner-claude'], {}).agentsDir, path.join(os.homedir(), '.claude', 'agents'));
});

test('the rendered definition tells a person to run setup toolkit, with no repo-relative generator command', () => {
  const { text } = ClaudeHelperAgentRenderer.fromRepository('owner-claude').render('G0');
  assert.match(text, /Run `setup toolkit` to refresh this file\./);
  assert.doesNotMatch(text, /Regenerate|repo\/scripts/);
});

test('a registry change makes installed helpers stale; refresh backs them up and rewrites them, and the policy then allows the launch', t => {
  const f = userFixture(t);
  install(f);
  const defs = f.defs();
  assert.equal(defs.check().status, 'current');
  const before = { G0: read(path.join(f.agents, FILE.G0)), G1: read(path.join(f.agents, FILE.G1)) };
  const policy = new ClaudeNamedHelperPolicy({ toolkitRoot: f.repoRoot, environment: f.environment });
  // One more byte keeps the registry valid and changes its digest: registry A becomes A'.
  fs.appendFileSync(path.join(f.repoRoot, REGISTRY_REL), '\n');
  const stale = defs.check();
  assert.equal(stale.status, 'stale');
  assert.deepEqual(stale.files, [{ file: FILE.G0, state: 'update', stack: 'owner-claude' }, { file: FILE.G1, state: 'update', stack: 'owner-claude' }]);
  assert.ok(denied(policy.decide({ tool_input: { subagent_type: 'toolkit-g0-helper' } }, {})), 'refused before refresh');
  const refreshed = defs.refresh();
  assert.equal(refreshed.status, 'updated');
  assert.equal(refreshed.detail, '');
  assert.equal(read(path.join(refreshed.backup_dir, FILE.G0)), before.G0);
  assert.equal(read(path.join(refreshed.backup_dir, FILE.G1)), before.G1);
  assert.equal(read(path.join(f.agents, FILE.G0)), rendered(f, 'G0'));
  assert.equal(read(path.join(f.agents, FILE.G1)), rendered(f, 'G1'));
  assert.equal(defs.check().status, 'current');
  assert.deepEqual(policy.decide({ tool_input: { subagent_type: 'toolkit-g0-helper' } }, {}), {});
});

test('an empty user agents directory is not-installed, and refresh writes nothing', t => {
  const f = userFixture(t);
  const defs = f.defs();
  const checked = defs.check();
  assert.equal(checked.status, 'not-installed');
  assert.equal(checked.detail, '');
  assert.equal(checked.agents_dir, f.agents);
  assert.deepEqual(checked.files, [{ file: FILE.G0, state: 'missing', stack: null }, { file: FILE.G1, state: 'missing', stack: null }]);
  assert.deepEqual(defs.refresh(), { status: 'not-installed', backup_dir: null, files: checked.files, detail: '' });
  assert.equal(fs.existsSync(f.agents), false);
});

test('a missing user-level file is created from the stack the other installed file names', t => {
  const f = userFixture(t);
  install(f, ['G0']);
  const defs = f.defs();
  const g0Before = read(path.join(f.agents, FILE.G0));
  const checked = defs.check();
  assert.equal(checked.status, 'stale');
  assert.deepEqual(checked.files, [{ file: FILE.G0, state: 'unchanged', stack: 'owner-claude' }, { file: FILE.G1, state: 'missing', stack: 'owner-claude' }]);
  const refreshed = defs.refresh();
  assert.equal(refreshed.status, 'updated');
  assert.equal(refreshed.backup_dir, null, 'creating a file backs nothing up');
  assert.equal(read(path.join(f.agents, FILE.G1)), rendered(f, 'G1'));
  assert.equal(read(path.join(f.agents, FILE.G0)), g0Before);
  assert.equal(defs.check().status, 'current');
});

test('an unmanaged user-level file is never overwritten: check and refresh hold, and every byte stays', t => {
  const f = userFixture(t);
  install(f, ['G0']);
  fs.writeFileSync(path.join(f.agents, FILE.G1), 'hand-written, no marker');
  const g0Before = read(path.join(f.agents, FILE.G0));
  const defs = f.defs();
  const checked = defs.check();
  assert.equal(checked.status, 'held');
  assert.deepEqual(checked.files.map(({ file, state }) => [file, state]), [[FILE.G0, 'unchanged'], [FILE.G1, 'skip-unmanaged']]);
  assert.match(checked.detail, /^toolkit-g1-helper\.md in .+ was not written by Toolkit, so Toolkit will not replace it\. Rename or remove it, then run setup toolkit\.$/);
  assert.deepEqual(defs.refresh(), { status: 'held', backup_dir: null, files: checked.files, detail: checked.detail });
  assert.equal(read(path.join(f.agents, FILE.G1)), 'hand-written, no marker');
  assert.equal(read(path.join(f.agents, FILE.G0)), g0Before);
  assert.equal(fs.existsSync(f.backupRoot), false, 'nothing was backed up or written');
});

test('a managed file whose stack the registry cannot render holds the install, with the stack named in plain words', t => {
  const f = userFixture(t);
  install(f);
  const g0 = path.join(f.agents, FILE.G0);
  fs.writeFileSync(g0, read(g0).replace('explicitly selected stack `owner-claude`', 'explicitly selected stack `owner-unknown`'));
  const g0Before = read(g0);
  const defs = f.defs();
  const checked = defs.check();
  assert.equal(checked.status, 'held');
  assert.deepEqual(checked.files.map(({ state, stack }) => [state, stack]), [['unrenderable', 'owner-unknown'], ['unchanged', 'owner-claude']]);
  assert.equal(checked.detail, 'toolkit-g0-helper.md names stack owner-unknown, which the current stack registry cannot render.');
  assert.equal(defs.refresh().status, 'held');
  assert.equal(read(g0), g0Before);
});

test('a managed file that names no stack holds the install, because Toolkit cannot tell where it came from', t => {
  const f = userFixture(t);
  install(f);
  const g1 = path.join(f.agents, FILE.G1);
  fs.writeFileSync(g1, read(g1).replace('explicitly selected stack `owner-claude`', 'the selected stack'));
  const checked = f.defs().check();
  assert.equal(checked.status, 'held');
  assert.deepEqual(checked.files.map(({ state, stack }) => [state, stack]), [['unchanged', 'owner-claude'], ['unrenderable', null]]);
  assert.equal(checked.detail, 'toolkit-g1-helper.md is managed by Toolkit but names no stack, so Toolkit cannot tell which stack it came from. Rename or remove it, then run setup toolkit.');
});

test('a project copy that differs is reported and never written; refresh ignores project copies', t => {
  const f = userFixture(t);
  install(f);
  const project = path.join(f.base, 'project'), projectAgents = path.join(project, '.claude', 'agents');
  fs.mkdirSync(projectAgents, { recursive: true });
  const drifted = path.join(projectAgents, FILE.G0), matching = path.join(projectAgents, FILE.G1);
  fs.writeFileSync(drifted, read(path.join(f.agents, FILE.G0)).replace('maxTurns: 50', 'maxTurns: 99'));
  fs.writeFileSync(matching, read(path.join(f.agents, FILE.G1)));
  const driftedBefore = read(drifted);
  const defs = f.defs();
  const checked = defs.check({ projectDirectories: [projectAgents] });
  assert.deepEqual(checked.project_overrides, [{ file: drifted, state: 'mismatch' }, { file: matching, state: 'unchanged' }]);
  assert.equal(checked.status, 'held');
  assert.equal(checked.detail, `the project copy ${drifted} does not match the selected stack. Toolkit does not change project files; update or remove it.`);
  assert.deepEqual(defs.check().project_overrides, []);
  assert.equal(defs.check().status, 'current');
  assert.equal(defs.refresh().status, 'current', 'refresh reads user-level files only');
  assert.equal(read(drifted), driftedBefore);
});

test('a retired legacy helper file makes the install stale; refresh retires it with a backup', t => {
  const f = userFixture(t);
  install(f);
  fs.writeFileSync(path.join(f.agents, 'toolkit-v3-g1-bounded.md'), 'legacy');
  const defs = f.defs();
  assert.equal(defs.check().status, 'stale');
  const refreshed = defs.refresh();
  assert.equal(refreshed.status, 'updated');
  assert.equal(read(path.join(refreshed.backup_dir, 'toolkit-v3-g1-bounded.md')), 'legacy');
  assert.equal(fs.existsSync(path.join(f.agents, 'toolkit-v3-g1-bounded.md')), false);
  assert.equal(defs.check().status, 'current');
});

test('a folder holding only retired helper files is stale; refresh backs them up, removes them and installs nothing', t => {
  const f = userFixture(t);
  fs.mkdirSync(f.agents, { recursive: true });
  fs.writeFileSync(path.join(f.agents, 'toolkit-v3-g0-evidence.md'), 'legacy g0');
  fs.writeFileSync(path.join(f.agents, 'toolkit-v3-g1-bounded.md'), 'legacy g1');
  const defs = f.defs();
  const checked = defs.check();
  assert.equal(checked.status, 'stale');
  assert.match(checked.detail, /Retired Toolkit helper definitions remain/);
  const refreshed = defs.refresh();
  assert.equal(refreshed.status, 'updated');
  assert.equal(read(path.join(refreshed.backup_dir, 'toolkit-v3-g0-evidence.md')), 'legacy g0');
  assert.equal(read(path.join(refreshed.backup_dir, 'toolkit-v3-g1-bounded.md')), 'legacy g1');
  assert.deepEqual(fs.readdirSync(f.agents), []);
  assert.equal(defs.check().status, 'not-installed');
});

test('helper definitions are written through a temporary file and leave none behind', t => {
  const f = userFixture(t);
  install(f);
  const registry = path.join(f.repoRoot, REGISTRY_REL);
  fs.writeFileSync(registry, `${JSON.stringify(JSON.parse(read(registry)))}\n`);
  const writes = [];
  const original = fs.writeFileSync;
  fs.writeFileSync = function trace(file, ...rest) { writes.push(String(file)); return original.call(this, file, ...rest); };
  try { assert.equal(f.defs().refresh().status, 'updated'); }
  finally { fs.writeFileSync = original; }
  const into = writes.filter(file => path.dirname(file) === f.agents);
  assert.ok(into.length >= 2);
  assert.ok(into.every(file => file.endsWith('.tmp')), 'no definition is written in place');
  assert.deepEqual(fs.readdirSync(f.agents).sort(), Object.values(FILE).sort());
});

test('backup pruning removes only old timestamp-named backup folders', t => {
  const f = userFixture(t);
  install(f);
  fs.mkdirSync(f.backupRoot, { recursive: true });
  // Retention is 7 days before NOW, so 14 October 2026 00:00 UTC is the cutoff itself and is kept.
  const old = '2026-10-13T12-00-00-000Z';
  const kept = ['2026-10-14T00-00-00-000Z', '2026-10-18T09-30-00-000Z', 'manual-notes', '2026-10-01T00.00.00.000Z'];
  fs.mkdirSync(path.join(f.backupRoot, old));
  fs.writeFileSync(path.join(f.backupRoot, old, FILE.G0), 'old backup');
  for (const name of kept) fs.mkdirSync(path.join(f.backupRoot, name));
  fs.writeFileSync(path.join(f.backupRoot, '2026-10-01T00-00-00-000Z'), 'a file, not a folder');
  const refreshed = f.defs().refresh();
  assert.equal(refreshed.status, 'current');
  assert.deepEqual(fs.readdirSync(f.backupRoot).sort(), [...kept, '2026-10-01T00-00-00-000Z'].sort());
});
