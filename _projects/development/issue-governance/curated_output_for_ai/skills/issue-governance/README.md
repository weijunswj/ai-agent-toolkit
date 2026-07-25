# Issue Governance

Toolkit global issue-governance standard for `toolkit-governed` repositories.

## What This Skill Does

- Defines the canonical lean-parent/comprehensive-child issue model.
- Provides machine-readable policy metadata and versioning.
- Supplies templates for parent trackers, comprehensive children, and reduced atomic children.
- Validates local issue snapshots with a deterministic advisory audit.
- Produces stable finding codes (GOV001–GOV020).
- Enforces controller-vs. implementer authority boundaries.

## Quick Start

```powershell
# Run an advisory audit on a local snapshot
node repo/scripts/audit-issue-governance.cjs --input snapshot.json

# JSON output
node repo/scripts/audit-issue-governance.cjs --input snapshot.json --format json

# Human-readable output
node repo/scripts/audit-issue-governance.cjs --input snapshot.json --format human
```

## Source

Canonical source: `_projects/development/issue-governance/_main/`
Policy version: 1.0.0
