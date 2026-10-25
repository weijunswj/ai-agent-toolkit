'use strict';
require('./toolkit-test-temp-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const plain = require('../scripts/check-plain-references.cjs');
const check = require('../../skills/secure-ci-cd/scripts/plain-text-check.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'repo', 'scripts', 'check-plain-references.cjs');
const BASELINE = 'toolkit-plain-references-baseline/v1';
// Built from pieces so this test file stays a plain example of what it checks.
const HASH = '#';
const GITHUB = 'https://' + 'github.com/example-owner/example-repo';

function fixture(t, files, allowed = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-plain-references-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  fs.mkdirSync(path.dirname(path.join(root, plain.BASELINE_REL)), { recursive: true });
  fs.writeFileSync(path.join(root, plain.BASELINE_REL), JSON.stringify({ schema: BASELINE, allowed }));
  return root;
}

const rules = text => plain.findReferences(text).map(finding => [finding.rule, finding.text]);

test('flags GitHub issue, pull request, discussion, commit and compare links', () => {
  for (const kind of ['issues/12', 'pull/34', 'discussions/5', 'commit/abc1234', 'compare/main...topic']) {
    assert.deepEqual(rules(`See [it](${GITHUB}/${kind}).`).map(([rule]) => rule).filter(rule => rule === 'github-link'), ['github-link'], kind);
  }
  assert.deepEqual(rules(`See ${GITHUB}/issues/7${HASH}issuecomment-99`)[0], ['github-link', `${GITHUB}/issues/7${HASH}issuecomment-99`]);
});

test('allows repository file links, blob links and plain GitHub repository links', () => {
  assert.deepEqual(rules('Read [the rules](repo/contracts/agent-rules/global-rules.md).'), []);
  assert.deepEqual(rules(`Read ${GITHUB}/blob/main/README.md and ${GITHUB}/tree/main/skills.`), []);
  assert.deepEqual(rules(`Install from ${GITHUB}.`), []);
});

test('flags number references and pull request labels, not entities, anchors or colours', () => {
  assert.deepEqual(rules(`Fixed in ${HASH}542 (see ${HASH}12).`), [['number-reference', `${HASH}542`], ['number-reference', `${HASH}12`]]);
  assert.deepEqual(rules(`Use \`${HASH}421\` here.`), [['number-reference', `${HASH}421`]]);
  assert.deepEqual(rules('Legacy PR 237 block and pull request 9 and issue 4.'), [
    ['pr-number-label', 'PR 237'], ['pr-number-label', 'pull request 9'], ['pr-number-label', 'issue 4']]);
  assert.deepEqual(rules(`a&${HASH}64;b, page${HASH}1, ${HASH}${HASH}2 heading, colour "${HASH}334155", ${HASH}12abc, ${HASH}L10`), []);
  assert.deepEqual(rules('Two issues to fix, PR checks, version 3.9.1.'), []);
  assert.deepEqual(rules(`See [setup](${HASH}1-install) and [the list](${HASH}12-steps).`), []);
  for (const line of [`Background: the design came from ${HASH}461.`, `Fill in the form described in ${HASH}613.`,
    `The CSS refactor landed in ${HASH}1234.`, `Fixed in ${HASH}12-15.`, `Use colour ${HASH}333 for the border.`,
    `Covers ${HASH}461-and-later.`, `The ${HASH}600-series fixes.`, `See ${HASH}461-era notes.`, `Old link (${HASH}461-era notes) here.`]) {
    assert.equal(rules(line).filter(([rule]) => rule === 'number-reference').length, 1, line);
  }
  assert.deepEqual(rules(`Use colour ${HASH}333 here <!-- plain-text: allow a colour value -->`), []);
  assert.deepEqual(rules(`Odd ${HASH}42 here <!-- plain-text: allow a score, not a reference -->`), []);
  for (const reason of ['', 'x', 'ok fine']) {
    assert.deepEqual(rules(`Odd ${HASH}42 here <!-- plain-text: allow ${reason} -->`), [['number-reference', `${HASH}42`]], `reason "${reason}" is too thin`);
  }
  assert.deepEqual(rules(`Shipped in ${GITHUB}/pull/9 and PR 600 and ${HASH}461 <!-- plain-text: allow a score, not a reference -->`),
    [['github-link', `${GITHUB}/pull/9`], ['pr-number-label', 'PR 600']], 'the marker hides only the #number');
  const codes = check.resolveConfig({ banned_terms: [{ term: 'Q#', reason: 'a lane code', fix: 'say what the work is' }] });
  assert.deepEqual(check.findInText('The Q5 lane <!-- plain-text: allow a score, not a reference -->', 'a.md', codes).map(f => f.text), ['Q5'],
    'banned terms are still reported on a marked line');
});

test('allows links to open a new issue and to issue or pull request lists', () => {
  assert.deepEqual(rules(`Report bugs at ${GITHUB}/issues/new, browse ${GITHUB}/issues or ${GITHUB}/pulls.`), []);
});

test('flags Codex mode class names but not the mode spellings', () => {
  assert.deepEqual(rules('MultiAgentV2 spawns and MultiAgentV1 forks'), [['codex-mode-name', 'MultiAgentV2'], ['codex-mode-name', 'MultiAgentV1']]);
  assert.deepEqual(rules('V1 (`multi_agent`) and V2 (`multi_agent_v2`)'), []);
});

test('scans docs, skills and instructions, and skips history, audits, third-party copies, provenance and tests', () => {
  for (const rel of ['README.md', 'AGENTS.md', 'repo/docs/HOW-TO-USE.md', 'repo/CONTROLLER.md', 'skills/x/SKILL.md', 'skills/x/agents/openai.yaml',
    '.claude-plugin/plugin.json', '.agents/rules/a.md', 'repo/contracts/agent-rules/global-rules.md', 'repo/docs/a.json', 'repo/contracts/x/schema.json']) assert.equal(plain.inScope(rel), true, rel);
  for (const rel of ['repo/docs/CHANGELOG.md', 'repo/docs/audits/a.md', 'repo/contracts/third-party/n8n/SKILL.md', 'repo/source-watch/x.md',
    'repo/tests/fixture.md', 'repo/scripts/a.cjs', 'repo/tests/a.json', '.github/pull_request_template.md', 'node_modules/x/README.md']) assert.equal(plain.inScope(rel), false, rel);
});

test('a new reference fails with its line and a plain-English fix; a baselined one passes up to its count', t => {
  const root = fixture(t, { 'repo/docs/A.md': `one\nSee ${HASH}7.\nAgain ${HASH}7.\n`, 'repo/docs/CHANGELOG.md': `Fixed ${HASH}9.\n` },
    [{ file: 'repo/docs/A.md', rule: 'number-reference', text: `${HASH}7`, count: 1 }]);
  const result = plain.check(root);
  assert.deepEqual(result.failures.map(finding => finding.line), [2, 3], 'every occurrence is listed once the count is exceeded');
  assert.match(plain.describeFailure(result.failures[0]), /^repo\/docs\/A\.md:2: number-reference "#7": replace the #number with what it refers to, in plain English \(if it is not a reference, mark the line `plain-text: allow <reason>`\)$/);
  fs.writeFileSync(path.join(root, 'repo/docs/A.md'), `See ${HASH}7.\n`);
  assert.deepEqual(plain.check(root).failures, []);
});

test('a rewritten reference leaves a stale entry that only a prune removes, and pruning never adds entries', t => {
  const root = fixture(t, { 'repo/docs/A.md': `See ${HASH}7 and ${HASH}8 and ${HASH}8.\n` }, [
    { file: 'repo/docs/A.md', rule: 'number-reference', text: `${HASH}7`, count: 1 },
    { file: 'repo/docs/A.md', rule: 'number-reference', text: `${HASH}8`, count: 3 },
    { file: 'repo/docs/Gone.md', rule: 'number-reference', text: `${HASH}5`, count: 1 }]);
  const before = plain.check(root);
  assert.deepEqual(before.failures, []);
  assert.deepEqual(before.stale.map(entry => [entry.text, entry.found]), [[`${HASH}8`, 2], [`${HASH}5`, 0]]);
  assert.deepEqual(plain.pruneBaseline(root), { removed: 1, kept: 2 });
  const baseline = JSON.parse(fs.readFileSync(path.join(root, plain.BASELINE_REL), 'utf8'));
  assert.deepEqual(baseline.allowed.map(entry => [entry.text, entry.count]), [[`${HASH}7`, 1], [`${HASH}8`, 2]]);
  fs.writeFileSync(path.join(root, 'repo/docs/B.md'), `New ${HASH}3.\n`);
  plain.pruneBaseline(root);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, plain.BASELINE_REL), 'utf8')).allowed.length, 2, 'the new reference is not added');
  assert.equal(plain.check(root).failures.length, 1);
});

