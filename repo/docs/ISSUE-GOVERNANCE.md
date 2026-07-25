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

Every material task gets one child issue linked back to the repository's canonical parent tracker. The child must include at minimum:

- Current status and one reconciliation timestamp.
- Parent tracker and implementation PR.
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
- Parent link.
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

## Governance Modes

| Mode | Description |
|------|-------------|
| `toolkit-governed` | The global standard applies. Versioned templates and audit assets may be distributed after explicit governance consent. |
| `repository-native` | The repository's own issue process remains authoritative. Toolkit must not overwrite or impose its structure. |
| `unknown` | Governance mode must be selected. Toolkit must not silently install or enforce the standard. |

## Policy Versioning

The canonical policy is versioned using semver (`MAJOR.MINOR.PATCH`).

- Current version: `1.0.0`
- Source: `_projects/development/issue-governance/_main/policy/issue-governance-policy.json`

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
- Issue categories: canonical_parent_tracker, active_multi_step_child, small_atomic_child, recurring_evidence_log, superseded_duplicate_not_planned, complete.

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

| Code | Severity | Description |
|------|----------|-------------|
| GOV001 | error | toolkit-governed repository with no declared canonical parent |
| GOV002 | error | toolkit-governed repository with more than one canonical parent |
| GOV003 | warning | parent checklist entry with no linked child |
| GOV004 | error | active child with no parent link |
| GOV005 | error | active child absent from its declared parent checklist |
| GOV006 | error | parent/child link that is not bidirectional |
| GOV007 | error | checked parent item while the child remains open or acceptance is incomplete |
| GOV008 | error | closed or complete child with unchecked acceptance criteria |
| GOV009 | warning | complete child whose parent item remains unchecked or materially stale |
| GOV010 | error | missing current status |
| GOV011 | error | missing reconciliation timestamp |
| GOV012 | error | more than one reconciliation timestamp |
| GOV013 | warning | malformed reconciliation timestamp |
| GOV014 | error | missing `Why this issue exists` section |
| GOV015 | error | missing required child tracking dimensions |
| GOV016 | error | missing acceptance criteria |
| GOV017 | warning | superseded/duplicate/not-planned issue without a reason or successor |
| GOV018 | error | body or fixture explicitly treats PR merge as sufficient completion |
| GOV019 | error | implementer record or fixture claims independent acceptance without controller authority |
| GOV020 | warning | policy-version or generated-surface drift |

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
