'use strict';

// Stale copies are loud, and only where a refresh moves them forward: in a governed repository whose
// cloud workflow copies are behind the Toolkit's layout (here: still pinned to an older Toolkit commit
// that this computer's Toolkit checkout, on main, contains), the session start of both hosts names them
// and the --refresh-pr command. A copy made by a newer commit, one the checkout lacks or a checkout off
// main gets the update-the-checkout line instead, never the command, which would roll the copies back.
// A copy another commit rendered with today's layout is current. The governance check's
// CLOUD_WORKFLOW_OUTDATED rows decide which copies differ.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');
const gate = require('../scripts/toolkit-governance-gate.cjs');
const pack = require('../scripts/toolkit-hook-pack.cjs');
const { render } = require('../scripts/toolkit-cloud-workflows-render.cjs');
const { pinnedCopy } = require('./support/pinned-cloud-copy.cjs');
const ROOT = path.resolve(__dirname, '../..');
const UNKNOWN = 'f'.repeat(40);
const COPIES = [['programme-sweep', '.github/workflows/toolkit-programme-sweep.yml'], ['programme-sweep-gate', '.github/workflows/toolkit-programme-sweep-gate.yml']];
const FILES = '\\.github\\/workflows\\/toolkit-programme-sweep\\.yml, \\.github\\/workflows\\/toolkit-programme-sweep-gate\\.yml';
const STALE = new RegExp(`⚠️ Stale Toolkit copies: ${FILES} are behind the Toolkit's current layout, and ${FILES} are pinned to one older Toolkit commit`);
const BEHIND = new RegExp(`⚠️ Toolkit checkout behind: ${FILES} are made by a Toolkit commit that this computer's Toolkit checkout`);
const COMMAND = /toolkit-cloud-workflows\.cjs/;
const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const run = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, ...IDENTITY } }).trim();

