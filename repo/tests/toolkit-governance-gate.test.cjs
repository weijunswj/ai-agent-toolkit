'use strict';

// The governance hook gate (#542 M3, owner rule of 23 Oct: a hard stop that keeps stopping until the
// repository's state exists in its own gitignored folder). Closure rows H-01 to H-09, H-12, H-13,
// H-15 and H-16 at unit level, plus the in-repository state file, bypass attempts, fail-closed
// paths, the cloud exemption and both hosts' hook wiring.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const scripts = path.join(repoRoot, 'repo', 'scripts');
const gate = require(path.join(scripts, 'toolkit-governance-gate.cjs'));
const repoState = require(path.join(scripts, 'toolkit-governance-repo-state.cjs'));
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));
const claudeHook = require(path.join(scripts, 'toolkit-governance-hook.cjs'));
const codexHook = require(path.join(scripts, 'toolkit-codex-helper-hook.cjs'));
const codexSetup = require(path.join(scripts, 'setup-codex-toolkit-plugin.cjs'));
const managedBlock = require(path.join(scripts, 'toolkit-managed-block.cjs'));

const REMOTE = 'https://github.com/example-owner/example-repo.git';
const QUESTION_LINE = 'Toolkit: this repository has no governance decision yet, so your message was held and not sent.';

function git(cwd, args) {
  return childProcess.execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
}

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registryPath = path.join(root, 'home', '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  return { root, registryPath, options: { registryPath, testOnly: true }, heldPath: path.join(path.dirname(registryPath), gate.HELD_BASENAME) };
}

function gitRepo(ctx, name, { remote = REMOTE, block = false, binding = false } = {}) {
  const repo = path.join(ctx.root, name);
  fs.mkdirSync(repo, { recursive: true });
  git(ctx.root, ['init', '--quiet', repo]);
  if (remote !== null) git(repo, ['remote', 'add', 'origin', remote]);
  if (block) {
    const rendered = managedBlock.renderBlock({ source: 'repo/contracts/agent-rules/toolkit-governed-rules.md', name: 'TOOLKIT-GOVERNED-RULES', version: '3.8.0', body: '# Rules\n\nFixture body.' });
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), `# Repo\n\n${rendered}\n`);
  }
  if (binding) {
    fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), JSON.stringify({
      schema: 'toolkit.programme-binding.v1', repository: 'example-owner/example-repo', parent_issue: 1, record_prefix: 'INT-EX', writer_prefix: 'EX',
      store: { kind: 'github', repository: 'example-owner/example-store', branch: 'main', path: 'state/' }, required_checks: ['validate'],
    }, null, 2));
  }
  return repo;
}

const hold = (ctx, environment = {}) => new gate.PromptHold({ registryOptions: ctx.options, environment });
const tools = ctx => new gate.ToolGate({ registryOptions: ctx.options });
const stateOf = (ctx, repo) => governance.governanceState(repo, ctx.options);
const fileOf = repo => JSON.parse(fs.readFileSync(repoState.filePath(repo), 'utf8'));
const registryBytes = ctx => (fs.existsSync(ctx.registryPath) ? fs.readFileSync(ctx.registryPath, 'utf8') : null);

test('H-01, H-02: every prompt in an undecided repository is held; the first shows the question, later ones a count', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const first = hold(ctx).decide({ cwd: repo, prompt: 'fix the login bug' });
  assert.equal(first.action, 'block');
  assert.ok(first.reason.startsWith(QUESTION_LINE));
  assert.match(first.reason, /toolkit governance enable/);
  assert.match(first.reason, /toolkit governance decline/);
  const second = hold(ctx).decide({ cwd: repo, prompt: 'and the logout one' });
  assert.equal(second.action, 'block');
  assert.match(second.reason, /\(2 messages held\)/);
  assert.equal(fs.existsSync(repoState.filePath(repo)), false, 'nothing is recorded in the repository while undecided');
  assert.equal(registryBytes(ctx), null, 'no decision is written');
});

