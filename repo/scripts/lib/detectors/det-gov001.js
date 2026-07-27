'use strict';

const { getCanonicalParents } = require('./shared/relationship-index');

function detectGOV001(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;
  const parents = getCanonicalParents(issues);
  if (parents.length === 0) {
    emit(findings, 'GOV001', null, 'no_canonical_parent', {});
  }
}

module.exports = detectGOV001;
