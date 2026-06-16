---
name: secure-cicd-installer
description: Instruction-only guidance for security-first CI/CD setup, GitHub Actions workflows, pipeline hardening, required checks, deployment automation planning, branch/status checks, release automation, installer prompt/status templates, and safe rollout planning. Use for any request mentioning CI/CD, CI, CD, GitHub Actions, workflows, pipelines, deployment automation, build/test automation, security checks, secret scanning, required checks, branch protection, or automated validation.
---

<!--
Curated AI-facing source.
Project: cicd.secure-installer
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Secure CI/CD Installer

Use this skill as a safety-gated router for this toolkit's Secure CI/CD installer procedure.

## Canonical Procedure

When this skill is invoked, read and follow [`templates/cicd/secure-cicd-prompt.md`](templates/cicd/secure-cicd-prompt.md) as the source-of-truth execution procedure.

The prompt template is not optional background material. It defines the required phases, safety gates, status tracking, secret-handling rules, and commit/push/PR/deployment approval policy.

## Approval Gate Precedence

When this skill applies, its approval gates override any repo-local default that would otherwise auto-commit, push, open a pull request, merge, or deploy.

Before committing, pushing, creating a pull request, merging, or deploying, pause, explain the risk, name the exact target and action, and ask for explicit user approval for that exact action.

## Required Execution Shape

- Inspect the target repo before editing.
- Verify repo access/state before changes.
- Scan for risky files and secrets before setup.
- Stop if secrets or risky credentials are found.
- Report risky file paths/status only; never print secret values.
- Prefer CI first; keep deployment disabled unless explicitly approved.
- Run security checks before lint, tests, build, package, or deploy.
- Use GitHub Secrets for private values.
- Never ask the user to paste secret values into chat.
- Create or update `docs/ci-cd/CURRENT_CICD_STATUS.md`.
- Define a metadata-only deployment and AI-module observability baseline before deployment, provider integrations, notification tests, or background AI features are enabled.
- Ask a clear approval question before commit, push, PR creation, merge, or deployment.

## Manual Secret Handling

- Give beginner-friendly GitHub Secret setup instructions using secret names only.
- Never request or display secret values in chat.
- Tell the user where to paste values directly in GitHub or the external platform.

## Source Module

- Project module: [_projects/cicd/secure-installer/](../../_projects/cicd/secure-installer/)
- Preserved source: [_projects/cicd/secure-installer/_main/](../../_projects/cicd/secure-installer/_main/)

## Core Rules

- Run CI/CD commands only when they are part of the approved plan or a safe local validation step.
- Before installing packages, mutating deployment settings, or rotating credentials, pause, explain the risk, name the exact action and target, and ask for explicit current-turn approval. Never write secret values into repo files.
- Keep status tracking under `docs/ci-cd/` or another repo-documented docs folder, copy-ready and machine-readable when requested.
- Treat `.env*`, private keys, deployment tokens, and credential files as denied writes.
- Observability must stay privacy-safe: daily PASS/WARN/FAIL summaries, event allowlists, AI attempt ledger metadata, failure taxonomy, and output-shape diagnostics are allowed; raw prompts, uploads, model responses, customer content, secrets, auth headers, cookies, private connector data, provider calls, notification tests, production mutations, and auto-remediation require explicit approval or are forbidden as applicable.
- Keep n8n helper-script and reusable workflow-template procedures routed to the dedicated n8n skills instead of duplicating their copy/install steps here.
- Keep [`templates/cicd/secure-cicd-prompt.md`](templates/cicd/secure-cicd-prompt.md) loaded as the full guide; this SKILL.md is only the trigger surface, mandatory router, and high-priority safety summary.

## Related Routing

- Use `n8n-workflow-helper-scripts` for installing, copying, adapting, or validating n8n import/export/sync helper scripts.
- Use `n8n-workflow-templates` for selecting, copying, publishing, or adapting reusable n8n workflow templates.
- For mixed Secure CI/CD and n8n helper/template requests, keep this skill focused on CI/CD safety and validation, then use the dedicated n8n skill for the n8n-specific procedure.

## AI-Facing Surfaces

- Reference: [references/secure-cicd-installer.md](references/secure-cicd-installer.md)
- Templates: [templates/cicd/](templates/cicd/)
- Pack checklist: [packs/secure-cicd/pack.json](packs/secure-cicd/pack.json)
