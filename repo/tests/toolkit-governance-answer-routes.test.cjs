'use strict';

// Every route that records the owner's governance answer or opens the off pull request, and who may take
// it: the owner's own terminal (enable, disable and the bank), the bank's reply ticket in a chat, the
// card's or a typed answer (the gate records it, an agent publishes it) and the shell tools of both apps,
// with and without Toolkit's hooks. Each route has a row an agent cannot take and a row the owner can.
// Scratch repositories, a fake GitHub transport and reserved names only.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { recordMerged, recordAbsent } = require('./toolkit-governed-fixture-support.cjs');

const scripts = path.join(__dirname, '..', 'scripts');
const { ToolkitGovernanceCli, BANK_SHOWN } = require(path.join(scripts, 'toolkit-governance.cjs'));
const { GovernanceProposals } = require(path.join(scripts, 'toolkit-governance-proposal.cjs'));
const { BankTickets } = require(path.join(scripts, 'toolkit-governance-bank.cjs'));
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));
const gate = require(path.join(scripts, 'toolkit-governance-gate.cjs'));
const { AGENT_MARKERS } = require(path.join(scripts, 'owner-terminal.cjs'));
const { SHELL_TOOL_NAMES } = require(path.join(scripts, 'toolkit-shell-call.cjs'));

const REPOSITORY = 'example-owner/example-repo';
const SESSION = 'session-routes-1';
const OFF = { schema: 'toolkit.programme-binding.v2', repository: REPOSITORY, governance: 'disabled' };

function fixture(t, { governed = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-answer-routes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'repo');
  const git = args => childProcess.execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  git(['init', '--quiet', repo]);
  git(['-C', repo, 'remote', 'add', 'origin', `https://github.com/${REPOSITORY}.git`]);
  const registryPath = path.join(root, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  const registryOptions = { registryPath, testOnly: true };
  if (governed) recordMerged(repo, { registryPath, text: JSON.stringify({ schema: 'toolkit.programme-binding.v2', repository: REPOSITORY, governance: 'enabled',
    parents: [{ issue: 1, record_prefix: 'INT-X1-' }], store: { kind: 'github', repository: 'example-owner/TRANSPORT-example-repo', branch: 'main', path: 'state/example-owner/example-repo/' }, required_checks: ['validate'] }) });
  else recordAbsent(repo, { registryPath });
  new gate.SessionEpochs({ registryOptions }).start(SESSION, 'startup', governance.governanceState(repo, registryOptions).repository_id);
  return { root, repo, registryOptions };
}

// GitHub as the proposal code reads and writes it. `fail` throws from the read the publish starts with;
// `open` is what is already open; `canWrite` is the account's write access.
function transport({ open = [], canWrite = true, fail = null } = {}) {
  const calls = [];
  let listed = open;
  const proposal = answer => ({ repository: REPOSITORY, number: 9, head: 'b'.repeat(40), url: `https://github.com/${REPOSITORY}/pull/9`, state: 'open', answer });
  return { calls, proposal, canWrite: () => canWrite, read: () => listed[0],
    list: () => { if (fail) throw fail; return listed; },
    publish(repository, binding) { calls.push(binding); listed = [proposal(binding.governance === 'disabled' ? 'no' : 'yes')]; return listed[0]; } };
}

async function run(ctx, argv, { interactive = false, environment = {}, replies = [], github = transport(), publishThrows = null } = {}) {
  let out = ''; let err = '';
  const asked = [];
  if (publishThrows) github.publish = () => { throw publishThrows; };
  const cli = new ToolkitGovernanceCli({
    stdout: { write: text => { out += text; return true; } }, stderr: { write: text => { err += text; return true; } },
    cwd: ctx.repo, interactive, environment, registryOptions: ctx.registryOptions, proposalTransport: github,
    ask: async question => { asked.push(question); return replies.shift() ?? ''; },
    confirm: async effect => { asked.push(effect); return true; },
    discoveryGh: () => ({ ok: false, reason: 'offline' }), refresh: () => ({ refreshed: false, error: 'offline' }), appReader: () => ({ ok: false }),
    permissionsChecker: () => ({ checked: false, missing: 0 }), hookReader: () => null, queueReader: () => null,
  });
  const code = await cli.main(argv);
  return { code, out, err, asked, calls: github.calls };
}

// The answers recorded for a repository on this computer, whoever recorded them.
function recorded(ctx) {
  const folder = path.join(path.dirname(ctx.registryOptions.registryPath), 'governance-proposals');
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder).flatMap(name => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8')).requests.map(item => item.answer));
}

test('own terminal: disable, decline and enable refuse a shell a coding agent started, naming its marker, and record nothing', async t => {
  assert.ok(AGENT_MARKERS.length >= 8);
  for (const marker of AGENT_MARKERS) for (const command of ['disable', 'decline', 'enable']) {
    const ctx = fixture(t);
    const result = await run(ctx, [command], { interactive: true, environment: { [marker]: '1' }, replies: ['1.1=B'] });
    assert.equal(result.code, 2, `${command} ${marker}`);
    assert.match(result.err, new RegExp(`^No answer was recorded: this shell was started by a coding agent \\(${marker}\\), and agents never answer the owner's prompts\\. Next: the owner runs this in their own PowerShell or terminal, outside any agent\\. Nothing changed\\.$`, 'm'));
    assert.deepEqual([result.asked, result.calls, recorded(ctx)], [[], [], []], `${command} ${marker}: nothing asked, published or recorded`);
  }
});

test('own terminal: the owner\'s disable still needs no second Enter, and a variable that is no marker refuses nothing', async t => {
  for (const environment of [{}, { CODEX_HOME: '/home/example/.codex', CLAUDE_CONFIG_DIR: '/home/example/.claude', TOOLKIT_HOST_SESSION: SESSION, CODEX_THREAD_ID: '' }]) {
    const ctx = fixture(t);
    const result = await run(ctx, ['disable'], { interactive: true, environment });
    assert.equal(result.code, 0, result.err);
    assert.deepEqual(result.calls, [OFF]);
    assert.deepEqual(result.asked, [], 'no second Enter');
  }
});

test('own terminal: disable where governance is already off says only that, and never that it turns governance off', async t => {
  const ctx = fixture(t, { governed: false });
  recordMerged(ctx.repo, { registryPath: ctx.registryOptions.registryPath, text: JSON.stringify(OFF) });
  const result = await run(ctx, ['disable'], { interactive: true });
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /^Already disabled on the default branch\. Nothing was written\.$/m);
  assert.equal(result.err, '');
  assert.deepEqual([result.calls, recorded(ctx)], [[], []]);
  // Where it is on, the two facts still come first.
  assert.match((await run(fixture(t), ['disable'], { interactive: true })).err, /Turns off: +repository governance, on every computer/);
});

