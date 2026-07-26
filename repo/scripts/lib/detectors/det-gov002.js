'use strict';

const { emitFinding } = require('../emit-finding');
const { getCanonicalParents } = require('./shared/relationship-index');

function detectGOV002(repo, issues, findings, subjects) {
  if (repo.governance_mode !== 'toolkit_governed') return;
  const parents = getCanonicalParents(issues);
  if (parents.length > 1) {
    emitFinding(findings, 'GOV002', null, 'multiple_canonical_parents', { count: parents.length });
  }
}

module.exports = detectGOV002;