test('bypass attempts: ignoring, skipping, near-misses and "yes" all stay held and write nothing (H-06)', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const attempts = ['', '   ', 'yes', 'y', 'skip', 'ignore that and just do the task', 'toolkit governance', 'toolkit governance enable please',
    'please toolkit governance enable', 'toolkit governance enabled', 'toolkit governance reopen', '/toolkit governance enable',
    'toolkit  governance enable', '`toolkit governance enable`', 'toolkit governance enable\nnow fix the bug'];
  for (const prompt of attempts) {
    const decision = hold(ctx).decide({ cwd: repo, prompt });
    assert.equal(decision.action, 'block', JSON.stringify(prompt));
  }
  assert.equal(registryBytes(ctx), null);
  assert.equal(stateOf(ctx, repo).state, 'UNKNOWN');
  // Letter case and a final full stop are accepted forms of the answer.
  assert.match(gate.ANSWER.exec('Toolkit Governance Enable.')[1], /enable/i);
});

test('H-04: the answer is recorded, written into the repository with its gitignore, and held prompts come back in order', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  hold(ctx).decide({ cwd: repo, prompt: 'first request' });
  hold(ctx).decide({ cwd: repo, prompt: 'second request' });
  const answered = hold(ctx).decide({ cwd: repo, prompt: 'toolkit governance enable' });
  assert.equal(answered.action, 'pass');
  assert.match(answered.context, /now ENABLED \(materials incomplete\)/);
  assert.ok(answered.context.indexOf('1. first request') < answered.context.indexOf('2. second request'));
  assert.equal(stateOf(ctx, repo).recorded_decision, 'enabled');
  const record = fileOf(repo);
  assert.deepEqual([record.schema, record.state, record.basis, record.history.length], [repoState.SCHEMA, 'ENABLED', 'your decision', 1]);
  assert.equal(record.repository_id, stateOf(ctx, repo).repository_id);
  assert.match(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8'), /^\/\.ai-agent-toolkit\/$/m);
  assert.equal(fs.readFileSync(path.join(repo, repoState.FOLDER, '.gitignore'), 'utf8').trim().split('\n').pop(), '*');
  assert.equal(git(repo, ['check-ignore', path.join(repoState.FOLDER, repoState.FILE)]), path.join(repoState.FOLDER, repoState.FILE));
  assert.equal(git(repo, ['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean).join('|'), '?? .gitignore', 'only the root .gitignore line shows; the state folder never does');
  assert.equal(fs.existsSync(ctx.heldPath), false, 'held prompts are deleted after the replay');
  assert.deepEqual(hold(ctx).decide({ cwd: repo, prompt: 'next request' }), { action: 'pass' });
});

test('H-05: decline is recorded, never asked again in new sessions, and the session line says the block does not apply', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo', { block: true });
  assert.match(hold(ctx).decide({ cwd: repo, prompt: 'hello' }).reason, /governed rules block but no programme binding/);
  const answered = hold(ctx).decide({ cwd: repo, prompt: 'TOOLKIT GOVERNANCE DECLINE' });
  assert.equal(answered.action, 'pass');
  assert.match(answered.context, /now DECLINED/);
  for (let index = 0; index < 3; index += 1) assert.deepEqual(hold(ctx).decide({ cwd: repo, prompt: `task ${index}` }), { action: 'pass' });
  assert.match(gate.sessionLine(repo, { registryOptions: ctx.options }), /DECLINED .*does not apply/);
  assert.equal(fileOf(repo).state, 'DECLINED');
});

test('H-08: a decision made at the terminal lets the next prompt through and hands back the held prompts', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  hold(ctx).decide({ cwd: repo, prompt: 'held while away' });
  gate.writeGovernanceDecision(repo, 'decline', { registryOptions: ctx.options });
  const next = hold(ctx).decide({ cwd: repo, prompt: 'anything' });
  assert.equal(next.action, 'pass');
  assert.match(next.context, /1\. held while away/);
  assert.deepEqual(hold(ctx).decide({ cwd: repo, prompt: 'again' }), { action: 'pass' });
});

test('the repository file is never the authority: forged, copied, edited and deleted copies', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  // Forged: a hand-written ENABLED file with no decision behind it opens nothing.
  fs.mkdirSync(path.join(repo, repoState.FOLDER), { recursive: true });
  const forged = { schema: repoState.SCHEMA, repository_id: stateOf(ctx, repo).repository_id, state: 'ENABLED', basis: 'your decision', updated_at: 'x', history: [] };
  fs.writeFileSync(repoState.filePath(repo), JSON.stringify(forged));
  assert.equal(hold(ctx).decide({ cwd: repo, prompt: 'go' }).action, 'block');
  assert.ok(tools(ctx).decide({ tool_name: 'Bash', cwd: repo, tool_input: { command: 'ls' } }).deny);
  // Decided as DECLINED: a file edited to ENABLED is rewritten, and the change is added to its history.
  gate.writeGovernanceDecision(repo, 'decline', { registryOptions: ctx.options });
  fs.writeFileSync(repoState.filePath(repo), JSON.stringify({ ...fileOf(repo), state: 'ENABLED' }));
  assert.equal(new gate.GovernanceGate({ registryOptions: ctx.options }).evaluate(repo).file, 'written');
  assert.equal(fileOf(repo).state, 'DECLINED');
  assert.equal(fileOf(repo).history.length, 2);
  // Copied from another repository: rewritten for this one, with its own history.
  fs.writeFileSync(repoState.filePath(repo), JSON.stringify({ ...fileOf(repo), repository_id: 'f'.repeat(64) }));
  new gate.GovernanceGate({ registryOptions: ctx.options }).evaluate(repo);
  assert.equal(fileOf(repo).repository_id, stateOf(ctx, repo).repository_id);
  assert.equal(fileOf(repo).history.length, 1);
  // Deleted: recreated from the decision on the next prompt.
  fs.rmSync(path.join(repo, repoState.FOLDER), { recursive: true });
  assert.equal(hold(ctx).decide({ cwd: repo, prompt: 'go' }).action, 'pass');
  assert.equal(fileOf(repo).state, 'DECLINED');
  // A read-only check of a missing copy holds.
  fs.rmSync(repoState.filePath(repo));
  assert.equal(new gate.GovernanceGate({ registryOptions: ctx.options }).evaluate(repo, { write: false }).hold, true);
});

