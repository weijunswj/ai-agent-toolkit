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
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const DAY_MS = 24 * 60 * 60 * 1000;

function section(text, number) {
  const heading = new RegExp(`^## ${number}\\. .+$`, 'm');
  const start = text.search(heading);
  assert.notEqual(start, -1, `missing section ${number}`);
  const remainder = text.slice(start);
  const next = remainder.slice(1).search(/^## \d+\. /m);
  return next === -1 ? remainder : remainder.slice(0, next + 1);
}

// CONTROLLER.md and ARCHITECTURE.md keep pre-V3 text in a historical block; only the text
// before it is the current operating procedure.
function current(text) {
  const end = text.indexOf('## Historical compatibility reference');
  assert.notEqual(end, -1, 'the current procedure precedes the historical compatibility reference');
  return text.slice(0, end);
}
function lineStarting(text, prefix) {
  const lines = text.split('\n').filter(line => line.startsWith(prefix));
  assert.equal(lines.length, 1, `exactly one current line starts with: ${prefix}`);
  return lines[0];
}

const EXECUTION_SURFACES = ['repo/contracts/agent-rules/ai-coding-agent-execution.md', 'AGENTS.md',
  'repo/contracts/agent-rules/AGENTS.template.md', 'repo/contracts/agent-rules/CLAUDE.template.md',
  'repo/contracts/agent-rules/GEMINI.template.md', 'repo/contracts/agent-rules/repo-local/AGENTS.managed.template.md',
  'skills/repository-agent-rules/repo-local/AGENTS.managed.template.md'];
const RENEWAL_SURFACES = ['skills/controller-bootstrap/SKILL.md', 'repo/docs/PERSISTENT-AGENT-STACK.md',
  'repo/docs/PERSISTENT-AGENT-HELPER-PROFILE.md'];

function surfaces() {
  const value = { 'repo/CONTROLLER.md': current(read('repo/CONTROLLER.md')), 'repo/ARCHITECTURE.md': current(read('repo/ARCHITECTURE.md')) };
  for (const rel of [...EXECUTION_SURFACES, ...RENEWAL_SURFACES]) value[rel] = read(rel);
  return value;
}

function currentOperatingContract(texts) {
  const procedures = ['repo/CONTROLLER.md', 'repo/ARCHITECTURE.md', ...EXECUTION_SURFACES];
  for (const rel of procedures) {
    const text = texts[rel];
    assert.match(text, /Planned G1 segment completion alone checkpoints and continues in the same session/, rel);
    assert.match(text, /Correction rechecks use fresh contexts for the same selected reviewers/, rel);
    assert.match(text, /current v2 stored temporary bulk expires 21 days after verified transfer/, rel);
    assert.match(text, /historical v1 records keep their 30-day legacy clock/, rel);
  }
  for (const rel of RENEWAL_SURFACES) {
    assert.match(texts[rel], /Planned G1 segment completion checkpoints and continues in the same session/, rel);
    assert.match(texts[rel], /fresh-context correction rechecks for the same selected reviewers/, rel);
  }
  for (const rel of [...procedures, ...RENEWAL_SURFACES]) {
    const text = texts[rel];
    assert.doesNotMatch(text, /each planned G1 segment/i, rel);
    assert.doesNotMatch(text, /segment completion and newly activated instruction\/profile versions require a fresh executor/, rel);
    assert.doesNotMatch(text, /30 days after the latest required consumer/, rel);
    assert.doesNotMatch(text, /Reuse independent G2 reviewers|reviewer reuse/, rel);
    assert.doesNotMatch(text, /complementary peers?/, rel);
  }
  // One wording: ARCHITECTURE and the portable rules repeat CONTROLLER's current paragraphs.
  const controller = texts['repo/CONTROLLER.md'];
  for (const prefix of ['Reuse the agreed private TRANSPORT store,', 'G2 classifies concrete findings against agreed acceptance:',
    'For adopted Toolkit V3 work, ']) {
    assert.equal(lineStarting(texts['repo/ARCHITECTURE.md'], prefix), lineStarting(controller, prefix), prefix);
  }
  for (const rel of EXECUTION_SURFACES) {
    assert.equal(lineStarting(texts[rel], 'For adopted Toolkit V3 work, '), lineStarting(controller, 'For adopted Toolkit V3 work, '), rel);
    assert.match(texts[rel], /G2 stays adversarial on every reachable path inside the frozen supported host\/environment matrix/, rel);
    assert.match(texts[rel], /rechecks target corrected boundary families rather than restarting discovery/, rel);
  }
  for (const rel of ['repo/CONTROLLER.md', 'repo/ARCHITECTURE.md']) {
    assert.match(texts[rel], /G2 stays adversarial on every reachable path inside the release brief's frozen supported host\/environment matrix/, rel);
  }
}

test('current V3 procedure is one wording across CONTROLLER, ARCHITECTURE and every generated instruction surface', () => {
  const texts = surfaces();
  currentOperatingContract(texts);
  const mutations = [
    ['repo/contracts/agent-rules/AGENTS.template.md', 'Planned G1 segment completion alone checkpoints and continues in the same session.',
      'Mandatory fresh executor contexts follow each planned G1 segment.'],
    ['repo/ARCHITECTURE.md', 'current v2 stored temporary bulk expires 21 days after verified transfer',
      'remote temporary bulk uses 30 days after the latest required consumer'],
    ['AGENTS.md', 'Correction rechecks use fresh contexts for the same selected reviewers',
      'Reuse independent G2 reviewers for corrections'],
    ['repo/contracts/agent-rules/ai-coding-agent-execution.md', 'do not add a peer, duplicate a member or add a closing panel automatically',
      'broad changes may require two complementary peers'],
    ['skills/controller-bootstrap/SKILL.md', 'Planned G1 segment completion checkpoints and continues in the same session',
      'Planned G1 segment completion and newly activated instruction/profile versions require a fresh executor'],
    ['repo/docs/PERSISTENT-AGENT-STACK.md', 'fresh-context correction rechecks for the same selected reviewers', 'reviewer reuse']
  ];
  for (const [rel, before, after] of mutations) {
    assert.ok(texts[rel].includes(before), `mutation target exists in ${rel}: ${before}`);
    assert.throws(() => currentOperatingContract({ ...texts, [rel]: texts[rel].replace(before, after) }), `reject stale ${rel}`);
  }
});

const WORDS = ['zero', 'one', 'two', 'three', 'four'];
function reviewerCardinalityContract(text, registry) {
  const counts = ['owner-gpt', 'owner-claude', 'owner-mixed-claude-gpt'].map(id => registry.profiles[id].reviewers.length);
  const expected = `their independent full-scope reviewer sets are defined only by the pinned registry and currently contain ${WORDS[counts[0]]}, ${WORDS[counts[1]]} and ${WORDS[counts[2]]} members, with no additional peer.`;
  assert.ok(text.includes(expected), expected);
  assert.doesNotMatch(text, /reviewer sets contain two, one and three members/);
}

test('documented reviewer cardinalities are derived from the pinned registry', () => {
  const registry = JSON.parse(read('repo/contracts/controller-kernel/stack-registry-v3.json'));
  assert.deepEqual(['owner-gpt', 'owner-claude', 'owner-mixed-claude-gpt'].map(id => registry.profiles[id].reviewers.length), [1, 1, 2]);
  for (const rel of ['repo/contracts/source-of-truth-contract.md', 'AGENTS.md', 'README.md']) reviewerCardinalityContract(read(rel), registry);
  const stale = read('repo/contracts/source-of-truth-contract.md').replace('currently contain one, one and two members', 'currently contain two, one and three members');
  assert.throws(() => reviewerCardinalityContract(stale, registry));
  const grown = structuredClone(registry); grown.profiles['owner-gpt'].reviewers.push({ reviewer_id: 'extra' });
  assert.throws(() => reviewerCardinalityContract(read('repo/contracts/source-of-truth-contract.md'), grown),
    'a registry change cannot pass against stale prose');
});

test('documented retention clocks match the implemented constants', () => {
  const retention = require('../scripts/toolkit-custody-retention-v3.cjs');
  assert.equal(retention.REMOTE_BULK_RETENTION_MS, 21 * DAY_MS);
  assert.equal(retention.TRANSFER_RETENTION_MS, 21 * DAY_MS);
  assert.equal(retention.LEGACY_REMOTE_BULK_RETENTION_MS, 30 * DAY_MS);
  const v3 = section(read('repo/docs/TOOLKIT-V3.md'), 13);
  assert.match(v3, /Current v2 remote temporary bulk expires exactly 21 days after its immutable verified-transfer timestamp/);
  assert.match(v3, /Historical v1 records keep an explicit 30-day legacy clock/);
  assert.match(current(read('repo/CONTROLLER.md')), /Current v2 stored temporary owned bulk expires 21 days after its immutable verified transfer.*Historical v1 records keep their read-only 30-day legacy clock/);
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
  assert.ok(commands >= 10, 'the documented bridge command surface is exercised');
}

test('present surfaces document only the portable Antigravity route that the bridge accepts', () => {
  const { parseArgs } = require('../scripts/toolkit-local-bridge.cjs');
  const texts = Object.fromEntries(ANTIGRAVITY_SURFACES.map(rel => [rel, read(rel)]));
  antigravityPortableContract(texts, parseArgs);
  assert.throws(() => parseArgs(['--enable-target', 'ag2']), /AG2 native\/plugin target is unsupported/);
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
