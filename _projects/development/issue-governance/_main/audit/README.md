# Issue Governance Advisory Audit

## Overview

The advisory audit is a deterministic, read-only command that validates local issue snapshots against the Toolkit global issue-governance policy.

## Properties

- Read-only: never mutates issue data.
- No credentials required.
- No network requests.
- No GitHub API calls.
- Never rewrites issue data.
- Never ticks checkboxes.
- Never closes, reopens, or comments on issues.
- Deterministic: identical input produces identical output.
- Supports human-readable and structured JSON output.
- Uses stable finding codes (GOV001–GOV020).
- Privacy-safe diagnostics: no full issue bodies or unnecessary private paths in output.

## Command

```powershell
node repo/scripts/audit-issue-governance.cjs --input <snapshot.json>
node repo/scripts/audit-issue-governance.cjs --input <snapshot.json> --format json
node repo/scripts/audit-issue-governance.cjs --input <snapshot.json> --format human
```

## Exit Codes

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

## Semantic Rules

The audit uses explicit structured fields, exact markers, or conservative deterministic patterns. It does not build speculative natural-language judgement. False negatives are preferred over false accusations.

## Snapshot Input

See `schema/issue-snapshot.schema.json` for the full input schema.

## Source

Canonical source: `_projects/development/issue-governance/_main/`
Policy version: 1.0.0
