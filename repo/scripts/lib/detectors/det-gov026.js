'use strict';

const { getCanonicalParents, getIssueById } = require('./shared/relationship-index');

function detectGOV026(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;
  const parents = getCanonicalParents(issues);

  if (repo.canonical_parent_tracker === undefined || repo.canonical_parent_tracker === null) {
    if (parents.length === 1) {
      emit(findings, 'GOV026', null, 'canonical_parent_not_found', {});
    }
    return;
  }

  const declared = getIssueById(issues, repo.canonical_parent_tracker);
  if (!declared) {
    emit(findings, 'GOV026', null, 'canonical_parent_not_found', {});
    return;
  }
  if (declared.category !== 'canonical_parent_tracker') {
    emit(findings, 'GOV026', null, 'canonical_parent_not_found', {});
    return;
  }
  if (parents.length === 1 && String(parents[0].id) !== String(repo.canonical_parent_tracker)) {
    emit(findings, 'GOV026', null, 'canonical_parent_not_found', {});
  }
}

module.exports = detectGOV026;