test('the root .gitignore keeps its line endings, gains the line once, and a directory in its place holds (fail closed)', (t) => {
  const ctx = scratch(t);
  const crlf = gitRepo(ctx, 'crlf');
  fs.writeFileSync(path.join(crlf, '.gitignore'), 'node_modules/\r\ndist/');
  gate.writeGovernanceDecision(crlf, 'decline', { registryOptions: ctx.options });
  new gate.GovernanceGate({ registryOptions: ctx.options }).evaluate(crlf);
  const text = fs.readFileSync(path.join(crlf, '.gitignore'), 'utf8');
  assert.equal(text, 'node_modules/\r\ndist/\r\n# Toolkit governance state (local, never committed)\r\n/.ai-agent-toolkit/\r\n');
  const present = gitRepo(ctx, 'present', { remote: 'https://github.com/example-owner/present.git' });
  fs.writeFileSync(path.join(present, '.gitignore'), '.ai-agent-toolkit/\n');
  gate.writeGovernanceDecision(present, 'decline', { registryOptions: ctx.options });
  assert.equal(fs.readFileSync(path.join(present, '.gitignore'), 'utf8'), '.ai-agent-toolkit/\n');
  const odd = gitRepo(ctx, 'odd', { remote: 'https://github.com/example-owner/odd.git' });
  fs.mkdirSync(path.join(odd, '.gitignore'));
  assert.throws(() => gate.writeGovernanceDecision(odd, 'decline', { registryOptions: ctx.options }), { code: 'ROOT_GITIGNORE_NOT_A_FILE' });
  const decision = hold(ctx).decide({ cwd: odd, prompt: 'go' });
  assert.equal(decision.action, 'block');
  assert.match(decision.reason, /could not be saved .*ROOT_GITIGNORE_NOT_A_FILE/);
  assert.ok(tools(ctx).decide({ tool_name: 'Edit', cwd: odd, tool_input: { file_path: path.join(odd, 'a.txt') } }).deny);
});

