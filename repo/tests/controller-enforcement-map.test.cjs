'use strict';

// The controller enforcement map names, for every controller rule, what enforces it or why it is
// instruction-only. These tests run the check on the real repository (the gate) and on throwaway
// copies with one thing broken at a time.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { BASES, GATE_RULES, KINDS, MAP, check, ruleLines, ruleSha, run } = require('../scripts/check-controller-enforcement-map.cjs');
const { controllerFiles } = require('./support/controller-text.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'repo', 'scripts', 'check-controller-enforcement-map.cjs');
const readMap = root => JSON.parse(fs.readFileSync(path.join(root, ...MAP.split('/')), 'utf8'));
const writeMap = (root, map) => fs.writeFileSync(path.join(root, ...MAP.split('/')), `${JSON.stringify(map, null, 2)}\n`);

// A throwaway copy of the controller set, the map and every file the map names.
function copy(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'controller-enforcement-map-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const take = rel => {
    const target = path.join(root, ...rel.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, ...rel.split('/')), target);
  };
  for (const rel of [...controllerFiles(), GATE_RULES]) take(rel);
  take(MAP);
  for (const row of readMap(ROOT).rows) for (const enforcer of row.enforced_by || []) { take(enforcer.path); take(enforcer.test); }
  return root;
}
const editMap = (root, change) => { const map = readMap(root); change(map); writeMap(root, map); };
const errorsOf = root => check(root).errors;

test('the real map covers every controller rule exactly once and every enforcer exists', () => {
  const result = check(ROOT);
  assert.deepEqual(result.errors, []);
  const ruleCount = [...controllerFiles(), GATE_RULES].reduce((sum, rel) => sum + ruleLines(fs.readFileSync(path.join(ROOT, rel), 'utf8')).length, 0);
  assert.equal(result.rules, ruleCount);
  assert.equal(result.rows, ruleCount);
  const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^Controller enforcement map check passed: \d+ rules, \d+ rows\.\n$/);
});

test('every row is either enforced or instruction-only with a reason, and kinds stay in the list', () => {
  for (const row of readMap(ROOT).rows) {
    assert.ok((row.enforced_by === undefined) !== (row.instruction_only === undefined), row.rule);
    for (const enforcer of row.enforced_by || []) assert.ok(KINDS.includes(enforcer.kind), `${row.rule}: ${enforcer.kind}`);
    if (row.instruction_only !== undefined) {
      assert.ok(Object.hasOwn(BASES, row.instruction_only.basis), `${row.rule}: has a basis`);
      assert.ok(row.instruction_only.why.trim().length > 20, `${row.rule}: says why`);
      if (BASES[row.instruction_only.basis]) assert.ok(row.instruction_only[BASES[row.instruction_only.basis]].trim().length > 20, `${row.rule}: says how to test or what builds it`);
    }
    assert.match(row.rule_sha, /^[0-9a-f]{12}$/, row.rule);
    if (row.enforced_by !== undefined) assert.ok(typeof row.covers === 'string' && row.covers.trim().length > 20, `${row.rule}: says what it covers`);
  }
});

test('D7-1: a removed row fails and names the rule', t => {
  const root = copy(t);
  editMap(root, map => { map.rows = map.rows.filter(row => row.rule !== '**Scope confirmation:**'); });
  const errors = errorsOf(root);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^rule with no map row: repo\/controller\/gates\.md:\d+ \(Gate lifecycle and acceptance\): "- \*\*Scope confirmation:\*\*/);
  const run = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /rule with no map row: .*Scope confirmation/);
});

