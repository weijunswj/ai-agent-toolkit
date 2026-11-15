'use strict';

// Claude Code's PreToolUse hook approves Toolkit's own governance bank command, so neither a
// permission prompt nor auto mode stops it: exactly `node "<script>" setup` and the bank answer
// command with this session's live ticket, nothing broader, and only after every refusal check.

const { assert, fs, path, test, scripts, gate, governance, scratch, gitRepo, claudeHook } = require('./toolkit-governance-gate-support.cjs');
const bank = require(path.join(scripts, 'toolkit-governance-bank.cjs'));

const REFERENCE = 'ABCD-EFGH-JKMN-PQRS';
const SCRIPT = path.join(scripts, 'toolkit-governance.cjs');
const SESSION = 'session-bank-approve';

function fixture(t) {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'target');
  gate.startSession({ session_id: SESSION, source: 'startup', cwd: repo }, { registryOptions: ctx.options });
  return { ctx, repo, tools: new gate.ToolGate({ registryOptions: ctx.options }) };
}

// Shows a bank in this session and turns the owner's next own message into a live bank ticket.
function liveTicket(ctx, repo) {
  const epochs = new gate.SessionEpochs({ registryOptions: ctx.options });
  const repositoryId = governance.governanceState(repo, ctx.options).repository_id;
  new bank.BankTickets({ registryOptions: ctx.options }).shown(SESSION, { epoch: epochs.get(SESSION), repositoryMark: epochs.repository(repositoryId), repositoryId, root: repo, bankReference: REFERENCE });
  const reply = new gate.PromptHold({ registryOptions: ctx.options, environment: {} }).decide({ cwd: repo, prompt: 'all recommended', sessionId: SESSION });
  return (/--ticket ([0-9a-f]{32})/.exec(reply.context || '') || [])[1];
}

const call = (cwd, command, extra = {}, tool = 'Bash') => ({ tool_name: tool, session_id: SESSION, cwd, tool_input: { command, ...extra } });
const SETUP = `node "${SCRIPT}" setup`;

test('the hook approves showing the bank and nothing near it', (t) => {
  const { repo, tools } = fixture(t);
  assert.match(tools.allow(call(repo, SETUP), { environment: {} }), /approved its own governance bank command/);
  assert.ok(tools.allow(call(repo, `& ${SETUP}`, {}, 'PowerShell'), { environment: {} }), 'the PowerShell form');
  assert.ok(tools.allow(call(repo, SETUP, { description: 'Show the governance bank', timeout: 120000, run_in_background: false }), { environment: {} }), 'options left off');
  for (const command of [
    `${SETUP} --json`,
    `node "${SCRIPT}" refresh`,
    `node "${SCRIPT}" status`,
    `node "${SCRIPT}" enable`,
    `node "${SCRIPT}" migrate`,
    `${SETUP}; echo done`,
    `${SETUP} && rm -rf x`,
    `${SETUP}\nnode -e 1`,
    `${SETUP} > out.txt`,
    `node "${SCRIPT}" setup $X`,
    `node "${scripts}${path.sep}..${path.sep}scripts${path.sep}toolkit-governance.cjs" setup`,
    'node "/elsewhere/repo/scripts/toolkit-governance.cjs" setup',
    'node toolkit-governance.cjs setup',
    `bash -c '${SETUP}'`,
  ]) assert.equal(tools.allow(call(repo, command), { environment: {} }), null, command);
  for (const extra of [{ run_in_background: true }, { dangerouslyDisableSandbox: true }, { workdir: '/tmp' }]) {
    assert.equal(tools.allow(call(repo, SETUP, extra), { environment: {} }), null, JSON.stringify(extra));
  }
  assert.equal(tools.allow(call(repo, SETUP, {}, 'Monitor'), { environment: {} }), null, 'a Monitor stream is never approved');
  assert.equal(tools.allow({ tool_name: 'Bash', session_id: SESSION, cwd: repo, tool_input: { command: ['node', SCRIPT, 'setup'] } }, { environment: {} }), null, 'only a string command');
  assert.equal(tools.allow({ tool_name: 'Write', session_id: SESSION, cwd: repo, tool_input: { file_path: SCRIPT, content: '' } }, { environment: {} }), null);
});

