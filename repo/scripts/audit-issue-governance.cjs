#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const POLICY_VERSION = '1.0.0';
const SNAPSHOT_VERSION = '1.0.0';

const TIMESTAMP_PATTERN = /^Last reconciled: \*\*\d{1,2} [A-Z][a-z]+ \d{4}, \d{2}:\d{2} SGT\*\*$/;
const CHECKBOX_PATTERN = /^- \[([ xX])\]\s+/;
const ISSUE_LINK_PATTERN = /#(\d+)/;
const PR_MERGE_COMPLETION_PATTERN = /(?:pr|pull\s*request)\s*(?:#?\d+\s*)?(?:is\s*)?(?:merged|merge)\s*(?:=|equals|is|means|sufficient|enough|complete)/i;
const IMPLEMENTER_ACCEPTANCE_PATTERN = /(?:implementer|coding\s*agent|codex|claude|copilot)\s+(?:has\s+)?(?:independently\s+)?(?:verified|confirmed|accepted|certified|approved)\s+(?:independent\s+)?(?:review|acceptance|completion)/i;
const WHY_SECTION_PATTERN = /^#\s+Why\s+this\s+issue\s+exists/im;
const ACCEPTANCE_CRITERIA_PATTERN = /^#\s+Acceptance\s+criteria/im;
const CURRENT_STATUS_PATTERN = /^#\s+Current\s+status/im;
const COMPLETED_WORK_PATTERN = /^#\s+Completed\s+work/im;
const REMAINING_PATTERN = /^#\s+Remaining\s+(?:steps|work)/im;
const BLOCKERS_PATTERN = /^#\s+(?:Current\s+)?(?:blockers|Blockers)(?:\s+and\s+findings)?/im;
const SAFETY_AUTHORITY_PATTERN = /^#\s+Safety\s+and\s+authority/im;
const GOAL_SCOPE_PATTERN = /^#\s+Goal\s+and\s+scope/im;
const PARENT_TRACKER_PATTERN = /^Parent\s+tracker:\s*#(\d+)/im;
const IMPLEMENTATION_PR_PATTERN = /^Implementation\s+PR:\s*#(\d+)/im;
const LINKED_PRS_PATTERN = /^#\s+Linked\s+PRs(?:\s+and\s+follow-ups)?/im;

const FINDING_CODES = {
  GOV001: 'toolkit_governed_no_canonical_parent',
  GOV002: 'toolkit_governed_multiple_canonical_parents',
  GOV003: 'parent_checklist_entry_no_linked_child',
  GOV004: 'active_child_no_parent_link',
  GOV005: 'active_child_absent_from_parent_checklist',
  GOV006: 'parent_child_link_not_bidirectional',
  GOV007: 'checked_parent_incomplete_child',
  GOV008: 'closed_complete_child_incomplete_acceptance',
  GOV009: 'complete_child_parent_unchecked_or_stale',
  GOV010: 'missing_current_status',
  GOV011: 'missing_reconciliation_timestamp',
  GOV012: 'multiple_reconciliation_timestamps',
  GOV013: 'malformed_reconciliation_timestamp',
  GOV014: 'missing_why_section',
  GOV015: 'missing_required_tracking_dimensions',
  GOV016: 'missing_acceptance_criteria',
  GOV017: 'superseded_no_reason_or_successor',
  GOV018: 'pr_merge_treated_as_completion',
  GOV019: 'implementer_claims_independent_acceptance',
  GOV020: 'policy_version_or_surface_drift'
};

const CHILD_REQUIRED_SECTIONS_COMPREHENSIVE = [
  'current_status',
  'reconciliation_timestamp',
  'parent_tracker',
  'why_this_issue_exists',
  'goal_and_scope',
  'completed_work',
  'current_blockers_and_findings',
  'remaining_steps',
  'acceptance_criteria',
  'linked_prs_and_followups',
  'safety_and_authority'
];

const CHILD_REQUIRED_SECTIONS_ATOMIC = [
  'current_status',
  'reconciliation_timestamp',
  'parent_link',
  'why_this_issue_exists',
  'completed_work',
  'blockers',
  'remaining_work',
  'acceptance_criteria',
  'linked_prs_or_followups',
  'safety_and_authority'
];

function parseSnapshot(inputPath) {
  let raw;
  try {
    raw = fs.readFileSync(inputPath, 'utf8');
  } catch (err) {
    return { ok: false, error: `Cannot read input file: ${err.message}` };
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${err.message}` };
  }

  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Input must be a JSON object.' };
  }
  if (data.snapshot_version !== SNAPSHOT_VERSION) {
    return { ok: false, error: `Unsupported snapshot version: ${JSON.stringify(data.snapshot_version)}. Expected ${SNAPSHOT_VERSION}.` };
  }
  if (!data.repository || typeof data.repository !== 'object') {
    return { ok: false, error: 'Missing or invalid repository metadata.' };
  }
  if (!Array.isArray(data.issues)) {
    return { ok: false, error: 'Missing or invalid issues array.' };
  }

  const validModes = ['toolkit_governed', 'repository_native', 'unknown'];
  if (!validModes.includes(data.repository.governance_mode)) {
    return { ok: false, error: `Invalid governance_mode: ${JSON.stringify(data.repository.governance_mode)}.` };
  }

  for (const issue of data.issues) {
    if (!issue || typeof issue !== 'object') {
      return { ok: false, error: 'Each issue must be a JSON object.' };
    }
    if (issue.id === undefined || issue.id === null) {
      return { ok: false, error: 'Each issue must have an id.' };
    }
    if (!['open', 'closed'].includes(issue.state)) {
      return { ok: false, error: `Invalid state for issue ${issue.id}: ${JSON.stringify(issue.state)}.` };
    }
    const validCategories = [
      'canonical_parent_tracker',
      'active_multi_step_child',
      'small_atomic_child',
      'recurring_evidence_log',
      'superseded_duplicate_not_planned',
      'complete'
    ];
    if (!validCategories.includes(issue.category)) {
      return { ok: false, error: `Invalid category for issue ${issue.id}: ${JSON.stringify(issue.category)}.` };
    }
    if (typeof issue.body !== 'string') {
      return { ok: false, error: `Issue ${issue.id} body must be a string.` };
    }
  }

  return { ok: true, data };
}

function countTimestamps(body) {
  const lines = body.split('\n');
  let count = 0;
  for (const line of lines) {
    if (/^Last reconciled:\s+/.test(line.trim())) {
      count += 1;
    }
  }
  return count;
}

function hasMalformedTimestamp(body) {
  const lines = body.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^Last reconciled:\s+/.test(trimmed)) {
      if (!TIMESTAMP_PATTERN.test(trimmed)) {
        return true;
      }
    }
  }
  return false;
}

function hasWellFormedTimestamp(body) {
  const lines = body.split('\n');
  for (const line of lines) {
    if (TIMESTAMP_PATTERN.test(line.trim())) {
      return true;
    }
  }
  return false;
}

function hasSection(body, pattern) {
  return pattern.test(body);
}

function parseChecklistItems(body) {
  const items = [];
  const lines = body.split('\n');
  for (const line of lines) {
    const match = line.match(CHECKBOX_PATTERN);
    if (match) {
      const checked = match[1] === 'x' || match[1] === 'X';
      const text = line;
      const issueMatch = line.match(ISSUE_LINK_PATTERN);
      const linkedIssue = issueMatch ? parseInt(issueMatch[1], 10) : null;
      items.push({ checked, text, linked_issue: linkedIssue });
    }
  }
  return items;
}

function getIssueById(issues, id) {
  return issues.find(i => String(i.id) === String(id)) || null;
}

function isChildCategory(category) {
  return ['active_multi_step_child', 'small_atomic_child'].includes(category);
}

function isChildLikeIssue(issue) {
  return isChildCategory(issue.category) || issue.category === 'complete';
}

function isAcceptanceCriteriaMet(body) {
  const lines = body.split('\n');
  let inAcceptance = false;
  let hasCriteria = false;
  let allChecked = true;

  for (const line of lines) {
    if (ACCEPTANCE_CRITERIA_PATTERN.test(line.trim())) {
      inAcceptance = true;
      continue;
    }
    if (inAcceptance && /^#\s+/.test(line.trim())) {
      break;
    }
    if (inAcceptance) {
      const match = line.match(CHECKBOX_PATTERN);
      if (match) {
        hasCriteria = true;
        if (match[1] !== 'x' && match[1] !== 'X') {
          allChecked = false;
        }
      }
    }
  }

  if (!hasCriteria) return null;
  return allChecked;
}

function checkRequiredSections(issue, findings) {
  const body = issue.body;
  const category = issue.category;

  if (!hasSection(body, CURRENT_STATUS_PATTERN)) {
    findings.push({
      code: 'GOV010',
      severity: 'error',
      issue_id: issue.id,
      message: `Issue #${issue.id}: missing Current status section.`
    });
  }

  const tsCount = countTimestamps(body);
  if (tsCount === 0) {
    findings.push({
      code: 'GOV011',
      severity: 'error',
      issue_id: issue.id,
      message: `Issue #${issue.id}: missing reconciliation timestamp.`
    });
  } else if (tsCount > 1) {
    findings.push({
      code: 'GOV012',
      severity: 'error',
      issue_id: issue.id,
      message: `Issue #${issue.id}: multiple reconciliation timestamps found (${tsCount}).`
    });
  }

  if (tsCount > 0 && hasMalformedTimestamp(body)) {
    findings.push({
      code: 'GOV013',
      severity: 'warning',
      issue_id: issue.id,
      message: `Issue #${issue.id}: malformed reconciliation timestamp. Expected format: Last reconciled: **DD Month YYYY, HH:mm SGT**`
    });
  }

  if (!hasSection(body, WHY_SECTION_PATTERN)) {
    findings.push({
      code: 'GOV014',
      severity: 'error',
      issue_id: issue.id,
      message: `Issue #${issue.id}: missing "Why this issue exists" section.`
    });
  }

  if (category === 'active_multi_step_child') {
    if (!hasSection(body, GOAL_SCOPE_PATTERN)) {
      findings.push({
        code: 'GOV015',
        severity: 'error',
        issue_id: issue.id,
        message: `Issue #${issue.id}: missing required tracking dimension "Goal and scope".`
      });
    }
    if (!hasSection(body, COMPLETED_WORK_PATTERN)) {
      findings.push({
        code: 'GOV015',
        severity: 'error',
        issue_id: issue.id,
        message: `Issue #${issue.id}: missing required tracking dimension "Completed work".`
      });
    }
    if (!hasSection(body, BLOCKERS_PATTERN)) {
      findings.push({
        code: 'GOV015',
        severity: 'error',
        issue_id: issue.id,
        message: `Issue #${issue.id}: missing required tracking dimension "Current blockers and findings".`
      });
    }
    if (!hasSection(body, REMAINING_PATTERN)) {
      findings.push({
        code: 'GOV015',
        severity: 'error',
        issue_id: issue.id,
        message: `Issue #${issue.id}: missing required tracking dimension "Remaining steps".`
      });
    }
    if (!hasSection(body, LINKED_PRS_PATTERN)) {
      findings.push({
        code: 'GOV015',
        severity: 'error',
        issue_id: issue.id,
        message: `Issue #${issue.id}: missing required tracking dimension "Linked PRs and follow-ups".`
      });
    }
    if (!hasSection(body, SAFETY_AUTHORITY_PATTERN)) {
      findings.push({
        code: 'GOV015',
        severity: 'error',
        issue_id: issue.id,
        message: `Issue #${issue.id}: missing required tracking dimension "Safety and authority".`
      });
    }
  }

  if (category === 'small_atomic_child') {
    if (!hasSection(body, COMPLETED_WORK_PATTERN)) {
      findings.push({
        code: 'GOV015',
        severity: 'error',
        issue_id: issue.id,
        message: `Issue #${issue.id}: missing required tracking dimension "Completed work".`
      });
    }
    if (!hasSection(body, BLOCKERS_PATTERN)) {
      findings.push({
        code: 'GOV015',
        severity: 'error',
        issue_id: issue.id,
        message: `Issue #${issue.id}: missing required tracking dimension "Blockers".`
      });
    }
    if (!hasSection(body, REMAINING_PATTERN)) {
      findings.push({
        code: 'GOV015',
        severity: 'error',
        issue_id: issue.id,
        message: `Issue #${issue.id}: missing required tracking dimension "Remaining work".`
      });
    }
    if (!hasSection(body, LINKED_PRS_PATTERN)) {
      findings.push({
        code: 'GOV015',
        severity: 'error',
        issue_id: issue.id,
        message: `Issue #${issue.id}: missing required tracking dimension "Linked PRs or follow-ups".`
      });
    }
    if (!hasSection(body, SAFETY_AUTHORITY_PATTERN)) {
      findings.push({
        code: 'GOV015',
        severity: 'error',
        issue_id: issue.id,
        message: `Issue #${issue.id}: missing required tracking dimension "Safety and authority".`
      });
    }
  }

  if (isChildCategory(category) && !hasSection(body, ACCEPTANCE_CRITERIA_PATTERN)) {
    findings.push({
      code: 'GOV016',
      severity: 'error',
      issue_id: issue.id,
      message: `Issue #${issue.id}: missing Acceptance criteria section.`
    });
  }
}

