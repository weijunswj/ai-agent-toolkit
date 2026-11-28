'use strict';

// The post-merge finish of a governance turn-on from the question bank: `toolkit governance finish`
// acts only on a repository the bank noted as finish pending, once its enabled binding is merged;
// it asks nothing. Each setting ends as on (read back), not enforceable on this plan, held for an owner
// step, or retry; only retry keeps it pending. The session line shows the result, built from what
// actually happened, once.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { recordMerged, commitFixture } = require('./toolkit-governed-fixture-support.cjs');

const scripts = path.resolve(__dirname, '..', 'scripts');
const { ToolkitGovernanceCli } = require(path.join(scripts, 'toolkit-governance.cjs'));
const finishing = require(path.join(scripts, 'toolkit-governance-finish.cjs'));
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));
const ruleset = require(path.join(scripts, 'toolkit-governance-ruleset.cjs'));
const protection = require(path.join(scripts, 'toolkit-governance-protection.cjs'));
const managedBlock = require(path.join(scripts, 'toolkit-managed-block.cjs'));

function governedRepo(t, { merged = true, requiredChecks = ['validate'], workflow = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-finish-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'example-repo');
  fs.mkdirSync(repo, { recursive: true });
  childProcess.execFileSync('git', ['init', '--quiet', repo], { windowsHide: true });
  childProcess.execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/example-owner/example-repo.git'], { windowsHide: true });
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), `${managedBlock.renderBlock({ source: 'repo/contracts/agent-rules/toolkit-governed-rules.md', name: 'TOOLKIT-GOVERNED-RULES', version: '1.0.0', body: '# Rules' })}\n`);
  fs.mkdirSync(path.join(repo, '.github', 'workflows'), { recursive: true });
  if (workflow) fs.writeFileSync(path.join(repo, '.github', 'workflows', 'ci.yml'), 'name: CI\non:\n  pull_request:\n  push:\n    branches: [main]\njobs:\n  validate:\n    name: validate\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n');
  fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), JSON.stringify({
    schema: 'toolkit.programme-binding.v2', repository: 'example-owner/example-repo', governance: 'enabled', parents: [{ issue: 3, record_prefix: 'INT-A-' }],
    store: { kind: 'github', repository: 'example-owner/example-store', branch: 'main', path: 'state/' }, required_checks: requiredChecks,
  }));
  const registryOptions = { registryPath: path.join(root, 'state', 'repository-governance.v1.json'), testOnly: true };
  if (merged) recordMerged(repo, { registryPath: registryOptions.registryPath, commit: commitFixture(repo) });
  return { repo, registryOptions };
}

function cli(ctx, rulesets, created, overrides = {}) {
  const out = [];
  const instance = new ToolkitGovernanceCli({
    stdout: { write: text => { out.push(String(text)); return true; } }, stderr: { write: text => { out.push(String(text)); return true; } }, interactive: true, cwd: ctx.repo,
    ask: async question => { throw Error(`the finish asked: ${question}`); },
    registryOptions: ctx.registryOptions,
    rulesetReader: () => ({ ok: true, rulesets }),
    rulesetCreator: () => { created.push('no-force-push'); rulesets.push(ruleset.noForcePushRulesetBody()); return { ok: true, id: 1 }; },
    stateRulesetCreator: () => ({ ok: false, reason: 'not expected' }),
    protectionReader: () => ({ ok: false, reason: 'gh-unavailable' }),
    securityReader: () => ({ ok: false, reason: 'gh-unavailable' }),
    ...overrides,
  });
  return { run: () => instance.main(['finish']), out };
}

