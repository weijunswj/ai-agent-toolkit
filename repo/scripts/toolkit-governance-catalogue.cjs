'use strict';

// The skill catalogue per governance state. It is computed, never stored: the tier of each
// skill comes from repo/contracts/agent-rules/governance-skill-tiers.json, the skill set from the
// skills/ folders, and the routed set from repo/contracts/agent-rules/toolkit-skill-routing.md.
// `catalogueProblems` is the drift check: a skill without a tier, a tier for a missing skill, or a
// routed skill that does not exist fails it.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const TIERS_REL = 'repo/contracts/agent-rules/governance-skill-tiers.json';
const ROUTING_REL = 'repo/contracts/agent-rules/toolkit-skill-routing.md';
const TIERS_SCHEMA = 'toolkit.governance-skill-tiers.v1';
const TIERS = Object.freeze(['portable', 'governed']);

function loadTiers(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, ...TIERS_REL.split('/')), 'utf8'));
}

// Every skills/<name>/ folder that carries a SKILL.md, sorted.
function skillNames(root = ROOT) {
  return fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(root, 'skills', entry.name, 'SKILL.md')))
    .map(entry => entry.name)
    .sort();
}

// The skill names in the routing table's first column.
function routedSkillNames(root = ROOT) {
  const text = fs.readFileSync(path.join(root, ...ROUTING_REL.split('/')), 'utf8');
  return [...text.matchAll(/^\|\s*`([a-z0-9][a-z0-9-]*)`\s*\|/gm)].map(match => match[1]).sort();
}

function catalogueProblems(root = ROOT) {
  const problems = [];
  let tiers;
  try { tiers = loadTiers(root); } catch { return [`${TIERS_REL} is not readable JSON`]; }
  if (!tiers || tiers.schema !== TIERS_SCHEMA) problems.push(`${TIERS_REL}: schema must be ${TIERS_SCHEMA}`);
  if (!tiers || JSON.stringify(tiers.tiers) !== JSON.stringify(TIERS)) problems.push(`${TIERS_REL}: tiers must be ${TIERS.join(', ')}`);
  const mapping = tiers && tiers.skills && typeof tiers.skills === 'object' && !Array.isArray(tiers.skills) ? tiers.skills : {};
  const skills = skillNames(root);
  for (const name of skills) if (!Object.prototype.hasOwnProperty.call(mapping, name)) problems.push(`skill ${name} has no governance tier in ${TIERS_REL}`);
  for (const [name, tier] of Object.entries(mapping)) {
    if (!skills.includes(name)) problems.push(`${TIERS_REL} names ${name}, which is not a skill under skills/`);
    if (!TIERS.includes(tier)) problems.push(`skill ${name} has an unknown tier ${JSON.stringify(tier)}`);
  }
  const keys = Object.keys(mapping);
  if (keys.join('\n') !== [...keys].sort().join('\n')) problems.push(`${TIERS_REL}: skills must be sorted by name`);
  for (const name of routedSkillNames(root)) if (!skills.includes(name)) problems.push(`${ROUTING_REL} routes ${name}, which is not a skill under skills/`);
  return problems;
}

// Which tiers a state offers. `materialsComplete` matters only for ENABLED.
function tiersFor(state, materialsComplete) {
  if (state === 'ENABLED') return materialsComplete === true ? ['portable', 'governed'] : ['portable'];
  if (state === 'DECLINED' || state === 'PORTABLE') return ['portable'];
  return [];
}

// [{ skill, tier }] offered in that state, sorted by skill name.
function catalogueFor(state, { materialsComplete = false, root = ROOT } = {}) {
  const offered = tiersFor(state, materialsComplete);
  const mapping = loadTiers(root).skills;
  return skillNames(root)
    .filter(name => offered.includes(mapping[name]))
    .map(name => Object.freeze({ skill: name, tier: mapping[name] }));
}

// The catalogue for a governance-state result from toolkit-governance-state.cjs.
function catalogueForState(stateResult, options = {}) {
  return catalogueFor(stateResult.state, { ...options, materialsComplete: stateResult.materials_complete === true });
}

module.exports = Object.freeze({
  TIERS, TIERS_REL, TIERS_SCHEMA, loadTiers, skillNames, routedSkillNames, catalogueProblems, tiersFor, catalogueFor, catalogueForState,
});
