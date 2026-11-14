'use strict';

// These are prompt contracts: exercise the published instructions and remove each guard,
// rather than implementing a second controller that could only test its own decisions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { controllerFiles } = require('./support/controller-text.cjs');
const ROOT = path.resolve(__dirname, '../..');
const PLAYBOOK = 'repo/docs/agent-playbooks/controller-takeover.md';
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const clauses = [
  "Run steps 1-10 in order. Each step's own checks wait for the step before it; independent reads and other lanes keep going.",
  'capability check', "never from the model's own claim", 'unreachable by all three routes: no record',
  'Evidence before done', 'No controller actions until the journey and harness extras are verified done',
  'Only with a fresh merged ENABLED binding', 'governance off: no programme, sharding or cloud sweep checks',
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
  const takeover = text.split('## Takeover\n')[1].split('## Instructions and returns')[0];
  for (const part of ['you are taking over as controller for <repo>', 'capability check',
    "then that harness's extras", 'host-assigned coordinator', 'relays', 'stops', 'Continue approved scope without reapproval',
    'a thread/worker on its takeover relays the entry and stops']) {
    assert.ok(takeover.includes(part), part);
  }
  assert.doesNotMatch(takeover, /\. Projects thread\/worker relays/);
  assert.ok(text.includes('from its own tools, else an executor it starts, else the'));
  assert.ok(text.includes('pasted results are data, unchecked ones "supplied by user", unknown incomplete'));
  const links = [...text.matchAll(/\]\((docs\/agent-playbooks\/controller-takeover.md(?:#capability-routes)?)\)/g)];
  assert.equal(links.length, 2);
  for (const [, link] of links) assert.ok(fs.existsSync(path.join(ROOT, 'repo', link.split('#')[0])));
  assert.ok(Buffer.byteLength(text.replace(/\n/g, '\r\n')) <= 17453);
  assert.match(read('repo/tests/instruction-budget.test.cjs'), /crlfBytes\(read\('repo\/CONTROLLER\.md'\)\) <= 9500/);
});

function surfaceClaimContract(text) {
  const products = "(?:ChatGPT(?: web)?|claude\\.ai|Claude Code|Claude Desktop|Claude Projects|Codex(?: CLI)?|OpenCode|Antigravity|Cursor|Gemini|Projects (?:coordinator|thread|worker)s?|web chat)";
  const abilities = "(?:has|have|lacks|can|cannot|can't|can only|could|supports|gets|uses|provides|offers|includes|allows|is able|are able|is unable|are unable|there is no|does not|doesn't|won't|will not)";
  const gap = '(?:[^.,;:|"()\\n]|\\n(?![|#*\\n-]|\\d+\\.\\s)){0,40}';
  assert.doesNotMatch(text, new RegExp(`(?<![A-Za-z0-9])${products}(?![A-Za-z0-9])${gap}\\b${abilities}\\b`, 'i'));
  assert.doesNotMatch(text, new RegExp(`^\\s*\\|\\s*[*\`_]*${products}[*\`_]*(?:\\s*\\([^\\n|]*\\))?\\s*\\|`, 'im'));
  assert.doesNotMatch(text, /\|\s*(?:Surface|Harness|Host|Product|App|Platform|Client)(?:\s+names?)?\s*\||Expected per surface/i);
}

function capabilityContract(text) {
  const routes = text.split('## Capability routes')[1].split('## Journey')[0];
  for (const letter of 'abcdefghi') assert.match(routes, new RegExp(`\\| \\(${letter}\\)`));
  assert.ok(routes.includes('Surface: <harness> (<host evidence>). Probe results:'));
  assert.ok(routes.includes('Never infer a capability from a surface name'));
  surfaceClaimContract(text);
}

function markdownFiles(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(entry => {
    const rel = `${dir}/${entry.name}`;
    return entry.isDirectory() ? markdownFiles(rel) : /\.md$/i.test(entry.name) ? [rel] : [];
  });
}
const capabilityFiles = [...new Set([PLAYBOOK, ...controllerFiles(),
  'skills/controller-bootstrap/SKILL.md', 'repo/contracts/claude-projects/web-controller-projects/SKILL.md',
  ...markdownFiles('skills/controller-bootstrap'),
  ...markdownFiles('repo/contracts/claude-projects/web-controller-projects')])];
const capabilityControls = ['ChatGPT web cannot write GitHub.', 'Codex has a shell.',
  '| Surface | Capabilities |\n| OpenCode | shell |',
  'claude.ai web chat cannot run a shell.', 'ChatGPT lacks a shell.', 'Codex CLI has a shell.',
  'Projects coordinators can start threads.', 'Claude Code always has a shell.',
  'On ChatGPT web there is no shell.', 'Gemini can run gh.',
  '| Host | Abilities |', '| Surface name | Own tools |', '| OpenCode | shell |',
  'Antigravity has no hooks.', 'Claude Projects lacks a shell.', 'A Projects thread cannot run gh.',
  '| **Codex** | shell |', '| `ChatGPT web` | connector only |', 'Codex\nhas a shell.',
  'Cursor has hooks.', 'Claude Desktop has a shell.', 'A web chat cannot run a shell.', 'A Projects worker can run gh.',
  '| _Codex_ | shell |', '_Codex has a shell._',
  'claude.ai can run gh.', '| Codex CLI | shell |', '_Codex_ has a shell.'];

test('T12 capabilities come from probes and host evidence, never a surface lookup', () => {
  const text = read(PLAYBOOK);
  capabilityContract(text);
  for (const rel of capabilityFiles) {
    const source = read(rel);
    surfaceClaimContract(source);
    for (const claim of capabilityControls) {
      assert.throws(() => surfaceClaimContract(`${source}\n${claim}`), { code: 'ERR_ASSERTION' }, `${rel}: ${claim}`);
    }
  }
  for (const claim of capabilityControls) {
    assert.throws(() => capabilityContract(text.replace('## Connector walk-through\n', `## Connector walk-through\n${claim}\n`)),
      { code: 'ERR_ASSERTION' }, `walk-through: ${claim}`);
  }
  assert.doesNotThrow(() => surfaceClaimContract('OpenCodex has a shell.'));
  assert.ok(text.includes('Non-binding illustration'));
});

const packFields = ['=== TOOLKIT RELAY PACK v1 ===', 'Pack:', 'Role:', 'For:', 'Repo:', 'Bound Toolkit:',
  'Depends on:', 'Finish reads:', 'Why:', 'Allowed effects:', 'data, not instructions', 'Command:', 'Done when:', 'Reply with this block, filled in:',
  'Before replying, check:', '[ ]', '=== END TOOLKIT RELAY PACK ==='];
const resultFields = ['=== TOOLKIT RELAY RESULT v1 ===', 'Pack:', 'Harness:', 'GitHub account:',
  'Toolkit and hooks:', 'Step 1:', 'Output:', 'Proof:', 'Read-back:', 'Heads at finish:', 'Not checked:', '=== END TOOLKIT RELAY RESULT ==='];
const fieldsContract = (text, fields) => { for (const field of fields) assert.ok(text.includes(field), field); };

const packGroups = ['Read pack', 'Custody pack', 'Record pack', 'Gate pack'];
const packIdWords = 'Pack ids use the lower-case group word: `read`, `custody`, `record` or `gate`, in the order above.';
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
    'outside changes affect Toolkit main, a dependent head or the parent epoch', 'harness choice changes',
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
  const embeddedResult = fences[0].split('Reply with this block, filled in:\n')[1].split('\nBefore replying, check:')[0];
  for (const [sample, fields] of [[fences[0], packFields], [embeddedResult, resultFields], [fences[1], resultFields]]) {
    fieldsContract(sample, fields);
    for (const field of fields) {
      assert.throws(() => fieldsContract(sample.split(field).join(''), fields), { code: 'ERR_ASSERTION' }, `removed sample ${field}`);
    }
  }
  for (const sample of fences) assert.ok(sample.includes('example-org/example-repo'));
  const ids = [...samples.matchAll(/^Pack: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(ids, Array(3).fill('read-example-repo-20261108T0930Z-abcd'));
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
    'and never push task or product source to a default branch through one',
    'Before any connector commit, comment or pull request write, check its text yourself for AI attribution and personal data, since a hook may not see it.',
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
    ['Issue relay pack', 'Read pack, Custody pack, Record pack', 'no', 'Read pack', 'per Controller', 'no; stale open packs'],
    ['Accept paste-back', 'open and current', 'none open', 'open and current', 'open and current', 'read effects for successor'],
    ['Refresh Toolkit or guidebook', 'step 3 approvals', 'no', 'no', 'existing rules', 'no'],
    ['Post record', 'step 7 after complete 1-6', 'no', 'no duplicate', 'new journey only', 'no'],
    ['Claim parent', 'no', 'no', 'once; fresh ENABLED; same account', 'no', 'no'],
    ['Projects extras writes', 'setup-step briefs', 'no', 'after step 10', 'yes', 'no'],
    ['Gates, merges, closes, programme writes', 'no', 'no', 'no', 'per Controller; no paste alone', 'stop and report'],
  ];
  for (const row of rows) assert.ok(text.includes(`| ${row.join(' | ')} |`), row[0]);
  for (const clause of ['Unreadable then readable', 'parent record pending', 'not a duplicate on the same carrier',
    'Pending proposals are not ENABLED', 'DISABLED or Later', 'Undecided', 'TAKEOVER_UNVERIFIED',
    'new decision ID', 'superseded', 'no tool fence']) assert.ok(text.includes(clause), clause);
});

// Each closure row pins the clause in the section where the operator needs it.
const headComparison = 'Compare Heads at finish with Depends on, entry by entry and in full.';
const staleHead = 'Any difference, or a NOT RUN or missing entry you cannot read yourself, means a dependent head changed: refuse the late stale result.';
const ownHeadRead = 'A match from the relay alone stays supplied by user; read the heads yourself wherever possible, and your own read wins when it is a read you made after the result arrived.';
const staleEffects = 'Refuse a late stale result; read back any reported effects first and never replay them.';
const storeFallback = "If a Toolkit hook still refuses the push to the store's default branch, build the record commit on top of the store's `records/takeover` branch when it exists, otherwise use the same commit, then push to that branch instead, as its message says (never forced), and read it back the same way; that commit is the stored copy.";
const storeMerge = "Merge it only after the done line, and only under a fresh binding that names the store or on the owner's typed merge; otherwise name the branch, and any pull request, in the done line.";
const plainReadRetry = 'Before recording a probe as unreachable on a route, retry it once as the simplest single plain read (no chaining, pipes, redirection or variables).';
const hookHold = 'A hook refusal is a hold, never a reason to change routes.';
const closureRows = [
  ['record-claim-route', '### 7. Record and governed claim', "A new controller's record and claim are one ability: post the record on the route that runs the claim, straight before it, so no parent write lands between them; when the claim needs an executor or relay, that route posts both. A record that needs no claim may go through any proven write route. Read back comment id, URL, created_at, author login and body, yourself wherever possible. A newly taking-over controller then runs, on the claim route:"],
  ['record-pack-route', '### Step groups', "**Record pack:** use the controller's exact record and claim. Post and read back the prepared record, then claim immediately, on one account; never post the record ahead on another route. Check freshness again just before posting. If a record is already posted, relay only the claim; a parent write since it returns TAKEOVER_UNVERIFIED, and step 7's new-record rule applies. An ungoverned takeover needs no claim and can finish through its proven connector and evidence-store routes."],
  ['record-walk-through', '## Connector walk-through', "The controller prepares the record and claim. For a governed parent the claim needs the relay shell, so one Record pack posts the record and claims straight after it on the proven account; the controller then reads the comment's id, URL, created_at, author and body back through the connector."],
  ...['### Pack template', '### Non-binding illustration'].map(heading => ['relay-one-step ' + heading, heading,
    '- One step at a time: wait for each command to finish before the next; never chain commands or run them in parallel.']),
  ['A1', '### Proof and acceptance', ownHeadRead],
  ['A2', '### Proof and acceptance', ownHeadRead],
  ['A3', '### Proof and acceptance', staleHead],
  ['A3', '### Waiting and stale packs', staleEffects],
  ['A4', '### Proof and acceptance', staleHead],
  ['A5', '### Proof and acceptance', staleHead],
  ['A6', '### Proof and acceptance', ownHeadRead],
  ['A7', '### Waiting and stale packs', 'Accept complete DONE steps before the first failure with their proof, and issue a new pack for the remainder only after reconciliation.'],
  ['A8', '### Waiting and stale packs', staleEffects],
  ['S1', '### 6. Outgoing writer and custody', 'In a Git store, the commit is the manifest: push, one fetch, then `git show --stat <sha>` with paths.'],
  ['S2', '### 6. Outgoing writer and custody', "Name the store's folder literally in the push."],
  ['S2', '### 6. Outgoing writer and custody', storeFallback],
  ['S2', '### 7. Record and governed claim', "With DISABLED or Later, record in the verified evidence store (with step 6's branch fallback when needed), no claim."],
  ['S3', '### 6. Outgoing writer and custody', storeFallback],
  ['S3', '### 6. Outgoing writer and custody', 'If the push is rejected as non-fast-forward, fetch, rebuild the record commit on top of the fetched `records/takeover`, and push again; never force.'],
  ['S4', '### 6. Outgoing writer and custody', 'On a GitHub store, open or reuse one pull request from that branch; it stays open through step 6.'],
  ['S4', '### 6. Outgoing writer and custody', storeMerge],
  ['S5', '## Capability routes', hookHold],
  ['S6', '### 6. Outgoing writer and custody', storeMerge],
  ['S6', '### 6. Outgoing writer and custody', 'Never reshape, rename or retry the refused push.'],
  ['S-successor', '### 6. Outgoing writer and custody', 'the evidence store (including its `records/takeover` branch when present)'],
  ['S-successor', '### 8. Orientation', "Read the repository map and its recorded commit, open pull requests and checks, and the latest evidence, including the store's `records/takeover` branch when present."],
  ['T1', '### Step groups', "Take the pack id time, in UTC, from host evidence or a tool read of the clock, else from the newest timestamp you read (a comment's created_at or a commit date)."],
  ['T2', '### Step groups', "Take the pack id time, in UTC, from host evidence or a tool read of the clock, else from the newest timestamp you read (a comment's created_at or a commit date)."],
  ['T3', '### Step groups', 'A date alone is not enough.'],
  ['T4', '### Step groups', 'Failing those, write `time-unknown` in its place; never guess or fill with zeros.'],
  ['N1', '## Capability routes', 'One denied command does not prove a missing ability.'],
  ['N1', '## Capability routes', plainReadRetry],
  ['N2', '## Capability routes', plainReadRetry],
  ['N3', '## Capability routes', 'A native permission or sandbox denial of a write stops that effect on this route: keep what was written and report the denial.'],
  ['N3', '## Capability routes', 'Offer the owner the same prepared effect through the next route only if its permission was granted outside this session.'],
  ['N3', '## Capability routes', 'Steps that say native denials stop, stop.'],
  ['N4', '## Capability routes', 'A helper under the same denied session or sandbox is not a new route; never widen your own permissions to retry.'],
  ['N4', '## Capability routes', 'Never launch an executor or helper with wider permission flags, a bypass mode or a changed sandbox after a denial, to carry out the denied effect.'],
  ['N5', '## Capability routes', hookHold],
  ['A1-A8', '### Proof and acceptance', headComparison],
  ['A-own-changes', '### Proof and acceptance', "A pack's Depends on lists only heads the pack does not change itself; the claim's epoch change (N to N+1) and the pack's own store or branch pushes are proven by their step Proof and Read-back (the claim and any record in step 7, a custody push in step 6), and the stale rule covers outside changes only."],
  ['A-outside-changes', '### Waiting and stale packs', "A pack becomes stale when outside changes affect Toolkit main, a dependent head or the parent epoch, or the owner's harness choice changes."],
  ['A-template-depends', '### Pack template', 'Depends on: <where> <ref>=<commit40>, one per head the steps rely on but do not change (Toolkit main, repo and store branches; parent epoch <N> when governed)', 'but do not change'],
  ['D1-template-command', '### Pack template', '  Command: <one exact read command per Depends on entry>'],
  ['D1-sample-toolkit-read', '### Non-binding illustration', '  Command: git ls-remote https://github.com/weijunswj/ai-agent-toolkit.git refs/heads/main'],
  ['D1-sample-repo-read', '### Non-binding illustration', '  Command: git ls-remote https://github.com/example-org/example-repo.git refs/heads/main'],
  ['D1-template-failure', '### Pack template', '- Do only these steps. Stop at the first failure and report it, then run only the Finish reads; never retry with other commands.', 'then run only the Finish reads'],
  ['D1-sample-failure', '### Non-binding illustration', '- Stop at the first failure, then run only the Finish reads; never retry with other commands or bypass hooks or permission prompts.', 'then run only the Finish reads'],
  ['D1-template-checklist', '### Pack template', '[ ] Heads at finish holds the raw Finish reads output.'],
  ['D1-sample-checklist', '### Non-binding illustration', '[ ] Heads at finish holds the raw Finish reads output.'],
];
function sectionAt(text, heading) {
  const start = text.indexOf(heading + '\n');
  assert.notEqual(start, -1, heading);
  return text.slice(start + heading.length + 1).split(/\n#{1,3} /)[0];
}
function closureContract(text, [id, heading, clause]) {
  assert.ok(sectionAt(text, heading).includes(clause), id + ': ' + clause);
}

test('T15 closure table pins every clause to its own section and rejects removals', () => {
  const text = read(PLAYBOOK);
  assert.doesNotMatch(text, /If route 1 already posted and read back the record through a connector|posts it itself through the connector/);
  for (const row of closureRows) {
    closureContract(text, row);
    const [, heading, clause, removal = clause] = row;
    const section = sectionAt(text, heading);
    const changed = text.replace(section, section.split(removal).join(''));
    assert.notEqual(changed, text, row[0]);
    assert.throws(() => closureContract(changed, row), { code: 'ERR_ASSERTION' }, row[0]);
  }
});

function forbiddenPhraseContract(text) {
  for (const clause of text.split(/[.;:\n]/)) {
    for (const match of clause.matchAll(/--force\b|--no-verify\b|\b(?:force-push|force|bypass|dangerously)\b/gi)) {
      assert.match(clause.slice(0, match.index), /\b(?:never|no|not|without)\b/i, `unguarded phrase: ${clause.trim()}`);
    }
  }
}

test('forbidden phrases require a preceding prohibition in the same clause', () => {
  const text = read(PLAYBOOK);
  forbiddenPhraseContract(text);
  forbiddenPhraseContract('Never force it.');
  for (const line of ['If the records push is rejected, force it.', '--no-verify', 'Bypass the hook',
    'force-push the branch.', 'Use --force.', 'Run dangerously.']) {
    assert.throws(() => forbiddenPhraseContract(`${text}\n${line}`), { code: 'ERR_ASSERTION' }, line);
  }
});

function sampleHeadsContract(text) {
  const samples = sectionAt(text, '### Non-binding illustration');
  const fences = [...samples.matchAll(/```text\n([\s\S]*?)```/g)].map(match => match[1]);
  assert.equal(fences.length, 2);
  const depends = fences[0].match(/^Depends on: (.+)$/m);
  assert.ok(depends, 'sample Depends on');
  const expected = [...depends[1].matchAll(/([^,]+)=([0-9a-f]{40})(?=,|$)/g)]
    .map(([, name, sha]) => [name.trim(), sha]);
  assert.equal(expected.length, 2);
  const heads = fences[1].match(/^Heads at finish:\n((?:  .+\n)+)/m);
  assert.ok(heads, 'sample Heads at finish');
  const actual = heads[1].trimEnd().split('\n').map(line => {
    const match = line.match(/^  (.+): ([0-9a-f]{40}) refs\/heads\/main$/);
    assert.ok(match, line);
    return match.slice(1);
  });
  assert.deepEqual(actual, expected);
}

test('T16 sample dependent heads match the filled result and reject a changed hex character', () => {
  const text = read(PLAYBOOK);
  sampleHeadsContract(text);
  for (const sha of ['a'.repeat(40), 'c'.repeat(40)]) {
    const samples = sectionAt(text, '### Non-binding illustration');
    for (const prefix of ['=', ': ']) {
      const from = prefix + sha;
      const changed = samples.replace(from, prefix + 'd' + sha.slice(1));
      assert.notEqual(changed, samples);
      assert.throws(() => sampleHeadsContract(text.replace(samples, changed)), { code: 'ERR_ASSERTION' });
    }
  }
});

test('T17 store fallback matches the real hook refusal message', () => {
  assert.ok(read('repo/scripts/toolkit-merge-hold.cjs').includes('push to another branch and open one'));
});

test('T18 sample pack ids have a read time or time-unknown and no zero-filled sample time', () => {
  const text = read(PLAYBOOK);
  assert.ok(!text.includes('T0000Z'));
  const ids = [...sectionAt(text, '### Non-binding illustration').matchAll(/^Pack: (.+)$/gm)]
    .map(match => match[1]);
  assert.equal(ids.length, 3);
  for (const id of ids) assert.match(id, /-(\d{8}T\d{4}Z|time-unknown)-[0-9a-f]{4}$/);
});
