'use strict';

// The cloud sweep (delta closure rows R11 to R17 and I9): the workflow's shape and tokens, the
// action's notices and fixed failures, the merged binding on a fresh runner, and the installation
// transport's routing, sign-in check and login.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = process.env.A2A_SOURCE_ROOT || path.resolve(__dirname, '../..');
const workflowPath = path.join(ROOT, '.github/workflows/toolkit-programme-sweep.yml');
const action = () => require(path.join(ROOT, 'repo/scripts/toolkit-programme-sweep-action.cjs'));
const cloudJobs = () => require(path.join(ROOT, 'repo/scripts/toolkit-cloud-jobs.cjs'));
const state = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-state.cjs'));
const cli = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme.cjs'));
const fakeToken = ['example', 'token', 'not', 'a', 'credential'].join('-');
const storeToken = ['example', 'store', 'token'].join('-');
const workflow = () => fs.readFileSync(workflowPath, 'utf8');
// One step's text, up to the next step or the next job.
const step = name => {
  const text = workflow(); const at = text.indexOf(`- name: ${name}`);
  const ends = [text.indexOf('\n      - name:', at + 1), text.slice(at).search(/\n  [a-z][a-z-]*:\r?\n/)].map((end, i) => (end === -1 ? Infinity : i ? at + end : end));
  const end = Math.min(...ends);
  return text.slice(at, end === Infinity ? undefined : end);
};

