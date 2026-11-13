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
const step = name => { const text = workflow(); const at = text.indexOf(`- name: ${name}`); return text.slice(at, text.indexOf('\n      - name:', at + 1) === -1 ? undefined : text.indexOf('\n      - name:', at + 1)); };

test('workflow: hourly off the top of the hour, after each push to main and by hand only, read-only built-in token, no saved credentials, one run at a time, stopped at 58 minutes', () => {
  const text = workflow();
  assert.match(text, /^on:\r?\n  schedule:\r?\n    - cron: '41 \* \* \* \*'\r?\n  push:\r?\n    branches: \[main\]\r?\n  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(text, /^\s+(pull_request|pull_request_target|workflow_run|repository_dispatch):/m, 'never started by pull requests, forks or other workflows');
  assert.equal((text.match(/^\s+push:/gm) || []).length, 1, 'one push trigger');
  assert.doesNotMatch(text, /tags:|branches-ignore:|'\*\*'/, 'pushes to main only');
  assert.match(text, /^permissions:\r?\n  contents: read\s*$/m);
  assert.match(text, /^    permissions:\r?\n      contents: read\s*$/m);
  assert.match(text, /persist-credentials: false/);
  assert.match(text, /concurrency:\r?\n  group: toolkit-programme-sweep-\$\{\{ github\.repository \}\}\r?\n  cancel-in-progress: false/);
  assert.match(text, /timeout-minutes: 58/);
  for (const uses of text.match(/^\s+uses: \S+/gm)) assert.match(uses, /@[0-9a-f]{40}$/, `${uses.trim()} is pinned by commit`);
  assert.equal((text.match(/actions\/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510/g) || []).length, 2);
});

test('contract: mint permissions match the row', () => {
  const row = cloudJobs().readCloudJobsContract({ root: ROOT }).jobs.find(job => job.id === 'programme-sweep');
  assert.equal(row.workflow, '.github/workflows/toolkit-programme-sweep.yml');
  assert.equal(row.schedule.cron, '41 * * * *');
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

function runAction(mode, { env = {}, file = binding(), refresh = null } = {}) {
  const notices = [], failures = [], outputs = [], summaries = [], refreshes = [];
  const runner = new (action().ProgrammeSweepAction)({
    env: { GITHUB_REPOSITORY: 'owner/repository', ...env }, root: ROOT,
    readFile: () => { if (file === null) throw Object.assign(new Error('absent'), { code: 'ENOENT' }); return Buffer.from(typeof file === 'string' ? file : JSON.stringify(file)); },
    validateBinding: value => state.validateBinding(value),
    refresh: input => { refreshes.push(input); return refresh ? refresh(input) : { status: 0, code: null, report: { metrics: 'Sweep: requests=40, tasks read=3, queue left=0', holds: [] } }; },
    notice: message => notices.push(message), failure: message => failures.push(message), output: (name, value) => outputs.push([name, value]), summary: line => summaries.push(line),
  });
  const code = mode === 'store' ? runner.store() : runner.run();
  return { code, notices, failures, outputs, summaries, refreshes };
}
const minted = { STORE_REPOSITORY: 'owner/evidence', APP_CLIENT_ID_SET: 'true', MINT_OUTCOME: 'success/success', GOVERNED_TOKEN: fakeToken, STORE_TOKEN: storeToken, SWEEP_LOGIN: 'toolkit-governance[bot]' };

test('action: the store step names the evidence store from the checked-out binding', () => {
  const result = runAction('store');
  assert.equal(result.code, 0);
  assert.deepEqual(result.outputs, [['store', 'evidence'], ['store_repository', 'owner/evidence']]);
  assert.deepEqual(result.notices, []);
});

test('cloud: public state branch is refused with a notice', () => {
  const result = runAction('store', { file: binding({ publicState: true }) });
  assert.equal(result.code, 0);
  assert.deepEqual(result.outputs, [['store', '']]);
  assert.match(result.notices[0], /public branch; the cloud sweep does not run it yet/);
});

for (const [label, file] of [['absent', null], ['disabled', binding({ governance: 'disabled' })], ['another repository', binding({ repository: 'owner/other' })],
  ['a store of another owner', binding({ store: 'someone-else/evidence' })], ['invalid', '{"schema":'], ['oversize', ' '.repeat(65 * 1024)]]) {
  test(`action: ${label} binding gives a notice and writes nothing`, () => {
    const result = runAction('store', { file });
    assert.equal(result.code, 0);
    assert.deepEqual(result.outputs, [['store', '']]);
    assert.equal(result.notices.length, 1);
    assert.equal(result.refreshes.length, 0);
  });
}

test('action: no App configured gives a notice naming the variable, the secret and the check', () => {
  const result = runAction('run', { env: { STORE_REPOSITORY: 'owner/evidence', APP_CLIENT_ID_SET: 'false', MINT_OUTCOME: 'skipped/skipped' } });
  assert.equal(result.code, 0);
  assert.match(result.notices[0], /TOOLKIT_GOVERNANCE_APP_CLIENT_ID.*TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY.*toolkit governance check/);
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
  const queued = runAction('run', { env: minted, refresh: () => ({ status: 0, code: null, report: { outcome: 'QUEUED', reason: 'another sweep is running' } }) });
  assert.deepEqual(queued.summaries, [action().NOTICES.queued]);
  const moved = runAction('run', { env: minted, refresh: () => ({ status: 2, code: 'MAIN_MOVED', report: null }) });
  assert.equal(moved.code, 0);
  assert.deepEqual(moved.notices, [action().NOTICES.main_moved]);
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

// Footer cleaning: the third step of the sweep.
function runFooters({ env = {}, footers = null, now = Date.parse('2026-11-13T00:00:00Z') } = {}) {
  const failures = [], summaries = [], warnings = [], calls = [];
  const runner = new (action().ProgrammeSweepAction)({
    env: { GITHUB_REPOSITORY: 'owner/repository', GITHUB_REPOSITORY_OWNER: 'owner', STORE_REPOSITORY: 'owner/evidence', GOVERNED_TOKEN: fakeToken, STORE_TOKEN: storeToken, PATH: process.env.PATH, ...env },
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
  assert.match(footers, /if: \$\{\{ !cancelled\(\) && steps\.governed\.outcome == 'success' && steps\.store\.outcome == 'success' \}\}/);
  assert.match(footers, /FOOTER_SINCE: \$\{\{ inputs\.footer_since \}\}/);
  assert.match(footers, /run: node repo\/scripts\/toolkit-programme-sweep-action\.cjs footers\s*$/);
  assert.doesNotMatch(footers, /secrets\./);
  assert.match(step('Mint the evidence store token'), /permission-contents: write\r?\n\s+permission-issues: write\r?\n\s+permission-pull-requests: write/);
});
