'use strict';
require('./toolkit-test-temp-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CodexHelperAgentRenderer, CodexHelperDefinitions, CodexAgentDirectoryInstaller, MARKER, codexUserAgentsDirectory,
  matchesRenderedDefinition, parseArgs } = require('../scripts/toolkit-codex-helper-agents.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'repo', 'scripts', 'toolkit-codex-helper-agents.cjs');
const REGISTRY_REL = 'repo/contracts/controller-kernel/stack-registry-v3.json';
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, REGISTRY_REL), 'utf8'));
const FILE = Object.freeze({ G0: 'toolkit-g0-helper.toml', G1: 'toolkit-g1-helper.toml' });
// The only keys the official Codex subagents page documents for this writer's purpose.
const DOCUMENTED_KEYS = ['description', 'developer_instructions', 'model', 'model_reasoning_effort', 'name'];
const read = file => fs.readFileSync(file, 'utf8');

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-helper-agents-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A toolkit root holding a copy of the registry and an isolated CODEX_HOME. Nothing here touches
// the real home or Codex configuration.
function fixture(t) {
  const base = scratch(t);
  const repoRoot = path.join(base, 'toolkit');
  fs.mkdirSync(path.dirname(path.join(repoRoot, REGISTRY_REL)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, REGISTRY_REL), path.join(repoRoot, REGISTRY_REL));
  const environment = { CODEX_HOME: path.join(base, 'codex') };
  const backupRoot = path.join(base, 'backups');
  const agents = path.join(base, 'codex', 'agents');
  const defs = (options = {}) => new CodexHelperDefinitions({ environment, repositoryRoot: repoRoot, backupRoot, ...options });
  const editRegistry = change => {
    const file = path.join(repoRoot, REGISTRY_REL), value = JSON.parse(read(file));
    change(value);
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  };
  return { base, repoRoot, environment, backupRoot, agents, defs, editRegistry };
}

// Top-level keys of the rendered file: `key = value` lines outside the literal instructions block.
function topLevelKeys(text) {
  const head = text.slice(0, text.indexOf("'''"));
  return head.split('\n').filter(line => line && !line.startsWith('#')).map(line => line.split(' = ')[0]).sort();
}

test('renders one Codex custom agent per role with only the documented keys and the pinned route', () => {
  const renderer = CodexHelperAgentRenderer.fromRepository('owner-gpt');
  for (const [role, registryRole] of [['G0', 'DISCOVERY_HELPER'], ['G1', 'BUILDER_HELPER']]) {
    const { file, text } = renderer.render(role);
    const route = registry.profiles['owner-gpt'].routes[registryRole];
    assert.equal(file, FILE[role]);
    assert.ok(text.startsWith(`${MARKER}\n`), 'marker first');
    assert.deepEqual(topLevelKeys(text), DOCUMENTED_KEYS);
    assert.match(text, new RegExp(`^name = "toolkit-${role.toLowerCase()}-helper"$`, 'm'));
    assert.match(text, new RegExp(`^model = "${route.model}"$`, 'm'));
    assert.match(text, new RegExp(`^model_reasoning_effort = "${route.reasoning}"$`, 'm'));
    // Provider, sandbox and approval always come from the parent on Codex; the file must not claim them.
    assert.doesNotMatch(text, /^(?:model_provider|sandbox_mode|approval_policy|mcp_servers)\b/m);
    assert.match(text, /Never launch, delegate to or request another agent/);
    assert.ok(text.endsWith("'''\n"), 'closes the literal instructions block');
  }
});

test('refuses a stack whose helper route is not an OpenAI route', () => {
  assert.throws(() => CodexHelperAgentRenderer.fromRepository('owner-claude').render('G0'), { code: 'CODEX_NATIVE_ROUTE_UNSUPPORTED' });
  assert.throws(() => CodexHelperAgentRenderer.fromRepository(''), { code: 'HELPER_AGENTS_STACK_SELECTION_REQUIRED' });
});

