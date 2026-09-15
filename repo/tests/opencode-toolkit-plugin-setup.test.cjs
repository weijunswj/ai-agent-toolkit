'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../scripts/setup-opencode-toolkit-plugin.cjs');

test('OpenCode native package is ready at the frozen version', () => {
  const result = plugin.validateRepoOpenCodePlugin(process.cwd());
  assert.equal(result.ok, true);
  assert.equal(result.package_version, '2.11.6');
  const state = plugin.migrationState({ repoRoot: process.cwd() });
  assert.equal(state.state, 'PLUGIN_PACKAGE_READY');
  assert.equal(state.bridge_removal_allowed, false);
  assert.equal(state.live_install_attempted, false);
});

test('OpenCode live installation requires separate authority', () => {
  assert.throws(() => plugin.installOpenCodePlugin({ repoRoot: process.cwd() }), /OPENCODE_INSTALL_REQUIRES_SEPARATE_WEB_AUTHORITY/);
});
