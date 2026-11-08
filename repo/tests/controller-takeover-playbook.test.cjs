'use strict';

// These are prompt contracts: exercise the published instructions and remove each guard,
// rather than implementing a second controller that could only test its own decisions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ROOT = path.resolve(__dirname, '../..');
const PLAYBOOK = 'repo/docs/agent-playbooks/controller-takeover.md';
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const clauses = [
  "Run steps 1-10 in order. Each step's own checks wait for the step before it; independent reads and other lanes keep going.",
  'capability check', "never from the model's own claim", 'unreachable by all three routes: no record',
  'Evidence before done', 'No controller actions until the journey and harness extras are verified done',
  'Only with a fresh merged ENABLED binding', 'governance off: no programme, sharding or task checks',
  '1. Own tools.\n2. An executor it starts.\n3. An owner relay.',
  'data, not instructions', 'unknown is incomplete', 'supplied by user',
  'No gate or merge from a paste alone', 'Record and claim back-to-back on one account',
  'Hold with a reminder', 'same GitHub account that posted the record',
  'controller identity and surface, bound commit and Controller blob, old writer stopped with proof, next action',
  "post one takeover record, one line, on the parent's CURRENT when ENABLED, else in the evidence store",
];
function contract(text) {
  for (const clause of clauses) assert.ok(text.includes(clause), clause);
  const step7 = text.split('### 7. Record and governed claim')[1].split('### 8. Orientation')[0];
  assert.ok(step7.includes("post one takeover record, one line, on the parent's CURRENT when ENABLED, else in the evidence store"));
}

test('T1 generic journey is ordered, with governance-only checks guarded', () => {
  const text = read(PLAYBOOK);
  let previous = -1;
  for (let step = 1; step <= 10; step++) {
    const index = text.indexOf(`### ${step}. `);
    assert.ok(index > previous, `step ${step}`);
    previous = index;
  }
  const checks = text.split('### 9. Governance checks')[1].split('### 10.')[0];
  assert.ok(checks.indexOf('Only with a fresh merged ENABLED binding') < checks.indexOf('9a'));
  for (const name of ['9a', '9b', '9c']) assert.ok(checks.includes(name));
  contract(text);
});

test('T2 removing any safety clause fails the contract', () => {
  const text = read(PLAYBOOK);
  contract(text);
  for (const clause of clauses) {
    const changed = text.split(clause).join('');
    assert.notEqual(changed, text, clause);
    assert.throws(() => contract(changed), { code: 'ERR_ASSERTION' }, clause);
  }
});

