'use strict';

// Tokenless programme refresh: the `refresh` command any session may run, the per-computer pass lock,
// and the after-tool and turn-end hook paths that start it after a GitHub write.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
const trigger = require('../../skills/github-program-reconciler/scripts/programme-refresh-trigger.cjs');
const hook = require('../scripts/toolkit-programme-checkpoint-hook.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const controller = { session: 'toolkit-421-controller', prefix: 'INT-TK421-' };
const GOVERNED = () => ({ state: 'ENABLED', governed_rules_bind: true });
const temps = [];
const tmp = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'programme-refresh-')); temps.push(dir); return dir; };
test.after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture({ held = 'controller' } = {}) {
  if (held === true) held = 'controller';
  if (held === false) held = 'none';
  const repository = 'acme/app';
  const github = new FakeGitHub({ repository, store: 'acme/state-store' });
  const binding = {
    schema: state.SCHEMA.binding, repository, parent_issue: 421, record_prefix: 'INT-TK421-', writer_prefix: 'INT-TK421-',
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: `state/${repository}/` }, required_checks: ['validate'],
  };
  const outcomes = [{ issue: 423, label: 'C2', class: 'CORE', parent: 421, order: 1 }];
  github.addIssue(421, { body: '## CURRENT\n' });
  github.addIssue(423, { body: 'Body of 423' });
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => new Date(github.clock).toISOString(), toolkitVersion: '3.9.0' });
  const parent = state.newParent({ repository, parentIssue: 421, outcomes });
  const holder = { controller, lane: { session: 'lane-session', prefix: 'LANE-X-' } }[held];
  if (held !== 'missing') store.write('parent', 421, holder ? state.claimDocument(parent, holder, {}) : parent, { sha: null, previous: null });
  const fx = { github, store, binding, output: '', lockFile: path.join(tmp(), 'pass.lock') };
  fx.run = (argv, extra = {}) => {
    fx.output = '';
    const deps = { transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: tmp(), toolkitVersion: '3.9.0',
      lockFile: fx.lockFile, environment: {}, stdout: { write: text => { fx.output += text; } }, ...extra };
    try { return { code: cli.main([...argv, '--json'], deps), result: JSON.parse(fx.output), error: null }; }
    catch (error) { return { code: null, result: null, error }; }
  };
  return fx;
}

test('refresh runs the full pass as the parent holder, with no session or controller flag', () => {
  const fx = fixture();
  const { result, error } = fx.run(['refresh']);
  assert.equal(error, null);
  assert.equal(result.mode, 'apply');
  assert.ok(result.writes.github > 0, 'the pages were written');
  assert.match(fx.github.issues.get(423).body, /AI-AGENT-TOOLKIT:programme-state:BEGIN STATE/);
  assert.equal(fx.store.read('parent', 421).doc.fence.holder_session, controller.session, 'the fence is unchanged');
  assert.equal(fx.run(['refresh']).result.summary, 'No changes', 'a second pass writes nothing');
});

test('refresh also runs for a session a Toolkit launcher started', () => {
  const fx = fixture();
  const { error } = fx.run(['refresh'], { environment: { TOOLKIT_GATE_ROLE: 'G1' } });
  assert.equal(error, null);
  const blocked = fx.run(['reconcile', '--apply', '--controller', '--session', controller.session], { environment: { TOOLKIT_GATE_ROLE: 'G1' } });
  assert.equal(blocked.error.code, 'USAGE', 'the controller pass stays refused for an executor');
});

test('refresh takes no decision input', () => {
  for (const extra of [['--session', 'x'], ['--controller'], ['--issue', '423'], ['--apply'], ['--patch', 'x.json']]) {
    assert.throws(() => cli.parseArgs(['refresh', ...extra]), { code: 'USAGE' }, extra.join(' '));
  }
  assert.doesNotThrow(() => cli.parseArgs(['refresh', '--json', '--repo-root', '.']));
});

test('refresh refuses when no controller holds the parent', () => {
  const fx = fixture({ held: false });
  assert.equal(fx.run(['refresh']).error.code, 'PARENT_UNHELD');
});

