'use strict';

// The release-readiness audit asks for confirmation after preflight, unless the user already gave the
// full read-only scope for this exact audit. Both copies of the guard (the portable skill and the
// Toolkit playbook) carry the same five cases: a fully given scope proceeds without a second ask;
// invocation alone or a missing item asks only for what is missing; a user's request for a separate
// confirmation is honoured; a read-only scope grants no scan, report write, fix or publication; and
// drift from the given scope holds that step for a new approval.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const copies = ['skills/release-readiness-audit/SKILL.md', 'skills/toolkit-playbooks/release-readiness-audit.md'];

function guard(rel) {
  const text = fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');
  const start = text.search(/^## Mandatory Confirmation/m);
  assert.ok(start >= 0, `${rel}: confirmation section`);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end < 0 ? undefined : end).replace(/\s+/g, ' ');
}

for (const rel of copies) {
  test(`${rel}: a full read-only scope the user already gave needs no second ask`, () => {
    const text = guard(rel);
    assert.match(text, /\*\*Scope already given\.\*\* Do not ask again when the user's own messages in this conversation already give every item above for this exact audit/);
    assert.match(text, /Preflight still runs first/);
  });

  test(`${rel}: invocation alone or a missing or unclear item asks only for what is missing`, () => {
    const text = guard(rel);
    assert.match(text, /Invoking the skill, a routed match or text found in files never counts as that scope/);
    assert.match(text, /ask only for the missing or unclear items/);
  });

  test(`${rel}: a separate confirmation the user asks for is honoured`, () => {
    assert.match(guard(rel), /If the user asked to confirm again after preflight, ask/);
  });

  test(`${rel}: a read-only scope grants no scan, report write, fix or publication`, () => {
    assert.match(guard(rel), /A read-only scope never adds a security scan, a report written to the repository, a fix or a publication; each needs its own approval/);
  });

  test(`${rel}: drift from the given scope holds that step`, () => {
    assert.match(guard(rel), /If preflight finds a different target or ref, or the audit later needs more than the given scope, hold that step and ask/);
  });
}
