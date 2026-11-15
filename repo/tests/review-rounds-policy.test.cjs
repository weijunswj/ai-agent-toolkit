'use strict';

// Review-round rules: G0 slices with acceptance tests, the builder's same-session self-check,
// finding severities (High and Medium block, Low becomes a follow-up record), rechecks scoped to the
// fix, and small fixes batched into the next slice. Limits stop review looping: a blocker needs
// proof, rechecks after a FAIL are scope-locked, and a third FAIL round needs the owner's card answer.
// The negative checks stop a later edit from quietly letting proved High or Medium findings through.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { controllerText } = require('./support/controller-text.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const flat = text => text.replace(/\s+/g, ' ');

const GATE = flat(read('repo/contracts/agent-rules/gate-rules.md'));
const CONTROLLER = flat(controllerText());
const DELIVERY = flat(read('repo/docs/TOOLKIT-DELIVERY.md'));
const SKILL = flat(read('repo/contracts/claude-projects/web-controller-projects/SKILL.md'));

test('G0 returns small slices with acceptance tests', () => {
  assert.match(GATE, /small slices \(one reviewable PR each\) with acceptance tests \(action, expected result, test file\)/);
  assert.match(DELIVERY, /small slices, one reviewable PR each, and writes each slice's acceptance tests/);
});

test('G1 self-checks in the same session and that replaces no review', () => {
  assert.match(GATE, /self-checks its diff against the G2 review section in the same session/);
  assert.match(GATE, /this replaces no review/);
  assert.match(DELIVERY, /self-checks its diff against the gate rules' G2 review section in the same session/);
});

test('High and Medium findings block; Low never blocks and is recorded', () => {
  assert.match(GATE, /High breaks an agreed criterion or the safety floor/);
  assert.match(GATE, /Medium is a plausible supported-path break/);
  assert.match(GATE, /both block/);
  assert.match(GATE, /Low is anything else, never blocks and joins one follow-up record per PR/);
  assert.doesNotMatch(GATE, /Medium[^.;]*never blocks/);
  assert.doesNotMatch(GATE, /High[^.;]*never blocks/);
  assert.match(DELIVERY, /\| Current ship blocker \(High or Medium\) \|/);
  assert.match(DELIVERY, /\| Follow-up \(Low\) \|/);
  assert.match(DELIVERY, /\| Later or optional \(Low\) \|/);
  assert.match(DELIVERY, /review, custody, integration, publication, installation, Core release and parent completion separately/);
});

test('correction rechecks review the fix, and post-PASS deltas are unchanged', () => {
  assert.match(GATE, /review the fix commits, closed findings and dependent invariants, widening to the whole diff only where a fix reaches beyond them/);
  assert.match(GATE, /Each delta G2 covers the whole diff since the last PASS/);
  assert.match(GATE, /rechecks target corrected boundary families rather than restarting discovery/);
});

test('CONTROLLER maps severities, scopes rechecks and batches small fixes', () => {
  assert.match(CONTROLLER, /ship blocker \(High or Medium, gate rules\), follow-up \(Low or `POST_SHIP`; one record per PR, on its area's open child, which joins the lane's next slice or starts within 3 days, unless the owner accepted it\)/);
  assert.match(CONTROLLER, /fresh rechecks target fix commits/);
  assert.match(CONTROLLER, /\*\*Batch small fixes:\*\* a small fix joins the lane's next slice not yet in review/);
  assert.match(CONTROLLER, /the slice takes its highest tier/);
  assert.match(CONTROLLER, /Plausible supported-path violations or critical missing proof block/);
});

test('Projects briefs keep review rounds short', () => {
  assert.match(SKILL, /\*\*Briefs keep review rounds short\.\*\*/);
  assert.match(SKILL, /Relay Low findings as one follow-up line, never as a blocker/);
  assert.match(SKILL, /unless `CONTROLLER\.md` batching lets it go alone \(a default-branch repair, a safety-floor gap or a fix that unblocks work\)/);
});

test('a blocking finding needs proof; unproven Medium is Low, unproven High goes to the owner', () => {
  assert.match(GATE, /both block only with proof: a failing test or a supported-path trace with the reason \(missing proof: name what is absent\)/);
  assert.match(GATE, /An unproven Medium becomes Low; an unproven High goes to the owner's card and does not block alone/);
  assert.doesNotMatch(GATE, /unproven High[^.;]*(becomes Low|is dropped|joins the follow-up)/);
  assert.match(DELIVERY, /the failing test or trace proving it \(an unproven Medium is a follow-up; an unproven High goes to the owner\)/);
  assert.match(CONTROLLER, /Plausible supported-path violations or critical missing proof block/);
});

test('rechecks after a FAIL are scope-locked; proved High on untouched code still blocks', () => {
  assert.match(GATE, /\*\*Scope lock:\*\* after a FAIL, rechecks review only the fix commits, earlier findings and what the fixes reach; a new finding on code no fix touched blocks only if High and proved, else joins the follow-up record/);
  assert.match(SKILL, /every recheck brief names the fix commits, the findings they close, the scope lock and the PR's FAIL count/);
  assert.match(DELIVERY, /Rechecks after a FAIL are scope-locked to the fix/);
});

test('round cap: two FAIL verdicts hold the next round for the owner card', () => {
  assert.match(GATE, /\*\*Round cap:\*\* after two FAIL verdicts on one PR \(`Toolkit-G2: FAIL` comments, deltas included, since the owner last answered it\), no round starts until the owner answers a card/);
  assert.match(GATE, /ship with open items as follow-ups \(if none breaks the shipping floor\), one more round, or split the PR\. One more round allows one; the card precedes any family reassessment/);
  assert.match(GATE, /after two NOT PASSED rechecks of one family a consolidated root-cause reassessment comes first/);
  assert.match(CONTROLLER, /Before any recheck, count the PR's FAIL verdict comments; at two, hold and ask the owner with the host's question UI \(gate rules' round cap\)/);
  assert.match(SKILL, /at two FAILs, post the round-cap card first \(gate rules\)/);
  assert.match(DELIVERY, /after two FAIL verdicts on one PR no further round starts until the owner answers the gate rules' round-cap card/);
});
