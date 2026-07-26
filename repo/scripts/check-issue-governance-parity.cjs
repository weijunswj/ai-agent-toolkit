#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function read(rel) { return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'); }
function readJson(rel) { return JSON.parse(read(rel)); }

const errors = [];
function fail(msg) { errors.push(msg); }

const policy = readJson('_projects/development/issue-governance/_main/policy/issue-governance-policy.json');
const schema = readJson('_projects/development/issue-governance/_main/schema/issue-snapshot.schema.json');

const policyVersion = policy.policy_version;
const snapshotVersion = schema.properties.snapshot_version.const;
const policyCodes = Object.keys(policy.finding_codes).sort();

const { DETECTOR_REGISTRY } = require('./lib/detectors/index');
const registryCodes = Object.keys(DETECTOR_REGISTRY).sort();

const policySet = new Set(policyCodes);
const registrySet = new Set(registryCodes);

for (const code of policySet) {
  if (!registrySet.has(code)) fail('Policy finding code ' + code + ' missing from detector registry');
}
for (const code of registrySet) {
  if (!policySet.has(code)) fail('Registry code ' + code + ' not in canonical policy');
}

for (const code of registrySet) {
  const val = DETECTOR_REGISTRY[code];
  if (typeof val !== 'function') fail('Registry entry ' + code + ' is not a function');
}

for (const code of policySet) {
  const meta = policy.finding_codes[code];
  if (!meta || typeof meta !== 'object') { fail('Policy code ' + code + ' has no metadata object'); continue; }
  if (!meta.severity) fail('Policy code ' + code + ' missing severity');
  if (!meta.group) fail('Policy code ' + code + ' missing group');
  if (!meta.messages || typeof meta.messages !== 'object') fail('Policy code ' + code + ' missing messages');

  if (meta.messages) {
    for (const [mkey, mspec] of Object.entries(meta.messages)) {
      if (!mspec.template) fail('Policy code ' + code + ' message ' + mkey + ' missing template');
      const ctx = mspec.context || {};
      for (const [ckey, cs] of Object.entries(ctx)) {
        if (!cs.type) fail('Policy code ' + code + ' message ' + mkey + ' context ' + ckey + ' missing type');
        if (cs.type === 'integer' && (cs.minimum === undefined || cs.maximum === undefined)) {
        }
      }
    }
  }
}

const MODES_KEYS = Object.keys(policy.governance_modes).sort();
if (JSON.stringify(MODES_KEYS) !== JSON.stringify(['repository_native', 'toolkit_governed', 'unknown'])) {
  fail('Governance modes mismatch');
}

const requiredSectionDims = [];
for (const [cat, def] of Object.entries(policy.issue_categories)) {
  if (def.required_sections) requiredSectionDims.push(...def.required_sections);
}
const uniqueDims = [...new Set(requiredSectionDims)].sort();

const sectionHandlers = require('./lib/detectors/shared/section-handlers');
const handlerKeys = Object.keys(sectionHandlers.HANDLER_REGISTRY).sort();

for (const dim of uniqueDims) {
  if (!handlerKeys.includes(dim)) fail('Required section dimension ' + dim + ' missing from HANDLER_REGISTRY');
}
for (const hk of handlerKeys) {
  if (!uniqueDims.includes(hk)) fail('HANDLER_REGISTRY key ' + hk + ' not declared as required_section in any category');
}

const auditReadme = read('_projects/development/issue-governance/_main/audit/README.md');
if (!auditReadme.includes('Policy version: ' + policyVersion)) {
  fail('audit/README.md does not declare policy version ' + policyVersion);
}

const templates = [
  '_projects/development/issue-governance/_main/templates/lean-parent-tracker.md',
  '_projects/development/issue-governance/_main/templates/comprehensive-child-issue.md',
  '_projects/development/issue-governance/_main/templates/reduced-atomic-child.md'
];
for (const t of templates) {
  const text = read(t);
  if (!text.includes('**Policy version:** ' + policyVersion)) {
    fail(t + ' does not declare policy version ' + policyVersion);
  }
}

const curatedSkill = read('_projects/development/issue-governance/curated_output_for_ai/skills/issue-governance/SKILL.md');
if (!curatedSkill.includes('Policy version: ' + policyVersion)) {
  fail('curated SKILL.md does not declare policy version ' + policyVersion);
}

const curatedReadme = read('_projects/development/issue-governance/curated_output_for_ai/skills/issue-governance/README.md');
if (!curatedReadme.includes('Policy version: ' + policyVersion)) {
  fail('curated README.md does not declare policy version ' + policyVersion);
}

const docs = read('repo/docs/ISSUE-GOVERNANCE.md');
if (!docs.includes(policyVersion)) {
  fail('ISSUE-GOVERNANCE.md does not reference policy version ' + policyVersion);
}

const publishedSkill = read('skills/issue-governance/SKILL.md');
if (!publishedSkill.includes('Policy version: ' + policyVersion)) {
  fail('published SKILL.md does not declare policy version ' + policyVersion);
}

if (errors.length > 0) {
  console.error('Semantic parity check found ' + errors.length + ' issue(s):');
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

console.log('Semantic parity check passed for policy v' + policyVersion + ', schema v' + snapshotVersion + '.');
console.log('  Finding codes: ' + policyCodes.length);
console.log('  Registry codes: ' + registryCodes.length);
console.log('  All policy codes have severity, group and messages.');
process.exit(0);
