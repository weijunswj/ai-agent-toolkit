---
name: secure-ci-cd
description: Use when planning security-first CI/CD setup, GitHub Actions workflows, pipelines, pipeline hardening, required checks, security checks, deployment automation, build/test automation, automated validation, secret scanning, branch protection, release automation, installer prompt/status templates, or safe rollout planning.
---


# Secure CI/CD

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

- Canonical skill surface: [skills/secure-ci-cd/](./)
- Related contracts and policy: [repo/contracts/](../../repo/contracts/)

## Core Rules

- Run CI/CD commands only when they are part of the approved plan or a safe local validation step.
- Before installing packages, mutating deployment settings, or rotating credentials, pause, explain the risk, name the exact action and target, and ask for explicit current-turn approval. Never write secret values into repo files.
- Keep status tracking under `docs/ci-cd/` or another repo-documented docs folder, copy-ready and machine-readable when requested.
- Treat `.env*`, private keys, deployment tokens, and credential files as denied writes.
- Observability must stay privacy-safe: daily PASS/WARN/FAIL summaries, event allowlists, AI attempt ledger metadata, failure taxonomy, and output-shape diagnostics are allowed; raw prompts, uploads, model responses, customer content, secrets, auth headers, cookies, private connector data, provider calls, notification tests, production mutations, and auto-remediation require explicit approval or are forbidden as applicable.
- Keep n8n workflow-file transport routed to `n8n-workflow-transport` instead of duplicating its preparation steps here.
- Keep [`templates/cicd/secure-cicd-prompt.md`](templates/cicd/secure-cicd-prompt.md) loaded as the full guide; this SKILL.md is only the trigger surface, mandatory router, and high-priority safety summary.

## Related Routing

- Use `n8n-workflow-transport` for installing, copying, adapting, or validating n8n workflow-file transport helpers.
- For mixed Secure CI/CD and n8n helper/template requests, keep this skill focused on CI/CD safety and validation, then use the dedicated n8n skill for the n8n-specific procedure.

## Personal-Data Guard

- [`scripts/personal-data-guard.cjs`](scripts/personal-data-guard.cjs) is a zero-dependency scanner for email addresses, phone numbers and WhatsApp number links in file content (including Word, Excel, PowerPoint and PDF text), file names, commit and tag messages, branch names and pull request text. It prints the place, class and rule only, never the value, and any error that stops a complete scan fails.
- [`scripts/install-personal-data-guard.cjs`](scripts/install-personal-data-guard.cjs) installs it into a repository on the owner's opt-in: a copy under `.github/scripts/`, the config `.github/personal-data-guard.json` (the owner chooses whether author and committer addresses are scanned), git hooks in the folder git really uses, and with `--workflow` the CI job from [`templates/github-actions/personal-data-guard.yml`](templates/github-actions/personal-data-guard.yml). `--check` reports drift.
- Hooks can be skipped with `--no-verify`; the CI job is the backstop. Follow `docs/agent-playbooks/privacy-safe-checks.md` in the target repository (the repository-agent-rules playbook) for fixtures, allow markers and the pushed-by-mistake steps.

## Dependency Auto-Merge

- [`templates/github-actions/dependency-auto-merge.yml`](templates/github-actions/dependency-auto-merge.yml) turns on GitHub auto-merge, merge commit only, for Dependabot patch and minor updates, so GitHub merges only after every required check passes. It uses only the built-in token, never checks out the pull request's code, reads the policy from the base branch's programme binding (`dependency_updates.auto_merge: patch-minor` is the owner's standing permission) and refuses when no ruleset requires a check. Majors and maintainer changes get one comment for the owner.
- In a Toolkit-governed repository, `toolkit governance check` reports it with the other dependency and security settings, and `toolkit governance security` installs it once the binding allows auto-merge. Elsewhere, install it only on the owner's explicit approval, after required checks exist.

## AI-Facing Surfaces

- Reference: [references/secure-ci-cd.md](references/secure-ci-cd.md)
- Templates: [templates/cicd/](templates/cicd/)
- Scripts: [scripts/](scripts/)
