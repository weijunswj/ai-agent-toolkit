'use strict';

// Review-round rules: G0 slices with acceptance tests, the builder's same-session self-check,
// finding severities (High and Medium block, Low becomes a follow-up record), rechecks scoped to the
// fix, and small fixes batched into the next slice. The negative checks stop a later edit from
// quietly letting High or Medium findings through.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..', '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const flat = text => text.replace(/\s+/g, ' ');

const GATE = flat(read('repo/contracts/agent-rules/gate-rules.md'));
const CONTROLLER = flat(read('repo/CONTROLLER.md'));
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
});

test('correction rechecks review the fix, and post-PASS deltas are unchanged', () => {
  assert.match(GATE, /review the fix commits, closed findings and dependent invariants, widening to the whole diff only where a fix reaches beyond them/);
  assert.match(GATE, /Each delta G2 covers the whole diff since the last PASS/);
  assert.match(GATE, /rechecks target corrected boundary families rather than restarting discovery/);
});

test('CONTROLLER maps severities, scopes rechecks and batches small fixes', () => {
  assert.match(CONTROLLER, /ship blocker \(High or Medium, gate rules\), follow-up \(Low;/);
  assert.match(CONTROLLER, /fresh rechecks target fix commits/);
  assert.match(CONTROLLER, /\*\*Batch small fixes:\*\* a small fix joins the lane's next slice not yet in review/);
  assert.match(CONTROLLER, /the slice takes its highest tier/);
  assert.match(CONTROLLER, /Plausible supported-path violations or critical missing proof block/);
});

test('Projects briefs keep review rounds short', () => {
  assert.match(SKILL, /\*\*Briefs keep review rounds short\.\*\*/);
  assert.match(SKILL, /every recheck brief names the fix commits and the findings they close/);
  assert.match(SKILL, /Relay Low findings as one follow-up line, never as a blocker/);
});