function checkGovernanceMode(repo, issues, findings) {
  if (repo.governance_mode !== 'toolkit_governed') {
    return;
  }

  const parents = issues.filter(i => i.category === 'canonical_parent_tracker');
  if (parents.length === 0) {
    findings.push({
      code: 'GOV001',
      severity: 'error',
      issue_id: null,
      message: 'Toolkit-governed repository has no declared canonical parent tracker.'
    });
  } else if (parents.length > 1) {
    findings.push({
      code: 'GOV002',
      severity: 'error',
      issue_id: null,
      message: `Toolkit-governed repository has ${parents.length} canonical parent trackers. Expected exactly one.`
    });
  }
}

function checkParentChildLinks(repo, issues, findings) {
  const parents = issues.filter(i => i.category === 'canonical_parent_tracker');
  const children = issues.filter(i => isChildCategory(i.category));

  for (const parent of parents) {
    const checklistItems = parent.checklist_items || [];
    for (const item of checklistItems) {
      if (!item.linked_issue) {
        findings.push({
          code: 'GOV003',
          severity: 'warning',
          issue_id: parent.id,
          message: `Parent #${parent.id} checklist entry has no linked child: "${item.text.trim().substring(0, 60)}"`
        });
      }
    }
  }

  for (const child of children) {
    const parentLink = child.parent;
    if (!parentLink && parentLink !== 0) {
      findings.push({
        code: 'GOV004',
        severity: 'error',
        issue_id: child.id,
        message: `Active child #${child.id} has no parent link.`
      });
      continue;
    }

    const parentIssue = getIssueById(issues, parentLink);
    if (!parentIssue) {
      findings.push({
        code: 'GOV005',
        severity: 'error',
        issue_id: child.id,
        message: `Active child #${child.id} parent #${parentLink} not found in snapshot.`
      });
      continue;
    }

    const parentChildren = parentIssue.children || [];
    const childInParentChildren = parentChildren.some(c => String(c) === String(child.id));

    const checklistItems = parentIssue.checklist_items || [];
    const childInChecklist = checklistItems.some(item =>
      item.linked_issue && String(item.linked_issue) === String(child.id)
    );

    if (!childInParentChildren && !childInChecklist) {
      findings.push({
        code: 'GOV005',
        severity: 'error',
        issue_id: child.id,
        message: `Active child #${child.id} is absent from parent #${parentLink} checklist.`
      });
    }

    if (!childInParentChildren) {
      findings.push({
        code: 'GOV006',
        severity: 'error',
        issue_id: child.id,
        message: `Parent #${parentLink} does not list child #${child.id} in its children. Bidirectional link broken.`
      });
    }
  }
}

