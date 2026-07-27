'use strict';

const { getSubjectForIssue } = require('../subject-map');
const { hasSection } = require('./shared/section-handlers');
const { isChildCategory } = require('./shared/relationship-index');
const { loadPolicy } = require('../emit-finding');

function detectGOV015(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;
  const policy = loadPolicy();
  for (const issue of issues) {
    if (!isChildCategory(issue.category)) continue;
    const catDef = policy.issue_categories[issue.category];
    if (!catDef || !catDef.required_sections) continue;
    const dedicatedKeys = new Set(['current_status', 'reconciliation_timestamp', 'why_this_issue_exists', 'acceptance_criteria']);
    for (const secKey of catDef.required_sections) {
      if (dedicatedKeys.has(secKey)) continue;
      if (!hasSection(issue.body, secKey)) {
        emit(findings, 'GOV015', getSubjectForIssue(subjects, issue.id), 'missing_dimension', {});
        break;
      }
    }
  }
}

module.exports = detectGOV015;