test('D7-1: a new rule with no row fails, in the core and in a page, bullet or paragraph', t => {
  for (const [rel, line] of [['repo/CONTROLLER.md', '- **Brand new rule:** every lane writes a haiku.'],
    ['repo/controller/gates.md', 'A paragraph rule added under the human-readable heading.']]) {
    const root = copy(t);
    const file = path.join(root, ...rel.split('/'));
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    // The core ends with its Pages list, so a core rule goes into the first section instead.
    fs.writeFileSync(file, rel === 'repo/CONTROLLER.md' ? text.replace('\n- **Batch small fixes:**', `\n${line}\n- **Batch small fixes:**`) : `${text.replace(/\n*$/, '\n')}${line}\n`);
    const errors = errorsOf(root);
    assert.equal(errors.length, 1, errors.join('\n'));
    assert.ok(errors[0].startsWith(`rule with no map row: ${rel}:`), errors[0]);
    assert.ok(errors[0].includes(line.slice(0, 40)), errors[0]);
  }
});

test('D7-1: a row pointing at a missing test, a missing enforcer or a test that never names it fails', t => {
  const cases = [
    [enforcer => { enforcer.test = 'repo/tests/no-such-file.test.cjs'; }, /test repo\/tests\/no-such-file\.test\.cjs is not a file inside the repository/],
    [enforcer => { enforcer.path = 'repo/scripts/no-such-script.cjs'; }, /enforcer repo\/scripts\/no-such-script\.cjs is not a file inside the repository/],
    [enforcer => { enforcer.path = 'repo/scripts'; }, /enforcer repo\/scripts is not a file inside the repository/],
    [enforcer => { enforcer.path = '../outside.cjs'; }, /enforcer \.\.\/outside\.cjs is not a file inside the repository/],
    [enforcer => { enforcer.path = 'repo/scripts/../scripts/toolkit-merge-hold.cjs'; }, /is not a file inside the repository/],
    [enforcer => { enforcer.path = '/etc/hostname'; }, /enforcer \/etc\/hostname is not a file inside the repository/],
    [enforcer => { enforcer.test = 'repo/tests'; }, /test repo\/tests is not a file inside the repository/],
    [enforcer => { enforcer.test = 'repo/tests/controller-pages.test.cjs'; }, /test repo\/tests\/controller-pages\.test\.cjs never names toolkit-merge-hold\.cjs/],
    [enforcer => { enforcer.kind = 'vibes'; }, /kind must be one of hook, script, ci, reconciler/],
    [enforcer => { enforcer.owner = 'someone'; }, /unknown enforcer key "owner"/],
  ];
  for (const [change, expected] of cases) {
    const root = copy(t);
    editMap(root, map => change(map.rows.find(row => row.rule === '**Transport stores:**').enforced_by[0]));
    const errors = errorsOf(root);
    assert.ok(errors.some(error => expected.test(error)), `${expected}: ${errors.join('\n')}`);
  }
});

test('a phrase that matches no rule, two rules or another file fails, and two rows on one rule fail', t => {
  let root = copy(t);
  editMap(root, map => { map.rows.find(row => row.rule === '**Promises:**').rule = 'a phrase in no rule at all'; });
  let errors = errorsOf(root);
  assert.ok(errors.some(error => /"a phrase in no rule at all"\): matches no rule in repo\/controller\/evidence-and-finish\.md/.test(error)), errors.join('\n'));
  assert.ok(errors.some(error => /^rule with no map row: .*Promises/.test(error)), errors.join('\n'));

  root = copy(t);
  editMap(root, map => { map.rows.push({ file: 'repo/CONTROLLER.md', rule: 'owner', rule_sha: '000000000000', instruction_only: { basis: 'judgement', why: 'too short a phrase to pin one rule' } }); });
  errors = errorsOf(root);
  assert.ok(errors.some(error => /matches \d+ rules in repo\/CONTROLLER\.md \(lines [\d, ]+\); use a longer phrase/.test(error)), errors.join('\n'));

  root = copy(t);
  editMap(root, map => { map.rows.push({ ...map.rows[0] }); });
  errors = errorsOf(root);
  assert.ok(errors.some(error => /^rule with 2 map rows \(1, \d+\): repo\/CONTROLLER\.md/.test(error)), errors.join('\n'));

  root = copy(t);
  editMap(root, map => { map.rows[0].file = 'repo/AGENTS.md'; });
  assert.ok(errorsOf(root).some(error => /file must be one of repo\/CONTROLLER\.md, /.test(error)));
});

