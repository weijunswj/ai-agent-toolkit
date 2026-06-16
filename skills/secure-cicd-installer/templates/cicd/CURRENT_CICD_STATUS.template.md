<!--
Generated from toolkit curated output for AI. Do not edit directly.
Project: cicd.secure-installer
Source: _projects/cicd/secure-installer/curated_output_for_ai/templates/cicd/CURRENT_CICD_STATUS.template.md
Update the curated output and run sync.
-->
<!--
Curated AI-facing source.
Project: cicd.secure-installer
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

# Current CI/CD Status

Recommended repo path: `docs/ci-cd/CURRENT_CICD_STATUS.md`

If the repo already has a documented CI/CD, deployment, operations, or status document under `docs/` or another project docs folder, update that file instead of creating a duplicate.

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

## Deployment And AI Observability

- Baseline: privacy-safe and metadata-only
- Daily status rollup: PASS/WARN/FAIL pending setup
- Deployment event allowlist: CI result, deployment readiness, smoke test result, rollback readiness, manual approval state
- AI attempt ledger: timestamp, module name, request id, provider/model identifier, status, latency, retry count, safe token or byte counts, output-shape validation result
- AI failure taxonomy: blocked input, provider unavailable, timeout, rate limit, malformed output, validation failed, stale write skipped, user approval required
- Privacy rule: metadata-only; do not log raw prompts, uploads, model responses, customer content, secrets, auth headers, cookies, private connector data, payment data, or private files
- Action rule: no provider calls, notification tests, production mutations, or auto-remediation without explicit current-turn approval naming the target operation

## Must Not Do Yet

- Do not deploy production.
- Do not bypass failing checks.
- Do not commit secret values.

## Debugging

Open the failed GitHub Actions run, inspect the failed job, and fix the underlying repo issue before rerunning.
