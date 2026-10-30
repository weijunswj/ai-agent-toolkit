'use strict';

// Task auto-merge: the owner's per-repository answer in the merged programme binding
// (`task_prs.auto_merge`), how Toolkit reads it, and the one pinned merge shape the merge hold lets
// through without a typed approval when the answer is yes. Every case uses temporary git
// repositories and a temporary user-state folder.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const hold = require('../scripts/toolkit-merge-hold.cjs');
const gate = require('../scripts/toolkit-governance-gate.cjs');
const governance = require('../scripts/toolkit-governance-state.cjs');
const bindingCache = require('../scripts/toolkit-governance-binding.cjs');
const programmeState = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');

const HEAD = '62405ebd4c27859d66036e18f13c856c645d366d';
const MAIN = 'a'.repeat(40);

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function binding(extra = {}) {
  return {
    schema: 'toolkit.programme-binding.v2',
    repository: 'owner/a',
    governance: 'enabled',
    parents: [{ issue: 1, record_prefix: 'INT-A-' }],
    store: { kind: 'github', repository: 'owner/TRANSPORT-a', branch: 'main', path: 'state/owner/a/' },
    required_checks: ['validate'],
    ...extra,
  };
}

function context(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-task-auto-merge-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registryPath = path.join(root, 'home', '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  const repo = path.join(root, 'a');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'feature']);
  git(repo, ['remote', 'add', 'origin', 'https://github.com/owner/a.git']);
  const remotes = path.join(repo, '.git', 'refs', 'remotes', 'origin');
  fs.mkdirSync(remotes, { recursive: true });
  fs.writeFileSync(path.join(remotes, 'main'), `${MAIN}\n`);
  fs.writeFileSync(path.join(remotes, 'HEAD'), 'ref: refs/remotes/origin/main\n');
  return { root, repo, registryOptions: { registryPath, testOnly: true } };
}

// Writes this computer's read of the binding merged on the default branch, `ageMs` old.
function merged(ctx, value, { ageMs = 0 } = {}) {
  const identity = governance.readIdentity(ctx.repo);
  const text = value === null ? null : JSON.stringify(value);
  const entry = {
    schema: bindingCache.CACHE_SCHEMA,
    repository_id: identity.repository_id,
    remote: identity.remote.canonical,
    default_branch: 'main',
    commit: MAIN,
    fetched_at: new Date(Date.now() - ageMs).toISOString(),
    status: value === null ? 'absent' : 'present',
    bytes_sha256: text === null ? null : crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
    text,
    problem: null,
  };
  const file = bindingCache.cacheFileFor(ctx.registryOptions.registryPath, identity.repository_id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(entry));
}

const YES = binding({ task_prs: { auto_merge: 'after-gates' }, required_checks: ['validate', 'auto-merge-eligible'] });

const userSession = (ctx, id = 'user') => { gate.startSession({ session_id: id, source: 'startup', cwd: ctx.repo }, { registryOptions: ctx.registryOptions }); return id; };
const bash = (ctx, command, session) => ({ cwd: ctx.repo, session_id: session, tool_name: 'Bash', tool_input: { command } });
const decide = (ctx, input, environment = {}) => hold.decide(input, { registryOptions: ctx.registryOptions, environment });

test('binding: task_prs.auto_merge is off or after-gates, version 2 only, nothing else', () => {
  for (const value of ['off', 'after-gates']) assert.ok(programmeState.validateBinding(binding({ task_prs: { auto_merge: value } })), value);
  assert.ok(programmeState.validateBinding(binding({ task_prs: {} })));
  for (const task_prs of [{ auto_merge: 'on' }, { auto_merge: true }, { auto_merge: 'off', other: 1 }, 'after-gates', null]) {
    assert.throws(() => programmeState.validateBinding(binding({ task_prs })), /task_prs/, JSON.stringify(task_prs));
  }
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'programme-state', 'binding-v2.schema.json'), 'utf8'));
  assert.deepEqual(schema.properties.task_prs.properties.auto_merge.enum, ['off', 'after-gates']);
});

