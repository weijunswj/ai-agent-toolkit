'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const registry = require('../scripts/toolkit-repository-identity.cjs');
test('ID-01: every clone form of one repository is one identity; other repositories are not', () => {
  const forms = [
    'https://github.com/Example-Owner/Example-Repo.git',
    'https://github.com/example-owner/example-repo',
    'https://github.com/example-owner/example-repo/',
    'git@github.com:example-owner/example-repo.git',
    'git@github.com:Example-Owner/example-repo',
    'ssh://git@github.com/example-owner/example-repo.git',
    'ssh://git@github.com:22/example-owner/example-repo',
  ];
  const ids = new Set(forms.map(form => registry.repositoryIdForCanonicalRemote(registry.validateRemoteIdentity(form).canonical)));
  assert.equal(ids.size, 1);
  const other = registry.repositoryIdForCanonicalRemote('https://github.com/example-owner/other-repo.git');
  assert.equal(ids.has(other), false);
  // Off github.com the path keeps its case.
  assert.notEqual(registry.repositoryIdForCanonicalRemote('https://gitlab.example/Group/Repo.git'), registry.repositoryIdForCanonicalRemote('https://gitlab.example/group/repo.git'));
  assert.equal(registry.repositoryIdForCanonicalRemote('https://gitlab.example/Group/Repo.git'), registry.repositoryIdForCanonicalRemote('git@gitlab.example:Group/Repo'));
});


test('ID-06: remote validation accepts HTTPS, SSH and SCP forms and refuses broad ones', () => {
  for (const remote of ['https://github.com/weijunswj/ai-agent-toolkit.git', 'ssh://git@github.com:22/weijunswj/ai-agent-toolkit.git', 'git@github.com:weijunswj/ai-agent-toolkit.git']) {
    assert.equal(registry.validateRemoteIdentity(remote).valid, true, remote);
  }
  for (const remote of [
    'https://user:secret@example.com/repo.git', 'https://github.com/repo.git?token=synthetic',
    'https://github.com', 'https://[::1]:65536/repo.git', 'git@@github.com:repo.git',
    'git@github.com:', 'C:\\fixture\\repo', '\\\\server\\share', './relative/repo', '', 'x'.repeat(4097),
  ]) assert.equal(registry.validateRemoteIdentity(remote).valid, false, remote);
});
