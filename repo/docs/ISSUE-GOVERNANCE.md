# Issue Governance

Toolkit global issue-governance standard for `toolkit-governed` repositories.

## Why The Standard Exists

Current project truth can drift across issue bodies, comments, pull-request descriptions, review threads, executor reports and chat history. Large parent trackers can become duplicate archives rather than clear programme queues.

The owner requires one consistent global pattern for every Toolkit-governed repository:

- One lean canonical parent tracker that shows the programme task list as short checklist lines.
- One comprehensive child issue per material task.
- Issue bodies as current authority.
- Comments as chronology and discussion only.
- Independent web-controller verification before acceptance, checklist completion or closure.

## Lean Parent / Comprehensive Child Model

### One lean canonical parent tracker

Each governed repository declares exactly one canonical programme tracker. The parent is a concise checklist-first queue, not a duplicate evidence archive. Each material task appears as one concise checklist line.

A normal task line resembles:

```md
- [ ] #123 Short task title — compact current status
```

### One comprehensive child per material task

Every material task gets one child issue linked back to the repository's canonical parent tracker. Closed issues retain their structural profile and must pass all required-section checks. The child must include at minimum:

- Current status and one reconciliation timestamp.
- Parent tracker, implementation branch and implementation PR.
- Dependencies, blockers and related work.
- Why the issue exists.
- Goal and scope, including non-goals.
- Completed work.
- Current blockers and findings.
- Remaining work.
- Acceptance criteria.
- Linked PRs and follow-ups.
- Decisions and durable evidence.
- Safety and authority.

### Reduced atomic child

Small atomic tasks may use a shorter template but must retain:

- Current status and reconciliation timestamp.
- Parent link, implementation branch and implementation PR.
- Why the task exists.
- Completed work.
- Blockers.
- Remaining work.
- Acceptance criteria.
- Linked PRs or follow-ups.
- Safety and authority.

## Controller vs. Implementer Authority

### Web controller owns by default

- Issue-body reconciliation.
- Parent status changes and checklist completion.
- Acceptance decisions.
- Closure, reopening, and successor decisions.
- Verification that review findings are resolved.

### Coding agents may by default

- Read parent and child issues.
- Implement the scoped repository task.
- Report exact evidence.
- Propose clean replacement text.
- Propose concise parent status-line updates.

### Coding agents may not by default

- Rewrite a live issue.
- Tick a parent checklist item.
- Mark acceptance criteria independently verified.
- Change the reconciliation timestamp.
- Close or reopen an issue.
- Declare their own implementation accepted.
- Resolve review findings.

## Implementation PR Lifecycle

One implementation issue maps to one implementation branch and one active implementation PR.

- Amendments remain on the same PR.
- Replacement PRs require a recorded exceptional reason and explicit supersession.
- Body and structured implementation-PR metadata must agree.
- Research, architecture-only and recurring-evidence issues are not required to have implementation PRs.

The audit detects: multiple active implementation PRs, replacement PRs without reasons, and contradictory derived fields.

## Governance Modes

| Mode | Description |
|------|-------------|
| `toolkit-governed` | The global standard applies. Versioned templates and audit assets may be distributed after explicit governance consent. |
| `repository-native` | The repository's own issue process remains authoritative. Toolkit must not overwrite or impose its structure. |
| `unknown` | Governance mode must be selected. Toolkit must not silently install or enforce the standard. |

## Policy Versioning

The canonical policy is versioned using semver (`MAJOR.MINOR.PATCH`).

- Current version: `2.0.0`
- Snapshot schema version: `2.0.0`
- Source: `_projects/development/issue-governance/_main/policy/issue-governance-policy.json`

## Canonical Runtime Authority

The canonical policy and JSON schema are the production authority:

- Finding codes, governance modes, and required sections are loaded from the canonical policy JSON.
- Input validation enforces the canonical schema's `additionalProperties`, type, and structural constraints.
- Body content is the truth; structured derived fields are recomputed from or consistency-checked against the body.
- The audit script never hardcodes policy data that exists in the canonical sources.

## Reconciliation Timestamp

Format: `Last reconciled: **DD Month YYYY, HH:mm SGT**`

