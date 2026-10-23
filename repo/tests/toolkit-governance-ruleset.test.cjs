'use strict';

// The no-force-push branch ruleset check (#542): which rulesets count, how `gh api` answers map to
// present, missing, not-enforceable (GitHub Free private repository) and unverified, and that a
// non-GitHub repository is not applicable. Closure rows NF-01 to NF-04.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ruleset = require(path.join(__dirname, '..', 'scripts', 'toolkit-governance-ruleset.cjs'));

function protectedRuleset(overrides = {}) {
  return {
    id: 1, enforcement: 'active', target: 'branch',
    conditions: { ref_name: { include: ['~ALL'], exclude: [] } },
    rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }],
    bypass_actors: [],
    ...overrides,
  };
}

function repoWithRemote(t, remote) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-ruleset-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, '.git', 'config'), `[remote "origin"]\n\turl = ${remote}\n`);
  return root;
}

// A spawnSync stand-in answering `gh api <endpoint>` from a table.
function fakeGh(answers, calls = []) {
  return (command, args) => {
    calls.push(args.join(' '));
    const endpoint = args[1];
    const answer = Object.entries(answers).find(([prefix]) => endpoint.startsWith(prefix));
    if (!answer) return { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
    return typeof answer[1] === 'function' ? answer[1]() : { status: 0, stdout: JSON.stringify(answer[1]), stderr: '' };
  };
}

test('NF-01: only an active all-branch non_fast_forward ruleset counts', () => {
  assert.equal(ruleset.rulesetVerdict([protectedRuleset()]).status, 'present');
  assert.equal(ruleset.rulesetVerdict([protectedRuleset()]).bypass, 'none');
  for (const broken of [
    { enforcement: 'disabled' },
    { enforcement: 'evaluate' },
    { target: 'tag' },
    { conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } } },
    { conditions: { ref_name: { include: ['~ALL'], exclude: ['refs/heads/scratch/*'] } } },
    { rules: [{ type: 'deletion' }] },
  ]) assert.equal(ruleset.rulesetVerdict([protectedRuleset(broken)]).status, 'missing', JSON.stringify(broken));
  assert.equal(ruleset.rulesetVerdict([]).status, 'missing');
  assert.equal(ruleset.rulesetVerdict([protectedRuleset({ bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }] })]).bypass, 'allowed');
  const { bypass_actors: _hidden, ...noBypassField } = protectedRuleset();
  assert.equal(ruleset.rulesetVerdict([noBypassField]).bypass, 'not-visible');
});

test('NF-02: the gh reader lists branch rulesets, then reads each by id', () => {
  const calls = [];
  const spawn = fakeGh({
    'repos/example-owner/example-repo/rulesets?': [{ id: 11 }, { id: 12 }],
    'repos/example-owner/example-repo/rulesets/11': protectedRuleset({ id: 11, target: 'tag' }),
    'repos/example-owner/example-repo/rulesets/12': protectedRuleset({ id: 12 }),
  }, calls);
  const read = ruleset.ghRulesetReader('example-owner/example-repo', { spawn });
  assert.equal(read.ok, true);
  assert.equal(ruleset.rulesetVerdict(read.rulesets).status, 'present');
  assert.match(calls[0], /^api repos\/example-owner\/example-repo\/rulesets\?includes_parents=true&targets=branch&per_page=100$/);
  assert.equal(calls.length, 3);
});

test('NF-03: GitHub Free private repositories are not enforceable; other failures are unverified', (t) => {
  const root = repoWithRemote(t, 'https://github.com/example-owner/example-repo.git');
  const plan = () => ({ status: 1, stdout: '{"message":"Upgrade to GitHub Pro or make this repository public to enable this feature."}', stderr: 'gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)' });
  const viaGh = (spawn) => ruleset.noForcePushRuleset(root, { reader: (slug) => ruleset.ghRulesetReader(slug, { spawn }) });
  assert.deepEqual({ ...viaGh(fakeGh({ 'repos/': plan })) }, { status: 'not-enforceable', reason: 'plan-has-no-rulesets', bypass: null });
  assert.equal(viaGh(fakeGh({ 'repos/': () => ({ status: 1, stdout: '', stderr: 'gh: Resource not accessible (HTTP 403)' }) })).status, 'unverified');
  assert.equal(viaGh(fakeGh({})).reason, 'repository-not-visible');
  assert.equal(viaGh(() => { throw new Error('ENOENT'); }).reason, 'gh-unavailable');
  assert.equal(viaGh(fakeGh({ 'repos/': () => ({ status: 0, stdout: 'not json', stderr: '' }) })).reason, 'gh-output-invalid');
  assert.equal(ruleset.noForcePushRuleset(root, { reader: () => { throw new Error('boom'); } }).status, 'unverified');
  assert.equal(ruleset.noForcePushRuleset(root, { reader: () => ({ ok: true, rulesets: [] }) }).status, 'missing');
});

test('NF-04: repositories not on github.com are not applicable and GitHub is never asked', (t) => {
  for (const remote of ['https://gitlab.com/group/sub/project.git', 'git@bitbucket.org:team/repo.git', 'https://github.com/only-one-segment']) {
    const root = repoWithRemote(t, remote);
    let asked = false;
    const result = ruleset.noForcePushRuleset(root, { reader: () => { asked = true; return { ok: true, rulesets: [] }; } });
    assert.equal(result.status, 'not-applicable', remote);
    assert.equal(asked, false);
  }
});