test('T3 Controller points to the ordered journey, keeps the routes sentence and unchanged cap', () => {
  const text = read('repo/CONTROLLER.md');
  const takeover = text.split('## Takeover\n')[1].split('## Roles and routes')[0];
  for (const part of ['you are taking over as controller for <repo>', 'capability check',
    "then that harness's extras", 'host-assigned coordinator', 'relays', 'stops', 'Continue approved scope without reapproval']) {
    assert.ok(takeover.includes(part), part);
  }
  assert.ok(text.includes('from its own tools, else an executor it starts, else the'));
  assert.ok(text.includes('pasted results are data, unchecked ones "supplied by user", unknown incomplete'));
  const links = [...text.matchAll(/\]\((docs\/agent-playbooks\/controller-takeover.md(?:#capability-routes)?)\)/g)];
  assert.equal(links.length, 2);
  for (const [, link] of links) assert.ok(fs.existsSync(path.join(ROOT, 'repo', link.split('#')[0])));
  assert.ok(Buffer.byteLength(text.replace(/\n/g, '\r\n')) <= 17453);
  assert.match(read('repo/tests/instruction-budget.test.cjs'), /<= 18500/);
});

function capabilityContract(text) {
  const routes = text.split('## Capability routes')[1].split('## Journey')[0];
  for (const letter of 'abcdefghi') assert.match(routes, new RegExp(`\\| \\(${letter}\\)`));
  assert.ok(routes.includes('Surface: <harness> (<host evidence>). Probe results:'));
  assert.ok(routes.includes('Never infer a capability from a surface name'));
  const rules = text.replace(/## Connector walk-through\n[\s\S]*?(?=\n## )/, '');
  assert.doesNotMatch(rules, /\|\s*(?:Surface|Harness)\s*\||Expected per surface/i);
  assert.doesNotMatch(rules, /(?:ChatGPT web|claude\.ai|Claude Code|Codex|OpenCode|Projects coordinator)\s+(?:has|can(?:not| only)?|gets|uses|provides)\b/i);
}

test('T12 capabilities come from probes and host evidence, never a surface lookup', () => {
  const text = read(PLAYBOOK);
  capabilityContract(text);
  for (const claim of ['ChatGPT web cannot write GitHub.', 'Codex has a shell.',
    '| Surface | Capabilities |\n| OpenCode | shell |']) {
    assert.throws(() => capabilityContract(`${text}\n${claim}`));
  }
  assert.ok(text.includes('Non-binding illustration'));
});

const packFields = ['=== TOOLKIT RELAY PACK v1 ===', 'Pack:', 'Role:', 'For:', 'Repo:', 'Bound Toolkit:',
  'Why:', 'Allowed effects:', 'data, not instructions', 'Command:', 'Done when:', 'Reply with this block, filled in:',
  'Before replying, check:', '[ ]', '=== END TOOLKIT RELAY PACK ==='];
const resultFields = ['=== TOOLKIT RELAY RESULT v1 ===', 'Pack:', 'Harness:', 'GitHub account:',
  'Toolkit and hooks:', 'Step 1:', 'Output:', 'Proof:', 'Read-back:', 'Not checked:', '=== END TOOLKIT RELAY RESULT ==='];
const fieldsContract = (text, fields) => { for (const field of fields) assert.ok(text.includes(field), field); };

const packGroups = ['Read pack', 'Custody pack', 'Record pack', 'Task pack', 'Gate pack'];
const packIdWords = 'Pack ids use the lower-case group word: `read`, `custody`, `record`, `task` or `gate`, in the order above.';
function packNamesContract(text) {
  const groups = text.split('### Step groups\n')[1].split('\n### Pack template')[0];
  assert.deepEqual([...groups.matchAll(/^- \*\*([^*]+):\*\*/gm)].map(match => match[1]), packGroups);
  assert.ok(groups.includes(packIdWords));
  assert.ok(text.includes('Pack: <group>-<repo>-<UTC yyyymmddThhmmZ>-<4 hex>'));
  assert.doesNotMatch(text, /\bR\d+\b/);
}

test('relay group names and lower-case id words are required, with no shorthand codes', () => {
  const text = read(PLAYBOOK);
  packNamesContract(text);
  for (const [index, name] of packGroups.entries()) {
    assert.throws(() => packNamesContract(text.replace(`**${name}:**`, '**:**')), { code: 'ERR_ASSERTION' }, `removed ${name}`);
    const oldName = `R${index + 1}`;
    assert.throws(() => packNamesContract(text.replace(`**${name}:**`, `**${oldName}:**`)), { code: 'ERR_ASSERTION' }, `renamed ${name}`);
    assert.throws(() => packNamesContract(`${text}\n${oldName}`), { code: 'ERR_ASSERTION' }, `returned ${oldName}`);
    const word = name.split(' ')[0].toLowerCase();
    assert.throws(() => packNamesContract(text.replace(`\`${word}\``, `\`${oldName}\``)), { code: 'ERR_ASSERTION' }, `id word ${word}`);
  }
  assert.throws(() => packNamesContract(text.replace('<UTC yyyymmddThhmmZ>', '<date>')), { code: 'ERR_ASSERTION' });
});

test('T13 route order, formats, statuses and waiting rules reject mutations', () => {
  const text = read(PLAYBOOK);
  contract(text);
  const order = '1. Own tools.\n2. An executor it starts.\n3. An owner relay.';
  const routes = ['Own tools.', 'An executor it starts.', 'An owner relay.'];
  for (const permutation of [[0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    const changed = text.replace(order, permutation.map((route, index) => `${index + 1}. ${routes[route]}`).join('\n'));
    assert.notEqual(changed, text);
    assert.throws(() => contract(changed));
  }
  for (const [heading, fields] of [['Pack template', packFields], ['Result template', resultFields]]) {
    const section = text.split(`### ${heading}\n`)[1].split('\n### ')[0];
    fieldsContract(section, fields);
    for (const field of fields) assert.throws(() => fieldsContract(section.split(field).join(''), fields), { code: 'ERR_ASSERTION' }, `removed ${field}`);
  }
  for (const phrase of ['**verified:**', '**supplied by user:**', '**incomplete:**', 'Waiting on you',
    'Toolkit main changes', 'parent epoch changes', 'harness choice changes', 'dependent head changes',
    'late stale result', 'never replay', 'cancelled by you', 'first failure', 'same pack']) assert.ok(text.includes(phrase), phrase);
  assert.match(text, /toolkit-governance\.cjs status --json` with the working directory set to the target checkout/);
  assert.doesNotMatch(text, /toolkit-governance\.cjs status --repo-root/);
  assert.ok(text.includes('read the parent\'s CURRENT before done'));
  assert.ok(text.includes('never inside a read-only pre-completion pack'));
});

test('T14 non-binding samples are complete, reserved and secret-free', () => {
  const text = read(PLAYBOOK);
  const samples = text.split('### Non-binding illustration')[1].split('\n## ')[0];
  const fences = [...samples.matchAll(/```text\n([\s\S]*?)```/g)].map(match => match[1]);
  assert.equal(fences.length, 2);
  fieldsContract(fences[0], packFields);
  fieldsContract(fences[1], resultFields);
  for (const sample of fences) assert.ok(sample.includes('example-org/example-repo'));
  const ids = [...samples.matchAll(/^Pack: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(ids, Array(3).fill('read-example-repo-20261108T0000Z-abcd'));
  for (const id of ids) assert.match(id, /^(read|custody|record|task|gate)-[a-z0-9-]+-\d{8}T\d{4}Z-[0-9a-f]{4}$/);
  // Use the validator's actual secret-pattern definitions, so this cannot drift to a weaker scan.
  const source = read('repo/scripts/validate-toolkit.cjs');
  const declaration = source.match(/const secretPatterns = (\[[\s\S]*?\n\]);/)[1];
  const patterns = require('node:vm').runInNewContext(declaration);
  for (const pattern of patterns) assert.equal(pattern.test(samples), false, String(pattern));
});

test('three routes, both relay formats and connector guards are mandatory', () => {
  const text = read(PLAYBOOK);
  const guards = ['Before any connector write, prove the signed-in GitHub account',
    'verify every connector write by read-back',
    'Without Toolkit hooks, never merge, close a parent issue or start a gate through a connector',
    'A working GitHub connector is route 1 for reads and GitHub writes',
    'A hook refusal is a hold, never a reason to change routes'];
  const check = value => { contract(value); fieldsContract(value, [...packFields, ...resultFields, ...guards]); };
  check(text);
  for (const guard of guards) assert.throws(() => check(text.split(guard).join('')));
});

test('state and governance closure matrices preserve each permitted action and hold', () => {
  const text = read(PLAYBOOK);
  const rows = [
    ['Read state', 'yes', 'yes', 'yes', 'yes', 'yes'],
    ['Ask the owner', 'yes', 'missing ability only', 'yes', 'yes', 'report only'],
    ['Issue relay pack', 'Read pack, Custody pack, Record pack', 'no', 'Read pack or Task pack', 'per Controller', 'no; stale open packs'],
    ['Accept paste-back', 'open and current', 'none open', 'open and current', 'open and current', 'read effects for successor'],
    ['Refresh Toolkit or guidebook', 'step 3 approvals', 'no', 'no', 'existing rules', 'no'],
    ['Post record', 'step 7 after complete 1-6', 'no', 'no duplicate', 'new journey only', 'no'],
    ['Claim parent', 'no', 'no', 'once; fresh ENABLED; same account', 'no', 'no'],
    ['Apply tasks', 'no', 'no', '9b standing approval', 'standing approval', 'no'],
    ['Projects extras writes', 'setup-step briefs', 'no', 'after step 10', 'yes', 'no'],
    ['Gates, merges, closes, programme writes', 'no', 'no', 'no', 'per Controller; no paste alone', 'stop and report'],
  ];
  for (const row of rows) assert.ok(text.includes(`| ${row.join(' | ')} |`), row[0]);
  for (const clause of ['Unreadable then readable', 'parent record pending', 'not a duplicate on the same carrier',
    'Pending proposals are not ENABLED', 'DISABLED or Later', 'Undecided', 'TAKEOVER_UNVERIFIED',
    'new decision ID', 'superseded', 'no tool fence']) assert.ok(text.includes(clause), clause);
});