Rules:
- Asia/Singapore time.
- 24-hour time to the minute.
- Exactly one timestamp per issue body.
- Replace the previous timestamp rather than stacking.
- Advance only after substantive reconciliation.
- Comments and GitHub edit history preserve chronology.

## Snapshot Schema

The local issue-snapshot schema is defined at:

`_projects/development/issue-governance/_main/schema/issue-snapshot.schema.json`

It supports:

- Repository metadata: fixture ID, governance mode, canonical parent tracker, policy version.
- Issue records: ID, state, category, body, parent, children, linked PRs, reconciliation metadata.
- Issue categories: canonical_parent_tracker, active_multi_step_child, small_atomic_child, recurring_evidence_log, superseded_duplicate_not_planned.

## Advisory Audit Command

```powershell
node repo/scripts/audit-issue-governance.cjs --input <snapshot.json>
node repo/scripts/audit-issue-governance.cjs --input <snapshot.json> --format json
node repo/scripts/audit-issue-governance.cjs --input <snapshot.json> --format human
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Audit executed with no violations |
| 1 | Audit executed and policy violations were found |
| 2 | Input/schema or execution failure |

## Stable Finding Codes

| Code | Severity | Group | Description |
|------|----------|-------|-------------|
| GOV001 | error | parent_tracker | Toolkit-governed repository with no canonical parent issue |
| GOV002 | error | parent_tracker | Toolkit-governed repository with more than one canonical parent |
| GOV003 | warning | parent_child_link | Parent checklist entry with no linked child |
| GOV004 | error | parent_child_link | Active child with no parent link |
| GOV005 | error | parent_child_link | Active child absent from parent checklist or parent not found |
| GOV006 | error | parent_child_link | Parent/child link not bidirectional |
| GOV007 | error | completion_consistency | Checked parent item while child remains open or acceptance incomplete |
| GOV008 | error | completion_consistency | Closed child with unchecked acceptance criteria |
| GOV009 | warning | completion_consistency | Closed child's parent item unchecked |
| GOV010 | error | required_sections | Missing Current status section |
| GOV011 | error | required_sections | Missing reconciliation timestamp |
| GOV012 | error | required_sections | Multiple reconciliation timestamps |
| GOV013 | warning | required_sections | Malformed or invalid reconciliation timestamp |
| GOV014 | error | required_sections | Missing "Why this issue exists" section |
| GOV015 | error | required_sections | Missing required tracking dimension |
| GOV016 | error | required_sections | Missing Acceptance criteria section |
| GOV017 | warning | superseded | Superseded/duplicate/not-planned without reason or successor |
| GOV018 | error | anti_patterns | PR merge treated as sufficient completion (non-negated) |
| GOV019 | error | anti_patterns | Implementer claims independent acceptance (non-negated) |
| GOV020 | warning | policy_drift | Snapshot policy version differs from canonical |
| GOV021 | warning | governance_mode | Unknown governance mode requires selection |
| GOV022 | error | implementation_pr | Multiple active (draft/open) implementation PRs |
| GOV023 | error | implementation_pr | Implementation branch/PR body metadata disagreement |
| GOV024 | error | implementation_pr | Replacement PR without reason or supersedes_pr |
| GOV025 | error | identity | Duplicate issue identity |
| GOV026 | error | parent_tracker | Canonical parent identifier absent, unresolved, or mismatched |
| GOV027 | error | body_authority | Structured derived field contradicts body content |

Policy version: `2.0.0` (unmerged pre-release correction).

## Source / Generated Ownership

- Canonical source: `_projects/development/issue-governance/_main/`
- Published skill: `skills/issue-governance/`
- Audit script: `repo/scripts/audit-issue-governance.cjs`
- Tests: `repo/tests/issue-governance.test.cjs`

Generated surfaces must not be edited directly. Update the source in `_projects/` and run sync.

## Consumer Adoption

Later phases will distribute versioned templates and audit assets to repositories that explicitly operate in `toolkit-governed` mode under #295 consent. This PR does not modify live issues or consumer repositories.

## Phase 2 / Phase 3

Phase 2 (Toolkit migration) and Phase 3 (governed consumer adoption) remain separate controller-reviewed phases. See #299 for the full phased plan.
