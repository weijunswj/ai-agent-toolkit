'use strict';

// Stale pins are loud, and only where a refresh moves them forward: in a governed repository whose
// cloud workflow copies are pinned to an older Toolkit commit that this computer's Toolkit checkout (on
// main) contains, the session start of both hosts names them and the refresh command. A newer pin, a
// pin the checkout lacks or a checkout off main gets the update-the-checkout line instead, never the
// command, which would roll the copies back. The governance check's CLOUD_WORKFLOW_OUTDATED rows
// decide which copies differ.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');
const gate = require('../scripts/toolkit-governance-gate.cjs');
const pack = require('../scripts/toolkit-hook-pack.cjs');
const { render } = require('../scripts/toolkit-cloud-workflows-render.cjs');
const ROOT = path.resolve(__dirname, '../..');
const UNKNOWN = 'f'.repeat(40);
const COPIES = [['programme-sweep', '.github/workflows/toolkit-programme-sweep.yml'], ['programme-sweep-gate', '.github/workflows/toolkit-programme-sweep-gate.yml']];
const FILES = '\\.github\\/workflows\\/toolkit-programme-sweep\\.yml, \\.github\\/workflows\\/toolkit-programme-sweep-gate\\.yml';
const STALE = new RegExp(`⚠️ Stale Toolkit pins: ${FILES} are pinned to an older Toolkit commit`);
const BEHIND = new RegExp(`⚠️ Toolkit checkout behind: ${FILES} are pinned to a Toolkit commit that this computer's Toolkit checkout`);
const COMMAND = /toolkit-cloud-workflows\.cjs/;
const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const run = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, ...IDENTITY } }).trim();

// A Toolkit git checkout holding two commits of this checkout's tree, A and then B on top, sharing this
// checkout's objects. `at(head, main)` moves its HEAD and its origin/main.
function toolkitCheckout(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-stale-pins-toolkit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
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
// Toolkit's workflow files, the sweep pinned to `commit` and its gate to `gateCommit`.
function governedRepo(t, commit, gateCommit = commit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-stale-pins-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'work');
  execFileSync('git', ['init', '--quiet', repo], { stdio: 'ignore', windowsHide: true });
  for (const [id, file] of COPIES) {
    const source = execFileSync('git', ['show', `HEAD:${file}`], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
    fs.mkdirSync(path.join(repo, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), render(id, source, id === 'programme-sweep' ? commit : gateCommit));
  }
  return { dir, repo };
}
const enabled = root => ({ state: 'ENABLED', rule: 'M1', materials_complete: true, programme_records_bind: true, root });
const deps = (dir, toolkitRoot) => ({ toolkitRoot, attentionDir: path.join(dir, 'attention'), sessionsDir: path.join(dir, 'sessions'), home: dir, mergedBinding: () => ({ repository: 'acme/app' }), startRefresh: () => {} });

test('the session line names stale cloud workflow pins and the refresh command only when a refresh moves them forward', t => {
  const toolkit = toolkitCheckout(t);
  const line = (repo, extra = {}) => gate.sessionLine(repo.repo, { stateReader: () => enabled(repo.repo), programmeDeps: { ...deps(repo.dir, toolkit.root), ...extra } });
  const older = governedRepo(t, toolkit.A);
  // Older pin, checkout on main and containing it: the note, the update step and the refresh command.
  toolkit.at(toolkit.B, toolkit.B);
  const stale = line(older);
  assert.match(stale, STALE);
  assert.ok(stale.includes(`update the Toolkit checkout to the latest main, then refresh them with \`node repo/scripts/toolkit-cloud-workflows.cjs --repo ${older.repo}\``), stale);
  assert.doesNotMatch(stale, /Toolkit checkout behind/);
  // Copies pinned to the checkout's own commit are current: no line.
  assert.doesNotMatch(line(governedRepo(t, toolkit.B)), /Stale Toolkit pins|Toolkit checkout behind/);
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
    assert.doesNotMatch(text, /Stale Toolkit pins/, name);
    assert.doesNotMatch(text, COMMAND, name);
  }
  // Only outdated copies count: a missing or hand-edited copy is drift the governance check reports.
  toolkit.at(toolkit.B, toolkit.B);
  for (const findings of [[], [{ id: 'CLOUD_WORKFLOW_DRIFT', severity: 'drift', message: 'x' }], [{ id: 'CLOUD_WORKFLOWS_UNCHECKED', severity: 'info', message: 'x' }]]) {
    assert.doesNotMatch(line(older, { cloudWorkflowFindings: () => findings }), /Stale Toolkit pins|Toolkit checkout behind/);
  }
  // Not where programme records do not bind.
  assert.doesNotMatch(gate.sessionLine(older.repo, { stateReader: () => ({ ...enabled(older.repo), programme_records_bind: false }), programmeDeps: deps(older.dir, toolkit.root) }), /Stale Toolkit pins/);
});

test('both hosts print the stale-pin note at session start', t => {
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
    assert.ok(context.includes(`node repo/scripts/toolkit-cloud-workflows.cjs --repo ${repo}`), host);
  }
});
