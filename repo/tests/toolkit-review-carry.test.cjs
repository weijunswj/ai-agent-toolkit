'use strict';

// Scripted review carry in the merge train finder: a body-only FAIL carried forward, the shard-timing
// bot's refresh and a generated-sync change board without a fresh G2 only inside their exact checks,
// and a wording-only docs pull request may carry a high-effort G2 stamp. Every guard has a case that
// keeps the pull request off the train.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const train = require('../scripts/toolkit-merge-train.cjs');
const carry = require('../scripts/toolkit-review-carry.cjs');
const riskTier = require('../scripts/toolkit-risk-tier.cjs');
const { fixture } = require('./support/merge-train-fixture.cjs');

const sha = n => String(n).repeat(40).slice(0, 40);
const BASE = 'f'.repeat(40);
const G2_STAMP = 'Route: host-verified opus-5.5/xhigh pin=owner-claude/opus';
const G1_STAMP = 'Route: host-verified opus-5.5/high pin=owner-claude/BUILDER';
const green = [{ id: 1, name: 'validate', status: 'completed', conclusion: 'success' }];
const verdict = (head, { result = 'PASS', tier = 'NORMAL', route = G2_STAMP, extra = '' } = {}) => ({
  body: `Toolkit-G2: ${result} ${head} tier=${tier}\n${route}\n${extra}---\nReport: evidence/g2.md`, author_association: 'OWNER', created_at: '2026-11-15T00:01:00Z', html_url: `https://example.test/c/${head.slice(0, 4)}`,
});
const body = (uat = 'NOT_REQUIRED (internal)', bump = 'patch', more = '') => `Change.\n\n${G1_STAMP}\nBump: ${bump}\nUAT: ${uat}\n${more}`;
const pull = (number, extra = {}) => ({ number, draft: false, title: `Change ${number}`, user: { login: 'weijunswj', type: 'User' }, base: { ref: 'main', sha: BASE, repo: { full_name: 'example/repo' } }, head: { sha: sha(number), ref: `work-${number}`, repo: { full_name: 'example/repo' } }, body: body(), ...extra });

// One pull request's GitHub facts; `contents` maps "<ref>:<path>" to text.
function entry(number, { pull: over = {}, comments = [], checks = green, files = ['b.txt'], contents = {} } = {}) {
  return { pull: pull(number, over), comments, checks, files, contents };
}

function judge(t, entries) {
  const f = fixture(t);
  const live = path.join(f.root, 'facts.json');
  fs.writeFileSync(live, JSON.stringify({
    default_branch: 'main',
    pulls: entries.map(item => item.pull),
    comments: Object.fromEntries(entries.map(item => [item.pull.number, item.comments])),
    checks: Object.fromEntries(entries.map(item => [item.pull.head.sha, item.checks])),
    files: Object.fromEntries(entries.map(item => [item.pull.number, item.files])),
    merge_bases: Object.fromEntries(entries.map(item => [`main...${item.pull.head.sha}`, BASE])),
    contents: Object.assign({}, ...entries.map(item => item.contents)),
  }));
  const out = path.join(f.root, 'found.json');
  const result = train.run(['find', '--out', out, '--live', live], f.repo, f.opts);
  assert.equal(result.ok, true, JSON.stringify(result));
  const members = result.written ? JSON.parse(fs.readFileSync(out, 'utf8')).members : [];
  return { ready: result.ready, skipped: result.skipped.join('\n'), members };
}

// ---- body-only FAIL carried forward ----

const bodyOnly = (number, floor, over = {}) => entry(number, { comments: [verdict(sha(number), { result: 'FAIL', extra: `Carry: body-only uat=${floor}\n` })], ...over });

