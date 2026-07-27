'use strict';

const { getSubjectForIssue } = require('../subject-map');
const { parseChecklistFromBody } = require('./shared/body-parsers');
const { getCanonicalParents } = require('./shared/relationship-index');

function detectGOV003(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;
  const parents = getCanonicalParents(issues);
  for (const parent of parents) {
    const bodyCL = parseChecklistFromBody(parent.body);
    for (const item of bodyCL) {
      if (!item.linked_issue) {
        emit(findings, 'GOV003', getSubjectForIssue(subjects, parent.id), 'no_linked_child', {});
      }
    }
  }
}

module.exports = detectGOV003;
