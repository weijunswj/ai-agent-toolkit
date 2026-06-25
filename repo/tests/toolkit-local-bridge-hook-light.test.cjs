const assert = require('node:assert/strict');
const test = require('node:test');
const {
  compareSemver,
  getRepoValidationLabels
} = require('../scripts/toolkit-local-bridge.cjs');

test('hook-light validation confirms bridge helpers remain loadable', () => {
  assert.equal(typeof compareSemver, 'function');
  assert.equal(compareSemver('2.2.1', '2.2.1'), 0);
  assert.equal(compareSemver('2.2.3', '2.2.1'), 1);
  assert.equal(compareSemver('2.2.0', '2.2.1'), -1);
});

test('hook-light validation uses dedicated smoke command path', () => {
  const commands = getRepoValidationLabels({ hookMode: true });
  assert.equal(commands.length, 2);
  assert.equal(commands[0], 'node repo/scripts/validate-toolkit.cjs');
  assert.equal(commands[1], 'node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs');
});
