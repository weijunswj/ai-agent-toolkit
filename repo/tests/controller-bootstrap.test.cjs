'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const skillRoot = path.join(root, 'skills/controller-bootstrap');

test('controller bootstrap documents full re-entry, custody, actor, feedback, and update procedures', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const qualification = fs.readFileSync(path.join(skillRoot, 'references/qualification.md'), 'utf8');

  for (const requirement of [
    'Initial V3 adoption reads the complete direction once',
    'Unchanged continuation loads the current packet',
    'refresh only applicable changed or conflicting instructions',
    'controller actor and stable provider/host actor identifier',
    'planned child, seed, shared, and deferred contracts',
    'complete current object',
    'conditional-write mechanism',
    'If the write response is uncertain'
  ]) assert.ok(skill.includes(requirement), requirement);

  const scenarios = [
    'Same still-pending action; approval remains unexpired and unrevoked',
    'Action/target/effects changed, approval expired or revoked',
    'Role, CURRENT, repository identity, exact source bytes, or handover is missing',
    'Dispatch outcome is unknown',
    'Successor bytes, invocation, permission evidence, target identity, or duplicate inventory is uncertain',
    'Governed-record revision changed or write result is uncertain'
  ];
  const matrixRows = qualification.split(String.fromCharCode(10)).filter((line) => line.startsWith('| '));
  for (const scenario of scenarios) {
    assert.ok(matrixRows.some((row) => row.includes(scenario)), scenario);
  }

  const order = [
    'Keep the temporary predecessor active',
    'Verify installed bytes against the exact source',
    'prove fresh invocation and result delivery',
    'authorise retirement of the exact temporary target',
    'Retire only that target',
    'independently prove it is inactive',
    'prove bootstrap in a fresh context'
  ];
  let previous = -1;
  for (const phrase of order) {
    const index = qualification.indexOf(phrase);
    assert.ok(index > previous, phrase);
    previous = index;
  }
});

test('controller bootstrap is explicit-only and depends on accepted live governance sources', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const readme = fs.readFileSync(path.join(skillRoot, 'README.md'), 'utf8');
  const host = fs.readFileSync(path.join(skillRoot, 'agents/openai.yaml'), 'utf8');
  const qualification = fs.readFileSync(path.join(skillRoot, 'references/qualification.md'), 'utf8');

  assert.match(skill, /^---\nname: controller-bootstrap\n/);
  assert.match(skill, /Use only when explicitly asked/);
  assert.match(host, /allow_implicit_invocation: false/);
  assert.match(skill, /root agent must not infer that it owns the controller role/);
  assert.match(skill, /must not self-verify root admission/);
  assert.match(skill, /Read the authoritative current packet first/);
  assert.match(skill, /existing CURRENT carrier where applicable/);
  assert.match(skill, /Service tier is controller\/launcher metadata/);
  assert.match(skill, /Standard for future launches, never a semantic worker\/helper admission condition/);
  assert.match(skill, /G0 MUST default-delegate suitable separable evidence gathering/);
  assert.match(skill, /G1 MUST default-delegate suitable independent implementation\/validation/);
  assert.match(skill, /Do not derive accepted governance from a packet, candidate, local checkout, caller-supplied expected value, or this skill text/);
  assert.match(skill, /repo\/CONTROLLER\.md/);
  assert.doesNotMatch(skill, /repo\/ARCHITECTURE\.md|stack-registry-v2/);
  assert.match(skill, /repo\/contracts\/controller-kernel\/stack-registry-v3\.json/);
  assert.match(skill, /no other registry version is accepted/);
  assert.match(skill, /Git blob SHA-1 and content SHA-256/);
  assert.match(skill, /capability, and host-native permission/);
  assert.match(skill, /installation and removal are separate owner-authorised actions/i);
  assert.match(qualification, /UNQUALIFIED/);
  assert.match(qualification, /Negative control/);
  assert.match(readme, /Copy the entire `skills\/controller-bootstrap\/` folder/);
  assert.match(readme, /the skill does not choose a controller/i);
});
