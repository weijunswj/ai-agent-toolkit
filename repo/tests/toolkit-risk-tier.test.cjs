'use strict';

// The risk tier comes from the changed paths, not a model's guess: these tests pin the matching
// rules, this repository's own RISKY list against the owner's categories, and the git reading.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { DEFAULT_CONFIG, GitChange, classify, globToRegExp, loadConfig, normalizePath, parseArgs } = require('../scripts/toolkit-risk-tier.cjs');

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
    'repo/scripts/toolkit-gate-contract-compiler.cjs', 'repo/scripts/codex-config-load-check.cjs',
    'skills/codex-ssh-hostinger-coolify-setup-maintainer/scripts/install-daily-security-check-systemd.sh',
    'skills/secure-ci-cd/scripts/install-personal-data-guard.cjs', 'skills/github-program-reconciler/scripts/programme-checkpoint.cjs',
    // What those load or run: an unattended root script, executable and path resolution, the Codex server, versions and task templates.
    'skills/codex-ssh-hostinger-coolify-setup-maintainer/scripts/daily-security-check.sh', 'repo/scripts/claude-process-launch.cjs',
    'repo/scripts/toolkit-canonical-path.cjs', 'repo/scripts/codex-app-server.cjs', 'repo/scripts/toolkit-projects-tasks.cjs',
    'repo/scripts/toolkit-version.cjs', 'skills/github-program-reconciler/scripts/resolve-executable.cjs',
    'skills/github-program-reconciler/scripts/decision-tags.cjs', 'repo/scripts/update-source-watch-review-branch.sh',
    // What setup and the bridge run after an update, what a workflow with a write token runs, and what an installer copies out.
    'repo/scripts/validate-toolkit.cjs', 'repo/scripts/sync-repo-doc-contract.cjs', 'repo/scripts/check-plain-references.cjs',
    'repo/tests/toolkit-local-bridge-hook-light.test.cjs', 'repo/tests/toolkit-local-bridge.test.cjs', 'repo/tests/toolkit-test-temp-guard.cjs',
    'repo/scripts/check-project-source-updates.cjs', 'repo/scripts/plan-source-watch-pr-lifecycle.cjs', 'repo/scripts/source-watch-advisory-targets.cjs',
    'skills/secure-ci-cd/templates/github-actions/personal-data-guard.yml', 'skills/skill-product-review/templates/ci/generated-surface-check.template.yml',
    'repo/scripts/run-tests.cjs', 'repo/docs/published-surface-audit-baseline.json',
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
  for (const glob of TOOLKIT.risky.filter(entry => entry.startsWith('!'))) assert.equal(tierOf(glob.slice(1)), 'NORMAL', glob);
  assert.equal(tierOf('repo/scripts/a-new-tool.cjs'), 'RISKY', 'a new script is RISKY until it is shown not to be');
  assert.equal(tierOf('skills/any-skill/scripts/new.py'), 'RISKY');
  assert.equal(tierOf('skills/secure-ci-cd/SKILL.md'), 'NORMAL');
  assert.equal(tierOf('repo/docs/agent-playbooks/INDEX.md'), 'NORMAL');
  for (const rel of ['README.md', 'repo/docs/CHANGELOG.md', 'repo/ARCHITECTURE.md', 'repo/docs/HOW-TO-USE.md']) assert.equal(tierOf(rel), 'LIGHT', rel);
});