test('reader: only a fresh merged binding that says after-gates turns it on', (t) => {
  const ctx = context(t);
  const read = () => governance.taskAutoMerge(ctx.repo, ctx.registryOptions);
  assert.deepEqual(read(), { auto_merge: 'off', answered: false, fresh: false, eligibility_required: false }, 'nothing read yet');
  merged(ctx, binding());
  assert.deepEqual(read(), { auto_merge: 'off', answered: false, fresh: true, eligibility_required: false }, 'not answered');
  merged(ctx, binding({ task_prs: { auto_merge: 'off' } }));
  assert.deepEqual(read(), { auto_merge: 'off', answered: true, fresh: true, eligibility_required: false });
  merged(ctx, YES);
  assert.deepEqual(read(), { auto_merge: 'after-gates', answered: true, fresh: true, eligibility_required: true });
  merged(ctx, binding({ task_prs: { auto_merge: 'after-gates' } }));
  assert.deepEqual(read(), { auto_merge: 'after-gates', answered: true, fresh: true, eligibility_required: false });
  merged(ctx, YES, { ageMs: 25 * 60 * 60 * 1000 });
  assert.equal(read().auto_merge, 'off', 'a read over a day old');
  merged(ctx, { ...YES, governance: 'disabled' });
  assert.equal(read().auto_merge, 'off', 'governance off');
  merged(ctx, { ...YES, repository: 'owner/b' });
  assert.equal(read().auto_merge, 'off', 'another repository\'s binding');
  merged(ctx, null);
  fs.mkdirSync(path.join(ctx.repo, '.github'), { recursive: true });
  fs.writeFileSync(path.join(ctx.repo, '.github', 'toolkit-programme.json'), JSON.stringify(YES));
  assert.equal(read().auto_merge, 'off', 'a working-tree edit turns nothing on');
});

test('hold: with yes, only the pinned merge-commit merge in the user\'s own session passes without a typed approval', (t) => {
  const ctx = context(t);
  merged(ctx, YES);
  const session = userSession(ctx);
  const pass = [
    `gh pr merge 7 --merge --match-head-commit ${HEAD}`,
    `gh pr merge 7 -m --match-head-commit=${HEAD}`,
    `gh pr merge https://github.com/owner/a/pull/7 --merge --match-head-commit ${HEAD}`,
    `gh pr merge 7 --repo owner/a --merge --match-head-commit ${HEAD}`,
  ];
  for (const command of pass) assert.equal(decide(ctx, bash(ctx, command, session)), null, command);
  const refused = [
    [`gh pr merge 7 --match-head-commit ${HEAD}`, /--merge/],
    [`gh pr merge 7 --merge --match-head-commit 62405eb`, /40 character/],
    [`gh pr merge 7 --merge`, /40 character/],
    [`gh pr merge 7 --merge --auto --match-head-commit ${HEAD}`, /adds --auto/],
    [`gh pr merge 7 --squash --match-head-commit ${HEAD}`, /--merge|--squash/],
    [`gh pr merge 7 --merge --rebase --match-head-commit ${HEAD}`, /adds --rebase/],
    [`gh pr merge 7 --merge --admin --match-head-commit ${HEAD}`, /adds --admin/],
    [`gh pr merge 7 --merge --delete-branch --match-head-commit ${HEAD}`, /adds --delete-branch/],
    [`gh pr merge 7 --merge --subject x --match-head-commit ${HEAD}`, /adds --subject/],
    [`gh pr merge 7 --repo owner/b --merge --match-head-commit ${HEAD}`, /another repository/],
    [`gh api -X PUT repos/owner/a/pulls/7/merge -f sha=${HEAD} -f merge_method=merge`, /API merge endpoint/],
  ];
  for (const [command, why] of refused) {
    const result = decide(ctx, bash(ctx, command, session));
    assert.ok(result && result.deny, command);
    assert.match(result.deny, why, command);
    assert.match(result.deny, /type, as plain text/, 'the refusal says how the user approves instead');
  }
});

