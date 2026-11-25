'use strict';

// The first-install sweep after a governance turn-on: at most one run started, only where the turn-on
// added the personal data guard, its counts and link in the finish's result line, and every way GitHub
// can refuse or fail ending as a named owner step or a later try. GitHub is a fake; no workflow runs.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const childProcess = require('node:child_process');
const { recordMerged } = require('./toolkit-governed-fixture-support.cjs');
const { FirstInstallSweep, WAIT_MS, WORKFLOW } = require('../scripts/toolkit-governance-first-sweep.cjs');
const { ToolkitGovernanceCli } = require('../scripts/toolkit-governance.cjs');
const finishing = require('../scripts/toolkit-governance-finish.cjs');
const governance = require('../scripts/toolkit-governance-state.cjs');
const ruleset = require('../scripts/toolkit-governance-ruleset.cjs');

const SLUG = 'acme/app';
const COUNTS = '4 found (1 in files, 1 in commit messages, 1 in pull request text, 1 in comments), 2 not readable';
const DONE = { id: 901, status: 'completed', conclusion: 'success', created_at: '2026-11-25T01:00:00Z' };

// GitHub as the sweep reads it. `runs` is what the run list shows; `onStart` changes it when a run starts.
function fakeGitHub({ runs = [], onStart = null, jobs = [{ id: 54, name: 'other' }, { id: 55, name: 'sweep' }], notes = [{ title: 'Toolkit personal data sweep', message: COUNTS }], refuse = {} } = {}) {
  const world = { runs: [...runs], calls: [], starts: [] };
  const gh = (args, input) => {
    const endpoint = args.find(arg => arg.startsWith('repos/'));
    world.calls.push(args.join(' '));
    for (const [part, reason] of Object.entries(refuse)) if (endpoint.includes(part)) return { ok: false, reason };
    if (endpoint === `repos/${SLUG}`) return { ok: true, value: { default_branch: 'main' } };
    if (endpoint.endsWith('/dispatches')) { world.starts.push({ args, input }); if (onStart) onStart(world); return { ok: true, value: null }; }
    if (endpoint.includes(`/workflows/${WORKFLOW}/runs?`)) return { ok: true, value: { workflow_runs: world.runs.map(run => ({ ...run })) } };
    if (endpoint.includes('/actions/runs/901/jobs')) return { ok: true, value: { jobs } };
    if (endpoint.includes('/check-runs/55/annotations')) return { ok: true, value: notes };
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  return { world, gh };
}

// Runs the sweep with a clock that only `wait` moves; `onWait` changes what GitHub shows.
function run(fake, onWait = () => {}) {
  let clock = 0;
  const waits = [];
  const result = new FirstInstallSweep({ gh: fake.gh, now: () => clock, wait: ms => { waits.push(ms); clock += ms; onWait(fake.world, waits.length); } }).run(SLUG);
  return { result, waits, writes: fake.world.calls.filter(call => /--method|--input/.test(call)) };
}

test('one run is started on the default branch, waited for, and its counts and link come back', () => {
  const fake = fakeGitHub();
  const { result, writes } = run(fake, (world, count) => { world.runs = [count === 1 ? { ...DONE, status: 'in_progress', conclusion: null } : DONE]; });
  assert.deepEqual(result, { end: 'report', text: `First personal data sweep: ${COUNTS}; the list (places and rule names only) is at https://github.com/${SLUG}/actions/runs/901; on a public repository anyone can read it. It changed and posted nothing.` });
  assert.deepEqual(fake.world.starts.map(start => start.input), [{ ref: 'main' }]);
  assert.deepEqual(writes, [`--method POST repos/${SLUG}/actions/workflows/personal-data-sweep.yml/dispatches`], 'starting the run is the only write');
});

test('a sweep already on GitHub is read, never started again', () => {
  for (const runs of [[DONE], [{ ...DONE, status: 'queued', conclusion: null }]]) {
    const fake = fakeGitHub({ runs });
    const { result } = run(fake, world => { world.runs = [DONE]; });
    assert.equal(result.end, 'report');
    assert.equal(fake.world.starts.length, 0);
  }
  // A cancelled run swept nothing.
  const fake = fakeGitHub({ runs: [{ ...DONE, id: 899, conclusion: 'cancelled' }], onStart: world => { world.runs.push({ ...DONE, created_at: '2026-11-25T02:00:00Z' }); } });
  assert.equal(run(fake).result.end, 'report');
  assert.equal(fake.world.starts.length, 1);
});

test('a run still going when the wait ends, or that can no longer be read, is one line with its link, and never a second start', () => {
  const going = { ...DONE, status: 'in_progress', conclusion: null };
  const line = url => `First personal data sweep: started, and its list (places and rule names only) will be at ${url}; on a public repository anyone can read it. It changes and posts nothing.`;
  const fake = fakeGitHub({ onStart: world => { world.runs = [going]; } });
  const { result, waits } = run(fake);
  assert.deepEqual(result, { end: 'report', text: line(`https://github.com/${SLUG}/actions/runs/901`) });
  assert.ok(waits.reduce((sum, ms) => sum + ms, 0) >= WAIT_MS);
  assert.ok(WAIT_MS < finishing.FINISH_GAP_MS, 'the finish\'s lock outlasts the wait');
  fake.world.runs = [DONE];
  assert.match(run(fake).result.text, /4 found/);
  assert.equal(fake.world.starts.length, 1, 'one start in all');
  // Started, but GitHub shows no run yet, or stops answering: the link is the workflow's own page.
  assert.deepEqual(run(fakeGitHub()).result, { end: 'report', text: line(`https://github.com/${SLUG}/actions/workflows/personal-data-sweep.yml`) });
  const lost = fakeGitHub();
  const refuse = {};
  const gh = lost.gh;
  lost.gh = (args, input) => (refuse.on && args.some(arg => arg.includes('/runs?')) ? { ok: false, reason: 'gh-request-failed' } : gh(args, input));
  assert.deepEqual(run(lost, () => { refuse.on = true; }).result, { end: 'report', text: line(`https://github.com/${SLUG}/actions/workflows/personal-data-sweep.yml`) });
  assert.equal(lost.world.starts.length, 1);
});

test('a sweep that may not or cannot be started is one plain line with the owner\'s step, never a retry', () => {
  const cases = [
    ['the repository cannot be read', { [`repos/${SLUG}`]: 'gh-request-failed' }, 'it was not started, because GitHub could not be read'],
    ['not signed in', { [`repos/${SLUG}`]: 'gh-unavailable' }, 'it was not started, because GitHub could not be read'],
    ['the run list cannot be read', { '/runs?': 'gh-request-failed' }, 'it was not started, because GitHub could not be read'],
    ['too many requests', { '/runs?': 'rate-limited' }, 'it was not started, because GitHub could not be read'],
    ['the workflow is not there', { '/runs?': 'not-found' }, 'it was not started, because its workflow is not on the default branch'],
    ['no right to start it', { '/dispatches': 'forbidden' }, 'GitHub did not start it (forbidden)'],
    ['Actions is off', { '/dispatches': 'refused' }, 'GitHub did not start it (refused)'],
    ['the start fails', { '/dispatches': 'gh-request-failed' }, 'GitHub did not start it (gh-request-failed)'],
  ];
  for (const [name, refuse, why] of cases) {
    const fake = fakeGitHub({ refuse });
    const { result, waits } = run(fake);
    assert.deepEqual(result, { end: 'held', step: `${why}; on GitHub, open Actions, choose Personal data sweep and press Run workflow.` }, name);
    assert.equal(fake.world.starts.length, 0, name);
    assert.equal(waits.length, 0, `${name}: nothing is waited for`);
    // The governance App, its variable and its secret are never read or needed.
    for (const call of fake.world.calls) assert.doesNotMatch(call, /variables|secrets|installation/, call);
  }
  // A run that could not scan everything is never a report.
  const failed = run(fakeGitHub({ runs: [{ ...DONE, conclusion: 'failure' }] })).result;
  assert.equal(failed.end, 'held');
  assert.match(failed.step, /could not scan everything; open https:\/\/github\.com\/acme\/app\/actions\/runs\/901/);
  // Counts that cannot be read, or are not the guard's own line, are never shown.
  for (const options of [{ refuse: { '/jobs': 'gh-request-failed' } }, { refuse: { '/annotations': 'gh-request-failed' } }, { jobs: [] }, { notes: [] }, { notes: [{ title: 'Toolkit personal data sweep', message: `see ${['jane.tan', 'mailbox.sg'].join('@')}` }] }, { notes: [{ title: 'Other', message: COUNTS }] }]) {
    const { result } = run(fakeGitHub({ runs: [DONE], ...options }));
    assert.deepEqual(result, { end: 'report', text: `First personal data sweep: it finished; its report is at https://github.com/${SLUG}/actions/runs/901; on a public repository anyone can read it. It changed and posted nothing.` });
  }
  assert.equal(new FirstInstallSweep({ gh: () => assert.fail('no read') }).run('not a name').end, 'held');
});

// ---- the finish --------------------------------------------------------------------------------

function governedRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-first-sweep-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'example-repo');
  childProcess.execFileSync('git', ['init', '--quiet', repo], { windowsHide: true });
  childProcess.execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/example-owner/example-repo.git'], { windowsHide: true });
  fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), JSON.stringify({
    schema: 'toolkit.programme-binding.v2', repository: 'example-owner/example-repo', governance: 'enabled', parents: [{ issue: 3, record_prefix: 'INT-A-' }],
    store: { kind: 'github', repository: 'example-owner/example-store', branch: 'main', path: 'state/' }, required_checks: [],
  }));
  const registryOptions = { registryPath: path.join(root, 'state', 'repository-governance.v1.json'), testOnly: true };
  recordMerged(repo, { registryPath: registryOptions.registryPath });
  return { repo, registryOptions, id: governance.governanceState(repo, registryOptions).repository_id };
}

