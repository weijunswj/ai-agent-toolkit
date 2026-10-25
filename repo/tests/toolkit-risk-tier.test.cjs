'use strict';

// The risk tier comes from the changed paths, not a model's guess: these tests pin the matching
// rules, this repository's own RISKY list against the owner's categories, and the git reading.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { DEFAULT_CONFIG, GitChange, classify, globToRegExp, loadConfig, parseArgs } = require('../scripts/toolkit-risk-tier.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const { config: TOOLKIT } = loadConfig(ROOT);
const tierOf = (rel, changedLines = null, config = TOOLKIT) => classify([{ path: rel, changedLines }], config).tier;

test('globs follow gitignore style', () => {
  for (const [glob, rel, hit] of [
    ['repo/scripts/setup-*.cjs', 'repo/scripts/setup-toolkit.cjs', true],
    ['repo/scripts/setup-*.cjs', 'repo/scripts/sub/setup-toolkit.cjs', false],
    ['skills/**', 'skills/a/b/SKILL.md', true],
    ['**/*.md', 'README.md', true],
    ['**/*.md', 'repo/docs/x.md', true],
    ['*.md', 'repo/docs/x.md', true],
    ['AGENTS.md', 'skills/x/AGENTS.md', true],
    ['repo/CONTROLLER.md', 'repo/CONTROLLER.md.bak', false],
    ['LICENSE*', 'LICENSE', true],
  ]) assert.equal(globToRegExp(glob).test(rel), hit, `${glob} vs ${rel}`);
});

