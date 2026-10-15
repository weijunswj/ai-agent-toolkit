'use strict';

// Proposal-contract coverage only; this does not prove runtime enforcement.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const directive = fs.readFileSync(path.join(__dirname, '..', 'docs', 'TOOLKIT-V3.md'), 'utf8');

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
  assert.match(discovery, /After discovery, G0 records the evidence and recommended direction in the current delivery packet/);
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
  assert.match(discovery, /records the evidence and recommended direction in the current delivery packet/);
  assert.match(discovery, /within approved scope and current authority, continue already-authorised G1 without renewed semantic approval/);
  assert.match(discovery, /Preserve the actual G0-to-G1 role\/context handoff/);
  assert.match(discovery, /material scope, trust, security, risk, spend, consent or acceptance changes, remain owner decisions/);
  const acceptance = section(text, 18);
  assert.match(acceptance, /Record discovery evidence and recommended direction in the current delivery packet; within approved scope and current authority, continue already-authorised G1 without renewed semantic approval/);
  assert.match(acceptance, /Preserve owner boundaries, routine technical decisions with the strong lead, the actual G0-to-G1 role\/context handoff, same-G0 context reuse and independent final review/);
}

test('approved G0 direction is recorded and continues into G1 without another semantic approval', () => {
  authorisedContinuationContract(directive);
  for (const [before, after] of [
    ['Routine technical decisions remain with the strong lead', 'Routine technical decisions require owner approval'],
    ['records the evidence and recommended direction in the current delivery packet', 'keeps the evidence and recommended direction only in chat'],
    ['within approved scope and current authority, continue already-authorised G1 without renewed semantic approval', 'within approved scope and current authority, wait for renewed semantic approval before G1'],
    ['Preserve the actual G0-to-G1 role/context handoff', 'Omit the G0-to-G1 role/context handoff'],
    ['material scope, trust, security, risk, spend, consent or acceptance changes, remain owner decisions', 'material scope, trust, security, risk, spend, consent or acceptance changes, become executor decisions'],
    ['Record discovery evidence and recommended direction in the current delivery packet; within approved scope and current authority, continue already-authorised G1 without renewed semantic approval', 'After discovery, always request another semantic approval before G1']
  ]) {
    assert.ok(directive.includes(before), `mutation target exists: ${before}`);
    assert.throws(() => authorisedContinuationContract(directive.replace(before, after)), `reject continuation regression: ${before}`);
  }
});

function checkpointContinuationContract(text) {
  const context = section(text, 7);
  assert.match(context, /An execution segment is a bounded working slice within the assignment/);
  assert.match(context, /For the approved whole-phase Core assignment, planned G1 segment completion alone requires a recoverable checkpoint and continuation in the same working session, not fresh-context renewal/);
  assert.doesNotMatch(context, /after each planned G1 segment before the next/);
  assert.match(context, /Fresh executor contexts are mandatory between G0 and G1, for initial G2/);
  assert.match(context, /required model\/effort\/harness switch, runtime\/environment replacement, changed active instruction\/profile configuration or executor replacement/);
  assert.match(context, /genuine session loss or actual context-capacity limits, including forced compaction/);
  assert.match(context, /ordinary commit, test, helper return, tool call, internal milestone or evidence upload does not require renewal/);
  assert.match(section(text, 18), /Planned G1 segment completion alone checkpoints and continues the approved whole-phase Core in the same session; actual required renewal and fresh independent review remain binding/);
}