test('finish changes nothing for a repository the bank did not turn on, or before its turn-on is merged', async t => {
  const ctx = governedRepo(t, { merged: false }), created = [];
  const nothing = cli(ctx, [], created);
  assert.equal(await nothing.run(), 0);
  assert.match(nothing.out.join(''), /Nothing to finish here/);
  const id = governance.governanceState(ctx.repo, ctx.registryOptions).repository_id;
  finishing.markPending(ctx.registryOptions, id, { proposal: 1 });
  const early = cli(ctx, [], created);
  assert.equal(await early.run(), 0);
  assert.match(early.out.join(''), /Not finished yet: the turn-on pull request is not merged/);
  assert.deepEqual(created, [], 'nothing is written before the merge');
  assert.equal(finishing.entryFor(ctx.registryOptions, id).status, 'pending');
});

test('after the merge, finish adds the settings without asking, and stays pending until GitHub reads every one back', async t => {
  const ctx = governedRepo(t), created = [], rulesets = [];
  const state = governance.governanceState(ctx.repo, ctx.registryOptions);
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
  const run = cli(ctx, rulesets, created);
  // Protection and security cannot be read here, so the finish is not done, though the ruleset was added.
  assert.equal(await run.run(), 2, run.out.join(''));
  assert.deepEqual(created, ['no-force-push'], 'the bank\'s yes covers the ruleset: it is added without another question');
  const entry = finishing.entryFor(ctx.registryOptions, state.repository_id);
  assert.equal(entry.status, 'pending');
  assert.match(entry.line, /could not finish here yet \(default-branch protection could not be read back; the security settings could not be read back\); it is tried again in a later session\. On and read back: the no-force-push ruleset\./);
  // The next session shows why; it is tried again later, never more than once per gap.
  const started = [];
  const lines = finishing.sessionLines(governance.governanceState(ctx.repo, ctx.registryOptions), ctx.registryOptions, { startFinish: root => started.push(root) });
  assert.match(lines.join(' '), /could not finish here yet/);
  assert.equal(started.length, 1);
  assert.equal(finishing.sessionLines(governance.governanceState(ctx.repo, ctx.registryOptions), ctx.registryOptions, { startFinish: root => started.push(root) }).length, 1, 'the reason again, with no second start');
  assert.equal(started.length, 1);
});

test('a finished setup is shown once by the next session, then nothing more is said or started', t => {
  const ctx = governedRepo(t);
  const state = governance.governanceState(ctx.repo, ctx.registryOptions);
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
  finishing.record(ctx.registryOptions, state.repository_id, { result: 'done', on: ['the no-force-push ruleset', 'default-branch protection'] });
  const started = [];
  const deps = { startFinish: root => started.push(root) };
  assert.match(finishing.sessionLines(state, ctx.registryOptions, deps).join(' '), /governance setup finished here\. On and read back: the no-force-push ruleset and default-branch protection\.$/);
  assert.deepEqual(finishing.sessionLines(state, ctx.registryOptions, deps), []);
  assert.equal(started.length, 0);
});

test('one finish at a time: a second run while one works starts nothing, and a run that died is started again with a note', async t => {
  const ctx = governedRepo(t), created = [];
  const state = governance.governanceState(ctx.repo, ctx.registryOptions);
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
  const held = finishing.claim(ctx.registryOptions, state.repository_id);
  assert.ok(held);
  assert.equal(finishing.claim(ctx.registryOptions, state.repository_id), null, 'a second claim waits');
  const second = cli(ctx, [], created);
  assert.equal(await second.run(), 0);
  assert.match(second.out.join(''), /already working here/);
  assert.deepEqual(created, [], 'the second run wrote nothing');
  held.release();
  // A busy run notes when it ended, so it is not later reported as a run that died.
  assert.ok(Date.parse(finishing.entryFor(ctx.registryOptions, state.repository_id).finished_at) > 0);
  // A start an hour ago that never recorded a result: the next session starts it again and says why.
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
  const started = [], hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  finishing.sessionLines(state, ctx.registryOptions, { startFinish: () => started.push(1), now: () => hourAgo });
  const lines = finishing.sessionLines(state, ctx.registryOptions, { startFinish: () => started.push(1) });
  assert.equal(started.length, 2);
  assert.match(lines.join(' '), /stopped without a result, so it was started again/);
});