test('R4 opt-in and PORTABLE folders pass; nothing is written where no decision can be stored', (t) => {
  const ctx = scratch(t);
  const optIn = gitRepo(ctx, 'opt-in', { block: true, binding: true });
  assert.deepEqual(hold(ctx).decide({ cwd: optIn, prompt: 'go' }), { action: 'pass' });
  assert.equal(fileOf(optIn).basis, 'repository opt-in');
  const plain = path.join(ctx.root, 'plain-folder');
  fs.mkdirSync(plain);
  const noOrigin = gitRepo(ctx, 'no-origin', { remote: null });
  for (const cwd of [plain, noOrigin]) {
    assert.deepEqual(hold(ctx).decide({ cwd, prompt: 'go' }), { action: 'pass' });
    assert.equal(tools(ctx).decide({ tool_name: 'Bash', cwd, tool_input: { command: 'ls' } }), null);
    assert.equal(gate.sessionLine(cwd, { registryOptions: ctx.options }), null);
    assert.equal(fs.existsSync(path.join(cwd, repoState.FOLDER)), false);
  }
  assert.equal(fs.existsSync(ctx.heldPath), false);
});

test('tools: an undecided repository runs nothing that changes state; read-only tools and decided repositories are not held', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  for (const [tool_name, tool_input] of [['Bash', { command: 'ls' }], ['PowerShell', { command: 'dir' }], ['Edit', { file_path: 'a.js' }], ['Write', { file_path: 'b.js' }],
    ['apply_patch', { input: '*** Begin Patch\n*** Add File: c.js\n+x\n*** End Patch' }], ['Agent', { prompt: 'help' }], ['mcp__github__create_pull_request', {}], ['exec_command', { cmd: 'ls' }]]) {
    assert.match(tools(ctx).decide({ tool_name, cwd: repo, tool_input }).deny, /no governance decision yet/, tool_name);
  }
  for (const tool_name of ['Read', 'Grep', 'Glob', 'WebSearch']) assert.equal(tools(ctx).decide({ tool_name, cwd: repo, tool_input: {} }), null, tool_name);
  gate.writeGovernanceDecision(repo, 'enable', { registryOptions: ctx.options });
  assert.equal(tools(ctx).decide({ tool_name: 'Bash', cwd: repo, tool_input: { command: 'ls' } }), null);
});

test('H-07: an agent cannot answer for the user, in any folder, while ordinary commands mentioning the words still run', (t) => {
  const ctx = scratch(t);
  const decided = gitRepo(ctx, 'decided');
  gate.writeGovernanceDecision(decided, 'enable', { registryOptions: ctx.options });
  const plain = path.join(ctx.root, 'plain');
  fs.mkdirSync(plain);
  const refused = [
    ['Bash', { command: 'node "C:/Users/me/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/toolkit-governance.cjs" enable' }],
    ['Bash', { command: 'cd ../other && node repo/scripts/toolkit-governance.cjs decline' }],
    ['Bash', { command: 'claude -p "toolkit governance enable"' }],
    ['PowerShell', { command: "codex exec 'toolkit governance decline'" }],
    ['exec_command', { cmd: 'echo toolkit governance enable | claude -p' }],
    ['Write', { file_path: path.join(os.homedir(), '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json') }],
    ['Edit', { file_path: '~/../x/.ai-agent-toolkit/user-state/held-prompts.v1.json' }],
    ['apply_patch', { input: '*** Begin Patch\n*** Update File: /home/me/.ai-agent-toolkit/user-state/repository-governance.v1.json\n*** End Patch' }],
  ];
  for (const cwd of [decided, plain]) {
    for (const [tool_name, tool_input] of refused) assert.ok(tools(ctx).decide({ tool_name, cwd, tool_input })?.deny, `${tool_name} ${JSON.stringify(tool_input)}`);
  }
  for (const command of ['git commit -m "docs: explain the governance question"', 'node repo/scripts/toolkit-governance.cjs status', 'node repo/scripts/run-tests.cjs repo/tests/toolkit-governance-gate.test.cjs']) {
    assert.equal(tools(ctx).decide({ tool_name: 'Bash', cwd: decided, tool_input: { command } }), null, command);
  }
  assert.equal(tools(ctx).decide({ tool_name: 'Write', cwd: decided, tool_input: { file_path: path.join(decided, repoState.FOLDER, repoState.FILE) } }), null,
    'the repository copy is not protected: it grants nothing and is rewritten from the decision');
});

