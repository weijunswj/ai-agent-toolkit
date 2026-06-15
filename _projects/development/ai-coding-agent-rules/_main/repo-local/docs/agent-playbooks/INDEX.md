# Portable Agent Playbook Index

Use this index only when it exists in the repo. Read the smallest matching playbook set; do not load every playbook by default.

## Routing

- Baseline small task: no extra playbook required. Continue with `AGENTS.md` and targeted repo docs.
- Broad, ambiguous, or high-blast-radius task: read [Baseline workflow](baseline-workflow.md) (`docs/agent-playbooks/baseline-workflow.md`).
- Live systems, credentials, secrets, customer/private data, destructive commands, deployment, Docker, service exposure, auth, or production risk: read [Safety gates](safety-gates.md) (`docs/agent-playbooks/safety-gates.md`).
- Generated files, templates, schemas, migrations, source data, publishing, or regenerated output: read [Generated files](generated-files.md) (`docs/agent-playbooks/generated-files.md`).
- Git publication, pull requests, CI, review readiness, or status checks: read [Git completion](git-completion.md) (`docs/agent-playbooks/git-completion.md`).
- Root `MEMORY.md` create/update/review: read [Managed memory](managed-memory.md) (`docs/agent-playbooks/managed-memory.md`).
- Unfamiliar repo, docs index, architecture notes, validation docs, source-of-truth docs, or documented workflow: read [Local docs](local-docs.md) (`docs/agent-playbooks/local-docs.md`).

If no match applies, continue baseline-only. If a referenced playbook is missing, continue safely using `AGENTS.md`; for install, repair, or refresh work, report that the repo-local playbook docs should be refreshed.