test('the result names security files the finish wrote into the working tree', t => {
  const ctx = governedRepo(t);
  const state = governance.governanceState(ctx.repo, ctx.registryOptions);
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
  finishing.record(ctx.registryOptions, state.repository_id, { result: 'done', files: ['.github/dependabot.yml'] });
  // A file in the repository is its controller's to commit, never the owner's (G-4f).
  assert.match(finishing.entryFor(ctx.registryOptions, state.repository_id).line, /Your controller commits \.github\/dependabot\.yml through a pull request: Toolkit wrote it in this working tree\./);
});

// A fresh repository: no protection on the default branch, GitHub's default merge methods.
const unprotected = () => ({ ok: true, default_branch: 'main', repository: { allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true }, rules: [], classic: null, toolkit_ruleset: null });
// GitHub's read of the security settings, with the merged binding as the default branch holds it.
const publicSecurity = ctx => () => ({ ok: true, binding: { status: 'ok', text: fs.readFileSync(path.join(ctx.repo, '.github', 'toolkit-programme.json'), 'utf8') }, visibility: 'public', allow_auto_merge: false, delete_branch_on_merge: 'enabled', alerts: 'enabled', security_updates: 'enabled',
  secret_scanning: 'enabled', push_protection: 'enabled', code_scanning: 'enabled', private_reporting: 'enabled', advanced_codeql: null });