test('H-12, H-13: a launcher-started session cannot answer, and stays held', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  for (const marker of ['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256']) {
    const decision = hold(ctx, { [marker]: 'G1' }).decide({ cwd: repo, prompt: 'toolkit governance enable' });
    assert.equal(decision.action, 'block');
    assert.match(decision.reason, /automated session cannot answer/);
  }
  assert.equal(registryBytes(ctx), null);
});

test('H-09: unreadable state, an unreadable held-prompt store and a broken gate module all hold inside a repository only', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  fs.mkdirSync(path.dirname(ctx.registryPath), { recursive: true });
  fs.writeFileSync(ctx.registryPath, '{ not json');
  const corrupt = hold(ctx).decide({ cwd: repo, prompt: 'toolkit governance enable' });
  assert.equal(corrupt.action, 'block');
  assert.match(corrupt.reason, /could not be read/);
  assert.match(tools(ctx).decide({ tool_name: 'Bash', cwd: repo, tool_input: { command: 'ls' } }).deny, /could not be read/);
  assert.match(gate.sessionLine(repo, { registryOptions: ctx.options }), /could not be read/);
  fs.rmSync(ctx.registryPath);
  fs.writeFileSync(ctx.heldPath, 'garbage');
  assert.throws(() => hold(ctx).decide({ cwd: repo, prompt: 'go' }), { code: 'HELD_PROMPTS_MALFORMED' });
  // The hook turns any throw into a hold inside a repository, and into no decision outside one.
  const broken = { PromptHold: class { decide() { throw new Error('boom'); } }, ToolGate: class { decide() { throw new Error('boom'); } },
    sessionLine() { throw new Error('boom'); }, insideRepository: gate.insideRepository };
  const environment = {};
  assert.equal(claudeHook.respond('UserPromptSubmit', { cwd: repo, prompt: 'go' }, { gate: broken, environment }).decision, 'block');
  assert.equal(claudeHook.respond('PreToolUse', { cwd: repo, tool_name: 'Bash' }, { gate: broken, environment }).hookSpecificOutput.permissionDecision, 'deny');
  assert.deepEqual(claudeHook.respond('SessionStart', { cwd: repo }, { gate: broken, environment }), {});
  const outside = path.join(ctx.root, 'outside');
  fs.mkdirSync(outside);
  assert.deepEqual(claudeHook.respond('UserPromptSubmit', { cwd: outside, prompt: 'go' }, { gate: broken, environment }), {});
});

test('H-15: held prompts stay private, are never echoed in the hold message, and never carry the raw remote', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const secretish = 'my private plan for the merger';
  const first = hold(ctx).decide({ cwd: repo, prompt: secretish });
  const second = hold(ctx).decide({ cwd: repo, prompt: 'x'.repeat(gate.MAX_HELD_CHARS + 50) });
  for (const message of [first.reason, second.reason]) {
    assert.equal(message.includes(secretish), false);
    assert.doesNotMatch(message, /example-owner|github\.com/);
  }
  if (process.platform !== 'win32') assert.equal(fs.statSync(ctx.heldPath).mode & 0o777, 0o600);
  const stored = JSON.parse(fs.readFileSync(ctx.heldPath, 'utf8'));
  const list = Object.values(stored.repositories)[0];
  assert.equal(list[1].text.length, gate.MAX_HELD_CHARS);
  assert.doesNotMatch(JSON.stringify(stored), /example-owner|github\.com/, 'keyed by the digest identity only');
  for (let index = 0; index < gate.MAX_HELD + 5; index += 1) hold(ctx).decide({ cwd: repo, prompt: `p${index}` });
  assert.equal(Object.values(JSON.parse(fs.readFileSync(ctx.heldPath, 'utf8')).repositories)[0].length, gate.MAX_HELD);
});