test('hold: connector merges with yes need merge_method "merge" and the head SHA field; auto-merge stays refused', (t) => {
  const ctx = context(t);
  merged(ctx, YES);
  const session = userSession(ctx);
  const call = (tool, args) => ({ cwd: ctx.repo, session_id: session, tool_name: `mcp__github__${tool}`, tool_input: { owner: 'owner', repo: 'a', pullNumber: 7, ...args } });
  assert.equal(decide(ctx, call('merge_pull_request', { expectedHeadSha: HEAD, merge_method: 'merge' })), null);
  assert.match(decide(ctx, call('merge_pull_request', { expectedHeadSha: HEAD })).deny, /merge_method/);
  assert.match(decide(ctx, call('merge_pull_request', { expectedHeadSha: HEAD, merge_method: 'squash' })).deny, /merge_method/);
  assert.match(decide(ctx, call('merge_pull_request', { merge_method: 'merge' })).deny, /40 character/);
  assert.match(decide(ctx, call('enable_pull_request_auto_merge', { merge_method: 'merge' })).deny, /40 character|auto-merge/);
  assert.match(decide(ctx, call('enable_pull_request_auto_merge', { expectedHeadSha: HEAD, merge_method: 'merge' })).deny, /auto-merge/);
  const other = { cwd: ctx.repo, session_id: session, tool_name: 'mcp__github__merge_pull_request', tool_input: { owner: 'owner', repo: 'b', pullNumber: 7, expectedHeadSha: HEAD, merge_method: 'merge' } };
  assert.match(decide(ctx, other).deny, /another repository/);
});

test('hold: without a fresh yes, or in a session the user did not start, the typed approval is still needed', (t) => {
  const ctx = context(t);
  const command = `gh pr merge 7 --merge --match-head-commit ${HEAD}`;
  const session = userSession(ctx);
  const notApproved = /has not approved a merge of owner\/a#7/;
  merged(ctx, binding());
  assert.match(decide(ctx, bash(ctx, command, session)).deny, notApproved, 'not answered');
  merged(ctx, binding({ task_prs: { auto_merge: 'off' } }));
  assert.match(decide(ctx, bash(ctx, command, session)).deny, notApproved, 'answered no');
  merged(ctx, YES, { ageMs: 25 * 60 * 60 * 1000 });
  assert.match(decide(ctx, bash(ctx, command, session)).deny, notApproved, 'a stale read');
  merged(ctx, binding({ task_prs: { auto_merge: 'after-gates' } }));
  assert.match(decide(ctx, bash(ctx, command, session)).deny, notApproved, 'yes without the auto-merge-eligible required check');
  merged(ctx, YES);
  assert.match(decide(ctx, bash(ctx, command, 'never-started')).deny, notApproved, 'no session-start mark');
  assert.match(decide(ctx, bash(ctx, command, session), { TOOLKIT_GATE_ROLE: 'G1' }).deny, notApproved, 'a gate session');
  assert.match(decide(ctx, bash(ctx, command, session), { TOOLKIT_HOST_SESSION: 'parent' }).deny, notApproved, 'started by another session');
  gate.startSession({ session_id: 'resumed', source: 'resume', cwd: ctx.repo }, { registryOptions: ctx.registryOptions });
  assert.match(decide(ctx, bash(ctx, command, 'resumed')).deny, notApproved, 'a resumed run');
  assert.equal(decide(ctx, bash(ctx, command, session)), null, 'the user\'s own fresh session still passes');
});

test('hold: a typed approval works as before when the answer is yes, and a standing merge uses none', (t) => {
  const ctx = context(t);
  merged(ctx, YES);
  const session = userSession(ctx);
  assert.equal(hold.recordPrompt({ cwd: ctx.repo, prompt: 'merge 8', session_id: session }, { registryOptions: ctx.registryOptions, environment: {} }), 1);
  assert.equal(decide(ctx, bash(ctx, `gh pr merge 7 --merge --match-head-commit ${HEAD}`, session)), null);
  assert.equal(decide(ctx, bash(ctx, `gh pr merge 8 --squash --match-head-commit ${HEAD}`, session)), null, 'the typed approval for 8 covers its own shape');
  assert.match(decide(ctx, bash(ctx, `gh pr merge 8 --squash --match-head-commit ${HEAD}`, session)).deny, /--merge|--squash/, 'and is used once');
});

