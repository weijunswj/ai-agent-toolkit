# Portable Agent Playbook Index

Use this index only when it exists in the repo. Read the smallest matching playbook set; do not load every playbook by default.

## Routing

- Baseline small task: no extra playbook required. Continue with `AGENTS.md` and targeted repo docs.
- Broad, ambiguous, or high-blast-radius task: read [Baseline workflow](baseline-workflow.md) (`docs/agent-playbooks/baseline-workflow.md`).
- Final audit, completion audit, production-readiness audit, release-candidate audit, launch-readiness audit, QA pass, "make sure everything works", "is this production ready?", `/goal` readiness remediation, audit against original docs, security-readiness check, or final readiness check: read [Release readiness audit](release-readiness-audit.md) (`docs/agent-playbooks/release-readiness-audit.md`).
- Before G0 plans a programme child, when governance is first enabled on a repository with a programme, or when writing a decision comment on a programme issue: read [Decision trace](decision-trace.md) (`docs/agent-playbooks/decision-trace.md`).
- Live systems, credentials, secrets, customer/private data, destructive commands, deployment, Docker, service exposure, auth, or production risk: read [Safety gates](safety-gates.md) (`docs/agent-playbooks/safety-gates.md`).
- Personal or private data in checks, tests, fixtures, queries, logs or evidence, the personal-data guard, or reviewing a change for leaked personal data: read [Privacy-safe checks](privacy-safe-checks.md) (`docs/agent-playbooks/privacy-safe-checks.md`).
- Windows shell file inspection, log reads, command timeouts, stuck PowerShell reads, localhost dev-server restarts, duplicate watchers, or occupied ports: read [Windows command hygiene](windows-command-hygiene.md) (`docs/agent-playbooks/windows-command-hygiene.md`).
- A session or subagent switched to a fallback model by a safety classifier, or wording that may trigger false safety flags: read [Model safety flags](model-safety-flags.md) (`docs/agent-playbooks/model-safety-flags.md`).
- Docs map, repo map, documentation index, changelog, decision log, ADR, checklist ledger, checklist evidence, docs cleanup, archive/merge/delete decisions, or requests to add status/report/plan/handoff/audit docs: read [Docs governance](docs-governance.md) (`docs/agent-playbooks/docs-governance.md`).
- n8n workflow JSON, `n8n-workflows/`, n8n workflow helper scripts, import/export, live n8n, activation, execution, credentials, or repo/live sync: read [n8n workflows](n8n-workflows.md) (`docs/agent-playbooks/n8n-workflows.md`) and [Safety gates](safety-gates.md) (`docs/agent-playbooks/safety-gates.md`).
- Generated files, templates, schemas, migrations, source data, publishing, or regenerated output: read [Generated files](generated-files.md) (`docs/agent-playbooks/generated-files.md`).
- Git publication, pull requests, CI, review readiness, or status checks: read [Git completion](git-completion.md) (`docs/agent-playbooks/git-completion.md`).
- Features touching authority, approvals, custody, state machines or host configuration (Codex, Claude Code or other app settings files): read [Invariant models](invariant-models.md) (`docs/agent-playbooks/invariant-models.md`) before G0 planning, G1 tests or G2 review.
- Slow tests or CI, test runners, test shards, CI test jobs, or test time budgets: read [Fast tests and sharding](fast-tests-and-sharding.md) (`docs/agent-playbooks/fast-tests-and-sharding.md`).
- Unfamiliar repo, docs index, repo map, architecture notes, validation docs, source-of-truth docs, or documented workflow: read [Local docs](local-docs.md) (`docs/agent-playbooks/local-docs.md`).

If no match applies, continue baseline-only. If a referenced playbook is missing, continue safely using `AGENTS.md`; for install, repair, or refresh work, report that the repo-local playbook docs should be refreshed.
