'use strict';

const { emitFinding } = require('../emit-finding');
const { getCanonicalParents } = require('./shared/relationship-index');

function detectGOV001(repo, issues, findings, subjects) {
  if (repo.governance_mode !== 'toolkit_governed') return;
  const parents = getCanonicalParents(issues);
  if (parents.length === 0) {
    emitFinding(findings, 'GOV001', null, 'no_canonical_parent', {});
  }
}

module.exports = detectGOV001;