test('a fresh repository with no required checks finishes: protection waits for the owner\'s concrete step, and nothing is retried', async t => {
  const ctx = governedRepo(t, { requiredChecks: [] }), created = [], rulesets = [], wrote = [];
  const state = governance.governanceState(ctx.repo, ctx.registryOptions);
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
  const run = cli(ctx, rulesets, created, { protectionReader: unprotected, protectionWriter: (...args) => { wrote.push(args); return { ok: true, id: 9 }; }, securityReader: publicSecurity(ctx) });
  assert.equal(await run.run(), 0, run.out.join(''));
  assert.deepEqual(wrote, [], 'with nothing to require, no protection ruleset is written');
  const entry = finishing.entryFor(ctx.registryOptions, state.repository_id);
  assert.equal(entry.status, 'done', 'final: never \'tried again in a later session\'');
  assert.doesNotMatch(entry.line, /tried again/);
  assert.match(entry.line, /finished here, apart from what is left below\. On and read back: the no-force-push ruleset and the free dependency and security settings\./);
  // Never a hand edit of the programme file: the summary's one update pull request adds the checks.
  // Never a command for the owner's own terminal: the agent runs refresh governance (SQAG, 28 Nov).
  assert.match(entry.line, /Waiting for you, default-branch protection: the programme file lists no required checks yet, so there is nothing for it to require\. Say refresh governance: it offers one pull request that adds the checks the default branch already requires and Toolkit's own\. Once that is merged, refresh governance offers to add the protection\./);
  assert.doesNotMatch(entry.line, /migrate|own terminal/);
  assert.doesNotMatch(entry.line, /required_checks in|by hand/);
  const started = [];
  assert.match(finishing.sessionLines(state, ctx.registryOptions, { startFinish: () => started.push(1) }).join(' '), /Waiting for you, default-branch protection/);
  assert.deepEqual(finishing.sessionLines(state, ctx.registryOptions, { startFinish: () => started.push(1) }), [], 'shown once, then dropped');
  assert.equal(started.length, 0, 'no background run is started again');
});

test('protection held for a by-hand fix ends the finish with that step in the result, not in discarded output', async t => {
  // "validate" is required, but no workflow job produces it: requiring it would block every merge.
  const ctx = governedRepo(t), created = [], rulesets = [], wrote = [];
  const state = governance.governanceState(ctx.repo, ctx.registryOptions);
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
  const run = cli(ctx, rulesets, created, { protectionReader: unprotected, protectionWriter: (...args) => { wrote.push(args); return { ok: true, id: 9 }; }, securityReader: publicSecurity(ctx) });
  assert.equal(await run.run(), 0, run.out.join(''));
  assert.deepEqual(wrote, []);
  const entry = finishing.entryFor(ctx.registryOptions, state.repository_id);
  assert.equal(entry.status, 'done');
  // Where on GitHub to change it, then the agent checks again: never a command for the owner.
  assert.match(entry.line, /Waiting for you, default-branch protection: change by hand: .*validate.*\. Where on GitHub: the repository's Settings, then Rules, then Rulesets[^.]*\. Then say refresh governance, and your agent checks it again\./);
  assert.doesNotMatch(entry.line, /migrate|own terminal/);
});

test('on a private repository on GitHub Free, the result never says protection or rulesets are on, and names what GitHub cannot enforce', async t => {
  const ctx = governedRepo(t), created = [], writes = [];
  const state = governance.governanceState(ctx.repo, ctx.registryOptions);
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
  const run = cli(ctx, [], created, {
    rulesetReader: () => ({ ok: false, reason: 'plan-has-no-rulesets' }),
    protectionReader: () => ({ ok: false, reason: 'plan-has-no-protection' }),
    protectionWriter: () => { writes.push('protection'); return { ok: false, reason: 'x' }; },
    securityReader: () => ({ ...publicSecurity(ctx)(), visibility: 'private', secret_scanning: 'not-on-plan', push_protection: 'not-on-plan', code_scanning: 'not-on-plan', private_reporting: 'not-on-plan' }),
    securityWriter: () => { writes.push('security'); return []; },
  });
  assert.equal(await run.run(), 0, run.out.join(''));
  assert.deepEqual([...created, ...writes], [], 'nothing is written');
  const line = finishing.sessionLines(governance.governanceState(ctx.repo, ctx.registryOptions), ctx.registryOptions, { startFinish: () => {} }).join(' ');
  assert.doesNotMatch(line, /protection[^.]*are on|On and read back:[^.]*(ruleset|protection)/);
  assert.match(line, /On and read back: the free dependency and security settings\. Not set: GitHub cannot enforce the no-force-push ruleset and default-branch protection on a private repository on GitHub Free, so nothing was written for them; the local guards stay the fallback\./);
});

test('a run that finds the turn-on not merged yet notes when it ended, so it is not reported as a run that died', async t => {
  const ctx = governedRepo(t, { merged: false }), created = [];
  const id = governance.governanceState(ctx.repo, ctx.registryOptions).repository_id;
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  finishing.markPending(ctx.registryOptions, id, { proposal: 1, now: hourAgo });
  // The session start an hour ago launched it; it ran and found the turn-on not merged.
  const file = path.join(path.dirname(ctx.registryOptions.registryPath), finishing.BASENAME);
  fs.writeFileSync(file, JSON.stringify({ schema: finishing.SCHEMA, repositories: { [id]: { ...finishing.entryFor(ctx.registryOptions, id), started_at: hourAgo.toISOString() } } }));
  assert.equal(await cli(ctx, [], created).run(), 0);
  recordMerged(ctx.repo, { registryPath: ctx.registryOptions.registryPath, commit: commitFixture(ctx.repo) });
  const lines = finishing.sessionLines(governance.governanceState(ctx.repo, ctx.registryOptions), ctx.registryOptions, { startFinish: () => {} });
  assert.doesNotMatch(lines.join(' '), /stopped without a result/);
  assert.match(lines.join(' '), /finishing its setup in the background/);
});

test('a CodeQL setup only a person can check ends the finish with that step, instead of retrying it every session', async t => {
  // A public repository whose CodeQL results come from a workflow Toolkit cannot place: GitHub
  // answered, so reading again shows the same thing. (No required checks, so protection is held too.)
  const ctx = governedRepo(t, { requiredChecks: [] }), created = [], rulesets = [], writes = [];
  const state = governance.governanceState(ctx.repo, ctx.registryOptions);
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
  const securityReader = () => ({ ...publicSecurity(ctx)(), code_scanning: 'disabled', advanced_codeql: 'unreadable', codeql_uploads: '.github/workflows/org-codeql.yml:analyze' });
  const run = cli(ctx, rulesets, created, { protectionReader: unprotected, protectionWriter: () => ({ ok: true, id: 9 }), securityReader, securityWriter: (slug, plan) => { writes.push(plan); return []; } });
  assert.equal(await run.run(), 0, run.out.join(''));
  assert.deepEqual(writes, [], 'nothing is written for CodeQL while an advanced setup cannot be ruled out');
  const entry = finishing.entryFor(ctx.registryOptions, state.repository_id);
  assert.equal(entry.status, 'done');
  assert.doesNotMatch(entry.line, /tried again|could not be read back/);
  assert.match(entry.line, /Waiting for you, some dependency and security settings: change by hand: GitHub has CodeQL results on the default branch from \.github\/workflows\/org-codeql\.yml:analyze .*check it by hand\./);
  // A read GitHub did not answer is still retried.
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
  const unread = cli(ctx, rulesets, created, { protectionReader: unprotected, protectionWriter: () => ({ ok: true, id: 9 }), securityReader: () => ({ ...securityReader(), codeql_uploads: undefined }) });
  assert.equal(await unread.run(), 2);
  assert.match(finishing.entryFor(ctx.registryOptions, state.repository_id).line, /could not finish here yet \(the security settings could not be read back\)/);
});

test('on a private repository on GitHub Free with no required checks, protection is named with what GitHub cannot enforce, not as a step', async t => {
  const ctx = governedRepo(t, { requiredChecks: [] }), created = [];
  const state = governance.governanceState(ctx.repo, ctx.registryOptions);
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
  const run = cli(ctx, [], created, {
    rulesetReader: () => ({ ok: false, reason: 'plan-has-no-rulesets' }), protectionReader: () => ({ ok: false, reason: 'plan-has-no-protection' }),
    securityReader: () => ({ ...publicSecurity(ctx)(), visibility: 'private', secret_scanning: 'not-on-plan', push_protection: 'not-on-plan', code_scanning: 'not-on-plan', private_reporting: 'not-on-plan' }),
  });
  assert.equal(await run.run(), 0, run.out.join(''));
  const line = finishing.entryFor(ctx.registryOptions, state.repository_id).line;
  assert.match(line, /Not set: GitHub cannot enforce the no-force-push ruleset and default-branch protection on a private repository on GitHub Free/);
  assert.doesNotMatch(line, /Waiting for you|migrate/);
});

test('a write GitHub refuses keeps its answer in the reason the owner sees', async t => {
  const ctx = governedRepo(t, { workflow: true }), rulesets = [];
  const state = governance.governanceState(ctx.repo, ctx.registryOptions);
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
  const run = cli(ctx, rulesets, [], { rulesetCreator: () => ({ ok: false, reason: 'gh-request-failed' }), protectionReader: unprotected,
    protectionWriter: () => ({ ok: false, reason: 'gh-request-failed' }), securityReader: publicSecurity(ctx) });
  assert.equal(await run.run(), 2, run.out.join(''));
  assert.match(finishing.entryFor(ctx.registryOptions, state.repository_id).line,
    /could not finish here yet \(the no-force-push ruleset is not read back \(GitHub answered: gh-request-failed\); default-branch protection did not read back after the write \(GitHub answered: gh-request-failed\)\)/);
});

test('dependency auto-merge waiting on a workflow fix for the controller waits with it, not retried and not by hand', async t => {
  // "validate" only reports on some pull requests (its trigger lists activity types), so protection
  // reads unverified: a workflow fix for the repository's controller (G-4f), never a by-hand step.
  // Dependency auto-merge needs that protection, so it waits for the fix too.
  const ctx = governedRepo(t, { workflow: true });
  fs.writeFileSync(path.join(ctx.repo, '.github', 'workflows', 'ci.yml'), 'name: CI\non:\n  pull_request:\n    types: [opened]\njobs:\n  validate:\n    name: validate\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n');
  const bindingFile = path.join(ctx.repo, '.github', 'toolkit-programme.json');
  fs.writeFileSync(bindingFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(bindingFile, 'utf8')), dependency_updates: { auto_merge: 'patch-minor', github_actions: 'owner' } }));
  recordMerged(ctx.repo, { registryPath: ctx.registryOptions.registryPath, commit: commitFixture(ctx.repo) });
  const state = governance.governanceState(ctx.repo, ctx.registryOptions);
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
  const protectedRead = () => ({ ok: true, default_branch: 'main', repository: { allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: false }, classic: null, toolkit_ruleset: null,
    rules: [{ type: 'pull_request', ruleset_id: 7, parameters: { allowed_merge_methods: ['merge'] } }, { type: 'required_status_checks', ruleset_id: 7, parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: 'validate', integration_id: 15368 }] } }] });
  const run = cli(ctx, [], [], { protectionReader: protectedRead, securityReader: () => ({ ...publicSecurity(ctx)(), allow_auto_merge: true }) });
  const code = await run.run();
  const line = finishing.entryFor(ctx.registryOptions, state.repository_id).line;
  assert.equal(code, 0, `${run.out.join('')}\n${line}`);
  assert.match(line, /^Toolkit: governance setup finished here, apart from what is left below\./);
  assert.match(line, /Your controller fixes this in a pull request: "validate" \(\.github\/workflows\/ci\.yml\): its pull_request trigger lists activity types/);
  assert.match(line, /Waiting for you, some dependency and security settings: dependency auto-merge waits until your controller's workflow fix above has landed\./);
  assert.doesNotMatch(line, /change by hand|default-branch protection: /, 'the workflow is not the owner\'s by hand');
});