// Every way a RISKY file reaches another file by a path written in it: require, path.join,
// path.resolve, path.posix.join or a destructured join with literal parts, and any other repository
// path written as a whole word in code, a plugin or settings hook command, a shell script (from its
// own folder, or one a line cds into), PowerShell from $PSScriptRoot, or a workflow that holds a
// write permission or a secret, or has no permissions key (comments and generated headers skipped).
// Only code, JSON, YAML and templates count as reached; a doc a script reads to check it does not.
// A path built only at run time, a folder a script lists, or a command named inside a data file is
// not followed: that is why script folders default to RISKY.
function riskyReach(tracked) {
  const known = new Set(tracked);
  const code = /\.(?:c?js|mjs|ps1|sh|py)$/i;
  const data = /\.(?:json|ya?ml)$/i;
  const counts = rel => code.test(rel) || data.test(rel) || rel.includes('/templates/');
  const resolve = base => [base, `${base}.cjs`, `${base}.js`, `${base}/index.cjs`, `${base}/index.js`].find(candidate => known.has(candidate));
  const literal = arg => (/^\s*(['"`])([^'"`$]*)\1\s*$/.exec(arg) || [])[2];
  // A repository path written in code: relative to the file (or the folder a shell line cds into),
  // or to the repository root, after any leading $VAR/ (shell) or ${VAR}/ (template string) is
  // dropped. A name without its extension finds the .cjs or .js file.
  const candidates = (dir, written) => {
    const unvar = written.replace(/^\$\w+\//, '');
    const bare = unvar.replace(/^\/+/, '').replace(/\/+$/, '');
    const bases = /^\.{1,2}\//.test(unvar) ? [path.posix.join(dir, bare)] : [path.posix.normalize(bare), path.posix.join(dir, bare)];
    return bases.map(base => resolve(base) || base);
  };
  const links = (rel, text = fs.readFileSync(path.join(ROOT, rel), 'utf8')) => {
    const workflow = rel.startsWith('.github/workflows/');
    // A workflow with no permissions key gets the default token, which may write.
    if (workflow && /^permissions:/m.test(text) && !/:\s*write\b/.test(text) && !/\$\{\{\s*secrets\.(?!GITHUB_TOKEN)/.test(text)) return [];
    // A workflow step runs from the repository root, so its ./ paths start there.
    const dir = workflow ? '.' : path.posix.dirname(rel);
    // A PowerShell path from the script's folder uses backslashes.
    text = text.replace(/\$PSScriptRoot((?:\\[\w.-]+)+)/g, (match, rest) => `$PSScriptRoot${rest.replace(/\\/g, '/')}`);
    const found = [];
    for (const match of text.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) found.push(resolve(path.posix.join(dir, match[1])));
    // path.join, path.resolve, path.posix.join or a destructured join or resolve with literal parts,
    // whatever comes first: __dirname, a root variable or call, or a string.
    for (const match of text.matchAll(/(?<![\w.])(?:path(?:\.posix)?\.)?(?:join|resolve)\(((?:[^()]|\([^()]*\))*)\)/g)) {
      const [first, ...rest] = match[1].split(',');
      const parts = [];
      for (const arg of [first, ...rest].slice(literal(first) === undefined ? 1 : 0)) {
        if (literal(arg) === undefined) break;
        parts.push(literal(arg));
      }
      if (!parts.length) continue;
      if (first.trim() === '__dirname') found.push(resolve(path.posix.join(dir, ...parts)) || path.posix.join(dir, ...parts));
      else found.push(...candidates(dir, parts.join('/')));
    }
    // Every other path written in code or a command, read as whole words so no extension or
    // boundary can cut it short. Comment lines (also a quoted line that is a comment in the text a
    // script writes) and generated headers are skipped. A shell line
    // that cds into a folder also reads its file names from there.
    const lines = text.split('\n').filter(line => !/^\s*(?:\/\/|\*|\/\*|#|['"`]\s*#)/.test(line) && !line.includes('Generated by'));
    for (const line of lines) {
      const cd = (/\bcd\s+['"]?([\w.$/{}-]+)['"]?\s*(?:&&|;)/.exec(line) || [])[1];
      for (const word of line.split(/[\s'"`(),;=[\]{}<>|&\\]+/)) {
        if (word.length >= 300) continue;
        if (word.includes('/')) found.push(...candidates(dir, word));
        if (cd && /\.\w+$/.test(word) && !word.includes('/')) found.push(...candidates(dir, `${cd.replace(/^\$\{?\w+\}?\//, '')}/${word}`));
      }
    }
    return found.filter(target => target && known.has(target) && counts(target));
  };
  const roots = tracked.filter(rel => tierOf(rel) === 'RISKY' && !rel.includes('/third-party/')
    && (code.test(rel) || /hooks\/[^/]+\.json$/.test(rel) || rel === '.claude/settings.json' || rel.startsWith('.github/workflows/')));
  const reached = new Map(roots.map(rel => [rel, 'a RISKY root']));
  for (const queue = [...roots]; queue.length;) {
    const rel = queue.shift();
    for (const target of links(rel)) {
      if (reached.has(target)) continue;
      reached.set(target, rel);
      if (code.test(target)) queue.push(target);
    }
  }
  reached.links = links;
  return reached;
}

test('everything RISKY code loads, starts, copies out or runs with a write token is RISKY, so a family cannot be split', () => {
  const tracked = spawnSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const reached = riskyReach(tracked);
  const missing = [...reached].filter(([rel]) => tierOf(rel) !== 'RISKY').map(([rel, from]) => `${rel} (reached from ${from})`);
  assert.deepEqual(missing, []);
  for (const rel of ['repo/scripts/validate-toolkit.cjs', 'repo/tests/toolkit-local-bridge-hook-light.test.cjs', 'repo/scripts/plan-source-watch-pr-lifecycle.cjs',
    'skills/secure-ci-cd/templates/github-actions/personal-data-guard.yml', 'repo/scripts/source-watch-advisory-targets.cjs']) {
    assert.ok(reached.has(rel), `the scan follows the link to ${rel}`);
  }
  for (const glob of TOOLKIT.risky.filter(entry => entry.startsWith('!'))) {
    assert.ok(!reached.has(glob.slice(1)), `${glob} is an exception, so nothing RISKY may reach it`);
    assert.ok(tracked.includes(glob.slice(1)), `${glob} names a tracked file`);
  }
  assert.deepEqual(exceptionFaults(TOOLKIT), []);
  // Each link kind on a real file: a JSON path in a string, a join that starts with a string, a hook
  // command, a shell path from the script's folder, and a write-token workflow step.
  const linked = (from, to) => assert.ok(reached.links(from).includes(to), `${from} links to ${to}`);
  linked('repo/scripts/audit-published-surfaces.cjs', 'repo/contracts/topology-scope-policy.json');
  linked('repo/scripts/toolkit-install-health.cjs', 'repo/contracts/host-qualification/claude-code.json');
  linked('.claude-plugin/hooks/hooks.json', 'repo/scripts/toolkit-governance-hook.cjs');
  linked('skills/codex-ssh-hostinger-coolify-setup-maintainer/scripts/install-daily-security-check-systemd.sh', 'skills/codex-ssh-hostinger-coolify-setup-maintainer/templates/daily-security-check.env.example');
  linked('.github/workflows/source-watch-pr.yml', 'repo/scripts/check-project-source-updates.cjs');
  assert.deepEqual(reached.links('.github/workflows/validate.yml'), [], 'a read-only workflow starts nothing RISKY');
  // The other common spellings of a path, each pointing at one real script.
  const target = 'repo/scripts/watch-project-sources.cjs';
  for (const [from, text] of [
    ['.github/workflows/new.yml', 'jobs:\n  a:\n    steps:\n      - run: node ./repo/scripts/watch-project-sources.cjs\n'],
    ['skills/any/scripts/run.sh', 'cd repo/scripts && node watch-project-sources.cjs\n'],
    ['repo/scripts/run.ps1', 'node "$PSScriptRoot\\watch-project-sources.cjs"\n'],
    ['repo/scripts/run.cjs', "const { join } = require('node:path');\nspawn(join(__dirname, 'watch-project-sources.cjs'));\n"],
    ['repo/scripts/run.cjs', "spawn(path.join(root(), 'repo', 'scripts', 'watch-project-sources.cjs'));\n"],
    ['repo/scripts/run.cjs', "spawn(path.posix.join(ROOT, 'repo/scripts/watch-project-sources.cjs'));\n"],
    ['repo/scripts/run.cjs', "run('node', ['repo/scripts/watch-project-sources']);\n"]
  ]) assert.ok(reached.links(from, text).includes(target), `${from}: ${text.trim()}`);
});

// Being unreached only proves something for code: workflows, instructions and data are RISKY by
// what they are, not by being reached. So an exception may only take a script out of a script folder.
function exceptionFaults(config) {
  return config.risky.filter(entry => entry.startsWith('!') && !/^!(?:repo\/scripts|skills\/[^/]+\/scripts)\/[^/]+\.(?:c?js|mjs)$/.test(entry));
}

test('an exception can only take a script out of a script folder, never a workflow, instruction or data file', () => {
  for (const entry of ['!.github/workflows/programme-reconcile.yml', '!repo/docs/TOOLKIT-DELIVERY.md', '!AGENTS.md', '!repo/contracts/topology-scope-policy.json', '!repo/scripts/lib/x.cjs']) {
    const config = { ...TOOLKIT, risky: [...TOOLKIT.risky, entry] };
    assert.deepEqual(exceptionFaults(config), [entry], entry);
  }
  assert.equal(tierOf('.github/workflows/programme-reconcile.yml'), 'RISKY');
  assert.equal(tierOf('repo/docs/TOOLKIT-DELIVERY.md'), 'RISKY');
  assert.equal(tierOf('repo/scripts/Bump-Version.cjs'), 'RISKY', 'a new script differing only in case from an exception stays RISKY');
});

test('every RISKY pattern in this repository matches a tracked file, so the list cannot go stale unnoticed', () => {
  const tracked = spawnSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const stale = TOOLKIT.risky.filter(glob => !tracked.some(rel => globToRegExp(glob.replace(/^!/, '')).test(rel)));
  assert.deepEqual(stale, []);
});

test('a version-only edit is LIGHT even on a RISKY path; any other line keeps the path tier', () => {
  assert.equal(tierOf('repo/tests/support/release-notes.cjs', ["const VERSION = '3.10.0';", "const VERSION = '3.11.0';"]), 'LIGHT', 'a code constant on a NORMAL path');
  assert.equal(tierOf('repo/scripts/toolkit-local-bridge.cjs', ["const VERSION = '3.10.0';", "const VERSION = '3.11.0';"]), 'RISKY', 'a code constant never lowers a RISKY path');
  assert.equal(tierOf('scripts/install-tool.js', ['const VERSION = "1.0.0";', 'const VERSION = "9.9.9";'], DEFAULT_CONFIG), 'RISKY', "an installer's VERSION picks what it downloads");
  assert.equal(tierOf('.claude-plugin/plugin.json', ['  "version": "3.10.0",', '  "version": "3.11.0",']), 'LIGHT');
  assert.equal(tierOf('repo/scripts/toolkit-local-bridge.cjs', ["const VERSION = '3.11.0';", 'process.exit(0);']), 'RISKY');
  assert.equal(tierOf('AGENTS.md', ['<!-- AI-AGENT-TOOLKIT:a.md:BEGIN X v2 toolkit=3.10.0 sha256=0123456789ab -->',
    '<!-- AI-AGENT-TOOLKIT:a.md:BEGIN X v2 toolkit=3.11.0 sha256=0123456789ab -->']), 'LIGHT', 'a managed-block marker bump');
  assert.equal(tierOf('AGENTS.md', ['<!-- AI-AGENT-TOOLKIT:a.md:BEGIN X v2 toolkit=3.11.0 sha256=0123456789ab -->', '- a new rule']), 'RISKY');
  assert.equal(tierOf('repo/scripts/toolkit-local-bridge.cjs', []), 'RISKY', 'a mode-only change is not a version bump');
});

test('every real managed-block marker in this repository counts as a version bump, and only the toolkit= version may differ', () => {
  const grep = spawnSync('git', ['-C', ROOT, 'grep', '-h', '-E', '<!-- AI-AGENT-TOOLKIT:[^ ]+:BEGIN '], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
  const markers = [...new Set(grep.map(line => line.trim()).filter(line => / toolkit=\d+\.\d+\.\d+ sha256=[0-9a-f]{12} -->$/.test(line)))];
  assert.ok(markers.some(line => line.includes('ANTIGRAVITY.BOOTSTRAP')), 'a marker name with a dot is among them');
  for (const marker of markers) {
    const bumped = marker.replace(/toolkit=\d+\.\d+\.\d+/, 'toolkit=99.0.0');
    assert.equal(classify([{ path: '.agents/rules/00-agent-toolkit-bootstrap.md', removed: [marker], added: [bumped] }], TOOLKIT).tier, 'LIGHT', marker);
    assert.equal(tierOf('AGENTS.md', [marker, bumped]), 'LIGHT', marker);
    for (const changed of [bumped.replace(/sha256=[0-9a-f]{12}/, 'sha256=ffffffffffff'), bumped.replace(/ v2 /, ' v3 '), bumped.replace(/:BEGIN \S+/, ':BEGIN OTHER')]) {
      assert.equal(classify([{ path: 'AGENTS.md', removed: [marker], added: [changed] }], TOOLKIT).tier, 'RISKY', changed);
    }
    assert.equal(classify([{ path: 'AGENTS.md', removed: [], added: [bumped] }], TOOLKIT).tier, 'RISKY', 'a lone added marker');
    assert.equal(tierOf('AGENTS.md', [bumped]), 'RISKY', 'a lone marker line');
  }
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

test('patterns ignore letter case, so a hand-typed Windows path cannot drop the tier', () => {
  assert.equal(tierOf('Skills/secure-ci-cd/SKILL.md'), 'NORMAL');
  assert.equal(tierOf('Repo/docs/agent-playbooks/INDEX.md'), 'NORMAL');
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

test('the git reader reads raw paths, counts only hunk lines, and keeps the tier the list had at the merge base', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risk-tier-git2-'));
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  const git = (...args) => {
    const result = spawnSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  const marker = version => `<!-- AI-AGENT-TOOLKIT:src.md:BEGIN ANTIGRAVITY.BOOTSTRAP v2 toolkit=${version} sha256=0123456789ab -->`;
  try {
    git('init', '-q', '-b', 'main');
    write('.github/toolkit-risk-tiers.json', JSON.stringify({ schema: 'toolkit-risk-tiers/v1', risky: ['.github/toolkit-risk-tiers.json', 'scripts/*-hook.cjs', '**/AGENTS.md'], normal: [], light: ['**/*.md'] }));
    write('scripts/agent-hook.cjs', 'module.exports = 1;\n');
    write('AGENTS.md', `${marker('1.0.0')}\n-- Never push to main.\n`);
    write('docs/rules.md', `${marker('1.0.0')}\n`);
    git('add', '.'); git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'work');
    write('.github/toolkit-risk-tiers.json', JSON.stringify({ schema: 'toolkit-risk-tiers/v1', risky: [], normal: [], light: ['**/*.md', '**/*.cjs', '**/*.json'] }));
    write('scripts/agent-hook.cjs', 'module.exports = 2;\n');
    write('AGENTS.md', `${marker('1.1.0')}\n++ Push to main is fine.\n`);
    write('docs/rules.md', `${marker('1.1.0')}\n`);
    write('docs/caf\u00e9/AGENTS.md', 'new rules\n');
    git('add', '.'); git('commit', '-q', '-m', 'work');
    const change = new GitChange(dir);
    const files = change.files('main');
    assert.ok(files.some(f => f.path === 'docs/caf\u00e9/AGENTS.md'), 'a non-ASCII path comes through unquoted');
    const current = loadConfig(dir).config;
    const result = classify(files, [current, change.baseConfig()]);
    const tierFor = rel => result.files.find(f => f.path === rel).tier;
    assert.equal(tierFor('scripts/agent-hook.cjs'), 'RISKY', 'editing the list cannot lower the same change');
    assert.equal(tierFor('.github/toolkit-risk-tiers.json'), 'RISKY');
    assert.equal(tierFor('AGENTS.md'), 'RISKY', 'content lines starting with -- or ++ are changes, not headers');
    assert.equal(tierFor('docs/caf\u00e9/AGENTS.md'), 'RISKY');
    assert.equal(tierFor('docs/rules.md'), 'LIGHT', 'a real marker bump read from git');
    assert.equal(classify(files, current).files.find(f => f.path === 'scripts/agent-hook.cjs').tier, 'LIGHT', 'the current list alone would have lowered it');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a ! pattern takes a path back out of its list, and the last match wins', () => {
  const config = { schema: 'toolkit-risk-tiers/v1', risky: ['tools/**', '!tools/dev-lint.cjs', 'tools/dev-*.cjs'], normal: [], light: ['**/*.md'] };
  assert.equal(tierOf('tools/setup.cjs', null, config), 'RISKY');
  assert.equal(tierOf('tools/dev-tidy.cjs', null, config), 'RISKY', 'a later pattern puts it back');
  const out = { ...config, risky: ['tools/**', '!tools/dev-lint.cjs'] };
  assert.equal(tierOf('tools/dev-lint.cjs', null, out), 'NORMAL');
  assert.equal(tierOf('Tools/Dev-Lint.cjs', null, out), 'RISKY', 'an exception names its file exactly, so a new file differing in case keeps the folder tier');
  assert.equal(tierOf('tools/notes.md', null, out), 'RISKY', 'an exception never reaches past its own file');
  assert.throws(() => loadConfigText({ risky: ['!'] }), /"risky" must be a list of path patterns/);
  // An exception names one file by its full path: no bare names, wildcards or untidy paths.
  for (const loose of ['!deploy.yml', '!*.sh', '!tools/*.cjs', '!tools/**', '!tools/dev-[ab].cjs', '!tools/./x.cjs', '!tools/x.cjs ']) {
    assert.throws(() => loadConfigText({ risky: ['tools/**', loose] }), /must name one file by its full path/, loose);
  }
  assert.doesNotThrow(() => loadConfigText({ risky: ['tools/**', '!tools/dev-lint.cjs'] }));
});

function loadConfigText(lists) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risk-tier-list-'));
  try {
    fs.mkdirSync(path.join(dir, '.github'));
    fs.writeFileSync(path.join(dir, '.github', 'toolkit-risk-tiers.json'), JSON.stringify({ schema: 'toolkit-risk-tiers/v1', risky: [], normal: [], light: [], ...lists }));
    return loadConfig(dir).config;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('a hand-typed path is tidied before matching, so ./, .., doubled slashes or a trailing space or dot cannot drop the tier', () => {
  for (const typed of ['repo/./CONTROLLER.md', 'repo/scripts/../CONTROLLER.md', 'repo//CONTROLLER.md', 'repo/CONTROLLER.md ', 'repo/CONTROLLER.md.', '/repo/CONTROLLER.md', 'repo\\CONTROLLER.md', './AGENTS.md']) {
    assert.equal(tierOf(typed), 'RISKY', JSON.stringify(typed));
    assert.equal(tierOf(parseArgs(['--', typed]).paths[0]), 'RISKY', JSON.stringify(typed));
  }
  assert.equal(normalizePath('repo/./scripts//x.cjs '), 'repo/scripts/x.cjs');
  // A typed absolute path inside the checkout, run from a subfolder, still reads this repository's list.
  const out = spawnSync(process.execPath, [path.join(ROOT, 'repo', 'scripts', 'toolkit-risk-tier.cjs'), '--repo', path.join(ROOT, 'repo', 'docs'), '--json', '--',
    path.join(ROOT, 'repo', 'scripts', 'setup-toolkit.cjs'), path.join(ROOT, 'repo', 'CONTROLLER.md')], { encoding: 'utf8' });
  const result = JSON.parse(out.stdout);
  assert.equal(result.list, '.github/toolkit-risk-tiers.json');
  assert.deepEqual(result.files.map(file => [file.path, file.tier]), [['repo/scripts/setup-toolkit.cjs', 'RISKY'], ['repo/CONTROLLER.md', 'RISKY']]);
});

test('a moved marker or an unchanged line is not a version bump, and only the marker\'s toolkit= value may change', () => {
  const marker = version => `<!-- AI-AGENT-TOOLKIT:src.md:BEGIN RULES v2 toolkit=${version} sha256=0123456789ab -->`;
  const moved = { path: 'AGENTS.md', removed: [marker('3.10.0')], added: [marker('3.10.0')], hunks: [{ removed: [marker('3.10.0')], added: [] }, { removed: [], added: [marker('3.10.0')] }] };
  assert.equal(classify([moved], TOOLKIT).tier, 'RISKY', 'a marker moved below rule lines');
  const movedBumped = { ...moved, added: [marker('3.11.0')], hunks: [{ removed: [marker('3.10.0')], added: [] }, { removed: [], added: [marker('3.11.0')] }] };
  assert.equal(classify([movedBumped], TOOLKIT).tier, 'RISKY', 'a marker moved and bumped');
  assert.equal(classify([{ path: 'AGENTS.md', removed: [marker('3.10.0')], added: [marker('3.11.0')], hunks: [{ removed: [marker('3.10.0')], added: [marker('3.11.0')] }] }], TOOLKIT).tier, 'LIGHT');
  assert.equal(classify([{ path: 'AGENTS.md', removed: [marker('3.10.0')], added: [marker('3.10.0')] }], TOOLKIT).tier, 'RISKY', 'identical lines are a move');
  assert.equal(tierOf('AGENTS.md', [marker('3.10.0'), marker('3.10.0')]), 'RISKY', 'identical bare lines are a move');
  const source = version => `<!-- AI-AGENT-TOOLKIT:rules-${version}.md:BEGIN RULES v2 toolkit=3.10.0 sha256=0123456789ab -->`;
  assert.equal(classify([{ path: 'AGENTS.md', removed: [source('1.0.0')], added: [source('2.0.0')] }], TOOLKIT).tier, 'RISKY', 'a version in the source name is not the toolkit= value');
});

test('reading from git, adding a list for the first time cannot lower its own change, and paths are literal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risk-tier-git3-'));
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  const git = (...args) => {
    const result = spawnSync('git', ['-C', dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  const cli = () => JSON.parse(spawnSync(process.execPath, [path.join(ROOT, 'repo', 'scripts', 'toolkit-risk-tier.cjs'), '--repo', dir, '--base', 'main', '--json'], { encoding: 'utf8' }).stdout);
  try {
    git('init', '-q', '-b', 'main');
    write('AGENTS.md', 'Never push to main.\n');
    write('.github/workflows/ci.yml', 'on: pull_request\n');
    write('cfg/[ab].json', '{\n  "version": "1.0.0"\n}\n');
    write('cfg/a.json', '{\n  "name": "one"\n}\n');
    git('add', '.'); git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'work');
    write('.github/toolkit-risk-tiers.json', JSON.stringify({ schema: 'toolkit-risk-tiers/v1', risky: [], normal: [], light: ['**'] }));
    write('AGENTS.md', 'Push to main is fine.\n');
    write('.github/workflows/ci.yml', 'on: pull_request_target\n');
    git('add', '.'); git('commit', '-q', '-m', 'work');
    const first = cli();
    const tierFor = (result, rel) => result.files.find(f => f.path === rel).tier;
    assert.equal(tierFor(first, 'AGENTS.md'), 'RISKY', 'the built-in default list applied at the merge base');
    assert.equal(tierFor(first, '.github/workflows/ci.yml'), 'RISKY');
    git('checkout', '-q', 'main');
    write('.github/toolkit-risk-tiers.json', JSON.stringify({ schema: 'toolkit-risk-tiers/v1', risky: ['cfg/**'], normal: [], light: [] }));
    git('add', '.'); git('commit', '-q', '-m', 'list');
    git('checkout', '-q', '-b', 'bump');
    write('cfg/[ab].json', '{\n  "version": "1.1.0"\n}\n');
    write('cfg/a.json', '{\n  "name": "two"\n}\n');
    git('commit', '-q', '-am', 'bump');
    const bump = cli();
    assert.equal(tierFor(bump, 'cfg/[ab].json'), 'LIGHT', 'the bracketed name is read on its own, not as a pattern that also matches cfg/a.json');
    assert.equal(tierFor(bump, 'cfg/a.json'), 'RISKY');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('arguments', () => {
  assert.deepEqual(parseArgs(['--json', '--', '.\\a\\b.md']).paths, ['a/b.md']);
  assert.throws(() => parseArgs(['--bogus']), /Unknown argument/);
});
