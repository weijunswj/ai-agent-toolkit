'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const bridge = require('../scripts/toolkit-local-bridge.cjs');

test('AG2 proof is unavailable when supported read-only discovery is absent', () => {
  const result = bridge.ag2SkillsProjectionProof({ discovery: { supported: false, skills_only: true, plugin_authority: false } });
  assert.equal(result.status, 'AG2_PROOF_UNAVAILABLE');
  assert.equal(result.destination_kind, 'unknown');
  assert.equal(result.plugin_authority, false);
});

test('AG2 proof admits only a skills-only supported destination', () => {
  const result = bridge.ag2SkillsProjectionProof({ discovery: {
    supported: true,
    destination_kind: 'supported-skills-directory',
    target_path: 'C:/temporary/ag2-skills',
    skills_only: true,
    plugin_authority: false
  } });
  assert.equal(result.status, 'PROVEN');
  assert.equal(result.skills_only, true);
  assert.equal(result.plugin_authority, false);
  const payloads = bridge.adapterPayloads({ repo_path: process.cwd() }, process.cwd());
  assert.equal(Object.keys(payloads.ag2).some((name) => /(?:^|\/)(?:plugin|installed_version|ai-agent-toolkit-ag2-adapter)\.json$/.test(name)), false);
});
