'use strict';

// Contract coverage for the current V3 operating text and its projections: the canonical
// instruction surfaces must agree with each other, with the pinned registry, with the
// implemented retention clocks and with the bridge parser. This does not prove runtime
// enforcement or native qualification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
// Windows checkouts may convert text files to CRLF; the contracts are about the words, not line ends.
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const DAY_MS = 24 * 60 * 60 * 1000;

function section(text, number) {
  const heading = new RegExp(`^## ${number}\\. .+$`, 'm');
  const start = text.search(heading);
  assert.notEqual(start, -1, `missing section ${number}`);
  const remainder = text.slice(start);
  const next = remainder.slice(1).search(/^## \d+\. /m);
  return next === -1 ? remainder : remainder.slice(0, next + 1);
}

// CONTROLLER.md holds only the current operating procedure (R3 removed its pre-V3 history); the
// gate rules hold the executor gate procedure (fresh contexts, review, delta reviews and routes,
// read by every gate session wherever the plugin is installed). The governed block keeps only the GitHub-tracking parts and is projected
// unchanged into root AGENTS.md and both portable templates (checked by agent-instruction-shims).
function current(text) {
  assert.equal(text.includes('## Historical compatibility reference'), false, 'the pre-V3 history is removed');
  return text;
}

const GATE_SURFACES = ['repo/contracts/agent-rules/gate-rules.md'];
const RENEWAL_SURFACES = ['skills/controller-bootstrap/SKILL.md'];

function surfaces() {
  const value = { 'repo/CONTROLLER.md': current(read('repo/CONTROLLER.md')) };
  for (const rel of [...GATE_SURFACES, ...RENEWAL_SURFACES]) value[rel] = read(rel);
  return value;
}

function currentOperatingContract(texts) {
  for (const rel of GATE_SURFACES) {
    const text = texts[rel];
    assert.match(text, /Planned G1 segment completion alone checkpoints and continues in the same session/, rel);
    assert.match(text, /Correction rechecks use fresh contexts for the same selected reviewers/, rel);
    assert.match(text, /G2 stays adversarial on every reachable path inside the frozen supported host\/environment matrix/, rel);
    assert.match(text, /rechecks target corrected boundary families rather than restarting discovery/, rel);
    assert.match(text, /no added peer, duplicate or automatic closing panel/, rel);
  }
  const controller = texts['repo/CONTROLLER.md'];
  // The audit dropped the expiry clock, pins and cleanup ledger: delete scratch once its report is stored.
  assert.doesNotMatch(controller, /expires 21 days|21-day/);
  assert.match(controller, /Delete scratch once its report is stored; never delete the only copy/);
  assert.match(controller, /in a Git evidence store the commit is the manifest, and a successful push plus one fetch is the read-back/);
  assert.match(controller, /fresh-context, family-closure and delta-review rules are in the gate rules/);
  assert.match(controller, /G2 stays adversarial on every reachable path inside the release brief's frozen supported host\/environment matrix/);
  assert.match(controller, /a private `TRANSPORT-\*` Git repository is only the recommended default when no store was previously selected/);
  for (const rel of RENEWAL_SURFACES) {
    assert.match(texts[rel], /Planned G1 segment completion checkpoints and continues in the same session/, rel);
    assert.match(texts[rel], /fresh-context correction rechecks for the same selected reviewers/, rel);
  }
  for (const [rel, text] of Object.entries(texts)) {
    assert.doesNotMatch(text, /each planned G1 segment/i, rel);
    assert.doesNotMatch(text, /segment completion and newly activated instruction\/profile versions require a fresh executor/, rel);
    assert.doesNotMatch(text, /30 days after the latest required consumer|v1 records|legacy clock/, rel);
    assert.doesNotMatch(text, /Reuse independent G2 reviewers|reviewer reuse/, rel);
    assert.doesNotMatch(text, /complementary peers?/, rel);
    assert.doesNotMatch(text, /agreed private TRANSPORT store/, rel);
  }
  assert.match(read('repo/docs/TOOLKIT-V3.md'), /selection of another supported private backend takes precedence over that recommendation/);
  assert.match(read('repo/docs/TOOLKIT-V3.md'), /Git cleanup is an ordinary non-force commit and never removes history; another backend uses its own supported capability or holds the cleanup/);
  assert.doesNotMatch(read('repo/docs/TOOLKIT-V3.md'), /TRANSPORT repo retaining the small index/);
}

test('current procedure is one wording across CONTROLLER, the governed block and its projections', () => {
  const texts = surfaces();
  currentOperatingContract(texts);
  const mutations = [
    ['repo/contracts/agent-rules/gate-rules.md', 'Planned G1 segment completion alone checkpoints and continues in the same session.',
      'Mandatory fresh executor contexts follow each planned G1 segment.'],
    ['repo/CONTROLLER.md', 'Delete scratch once its report is stored; never delete the only copy',
      'Stored temporary owned bulk expires 21 days after its immutable verified transfer'],
    ['repo/contracts/agent-rules/gate-rules.md', 'Correction rechecks use fresh contexts for the same selected reviewers',
      'Reuse independent G2 reviewers for corrections'],
    ['repo/contracts/agent-rules/gate-rules.md', 'no added peer, duplicate or automatic closing panel',
      'broad changes may require two complementary peers'],
    ['skills/controller-bootstrap/SKILL.md', 'Planned G1 segment completion checkpoints and continues in the same session',
      'Planned G1 segment completion and newly activated instruction/profile versions require a fresh executor']
  ];
  for (const [rel, before, after] of mutations) {
    assert.ok(texts[rel].includes(before), `mutation target exists in ${rel}: ${before}`);
    assert.throws(() => currentOperatingContract({ ...texts, [rel]: texts[rel].replace(before, after) }), `reject stale ${rel}`);
  }
});

const WORDS = ['zero', 'one', 'two', 'three', 'four'];
function reviewerCardinalityContract(text, registry) {
  const counts = ['owner-gpt', 'owner-claude'].map(id => registry.profiles[id].reviewers.length);
  const expected = `their independent full-scope reviewer sets are defined only by the pinned registry and currently contain ${WORDS[counts[0]]} and ${WORDS[counts[1]]} members, with no additional peer.`;
  assert.ok(text.includes(expected), expected);
  assert.doesNotMatch(text, /reviewer sets contain two, one and three members/);
}

test('documented reviewer cardinalities are derived from the pinned registry', () => {
  const registry = JSON.parse(read('repo/contracts/controller-kernel/stack-registry-v3.json'));
  assert.deepEqual(Object.keys(registry.profiles).map(id => registry.profiles[id].reviewers.length), [1, 1]);
  for (const rel of ['repo/contracts/source-of-truth-contract.md', 'README.md']) reviewerCardinalityContract(read(rel), registry);
  const stale = read('repo/contracts/source-of-truth-contract.md').replace('currently contain one and one members', 'currently contain two and one members');
  assert.throws(() => reviewerCardinalityContract(stale, registry));
  const grown = structuredClone(registry); grown.profiles['owner-gpt'].reviewers.push({ reviewer_id: 'extra' });
  assert.throws(() => reviewerCardinalityContract(read('repo/contracts/source-of-truth-contract.md'), grown),
    'a registry change cannot pass against stale prose');
});

test('neither the directive nor CONTROLLER keeps a retention clock', () => {
  // The rules audit dropped the expiry clock, pins and cleanup ledger: scratch goes once its report is stored.
  const v3 = section(read('repo/docs/TOOLKIT-V3.md'), 13);
  assert.match(v3, /There is no expiry clock, pin or cleanup ledger/);
  assert.match(v3, /In a Git store the commit is the manifest, and a successful push plus one fetch is the read-back/);
  assert.doesNotMatch(v3, /21 days|30-day|restart the clock/);
  assert.doesNotMatch(current(read('repo/CONTROLLER.md')), /expires 21 days|restart the clock/);
  assert.doesNotMatch(current(read('repo/CONTROLLER.md')), /Historical v1 records/);
});

function securityReviewContract(text) {
  const brief = section(text, 5);
  assert.match(brief, /\*\*Frozen supported profile\.\*\* Before final review, that existing release brief binds, for each approved host/);
  for (const item of [/supported OS, runtime, provider, model and effort/, /executable and install locations and their protection assumptions/,
    /native trust, hook and plugin loading/, /authoritative entrypoints and alternate invocation paths/, /credential references/,
    /data and effect targets/, /principals and permissions/, /threat boundaries/, /acceptance criteria/,
    /available positive and negative evidence/, /explicitly unsupported states; and rollback/]) assert.match(brief, item);
  assert.match(brief, /This is part of existing G0\/G1 work, not a new gate/);
  assert.match(brief, /Actual source, UAT and installed state must match it/);
  assert.match(brief, /only the owner can reduce supported hosts/);
  const review = section(text, 8);
  assert.match(review, /G2 reviews against the section 5 frozen supported profile and the agreed invariants, and stays adversarial on every reachable path inside it/);
  assert.match(review, /A security finding blocks Core when a plausible supported-path trace violates an existing acceptance or safety invariant, or proves critical required evidence absent/);
  assert.match(review, /concrete setup, attacker capability, reproduction or trace, consequence and minimum correction/);
  assert.match(review, /An unsupported arbitrary layout or extra execution surface does not by itself create Core scope/);
  assert.match(review, /a newly proposed environment, feature or threat goes to the owner for classification before adoption/);
  assert.match(review, /A genuinely serious reachable issue found late still blocks, even when an earlier review missed it/);
  assert.match(review, /G1 inventories every material entrypoint for that invariant inside the frozen profile and fixes the family once, with positive and negative controls, rather than one bypass per cycle/);
  assert.match(review, /The fresh recheck covers the corrected families, cumulative diff, dependent invariants, new real host evidence and retained previously reviewed scope/);
  assert.match(review, /It does not restart discovery, rescan the whole product by default, add reviewers or open unbounded hardening/);
  assert.match(review, /preserves any genuinely new security finding without manufacturing an extra gate/);
  assert.match(review, /G2 does not spawn subagents/);
  const acceptance = section(text, 18);
  assert.match(acceptance, /\| Security review boundary \| The release brief freezes the supported profile for each approved host before final review, and G2 is adversarial on every reachable path within it\./);
  assert.match(acceptance, /Ship status keeps source-green, owner UAT, the native qualified host matrix, merge\/install\/activation authority and installed proof separate/);
  assert.match(acceptance, /A genuine host-unavailable HOLD is neither product-red nor success; only the owner may choose a reduced supported release, with residual hosts tracked/);
}

test('final review is adversarial within the frozen supported profile and rechecks corrected families', () => {
  const directive = read('repo/docs/TOOLKIT-V3.md');
  securityReviewContract(directive);
  for (const [before, after] of [
    ['and stays adversarial on every reachable path inside it', 'and reviews only the files G1 lists'],
    ['does not by itself create Core scope', 'automatically becomes Core scope'],
    ['goes to the owner for classification before adoption', 'is adopted by the reviewer'],
    ['A genuinely serious reachable issue found late still blocks', 'An issue found late is deferred'],
    ['fixes the family once, with positive and negative controls, rather than one bypass per cycle', 'fixes one bypass per cycle'],
    ['It does not restart discovery, rescan the whole product by default, add reviewers or open unbounded hardening', 'It restarts discovery and rescans the whole product'],
    ['without manufacturing an extra gate', 'by adding a security panel'],
    ['This is part of existing G0/G1 work, not a new gate', 'This is a new security gate'],
    ['only the owner can reduce supported hosts', 'the reviewer may reduce supported hosts'],
    ['is neither product-red nor success', 'counts as success']
  ]) {
    assert.ok(directive.includes(before), `mutation target exists: ${before}`);
    assert.throws(() => securityReviewContract(directive.replace(before, after)), `reject security-review regression: ${before}`);
  }
});

const ANTIGRAVITY_SURFACES = ['README.md', 'repo/docs/HOW-TO-USE.md', 'repo/docs/TOOLKIT-LOCAL-BRIDGE.md',
  'skills/toolkit-setup/SKILL.md', 'skills/toolkit-setup/README.md', 'skills/repository-agent-rules/README.md',
  '.claude-plugin/plugin.json', '.codex-plugin/plugin.json',
  'repo/contracts/toolkit-local-bridge/claude-plugin/plugin.json', 'repo/contracts/toolkit-local-bridge/codex-plugin/plugin.json'];
const NATIVE_ANTIGRAVITY_PROMISE = /--enable-target ag2|--set-ag2-python-command|plugin-scoped|Antigravity 2 (adapter|bridge)|Antigravity 2 (is|are) (an )?opt-in (local )?bridge target|\.gemini[\\/]+config[\\/]+plugins|pip show ag2/i;

function antigravityPortableContract(texts, parseArgs) {
  for (const [rel, text] of Object.entries(texts)) {
    assert.doesNotMatch(text, NATIVE_ANTIGRAVITY_PROMISE, rel);
    if (rel.endsWith('plugin.json')) assert.equal(JSON.parse(text).keywords.includes('ag2'), false, rel);
  }
  for (const rel of ['README.md', 'repo/docs/HOW-TO-USE.md', 'repo/docs/TOOLKIT-LOCAL-BRIDGE.md']) {
    assert.match(texts[rel], /portable/i, rel);
  }
  // Every bridge command documented on a present surface must be accepted by the real parser.
  let commands = 0;
  for (const [rel, text] of Object.entries(texts)) {
    for (const match of text.matchAll(/node repo\/scripts\/toolkit-local-bridge\.cjs([^`|\r\n]*)/g)) {
      const args = (match[1].trim().match(/"[^"]*"|\S+/g) || []).map(arg => arg.replace(/^"|"$/g, ''))
        .map(arg => arg === '<absolute-path>' ? path.join(os.tmpdir(), 'toolkit-workspace')
          : arg === '<generation-id>' ? '00000000-0000-4000-8000-000000000000' : arg);
      assert.doesNotThrow(() => parseArgs(args), `${rel}: ${match[0]}`);
      commands++;
    }
  }
  assert.ok(commands >= 6, 'the documented bridge command surface is exercised');
}

test('present surfaces document only the portable Antigravity route that the bridge accepts', () => {
  const { parseArgs } = require('../scripts/toolkit-local-bridge.cjs');
  const texts = Object.fromEntries(ANTIGRAVITY_SURFACES.map(rel => [rel, read(rel)]));
  antigravityPortableContract(texts, parseArgs);
  assert.throws(() => parseArgs(['--enable-target', 'ag2']), /Unknown argument: --enable-target/);
  for (const [rel, injected] of [
    ['README.md', '\nRun `node repo/scripts/toolkit-local-bridge.cjs --enable-target ag2 --write` to sync Antigravity.\n'],
    ['repo/docs/HOW-TO-USE.md', '\nUse the plugin-scoped `C:\\Users\\<user>\\.gemini\\config\\plugins\\ai-agent-toolkit` folder.\n'],
    ['repo/docs/TOOLKIT-LOCAL-BRIDGE.md', '\nnode repo/scripts/toolkit-local-bridge.cjs --set-ag2-python-command "python" --write\n']
  ]) {
    assert.throws(() => antigravityPortableContract({ ...texts, [rel]: texts[rel] + injected }, parseArgs), `reject native promise in ${rel}`);
  }
  const keyword = JSON.parse(texts['.claude-plugin/plugin.json']); keyword.keywords.push('ag2');
  assert.throws(() => antigravityPortableContract({ ...texts, '.claude-plugin/plugin.json': JSON.stringify(keyword) }, parseArgs));
});

// Owner records 08 (launch ownership) and 10 (finish before stopping), 17 October 2026, as compressed
// in 3.4.0: each keeps its meaning on every current surface, in the sections that govern it.
const FINISH_BEFORE_STOP = '**Finish authorised work before stopping.** For admitted, already-authorised work, carry every dependency-ready safe step through to the actual deliverable in one sustained run where practical: implementation, targeted tests, relevant CI or status, authorised publication with conflict controls, custody and readback, then one complete return instead of asking whether to continue. A plan, green focused test, commit, PR draft, helper return, checkpoint, evidence upload, CI watcher start or progress note is not a terminal outcome. A genuine owner UAT or decision, new scope, trust or spend, host-native permission, missing credential or route, unknown external effect, incomplete CI or independent G2 holds only its dependent steps; continue independent authorised work and report the exact HOLD and next action. This never authorises working around a denial, an unsafe retry, a duplicate writer, an unapproved model launch, claimed background execution or self-launching G2.';
const V3_DOC = 'repo/docs/TOOLKIT-V3.md';
const GLOBAL = 'repo/contracts/agent-rules/global-rules.md';
const LAUNCH_OWNERSHIP_V3 = "Model and effort follow launch ownership. A human's direct model/effort choice for the first manually launched agent, including a directly opened G2 chat, is advisory relative to the stack and is not itself a blocker; record the actual route where observable and never label it as the recommended one. Every automation-launched G0/G1/G2 worker or successor, even when it is root of its own session, and every G0/G1 helper receives the exact pinned-stack route for its role and member, without fallback or weaker effort. A root label is not a human override, and no root-level model lock is installed into a human-run entrypoint. Native permissions, independence, reviewer obligations and delegation limits still apply.";
const LAUNCH_CLAUSES = [/Model and effort follow launch ownership/, /advisory, not a blocker/, /never labelled the recommended one/,
  /Every automation-launched G0\/G1\/G2 worker or successor/, /every G0\/G1 helper/, /(?:with no|without) fallback or weaker effort/,
  /A root label is not a human override/, /Native permissions, independence, reviewer obligations and delegation limits still apply/];
const LAUNCH_SURFACES = [...GATE_SURFACES, ...RENEWAL_SURFACES];
const GATE = GATE_SURFACES[0];

function ownerLawContract(texts) {
  for (const rel of LAUNCH_SURFACES) for (const clause of LAUNCH_CLAUSES) assert.match(texts[rel], clause, `${rel}: launch ownership ${clause}`);
  // One home per rule: launch ownership lives in the gate rules and finish-before-stop in the global
  // Shipping section; the V3 directive points at them instead of repeating either.
  assert.equal(texts[V3_DOC].includes(LAUNCH_OWNERSHIP_V3), false, 'V3 directive does not repeat launch ownership');
  assert.equal(texts[V3_DOC].includes(FINISH_BEFORE_STOP), false, 'V3 directive does not repeat finish-before-stop');
  assert.match(section(texts[V3_DOC], 10), /Launch ownership and route proof are in the gate rules/);
  assert.match(section(texts[V3_DOC], 6), /work finishes before stopping as the global Shipping section says/);
  const shipping = texts[GLOBAL].match(/## Shipping\n([\s\S]*?)(?=\n## )/)?.[0] || '';
  assert.match(shipping, /\*\*Finish authorised work before stopping\.\*\*/, 'finish-before-stop sits in the global Shipping section');
  for (const clause of [/is not a finish/, /holds only the steps that depend on it/, /report the exact hold and next action/,
    /never authorises working around a denial, an unsafe retry, a duplicate writer, an unapproved model launch or claimed background work/]) assert.match(shipping, clause);
  for (const rel of GATE_SURFACES) assert.match(texts[rel], /Gate models and effort come only from an explicitly selected stack registry revision/, rel);
  const v3 = texts[V3_DOC];
  assert.match(texts[GATE], /a human's own choice for an agent they open directly \(including a G2 chat\) is advisory/);
  assert.match(texts[GATE], /a model or effort difference alone is not a G2 failure/);
  assert.match(texts[GATE], /A checkpoint \(work pushed, the PR or brief current\) is not a terminal outcome/);
  assert.match(section(v3, 14), /Before inference by an automation-launched agent or helper, deterministically enforce/);
  assert.match(section(v3, 14), /These checks never lock a human's manually selected first-layer model or effort/);
  assert.match(section(v3, 18), /Missing, duplicate, stale or wrong-route automated returns cannot complete the set; an owner's manually selected reviewer model and effort are recorded as actual/);
  assert.match(section(v3, 18), /a genuine HOLD blocks only its dependent steps/);
  assert.match(section(v3, 19), /through a launcher that enforces the exact pinned-stack route for the role, not a prompt that merely names it/);
  assert.match(texts['repo/CONTROLLER.md'], /Launch every gate with model and effort pinned explicitly/);
  // One home per rule: CONTROLLER points at the global Shipping rule instead of repeating it.
  assert.match(texts['repo/CONTROLLER.md'], /Finish authorised work before stopping, as the global rules' Shipping section says/);
}

test('launch ownership and finish-before-stop keep their meaning on every current surface', () => {
  const texts = { ...surfaces(), [V3_DOC]: read(V3_DOC), [GLOBAL]: read(GLOBAL) };
  ownerLawContract(texts);
  for (const [rel, before, after] of [
    [GATE, 'is advisory, not a blocker', 'must equal the stack recommendation'],
    [GLOBAL, 'progress note is not a finish', 'progress note is a finish'],
    [GLOBAL, 'holds only the steps that depend on it', 'stops all work'],
    [V3_DOC, 'a genuine HOLD blocks only its dependent steps', 'a HOLD stops all work'],
    [GATE, 'a model or effort difference alone is not a G2 failure', 'a model difference fails G2'],
    ['skills/controller-bootstrap/SKILL.md', 'without fallback or weaker effort', 'with the controller choosing the effort'],
    [GATE, 'Gate models and effort come only from an explicitly selected stack registry revision', 'Gate models and effort come from any registry']
  ]) {
    assert.ok(texts[rel].includes(before), `mutation target exists in ${rel}: ${before}`);
    assert.throws(() => ownerLawContract({ ...texts, [rel]: texts[rel].replace(before, after) }), `reject ${rel}: ${before}`);
  }
});

// Owner UAT holds only what needs the owner's own hands; CI, tests and G2 prove the rest.
const PROJECTS_SKILL = 'repo/contracts/claude-projects/web-controller-projects/SKILL.md';
const GATE_RULES = GATE_SURFACES[0];
const GOVERNED = 'repo/contracts/agent-rules/toolkit-governed-rules.md';

function ownerUatScopeContract(texts) {
  assert.match(texts[GATE_RULES], /G2 starts after the working result and any owner UAT acceptance/);
  assert.match(texts[GLOBAL], /Owner UAT holds only owner-hands steps \(real app UI, signed-in accounts, device behaviour CI cannot reach\); CI, tests and G2 prove the rest, each UAT list names the check covering every dropped item, and with none, UAT is NOT_REQUIRED\./);
  // The issue rules live in the governed block; closing waits for any owner UAT.
  assert.match(texts[GOVERNED], /`Closes`\/`Fixes`, and closing, only once the merge completes every criterion and any owner UAT passed/);
  assert.match(texts['repo/CONTROLLER.md'], /At admission split acceptance: owner UAT only for owner-hands steps \(global rules\), objective acceptance \(CI, tests, G2\) for the rest; with no such step record NOT_REQUIRED\. Missing authority never waives a needed UAT\./);
  assert.match(texts['repo/CONTROLLER.md'], /G2 begins after builder readiness and any owner UAT acceptance/);
  assert.match(texts[V3_DOC], /User acceptance covers only what needs the owner's own hands/);
  assert.match(texts[V3_DOC], /listed beside the owner steps with the passing check that covers it; when nothing needs the owner's hands, UAT is recorded as not required/);
  assert.match(texts[GLOBAL], /Source-only checks, fixtures and CI do not prove user acceptance or an installed result: before acceptance, check the real installed or deployed result where one exists\./);
  assert.match(texts[V3_DOC], /G2 starts after G1's working version and any required user UAT are accepted/);
  assert.match(texts[PROJECTS_SKILL], /\*\*Owner UAT lists carry only owner-hands steps\*\* \(global rules\): real app UI, signed-in accounts and device behaviour CI cannot reach\. End each list with what was dropped and the passing check that covers each/);
}

test('owner UAT is limited to owner-hands steps on every current surface', () => {
  const texts = { ...surfaces(), [V3_DOC]: read(V3_DOC), [PROJECTS_SKILL]: read(PROJECTS_SKILL), [GLOBAL]: read(GLOBAL), [GOVERNED]: read(GOVERNED) };
  ownerUatScopeContract(texts);
  for (const [rel, before, after] of [
    [GLOBAL, 'Owner UAT holds only owner-hands steps', 'Owner UAT holds every step'],
    [GOVERNED, 'any owner UAT passed', "the owner's UAT passed"],
    [GATE_RULES, 'any owner UAT acceptance', "the owner's actual UAT acceptance"],
    ['repo/CONTROLLER.md', 'with no such step record NOT_REQUIRED', 'always run owner UAT'],
    [V3_DOC, 'User acceptance covers only', 'User acceptance covers every step, not only'],
    [PROJECTS_SKILL, '**Owner UAT lists carry only owner-hands steps**', '**Owner UAT lists carry every step**']
  ]) {
    assert.ok(texts[rel].includes(before), `mutation target exists in ${rel}: ${before}`);
    assert.throws(() => ownerUatScopeContract({ ...texts, [rel]: texts[rel].replace(before, after) }), `reject ${rel}: ${before}`);
  }
});
