'use strict';

// The "Toolkit: keep programme state" ruleset: its body and verdict, and `toolkit governance migrate`
// offering it, after its own typed yes, only for a repository whose merged binding keeps programme
// state on the public state branch. A private repository on GitHub Free reports not-enforceable.

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { recordMerged } = require('./toolkit-governed-fixture-support.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const scripts = path.join(repoRoot, 'repo', 'scripts');
const { ToolkitGovernanceCli } = require(path.join(scripts, 'toolkit-governance.cjs'));
const ruleset = require(path.join(scripts, 'toolkit-governance-ruleset.cjs'));
const managedBlock = require(path.join(scripts, 'toolkit-managed-block.cjs'));
const programmeState = require(path.join(repoRoot, 'skills', 'github-program-reconciler', 'scripts', 'programme-state.cjs'));

const STORE = { kind: 'github', repository: 'example-owner/example-store', branch: 'main', path: 'state/example-owner/' };

test('the keep-state ruleset covers only the state branch, blocks deletion and has no bypass', () => {
  const body = ruleset.keepStateRulesetBody();
  assert.equal(ruleset.STATE_BRANCH, programmeState.STATE_BRANCH);
  assert.deepEqual(body.conditions.ref_name, { include: [`refs/heads/${programmeState.STATE_BRANCH}`], exclude: [] });
  assert.deepEqual(body.rules, [{ type: 'deletion' }]);
  assert.deepEqual(body.bypass_actors, []);
  assert.equal(ruleset.keepStateVerdict([body]).status, 'present');
  assert.equal(ruleset.keepStateVerdict([{ ...body, enforcement: 'evaluate' }]).status, 'missing');
  assert.equal(ruleset.keepStateVerdict([{ ...body, rules: [{ type: 'non_fast_forward' }] }]).status, 'missing');
  assert.equal(ruleset.keepStateVerdict([{ ...body, conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } } }]).status, 'missing');
  assert.equal(ruleset.keepStateVerdict([ruleset.noForcePushRulesetBody()]).status, 'missing', 'the no-force-push ruleset does not stop a deletion');
  assert.equal(ruleset.rulesetVerdict([body]).status, 'missing', 'and this one is not the no-force-push ruleset');
});

function governedRepo(t, { state }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-state-ruleset-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projects = path.join(root, 'projects');
  const repo = path.join(projects, 'example-repo');
  fs.mkdirSync(repo, { recursive: true });
  childProcess.execFileSync('git', ['init', '--quiet', repo], { windowsHide: true });
  childProcess.execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/example-owner/example-repo.git'], { windowsHide: true });
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), `${managedBlock.renderBlock({ source: 'repo/contracts/agent-rules/toolkit-governed-rules.md', name: 'TOOLKIT-GOVERNED-RULES', version: '1.0.0', body: '# Rules' })}\n`);
  fs.mkdirSync(path.join(repo, '.github'));
  fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), JSON.stringify({
    schema: 'toolkit.programme-binding.v2', repository: 'example-owner/example-repo', governance: 'enabled', parents: [{ issue: 3, record_prefix: 'INT-A-' }],
    store: STORE, required_checks: ['validate'], ...(state ? { state: { kind: 'branch', branch: programmeState.STATE_BRANCH, path: 'state/' } } : {}),
  }));
  const registryPath = path.join(root, 'state', 'repository-governance.v1.json');
  recordMerged(repo, { registryPath });
  return { projects, registryPath };
}

// Every question is answered yes, except the keep-state one, which gets `keepState`.
async function migrate(ctx, { keepState = 'yes', rulesets, created, readerReason = null }) {
  const asked = [];
  const out = [];
  const cli = new ToolkitGovernanceCli({
    stdout: { write: text => { out.push(String(text)); return true; } }, stderr: { write: () => true }, interactive: true, cwd: ctx.projects,
    ask: async question => { asked.push(question); return question.includes(ruleset.KEEP_STATE_RULESET_NAME) ? keepState : 'yes'; },
    registryOptions: { registryPath: ctx.registryPath, testOnly: true },
    rulesetReader: slug => (readerReason ? { ok: false, reason: readerReason } : { ok: true, rulesets: rulesets[slug] || [] }),
    rulesetCreator: slug => { (rulesets[slug] ||= []).push(ruleset.noForcePushRulesetBody()); return { ok: true, id: 1 }; },
    stateRulesetCreator: slug => { created.push(slug); (rulesets[slug] ||= []).push(ruleset.keepStateRulesetBody()); return { ok: true, id: 2 }; },
    protectionReader: () => ({ ok: false, reason: 'gh-unavailable' }),
    securityReader: () => ({ ok: false, reason: 'gh-unavailable' }),
  });
  const code = await cli.main(['migrate', '--root', ctx.projects]);
  return { code, asked, out: out.join('') };
}

test('migrate offers the keep-state ruleset only after its own typed yes, and only with the state branch in the merged binding', async (t) => {
  const withState = governedRepo(t, { state: true });
  const rulesets = {};
  const created = [];
  const declined = await migrate(withState, { keepState: 'no', rulesets, created });
  assert.ok(declined.asked.some(question => question.includes(ruleset.KEEP_STATE_RULESET_NAME)), declined.asked.join('\n'));
  assert.deepEqual(created, [], 'no without its own yes');
  assert.match(declined.out, /Programme state rulesets not added/);
  const accepted = await migrate(withState, { rulesets, created });
  assert.deepEqual(created, ['example-owner/example-repo']);
  assert.match(accepted.out, /programme state ruleset added and read back/);
  const again = await migrate(withState, { rulesets, created });
  assert.equal(again.asked.some(question => question.includes(ruleset.KEEP_STATE_RULESET_NAME)), false, 'present: not offered again');

  const without = governedRepo(t, { state: false });
  const plain = await migrate(without, { rulesets: {}, created: [] });
  assert.equal(plain.asked.some(question => question.includes(ruleset.KEEP_STATE_RULESET_NAME)), false, 'no state branch: never offered');

  const free = governedRepo(t, { state: true });
  const notEnforceable = await migrate(free, { rulesets: {}, created: [], readerReason: 'plan-has-no-rulesets' });
  assert.match(notEnforceable.out, /cannot enforce a ruleset that keeps the programme state branch/);
  assert.equal(notEnforceable.asked.some(question => question.includes(ruleset.KEEP_STATE_RULESET_NAME)), false);
});
