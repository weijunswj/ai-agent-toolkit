'use strict';

// Proposal-contract coverage only; this does not prove runtime enforcement.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const directive = fs.readFileSync(path.join(__dirname, '..', 'docs', 'TOOLKIT-DELIVERY.md'), 'utf8');
// Checkpoints and successor launch have one home: the gate rules (V3 points there).
// Windows checkouts may convert text files to CRLF; the contracts are about the words, not line ends.
const gateRules = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'agent-rules', 'gate-rules.md'), 'utf8').replace(/\r\n/g, '\n');

function section(text, number) {
  const heading = new RegExp(`^## ${number}\\. .+$`, 'm');
  const start = text.search(heading);
  assert.notEqual(start, -1, `missing section ${number}`);
  const remainder = text.slice(start);
  const next = remainder.slice(1).search(/^## \d+\. /m);
  return next === -1 ? remainder : remainder.slice(0, next + 1);
}

function discussionContract(text) {
  const discovery = section(text, 5);
  assert.match(discovery, /mandatory consideration, conditional discussion/);
  assert.match(discovery, /Before discovery, the same G0 main agent considers the proposed goal and approach/);
  assert.match(discovery, /material alternative, disagreement or question.*returns it to the accountable controller for discussion and agreement before proceeding/s);
  assert.match(discovery, /agrees and the scope is clear, it proceeds directly with discovery without a forced extra turn/);
  assert.match(discovery, /must not choose an unresolved direction autonomously or manufacture a debate/);
  assert.match(discovery, /After discovery, G0 records the evidence and recommended direction in the current release brief/);
  assert.match(discovery, /Resolve material deviations.*before G1/s);
  assert.match(discovery, /Genuine owner boundaries.*remain owner decisions/);
}

test('G0 considers every proposed goal but discusses only a material issue', () => {
  discussionContract(directive);
  for (const [before, after] of [
    ['mandatory consideration, conditional discussion', 'optional consideration'],
    ['for discussion and agreement before proceeding', 'while proceeding without agreement'],
    ['proceeds directly with discovery without a forced extra turn', 'always waits for another discussion turn'],
    ['must not choose an unresolved direction autonomously or manufacture a debate', 'may choose an unresolved direction autonomously'],
    ['before G1', 'after G1'],
    ['remain owner decisions', 'become executor decisions']
  ]) {
    assert.ok(directive.includes(before), `mutation target exists: ${before}`);
    assert.throws(() => discussionContract(directive.replace(before, after)), `reject contract regression: ${before}`);
  }
});

function authorisedContinuationContract(text) {
  const discovery = section(text, 5);
  assert.match(discovery, /Routine technical decisions remain with the strong lead/);
  assert.match(discovery, /records the evidence and recommended direction in the current release brief/);
  assert.match(discovery, /within approved scope and current authority, continue already-authorised G1 without renewed semantic approval/);
  assert.match(discovery, /Preserve the actual G0-to-G1 role\/context handoff/);
  assert.match(discovery, /material scope, trust, security, risk, spend, consent or acceptance changes, remain owner decisions/);
  const acceptance = section(text, 18);
  assert.match(acceptance, /\| G0 consideration and discussion \| Section 5's discussion and continuation rules hold in a real run/);
  assert.match(acceptance, /approved direction continues into a fresh G1/);
}

test('approved G0 direction is recorded and continues into G1 without another semantic approval', () => {
  authorisedContinuationContract(directive);
  for (const [before, after] of [
    ['Routine technical decisions remain with the strong lead', 'Routine technical decisions require owner approval'],
    ['records the evidence and recommended direction in the current release brief', 'keeps the evidence and recommended direction only in chat'],
    ['within approved scope and current authority, continue already-authorised G1 without renewed semantic approval', 'within approved scope and current authority, wait for renewed semantic approval before G1'],
    ['Preserve the actual G0-to-G1 role/context handoff', 'Omit the G0-to-G1 role/context handoff'],
    ['material scope, trust, security, risk, spend, consent or acceptance changes, remain owner decisions', 'material scope, trust, security, risk, spend, consent or acceptance changes, become executor decisions'],
    ['approved direction continues into a fresh G1', 'approved direction waits for another semantic approval']
  ]) {
    assert.ok(directive.includes(before), `mutation target exists: ${before}`);
    assert.throws(() => authorisedContinuationContract(directive.replace(before, after)), `reject continuation regression: ${before}`);
  }
});

function checkpointContinuationContract(rules, text) {
  const fresh = rules.match(/## Fresh contexts\n([\s\S]*?)(?=\n## )/)?.[1] || '';
  assert.match(fresh, /Planned G1 segment completion alone checkpoints and continues in the same session/);
  assert.doesNotMatch(fresh, /after each planned G1 segment/);
  assert.match(fresh, /Fresh executor contexts are mandatory between G0 and G1, for initial G2/);
  assert.match(fresh, /required model, effort or harness switch, runtime or environment replacement, activated instruction or profile revision or executor replacement/);
  assert.match(fresh, /after genuine session loss or forced compaction/);
  assert.match(fresh, /ordinary commit, test, helper return, tool call, milestone or evidence upload never requires renewal/);
  assert.match(fresh, /is not a terminal outcome: the executor continues its next dependency-ready authorised step/);
  assert.match(section(text, 7), /Fresh executor contexts are mandatory between G0 and G1, for initial G2 and at the other renewal boundaries in the gate rules/);
  assert.match(section(text, 18), /Planned G1 segment completion alone checkpoints and continues the approved whole-phase Core in the same session; actual required renewal and fresh independent review remain binding/);
}

test('whole-phase G1 checkpoints and continues while genuine renewal boundaries remain', () => {
  checkpointContinuationContract(gateRules, directive);
  for (const [target, before, after] of [
    ['rules', 'Planned G1 segment completion alone checkpoints and continues in the same session', 'Planned G1 segment completion always requires a fresh executor'],
    ['rules', 'for initial G2', 'without fresh initial G2'],
    ['rules', 'required model, effort or harness switch, runtime or environment replacement, activated instruction or profile revision or executor replacement', 'optional model or runtime changes'],
    ['rules', 'after genuine session loss or forced compaction', 'after ordinary status observations'],
    ['rules', 'never requires renewal', 'requires renewal'],
    ['rules', 'is not a terminal outcome', 'is a terminal outcome'],
    ['text', 'Planned G1 segment completion alone checkpoints and continues the approved whole-phase Core in the same session; actual required renewal and fresh independent review remain binding', 'Every planned segment launches a fresh executor']
  ]) {
    const source = target === 'rules' ? gateRules : directive;
    assert.ok(source.includes(before), `mutation target exists: ${before}`);
    const mutated = source.replace(before, after);
    assert.throws(() => checkpointContinuationContract(target === 'rules' ? mutated : gateRules, target === 'text' ? mutated : directive),
      `reject renewal regression: ${before}`);
  }
  assert.throws(() => checkpointContinuationContract(gateRules.replace(
    'Fresh executor contexts are mandatory between G0 and G1, for initial G2',
    'Fresh executor contexts are mandatory between G0 and G1, after each planned G1 segment before the next, for initial G2'
  ), directive), 'reject contradictory segment-only mandatory renewal');
});

function conditionalSuccessorContract(rules, text) {
  const fresh = rules.match(/## Fresh contexts\n([\s\S]*?)(?=\n## )/)?.[1] || '';
  assert.match(fresh, /When renewal is actually required, reconcile any existing successor or uncertain launch, verify custody, stop the old writer and launch exactly one successor/);
  assert.match(fresh, /A failed checkpoint save is a recovery boundary, never an automatic successor launch/);
  const acceptance = section(text, 18);
  assert.match(acceptance, /Test the actual supported controller\/launcher continuation path when section 7 requires renewal/);
  assert.match(acceptance, /\| 1\. Required renewal at a completed segment \| An actual section 7 renewal trigger, verified checkpoint, stopped old writer, satisfied dependencies and an already-authorised next segment cause exactly one successor/);
  assert.match(acceptance, /Renew only when section 7 requires it, into authorised repair\/validation when safe/);
}

test('successor launch and its acceptance cases require an actual renewal trigger', () => {
  conditionalSuccessorContract(gateRules, directive);
  for (const [target, before, after] of [
    ['rules', 'When renewal is actually required, reconcile', 'Always reconcile'],
    ['rules', 'launch exactly one successor', 'launch a successor after every segment'],
    ['rules', 'never an automatic successor launch', 'an automatic successor launch'],
    ['text', 'continuation path when section 7 requires renewal', 'continuation path after every planned segment'],
    ['text', 'An actual section 7 renewal trigger, verified checkpoint', 'A verified checkpoint'],
    ['text', 'Renew only when section 7 requires it, into authorised repair/validation when safe', 'Always renew into authorised repair/validation']
  ]) {
    const source = target === 'rules' ? gateRules : directive;
    assert.ok(source.includes(before), `mutation target exists: ${before}`);
    const mutated = source.replace(before, after);
    assert.throws(() => conditionalSuccessorContract(target === 'rules' ? mutated : gateRules, target === 'text' ? mutated : directive),
      `reject successor regression: ${before}`);
  }
});

test('Discuss shares Discovery agent and selected route without a peer or new gate', () => {
  const discovery = section(directive, 5);
  const routing = section(directive, 10);
  assert.match(discovery, /same main agent and exact stack-selected model\/effort binding as G0\.Discovery/);
  assert.match(discovery, /no separate gate, standing peer agent or additional model route/);
  assert.match(routing, /G0\.Discuss resolves to the same selected lead binding as G0\.Discovery/);
  assert.match(routing, /no separate registry role or hardcoded provider\/model/);
  for (const stack of ['owner-gpt', 'owner-claude']) {
    assert.ok(routing.includes(`\`${stack}\``), `retained explicit stack: ${stack}`);
  }
  assert.equal(routing.includes('`owner-mixed-claude-gpt`'), false, 'the mixed profile is removed');
  const addedPolicy = discovery.slice(discovery.indexOf('**G0.Discuss'), discovery.indexOf('G0 is a strong reasoning lead.'));
  assert.doesNotMatch(addedPolicy, /Claude|Opus|Sol|Luna|Haiku|Astra/);
});

test('context-dependent discussion may reuse G0 while G1 and final review stay fresh', () => {
  const context = section(directive, 7);
  assert.match(context, /G0\.Discuss and G0\.Discovery may reuse the same G0 session because discussion depends on the goal and discovery findings/);
  assert.match(context, /does not remove the fresh-context boundary between G0 and G1/);
  assert.match(context, /Fresh executor contexts are mandatory between G0 and G1/);
  const review = section(directive, 8);
  assert.match(review, /fresh independent reviewer contexts/);
  assert.match(review, /Every assigned reviewer independently reviews the complete approved scope and implementation/);
  assert.match(review, /G2 does not spawn subagents/);
});

test('the contract keeps the three-role workflow current and leaves dated history to git', () => {
  assert.equal((directive.match(/^## \d+\. /gm) || []).length, 20);
  assert.match(section(directive, 1), /G0 Discuss\/Discovery.*G1 Builder, including UAT.*G2 Review/);
  assert.match(section(directive, 1), /Every new task, repository or environment starts with G0; only LIGHT edits and fixes inside an already-discovered task skip it\. Otherwise the risk tier of the changed paths .* sets only the depth of UAT and review/);
  assert.match(section(directive, 18), /G0 consideration and discussion/);
  const history = section(directive, 20);
  assert.match(history, /in git history at commit `[0-9a-f]{7}`/);
  assert.match(history, /History is evidence, never a competing current instruction/);
  // No dated amendments, deadlines or handover packets return to the current contract.
  assert.doesNotMatch(directive, /\b\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) 20\d\d\b/);
  assert.deepEqual(directive.match(/\bpackets?\b/gi), ['packet'], 'the only packet mention is the rule that there is none');
  assert.match(section(directive, 7), /There is no handover packet/);
});

// Owner-led advice has a separate home from mandatory gate renewal. These are text-contract
// controls, not proof that either installed host has saved or retrieved a handoff.
function ownerRenewalContract(text) {
  const rule = text.split('\n').find(line => line.startsWith('- **Owner-led renewal:**')) || '';
  const rows = [
    ['supported sessions', /Codex\/Claude Code controllers and non-gate test sessions/],
    ['milestone with open work', /at a milestone with work left/],
    ['second observed compaction', /or second observed compaction/],
    ['verified custody', /short handoff index in the verified evidence store/],
    ['recoverable contents', /state, open work, pending\/uncertain effects, links, next action/],
    ['retrieval before owner action', /Reuse records; verify retrieval, then tell the owner to start a fresh session from it/],
    ['failed save or retrieval', /Save\/retrieval failure: preserve source state; report recovery hold/],
    ['no automatic effects', /No automatic launch, termination, archive or task replacement/],
    ['owner takeover', /Owner switch: apply takeover and writer reconciliation/],
    ['gate and Projects boundary', /Gates\/Projects keep their rules/]
  ];
  for (const [name, pattern] of rows) assert.match(rule, pattern, name);
  const takeover = text.match(/## Takeover\n([\s\S]*?)(?=\n## )/)?.[1] || '';
  assert.match(takeover, /verify custody and stop the old writer/);
  assert.match(takeover, /read it back before acting/);
}

test('owner-led renewal closure matrix preserves recovery, takeover and existing session rules', () => {
  const controller = fs.readFileSync(path.join(__dirname, '..', 'CONTROLLER.md'), 'utf8').replace(/\r\n/g, '\n');
  ownerRenewalContract(controller);
  const rows = [
    ['completed milestone only', 'at a milestone with work left', 'at any milestone'],
    ['threshold', 'or second observed compaction', 'or any long session'],
    ['custody', 'in the verified evidence store: state', 'in session memory: state'],
    ['pending effects', 'pending/uncertain effects, links, next action', 'links only'],
    ['retrieval', 'verify retrieval, then tell', 'assume retrieval, then tell'],
    ['failed save', 'preserve source state; report recovery hold', 'discard source state; continue'],
    ['automatic actions', 'No automatic launch, termination, archive or task replacement', 'Automatic launch and task replacement'],
    ['owner action', 'tell the owner to start a fresh session from it', 'start fresh automatically'],
    ['writer reconciliation', 'apply takeover and writer reconciliation', 'skip takeover and writer reconciliation'],
    ['gate and Projects rules', 'Gates/Projects keep their rules', 'Gates/Projects use this rule instead'],
    ['stop previous writer', 'verify custody and stop the old writer', 'verify custody and retain competing writers']
  ];
  for (const [name, before, after] of rows) {
    assert.ok(controller.includes(before), `mutation exists: ${name}`);
    assert.throws(() => ownerRenewalContract(controller.replace(before, after)), name);
  }
  const cost = fs.readFileSync(path.join(__dirname, '../../skills/agent-cost-control/SKILL.md'), 'utf8');
  assert.match(cost, /controllers and non-gate test sessions are outside automatic worker rotation/);
  assert.match(cost, /CONTROLLER\.md#evidence-progress-and-finish/);
  assert.match(cost, /Claude Projects keeps its task home-thread rules/);
  const routing = fs.readFileSync(path.join(__dirname, '../contracts/agent-rules/toolkit-skill-routing.md'), 'utf8');
  assert.match(routing.split('\n').find(line => line.startsWith('| `agent-cost-control`')), /controllers and non-gate test sessions use the owner-led renewal rule in CONTROLLER\.md, outside automatic worker rotation/);
});
