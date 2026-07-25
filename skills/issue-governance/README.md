<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: development.issue-governance
Source: _projects/development/issue-governance/curated_output_for_ai/skills/issue-governance/README.md
Update the curated output and run sync.
-->
# Issue Governance

Toolkit global issue-governance standard for `toolkit-governed` repositories.

## What This Skill Does

- Defines the canonical lean-parent/comprehensive-child issue model.
- Provides machine-readable policy metadata and versioning.
- Supplies templates for parent trackers, comprehensive children, and reduced atomic children.
- Validates local issue snapshots with a deterministic advisory audit.
- Produces stable finding codes (GOV001–GOV027).
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
Policy version: 2.0.0