function checkCompletionConsistency(issues, findings) {
  const parents = issues.filter(i => i.category === 'canonical_parent_tracker');

  for (const parent of parents) {
    const checklistItems = parent.checklist_items || [];
    for (const item of checklistItems) {
      if (!item.linked_issue) continue;

      const child = getIssueById(issues, item.linked_issue);
      if (!child) continue;

      if (item.checked) {
        if (child.state === 'open') {
          findings.push({
            code: 'GOV007',
            severity: 'error',
            issue_id: parent.id,
            message: `Parent #${parent.id} item checked but child #${child.id} is still open.`
          });
        }
        if (isChildLikeIssue(child)) {
          const acceptanceMet = isAcceptanceCriteriaMet(child.body);
          if (acceptanceMet === false) {
            findings.push({
              code: 'GOV007',
              severity: 'error',
              issue_id: parent.id,
              message: `Parent #${parent.id} item checked but child #${child.id} has incomplete acceptance criteria.`
            });
          }
        }
      }
    }
  }

  const completeChildren = issues.filter(i =>
    (i.category === 'complete' || i.state === 'closed') && isChildLikeIssue(i)
  );
  for (const child of completeChildren) {
    if (!hasSection(child.body, ACCEPTANCE_CRITERIA_PATTERN)) continue;
    const acceptanceMet = isAcceptanceCriteriaMet(child.body);
    if (acceptanceMet === false) {
      findings.push({
        code: 'GOV008',
        severity: 'error',
        issue_id: child.id,
        message: `Closed/complete child #${child.id} has unchecked acceptance criteria.`
      });
    }
  }

  const childrenLinkedToParents = [];
  for (const child of issues.filter(i => isChildLikeIssue(i))) {
    if (child.parent || child.parent === 0) {
      childrenLinkedToParents.push(child);
    }
  }

  for (const child of childrenLinkedToParents) {
    if (child.category === 'complete' || child.state === 'closed') {
      const parentIssue = getIssueById(issues, child.parent);
      if (!parentIssue) continue;

      const checklistItems = parentIssue.checklist_items || [];
      const item = checklistItems.find(ci =>
        ci.linked_issue && String(ci.linked_issue) === String(child.id)
      );
      if (item && !item.checked) {
        findings.push({
          code: 'GOV009',
          severity: 'warning',
          issue_id: child.id,
          message: `Complete child #${child.id} has unchecked parent item in #${parentIssue.id}.`
        });
      }
    }
  }
}