test('installs into CODEX_HOME/agents, reads back, reports the load check as not verified without Codex, then stays current', t => {
  const f = fixture(t);
  assert.equal(codexUserAgentsDirectory(f.environment), f.agents);
  assert.equal(f.defs().check().status, 'not-installed');
  assert.equal(f.defs().refresh().status, 'not-installed', 'no stack, nothing to install');
  const result = f.defs().refresh({ stack: 'owner-gpt' });
  assert.equal(result.status, 'installed');
  assert.equal(result.backup_dir, null, 'nothing was replaced');
  assert.equal(result.load_check.status, 'unverified');
  assert.match(result.detail, /not verified/);
  for (const role of ['G0', 'G1']) assert.equal(read(path.join(f.agents, FILE[role])), CodexHelperAgentRenderer.fromRepository('owner-gpt', f.repoRoot).render(role).text);
  assert.deepEqual(f.defs().check(), { status: 'current', agents_dir: f.agents, detail: '', project_overrides: [],
    files: [{ file: FILE.G0, state: 'unchanged', stack: 'owner-gpt' }, { file: FILE.G1, state: 'unchanged', stack: 'owner-gpt' }] });
  assert.equal(f.defs().refresh().status, 'current');
});

test('a registry change makes the helpers stale; refresh backs up the exact old bytes and rewrites them', t => {
  const f = fixture(t);
  f.defs().refresh({ stack: 'owner-gpt' });
  const before = read(path.join(f.agents, FILE.G1));
  f.editRegistry(value => { value.profiles['owner-gpt'].routes.BUILDER_HELPER.reasoning = 'high'; });
  const check = f.defs().check();
  assert.equal(check.status, 'stale');
  assert.equal(check.files.find(file => file.file === FILE.G1).state, 'update');
  const result = f.defs().refresh();
  assert.equal(result.status, 'updated');
  assert.equal(read(path.join(result.backup_dir, FILE.G1)), before);
  assert.match(read(path.join(f.agents, FILE.G1)), /^model_reasoning_effort = "high"$/m);
  assert.equal(f.defs().check().status, 'current');
});

test('a missing helper is restored from the stack its sibling names', t => {
  const f = fixture(t);
  f.defs().refresh({ stack: 'owner-gpt' });
  fs.rmSync(path.join(f.agents, FILE.G0));
  assert.equal(f.defs().check().status, 'stale');
  assert.equal(f.defs().refresh().status, 'updated');
  assert.equal(f.defs().check().status, 'current');
});

test('a file Toolkit did not write is held, never replaced', t => {
  const f = fixture(t);
  fs.mkdirSync(f.agents, { recursive: true });
  const own = 'name = "toolkit-g0-helper"\ndescription = "mine"\ndeveloper_instructions = "mine"\n';
  fs.writeFileSync(path.join(f.agents, FILE.G0), own);
  const check = f.defs().check();
  assert.equal(check.status, 'held');
  assert.match(check.detail, /was not written by Toolkit/);
  assert.equal(f.defs().refresh({ stack: 'owner-gpt' }).status, 'held');
  assert.equal(read(path.join(f.agents, FILE.G0)), own);
  const files = ['G0', 'G1'].map(role => CodexHelperAgentRenderer.fromRepository('owner-gpt', f.repoRoot).render(role));
  assert.throws(() => new CodexAgentDirectoryInstaller(f.agents, files).apply(f.backupRoot), { code: 'HELPER_AGENTS_UNMANAGED_TARGET' });
  assert.equal(read(path.join(f.agents, FILE.G0)), own);
  assert.equal(fs.existsSync(path.join(f.agents, FILE.G1)), false);
});

test('a managed file naming a stack the registry no longer has is held with a plain reason', t => {
  const f = fixture(t);
  f.defs().refresh({ stack: 'owner-gpt' });
  const file = path.join(f.agents, FILE.G0);
  fs.writeFileSync(file, read(file).replace('# Stack `owner-gpt`', '# Stack `retired-stack`'));
  const check = f.defs().check();
  assert.equal(check.status, 'held');
  assert.match(check.detail, /names stack retired-stack, which the current stack registry cannot render for Codex/);
});