test('cloud sessions are not enforced and write nothing; the session line says so inside a repository', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const environment = { CLAUDE_CODE_REMOTE: 'true' };
  assert.deepEqual(claudeHook.respond('UserPromptSubmit', { cwd: repo, prompt: 'go' }, { environment, registryOptions: ctx.options }), {});
  assert.deepEqual(claudeHook.respond('PreToolUse', { cwd: repo, tool_name: 'Bash', tool_input: { command: 'ls' } }, { environment, registryOptions: ctx.options }), {});
  assert.equal(claudeHook.respond('SessionStart', { cwd: repo }, { environment }).hookSpecificOutput.additionalContext, claudeHook.CLOUD_LINE);
  assert.deepEqual(claudeHook.respond('SessionStart', { cwd: ctx.root }, { environment }), {});
  assert.equal(fs.existsSync(path.join(repo, repoState.FOLDER)), false);
  assert.equal(fs.existsSync(ctx.heldPath), false);
});

test('hosts: the Claude hook script holds and answers end to end with the real user-state location', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const home = path.join(ctx.root, 'home');
  const run = (event, input) => {
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    delete env.CLAUDE_CODE_REMOTE;
    for (const marker of ['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256']) delete env[marker];
    const out = childProcess.execFileSync(process.execPath, [path.join(scripts, 'toolkit-governance-hook.cjs'), '--event', event], { input: JSON.stringify(input), env, encoding: 'utf8' });
    return JSON.parse(out);
  };
  assert.equal(run('UserPromptSubmit', { cwd: repo, prompt: 'go' }).decision, 'block');
  assert.equal(run('PreToolUse', { cwd: repo, tool_name: 'Bash', tool_input: { command: 'ls' } }).hookSpecificOutput.permissionDecision, 'deny');
  const answered = run('UserPromptSubmit', { cwd: repo, prompt: 'toolkit governance decline' });
  assert.match(answered.hookSpecificOutput.additionalContext, /1\. go/);
  assert.deepEqual(run('UserPromptSubmit', { cwd: repo, prompt: 'go' }), {});
  assert.match(run('SessionStart', { cwd: repo }).hookSpecificOutput.additionalContext, /DECLINED/);
  assert.ok(fs.existsSync(path.join(home, '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json')));
  // An unknown event name is a broken install and holds.
  const broken = childProcess.execFileSync(process.execPath, [path.join(scripts, 'toolkit-governance-hook.cjs'), '--event', 'Nope'],
    { input: JSON.stringify({ cwd: repo }), env: { ...process.env, HOME: home, USERPROFILE: home }, encoding: 'utf8' });
  assert.equal(JSON.parse(broken).decision, 'block');
});

test('hosts: the Codex helper hook holds prompts with exit 2 and refuses tools in an undecided repository', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  const home = path.join(ctx.root, 'home');
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  for (const marker of ['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING', 'TOOLKIT_CLAUDE_TASK_PROFILE_SHA256']) delete env[marker];
  const run = input => childProcess.spawnSync(process.execPath, [path.join(scripts, 'toolkit-codex-helper-hook.cjs')], { input: JSON.stringify(input), env, encoding: 'utf8' });
  assert.equal(codexHook.promptEvent({ hook_event_name: 'UserPromptSubmit', prompt: 'x' }), true);
  assert.equal(codexHook.promptEvent({ prompt: 'x' }), true);
  assert.equal(codexHook.promptEvent({ tool_name: 'Bash', tool_input: {} }), false);
  const held = run({ hook_event_name: 'UserPromptSubmit', cwd: repo, prompt: 'go' });
  assert.equal(held.status, 2);
  assert.equal(JSON.parse(held.stdout).decision, 'block');
  assert.ok(held.stderr.startsWith(QUESTION_LINE));
  const tool = run({ hook_event_name: 'PreToolUse', cwd: repo, tool_name: 'apply_patch', tool_input: { input: '*** Begin Patch\n*** End Patch' } });
  assert.equal(tool.status, 2);
  assert.match(JSON.parse(tool.stdout).hookSpecificOutput.permissionDecisionReason, /no governance decision yet/);
  const answered = run({ hook_event_name: 'UserPromptSubmit', cwd: repo, prompt: 'toolkit governance enable' });
  assert.equal(answered.status, 0);
  assert.match(JSON.parse(answered.stdout).hookSpecificOutput.additionalContext, /now ENABLED/);
  const after = run({ hook_event_name: 'UserPromptSubmit', cwd: repo, prompt: 'go' });
  assert.deepEqual([after.status, after.stdout], [0, '']);
});