test('a security read or write GitHub did not confirm is retried, never held as a by-hand step', async t => {
  const ctx = governedRepo(t, { requiredChecks: [] });
  const state = governance.governanceState(ctx.repo, ctx.registryOptions);
  const alertsOff = () => ({ ...publicSecurity(ctx)(), alerts: 'disabled' });
  // H: the first read fails (nothing is written), the final read shows a free setting off.
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
  let reads = 0;
  const firstFails = () => (reads++ === 0 ? { ok: false, reason: 'gh-unavailable' } : alertsOff());
  assert.equal(await cli(ctx, [], [], { protectionReader: unprotected, securityReader: firstFails }).run(), 2);
  let entry = finishing.entryFor(ctx.registryOptions, state.repository_id);
  assert.equal(entry.status, 'pending');
  assert.match(entry.line, /could not finish here yet \(the security settings could not be read back\)/);
  assert.doesNotMatch(entry.line, /Dependabot alerts is off/, 'not handed to the owner: Toolkit turns it on itself');
  // G: the write is accepted but its read-back fails, then the final read shows it off.
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
  reads = 0;
  const readBackFails = () => (reads++ === 1 ? { ok: false, reason: 'gh-unavailable' } : alertsOff());
  assert.equal(await cli(ctx, [], [], { protectionReader: unprotected, securityReader: readBackFails, securityWriter: (slug, plan) => Object.keys(plan).filter(key => plan[key]).map(setting => ({ setting, ok: true })) }).run(), 2);
  entry = finishing.entryFor(ctx.registryOptions, state.repository_id);
  assert.equal(entry.status, 'pending');
  assert.doesNotMatch(entry.line, /change by hand: Dependabot alerts/);
  // A free setting Toolkit would turn on that the first read could not see is retried too.
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
  reads = 0;
  const unseenFirst = () => (reads++ === 0 ? { ...publicSecurity(ctx)(), alerts: 'unreadable' } : alertsOff());
  assert.equal(await cli(ctx, [], [], { protectionReader: unprotected, securityReader: unseenFirst }).run(), 2);
  assert.match(finishing.entryFor(ctx.registryOptions, state.repository_id).line, /could not finish here yet \(a free security setting Toolkit turns on is still off\)/);
});