test('a Codex load rejection restores the previous bytes and removes files that did not exist', t => {
  const f = fixture(t);
  const rejected = () => ({ status: 'rejected', detail: 'unknown variant `max`' });
  assert.throws(() => f.defs({ probe: rejected }).refresh({ stack: 'owner-gpt' }), error => {
    assert.equal(error.code, 'CODEX_HELPER_AGENTS_LOAD_FAILED');
    assert.equal(error.restored, true);
    assert.match(error.message, /unknown variant `max`.*previous files were restored/);
    return true;
  });
  for (const role of ['G0', 'G1']) assert.equal(fs.existsSync(path.join(f.agents, FILE[role])), false, 'created files removed');

  f.defs().refresh({ stack: 'owner-gpt' });
  const before = { G0: read(path.join(f.agents, FILE.G0)), G1: read(path.join(f.agents, FILE.G1)) };
  f.editRegistry(value => { value.profiles['owner-gpt'].routes.DISCOVERY_HELPER.reasoning = 'high'; });
  assert.throws(() => f.defs({ probe: rejected }).refresh(), { code: 'CODEX_HELPER_AGENTS_LOAD_FAILED' });
  for (const role of ['G0', 'G1']) assert.equal(read(path.join(f.agents, FILE[role])), before[role], 'previous bytes restored');
});

test('a verified load check is reported as verified, and the probe receives the agents directory', t => {
  const f = fixture(t);
  const seen = [];
  const result = f.defs({ probe: dir => { seen.push(dir); return { status: 'verified', detail: 'loaded' }; } }).refresh({ stack: 'owner-gpt' });
  assert.deepEqual(seen, [path.resolve(f.agents)]);
  assert.deepEqual(result.load_check, { status: 'verified', detail: 'loaded' });
  assert.equal(result.detail, '');
});

test('a project copy that differs from the rendering holds the check, because Codex may load it instead', t => {
  const f = fixture(t);
  f.defs().refresh({ stack: 'owner-gpt' });
  const project = path.join(f.base, 'project', '.codex', 'agents');
  fs.mkdirSync(project, { recursive: true });
  fs.copyFileSync(path.join(f.agents, FILE.G0), path.join(project, FILE.G0));
  assert.deepEqual(f.defs().check({ projectDirectories: [project] }).project_overrides, [{ file: path.join(project, FILE.G0), state: 'unchanged' }]);
  fs.appendFileSync(path.join(project, FILE.G0), 'model = "gpt-6-astra"\n');
  const check = f.defs().check({ projectDirectories: [project] });
  assert.equal(check.status, 'held');
  assert.match(check.detail, /project copy .* does not match the selected stack/);
});

test('matchesRenderedDefinition accepts only the exact rendering for the stack the file names', () => {
  const { text } = CodexHelperAgentRenderer.fromRepository('owner-gpt').render('G1');
  assert.deepEqual(matchesRenderedDefinition('G1', text), { matches: true, stack: 'owner-gpt' });
  assert.equal(matchesRenderedDefinition('G0', text).matches, false);
  assert.equal(matchesRenderedDefinition('G1', text.replace('"max"', '"high"')).matches, false);
  assert.deepEqual(matchesRenderedDefinition('G1', 'name = "toolkit-g1-helper"\n'), { matches: false, stack: null });
});

test('the command line needs an explicit stack and writes nothing without --write', t => {
  assert.throws(() => parseArgs([]), { code: 'HELPER_AGENTS_STACK_SELECTION_REQUIRED' });
  assert.throws(() => parseArgs(['--stack', 'owner-gpt', '--force']), { code: 'HELPER_AGENTS_ARGUMENT_UNKNOWN' });
  const base = scratch(t), agents = path.join(base, 'agents');
  const dry = spawnSync(process.execPath, [SCRIPT, '--stack', 'owner-gpt', '--agents-dir', agents], { encoding: 'utf8', timeout: 20000 });
  assert.equal(dry.status, 0, dry.stderr);
  assert.equal(JSON.parse(dry.stdout).dry_run, true);
  assert.equal(fs.existsSync(agents), false);
  const written = spawnSync(process.execPath, [SCRIPT, '--stack', 'owner-gpt', '--agents-dir', agents, '--backup-root', path.join(base, 'b'), '--write'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(written.status, 0, written.stderr);
  assert.deepEqual(fs.readdirSync(agents).sort(), [FILE.G0, FILE.G1]);
});