test('own terminal: without a terminal nothing is recorded, marker or not', async t => {
  for (const environment of [{}, { CLAUDECODE: '1' }]) for (const command of ['disable', 'enable']) {
    const ctx = fixture(t);
    const result = await run(ctx, [command], { environment });
    assert.equal(result.code, 2);
    assert.match(result.err, /^No answer was recorded\. Ask the owner in this chat; an agent cannot answer for them\.$/m);
    assert.deepEqual([result.calls, recorded(ctx)], [[], []]);
  }
});

test('terminal bank: an agent\'s shell never answers it, whatever terminal it has; it is shown as in a chat', async t => {
  for (const marker of AGENT_MARKERS) for (const command of ['setup', 'refresh']) {
    const ctx = fixture(t);
    const result = await run(ctx, [command], { interactive: true, environment: { [marker]: '1', TOOLKIT_HOST_SESSION: SESSION }, replies: ['1.1=B', '1.1=B'] });
    assert.deepEqual([result.asked, result.calls, recorded(ctx)], [[], [], []], `${command} ${marker}: nothing asked, published or recorded`);
    assert.equal(result.code, BANK_SHOWN, `${command} ${marker}`);
    assert.match(result.out, /GitHub governance \| On/);
    assert.match(result.err, new RegExp(`^Toolkit: no answer is read in this terminal, because this shell was started by a coding agent \\(${marker}\\)`, 'm'));
    const epoch = new gate.SessionEpochs({ registryOptions: ctx.registryOptions }).get(SESSION);
    assert.ok(new BankTickets({ registryOptions: ctx.registryOptions }).pendingFor(SESSION, epoch), 'the owner\'s own next message answers it');
  }
  // A turn-on bank, where a plain word would do: a typed no is not read either.
  const undecided = fixture(t, { governed: false });
  const typed = await run(undecided, ['setup'], { interactive: true, environment: { CODEX_THREAD_ID: 'thread' }, replies: ['no'] });
  assert.deepEqual([typed.asked, typed.calls, recorded(undecided)], [[], [], []]);
});

