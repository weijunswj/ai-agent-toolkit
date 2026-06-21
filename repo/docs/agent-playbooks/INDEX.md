# Agent Playbook Index

## Purpose

Classify toolkit repo tasks before planning or editing. Read only the playbooks that match the task.

## Global Routing Rules

1. Follow root `AGENTS.md`.
2. Read this index.
3. If root `MEMORY.md` exists, read it as non-authoritative context.
4. Classify the task using the matches below.
5. Read every matching playbook, but do not load every playbook by default.
6. If no special match applies, proceed baseline-only with `AGENTS.md` and this index.
7. If a required playbook is missing, inaccessible, or conflicts with `AGENTS.md`, stop and report the issue.

Final reports must list `Instruction sources used`, including `MEMORY.md` when it was present and read.

## Always-Active Baseline

For a normal small code or docs task with no special match, do not read `baseline-workflow.md` by default. Continue baseline-only.

Read `repo/docs/agent-playbooks/baseline-workflow.md` only when the task is broad, ambiguous, high-blast-radius, or explicitly asks for detailed workflow guidance.

## Match: Repo-Local Agent Instruction Work

Triggers: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.agents/rules`, managed markers, agent bootstrap, repo-local templates, instruction shims, or the `ai-coding-agent-rules` project.

Read: `repo/docs/agent-playbooks/repo-local-agent-instructions.md`.

Stop if the source/output ownership is unclear or a generated instruction file would be edited directly without a linked exception.

## Match: Generated Output Or Publishing Work

Triggers: `skills/**`, `_projects/**`, `curated_output_for_ai`, `_main`, `toolkit.project.json`, `SOURCE-LOCK.json`, generated outputs, sync scripts, source-of-truth contract, source-watch, audit baselines, package outputs, or published-surface validation.

Read: `repo/docs/agent-playbooks/generated-output-and-publishing.md`.

Stop if the change would weaken source-of-truth, provenance, generated-output ownership, or attribution rules.

## Match: n8n Work

Triggers: n8n workflow JSON, workflow templates, helper scripts, MCP, import/export, live n8n, credentials, activation, execution, repo/live sync, webhook IDs, static data, or n8n safety.

Read: `repo/docs/agent-playbooks/n8n-safety-and-workflows.md`.

Stop before live n8n, Docker, import/export, sync, activation, execution, publish/unpublish, credential, deployment, production, destructive, or privileged external actions. Require explicit current-turn approval naming the target and operation.

## Match: Hostinger, Coolify, VPS, SSH, Or Deployment Work

Triggers: Hostinger, Coolify, VPS, SSH, production deployment, reverse proxy, Docker Compose, firewall, server backups, service restart, DNS/TLS, secrets, or production security checks.

Read: `repo/docs/agent-playbooks/hostinger-coolify-vps.md`.

Stop before SSHing into a real server, deploying, restarting services, changing firewall/security settings, modifying production config, or touching secrets/env values. Require explicit current-turn approval naming the target and operation.

## Match: PR Review, CI, Or Merge-Readiness Work

Triggers: PR review, CI status, merge readiness, test failure verification, diff analysis, PR feedback, check runs, workflow logs, or release readiness.

Read: `repo/docs/agent-playbooks/pr-review-and-ci.md`.

Do not claim CI passed unless checked. Do not do reviews from metadata alone.

## Match: Project Completion Or Production-Readiness Audit Work

Triggers: final audit, completion audit, production-readiness audit, release-candidate audit, launch-readiness audit, QA pass, "make sure everything works", "is this production ready?", `/goal` readiness remediation, audit against original docs, security-readiness check, or final readiness check.

Read: `skills/project-completion-audit/SKILL.md` when generated/published outputs are present; when editing the source in this toolkit repo, read `_projects/development/project-completion-audit/_main/skill/SKILL.md`.

Only lightweight preflight is allowed before explicit confirmation. Stop before broad validation, full builds, browser sweeps, security scans, deployment checks, external-service checks, or remediation until the user confirms the target and scope.

## Match: Risky Or Live-System Work

Triggers: credentials, secrets, customer/private data, production behavior, external service writes, destructive commands, deployments, runtime state, live databases, auth/security settings, Docker, n8n live actions, SSH, or firewall changes.

Read: `repo/docs/agent-playbooks/safety-gates.md`.

Stop before the risky action. Require explicit current-turn approval naming the target and operation.