test('dependency auto-merge is held behind protection only when its policy and allow auto-merge were read', async t => {
  const ctx = governedRepo(t, { workflow: true });
  fs.writeFileSync(path.join(ctx.repo, '.github', 'workflows', 'ci.yml'), 'name: CI\non:\n  pull_request:\n    types: [opened]\njobs:\n  validate:\n    name: validate\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n');
  const bindingFile = path.join(ctx.repo, '.github', 'toolkit-programme.json');
  fs.writeFileSync(bindingFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(bindingFile, 'utf8')), dependency_updates: { auto_merge: 'patch-minor', github_actions: 'owner' } }));
  recordMerged(ctx.repo, { registryPath: ctx.registryOptions.registryPath, commit: commitFixture(ctx.repo) });
  const state = governance.governanceState(ctx.repo, ctx.registryOptions);
  const protectedRead = () => ({ ok: true, default_branch: 'main', repository: { allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: false }, classic: null, toolkit_ruleset: null,
    rules: [{ type: 'pull_request', ruleset_id: 7, parameters: { allowed_merge_methods: ['merge'] } }, { type: 'required_status_checks', ruleset_id: 7, parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: 'validate', integration_id: 15368 }] } }] });
  for (const [label, extra] of [['allow auto-merge unreadable', { allow_auto_merge: 'unreadable' }], ['binding unreadable, so the policy is unknown', { allow_auto_merge: true, binding: { status: 'unreadable' } }]]) {
    finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
    assert.equal(await cli(ctx, [], [], { protectionReader: protectedRead, securityReader: () => ({ ...publicSecurity(ctx)(), ...extra }) }).run(), 2, label);
    const line = finishing.entryFor(ctx.registryOptions, state.repository_id).line;
    assert.match(line, /could not finish here yet \(the security settings could not be read back\)/, label);
    assert.doesNotMatch(line, /dependency auto-merge waits/, label);
  }
});