async function finish(ctx, firstSweep) {
  const out = [];
  const write = text => { out.push(String(text)); return true; };
  const code = await new ToolkitGovernanceCli({
    stdout: { write }, stderr: { write }, interactive: true, cwd: ctx.repo, registryOptions: ctx.registryOptions, firstSweep,
    ask: async question => { throw Error(`the finish asked: ${question}`); },
    rulesetReader: () => ({ ok: true, rulesets: [ruleset.noForcePushRulesetBody()] }), rulesetCreator: () => ({ ok: false, reason: 'not expected' }), stateRulesetCreator: () => ({ ok: false, reason: 'not expected' }),
    protectionReader: () => ({ ok: true, default_branch: 'main', repository: { allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true }, rules: [], classic: null, toolkit_ruleset: null }),
    securityReader: () => ({ ok: true, binding: { status: 'ok', text: fs.readFileSync(path.join(ctx.repo, '.github', 'toolkit-programme.json'), 'utf8') }, visibility: 'public', allow_auto_merge: false, delete_branch_on_merge: 'enabled', alerts: 'enabled', security_updates: 'enabled',
      secret_scanning: 'enabled', push_protection: 'enabled', code_scanning: 'enabled', private_reporting: 'enabled', advanced_codeql: null }),
  }).main(['finish']);
  return { code, out: out.join(''), entry: finishing.entryFor(ctx.registryOptions, ctx.id) };
}

