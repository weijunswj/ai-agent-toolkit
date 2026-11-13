'use strict';

// A preview's bank reference must be the one the run accepts. `--plan` once filled every answer with
// its recommendation before working out the reference, so a run never accepted a preview's reference
// and showed the owner a new bank.

const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../scripts/setup-toolkit-core.cjs');

const reference = specs => core.renderSetupQuestionBank(specs).match(/Bank reference: (\S+)/)[1];

// The documentation state, and the state right after `remove toolkit`: no update copy and no Codex plugin.
function states() {
  const fixture = core.documentationFixtureState();
  const removed = { ...fixture,
    managed: { ...fixture.managed, exists: false, git: false },
    audit: { ...fixture.audit, repo_auto_update: { enabled: false }, codex_plugin_auto_refresh_enabled: false },
    codexInstall: { ...fixture.codexInstall, plugin: 'missing', versions: [], version: null, hooks: { status: 'read', entries: [] } } };
  return { fixture, removed };
}

for (const host of ['codex', 'claude-code']) {
  for (const [name, current] of Object.entries(states())) {
    test(`${host}, ${name} state: the preview shows the run's bank with the run's reference`, () => {
      const planned = core.plannedQuestionBank(core.parseArgs(['--plan', '--host', host]), current);
      const run = core.setupQuestionSpecs(core.parseArgs(['--execute', '--host', host]), current);
      assert.equal(reference(planned.bank), reference(run));
      assert.equal(core.questionBankSemanticIdentity(planned.bank), core.questionBankSemanticIdentity(run));
    });
  }
}