test('a write GitHub refuses for this account (forbidden) is held with the admin step, not retried', async t => {
  const ctx = governedRepo(t, { workflow: true });
  const state = governance.governanceState(ctx.repo, ctx.registryOptions);
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
  const run = cli(ctx, [], [], { rulesetCreator: () => ({ ok: false, reason: 'forbidden' }), protectionReader: unprotected,
    protectionWriter: () => ({ ok: false, reason: 'forbidden' }), securityReader: publicSecurity(ctx) });
  assert.equal(await run.run(), 0, run.out.join(''));
  const entry = finishing.entryFor(ctx.registryOptions, state.repository_id);
  assert.equal(entry.status, 'done');
  // GitHub settings steps for the admin role, then the agent asks again: never a command for the owner.
  assert.match(entry.line, /Waiting for you, the no-force-push ruleset: GitHub refused the write for the account this computer's GitHub sign-in uses \(forbidden\): that account needs admin rights on [^ ]+\. On GitHub, an admin of the repository gives it the Admin role under Settings, then Collaborators and teams \(Collaborators on a personal account\); then say refresh governance and answer yes again\./);
  assert.match(entry.line, /Waiting for you, default-branch protection: GitHub refused the write for the account this computer's GitHub sign-in uses \(forbidden\)/);
  assert.doesNotMatch(entry.line, /migrate|own terminal/);
});

test('a default branch that merges heads without its latest commit gets the Toolkit ruleset, which requires them up to date', async t => {
  const ctx = governedRepo(t, { workflow: true }), created = [], rulesets = [], wrote = [];
  const state = governance.governanceState(ctx.repo, ctx.registryOptions);
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
  // Another ruleset already requires the check, pinned, with merge commits only, but not up to date.
  const rules = [
    { type: 'pull_request', ruleset_id: 7, parameters: { allowed_merge_methods: ['merge'] } },
    { type: 'required_status_checks', ruleset_id: 7, parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'validate', integration_id: 15368 }] } },
  ];
  let own = null;
  const protectionReader = () => ({ ok: true, default_branch: 'main', repository: { allow_merge_commit: true, allow_squash_merge: false, allow_rebase_merge: false }, classic: null, toolkit_ruleset: own,
    rules: own ? [...rules, ...protection.protectionRulesetBody(['validate']).rules.map(rule => ({ ...rule, ruleset_id: own.id }))] : rules });
  const protectionWriter = (...args) => { wrote.push(args); own = { id: 9 }; return { ok: true, id: 9 }; };
  const run = cli(ctx, rulesets, created, { protectionReader, protectionWriter, securityReader: publicSecurity(ctx) });
  assert.equal(await run.run(), 0, run.out.join(''));
  assert.deepEqual(wrote.map(args => args.slice(0, 2)), [['example-owner/example-repo', ['validate']]]);
  assert.match(finishing.entryFor(ctx.registryOptions, state.repository_id).line, /On and read back: .*default-branch protection/);
});

