'use strict';

const { getSubjectForIssue } = require('../subject-map');
const { getChildren } = require('./shared/relationship-index');

function detectGOV004(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;
  const children = getChildren(issues);
  for (const child of children) {
    if (!child.parent && child.parent !== 0) {
      emit(findings, 'GOV004', getSubjectForIssue(subjects, child.id), 'no_parent_link', {});
    }
  }
}

module.exports = detectGOV004;
