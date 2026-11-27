---
name: toolkit-playbooks
description: Use before planning or editing in any repository to pick the Toolkit playbook that applies, such as safety gates, git completion and closing comments, decision traces, privacy-safe checks, generated files, docs, fast tests and sharding, Windows commands, n8n workflows, release readiness, invariant models or model safety flags. Read only the matching playbooks.
---

# Toolkit Playbooks

The Toolkit's working playbooks, shipped with the plugin so no repository needs a copy. Read the smallest matching set; do not load every playbook by default.

## Routing

- Baseline small task: no extra playbook required. Continue with `AGENTS.md` and targeted repo docs.
- Broad, ambiguous, or high-blast-radius task: read [Baseline workflow](baseline-workflow.md).
- Final audit, completion audit, production-readiness audit, release-candidate audit, launch-readiness audit, QA pass, "make sure everything works", "is this production ready?", `/goal` readiness remediation, audit against original docs, security-readiness check, or final readiness check: read [Release readiness audit](release-readiness-audit.md).
- Before G0 plans a programme child, when governance is first enabled on a repository with a programme, or when writing a decision comment on a programme issue: read [Decision trace](decision-trace.md).
- Live systems, credentials, secrets, customer/private data, destructive commands, deployment, Docker, service exposure, auth, or production risk: read [Safety gates](safety-gates.md).
- Personal or private data in checks, tests, fixtures, queries, logs or evidence, the personal-data guard, or reviewing a change for leaked personal data: read [Privacy-safe checks](privacy-safe-checks.md).
- Windows shell file inspection, log reads, command timeouts, stuck PowerShell reads, localhost dev-server restarts, duplicate watchers, or occupied ports: read [Windows command hygiene](windows-command-hygiene.md).
- A session or subagent switched to a fallback model by a safety classifier, or wording that may trigger false safety flags: read [Model safety flags](model-safety-flags.md).
- Writing or changing user-facing docs or text, docs map, repo map, documentation index, changelog, decision log, ADR, checklist ledger, checklist evidence, docs cleanup, archive/merge/delete decisions, or requests to add status/report/plan/handoff/audit docs: read [Docs governance](docs-governance.md).
- n8n workflow JSON, `n8n-workflows/`, n8n workflow helper scripts, import/export, live n8n, activation, execution, credentials, or repo/live sync: read [n8n workflows](n8n-workflows.md) and [Safety gates](safety-gates.md).
- Generated files, templates, schemas, migrations, source data, publishing, or regenerated output: read [Generated files](generated-files.md).
- Git publication, pull requests, CI, review readiness, or status checks: read [Git completion](git-completion.md).
- Closing, merging or asking the owner to merge a PR or issue: read [Closing comments](closing-comments.md).
- Features touching authority, approvals, custody, state machines or host configuration (Codex, Claude Code or other app settings files): read [Invariant models](invariant-models.md) before G0 planning, G1 tests or G2 review.
- Slow tests or CI, long or background commands, test runners, test shards, CI test jobs, test time budgets, or a `speed.shards` or `speed.shards-lopsided` CI check-up finding: read [Fast tests and sharding](fast-tests-and-sharding.md).
- Unfamiliar repo, docs index, repo map, architecture notes, validation docs, source-of-truth docs, or documented workflow: read [Local docs](local-docs.md).

If no match applies, continue baseline-only. If a playbook here is missing, continue safely with the global rules and report that Toolkit needs `setup toolkit`.