// The output of one or more passes printed with --json, one JSON document each.
const documents = text => text.split(/\n(?=\{)/).filter(Boolean).map(part => JSON.parse(part));

test('while another live pass holds the lock, refresh queues one more pass and reconcile --apply refuses', () => {
  const fx = fixture();
  const other = cli.takeLock(fx.lockFile);
  assert.ok(other.token);
  const queued = fx.run(['refresh']);
  assert.deepEqual([queued.code, queued.result.outcome], [0, 'QUEUED']);
  assert.match(queued.result.reason, /runs once more when it ends/);
  assert.equal(fs.existsSync(cli.againFile(fx.lockFile)), true, 'the change is flagged for the running pass');
  assert.equal(fx.github.issues.get(423).body, 'Body of 423', 'nothing was written');
  assert.equal(fx.run(['reconcile', '--apply', '--controller', '--session', controller.session]).error.code, 'PASS_RUNNING');
  assert.equal(fx.run(['reconcile']).error, null, 'a dry run needs no lock');
  other.release();
  assert.equal(fs.existsSync(fx.lockFile), false);
});

// Runs refresh as the lock owner with its own output, so refreshes started inside a hook do not mix in.
function own(fx, argv = ['refresh']) {
  const sink = { text: '' };
  const deps = { transport: fx.github, binding: fx.binding, originUrl: 'https://github.com/acme/app.git', repoRoot: tmp(), toolkitVersion: '3.9.0', lockFile: fx.lockFile, environment: {}, stdout: { write: text => { sink.text += text; } } };
  try { return { code: cli.main([...argv, '--json'], deps), passes: documents(sink.text), error: null }; }
  catch (error) { return { code: null, passes: documents(sink.text), error }; }
}
const firstWrite = (fx, act) => {
  let done = false;
  fx.github.hooks.push((call, github) => {
    if (done || call.method === 'GET') return null;
    done = true;
    act(call, github);
    return null;
  });
  return () => done;
};
const writesAfter = (fx, from) => fx.github.calls.slice(from).filter(call => call.method !== 'GET').length;

test('a change that lands during a pass is picked up by one more pass before the lock is let go, even with read lag', () => {
  for (const lag of [false, true]) {
    const fx = fixture();
    // Mid-pass, after the pass has read #423: another session writes and its refresh finds the lock held.
    const fired = firstWrite(fx, () => {
      fx.github.addComment(423, { body: 'A late comment' });
      assert.equal(fx.run(['refresh']).result.outcome, 'QUEUED');
      // GitHub's branch reads now trail the pass's own writes.
      fx.github.branchLag = lag;
    });
    const run = own(fx);
    assert.equal(run.error, null, `lag ${lag}: ${run.error?.message}`);
    assert.equal(fired(), true);
    assert.equal(run.passes.length, 2, `lag ${lag}: the owner ran one more pass`);
    assert.equal(run.passes[1].holds.length, 0, `lag ${lag}: the extra pass held nothing`);
    assert.equal(fs.existsSync(fx.lockFile), false, 'released');
    assert.equal(fs.existsSync(cli.againFile(fx.lockFile)), false, 'flag cleared');
    fx.github.branchLag = false;
    assert.equal(fx.run(['reconcile']).result.summary, 'No changes', `lag ${lag}: the late write is on the pages`);
  }
});

test('a change flagged between the last check and the release makes the owner take the lock back', () => {
  const fx = fixture();
  const unlink = fs.unlinkSync;
  let flaggedAtRelease = false;
  fs.unlinkSync = file => {
    // The release: just before the lock file goes, a late refresh finds it held and leaves the flag.
    if (file === fx.lockFile && !flaggedAtRelease) {
      flaggedAtRelease = true;
      fx.github.addComment(423, { body: 'A comment at release time' });
      assert.equal(fx.run(['refresh']).result.outcome, 'QUEUED');
    }
    return unlink(file);
  };
  let run;
  try { run = own(fx); } finally { fs.unlinkSync = unlink; }
  assert.equal(run.error, null);
  assert.equal(flaggedAtRelease, true);
  assert.equal(run.passes.length, 2, 'the owner took the lock back and ran once more');
  assert.equal(fs.existsSync(cli.againFile(fx.lockFile)), false);
  assert.equal(fx.run(['reconcile']).result.summary, 'No changes');
});

test('a long burst stops at the pass limit and leaves the flag for the next refresh', () => {
  const fx = fixture();
  let comments = 0;
  // Every write of every pass brings one more change and one more queued refresh.
  fx.github.hooks.push((call, github) => {
    if (call.method === 'GET' || !/issues\/423/.test(call.path) || comments >= 50) return null;
    comments += 1;
    github.addComment(423, { body: `burst ${comments}` });
    fs.writeFileSync(cli.againFile(fx.lockFile), 'x');
    return null;
  });
  const run = own(fx);
  assert.equal(run.error, null);
  assert.equal(run.passes.length, cli.MAX_PASSES);
  assert.equal(fs.existsSync(cli.againFile(fx.lockFile)), true, 'the flag stays for the next refresh or the sweep');
  assert.equal(fs.existsSync(fx.lockFile), false, 'released');
  const queued = cli.takeLock(fx.lockFile);
  assert.ok(queued);
  assert.match(fx.run(['refresh']).result.reason, /next refresh or the hourly sweep does/);
  queued.release();
});

test('a pass that loses its lock stops before its next GitHub request', () => {
  const cases = {
    // A sleep longer than the abandon limit: another pass takes the lock from the live process.
    suspended: () => {
      const old = new Date(Date.now() - cli.LOCK_ABANDONED_MS - 60000);
      fs.utimesSync(fx.lockFile, old, old);
      assert.ok(cli.takeLock(fx.lockFile), 'the second pass took the lock');
    },
    // Any other way the lock at the path stops being this pass's (a three-way take-over).
    replaced: () => {
      const lock = JSON.parse(fs.readFileSync(fx.lockFile, 'utf8'));
      fs.writeFileSync(fx.lockFile, JSON.stringify({ ...lock, token: 'another-pass' }));
    },
  };
  let fx;
  for (const [name, act] of Object.entries(cases)) {
    fx = fixture();
    let at = null;
    firstWrite(fx, () => { act(); at = fx.github.calls.length; });
    const run = own(fx);
    assert.equal(run.error?.code, 'PASS_LOCK_LOST', name);
    assert.equal(writesAfter(fx, at), 0, `${name}: no GitHub request after the lock was lost`);
    assert.equal(fs.existsSync(fx.lockFile), true, `${name}: the other pass's lock is left in place`);
    assert.notEqual(JSON.parse(fs.readFileSync(fx.lockFile, 'utf8')).token, undefined);
  }
});

test('a pass that loses its lock before its first request leaves the flag for the new owner', () => {
  const fx = fixture();
  const link = fs.linkSync;
  let swapped = false;
  fs.linkSync = (from, to) => {
    link(from, to);
    // Right after this pass links its lock, another pass's lock replaces it and a queued refresh flags it.
    if (to === fx.lockFile && !swapped) {
      swapped = true;
      const lock = JSON.parse(fs.readFileSync(to, 'utf8'));
      fs.unlinkSync(to);
      fs.writeFileSync(to, JSON.stringify({ ...lock, token: 'pass-c' }));
      fs.writeFileSync(cli.againFile(fx.lockFile), 'd');
    }
  };
  let run;
  const before = fx.github.calls.length;
  try { run = own(fx); } finally { fs.linkSync = link; }
  assert.equal(run.error?.code, 'PASS_LOCK_LOST');
  assert.equal(writesAfter(fx, before), 0, 'no write');
  assert.equal(JSON.parse(fs.readFileSync(fx.lockFile, 'utf8')).token, 'pass-c');
  assert.equal(fs.existsSync(cli.againFile(fx.lockFile)), true, 'the flag left for the new owner is still there');
});

test('a takeover in the middle of a refresh stops it with STALE_WRITER and releases the lock', () => {
  const fx = fixture();
  firstWrite(fx, () => {
    const { doc, sha } = fx.store.read('parent', 421);
    fx.store.write('parent', 421, state.claimDocument(doc, { session: 'new-controller', prefix: 'INT-TK421-' }, { takeover: true }), { sha, previous: doc });
  });
  const run = own(fx);
  assert.equal(run.error?.code, 'STALE_WRITER');
  assert.equal(fs.existsSync(fx.lockFile), false, 'released');
});

test('the lock is never broken while its owner is alive and beating, and release removes only its own lock', () => {
  const dir = tmp();
  const file = path.join(dir, 'pass.lock');
  const a = cli.takeLock(file);
  assert.equal(cli.takeLock(file), null, 'held by a live owner');
  const old = new Date(Date.now() - cli.LOCK_STALE_MS - 60000);
  fs.utimesSync(file, old, old);
  assert.equal(cli.takeLock(file, { pidAlive: () => true }), null, 'a live owner on this computer is not taken over after a sleep');
  a.beat();
  assert.equal(cli.takeLock(file), null, 'a beat keeps it held');
  // Someone else's lock now sits at the path: A's release leaves it alone.
  const theirs = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...theirs, token: 'someone-else' }));
  a.release();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).token, 'someone-else');
  fs.unlinkSync(file);
});

