# Secure CI/CD Installer

Source-derived from `weijunswj/ai-cicd-installer` `README.md`.

## Goal

Help an AI coding agent create a security-first CI/CD setup in a consumer repo while keeping the user in control of commits, pushes, PRs, deployment, and secrets.

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

- `templates/cicd/secure-cicd-prompt.md`
- `templates/cicd/CURRENT_CICD_STATUS.template.md`
- `templates/cicd/safe-source-update-policy.md`
- `packs/secure-cicd/pack.json`
