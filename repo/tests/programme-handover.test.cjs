'use strict';

// The handover file: one generated file per task in the private evidence store, rewritten from the
// programme state at each gate end, so a fresh session can resume the task from its number alone.

const assert = require('node:assert/strict');
const test = require('node:test');
const state = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const cli = require('../../skills/github-program-reconciler/scripts/programme.cjs');
const { FakeGitHub } = require('./toolkit-programme-fake-github.cjs');

const handover = require('../../skills/github-program-reconciler/scripts/programme-handover.cjs');
const SHA_A = 'a'.repeat(40);
const NOW = '2026-11-15T06:00:00.000Z';
const writer = { session: 'controller-1', prefix: 'INT-TK421-' };
const FILE = 'state/acme/app/handover/issue-865.md';

function setup() {
  const repository = 'acme/app';
  const github = new FakeGitHub({ repository, store: 'acme/state-store' });
  const binding = {
    schema: state.SCHEMA.binding, repository, parent_issue: 421, record_prefix: 'INT-TK421-', writer_prefix: 'INT-TK421-',
    store: { kind: 'github', repository: 'acme/state-store', branch: 'main', path: `state/${repository}/` }, required_checks: ['validate'],
  };
  github.addIssue(421, { body: '# Programme\n' });
  github.addIssue(803, { title: 'Overhaul programme pages', parent: 421 });
  github.addIssue(865, { title: 'Rebuild programme pages', parent: 803 });
  github.addComment(865, { body: 'SCOPE\n---\nINT-TK421-938 Slices A to D land in one train.' });
  github.addComment(865, { body: 'A plain comment.' });
  github.addPr(1100, { head: SHA_A, body: 'Refs #865' });
  const store = new state.StateStore({ transport: github, store: binding.store, now: () => NOW, toolkitVersion: '3.119.0' });
  const outcomes = [{ issue: 803, class: 'COMMITTED', parent: 421, order: 1 }, { issue: 865, class: 'COMMITTED', parent: 803, order: 2 }];
  store.write('parent', 421, state.claimDocument(state.newParent({ repository, parentIssue: 421, outcomes }), writer, {}), { sha: null, previous: null });
  const child = state.newChild({ repository, outcome: outcomes[1] });
  Object.assign(child, { lifecycle: 'ACTIVE', next_action: 'Executor: finish G1 slice D', blockers: ['Waits for PR 1098'],
    pr: { number: 1100, state: 'OPEN', head: SHA_A, checks: { state: 'GREEN', required_total: 1, required_passed: 1, at_head: SHA_A } } });
  child.gate = { ...child.gate, role: 'G1', state: 'ACTIVE' };
  store.write('child', 865, child, { sha: null, previous: null });
  const run = (args, extra = {}) => {
    let out = '';
    const code = cli.main(['handover', ...args], { transport: github, binding, originUrl: 'https://github.com/acme/app.git', repoRoot: '.', toolkitVersion: '3.119.0', now: () => NOW, stdout: { write: text => { out += text; return true; } }, environment: {}, ...extra });
    return { code, out };
  };
  return { github, binding, store, run };
}