test('a row must be enforced or instruction-only, never both or neither, and says why', t => {
  const cases = [
    [row => { row.instruction_only = { basis: 'judgement', why: 'also says it is instruction-only' }; }, /needs exactly one of "enforced_by" and "instruction_only"/],
    [row => { delete row.enforced_by; }, /needs exactly one of "enforced_by" and "instruction_only"/],
    [row => { row.enforced_by = []; }, /"enforced_by" must list at least one enforcer/],
    [row => { delete row.enforced_by; row.instruction_only = { basis: 'judgement', why: '  ' }; }, /instruction_only needs a "why" line/],
    [row => { row.note = 'extra'; }, /unknown key "note"/],
    [row => { delete row.covers; }, /an enforced row needs a "covers" line/],
    [row => { row.covers = ' '; }, /an enforced row needs a "covers" line/],
    [row => { delete row.enforced_by; row.instruction_only = { basis: 'judgement', why: 'nothing in code checks this rule today' }; }, /an instruction-only row has no "covers" line/],
  ];
  for (const [change, expected] of cases) {
    const root = copy(t);
    editMap(root, map => change(map.rows.find(row => row.rule === '**Standing approvals:**')));
    const errors = errorsOf(root);
    assert.ok(errors.some(error => expected.test(error)), `${expected}: ${errors.join('\n')}`);
  }
});

test('an unreadable or malformed map fails closed with one plain line', t => {
  for (const [bytes, expected] of [['{ not json', /cannot be read as JSON/], ['{"schema":"other","rows":[]}', /needs "schema": "toolkit-controller-enforcement-map\/v2" and a "rows" list/],
    ['[]', /needs "schema"/], ['{"schema":"toolkit-controller-enforcement-map/v2","rows":{}}', /needs "schema"/],
    ['{"schema":"toolkit-controller-enforcement-map/v1","rows":[]}', /needs "schema": "toolkit-controller-enforcement-map\/v2"/]]) {
    const root = copy(t);
    fs.writeFileSync(path.join(root, ...MAP.split('/')), bytes);
    const errors = errorsOf(root);
    assert.equal(errors.length, 1);
    assert.match(errors[0], expected);
  }
  const root = copy(t);
  editMap(root, map => { map.rows[3] = 'not an object'; });
  assert.ok(errorsOf(root).some(error => /row 4: must be an object/.test(error)));
});

test('an edited rule line fails until its row is reviewed and its rule_sha updated, and a row with no rule_sha fails', t => {
  const root = copy(t);
  const rel = 'repo/controller/gates.md';
  const file = path.join(root, ...rel.split('/'));
  const text = fs.readFileSync(file, 'utf8');
  const before = ruleLines(text).find(rule => rule.text.includes('**Scope confirmation:**'));
  const edited = `${before.text} Also confirm it twice.`;
  fs.writeFileSync(file, text.replace(before.text, edited));
  let errors = errorsOf(root);
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.match(errors[0], new RegExp(`rule line repo/controller/gates\\.md:${before.line} changed since this row was reviewed; .*"rule_sha": "${ruleSha(edited)}"`));
  editMap(root, map => { map.rows.find(row => row.rule === '**Scope confirmation:**').rule_sha = ruleSha(edited); });
  assert.deepEqual(errorsOf(root), []);

  editMap(root, map => { delete map.rows.find(row => row.rule === '**Scope confirmation:**').rule_sha; });
  errors = errorsOf(root);
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.match(errors[0], new RegExp(`needs "rule_sha": "${ruleSha(edited)}", the hash of repo/controller/gates\\.md:${before.line}`));
});

test('an edited or new gate-rules line is guarded like a controller line', t => {
  const root = copy(t);
  const file = path.join(root, ...GATE_RULES.split('/'));
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const first = ruleLines(text)[0];
  fs.writeFileSync(file, text.replace(first.text, `${first.text} Edited.`));
  let errors = errorsOf(root);
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.ok(errors[0].includes(`rule line ${GATE_RULES}:${first.line} changed since this row was reviewed`), errors[0]);

  fs.writeFileSync(file, `${text.replace(/\n*$/, '\n')}A brand new gate rule with no row.\n`);
  errors = errorsOf(root);
  assert.equal(errors.length, 1, errors.join('\n'));
  assert.ok(errors[0].startsWith(`rule with no map row: ${GATE_RULES}:`), errors[0]);
});