// Closure matrix for the lock: what is at the path, its owner, its heartbeat, and the outcome.
const LOCK_MATRIX = [
  { name: 'nothing there', setup: () => {}, alive: true, taken: true },
  { name: 'live owner, fresh beat', setup: f => writeLock(f, {}), alive: true, taken: false },
  { name: 'live owner, beat a minute in the future', setup: f => writeLock(f, { beatMs: 60000 }), alive: true, taken: false },
  { name: 'dead owner, fresh beat', setup: f => writeLock(f, {}), alive: false, taken: true },
  { name: 'live owner, silent past 15 minutes (a sleep)', setup: f => writeLock(f, { beatMs: -cli.LOCK_STALE_MS - 60000 }), alive: true, taken: false },
  { name: 'live owner, beat far in the future (clock moved)', setup: f => writeLock(f, { beatMs: cli.LOCK_STALE_MS + 60000 }), alive: true, taken: false },
  { name: 'live process, silent past the abandon limit (a reused id)', setup: f => writeLock(f, { beatMs: -cli.LOCK_ABANDONED_MS - 60000 }), alive: true, taken: true },
  { name: 'dead owner, beat far in the future', setup: f => writeLock(f, { beatMs: cli.LOCK_STALE_MS + 60000 }), alive: false, taken: true },
  { name: 'owner on another host, beat far in the future', setup: f => writeLock(f, { host: 'elsewhere', beatMs: cli.LOCK_STALE_MS + 60000 }), alive: false, taken: true },
  { name: 'a link to a lock file', setup: f => { writeLock(`${f}.target`, {}); fs.symlinkSync(`${f}.target`, f); }, alive: true, taken: true, leaves: ['pass.lock.target'], links: true },
  { name: 'live process, lock from an earlier boot by uptime (a reused id)', setup: f => writeLock(f, { uptime: 7200 }), alive: true, taken: true, boot: { bootId: null, uptime: 60 } },
  { name: 'live process, lock from an earlier boot by boot id', setup: f => writeLock(f, { bootId: 'old', uptime: 10 }), alive: true, taken: true, boot: { bootId: 'new', uptime: 7200 } },
  { name: 'live process, same boot, soon after start, clock moved forward', setup: f => writeLock(f, { bootId: 'b', uptime: 120, beatMs: -3600000 }), alive: true, taken: false, boot: { bootId: 'b', uptime: 300 } },
  { name: 'live process, same boot by uptime, clock moved forward', setup: f => writeLock(f, { uptime: 120, beatMs: -3600000 }), alive: true, taken: false, boot: { bootId: null, uptime: 300 } },
  { name: 'owner on another host, fresh beat', setup: f => writeLock(f, { host: 'elsewhere' }), alive: false, taken: false },
  { name: 'owner on another host, silent past the limit', setup: f => writeLock(f, { host: 'elsewhere', beatMs: -cli.LOCK_STALE_MS - 60000 }), alive: false, taken: true },
  { name: 'unreadable file', setup: f => fs.writeFileSync(f, 'not json'), alive: true, taken: true },
  { name: 'a directory', setup: f => fs.mkdirSync(f), alive: true, taken: true },
];
function writeLock(file, { host = os.hostname(), beatMs = 0, bootId = null, uptime = 0 }) {
  fs.writeFileSync(file, JSON.stringify({ schema: 'toolkit.programme-pass-lock.v1', token: 'other', pid: 424242, host, boot_id: bootId, uptime, at: new Date().toISOString() }));
  const at = new Date(Date.now() + beatMs);
  fs.utimesSync(file, at, at);
}
for (const row of LOCK_MATRIX) {
  test(`lock matrix: ${row.name}`, t => {
    const file = path.join(tmp(), 'pass.lock');
    try { row.setup(file); }
    catch (error) {
      // A file link needs Developer Mode or admin rights on Windows.
      if (row.links && process.platform === 'win32' && error.code === 'EPERM') return t.skip('no symlink rights');
      throw error;
    }
    const handle = cli.takeLock(file, { pidAlive: () => row.alive, boot: row.boot || { bootId: null, uptime: 1e9 } });
    assert.equal(Boolean(handle), row.taken);
    if (handle) {
      assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).token, handle.token);
      handle.release();
      assert.deepEqual(fs.readdirSync(path.dirname(file)), row.leaves || [], 'nothing left beside the lock');
    }
  });
}