test('a malformed baseline fails instead of allowing everything', t => {
  const root = fixture(t, { 'README.md': 'clean\n' }, [{ file: 'README.md', rule: 'number-reference', text: `${HASH}1`, count: 0 }]);
  assert.throws(() => plain.check(root), /positive count/);
});

test('the command line exits 1 with the fix list and 0 when clean', t => {
  const root = fixture(t, { 'skills/x/SKILL.md': `Follow ${GITHUB}/pull/3.\n` });
  const failed = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8', timeout: 20000 });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /skills\/x\/SKILL\.md:1: github-link/);
  assert.match(failed.stderr, /Repository file links are fine/);
  fs.writeFileSync(path.join(root, 'skills/x/SKILL.md'), 'Follow the pull request that added the guard.\n');
  const passed = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8', timeout: 20000 });
  assert.equal(passed.status, 0, passed.stderr);
});

test('flags Toolkit shorthand codes in docs and in the readable fields of structured files only', t => {
  const code = 'N' + '5';
  const root = fixture(t, {
    'repo/docs/A.md': `Ships with the ${code} work.\nCodex V1 (\`multi_agent\`) and V2 (\`multi_agent_v2\`) are fine.\n`,
    'repo/contracts/x/a.json': `{\n  "title": "The ${code} contract",\n  "owned_by": "${code}"\n}\n`,
    'repo/contracts/trusted-ci-repository-protection/a.json': '{ "name": "N' + '6 CI diagnostics" }\n'
  });
  const failures = plain.check(root).failures.map(finding => [finding.file, finding.line, finding.rule, finding.text]);
  assert.deepEqual(failures, [['repo/contracts/x/a.json', 2, 'banned-term', code], ['repo/docs/A.md', 1, 'banned-term', code]]);
  assert.match(plain.describeFailure(plain.check(root).failures[0]), /banned-term "N5": a programme or release code; say what the work is/);
});

test('this repository passes against its own baseline', () => {
  const result = plain.check(ROOT);
  assert.deepEqual(result.failures.map(plain.describeFailure), []);
});
