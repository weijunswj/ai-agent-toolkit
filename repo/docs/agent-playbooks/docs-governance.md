# Docs Governance

Use this for docs maps, repo maps, documentation indexes, changelogs, decision logs, ADRs, checklist ledgers, docs cleanup, archive/merge/delete decisions, and requests to add status/report/plan/handoff/audit docs.

## Operating Model

- Prefer one compact docs map or README per docs area over broad repo scans.
- Keep durable docs current-state oriented. Do not use permanent docs as task logs, handoffs, progress reports, scratch notes, or completion reports.
- Add a new doc only when an existing canonical doc cannot hold the durable information cleanly.
- Put detailed examples and checklists in routed docs, not always-loaded instructions.
- Preserve provenance, source-of-truth links, validation commands, unresolved risks, and maintenance-critical context when compressing old docs.

## Recommended Structure

For downstream repos that do not already have a better convention, prefer:

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

Use the structure as a starting point, not a reason to create empty folders or vanity docs.

## Docs Map

- Maintain a compact `docs/README.md` or equivalent when the docs tree is large enough that future agents would otherwise scan broadly.
- Link canonical docs, architecture notes, validation commands, source-of-truth docs, checklist ledgers, and archive policy from the map.
- Keep the map pointer-based. Do not turn it into a full file inventory, PR history, task log, or duplicate summary of every doc.

## Checklists

- Use checklist ledgers for durable readiness gates, not temporary task tracking.
- Give each checklist item a stable ID, such as `SEC-001` or `PROD-014`, so evidence can refer to it.
- Do not mark an item complete without evidence in the item text or a nearby evidence column.
- Evidence should name the file, command, test, PR, or reviewed source that proves the item.
- If evidence expires, leave the item unchecked or add a clear review date.

## Decisions And Changelog

- Use a compact decision log or ADRs for durable architectural and policy decisions.
- A decision entry should include the decision, date, context, alternatives considered when useful, and consequences.
- Use a changelog for user-visible or operationally relevant history. Do not duplicate PR-by-PR chatter.

## Merge, Archive, Or Delete

- Merge docs when two current docs describe the same workflow, policy, or source of truth.
- Archive docs when the historical context remains useful but is no longer current operating guidance.
- Delete docs only after durable content has been moved or is provably obsolete, duplicated, or temporary.
- For every removed or archived doc in a cleanup PR, report source path, action, durable-content destination, and why the action is safe.

## Anti-Bloat Guardrails

- Do not add root-level `STATUS.md`, `REPORT.md`, `PLAN.md`, `HANDOFF.md`, `COMPLETION.md`, `SCRATCH.md`, `NOTES.md`, or `AUDIT.md` unless the repo explicitly requires that path.
- Do not create scattered per-task status docs to preserve agent context. Use the PR body and final report for temporary continuation state.
- Do not create hooks or validators as part of docs-governance guidance unless the task explicitly asks for executable enforcement.
- Keep normal work changed-file-first; reserve repo-wide docs sweeps for explicit cleanup, audit, or governance tasks.
