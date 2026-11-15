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
const { recordMerged } = require('./toolkit-governed-fixture-support.cjs');

const scripts = path.resolve(__dirname, '..', 'scripts');
const { ToolkitGovernanceCli } = require(path.join(scripts, 'toolkit-governance.cjs'));
const finishing = require(path.join(scripts, 'toolkit-governance-finish.cjs'));
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));
const ruleset = require(path.join(scripts, 'toolkit-governance-ruleset.cjs'));
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
  if (merged) recordMerged(repo, { registryPath: registryOptions.registryPath });
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
  assert.match(finishing.entryFor(ctx.registryOptions, state.repository_id).line, /It also wrote \.github\/dependabot\.yml in this working tree; commit it through a pull request\./);
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
  assert.match(entry.line, /finished here, apart from what waits for you below\. On and read back: the no-force-push ruleset and the free dependency and security settings\./);
  assert.match(entry.line, /Waiting for you, default-branch protection: the programme file lists no required checks yet.*required_checks in \.github\/toolkit-programme\.json through a pull request, merge it, then run `node ".*toolkit-governance\.cjs" migrate` in your own terminal to add the protection\./);
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
  assert.match(entry.line, /Waiting for you, default-branch protection: change by hand: .*validate.*then run `node ".*toolkit-governance\.cjs" migrate` in your own terminal to check it again\./);
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
  recordMerged(ctx.repo, { registryPath: ctx.registryOptions.registryPath });
  const lines = finishing.sessionLines(governance.governanceState(ctx.repo, ctx.registryOptions), ctx.registryOptions, { startFinish: () => {} });
  assert.doesNotMatch(lines.join(' '), /stopped without a result/);
  assert.match(lines.join(' '), /finishing its setup in the background/);
});
