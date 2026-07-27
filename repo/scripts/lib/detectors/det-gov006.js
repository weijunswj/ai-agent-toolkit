'use strict';

const { getSubjectForIssue } = require('../subject-map');
const { getChildren, getIssueById } = require('./shared/relationship-index');

function detectGOV006(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;
  const children = getChildren(issues);
  for (const child of children) {
    if (!child.parent && child.parent !== 0) continue;
    const parentIssue = getIssueById(issues, child.parent);
    if (!parentIssue || parentIssue.category !== 'canonical_parent_tracker') continue;
    const parentChildren = parentIssue.children || [];
    if (!parentChildren.some(c => String(c) === String(child.id))) {
      emit(findings, 'GOV006', getSubjectForIssue(subjects, child.id), 'not_bidirectional', {});
    }
  }
}

module.exports = detectGOV006;