test('whole-phase G1 checkpoints and continues while genuine renewal boundaries remain', () => {
  checkpointContinuationContract(directive);
  for (const [before, after] of [
    ['An execution segment is a bounded working slice within the assignment', 'An execution segment is a bounded working slice between renewal boundaries'],
    ['planned G1 segment completion alone requires a recoverable checkpoint and continuation in the same working session, not fresh-context renewal', 'planned G1 segment completion always requires a fresh executor'],
    ['for initial G2', 'without fresh initial G2'],
    ['required model/effort/harness switch, runtime/environment replacement, changed active instruction/profile configuration or executor replacement', 'optional model or runtime changes'],
    ['genuine session loss or actual context-capacity limits, including forced compaction', 'ordinary status observations'],
    ['Planned G1 segment completion alone checkpoints and continues the approved whole-phase Core in the same session; actual required renewal and fresh independent review remain binding', 'Every planned segment launches a fresh executor']
  ]) {
    assert.ok(directive.includes(before), `mutation target exists: ${before}`);
    assert.throws(() => checkpointContinuationContract(directive.replace(before, after)), `reject renewal regression: ${before}`);
  }
  assert.throws(() => checkpointContinuationContract(directive.replace(
    'Fresh executor contexts are mandatory between G0 and G1, for initial G2',
    'Fresh executor contexts are mandatory between G0 and G1, after each planned G1 segment before the next, for initial G2'
  )), 'reject contradictory segment-only mandatory renewal');
});

function conditionalSuccessorContract(text) {
  const context = section(text, 7);
  assert.match(context, /When renewal is actually required, bind the next segment to its checkpoint and durable successor identity/);
  assert.match(context, /Launch exactly one successor only for that required renewal when the next work is authorised and its dependencies are satisfied/);
  assert.match(context, /checkpoint-only save persists changed recoverable state and the current executor continues its safe authorised work/);
  assert.match(context, /checkpoint save\/verification failure is a recovery boundary.*not an automatic successor-launch trigger/s);
  const acceptance = section(text, 18);
  assert.match(acceptance, /Test the actual supported controller\/launcher continuation path when section 7 requires renewal/);
  assert.match(acceptance, /\| 1\. Required renewal at a completed segment \| An actual section 7 renewal trigger, verified checkpoint, stopped old writer, satisfied dependencies and an already-authorised next segment cause exactly one successor/);
  assert.match(acceptance, /Renew only when section 7 requires it, into authorised repair\/validation when safe/);
}

test('successor launch and its acceptance cases require an actual renewal trigger', () => {
  conditionalSuccessorContract(directive);
  for (const [before, after] of [
    ['When renewal is actually required, bind the next segment', 'Always bind the next segment'],
    ['Launch exactly one successor only for that required renewal', 'Launch exactly one successor after every segment'],
    ['not an automatic successor-launch trigger', 'an automatic successor-launch trigger'],
    ['continuation path when section 7 requires renewal', 'continuation path after every planned segment'],
    ['An actual section 7 renewal trigger, verified checkpoint', 'A verified checkpoint'],
    ['Renew only when section 7 requires it, into authorised repair/validation when safe', 'Always renew into authorised repair/validation']
  ]) {
    assert.ok(directive.includes(before), `mutation target exists: ${before}`);
    assert.throws(() => conditionalSuccessorContract(directive.replace(before, after)), `reject successor regression: ${before}`);
  }
});

test('Discuss shares Discovery agent and selected route without a peer or new gate', () => {
  const discovery = section(directive, 5);
  const routing = section(directive, 10);
  assert.match(discovery, /same main agent and exact stack-selected model\/effort binding as G0\.Discovery/);
  assert.match(discovery, /no separate gate, standing peer agent or additional model route/);
  assert.match(routing, /G0\.Discuss resolves to the same selected lead binding as G0\.Discovery/);
  assert.match(routing, /no separate registry role or hardcoded provider\/model/);
  for (const stack of ['owner-gpt', 'owner-claude', 'owner-mixed-claude-gpt']) {
    assert.ok(routing.includes(`\`${stack}\``), `retained explicit stack: ${stack}`);
  }
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

test('adoption is prospective and keeps the three-role workflow and implementation claims honest', () => {
  assert.equal((directive.match(/^## \d+\. /gm) || []).length, 20);
  assert.match(section(directive, 1), /G0 Discuss\/Discovery.*G1 Builder, including UAT.*G2 Review/);
  assert.match(section(directive, 18), /G0 consideration and discussion/);
  const provenance = section(directive, 20);
  assert.match(provenance, /15 October 2026.*mandatory consideration, conditional discussion/s);
  assert.match(provenance, /future G0 admissions only/);
  assert.match(provenance, /Preserve every in-flight contract and its pinned proposal revision/);
  assert.match(provenance, /does not establish runtime enforcement, installation or broad repository activation/);
});
