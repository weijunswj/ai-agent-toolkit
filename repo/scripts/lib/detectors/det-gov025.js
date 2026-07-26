'use strict';

const { emitFinding } = require('../emit-finding');

function detectGOV025(repo, issues, findings, subjects) {
  if (repo.governance_mode !== 'toolkit_governed') return;
  if (!subjects || !subjects.duplicates) return;
  for (const dup of subjects.duplicates) {
    emitFinding(findings, 'GOV025', null, 'duplicate_identity', {});
    return;
  }
}

module.exports = detectGOV025;
