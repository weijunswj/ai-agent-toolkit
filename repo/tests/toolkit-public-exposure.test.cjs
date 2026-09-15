'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const exposure = require('../scripts/toolkit-public-exposure.cjs');

test('possible exposure is redacted and pauses with type/name/place/action only', () => {
  const result = exposure.preparePublicPayload({ token: 'opaque' }, { place: 'pr-body' });
  assert.equal(result.classification, 'possible');
  assert.equal(result.action, 'pause');
  assert.equal(result.payload.token, exposure.REDACTED);
  assert.deepEqual(Object.keys(result.findings[0]).sort(), ['action', 'name', 'place', 'type']);
});

test('confirmed exposure stops with the exact public code and no value', () => {
  const result = exposure.classifyExposure({ confirmed: true, type: 'credential', name: 'config', place: 'terminal-packet', action: 'publish' });
  assert.equal(result.classification, 'confirmed');
  assert.equal(result.code, 'SECRET_EXPOSURE_DETECTED');
  assert.equal(result.finding.type, 'credential');
  assert.equal(result.finding.name, 'config');
});

test('safe metadata and required deployment configuration are handled separately', () => {
  assert.equal(exposure.classifyExposure({ value: 'masked', name: 'masked_token' }).classification, 'none');
  assert.equal(exposure.requireDeploymentConfiguration({}, ['deployment_url']).code, 'REQUIRED_CONFIGURATION_MISSING');
  assert.equal(exposure.requireDeploymentConfiguration({ deployment_url: 'configured' }, ['deployment_url']).ok, true);
});

test('safe metadata names cannot suppress secret-pattern detection in values', () => {
  const value = 'sk-' + 'a'.repeat(24);
  const direct = exposure.classifyExposure({ value, name: 'host' });
  assert.equal(direct.classification, 'confirmed');
  assert.equal(direct.finding.type, 'openai-key');
  const recursive = exposure.preparePublicPayload({ host: value, account: 'safe-account' });
  assert.equal(recursive.classification, 'confirmed');
  assert.equal(recursive.payload.host, exposure.REDACTED);
  assert.equal(recursive.payload.account, 'safe-account');
});

test('metadata exemptions never suppress credential assignments or recursive secret context', () => {
  const result = exposure.preparePublicPayload({
    host: 'token=plain-credential-value',
    masked_token: 'sk-' + 'abcdefghijklmnopqrstuvwxyz1234',
    token: ['plain-value', '[REDACTED]'],
    password: { nested: ['plain-value'] },
    account: { nested: { credential: ['plain-value'] } }
  });
  assert.equal(result.classification, 'confirmed');
  assert.equal(result.payload.host, exposure.REDACTED);
  assert.equal(result.payload.masked_token, exposure.REDACTED);
  assert.equal(result.payload.token[0], exposure.REDACTED);
  assert.equal(result.payload.token[1], '[REDACTED]');
  assert.equal(result.payload.password.nested[0], exposure.REDACTED);
  assert.equal(result.payload.account.nested.credential[0], exposure.REDACTED);
  assert.doesNotMatch(JSON.stringify(result.findings), /plain-credential-value|abcdefghijklmnopqrstuvwxyz|plain-value/);
});

test('strict whole-value masked placeholders remain non-secret', () => {
  const result = exposure.preparePublicPayload({ host: 'github.com', masked_token: '[REDACTED]', token: '***', password: '<redacted>' });
  assert.equal(result.classification, 'none');
  assert.deepEqual(result.findings, []);
});

test('generic credential-shaped content is unsafe before metadata exemptions', () => {
  const generic = `ghp_${'A'.repeat(36)}`;
  for (const name of ['payload', 'host']) {
    const result = exposure.classifyExposure({ value: generic, name, metadata: name === 'host' });
    assert.equal(result.classification, 'possible');
    assert.equal(result.finding.type, 'credential-like-token');
  }
  const recursive = exposure.preparePublicPayload({ host: generic, secret: ['synthetic-value'], masked_token: '[REDACTED]' });
  assert.equal(recursive.classification, 'possible');
  assert.equal(recursive.payload.host, exposure.REDACTED);
  assert.equal(recursive.payload.secret[0], exposure.REDACTED);
  assert.equal(recursive.payload.masked_token, '[REDACTED]');
  assert.doesNotMatch(JSON.stringify(recursive.findings), /ghp_|synthetic-value/);
});
