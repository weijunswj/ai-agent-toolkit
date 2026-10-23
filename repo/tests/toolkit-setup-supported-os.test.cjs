'use strict';

// Toolkit supports Windows computers only; Linux is allowed only as a CI build machine (CI=true).
const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../scripts/setup-toolkit-core.cjs');

test('setup accepts Windows and a Linux CI runner and stops on every other computer', () => {
  assert.doesNotThrow(() => core.assertSupportedComputer({ platform: 'win32', environment: {} }));
  assert.doesNotThrow(() => core.assertSupportedComputer({ platform: 'linux', environment: { CI: 'true' } }));
  for (const [platform, environment] of [['darwin', {}], ['darwin', { CI: 'true' }], ['linux', {}], ['linux', { CI: '1' }], ['freebsd', { CI: 'true' }]]) {
    assert.throws(() => core.assertSupportedComputer({ platform, environment }), /supports Windows 10 and 11 only; this computer runs/, `${platform} ${JSON.stringify(environment)}`);
  }
});

test('the stop comes before any setup step, and help still prints', async () => {
  const options = { platform: 'darwin', environment: {} };
  await assert.rejects(() => core.main(['--execute', '--yes-recommended'], options), /supports Windows 10 and 11 only/);
  await assert.rejects(() => core.main(['--plan', '--json'], options), /supports Windows 10 and 11 only/);
  const original = console.log;
  console.log = () => {};
  try { assert.equal(await core.main(['--help'], options), 0); }
  finally { console.log = original; }
});