// Authority and closure matrix for the pass commands: who runs it, the parent's holder, and the lock.
const PASS_MATRIX = [
  { argv: ['refresh'], env: {}, held: 'controller', lock: 'free', expect: 'WROTE' },
  { argv: ['refresh'], env: { TOOLKIT_GATE_ROLE: 'G1' }, held: 'controller', lock: 'free', expect: 'WROTE' },
  { argv: ['refresh'], env: { TOOLKIT_NATIVE_HELPER_BINDING: 'h' }, held: 'controller', lock: 'free', expect: 'WROTE' },
  { argv: ['refresh'], env: {}, held: 'lane', lock: 'free', expect: 'PARENT_UNHELD' },
  { argv: ['refresh'], env: {}, held: 'none', lock: 'free', expect: 'PARENT_UNHELD' },
  { argv: ['refresh'], env: {}, held: 'missing', lock: 'free', expect: 'PARENT_STATE_MISSING' },
  { argv: ['refresh'], env: {}, held: 'controller', lock: 'live', expect: 'QUEUED' },
  { argv: ['refresh'], env: {}, held: 'controller', lock: 'dead', expect: 'WROTE' },
  { argv: ['reconcile', '--apply', '--controller', '--session', controller.session], env: {}, held: 'controller', lock: 'free', expect: 'WROTE' },
  { argv: ['reconcile', '--apply', '--controller', '--session', controller.session], env: {}, held: 'controller', lock: 'live', expect: 'PASS_RUNNING' },
  { argv: ['reconcile', '--apply', '--controller', '--session', controller.session], env: { TOOLKIT_GATE_ROLE: 'G2' }, held: 'controller', lock: 'free', expect: 'USAGE' },
  { argv: ['reconcile', '--apply', '--controller', '--session', 'someone-else'], env: {}, held: 'controller', lock: 'free', expect: 'STALE_WRITER' },
  { argv: ['reconcile', '--apply', '--controller', '--session', controller.session], env: {}, held: 'controller', lock: 'dead', expect: 'WROTE' },
  { argv: ['reconcile', '--apply', '--controller', '--session', controller.session], env: { TOOLKIT_NATIVE_HELPER_BINDING: 'h' }, held: 'controller', lock: 'free', expect: 'USAGE' },
  { argv: ['reconcile', '--apply', '--controller', '--session', 'lane-session', '--prefix', 'LANE-X-'], env: {}, held: 'controller', lock: 'free', expect: 'ROLE_REFUSED' },
  { argv: ['reconcile', '--apply', '--controller', '--session', controller.session], env: {}, held: 'none', lock: 'free', expect: 'STALE_WRITER' },
  { argv: ['reconcile', '--apply', '--controller', '--session', controller.session], env: {}, held: 'missing', lock: 'free', expect: 'PARENT_STATE_MISSING' },
  { argv: ['reconcile'], env: { TOOLKIT_GATE_ROLE: 'G0' }, held: 'controller', lock: 'live', expect: 'DRY' },
];
for (const row of PASS_MATRIX) {
  test(`pass matrix: ${row.argv.join(' ')} | ${Object.keys(row.env)[0] || 'plain session'} | parent ${row.held} | lock ${row.lock}`, () => {
    const fx = fixture({ held: row.held });
    if (row.lock === 'live') cli.takeLock(fx.lockFile);
    if (row.lock === 'dead') {
      fs.mkdirSync(path.dirname(fx.lockFile), { recursive: true });
      writeLock(fx.lockFile, {});
    }
    const run = fx.run(row.argv, { environment: row.env, pidAlive: () => row.lock !== 'dead' });
    const got = run.error ? run.error.code : run.result.outcome || (run.result.mode === 'apply' ? 'WROTE' : 'DRY');
    assert.equal(got, row.expect, run.error?.message);
    const written = /AI-AGENT-TOOLKIT:programme-state/.test(fx.github.issues.get(423).body);
    assert.equal(written, row.expect === 'WROTE', 'pages written only by a pass that ran');
  });
}