test('terminal bank: the owner\'s typed answer still turns governance off', async t => {
  const ctx = fixture(t);
  const result = await run(ctx, ['setup'], { interactive: true, replies: ['1.1=B'] });
  assert.equal(result.code, 0, result.err + result.out);
  assert.deepEqual(result.calls, [OFF]);
  assert.doesNotMatch(result.err, /no answer is read/);
});

// The route write_stdin opens: the shell is already running and allowed, the hooks see nothing, and the
// command typed into it has a real terminal's streams and the app's marker in its environment. Also any
// chat whose hooks do not run. The real Enter guard (owner-terminal.cjs) and the real terminal check run.
// A Terminal panel tab Claude opened in the desktop app has none of the other markers: only the app's own.
// A tab the owner opened there has the same terminal variables without it, and takes the owner's answer.
const PANEL_TAB = { CLAUDE_AGENT_SDK_VERSION: '0.0.0', TERM_PROGRAM: 'claude-desktop', TERM: 'xterm-256color', COLORTERM: 'truecolor' };
test('write_stdin into an allowed shell, a chat with no hooks or a Terminal panel tab Claude opened: one marker of each app refuses the real process', t => {
  for (const [marker, value = 'x', around = {}] of [['CODEX_THREAD_ID'], ['CLAUDECODE'], ['AI_AGENT'], [null], [null, '', PANEL_TAB],
    ['CLAUDE_CODE_LAUNCHED_BY_SESSION_IDS', '00000000-0000-0000-0000-000000000000', PANEL_TAB], ['CLAUDE_CODE_LAUNCHED_BY_SESSION_IDS', ',', PANEL_TAB]]) {
    const ctx = fixture(t);
    const resultFile = path.join(ctx.root, 'result.json');
    const code = `
      process.stdin.isTTY = true; process.stderr.isTTY = true;
      const { ToolkitGovernanceCli } = require(${JSON.stringify(path.join(scripts, 'toolkit-governance.cjs'))});
      const calls = []; let listed = []; let err = '';
      const proposal = { repository: ${JSON.stringify(REPOSITORY)}, number: 9, head: 'b'.repeat(40), url: 'https://github.com/${REPOSITORY}/pull/9', state: 'open', answer: 'no' };
      process.stderr.write = text => { err += text; return true; };
      const cli = new ToolkitGovernanceCli({ cwd: ${JSON.stringify(ctx.repo)}, stdout: { write: () => true },
        proposalTransport: { canWrite: () => true, list: () => listed, read: () => proposal, publish(_, binding) { calls.push(binding); listed = [proposal]; return proposal; } },
        registryOptions: ${JSON.stringify(ctx.registryOptions)}, discoveryGh: () => ({ ok: false, reason: 'offline' }), refresh: () => ({ refreshed: false, error: 'offline' }), appReader: () => ({ ok: false }) });
      cli.main(['disable']).then(exit => { require('node:fs').writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ exit, calls, err })); process.exit(0); });`;
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(?:CLAUDE|CODEX|AI_AGENT|TOOLKIT_HOST)/i.test(name)));
    childProcess.spawnSync(process.execPath, ['-e', code], { env: { ...env, HOME: ctx.root, USERPROFILE: ctx.root, ...around, ...(marker ? { [marker]: value } : {}) }, input: '\n\n\n', timeout: 60000, windowsHide: true });
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    if (marker) {
      assert.deepEqual([result.exit, result.calls], [2, []], marker);
      assert.match(result.err, new RegExp(`started by a coding agent \\(${marker}\\)`));
    } else assert.deepEqual([result.exit, result.calls], [0, [OFF]], `the owner's own shell ${JSON.stringify(around)}`);
  }
});

