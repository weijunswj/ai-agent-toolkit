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
  assert.match(discovery, /better idea, disagreement or material question.*returns it to the accountable controller for discussion and agreement before proceeding/s);
  assert.match(discovery, /agrees and the scope is clear, it proceeds directly with discovery without a forced extra turn/);
  assert.match(discovery, /must not choose an unresolved direction autonomously or manufacture a debate/);
  assert.match(discovery, /After discovery, G0 returns the evidence and recommended direction to the accountable controller/);
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