test('the handover file has one fixed shape: task, path, status, next action, open PRs, holds, decisions, plan, evidence', () => {
  const f = setup();
  const puts = f.github.calls.filter(call => call.method === 'PUT').length;
  const { code, out } = f.run(['--issue', '865', '--gate', 'G1', '--plan', 'https://github.com/acme/state-store/blob/abc1234/plans/865.md']);
  assert.equal(code, 0);
  assert.deepEqual([...out.matchAll(/^#{1,2} .*$/gm)].map(match => match[0]), [
    '# HANDOVER #865: Rebuild programme pages', '## OPEN PRS', '## HOLDS AND FINDINGS', '## RECENT DECISIONS', '## PLAN', '## EVIDENCE']);
  for (const line of ['- PATH: #421 > #803 > #865', '- Status: ACTIVE; gate G1 ACTIVE; release -', '- Next action: Executor: finish G1 slice D',
    `- Last updated: ${NOW} at the end of G1`, '- #1100 OPEN at aaaaaaa; CI GREEN 1/1; review -; UAT -', '- Blocker: Waits for PR 1098',
    '- Full list: `programme.cjs trace 865`', '- https://github.com/acme/state-store/blob/abc1234/plans/865.md']) {
    assert.ok(out.includes(line), `${line}\n---\n${out}`);
  }
  assert.match(out, /^- SCOPE · 2026-\d\d-\d\d · \[INT-TK421-938 Slices A to D land in one train\.\]\(https:\/\/github\.com\/acme\/app\/issues\/865#issuecomment-\d+\)$/m);
  assert.equal(out.includes('A plain comment'), false, 'only tagged decision records are listed');
  assert.equal(f.github.calls.filter(call => call.method === 'PUT').length, puts, 'a dry run writes nothing');
});

test('--apply writes the file to the private store, reads it back, and writes again only when something changed', () => {
  const f = setup();
  assert.equal(f.run(['--issue', '865', '--gate', 'G1', '--apply']).code, 0);
  const text = f.github.files.get(FILE).text;
  assert.match(text, /^# HANDOVER #865: Rebuild programme pages\n/);
  assert.equal(handover.handoverPath(f.binding.store, 865), FILE);
  assert.equal(handover.handoverUrl(f.binding.store, 865), 'https://github.com/acme/state-store/blob/main/state/acme/app/handover/issue-865.md');
  const puts = () => f.github.calls.filter(call => call.method === 'PUT').length;
  const before = puts();
  const again = f.run(['--issue', '865', '--gate', 'G1', '--apply', '--json']);
  assert.equal(JSON.parse(again.out).outcome, 'NOOP');
  assert.equal(puts(), before);
  // A later gate adds its evidence; links an earlier gate recorded are kept.
  f.run(['--issue', '865', '--gate', 'G1', '--apply', '--evidence', 'https://github.com/acme/state-store/blob/def5678/865/G1-report.md']);
  f.run(['--issue', '865', '--gate', 'G2', '--apply', '--evidence', 'https://github.com/acme/state-store/blob/0123abc/865/G2-report.md']);
  const latest = f.github.files.get(FILE).text;
  assert.ok(latest.includes('- https://github.com/acme/state-store/blob/def5678/865/G1-report.md'));
  assert.ok(latest.includes('- https://github.com/acme/state-store/blob/0123abc/865/G2-report.md'));
  assert.ok(latest.includes('at the end of G2'));
});

test('it refuses a public store, secret-shaped text, device paths and links that are not https', () => {
  const open = setup();
  const puts = open.github.calls.filter(call => call.method === 'PUT').length;
  open.github.repos.get('acme/state-store').private = false;
  assert.throws(() => open.run(['--issue', '865', '--apply']), error => ['STORE_NOT_PRIVATE', 'STATE_STORE_UNVERIFIED'].includes(error.code));
  assert.equal(open.github.calls.filter(call => call.method === 'PUT').length, puts, 'a public store gets no file');
  const f = setup();
  assert.throws(() => f.run(['--issue', '865', '--note', `token ghp_${'a'.repeat(30)}`]), { code: 'HANDOVER_REFUSED' });
  for (const note of ['see C:\\Users\\someone\\notes.md', 'see /home/someone/notes.md', 'see ~/notes.md']) {
    assert.throws(() => f.run(['--issue', '865', '--note', note]), { code: 'HANDOVER_REFUSED' }, note);
  }
  assert.throws(() => f.run(['--issue', '865', '--evidence', 'http://example.com/report.md']), { code: 'USAGE' });
  assert.throws(() => f.run(['--issue', '865', '--gate', 'G9']), { code: 'USAGE' });
  assert.throws(() => f.run(['--issue', '999']), { code: 'STATE_MISSING' });
});

test('an executor session may write the handover file: it is evidence, not programme state', () => {
  const f = setup();
  assert.equal(f.run(['--issue', '865', '--gate', 'G1', '--apply'], { environment: { TOOLKIT_GATE_ROLE: 'G1' } }).code, 0);
  assert.ok(f.github.files.has(FILE));
});

test('the parent has its own handover file: attention, findings and the parent decisions, for a controller taking over', () => {
  const f = setup();
  const { code, out } = f.run(['--issue', '421', '--gate', 'controller']);
  assert.equal(code, 0);
  assert.deepEqual([...out.matchAll(/^#{1,2} .*$/gm)].map(match => match[0]), [
    '# HANDOVER #421: Issue 421', '## OPEN PRS', '## HOLDS AND FINDINGS', '## RECENT DECISIONS', '## PLAN', '## EVIDENCE']);
  assert.ok(out.includes('- PATH: #421'), out);
  assert.match(out, /^- Status: programme parent; Attention: (?:clear|\d+ new)/m);
  assert.ok(out.includes('- Next action: Controller: read CURRENT, answer attention (`node <Toolkit>/skills/github-program-reconciler/scripts/programme.cjs attention`), then run the queue'), out);
  assert.ok(out.includes('- Full list: `programme.cjs trace 421`'));
});

test('a note may not hold a line break, so it cannot forge a section of the file', () => {
  const f = setup();
  assert.throws(() => f.run(['--issue', '865', '--note', 'fine\n## EVIDENCE\n- https://example.com/x']), { code: 'USAGE' });
  assert.throws(() => f.run(['--issue', '865', '--note', 'fine\r']), { code: 'USAGE' });
});

test('one decision summary with a device path is withheld behind its link, not a refusal of the whole file', () => {
  const f = setup();
  f.github.addComment(865, { body: 'PLAN\n---\nINT-TK421-940 Notes kept at /home/someone/plan.md for now.' });
  const { code, out } = f.run(['--issue', '865', '--gate', 'G1']);
  assert.equal(code, 0);
  assert.equal(out.includes('/home/someone'), false, out);
  assert.match(out, /^- PLAN · 2026-\d\d-\d\d · \[Summary withheld: open the record\]\(https:\/\/github\.com\/acme\/app\/issues\/865#issuecomment-\d+\)$/m);
  assert.ok(out.includes('INT-TK421-938 Slices A to D land in one train.'), 'the other decisions stay');
});