test('hook wiring: both Claude copies hold prompts and tools with onFailure block; Codex shares the helper launcher', () => {
  for (const file of ['.claude-plugin/hooks/hooks.json', 'repo/contracts/toolkit-local-bridge/claude-plugin/hooks/hooks.json']) {
    const hooks = JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8')).hooks;
    const prompt = hooks.UserPromptSubmit[0].hooks[0];
    assert.equal(prompt.command, 'node "${CLAUDE_PLUGIN_ROOT}/repo/scripts/toolkit-governance-hook.cjs" --event UserPromptSubmit', file);
    assert.equal(prompt.onFailure, 'block');
    const tool = hooks.PreToolUse.find(entry => entry.hooks[0].command.includes('toolkit-governance-hook.cjs'));
    assert.equal(tool.hooks[0].onFailure, 'block');
    for (const name of ['Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Agent', 'Task', 'mcp__github__create_pull_request']) {
      assert.match(name, new RegExp(`^(?:${tool.matcher})$`), name);
    }
    for (const name of ['Read', 'Grep', 'Glob']) assert.doesNotMatch(name, new RegExp(`^(?:${tool.matcher})$`), name);
    assert.ok(hooks.SessionStart[0].hooks.some(hook => hook.command.endsWith('toolkit-governance-hook.cjs" --event SessionStart')));
  }
  for (const file of ['.codex-plugin/hooks/hooks.json', 'repo/contracts/toolkit-local-bridge/codex-plugin/hooks/hooks.json']) {
    const hooks = JSON.parse(fs.readFileSync(path.join(repoRoot, file), 'utf8'));
    assert.equal(hooks.hooks.UserPromptSubmit[0].hooks[0].command, hooks.hooks.PreToolUse[0].hooks[0].command, file);
    for (const entry of hooks.hooks.PreToolUse) assert.equal(entry.hooks[0].command, hooks.hooks.UserPromptSubmit[0].hooks[0].command, file);
    const matches = name => hooks.hooks.PreToolUse.some(entry => new RegExp(entry.matcher).test(name));
    for (const name of ['Bash', 'apply_patch', 'Edit', 'Write', 'spawn_agent', 'mcp__github__create_pull_request']) assert.ok(matches(name), name);
    assert.deepEqual(codexSetup.verifySessionStartHook(null, { hooks }), [], file);
    const rendered = codexSetup.renderInstalledWindowsHooks(hooks, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(rendered.hooks.UserPromptSubmit[0].hooks[0].commandWindows, rendered.hooks.PreToolUse[0].hooks[0].commandWindows);
    assert.equal(rendered.hooks.PreToolUse[1].hooks[0].commandWindows, rendered.hooks.PreToolUse[0].hooks[0].commandWindows);
    assert.deepEqual(codexSetup.verifySessionStartHook(null, { hooks: rendered, windows: true, powershellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' }), []);
  }
});

test('H-16: decided and portable repositories add only local reads', (t) => {
  const ctx = scratch(t);
  const repo = gitRepo(ctx, 'repo');
  gate.writeGovernanceDecision(repo, 'decline', { registryOptions: ctx.options });
  const spawnNames = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync', 'fork'];
  const saved = Object.fromEntries(spawnNames.map(name => [name, childProcess[name]]));
  let spawned = 0;
  for (const name of spawnNames) childProcess[name] = (...args) => { spawned += 1; return saved[name](...args); };
  try {
    const started = process.hrtime.bigint();
    for (let index = 0; index < 20; index += 1) {
      assert.deepEqual(hold(ctx).decide({ cwd: repo, prompt: 'go' }), { action: 'pass' });
      assert.equal(tools(ctx).decide({ tool_name: 'Bash', cwd: repo, tool_input: { command: 'ls' } }), null);
    }
    const perCall = Number(process.hrtime.bigint() - started) / 40 / 1e6;
    assert.ok(perCall < 200, `${perCall.toFixed(1)} ms per call`);
  } finally {
    for (const name of spawnNames) childProcess[name] = saved[name];
  }
  assert.equal(spawned, 0, 'no subprocess on the decided path');
});
