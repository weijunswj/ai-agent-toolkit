# Project Completion Audit

Use this playbook for final/completion/production-readiness/release-candidate/launch-readiness audits, QA pass, security-readiness check, final readiness check, "make sure everything works", "is this production ready?", "/goal" readiness remediation, or "audit against original docs." This playbook is a guardrail, not approval for a full audit.

## Lightweight Preflight First
During preflight, inspect only enough to identify:

- Repo/app name.
- Current branch/ref if available.
- App type: frontend, backend, full-stack, data/tooling, or mixed.
- Likely audit scope.
- Relevant local docs/instructions available.
- Whether UI, backend, data, deployment, auth, admin, uploads, APIs, logging, privacy, payments, external integrations, webhooks, or other security-sensitive surfaces appear to exist.
- Whether Codex Security appears installed/available, if detectable.
- Whether Playwright/browser verification appears available, if applicable.

Do not immediately run broad validation, full builds, browser sweeps, security scans, deployment/external-service checks, remediation, or destructive cleanup.

## Mandatory Confirmation
After preflight, stop and ask the user to confirm:

- Target repo/app.
- Branch/ref.
- Audit scope.
- Full-repo audit or scoped-folder audit.
- Whether Codex Security should be invoked if installed and available.
- Whether standard security scan or deep security scan is approved.
- Whether screenshot/browser click-through verification is approved for UI apps.
- That no live/deployment/destructive/external-service/credential/payment/customer-data/private-data actions are allowed without separate explicit current-turn approval naming target and action.

Require an explicit affirmative reply similar to:

```text
Proceed with full production-readiness audit for <target>.
```

Do not treat `ok`, `sure`, `go`, or `continue` as approval unless target and scope were unambiguous in the immediately preceding confirmation prompt.

## After Confirmation
Run two phases:

1. Production-readiness audit.
2. Security-readiness audit.

Read root `AGENTS.md`, repo playbook/index if present, root `MEMORY.md` if present, relevant product/architecture/requirements docs, and test/readiness/runbook docs. Compare intended behavior against actual implementation before fixes.

For UI projects, use approved browser/click-through verification where available, preferably Playwright/screenshots. For backend/data/tooling, use targeted tests, fixtures, CLI dry-runs, schemas, output checks, and error-path checks.

Review user/admin/protected workflows, API/backend behavior, error handling, privacy-safe logging, generic user-facing errors with traceable references, Privacy Policy and Terms links for product-facing or data-handling apps, and security-sensitive auth, uploads, webhooks, integrations, secrets, database, private data, payment, billing, entitlement, and logging surfaces.

## Security Readiness
Invoke Codex Security if installed and available. Prefer a standard security scan first. Do not run a deep security scan unless the user explicitly approved deep scan in the confirmation step.

Record availability, invocation, scan type, target/scope, status, findings, unresolved/false-positive/deferred items, and report/artifact paths.

If unavailable, state that clearly and fall back to manual review, static checks, and targeted tests where practical.

## Audit Report
Create or update a repo-local audit report. Use an existing docs/audit-style location if present. Otherwise use:

```text
docs/audits/YYYY-MM-DD-production-readiness-audit.md
```

Include scope, instruction sources, docs reviewed, branch/ref, app type, validation commands and exact results, UI/browser flows, artifact paths, security scan status/scope, findings table, release gates, remediation batches, manual checks, and unverified/skipped/failed/inaccessible/unavailable/deferred areas.

Classify findings:

- P0 production blocker.
- P1 release blocker.
- P2 quality gap.
- P3 nice-to-have/defer.

## Claim Rules
Do not claim "all security is covered" or imply perfect security. Prefer wording like:

- `No known unresolved P0/P1 security blockers found in the checks performed.`
- `Security coverage is limited to the declared scan scope and validation evidence.`
- `Unverified, unavailable, skipped, or deferred areas remain not production-cleared.`

Do not call the repo/app production-ready if any P0/P1 remains open, Codex Security was skipped/unavailable/incomplete or found unresolved high/critical-equivalent issues without recorded risk acceptance, required validation failed or was skipped/inaccessible without disclosure, or live/external/private-data checks are assumed rather than verified or explicitly deferred.

## Remediation
Only remediate after the audit report exists. Fix P0 before P1, and P1 before P2 unless reprioritized. Keep batches small, run targeted validation after each batch, re-run affected UI checks, update the report, record closed/partial/deferred/new findings, commit to a non-main branch, push, and open/update a PR unless local-only.

Stop for ambiguous product decisions, live-system actions, deployment, secrets, external services, destructive actions, customer/private data, or security-sensitive operations requiring explicit approval.