function checkSupersededIssues(issues, findings) {
  for (const issue of issues) {
    if (issue.category === 'superseded_duplicate_not_planned') {
      if (!issue.reason && !issue.successor) {
        findings.push({
          code: 'GOV017',
          severity: 'warning',
          issue_id: issue.id,
          message: `Issue #${issue.id} is superseded/duplicate/not-planned but has no reason or successor.`
        });
      }
    }
  }
}

function checkAntiPatterns(issues, findings) {
  for (const issue of issues) {
    if (PR_MERGE_COMPLETION_PATTERN.test(issue.body)) {
      findings.push({
        code: 'GOV018',
        severity: 'error',
        issue_id: issue.id,
        message: `Issue #${issue.id} body treats PR merge as sufficient completion.`
      });
    }

    if (IMPLEMENTER_ACCEPTANCE_PATTERN.test(issue.body)) {
      findings.push({
        code: 'GOV019',
        severity: 'error',
        issue_id: issue.id,
        message: `Issue #${issue.id} body contains implementer self-acceptance claim.`
      });
    }
  }
}

function checkPolicyDrift(repo, findings) {
  if (repo.policy_version && repo.policy_version !== POLICY_VERSION) {
    findings.push({
      code: 'GOV020',
      severity: 'warning',
      issue_id: null,
      message: `Policy version drift: snapshot declares ${repo.policy_version}, expected ${POLICY_VERSION}.`
    });
  }
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function auditSnapshot(snapshot) {
  const findings = [];
  const repo = snapshot.repository;
  const issues = deepClone(snapshot.issues);

  for (const issue of issues) {
    const parsed = parseChecklistItems(issue.body);
    if (issue.checklist_items === undefined) {
      issue.checklist_items = parsed;
    }
  }

  checkGovernanceMode(repo, issues, findings);

  if (repo.governance_mode === 'toolkit_governed') {
    checkParentChildLinks(repo, issues, findings);
    checkCompletionConsistency(issues, findings);

    for (const issue of issues) {
      if (isChildCategory(issue.category)) {
        checkRequiredSections(issue, findings);
      }
    }

    checkSupersededIssues(issues, findings);
    checkAntiPatterns(issues, findings);
  }

  checkPolicyDrift(repo, findings);

  findings.sort((a, b) => {
    if (a.code < b.code) return -1;
    if (a.code > b.code) return 1;
    const aId = a.issue_id === null ? '' : String(a.issue_id);
    const bId = b.issue_id === null ? '' : String(b.issue_id);
    if (aId < bId) return -1;
    if (aId > bId) return 1;
    if (a.message < b.message) return -1;
    if (a.message > b.message) return 1;
    return 0;
  });

  return findings;
}

function formatHuman(findings, repo) {
  const lines = [];
  lines.push('Issue Governance Advisory Audit');
  lines.push('================================');
  lines.push(`Governance mode: ${repo.governance_mode}`);
  if (repo.fixture_id) {
    lines.push(`Repository fixture: ${repo.fixture_id}`);
  }
  lines.push(`Policy version: ${repo.policy_version || 'not declared'}`);
  lines.push('');

  if (findings.length === 0) {
    lines.push('No violations found.');
    return lines.join('\n');
  }

  lines.push(`${findings.length} finding(s):`);
  lines.push('');

  for (const f of findings) {
    const issueRef = f.issue_id !== null ? ` [#${f.issue_id}]` : '';
    lines.push(`  ${f.code} (${f.severity})${issueRef}: ${f.message}`);
  }

  return lines.join('\n');
}

function formatJson(findings, repo) {
  return JSON.stringify({
    audit_version: POLICY_VERSION,
    governance_mode: repo.governance_mode,
    policy_version: repo.policy_version || null,
    finding_count: findings.length,
    findings: findings.map(f => ({
      code: f.code,
      severity: f.severity,
      issue_id: f.issue_id,
      message: f.message
    }))
  }, null, 2);
}

function parseArgs(argv) {
  const args = { input: null, format: 'human' };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--input' && argv[i + 1]) {
      args.input = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--format' && argv[i + 1]) {
      args.format = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);

  if (!args.input) {
    console.error('Usage: audit-issue-governance.cjs --input <snapshot.json> [--format human|json]');
    process.exit(2);
  }

  const inputPath = path.resolve(args.input);
  const parsed = parseSnapshot(inputPath);

  if (!parsed.ok) {
    console.error(`Input error: ${parsed.error}`);
    process.exit(2);
  }

  const findings = auditSnapshot(parsed.data);
  const repo = parsed.data.repository;

  if (args.format === 'json') {
    process.stdout.write(formatJson(findings, repo) + '\n');
  } else {
    console.log(formatHuman(findings, repo));
  }

  if (findings.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  auditSnapshot,
  parseSnapshot,
  formatHuman,
  formatJson,
  FINDING_CODES,
  POLICY_VERSION,
  SNAPSHOT_VERSION
};