test('governance check: asks the question once, says off or on, and flags a yes it cannot enforce', (t) => {
  const conformance = require('../scripts/toolkit-governance-conformance.cjs');
  const ctx = context(t);
  fs.mkdirSync(path.join(ctx.repo, '.github'), { recursive: true });
  const both = (value) => {
    merged(ctx, value);
    fs.writeFileSync(path.join(ctx.repo, '.github', 'toolkit-programme.json'), JSON.stringify(value));
    return conformance.checkConformance(ctx.repo, { ...ctx.registryOptions, offline: true }).findings.filter(entry => entry.id.startsWith('TASK_AUTO_MERGE'));
  };
  const [unanswered] = both(binding());
  assert.equal(unanswered.id, 'TASK_AUTO_MERGE_UNANSWERED');
  assert.equal(unanswered.severity, 'info', 'never blocks');
  for (const words of [governance.TASK_AUTO_MERGE_QUESTION.text, governance.TASK_AUTO_MERGE_QUESTION.no, 'task_prs.auto_merge', 'auto-merge-eligible']) assert.ok(unanswered.message.includes(words), words);
  assert.match(governance.TASK_AUTO_MERGE_QUESTION.no, /^No\b.*\(recommended\)/, 'No is the recommended answer');
  assert.doesNotMatch(governance.TASK_AUTO_MERGE_QUESTION.yes, /recommended/);
  assert.match(governance.TASK_AUTO_MERGE_QUESTION.yes, /toolkit-owner-merge label/, 'the yes says how always-manual pull requests merge');
  const version = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'toolkit-local-bridge', 'version.json'), 'utf8')).version;
  assert.ok(unanswered.message.includes(`Once every Toolkit copy, the Claude account copy included, runs ${version} or later`), 'asked only once every copy can read the answer');
  assert.match(unanswered.message, /Until then, ask nothing and merge no answer\./);
  assert.deepEqual(both(binding({ task_prs: { auto_merge: 'off' } })).map(entry => [entry.id, entry.severity]), [['TASK_AUTO_MERGE_OFF', 'info']]);
  assert.deepEqual(both(binding({ task_prs: { auto_merge: 'after-gates' } })).map(entry => [entry.id, entry.severity]), [['TASK_AUTO_MERGE_NOT_ENFORCEABLE', 'drift']]);
  assert.deepEqual(both(YES).map(entry => [entry.id, entry.severity]), [['TASK_AUTO_MERGE_ON', 'info']]);
});

test('hold: only the owner sets the toolkit-owner-merge label; agents naming it to GitHub are refused', (t) => {
  const ctx = context(t);
  merged(ctx, YES);
  const session = userSession(ctx);
  const label = require('../scripts/toolkit-auto-merge-eligible.cjs').OWNER_LABEL;
  assert.equal(label, 'toolkit-owner-merge');
  for (const command of [`gh pr edit 7 --add-label ${label}`, `gh api -X POST repos/owner/a/issues/7/labels -f labels[]=${label}`, `curl -X POST https://api.github.com/repos/owner/a/issues/7/labels -d '{"labels":["${label}"]}'`, `gh label create ${label}`, `gh pr edit 7 --remove-label ${label}`]) {
    const result = decide(ctx, bash(ctx, command, session));
    assert.ok(result && result.deny, command);
    assert.match(result.deny, /only the owner adds or removes it, in GitHub/, command);
  }
  for (const command of [`grep -rn ${label} repo/docs`, 'gh pr view 7 --json labels']) assert.equal(decide(ctx, bash(ctx, command, session)), null, command);
  const tool = (name, input) => ({ cwd: ctx.repo, session_id: session, tool_name: name, tool_input: input });
  for (const name of ['mcp__github__issue_write', 'mcp__github__add_labels_to_issue', 'mcp__2f1c__update_pull_request']) {
    assert.match(decide(ctx, tool(name, { owner: 'owner', repo: 'a', issue_number: 7, labels: [label] })).deny, /only the owner/, name);
    assert.equal(decide(ctx, tool(name, { owner: 'owner', repo: 'a', issue_number: 7, labels: ['bug'] })), null, `${name} with another label`);
  }
  assert.equal(decide(ctx, tool('mcp__hearthbot__post_message', { text: `Add the ${label} label in GitHub.` })), null, 'chat may name it');
  assert.equal(hold.mayMerge(tool('Bash', { command: `gh pr edit 7 --add-label ${label}` })), true, 'a failed check refuses it too');
});