test('the owner\'s RISKY categories are RISKY in this repository', () => {
  for (const rel of [
    'repo/scripts/toolkit-governance-hook.cjs', 'repo/scripts/toolkit-codex-helper-hook.ps1', 'repo/scripts/toolkit-claude-helper-policy.cjs',
    'repo/scripts/setup-toolkit.cjs', 'repo/scripts/toolkit-local-bridge.cjs', 'repo/scripts/toolkit-global-rules.cjs',
    'repo/scripts/codex-delegation-config.cjs', 'repo/contracts/agent-rules/global-rules.md', 'repo/contracts/agent-rules/gate-rules.md',
    'repo/contracts/agent-rules/toolkit-governed-rules.md', 'repo/CONTROLLER.md', 'AGENTS.md', 'repo/scripts/toolkit-env.cjs',
    'repo/scripts/toolkit-env-store.cjs', 'repo/scripts/repo-local-backup.cjs', 'repo/scripts/toolkit-governance-ruleset.cjs',
    'repo/scripts/toolkit-attribution-guard.cjs', 'repo/contracts/claude-projects/web-controller-projects/SKILL.md',
    '.github/workflows/validate.yml', '.github/toolkit-risk-tiers.json', 'repo/scripts/toolkit-risk-tier.cjs',
    // Authority, custody and home-folder writers: the governance decision store, helper profiles, task sessions and routes.
    'repo/scripts/toolkit-capability-registry.cjs', 'repo/contracts/repository-capability-registry/repository-capability-policy.json',
    'repo/scripts/toolkit-agent-control.cjs', 'repo/scripts/toolkit-claude-task-session.cjs', 'repo/scripts/toolkit-stack-selection.cjs',
    'repo/scripts/toolkit-gate-contract-compiler.cjs', 'repo/scripts/toolkit-control-plane/control-plane-kernel.cjs',
    'repo/contracts/trusted-ci-repository-protection/templates/protected-ci-gate.workflow.yml', 'repo/scripts/codex-config-load-check.cjs',
    'skills/codex-ssh-hostinger-coolify-setup-maintainer/scripts/install-daily-security-check-systemd.sh',
    'skills/secure-ci-cd/scripts/install-personal-data-guard.cjs', 'skills/github-program-reconciler/scripts/programme-checkpoint.cjs',
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} exists`);
    assert.equal(tierOf(rel), 'RISKY', rel);
  }
});

test('tests and other scripts are NORMAL, docs are LIGHT, skills are NORMAL', () => {
  assert.equal(tierOf('repo/tests/toolkit-risk-tier.test.cjs'), 'NORMAL');
  assert.equal(tierOf('repo/tests/qualification/claude-helper-matrix.live.cjs'), 'NORMAL');
  assert.equal(tierOf('skills/github-program-reconciler/scripts/decision-history.cjs'), 'NORMAL');
  assert.equal(tierOf('skills/github-program-reconciler/scripts/programme-state.cjs'), 'RISKY', 'programme state is authority');
  assert.equal(tierOf('skills/secure-ci-cd/SKILL.md'), 'NORMAL');
  assert.equal(tierOf('repo/docs/agent-playbooks/INDEX.md'), 'NORMAL');
  for (const rel of ['README.md', 'repo/docs/CHANGELOG.md', 'repo/ARCHITECTURE.md', 'repo/docs/HOW-TO-USE.md']) assert.equal(tierOf(rel), 'LIGHT', rel);
});

test('every RISKY pattern in this repository matches a tracked file, so the list cannot go stale unnoticed', () => {
  const tracked = spawnSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const stale = TOOLKIT.risky.filter(glob => !tracked.some(rel => globToRegExp(glob).test(rel)));
  assert.deepEqual(stale, []);
});

test('a version-only edit is LIGHT even on a RISKY path; any other line keeps the path tier', () => {
  assert.equal(tierOf('repo/scripts/toolkit-local-bridge.cjs', ["const VERSION = '3.10.0';", "const VERSION = '3.11.0';"]), 'LIGHT');
  assert.equal(tierOf('.claude-plugin/plugin.json', ['  "version": "3.10.0",', '  "version": "3.11.0",']), 'LIGHT');
  assert.equal(tierOf('repo/scripts/toolkit-local-bridge.cjs', ["const VERSION = '3.11.0';", 'process.exit(0);']), 'RISKY');
  assert.equal(tierOf('AGENTS.md', ['<!-- AI-AGENT-TOOLKIT:a.md:BEGIN X v2 toolkit=3.10.0 sha256=0123456789ab -->',
    '<!-- AI-AGENT-TOOLKIT:a.md:BEGIN X v2 toolkit=3.11.0 sha256=0123456789ab -->']), 'LIGHT', 'a managed-block marker bump');
  assert.equal(tierOf('AGENTS.md', ['<!-- AI-AGENT-TOOLKIT:a.md:BEGIN X v2 toolkit=3.11.0 sha256=0123456789ab -->', '- a new rule']), 'RISKY');
  assert.equal(tierOf('repo/scripts/toolkit-local-bridge.cjs', []), 'RISKY', 'a mode-only change is not a version bump');
});

test('a version-like line that can change behaviour, or sits in the wrong kind of file, keeps the path tier', () => {
  for (const [rel, lines] of [
    ['repo/scripts/toolkit-governance-gate.cjs', ["const MIN_VERSION = '1.0.0';", "const MIN_VERSION = '9.9.9';"]],
    ['repo/scripts/toolkit-local-bridge.cjs', ["const BRIDGE_VERSION = '3.10.0';", "const BRIDGE_VERSION = '3.11.0';"]],
    ['.claude-plugin/plugin.json', ['  "minVersion": "1.0.0",', '  "minVersion": "2.0.0",']],
    ['repo/CONTROLLER.md', ["const MIN_VERSION = '1.0.0';", "const MIN_VERSION = '9.9.9';"]],
    ['repo/CONTROLLER.md', ['  "version": "3.10.0",', '  "version": "3.11.0",']],
    ['repo/CONTROLLER.md', ["version = '3.10.0'", "version = '3.11.0'"]],
  ]) assert.equal(tierOf(rel, lines), 'RISKY', `${rel}: ${lines[1]}`);
  assert.equal(tierOf('pkg/__init__.py', ["__version__ = '1.0.0'", "__version__ = '1.1.0'"], DEFAULT_CONFIG), 'LIGHT');
});

test('RISKY patterns ignore letter case, so a hand-typed Windows path cannot drop the tier', () => {
  for (const rel of ['REPO/controller.MD', 'Repo/Scripts/Setup-Toolkit.cjs', 'agents.md', 'docs/claude.md', 'skills/foo/agents.md', '.Agents/Rules/x.md', 'repo/scripts/TOOLKIT-GOVERNANCE-HOOK.cjs']) {
    assert.equal(tierOf(rel), 'RISKY', rel);
  }
  assert.equal(tierOf(parseArgs(['--', 'Repo\\Scripts\\Setup-Toolkit.cjs']).paths[0]), 'RISKY');
  assert.equal(tierOf('Scripts/Install.sh', null, DEFAULT_CONFIG), 'RISKY');
  assert.equal(globToRegExp('repo/CONTROLLER.md').test('repo/controller.md'), false, 'matching stays exact unless asked');
});

test('a mixed change takes its highest tier, and no change is LIGHT', () => {
  const mixed = classify([{ path: 'README.md', changedLines: null }, { path: 'repo/tests/a.test.cjs', changedLines: null }], TOOLKIT);
  assert.equal(mixed.tier, 'NORMAL');
  assert.equal(classify([...mixed.files.map(f => ({ path: f.path, changedLines: null })), { path: 'repo/CONTROLLER.md', changedLines: null }], TOOLKIT).tier, 'RISKY');
  assert.equal(classify([], TOOLKIT).tier, 'LIGHT');
});

test('a repository without a list gets the generic defaults, and a broken list is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risk-tier-'));
  try {
    assert.equal(loadConfig(dir).config, DEFAULT_CONFIG);
    assert.equal(tierOf('scripts/install.sh', null, DEFAULT_CONFIG), 'RISKY');
    assert.equal(tierOf('.github/workflows/ci.yml', null, DEFAULT_CONFIG), 'RISKY');
    assert.equal(tierOf('src/app.ts', null, DEFAULT_CONFIG), 'NORMAL');
    assert.equal(tierOf('docs/guide.md', null, DEFAULT_CONFIG), 'LIGHT');
    assert.equal(tierOf('AGENTS.md', null, DEFAULT_CONFIG), 'RISKY');
    fs.mkdirSync(path.join(dir, '.github'));
    fs.writeFileSync(path.join(dir, '.github', 'toolkit-risk-tiers.json'), JSON.stringify({ schema: 'other', risky: [], normal: [], light: [] }));
    assert.throws(() => loadConfig(dir), /must have schema toolkit-risk-tiers\/v1/);
    fs.writeFileSync(path.join(dir, '.github', 'toolkit-risk-tiers.json'), JSON.stringify({ schema: 'toolkit-risk-tiers/v1', risky: [''], normal: [], light: [] }));
    assert.throws(() => loadConfig(dir), /"risky" must be a list of path patterns/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the git reader sees committed, uncommitted and untracked changes since the merge base', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risk-tier-git-'));
  const git = (...args) => {
    const result = spawnSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    git('init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(dir, 'README.md'), 'one\n');
    fs.writeFileSync(path.join(dir, 'package.json'), '{\n  "version": "1.0.0"\n}\n');
    git('add', '.'); git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'work');
    fs.writeFileSync(path.join(dir, 'package.json'), '{\n  "version": "1.1.0"\n}\n');
    git('commit', '-q', '-am', 'bump');
    fs.writeFileSync(path.join(dir, 'README.md'), 'two\n');
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.writeFileSync(path.join(dir, 'scripts', 'install.sh'), 'echo hi\n');
    const files = new GitChange(dir).files('main');
    assert.deepEqual(files.map(f => f.path), ['README.md', 'package.json', 'scripts/install.sh']);
    const result = classify(files, DEFAULT_CONFIG);
    assert.deepEqual(result.files.map(f => f.tier), ['LIGHT', 'LIGHT', 'RISKY']);
    assert.equal(result.tier, 'RISKY');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('arguments', () => {
  assert.deepEqual(parseArgs(['--json', '--', '.\\a\\b.md']).paths, ['a/b.md']);
  assert.throws(() => parseArgs(['--bogus']), /Unknown argument/);
});
