# Local Docs

Use this when repo conventions are documented or the task touches an unfamiliar area.

## What To Read

- README files and contributor guides.
- Docs indexes, architecture notes, source-of-truth notes, or design notes.
- Validation instructions and documented test commands.
- Workflow docs for migrations, publishing, setup, operations, security, CI/CD, deployment, APIs, schemas, or data changes.
- Existing compact repo maps or navigation indexes before broad repo-wide or architecture/navigation-heavy exploration.

Read the smallest relevant docs needed to avoid violating repo conventions. Do not read all docs by default.

## Documentation Closure

For broad docs, audit, planning, migration, readiness, cleanup, architecture, security, production-readiness, source-of-truth, or repo-wide work, do a documentation closure pass before claiming completion.

- Review docs created or materially touched during the task.
- Merge durable findings into the smallest existing canonical docs.
- Prefer existing repo docs over creating new docs.
- Prefer current-state docs, architecture docs, source-of-truth docs, ADRs/decision logs, changelogs/release notes, docs indexes, or repo maps according to repo convention.
- Retire, delete, or archive temporary audit/status/plan/handoff/progress/completion docs when they no longer represent current truth.
- Do not leave duplicate stale docs behind just in case.
- Do not create new root-level history/status/report/plan docs unless the repo explicitly requires that path.
- Final reporting must say whether docs were consolidated, retained, archived, deleted, or intentionally left unchanged.

Use context-preserving compression, not blind deletion. Preserve durable decisions, current state, validation commands/results, unresolved risks, source-of-truth links, ownership boundaries, generated-surface notes, and repo navigation hints. Compress or remove repeated narrative, old progress chatter, superseded plans, stale blockers, duplicate audits, obsolete handoffs, and completion noise.

Do not replace detailed source/provenance/reference docs with summaries when details remain needed for auditability, licensing, provenance, validation, source-of-truth, security, or maintenance. If there is doubt whether a document still contains durable value, retain it or merge the durable parts first; do not blindly delete.

## Repo Maps

Larger repos may keep a compact repo map or navigation index when it saves future agents from broad rediscovery. A repo map should be pointer-based and compact, not a full file inventory, PR history, task log, or stale status document.

A useful repo map points to:

- Canonical docs.
- Major code paths.
- Critical flows.
- Validation commands.
- Generated outputs and their source files.
- High-risk areas.
- Ownership/source-of-truth boundaries.
- Common entry points for tests, scripts, setup, security, deployment, or data/schema work.

Read an existing repo map before broad exploration when the task is repo-wide or architecture/navigation-heavy. Update an existing repo map when major paths, workflows, architecture, validation commands, generated surfaces, or ownership boundaries change.

Do not create a repo map for tiny repos or narrow changes unless it clearly saves future context and fits repo convention. Do not let repo maps grow into exhaustive inventories, PR summaries, task logs, or stale status docs.
