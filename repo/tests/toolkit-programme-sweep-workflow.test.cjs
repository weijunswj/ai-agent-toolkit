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

test('workflow: hourly and manual only, read-only built-in token, no saved credentials, one run at a time, stopped at 58 minutes', () => {
  const text = workflow();
  assert.match(text, /^on:\r?\n  schedule:\r?\n    - cron: '17 \* \* \* \*'\r?\n  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(text, /^\s+(pull_request|pull_request_target|push):/m);
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
  assert.equal(row.schedule.cron, '17 * * * *');
  const minted = name => Object.fromEntries([...step(name).matchAll(/permission-([a-z-]+): (read|write)/g)].map(([, permission, level]) => [permission.replace(/-/g, '_'), level]));
  const wanted = repository => cloudJobs().tokenPermissions(row.tokens.find(token => token.repository === repository));
  assert.deepEqual(minted('Mint the governed repository token'), wanted('governed_repository'));
  assert.deepEqual(minted('Mint the evidence store token'), wanted('evidence_store'));
  assert.match(step('Mint the evidence store token'), /owner: \$\{\{ github\.repository_owner \}\}\r?\n\s+repositories: \$\{\{ steps\.binding\.outputs\.store \}\}/);
  assert.doesNotMatch(step('Mint the governed repository token'), /owner:|repositories:/, 'the governed token is for this repository alone');
});

test('workflow: the key reaches only the mint steps, the tokens only the refresh step', () => {
  const text = workflow();
  assert.equal((text.match(/secrets\.TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY/g) || []).length, 2);
  for (const name of ['Mint the governed repository token', 'Mint the evidence store token']) {
    assert.match(step(name), /secrets\.TOOLKIT_GOVERNANCE_APP_PRIVATE_KEY/);
    assert.match(step(name), /if: \$\{\{ vars\.TOOLKIT_GOVERNANCE_APP_CLIENT_ID != '' && steps\.binding\.outputs\.store != '' \}\}/);
    assert.match(step(name), /continue-on-error: true/);
  }
  assert.equal((text.match(/outputs\.token/g) || []).length, 2);
  assert.match(step('Refresh the programme'), /GOVERNED_TOKEN: \$\{\{ steps\.governed\.outputs\.token \}\}/);
  assert.match(step('Refresh the programme'), /STORE_TOKEN: \$\{\{ steps\.store\.outputs\.token \}\}/);
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
