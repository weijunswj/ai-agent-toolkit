'use strict';

// The closure matrix of "not complete means not working" (G0 plan section 4.3, INT-TK421-1386 and 1387):
// every action against every governance state, for each role that may run it, as one table; the
// readiness reader against hostile parts-cache files; and each choke point run for real on a governed
// fixture (programme writes, gate checkpoints, task auto-merge, merge trains), held while not ready and
// running for an older programme file. Fixtures only: a scratch home, fake transports, no network.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { governedHome } = require('./toolkit-governed-fixture-support.cjs');
const hostile = require('./support/hostile-inputs.cjs');
const { APP, HOLD_FROM, PERMISSIONS, STORE, SLUG, readyRepo } = require('./support/governance-ready-fixture.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
// These rows are about a computer session: a CI runner's own markers would make every run a cloud
// session, which has no computer permissions part. Cleared for this test process only.
delete process.env.GITHUB_ACTIONS;
delete process.env.CLAUDE_CODE_REMOTE;
const ready = require('../scripts/toolkit-governance-ready.cjs');
const parts = require('../scripts/toolkit-governance-parts.cjs');

// ---- the matrix -------------------------------------------------------------------------------------

const BOUND = { state: 'ENABLED', programme_records_bind: true, root: '/fixture', repository_id: 'repo-1', repository: SLUG };
const USABLE = { repository: STORE, state: 'usable' };
// Each state of PLAN 4.2 as (governance state, saved parts, this computer's permissions, min_toolkit).
const STATES = {
  U: [{ state: 'UNDECIDED' }, null, PERMISSIONS.never, HOLD_FROM],
  P: [{ ...BOUND, programme_records_bind: false }, null, PERMISSIONS.never, HOLD_FROM],
  D: [{ state: 'DISABLED' }, null, PERMISSIONS.never, HOLD_FROM],
  N: [BOUND, { app: APP.missing, store: USABLE }, PERMISSIONS.current, HOLD_FROM],
  K: [BOUND, { app: null, store: null }, PERMISSIONS.current, HOLD_FROM],
  R: [BOUND, { app: APP.found, store: USABLE }, PERMISSIONS.drift, HOLD_FROM],
  L: [BOUND, { app: APP.missing, store: USABLE }, PERMISSIONS.never, '3.137.0'],
};
const judge = name => {
  const [state, saved, permissions, minToolkit] = STATES[name];
  return ready.readiness(state, {}, { parts: saved, store: STORE, permissions: () => permissions, minToolkit, environment: {} });
};

// Action x column: U/Q/P, N owner-started, N launched, N cloud sweep, R/K/L, D. null runs; the holds
// for U/P and D are the existing governance-off refusals, not the readiness hold.
const MATRIX = [
  ['programme-write', { N: 'refuse', launched: 'refuse', cloud: null }],
  ['checkpoint', { N: 'queue', launched: 'queue', cloud: null }],
  ['task-auto-merge', { N: 'refuse', launched: 'refuse', cloud: null }],
  ['merge-train', { N: 'refuse', launched: 'refuse', cloud: null }],
  ['owner-merge', { N: null, launched: null, cloud: null }],
  ['evidence-save', { N: null, launched: null, cloud: null }],
  ['setup', { N: null, launched: null, cloud: null }],
  ['programme-read', { N: null, launched: null, cloud: null }],
  ['coding', { N: null, launched: null, cloud: null }],
];

test('RM-1 the closure matrix: every action in every state, for every role', () => {
  assert.equal(HOLD_FROM, ready.HOLD_FROM, 'the fixture writes the first version the hold reads');
  const expected = { U: 'U', P: 'U', D: 'D', N: 'N', K: 'K', R: 'R', L: 'L' };
  for (const [name, wanted] of Object.entries(expected)) assert.equal(ready.matrixState(STATES[name][0], judge(name)), wanted, name);
  assert.deepEqual(MATRIX.map(([action]) => action).sort(), Object.keys(ready.HOLDS).sort(), 'every action has a row');
  for (const [action, held] of MATRIX) {
    for (const name of ['U', 'P', 'D', 'K', 'R', 'L']) assert.equal(ready.holdFor(action, judge(name)), null, `${action} in ${name}`);
    // A launched session holds as the owner's own does; the cloud sweep's write is RM-4's online row.
    assert.equal(ready.holdFor(action, judge('N')), held.N, `${action}, N, owner-started`);
    assert.equal(held.launched, held.N, `${action}, N, launched`);
  }
  assert.throws(() => ready.holdFor('merge-everything', judge('N')), /unknown action/);
});

test('RM-2 only parts that are gone hold: App, store or permissions never set up; drift and unknown never do', () => {
  const cases = [
    ['App missing', { app: APP.missing, store: USABLE }, PERMISSIONS.current, ['app']],
    ['App partly set up', { app: { variable: 'found', secret: 'missing' }, store: USABLE }, PERMISSIONS.current, ['app']],
    ['store not private', { app: APP.found, store: { repository: STORE, state: 'not-private' } }, PERMISSIONS.current, ['store']],
    ['store missing', { app: APP.found, store: { repository: STORE, state: 'missing' } }, PERMISSIONS.current, ['store']],
    ['store read-only', { app: APP.found, store: { repository: STORE, state: 'read-only' } }, PERMISSIONS.current, ['store']],
    ['permissions never set up', { app: APP.found, store: USABLE }, PERMISSIONS.never, ['permissions']],
    ['all three', { app: APP.missing, store: { repository: STORE, state: 'missing' } }, PERMISSIONS.never, ['app', 'store', 'permissions']],
    ['permissions drift', { app: APP.found, store: USABLE }, PERMISSIONS.drift, []],
    ['old permission lines only', { app: APP.found, store: USABLE }, { ...PERMISSIONS.never, stale: 3 }, []],
    ['App unread', { app: APP.unread, store: USABLE }, PERMISSIONS.current, []],
    ['store result for another store', { app: APP.found, store: { repository: 'example-owner/old-store', state: 'missing' } }, PERMISSIONS.current, []],
    ['store unverified', { app: APP.found, store: { repository: STORE, state: 'unverified' } }, PERMISSIONS.current, []],
    ['permissions unreadable', { app: APP.found, store: USABLE }, { checked: false }, []],
    ['nothing saved yet', null, PERMISSIONS.current, []],
  ];
  for (const [name, saved, permissions, missing] of cases) {
    const result = ready.readiness(BOUND, {}, { parts: saved, store: STORE, permissions: () => permissions, minToolkit: HOLD_FROM, environment: {} });
    assert.deepEqual(result.missing.map(item => item.part), missing, name);
    assert.equal(result.ready, missing.length === 0, name);
    for (const item of result.missing) assert.match(item.step, /^say `toolkit (governance|permissions)`|^sign in|^make it private|^give this computer/, `${name}: one step`);
  }
  // A cloud session has no computer: this computer's permissions are not its part.
  const cloud = ready.readiness(BOUND, {}, { parts: { app: APP.found, store: USABLE }, store: STORE, permissions: () => PERMISSIONS.never, minToolkit: HOLD_FROM, environment: { GITHUB_ACTIONS: 'true' } });
  assert.equal(cloud.ready, true);
  // A reader that throws is unknown, never missing.
  const thrown = ready.readiness(BOUND, {}, { parts: { app: APP.found, store: USABLE }, store: STORE, permissions: () => { throw new Error('boom'); }, minToolkit: HOLD_FROM, environment: {} });
  assert.deepEqual([thrown.ready, thrown.unknown], [true, ['permissions']]);
  // Refusal text: what waits, each part and its step, nothing changed, saves still work.
  const line = ready.heldLine(judge('N'), 'programme update');
  assert.match(line, /^Toolkit governance is on but held until setup is complete, so programme update waits\. Governance App: not set up on example-owner\/example-repo .*; say `toolkit governance` for the one line that sets it up\. .*evidence saves still work\. Nothing changed\.$/);
  assert.doesNotMatch(line, /nothing waits on it|no action needed/i);
});

// ---- hostile parts-cache files ----------------------------------------------------------------------

test('RM-3 a hostile parts cache never holds and never throws: each unreadable value is unknown', t => {
  const home = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'toolkit-ready-hostile-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const registryOptions = { testOnly: true, stateDirectory: path.join(home, 'state') };
  const file = path.join(registryOptions.stateDirectory, parts.BASENAME);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const write = repositories => fs.writeFileSync(file, typeof repositories === 'string' ? repositories : JSON.stringify({ schema: parts.SCHEMA, repositories }));
  const judgeSaved = () => ready.readiness(BOUND, registryOptions, { store: STORE, permissions: () => PERMISSIONS.current, minToolkit: HOLD_FROM, environment: {} });
  // Each hostile text as the App's state and as the store's: the reader accepts none of them.
  const list = hostile.cases(hostile.FAMILIES);
  hostile.expectDefaultDeny(assert, text => {
    write({ 'repo-1': { app: { variable: text, secret: text }, store: { repository: STORE, state: text }, checked_at: text } });
    const result = judgeSaved();
    return result.parts.app !== 'unknown' || result.parts.store !== 'unknown' || !result.ready;
  }, list);
  // Whole-file shapes: not JSON, the wrong schema, arrays, strings, prototype keys, huge values.
  const big = 'x'.repeat(2 * 1024 * 1024);
  const shapes = [
    'not json', '', '[]', 'null', JSON.stringify({ schema: 'other', repositories: { 'repo-1': { app: APP.missing } } }),
    JSON.stringify({ schema: parts.SCHEMA, repositories: [] }), JSON.stringify({ schema: parts.SCHEMA, repositories: 'repo-1' }),
    `{"schema":"${parts.SCHEMA}","repositories":{"__proto__":{"app":{"variable":"missing","secret":"missing"}}}}`,
    { 'repo-1': 'missing' }, { 'repo-1': [] }, { 'repo-1': { app: 'missing', store: 'missing' } }, { 'repo-1': { app: [APP.missing], store: [USABLE] } },
    { 'repo-1': { app: { variable: 'missing' }, store: { state: 'missing' } } }, { 'repo-1': { app: { variable: big, secret: big } } },
    { 'repo-1': { app: { variable: 'MISSING', secret: 'Missing' }, store: { repository: STORE.toUpperCase(), state: 'missing' } } },
    { 'repo-2': { app: APP.missing, store: { repository: STORE, state: 'missing' } } },
  ];
  for (const shape of shapes) {
    write(shape);
    let result;
    assert.doesNotThrow(() => { result = judgeSaved(); }, JSON.stringify(shape).slice(0, 80));
    assert.equal(result.ready, true, JSON.stringify(shape).slice(0, 80));
    assert.equal(Object.prototype.app, undefined, 'no prototype key leaks');
  }
  // The same reader still reads a well-formed result.
  write({ 'repo-1': { app: APP.missing, store: USABLE, checked_at: '2026-11-27T00:00:00Z' } });
  assert.deepEqual(judgeSaved().missing.map(item => item.part), ['app']);
});

// ---- the real choke points --------------------------------------------------------------------------

// Every repository below reads this process's own scratch home, where this computer's Toolkit
// permissions were never set up: with a current programme file that holds, with an older one it does not.
function chokeRepo(t, minToolkit) {
  const home = governedHome();
  // Setup recorded this checkout as the Toolkit folder, so the permission lines can be read (and none is there).
  const recorded = path.join(home, '.ai-agent-toolkit', 'current', 'state.json');
  fs.mkdirSync(path.dirname(recorded), { recursive: true });
  fs.writeFileSync(recorded, JSON.stringify({ repo_path: ROOT }));
  const f = readyRepo(t, { minToolkit, home });
  const git = args => childProcess.execFileSync('git', ['-C', f.repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', ...args], { windowsHide: true }).toString().trim();
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'binding']);
  const base = git(['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(f.repo, 'README.md'), '# Example\n');
  git(['add', 'README.md']);
  git(['commit', '--quiet', '-m', 'readme']);
  return { ...f, base, head: git(['rev-parse', 'HEAD']) };
}

test('RM-4 programme writes refuse while not ready; reads still run; an older programme file is not held', t => {
  const programme = require('../../skills/github-program-reconciler/scripts/programme.cjs');
  const reached = { request() { throw Object.assign(new Error('the transport was reached'), { code: 'TRANSPORT_REACHED' }); } };
  const open = (repo, command) => {
    try { programme.openContext({ command, 'repo-root': repo }, { transport: reached, environment: {} }); return 'opened'; } catch (error) { return error.code; }
  };
  const held = chokeRepo(t, HOLD_FROM);
  for (const command of ['update', 'claim', 'gate-session', 'refresh', 'bind', 'handover']) assert.equal(open(held.repo, command), 'GOVERNANCE_NOT_READY', command);
  for (const command of ['show', 'inventory', 'attention']) assert.equal(open(held.repo, command), 'TRANSPORT_REACHED', `${command} still reads`);
  const older = chokeRepo(t, '3.137.0');
  assert.equal(open(older.repo, 'update'), 'TRANSPORT_REACHED', 'an older programme file only warns');
  // The cloud sweep (G2 Low: its exemption was proved only on a test-only setting): the same held
  // repository, read through the online reader at the checked-out commit, is not held; the run goes on
  // to its next GitHub read.
  const text = fs.readFileSync(path.join(held.repo, '.github', 'toolkit-programme.json'), 'utf8');
  const online = { request(method, url) {
    if (url === `repos/${SLUG}`) return { status: 200, json: { full_name: SLUG, default_branch: 'main' } };
    if (url === `repos/${SLUG}/branches/main`) return { status: 200, json: { commit: { sha: held.head } } };
    if (url.startsWith(`repos/${SLUG}/contents/.github/toolkit-programme.json?ref=`)) return { status: 200, json: { encoding: 'base64', content: Buffer.from(text).toString('base64') } };
    throw Object.assign(new Error(`the run went on to ${url}`), { code: 'TRANSPORT_REACHED' });
  } };
  const cloud = { GITHUB_ACTIONS: 'true', TOOLKIT_PROGRAMME_CLOUD_SWEEP: '1', GITHUB_SHA: held.head };
  let outcome;
  try { programme.openContext({ command: 'refresh', 'repo-root': held.repo }, { transport: online, environment: cloud }); outcome = 'opened'; } catch (error) { outcome = error.code; }
  assert.equal(outcome, 'TRANSPORT_REACHED', 'the cloud sweep\'s write is never held: it goes on to its next read');
});

test('RM-5 a gate checkpoint is queued while not ready, before any store read', t => {
  const checkpoint = require('../../skills/github-program-reconciler/scripts/programme-checkpoint.cjs');
  const f = chokeRepo(t, HOLD_FROM);
  const sessionsDir = path.join(f.root, 'sessions');
  const hash = checkpoint.sessionHash('s-ready');
  checkpoint.writeLocalBinding({ session_hash: hash, repo_root: f.repo, repository: SLUG, issue: 1, assignment: 'g1-ready' }, { sessionsDir });
  const reached = { request() { throw Object.assign(new Error('the store was read'), { code: 'TRANSPORT_REACHED' }); } };
  const result = checkpoint.runCheckpoint({ sessionId: 's-ready', message: null }, { sessionsDir, transport: reached });
  assert.equal(result.outcome, 'QUEUED');
  assert.ok(fs.existsSync(checkpoint.queueFile(hash, { sessionsDir })));
});

test('RM-6 standing task auto-merge waits while not ready, with the held line; an older programme file is not held', t => {
  const eligible = require('../scripts/toolkit-auto-merge-eligible.cjs');
  const check = f => {
    const out = [];
    const code = eligible.main(['--base', f.base, '--head', f.head, '--body-file', '-'], { cwd: f.repo, stdin: 'UAT: NOT_REQUIRED (docs only)\n', stdout: { write: text => out.push(text) }, stderr: { write: text => out.push(text) } });
    return { code, text: out.join('') };
  };
  const held = check(chokeRepo(t, HOLD_FROM));
  assert.equal(held.code, 1, held.text);
  assert.match(held.text, /^Toolkit governance is on but held until setup is complete, so task auto-merge waits\. Toolkit permissions \(Claude Code, this computer\): not set up; say `toolkit permissions`/);
  const older = check(chokeRepo(t, '3.137.0'));
  assert.equal(older.code, 0, older.text);
});

test('RM-7 merge trains refuse while not ready; an older programme file is not held', t => {
  const train = require('../scripts/toolkit-merge-train.cjs');
  const attempt = f => { try { train.run(['build', '--manifest', path.join(f.root, 'no-manifest.json')], f.repo); return null; } catch (error) { return error.message; } };
  assert.match(attempt(chokeRepo(t, HOLD_FROM)), /^Toolkit governance is on but held until setup is complete, so this merge train waits\..*Merge each ready pull request alone with the owner's merge\.$/);
  assert.doesNotMatch(attempt(chokeRepo(t, '3.137.0')), /held until setup is complete/);
});

test('RM-8 evidence saves never read the readiness hold', () => {
  const store = fs.readFileSync(path.join(ROOT, 'repo', 'scripts', 'toolkit-store.cjs'), 'utf8');
  assert.doesNotMatch(store, /toolkit-governance-ready/);
});
