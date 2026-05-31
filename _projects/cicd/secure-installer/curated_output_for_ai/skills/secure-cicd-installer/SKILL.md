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

Do not commit, push, create a pull request, merge, or deploy without explicit user approval for that exact action.

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
- Create or update `CURRENT_CICD_STATUS.md`.
- Ask before commit, push, PR creation, merge, or deployment.

## Manual Secret Handling

- Give beginner-friendly GitHub Secret setup instructions using secret names only.
- Never request or display secret values in chat.
- Tell the user where to paste values directly in GitHub or the external platform.

## Source Module

- Project module: [_projects/cicd/secure-installer/](../../_projects/cicd/secure-installer/)
- Preserved source: [_projects/cicd/secure-installer/_main/](../../_projects/cicd/secure-installer/_main/)

## Core Rules

- Do not run CI/CD commands by default.
- Do not install packages, mutate deployment settings, rotate credentials, or write secrets unless the user explicitly approves the exact action and target.
- Keep status tracking copy-ready and machine-readable when requested.
- Treat `.env*`, private keys, deployment tokens, and credential files as denied writes.
- Keep [`templates/cicd/secure-cicd-prompt.md`](templates/cicd/secure-cicd-prompt.md) loaded as the full guide; this SKILL.md is only the trigger surface, mandatory router, and high-priority safety summary.

## AI-Facing Surfaces

- Reference: [references/secure-cicd-installer.md](references/secure-cicd-installer.md)
- Templates: [templates/cicd/](templates/cicd/)
- Pack checklist: [packs/secure-cicd/pack.json](packs/secure-cicd/pack.json)
