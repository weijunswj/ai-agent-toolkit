'use strict';

const { emitFinding, loadPolicy } = require('../emit-finding');

function detectGOV020(repo, issues, findings, subjects) {
  const pv = loadPolicy().policy_version;
  if (repo.policy_version && repo.policy_version !== pv) {
    emitFinding(findings, 'GOV020', null, 'policy_version_drift', {});
  }
}

module.exports = detectGOV020;