test('workflow: after each push to main and by hand only (the gate and the follow-up start it by hand), read-only built-in token, no saved credentials, one run at a time, stopped at 58 minutes', () => {
  const text = workflow();
  assert.match(text, /^on:\r?\n  push:\r?\n    branches: \[main\]\r?\n  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(text, /^\s+(schedule|issues|issue_comment):/m, 'the gate holds the hourly start and the activity triggers');
  assert.doesNotMatch(text, /^\s+(pull_request|pull_request_target|workflow_run|repository_dispatch):/m, 'never started by pull requests, forks or other workflows');
  assert.equal((text.match(/^\s+push:/gm) || []).length, 1, 'one push trigger');
  assert.doesNotMatch(text, /tags:|branches-ignore:|'\*\*'/, 'pushes to main only');
  assert.match(text, /^permissions:\r?\n  contents: read\s*$/m);
  assert.match(text, /^    permissions:\r?\n      contents: read\r?\n    outputs:/m, 'the sweep job\'s built-in token reads contents only');
  assert.match(text, /persist-credentials: false/);
  assert.match(text, /^    concurrency:\r?\n      group: toolkit-programme-sweep-\$\{\{ github\.repository \}\}\r?\n      cancel-in-progress: false/m, 'one sweep job at a time');
  assert.equal((text.match(/concurrency:/g) || []).length, 1, 'the follow-up job waits outside the group');
  assert.match(text, /timeout-minutes: 58/);
  for (const uses of text.match(/^\s+uses: \S+/gm)) assert.match(uses, /@[0-9a-f]{40}$/, `${uses.trim()} is pinned by commit`);
  assert.equal((text.match(/actions\/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510/g) || []).length, 2);
});

test('contract: mint permissions match the row', () => {
  const row = cloudJobs().readCloudJobsContract({ root: ROOT }).jobs.find(job => job.id === 'programme-sweep');
  assert.equal(row.workflow, '.github/workflows/toolkit-programme-sweep.yml');
  assert.equal(row.schedule.cron, '41 * * * *');
  assert.ok(fs.readFileSync(path.join(ROOT, '.github/workflows/toolkit-programme-sweep-gate.yml'), 'utf8').includes(`- cron: '${row.schedule.cron}'`), 'the gate holds the hourly start');
  const minted = name => Object.fromEntries([...step(name).matchAll(/permission-([a-z-]+): (read|write)/g)].map(([, permission, level]) => [permission.replace(/-/g, '_'), level]));
  const wanted = repository => cloudJobs().tokenPermissions(row.tokens.find(token => token.repository === repository));
  assert.deepEqual(minted('Mint the governed repository token'), wanted('governed_repository'));
  assert.deepEqual(minted('Mint the evidence store token'), wanted('evidence_store'));
  assert.match(step('Mint the evidence store token'), /owner: \$\{\{ github\.repository_owner \}\}\r?\n\s+repositories: \$\{\{ steps\.binding\.outputs\.store \}\}/);
  assert.doesNotMatch(step('Mint the governed repository token'), /owner:|repositories:/, 'the governed token is for this repository alone');
});

test('workflow: the key reaches only the mint steps, the tokens only the refresh and footer steps', () => {
  const text = workflow();
  assert.equal((text.match(/secrets\.TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY/g) || []).length, 2);
  for (const name of ['Mint the governed repository token', 'Mint the evidence store token']) {
    assert.match(step(name), /secrets\.TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY/);
    assert.match(step(name), /if: \$\{\{ vars\.TOOLKIT_GOVERNANCE_APP_CLIENT_ID != '' && steps\.binding\.outputs\.store != '' \}\}/);
    assert.match(step(name), /continue-on-error: true/);
  }
  assert.equal((text.match(/outputs\.token/g) || []).length, 4);
  for (const name of ['Refresh the programme', "Clean the cloud footer from the owner's posts"]) {
    assert.match(step(name), /GOVERNED_TOKEN: \$\{\{ steps\.governed\.outputs\.token \}\}/);
    assert.match(step(name), /STORE_TOKEN: \$\{\{ steps\.store\.outputs\.token \}\}/);
  }
  assert.doesNotMatch(text, /TOOLKIT_GOVERNANCE_TOKEN|GH_TOKEN: \$\{\{ secrets/, 'no personal token and no secret as GH_TOKEN');
});

function binding({ governance = 'enabled', repository = 'owner/repository', store = 'owner/evidence', publicState = false } = {}) {
  return { schema: state.SCHEMA.bindingV2, repository, governance, parents: [{ issue: 421, record_prefix: 'TEST-', writer_prefix: 'TEST-' }],
    store: { kind: 'github', repository: store, branch: 'main', path: 'state/' }, required_checks: [], ...(publicState ? { state: { kind: 'branch', branch: state.STATE_BRANCH, path: state.STATE_PATH } } : {}) };
}

// The same programme file as version 1: no governance key, one parent, and it reads as enabled.
function bindingV1() {
  return { schema: state.SCHEMA.binding, repository: 'owner/repository', parent_issue: 421, record_prefix: 'TEST-', writer_prefix: 'TEST-',
    store: { kind: 'github', repository: 'owner/evidence', branch: 'main', path: 'state/' }, required_checks: [] };
}

function runAction(mode, { env = {}, file = binding(), refresh = null } = {}) {
  const notices = [], failures = [], outputs = [], summaries = [], refreshes = [], warnings = [], tags = [], noticeTags = [];
  const runner = new (action().ProgrammeSweepAction)({
    env: { GITHUB_REPOSITORY: 'owner/repository', GITHUB_REF: 'refs/heads/main', DEFAULT_BRANCH: 'main', ...env }, root: ROOT,
    readFile: () => { if (file === null) throw Object.assign(new Error('absent'), { code: 'ENOENT' }); return Buffer.from(typeof file === 'string' ? file : JSON.stringify(file)); },
    validateBinding: value => state.validateBinding(value),
    refresh: input => { refreshes.push(input); return refresh ? refresh(input) : { status: 0, code: null, report: { metrics: 'Sweep: requests=40, tasks read=3, queue left=0', holds: [] } }; },
    notice: (message, tag) => { notices.push(message); noticeTags.push(tag || null); }, failure: message => failures.push(message), output: (name, value) => outputs.push([name, value]), summary: line => summaries.push(line),
    warning: (message, tag) => { warnings.push(message); tags.push(tag || null); },
  });
  const code = mode === 'store' ? runner.store() : runner.run();
  return { code, notices, failures, outputs, summaries, refreshes, warnings, tags, noticeTags };
}
// Record 808: every skip is a visible warning that names the repository, the reason and the fix.
function assertSkipWarning(result, reason) {
  assert.deepEqual(result.notices.filter((_, index) => result.noticeTags[index]?.title !== action().NO_PASS_TITLE), [], 'a skip is a warning, not a quiet notice');
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /^Programme Sweep skipped on owner\/repository: /);
  assert.match(result.warnings[0], reason);
  assert.match(result.warnings[0], / Fix: \S/);
}
const minted = { STORE_REPOSITORY: 'owner/evidence', APP_CLIENT_ID_SET: 'true', MINT_OUTCOME: 'success/success', GOVERNED_TOKEN: fakeToken, STORE_TOKEN: storeToken, SWEEP_LOGIN: 'toolkit-governance[bot]' };

test('action: the store step names the evidence store from the checked-out binding', () => {
  const result = runAction('store');
  assert.equal(result.code, 0);
  assert.deepEqual(result.outputs, [['store', 'evidence'], ['store_repository', 'owner/evidence']]);
  assert.deepEqual(result.notices, []);
});

test('cloud: public state branch is refused with a warning', () => {
  const result = runAction('store', { file: binding({ publicState: true }) });
  assert.equal(result.code, 0);
  assert.deepEqual(result.outputs, [['store', '']]);
  assertSkipWarning(result, /public branch, which the cloud sweep does not run/);
});

for (const [label, file, reason] of [['absent', null, /no programme file/], ['disabled', binding({ governance: 'disabled' }), /turns governance off/],
  ['another repository', binding({ repository: 'owner/other' }), /names owner\/other/],
  ['a store of another owner', binding({ store: 'someone-else/evidence' }), /someone-else\/evidence belongs to another owner/], ['invalid', '{"schema":', /not a valid programme file/],
  ['oversize', ' '.repeat(65 * 1024), /larger than/]]) {
  test(`action: ${label} binding gives a warning naming the repository, the reason and the fix, and writes nothing`, () => {
    const result = runAction('store', { file });
    assert.equal(result.code, 0);
    assert.deepEqual(result.outputs, [['store', '']]);
    assertSkipWarning(result, reason);
    assert.equal(result.refreshes.length, 0);
  });
}

test('action: a version 1 binding reads as enabled, as bindingEnabled says, and names its store', () => {
  const v1 = bindingV1();
  assert.equal(state.bindingEnabled(state.validateBinding(v1)), true);
  const result = runAction('store', { file: v1 });
  assert.equal(result.code, 0);
  assert.deepEqual(result.outputs, [['store', 'evidence'], ['store_repository', 'owner/evidence']]);
  assert.deepEqual(result.notices, []);
});

test('gate: a version 1 binding names its parent issue, as bindingEnabled says; off and unreadable stay null', () => {
  const { parentsOf } = gateScript();
  assert.deepEqual(parentsOf({ schema: state.SCHEMA.binding, repository: 'owner/repository', parent_issue: 143 }), [143]);
  assert.deepEqual(parentsOf({ schema: state.SCHEMA.bindingV2, governance: 'enabled', parents: [{ issue: 421 }, { issue: 7 }] }), [421, 7]);
  assert.equal(parentsOf({ schema: state.SCHEMA.bindingV2, governance: 'disabled' }), null);
  assert.equal(parentsOf({ schema: 'toolkit.programme-binding.v9', parent_issue: 1 }), null);
  assert.equal(parentsOf(null), null);
});

test('bridge doc: a skipped or failed refresh skips footer cleaning, and the refresh\'s own line says why', () => {
  // The footer step runs only when the refresh says it ran, so the script's own FOOTER_SKIPPED
  // warning is a second guard a normal run never shows; the doc must not promise it.
  const doc = fs.readFileSync(path.join(ROOT, 'repo/docs/TOOLKIT-LOCAL-BRIDGE.md'), 'utf8');
  assert.match(step('Clean the cloud footer from the owner\'s posts'), /steps\.refresh\.outputs\.refreshed == 'true'/);
  assert.doesNotMatch(doc, /when the refresh skips or fails, it edits nothing and says so in a warning/);
  assert.match(doc, /when the refresh skips or fails, the footer step does not run and edits nothing; the refresh's own warning, notice or failure says why/);
});

test('gate: it turns governance on for exactly the files the sweep reads as enabled (validateBinding, then bindingEnabled)', () => {
  // The gate reads the raw file (it checks out only itself), so this table keeps its reading in step
  // with the sweep's. A hand-broken version 1 file carrying version 2 keys is not a valid file.
  const { parentsOf } = gateScript();
  const sweepEnabled = file => { try { return state.bindingEnabled(state.validateBinding(file)); } catch { return false; } };
  const { parents, ...v2NoParents } = binding();
  for (const [label, file] of [
    ['v1', bindingV1()], ['v2 enabled', binding()], ['v2 disabled', binding({ governance: 'disabled' })],
    ['v1 with governance disabled', { ...bindingV1(), governance: 'disabled' }], ['v1 with governance enabled', { ...bindingV1(), governance: 'enabled' }],
    ['v1 with v2 parents', { ...bindingV1(), parents }], ['v1 with parent_lifecycle', { ...bindingV1(), parent_lifecycle: { reopen_incomplete: true, complete_when_children_closed: true } }], ['v1 with detach_finished_children', { ...bindingV1(), detach_finished_children: true }], ['no schema, enabled', { ...v2NoParents, schema: undefined, parents }],
    ['v2 without a governance key', { ...v2NoParents, governance: undefined, parents }], ['unknown schema', { ...bindingV1(), schema: 'toolkit.programme-binding.v9' }],
  ]) {
    const file2 = JSON.parse(JSON.stringify(file));
    assert.equal(parentsOf(file2) !== null, sweepEnabled(file2), label);
  }
});

test('action: no App configured gives a warning naming the repository, the variable, the secret and the check', () => {
  const result = runAction('run', { env: { STORE_REPOSITORY: 'owner/evidence', APP_CLIENT_ID_SET: 'false', MINT_OUTCOME: 'skipped/skipped' } });
  assert.equal(result.code, 0);
  assertSkipWarning(result, /TOOLKIT_GOVERNANCE_APP_CLIENT_ID.*TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY.*toolkit governance check/);
  assert.deepEqual(result.tags, [{ title: gateScript().TITLES.skipped, code: 'no_app' }], 'the gate counts this skip by title and code');
  const disabled = runAction('store', { file: binding({ governance: 'disabled' }) });
  assert.equal(disabled.tags[0]?.title, gateScript().TITLES.skipped);
  assert.match(disabled.tags[0]?.code, /^[a-z_]+$/);
  const offDefault = runAction('store', { env: { GITHUB_REF: 'refs/heads/feature/x' } });
  assert.deepEqual(offDefault.tags, [null], 'a manual run off the default branch never counts toward a streak');
  assert.deepEqual(offDefault.noticeTags, [{ title: gateScript().TITLES.noPass, code: 'off_default' }], 'nor ends one');
  assert.equal(result.refreshes.length, 0);
});

for (const [label, env, refresh] of [
  ['the governed mint failed', { MINT_OUTCOME: 'failure/success' }, null],
  ['the store mint failed', { MINT_OUTCOME: 'success/failure' }, null],
  ['GitHub refused a token', {}, () => ({ status: 1, code: 'GH_AUTH', report: null })],
]) test(`action: ${label} fails with the fixed sign-in message and no provider text`, () => {
  const result = runAction('run', { env: { ...minted, ...env }, refresh });
  assert.equal(result.code, 1);
  assert.deepEqual(result.failures, [action().SIGN_IN_FAILURE]);
  assert.match(result.failures[0], /TOOLKIT_GOVERNANCE_APP_CLIENT_ID and TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY: the App may not be installed on this repository or its evidence store, or the key was revoked/);
  assert.ok(!result.failures[0].includes(fakeToken) && !result.failures[0].includes(storeToken));
});

test('action: a healthy run writes the metrics line; a held pass is resumable; an overlap is queued', () => {
  const ok = runAction('run', { env: minted });
  assert.equal(ok.code, 0);
  assert.deepEqual(ok.summaries, ['Programme Sweep: Sweep: requests=40, tasks read=3, queue left=0']);
  const held = runAction('run', { env: minted, refresh: () => ({ status: 1, code: null, report: { metrics: 'Sweep: requests=300, tasks read=20, queue left=8', holds: [{ code: 'PASS_STOPPED' }] } }) });
  assert.equal(held.code, 0);
  assert.match(held.summaries[0], /this pass held, the next run retries/);
  // The gate counts held runs by this title and code (three in a row turn it red).
  assert.deepEqual(held.tags, [{ title: gateScript().TITLES.held, code: 'PASS_STOPPED' }]);
  assert.deepEqual(ok.tags, [], 'a clean pass has no held warning');
  assert.equal(action().holdCodes({ holds: [{ code: 'B_CODE' }, { code: 'A_CODE' }, { code: 'B_CODE' }, { code: 'not a code' }] }), 'A_CODE, B_CODE');
  assert.equal(action().holdCodes({ holds: [{}] }), 'unnamed');
  const queued = runAction('run', { env: minted, refresh: () => ({ status: 0, code: null, report: { outcome: 'QUEUED', reason: 'another sweep is running' } }) });
  assert.deepEqual(queued.summaries, [action().NOTICES.queued]);
  // L3 (G2 of slice 4): a run that made no pass carries a titled notice the gate passes over.
  assert.deepEqual(queued.noticeTags, [{ title: action().NO_PASS_TITLE, code: 'queued' }]);
  assert.equal(action().NO_PASS_TITLE, gateScript().TITLES.noPass);
  const moved = runAction('run', { env: minted, refresh: () => ({ status: 2, code: 'MAIN_MOVED', report: null }) });
  assert.equal(moved.code, 0);
  assert.deepEqual(moved.notices, [action().NOTICES.main_moved]);
  assert.deepEqual(moved.noticeTags, [{ title: action().NO_PASS_TITLE, code: 'main_moved' }]);
  assert.deepEqual(ok.noticeTags, [], 'a clean pass has no no-pass notice, so it ends a streak');
  assert.deepEqual(held.noticeTags, []);
  const leaking = runAction('run', { env: minted, refresh: () => ({ status: 0, code: null, report: { metrics: `Sweep: ${fakeToken}`, holds: [] } }) });
  assert.equal(leaking.code, 1);
  assert.deepEqual(leaking.summaries, [], 'a line that carries a token is never written');
});

test('action: a failed pass names its stop code and HTTP status, never GitHub text or a token', () => {
  const failed = runAction('run', { env: minted, refresh: () => ({ status: 2, code: 'GH_FAILED', http: '403', report: null }) });
  assert.equal(failed.code, 1);
  assert.deepEqual(failed.failures, ['Programme Sweep failed (GH_FAILED, HTTP 403). Open this workflow run and toolkit governance check for the cause.']);
  const noStatus = runAction('run', { env: minted, refresh: () => ({ status: 1, code: 'PASS_LOCK_LOST', http: null, report: null }) });
  assert.deepEqual(noStatus.failures, ['Programme Sweep failed (PASS_LOCK_LOST). Open this workflow run and toolkit governance check for the cause.']);
  const unknown = runAction('run', { env: minted, refresh: () => ({ status: 1, code: null, report: null }) });
  assert.deepEqual(unknown.failures, [action().GENERAL_FAILURE]);
  const hostile = runAction('run', { env: minted, refresh: () => ({ status: 1, code: `X ${fakeToken}`, http: 'abc', report: null }) });
  assert.deepEqual(hostile.failures, [action().GENERAL_FAILURE]);
  const spawn = () => ({ status: 2, stdout: '', stderr: `GH_FAILED: Writing state/x/sweep-lease.json failed (403): Resource not accessible by integration ${fakeToken}\nmore` });
  const parsed = action().runRefresh({ root: ROOT, env: minted, spawn });
  assert.deepEqual([parsed.code, parsed.http], ['GH_FAILED', '403']);
  assert.ok(!action().failureLine(parsed).includes('Resource') && !action().failureLine(parsed).includes(fakeToken));
});

test('action: the CLI runs without a shell and only with the two tokens, the login and the store', () => {
  const seen = [];
  const spawn = (file, args, options) => { seen.push({ file, args, options }); return { status: 0, stdout: '{\n  "metrics": "Sweep: requests=1"\n}\n', stderr: '' }; };
  const env = { ...minted, GH_TOKEN: 'gh-fixture', GITHUB_TOKEN: 'builtin-fixture', TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY: 'key-fixture', PATH: process.env.PATH };
  const result = action().runRefresh({ root: ROOT, env, spawn });
  assert.equal(result.report.metrics, 'Sweep: requests=1');
  const { options, args } = seen[0];
  assert.equal(options.shell, false);
  assert.deepEqual(args.slice(-3), ['refresh', '--scheduled', '--json']);
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY']) assert.equal(options.env[name], undefined, name);
  assert.deepEqual([options.env.GOVERNED_TOKEN, options.env.STORE_TOKEN, options.env.SWEEP_LOGIN, options.env.TOOLKIT_PROGRAMME_CLOUD_SWEEP], [fakeToken, storeToken, 'toolkit-governance[bot]', '1']);
});

// The merged binding a fresh runner reads, at the head this run checked out.
function bindingReader({ status = 200, text = JSON.stringify(binding()), head = 'a'.repeat(40), checkedOut = 'a'.repeat(40) } = {}) {
  const calls = [];
  const reader = new cli.MergedSweepBindingReader({ repository: 'owner/repository', checkedOut, transport: { request(method, endpoint) {
    calls.push({ method, endpoint });
    if (endpoint === 'repos/owner/repository') return { status: 200, json: { full_name: 'owner/repository', default_branch: 'main' } };
    if (endpoint.endsWith('/branches/main')) return { status: 200, json: { commit: { sha: head } } };
    return status === 404 ? { status: 404, json: {} } : { status: 200, json: { encoding: 'base64', content: Buffer.from(text).toString('base64') } };
  } } });
  return { reader, calls };
}
const identity = { repository_id: 'example-identity', remote: { canonical: 'https://github.com/owner/repository.git' } };

for (const [label, options, expect] of [
  ['present and enabled', {}, entry => entry.binding?.governance === 'enabled'],
  ['version 1, which reads as enabled', { text: JSON.stringify(bindingV1()) }, entry => entry.binding?.parent_issue === 421 && entry.binding.schema === state.SCHEMA.binding],
  ['absent', { status: 404 }, entry => entry.binding === null && entry.status === 'absent'],
  ['invalid', { text: '{"schema":' }, entry => entry.binding === null && entry.status === 'present'],
  ['disabled', { text: JSON.stringify({ schema: state.SCHEMA.bindingV2, repository: 'owner/repository', governance: 'disabled' }) }, entry => entry.binding === null],
  ['for another repository', { text: JSON.stringify(binding({ repository: 'owner/other' })) }, entry => entry.binding === null],
]) test(`fresh runner binding: ${label}`, () => {
  const { reader, calls } = bindingReader(options);
  const entry = reader.read(identity);
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.ok(calls.at(-1).endpoint.endsWith(`?ref=${'a'.repeat(40)}`), 'read at the immutable default-branch commit');
  assert.ok(expect({ ...entry, binding: reader.binding }));
});

test('fresh runner binding: a head other than the checked-out commit stops with nothing written', () => {
  const { reader, calls } = bindingReader({ head: 'b'.repeat(40) });
  assert.throws(() => reader.read(identity), { code: 'MAIN_MOVED' });
  assert.equal(calls.some(call => call.endpoint.includes('/contents/')), false);
});

// The cloud entry end to end on a fresh runner: the command line gets no origin URL, so it runs the
// real governance check, and the home folder has no binding cache. Only the online reader can show
// the repository is ENABLED (review finding H1).
function freshRunner(t) {
  const os = require('node:os');
  const { execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-runner-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-runner-home-'));
  t.after(() => { for (const folder of [dir, home]) fs.rmSync(folder, { recursive: true, force: true }); });
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  Object.assign(process.env, { HOME: home, USERPROFILE: home });
  t.after(() => { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const git = (...args) => execFileSync('git', ['-c', 'user.name=example', '-c', 'user.email=example@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', 'https://github.com/owner/repository.git');
  fs.mkdirSync(path.join(dir, '.github'));
  fs.writeFileSync(path.join(dir, '.github', 'toolkit-programme.json'), JSON.stringify(binding(), null, 2));
  git('add', '.');
  git('commit', '-q', '-m', 'binding');
  return { dir, home, head: git('rev-parse', 'HEAD') };
}

function freshRun(t, { file = JSON.stringify(binding()), head = null } = {}) {
  const runner = freshRunner(t);
  const calls = [];
  const transport = {
    verify() { calls.push('verify'); return true; },
    request(method, endpoint) {
      calls.push(`${method} ${endpoint}`);
      if (endpoint === 'repos/owner/repository') return { status: 200, json: { full_name: 'owner/repository', default_branch: 'main' } };
      if (endpoint === 'repos/owner/repository/branches/main') return { status: 200, json: { commit: { sha: head || runner.head } } };
      if (endpoint.startsWith('repos/owner/repository/contents/.github/toolkit-programme.json')) {
        return file === null ? { status: 404, json: { message: 'Not Found' } } : { status: 200, json: { encoding: 'base64', content: Buffer.from(file).toString('base64') } };
      }
      // Past the governance check: the store's own checks are not part of this test.
      throw Object.assign(new Error(`past the governance check: ${endpoint}`), { code: 'PAST_GOVERNANCE' });
    },
  };
  const environment = { GITHUB_ACTIONS: 'true', TOOLKIT_PROGRAMME_CLOUD_SWEEP: '1', GITHUB_SHA: runner.head, GITHUB_REPOSITORY: 'owner/repository',
    STORE_REPOSITORY: 'owner/evidence', SWEEP_LOGIN: 'toolkit-governance[bot]', PATH: process.env.PATH };
  let error = null;
  try { cli.openContext(cli.parseArgs(['refresh', '--scheduled', '--json']), { environment, transport, repoRoot: runner.dir }); }
  catch (thrown) { error = thrown; }
  assert.deepEqual(fs.readdirSync(runner.home), [], 'no binding cache in the home folder');
  return { calls, error, runner };
}

test('fresh runner: the command line reads the merged binding online and passes the governance check', t => {
  const { calls, error, runner } = freshRun(t);
  assert.equal(error?.code, 'PAST_GOVERNANCE', `${error?.code}: ${error?.message}`);
  assert.deepEqual(calls.slice(0, 4), ['verify', 'GET repos/owner/repository', 'GET repos/owner/repository/branches/main',
    `GET repos/owner/repository/contents/.github/toolkit-programme.json?ref=${runner.head}`], 'the binding was read at the checked-out commit');
});

test('fresh runner: a binding absent on the default branch refuses the sweep', t => {
  const { error } = freshRun(t, { file: null });
  assert.equal(error?.code, 'GITHUB_GOVERNANCE_OFF');
});

test('fresh runner: main moved since the checkout stops with nothing written', t => {
  const { calls, error } = freshRun(t, { head: 'b'.repeat(40) });
  assert.equal(error?.code, 'MAIN_MOVED');
  assert.ok(calls.every(call => call === 'verify' || call.startsWith('GET ')), 'only reads');
});

test('fresh runner binding: an oversize binding is refused', () => {
  const { reader } = bindingReader({ text: JSON.stringify({ ...binding(), padding: 'x'.repeat(70 * 1024) }) });
  assert.throws(() => reader.read(identity), { code: 'BINDING_INVALID' });
});

const { InstallationTransport } = require(path.join(ROOT, 'skills/github-program-reconciler/scripts/programme-installation.cjs'));
function installation({ answer = null } = {}) {
  const seen = [];
  const run = (file, args, options) => {
    const endpoint = args[4];
    seen.push({ endpoint, token: options.env.GH_TOKEN, env: options.env });
    const body = answer ? answer(endpoint, options.env.GH_TOKEN) : { total_count: 1, repositories: [{ full_name: options.env.GH_TOKEN === fakeToken ? 'owner/repository' : 'owner/evidence' }] };
    return { status: 0, stdout: `HTTP/2.0 200 OK\n\n${JSON.stringify(body)}` };
  };
  const transport = new InstallationTransport({ governed: 'owner/repository', store: 'owner/evidence', governedToken: fakeToken, storeToken,
    login: 'toolkit-governance[bot]', ghPath: 'fixture-gh', run, environment: { PATH: 'fixture', GH_TOKEN: 'personal-fixture', GITHUB_TOKEN: 'builtin-fixture' } });
  return { transport, seen };
}

test('token: each repository gets only its own token', () => {
  const { transport, seen } = installation();
  transport.request('GET', 'repos/owner/repository/issues/421');
  transport.request('GET', 'repos/owner/evidence/contents/state/parent-421.json?ref=main');
  transport.request('POST', 'graphql', { query: 'query($owner:String!,$name:String!){repository(owner:$owner,name:$name){id}}', variables: { owner: 'owner', name: 'evidence' } });
  assert.deepEqual(seen.map(call => call.token), [fakeToken, storeToken, storeToken]);
  assert.ok(seen.every(call => call.env.GITHUB_TOKEN === undefined && call.env.PATH === 'fixture'), 'no other credential reaches gh');
  for (const [method, endpoint] of [['GET', 'repos/owner/other/issues'], ['GET', 'user'], ['GET', 'orgs/owner/repos'], ['PUT', 'repos/owner/repository-two/contents/x']]) {
    assert.throws(() => transport.request(method, endpoint), { code: 'TOKEN_ROUTE_REFUSED' }, endpoint);
  }
});

test('token: undeclared GraphQL is refused', () => {
  const { transport, seen } = installation();
  assert.throws(() => transport.request('POST', 'graphql', { query: 'query { viewer { login } }' }), { code: 'TOKEN_ROUTE_REFUSED' });
  assert.throws(() => transport.request('POST', 'graphql', { query: 'query { x }', variables: { owner: 'owner', name: 'other' } }), { code: 'TOKEN_ROUTE_REFUSED' });
  assert.equal(seen.length, 0);
});

for (const [label, answer] of [
  ['an extra repository', () => ({ total_count: 2, repositories: [{ full_name: 'owner/repository' }, { full_name: 'owner/evidence' }] })],
  ['the wrong repository', () => ({ total_count: 1, repositories: [{ full_name: 'owner/other' }] })],
]) test(`token: installation repositories must match exactly (${label})`, () => {
  const { transport, seen } = installation({ answer });
  assert.throws(() => transport.verify(), { code: 'GH_AUTH' });
  assert.equal(seen[0].endpoint, 'installation/repositories?per_page=100');
});

test('token: installation repositories must match exactly (each token its own one)', () => {
  const { transport, seen } = installation();
  assert.equal(transport.verify(), true);
  assert.deepEqual(seen.map(call => [call.endpoint, call.token]), [['installation/repositories?per_page=100', fakeToken], ['installation/repositories?per_page=100', storeToken]]);
});

test('token: archive login comes from the mint output, never GET /user', () => {
  const calls = [];
  const reader = new state.ProgrammeGraphReader({ repository: 'owner/repository', login: 'toolkit-governance[bot]', transport: { request: (...args) => { calls.push(args); return { status: 200, json: { login: 'someone' } }; } } });
  assert.equal(reader.viewer(), 'toolkit-governance[bot]');
  assert.deepEqual(calls, []);
});

test('cloud: the CLI in installation mode runs refresh only', () => {
  const environment = { GITHUB_ACTIONS: 'true', TOOLKIT_PROGRAMME_CLOUD_SWEEP: '1' };
  for (const argv of [['reconcile', '--apply', '--controller', '--session', 'fixture'], ['show']]) {
    assert.throws(() => cli.openContext(cli.parseArgs(argv), { environment, transport: { request() { throw new Error('no request expected'); } }, originUrl: 'https://github.com/owner/repository.git', repoRoot: '.' }), { code: 'ROLE_REFUSED' });
  }
});


// The gate and the follow-up: the hourly start and issue, comment and pull request activity run a
// near-free check with the built-in token, which starts the sweep only when there is work; a pass
// that stops early starts one more run itself.
const gatePath = path.join(ROOT, '.github/workflows/toolkit-programme-sweep-gate.yml');
const gateWorkflow = () => fs.readFileSync(gatePath, 'utf8').replace(/\r\n/g, '\n');
const gateScript = () => require(path.join(ROOT, 'repo/scripts/toolkit-programme-sweep-gate.cjs'));

test('gate workflow: hourly at minute 41, narrow activity triggers, bots ignored before a runner starts, main only, no secrets', () => {
  const text = gateWorkflow();
  assert.match(text, /^on:\n  schedule:\n    - cron: '41 \* \* \* \*'\n  workflow_dispatch:\n  issues:\n    types: \[opened, edited, closed, reopened\]\n  issue_comment:\n    types: \[created\]\n  pull_request_target:\n    types: \[opened, synchronize, closed, reopened\]\n    branches: \[main\]\n  workflow_run:\n    workflows: \[Validate\]\n    types: \[completed\]\n\n/m);
  assert.doesNotMatch(text, /^\s+(pull_request|push|repository_dispatch):/m);
  assert.match(text, /CI_WORKFLOW: validate\.yml$/m, 'the hourly start also counts finished CI runs');
  assert.match(text, /^permissions:\n  contents: read\n\n/m);
  assert.match(text, /^    permissions:\n      actions: write\n      checks: read\n      contents: read\n      issues: read\n    steps:/m, 'the built-in token reads issues, contents and run annotations and starts workflow runs, nothing more');
  assert.match(text, /^    if: \$\{\{ github\.ref == 'refs\/heads\/main' && \(github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch' \|\| github\.event\.sender\.type != 'Bot'\) \}\}$/m);
  assert.match(text, /concurrency:\n  group: toolkit-programme-sweep-gate-\$\{\{ github\.repository \}\}\n  cancel-in-progress: false/);
  assert.match(text, /timeout-minutes: 3/);
  assert.doesNotMatch(text, /secrets\.|github\.event\.(?:issue|comment|pull_request|workflow_run)\.|head\.sha|head_ref/, 'no secrets, no event text and nothing from the pull request');
  assert.match(text, /ref: main\n          persist-credentials: false\n          sparse-checkout: repo\/scripts\/toolkit-programme-sweep-gate\.cjs\n/);
  for (const uses of text.match(/^\s+uses: \S+/gm)) assert.match(uses, /@[0-9a-f]{40}$/);
  assert.match(text, /run: node repo\/scripts\/toolkit-programme-sweep-gate\.cjs$/m);
});

test('sweep workflow: the follow-up job holds only the built-in token and waits outside the sweep group', () => {
  const text = workflow().replace(/\r\n/g, '\n');
  const job = text.slice(text.indexOf('  follow-up:'));
  // L8: a failed footer step after the refresh still lets the follow-up run.
  assert.match(job, /needs: sweep\n    if: \$\{\{ !cancelled\(\) && needs\.sweep\.outputs\.follow_up_at != '' \}\}/);
  assert.match(job, new RegExp(`^    name: ${gateScript().FOLLOW_UP_JOB}$`, 'm'), 'the gate finds the follow-up job by this name');
  // L4: contents read, so the sparse checkout works on a private repository too.
  assert.match(job, /permissions:\n      actions: write\n      contents: read\n    steps:/);
  assert.match(job, /timeout-minutes: 65/);
  assert.doesNotMatch(job, /secrets\.|outputs\.token|concurrency:/);
  assert.match(job, /run: node repo\/scripts\/toolkit-programme-sweep-gate\.cjs follow-up$/m);
  assert.match(text, /follow_up_at: \$\{\{ steps\.refresh\.outputs\.follow_up_at \}\}/);
});

const HOUR = 60 * 60 * 1000;
const T = Date.parse('2026-11-13T03:00:00Z');
const done = (endedAgo, startedAgo = endedAgo + 10 * 60 * 1000) => ({ status: 'completed', conclusion: 'success', updated_at: new Date(T - endedAgo).toISOString(), run_started_at: new Date(T - startedAgo).toISOString() });
const COMPLETE = 'Board updated: 13 Nov 2026, 10:41 SGT (state revision 9)';
const PAUSED = 'Board updated: 13 Nov 2026, 10:41 SGT (state revision 9). Paused at GitHub\'s hourly App limit; the next run picks up the 340 tasks left.';
const TIMED = 'Board updated: 13 Nov 2026, 10:41 SGT (state revision 9). Paused at this pass\'s time limit; the next run picks up the 40 tasks left.';

test('gate: the hourly start sweeps only for a saved place, a change or six quiet hours', () => {
  const { decide } = gateScript();
  const hourly = facts => decide({ event: 'schedule', now: T, lines: [COMPLETE], changedSince: false, runs: [done(HOUR)], ...facts });
  assert.deepEqual(hourly({}), { start: false, reason: 'nothing changed since the last sweep' });
  assert.equal(hourly({ changedSince: true }).start, true);
  assert.equal(hourly({ lines: [TIMED] }).start, true, 'a saved place resumes');
  assert.equal(hourly({ lines: [null] }).start, true, 'no board line yet');
  assert.equal(hourly({ runs: [] }).start, true, 'no sweep has finished yet');
  assert.equal(hourly({ runs: [{ status: 'completed', conclusion: 'cancelled' }, done(7 * HOUR)] }).start, true, 'six quiet hours, and a cancelled run is not a sweep');
  assert.deepEqual(hourly({ runs: [{ status: 'in_progress' }, done(HOUR)], changedSince: true }), { start: false, reason: 'a sweep is running' });
  assert.deepEqual(hourly({ runs: [{ status: 'pending' }, { status: 'in_progress' }, done(HOUR)] }), { start: false, reason: 'a sweep is already queued' });
  // M2: a failed run is not the last sweep; changes are measured from the last successful one.
  assert.equal(hourly({ runs: [{ ...done(10 * 60 * 1000), conclusion: 'failure' }, done(7 * HOUR)] }).start, true, 'a failed run does not hide six quiet hours');
  assert.equal(hourly({ runs: [{ ...done(10 * 60 * 1000), conclusion: 'failure' }] }).start, true, 'only failed runs: no sweep has finished yet');
  assert.equal(hourly({ event: 'workflow_dispatch', changedSince: true }).start, true);
});

test('gate: a pass paused at GitHub\'s hourly App limit resumes only once the limit has reset', () => {
  const { decide, RESET_WAIT_MS } = gateScript();
  const at = startedAgo => decide({ event: 'schedule', now: T, lines: [PAUSED], changedSince: true, runs: [done(5 * 60 * 1000, startedAgo)] });
  assert.equal(at(RESET_WAIT_MS - 1).start, false);
  assert.match(at(RESET_WAIT_MS - 1).reason, /has not reset yet/);
  assert.equal(at(RESET_WAIT_MS).start, true);
});

test('gate: activity (a finished CI run included) starts a sweep when none finished in the last hour, or queues one behind a running sweep', () => {
  const { decide } = gateScript();
  for (const event of ['issues', 'issue_comment', 'pull_request_target', 'workflow_run']) {
    assert.equal(decide({ event, now: T, lines: [COMPLETE], changedSince: true, runs: [done(HOUR - 1)] }).start, false);
    assert.equal(decide({ event, now: T, lines: [COMPLETE], changedSince: true, runs: [done(HOUR)] }).start, true);
    // M2: the running pass may have read past this change, so one more waits behind it.
    assert.deepEqual(decide({ event, now: T, lines: [COMPLETE], changedSince: false, runs: [{ status: 'in_progress' }, done(HOUR - 1)] }),
      { start: true, reason: 'activity during a running sweep; one more waits behind it' });
    assert.equal(decide({ event, now: T, lines: [COMPLETE], changedSince: false, runs: [{ status: 'queued' }, { status: 'in_progress' }] }).start, false, 'never more than one waiting');
    // M4: a follow-up waiting for the App limit to reset starts the next sweep; none starts under the margin now.
    assert.deepEqual(decide({ event, now: T, lines: [PAUSED], changedSince: true, runs: [{ status: 'in_progress' }, done(2 * HOUR)], followUpWaiting: true }),
      { start: false, reason: 'a follow-up run is already on its way' });
  }
});

const actionsToken = ['example', 'actions', 'token'].join('-');
const gateBinding = JSON.stringify(binding());
function fakeGitHub({ runs = [done(2 * HOUR)], body = COMPLETE, changed = [], binding = gateBinding, ci = [], jobs = [], gateRuns = [], runJobs = {}, notes = {}, answers = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const route = url.replace('https://api.github.com/repos/owner/repository/', '');
    calls.push(`${options.method} ${route}`);
    assert.equal(options.headers.authorization, `Bearer ${actionsToken}`);
    if (answers[route]) return { ok: false, status: answers[route], json: async () => ({}) };
    const jobsOf = /^actions\/runs\/(\d+)\/jobs$/.exec(route)?.[1];
    const notesOf = /^check-runs\/(\d+)\/annotations/.exec(route)?.[1];
    const json = jobsOf && runJobs[jobsOf] ? { jobs: runJobs[jobsOf] } : notesOf ? (notes[notesOf] || [])
      : route.startsWith('actions/workflows/toolkit-programme-sweep-gate.yml/runs') ? { workflow_runs: gateRuns }
      : route.startsWith('actions/workflows/toolkit-programme-sweep.yml/runs') ? { workflow_runs: runs }
      : route === 'issues/421' ? { body: `# Programme\n\n${body}\n` } : route.startsWith('issues?') ? changed
        : route === 'contents/.github/toolkit-programme.json?ref=main' ? { content: Buffer.from(binding).toString('base64') }
          : route.startsWith('actions/workflows/validate.yml/runs') ? { workflow_runs: ci } : /^actions\/runs\/\d+\/jobs$/.test(route) ? { jobs } : null;
    return { ok: true, status: options.method === 'POST' ? 204 : 200, json: async () => json };
  };
  return { calls, fetchImpl };
}
const gateEnv = { GITHUB_REPOSITORY: 'owner/repository', GH_TOKEN: actionsToken, EVENT_NAME: 'schedule' };

test('gate: a quiet hour reads four small answers and starts nothing; a change since the last sweep starts it on main', async () => {
  const { gate } = gateScript();
  const quiet = fakeGitHub();
  const lines = [];
  const verdict = await gate({ env: gateEnv, fetchImpl: quiet.fetchImpl, now: T, log: line => lines.push(line) });
  assert.equal(verdict.start, false);
  assert.deepEqual(quiet.calls.map(call => call.split('?')[0]), ['GET contents/.github/toolkit-programme.json', 'GET actions/workflows/toolkit-programme-sweep.yml/runs', 'GET issues/421', 'GET issues']);
  assert.match(quiet.calls[3], /since=2026-11-13T01%3A00%3A00\.000Z/, 'changes since the last sweep finished');
  assert.deepEqual(lines, ['Programme Sweep gate: nothing to start (nothing changed since the last sweep).']);
  const busy = fakeGitHub({ changed: [{ updated_at: '2026-11-13T02:30:00Z' }] });
  assert.equal((await gate({ env: gateEnv, fetchImpl: busy.fetchImpl, now: T, log: () => {} })).start, true);
  assert.equal(busy.calls.at(-1), 'POST actions/workflows/toolkit-programme-sweep.yml/dispatches');
  // M3: a CI run that finished after the last sweep counts, though it changed no issue.
  const ciEnv = { ...gateEnv, CI_WORKFLOW: 'validate.yml' };
  const ciDone = fakeGitHub({ ci: [{ updated_at: '2026-11-13T02:10:00Z' }] });
  assert.equal((await gate({ env: ciEnv, fetchImpl: ciDone.fetchImpl, now: T, log: () => {} })).start, true);
  assert.match(ciDone.calls[4], /^GET actions\/workflows\/validate\.yml\/runs\?status=completed&per_page=1$/);
  const ciOld = fakeGitHub({ ci: [{ updated_at: '2026-11-13T00:50:00Z' }] });
  assert.equal((await gate({ env: ciEnv, fetchImpl: ciOld.fetchImpl, now: T, log: () => {} })).start, false, 'a CI run before the last sweep is already read');
  // M4: an issue comment while a run's follow-up waits for the App limit starts nothing; the jobs are
  // read only for a run in progress.
  const commentEnv = { ...gateEnv, EVENT_NAME: 'issue_comment' };
  const waiting = fakeGitHub({ runs: [{ id: 77, status: 'in_progress' }, done(2 * HOUR)], body: PAUSED,
    jobs: [{ name: 'Refresh the programme', status: 'completed' }, { name: gateScript().FOLLOW_UP_JOB, status: 'in_progress' }] });
  assert.deepEqual(await gate({ env: commentEnv, fetchImpl: waiting.fetchImpl, now: T, log: () => {} }), { start: false, reason: 'a follow-up run is already on its way' });
  assert.ok(waiting.calls.includes('GET actions/runs/77/jobs'));
  assert.ok(!waiting.calls.some(call => call.startsWith('POST')));
  const sweeping = fakeGitHub({ runs: [{ id: 78, status: 'in_progress' }, done(2 * HOUR)], jobs: [{ name: 'Refresh the programme', status: 'in_progress' }] });
  assert.equal((await gate({ env: commentEnv, fetchImpl: sweeping.fetchImpl, now: T, log: () => {} })).start, true, 'a sweep still reading: one more waits behind it');
  assert.equal(quiet.calls.filter(call => /jobs$/.test(call)).length, 0);
  const off = fakeGitHub({ binding: JSON.stringify({ governance: 'disabled' }) });
  assert.equal((await gate({ env: gateEnv, fetchImpl: off.fetchImpl, now: T, log: () => {} })).start, false);
  assert.deepEqual(off.calls, ['GET contents/.github/toolkit-programme.json?ref=main', 'GET actions/workflows/toolkit-programme-sweep-gate.yml/runs?event=schedule&status=completed&per_page=2'],
    'governance off on the hourly start reads the binding and the two earlier hourly gate runs');
  const offByActivity = fakeGitHub({ binding: JSON.stringify({ governance: 'disabled' }) });
  await gate({ env: commentEnv, fetchImpl: offByActivity.fetchImpl, now: T, log: () => {} });
  assert.deepEqual(offByActivity.calls, ['GET contents/.github/toolkit-programme.json?ref=main'], 'activity reads only the binding');
});

// Findings are for action: three held or skipped runs in a row turn the hourly gate red.
const finished = id => ({ ...done(2 * HOUR), id });
const sweepJob = id => [{ id: id * 10, name: 'Refresh the programme' }, { id: id * 10 + 1, name: 'Start the next run after an early stop' }];
const note = (title, message) => [{ title, annotation_level: 'warning', message }];
function streakGitHub(findings, extra = {}) {
  const runs = findings.map((_, index) => finished(100 + index));
  const runJobs = Object.fromEntries(runs.map(run => [run.id, sweepJob(run.id)]));
  const notes = Object.fromEntries(findings.map((found, index) => [(100 + index) * 10, found]));
  return fakeGitHub({ runs, runJobs, notes, ...extra });
}

test('gate: three held sweeps in a row turn the hourly gate red with the controller step; a clean one ends it', async () => {
  const { gate } = gateScript();
  const held = note('Programme Sweep held', '(PASS_STOPPED) Programme Sweep held: this pass held and the next run retries.');
  const red = await gate({ env: gateEnv, fetchImpl: streakGitHub([held, held, held, []]).fetchImpl, now: T, log: () => {} });
  assert.match(red.alert, /^Programme Sweep held 3 runs in a row \(PASS_STOPPED\) since [^ ]+\. Controller: read the held items on the programme page/);
  assert.equal(red.start, false, 'the verdict itself is unchanged');
  for (const findings of [[[], held, held], [held, held, []], [held, held]]) {
    assert.equal((await gate({ env: gateEnv, fetchImpl: streakGitHub(findings).fetchImpl, now: T, log: () => {} })).alert, undefined, JSON.stringify(findings));
  }
  const quiet = streakGitHub([[], held, held]);
  await gate({ env: gateEnv, fetchImpl: quiet.fetchImpl, now: T, log: () => {} });
  assert.deepEqual(quiet.calls.filter(call => /jobs$|annotations/.test(call)), ['GET actions/runs/100/jobs', 'GET check-runs/1000/annotations?per_page=50'], 'a clean last run stops the read');
  const byActivity = streakGitHub([held, held, held]);
  assert.equal((await gate({ env: { ...gateEnv, EVENT_NAME: 'issues' }, fetchImpl: byActivity.fetchImpl, now: T, log: () => {} })).alert, undefined, 'activity never goes red');
  // Activity reads only the newest run's finding, to pick the last sweep; never the streak behind it.
  assert.deepEqual(byActivity.calls.filter(call => /annotations/.test(call)), ['GET check-runs/1000/annotations?per_page=50']);
});

test('L3: runs that made no pass neither count nor end a held streak; changed hold codes still count; since is the streak\'s start', async () => {
  const { gate } = gateScript();
  const held = code => note('Programme Sweep held', `(${code}) Programme Sweep held: this pass held and the next run retries.`);
  const noPass = code => [{ title: 'Programme Sweep no pass', annotation_level: 'notice', message: `(${code}) x` }];
  // Newest first: held, queued, held, main moved, held (codes changing), then a clean pass.
  const findings = [held('PASS_STOPPED'), noPass('queued'), held('A_CODE, PASS_STOPPED'), noPass('main_moved'), held('B_CODE'), []];
  const github = streakGitHub(findings);
  const red = await gate({ env: gateEnv, fetchImpl: github.fetchImpl, now: T, log: () => {} });
  assert.match(red.alert, /^Programme Sweep held 3 runs in a row \(A_CODE, B_CODE, PASS_STOPPED\) since /);
  // The streak began with the oldest held run (index 4), not the oldest of the last three runs.
  const runs = findings.map((_, index) => ({ ...done(2 * HOUR), id: 100 + index, run_started_at: `2026-11-13T0${index}:00:00Z` }));
  const dated = streakGitHub(findings, { runs, runJobs: Object.fromEntries(runs.map(run => [run.id, sweepJob(run.id)])) });
  assert.match((await gate({ env: gateEnv, fetchImpl: dated.fetchImpl, now: T, log: () => {} })).alert, / since 2026-11-13T04:00:00Z\. /);
  // Five held runs read back to their start: the count says five.
  const long = streakGitHub([held('X'), held('X'), held('X'), held('X'), held('X'), []]);
  assert.match((await gate({ env: gateEnv, fetchImpl: long.fetchImpl, now: T, log: () => {} })).alert, /^Programme Sweep held 5 runs in a row \(X\) since [^ ]+\. /);
  // Every run read is held: the streak may be older, so "or earlier".
  assert.match((await gate({ env: gateEnv, fetchImpl: streakGitHub([held('X'), held('X'), held('X')]).fetchImpl, now: T, log: () => {} })).alert, / since \S+ or earlier\. /);
  // A run whose sweep job was skipped or is missing is passed over too.
  const skippedJob = streakGitHub([held('X'), [], held('X'), held('X'), []]);
  const jobs = skippedJob.fetchImpl;
  const patched = async (url, options) => {
    if (/actions\/runs\/101\/jobs$/.test(url)) return { ok: true, status: 200, json: async () => ({ jobs: [{ id: 1010, name: 'Refresh the programme', conclusion: 'skipped' }] }) };
    return jobs(url, options);
  };
  assert.match((await gate({ env: gateEnv, fetchImpl: patched, now: T, log: () => {} })).alert, /^Programme Sweep held 3 runs in a row/);
  const noJob = async (url, options) => /actions\/runs\/101\/jobs$/.test(url) ? { ok: true, status: 200, json: async () => ({ jobs: [] }) } : jobs(url, options);
  assert.match((await gate({ env: gateEnv, fetchImpl: noJob, now: T, log: () => {} })).alert, /^Programme Sweep held 3 runs in a row/);
  // Only no-pass runs between two held runs: no streak.
  assert.equal((await gate({ env: gateEnv, fetchImpl: streakGitHub([held('X'), noPass('queued'), noPass('paused'), held('X'), []]).fetchImpl, now: T, log: () => {} })).alert, undefined);
  // A no-pass title at warning level, or a notice with another title, is a clean run.
  assert.equal((await gate({ env: gateEnv, fetchImpl: streakGitHub([held('X'), note('Programme Sweep no pass', '(queued) x'), held('X'), held('X')]).fetchImpl, now: T, log: () => {} })).alert, undefined);
});

test('gate: a green run that made no pass (queued behind the lease, main moved, off the default branch, no sweep job) is not the last sweep; a paused one is', async () => {
  const { gate, decide } = gateScript();
  const noPass = code => [{ title: 'Programme Sweep no pass', annotation_level: 'notice', message: `(${code}) x` }];
  // Newest first: a green run 5 minutes ago with the given finding, then the last real pass 7 hours ago;
  // an issue changed 2 hours ago.
  const gitHub = (finding, jobs = sweepJob(200)) => {
    const runs = [{ ...done(5 * 60 * 1000), id: 200 }, { ...done(7 * HOUR), id: 100 }];
    return fakeGitHub({ runs, runJobs: { 200: jobs, 100: sweepJob(100) }, notes: { 2000: finding, 1000: [] }, changed: [{ updated_at: new Date(T - 2 * HOUR).toISOString() }] });
  };
  const start = async (finding, event, jobs) => {
    const github = gitHub(finding, jobs);
    const verdict = await gate({ env: { ...gateEnv, EVENT_NAME: event }, fetchImpl: github.fetchImpl, now: T, log: () => {} });
    return { verdict, github };
  };
  for (const code of ['queued', 'main_moved', 'off_default']) {
    const { verdict, github } = await start(noPass(code), 'schedule');
    assert.deepEqual(verdict, { start: true, reason: 'issues, pull requests or CI results changed since the last sweep' }, code);
    assert.match(github.calls.find(call => call.startsWith('GET issues?')), /since=2026-11-12T20%3A00%3A00\.000Z/, 'changes since the last pass that did work');
    // M1 (G2): activity still waits an hour after the newest run, so a held lease never starts a run per edit.
    assert.deepEqual((await start(noPass(code), 'issue_comment')).verdict, { start: false, reason: 'a sweep finished within the last hour; the hourly start picks this change up' }, code);
  }
  for (const jobs of [[], [{ id: 2000, name: 'Refresh the programme', conclusion: 'skipped' }]]) {
    assert.equal((await start([], 'schedule', jobs)).verdict.start, true, 'no sweep job');
  }
  // A pass paused at the App limit still counts: the hourly start sees nothing new since it.
  assert.deepEqual((await start(noPass('paused'), 'schedule')).verdict, { start: false, reason: 'nothing changed since the last sweep' });
  // A real pass 5 minutes ago (clean) is the last sweep, as before.
  assert.equal((await start([], 'schedule')).verdict.start, false);
  // A queued run over an hour old no longer holds activity back; a real pass 7 hours ago is the last sweep.
  const older = fakeGitHub({ runs: [{ ...done(HOUR + 60 * 1000), id: 200 }, { ...done(7 * HOUR), id: 100 }], runJobs: { 200: sweepJob(200), 100: sweepJob(100) }, notes: { 2000: noPass('queued'), 1000: [] } });
  assert.deepEqual(await gate({ env: { ...gateEnv, EVENT_NAME: 'issues' }, fetchImpl: older.fetchImpl, now: T, log: () => {} }), { start: true, reason: 'activity, and no sweep within the last hour' });
  // L1 (G2): a finding that cannot be read counts the run as a sweep; the gate decides as before, never red before a start.
  const lost = fakeGitHub({ runs: [{ ...done(2 * HOUR), id: 200 }], answers: { 'actions/runs/200/jobs': 404 }, changed: [{ updated_at: new Date(T - HOUR).toISOString() }] });
  assert.deepEqual(await gate({ env: { ...gateEnv, EVENT_NAME: 'issues' }, fetchImpl: lost.fetchImpl, now: T, log: () => {} }), { start: true, reason: 'activity, and no sweep within the last hour' });
  // decide(): runs named in noPass are passed over; with only those, no sweep has finished yet.
  const lease = { ...done(5 * 60 * 1000), id: 200 };
  assert.deepEqual(decide({ event: 'schedule', now: T, lines: [COMPLETE], changedSince: false, runs: [lease, { ...done(7 * HOUR), id: 100 }], noPass: new Set([200]) }),
    { start: true, reason: 'six hours since the last sweep' });
  assert.deepEqual(decide({ event: 'schedule', now: T, lines: [COMPLETE], changedSince: false, runs: [lease], noPass: new Set([200]) }),
    { start: true, reason: 'no sweep has finished yet' });
  assert.equal(decide({ event: 'issues', now: T, lines: [COMPLETE], changedSince: true, runs: [lease], noPass: new Set([200]) }).start, false, 'only a queued run within the hour: activity waits');
  // Each run's jobs and annotations are read once per gate run: the streak reuses the last-sweep reads.
  const reads = gitHub(noPass('queued'));
  await gate({ env: gateEnv, fetchImpl: reads.fetchImpl, now: T, log: () => {} });
  const runReads = reads.calls.filter(call => /jobs$|annotations/.test(call));
  assert.deepEqual(runReads, [...new Set(runReads)]);
  assert.deepEqual(runReads, ['GET actions/runs/200/jobs', 'GET check-runs/2000/annotations?per_page=50', 'GET actions/runs/100/jobs', 'GET check-runs/1000/annotations?per_page=50']);
});

test('L2: a failure reading the streak after the start says the sweep started; a blip stays a notice and a set-up fault stays red', t => {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  const script = path.join(ROOT, 'repo/scripts/toolkit-programme-sweep-gate.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-gate-l2-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // The last sweep finished long ago, so the hourly start dispatches; its jobs answer with the given
  // status. The read that picks the last sweep fails first and counts the run as a sweep, so the start
  // goes ahead; the streak read then meets the same failure after it.
  const runs = JSON.stringify([{ id: 9, status: 'completed', conclusion: 'success', updated_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }]);
  const preload = status => {
    const file = path.join(dir, `fetch-${status}.cjs`);
    fs.writeFileSync(file, `globalThis.fetch = async (url, options) => {
      const ok = json => ({ ok: true, status: options.method === 'POST' ? 204 : 200, json: async () => json });
      if (/contents\\/\\.github\\/toolkit-programme\\.json/.test(url)) return ok({ content: Buffer.from(${JSON.stringify(gateBinding)}).toString('base64') });
      if (/actions\\/runs\\/9\\/jobs/.test(url)) return { ok: false, status: ${status}, json: async () => ({}) };
      if (/toolkit-programme-sweep\\.yml\\/runs/.test(url)) return ok({ workflow_runs: ${runs} });
      if (/issues\\/421$/.test(url)) return ok({ body: 'Board updated: x (state revision 1)' });
      return ok([]);
    };\n`);
    return file;
  };
  const env = { PATH: process.env.PATH, GITHUB_REPOSITORY: 'owner/repository', GH_TOKEN: actionsToken, EVENT_NAME: 'schedule' };
  const blip = spawnSync(process.execPath, ['--require', preload(502), script], { env, encoding: 'utf8', timeout: 30000 });
  assert.equal(blip.status, 0, blip.stderr);
  assert.match(blip.stdout, /^Programme Sweep gate: started the sweep \(six hours since the last sweep\)\.$/m);
  assert.match(blip.stdout, /^::notice::Programme Sweep gate started the sweep, but its held-streak check could not finish: GitHub answered 502 for GET actions\/runs\/9\/jobs\. The next hourly start checks again\.$/m);
  assert.doesNotMatch(blip.stdout, /The next start tries again/);
  const fault = spawnSync(process.execPath, ['--require', preload(403), script], { env, encoding: 'utf8', timeout: 30000 });
  assert.equal(fault.status, 1, 'a set-up fault stays red');
  assert.match(fault.stderr, /^Programme Sweep gate started the sweep, but its held-streak check failed: GitHub answered 403/m);
});

test('gate: three sweeps skipped in a row for the same reason turn it red with the owner step; mixed reasons or held and skipped do not', async () => {
  const { gate } = gateScript();
  const noApp = note('Programme Sweep skipped', '(no_app) Programme Sweep skipped on owner/repository: the governance GitHub App is not set up here.');
  const held = note('Programme Sweep held', '(PASS_STOPPED) held');
  const red = await gate({ env: { ...gateEnv, EVENT_NAME: 'workflow_dispatch' }, fetchImpl: streakGitHub([noApp, noApp, noApp]).fetchImpl, now: T, log: () => {} });
  assert.match(red.alert, /^Programme Sweep skipped 3 runs in a row \(no_app\) since .+\. Owner: follow the fix in the sweep run's warning/);
  assert.equal((await gate({ env: gateEnv, fetchImpl: streakGitHub([noApp, held, noApp]).fetchImpl, now: T, log: () => {} })).alert, undefined);
  assert.equal((await gate({ env: gateEnv, fetchImpl: streakGitHub([noApp, noApp, note('Programme Sweep skipped', '(public_state) x')]).fetchImpl, now: T, log: () => {} })).alert, undefined);
  assert.equal((await gate({ env: gateEnv, fetchImpl: streakGitHub([note('Programme Sweep skipped', 'no code'), noApp, noApp]).fetchImpl, now: T, log: () => {} })).alert, undefined, 'an untitled code never counts');
});

test('gate: a governance-off skip on the third hourly run in a row turns it red, naming the leftover workflows', async () => {
  const { gate } = gateScript();
  const off = JSON.stringify({ governance: 'disabled' });
  const gateRuns = [{ id: 7, status: 'completed' }, { id: 8, status: 'completed' }];
  const runJobs = { 7: [{ id: 70, name: 'Start the sweep if there is work' }], 8: [{ id: 80, name: 'Start the sweep if there is work' }] };
  const skipped = note('Programme Sweep gate skipped', '(disabled) Programme Sweep gate skipped owner/repository: the programme file on main turns governance off.');
  const lines = [];
  const red = await gate({ env: gateEnv, fetchImpl: fakeGitHub({ binding: off, gateRuns, runJobs, notes: { 70: skipped, 80: skipped } }).fetchImpl, now: T, log: line => lines.push(line) });
  assert.match(lines[0], /^::warning title=Programme Sweep gate skipped::\(disabled\) Programme Sweep gate skipped owner\/repository: /);
  assert.match(red.alert, /3 hourly runs in a row \(disabled\).+remove the Toolkit Programme Sweep workflows/);
  const once = await gate({ env: gateEnv, fetchImpl: fakeGitHub({ binding: off, gateRuns, runJobs, notes: { 70: skipped } }).fetchImpl, now: T, log: () => {} });
  assert.equal(once.alert, undefined, 'an earlier run without the skip ends the streak');
  const other = await gate({ env: gateEnv, fetchImpl: fakeGitHub({ binding: off, gateRuns, runJobs, notes: { 70: skipped, 80: note('Programme Sweep gate skipped', '(invalid) x') } }).fetchImpl, now: T, log: () => {} });
  assert.equal(other.alert, undefined, 'a different reason ends the streak');
});

test('gate: only a 404 reads as no programme file; a 401, 403 or 5xx on the binding is not governance off', async () => {
  const { gate, GitHubAnswerError, isBlip } = gateScript();
  const route = 'contents/.github/toolkit-programme.json?ref=main';
  const lines = [];
  const missing = await gate({ env: gateEnv, fetchImpl: fakeGitHub({ answers: { [route]: 404 } }).fetchImpl, now: T, log: line => lines.push(line) });
  assert.equal(missing.reason, 'governance off');
  assert.match(lines[0], /\(unreadable\).+missing or unreadable/);
  for (const status of [401, 403, 500]) {
    await assert.rejects(gate({ env: gateEnv, fetchImpl: fakeGitHub({ answers: { [route]: status } }).fetchImpl, now: T, log: () => {} }),
      error => error instanceof GitHubAnswerError && error.status === status && isBlip(error) === (status >= 500));
  }
});

test('gate: a repository it skips gets one warning naming the repository, the reason and the fix (record 808)', async () => {
  const { gate } = gateScript();
  for (const [binding, reason] of [[JSON.stringify({ governance: 'disabled' }), /turns governance off/], ['{"schema":', /missing or unreadable/],
    [JSON.stringify({ schema: state.SCHEMA.bindingV2, governance: 'enabled', parents: [] }), /names no parent issue/],
    [JSON.stringify({ ...bindingV1(), governance: 'disabled' }), /is not a valid programme file/]]) {
    const lines = [];
    const off = fakeGitHub({ binding });
    assert.equal((await gate({ env: gateEnv, fetchImpl: off.fetchImpl, now: T, log: line => lines.push(line) })).start, false);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^::warning title=Programme Sweep gate skipped::\((?:disabled|unreadable|invalid|no_parent)\) Programme Sweep gate skipped owner\/repository: /);
    assert.match(lines[0], reason);
    assert.match(lines[0], / Fix: \S/);
  }
});

test('follow-up: waits for the given time, capped, then starts one run on main', async () => {
  const { followUp, RESET_WAIT_MS } = gateScript();
  const run = async at => {
    const github = fakeGitHub(); const waits = [];
    const started = await followUp({ env: { ...gateEnv, FOLLOW_UP_AT: String(at) }, fetchImpl: github.fetchImpl, now: () => T, sleep: async ms => { waits.push(ms); }, log: () => {} });
    return { started, waits, calls: github.calls };
  };
  assert.deepEqual(await run(T + 30 * 60 * 1000), { started: true, waits: [30 * 60 * 1000], calls: ['GET actions/workflows/toolkit-programme-sweep.yml/runs?per_page=20', 'POST actions/workflows/toolkit-programme-sweep.yml/dispatches'] });
  assert.deepEqual((await run(T + 5 * HOUR)).waits, [RESET_WAIT_MS], 'never waits past the reset bound');
  assert.deepEqual((await run(T - 1000)).waits, [], 'a time-limit stop starts again at once');
  assert.deepEqual(await run(0), { started: false, waits: [], calls: [] });
});

test('L2: after its wait the follow-up starts nothing when another sweep is queued, running or newer', async () => {
  const { followUp } = gateScript();
  const own = { id: 500, status: 'in_progress', created_at: '2026-11-13T01:50:00Z' };
  const run = async runs => {
    const github = fakeGitHub({ runs }); const lines = [];
    const started = await followUp({ env: { ...gateEnv, GITHUB_RUN_ID: '500', FOLLOW_UP_AT: String(T) }, fetchImpl: github.fetchImpl, now: () => T, sleep: async () => {}, log: line => lines.push(line) });
    return { started, posted: github.calls.some(call => call.startsWith('POST')), lines };
  };
  assert.deepEqual((await run([own, done(2 * HOUR)])).started, true, 'only its own run and older finished ones');
  for (const other of [{ id: 501, status: 'queued', created_at: '2026-11-13T02:40:00Z' }, { id: 499, status: 'in_progress', created_at: '2026-11-13T01:40:00Z' },
    { id: 502, status: 'completed', conclusion: 'success', created_at: '2026-11-13T02:10:00Z' }]) {
    const result = await run([other, own]);
    assert.deepEqual([result.started, result.posted], [false, false], JSON.stringify(other));
    assert.deepEqual(result.lines, ['Programme Sweep follow-up: another sweep already started; none more needed.']);
  }
  assert.equal((await run([{ id: 400, status: 'completed', conclusion: 'success', created_at: '2026-11-13T01:00:00Z' }, own])).started, true, 'an older finished run is not newer');
});

test('L6: GitHub failures in the gate and follow-up end green with a notice; a set-up fault stays red', t => {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  const script = path.join(ROOT, 'repo/scripts/toolkit-programme-sweep-gate.cjs');
  // A stand-in fetch: the binding reads, then GitHub answers 502 (a 5xx blip).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-gate-l6-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const preload = path.join(dir, 'fetch-502.cjs');
  fs.writeFileSync(preload, `globalThis.fetch = async url => /contents\\/\\.github\\/toolkit-programme\\.json/.test(url)
    ? { ok: true, status: 200, json: async () => ({ content: Buffer.from(${JSON.stringify(gateBinding)}).toString('base64') }) }
    : { ok: false, status: 502, json: async () => ({}) };\n`);
  const env = { PATH: process.env.PATH, GITHUB_REPOSITORY: 'owner/repository', GH_TOKEN: actionsToken, EVENT_NAME: 'schedule' };
  for (const args of [[], ['follow-up']]) {
    const blip = spawnSync(process.execPath, ['--require', preload, script, ...args], { env: { ...env, FOLLOW_UP_AT: '1' }, encoding: 'utf8', timeout: 30000 });
    assert.equal(blip.status, 0, `${args[0] || 'gate'}: ${blip.stderr}`);
    assert.match(blip.stdout, /^::notice::Programme Sweep (gate|follow-up) could not finish: GitHub answered 502 for GET actions\/workflows\/toolkit-programme-sweep\.yml\/runs\. The next start tries again\.$/m);
    // L1 (G2 of this fix): a 404 or 403 is a set-up fault and stays red; a 429 is a blip.
    for (const [status, code] of [[404, 1], [403, 1], [401, 1], [429, 0], [503, 0]]) {
      const answer = path.join(dir, `fetch-${status}.cjs`);
      fs.writeFileSync(answer, fs.readFileSync(preload, 'utf8').replace('status: 502', `status: ${status}`));
      const result = spawnSync(process.execPath, ['--require', answer, script, ...args], { env: { ...env, FOLLOW_UP_AT: '1' }, encoding: 'utf8', timeout: 30000 });
      assert.equal(result.status, code, `${args[0] || 'gate'} ${status}: ${result.stdout}${result.stderr}`);
      if (code) assert.match(result.stderr, new RegExp(`GitHub answered ${status}`));
    }
    const { isBlip, GitHubAnswerError } = gateScript();
    assert.equal(isBlip(Object.assign(new TypeError('fetch failed'), { cause: new Error('ECONNRESET') })), true, 'a dropped connection');
    assert.equal(isBlip(new TypeError('Cannot read properties of undefined')), false, 'a code bug stays red');
    assert.equal(isBlip(new GitHubAnswerError(500, 'x')), true);
    const unset = spawnSync(process.execPath, [script, ...args], { env: { PATH: process.env.PATH, FOLLOW_UP_AT: '1' }, encoding: 'utf8', timeout: 30000 });
    assert.equal(unset.status, 1, `${args[0] || 'gate'} without a token is a set-up fault`);
    assert.match(unset.stderr, /needs GITHUB_REPOSITORY and GH_TOKEN/);
  }
});

test('M1 (G2 of this fix): the gate resumes a private repository\'s mid-pass limit stop from its board note, about an hour after the reset', () => {
  const { decide, RESET_WAIT_MS } = gateScript();
  // The pass began 10 minutes before it ended; its board line carries the App-limit note.
  const at = ago => decide({ event: 'schedule', now: T, lines: [PAUSED], changedSince: false, runs: [done(ago, ago + 10 * 60 * 1000)] });
  assert.equal(at(30 * 60 * 1000).start, false, 'before the reset it waits');
  assert.equal(at(RESET_WAIT_MS).start, true, 'after the reset the hourly start resumes it');
});

test('L3 and L7: at the App limit the footer step skips; a private repository leaves the wait to the hourly gate', () => {
  const { RESET_WAIT_MS } = gateScript();
  const limited = { status: 0, code: null, report: { outcome: 'PAUSED', reason: 'GitHub rate limit' } };
  const rate = { status: 0, code: null, report: { metrics: 'Sweep: requests=4500', sweep: { read: 5, left: 10, reason: 'GitHub rate limit' }, holds: [] } };
  const timed = { status: 0, code: null, report: { metrics: 'Sweep: requests=40', sweep: { read: 5, left: 10, reason: 'time limit' }, holds: [] } };
  for (const refresh of [limited, rate]) {
    const result = runAction('run', { env: minted, refresh: () => refresh });
    assert.ok(result.outputs.some(([name, value]) => name === 'at_limit' && value === 'true'));
    assert.ok(Number(result.outputs.find(([name]) => name === 'follow_up_at')?.[1]) >= Date.now() - 5000 + RESET_WAIT_MS - 60000, 'public: waits for the reset');
  }
  // Private, stopped mid-way at the limit: no runner waits; the board note lets the gate resume it.
  const hidden = runAction('run', { env: { ...minted, REPOSITORY_PRIVATE: 'true' }, refresh: () => rate });
  assert.equal(hidden.code, 0);
  assert.equal(hidden.outputs.some(([name]) => name === 'follow_up_at'), false, 'no runner waits an hour on a private repository');
  assert.deepEqual(hidden.notices, [action().NOTICES.private_wait]);
  // M1 (G2 of this fix): private and PAUSED read nothing and leave no board note, so the follow-up stays.
  const before = Date.now();
  const pausedPrivate = runAction('run', { env: { ...minted, REPOSITORY_PRIVATE: 'true' }, refresh: () => limited });
  const at = Number(pausedPrivate.outputs.find(([name]) => name === 'follow_up_at')?.[1]);
  assert.ok(at >= before + RESET_WAIT_MS && at <= Date.now() + RESET_WAIT_MS, 'a PAUSED pass on a private repository still follows up once the limit resets');
  assert.deepEqual(pausedPrivate.notices, [action().NOTICES.paused], 'only the no-pass notice the gate passes over');
  assert.deepEqual(pausedPrivate.noticeTags, [{ title: action().NO_PASS_TITLE, code: 'paused' }]);
  const quick = runAction('run', { env: { ...minted, REPOSITORY_PRIVATE: 'true' }, refresh: () => timed });
  assert.ok(quick.outputs.some(([name]) => name === 'follow_up_at'), 'a time-limit stop still follows up at once');
  assert.equal(quick.outputs.some(([name]) => name === 'at_limit'), false, 'footer cleaning runs after a time-limit stop');
  assert.equal(runAction('run', { env: minted }).outputs.some(([name]) => name === 'at_limit'), false);
  assert.match(step('Clean the cloud footer from the owner\'s posts'), /steps\.refresh\.outputs\.at_limit != 'true'/);
  assert.match(step('Refresh the programme'), /REPOSITORY_PRIVATE: \$\{\{ github\.event\.repository\.private \}\}/);
});

test('follow-up time: only a pass that read something and left tasks follows up', () => {
  const { followUpAt } = action();
  const { RESET_WAIT_MS } = gateScript();
  const report = sweep => ({ sweep: { read: 5, left: 10, reason: 'GitHub rate limit', ...sweep } });
  assert.equal(followUpAt(report({}), 1000, 5000), 1000 + RESET_WAIT_MS);
  assert.equal(followUpAt(report({ reason: 'time limit' }), 1000, 5000), 5000);
  assert.equal(followUpAt(report({ read: 0 }), 1000, 5000), 0, 'no progress, no loop');
  assert.equal(followUpAt(report({ left: 0 }), 1000, 5000), 0);
  assert.equal(followUpAt(report({ reason: 'state branch busy' }), 1000, 5000), 0, 'the hourly start retries');
  assert.equal(followUpAt({}, 1000, 5000), 0);
  // M5: a pass that found the limit already at the margin follows up once it resets, at most hourly.
  assert.equal(followUpAt({ outcome: 'PAUSED', reason: 'GitHub rate limit' }, 1000, 5000), 1000 + RESET_WAIT_MS);
  assert.equal(followUpAt({ outcome: 'QUEUED' }, 1000, 5000), 0, 'a run queued behind another sweep needs no follow-up');
});

test('M5: a run whose pass found the App limit at the margin ends green with the paused note and asks for one follow-up after the reset', () => {
  const { RESET_WAIT_MS } = gateScript();
  const before = Date.now();
  const paused = runAction('run', { env: minted, refresh: () => ({ status: 0, code: null, report: { outcome: 'PAUSED', reason: 'GitHub rate limit' } }) });
  assert.equal(paused.code, 0);
  assert.deepEqual(paused.failures, []);
  assert.match(paused.summaries[0], /^Programme Sweep paused: GitHub's hourly App limit/);
  const at = Number(paused.outputs.find(([name]) => name === 'follow_up_at')?.[1]);
  assert.ok(at >= before + RESET_WAIT_MS && at <= Date.now() + RESET_WAIT_MS, 'the follow-up waits for the reset, so it runs at most once an hour');
  // A finished pass asks for nothing.
  const done = runAction('run', { env: minted });
  assert.equal(done.outputs.some(([name]) => name === 'follow_up_at'), false);
});

// Footer cleaning: the third step of the sweep.
function runFooters({ env = {}, footers = null, now = Date.parse('2026-11-13T00:00:00Z') } = {}) {
  const failures = [], summaries = [], warnings = [], calls = [];
  const runner = new (action().ProgrammeSweepAction)({
    env: { GITHUB_REPOSITORY: 'owner/repository', GITHUB_REPOSITORY_OWNER: 'owner', STORE_REPOSITORY: 'owner/evidence', GOVERNED_TOKEN: fakeToken, STORE_TOKEN: storeToken, REFRESHED: 'true', PATH: process.env.PATH, ...env },
    root: ROOT, nowMs: () => now,
    footers: input => { calls.push(input); return footers ? footers(input) : { status: 0, results: [] }; },
    failure: message => failures.push(message), summary: line => summaries.push(line), warning: message => warnings.push(message),
  });
  return { code: runner.cleanFooters(), failures, summaries, warnings, calls };
}

test('footers: each repository is cleaned under its own token, for the owner\'s posts in the last 26 hours', () => {
  const result = runFooters();
  assert.equal(result.code, 0);
  assert.deepEqual(result.calls.map(call => [call.repository, call.token, call.author, call.since]), [
    ['owner/repository', fakeToken, 'owner', '2026-11-11T22:00:00.000Z'],
    ['owner/evidence', storeToken, 'owner', '2026-11-11T22:00:00.000Z'],
  ]);
  assert.deepEqual(result.summaries, ['Footer cleaning since 2026-11-11T22:00:00.000Z: cleaned=0, skipped=0, review bodies refused=0, failed=0']);
  const manual = runFooters({ env: { FOOTER_SINCE: '2026-11-01T00:00:00Z' } });
  assert.equal(manual.calls[0].since, '2026-11-01T00:00:00.000Z', 'a manual run can reach further back');
  const odd = runFooters({ env: { FOOTER_SINCE: 'yesterday-ish' } });
  assert.equal(odd.calls[0].since, '2026-11-11T22:00:00.000Z', 'an unreadable time falls back to the window');
});

test('footers: without the App tokens nothing runs; a bad owner or repository fails before any edit', () => {
  for (const missing of ['STORE_REPOSITORY', 'GOVERNED_TOKEN', 'STORE_TOKEN']) {
    const result = runFooters({ env: { [missing]: '' } });
    assert.deepEqual([result.code, result.calls.length], [0, 0], missing);
  }
  for (const env of [{ GITHUB_REPOSITORY_OWNER: 'app[bot]' }, { GITHUB_REPOSITORY_OWNER: '' }, { STORE_REPOSITORY: 'not a repo' }]) {
    const result = runFooters({ env });
    assert.deepEqual([result.code, result.calls.length], [1, 0], JSON.stringify(env));
    assert.equal(result.failures[0], action().FOOTER_FAILURE);
  }
});

test('footers: counts only reach the summary; refused review bodies warn; any other failure fails the step', () => {
  const rows = [
    { status: 'CLEANED', kind: 'issue_comment', url: 'https://github.com/owner/evidence/issues/1#issuecomment-9' },
    { status: 'SKIPPED_OTHER_AUTHOR', kind: 'issue_comment', url: 'https://github.com/owner/repository/issues/2#issuecomment-8' },
    { status: 'FAILED', kind: 'review', url: 'https://github.com/owner/repository/pull/3#pullrequestreview-7', detail: 'HTTP 403' },
  ];
  const warned = runFooters({ footers: () => ({ status: 1, results: rows }) });
  assert.equal(warned.code, 0, 'a refused review body alone does not fail the sweep');
  assert.deepEqual(warned.warnings, [action().FOOTER_REVIEW_WARNING]);
  assert.match(warned.summaries[0], /cleaned=2, skipped=2, review bodies refused=2, failed=0$/);
  assert.doesNotMatch(warned.summaries.join('\n'), /github\.com|issuecomment|HTTP 403/, 'no post, link or GitHub text');
  for (const status of ['FAILED', 'STILL_FOOTED', 'MISMATCH']) {
    const failed = runFooters({ footers: () => ({ status: 1, results: [{ status, kind: 'issue_comment' }] }) });
    assert.equal(failed.code, 1, status);
    assert.deepEqual(failed.failures, [action().FOOTER_FAILURE]);
  }
  const reviewMismatch = runFooters({ footers: () => ({ status: 1, results: [{ status: 'MISMATCH', kind: 'review' }] }) });
  assert.equal(reviewMismatch.code, 1, 'a review edit that went through but read back wrong is a failure');
  const unreadable = runFooters({ footers: () => ({ status: 1, results: null }) });
  assert.equal(unreadable.code, 1);
  const thrown = runFooters({ footers: () => { throw new Error(fakeToken); } });
  assert.equal(thrown.code, 1);
  assert.doesNotMatch([...thrown.failures, ...thrown.summaries].join('\n'), new RegExp(fakeToken));
});

test('footers: the child process gets only its own token and runs the footer sweep without a shell', () => {
  const seen = [];
  const spawn = (file, args, options) => { seen.push({ file, args, options }); return { status: 0, stdout: '{"apply":true,"results":[]}\n', stderr: '' }; };
  const result = action().runFooterSweep({ root: ROOT, env: { PATH: '/bin', HOME: '/home/runner', GOVERNED_TOKEN: fakeToken, STORE_TOKEN: storeToken, GITHUB_TOKEN: 'built-in', TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY: 'key' },
    repository: 'owner/evidence', token: storeToken, author: 'owner', since: '2026-11-11T22:00:00.000Z', spawn });
  assert.deepEqual(result, { status: 0, results: [] });
  assert.equal(seen[0].options.shell, false);
  assert.deepEqual(seen[0].args.slice(1), ['--repo', 'owner/evidence', '--since', '2026-11-11T22:00:00.000Z', '--author', 'owner', '--apply', '--json']);
  assert.equal(seen[0].options.env.GH_TOKEN, storeToken);
  for (const name of ['GOVERNED_TOKEN', 'STORE_TOKEN', 'GITHUB_TOKEN', 'TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY']) assert.equal(seen[0].options.env[name], undefined, name);
  assert.deepEqual(action().runFooterSweep({ root: ROOT, env: {}, repository: 'a/b', token: 't', author: 'a', since: 's', spawn: () => ({ status: 1, stdout: 'not json', stderr: '' }) }), { status: 1, results: null });
});

test('workflow: footer cleaning runs after the refresh, on minted tokens, and a manual run can widen its window', () => {
  const text = workflow();
  assert.match(text, /  workflow_dispatch:\r?\n    inputs:\r?\n      footer_since:\r?\n        description: .+\r?\n        required: false\r?\n        default: ''/);
  const footers = step("Clean the cloud footer from the owner's posts");
  assert.ok(text.indexOf("- name: Clean the cloud footer") > text.indexOf('- name: Refresh the programme'), 'after the refresh');
  assert.match(footers, /if: \$\{\{ !cancelled\(\) && steps\.governed\.outcome == 'success' && steps\.store\.outcome == 'success' && steps\.refresh\.outputs\.refreshed == 'true' && steps\.refresh\.outputs\.at_limit != 'true' \}\}/);
  assert.match(footers, /REFRESHED: \$\{\{ steps\.refresh\.outputs\.refreshed \}\}/);
  assert.match(footers, /FOOTER_SINCE: \$\{\{ inputs\.footer_since \}\}/);
  assert.match(footers, /run: node repo\/scripts\/toolkit-programme-sweep-action\.cjs footers\s*$/);
  assert.doesNotMatch(footers, /secrets\./);
  assert.match(step('Mint the evidence store token'), /permission-contents: write\r?\n\s+permission-issues: write\r?\n\s+permission-pull-requests: write/);
});

// A manual run can pick any branch. Off the default branch no App token is minted and nothing is
// edited: the store step stops it with one warning, and the footer step needs a refresh that ran.
test('off the default branch: the store step names no store, so no token is minted, with one warning naming the ref and the branch', () => {
  for (const env of [{ GITHUB_REF: 'refs/heads/feature/x' }, { GITHUB_REF: 'refs/tags/v1' }, { GITHUB_REF: 'refs/pull/5/merge' }, { DEFAULT_BRANCH: '' }, { GITHUB_REF: '' }]) {
    const result = runAction('store', { env });
    assert.equal(result.code, 0, JSON.stringify(env));
    assert.deepEqual(result.outputs, [['store', '']], JSON.stringify(env));
    assertSkipWarning(result, /not the default branch/);
    assert.equal(result.refreshes.length, 0);
  }
  const named = runAction('store', { env: { GITHUB_REF: 'refs/heads/feature/x' } });
  assert.match(named.warnings[0], /refs\/heads\/feature\/x/);
  assert.match(named.warnings[0], /main/);
  assert.match(named.warnings[0], /Fix: start it from main/);
  const other = runAction('store', { env: { GITHUB_REF: 'refs/heads/trunk', DEFAULT_BRANCH: 'trunk' } });
  assert.deepEqual(other.outputs, [['store', 'evidence'], ['store_repository', 'owner/evidence']], 'a default branch not called main still runs');
  assert.match(step('Read the evidence store from the binding'), /DEFAULT_BRANCH: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  for (const name of ['Mint the governed repository token', 'Mint the evidence store token']) assert.match(step(name), /steps\.binding\.outputs\.store != ''/, name);
});

test('refreshed: only a pass that ran says so; every skip and failure leaves footer cleaning off', () => {
  const ran = runAction('run', { env: minted });
  assert.ok(ran.outputs.some(([name, value]) => name === 'refreshed' && value === 'true'));
  const held = runAction('run', { env: minted, refresh: () => ({ status: 1, code: null, report: { metrics: 'Sweep: requests=4', holds: ['x'] } }) });
  assert.ok(held.outputs.some(([name, value]) => name === 'refreshed' && value === 'true'), 'a held pass ran');
  for (const [label, env, refresh] of [
    ['queued behind another sweep', minted, () => ({ status: 0, code: null, report: { outcome: 'QUEUED', reason: 'another sweep is running' } })],
    ['main moved', minted, () => ({ status: 1, code: 'MAIN_MOVED', report: null })],
    ['public state', minted, () => ({ status: 1, code: 'CLOUD_PUBLIC_STATE', report: null })],
    ['sign-in', minted, () => ({ status: 1, code: 'GH_AUTH', report: null })],
    ['failure', minted, () => ({ status: 1, code: 'GOVERNANCE_STATE_UNAVAILABLE', report: null })],
    ['no store', { ...minted, STORE_REPOSITORY: '' }, null],
    ['no App', { ...minted, APP_CLIENT_ID_SET: 'false' }, null],
    ['mint failed', { ...minted, MINT_OUTCOME: 'failure/success' }, null]]) {
    const result = runAction('run', { env, refresh });
    assert.equal(result.outputs.some(([name]) => name === 'refreshed'), false, label);
  }
});

// saqg review: near the App limit a pass that cannot read its large state documents stops before any
// write, and its stop reason names the documents, not the limit. It must not count as refreshed.
test('App limit and no-write stops: never refreshed, so footer cleaning never runs; a no-write pass is held', () => {
  const { RESET_WAIT_MS } = gateScript();
  const stop = { code: 'PASS_STOPPED', target: '#421', detail: 'the last refresh stopped at planning' };
  const truncatedAtLimit = { status: 1, code: null, report: { metrics: 'Sweep: requests=4400', holds: [stop],
    sweep: { read: 0, left: 12, noWrite: true, reason: 'State documents too large for GraphQL', limit: 'GitHub rate limit' } } };
  const busy = { status: 1, code: null, report: { metrics: 'Sweep: requests=90', holds: [stop],
    sweep: { read: 4, left: 0, noWrite: true, reason: 'state branch busy', limit: null } } };
  const unheldNoWrite = { status: 0, code: null, report: { metrics: 'Sweep: requests=30', holds: [], sweep: { read: 0, left: 3, noWrite: true, reason: 'time limit', limit: null } } };
  const midPassLimit = { status: 0, code: null, report: { metrics: 'Sweep: requests=4500', holds: [], sweep: { read: 5, left: 10, reason: 'GitHub rate limit', limit: 'GitHub rate limit' } } };
  const paused = { status: 0, code: null, report: { outcome: 'PAUSED', reason: 'GitHub rate limit' } };
  const has = (result, name) => result.outputs.some(([key, value]) => key === name && value === 'true');
  for (const [label, refresh, limited] of [['truncated documents at the App limit', truncatedAtLimit, true], ['busy state branch', busy, false],
    ['no-write pass without a hold', unheldNoWrite, false], ['mid-pass App limit', midPassLimit, true], ['PAUSED', paused, true]]) {
    const result = runAction('run', { env: minted, refresh: () => refresh });
    assert.equal(result.code, 0, label);
    assert.equal(has(result, 'refreshed'), false, `${label}: not refreshed`);
    assert.equal(has(result, 'at_limit'), limited, `${label}: at_limit`);
  }
  // The stop reason alone names the documents; the limit that bound it makes it an App-limit stop.
  assert.equal(action().atAppLimit(truncatedAtLimit.report), true);
  assert.equal(action().atAppLimit({ sweep: { ...truncatedAtLimit.report.sweep, limit: 'request cap' } }), false);
  assert.equal(action().wroteNothing(truncatedAtLimit.report), true);
  assert.equal(action().wroteNothing(midPassLimit.report), false);
  // Held: titled, so the gate counts it; a no-write pass without a hold is held too, under NO_WRITE.
  const held = runAction('run', { env: minted, refresh: () => truncatedAtLimit });
  assert.deepEqual(held.tags, [{ title: action().HELD_TITLE, code: 'PASS_STOPPED' }]);
  const unsaved = runAction('run', { env: minted, refresh: () => unheldNoWrite });
  assert.deepEqual(unsaved.warnings, [action().NOTICES.unsaved]);
  assert.deepEqual(unsaved.tags, [{ title: action().HELD_TITLE, code: 'NO_WRITE' }]);
  assert.deepEqual(runAction('run', { env: minted, refresh: () => paused }).tags, [], 'PAUSED stays calm');
  // It read and saved nothing, so it follows up once the limit resets, on a private repository too
  // (it leaves no board note for the hourly gate to resume from).
  for (const env of [minted, { ...minted, REPOSITORY_PRIVATE: 'true' }]) {
    const before = Date.now();
    const result = runAction('run', { env, refresh: () => truncatedAtLimit });
    const at = Number(result.outputs.find(([name]) => name === 'follow_up_at')?.[1]);
    assert.ok(at >= before + RESET_WAIT_MS && at <= Date.now() + RESET_WAIT_MS, JSON.stringify(result.outputs));
    assert.deepEqual(result.notices, []);
  }
  assert.equal(action().followUpAt(truncatedAtLimit.report, 1000, 5000), 1000 + RESET_WAIT_MS);
  assert.equal(action().followUpAt(busy.report, 1000, 5000), 0, 'a busy branch below the limit needs no wait');
  // The footer step runs only on refreshed == 'true', so none of these edits a post.
  assert.match(step('Clean the cloud footer from the owner\'s posts'), /steps\.refresh\.outputs\.refreshed == 'true'/);
});

// saqg review: a pass whose state commit did not read back as written reports a
// STATE_READBACK_MISMATCH hold and no verified write, but not noWrite (the commit may stand). It must
// not count as refreshed, so footer cleaning never edits a post on an unverified save.
test('state readback mismatch: never refreshed, so footer cleaning is skipped; the pass is held', () => {
  const mismatch = { code: 'STATE_READBACK_MISMATCH', target: '#421', detail: 'state/parent-421.json did not read back as written in the state commit.' };
  const unverified = { status: 1, code: null, report: { metrics: 'Sweep: requests=40', holds: [mismatch], writes: { state: 0, github: 0 },
    sweep: { read: 3, left: 0, noWrite: false, reason: null, limit: null } } };
  const result = runAction('run', { env: minted, refresh: () => unverified });
  assert.equal(result.code, 0);
  assert.equal(result.outputs.some(([name]) => name === 'refreshed'), false, 'not refreshed');
  assert.equal(result.outputs.some(([name]) => name === 'at_limit'), false, 'not at the limit');
  assert.deepEqual(result.tags, [{ title: action().HELD_TITLE, code: 'STATE_READBACK_MISMATCH' }]);
  assert.equal(action().saveUnverified(unverified.report), true);
  assert.equal(action().wroteNothing(unverified.report), false, 'the reconciler does not report it as noWrite');
  // Another hold beside a verified save still counts as refreshed: only the readback decides.
  const other = { status: 1, code: null, report: { metrics: 'Sweep: requests=40', holds: [{ code: 'STATE_WRITE_FAILED', target: '#500', detail: 'x' }], sweep: { read: 3, left: 0, noWrite: false } } };
  assert.equal(action().saveUnverified(other.report), false);
  assert.ok(runAction('run', { env: minted, refresh: () => other }).outputs.some(([name, value]) => name === 'refreshed' && value === 'true'));
  // The footer step then sees no REFRESHED and edits nothing.
  const footers = runFooters({ env: { REFRESHED: '' } });
  assert.deepEqual([footers.code, footers.calls.length], [0, 0]);
  assert.deepEqual(footers.warnings, [action().FOOTER_SKIPPED]);
});

test('footers: without a refresh that ran this commit, nothing is edited and one warning says so', () => {
  for (const REFRESHED of ['', 'false', undefined]) {
    const result = runFooters({ env: { REFRESHED } });
    assert.deepEqual([result.code, result.calls.length], [0, 0], String(REFRESHED));
    assert.deepEqual(result.warnings, [action().FOOTER_SKIPPED]);
    assert.deepEqual(result.summaries, []);
  }
});

// #886 slice A2: the holder orders a cloud pass ran are counted in the summary, never printed.
test('action: holder orders the pass ran add a counts line; a refused one also warns', () => {
  const report = orders => ({ status: 0, code: null, report: { metrics: 'Sweep: requests=40, tasks read=3, queue left=0', holds: [], orders } });
  const quiet = runAction('refresh', { env: minted, refresh: () => report({ done: 0, refused: 0, pending: 0, results: [] }) });
  assert.equal(quiet.code, 0);
  assert.equal(quiet.summaries.length, 1, 'an empty queue adds no line');
  const ran = runAction('refresh', { env: minted, refresh: () => report({ done: 2, refused: 1, pending: 1, results: [{ order_id: 'secret-looking-id', outcome: 'DONE' }] }) });
  assert.equal(ran.code, 0);
  assert.deepEqual(ran.summaries.slice(1), ['Holder orders: done=2, refused=1, left pending=1']);
  assert.ok(!ran.summaries.join('\n').includes('secret-looking-id'), 'order ids stay in the store');
  assert.deepEqual(ran.warnings, [action().ORDERS_REFUSED]);
  const done = runAction('refresh', { env: minted, refresh: () => report({ done: 1, refused: 0, pending: 0, results: [] }) });
  assert.deepEqual(done.warnings, []);
  assert.deepEqual(action().ordersLine({ done: -1, refused: 'x', pending: 3 }), { line: 'Holder orders: done=0, refused=0, left pending=3', refused: 0, retrying: 0, unreadable: null });
});

test('action: orders retrying after a GitHub failure, or a queue that could not be read, warn each run', () => {
  const report = orders => ({ status: 0, code: null, report: { metrics: 'Sweep: requests=40, tasks read=3, queue left=0', holds: [], orders } });
  const retrying = runAction('refresh', { env: minted, refresh: () => report({ done: 0, refused: 0, pending: 1, retrying: 1, results: [] }) });
  assert.deepEqual(retrying.warnings, [action().ORDERS_RETRYING]);
  const capped = runAction('refresh', { env: minted, refresh: () => report({ done: 10, refused: 0, pending: 2, retrying: 0, results: [] }) });
  assert.deepEqual(capped.warnings, []);
  const unreadable = runAction('refresh', { env: minted, refresh: () => report({ done: 0, refused: 0, pending: 0, retrying: 0, unreadable: 'GH_FAILED', results: [] }) });
  assert.equal(unreadable.code, 0);
  assert.match(unreadable.summaries[1], /could not be read \(GH_FAILED\)/);
  assert.deepEqual(unreadable.warnings, [action().ORDERS_RETRYING]);
});
