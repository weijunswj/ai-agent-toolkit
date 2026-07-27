'use strict';

const { getSubjectForIssue } = require('../subject-map');
const { parseImplBranchFromBody, parseImplPRFromBody } = require('./shared/body-parsers');
const { loadPolicy } = require('../emit-finding');

function detectGOV023(repo, issues, findings, subjects, emit) {
  if (typeof emit !== 'function') throw new TypeError('detector emitter is required');
  if (repo.governance_mode !== 'toolkit_governed') return;
  const policy = loadPolicy();
  for (const issue of issues) {
    const catDef = policy.issue_categories[issue.category];
    if (!catDef || !catDef.is_implementation_work) continue;
    const bodyBranch = parseImplBranchFromBody(issue.body);
    const bodyPR = parseImplPRFromBody(issue.body);
    const implPrs = issue.implementation_prs || [];

    if (!bodyPR && !bodyBranch) {
      emit(findings, 'GOV023', getSubjectForIssue(subjects, issue.id), 'missing_body_implementation_pr', {});
      continue;
    }

    if (issue.implementation_branch !== undefined && issue.implementation_branch !== null) {
      if (bodyBranch && issue.implementation_branch !== bodyBranch) {
        emit(findings, 'GOV023', getSubjectForIssue(subjects, issue.id), 'branch_disagree', {});
      }
    }

    const activePrs = implPrs.filter(pr => pr.state === 'open' && pr.merged === false);

    if (activePrs.length === 1) {
      const soleOpenPR = activePrs[0];
      if (bodyPR && bodyPR !== 'Not opened') {
        const bodyPRNum = bodyPR.replace(/[^0-9]/g, '');
        if (bodyPRNum && String(soleOpenPR.number) !== bodyPRNum) {
          emit(findings, 'GOV023', getSubjectForIssue(subjects, issue.id), 'pr_disagree', {});
        } else if (!bodyPRNum) {
          emit(findings, 'GOV023', getSubjectForIssue(subjects, issue.id), 'pr_disagree', {});
        }
      }
      if (bodyPR === 'Not opened') {
        emit(findings, 'GOV023', getSubjectForIssue(subjects, issue.id), 'body_not_opened_but_pr_exists', {});
      }
    }

    if (bodyPR && bodyPR !== 'Not opened' && activePrs.length === 0) {
      const bodyPRNum = bodyPR.replace(/[^0-9]/g, '');
      const hasMatchingClosed = implPrs.some(pr => String(pr.number) === bodyPRNum && pr.state === 'closed');
      if (!hasMatchingClosed) {
        emit(findings, 'GOV023', getSubjectForIssue(subjects, issue.id), 'body_pr_not_in_structured', {});
      }
    }
  }
}

module.exports = detectGOV023;
