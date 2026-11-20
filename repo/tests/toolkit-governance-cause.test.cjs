'use strict';

// A session start that cannot check governance says why, in fixed words (I2), with governed effects
// exactly as before (I1); the hook and `status` agree (I3); a cloud session start reads its
// repositories side by side, so one slow read never spends another's time (T6).
const { assert, fs, path, test, scripts, gate, governance, claudeHook, scratch, gitRepo, stateOf } = require('./toolkit-governance-gate-support.cjs');
const cache = require(path.join(scripts, 'toolkit-governance-binding.cjs'));
// Loaded where used, so each row fails on its own on a copy without the side-by-side read.
const refresher = () => require(path.join(scripts, 'toolkit-governance-refresh.cjs'));
const { seedMerged } = require('./support/governance-observations.cjs');
const STAND_IN = path.join(__dirname, 'support', 'governance-refresh-stand-in.cjs');
const { TIME_MS } = require(STAND_IN);

const SENTINEL = 'SENTINEL-7f3a-stderr-or-env';
const SHA = 'a'.repeat(40);
const computerStart = (ctx, repo, refresh, extra = {}) => claudeHook.respond('SessionStart', { cwd: repo, session_id: 's1', source: 'startup' },
  { registryOptions: ctx.options, environment: {}, refreshBinding: () => refresh, ...extra }).hookSpecificOutput.additionalContext;
// The last read on this computer failed (the cache keeps the decision and notes the failure).
const failedBefore = (ctx, repo, error = 'remote-unreachable') => {
  const dir = path.dirname(ctx.registryPath);
  cache.writeCache(dir, { ...cache.readBindingCache(governance.readIdentity(repo), dir), refresh_error: error });
};