// A Toolkit git checkout holding two commits of this checkout's tree, A and then B on top, sharing this
// checkout's objects. `at(head, main)` moves its HEAD and its origin/main.
function toolkitCheckout(t, parent = null) {
  const root = parent ? path.join(parent, 'ai-agent-toolkit') : fs.mkdtempSync(path.join(os.tmpdir(), 'tk-stale-pins-toolkit-'));
  if (parent) fs.mkdirSync(root); else t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  run(root, ['init', '--quiet']);
  fs.writeFileSync(path.join(root, '.git', 'objects', 'info', 'alternates'), `${path.resolve(ROOT, run(ROOT, ['rev-parse', '--git-path', 'objects']))}\n`);
  const tree = run(ROOT, ['rev-parse', 'HEAD^{tree}']);
  const A = run(root, ['commit-tree', tree, '-m', 'a']);
  const B = run(root, ['commit-tree', tree, '-p', A, '-m', 'b']);
  run(root, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  const at = (head, main) => { run(root, ['update-ref', 'refs/heads/main', head]); run(root, ['update-ref', 'refs/remotes/origin/main', main]); };
  return { root, A, B, at };
}

// A governed repository (not a Toolkit checkout) carrying the sweep and its gate rendered from this
// Toolkit's workflow files, the sweep made at `commit` and its gate at `gateCommit`: pinned to that
// commit as before layouts, or with today's layout when `pinned` is false.
function governedRepo(t, commit, gateCommit = commit, pinned = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-stale-pins-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'work');
  execFileSync('git', ['init', '--quiet', repo], { stdio: 'ignore', windowsHide: true });
  fs.mkdirSync(path.join(repo, '.github', 'workflows'), { recursive: true });
  if (commit === null) return { dir, repo };
  for (const [id, file] of COPIES) {
    const source = execFileSync('git', ['show', `HEAD:${file}`], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
    fs.mkdirSync(path.join(repo, path.dirname(file)), { recursive: true });
    const at = id === 'programme-sweep' ? commit : gateCommit;
    fs.writeFileSync(path.join(repo, file), pinned ? pinnedCopy(render(id, source, at), at) : render(id, source, at));
  }
  return { dir, repo };
}
const enabled = root => ({ state: 'ENABLED', rule: 'M1', materials_complete: true, programme_records_bind: true, root });
const deps = (dir, toolkitRoot) => ({ toolkitRoot, attentionDir: path.join(dir, 'attention'), sessionsDir: path.join(dir, 'sessions'), home: dir, mergedBinding: () => ({ repository: 'acme/app' }), startRefresh: () => {} });

test('the session line names stale cloud workflow copies and the refresh command only when a refresh moves them forward', t => {
  const toolkit = toolkitCheckout(t);
  const line = (repo, extra = {}) => gate.sessionLine(repo.repo, { stateReader: () => enabled(repo.repo), programmeDeps: { ...deps(repo.dir, toolkit.root), ...extra } });
  const older = governedRepo(t, toolkit.A);
  // Older pin, checkout on main and containing it: the note, the update step and the refresh command.
  toolkit.at(toolkit.B, toolkit.B);
  const stale = line(older);
  assert.match(stale, STALE);
  assert.ok(stale.includes(`update the Toolkit checkout to the latest main, then run \`node repo/scripts/toolkit-cloud-workflows.cjs --repo ${older.repo} --refresh-pr\` from it; it opens or updates one pull request for the owner to merge`), stale);
  assert.doesNotMatch(stale, /Toolkit checkout behind/);
  // Copies with today's layout are current whichever commit rendered them: no line.
  for (const at of [toolkit.A, toolkit.B]) assert.doesNotMatch(line(governedRepo(t, at, at, false)), /Stale Toolkit|Toolkit checkout behind/);
  // Newer pin (another computer refreshed from a later main), a pin the checkout lacks, and a checkout
  // off main: the update-the-checkout line and never the refresh command.
  // One copy older and one the checkout lacks: a refresh would still roll the second back.
  const cases = [['newer pin', governedRepo(t, toolkit.B), toolkit.A, toolkit.B], ['unknown pin', governedRepo(t, UNKNOWN), toolkit.B, toolkit.B], ['checkout off main', older, toolkit.B, toolkit.A],
    ['one older, one unknown', governedRepo(t, toolkit.A, UNKNOWN), toolkit.B, toolkit.B]];
  for (const [name, repo, head, main] of cases) {
    toolkit.at(head, main);
    const text = line(repo);
    assert.match(text, BEHIND, name);
    assert.ok(text.includes(`checkout (${head.slice(0, 7)}) does not contain, or the checkout is not on main`), `${name}: ${text}`);
    assert.doesNotMatch(text, /Stale Toolkit/, name);
    assert.doesNotMatch(text, COMMAND, name);
  }
  // Only outdated copies count: a missing or hand-edited copy is drift the governance check reports.
  toolkit.at(toolkit.B, toolkit.B);
  for (const findings of [[], [{ id: 'CLOUD_WORKFLOW_DRIFT', severity: 'drift', message: 'x' }], [{ id: 'CLOUD_WORKFLOWS_UNCHECKED', severity: 'info', message: 'x' }]]) {
    assert.doesNotMatch(line(older, { cloudWorkflowFindings: () => findings }), /Stale Toolkit|Toolkit checkout behind/);
  }
  // Not where programme records do not bind.
  assert.doesNotMatch(gate.sessionLine(older.repo, { stateReader: () => ({ ...enabled(older.repo), programme_records_bind: false }), programmeDeps: deps(older.dir, toolkit.root) }), /Stale Toolkit/);
});

test('both hosts print the stale-copy note at session start', t => {
  const toolkit = toolkitCheckout(t);
  toolkit.at(toolkit.B, toolkit.B);
  const { dir, repo } = governedRepo(t, toolkit.A);
  const home = path.join(dir, 'home');
  fs.mkdirSync(home, { recursive: true });
  const preload = path.join(dir, 'preload.cjs');
  // The repository's governance state is given (a merged binding needs GitHub) and the Toolkit checkout
  // compared is the fixture's; everything after it, the governance check on the copies included, runs
  // as shipped. Optional bridge maintenance is out of scope.
  fs.writeFileSync(preload, `
const Module = require('node:module'), path = require('node:path');
const load = Module._load;
Module._load = function(request, parent, main) {
  const name = path.basename(request);
  if (name === 'toolkit-local-bridge.cjs') return { run: () => ({ status: 0 }) };
  if (name === 'toolkit-governance-gate.cjs') {
    const gate = load.call(this, request, parent, main);
    return { ...gate, sessionLine: (cwd, opts = {}) => gate.sessionLine(cwd, { ...opts, stateReader: () => (${enabled.toString()})(cwd), programmeDeps: { ...opts.programmeDeps, toolkitRoot: ${JSON.stringify(toolkit.root)} } }) };
  }
  return load.call(this, request, parent, main);
};
`);
  const env = { ...process.env, HOME: home, USERPROFILE: home, TOOLKIT_GOVERNANCE_OFFLINE: '1', NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require="${preload.replace(/\\/g, '/')}"`].filter(Boolean).join(' ') };
  delete env.CLAUDE_CODE_REMOTE;
  for (const host of ['claude', 'codex']) {
    const args = host === 'claude' ? [path.join(ROOT, 'repo/scripts/toolkit-governance-hook.cjs'), '--event', 'SessionStart']
      : [path.join(ROOT, 'repo/scripts/toolkit-codex-session-start.cjs'), '--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin'];
    const result = spawnSync(process.execPath, args, { input: JSON.stringify({ cwd: repo, session_id: `stale-${host}`, source: 'startup' }), env, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(result.status, 0, `${host}: ${result.stderr}`);
    const context = pack.hookContext(host, 'SessionStart', result);
    assert.match(context, STALE, `${host}: ${context}`);
    assert.ok(context.includes(`node repo/scripts/toolkit-cloud-workflows.cjs --repo ${repo} --refresh-pr`), host);
  }
});

// A cloud session (a Claude Projects thread) starts above its clones. Each ENABLED repository's line
// carries the same stale-copy line, rendered from a Toolkit clone in the session; a repository whose
// governance is off gets none.
test('a cloud session shows the stale-copy line for each ENABLED repository', t => {
  const governed = governedRepo(t, null);
  const toolkit = toolkitCheckout(t, governed.dir);
  toolkit.at(toolkit.B, toolkit.B);
  // The clone counts as a Toolkit checkout (its marker file) whose origin is the Toolkit; a fork never would.
  fs.mkdirSync(path.join(toolkit.root, 'repo', 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(toolkit.root, 'repo', 'scripts', 'toolkit-governance-conformance.cjs'), '');
  run(toolkit.root, ['remote', 'add', 'origin', 'https://github.com/weijunswj/ai-agent-toolkit.git']);
  const registryOptions = { registryPath: path.join(governed.dir, 'home', 'registry.json'), testOnly: true, home: path.join(governed.dir, 'home') };
  const seed = require('./support/governance-observations.cjs').seedMerged;
  const repos = { on: governed.repo, off: path.join(governed.dir, 'off') };
  fs.cpSync(governed.repo, repos.off, { recursive: true });
  run(repos.on, ['remote', 'add', 'origin', 'https://github.com/example-owner/governed.git']);
  run(repos.off, ['remote', 'add', 'origin', 'https://github.com/example-owner/off.git']);
  for (const [, folder] of Object.entries(repos)) {
    for (const [id, file] of COPIES) fs.writeFileSync(path.join(folder, file), pinnedCopy(render(id, execFileSync('git', ['show', `HEAD:${file}`], { cwd: ROOT, encoding: 'utf8' }), toolkit.A), toolkit.A));
  }
  seed(repos.on, 'enable', { registryOptions });
  seed(repos.off, 'disable', { registryOptions });
  const text = gate.cloudSessionText(governed.dir, { registryOptions, refreshBinding: () => {} });
  const on = text.split('\n- ').find(line => line.startsWith('example-owner/governed:'));
  assert.match(on, STALE, text);
  assert.ok(on.includes(`--repo ${repos.on} --refresh-pr`), on);
  assert.doesNotMatch(text.split('\n- ').find(line => line.startsWith('example-owner/off:')), /Stale Toolkit|Toolkit checkout behind/);
  assert.equal(text.match(/Stale Toolkit copies/g).length, 1);
});
