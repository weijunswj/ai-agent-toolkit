'use strict';

// Stale pins are loud: in a governed repository whose cloud workflow copies are pinned to an older
// Toolkit commit, the session start of both hosts names them and the refresh command. The governance
// check's CLOUD_WORKFLOW_OUTDATED rows decide which copies are stale.
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
const OLD = 'f'.repeat(40);
const COPIES = [['programme-sweep', '.github/workflows/toolkit-programme-sweep.yml'], ['programme-sweep-gate', '.github/workflows/toolkit-programme-sweep-gate.yml']];
const STALE = /⚠️ Stale Toolkit pins: \.github\/workflows\/toolkit-programme-sweep\.yml, \.github\/workflows\/toolkit-programme-sweep-gate\.yml are pinned to an older Toolkit commit/;

// A governed repository (not a Toolkit checkout) carrying the sweep and its gate rendered from this
// Toolkit's workflow files and pinned to `commit`.
function governedRepo(t, commit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-stale-pins-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'work');
  execFileSync('git', ['init', '--quiet', repo], { stdio: 'ignore', windowsHide: true });
  for (const [id, file] of COPIES) {
    const source = execFileSync('git', ['show', `HEAD:${file}`], { cwd: ROOT, encoding: 'utf8', windowsHide: true });
    fs.mkdirSync(path.join(repo, path.dirname(file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), render(id, source, commit));
  }
  return { dir, repo };
}
const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
const enabled = root => ({ state: 'ENABLED', rule: 'M1', materials_complete: true, programme_records_bind: true, root });
const deps = dir => ({ attentionDir: path.join(dir, 'attention'), sessionsDir: path.join(dir, 'sessions'), home: dir, mergedBinding: () => ({ repository: 'acme/app' }), startRefresh: () => {} });

test('the session line names stale cloud workflow pins and the refresh command, from the governance check itself', t => {
  const stale = governedRepo(t, OLD);
  const line = gate.sessionLine(stale.repo, { stateReader: () => enabled(stale.repo), programmeDeps: deps(stale.dir) });
  assert.match(line, STALE);
  assert.ok(line.includes(`\`node repo/scripts/toolkit-cloud-workflows.cjs --repo ${stale.repo}\``), line);
  // Copies pinned to this Toolkit's own commit are current: no note.
  const current = governedRepo(t, head());
  assert.doesNotMatch(gate.sessionLine(current.repo, { stateReader: () => enabled(current.repo), programmeDeps: deps(current.dir) }), /Stale Toolkit pins/);
  // Only outdated copies count: a missing or hand-edited copy is drift the governance check reports.
  for (const findings of [[], [{ id: 'CLOUD_WORKFLOW_DRIFT', severity: 'drift', message: 'x' }], [{ id: 'CLOUD_WORKFLOWS_UNCHECKED', severity: 'info', message: 'x' }]]) {
    assert.doesNotMatch(gate.sessionLine(stale.repo, { stateReader: () => enabled(stale.repo), programmeDeps: { ...deps(stale.dir), cloudWorkflowFindings: () => findings } }), /Stale Toolkit pins/);
  }
  // Not where programme records do not bind.
  assert.doesNotMatch(gate.sessionLine(stale.repo, { stateReader: () => ({ ...enabled(stale.repo), programme_records_bind: false }), programmeDeps: deps(stale.dir) }), /Stale Toolkit pins/);
});

test('both hosts print the stale-pin note at session start', t => {
  const { dir, repo } = governedRepo(t, OLD);
  const home = path.join(dir, 'home');
  fs.mkdirSync(home, { recursive: true });
  const preload = path.join(dir, 'preload.cjs');
  // The repository's governance state is given (a merged binding needs GitHub); everything after it,
  // the governance check on the copies included, runs as shipped. Optional bridge maintenance is out of scope.
  fs.writeFileSync(preload, `
const Module = require('node:module'), path = require('node:path');
const load = Module._load;
Module._load = function(request, parent, main) {
  const name = path.basename(request);
  if (name === 'toolkit-local-bridge.cjs') return { run: () => ({ status: 0 }) };
  if (name === 'toolkit-governance-gate.cjs') {
    const gate = load.call(this, request, parent, main);
    return { ...gate, sessionLine: (cwd, opts) => gate.sessionLine(cwd, { ...opts, stateReader: () => (${enabled.toString()})(cwd) }) };
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