test('the hook approves the bank answer only with this session\'s live ticket', (t) => {
  const { ctx, repo, tools } = fixture(t);
  const answer = ticket => `node "${SCRIPT}" setup --answers "${REFERENCE}: all recommended" --ticket ${ticket}`;
  assert.equal(tools.allow(call(repo, answer('f'.repeat(32))), { environment: {} }), null, 'no ticket was given');
  const ticket = liveTicket(ctx, repo);
  assert.ok(ticket);
  assert.ok(tools.allow(call(repo, answer(ticket)), { environment: {} }));
  assert.equal(tools.allow({ ...call(repo, answer(ticket)), session_id: 'another-session' }, { environment: {} }), null, 'another session');
  assert.equal(tools.allow(call(repo, `${answer(ticket)}; echo done`), { environment: {} }), null);
  assert.equal(tools.allow(call(repo, answer('e'.repeat(32))), { environment: {} }), null, 'a wrong ticket');
  assert.equal(tools.allow(call(repo, `node "/elsewhere/toolkit-governance.cjs" setup --answers "${REFERENCE}: all recommended" --ticket ${ticket}`), { environment: {} }), null);
});

test('the managed checkout\'s script is approved only from outside its repository', (t) => {
  const ctx = scratch(t);
  const managed = gitRepo(ctx, 'managed-toolkit');
  const managedScript = path.join(managed, 'repo', 'scripts', 'toolkit-governance.cjs');
  fs.mkdirSync(path.dirname(managedScript), { recursive: true });
  fs.writeFileSync(managedScript, '');
  const work = gitRepo(ctx, 'work');
  const home = path.join(ctx.root || path.dirname(work), 'home');
  fs.mkdirSync(path.join(home, '.ai-agent-toolkit', 'current'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ai-agent-toolkit', 'current', 'state.json'), JSON.stringify({ repo_path: managed }));
  const command = `node "${managedScript}" setup`;
  const approved = folders => bank.bankRunApproved(command, SESSION, null, { folders, home });
  assert.equal(approved([work]), true, 'from another repository');
  assert.equal(approved([work, work]), true, 'session and project folder both elsewhere');
  assert.equal(approved([managed]), false, 'the session works in the managed checkout');
  assert.equal(approved([path.join(managed, 'repo')]), false, 'a folder inside it');
  assert.equal(approved([work, managed]), false, 'the project folder is the managed checkout');
  assert.equal(approved([]), false, 'no folder known');
  assert.equal(approved(['relative/folder']), false, 'only absolute folders count');
  assert.equal(bank.bankRunApproved(`node "${SCRIPT}" setup`, SESSION, null, { folders: [], home }), true, 'this copy needs no folder');
  fs.rmSync(managedScript);
  assert.equal(approved([work]), false, 'a recorded folder without the script');
  fs.writeFileSync(path.join(home, '.ai-agent-toolkit', 'current', 'state.json'), '{not json');
  assert.equal(approved([work]), false, 'an unreadable record');
});

test('the Claude Code hook sends the approval only after every refusal check, and never in the cloud', (t) => {
  const { ctx, repo } = fixture(t);
  const options = { registryOptions: ctx.options, environment: {} };
  const output = claudeHook.respond('PreToolUse', call(repo, SETUP), options);
  assert.equal(output.hookSpecificOutput.permissionDecision, 'allow');
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /approved its own governance bank command/);
  assert.deepEqual(claudeHook.respond('PreToolUse', call(repo, 'ls'), options), {}, 'any other command gets no decision');
  assert.deepEqual(claudeHook.respond('PreToolUse', call(repo, SETUP), { ...options, environment: { CLAUDE_CODE_REMOTE: 'true' } }), {}, 'cloud sessions get no approval');
  // An answer command without a ticket is still refused, not approved.
  const refused = claudeHook.respond('PreToolUse', call(repo, `node "${SCRIPT}" setup --answers "${REFERENCE}: all recommended" --ticket ${'f'.repeat(32)}`), options);
  assert.equal(refused.hookSpecificOutput.permissionDecision, 'deny');
  // A refusal earlier in the hook wins over the approval.
  const denying = { ...options, gate: { ...gate, ToolGate: class extends gate.ToolGate { decide() { return { deny: 'held' }; } } } };
  assert.equal(claudeHook.respond('PreToolUse', call(repo, SETUP), denying).hookSpecificOutput.permissionDecision, 'deny');
});