test('bank reply ticket: an agent with none (no hooks) or another session\'s records nothing; the owner\'s own message answers', async t => {
  const reply = ticket => ['setup', '--answers', null, '--ticket', ticket];
  const ctx = fixture(t);
  const environment = { TOOLKIT_HOST_SESSION: SESSION, CLAUDECODE: '1' };
  const shown = await run(ctx, ['setup'], { environment });
  const epochs = new gate.SessionEpochs({ registryOptions: ctx.registryOptions });
  const tickets = new BankTickets({ registryOptions: ctx.registryOptions });
  const reference = tickets.pendingFor(SESSION, epochs.get(SESSION)).bank_reference;
  assert.match(shown.out, new RegExp(reference));
  const answer = (ticket, env) => run(ctx, reply(ticket).map(word => word ?? `${reference}: 1.1=B`), { environment: env });
  const none = await answer('0'.repeat(32), environment);
  assert.equal(none.code, 2);
  assert.match(none.err, /No live reply ticket from the owner for this session and repository, so nothing was written\..*An agent cannot answer for the owner\./);
  const ticket = tickets.issue(SESSION, epochs.get(SESSION));
  const other = await answer(ticket, { TOOLKIT_HOST_SESSION: 'another-session', CLAUDECODE: '1' });
  assert.match(other.err, /No live reply ticket/);
  assert.deepEqual([none.calls, other.calls, recorded(ctx)], [[], [], []]);
  // The ticket the hook gives the owner's own message, in the session it was given to.
  const again = await run(ctx, ['setup'], { environment });
  assert.equal(again.code, BANK_SHOWN);
  const owned = await answer(tickets.issue(SESSION, epochs.get(SESSION)), environment);
  assert.equal(owned.code, 0, owned.err + owned.out);
  assert.deepEqual(owned.calls, [OFF]);
});

test('card and typed answers: an unasked tap, a made-up ticket and a publish with nothing recorded answer nothing; a recorded no publishes', async t => {
  const ctx = fixture(t, { governed: false });
  const hold = new gate.PromptHold({ registryOptions: ctx.registryOptions, environment: {} });
  const tap = hold.picked({ cwd: ctx.repo, sessionId: SESSION, toolUseId: 'tool-never-noted', toolResponse: { answers: { [gate.PICKER_QUESTION]: 'No' } } });
  assert.doesNotMatch(tap?.context || '', /no is pending/);
  assert.equal(hold.answerTicket('0'.repeat(32), 'no').ok, false);
  assert.deepEqual(recorded(ctx), []);
  for (const argv of [['publish'], ['publish', '--run', '0'.repeat(32)]]) {
    const refused = await run(ctx, argv, { environment: { TOOLKIT_HOST_SESSION: SESSION, CLAUDECODE: '1' } });
    assert.equal(refused.code, 2);
    assert.deepEqual(refused.calls, [], argv.join(' '));
  }
  // The gate recorded the owner's no for this session: its agent publishes that run, by name or by session.
  for (const named of [true, false]) {
    const answered = fixture(t, { governed: false });
    const epoch = new gate.SessionEpochs({ registryOptions: answered.registryOptions }).get(SESSION);
    const { run: receipt } = new GovernanceProposals({ registryOptions: answered.registryOptions }).request(answered.repo, 'no', { sessionId: SESSION, epoch });
    const published = await run(answered, ['publish', ...(named ? ['--run', receipt] : [])], { environment: { TOOLKIT_HOST_SESSION: SESSION, CLAUDECODE: '1' } });
    assert.equal(published.code, 0, published.err);
    assert.deepEqual(published.calls, [OFF]);
  }
});

