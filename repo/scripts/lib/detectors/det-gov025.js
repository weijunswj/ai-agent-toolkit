'use strict';


function detectGOV025(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;
  if (!subjects || !subjects.duplicates) return;
  for (const dup of subjects.duplicates) {
    emit(findings, 'GOV025', null, 'duplicate_identity', {});
    return;
  }
}

module.exports = detectGOV025;
