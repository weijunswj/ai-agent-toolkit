<!--
Curated AI-facing source.
Project: cicd.secure-installer
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# CI/CD Templates

Reusable secure CI/CD source materials.

## Files

- `secure-cicd-prompt.md`: prompt for an AI coding agent to install CI/CD safely in a consumer repo.
- `CURRENT_CICD_STATUS.template.md`: status-file shape for consumer repos; copy or adapt it as `docs/ci-cd/CURRENT_CICD_STATUS.md` unless the repo already documents another CI/CD status path.
- `safe-source-update-policy.md`: policy for source update detection and review.

These are templates. Review and adapt them before use.
