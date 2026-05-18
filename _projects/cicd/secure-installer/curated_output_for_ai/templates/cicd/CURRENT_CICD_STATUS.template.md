<!--
Curated AI-facing source.
Project: cicd.secure-installer
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Current CI/CD Status

## Status

- CI installed: no
- Deployment enabled: no
- Production approval required: yes

## Workflow Files

- None yet.

## Checks

- Secret scanning: pending
- Dependency review: pending
- Lint: pending
- Tests: pending
- Build: pending

## Required Secrets

List secret names only. Do not include values.

- None yet.

## Manual Steps

- Review the generated CI plan.
- Add required GitHub Secrets directly in GitHub if deployment is later enabled.

## Safe Next Steps

- Run CI on a pull request.
- Add deployment only after CI is green and the deployment target is approved.

## Must Not Do Yet

- Do not deploy production.
- Do not bypass failing checks.
- Do not commit secret values.

## Debugging

Open the failed GitHub Actions run, inspect the failed job, and fix the underlying repo issue before rerunning.
