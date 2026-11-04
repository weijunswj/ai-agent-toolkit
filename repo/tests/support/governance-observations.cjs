'use strict';

// Test-only observations of merged decisions. Never a production answer writer.
const governance = require('../../scripts/toolkit-governance-state.cjs');
const { recordMerged } = require('../toolkit-governed-fixture-support.cjs');
function seedMerged(cwd, command, { registryOptions = {} } = {}) {
  const identity = governance.readIdentity(cwd), repository = governance.remoteSlug(identity.remote);
  const binding = command === 'enable' ? {
    schema: 'toolkit.programme-binding.v2', repository, governance: 'enabled', parents: [{ issue: 1, record_prefix: 'INT-FX-' }],
    store: { kind: 'github', repository: 'example-owner/evidence-store', branch: 'main', path: 'state/' }, required_checks: ['validate'],
  } : { schema: 'toolkit.programme-binding.v2', repository, governance: 'disabled' };
  recordMerged(cwd, { registryPath: registryOptions.registryPath, home: registryOptions.userHome, text: JSON.stringify(binding) });
  return { hold: false, reason: 'decided', state: governance.governanceState(cwd, registryOptions) };
}
module.exports = Object.freeze({ seedMerged });
