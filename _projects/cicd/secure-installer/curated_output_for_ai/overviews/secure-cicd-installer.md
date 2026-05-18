<!--
Curated AI-facing source.
Project: cicd.secure-installer
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Secure CI/CD Installer Overview

## Goal

Help an AI coding agent create a security-first CI/CD setup in a consumer repo while keeping the user in control of commits, pushes, PRs, deployment, and secrets.

## Boundary

This is a short reviewed operating overview and safety wrapper. It is not the full runtime guide.

## Required Behavior

- Inspect the target repo before editing.
- Scan for risky files and secrets before setup.
- Do not print secret values.
- Do not commit, push, create a PR, merge, or deploy without approval.
- Prefer CI first, deployment later.
- Use GitHub Secrets for private values.
- Keep `CURRENT_CICD_STATUS.md` updated in the consumer repo.

## Pipeline Defaults

Run security checks before lint, tests, build, package, or deploy. Deployment should be disabled unless the user approves a deployment plan.

## Toolkit Materials

- [Secure CI/CD prompt](../templates/cicd/secure-cicd-prompt.md)
- [Current CI/CD status template](../templates/cicd/CURRENT_CICD_STATUS.template.md)
- [Safe source update policy](../templates/cicd/safe-source-update-policy.md)
- [Secure CI/CD pack](../packs/secure-cicd/pack.json)