// --- Hook paths ---

function governedCheckout() {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, '.github'));
  fs.writeFileSync(path.join(root, '.github', 'toolkit-programme.json'), JSON.stringify({ repository: 'acme/app' }));
  fs.mkdirSync(path.join(root, 'sub'));
  return root;
}

const post = (tool, toolInput, extra = {}) => ({ hook_event_name: 'PostToolUse', session_id: 's1', cwd: extra.cwd || '/nowhere', tool_name: tool, tool_input: toolInput, ...extra });

test('GitHub writes are recognised; reads and other repositories are not', () => {
  const writes = [
    post('mcp__github__issue_write', { owner: 'acme', repo: 'app', method: 'update' }),
    post('mcp__github__add_issue_comment', { owner: 'acme', repo: 'app' }),
    post('mcp__github__merge_pull_request', { owner: 'acme', repo: 'app' }),
    post('mcp__plugin_engineering_github__push_files', { owner: 'acme', repo: 'app' }),
    post('Bash', { command: 'gh pr create --fill' }),
    post('Bash', { command: 'gh issue comment 421 --body-file x.md' }),
    post('PowerShell', { command: 'gh.exe pr merge 12 --merge' }),
    post('Bash', { command: 'gh api repos/acme/app/issues/1 -X PATCH -f body=x' }),
    post('Bash', { command: 'gh api repos/acme/app/issues/1/comments -f body=x' }),
    post('Bash', { command: 'gh api graphql -f query="mutation { x }"' }),
    post('Bash', { command: 'git push -u origin feature' }),
    post('Bash', { command: ['bash', '-lc', 'git -C repo push'] }),
    post('Bash', { command: 'git --no-pager -c push.default=current push' }),
    post('Bash', { command: 'gh pr update-branch 12' }),
    post('mcp__github__create_issue', { owner: 'acme', repo: 'app' }),
    post('mcp__github__add_sub_issue', { owner: 'acme', repo: 'app' }),
    post('mcp__github__submit_pending_pull_request_review', { owner: 'acme', repo: 'app' }),
    post('Bash', { command: 'gh api -X GET repos/a/b/issues && gh api -X POST repos/a/b/issues/1/comments -f body=x' }),
    post('Bash', { command: 'gh api graphql -f query="{ viewer { login } }" && gh api repos/a/b/issues -f title=x' }),
    post('Bash', { command: 'gh api repos/acme/app-Xtra/issues -f title=x' }),
    post('PowerShell', { command: '& git.exe -C $env:USERPROFILE\\repo push' }),
    post('Bash', { command: 'git status && git push' }),
    post('Bash', { command: 'bash -lc "git push"' }),
    post('Bash', { command: "sh -c 'git push origin main'" }),
    post('PowerShell', { command: 'powershell -Command "git push origin feature"' }),
    post('PowerShell', { command: 'pwsh -c "git -C repo push"' }),
    post('PowerShell', { command: "pwsh -Command 'git push'" }),
    post('Bash', { command: 'cmd /c "git push"' }),
    post('PowerShell', { command: 'powershell -NoProfile -Command "git push"' }),
    post('PowerShell', { command: 'powershell -NoProfile -ExecutionPolicy Bypass -Command "git push"' }),
    post('Bash', { command: 'cmd.exe /d /c "git push"' }),
    post('Bash', { command: 'bash -e -c "git push"' }),
    post('Bash', { command: 'bash --norc -c "git push"' }),
    post('Bash', { command: '"C:/Program Files/Git/bin/bash.exe" -c "git push"' }),
    post('Bash', { command: 'bash -lc "cd repo && git push"' }),
  ];
  for (const input of writes) assert.ok(trigger.githubWrite(input), `${input.tool_name} ${JSON.stringify(input.tool_input)}`);
  assert.equal(trigger.githubWrite(writes[0]).repository, 'acme/app');
  assert.equal(trigger.githubWrite(writes[4]).repository, null);
  const reads = [
    post('mcp__github__issue_read', { owner: 'acme', repo: 'app' }),
    post('mcp__github__list_pull_requests', { owner: 'acme', repo: 'app' }),
    post('mcp__notion__notion-create-pages', {}),
    post('mcp__slack__issue_write', {}),
    post('Bash', { command: 'gh pr view 12 --json state' }),
    post('Bash', { command: 'gh api repos/acme/app/issues/1' }),
    post('Bash', { command: 'git status && git log' }),
    post('Bash', { command: 'gh api -X GET search/issues -f q=repo:acme/app' }),
    post('Bash', { command: 'gh api graphql -f query="{ viewer { login } }"' }),
    post('Bash', { command: 'git -c push.default=current status' }),
    post('Bash', { command: 'git -C push' }),
    post('Bash', { command: 'git --version; push' }),
    post('Bash', { command: 'git -ab push' }),
    post('Bash', { command: 'git -- push' }),
    post('Bash', { command: 'echo "git push"' }),
    post('Bash', { command: 'git commit -m "git push"' }),
    post('Bash', { command: "git commit -m 'git push'" }),
    post('Bash', { command: 'printf "%s" "git push"' }),
    post('Bash', { command: 'git log --grep "git push"' }),
    post('Bash', { command: 'grep -c "git push" notes.md' }),
    post('Bash', { command: 'echo "run git push"' }),
    post('Bash', { command: 'git commit -m "then git push"' }),
    post('Bash', { command: `bash -c "echo 'run git push'"` }),
    post('Bash', { command: 'echo "cd repo && git push"' }),
    post('Bash', { command: 'bash x.sh; grep -c "git push" f' }),
    post('Edit', { file_path: 'x' }),
  ];
  for (const input of reads) assert.equal(trigger.githubWrite(input), null, `${input.tool_name} ${JSON.stringify(input.tool_input)}`);
});

