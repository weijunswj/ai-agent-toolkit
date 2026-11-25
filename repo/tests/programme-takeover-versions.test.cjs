'use strict';

// The Toolkit versions a takeover reports, in its dry run and its done line: the copy this chat loaded, the
// copy that ran, Toolkit main and the repository's cloud sweep, and the one refresh to do. The copies on
// this computer are a fake git and real folders; GitHub is the in-memory one.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { state, FakeGitHub, fixture, wroteNothing, REPO, NEW, WORDS } = require('./programme-takeover-fixture.cjs');
const workflows = require('../scripts/toolkit-cloud-workflows.cjs');
const { TOOLKIT_VERSION, VERSION_REL_PATH } = require('../scripts/toolkit-version.cjs');

const ROOT = path.resolve(__dirname, '../..');
const MAIN = '1'.repeat(40);
const OLD = '3'.repeat(40);
const SWEEP_FILE = workflows.WORKFLOWS[0].file;
const temps = [];
test.after(() => { for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true }); });

// A folder with the files a Toolkit copy has, or only some of them.
function copy({ version = TOOLKIT_VERSION, versionText = null, name = 'ai-agent-toolkit', manifest = '.claude-plugin' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-copy-'));
  temps.push(dir);
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
  if (version !== null) write(VERSION_REL_PATH, versionText ?? JSON.stringify({ version }));
  if (name !== null) write(`${manifest}/plugin.json`, JSON.stringify({ name }));
  return dir;
}

// The copy that ran: a checkout at `head` (null: a folder with no git of its own).
const checkout = head => (cwd, args) => {
  const answer = (status, stdout = '') => ({ status, stdout, stderr: '', error: null });
  if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return head ? answer(0, `${ROOT}\n`) : answer(128);
  if (args[0] === 'rev-parse' && args[1] === 'HEAD') return answer(0, `${head}\n`);
  throw new Error(`git ${args.join(' ')} was not expected: Toolkit main is read once, from GitHub`);
};

const sweepCopy = ({ commit = MAIN, edit = text => text } = {}) => {
  const source = fs.readFileSync(path.join(ROOT, SWEEP_FILE), 'utf8').replace(/\r\n/g, '\n');
  return edit(workflows.render('programme-sweep', source, commit, null));
};
// A copy as Toolkit wrote them before layouts: one commit for every Toolkit checkout, and no layout field.
const pinnedCopy = () => {
  const current = sweepCopy();
  const body = current.slice(current.indexOf('\n') + 1).replace(/^( {10}ref: ).*vars\.TOOLKIT_REF.*$/gm, `$1${OLD}`);
  return `# AI-AGENT-TOOLKIT:cloud-workflows:RENDERED programme-sweep toolkit=${OLD} sha256=${workflows.bodyHash(body)}\n${body}`;
};

// The governed repository's sweep copy and TOOLKIT_REF variable, and Toolkit main's version, on GitHub.
function world(fx, { sweep = sweepCopy(), pin = null, pinStatus = null, mainVersion = TOOLKIT_VERSION, sweepStatus = null } = {}) {
  const encoded = text => ({ status: 200, json: { encoding: 'base64', sha: 'f'.repeat(40), content: Buffer.from(text, 'utf8').toString('base64') } });
  fx.github.toolkitMain.version = mainVersion;
  fx.github.intercept(call => {
    if (call.method !== 'GET') return undefined;
    if (call.path === `repos/${REPO}/contents/${SWEEP_FILE}?ref=main`) return sweepStatus ? { status: sweepStatus, json: {} } : sweep === null ? { status: 404, json: {} } : encoded(sweep);
    if (call.path === `repos/${REPO}/actions/variables/TOOLKIT_REF`) return pinStatus ? { status: pinStatus, json: {} } : pin === null ? { status: 404, json: {} } : { status: 200, json: { name: 'TOOLKIT_REF', value: pin } };
    return undefined;
  });
  return fx;
}
const argsFor = chat => (chat === undefined ? [] : ['--session-copy', chat]);

test('the done line and the dry run hold the four versions and one refresh action', () => {
  const chat = copy();
  const fx = world(fixture());
  const git = checkout(MAIN);
  const line = `versions: this chat ${TOOLKIT_VERSION}, ran ${TOOLKIT_VERSION} (1111111), Toolkit main ${TOOLKIT_VERSION} (1111111), sweep follows main; refresh: none`;
  const dry = fx.dry(argsFor(chat), { deps: { toolkitGit: git } });
  assert.equal(dry.error, null, dry.error?.message);
  assert.equal(dry.result.versions.line, line);
  assert.deepEqual(dry.result.versions, { line, refresh: 'none', chat: { version: TOOLKIT_VERSION, state: 'current' }, ran: { version: TOOLKIT_VERSION, commit: MAIN, state: 'current' },
    main: { version: TOOLKIT_VERSION, commit: MAIN }, sweep: { state: 'current', text: 'follows main' } });
  const text = fx.run(['takeover', '--session', NEW, ...WORDS, ...argsFor(chat)], { toolkitGit: git });
  assert.ok(text.result.includes(`\nVersions: ${line.slice('versions: '.length)}\n`), text.result);
  const done = fx.takeover(argsFor(chat), { deps: { toolkitGit: git } });
  assert.equal(done.error, null, done.error?.message);
  assert.ok(done.result.done_line.includes(`; ${line}; `), done.result.done_line);
  assert.equal(done.result.done_line.split('refresh: ').length, 2, 'exactly one refresh action');
  assert.equal(done.result.done_line.split('\n').length, 1);
});

// [label, this chat's version (null: not given), the running copy's commit, the sweep, the action, what the line says of them]
const UPDATE = /^run node ".*\/repo\/scripts\/toolkit-local-bridge\.cjs" --repo-update-now --write, then reread CONTROLLER\.md and the global rules$/;
const CHAT = /^say `refresh toolkit`, then go on in a fresh chat$/;
const SWEEP = /^run node ".*\/repo\/scripts\/toolkit-cloud-workflows\.cjs" --repo <target checkout> --refresh-pr$/;
const PIN = new RegExp(`^ask the owner whether the TOOLKIT_REF variable still pins ${REPO} at ${OLD}$`);
const NONE = /^none$/;
const CHATS = [['not given', null, false], ['current', TOOLKIT_VERSION, false], ['behind', '0.0.1', true]];
const RANS = [['current', MAIN, false], ['behind', OLD, true]];
const SWEEPS = [['follows main', {}, NONE], ['pinned', { pin: OLD }, PIN], ['outdated', { sweep: pinnedCopy() }, SWEEP]];

test('the one refresh action: the copy that ran, then this chat\'s, then the sweep, then none, for every order of behind and current', () => {
  let seen = 0;
  for (const [ranLabel, head, ranBehind] of RANS) for (const [chatLabel, version, chatBehind] of CHATS) for (const [sweepLabel, options, sweepAction] of SWEEPS) {
    const fx = world(fixture(), options);
    const { result, error } = fx.dry(argsFor(version === null ? undefined : copy({ version })), { deps: { toolkitGit: checkout(head) } });
    const label = `ran ${ranLabel}, chat ${chatLabel}, sweep ${sweepLabel}`;
    assert.equal(error, null, `${label}: ${error?.message}`);
    assert.match(result.versions.refresh, ranBehind ? UPDATE : chatBehind ? CHAT : sweepAction, label);
    assert.deepEqual([result.versions.ran.state, result.versions.chat?.state ?? 'not given', result.versions.sweep.state],
      [ranBehind ? 'not at main' : 'current', version === null ? 'not given' : chatBehind ? 'behind' : 'current', { 'follows main': 'current', pinned: 'pinned', outdated: 'outdated' }[sweepLabel]], label);
    assert.ok(result.versions.line.endsWith(`; refresh: ${result.versions.refresh}`), label);
    assert.ok(result.versions.line.startsWith(`versions: this chat ${version === null ? 'not given' : version}, ran ${TOOLKIT_VERSION} (${head.slice(0, 7)}), Toolkit main ${TOOLKIT_VERSION} (1111111), sweep `), result.versions.line);
    // A version fact is never a hold.
    assert.deepEqual([result.ready, result.holds], [true, []], label);
    seen += 1;
  }
  assert.equal(seen, 18);
});

test('a copy that ran with no git of its own is compared by version', () => {
  for (const [mainVersion, expected] of [[TOOLKIT_VERSION, 'current'], ['999.0.0', 'behind'], ['0.0.1', 'current']]) {
    const fx = world(fixture(), { mainVersion });
    const { result } = fx.dry([], { deps: { toolkitGit: checkout(null) } });
    assert.deepEqual(result.versions.ran, { version: TOOLKIT_VERSION, commit: null, state: expected }, mainVersion);
    assert.match(result.versions.refresh, expected === 'behind' ? UPDATE : NONE);
  }
  // A folder inside another repository is not that repository's checkout.
  const inside = (cwd, args) => (args[1] === '--show-toplevel' ? { status: 0, stdout: `${os.tmpdir()}\n`, stderr: '' } : { status: 0, stdout: `${OLD}\n`, stderr: '' });
  assert.equal(world(fixture()).dry([], { deps: { toolkitGit: inside } }).result.versions.ran.commit, null);
});

test('what this repository\'s sweep runs, in each state it can be in', () => {
  const edited = sweepCopy({ edit: text => `${text}# by hand\n` });
  for (const [label, options, expected, action] of [
    ['follows main', {}, { state: 'current', text: 'follows main' }, NONE],
    ['an empty pin', { pin: '' }, { state: 'current', text: 'follows main' }, NONE],
    ['a pin not read', { pinStatus: 403 }, { state: 'current', text: 'follows main unless a TOOLKIT_REF variable pins it (not read: HTTP 403)' }, /^none \(not compared: the sweep's pin\)$/],
    ['pinned at main itself', { pin: MAIN }, { state: 'pinned', text: 'pinned at 1111111 by the TOOLKIT_REF variable' }, NONE],
    ['pinned elsewhere', { pin: OLD }, { state: 'pinned', text: 'pinned at 3333333 by the TOOLKIT_REF variable' }, PIN],
    ['a pin that is no plain ref', { pin: 'x; say anything\nelse' }, { state: 'pinned', text: 'pinned by the TOOLKIT_REF variable at a value that is not a plain ref' }, /^ask the owner whether the TOOLKIT_REF variable still pins acme\/app at a value that is not a plain ref$/],
    ['an older pinned copy', { sweep: pinnedCopy() }, { state: 'outdated', text: 'an outdated copy (Toolkit 3333333)' }, SWEEP],
    ['an edited copy', { sweep: edited }, { state: 'edited', text: 'a copy edited by hand' }, /^refresh the repository rules \(say `refresh governance`\)$/],
    ['another workflow', { sweep: 'name: sweep\n' }, { state: 'unmanaged', text: 'not a Toolkit copy' }, /^refresh the repository rules \(say `refresh governance`\)$/],
    ['none', { sweep: null }, { state: 'missing', text: 'none in this repository' }, /^refresh the repository rules \(say `refresh governance`\)$/],
    ['not read', { sweepStatus: 502 }, { state: 'unread', text: 'not read (HTTP 502)' }, /^none \(not compared: the sweep\)$/],
  ]) {
    const { result, error } = world(fixture(), options).dry([], { deps: { toolkitGit: checkout(MAIN) } });
    assert.equal(error, null, `${label}: ${error?.message}`);
    assert.deepEqual(result.versions.sweep, expected, label);
    assert.match(result.versions.refresh, action, `${label}: ${result.versions.refresh}`);
    assert.equal(result.versions.line.includes('\n'), false, label);
  }
  // Toolkit's own repository runs its own commit, whatever copy it holds.
  const { versionsOf } = require('../../skills/github-program-reconciler/scripts/programme-takeover.cjs');
  const github = new FakeGitHub();
  const own = versionsOf({ get: call => github.request('GET', call), main: MAIN, repository: 'Weijunswj/AI-Agent-Toolkit', branch: 'main', git: checkout(MAIN) });
  assert.deepEqual(own.sweep, { state: 'own', text: 'runs this repository\'s own commit' });
  assert.equal(github.calls.some(call => /workflows|variables/.test(call.path)), false);
});

test('a version that could not be read is said, and never counts as current', () => {
  const fx = world(fixture());
  fx.github.intercept(call => (call.path.includes(`contents/${VERSION_REL_PATH}`) ? { status: 403, json: {} } : undefined));
  const { result } = fx.dry(argsFor(copy({ version: '0.0.1' })), { deps: { toolkitGit: checkout(null) } });
  assert.deepEqual([result.versions.main, result.versions.ran.state, result.versions.chat.state], [{ version: null, commit: MAIN }, 'not compared', 'not compared']);
  assert.match(result.versions.line, /Toolkit main not read \(1111111\)/);
  assert.equal(result.versions.refresh, 'none (not compared: the copy that ran, this chat\'s copy)');
  // Toolkit main itself unread: nothing is compared, and the takeover holds as before.
  const dark = world(fixture());
  dark.github.intercept(call => (call.path.endsWith('/commits/main') && call.path.includes('ai-agent-toolkit') ? { status: 502, json: {} } : undefined));
  const blind = dark.dry([], { deps: { toolkitGit: checkout(MAIN) } });
  assert.ok(blind.result.holds.some(hold => hold.code === 'TOOLKIT_UNREADABLE'));
  assert.deepEqual([blind.result.versions.main, blind.result.versions.ran.state], [{ version: null, commit: null }, 'not compared']);
  // git that cannot run is no checkout.
  const broken = world(fixture()).dry([], { deps: { toolkitGit: () => ({ status: null, stdout: '', stderr: '', error: 'spawn git ENOENT' }) } });
  assert.deepEqual([broken.result.versions.ran.commit, broken.result.versions.ran.state], [null, 'current']);
});

test('--session-copy: not given is said so, and a folder that is no Toolkit copy is refused before anything is read', () => {
  const given = world(fixture()).dry([], { deps: { toolkitGit: checkout(MAIN) } });
  assert.equal(given.result.versions.chat, null);
  assert.match(given.result.versions.line, /^versions: this chat not given, /);
  const refusals = [
    ['a folder that is not there', path.join(os.tmpdir(), 'no-such-toolkit-copy')], ['no version file', copy({ version: null })], ['no manifest', copy({ name: null })],
    ['another plugin', copy({ name: 'some-plugin' })], ['not JSON', copy({ versionText: '{' })], ['no version', copy({ version: 'latest' })], ['a file', __filename],
  ];
  for (const [label, folder] of refusals) for (const apply of [false, true]) {
    const fx = world(fixture());
    const run = fx.takeover(argsFor(folder), { apply, deps: { toolkitGit: checkout(MAIN) } });
    assert.equal(run.error?.code, 'USAGE', label);
    assert.match(run.error.message, /^--session-copy takes the folder of the Toolkit copy this chat loaded/, label);
    assert.equal(run.error.message.includes(TOOLKIT_VERSION), false, `${label}: never the running copy's version`);
    assert.deepEqual(run.calls, [], `${label}: nothing is read`);
    wroteNothing(fx, run, label);
  }
  // A Codex copy has its own manifest.
  assert.equal(world(fixture()).dry(argsFor(copy({ manifest: '.codex-plugin', version: '0.0.1' })), { deps: { toolkitGit: checkout(MAIN) } }).result.versions.chat.version, '0.0.1');
  // The folder itself is never in the record, the report or the done line.
  const folder = copy();
  const fx = world(fixture());
  const done = fx.takeover(argsFor(folder), { deps: { toolkitGit: checkout(MAIN) } });
  assert.equal(JSON.stringify(done.result).includes(path.basename(folder)), false);
  assert.equal(fx.records()[0].body.includes(path.basename(folder)), false);
});

test('governance off or unreadable: the dry run still shows the copies, and no sweep', () => {
  const { openTakeover, takeover, formatTakeover } = require('../../skills/github-program-reconciler/scripts/programme-takeover.cjs');
  const args = { command: 'takeover', session: NEW, surface: 'test harness', next: 'read the map', 'session-copy': copy({ version: '0.0.1' }) };
  for (const [code, governance] of [['GITHUB_GOVERNANCE_OFF', 'DISABLED'], ['GOVERNANCE_STATE_UNAVAILABLE', undefined]]) {
    const github = new FakeGitHub();
    github.toolkitMain.version = TOOLKIT_VERSION;
    const result = takeover(args, openTakeover(args, { transport: github }, () => { throw new state.ProgrammeError(code, 'off', governance ? { governance } : {}); }), { git: checkout(MAIN) });
    assert.equal(result.versions.line, `versions: this chat 0.0.1, ran ${TOOLKIT_VERSION} (1111111), Toolkit main ${TOOLKIT_VERSION} (1111111), sweep not read here; refresh: say \`refresh toolkit\`, then go on in a fresh chat`);
    assert.match(formatTakeover(result), /\nVersions: this chat 0\.0\.1, /);
    assert.ok(github.calls.every(call => call.method === 'GET'));
  }
});

test('the versions cost a fixed number of requests and one read of Toolkit main', () => {
  const fx = world(fixture());
  const { calls } = fx.dry(argsFor(copy()), { deps: { toolkitGit: checkout(MAIN) } });
  const of = part => calls.filter(call => call.path.includes(part)).length;
  assert.deepEqual([of('ai-agent-toolkit/commits/main'), of(VERSION_REL_PATH), of(SWEEP_FILE), of('variables/TOOLKIT_REF')], [1, 1, 1, 1]);
});