test('an instruction-only reason names its basis and the field that basis needs', t => {
  const why = 'the host has no event this check could read';
  const cases = [
    [{ basis: 'host-gap', why }, /a host-gap row needs a "probe" line saying how to test whether the host has the capability now/],
    [{ basis: 'planned', why }, /a planned row needs a "planned" line naming the slice that builds it/],
    [{ basis: 'judgement', why, probe: 'run the hook pack against a fresh chat' }, /a judgement row has no "probe" line/],
    [{ basis: 'host-gap', why, probe: 'run the hook pack against a fresh chat', planned: 'slice S1' }, /a host-gap row has no "planned" line/],
    [{ basis: 'vibes', why }, /instruction_only basis must be one of judgement, host-gap, planned/],
    [{ basis: 'judgement', why, owner: 'someone' }, /unknown instruction_only key "owner"/],
    ['nothing in code checks this rule today', /"instruction_only" must be \{ "basis", "why" \}/],
  ];
  for (const [reason, expected] of cases) {
    const root = copy(t);
    editMap(root, map => { const row = map.rows.find(each => each.rule === '**Standing approvals:**'); delete row.enforced_by; delete row.covers; row.instruction_only = reason; });
    const errors = errorsOf(root);
    assert.ok(errors.some(error => expected.test(error)), `${expected}: ${errors.join('\n')}`);
  }
});

test('--list prints the rows of one basis, and an unknown basis is refused', t => {
  const map = readMap(ROOT);
  const hostGap = map.rows.filter(row => row.instruction_only && row.instruction_only.basis === 'host-gap');
  assert.ok(hostGap.length > 0);
  const listed = spawnSync(process.execPath, [SCRIPT, '--list', 'host-gap'], { encoding: 'utf8' });
  assert.equal(listed.status, 0, listed.stderr);
  for (const row of hostGap) {
    assert.ok(listed.stdout.includes(row.rule), row.rule);
    assert.ok(listed.stdout.includes(row.instruction_only.probe), row.rule);
  }
  for (const argv of [['--list', 'vibes'], ['--list']]) {
    const refused = spawnSync(process.execPath, [SCRIPT, ...argv], { encoding: 'utf8' });
    assert.equal(refused.status, 2, argv.join(' '));
    assert.match(refused.stderr, /^Usage: .*--list judgement\|host-gap\|planned/);
  }
  const out = [];
  const err = [];
  assert.equal(run(['--root', copy(t), '--list', 'planned'], { out: { write: text => out.push(text) }, err: { write: text => err.push(text) } }), 0, err.join(''));
  assert.match(out.join(''), /^\d+ planned row\(s\):\n- .*\n  why: .*\n  planned: /);
});

test('rule lines skip the title and the text before the first section, and read CRLF files the same', () => {
  const text = '# Title\nIntro line that is not a rule.\n## One\n- first\n\nA paragraph.\n### Two\n- second\n';
  const lf = ruleLines(text);
  assert.deepEqual(lf.map(rule => [rule.heading, rule.text]), [['One', '- first'], ['One', 'A paragraph.'], ['Two', '- second']]);
  assert.deepEqual(ruleLines(text.replace(/\n/g, '\r\n')), lf);
});

test('the check reads only and an unknown argument is refused', t => {
  const root = copy(t);
  const before = fs.readFileSync(path.join(root, ...MAP.split('/')), 'utf8');
  assert.deepEqual(check(root).errors, []);
  assert.equal(fs.readFileSync(path.join(root, ...MAP.split('/')), 'utf8'), before);
  const run = spawnSync(process.execPath, [SCRIPT, '--write'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /^Usage: /);
});