test('a marked session starts one refresh per governed checkout at turn end, then the mark is gone', () => {
  const root = governedCheckout();
  const deps = { refreshDir: tmp(), governanceState: GOVERNED, started: [] };
  deps.start = folder => deps.started.push(folder);
  assert.equal(hook.main({ ...deps, stdin: JSON.stringify(post('Bash', { command: 'gh pr create' }, { cwd: path.join(root, 'sub') })) }), 0);
  assert.equal(hook.main({ ...deps, stdin: JSON.stringify(post('mcp__github__issue_write', { owner: 'Acme', repo: 'App' }, { cwd: root })) }), 0);
  assert.equal(fs.readdirSync(deps.refreshDir).length, 1, 'one mark for the session');
  assert.equal(hook.main({ ...deps, stdin: JSON.stringify({ hook_event_name: 'Stop', session_id: 's1', cwd: root }) }), 0);
  assert.deepEqual(deps.started, [root]);
  assert.deepEqual(fs.readdirSync(deps.refreshDir), [], 'mark cleared');
  assert.equal(trigger.onStop({ session_id: 's1', cwd: root }, deps).outcome, 'UNMARKED', 'the next turn end starts nothing');
});

test('write detection stays fast on long commands', () => {
  for (const command of ['git '.repeat(12000), `git${' --a=/git'.repeat(24000)} x`, ` -C git`.repeat(24000), `${'some prose about git and how to push it. '.repeat(5000)}`, `git${' -c -0'.repeat(50000)} x`]) {
    const started = Date.now();
    trigger.githubWrite(post('Bash', { command }));
    assert.ok(Date.now() - started < 1000, `${command.length} characters took ${Date.now() - started} ms`);
  }
});

