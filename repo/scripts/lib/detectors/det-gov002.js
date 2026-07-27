'use strict';

const { getCanonicalParents } = require('./shared/relationship-index');

function detectGOV002(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;
  const parents = getCanonicalParents(issues);
  if (parents.length > 1) {
    emit(findings, 'GOV002', null, 'multiple_canonical_parents', { count: parents.length });
  }
}

module.exports = detectGOV002;
