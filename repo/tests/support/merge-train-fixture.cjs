'use strict';

// Shared fixture for the merge-train tests: a scratch repository with a toy bump script, member
// branches and manifest helpers. Split across files so each stays inside its CI time budget.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const train = require('../../scripts/toolkit-merge-train.cjs');
const governance = require('../../scripts/toolkit-governance-state.cjs');
const bindingCache = require('../../scripts/toolkit-governance-binding.cjs');

const SCRIPT = path.join(__dirname, '..', '..', 'scripts', 'toolkit-merge-train.cjs');
const BUMP_SCRIPT = [
  "'use strict';",
  "const fs = require('node:fs');",
  "const [level, base] = process.argv.slice(2);",
  "const [major, minor, patch] = fs.readFileSync('VERSION', 'utf8').trim().split('.').map(Number);",
  "const next = level === 'major' ? [major + 1, 0, 0] : level === 'minor' ? [major, minor + 1, 0] : [major, minor, patch + 1];",
  "fs.writeFileSync('VERSION', `${next.join('.')}\\n`);",
  "fs.writeFileSync('BUMP-BASE', `${base}\\n`);",
  '',
].join('\n');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-train-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
  git('init', '--quiet', '--initial-branch=main');
  git('remote', 'add', 'origin', 'https://github.com/example/repo.git');
  git('config', 'user.name', 'Train test');
  git('config', 'user.email', 'train@example.com');
  git('config', 'commit.gpgsign', 'false');
  write('VERSION', '1.0.0\n');
  write('a.txt', 'one\ntwo\nthree\n');
  write('scripts/bump.cjs', BUMP_SCRIPT);
  git('add', '--all');
  git('commit', '--quiet', '-m', 'base');
  const main = git('rev-parse', 'HEAD');
  const branch = (name, files) => {
    git('switch', '--quiet', '-c', name, main);
    for (const [rel, text] of Object.entries(files)) write(rel, text);
    git('add', '--all');
    git('commit', '--quiet', '-m', `work on ${name}`);
    const head = git('rev-parse', 'HEAD');
    git('switch', '--quiet', 'main');
    return head;
  };
  const member = (pr, head, extra = {}) => ({ pr, head, g2: `G2 PASS report for ${pr}`, tier: 'NORMAL', bump: 'patch', uat: 'UAT: NOT_REQUIRED (internal)', links: [`Refs #${pr + 100}`], ...extra });
  const manifestFile = (value, name = 'manifest.json') => {
    const file = path.join(root, name);
    fs.writeFileSync(file, JSON.stringify({ repository: 'example/repo', bump_command: 'node scripts/bump.cjs {level} {base}', ...value }));
    return file;
  };
  // An isolated Toolkit home whose fresh read of the merged binding has governance enabled, so
  // merge trains are on unless a test calls governed() with other values.
  const home = path.join(root, 'home');
  const opts = { registryOptions: { userHome: home, testOnly: true } };
  const governed = (taskPrs = null, extra = {}) => mergedBinding(repo, main, opts.registryOptions, {
    schema: 'toolkit.programme-binding.v2', repository: 'example/repo', governance: 'enabled',
    parents: [{ issue: 1, record_prefix: 'INT-EX-' }],
    store: { kind: 'github', repository: 'example/TRANSPORT-repo', branch: 'main', path: 'state/example/repo/' },
    required_checks: ['validate'], ...(taskPrs ? { task_prs: taskPrs } : {}), ...extra,
  });
  governed();
  const cli = (...args) => spawnSync(process.execPath, [SCRIPT, ...args, '--json'], { cwd: repo, encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
  return { root, repo, git, write, main, branch, member, manifestFile, cli, opts, governed };
}

// Writes this computer's fresh read of the binding merged on the default branch (null: none merged).
function mergedBinding(repo, main, registryOptions, value) {
  const identity = governance.readIdentity(repo);
  const text = value === null ? null : JSON.stringify(value);
  const file = bindingCache.cacheFileFor(governance.userStateDirectory(registryOptions), identity.repository_id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    schema: bindingCache.CACHE_SCHEMA, repository_id: identity.repository_id, remote: identity.remote.canonical,
    default_branch: 'main', commit: main, fetched_at: new Date().toISOString(),
    status: text === null ? 'absent' : 'present',
    bytes_sha256: text === null ? null : crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
    text, problem: null,
  }));
}

function built(f, members, extra = {}) {
  const out = path.join(f.root, 'boarded.json');
  const result = train.run(['build', '--manifest', f.manifestFile({ members, ...extra }), '--branch', 'toolkit-train/one', '--main', 'main', '--out', out], f.repo, f.opts);
  return { result, out, boarded: JSON.parse(fs.readFileSync(out, 'utf8')) };
}

module.exports = { fixture, built };