test('two checkouts of one repository start one refresh; marks older than a day are pruned', () => {
  const first = governedCheckout();
  const second = governedCheckout();
  const deps = { refreshDir: tmp(), governanceState: GOVERNED, started: [] };
  deps.start = folder => deps.started.push(folder);
  trigger.markWrite(post('Bash', { command: 'gh pr create' }, { cwd: first }), deps);
  trigger.markWrite(post('Bash', { command: 'git push' }, { cwd: second }), deps);
  const orphan = trigger.markFile('orphan', deps);
  fs.writeFileSync(orphan, '{}');
  const old = new Date(Date.now() - trigger.MARK_MAX_AGE_MS - 60000);
  fs.utimesSync(orphan, old, old);
  assert.equal(trigger.onStop({ session_id: 's1', cwd: first }, deps).outcome, 'STARTED');
  assert.deepEqual(deps.started, [first]);
  assert.deepEqual(fs.readdirSync(deps.refreshDir), [], 'the orphaned mark is gone too');
});

test('a background start that fails later never throws or prints, and each checkout keeps its own log', () => {
  const dir = tmp();
  const root = governedCheckout();
  const script = `const t = require(${JSON.stringify(require.resolve('../../skills/github-program-reconciler/scripts/programme-refresh-trigger.cjs'))});
    process.execPath = ${JSON.stringify(path.join(dir, 'no-such-node'))};
    t.startRefresh(${JSON.stringify(root)}, { refreshDir: ${JSON.stringify(dir)} });`;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 30000 });
  assert.deepEqual([result.status, result.stdout, result.stderr], [0, '', '']);
  assert.ok(fs.existsSync(trigger.lastRunFile({ refreshDir: dir }, root)));
  assert.notEqual(trigger.lastRunFile({ refreshDir: dir }, root), trigger.lastRunFile({ refreshDir: dir }, governedCheckout()));
});