// Red on the parent: the finish ran no sweep.
test('the finish of a turn-on that added the guard runs the sweep once and its report is in the next session\'s result line', async t => {
  const ctx = governedRepo(t), asked = [];
  finishing.markPending(ctx.registryOptions, ctx.id, { proposal: 1, firstSweep: true });
  const text = `First personal data sweep: ${COUNTS}; the list (places and rule names only) is at https://github.com/example-owner/example-repo/actions/runs/901; on a public repository anyone can read it. It changed and posted nothing.`;
  const done = await finish(ctx, { run: slug => { asked.push(slug); return { end: 'report', text }; } });
  assert.equal(done.code, 0, done.out);
  assert.deepEqual(asked, ['example-owner/example-repo']);
  assert.equal(done.entry.status, 'done');
  const state = governance.governanceState(ctx.repo, ctx.registryOptions);
  const lines = finishing.sessionLines(state, ctx.registryOptions, { startFinish: () => assert.fail('nothing more to start') });
  assert.ok(lines.join(' ').includes(text), lines.join(' '));
  assert.deepEqual(finishing.sessionLines(state, ctx.registryOptions, {}), [], 'shown once');
});

test('no sweep where the turn-on did not add the guard, and an update of the open turn-on keeps what it noted', async t => {
  for (const [first, next, sweeps] of [[false, undefined, 0], [null, undefined, 0], [true, null, 1], [true, false, 0]]) {
    const ctx = governedRepo(t);
    let asked = 0;
    finishing.markPending(ctx.registryOptions, ctx.id, { proposal: 1, firstSweep: first });
    if (next !== undefined) finishing.markPending(ctx.registryOptions, ctx.id, { proposal: 1, firstSweep: next });
    await finish(ctx, { run: () => { asked += 1; return { end: 'report', text: 'x' }; } });
    assert.equal(asked, sweeps, `${first} then ${next}`);
  }
});

test('a sweep that was not started never fails the finish or makes it run again: one line, shown once', async t => {
  const cases = [
    [{ run: () => ({ end: 'held', step: 'GitHub did not start it (forbidden); do it by hand.' }) }, /Waiting for you, the first personal data sweep: GitHub did not start it \(forbidden\); do it by hand\./],
    [{ run: () => { throw new Error('unexpected'); } }, /Waiting for you, the first personal data sweep: it was not started from here; on GitHub, open Actions/],
    [null, /Waiting for you, the first personal data sweep: it was not started from here; on GitHub, open Actions/],
  ];
  for (const [sweeper, words] of cases) {
    const ctx = governedRepo(t);
    finishing.markPending(ctx.registryOptions, ctx.id, { proposal: 1, firstSweep: true });
    const done = await finish(ctx, sweeper);
    assert.equal(done.code, 0, done.out);
    assert.equal(done.entry.status, 'done');
    assert.match(done.entry.line, words);
    const state = governance.governanceState(ctx.repo, ctx.registryOptions);
    assert.match(finishing.sessionLines(state, ctx.registryOptions, { startFinish: () => assert.fail('not started again') }).join(' '), words);
    assert.equal(finishing.entryFor(ctx.registryOptions, ctx.id), null, 'shown once, then gone');
  }
});

test('the turn-on says before the owner answers that the sweep follows the merge', () => {
  assert.match(finishing.WHAT, /where it adds the personal data guard, one report-only sweep of what is already there \(files, commit messages, pull request text and comments\), which changes and posts nothing \(on a public repository anyone can read its list\)/);
});
