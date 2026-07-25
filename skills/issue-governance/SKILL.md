---
name: issue-governance
description: Use when working with issue governance policy, issue templates, parent/child tracker structure, reconciliation timestamps, controller-vs-implementer authority, governance modes, issue snapshot validation, or advisory audits. Do not use for ordinary issue triage, live issue mutation, or GitHub API writes.
---

<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: development.issue-governance
Source: _projects/development/issue-governance/curated_output_for_ai/skills/issue-governance/SKILL.md
Update the curated output and run sync.
-->
# Issue Governance

## Overview

This skill provides the Toolkit global issue-governance standard for `toolkit-governed` repositories. It defines the lean-parent/comprehensive-child model, reconciliation timestamp contract, controller-versus-implementer authority boundary, governance modes, and deterministic advisory audit.

## When To Use

- Configuring a repository for `toolkit-governed` mode.
- Creating or reviewing lean parent programme trackers.
- Creating or reviewing comprehensive or reduced atomic child issues.
- Validating issue snapshots against the governance policy.
- Understanding controller vs. implementer authority boundaries.
- Running advisory audits with stable finding codes.

## When Not To Use

- Ordinary issue triage or bug filing.
- Live issue mutation, closing, reopening, or commenting.
- GitHub API writes or automation.
- Modifying consumer repositories without explicit consent.

## Governance Modes

### toolkit-governed

The global standard applies. Versioned templates and audit assets may be distributed after explicit governance consent.

### repository-native

The repository's own issue process remains authoritative. Toolkit must not overwrite or impose its structure.

### unknown

Governance mode must be selected. Toolkit must not silently install or enforce the standard.

## Lean Parent / Comprehensive Child Model

Each governed repository declares exactly one canonical programme tracker (the parent). The parent is a concise checklist-first queue, not a duplicate evidence archive.

Each material task has one comprehensive child issue linked back to the parent. The child includes current status, reconciliation timestamp, parent link, why the issue exists, goal and scope, completed work, blockers, remaining steps, acceptance criteria, linked PRs, decisions, and safety/authority.

Small atomic tasks may use a reduced template but must retain the core required dimensions.

## Authority Model

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

## Reconciliation Timestamp

Format: `Last reconciled: **DD Month YYYY, HH:mm SGT**`

Rules:
- Asia/Singapore time, 24-hour to the minute.
- Exactly one timestamp per issue body.
- Replace rather than stack.
- Advance only after substantive reconciliation.

## Advisory Audit Command

```powershell
node repo/scripts/audit-issue-governance.cjs --input <snapshot.json>
node repo/scripts/audit-issue-governance.cjs --input <snapshot.json> --format json
node repo/scripts/audit-issue-governance.cjs --input <snapshot.json> --format human
```

Exit codes:
- `0` — no violations.
- `1` — violations found.
- `2` — input/schema or execution failure.

## Stable Finding Codes

See `repo/docs/ISSUE-GOVERNANCE.md` for the complete list of GOV001–GOV020 finding codes.

## Source

Canonical source: `_projects/development/issue-governance/_main/`
Published surface: `skills/issue-governance/`
Policy version: 1.0.0