test('a finish mark whose turn-on pull request closed without merging is cleared, never finished', async t => {
  const ctx = governedRepo(t), created = [];
  const state = governance.governanceState(ctx.repo, ctx.registryOptions);
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 12 });
  const asked = [];
  const closed = cli(ctx, [], created, { proposalTransport: { outcome: (repository, number) => { asked.push([repository, number]); return 'closed'; }, list: () => [] } });
  assert.equal(await closed.run(), 0);
  assert.deepEqual(asked, [['example-owner/example-repo', 12]]);
  assert.match(closed.out.join(''), /Nothing finished: the governance turn-on pull request #12 was closed without merging, so its post-merge setup was dropped\./);
  assert.deepEqual(created, [], 'no ruleset or setting is written');
  assert.equal(finishing.entryFor(ctx.registryOptions, state.repository_id), null, 'the mark is cleared');
  // A merged one finishes as before.
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 13 });
  const merged = cli(ctx, [], created, { proposalTransport: { outcome: () => 'merged', list: () => [] } });
  await merged.run();
  assert.deepEqual(created, ['no-force-push'], 'the merged turn-on is finished');
});

// Owner decision INT-TK421-1398: only the owner's yes to the exact change shown changes a repository's
// own ruleset. A turn-on's finish was never shown one, so it writes only Toolkit's own.
test('a turn-on finish never changes the repository\'s own ruleset, even where it allows squash and rebase', async t => {
  const ctx = governedRepo(t, { workflow: true }), created = [], rulesets = [], own = [];
  const state = governance.governanceState(ctx.repo, ctx.registryOptions);
  finishing.markPending(ctx.registryOptions, state.repository_id, { proposal: 1 });
  const ownRuleset = () => ({ ...unprotected(), rules: [{ type: 'pull_request', ruleset_id: 7, parameters: { allowed_merge_methods: ['merge', 'squash', 'rebase'] } }], rulesets: [{ id: 7, name: 'protect-main', source_type: 'Repository' }] });
  const toolkit = [];
  const run = cli(ctx, rulesets, created, { protectionReader: ownRuleset, protectionWriter: (...args) => { toolkit.push(args); return { ok: true, id: 9 }; }, ownRulesetWriter: (...args) => { own.push(args); return { ok: true }; }, securityReader: publicSecurity(ctx) });
  await run.run();
  assert.equal(toolkit.length, 1, 'the finish ran its protection step');
  assert.deepEqual(own, [], 'the repository\'s own ruleset is not written');
});
