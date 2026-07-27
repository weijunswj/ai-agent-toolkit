'use strict';


function detectGOV021(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode === 'unknown') {
    emit(findings, 'GOV021', null, 'unknown_governance_mode', {});
  }
}

module.exports = detectGOV021;