test('hooked chats, both apps: every shell tool is refused a decision and the proposal code, and may show the bank', t => {
  const ctx = fixture(t);
  const tools = new gate.ToolGate({ registryOptions: ctx.registryOptions });
  const script = path.join(scripts, 'toolkit-governance.cjs');
  const call = (tool, command) => tools.decide({ tool_name: tool, session_id: SESSION, cwd: ctx.repo, tool_input: { command, cmd: command } });
  for (const tool of SHELL_TOOL_NAMES) {
    for (const command of ['disable', 'decline', 'enable', '--json disable', 'setup --answers "x: 1.1=B" --ticket 0']) assert.ok(call(tool, `node "${script}" ${command}`)?.deny, `${tool}: ${command}`);
    assert.ok(call(tool, `node -e "require('${path.join(scripts, 'toolkit-governance-proposal.cjs').replace(/\\/g, '/')}')"`)?.deny, `${tool}: the proposal code`);
    for (const command of ['setup', 'status', 'publish']) assert.equal(call(tool, `node "${script}" ${command}`), null, `${tool}: ${command}`);
  }
  // Text typed into a running shell is no command a hook reads (an accepted gap): the marker refuses it.
  assert.equal(tools.decide({ tool_name: 'write_stdin', session_id: SESSION, cwd: ctx.repo, tool_input: { chars: `node "${script}" disable\n` } }), null);
});

test('a failed turn-off: the no stays pending only where it can still be published, on one stream, and an unexpected error keeps its name', async t => {
  const PENDING = /The owner's no stays pending for this run: once GitHub can be read, run .*publish --run [a-f0-9]{32}/;
  const unread = () => transport({ fail: Object.assign(new Error('x'), { code: 'PROPOSAL_GITHUB_UNAVAILABLE' }) });
  // GitHub cannot be read: the recorded no waits, in the terminal on stderr.
  const terminal = await run(fixture(t), ['disable'], { interactive: true, github: unread() });
  assert.equal(terminal.code, 2);
  assert.match(terminal.err, /Proposal publication is unverified \(PROPOSAL_DISCOVERY_UNAVAILABLE\)/);
  assert.match(terminal.err, PENDING);
  // A publish that names no run is this session's recorded no, on the same route.
  const own = fixture(t);
  new GovernanceProposals({ registryOptions: own.registryOptions }).request(own.repo, 'no', { sessionId: SESSION, epoch: new gate.SessionEpochs({ registryOptions: own.registryOptions }).get(SESSION) });
  const session = await run(own, ['publish'], { environment: { TOOLKIT_HOST_SESSION: SESSION }, github: unread() });
  assert.equal(session.code, 2);
  assert.match(session.err, PENDING);
  // The bank's own: its lines stay on stdout with the rest of the answer.
  const bank = await run(fixture(t), ['setup'], { interactive: true, replies: ['1.1=B'], github: unread() });
  assert.equal(bank.code, 2);
  assert.match(bank.out, /Proposal publication is unverified/);
  assert.match(bank.out, PENDING);
  assert.doesNotMatch(bank.err, /unverified|pending/);
  // GitHub was read: an open turn-on pull request, or an account without write access.
  const open = transport();
  for (const [github, said] of [[transport({ open: [open.proposal('yes')] }), /Conflicting governance proposals are open/], [transport({ canWrite: false }), /This GitHub account cannot write/]]) {
    const stopped = await run(fixture(t), ['disable'], { interactive: true, github });
    assert.equal(stopped.code, 2);
    assert.match(stopped.err, said);
    assert.doesNotMatch(stopped.err, PENDING);
    assert.deepEqual(stopped.calls, []);
  }
  // A no recorded 48 hours ago is no live answer any more.
  const old = fixture(t);
  const { run: receipt } = new GovernanceProposals({ registryOptions: old.registryOptions, now: () => new Date(Date.now() - 48 * 3600 * 1000) }).request(old.repo, 'no', { sessionId: SESSION, epoch: 'c'.repeat(32) });
  const expired = await run(old, ['publish', '--run', receipt]);
  assert.match(expired.err, /^No live pending owner answer remains for this run\./m);
  assert.doesNotMatch(expired.err, PENDING);
  // A bug is not "GitHub could not be read": its name is kept on every route.
  const broken = fixture(t);
  const { run: brokenRun } = new GovernanceProposals({ registryOptions: broken.registryOptions }).request(broken.repo, 'no', { sessionId: SESSION, epoch: 'c'.repeat(32) });
  for (const [argv, options] of [[['publish', '--run', brokenRun], {}], [['disable'], { interactive: true }]]) {
    const failed = await run(broken, argv, { ...options, publishThrows: new TypeError('fixture') });
    assert.equal(failed.code, 2);
    assert.match(failed.err, /stopped because of an unexpected problem \(TypeError\)/);
    assert.doesNotMatch(failed.err, PENDING);
  }
});
