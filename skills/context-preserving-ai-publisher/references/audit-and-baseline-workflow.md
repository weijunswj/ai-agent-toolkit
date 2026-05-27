<!--
Generated from toolkit project source. Do not edit directly.
Project: repo-methodology.context-preserving-ai-publisher
Source: _projects/repo-methodology/context-preserving-ai-publisher/_main/audit-and-baseline-workflow.md
Update the project source and run sync.
-->
# Audit And Baseline Workflow

Audits make source-to-surface drift visible. Baselines make known findings explicit while follow-up cleanup is still in progress.

## Audit Targets

Use audits to detect:

- Published files not declared by any manifest.
- Generated outputs that are stale.
- Curated files that look like lossy replacements for full source.
- Source docs copied into the wrong project surface.
- Shared-surface outputs without ownership metadata.
- Broken source locks or missing provenance notes.
- Broken relative links after publishing.
- Suspicious package artifacts, credentials, live exports, or private files.

## Running Audits

Prefer the target repo's documented commands. If no commands exist, add small deterministic checks before adding broad automation.

Use `validation-strategy.md` for validation cadence: targeted checks during iteration, plus the target repo's CI or documented full gate for completion.

For this toolkit repo, `npm run validate:all` is the canonical full validation command and required merge gate.

A good audit command should:

- Read local files only.
- Avoid network calls.
- Avoid live-system actions.
- Avoid executing PR-controlled generated code.
- Print stable findings.
- Exit nonzero when new unreviewed findings appear.

## Updating Baselines

Update a baseline only when all of these are true:

- The audit was run after sync.
- The new findings or count movement were inspected.
- The movement is caused by the current intentional change.
- No new undeclared, cross-owned, suspicious, or boundary findings were introduced accidentally.
- The PR summary records the exact movement.

For `_projects/**/_main/**` source or provenance PRs, do not rely on privileged auto-sync to bless or repair the change. The author or Codex must update source-lock or provenance metadata when needed, regenerate declared outputs, and update inspected audit baselines when needed. Read-only CI should fail when those steps are missed.

## PR Reporting

Report:

- Which outputs were added, removed, or reclassified.
- Whether the baseline changed.
- Exact count movement for relevant categories.
- Which findings stayed unchanged.
- Which validation commands passed.

If a baseline failure reveals an unrelated pre-existing issue, do not fix it in a focused PR unless the user asked for that cleanup.