test('T1: a session start whose own read was held names the cause; governed effects still hold', (t) => {
  const ctx = scratch(t);
  const unknown = gitRepo(ctx, 'unknown');
  failedBefore(ctx, unknown);
  const line = computerStart(ctx, unknown, { refreshed: false, error: 'remote-redirected' });
  assert.match(line, /^Toolkit: couldn't check governance \(git settings here would send the read somewhere other than origin\)\. Continue with the global rules; no governance effects or standing task auto-merge until it can be checked\.$/m);
  const enabled = gitRepo(ctx, 'enabled');
  seedMerged(enabled, 'enable', { registryOptions: ctx.options });
  failedBefore(ctx, enabled);
  const decided = computerStart(ctx, enabled, { refreshed: false, error: 'fetch-failed' });
  assert.match(decided, /^Toolkit: couldn't check governance \(the default branch could not be fetched\)\. The last repository decision was enabled\. Ordinary work continues without governance effects or standing task auto-merge until it can be checked\./m);
  const state = stateOf(ctx, enabled);
  assert.deepEqual([state.state, state.governed_effects_hold, state.notes.includes('could-not-check-governance')], ['ENABLED', true, true], 'I1: the cause text changes no effect');
});

test('T2: every cause is a fixed phrase; an unknown or missing code gets a generic one; nothing from git, the environment or a path is shown', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'table');
  seedMerged(repo, 'enable', { registryOptions: ctx.options });
  const rows = [...Object.entries(cache.REFRESH_CAUSES),
    ['IDENTITY_UNREADABLE', "this repository's origin could not be read"],
    [`x-${SENTINEL}`, 'an unrecognised read failure'],
    [`${SENTINEL}\nset GIT_CONFIG_PARAMETERS`, 'an unrecognised read failure']];
  assert.ok(rows.length >= 14, 'every code the read and the refresh can give');
  for (const [code, phrase] of rows) {
    failedBefore(ctx, repo, code);
    const line = computerStart(ctx, repo, { refreshed: false, error: code }, { environment: { GIT_CONFIG_PARAMETERS: SENTINEL } });
    assert.ok(line.includes(`couldn't check governance (${phrase}). The last repository decision was enabled.`), `${JSON.stringify(code)}: ${line.slice(0, 160)}`);
    assert.doesNotMatch(line, new RegExp(SENTINEL), JSON.stringify(code));
    assert.doesNotMatch(line, new RegExp(ctx.root.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')), 'no path');
  }
  // No read this start (a /clear or compaction) and none recorded: it says so.
  assert.equal(cache.refreshCause(null), 'the cause was not recorded');
  // A read that succeeded, or a repository that is not on github.com, never stands in for a cause.
  failedBefore(ctx, repo, 'remote-unreachable');
  assert.match(computerStart(ctx, repo, { refreshed: false, error: 'not-applicable' }), /couldn't check governance \(GitHub could not be reached\)/, 'the recorded cause');
  // I5: a hook whose refresh throws still gives one line and never fails the start.
  assert.match(claudeHook.respond('SessionStart', { cwd: repo, session_id: 's2', source: 'startup' }, { registryOptions: ctx.options, environment: {}, refreshBinding: () => { throw new Error(SENTINEL); } }).hookSpecificOutput.additionalContext,
    /couldn't check governance \(GitHub could not be reached\)/);
});

test('T3: the hook and status give the same state word, and for a held read the same cause', async (t) => {
  const ctx = scratch(t);
  const { ToolkitGovernanceCli } = require(path.join(scripts, 'toolkit-governance.cjs'));
  const status = async (repo, refresh) => {
    const out = [];
    const cli = new ToolkitGovernanceCli({ cwd: repo, registryOptions: ctx.options, interactive: false, stdout: { write: text => out.push(text) }, stderr: { write: () => {} }, refresh: () => refresh });
    await cli.main(['status', '--json']);
    return JSON.parse(out.join(''));
  };
  const enabled = gitRepo(ctx, 'agree-enabled');
  seedMerged(enabled, 'enable', { registryOptions: ctx.options });
  assert.match(computerStart(ctx, enabled, { refreshed: true }), /^Toolkit governance: ENABLED for this repository\./m);
  assert.equal((await status(enabled, { refreshed: true })).state, 'ENABLED');
  for (const code of ['read-timed-out', 'remote-redirected']) {
    failedBefore(ctx, enabled, code);
    const held = await status(enabled, { refreshed: false, error: code });
    assert.deepEqual([held.state, held.notes.includes('could-not-check-governance'), held.refresh.reason, held.merged.refresh_error], ['ENABLED', true, code, code]);
    assert.ok(computerStart(ctx, enabled, { refreshed: false, error: code }).includes(`(${cache.refreshCause(code)}). The last repository decision was enabled.`));
  }
  const unavailable = gitRepo(ctx, 'agree-unavailable');
  failedBefore(ctx, unavailable, 'fetch-failed');
  const held = await status(unavailable, { refreshed: false, error: 'fetch-failed' });
  assert.deepEqual([held.state, held.refresh.reason], ['UNAVAILABLE', 'fetch-failed']);
  assert.ok(computerStart(ctx, unavailable, { refreshed: false, error: 'fetch-failed' }).includes(`couldn't check governance (${cache.refreshCause('fetch-failed')}). Continue`));
  const disabled = gitRepo(ctx, 'agree-disabled');
  seedMerged(disabled, 'disable', { registryOptions: ctx.options });
  assert.match(computerStart(ctx, disabled, { refreshed: true }), /^Toolkit governance: DISABLED for this repository/m);
  assert.equal((await status(disabled, { refreshed: true })).state, 'DISABLED');
});

// A git runner that answers the bounded read for an enabled binding; `slowFetch` holds the fetch
// until its time limit, as a cold network does.
function binding(repo) {
  const repository = governance.remoteSlug(governance.readIdentity(repo).remote);
  return JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository, governance: 'enabled', parents: [{ issue: 1, record_prefix: 'INT-FX-' }],
    store: { kind: 'github', repository: 'example-owner/evidence-store', branch: 'main', path: 'state/' }, required_checks: ['validate'] });
}
function runGitFor(repo, { slowFetch = false } = {}) {
  const text = binding(repo);
  const ok = out => ({ status: 0, stdout: Buffer.from(out), stderr: Buffer.alloc(0) });
  return (args, { timeout }) => {
    if (args[0] === 'ls-remote' && args[1] === '--get-url') return ok(`${governance.readIdentity(repo).remote.canonical}\n`);
    if (args[0] === 'config') return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    if (args[0] === 'ls-remote') return ok(`ref: refs/heads/main\tHEAD\n${SHA}\tHEAD\n`);
    if (args.includes('fetch')) {
      if (!slowFetch) return ok('');
      const until = Date.now() + timeout + 5;
      while (Date.now() < until) { /* held until its limit */ }
      return { status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    }
    if (args[0] === 'rev-parse' && args.includes('--git-common-dir')) return ok('.git\n');
    if (args[0] === 'rev-parse') return ok(`${SHA}\n`);
    if (args[0] === 'ls-tree') return ok(`100644 blob ${'c'.repeat(40)} ${text.length}\t.github/toolkit-programme.json\n`);
    if (args[0] === 'cat-file') return ok(text);
    return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  };
}

test('T6: a read whose time ran out says so at session start; a later status that reads it says ENABLED with no note', async (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'timed');
  seedMerged(repo, 'enable', { registryOptions: ctx.options });
  const read = (options) => governance.refreshMergedBinding(repo, ctx.options, options);
  const started = claudeHook.respond('SessionStart', { cwd: repo, session_id: 's1', source: 'resume' },
    { registryOptions: ctx.options, environment: {}, refreshBinding: () => read({ runGit: runGitFor(repo, { slowFetch: true }), deadline: Date.now() + 150 }) }).hookSpecificOutput.additionalContext;
  assert.match(started, /^Toolkit: couldn't check governance \(a read of GitHub ran out of time\)\. The last repository decision was enabled\./m);
  const { ToolkitGovernanceCli } = require(path.join(scripts, 'toolkit-governance.cjs'));
  const out = [];
  const cli = new ToolkitGovernanceCli({ cwd: repo, registryOptions: ctx.options, interactive: false, stdout: { write: text => out.push(text) }, stderr: { write: () => {} }, refresh: () => read({ runGit: runGitFor(repo) }) });
  assert.equal(await cli.main(['status']), 0);
  const text = out.join('');
  assert.match(text, /ENABLED/);
  assert.doesNotMatch(text, /Couldn't check governance|Refresh held/);
  assert.equal(stateOf(ctx, repo).merged.refresh_error, null, 'the successful read clears the recorded failure');
});

test('T6: the binding read tells a timed-out call from a refused one', () => {
  const NO_HOOKS = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'toolkit-cause-hooks-'));
  try {
    const remote = 'https://github.com/example-owner/example-repo.git';
    const guarded = { expectedRemote: remote, hooksDir: NO_HOOKS, environment: {} };
    const answers = (fetch, getUrl = { status: 0, stdout: Buffer.from(`${remote}\n`), stderr: Buffer.alloc(0) }) => (args, { timeout }) => {
      if (args[0] === 'ls-remote' && args[1] === '--get-url') return typeof getUrl === 'function' ? getUrl(timeout) : getUrl;
      if (args[0] === 'config') return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      if (args[0] === 'ls-remote') return { status: 0, stdout: Buffer.from(`ref: refs/heads/main\tHEAD\n${SHA}\tHEAD\n`), stderr: Buffer.alloc(0) };
      if (args.includes('fetch')) return fetch(timeout);
      return { status: 1, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    };
    const killedAtLimit = timeout => { const until = Date.now() + timeout + 2; while (Date.now() < until) { /* busy */ } return { status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }; };
    const refused = () => ({ status: 128, stdout: Buffer.alloc(0), stderr: Buffer.from(SENTINEL) });
    const notStarted = () => ({ status: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) });
    assert.equal(cache.readDefaultBranchBinding('/r', { ...guarded, deadline: Date.now() + 60, runGit: answers(killedAtLimit) }).error, 'read-timed-out', 'stopped at the deadline');
    assert.equal(cache.readDefaultBranchBinding('/r', { ...guarded, timeout: 40, runGit: answers(killedAtLimit) }).error, 'read-timed-out', 'stopped at its own limit');
    assert.equal(cache.readDefaultBranchBinding('/r', { ...guarded, runGit: answers(refused) }).error, 'fetch-failed', 'refused with time left');
    assert.equal(cache.readDefaultBranchBinding('/r', { ...guarded, runGit: answers(notStarted) }).error, 'fetch-failed', 'git that could not start is not a timeout');
    assert.equal(cache.readDefaultBranchBinding('/r', { ...guarded, runGit: answers(refused, { status: 128, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }) }).error, 'remote-unreachable');
    assert.equal(cache.readDefaultBranchBinding('/r', { ...guarded, deadline: Date.now() - 1, runGit: answers(refused) }).error, 'read-timed-out', 'the budget was already spent');
    assert.match(cache.refreshReason('read-timed-out'), /ran out of time/, 'status words it too');
  } finally { fs.rmSync(NO_HOOKS, { recursive: true, force: true }); }
});

test('T6: a cloud session start reads its repositories side by side, so a slow first one never starves the rest', (t) => {
  const ctx = scratch(t);
  const names = ['a-slow', 'b-next', 'c-last'];
  for (const name of names) {
    const repo = gitRepo(ctx, name, { remote: `https://github.com/example-owner/${name}.git` });
    seedMerged(repo, 'enable', { registryOptions: ctx.options });
    failedBefore(ctx, repo);
  }
  const began = Date.now();
  const text = gate.cloudSessionText(ctx.root, { registryOptions: ctx.options, deadline: Date.now() + TIME_MS, refreshWorker: STAND_IN });
  const took = Date.now() - began;
  assert.match(text, /- example-owner\/a-slow: Toolkit: couldn't check governance \(a read of GitHub ran out of time\)\./);
  for (const name of ['b-next', 'c-last']) assert.match(text, new RegExp(`- example-owner/${name}: Toolkit: couldn't check governance \\(the default branch could not be fetched\\)\\.`), `${name} had its own time`);
  assert.ok(took < TIME_MS + refresher().REPORT_GRACE_MS + 1500, `one deadline for all, not one each (${took} ms)`);
});

test('the side-by-side read: a thread that never reports counts as timed out, one that fails as failed, and the wait is bounded', (t) => {
  const ctx = scratch(t);
  const roots = ['hang-1', 'throw-1', 'ok-1'].map(name => gitRepo(ctx, name, { remote: `https://github.com/example-owner/${name}.git` }));
  const began = Date.now();
  const results = refresher().refreshAll(roots, { registryOptions: ctx.options, deadline: Date.now() + TIME_MS, module: STAND_IN, grace: 200 });
  const took = Date.now() - began;
  assert.deepEqual(roots.map(root => results.get(root)), [
    { refreshed: false, error: 'read-timed-out' },
    { refreshed: false, error: 'refresh-failed' },
    { refreshed: false, error: 'fetch-failed' },
  ]);
  assert.ok(took < TIME_MS + 200 + 1000, `bounded (${took} ms)`);
  assert.deepEqual([...refresher().refreshAll([], { deadline: Date.now() + 100 }).entries()], []);
  // The real refresh in a test registry reads nothing (offline), in a thread too.
  assert.deepEqual(refresher().refreshAll([roots[2]], { registryOptions: ctx.options, deadline: Date.now() + 2000 }).get(roots[2]), { refreshed: false, error: 'offline' });
});