test('a body-only FAIL at the head boards once the body is fixed, keeping or tightening its UAT', t => {
  const { ready, skipped, members } = judge(t, [
    bodyOnly(1, 'NOT_REQUIRED'),
    bodyOnly(2, 'NOT_REQUIRED', { pull: { body: body('OWNER_TEST_NEEDED (try the new step)') } }),
  ]);
  assert.deepEqual(ready, ['#1', '#2'], skipped);
  assert.match(members[0].g2, /^body-only FAIL carried forward: https:\/\/example\.test\/c\//);
});

test('a body-only carry refuses a weaker UAT, a footer, red checks, a FAIL without the line and a second Carry line', t => {
  const footer = ['\n\n', String.fromCodePoint(0x1F916), ' Generated with [Claude Code](https://claude.com/claude-code)'].join('');
  const { ready, skipped } = judge(t, [
    bodyOnly(1, 'OWNER_TEST_NEEDED'),
    bodyOnly(2, 'OWNER_TEST_NEEDED', { pull: { body: body('PASSED (owner said it works)') } }),
    bodyOnly(3, 'NOT_REQUIRED', { pull: { body: `${body()}${footer}` } }),
    bodyOnly(4, 'NOT_REQUIRED', { checks: [{ id: 1, name: 'validate', status: 'completed', conclusion: 'failure' }] }),
    entry(5, { comments: [verdict(sha(5), { result: 'FAIL' })] }),
    entry(6, { comments: [verdict(sha(6), { result: 'FAIL', extra: 'Carry: body-only uat=NOT_REQUIRED\nCarry: body-only uat=NOT_REQUIRED\n' })] }),
    entry(7, { comments: [verdict(sha(9), { result: 'FAIL', extra: 'Carry: body-only uat=NOT_REQUIRED\n' })] }),
  ]);
  assert.deepEqual(ready, []);
  assert.match(skipped, /#1: its body-only FAIL named UAT OWNER_TEST_NEEDED; the body now says NOT_REQUIRED/);
  assert.match(skipped, /#2: its body-only FAIL named UAT OWNER_TEST_NEEDED; the body now says PASSED/);
  assert.match(skipped, /#3: its title or body has text the personal-data guard reports \(PDG-AI-FOOTER\)/);
  assert.match(skipped, /#4: required checks not green: validate/);
  assert.match(skipped, /#5: its newest verdict for 555555555555 is FAIL/);
  assert.match(skipped, /#6: its newest verdict for 666666666666 is FAIL/);
  assert.match(skipped, /#7: no review verdict comment for its head 777777777777/, 'a carry for another head counts for nothing');
});

test('a body-only carry still needs its G2 route stamp on the pin', t => {
  const { ready, skipped } = judge(t, [entry(1, { comments: [verdict(sha(1), { result: 'FAIL', route: 'Route: host-verified opus-5.5/medium pin=owner-claude/opus', extra: 'Carry: body-only uat=NOT_REQUIRED\n' })] })]);
  assert.deepEqual(ready, []);
  assert.match(skipped, /#1: its G2 route stamp is off the stack-registry pin/);
});

// ---- shard-timing refresh ----

const MANIFEST = 'repo/contracts/ci/test-shards.json';
const manifest = (linux, durations = { 'repo/tests/a.test.cjs': 4 }, budget = 120) => JSON.stringify({
  schema: 'toolkit-test-shards/v1',
  systems: { linux: { shards: [{ id: 'linux-1', files: linux }, { id: 'linux-2', rest: true }] } },
  budgets: { seconds_per_file: { linux: budget } },
  durations_seconds: { linux: durations },
});
const BOT = { login: 'toolkit-governance[bot]', type: 'Bot' };
const refresh = (number, after, over = {}) => entry(number, {
  pull: { user: BOT, head: { sha: sha(number), ref: `toolkit/shard-timings-${String(number).repeat(7)}`, repo: { full_name: 'example/repo' } }, body: body('NOT_REQUIRED (manifest-only redistribution)', 'none'), ...(over.pull || {}) },
  files: over.files || [MANIFEST],
  contents: { [`${BASE}:${MANIFEST}`]: manifest(['repo/tests/a.test.cjs', 'repo/tests/b.test.cjs']), [`${sha(number)}:${MANIFEST}`]: after, ...(over.contents || {}) },
});

test("the shard-timing bot refresh boards with no verdict when it only moves files and times, rebalance included", t => {
  const restless = JSON.stringify({ ...JSON.parse(manifest(['repo/tests/a.test.cjs'])), systems: { linux: { shards: [{ id: 'linux-1', files: ['repo/tests/a.test.cjs'] }, { id: 'linux-2', files: ['repo/tests/b.test.cjs'] }] } } });
  const { ready, skipped } = judge(t, [
    refresh(1, manifest(['repo/tests/b.test.cjs', 'repo/tests/a.test.cjs'], { 'repo/tests/a.test.cjs': 9 })),
    refresh(2, manifest(['repo/tests/a.test.cjs'], { 'repo/tests/a.test.cjs': 9 })),
    refresh(3, manifest(['repo/tests/a.test.cjs', 'repo/tests/b.test.cjs', 'repo/tests/c.test.cjs'])),
    refresh(4, restless),
  ]);
  assert.deepEqual(ready, ['#1', '#2', '#3'], skipped);
  assert.match(skipped, /#4: no review verdict comment .*, and no scripted carry: it changes more than measured times and which shard runs which file/, 'the rest shard turned into a named one');
});

test('a shard refresh is refused for a budget change, another file, a human author, another branch or a fork', t => {
  const fork = { sha: sha(5), ref: 'toolkit/shard-timings-5555555', repo: { full_name: 'someone/repo' } };
  const { ready, skipped } = judge(t, [
    refresh(1, manifest(['repo/tests/a.test.cjs', 'repo/tests/b.test.cjs'], undefined, 600)),
    refresh(2, manifest(['repo/tests/a.test.cjs', 'repo/tests/b.test.cjs']), { files: [MANIFEST, 'repo/tests/a.test.cjs'] }),
    refresh(3, manifest(['repo/tests/a.test.cjs', 'repo/tests/b.test.cjs']), { pull: { user: { login: 'weijunswj', type: 'User' } } }),
    refresh(4, manifest(['repo/tests/a.test.cjs', 'repo/tests/b.test.cjs']), { pull: { head: { sha: sha(4), ref: 'toolkit/shard-timing-4', repo: { full_name: 'example/repo' } } } }),
    refresh(5, manifest(['repo/tests/a.test.cjs', 'repo/tests/b.test.cjs']), { pull: { head: fork } }),
    refresh(6, '{ not json'),
  ]);
  assert.deepEqual(ready, []);
  assert.match(skipped, /#1: .*it changes more than measured times/);
  assert.match(skipped, /#2: .*it changes more than the shard manifest/);
  assert.match(skipped, /#3: .*not opened by a bot account/);
  assert.match(skipped, /#4: no review verdict comment for its head 444444444444$/m, 'not a refresh branch: an ordinary pull request with no verdict');
  assert.match(skipped, /#5: .*its branch is not in this repository/);
  assert.match(skipped, /#6: .*does not read as JSON/);
});

test("a FAIL verdict on a shard refresh keeps it off, and a carried member never gets the owner's OK", t => {
  const good = manifest(['repo/tests/b.test.cjs', 'repo/tests/a.test.cjs']);
  const failed = refresh(1, good);
  failed.comments = [verdict(sha(1), { result: 'FAIL' })];
  const { ready, skipped, members } = judge(t, [failed, refresh(2, good), refresh(3, good)]);
  assert.deepEqual(ready, ['#2', '#3']);
  assert.match(skipped, /#1: its newest verdict for 111111111111 is FAIL/);
  // The fixture's built-in risk list makes the manifest NORMAL; this repository's own list makes it
  // RISKY, so here the owner still taps the merge card (the finder never fills owner_ok).
  assert.deepEqual(members.map(member => [member.tier, member.g2]), [['NORMAL', 'scripted carry (shard-timings), no G2'], ['NORMAL', 'scripted carry (shard-timings), no G2']]);
  assert.equal(members.some(member => member.owner_ok), false);
  const own = riskTier.loadConfig(path.join(__dirname, '..', '..')).config;
  for (const file of [MANIFEST, 'AGENTS.md', 'README.md']) assert.equal(riskTier.classify([{ path: file }], own).tier, file === 'README.md' ? 'LIGHT' : 'RISKY', file);
});

// ---- generated-sync ----

const block = (body, version = '1.0.0') => `<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/toolkit-governed-rules.md:BEGIN TOOLKIT-GOVERNED-RULES v2 toolkit=${version} sha256=000000000000 -->\n${body}\n<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/toolkit-governed-rules.md:END TOOLKIT-GOVERNED-RULES -->`;
const agents = (inner, rest = 'Hand-written rules.') => `# AI Agent Toolkit Repo Rules\n\n${block(inner)}\n\n${rest}\n`;
// The Toolkit's own CI: the Validate workflow runs both syncs' --check, at the merge base and the head.
const SYNC_CI = ref => ({
  [`${ref}:.github/workflows/validate.yml`]: 'jobs:\n  gate:\n    steps:\n      - run: |\n          node repo/scripts/sync-repo-doc-contract.cjs --check\n          node repo/scripts/sync-agent-instruction-shims.cjs --check\n',
  [`${ref}:repo/scripts/sync-repo-doc-contract.cjs`]: "'use strict';\n",
  [`${ref}:repo/scripts/sync-agent-instruction-shims.cjs`]: "'use strict';\n",
});
const sync = (number, files, contents, { ci = true, pull: over = {} } = {}) => entry(number, { files, pull: over, contents: {
  ...(ci ? { ...SYNC_CI(BASE), ...SYNC_CI(sha(number)) } : {}),
  ...Object.fromEntries(Object.entries(contents).map(([key, value]) => [key.replace('HEAD', sha(number)), value])),
} });

test('a generated-sync change boards when only managed blocks and whole projected files change', t => {
  const { ready, skipped } = judge(t, [
    sync(1, ['AGENTS.md', 'CLAUDE.md', 'skills/n8n-safety-router/n8n-safety-rules.md'], { [`${BASE}:AGENTS.md`]: agents('old'), 'HEAD:AGENTS.md': agents('new') }),
  ]);
  assert.deepEqual(ready, ['#1'], skipped);
});

test('a generated-sync change is refused for hand-written edits, a source file, broken markers or a missing block', t => {
  const { ready, skipped } = judge(t, [
    sync(1, ['AGENTS.md'], { [`${BASE}:AGENTS.md`]: agents('old'), 'HEAD:AGENTS.md': agents('new', 'Edited by hand.') }),
    sync(2, ['AGENTS.md', 'repo/contracts/agent-rules/toolkit-governed-rules.md'], { [`${BASE}:AGENTS.md`]: agents('old'), 'HEAD:AGENTS.md': agents('new') }),
    sync(3, ['AGENTS.md'], { [`${BASE}:AGENTS.md`]: agents('old'), 'HEAD:AGENTS.md': agents('new').replace(/<!-- AI-AGENT-TOOLKIT:[^\n]*:END[^\n]*-->/, '') }),
    sync(4, ['AGENTS.md'], { [`${BASE}:AGENTS.md`]: agents('old'), 'HEAD:AGENTS.md': '# AI Agent Toolkit Repo Rules\n\nHand-written rules.\n' }),
    sync(5, ['repo/contracts/agent-rules/repo-local/antigravity-bootstrap.template.md'], {}),
  ]);
  assert.deepEqual(ready, []);
  assert.match(skipped, /#1: .*AGENTS\.md changes outside its managed blocks/);
  assert.match(skipped, /#2: no review verdict comment for its head 222222222222$/m, 'a source file in the change: an ordinary pull request');
  assert.match(skipped, /#3: .*AGENTS\.md has broken or missing managed blocks/);
  assert.match(skipped, /#4: .*AGENTS\.md has broken or missing managed blocks/);
  assert.match(skipped, /#5: no review verdict comment for its head 555555555555$/m, 'a shim template whose block body is a source');
});

test('the sync outputs the carry trusts are exactly the files the two syncs write', () => {
  assert.deepEqual([...carry.OUTPUTS.keys()].sort(), [
    '.agents/rules/00-agent-toolkit-bootstrap.md', 'AGENTS.md', 'CLAUDE.md', 'README.md',
    'repo/contracts/agent-rules/repo-local/AGENTS.managed.template.md',
    'skills/n8n-environment-setup/references/n8n-safety-rules.md', 'skills/n8n-safety-router/adapters/AGENTS.n8n-brief.template.md',
    'skills/n8n-safety-router/n8n-safety-rules.md', 'skills/n8n-workflow-transport/references/n8n-safety-rules.md',
    'skills/repository-agent-rules/repo-local/AGENTS.managed.template.md', 'skills/repository-agent-rules/repo-local/CLAUDE.shim.template.md',
    'skills/repository-agent-rules/repo-local/antigravity-bootstrap.template.md',
  ]);
  assert.deepEqual(carry.OUTPUTS.get('AGENTS.md'), ['TOOLKIT-GOVERNED-RULES']);
  assert.deepEqual(carry.OUTPUTS.get('README.md'), ['SOURCE-OF-TRUTH-CONTRACT']);
});

// ---- wording-only docs: one G2 at high ----

test('a high-effort G2 stamp boards only a pull request of LIGHT .md files', t => {
  const high = 'Route: host-verified opus-5.5/high pin=owner-claude/opus';
  const { ready, skipped } = judge(t, [
    entry(1, { comments: [verdict(sha(1), { route: high })], files: ['repo/docs/guide.md', 'skills/x/README.md'] }),
    entry(2, { comments: [verdict(sha(2), { route: high })], files: ['repo/docs/guide.md', 'b.txt'] }),
    entry(3, { comments: [verdict(sha(3), { route: high })], files: ['AGENTS.md'] }),
    entry(4, { comments: [verdict(sha(4), { route: 'Route: host-verified opus-5.5/medium pin=owner-claude/opus' })], files: ['repo/docs/guide.md'] }),
  ]);
  assert.deepEqual(ready, ['#1'], skipped);
  assert.match(skipped, /#2: its G2 route stamp is off the stack-registry pin/);
  assert.match(skipped, /#3: its G2 route stamp is off the stack-registry pin/);
  assert.match(skipped, /#4: its G2 route stamp is off the stack-registry pin/);
});

test("a generated-sync change in a repository whose CI does not run the syncs' --check needs a G2", t => {
  const changes = { [`${BASE}:AGENTS.md`]: agents('old'), 'HEAD:AGENTS.md': agents('anything at all') };
  // No entry here gives the shared merge base its CI files, so only the head's can be there.
  const headOnly = number => Object.fromEntries(Object.entries(SYNC_CI(sha(number))));
  const none = judge(t, [
    sync(1, ['CLAUDE.md'], {}, { ci: false }),
    sync(2, ['AGENTS.md'], changes, { ci: false }),
    sync(3, ['AGENTS.md'], { ...changes, ...headOnly(3) }, { ci: false }),
  ]);
  assert.deepEqual(none.ready, []);
  for (const number of [1, 2, 3]) assert.match(none.skipped, new RegExp(`#${number}: .*CI here does not run repo/scripts/sync-repo-doc-contract\\.cjs --check and repo/scripts/sync-agent-instruction-shims\\.cjs --check`), none.skipped);
  const head = judge(t, [
    sync(4, ['AGENTS.md'], { ...changes, 'HEAD:.github/workflows/validate.yml': 'jobs: {}\n' }),
    sync(5, ['AGENTS.md'], { ...changes, 'HEAD:repo/scripts/sync-agent-instruction-shims.cjs': null }),
  ]);
  assert.deepEqual(head.ready, []);
  assert.match(head.skipped, /#4: .*CI here does not run repo\/scripts\/sync-repo-doc-contract\.cjs --check and /);
  assert.match(head.skipped, /#5: .*CI here does not run repo\/scripts\/sync-agent-instruction-shims\.cjs --check, so nothing proves/);
});

// ---- each guard on a carried path keeps the pull request off on its own ----

test('a scripted carry still needs a clean title and body and an on-pin G1 stamp', t => {
  const good = manifest(['repo/tests/b.test.cjs', 'repo/tests/a.test.cjs']);
  const session = ['https://claude', 'ai/code/session_abc'].join('.');
  const footer = ['\n\n', String.fromCodePoint(0x1F916), ' Generated with [Claude Code](https://claude.com/claude-code)'].join('');
  const { ready, skipped } = judge(t, [
    refresh(1, good, { pull: { body: `${body('NOT_REQUIRED (manifest-only redistribution)', 'none')}${footer}` } }),
    refresh(2, good, { pull: { title: `Refresh shard timings (${session})` } }),
    refresh(3, good, { pull: { body: body('NOT_REQUIRED (manifest-only redistribution)', 'none').replace(G1_STAMP, 'Route: host-verified opus-5.5/medium pin=owner-claude/BUILDER') } }),
    sync(4, ['CLAUDE.md'], {}, { pull: { title: `Sync (${session})` } }),
    sync(5, ['CLAUDE.md'], {}),
  ]);
  assert.deepEqual(ready, ['#5'], skipped);
  assert.match(skipped, /#1: its title or body has text the personal-data guard reports \(PDG-AI-FOOTER\)/);
  assert.match(skipped, /#2: its title or body has text the personal-data guard reports \(PDG-AI-SESSION-LINK\)/);
  assert.match(skipped, /#3: its G1 route stamp is off the stack-registry pin/);
  assert.match(skipped, /#4: its title or body has text the personal-data guard reports \(PDG-AI-SESSION-LINK\)/);
});

test('a body-only carry takes the higher of its verdict tier and the risk list, and checks the title', t => {
  const session = ['https://claude', 'ai/code/session_abc'].join('.');
  const { ready, skipped, members } = judge(t, [
    bodyOnly(1, 'NOT_REQUIRED', { files: ['.github/workflows/ci.yml'] }),
    bodyOnly(2, 'NOT_REQUIRED'),
    bodyOnly(3, 'NOT_REQUIRED', { pull: { title: `Fix (${session})` } }),
  ]);
  assert.deepEqual(ready, ['#1', '#2'], skipped);
  assert.deepEqual(members.map(member => member.tier), ['RISKY', 'NORMAL'], 'the verdict said NORMAL; the workflow file is RISKY');
  assert.match(skipped, /#3: its title or body has text the personal-data guard reports \(PDG-AI-SESSION-LINK\)/);
});
