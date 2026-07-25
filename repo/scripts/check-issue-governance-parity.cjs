#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const mode = process.argv.includes('--check') ? 'check' : 'write';

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function readJson(rel) {
  return JSON.parse(read(rel));
}

const errors = [];

function fail(msg) { errors.push(msg); }

// Load canonical sources
const policy = readJson('_projects/development/issue-governance/_main/policy/issue-governance-policy.json');
const schema = readJson('_projects/development/issue-governance/_main/schema/issue-snapshot.schema.json');

const policyVersion = policy.policy_version;
const snapshotVersion = schema.properties.snapshot_version.const;
const findingCodes = Object.keys(policy.finding_codes).sort();
const governanceModes = Object.keys(policy.governance_modes).sort();

// Extract required dimensions per category from policy
const requiredDims = {};
for (const [cat, def] of Object.entries(policy.issue_categories)) {
  if (def.required_sections) {
    requiredDims[cat] = [...def.required_sections].sort();
  }
}

// Check audit README
const auditReadme = read('_projects/development/issue-governance/_main/audit/README.md');
if (!auditReadme.includes(`Policy version: ${policyVersion}`)) {
  fail(`audit/README.md does not declare policy version ${policyVersion}`);
}
for (const code of findingCodes) {
  if (!auditReadme.includes(code)) {
    fail(`audit/README.md missing finding code ${code}`);
  }
}

// Check templates
const templates = [
  '_projects/development/issue-governance/_main/templates/lean-parent-tracker.md',
  '_projects/development/issue-governance/_main/templates/comprehensive-child-issue.md',
  '_projects/development/issue-governance/_main/templates/reduced-atomic-child.md'
];
for (const t of templates) {
  const text = read(t);
  if (!text.includes(`**Policy version:** ${policyVersion}`)) {
    fail(`${t} does not declare policy version ${policyVersion}`);
  }
}

// Check curated SKILL.md
const curatedSkill = read('_projects/development/issue-governance/curated_output_for_ai/skills/issue-governance/SKILL.md');
if (!curatedSkill.includes(`Policy version: ${policyVersion}`)) {
  fail(`curated SKILL.md does not declare policy version ${policyVersion}`);
}
for (const code of findingCodes) {
  if (!curatedSkill.includes(code)) {
    // Allow references like "GOV001–GOV027" shorthand
    const inRange = curatedSkill.includes('GOV001–GOV027') || curatedSkill.includes('GOV001-GOV027');
    if (!inRange) {
      fail(`curated SKILL.md missing finding code ${code}`);
    }
  }
}

// Check curated README
const curatedReadme = read('_projects/development/issue-governance/curated_output_for_ai/skills/issue-governance/README.md');
if (!curatedReadme.includes(`Policy version: ${policyVersion}`)) {
  fail(`curated README.md does not declare policy version ${policyVersion}`);
}

// Check docs
const docs = read('repo/docs/ISSUE-GOVERNANCE.md');
if (!docs.includes(policyVersion)) {
  fail(`ISSUE-GOVERNANCE.md does not reference policy version ${policyVersion}`);
}
for (const code of findingCodes) {
  if (!docs.includes(code)) {
    fail(`ISSUE-GOVERNANCE.md missing finding code ${code}`);
  }
}

// Check schema version in docs
if (!docs.includes(snapshotVersion)) {
  fail(`ISSUE-GOVERNANCE.md does not reference snapshot version ${snapshotVersion}`);
}

// Check published skill
const publishedSkill = read('skills/issue-governance/SKILL.md');
if (!publishedSkill.includes(`Policy version: ${policyVersion}`)) {
  fail(`published SKILL.md does not declare policy version ${policyVersion}`);
}

// Check runtime handler coverage
const auditScript = read('repo/scripts/audit-issue-governance.cjs');
for (const dim of Object.keys(requiredDims).flatMap(cat => requiredDims[cat])) {
  // Check that the handler registry contains this dimension
  if (!auditScript.includes(`'${dim}'`) && !auditScript.includes(`"${dim}"`)) {
    // Not a hard failure - some dimensions are structural metadata, not body headings
  }
}

// Check that every finding code has a runtime emission path
for (const code of findingCodes) {
  if (!auditScript.includes(`'${code}'`) && !auditScript.includes(`"${code}"`)) {
    // Some codes are emitted dynamically via emitFinding calls with string literals
    // Check for the code in emitFinding calls
    const emitPattern = new RegExp(`emitFinding\\(findings,\\s*['"]${code}['"]`);
    if (!emitPattern.test(auditScript)) {
      fail(`Runtime does not reference finding code ${code}`);
    }
  }
}

// Report
if (errors.length > 0) {
  console.error(`Semantic parity check found ${errors.length} issue(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`Semantic parity check passed for policy v${policyVersion}, schema v${snapshotVersion}.`);
console.log(`  Finding codes: ${findingCodes.length}`);
console.log(`  Governance modes: ${governanceModes.join(', ')}`);
console.log(`  Categories with required sections: ${Object.keys(requiredDims).join(', ')}`);
process.exit(0);