test('no refresh for unmarked sessions, other repositories, ungoverned folders or governance off', () => {
  const root = governedCheckout();
  const base = { refreshDir: tmp(), started: [] };
  const start = folder => base.started.push(folder);
  const cases = [
    [post('mcp__github__issue_write', { owner: 'other', repo: 'thing' }, { cwd: root }), GOVERNED, 'NOT_GOVERNED'],
    [post('Bash', { command: 'gh pr create' }, { cwd: tmp() }), GOVERNED, 'NOT_GOVERNED'],
    [post('Bash', { command: 'gh pr create' }, { cwd: root }), () => ({ state: 'DISABLED' }), 'NOT_GOVERNED'],
  ];
  for (const [input, governanceState, outcome] of cases) {
    const deps = { ...base, governanceState, start };
    trigger.markWrite(input, deps);
    assert.equal(trigger.onStop({ session_id: 's1', cwd: input.cwd }, deps).outcome, outcome);
  }
  assert.equal(trigger.onStop({ session_id: 'never-wrote', cwd: root }, { ...base, governanceState: GOVERNED, start }).outcome, 'UNMARKED');
  assert.deepEqual(base.started, []);
});

test('the real hook script marks nothing for reads, exits 0 and prints nothing', () => {
  const home = tmp();
  for (const input of [post('mcp__github__issue_read', { owner: 'acme', repo: 'app' }), { hook_event_name: 'Stop', session_id: 'nobody', cwd: home }, 'not json']) {
    const result = spawnSync(process.execPath, [path.join(ROOT, 'repo', 'scripts', 'toolkit-programme-checkpoint-hook.cjs')], {
      input: typeof input === 'string' ? input : JSON.stringify(input), env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8', timeout: 30000,
    });
    assert.deepEqual([result.status, result.stdout], [0, '']);
  }
  assert.equal(fs.existsSync(path.join(home, '.ai-agent-toolkit')), false);
});

test('the shipped hooks send after-tool events for shell and connector tools to the same script', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'repo/contracts/programme-state/host-contract-v1.json'), 'utf8'));
  const spec = contract.after_tool_hook;
  assert.equal(spec.script, contract.turn_end_hook.script);
  for (const [host, hostSpec] of Object.entries(contract.hosts)) {
    for (const file of [hostSpec.hooks_file, `repo/contracts/toolkit-local-bridge/${host === 'codex' ? 'codex' : 'claude'}-plugin/hooks/hooks.json`]) {
      const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')).hooks;
      // Other after-tool hooks (Claude Code's governance card) may sit beside it; this script has exactly one entry.
      const checkpoint = hooks[spec.event].filter(entry => entry.hooks.some(hook => hook.command.includes(spec.script)));
      assert.deepEqual(checkpoint, [{ matcher: hostSpec.after_tool_matcher, hooks: [{ type: 'command', command: `node "\${${hostSpec.plugin_root_variable}}/${spec.script}"`, timeout: spec.timeout_seconds }] }], file);
    }
  }
});
