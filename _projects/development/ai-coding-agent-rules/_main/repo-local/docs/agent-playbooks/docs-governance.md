# Docs Governance

Use this for docs maps, repo maps, documentation indexes, changelogs, decision logs, ADRs, checklist ledgers, docs cleanup, archive/merge/delete decisions, or requests to add status/report/plan/handoff/audit docs.

## Core Rules

- Prefer a compact docs map over broad repo scans when a repo has many docs.
- Keep durable docs current-state oriented; do not use them as task logs, handoffs, progress reports, scratch notes, or completion reports.
- Add a new doc only when an existing canonical doc cannot hold the durable information cleanly.
- Put detailed examples and checklists in routed docs, not always-loaded instructions.
- Preserve provenance, source-of-truth links, validation commands, unresolved risks, and maintenance-critical context when compressing old docs.

## Suggested Structure

For repos without a better convention, start from:

```text
docs/
  README.md
  CHANGELOG.md
  DECISIONS.md
  checklists/
    production-readiness.md
    security-readiness.md
    docs-hygiene.md
  architecture/
    README.md
  admin/
    README.md
  deployment/
    README.md
  qa/
    README.md
  archive/
    README.md
```

Create folders only when they will contain real current docs.

## Docs Maps

- Link canonical docs, architecture notes, validation commands, source-of-truth docs, checklist ledgers, and archive policy.
- Keep maps pointer-based; do not turn them into full inventories, PR histories, task logs, or duplicate summaries.

## Checklists

- Use checklist ledgers for durable readiness gates, not temporary task tracking.
- Give each checklist item a stable ID, such as `SEC-001` or `PROD-014`.
- Do not mark an item complete without evidence in the item text or a nearby evidence column.
- Evidence should name the file, command, test, PR, or reviewed source that proves the item.

## Decisions And Changelog

- Use a compact decision log or ADRs for durable architecture and policy choices.
- A decision entry should include the decision, date, context, and consequences.
- Use a changelog for user-visible or operationally relevant history, not PR-by-PR chatter.

## Merge, Archive, Or Delete

- Merge docs when two current docs describe the same workflow, policy, or source of truth.
- Archive docs when historical context remains useful but is no longer current guidance.
- Delete docs only after durable content has been moved or is provably obsolete, duplicated, or temporary.
- In cleanup reports, list each removed or archived path, the action, durable-content destination, and why it is safe.

## Anti-Bloat

- Do not add root-level `STATUS.md`, `REPORT.md`, `PLAN.md`, `HANDOFF.md`, `COMPLETION.md`, `SCRATCH.md`, `NOTES.md`, or `AUDIT.md` unless the repo requires that path.
- Do not create scattered per-task status docs for agent context. Use the PR body and final report for temporary continuation state.
- Keep normal work changed-file-first; reserve repo-wide docs sweeps for explicit cleanup, audit, or governance tasks.
