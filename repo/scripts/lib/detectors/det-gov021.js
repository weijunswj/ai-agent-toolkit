'use strict';

const { emitFinding } = require('../emit-finding');

function detectGOV021(repo, issues, findings, subjects) {
  if (repo.governance_mode === 'unknown') {
    emitFinding(findings, 'GOV021', null, 'unknown_governance_mode', {});
  }
}

module.exports = detectGOV021;
