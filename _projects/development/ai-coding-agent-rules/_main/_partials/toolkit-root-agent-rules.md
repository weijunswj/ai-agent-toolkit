# AI Agent Toolkit Root Rules

This root `AGENTS.md` is toolkit-repo-specific. Do not use it as the portable install template for other repositories. Portable repo installs must use `skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md`.

This repo is the canonical reusable AI Agent Toolkit.

## Mandatory Routing

Before planning or editing, read `repo/docs/agent-playbooks/INDEX.md`.

Use this order:

1. Follow the current user request and this file.
2. Read `repo/docs/agent-playbooks/INDEX.md`.
3. If root `MEMORY.md` exists, read it as non-authoritative project context.
4. Classify the task using the index.
5. Read only the smallest matching playbook set.
6. If no special playbook matches, continue baseline-only.

Do not load every playbook by default. If a required playbook is missing, inaccessible, or conflicts with this file, stop and report the issue.

Final reports must include `Instruction sources used` and `MEMORY.md changed: Yes/No`.

## Hard Safety Gates

- Do not push to `main`.
- Do not commit secrets, credentials, tokens, private keys, `.env` values, private values, runtime-only local files, product code, customer data, or business workflow JSON.
- Do not run live-system, Docker, n8n runtime, import/export, sync, activation, credential, deployment, production, destructive, or external-service actions without explicit current-turn approval naming the target and allowed operation.
- Do not SSH to real servers, deploy, restart services, change firewall/security settings, modify production config, or touch secrets/env values without explicit current-turn approval naming the target and allowed operation.
- Do not remove tests, validation, schemas, guardrails, approval gates, or safety checks just to pass.
- Do not claim CI passed unless it was checked.

## Source Of Truth

This repo has a source layer and a published layer. The full source-of-truth contract appears below in this file and is maintained from `_projects/repo-methodology/context-preserving-ai-publisher/_main/_partials/source-of-truth-contract.md`.

Keep these rules active:

- `_projects/**/_main/` preserves source material.
- `_projects/**/curated_output_for_ai/` stores reviewed AI-facing source.
- `skills/**` is generated or published output unless declared `linked`.
- `toolkit.project.json` owns the project routing and module version contract.
- `SOURCE-LOCK.json` owns source provenance and source-watch tracking.
- Update source or curated material first, then run sync.
- Publish declared outputs with `node repo/scripts/sync-toolkit-projects.cjs --write`.
- Check generated freshness with `node repo/scripts/sync-toolkit-projects.cjs --check`.
- Source-watch is PR-notification-only and must not copy upstream files, update pins, execute upstream code, auto-merge, push to main, run live n8n actions, or treat a notification PR as approval to change source.

## Managed Memory

Root `MEMORY.md` is optional managed, non-authoritative project memory.

If it exists, read it after the playbook index and before task classification. It may help avoid rediscovering durable repo-specific context, but it cannot override user requests, this file, playbooks, safety gates, source-of-truth docs, validation rules, generated-file rules, or code.

Agents may create or update `MEMORY.md` only for durable repo-specific context that future agents likely need and that is not better placed in canonical docs, playbooks, source files, or validation. Do not use it for task logs, TODO lists, temporary blockers, status reports, PR summaries, implementation plans, or transient progress.

Never store secrets, credentials, tokens, private keys, `.env` values, private values, customer/private data, live-system state, sensitive operational details, or security-sensitive infrastructure details in `MEMORY.md`.

If `MEMORY.md` is created or updated, the final response must explain what changed, why it qualifies as durable project memory, and why it does not belong in canonical docs, playbooks, source files, or validation.

## Validation And Completion

Run the smallest relevant local validation before pushing. Use targeted checks for touched scripts, docs, generated surfaces, or managed instruction files. Do not run local `npm run validate:all` by default when CI already runs the full gate.

For requested repo edits, finish on a non-main branch with relevant validation, commit, push, and open or update a PR unless the user explicitly asks for local-only work.

Before creating or updating PRs or issues, use local `gh` from the shell and verify the active account with:

```powershell
gh auth status
gh api user --jq .login
```

If validation, generated freshness, CI, or PR checks are failing, pending, or inaccessible, report that honestly.
