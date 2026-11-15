'use strict';

// The post-merge finish of a governance turn-on from the question bank: `toolkit governance finish`
// acts only on a repository the bank noted as finish pending, once its enabled binding is merged;
// it asks nothing, and it is done only when GitHub reads every setting back. The session line shows
// the result once.

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

function governedRepo(t, { merged = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-finish-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, 'example-repo');
  fs.mkdirSync(repo, { recursive: true });
  childProcess.execFileSync('git', ['init', '--quiet', repo], { windowsHide: true });
  childProcess.execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/example-owner/example-repo.git'], { windowsHide: true });
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), `${managedBlock.renderBlock({ source: 'repo/contracts/agent-rules/toolkit-governed-rules.md', name: 'TOOLKIT-GOVERNED-RULES', version: '1.0.0', body: '# Rules' })}\n`);
  fs.mkdirSync(path.join(repo, '.github'));
  fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), JSON.stringify({
    schema: 'toolkit.programme-binding.v2', repository: 'example-owner/example-repo', governance: 'enabled', parents: [{ issue: 3, record_prefix: 'INT-A-' }],
    store: { kind: 'github', repository: 'example-owner/example-store', branch: 'main', path: 'state/' }, required_checks: ['validate'],
  }));
  const registryOptions = { registryPath: path.join(root, 'state', 'repository-governance.v1.json'), testOnly: true };
  if (merged) recordMerged(repo, { registryPath: registryOptions.registryPath });
  return { repo, registryOptions };
}

function cli(ctx, rulesets, created) {
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
  assert.match(entry.line, /could not finish here yet \(.*default-branch protection is not read back as set; the security settings could not be read back\)/);
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
  finishing.record(ctx.registryOptions, state.repository_id, 'done', []);
  const started = [];
  const deps = { startFinish: root => started.push(root) };
  assert.match(finishing.sessionLines(state, ctx.registryOptions, deps).join(' '), /governance setup finished here: default-branch protection/);
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
  // A start an hour ago that never recorded a result: the next session starts it again and says why.
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
  finishing.record(ctx.registryOptions, state.repository_id, 'done', [], { files: ['.github/dependabot.yml'] });
  assert.match(finishing.entryFor(ctx.registryOptions, state.repository_id).line, /It also wrote \.github\/dependabot\.yml in this working tree; commit it through a pull request\./);
});
