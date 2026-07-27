'use strict';

const { loadPolicy } = require('../emit-finding');

function detectGOV020(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  const pv = loadPolicy().policy_version;
  if (repo.policy_version && repo.policy_version !== pv) {
    emit(findings, 'GOV020', null, 'policy_version_drift', {});
  }
}

module.exports = detectGOV020;
